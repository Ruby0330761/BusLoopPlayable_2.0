#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import re
import sys
from datetime import datetime
from pathlib import Path
from typing import Any

SCRIPT_ROOT = Path(__file__).resolve().parent
LIB_ROOT = SCRIPT_ROOT / "lib"
sys.path.insert(0, str(LIB_ROOT))
sys.path.insert(0, str(SCRIPT_ROOT))

from checker_acceptance import (
    CheckerAcceptanceError,
    load_and_validate as load_checker_acceptance,
)
from record_candidate import CandidateError, verify_manifest_file
from resource_common import load_json, sha256_file
from execution_timeline_core import TimelineError, load_timeline
from rules import RulesetError
from record_resource_reuse_approval import verified_approval as verified_resource_reuse_approval
from checker_ui_queue import validate_preflight as validate_checker_preflight


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="汇总 playable 候选清单、Checker 证据和资源优化效率")
    parser.add_argument("--manifest", action="append", required=True)
    parser.add_argument("--checker-acceptance")
    parser.add_argument("--checker-preflight", help="可选 Checker 可达性证据；UNREACHABLE 只形成外部补测提醒")
    parser.add_argument("--json-out", required=True)
    parser.add_argument("--md-out", required=True)
    parser.add_argument("--audit-md-out", help="内部审计 Markdown；省略时写入用户摘要同目录的 *.audit.md")
    parser.add_argument("--candidate-resource-root")
    parser.add_argument("--applied-resource-root")
    parser.add_argument("--rollback-root")
    parser.add_argument("--platform-package-root")
    parser.add_argument("--skill-ux-input", help="普通用户复验观察 JSON；提供时必须同时提供 --skill-ux-out")
    parser.add_argument("--skill-ux-out", help="固定五段式 Skill 用户体验复验报告")
    parser.add_argument("--execution-timeline", help="本轮结构化时间账本；提供后在首屏分开报告自动处理、用户等待、Checker 等待和返工")
    parser.add_argument("--resource-reuse-approval", help="跨运行复用历史 RESOURCE_READY 时必须绑定本轮 RESOURCE_REUSE_CONFIRMED 批准")
    return parser.parse_args()


def safe_cell(value: object) -> str:
    return str(value).replace("|", "\\|").replace("\n", "<br>")


def human_bytes(value: int | None) -> str:
    number = int(value or 0)
    if abs(number) >= 1024 * 1024:
        return f"{number / (1024 * 1024):.2f} MiB"
    if abs(number) >= 1024:
        return f"{number / 1024:.1f} KiB"
    return f"{number} B"


def exact_human_bytes(value: int | None) -> str:
    number = int(value or 0)
    shown = human_bytes(number)
    return f"{number:,} B" if abs(number) < 1024 else f"{number:,} B（{shown}）"


def human_duration(milliseconds: int | None) -> str:
    total_seconds = max(0, round(int(milliseconds or 0) / 1000))
    hours, remainder = divmod(total_seconds, 3600)
    minutes, seconds = divmod(remainder, 60)
    if hours:
        return f"{hours} 小时 {minutes} 分 {seconds} 秒"
    if minutes:
        return f"{minutes} 分 {seconds} 秒"
    return f"{seconds} 秒"


def timing_conclusion(timing: dict[str, Any]) -> str:
    if not timing.get("available"):
        return "本轮未绑定结构化时间账本，无法区分自动处理、用户等待和返工"
    summary = timing.get("summary") or {}
    if summary.get("complete") is not True:
        missing = "、".join(str(item) for item in summary.get("missingEventTypes") or []) or "必要处理事件"
        return f"时间账本不完整（缺少：{missing}），不能判定实际处理耗时"
    per_class = summary.get("perClassDurationMs") or {}
    return (
        f"实际处理 {human_duration(summary.get('activeDurationMs'))}；"
        f"用户等待 {human_duration(summary.get('userWaitDurationMs'))}；"
        f"其中 Checker 界面 {human_duration(per_class.get('checker-ui-wait'))}、"
        f"故障返工 {human_duration(per_class.get('rework'))}"
    )


def render_timing(lines: list[str], timing: dict[str, Any]) -> None:
    lines.extend(["", "## 流程耗时", ""])
    if not timing.get("available"):
        lines.append(f"- {timing_conclusion(timing)}。")
        return
    summary = timing.get("summary") or {}
    if summary.get("complete") is not True:
        lines.append(f"- {timing_conclusion(timing)}。")
        lines.append(f"- 时间账本：{(timing.get('timeline') or {}).get('path')}。")
        return
    per_class = summary.get("perClassDurationMs") or {}
    assessment = {
        "WITHIN_NORMAL_TARGET": "正常目标内",
        "WITHIN_P95_TARGET": "超过 45 分钟目标，但仍在 60 分钟观察线内",
        "EFFICIENCY_REVIEW_REQUIRED": "超过 60 分钟，需要效率复盘",
    }.get(summary.get("targetAssessment"), "尚未判定")
    lines.extend([
        f"- 墙钟事件区间：{human_duration(summary.get('wallClockDurationMs'))}。",
        f"- 实际处理关键路径：{human_duration(summary.get('activeDurationMs'))}，结论：{assessment}。",
        f"- 自动处理：{human_duration(per_class.get('automatic'))}。",
        f"- 用户 Gate 等待：{human_duration(summary.get('userWaitDurationMs'))}。",
        f"- Checker 界面等待与操作：{human_duration(per_class.get('checker-ui-wait'))}。",
        f"- 故障返工：{human_duration(per_class.get('rework'))}。",
        f"- 时间账本：{(timing.get('timeline') or {}).get('path')}。",
    ])


def delivery_key(item: dict) -> str:
    declared = item.get("deliveryKey")
    if isinstance(declared, str) and declared.strip():
        return declared.strip()
    target = (item.get("deliveryContext") or {}).get("targetOs") or "unspecified"
    file_name = (item.get("artifact") or {}).get("fileName") or Path(
        str((item.get("artifact") or {}).get("path", "candidate"))
    ).name
    version = re.search(r"(?:^|[_-])(V\d+)(?:[_-]|$)", file_name, re.IGNORECASE)
    taps = re.search(r"(?:^|[_-])(\d+tap)(?:[_.-]|$)", file_name, re.IGNORECASE)
    variant = ":".join(
        value.lower() for value in (
            version.group(1) if version else "default",
            taps.group(1) if taps else "default",
        )
    )
    return f"{target}:{variant}"


def candidate_groups(candidates: list[dict[str, Any]]) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    baselines = [
        item for item in candidates
        if item.get("status") == "BASELINE_READY"
        or (item.get("status") == "FINAL_RECHECK_READY" and item.get("platform") == "applovin")
    ]
    platforms = [
        item for item in candidates
        if item.get("status") == "PLATFORM_READY"
        or (item.get("status") == "FINAL_RECHECK_READY" and item.get("platform") != "applovin")
    ]
    return baselines, platforms


def verified_reference(reference: object) -> tuple[Path, dict[str, Any]] | None:
    if not isinstance(reference, dict):
        return None
    path = Path(str(reference.get("path") or "")).expanduser().resolve()
    if not path.is_file() or reference.get("sha256") != sha256_file(path):
        return None
    value = load_json(path)
    return (path, value) if isinstance(value, dict) else None


