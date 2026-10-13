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

from artifact import ArtifactError, load_artifact
from resource_common import (
    is_within,
    load_json,
    resolve_boundary_path,
    resolve_project_path,
    sha256_file,
    sha256_object,
    utc_now,
    write_json_atomic,
)
from validate_adapter import validate as validate_adapter


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="生成 Gate B《资源覆盖确认单》")
    parser.add_argument("--project-root", required=True, type=Path)
    parser.add_argument("--adapter", required=True, type=Path)
    parser.add_argument("--trial-plan", required=True, type=Path)
    parser.add_argument("--trial-approval", type=Path, help="未优化继续时必须绑定 Gate A 用户批准")
    parser.add_argument("--tinify-report", type=Path, help="含 Tinify 动作时必须绑定顺序批处理报告")
    parser.add_argument("--tinify-decisions", type=Path, help="含 Tinify 动作时必须绑定逐图接受/淘汰/暂停记录")
    parser.add_argument("--change-records", required=True, type=Path)
    parser.add_argument("--fidelity-report", required=True, type=Path)
    parser.add_argument("--fidelity-review", type=Path, help="单页内嵌的单文件与完整包 A/B 页面；存在资源替换动作时必填")
    parser.add_argument("--before-artifact", required=True, type=Path)
    parser.add_argument("--after-artifact", required=True, type=Path)
    parser.add_argument("--payload-report", required=True, type=Path)
    parser.add_argument("--excluded-resources", required=True, type=Path)
    parser.add_argument("--rollback-root", required=True, type=Path)
    parser.add_argument("--json-out", required=True, type=Path)
    parser.add_argument("--md-out", required=True, type=Path)
    return parser.parse_args()


def require(path: Path, schema: str) -> dict[str, Any]:
    resolved = path.expanduser().resolve()
    value = load_json(resolved)
    if not isinstance(value, dict) or value.get("schemaVersion") != schema:
        raise ValueError(f"{resolved.name} schemaVersion 必须为 {schema}")
    return value


def matches_ref(reference: object, path: Path) -> bool:
    if not isinstance(reference, dict):
        return False
    resolved = path.expanduser().resolve()
    return (
        Path(str(reference.get("path") or "")).expanduser().resolve() == resolved
        and resolved.is_file()
        and reference.get("sha256") == sha256_file(resolved)
    )


def within_any(path: Path, roots: list[str]) -> bool:
    return any(is_within(Path(root), path) for root in roots)


def human_bytes(value: int) -> str:
    if value >= 1024 * 1024:
        return f"{value / (1024 * 1024):.2f} MiB"
    if value >= 1024:
        return f"{value / 1024:.1f} KiB"
    return f"{value} B"


def format_parameters(parameters: dict[str, Any]) -> str:
    parts: list[str] = []
    labels = {
        "format": "格式",
        "codec": "编码",
        "bitRateKbps": "码率",
        "sampleRateHz": "采样率",
        "channels": "声道",
        "metadata": "元数据",
    }
    for name in ("format", "codec", "bitRateKbps", "sampleRateHz", "channels", "metadata"):
        if name not in parameters:
            continue
        value = parameters[name]
        if name == "bitRateKbps":
            shown = f"{value} kbps"
        elif name == "sampleRateHz":
            shown = f"{value} Hz"
        elif name == "channels":
            parts.append("单声道" if value == 1 else f"{value} 声道")
            continue
        elif name == "metadata" and value in {"remove", "strip", "removed"}:
            shown = "已移除"
        elif name in {"format", "codec"} and str(value).lower() in {"mp3", "libmp3lame"}:
            shown = "MP3"
        else:
            shown = str(value)
        parts.append(f"{labels[name]} {shown}")
    return "、".join(parts) if parts else "保持原格式"


def platform_label(value: Any) -> str:
    labels = {
        "applovin": "AppLovin",
        "google-ads": "Google Ads",
        "meta": "Meta",
        "unityads": "Unity Ads",
        "moloco": "Moloco",
        "mintegral": "Mintegral",
        "tiktok": "TikTok",
    }
    text = str(value or "").strip()
    return labels.get(text.lower(), text or "未指定")


