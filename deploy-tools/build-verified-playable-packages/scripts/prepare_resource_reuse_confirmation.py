#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

SCRIPT_ROOT = Path(__file__).resolve().parent
LIB_ROOT = SCRIPT_ROOT / "lib"
sys.path.insert(0, str(LIB_ROOT))
sys.path.insert(0, str(SCRIPT_ROOT))

from record_resource_apply_approval import verified_proposal
from render_resource_apply_confirmation import render_markdown as render_gate_b_markdown
from resource_common import (
    file_ref,
    is_within,
    load_json,
    sha256_file,
    sha256_object,
    sha256_paths,
    utc_now,
    write_json_atomic,
)


SCHEMA = "playable-resource-reuse-confirmation-v1"
STATE_SCHEMA = "playable-resource-state-verification-v1"
RUN_SCHEMA = "playable-package-finalization-run-v1"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="生成历史资源候选复用确认单；展示既有 Gate A、Gate B 和 A/B 报告后等待本轮确认")
    parser.add_argument("--project-root", required=True, type=Path)
    parser.add_argument("--historical-run-manifest", required=True, type=Path)
    parser.add_argument("--resource-state", required=True, type=Path)
    parser.add_argument("--effect-baseline", required=True, type=Path)
    parser.add_argument("--reference-graph", required=True, type=Path)
    parser.add_argument("--allowlist", required=True, type=Path)
    parser.add_argument("--optimization-plan", required=True, type=Path)
    parser.add_argument("--toolchain-lock", required=True, type=Path)
    parser.add_argument("--current-context", required=True, type=Path)
    parser.add_argument("--gate-a-report", required=True, type=Path)
    parser.add_argument("--gate-b-report", required=True, type=Path)
    parser.add_argument("--fidelity-review", required=True, type=Path)
    parser.add_argument("--json-out", required=True, type=Path)
    parser.add_argument("--md-out", required=True, type=Path)
    return parser.parse_args()


def human_bytes(value: object) -> str:
    if not isinstance(value, int) or value < 0:
        return "未记录"
    amount = float(value)
    for unit in ("B", "KiB", "MiB", "GiB"):
        if amount < 1024 or unit == "GiB":
            return f"{int(amount)} B" if unit == "B" else f"{amount:.1f} {unit}"
        amount /= 1024
    return f"{value} B"


def require_dict(path: Path, schema: str | None = None) -> dict[str, Any]:
    value = load_json(path)
    if not isinstance(value, dict):
        raise ValueError(f"{path.name} 必须是 JSON 对象")
    if schema is not None and value.get("schemaVersion") != schema:
        raise ValueError(f"{path.name} schemaVersion 必须为 {schema}")
    return value


def matches_ref(reference: object, path: Path) -> bool:
    return (
        isinstance(reference, dict)
        and path.is_file()
        and Path(str(reference.get("path") or "")).expanduser().resolve() == path
        and reference.get("sha256") == sha256_file(path)
    )


def optional_file_ref(path: Path) -> dict[str, Any]:
    if not path.is_file():
        return {"path": str(path), "bytes": None, "sha256": None, "available": False}
    return {**file_ref(path), "available": True}


def check_historical_evidence(state: dict[str, Any], blockers: list[str]) -> None:
    for name, reference in sorted((state.get("evidence") or {}).items()):
        if not isinstance(reference, dict):
            blockers.append(f"HISTORICAL_EVIDENCE_INVALID:{name}")
            continue
        path = Path(str(reference.get("path") or "")).expanduser().resolve()
        if not path.is_file():
            blockers.append(f"HISTORICAL_EVIDENCE_MISSING:{name}")
        elif reference.get("sha256") != sha256_file(path):
            blockers.append(f"HISTORICAL_EVIDENCE_DRIFT:{name}")


def context_value(context: dict[str, Any], name: str) -> str:
    value = context.get(name)
    return str(value).strip() if value is not None else ""


def verified_confirmation(path: Path) -> dict[str, Any]:
    value = require_dict(path, SCHEMA)
    core = {key: item for key, item in value.items() if key not in {"generatedAt", "confirmationHash"}}
    if value.get("confirmationHash") != "sha256:" + sha256_object(core):
        raise ValueError("资源复用确认单哈希无效")
    return value