def checker_capture_mismatch(candidates: list[dict[str, Any]], checker: dict[str, Any] | None) -> dict[str, Any]:
    if not isinstance(checker, dict):
        return {"detected": False, "platforms": []}
    candidate_by_key = {
        (item.get("platform"), delivery_key(item)): item
        for item in candidates
    }
    mismatches: list[str] = []
    for entry in checker.get("platforms") or []:
        if not isinstance(entry, dict) or (entry.get("tab") or {}).get("status") != "AVAILABLE":
            continue
        if entry.get("classification") != "OBSERVATION_RETRY":
            continue
        static = entry.get("static") or {}
        runtime = entry.get("runtime") or {}
        if (
            int(static.get("failures") or 0) > 0
            or int(static.get("warnings") or 0) > 0
        ):
            return {"detected": False, "platforms": []}
        key = (entry.get("platform"), entry.get("deliveryKey"))
        candidate = candidate_by_key.get(key)
        runtime_ref = verified_reference((candidate or {}).get("runtimeReport"))
        if runtime_ref is None:
            return {"detected": False, "platforms": []}
        _, local_runtime = runtime_ref
        if (
            (local_runtime.get("artifact") or {}).get("sha256") != ((candidate or {}).get("artifact") or {}).get("sha256")
            or local_runtime.get("checkBatchId") != (candidate or {}).get("checkBatchId")
            or (local_runtime.get("ctaCapture") or {}).get("conclusion") != "PASS"
        ):
            return {"detected": False, "platforms": []}
        if entry.get("platform") == "mintegral" and runtime.get("lifecycleCaptured") is False:
            if (local_runtime.get("lifecycleCapture") or {}).get("conclusion") != "PASS":
                return {"detected": False, "platforms": []}
        mismatches.append(str(entry.get("platform")))
    if not mismatches:
        return {"detected": False, "platforms": []}
    platforms = sorted(set(mismatches))
    shown = "、".join(platforms)
    return {
        "detected": True,
        "platforms": platforms,
        "userConclusion": f"{shown} 的本地可信桥接已通过，但 Checker 对同一 exact artifact 未捕获",
        "riskConclusion": "本地可信桥接已通过，但 Checker 对同一 exact artifact 未捕获；本地候选资格保留，不能把无效观察解释为已验证产物需要改写",
        "nextStep": "可以进入其他外部平台验收；如补做 Checker，请保持当前 artifact 冻结并用新 attempt 重录，不得注入假 CTA、空生命周期或手改成品",
        "failureAndRollback": "当前 Checker 捕获不一致不改写 artifact，保持冻结并保留全部失败证据；只有后续证明确属真实生成链缺陷时才按影响范围完整重建",
    }


def checker_external_validation(
    checker: dict[str, Any] | None,
    checker_ref: dict[str, Any] | None,
    checker_error: str | None,
    preflight: dict[str, Any] | None,
    preflight_ref: dict[str, Any] | None,
    preflight_error: str | None,
) -> dict[str, Any]:
    entries = checker.get("platforms") or [] if isinstance(checker, dict) else []
    conclusion = str((checker.get("summary") or {}).get("conclusion") or "") if checker else ""
    affected = sorted({
        str(item.get("platform"))
        for item in entries
        if isinstance(item, dict) and item.get("classification") == "ARTIFACT_REWORK" and item.get("platform")
    })
    unavailable = sorted({
        str(item.get("platform"))
        for item in entries
        if isinstance(item, dict) and (
            item.get("classification") == "EXTERNAL_CHECKER_BLOCK"
            or item.get("conclusion") == "UNAVAILABLE"
        ) and item.get("platform")
    })
    passed = sorted({
        str(item.get("platform"))
        for item in entries
        if isinstance(item, dict) and item.get("classification") == "PASS" and item.get("platform")
    })

    if conclusion == "REWORK_REQUIRED":
        status = "ISSUES_FOUND"
        shown = "、".join(affected) or "受影响平台"
        user_conclusion = f"Playable Ad Checker 可信观察发现 {shown} 的当前 artifact 存在真实缺陷，必须返工后重新验签"
    elif conclusion == "PASS":
        status = "PASS"
        user_conclusion = "Playable Ad Checker 已作为补充证据完成；真实平台人工验收仍未替代。"
    elif conclusion in {"OBSERVATION_RETRY", "INCOMPLETE"} or checker_error or preflight_error:
        status = "PENDING"
        user_conclusion = "Playable Ad Checker 补充观察需要重录或重新验签；本地 ruleset 检查通过的候选资格保持有效。"
    elif conclusion == "BLOCKED_EXTERNAL" or (preflight or {}).get("status") == "UNREACHABLE":
        status = "UNAVAILABLE"
        if passed and unavailable:
            user_conclusion = "Playable Ad Checker 仅完成可用平台；其余平台请在页签恢复后补测，或直接进入对应官方 Preview/广告后台验证。"
        else:
            user_conclusion = "Playable Ad Checker 当前不可达或缺少目标页签；请稍后补测，或直接进入对应官方 Preview/广告后台验证。"
    elif checker is None and preflight is None:
        status = "NOT_RUN"
        user_conclusion = "Playable Ad Checker 尚未验证，建议上传本轮最终文件补测。"
    else:
        status = "PENDING"
        user_conclusion = "Playable Ad Checker 补充验证尚未完成；本地 ruleset 检查通过的候选资格保持有效。"

    return {
        "status": status,
        "blocksLocalReady": status == "ISSUES_FOUND",
        "executed": checker is not None,
        "userConclusion": user_conclusion,
        "acceptance": checker_ref,
        "preflight": preflight_ref,
        "error": checker_error or preflight_error,
        "passedPlatforms": passed,
        "unavailablePlatforms": unavailable,
        "affectedPlatforms": affected,
        "platforms": [
            {
                key: item.get(key)
                for key in (
                    "platform", "deliveryKey", "conclusion", "classification", "artifact",
                    "attemptId", "observationSha256", "evidence",
                )
            }
            for item in entries if isinstance(item, dict)
        ],
    }