def performance_summary(report: dict[str, Any]) -> tuple[float | None, str]:
    longest = max(
        (
            float((item.get("performance") or {}).get("longTaskMaxMs"))
            for item in report.get("observations", [])
            if isinstance(item, dict)
            and isinstance((item.get("performance") or {}).get("longTaskMaxMs"), (int, float))
        ),
        default=None,
    )
    suffix = f"；本轮最长 Long Task 为 {longest:g} ms" if longest is not None else ""
    if report.get("automaticPassClaimed") is True:
        return longest, f"已按项目批准阈值完成性能检查{suffix}"
    return longest, f"性能已采样，但没有项目批准阈值，因此不声称性能通过，仍需代表设备确认{suffix}"


def build_proposal(args: argparse.Namespace) -> dict[str, Any]:
    project_root = args.project_root.expanduser().resolve()
    adapter_path = args.adapter.expanduser().resolve()
    adapter_report = validate_adapter(project_root, adapter_path)
    if not adapter_report.get("valid") or not (adapter_report.get("resourceBoundaries") or {}).get("applyCapable"):
        raise ValueError("v2 Adapter 未通过三层资源与稳定 runRoot 校验")
    boundaries = adapter_report["resourceBoundaries"]

    plan = require(args.trial_plan, "playable-resource-optimization-plan-v1")
    plan_core = {key: value for key, value in plan.items() if key not in {"generatedAt", "optimizationPlanHash"}}
    if plan.get("optimizationPlanHash") != "sha256:" + sha256_object(plan_core):
        raise ValueError("Gate A 资源优化计划哈希无效")
    changes = require(args.change_records, "playable-resource-change-records-v1")
    fidelity = require(args.fidelity_report, "playable-resource-fidelity-report-v1")
    payload = require(args.payload_report, "playable-candidate-payload-report-v1")
    excluded = require(args.excluded_resources, "playable-excluded-resources-v1")
    if any(str(value) != str(project_root) for value in (plan.get("projectRoot"), changes.get("projectRoot"), excluded.get("projectRoot"))):
        raise ValueError("Gate A、change records 和未引用清单不属于当前项目")
    automatic_conclusion = fidelity.get("automaticConclusion") or fidelity.get("conclusion")
    if automatic_conclusion != "PASS":
        raise ValueError("资源自动保真尚未通过，不能生成覆盖确认单")
    human_status = (fidelity.get("humanApproval") or {}).get("status")
    lossy_human_pending = human_status not in {"APPROVED", "NOT_REQUIRED_NO_LOSSY_CHANGE"}
    performance_reference = (fidelity.get("evidence") or {}).get("performanceSmoke")
    if not isinstance(performance_reference, str) or not performance_reference.strip():
        raise ValueError("保真报告未绑定性能 smoke，不能生成覆盖确认单")
    performance_path = Path(performance_reference).expanduser()
    if not performance_path.is_absolute():
        performance_path = args.fidelity_report.expanduser().resolve().parent / performance_path
    performance_path = performance_path.resolve()
    performance = load_json(performance_path)
    if (
        not isinstance(performance, dict)
        or not isinstance(performance.get("conclusion"), str)
        or not isinstance(performance.get("automaticPassClaimed"), bool)
    ):
        raise ValueError("性能 smoke 缺少结论或阈值声明")
    longest_task_ms, performance_user_conclusion = performance_summary(performance)
    comparison = changes.get("comparisonContext") or {}
    if comparison.get("equivalent") is not True or not isinstance(comparison.get("hash"), str):
        raise ValueError("未优化/优化 exact candidate 尚未证明使用同一构建上下文")

    before = load_artifact(str(args.before_artifact))
    after = load_artifact(str(args.after_artifact))
    payload_artifact = payload.get("artifact") or {}
    if payload.get("conclusion") != "PASS" or payload.get("blockers"):
        raise ValueError("最终候选载荷仍有 blocker，不能生成覆盖确认单")
    if payload_artifact.get("sha256") != after.sha256:
        raise ValueError("最终载荷报告未绑定优化后 exact candidate")

    rollback_root = resolve_boundary_path(
        project_root, str(args.rollback_root.expanduser()), boundaries, "rollbackRoot",
    )

    actions: list[dict[str, Any]] = []
    seen_ids: set[str] = set()
    plan_actions = {
        item.get("actionId"): item
        for item in plan.get("items") or []
        if isinstance(item, dict) and isinstance(item.get("actionId"), str)
    }
    tinify_plan_actions = {
        action_id: item for action_id, item in plan_actions.items()
        if item.get("action") == "TINIFY_SHRINK"
    }
    tinify_report: dict[str, Any] | None = None
    tinify_decisions: dict[str, Any] | None = None
    tinify_decisions_by_id: dict[str, dict[str, Any]] = {}
    tinify_status_summary = None
    if tinify_plan_actions:
        if args.trial_approval is None or args.tinify_report is None or args.tinify_decisions is None:
            raise ValueError("Tinify Gate B 必须绑定 Gate A approval、--tinify-report 和 --tinify-decisions")
        trial_approval = require(args.trial_approval, "playable-resource-trial-approval-v2")
        authorization = trial_approval.get("tinifyAuthorization") or {}
        if (
            trial_approval.get("optimizationPlanHash") != plan.get("optimizationPlanHash")
            or authorization.get("externalUploadAuthorized") is not True
            or authorization.get("approvedActionIds") != list(tinify_plan_actions)
        ):
            raise ValueError("Tinify Gate A 上传授权未绑定当前计划")
        tinify_report = require(args.tinify_report, "playable-tinify-batch-report-v1")
        report_items = [item for item in tinify_report.get("items") or [] if isinstance(item, dict)]
        report_by_id = {item.get("actionId"): item for item in report_items}
        if set(report_by_id) != set(tinify_plan_actions):
            raise ValueError("Tinify 批处理报告与 Gate A allowlist 不一致")
        statuses = {item.get("status") for item in report_items}
        unknown = statuses - {
            "SUCCESS", "REUSED_SUCCESS_RECEIPT", "NOT_TESTED_QUOTA",
        }
        if unknown:
            raise ValueError("Tinify 批处理仍有暂停或未知状态，不能进入 Gate B：" + ", ".join(sorted(str(value) for value in unknown)))
        tinify_decisions = require(args.tinify_decisions, "playable-tinify-candidate-decisions-v1")
        decisions_core = {
            key: value for key, value in tinify_decisions.items()
            if key not in {"generatedAt", "decisionHash"}
        }
        if (
            tinify_decisions.get("decisionHash") != "sha256:" + sha256_object(decisions_core)
            or tinify_decisions.get("provider") != "tinify"
            or tinify_decisions.get("operation") != "shrink"
            or tinify_decisions.get("optimizationPlanHash") != plan.get("optimizationPlanHash")
            or not matches_ref(tinify_decisions.get("plan"), args.trial_plan.expanduser().resolve())
            or not matches_ref(tinify_decisions.get("batchReport"), args.tinify_report.expanduser().resolve())
            or not matches_ref(tinify_decisions.get("changeRecords"), args.change_records.expanduser().resolve())
            or args.fidelity_review is None
            or not matches_ref(tinify_decisions.get("fidelityReview"), args.fidelity_review.expanduser().resolve())
        ):
            raise ValueError("Tinify 逐图决策未绑定当前计划、批处理报告、change records 或 A/B 审阅页")
        decision_items = [item for item in tinify_decisions.get("decisions") or [] if isinstance(item, dict)]
        tinify_decisions_by_id = {item.get("actionId"): item for item in decision_items}
        successful_ids = {
            item.get("actionId") for item in report_items
            if item.get("status") in {"SUCCESS", "REUSED_SUCCESS_RECEIPT"}
        }
        if set(tinify_decisions_by_id) != successful_ids:
            raise ValueError("Tinify 每个成功候选都必须有逐图决策")
        paused = sorted(
            str(action_id) for action_id, item in tinify_decisions_by_id.items()
            if item.get("status") == "CANDIDATE_PAUSED"
        )
        if paused:
            raise ValueError("Tinify 逐图 A/B 仍有暂停项，不能进入 Gate B：" + ", ".join(paused))
        invalid_decisions = sorted(
            str(action_id) for action_id, item in tinify_decisions_by_id.items()
            if item.get("status") not in {"ELIGIBLE_FOR_GATE_B", "CANDIDATE_REJECTED"}
        )
        if invalid_decisions:
            raise ValueError("Tinify 逐图决策状态无效：" + ", ".join(invalid_decisions))
        quota_ids = {
            item.get("actionId") for item in report_items if item.get("status") == "NOT_TESTED_QUOTA"
        }
        quota = tinify_decisions.get("quotaResolution") or {}
        if quota_ids:
            if set(quota.get("actionIds") or []) != quota_ids:
                raise ValueError("Tinify 额度处置未绑定全部 NOT_TESTED_QUOTA 项")
            if quota.get("status") == "LOCAL_FALLBACK_GATE_A_REQUIRED":
                raise ValueError("Tinify 剩余项已选择本地备用，必须先完成新的 Gate A，不能进入当前 Gate B")
            if quota.get("status") != "REMAINING_KEEP_ORIGINAL":
                raise ValueError("Tinify 额度不足后的剩余图片尚未决定保持原图或转本地备用")
        elif quota.get("status") != "NOT_APPLICABLE":
            raise ValueError("Tinify 未发生额度不足，但逐图决策包含额度处置")
        tinify_status_summary = {
            "provider": "tinify", "service": "Tinify Developer API",
            "actualRequestCount": sum(
                int(((item.get("receipt") or {}).get("api") or {}).get("requestCount") or 0)
                for item in report_items if item.get("status") in {"SUCCESS", "REUSED_SUCCESS_RECEIPT"}
            ),
            "successfulActionIds": [item.get("actionId") for item in report_items if item.get("status") in {"SUCCESS", "REUSED_SUCCESS_RECEIPT"}],
            "eligibleActionIds": [item.get("actionId") for item in decision_items if item.get("status") == "ELIGIBLE_FOR_GATE_B"],
            "rejectedActionIds": [item.get("actionId") for item in decision_items if item.get("status") == "CANDIDATE_REJECTED"],
            "notTestedQuotaActionIds": [item.get("actionId") for item in report_items if item.get("status") == "NOT_TESTED_QUOTA"],
            "report": {"path": str(args.tinify_report.expanduser().resolve()), "sha256": sha256_file(args.tinify_report.expanduser().resolve())},
            "decisions": {"path": str(args.tinify_decisions.expanduser().resolve()), "sha256": sha256_file(args.tinify_decisions.expanduser().resolve())},
        }
    for item in changes.get("actions") or []:
        if not isinstance(item, dict) or item.get("operation") != "REPLACE":
            raise ValueError("change records 只允许 REPLACE 候选动作")
        action_id = item.get("actionId")
        if not isinstance(action_id, str) or not action_id or action_id in seen_ids:
            raise ValueError("change records actionId 缺失或重复")
        seen_ids.add(action_id)
        planned = plan_actions.get(action_id)
        if not isinstance(planned, dict) or planned.get("action") not in {"TINIFY_SHRINK", "RESIZE", "REENCODE", "SIMPLIFY", "REPACK_ATLAS", "SUBSET_FONT", "PRUNE_CONFIG"}:
            raise ValueError(f"资源替换动作未绑定 Gate A 的有损候选：{action_id}")
        if (
            planned.get("action") == "TINIFY_SHRINK"
            and (tinify_decisions_by_id.get(action_id) or {}).get("status") == "CANDIDATE_REJECTED"
        ):
            continue
        target = resolve_project_path(project_root, item.get("targetPath"), must_exist=True)
        candidate = resolve_boundary_path(
            project_root, item.get("candidatePath"), boundaries, "candidateRoots", must_exist=True,
        )
        if not target.is_file() or not candidate.is_file():
            raise ValueError(f"覆盖动作必须指向文件：{action_id}")
        if not within_any(target, boundaries["overwriteEligibleRoots"]):
            raise ValueError(f"目标不在 overwriteEligibleRoots：{item.get('targetPath')}")
        if not within_any(candidate, boundaries["candidateRoots"]):
            raise ValueError(f"候选不在 candidateRoots：{item.get('candidatePath')}")
        before_sha = sha256_file(target)
        candidate_sha = sha256_file(candidate)
        if item.get("beforeSha256") != before_sha or item.get("beforeBytes") != target.stat().st_size:
            raise ValueError(f"目标文件已漂移：{item.get('targetPath')}")
        if item.get("candidateSha256") != candidate_sha or item.get("candidateBytes") != candidate.stat().st_size:
            raise ValueError(f"候选文件已漂移：{item.get('candidatePath')}")
        if item.get("fidelityConclusion") not in {"PASS", "PENDING_HUMAN"}:
            raise ValueError(f"资源尚未逐项通过自动保真：{action_id}")
        saved = target.stat().st_size - candidate.stat().st_size
        actual_parameters = item.get("actualParameters")
        if candidate_sha == before_sha:
            raise ValueError(f"资源候选与目标字节相同，不能作为优化动作：{action_id}")
        if saved <= 0:
            raise ValueError(f"资源候选没有正向字节收益：{action_id}")
        if not isinstance(actual_parameters, dict) or not actual_parameters:
            raise ValueError(f"资源候选缺少实际转换参数：{action_id}")
        if planned.get("action") == "TINIFY_SHRINK":
            decision = tinify_decisions_by_id.get(action_id) or {}
            if decision.get("status") != "ELIGIBLE_FOR_GATE_B":
                raise ValueError(f"Tinify 候选未通过逐图 A/B，不能进入 Gate B：{action_id}")
            report_item = next((value for value in (tinify_report or {}).get("items") or [] if value.get("actionId") == action_id), None)
            if not isinstance(report_item, dict) or report_item.get("status") not in {"SUCCESS", "REUSED_SUCCESS_RECEIPT"}:
                raise ValueError(f"Tinify 成功候选缺少对应脱敏 receipt：{action_id}")
            receipt = report_item.get("receipt") or {}
            if receipt.get("candidateSha256") != candidate_sha or receipt.get("sourceSha256") != before_sha:
                raise ValueError(f"Tinify receipt 与 Gate B 精确文件不一致：{action_id}")
            if decision.get("candidateSha256") != candidate_sha or decision.get("sourceSha256") != before_sha:
                raise ValueError(f"Tinify 逐图决策与 Gate B 精确文件不一致：{action_id}")
            audit = planned.get("opportunityAudit") or {}
            required_views = {
                "side-by-side", "overlay", "blink", "difference", "actual-display-size",
            }
            risks = {str(value).upper() for value in audit.get("riskFeatures") or []}
            if risks:
                required_views.add("runtime-scene")
            if risks & {"TEXT", "CTA", "LOGO", "KEY_UI", "NINE_SLICE", "TRANSPARENT_EDGE"}:
                required_views.update({"zoom", "transparent-checkerboard", "light-background", "dark-background"})
            review_views = set(((item.get("abReview") or {}).get("views") or []))
            if not required_views <= review_views:
                raise ValueError(f"Tinify A/B 视图不完整：{action_id} / 缺少 {sorted(required_views - review_views)}")
            if audit.get("pixelSensitive") is True:
                semantic = item.get("semanticValidation") or {}
                if semantic.get("conclusion") != "PASS" or semantic.get("schemaVersion") != "playable-image-semantic-verification-v1":
                    raise ValueError(f"像素敏感 Tinify 候选缺少语义验签：{action_id}")
        actions.append({
            "actionId": action_id,
            "operation": "REPLACE",
            "targetPath": item["targetPath"],
            "candidatePath": str(candidate),
            "bucket": item.get("bucket") or "other",
            "beforeBytes": target.stat().st_size,
            "beforeSha256": before_sha,
            "candidateBytes": candidate.stat().st_size,
            "candidateSha256": candidate_sha,
            "savedBytes": saved,
            "savedPercent": round(saved * 100 / target.stat().st_size, 1) if target.stat().st_size else 0.0,
            "actualParameters": actual_parameters,
            "fidelityConclusion": item.get("fidelityConclusion"),
            "fidelitySummary": item.get("fidelitySummary") or ("自动保真通过，等待本次 A/B 确认" if lossy_human_pending else "自动与人工保真均通过"),
            "abReview": item.get("abReview"),
            "provider": "tinify" if planned.get("action") == "TINIFY_SHRINK" else item.get("provider") or "local",
            "semanticValidation": item.get("semanticValidation"),
        })
    if tinify_decisions_by_id:
        eligible_ids = {
            action_id for action_id, item in tinify_decisions_by_id.items()
            if item.get("status") == "ELIGIBLE_FOR_GATE_B"
        }
        tinify_change_ids = {
            item.get("actionId") for item in actions if item.get("provider") == "tinify"
        }
        if eligible_ids != tinify_change_ids:
            raise ValueError("Gate B change records 必须精确包含已接受的 Tinify 候选，并排除淘汰项")
    package_only_actions = changes.get("packageOnlyActions") or []
    if not isinstance(package_only_actions, list) or not all(isinstance(item, dict) for item in package_only_actions):
        raise ValueError("packageOnlyActions 必须是对象数组")
    allowed_package_operations = {"ALLOWLIST_PROJECTION", "DEDUP_INLINE_PAYLOAD"}
    unknown_package_operations = sorted({str(item.get("operation")) for item in package_only_actions} - allowed_package_operations)
    if unknown_package_operations:
        raise ValueError("package-only 动作无效：" + ", ".join(unknown_package_operations))

    artifact_saved = before.size - after.size
    plan_intent = (plan.get("summary") or {}).get("resourceResultIntent")
    if actions:
        resource_result_type = "optimized"
        if artifact_saved <= 0 or before.sha256 == after.sha256:
            raise ValueError("优化候选没有产生最终 artifact 正向净收益")
    elif package_only_actions:
        resource_result_type = "package-only"
        if artifact_saved <= 0 or before.sha256 == after.sha256:
            raise ValueError("package-only 候选没有产生最终 artifact 正向净收益")
    elif plan_intent == "unchanged-explicitly-approved":
        if args.trial_approval is None:
            raise ValueError("未优化继续必须绑定 Gate A 用户批准")
        trial_approval = require(args.trial_approval, "playable-resource-trial-approval-v2")
        if (
            trial_approval.get("status") != "RESOURCE_TRIAL_APPROVED"
            or trial_approval.get("optimizationPlanHash") != plan.get("optimizationPlanHash")
            or not str(trial_approval.get("confirmationText") or "").strip()
        ):
            raise ValueError("未优化继续的 Gate A 用户批准无效")
        if before.sha256 != after.sha256:
            raise ValueError("未优化继续分支的 exact candidate 字节发生变化")
        resource_result_type = "unchanged-explicitly-approved"
    else:
        raise ValueError("没有真实资源候选、有效 package-only 收益或明确批准的未优化继续证据")
    if plan_intent == "optimized" and resource_result_type != "optimized":
        raise ValueError("Gate A 已批准资源优化动作，但 Gate B 没有绑定真实优化候选")
    if plan_intent == "package-only" and resource_result_type != "package-only":
        raise ValueError("Gate A 仅批准 package-only 动作，Gate B 结果类型不一致")
    if plan_intent == "unchanged-explicitly-approved" and resource_result_type != "unchanged-explicitly-approved":
        raise ValueError("Gate A 记录为未优化继续，Gate B 结果类型不一致")
    human_pending = resource_result_type == "optimized" and lossy_human_pending
    fidelity_review = None
    if resource_result_type == "optimized":
        if args.fidelity_review is None:
            raise ValueError("资源优化候选必须提供单页 --fidelity-review；不能要求用户逐项打开新页面")
        review_path = args.fidelity_review.expanduser().resolve()
        if not review_path.is_file() or review_path.suffix.lower() != ".html":
            raise ValueError("fidelity-review 必须是已生成的本地 HTML 页面")
        fidelity_review = {"path": str(review_path), "sha256": sha256_file(review_path)}

    unreferenced: list[dict[str, Any]] = []
    for item in excluded.get("resources") or []:
        if not isinstance(item, dict) or item.get("classification", "UNREFERENCED") != "UNREFERENCED":
            raise ValueError("排除清单包含非 UNREFERENCED 项")
        path = resolve_project_path(project_root, item.get("path"), must_exist=True)
        if not path.is_file() or item.get("bytes") != path.stat().st_size or item.get("sha256") != sha256_file(path):
            raise ValueError(f"未引用资源快照已漂移：{item.get('path')}")
        if any(action["targetPath"] == item.get("path") for action in actions):
            raise ValueError(f"UNREFERENCED 资源不得进入覆盖动作：{item.get('path')}")
        unreferenced.append({
            "path": item["path"],
            "bytes": item["bytes"],
            "sha256": item["sha256"],
            "projectAction": "KEEP_UNCHANGED",
            "candidateAction": "NOT_PACKAGED",
        })

    core = {
        "schemaVersion": "playable-resource-apply-proposal-v1",
        "projectRoot": str(project_root),
        "adapter": {"path": str(adapter_path), "sha256": sha256_file(adapter_path)},
        "optimizationPlanHash": plan.get("optimizationPlanHash"),
        "comparisonContext": comparison,
        "actions": actions,
        "packageOnlyActions": package_only_actions,
        "resourceResultType": resource_result_type,
        "unreferencedResources": unreferenced,
        "rollbackRoot": str(rollback_root),
        "artifacts": {
            "before": {"path": before.path, "bytes": before.size, "sha256": before.sha256},
            "after": {"path": after.path, "bytes": after.size, "sha256": after.sha256},
            "savedBytes": artifact_saved,
            "savedPercent": round(artifact_saved * 100 / before.size, 1) if before.size else 0.0,
        },
        "payloadReport": {
            "path": str(args.payload_report.expanduser().resolve()),
            "sha256": sha256_file(args.payload_report.expanduser().resolve()),
            "conclusion": payload["conclusion"],
            "duplicateWasteBytes": (payload.get("summary") or {}).get("duplicateWasteBytes", 0),
        },
        "platformContext": {
            "current": payload.get("platform"),
            "label": platform_label(payload.get("platform")),
            "stageConclusion": "当前仅完成资源候选对照，尚未生成平台交付包",
        },
        "performanceSmoke": {
            "path": str(performance_path),
            "sha256": sha256_file(performance_path),
            "conclusion": performance["conclusion"],
            "automaticPassClaimed": performance["automaticPassClaimed"],
            "longestTaskMs": longest_task_ms,
            "userConclusion": performance_user_conclusion,
        },
        "fidelityReport": {"path": str(args.fidelity_report.expanduser().resolve()), "sha256": sha256_file(args.fidelity_report.expanduser().resolve())},
        "humanFidelity": {
            "requiredInThisGate": human_pending,
            "statusBeforeGate": human_status or "PENDING",
            "reviewEntry": fidelity_review["path"] if fidelity_review else None,
        },
        "fidelityReview": fidelity_review,
        "tinifySummary": tinify_status_summary,
        "allowedDecisions": (
            ["candidate-only", "apply-approved-replacements"]
            if resource_result_type == "optimized"
            else ["candidate-only"]
        ),
        "deleteSupported": False,
    }
    proposal = dict(core)
    proposal["generatedAt"] = utc_now()
    proposal["proposalHash"] = "sha256:" + sha256_object(core)
    return proposal