def prepare(args: argparse.Namespace) -> dict[str, Any]:
    project_root = args.project_root.expanduser().resolve()
    if not project_root.is_dir():
        raise ValueError(f"项目目录不存在：{project_root}")
    paths = {
        name: Path(getattr(args, name)).expanduser().resolve()
        for name in (
            "historical_run_manifest", "resource_state", "effect_baseline", "reference_graph",
            "allowlist", "optimization_plan", "toolchain_lock", "current_context",
            "gate_a_report", "gate_b_report", "fidelity_review",
        )
    }
    blockers: list[str] = []
    for name in (
        "historical_run_manifest", "resource_state", "effect_baseline", "reference_graph",
        "allowlist", "optimization_plan", "toolchain_lock", "current_context",
    ):
        path = paths[name]
        if not path.is_file():
            blockers.append(f"REQUIRED_FILE_MISSING:{name}")
    if blockers:
        raise ValueError("；".join(blockers))
    for name in ("gate_a_report", "gate_b_report", "fidelity_review"):
        if not paths[name].is_file():
            blockers.append(f"HISTORICAL_REPORT_MISSING:{name}")

    state = require_dict(paths["resource_state"], STATE_SCHEMA)
    historical_run = require_dict(paths["historical_run_manifest"], RUN_SCHEMA)
    effect = require_dict(paths["effect_baseline"], "playable-effect-baseline-assessment-v1")
    graph = require_dict(paths["reference_graph"], "playable-resource-reference-graph-v1")
    allowlist = require_dict(paths["allowlist"], "playable-resource-allowlist-v1")
    plan = require_dict(paths["optimization_plan"], "playable-resource-optimization-plan-v1")
    toolchain = require_dict(paths["toolchain_lock"], "playable-resource-toolchain-lock-v1")
    context = require_dict(paths["current_context"], "playable-resource-reuse-context-v1")

    if state.get("status") != "RESOURCE_READY":
        blockers.append("HISTORICAL_RESOURCE_NOT_READY")
    for label, value in (
        ("resourceState", state.get("projectRoot")),
        ("historicalRun", historical_run.get("projectRoot")),
        ("effectBaseline", effect.get("projectRoot")),
        ("referenceGraph", graph.get("projectRoot")),
        ("allowlist", allowlist.get("projectRoot")),
        ("optimizationPlan", plan.get("projectRoot")),
        ("toolchainLock", toolchain.get("projectRoot")),
    ):
        if not isinstance(value, str) or Path(value).expanduser().resolve() != project_root:
            blockers.append(f"PROJECT_ROOT_MISMATCH:{label}")

    identity = {
        "effectFingerprint": {
            "historical": state.get("effectFingerprint"),
            "current": effect.get("effectFingerprint"),
        },
        "resourceReferenceGraphHash": {
            "historical": state.get("resourceReferenceGraphHash"),
            "current": graph.get("graphHash"),
        },
        "resourceAllowlistHash": {
            "historical": state.get("resourceAllowlistHash"),
            "current": allowlist.get("allowlistHash"),
        },
        "optimizationPlanHash": {
            "historical": state.get("optimizationPlanHash"),
            "current": plan.get("optimizationPlanHash"),
        },
        "toolchainLockHash": {
            "historical": state.get("toolchainLockHash"),
            "current": toolchain.get("toolchainLockHash"),
        },
    }
    for name, comparison in identity.items():
        comparison["matching"] = bool(comparison["historical"]) and comparison["historical"] == comparison["current"]
        if not comparison["matching"]:
            blockers.append(f"RESOURCE_REUSE_IDENTITY_DRIFT:{name}")

    check_historical_evidence(state, blockers)
    state_evidence = state.get("evidence") or {}
    if not matches_ref(state_evidence.get("plan_md"), paths["gate_a_report"]):
        blockers.append("GATE_A_REPORT_NOT_BOUND_TO_RESOURCE_STATE")
    proposal_reference = state_evidence.get("apply_proposal")
    proposal: dict[str, Any] | None = None
    if not isinstance(proposal_reference, dict):
        blockers.append("GATE_B_PROPOSAL_MISSING")
    else:
        proposal_path = Path(str(proposal_reference.get("path") or "")).expanduser().resolve()
        try:
            proposal = verified_proposal(proposal_path)
            if proposal_reference.get("sha256") != sha256_file(proposal_path):
                blockers.append("GATE_B_PROPOSAL_DRIFT")
            if paths["gate_b_report"].read_text(encoding="utf-8") != render_gate_b_markdown(proposal):
                blockers.append("GATE_B_REPORT_DRIFT")
        except (OSError, ValueError, json.JSONDecodeError):
            blockers.append("GATE_B_PROPOSAL_INVALID")
    if proposal is not None:
        if not matches_ref(proposal.get("fidelityReview"), paths["fidelity_review"]):
            blockers.append("FIDELITY_REVIEW_DRIFT")
        if proposal.get("optimizationPlanHash") != state.get("optimizationPlanHash"):
            blockers.append("GATE_B_PLAN_DRIFT")

    superseded_indices: set[int] = set()
    for invalidation in historical_run.get("invalidations") or []:
        if isinstance(invalidation, dict):
            superseded_indices.update(
                index for index in invalidation.get("supersededHistoryIndices") or []
                if isinstance(index, int) and index >= 0
            )
    active_resource_records = []
    for index, record in enumerate(historical_run.get("history") or []):
        if index in superseded_indices:
            continue
        if not isinstance(record, dict) or record.get("state") != "RESOURCE_READY":
            continue
        reference = (record.get("evidence") or {}).get("resourceState")
        if matches_ref(reference, paths["resource_state"]):
            active_resource_records.append(record)
    if len(active_resource_records) != 1:
        blockers.append("HISTORICAL_RUN_DOES_NOT_BIND_RESOURCE_STATE")

    candidate_tree = state.get("consumedResourceTree") or {}
    roots: list[Path] = []
    for value in candidate_tree.get("roots") or []:
        path = Path(str(value)).expanduser().resolve()
        if not path.exists() or not is_within(project_root, path):
            blockers.append(f"CANDIDATE_RESOURCE_ROOT_INVALID:{value}")
        else:
            roots.append(path)
    actual_candidate_hash = sha256_paths(roots, base=project_root) if roots else None
    candidate_tree_matches = bool(roots) and actual_candidate_hash == candidate_tree.get("sha256")
    if not candidate_tree_matches:
        blockers.append("CANDIDATE_RESOURCE_TREE_DRIFT")

    for field in ("playable", "variant", "targetOs"):
        if not context_value(context, field):
            blockers.append(f"CURRENT_CONTEXT_MISSING:{field}")

    apply_approval = None
    approval_reference = state_evidence.get("apply_approval")
    if isinstance(approval_reference, dict):
        approval_path = Path(str(approval_reference.get("path") or "")).expanduser().resolve()
        if approval_path.is_file() and approval_reference.get("sha256") == sha256_file(approval_path):
            loaded = load_json(approval_path)
            if isinstance(loaded, dict):
                apply_approval = loaded
    artifacts = (proposal or {}).get("artifacts") or {}
    actions = (proposal or {}).get("actions") or []
    package_actions = (proposal or {}).get("packageOnlyActions") or []
    excluded = (proposal or {}).get("unreferencedResources") or []
    summary = {
        "resourceResultType": state.get("resourceResultType"),
        "applicationMode": state.get("applicationMode"),
        "optimizedActionCount": len(actions) if isinstance(actions, list) else None,
        "packageOnlyActionCount": len(package_actions) if isinstance(package_actions, list) else None,
        "unreferencedExcludedCount": len(excluded) if isinstance(excluded, list) else None,
        "before": artifacts.get("before"),
        "after": artifacts.get("after"),
        "savedBytes": artifacts.get("savedBytes"),
        "savedPercent": artifacts.get("savedPercent"),
        "projectResourcesOverwritten": state.get("applicationMode") == "applied",
        "originalApprovalAt": (apply_approval or {}).get("approvedAt"),
    }
    if summary["resourceResultType"] not in {"optimized", "package-only", "unchanged-explicitly-approved"}:
        blockers.append("RESOURCE_RESULT_TYPE_INVALID")
    if summary["applicationMode"] not in {"candidate-only", "applied"}:
        blockers.append("APPLICATION_MODE_INVALID")

    core = {
        "schemaVersion": SCHEMA,
        "status": "AWAITING_USER_CONFIRMATION" if not blockers else "BLOCKED",
        "userConclusion": (
            "本轮尚未重新执行资源优化；已验签历史候选和此前对比报告，请查看后明确选择是否继续复用"
            if not blockers else
            "历史资源候选或此前对比报告已经缺失、漂移或与当前任务不一致，不能继续复用；请重新执行资源分析"
        ),
        "projectRoot": str(project_root),
        "historicalRun": {
            "runId": historical_run.get("runId"),
            "createdAt": historical_run.get("createdAt"),
            "manifest": file_ref(paths["historical_run_manifest"]),
            "resourceState": file_ref(paths["resource_state"]),
        },
        "currentContext": {
            "playable": context_value(context, "playable"),
            "variant": context_value(context, "variant"),
            "targetOs": context_value(context, "targetOs"),
            "targetPlatforms": context.get("targetPlatforms") or [],
        },
        "identityChecks": identity,
        "candidateResourceTree": {
            "roots": [str(item) for item in roots],
            "historicalSha256": candidate_tree.get("sha256"),
            "currentSha256": actual_candidate_hash,
            "matching": candidate_tree_matches,
        },
        "resourceSummary": summary,
        "reports": {
            "gateA": optional_file_ref(paths["gate_a_report"]),
            "gateB": optional_file_ref(paths["gate_b_report"]),
            "fidelityReview": optional_file_ref(paths["fidelity_review"]),
        },
        "allowedDecisions": ["reuse-existing", "reanalyze", "use-original"] if not blockers else ["reanalyze"],
        "blockers": sorted(set(blockers)),
    }
    result = dict(core)
    result["generatedAt"] = utc_now()
    result["confirmationHash"] = "sha256:" + sha256_object(core)
    return result