def optimization_efficiency(baselines: list[dict]) -> dict[str, Any]:
    if not baselines:
        return {"available": False, "userConclusion": "本次没有可绑定的资源阶段证据"}
    resource_states = [item.get("resourceState") for item in baselines if isinstance(item.get("resourceState"), dict)]
    if not resource_states:
        return {"available": False, "userConclusion": "候选清单未绑定资源状态，不能计算优化效率"}
    state_ref = verified_reference(resource_states[0])
    if state_ref is None:
        return {"available": False, "userConclusion": "资源状态不存在或已变化，不能计算优化效率"}
    _, state = state_ref
    evidence = state.get("evidence") or {}
    proposal_ref = verified_reference(evidence.get("apply_proposal"))
    approval_ref = verified_reference(evidence.get("apply_approval"))
    plan_ref = verified_reference(evidence.get("plan_json"))
    ledger_ref = verified_reference(evidence.get("source_ledger"))
    execution_ref = verified_reference(evidence.get("execution_verification"))
    fidelity_ref = verified_reference(evidence.get("fidelity_report"))
    if proposal_ref is None:
        return {"available": False, "userConclusion": "资源状态未绑定 Gate B 对照，不能给出可靠的实际节省"}
    _, proposal = proposal_ref
    approval = approval_ref[1] if approval_ref else {}
    plan = plan_ref[1] if plan_ref else {}
    ledger = ledger_ref[1] if ledger_ref else {}
    execution = execution_ref[1] if execution_ref else {}
    generation_ref = verified_reference(execution.get("executionRecords"))
    generation = generation_ref[1] if generation_ref else {}
    trial_fidelity: dict[str, Any] = {}
    if fidelity_ref:
        trial_path_value = ((fidelity_ref[1].get("evidence") or {}).get("trialFidelity"))
        trial_path = Path(str(trial_path_value or "")).expanduser().resolve()
        if trial_path.is_file():
            loaded_trial = load_json(trial_path)
            if isinstance(loaded_trial, dict):
                trial_fidelity = loaded_trial
    mode = state.get("applicationMode")
    actions = [item for item in proposal.get("actions") or [] if isinstance(item, dict)]
    if mode == "applied":
        approved_ids = {
            item.get("actionId") for item in approval.get("approvedActions") or [] if isinstance(item, dict)
        }
        adopted = [item for item in actions if item.get("actionId") in approved_ids]
    else:
        adopted = actions
    not_adopted = [item for item in actions if item not in adopted]
    human_fidelity_accepted = (approval.get("humanFidelity") or {}).get("status") == "ACCEPTED"
    adopted = [
        {
            **item,
            "finalFidelitySummary": (
                "自动保真通过；Gate B A/B 听感可接受"
                if human_fidelity_accepted else item.get("fidelitySummary") or item.get("fidelityConclusion")
            ),
        }
        for item in adopted
    ]
    adopted_paths = {str(item.get("targetPath") or "") for item in adopted}
    package_only_actions = [item for item in proposal.get("packageOnlyActions") or [] if isinstance(item, dict)]
    adopted_package_plan_actions = set()
    if any(item.get("operation") == "DEDUP_INLINE_PAYLOAD" for item in package_only_actions):
        adopted_package_plan_actions.add("DEDUP")
    planned_items = [
        item for item in plan.get("items") or []
        if isinstance(item, dict) and item.get("action") not in {"KEEP", "EXCLUDE"}
    ]
    package_plan_items = [item for item in planned_items if item.get("action") in adopted_package_plan_actions]
    resource_plan_items = [item for item in planned_items if item.get("action") not in adopted_package_plan_actions]
    generation_by_path = {
        str(item.get("path") or ""): item
        for item in (generation.get("actions") or generation.get("audioActions") or []) if isinstance(item, dict)
    }
    trial_by_path = {
        str(item.get("path") or ""): item
        for item in trial_fidelity.get("resources") or [] if isinstance(item, dict)
    }
    execution_by_path = {
        str(item.get("path") or ""): item
        for item in execution.get("verifiedActions") or [] if isinstance(item, dict)
    }
    rolled_back_plan_items = []
    for item in resource_plan_items:
        path = str(item.get("path") or "")
        if path in adopted_paths:
            continue
        generated = generation_by_path.get(path) or {}
        trial = trial_by_path.get(path) or {}
        before_bytes = int(((trial.get("before") or {}).get("bytes")) or generated.get("beforeBytes") or 0)
        candidate_bytes = int(((trial.get("after") or {}).get("bytes")) or generated.get("finalBytes") or 0)
        saved_bytes = max(0, before_bytes - candidate_bytes)
        failed_checks = [
            name for name, passed in (trial.get("checks") or {}).items() if passed is False
        ]
        loudness_delta = (trial.get("differences") or {}).get("loudnessDeltaLu")
        if "loudness" in failed_checks and isinstance(loudness_delta, (int, float)):
            reason = f"响度差 {loudness_delta:+.1f} LU 未通过保真阈值，平台包恢复原字节"
        elif failed_checks:
            reason = f"自动保真未通过（{', '.join(failed_checks)}），平台包恢复原字节"
        else:
            reason = "未进入最终保真候选，平台包继续使用原字节"
        rolled_back_plan_items.append({
            "path": path,
            "action": item.get("action"),
            "estimatedSavingsBytes": item.get("estimatedSavingsBytes", 0),
            "beforeBytes": before_bytes,
            "candidateBytes": candidate_bytes,
            "savedBytes": saved_bytes,
            "savedPercent": round(saved_bytes * 100 / before_bytes, 1) if before_bytes else 0.0,
            "actualParameters": (execution_by_path.get(path) or {}).get("actualParameters") or {},
            "reason": reason,
        })
    adopted_before = sum(int(item.get("beforeBytes") or 0) for item in adopted)
    adopted_after = sum(int(item.get("candidateBytes") or 0) for item in adopted)
    adopted_saved = adopted_before - adopted_after
    artifacts = proposal.get("artifacts") or {}
    exact_before = int((artifacts.get("before") or {}).get("bytes") or 0)
    exact_after = int((artifacts.get("after") or {}).get("bytes") or 0)
    exact_saved = exact_before - exact_after
    optimization_groups = (plan.get("userSummary") or {}).get("optimizationGroups") or []
    if isinstance(optimization_groups, list) and optimization_groups:
        estimated = sum(
            int(item.get("estimatedSavingsBytes") or 0)
            for item in optimization_groups if isinstance(item, dict)
        )
    else:
        estimated = int((plan.get("summary") or {}).get("estimatedSavingsBytes") or 0)
    excluded = [item for item in proposal.get("unreferencedResources") or [] if isinstance(item, dict)]
    duplicate_waste = int((proposal.get("payloadReport") or {}).get("duplicateWasteBytes") or 0)
    package_planned_bytes = sum(int(item.get("estimatedSavingsBytes") or 0) for item in package_plan_items)
    package_saved_bytes = sum(int(item.get("savedDecodedBytes") or 0) for item in package_only_actions)
    tinify_summary = proposal.get("tinifySummary") or {}
    tinify_metrics = {
        "provider": "tinify" if tinify_summary else None,
        "service": tinify_summary.get("service"),
        "actualRequestCount": int(tinify_summary.get("actualRequestCount") or 0),
        "successfulActionIds": list(tinify_summary.get("successfulActionIds") or []),
        "eligibleActionIds": list(tinify_summary.get("eligibleActionIds") or []),
        "rejectedActionIds": list(tinify_summary.get("rejectedActionIds") or []),
        "notTestedQuotaActionIds": list(tinify_summary.get("notTestedQuotaActionIds") or []),
    }
    trial_count = sum(
        1 for item in resource_plan_items
        if (
            str(item.get("path") or "") in adopted_paths
            or str(item.get("path") or "") in generation_by_path
            or str(item.get("path") or "") in trial_by_path
        )
    )
    return {
        "available": True,
        "applicationMode": mode,
        "sourceSurvey": {
            "fileCount": ledger.get("fileCount"),
            "bytes": ledger.get("totalBytes"),
            "classificationCounts": ledger.get("classificationCounts"),
        },
        "unreferencedExclusion": {
            "count": len(excluded),
            "bytes": sum(int(item.get("bytes") or 0) for item in excluded),
            "projectFilesChanged": False,
            "items": excluded,
        },
        "estimatedSavingsBytes": estimated,
        "adoptedActions": adopted,
        "notAdoptedActions": not_adopted,
        "rolledBackPlanItems": rolled_back_plan_items,
        "packageOnlySummary": {
            "actionCount": len(package_only_actions),
            "plannedItemCount": len(package_plan_items),
            "plannedSavingsBytes": package_planned_bytes,
            "actualSavingsBytes": package_saved_bytes,
            "pathsPreserved": all(item.get("pathsPreserved") is True for item in package_only_actions),
            "projectFilesChanged": any(item.get("projectFilesChanged") is True for item in package_only_actions),
        },
        "adoptedActionSummary": {
            "count": len(adopted),
            "beforeBytes": adopted_before,
            "afterBytes": adopted_after,
            "savedBytes": adopted_saved,
            "savedPercent": round(adopted_saved * 100 / adopted_before, 1) if adopted_before else 0.0,
        },
        "trialHitRate": round(len(adopted) * 100 / max(1, trial_count), 1),
        "planRealizationPercent": round(exact_saved * 100 / estimated, 1) if estimated else None,
        "exactCandidate": {
            "before": artifacts.get("before"),
            "after": artifacts.get("after"),
            "savedBytes": exact_saved,
            "savedPercent": round(exact_saved * 100 / exact_before, 1) if exact_before else 0.0,
        },
        "duplicateWasteBytes": duplicate_waste,
        "tinify": tinify_metrics,
        "userConclusion": (
            f"同链路 exact candidate 实测减少 {exact_human_bytes(exact_saved)}，节省率 {round(exact_saved * 100 / exact_before, 1) if exact_before else 0.0}%"
        ),
        "authority": "最终包净减少以同代码、Adapter、变体和构建入口的 before/after artifact 实测为准；未引用资源排除不与该净减少重复相加。",
    }


def list_lines(values: object, formatter=None) -> list[str]:
    if not isinstance(values, list) or not values:
        return ["- 未发现"]
    lines = []
    for item in values:
        shown = formatter(item) if formatter else str(item)
        lines.append(f"- {shown}")
    return lines