def render_markdown(proposal: dict[str, Any]) -> str:
    artifacts = proposal["artifacts"]
    bucket_labels = {"audio": "音效", "textures": "图片", "models": "模型", "atlas": "图集", "other": "资源"}
    bucket_counts: dict[str, int] = {}
    for item in proposal["actions"]:
        bucket = str(item.get("bucket") or "other")
        bucket_counts[bucket] = bucket_counts.get(bucket, 0) + 1
    change_summary = "、".join(f"{count} 个{bucket_labels.get(bucket, '资源')}" for bucket, count in sorted(bucket_counts.items()))
    if proposal.get("packageOnlyActions"):
        package_summary = "最终包内同时复用重复素材内容或排除未引用载荷，不删除、移动或改名项目文件"
        change_summary = f"{change_summary}；{package_summary}" if change_summary else package_summary
    if not change_summary:
        change_summary = "资源字节保持不变；已绑定用户明确的未优化继续确认"
    review_entry = proposal["humanFidelity"].get("reviewEntry")
    lines = [
        "# 资源覆盖确认单",
        "",
        "> 候选已完成自动保真和最终包对照。请在同一次回复中确认 A/B 体验，并选择是否写回工程。",
        "",
        "## 一眼结论",
        "",
        f"- 改什么：{change_summary}；可覆盖范围只涉及下方列出的精确文件，玩法和资源路径不变。",
        f"- 实际节省：最终包从 {human_bytes(artifacts['before']['bytes'])} 减至 {human_bytes(artifacts['after']['bytes'])}，减少 {human_bytes(artifacts['savedBytes'])}（{artifacts['savedPercent']}%）。",
        "- 主要风险：候选可能产生可感知的听感或观感差异；自动检查不能替代你的 A/B 体验确认。",
        "- 是否覆盖：现在不会覆盖工程资源；只有你明确选择覆盖后，才会写回下方列出的文件。",
        f"- 失败与回滚：不写回时可直接放弃候选；选择覆盖时会先备份到 `{proposal['rollbackRoot']}`，任何校验或替换失败都会停止并整批回滚。",
        "- 你需要做：先完成 A/B 对照，再选择“候选不写回”或“覆盖列出的精确文件”。",
        *([
            f"- Tinify 调用：实际 {proposal['tinifySummary']['actualRequestCount']} 次；成功 {len(proposal['tinifySummary']['successfulActionIds'])} 项，"
            f"淘汰 {len(proposal['tinifySummary']['rejectedActionIds'])} 项，因额度未测试 {len(proposal['tinifySummary']['notTestedQuotaActionIds'])} 项。"
        ] if proposal.get("tinifySummary") else []),
        "",
        "## A/B 对照",
        "",
        (f"- [在一个页面完成单文件试听和完整包对照]({review_entry})" if isinstance(review_entry, str) and review_entry else "- 本轮没有需要人工 A/B 的单文件替换动作。"),
        "",
        "## 最终包实际变化",
        "",
        f"- 未优化对照包：{human_bytes(artifacts['before']['bytes'])}，`{artifacts['before']['sha256']}`",
        f"- 优化候选包：{human_bytes(artifacts['after']['bytes'])}，`{artifacts['after']['sha256']}`",
        f"- 实际减少：{human_bytes(artifacts['savedBytes'])}（{artifacts['savedPercent']}%）。",
        f"- 最终重复载荷：{proposal['payloadReport']['duplicateWasteBytes']} B；未发现达到阈值的重复载荷问题。",
        "",
        "## 当前检查与人工门禁",
        "",
        f"- 当前平台：按 {proposal['platformContext']['label']} 资源载荷规则完成候选对照；{proposal['platformContext']['stageConclusion']}。",
        f"- 自动保真：已通过；人工门禁：{'等待你完成本次 A/B 确认' if proposal['humanFidelity']['requiredInThisGate'] else '已由绑定证据完成'}。",
        f"- 性能：{proposal['performanceSmoke']['userConclusion']}。",
        "",
        "## 可以覆盖的精确文件",
        "",
        "| 动作与项目文件 | 原大小 | 候选大小 | 实际节省 | 覆盖前 / 候选指纹 | 实际参数 | 保真 / A-B |",
        "|---|---:|---:|---:|---|---|---|",
    ]
    for item in proposal["actions"]:
        parameters = format_parameters(item["actualParameters"])
        if item.get("provider") == "tinify":
            parameters = "Tinify shrink；保持原格式、宽高、宽高比和透明能力"
        ab = "在上方统一 A/B 页面同屏试听/查看"
        lines.append(
            f"| 动作 `{item['actionId']}`<br>`{item['targetPath']}` | {item['beforeBytes']} B | {item['candidateBytes']} B | "
            f"{item['savedBytes']} B / {item['savedPercent']}% | 原 `{item['beforeSha256']}`<br>候选 `{item['candidateSha256']}` | "
            f"{parameters} | {item['fidelitySummary']}；{ab} |"
        )
    lines.extend([
        "",
        "## 本次不打包、项目中继续保留",
        "",
    ])
    if proposal["unreferencedResources"]:
        for item in proposal["unreferencedResources"]:
            lines.append(f"- `{item['path']}`：{item['bytes']} B；项目文件保持不变。")
    else:
        lines.append("- 本次没有判定为未引用的资源。")
    lines.extend([
        "",
        "## 回滚",
        "",
        f"- 如果选择覆盖，原文件先备份到：`{proposal['rollbackRoot']}`。",
        "- 覆盖前会再次核对目标文件指纹；任何变化都会停止。任一替换失败会整批回滚。",
        "",
        "## 请选择",
        "",
        "- 不写回工程：回复“候选用于本轮平台包，不覆盖工程；A/B 听感/观感可接受”。",
        "- 覆盖文件：回复“确认覆盖上述文件；A/B 听感/观感可接受”，也可以只写要覆盖的文件路径。",
        "- A/B 不可接受：直接写明文件或体验问题；该候选会被放弃，不进入平台构建。",
        "",
        "无论选择哪一种，本次不打包的资源都继续保留在项目中；本流程不提供删除选项。",
        "",
    ])
    return "\n".join(lines)


def main() -> int:
    args = parse_args()
    try:
        proposal = build_proposal(args)
        markdown = render_markdown(proposal)
        write_json_atomic(args.json_out, proposal)
        md_path = args.md_out.expanduser().resolve()
        md_path.parent.mkdir(parents=True, exist_ok=True)
        md_path.write_text(markdown, encoding="utf-8")
    except (ArtifactError, OSError, ValueError, json.JSONDecodeError) as exc:
        print(json.dumps({"ok": False, "error": str(exc)}, ensure_ascii=False, indent=2))
        return 1
    print(json.dumps({
        "ok": True,
        "userConclusion": "资源覆盖确认单已生成：请在同一次回复中确认 A/B 体验，并选择候选不写回或精确覆盖",
        "json": str(args.json_out.resolve()),
        "markdown": str(args.md_out.resolve()),
        "proposalHash": proposal["proposalHash"],
    }, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