def render_markdown(value: dict[str, Any]) -> str:
    history = value.get("historicalRun") or {}
    context = value.get("currentContext") or {}
    summary = value.get("resourceSummary") or {}
    reports = value.get("reports") or {}
    before = summary.get("before") or {}
    after = summary.get("after") or {}
    status = value.get("status")
    lines = [
        "# 历史资源候选复用确认单",
        "",
        "> **提醒：本轮尚未重新执行资源优化。下面准备复用的是历史候选，请先查看此前对比并确认。**",
        "",
        f"- 当前任务：{context.get('playable') or '未记录'} / {context.get('variant') or '未记录'} / {context.get('targetOs') or '未记录'}",
        f"- 历史运行：`{history.get('runId') or '未记录'}`（创建于 {history.get('createdAt') or '未记录'}）",
        f"- 历史资源结果：`{summary.get('resourceResultType') or '未记录'}`；使用方式 `{summary.get('applicationMode') or '未记录'}`",
        f"- 工程资源：{'历史记录显示已覆盖工程' if summary.get('projectResourcesOverwritten') else '历史记录显示未覆盖工程，仅使用候选'}",
        f"- 优化动作：{summary.get('optimizedActionCount') if summary.get('optimizedActionCount') is not None else '未记录'} 项；包内无损动作：{summary.get('packageOnlyActionCount') if summary.get('packageOnlyActionCount') is not None else '未记录'} 项；未引用资源不进包：{summary.get('unreferencedExcludedCount') if summary.get('unreferencedExcludedCount') is not None else '未记录'} 项",
        f"- 历史完整包对比：{human_bytes(before.get('bytes'))} → {human_bytes(after.get('bytes'))}，减少 {human_bytes(summary.get('savedBytes'))}（{summary.get('savedPercent') if summary.get('savedPercent') is not None else '未记录'}%）",
        "",
        "## 此前对比报告",
        "",
        f"- [Gate A 资源优化提案]({(reports.get('gateA') or {}).get('path')})",
        f"- [Gate B 资源覆盖确认单]({(reports.get('gateB') or {}).get('path')})",
        f"- [单页 A/B fidelity review]({(reports.get('fidelityReview') or {}).get('path')})",
        "",
    ]
    if status == "BLOCKED":
        lines.extend([
            "## 当前结论",
            "",
            "历史候选不能安全复用。以下证据缺失、漂移或与当前任务不一致：",
            "",
            *[f"- `{item}`" for item in value.get("blockers") or []],
            "",
            "请从当前原始资源重新分析并重新执行 Gate A、候选试做和 Gate B。",
        ])
    else:
        lines.extend([
            "## 请选择",
            "",
            "1. **继续复用历史优化候选**：本轮不重新处理资源，平台包消费上面验签通过的历史候选。",
            "2. **从当前原始资源重新分析**：重新执行机会审计、Gate A、候选试做和 Gate B。",
            "3. **使用原资源继续**：转入未优化明确批准分支；不能声称资源已优化。",
            "",
            "只有你在本轮明确选择第 1 项后，流程才会记录 `RESOURCE_REUSE_CONFIRMED` 并继续构建。",
        ])
    return "\n".join(lines).rstrip() + "\n"


def main() -> int:
    args = parse_args()
    try:
        result = prepare(args)
        write_json_atomic(args.json_out, result)
        args.md_out.expanduser().resolve().parent.mkdir(parents=True, exist_ok=True)
        args.md_out.expanduser().resolve().write_text(render_markdown(result), encoding="utf-8")
    except (OSError, ValueError, json.JSONDecodeError) as exc:
        print(json.dumps({"ok": False, "error": str(exc)}, ensure_ascii=False, indent=2))
        return 1
    print(json.dumps({
        "ok": result["status"] != "BLOCKED",
        "status": result["status"],
        "userConclusion": result["userConclusion"],
        "confirmation": str(args.md_out.expanduser().resolve()),
        "blockers": result["blockers"],
    }, ensure_ascii=False, indent=2))
    return 0 if result["status"] != "BLOCKED" else 2


if __name__ == "__main__":
    raise SystemExit(main())