def render_skill_ux(input_path: Path, output_path: Path) -> dict[str, Any]:
    data = load_json(input_path.expanduser().resolve())
    schema_version = data.get("schemaVersion") if isinstance(data, dict) else None
    if schema_version not in {
        "skill-user-experience-observations-v1",
        "skill-user-experience-observations-v2",
    }:
        raise ValueError("Skill 用户体验观察 schemaVersion 无效")
    conclusion = data.get("conclusion")
    if conclusion not in {"PASS", "FAIL"}:
        raise ValueError("Skill 用户体验 conclusion 必须为 PASS 或 FAIL")

    skill_defects = data.get("skillDefects") or []
    external_issues = data.get("externalIssues") or []
    if not isinstance(skill_defects, list) or not isinstance(external_issues, list):
        raise ValueError("Skill 用户体验缺陷与外部问题必须是数组")
    if schema_version == "skill-user-experience-observations-v2":
        required = ("issue", "impact", "evidence", "expectedBehavior")
        for index, item in enumerate(skill_defects):
            if not isinstance(item, dict) or item.get("ownership") != "skill":
                raise ValueError(f"skillDefects[{index}] 必须声明 ownership=skill")
            if item.get("resolutionStatus") not in {"OPEN", "FIXED"}:
                raise ValueError(f"skillDefects[{index}] resolutionStatus 必须为 OPEN 或 FIXED")
            if any(not str(item.get(name) or "").strip() for name in required):
                raise ValueError(f"skillDefects[{index}] 缺少问题、影响、证据或期望行为")
        for index, item in enumerate(external_issues):
            if not isinstance(item, dict) or item.get("ownership") not in {"checker", "environment", "platform"}:
                raise ValueError(f"externalIssues[{index}] ownership 必须为 checker、environment 或 platform")
            if item.get("status") not in {"OPEN", "RESOLVED"}:
                raise ValueError(f"externalIssues[{index}] status 必须为 OPEN 或 RESOLVED")
            if any(not str(item.get(name) or "").strip() for name in required):
                raise ValueError(f"externalIssues[{index}] 缺少问题、影响、证据或期望行为")

    def defect(item: object) -> str:
        if not isinstance(item, dict):
            return str(item)
        return "；".join(
            f"{label}：{item.get(name) or '未提供'}"
            for name, label in (
                ("issue", "问题"), ("impact", "影响"), ("evidence", "证据"),
                ("expectedBehavior", "期望"), ("fixStatus", "修复状态"),
            )
        )

    def external_issue(item: object) -> str:
        if not isinstance(item, dict):
            return str(item)
        owner = {
            "checker": "Checker",
            "environment": "运行环境",
            "platform": "真实平台",
        }.get(str(item.get("ownership") or ""), "外部系统")
        status = {
            "OPEN": "待处理",
            "RESOLVED": "已解决",
        }.get(str(item.get("status") or ""), "未提供")
        detail = "；".join(
            f"{label}：{item.get(name) or '未提供'}"
            for name, label in (
                ("issue", "问题"), ("impact", "影响"), ("evidence", "证据"),
                ("expectedBehavior", "期望"),
            )
        )
        return f"外部 {owner} 问题（不属于 Skill 缺陷）：{detail}；状态：{status}"

    readability_lines = list_lines(data.get("readabilityIssues"))
    if external_issues:
        if readability_lines == ["- 未发现"]:
            readability_lines = []
        readability_lines.extend(list_lines(external_issues, external_issue))

    unresolved_skill_defects = sum(
        (
            item.get("resolutionStatus") != "FIXED"
            if schema_version == "skill-user-experience-observations-v2"
            else not str(item.get("fixStatus") or "").startswith("已修复")
        )
        for item in skill_defects
        if isinstance(item, dict)
    )

    lines = [
        "# Skill 用户体验复验",
        "",
        "## 结论",
        "",
        f"- {'通过' if conclusion == 'PASS' else '未通过'}完整用户体验复验。",
        *list_lines(data.get("conclusionDetails")),
        "",
        "## 已通过的体验",
        "",
        *list_lines(data.get("passedExperiences")),
        "",
        "## 可读性与误导问题",
        "",
        *readability_lines,
        "",
        "## 无必要暂停",
        "",
        *list_lines(data.get("unnecessaryPauses")),
        "",
        "## Skill 缺陷",
        "",
        *list_lines(skill_defects, defect),
        "",
    ]
    output = output_path.expanduser().resolve()
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text("\n".join(lines), encoding="utf-8")
    return {
        "path": str(output),
        "bytes": output.stat().st_size,
        "sha256": sha256_file(output),
        "conclusion": conclusion,
        "skillDefectCount": len(skill_defects),
        "unresolvedSkillDefectCount": unresolved_skill_defects,
        "externalIssueCount": len(external_issues),
    }


def checker_status_text(conclusion: str | None) -> str:
    return {
        "PASS": "补充验证通过",
        "WARNING": "有警告，必须返工",
        "FAIL": "有失败，必须返工",
        "UNAVAILABLE": "Checker 无此页签，待外部补测",
        "OBSERVATION_RETRY": "观察证据待重录，本地候选资格保留",
        "NOT_RUN": "尚未验证",
    }.get(conclusion, "尚未提供")


def local_status_text(status: str | None) -> str:
    return {
        "BASELINE_READY": "本地基线检查通过",
        "PLATFORM_READY": "本地平台检查通过",
        "FINAL_RECHECK_READY": "最终字节本地复检通过",
    }.get(status, "本地检查状态异常")


def render_efficiency(lines: list[str], efficiency: dict[str, Any]) -> None:
    lines.extend(["", "## 优化效率明细", ""])
    if not efficiency.get("available"):
        lines.append(f"- {efficiency.get('userConclusion')}")
        return
    source = efficiency.get("sourceSurvey") or {}
    excluded = efficiency.get("unreferencedExclusion") or {}
    adopted = efficiency.get("adoptedActionSummary") or {}
    package_only = efficiency.get("packageOnlySummary") or {}
    exact = efficiency.get("exactCandidate") or {}
    lines.extend([
        f"- 源资源盘点：{source.get('fileCount') if source.get('fileCount') is not None else '未记录'} 个文件，{exact_human_bytes(source.get('bytes')) if source.get('bytes') is not None else '未记录总大小'}。",
        f"- 未引用载荷排除：{excluded.get('count')} 个、{exact_human_bytes(excluded.get('bytes'))}；只从本轮候选排除，工程文件没有删除、移动、改名或改写。",
        f"- 实际采用动作：{adopted.get('count')} 个，资源自身从 {exact_human_bytes(adopted.get('beforeBytes'))} 减至 {exact_human_bytes(adopted.get('afterBytes'))}，减少 {exact_human_bytes(adopted.get('savedBytes'))}（{adopted.get('savedPercent')}%）。",
        f"- 包内去重：{package_only.get('actionCount')} 项仅影响候选包的动作；Gate A 计划中单列 {package_only.get('plannedItemCount')} 项、预计减少 {exact_human_bytes(package_only.get('plannedSavingsBytes'))} 解码载荷，实际减少 {exact_human_bytes(package_only.get('actualSavingsBytes'))}；逻辑路径保留，工程文件未改写。",
        f"- 同链路 exact candidate：从 {exact_human_bytes((exact.get('before') or {}).get('bytes'))} 减至 {exact_human_bytes((exact.get('after') or {}).get('bytes'))}，净减少 {exact_human_bytes(exact.get('savedBytes'))}（{exact.get('savedPercent')}%）。",
        f"- 计划预计收益：{exact_human_bytes(efficiency.get('estimatedSavingsBytes'))}；计划兑现率：{str(efficiency.get('planRealizationPercent')) + '%' if efficiency.get('planRealizationPercent') is not None else '无法可靠计算'}；试做命中率：{efficiency.get('trialHitRate')}%。",
        f"- 最终重复浪费：{exact_human_bytes(efficiency.get('duplicateWasteBytes'))}。",
        *([
            f"- Tinify：实际请求 {efficiency['tinify'].get('actualRequestCount')} 次；成功 {len(efficiency['tinify'].get('successfulActionIds') or [])} 项；"
            f"逐图接受 {len(efficiency['tinify'].get('eligibleActionIds') or [])} 项；淘汰 {len(efficiency['tinify'].get('rejectedActionIds') or [])} 项；"
            f"额度未测试 {len(efficiency['tinify'].get('notTestedQuotaActionIds') or [])} 项。",
        ] if efficiency.get('tinify', {}).get('provider') == 'tinify' else []),
        f"- 口径：{efficiency.get('authority')}",
        "",
        "### 已采用动作",
        "",
        "| 文件 | 原大小 | 候选大小 | 减少 | 实际参数 | 保真结论 |",
        "|---|---:|---:|---:|---|---|",
    ])
    for item in efficiency.get("adoptedActions") or []:
        parameters = json.dumps(item.get("actualParameters") or {}, ensure_ascii=False, sort_keys=True)
        lines.append(
            f"| `{safe_cell(item.get('targetPath'))}` | {exact_human_bytes(item.get('beforeBytes'))} | {exact_human_bytes(item.get('candidateBytes'))} | "
            f"{exact_human_bytes(item.get('savedBytes'))} / {item.get('savedPercent')}% | {safe_cell(parameters)} | {safe_cell(item.get('finalFidelitySummary') or item.get('fidelitySummary') or item.get('fidelityConclusion'))} |"
        )
    if not efficiency.get("adoptedActions"):
        lines.append("| 未采用资源压缩动作 | 0 B | 0 B | 0 B | 不适用 | 不适用 |")
    lines.extend([
        "", "### 试做后未采用或已回退", "",
        "| 文件 | 原大小 | 试做候选 | 潜在节省 | 实际参数 | 回退原因 |",
        "|---|---:|---:|---:|---|---|",
    ])
    rejected = list(efficiency.get("notAdoptedActions") or []) + list(efficiency.get("rolledBackPlanItems") or [])
    if rejected:
        for item in rejected:
            path = item.get("targetPath") or item.get("path")
            potential = item.get("savedBytes") if item.get("savedBytes") is not None else item.get("estimatedSavingsBytes")
            parameters = json.dumps(item.get("actualParameters") or {}, ensure_ascii=False, sort_keys=True)
            lines.append(
                f"| `{safe_cell(path)}` | {exact_human_bytes(item.get('beforeBytes'))} | {exact_human_bytes(item.get('candidateBytes'))} | "
                f"{exact_human_bytes(potential)} / {item.get('savedPercent', 0.0)}% | {safe_cell(parameters)} | "
                f"{safe_cell(item.get('reason') or '未被 Gate B 采用，平台包继续使用原字节')} |"
            )
    else:
        lines.append("| 未发现回退或未采用动作 | 0 B | 0 B | 0 B | 不适用 | 不适用 |")


def render_markdown(report: dict[str, Any]) -> str:
    efficiency = report.get("optimizationEfficiency") or {}
    checker = report.get("checker") or {}
    checker_entries = checker.get("platforms") or []
    external_checker = ((report.get("externalValidations") or {}).get("checker") or {})
    missing_tabs = external_checker.get("unavailablePlatforms") or [
        item.get("platform") for item in checker_entries if item.get("conclusion") == "UNAVAILABLE"
    ]
    coverage = (
        "已覆盖工程，回滚副本见下方路径"
        if report["locations"].get("appliedResourceRoot") else
        "候选未覆盖工程"
    )
    local_ok = report.get("localValidationPassed") is True
    lines = [
        "# Playable 平台包生成与校验报告",
        "",
        f"> {report['userConclusion']}",
        "",
        "## 一眼结论",
        "",
        f"- 生成了什么：{len(report.get('candidates') or [])} 个已验签候选清单；平台包位置见下方交付矩阵。",
        f"- 实际节省：{efficiency.get('userConclusion') or '本轮没有足够资源对照证据，未推算优化百分比'}。",
        f"- 资源来源：{(report.get('resourceOrigin') or {}).get('userConclusion') or '未记录'}。",
        f"- 主要风险：{report.get('riskConclusion')}。",
        f"- 是否覆盖工程：{coverage}。",
        f"- 失败与回滚：{report.get('failureAndRollback') or 'Checker 或本地检查失败时修复真实生成链并完整重建'}；资源覆盖回滚目录为 `{report['locations'].get('rollbackRoot') or '未发生覆盖，无回滚副本'}`。",
        f"- Skill 本地检查：{'已通过全部候选清单验签' if local_ok else '存在阻塞，详见下方'}。",
        f"- Playable Ad Checker：{external_checker.get('userConclusion') or checker.get('userConclusion') or '尚未提供本轮 Checker 补充验证证据'}。",
        f"- 无页签平台：{'、'.join(str(item) for item in missing_tabs) if missing_tabs else '未发现或尚未记录'}。",
        f"- 流程耗时：{timing_conclusion(report.get('executionTiming') or {})}。",
        f"- 当前下一步：{report.get('nextStep')}。",
    ]
    if report.get("skillUserExperienceEvaluation"):
        lines.append(f"- Skill 用户体验复验：[打开五段式报告]({report['skillUserExperienceEvaluation']['path']})。")
    lines.extend([
        "",
        "## 交付位置",
        "",
        f"- 优化候选资源目录：{report['locations'].get('candidateResourceRoot') or '未提供'}",
        f"- 已覆盖到工程的目标目录：{report['locations'].get('appliedResourceRoot') or '未覆盖工程'}",
        f"- 回滚目录：{report['locations'].get('rollbackRoot') or '未发生覆盖，无回滚副本'}",
        f"- 平台包目录：{report['locations'].get('platformPackageRoot') or '见下方各 artifact 路径'}",
        f"- Checker 验收报告：{(external_checker.get('acceptance') or report.get('checkerAcceptance') or {}).get('path') or '尚未生成'}",
        f"- 总体报告：{report['locations'].get('reportPath')}",
    ])
    render_timing(lines, report.get("executionTiming") or {})
    render_efficiency(lines, efficiency)
    lines.extend([
        "",
        "## 交付矩阵",
        "",
        "| 交付组合 | 平台 | 投放目标端 | 资源模式 | Skill 本地检查 | Checker | 性能 | 文件 | SHA-256 | 人工门禁 |",
        "|---|---|---|---|---|---|---|---|---|---:|",
    ])
    checker_by_key = {
        (item.get("platform"), item.get("deliveryKey")): item
        for item in checker_entries
    }
    for item in report.get("candidates") or []:
        checker_item = checker_by_key.get((item.get("platform"), item.get("deliveryKey"))) or {}
        lines.append(
            "| {delivery_key} | {platform} | {target_os} | {application_mode} | {local} | {checker} | {performance} | {path} | {sha} | {gates} |".format(
                delivery_key=safe_cell(item.get("deliveryKey")),
                platform=safe_cell(item.get("platform")),
                target_os=safe_cell((item.get("deliveryContext") or {}).get("targetOs")),
                application_mode=safe_cell(item.get("applicationMode") or "legacy"),
                local=safe_cell(local_status_text(item.get("status"))),
                checker=safe_cell(checker_status_text(checker_item.get("conclusion"))),
                performance=safe_cell((item.get("performanceAssessment") or {}).get("userConclusion") or "旧报告未区分性能采样与判定"),
                path=safe_cell((item.get("artifact") or {}).get("path")),
                sha=safe_cell((item.get("artifact") or {}).get("sha256")),
                gates=len(item.get("manualGates") or []),
            )
        )
    lines.extend(["", "## Playable Ad Checker", ""])
    if checker_entries:
        for item in checker_entries:
            lines.append(f"- {item.get('deliveryKey')} / {item.get('platform')}：{item.get('userConclusion')}")
    else:
        lines.append("- 尚未绑定本轮 Checker 补充验证；本地 ruleset 通过不代表 Checker 已通过，也不替代真实平台验收。")
    if report.get("manualGates"):
        lines.extend(["", "## 仍需真实平台或人工验证", ""])
        for gate in report["manualGates"]:
            lines.append(f"- {gate['platform']} / {gate.get('id')}: {gate.get('manualGate')}")
    if report.get("acceptedWarnings"):
        lines.extend(["", "## Android 单端商店地址提示", ""])
        for warning in report["acceptedWarnings"]:
            lines.append(f"- {warning['platform']} / {warning['id']}: {warning['evidence']}")
    if report.get("errors"):
        lines.extend(["", "## 阻塞原因", ""])
        for error in report["errors"]:
            combination = error.get("deliveryKey")
            prefix = f"{combination} / " if combination else ""
            lines.append(f"- {prefix}{error.get('manifest')}: {error.get('error')}")
    lines.append("")
    return "\n".join(lines)


def render_user_markdown(report: dict[str, Any]) -> str:
    efficiency = report.get("optimizationEfficiency") or {}
    coverage = "已按批准范围覆盖工程，可使用回滚副本恢复" if report["locations"].get("appliedResourceRoot") else "候选仅用于本轮平台包，没有覆盖工程"
    checker = report.get("checker") or {}
    external_checker = ((report.get("externalValidations") or {}).get("checker") or {})
    checker_status = external_checker.get("status")
    if not checker_status:
        legacy_conclusion = (checker.get("summary") or {}).get("conclusion")
        checker_status = {
            "PASS": "PASS",
            "REWORK_REQUIRED": "ISSUES_FOUND",
            "OBSERVATION_RETRY": "PENDING",
            "INCOMPLETE": "PENDING",
            "BLOCKED_EXTERNAL": "UNAVAILABLE",
        }.get(legacy_conclusion, "NOT_RUN")
    checker_text = external_checker.get("userConclusion") or {
        "NOT_RUN": "Playable Ad Checker 尚未验证，建议上传本轮最终文件补测。",
        "PENDING": "Playable Ad Checker 补充观察待重录，尚未验证通过。",
        "PASS": "Playable Ad Checker 已作为补充证据完成；真实平台人工验收仍未替代。",
        "UNAVAILABLE": "Playable Ad Checker 当前不可达或缺少目标页签，请稍后补测或转入对应真实平台验证。",
        "ISSUES_FOUND": "Playable Ad Checker 可信观察已发现当前 artifact 的真实缺陷，必须返工。",
    }.get(checker_status, "Playable Ad Checker 尚未验证。")
    local_checker_conclusion = {
        "NOT_RUN": "本地 ruleset 检查通过，Checker 尚未验证。",
        "PENDING": "本地 ruleset 检查通过；Checker 补充观察待重录，尚未验证通过。",
        "PASS": "本地 ruleset 检查通过；Checker 已作为补充证据通过。",
        "UNAVAILABLE": "本地 ruleset 检查通过；Checker 当前不可达或部分页签不可用，尚未完成外部验证。",
        "ISSUES_FOUND": "Checker 可信观察已发现当前 artifact 的真实缺陷，受影响平台必须返工。",
    }.get(checker_status, "本地 ruleset 检查结果已记录；Checker 尚未验证。")
    if report.get("localValidationPassed") is False:
        local_checker_conclusion = "本地 ruleset 检查存在阻塞，当前不能形成待人工验收候选包。"
    user_risk = str(report.get("riskConclusion") or "").replace("无页签平台与", "未由 Checker 覆盖的平台以及")
    lines = [
        "# Playable 平台包交付摘要",
        "",
        f"> {report['userConclusion']}",
        "",
        "## 结果",
        "",
        f"- 本地结论：{local_checker_conclusion}",
        f"- 资源来源：{(report.get('resourceOrigin') or {}).get('userConclusion') or '本轮资源阶段未记录来源'}。",
        f"- 资源收益：{efficiency.get('userConclusion') or '本轮没有足够的前后包证据，未声明优化收益'}。",
        f"- 工程状态：{coverage}。",
        f"- Checker 状态：{checker_text}",
        f"- 需要注意：{user_risk}。",
        f"- 下一步：{report.get('nextStep')}。",
    ]
    if efficiency.get("available"):
        adopted = efficiency.get("adoptedActionSummary") or {}
        exact = efficiency.get("exactCandidate") or {}
        excluded = efficiency.get("unreferencedExclusion") or {}
        actions = efficiency.get("adoptedActions") or []
        package_only = efficiency.get("packageOnlySummary") or {}
        application_mode = (
            (report.get("resourceState") or {}).get("applicationMode")
            or next((item.get("applicationMode") for item in report.get("candidates") or [] if item.get("applicationMode")), None)
            or "未记录"
        )
        lines.extend([
            "",
            "## 资源优化明细",
            "",
            f"- 实际采用：{adopted.get('count', 0)} 项；资源自身从 {exact_human_bytes(adopted.get('beforeBytes'))} 减至 {exact_human_bytes(adopted.get('afterBytes'))}，减少 {exact_human_bytes(adopted.get('savedBytes'))}（{adopted.get('savedPercent', 0)}%）。",
            f"- 完整包收益：同链路候选从 {exact_human_bytes((exact.get('before') or {}).get('bytes'))} 减至 {exact_human_bytes((exact.get('after') or {}).get('bytes'))}，实际减少 {exact_human_bytes(exact.get('savedBytes'))}（{exact.get('savedPercent', 0)}%）。",
            f"- 工程应用方式：`{application_mode}`；{coverage}。",
        ])
        if excluded.get("count"):
            lines.append(
                f"- 未引用资源：{excluded.get('count')} 个、{exact_human_bytes(excluded.get('bytes'))}，只从本轮候选排除，工程文件保持不变。"
            )
        if package_only.get("actionCount"):
            lines.append(
                f"- 包内无损处理：{package_only.get('actionCount')} 项，实际减少 {exact_human_bytes(package_only.get('actualSavingsBytes'))}，不改写工程资源。"
            )
        if actions:
            lines.extend([
                "",
                "| 已采用资源 | 原大小 | 候选大小 | 减少 | 保真结论 |",
                "|---|---:|---:|---:|---|",
            ])
            for item in actions:
                lines.append(
                    f"| `{safe_cell(item.get('targetPath'))}` | {exact_human_bytes(item.get('beforeBytes'))} | "
                    f"{exact_human_bytes(item.get('candidateBytes'))} | {exact_human_bytes(item.get('savedBytes'))} / {item.get('savedPercent', 0)}% | "
                    f"{safe_cell(item.get('finalFidelitySummary') or item.get('fidelitySummary') or item.get('fidelityConclusion') or '未记录')} |"
                )
        else:
            lines.append("- 本轮没有采用逐文件有损优化动作；如有收益，来自上方记录的无损候选处理。")
    lines.extend([
        "",
        "## 平台包",
        "",
    ])
    candidates = report.get("candidates") or []
    if candidates:
        for item in candidates:
            artifact = item.get("artifact") or {}
            lines.append(f"- {item.get('platform')}：[{Path(str(artifact.get('path') or 'artifact')).name}]({artifact.get('path')})")
    else:
        lines.append("- 当前没有可交付的平台包；请先处理上方阻塞。")
    lines.extend([
        "",
        "## 外部验证待办",
        "",
        f"- Playable Ad Checker：{'已完成补充验证' if checker_status == 'PASS' else '待补测或补录'}。",
        "- 官方 Preview：待验证。",
        "- 真实广告后台：待验证。",
        "- 真机或代表设备：待验证横竖屏、前后台、真实商店跳转和主观效果。",
    ])
    if report["locations"].get("candidateResourceRoot"):
        lines.extend(["", "## 资源候选", "", f"- 候选目录：`{report['locations']['candidateResourceRoot']}`"])
    origin = report.get("resourceOrigin") or {}
    if origin.get("mode") == "reused-history":
        summary = origin.get("resourceSummary") or {}
        reports = origin.get("reports") or {}
        lines.extend([
            "",
            "## 历史资源对比",
            "",
            f"- 历史运行：`{origin.get('historicalRunId')}`；模式 `{summary.get('applicationMode')}`；{'已覆盖工程' if summary.get('projectResourcesOverwritten') else '未覆盖工程'}。",
            f"- 历史实际收益：{exact_human_bytes(summary.get('savedBytes'))}（{summary.get('savedPercent')}%）。",
            f"- [Gate A 资源优化提案]({(reports.get('gateA') or {}).get('path')})",
            f"- [Gate B 资源覆盖确认单]({(reports.get('gateB') or {}).get('path')})",
            f"- [单页 A/B fidelity review]({(reports.get('fidelityReview') or {}).get('path')})",
        ])
    if report["locations"].get("appliedResourceRoot"):
        lines.append(f"- 已覆盖目录：`{report['locations']['appliedResourceRoot']}`")
        if report["locations"].get("rollbackRoot"):
            lines.append(f"- 回滚目录：`{report['locations']['rollbackRoot']}`")
    if report.get("skillUserExperienceEvaluation"):
        lines.extend(["", f"- [查看本轮用户体验复验]({report['skillUserExperienceEvaluation']['path']})"])
    lines.append("")
    return "\n".join(lines)


def write(path_value: str, text: str) -> Path:
    path = Path(path_value).expanduser().resolve()
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")
    return path


def main() -> int:
    args = parse_args()
    candidates: list[dict[str, Any]] = []
    errors: list[dict[str, Any]] = []
    local_errors: list[dict[str, Any]] = []
    seen_manifest_paths: set[str] = set()
    for path in args.manifest:
        resolved_input = str(Path(path).expanduser().resolve())
        if resolved_input in seen_manifest_paths:
            local_errors.append({"manifest": resolved_input, "error": "同一候选清单被重复传入"})
            continue
        seen_manifest_paths.add(resolved_input)
        try:
            candidates.append(verify_manifest_file(path))
        except (CandidateError, RulesetError, OSError) as exc:
            local_errors.append({"manifest": resolved_input, "error": str(exc)})
    errors.extend(local_errors)

    baseline, non_baseline = candidate_groups(candidates)
    ruleset_hashes = {(item.get("ruleset") or {}).get("rulesetSha256") for item in candidates}
    ruleset_versions = {(item.get("ruleset") or {}).get("rulesetVersion") for item in candidates}
    batch_artifacts: dict[str, str] = {}
    for item in candidates:
        batch_id = item.get("checkBatchId")
        artifact_sha = (item.get("artifact") or {}).get("sha256")
        if batch_id:
            previous = batch_artifacts.get(batch_id)
            if previous is not None and previous != artifact_sha:
                errors.append({"manifest": str(item.get("manifestPath")), "deliveryKey": item.get("deliveryKey"), "error": f"检查批次 {batch_id} 被不同 artifact 复用"})
            batch_artifacts[batch_id] = artifact_sha

    baseline_by_sha = {item.get("manifestSha256"): item for item in baseline}
    baseline_by_delivery: dict[str, list[dict]] = {}
    for item in baseline:
        key = delivery_key(item)
        item["deliveryKey"] = key
        baseline_by_delivery.setdefault(key, []).append(item)
    for key, items in baseline_by_delivery.items():
        if len(items) > 1:
            errors.append({"manifest": ", ".join(str(item.get("manifestPath")) for item in items), "deliveryKey": key, "error": "同一交付组合存在多个 AppLovin 基线"})

    seen_platform_combinations: set[tuple[str, str]] = set()
    for item in non_baseline:
        reference = item.get("baselineManifest")
        if item.get("status") == "PLATFORM_READY":
            baseline_sha = reference.get("sha256") if isinstance(reference, dict) else None
            linked = baseline_by_sha.get(baseline_sha)
            if linked is None:
                errors.append({"manifest": str(item.get("manifestPath")), "deliveryKey": item.get("deliveryKey") or "无法确定", "error": f"报告输入缺少该平台实际引用的 AppLovin 基线：{baseline_sha or '未记录基线哈希'}"})
                continue
            key = delivery_key(linked)
            item["deliveryKey"] = key
            combination = (str(baseline_sha), str(item.get("platform")))
            if combination in seen_platform_combinations:
                errors.append({"manifest": str(item.get("manifestPath")), "deliveryKey": key, "error": f"同一交付组合重复提供平台 {item.get('platform')}"})
            seen_platform_combinations.add(combination)
        else:
            item["deliveryKey"] = delivery_key(item)

    if len(ruleset_hashes) > 1:
        errors.append({"manifest": "候选清单集合", "error": "候选清单使用了不同 ruleset，必须统一重检"})
    resource_origin: dict[str, Any] = {
        "mode": "current-run",
        "userConclusion": "本轮在当前流程完成资源阶段，没有复用其他运行的历史资源候选",
    }
    if args.resource_reuse_approval:
        approval_path = Path(args.resource_reuse_approval).expanduser().resolve()
        try:
            approval = verified_resource_reuse_approval(approval_path)
            if approval.get("status") != "RESOURCE_REUSE_CONFIRMED" or approval.get("authorizesPlatformBuild") is not True:
                raise ValueError("资源复用批准未授权平台构建")
            expected_state = approval.get("historicalResourceState") or {}
            baseline_states = [item.get("resourceState") or {} for item in baseline]
            if not baseline_states or any(
                item.get("path") != expected_state.get("path") or item.get("sha256") != expected_state.get("sha256")
                for item in baseline_states
            ):
                raise ValueError("资源复用批准与 AppLovin 基线绑定的资源状态不一致")
            historical_run = approval.get("historicalRun") or {}
            resource_origin = {
                "mode": "reused-history",
                "userConclusion": f"本轮复用历史运行 {historical_run.get('runId') or '未记录'} 的资源候选，没有重新执行资源优化",
                "approval": {
                    "path": str(approval_path),
                    "bytes": approval_path.stat().st_size,
                    "sha256": sha256_file(approval_path),
                },
                "historicalRunId": historical_run.get("runId"),
                "resourceSummary": approval.get("resourceSummary"),
                "reports": approval.get("reports"),
            }
        except (OSError, ValueError, json.JSONDecodeError) as exc:
            errors.append({"manifest": str(approval_path), "error": f"历史资源复用批准无效：{exc}"})
    local_blocking_error_count = len(errors)

    checker: dict[str, Any] | None = None
    checker_ref: dict[str, Any] | None = None
    checker_error: str | None = None
    if args.checker_acceptance:
        checker_path = Path(args.checker_acceptance).expanduser().resolve()
        try:
            checker = load_checker_acceptance(checker_path)
            checker_manifest_hashes = {
                (item.get("candidateManifest") or {}).get("sha256") for item in checker.get("platforms") or []
            }
            report_manifest_hashes = {item.get("manifestSha256") for item in candidates}
            if checker_manifest_hashes != report_manifest_hashes:
                raise CheckerAcceptanceError("Checker 证据与本次报告候选清单集合不一致")
            checker_ref = {"path": str(checker_path), "bytes": checker_path.stat().st_size, "sha256": sha256_file(checker_path)}
        except (CheckerAcceptanceError, OSError, json.JSONDecodeError) as exc:
            checker_error = str(exc)

    checker_preflight: dict[str, Any] | None = None
    checker_preflight_ref: dict[str, Any] | None = None
    checker_preflight_error: str | None = None
    if args.checker_preflight:
        preflight_path = Path(args.checker_preflight).expanduser().resolve()
        try:
            loaded_preflight = load_json(preflight_path)
            checker_url = str((loaded_preflight or {}).get("checkerUrl") or "") if isinstance(loaded_preflight, dict) else ""
            checker_preflight = validate_checker_preflight(preflight_path, checker_url, require_available=False)
            checker_preflight_ref = {
                "path": str(preflight_path),
                "bytes": preflight_path.stat().st_size,
                "sha256": sha256_file(preflight_path),
            }
        except (OSError, ValueError, json.JSONDecodeError) as exc:
            checker_preflight_error = str(exc)

    external_checker = checker_external_validation(
        checker,
        checker_ref,
        checker_error,
        checker_preflight,
        checker_preflight_ref,
        checker_preflight_error,
    )

    execution_timing: dict[str, Any] = {
        "available": False,
        "userConclusion": "本轮未绑定结构化时间账本，无法区分自动处理、用户等待和返工",
    }
    timeline_error = None
    if args.execution_timeline:
        timeline_path = Path(args.execution_timeline).expanduser().resolve()
        try:
            timeline = load_timeline(timeline_path)
            execution_timing = {
                "available": True,
                "timeline": {
                    "path": str(timeline_path),
                    "bytes": timeline_path.stat().st_size,
                    "sha256": sha256_file(timeline_path),
                },
                "summary": timeline["summary"],
                "userConclusion": timing_conclusion({"available": True, "summary": timeline["summary"]}),
            }
        except (OSError, json.JSONDecodeError, TimelineError) as exc:
            timeline_error = str(exc)
            errors.append({"manifest": str(timeline_path), "error": f"流程时间账本无效：{exc}"})

    if local_blocking_error_count:
        status = "BLOCKED"
    elif external_checker.get("status") == "ISSUES_FOUND":
        status = "CHECKER_REWORK_REQUIRED"
    elif baseline and not non_baseline:
        status = "BASELINE_READY"
    else:
        status = "READY_FOR_MANUAL_PLATFORM_ACCEPTANCE"
    if timeline_error:
        status = "BLOCKED"

    conclusions = {
        "BLOCKED": "本地候选清单存在阻塞，当前不能交付；请按错误列表修复真实生成链后完整重建",
        "BASELINE_READY": "AppLovin 基线已通过 Skill 内置 ruleset 本地检查，可以继续生成其他目标平台包；Checker 与真实平台验收仍待外部执行",
        "CHECKER_REWORK_REQUIRED": "Playable Ad Checker 可信观察发现当前 artifact 存在真实缺陷，受影响平台返工前不能进入人工验收",
        "READY_FOR_MANUAL_PLATFORM_ACCEPTANCE": "当前候选包已通过 Skill 内置 ruleset 的本地检查，可以进入 Checker、官方 Preview、广告后台、代表设备和人工验收",
    }
    next_steps = {
        "BLOCKED": "修复列出的责任层并完整重建、复检",
        "BASELINE_READY": "基于已验证 AppLovin 基线生成其他目标平台候选包",
        "CHECKER_REWORK_REQUIRED": "立即按受影响平台修复真实生成链、完整重建和 final-recheck，用新 SHA supersede 后继续终检；不得在返工状态停止",
        "READY_FOR_MANUAL_PLATFORM_ACCEPTANCE": "补做 Playable Ad Checker，并进入官方 Preview、真实广告后台、代表设备、横竖屏、真实商店跳转和人工验收",
    }

    manual_gates = []
    accepted_warnings = []
    for item in candidates:
        manual_gates.extend({"platform": item["platform"], **gate} for gate in item.get("manualGates") or [])
        accepted_warnings.extend({"platform": item["platform"], **warning} for warning in item.get("acceptedWarnings") or [])

    skill_ux_ref = None
    if bool(args.skill_ux_input) != bool(args.skill_ux_out):
        errors.append({"manifest": "Skill 用户体验复验", "error": "--skill-ux-input 与 --skill-ux-out 必须同时提供"})
        status = "BLOCKED"
    elif args.skill_ux_input and args.skill_ux_out:
        try:
            skill_ux_ref = render_skill_ux(Path(args.skill_ux_input), Path(args.skill_ux_out))
        except (OSError, ValueError, json.JSONDecodeError) as exc:
            errors.append({"manifest": str(args.skill_ux_input), "error": f"Skill 用户体验复验生成失败：{exc}"})
            status = "BLOCKED"

    efficiency = optimization_efficiency(baseline)
    capture_mismatch = checker_capture_mismatch(candidates, checker)
    if status == "READY_FOR_MANUAL_PLATFORM_ACCEPTANCE" and capture_mismatch.get("detected"):
        next_step = capture_mismatch["nextStep"]
        risk_conclusion = capture_mismatch["riskConclusion"]
        failure_and_rollback = capture_mismatch["failureAndRollback"]
    else:
        next_step = next_steps[status]
        failure_and_rollback = (
            "Checker 已发现真实 artifact 缺陷，受影响平台必须修复真实生成链并完整重建"
            if external_checker.get("status") == "ISSUES_FOUND" else
            "本地规则或可信外部观察发现 artifact 缺陷时修复真实生成链并完整重建；无效 Checker 观察不改写 artifact"
        )
        risk_conclusion = {
            "PASS": "Checker 已作为补充证据通过；官方 Preview、广告后台、代表设备和人工验收仍未完成",
            "ISSUES_FOUND": "Checker 可信观察已发现当前 artifact 的真实缺陷，受影响平台必须返工",
            "PENDING": "Checker 补充观察尚待重录；本地候选资格保留，真实平台与人工验收仍未完成",
            "UNAVAILABLE": "Checker 当前不可达或部分页签不可用；本地候选资格保留，需通过后续 Checker 或对应真实平台补测",
            "NOT_RUN": "Checker 尚未验证；本地 ruleset 通过不等于 Checker、官方 Preview、广告后台或代表设备通过",
        }.get(str(external_checker.get("status")), "外部平台与人工验收仍未完成")
    audit_md_path = (
        Path(args.audit_md_out).expanduser().resolve()
        if args.audit_md_out else
        Path(args.md_out).expanduser().resolve().with_name(Path(args.md_out).stem + ".audit.md")
    )
    external_validation_issues = []
    if checker_error:
        external_validation_issues.append({"validation": "checker", "error": f"Checker acceptance 需要重新验签：{checker_error}"})
    if checker_preflight_error:
        external_validation_issues.append({"validation": "checker", "error": f"Checker preflight 需要重新记录：{checker_preflight_error}"})
    report = {
        "schemaVersion": "playable-delivery-report-v2",
        "generatedAt": datetime.now().astimezone().isoformat(timespec="seconds"),
        "status": status,
        "userConclusion": conclusions[status],
        "nextStep": next_step,
        "riskConclusion": risk_conclusion,
        "failureAndRollback": failure_and_rollback,
        "rulesetVersion": next(iter(ruleset_versions), None),
        "rulesetSha256": next(iter(ruleset_hashes), None),
        "candidates": [
            {key: item.get(key) for key in (
                "mode", "status", "platform", "deliveryKey", "deliveryContext", "artifact", "ruleset",
                "applicationMode", "consumedResourceTree", "payloadReport", "acceptedWarnings", "manualGates",
                "resourceConsumptionProof", "performanceAssessment", "checkBatchId", "manifestPath", "manifestSha256",
            )}
            for item in candidates
        ],
        "checker": checker,
        "checkerAcceptance": checker_ref,
        "checkerPreflight": checker_preflight_ref,
        "checkerError": checker_error,
        "checkerCaptureMismatch": capture_mismatch,
        "externalValidations": {
            "checker": external_checker,
            "officialPreview": {
                "status": "NOT_RECORDED",
                "required": True,
                "userConclusion": "尚未记录官方 Preview 验收",
            },
            "adPlatform": {
                "status": "NOT_RECORDED",
                "required": True,
                "userConclusion": "尚未记录真实广告后台验收",
            },
            "representativeDevices": {
                "status": "NOT_RECORDED",
                "required": True,
                "userConclusion": "尚未记录真机或代表设备验收",
            },
        },
        "externalValidationIssues": external_validation_issues,
        "optimizationEfficiency": efficiency,
        "resourceOrigin": resource_origin,
        "executionTiming": execution_timing,
        "skillUserExperienceEvaluation": skill_ux_ref,
        "acceptedWarnings": accepted_warnings,
        "manualGates": manual_gates,
        "resourceState": baseline[0].get("resourceState") if len(baseline) == 1 else None,
        "resourceStates": [item.get("resourceState") for item in baseline],
        "deliveryMatrix": [
            {
                "deliveryKey": key,
                "baselineManifest": items[0].get("manifestPath"),
                "baselineSha256": items[0].get("manifestSha256"),
                "platforms": sorted(item.get("platform") for item in non_baseline if item.get("deliveryKey") == key),
            }
            for key, items in sorted(baseline_by_delivery.items())
        ],
        "locations": {
            "candidateResourceRoot": str(Path(args.candidate_resource_root).expanduser().resolve()) if args.candidate_resource_root else None,
            "appliedResourceRoot": str(Path(args.applied_resource_root).expanduser().resolve()) if args.applied_resource_root else None,
            "rollbackRoot": str(Path(args.rollback_root).expanduser().resolve()) if args.rollback_root else None,
            "platformPackageRoot": str(Path(args.platform_package_root).expanduser().resolve()) if args.platform_package_root else None,
            "reportPath": str(Path(args.md_out).expanduser().resolve()),
            "auditReportPath": str(audit_md_path),
        },
        "localErrors": local_errors,
        "localValidationPassed": local_blocking_error_count == 0 and timeline_error is None,
        "errors": errors,
    }
    json_text = json.dumps(report, ensure_ascii=False, indent=2) + "\n"
    write(args.json_out, json_text)
    write(args.md_out, render_user_markdown(report))
    write(str(audit_md_path), render_markdown(report))
    print(json_text, end="")
    if status == "READY_FOR_MANUAL_PLATFORM_ACCEPTANCE" or status == "BASELINE_READY":
        return 0
    return 1 if status == "BLOCKED" else 2


if __name__ == "__main__":
    raise SystemExit(main())
