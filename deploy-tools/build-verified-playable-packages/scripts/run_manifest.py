#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import sys
import uuid
from pathlib import Path
from typing import Any

LIB_ROOT = Path(__file__).resolve().parent / "lib"
sys.path.insert(0, str(LIB_ROOT))

from resource_common import load_json, path_bytes, sha256_file, sha256_tree, utc_now, write_json_atomic
from execution_timeline_core import TimelineError, create_timeline, finish_event, load_timeline, start_event
from validate_adapter import validate as validate_adapter
from checker_acceptance import load_and_validate as load_checker_acceptance, render_markdown as render_checker_markdown
from render_report import render_markdown as render_delivery_audit_markdown
from render_report import render_user_markdown as render_delivery_user_markdown
from prepare_resource_reuse_confirmation import render_markdown as render_resource_reuse_markdown
from prepare_resource_reuse_confirmation import verified_confirmation as verified_resource_reuse_confirmation
from record_resource_reuse_approval import verified_approval as verified_resource_reuse_approval
from checker_ui_queue import load_queue as load_checker_queue, validate_preflight as validate_checker_preflight


SCHEMA = "playable-package-finalization-run-v1"
STATES = (
    "DISCOVERED",
    "EFFECT_BASELINE_FROZEN",
    "RESOURCE_GRAPH_READY",
    "RESOURCE_TRIAL_PROPOSED",
    "RESOURCE_TRIAL_APPROVED",
    "TOOLCHAIN_VERIFIED",
    "RESOURCE_CANDIDATE_READY",
    "RESOURCE_APPLY_PROPOSED",
    "RESOURCE_APPLY_APPROVED",
    "RESOURCE_APPLIED",
    "RESOURCE_APPLY_SKIPPED",
    "RESOURCE_READY",
    "APPLOVIN_CANDIDATE_BUILT",
    "BASELINE_READY",
    "PLATFORM_CANDIDATE_BUILT",
    "PLATFORM_READY",
    "CHECKER_IN_PROGRESS",
    "CHECKER_ACCEPTANCE_RECORDED",
    "CHECKER_REWORK_REQUIRED",
    "CHECKER_OBSERVATION_RETRY",
    "CHECKER_BLOCKED_EXTERNAL",
    "READY_FOR_MANUAL_PLATFORM_ACCEPTANCE",
    "READY_FOR_MANUAL_ACCEPTANCE",
    "RESOURCE_REUSE_PROPOSED",
    "RESOURCE_REUSE_CONFIRMED",
)
REQUIRED_EVIDENCE = {
    "DISCOVERED": {"projectInspection"},
    "EFFECT_BASELINE_FROZEN": {"effectBaseline"},
    "RESOURCE_GRAPH_READY": {"resourceLedger", "referenceGraph", "resourceAllowlist"},
    "RESOURCE_TRIAL_PROPOSED": {"resourceOpportunityAudit", "resourcePlanJson", "resourcePlanMarkdown", "toolchainLock"},
    "RESOURCE_TRIAL_APPROVED": {"resourceApproval", "approvalVerification"},
    "TOOLCHAIN_VERIFIED": {"toolchainVerification"},
    "RESOURCE_CANDIDATE_READY": {"candidateResources", "fidelityReport", "fidelityReview", "payloadReport", "resourceExecutionVerification"},
    "RESOURCE_APPLY_PROPOSED": {"resourceApplyProposal", "resourceApplyMarkdown"},
    "RESOURCE_APPLY_APPROVED": {"resourceApplyApproval"},
    "RESOURCE_APPLIED": {"resourceApplyResult"},
    "RESOURCE_APPLY_SKIPPED": {"resourceApplyResult"},
    "RESOURCE_READY": {"resourceManifest", "optimizedLedger", "fidelityReport", "resourceState"},
    "APPLOVIN_CANDIDATE_BUILT": {"applovinArtifact"},
    "BASELINE_READY": {"baselineManifest"},
    "PLATFORM_CANDIDATE_BUILT": {"platformArtifact"},
    "PLATFORM_READY": {"platformManifest"},
    "CHECKER_IN_PROGRESS": set(),
    "CHECKER_ACCEPTANCE_RECORDED": {"checkerAcceptanceJson", "checkerAcceptanceMarkdown"},
    "CHECKER_REWORK_REQUIRED": {"checkerAcceptanceJson", "checkerAcceptanceMarkdown"},
    "CHECKER_OBSERVATION_RETRY": {"checkerAcceptanceJson", "checkerAcceptanceMarkdown"},
    "CHECKER_BLOCKED_EXTERNAL": set(),
    "READY_FOR_MANUAL_PLATFORM_ACCEPTANCE": {"deliveryReportJson", "deliveryReportMarkdown", "deliveryAuditMarkdown"},
    "READY_FOR_MANUAL_ACCEPTANCE": {"deliveryReportJson", "deliveryReportMarkdown", "deliveryAuditMarkdown"},
    "RESOURCE_REUSE_PROPOSED": {"historicalResourceState", "resourceReuseConfirmationJson", "resourceReuseConfirmationMarkdown"},
    "RESOURCE_REUSE_CONFIRMED": {"resourceReuseApproval"},
}
USER_CONCLUSIONS = {
    "DISCOVERED": "已识别目标工程，正在检查效果基线、资源范围和构建能力",
    "EFFECT_BASELINE_FROZEN": "试玩效果基线已固定，可以开始分析当前素材使用的资源",
    "RESOURCE_GRAPH_READY": "已完成当前素材的资源引用分析，正在生成资源优化计划",
    "RESOURCE_TRIAL_PROPOSED": "资源优化提案已生成；确认后只在候选目录试做，不会覆盖工程资源",
    "RESOURCE_TRIAL_APPROVED": "已确认可以试做资源优化，正在验证本地工具",
    "TOOLCHAIN_VERIFIED": "本地优化工具已验证，可以按照已确认计划执行资源优化",
    "RESOURCE_CANDIDATE_READY": "资源候选、保真和最终载荷检查已完成，正在生成资源覆盖确认单",
    "RESOURCE_APPLY_PROPOSED": "资源覆盖确认单已生成，等待你选择是否写回 playable 工程",
    "RESOURCE_APPLY_APPROVED": "已记录资源使用选择，正在按已确认方式处理候选",
    "RESOURCE_APPLIED": "确认的资源已覆盖，下一步从正式工程完整重建",
    "RESOURCE_APPLY_SKIPPED": "候选用于本轮平台包，playable 工程资源未被覆盖",
    "RESOURCE_READY": "资源候选已验证，可以开始生成 AppLovin 候选包；资源是否写回工程已记录",
    "APPLOVIN_CANDIDATE_BUILT": "AppLovin 候选包已经生成，正在执行静态和浏览器运行时检查",
    "BASELINE_READY": "AppLovin 候选包已通过本地自动检查，可以生成其他目标平台包；仍需真实平台和人工验收",
    "PLATFORM_CANDIDATE_BUILT": "目标平台候选包已经生成，正在执行该平台的本地检查",
    "PLATFORM_READY": "已绑定的目标平台候选包通过 Skill 内置 ruleset 本地检查，可以生成交付报告并进入外部平台与人工验收",
    "CHECKER_IN_PROGRESS": "正在执行可选 Playable Ad Checker 补充验证；页面观察必须绑定当前 attempt 与 exact artifact",
    "CHECKER_ACCEPTANCE_RECORDED": "Playable Ad Checker 已作为补充证据完成零 warning 与结构化证据验签，可以生成最终交付报告",
    "CHECKER_REWORK_REQUIRED": "Checker 已确认 artifact 或真实生成链存在问题；必须继续修复、重建、supersede 新 SHA 并复检",
    "CHECKER_OBSERVATION_RETRY": "Checker 补充观察证据无效或不完整；本地候选资格保留，可用同一 artifact 的新 attempt 补录",
    "CHECKER_BLOCKED_EXTERNAL": "Checker 不可达、缺少目标页签或页面工具故障；本地候选资格保留，并在交付报告中提醒补测",
    "READY_FOR_MANUAL_PLATFORM_ACCEPTANCE": "当前候选包已通过 Skill 内置 ruleset 本地检查，可以进入 Checker、官方 Preview、广告后台、代表设备和人工验收",
    "READY_FOR_MANUAL_ACCEPTANCE": "旧版最终状态仅保留历史读取，不允许新运行继续使用",
    "RESOURCE_REUSE_PROPOSED": "本轮尚未重新执行资源优化；历史候选和此前对比报告已展示，正在等待你选择是否复用",
    "RESOURCE_REUSE_CONFIRMED": "已按本轮明确选择复用验签通过的历史资源候选，可以重新绑定资源就绪证据",
}


def parser() -> argparse.ArgumentParser:
    root = argparse.ArgumentParser(description="维护资源阶段与平台阶段共用的运行清单")
    sub = root.add_subparsers(dest="command", required=True)
    init = sub.add_parser("init")
    init.add_argument("--project-root", required=True, type=Path)
    init.add_argument("--mode", required=True, choices=("resource-only", "baseline", "platform", "final-recheck"))
    init.add_argument("--manifest", type=Path)
    init.add_argument("--adapter", type=Path)
    init.add_argument("--run-id")
    init.add_argument("--require-skill-ux-evaluation", action="store_true", help="普通用户视角复验任务必须生成并绑定固定五段式报告")
    advance = sub.add_parser("advance")
    advance.formatter_class = argparse.RawDescriptionHelpFormatter
    advance.epilog = "阶段最低证据：\n" + "\n".join(
        f"  {state}: {', '.join(sorted(names))}" for state, names in REQUIRED_EVIDENCE.items()
    )
    advance.add_argument("--manifest", required=True, type=Path)
    advance.add_argument("--state", required=True, choices=STATES)
    advance.add_argument(
        "--evidence",
        action="append",
        default=[],
        metavar="NAME=PATH",
        help="绑定证据，例如 projectInspection=/abs/run/project-inspection.json；可重复传入",
    )
    advance.add_argument("--note")
    invalidate = sub.add_parser("invalidate", help="保留旧历史，并把指定阶段及下游标记为失效")
    invalidate.add_argument("--manifest", required=True, type=Path)
    invalidate.add_argument("--from-state", required=True, choices=STATES)
    invalidate.add_argument("--reason", required=True, help="面向后续执行者的中文失效原因")
    invalidate.add_argument(
        "--replacement-evidence",
        action="append",
        default=[],
        metavar="NAME=PATH",
        help="可选；已知替代证据，仅作失效记录，不会自动推进状态",
    )
    rebind = sub.add_parser("rebind", help="从最后有效阶段重新绑定失效阶段的新一轮证据")
    rebind.add_argument("--manifest", required=True, type=Path)
    rebind.add_argument("--state", required=True, choices=STATES)
    rebind.add_argument(
        "--evidence",
        action="append",
        default=[],
        metavar="NAME=PATH",
        help="新证据，格式 NAME=PATH；名称要求与 advance 相同",
    )
    rebind.add_argument("--note")
    verify = sub.add_parser("verify")
    verify.add_argument("--manifest", required=True, type=Path)
    wait_start = sub.add_parser("wait-start", help="记录 Gate A/Gate B/历史资源复用确认单已展示并开始等待用户，不代表自动批准")
    wait_start.add_argument("--manifest", required=True, type=Path)
    wait_start.add_argument("--gate", required=True, choices=("gate-a", "gate-b", "resource-reuse"))
    wait_finish = sub.add_parser("wait-finish", help="记录用户已明确回复；只结束等待，不自动推进状态")
    wait_finish.add_argument("--manifest", required=True, type=Path)
    wait_finish.add_argument("--gate", required=True, choices=("gate-a", "gate-b", "resource-reuse"))
    wait_finish.add_argument("--confirmation-text", required=True)
    checker_outcome = sub.add_parser("record-checker-outcome", help="根据验签后的 Checker acceptance 自动写入通过、返工、重录或外部阻塞状态")
    checker_outcome.add_argument("--manifest", required=True, type=Path)
    checker_outcome.add_argument("--checker-acceptance", type=Path)
    checker_outcome.add_argument("--checker-markdown", type=Path)
    checker_outcome.add_argument("--preflight", type=Path, help="Checker UNREACHABLE 时绑定外部阻塞 preflight，不创建上传 attempt")
    return root


def evidence_values(values: list[str]) -> dict[str, Path]:
    result = {}
    for value in values:
        if "=" not in value:
            raise ValueError(f"证据格式必须为 name=path：{value}")
        name, path_value = value.split("=", 1)
        if not name.strip() or not path_value.strip():
            raise ValueError(f"证据格式无效：{value}")
        path = Path(path_value).expanduser().resolve()
        if not path.exists():
            raise ValueError(f"证据不存在：{path}")
        result[name.strip()] = path
    return result


def evidence_ref(path: Path) -> dict[str, Any]:
    return {
        "path": str(path),
        "type": "file" if path.is_file() else "directory",
        "bytes": path_bytes(path),
        "sha256": sha256_tree(path),
    }


def load_manifest(path: Path) -> dict[str, Any]:
    value = load_json(path)
    if not isinstance(value, dict) or value.get("schemaVersion") != SCHEMA:
        raise ValueError("运行清单 schemaVersion 无效")
    if value.get("status") not in STATES:
        raise ValueError("运行清单 status 无效")
    return value


def can_advance(current: str, target: str) -> bool:
    if current == target:
        return True
    transitions = {
        "RESOURCE_GRAPH_READY": {"RESOURCE_TRIAL_PROPOSED", "RESOURCE_REUSE_PROPOSED"},
        "RESOURCE_REUSE_PROPOSED": {"RESOURCE_REUSE_CONFIRMED", "RESOURCE_TRIAL_PROPOSED"},
        "RESOURCE_REUSE_CONFIRMED": {"RESOURCE_READY"},
        "RESOURCE_APPLY_PROPOSED": {"RESOURCE_APPLY_APPROVED", "RESOURCE_APPLY_SKIPPED"},
        "RESOURCE_APPLY_APPROVED": {"RESOURCE_APPLIED", "RESOURCE_APPLY_SKIPPED"},
        "RESOURCE_APPLIED": {"RESOURCE_READY"},
        "RESOURCE_APPLY_SKIPPED": {"RESOURCE_READY"},
        "PLATFORM_READY": {
            "PLATFORM_CANDIDATE_BUILT",
            "CHECKER_IN_PROGRESS",
            "READY_FOR_MANUAL_PLATFORM_ACCEPTANCE",
        },
        "CHECKER_IN_PROGRESS": {
            "CHECKER_ACCEPTANCE_RECORDED",
            "CHECKER_REWORK_REQUIRED",
            "CHECKER_OBSERVATION_RETRY",
            "CHECKER_BLOCKED_EXTERNAL",
        },
        "CHECKER_ACCEPTANCE_RECORDED": {"READY_FOR_MANUAL_PLATFORM_ACCEPTANCE"},
        "CHECKER_REWORK_REQUIRED": {"CHECKER_IN_PROGRESS"},
        "CHECKER_OBSERVATION_RETRY": {"CHECKER_IN_PROGRESS", "READY_FOR_MANUAL_PLATFORM_ACCEPTANCE"},
        "CHECKER_BLOCKED_EXTERNAL": {"CHECKER_IN_PROGRESS", "READY_FOR_MANUAL_PLATFORM_ACCEPTANCE"},
    }
    if current in transitions:
        return target in transitions[current]
    if current in {
        "RESOURCE_REUSE_PROPOSED",
        "RESOURCE_REUSE_CONFIRMED",
        "READY_FOR_MANUAL_PLATFORM_ACCEPTANCE",
        "READY_FOR_MANUAL_ACCEPTANCE",
    }:
        return False
    if target in {"RESOURCE_REUSE_PROPOSED", "RESOURCE_REUSE_CONFIRMED"}:
        return False
    return STATES.index(target) == STATES.index(current) + 1


def superseded_history_indices(manifest: dict[str, Any]) -> set[int]:
    result: set[int] = set()
    for item in manifest.get("invalidations", []):
        if not isinstance(item, dict):
            continue
        indices = item.get("supersededHistoryIndices")
        if isinstance(indices, list):
            result.update(index for index in indices if isinstance(index, int) and index >= 0)
    return result


def active_history(manifest: dict[str, Any]) -> list[tuple[int, dict[str, Any]]]:
    superseded = superseded_history_indices(manifest)
    return [
        (index, item)
        for index, item in enumerate(manifest.get("history", []))
        if index not in superseded and isinstance(item, dict)
    ]


def unresolved_invalidation(manifest: dict[str, Any]) -> dict[str, Any] | None:
    for item in reversed(manifest.get("invalidations", [])):
        if isinstance(item, dict) and not item.get("resolvedAt"):
            return item
    return None


def verification(manifest: dict[str, Any]) -> dict[str, Any]:
    errors = []
    valid_states = []
    active = active_history(manifest)
    for _, state_record in active:
        state = state_record.get("state")
        state_errors = []
        if state not in STATES:
            state_errors.append("UNKNOWN_STATE")
        for name, reference in (state_record.get("evidence") or {}).items():
            path = Path(str(reference.get("path", ""))).expanduser().resolve()
            if not path.exists() or sha256_tree(path) != reference.get("sha256"):
                state_errors.append(f"EVIDENCE_DRIFT:{name}")
        if state_errors:
            errors.append({"state": state, "errors": state_errors})
            break
        valid_states.append(state)
    pending = unresolved_invalidation(manifest)
    last_valid = valid_states[-1] if valid_states else None
    if errors:
        failed_state = errors[0].get("state")
        user_conclusion = f"运行记录中的“{USER_CONCLUSIONS.get(failed_state, failed_state)}”证据已失效，请先登记失效并从该步骤重新生成"
        recommended_action = f"运行 invalidate --from-state {failed_state}，说明原因后重新绑定该步骤证据"
    elif pending:
        from_state = pending.get("fromState")
        user_conclusion = f"已保留旧记录；请从“{USER_CONCLUSIONS.get(from_state, from_state)}”重新生成并绑定证据"
        recommended_action = f"运行 rebind --state {from_state} 并提供该步骤要求的全部新证据"
    else:
        user_conclusion = USER_CONCLUSIONS.get(last_valid) if last_valid else "运行清单尚未绑定第一步证据"
        recommended_action = "可以继续下一步" if last_valid else "先为 DISCOVERED 绑定 projectInspection 证据"
    if not errors and not pending and last_valid == "CHECKER_REWORK_REQUIRED":
        user_conclusion = USER_CONCLUSIONS[last_valid]
        recommended_action = "修复受影响平台的真实生成链并完成 final-recheck，再对 Checker 队列运行 supersede；新 SHA 验签后重新进入 CHECKER_IN_PROGRESS"
    elif not errors and not pending and last_valid == "CHECKER_OBSERVATION_RETRY":
        user_conclusion = USER_CONCLUSIONS[last_valid]
        recommended_action = "可以先按本地 ruleset 结果生成交付报告；如继续 Checker，请保持 artifact SHA-256 不变并用新 attempt 重录 observation-v2"
    elif not errors and not pending and last_valid == "CHECKER_BLOCKED_EXTERNAL":
        user_conclusion = USER_CONCLUSIONS[last_valid]
        recommended_action = "可以按本地 ruleset 结果生成交付报告，并把 Checker 不可达或缺页签列为外部补测提醒"
    waiting = manifest.get("waitingFor")
    if not errors and not pending and isinstance(waiting, dict):
        gate = waiting.get("gate")
        label = gate_label(gate)
        user_conclusion = f"{label}已展示，正在等待你的明确确认；当前没有继续执行未授权步骤"
        recommended_action = f"收到用户原话后运行 wait-finish --gate {gate}；该命令不会自动推进下一阶段"
    return {
        "schemaVersion": "playable-package-finalization-run-verification-v1",
        "valid": not errors,
        "runId": manifest.get("runId"),
        "currentState": manifest.get("status"),
        "lastValidState": last_valid,
        "userConclusion": user_conclusion,
        "recommendedAction": recommended_action,
        "pendingRebindState": pending.get("fromState") if pending else None,
        "waitingFor": waiting,
        "errors": errors,
    }


def initialize(args: argparse.Namespace) -> tuple[dict[str, Any], Path]:
    project_root = args.project_root.expanduser().resolve()
    if not project_root.is_dir():
        raise ValueError(f"项目目录不存在：{project_root}")
    run_id = args.run_id or str(uuid.uuid4())
    run_root: Path | None = None
    if args.adapter:
        adapter_report = validate_adapter(project_root, args.adapter.expanduser().resolve())
        boundaries = adapter_report.get("resourceBoundaries") or {}
        if not adapter_report.get("valid") or not boundaries.get("runRoot"):
            raise ValueError("Adapter 的稳定 runRoot 未通过验证")
        product_root_value = boundaries.get("productRoot")
        if not product_root_value:
            raise ValueError("无法识别产品 Git 仓根；新运行不能写入 playable 工程内的隐藏目录")
        canonical_run_root = (Path(product_root_value) / "playable-runs").resolve()
        adapter_run_root = Path(boundaries["runRoot"]).resolve()
        if adapter_run_root != canonical_run_root:
            raise ValueError(
                "新运行目录必须固定为产品仓根/playable-runs；"
                f"当前 Adapter 解析为 {adapter_run_root}，应为 {canonical_run_root}"
            )
        run_root = canonical_run_root / run_id
    manifest_path = args.manifest.expanduser().resolve() if args.manifest else (run_root / "run-manifest.json" if run_root else None)
    if manifest_path is None:
        raise ValueError("未提供 --manifest 时必须提供 v2 --adapter")
    if run_root is not None and manifest_path.parent != run_root:
        raise ValueError("运行清单必须直接位于 Adapter runRoot/<run-id>/")
    if manifest_path.exists():
        raise ValueError(f"运行清单已存在：{manifest_path}")
    manifest = {
        "schemaVersion": SCHEMA,
        "runId": run_id,
        "createdAt": utc_now(),
        "updatedAt": utc_now(),
        "mode": args.mode,
        "projectRoot": str(project_root),
        "runRoot": str(run_root) if run_root else str(manifest_path.parent),
        "status": "DISCOVERED",
        "userConclusion": USER_CONCLUSIONS["DISCOVERED"],
        "history": [],
        "artifacts": [],
        "checks": [],
        "repairs": [],
        "manualGates": [],
        "requirements": {
            "skillUserExperienceEvaluation": bool(args.require_skill_ux_evaluation),
        },
        "executionTimeline": str((manifest_path.parent / "execution-timeline.json").resolve()),
        "waitingFor": None,
        "invalidations": [],
    }
    create_timeline(Path(manifest["executionTimeline"]), run_id, project_root)
    return manifest, manifest_path


GATE_STATES = {
    "gate-a": "RESOURCE_TRIAL_PROPOSED",
    "gate-b": "RESOURCE_APPLY_PROPOSED",
    "resource-reuse": "RESOURCE_REUSE_PROPOSED",
}


def gate_label(gate: str) -> str:
    return {
        "gate-a": "资源优化提案",
        "gate-b": "资源覆盖确认单",
        "resource-reuse": "历史资源候选复用确认单",
    }.get(gate, gate)


def wait_start(args: argparse.Namespace) -> dict[str, Any]:
    manifest_path = args.manifest.expanduser().resolve()
    manifest = load_manifest(manifest_path)
    checked = verification(manifest)
    if not checked["valid"] or unresolved_invalidation(manifest):
        raise ValueError(checked["userConclusion"])
    if manifest.get("waitingFor"):
        raise ValueError("当前已经在等待用户确认，不能重复开始等待")
    expected_state = GATE_STATES[args.gate]
    if manifest.get("status") != expected_state:
        raise ValueError(f"{args.gate} 只能在 {expected_state} 后开始等待")
    timeline_path = Path(str(manifest.get("executionTimeline") or "")).expanduser().resolve()
    event = start_event(
        timeline_path,
        phase="resource-gates",
        operation=f"等待 {args.gate} 用户确认",
        time_class="user-wait",
        event_id=f"{args.gate}-wait-{uuid.uuid4()}",
        attempt_id=(active_history(manifest)[-1][1].get("attemptId") if active_history(manifest) else None),
        concurrency_group="user-authorization",
    )
    started_at = event["startedAt"]
    gate_record = {
        "gate": args.gate,
        "status": "WAITING",
        "startedAt": started_at,
        "finishedAt": None,
        "durationMs": None,
        "timelineEventId": event["eventId"],
        "confirmationText": None,
    }
    try:
        manifest.setdefault("manualGates", []).append(gate_record)
        manifest["waitingFor"] = {
            "gate": args.gate,
            "startedAt": started_at,
            "timelineEventId": event["eventId"],
        }
        label = gate_label(args.gate)
        manifest["userConclusion"] = f"{label}已展示，正在等待你的明确确认；当前没有继续执行未授权步骤"
        manifest["updatedAt"] = utc_now()
        write_json_atomic(manifest_path, manifest)
    except OSError:
        finish_event(timeline_path, event_id=event["eventId"], status="CANCELLED")
        raise
    return manifest


def wait_finish(args: argparse.Namespace) -> dict[str, Any]:
    manifest_path = args.manifest.expanduser().resolve()
    manifest = load_manifest(manifest_path)
    waiting = manifest.get("waitingFor")
    if not isinstance(waiting, dict) or waiting.get("gate") != args.gate:
        raise ValueError(f"当前没有等待 {args.gate} 用户确认")
    confirmation = args.confirmation_text.strip()
    if not confirmation:
        raise ValueError("用户确认原话不能为空；沉默不代表同意")
    timeline_path = Path(str(manifest.get("executionTimeline") or "")).expanduser().resolve()
    event_id = str(waiting.get("timelineEventId") or "")
    matching = [
        item for item in manifest.get("manualGates", [])
        if isinstance(item, dict) and item.get("timelineEventId") == event_id
    ]
    if len(matching) != 1:
        raise ValueError("Gate 等待记录与时间账本不一致")
    timeline = load_timeline(timeline_path)
    timeline_events = [item for item in timeline["events"] if item.get("eventId") == event_id]
    if len(timeline_events) != 1:
        raise ValueError("Gate 等待事件不存在或重复")
    timeline_event = timeline_events[0]
    if timeline_event.get("status") == "RUNNING":
        event = finish_event(timeline_path, event_id=event_id, status="SUCCEEDED")
    elif timeline_event.get("status") == "SUCCEEDED":
        event = timeline_event
    else:
        raise ValueError("Gate 等待事件已失败或取消，必须重新展示确认文档并开始新的等待")
    matching[0].update({
        "status": "CONFIRMED",
        "finishedAt": event["finishedAt"],
        "durationMs": event["durationMs"],
        "confirmationText": confirmation,
    })
    manifest["waitingFor"] = None
    manifest["userConclusion"] = "已收到明确确认并结束等待；仍需由对应批准脚本验签原话后才能推进下一阶段"
    manifest["updatedAt"] = utc_now()
    write_json_atomic(manifest_path, manifest)
    return manifest


def active_state_record(manifest: dict[str, Any], state: str) -> dict[str, Any] | None:
    for _, record in reversed(active_history(manifest)):
        if record.get("state") == state:
            return record
    return None


def validate_state_evidence(target: str, parsed: dict[str, Path], manifest: dict[str, Any]) -> None:
    if target == "RESOURCE_REUSE_PROPOSED":
        confirmation = verified_resource_reuse_confirmation(parsed["resourceReuseConfirmationJson"])
        if confirmation.get("status") != "AWAITING_USER_CONFIRMATION":
            raise ValueError("历史资源候选未通过当前身份和报告验签，不能进入复用确认门禁")
        markdown = parsed["resourceReuseConfirmationMarkdown"].read_text(encoding="utf-8")
        if markdown != render_resource_reuse_markdown(confirmation):
            raise ValueError("历史资源候选复用确认单 Markdown 与 JSON 不一致")
        expected_state = (confirmation.get("historicalRun") or {}).get("resourceState") or {}
        if (
            expected_state.get("path") != str(parsed["historicalResourceState"])
            or expected_state.get("sha256") != sha256_file(parsed["historicalResourceState"])
        ):
            raise ValueError("复用确认单没有绑定同一份历史资源状态")
        return
    if target == "RESOURCE_REUSE_CONFIRMED":
        proposed = active_state_record(manifest, "RESOURCE_REUSE_PROPOSED")
        if proposed is None:
            raise ValueError("缺少 RESOURCE_REUSE_PROPOSED，不能批准复用历史资源")
        approval = verified_resource_reuse_approval(parsed["resourceReuseApproval"])
        if approval.get("status") != "RESOURCE_REUSE_CONFIRMED" or approval.get("authorizesPlatformBuild") is not True:
            raise ValueError("本轮没有明确选择继续复用历史资源候选")
        confirmation_reference = (proposed.get("evidence") or {}).get("resourceReuseConfirmationJson") or {}
        confirmation_path = Path(str(confirmation_reference.get("path") or "")).expanduser().resolve()
        if (
            (approval.get("confirmationJson") or {}).get("path") != str(confirmation_path)
            or (approval.get("confirmationJson") or {}).get("sha256") != confirmation_reference.get("sha256")
        ):
            raise ValueError("资源复用批准没有绑定本轮已展示的同一份确认单")
        return
    if target == "RESOURCE_READY":
        active = active_history(manifest)
        previous_state = active[-1][1].get("state") if active else None
        if previous_state == "RESOURCE_REUSE_CONFIRMED":
            approval_reference = (active[-1][1].get("evidence") or {}).get("resourceReuseApproval") or {}
            approval_path = Path(str(approval_reference.get("path") or "")).expanduser().resolve()
            approval = verified_resource_reuse_approval(approval_path)
            historical_state = approval.get("historicalResourceState") or {}
            if (
                historical_state.get("path") != str(parsed["resourceState"])
                or historical_state.get("sha256") != sha256_file(parsed["resourceState"])
            ):
                raise ValueError("RESOURCE_READY 没有绑定本轮批准复用的同一份历史资源状态")
            historical = load_json(parsed["resourceState"])
            evidence = historical.get("evidence") or {} if isinstance(historical, dict) else {}
            for evidence_name, parsed_name in (
                ("resource_manifest", "resourceManifest"),
                ("optimized_ledger", "optimizedLedger"),
                ("fidelity_report", "fidelityReport"),
            ):
                reference = evidence.get(evidence_name) or {}
                if (
                    reference.get("path") != str(parsed[parsed_name])
                    or reference.get("sha256") != sha256_file(parsed[parsed_name])
                ):
                    raise ValueError(f"复用 RESOURCE_READY 的历史证据不一致：{parsed_name}")
        return
    if target == "CHECKER_IN_PROGRESS":
        queue_path = parsed.get("checkerQueue")
        preflight_path = parsed.get("checkerPreflight")
        if bool(queue_path) == bool(preflight_path):
            raise ValueError("CHECKER_IN_PROGRESS 必须且只能绑定 checkerQueue 或 checkerPreflight")
        if preflight_path:
            preflight = load_json(preflight_path)
            checker_url = str((preflight or {}).get("checkerUrl") or "") if isinstance(preflight, dict) else ""
            checked_preflight = validate_checker_preflight(preflight_path, checker_url, require_available=False)
            if checked_preflight.get("status") != "UNREACHABLE":
                raise ValueError("只允许用 UNREACHABLE preflight 进入无队列的 Checker 外部阻塞分支")
            return
        queue = load_checker_queue(queue_path)
        previous = active_history(manifest)[-1][1] if active_history(manifest) else None
        previous_state = previous.get("state") if previous else None
        previous_outcome = previous.get("checkerOutcome") or {} if previous else {}
        affected = previous_outcome.get("affectedPlatforms") or []
        queue_items = {
            (item.get("platform"), item.get("deliveryKey")): item
            for item in queue.get("items") or []
        }
        if previous_state == "CHECKER_REWORK_REQUIRED":
            for outcome in affected:
                if outcome.get("classification") != "ARTIFACT_REWORK":
                    continue
                key = (outcome.get("platform"), outcome.get("deliveryKey"))
                current_item = queue_items.get(key) or {}
                previous_sha = (outcome.get("artifact") or {}).get("sha256")
                if not current_item or (current_item.get("artifact") or {}).get("sha256") == previous_sha:
                    raise ValueError(f"{key} artifact 返工后必须以新 SHA-256 supersede，不能复用旧包")
                versions = current_item.get("supersededVersions") or []
                if not any((version.get("artifact") or {}).get("sha256") == previous_sha for version in versions if isinstance(version, dict)):
                    raise ValueError(f"{key} Checker 队列没有保留旧 artifact/attempt 的 supersede 审计")
        elif previous_state == "CHECKER_OBSERVATION_RETRY":
            for outcome in affected:
                if outcome.get("classification") != "OBSERVATION_RETRY":
                    continue
                key = (outcome.get("platform"), outcome.get("deliveryKey"))
                current_item = queue_items.get(key) or {}
                if (current_item.get("artifact") or {}).get("sha256") != (outcome.get("artifact") or {}).get("sha256"):
                    raise ValueError(f"{key} 观察重录必须保持 artifact SHA-256 不变")
                current_attempt = current_item.get("currentAttempt") or {}
                if not current_attempt.get("attemptId") or current_attempt.get("attemptId") == outcome.get("attemptId"):
                    raise ValueError(f"{key} 观察重录必须创建不同的新 attempt")
        return
    if target in {
        "CHECKER_ACCEPTANCE_RECORDED",
        "CHECKER_REWORK_REQUIRED",
        "CHECKER_OBSERVATION_RETRY",
        "CHECKER_BLOCKED_EXTERNAL",
    }:
        acceptance = load_checker_acceptance(parsed["checkerAcceptanceJson"])
        markdown = parsed["checkerAcceptanceMarkdown"].read_text(encoding="utf-8")
        if markdown != render_checker_markdown(acceptance):
            raise ValueError("Checker 中文报告与验签 JSON 不一致")
        return
    if target != "READY_FOR_MANUAL_PLATFORM_ACCEPTANCE":
        return
    delivery = load_json(parsed["deliveryReportJson"])
    if not isinstance(delivery, dict) or delivery.get("schemaVersion") not in {
        "playable-delivery-report-v1", "playable-delivery-report-v2",
    }:
        raise ValueError("交付报告 JSON schemaVersion 无效")
    if delivery.get("status") != "READY_FOR_MANUAL_PLATFORM_ACCEPTANCE":
        raise ValueError("交付报告尚未达到待真实平台人工验收状态")
    if delivery.get("localValidationPassed") is not True:
        raise ValueError("交付报告没有证明全部候选清单通过本地 ruleset 验签")
    candidates = delivery.get("candidates") or []
    if not isinstance(candidates, list) or not candidates:
        raise ValueError("交付报告没有绑定本轮候选清单")
    for index, candidate in enumerate(candidates):
        if not isinstance(candidate, dict) or candidate.get("status") not in {
            "BASELINE_READY", "PLATFORM_READY", "FINAL_RECHECK_READY",
        }:
            raise ValueError(f"交付报告候选清单状态无效：candidates[{index}]")
        candidate_path = Path(str(candidate.get("manifestPath") or "")).expanduser().resolve()
        if (
            not candidate_path.is_file()
            or candidate.get("manifestSha256") != sha256_file(candidate_path)
        ):
            raise ValueError(f"交付报告候选清单已漂移：candidates[{index}]")

    external_validations = delivery.get("externalValidations") or {}
    checker_external = external_validations.get("checker") if isinstance(external_validations, dict) else None
    if not isinstance(checker_external, dict):
        # 兼容第 19.14 节生成的旧 PASS 报告；旧报告保持只读，不改写历史结论。
        legacy_checker_ref = delivery.get("checkerAcceptance") or {}
        checker_external = {
            "status": "PASS" if legacy_checker_ref else "NOT_RUN",
            "acceptance": legacy_checker_ref or None,
        }
    checker_status = checker_external.get("status")
    if checker_status not in {"NOT_RUN", "PENDING", "PASS", "ISSUES_FOUND", "UNAVAILABLE"}:
        raise ValueError("交付报告 externalValidations.checker.status 无效")
    if checker_status == "ISSUES_FOUND":
        raise ValueError("Checker 可信观察已发现当前 artifact 的真实缺陷，完成返工前不能进入人工验收")
    active = active_history(manifest)
    source_state = active[-1][1].get("state") if active else None
    expected_checker_status = {
        "CHECKER_ACCEPTANCE_RECORDED": "PASS",
        "CHECKER_OBSERVATION_RETRY": "PENDING",
        "CHECKER_BLOCKED_EXTERNAL": "UNAVAILABLE",
    }.get(source_state)
    if expected_checker_status and checker_status != expected_checker_status:
        raise ValueError(
            f"运行清单 {source_state} 已记录 Checker 事实，交付报告必须保持 "
            f"{expected_checker_status}，不能降级或遗漏为 {checker_status}"
        )

    acceptance_reference = checker_external.get("acceptance") or delivery.get("checkerAcceptance") or {}
    if acceptance_reference:
        checker_path = Path(str(acceptance_reference.get("path") or "")).expanduser().resolve()
        if (
            not checker_path.is_file()
            or acceptance_reference.get("sha256") != sha256_file(checker_path)
        ):
            raise ValueError("交付报告绑定的 Checker acceptance 已漂移")
        acceptance = load_checker_acceptance(checker_path)
        conclusion = str((acceptance.get("summary") or {}).get("conclusion") or "")
        expected_status = {
            "PASS": "PASS",
            "REWORK_REQUIRED": "ISSUES_FOUND",
            "OBSERVATION_RETRY": "PENDING",
            "INCOMPLETE": "PENDING",
            "BLOCKED_EXTERNAL": "UNAVAILABLE",
        }.get(conclusion)
        if expected_status != checker_status:
            raise ValueError("交付报告的 Checker 外部验证状态与 acceptance 结论不一致")
        if expected_status == "ISSUES_FOUND":
            raise ValueError("Checker 可信观察已发现当前 artifact 的真实缺陷，完成返工前不能进入人工验收")

    preflight_reference = checker_external.get("preflight") or {}
    if preflight_reference:
        preflight_path = Path(str(preflight_reference.get("path") or "")).expanduser().resolve()
        if (
            not preflight_path.is_file()
            or preflight_reference.get("sha256") != sha256_file(preflight_path)
        ):
            raise ValueError("交付报告绑定的 Checker preflight 已漂移")
        preflight = load_json(preflight_path)
        checker_url = str((preflight or {}).get("checkerUrl") or "") if isinstance(preflight, dict) else ""
        checked_preflight = validate_checker_preflight(preflight_path, checker_url, require_available=False)
        if checked_preflight.get("status") == "UNREACHABLE" and checker_status != "UNAVAILABLE":
            raise ValueError("Checker 不可达 preflight 必须记录为 UNAVAILABLE")
    markdown = parsed["deliveryReportMarkdown"].read_text(encoding="utf-8")
    if markdown != render_delivery_user_markdown(delivery):
        raise ValueError("用户交付摘要与验签 JSON 不一致")
    audit_markdown = parsed["deliveryAuditMarkdown"].read_text(encoding="utf-8")
    if audit_markdown != render_delivery_audit_markdown(delivery):
        raise ValueError("内部交付审计报告与验签 JSON 不一致")
    requires_skill_ux = (manifest.get("requirements") or {}).get("skillUserExperienceEvaluation") is True
    if requires_skill_ux:
        ux_path = parsed.get("skillUserExperienceEvaluation")
        if ux_path is None:
            raise ValueError("本轮要求普通用户体验复验，缺少 skillUserExperienceEvaluation 证据")
        ux_text = ux_path.read_text(encoding="utf-8")
        for heading in ("## 结论", "## 已通过的体验", "## 可读性与误导问题", "## 无必要暂停", "## Skill 缺陷"):
            if heading not in ux_text:
                raise ValueError(f"Skill 用户体验复验缺少章节：{heading}")
        delivery_ux = delivery.get("skillUserExperienceEvaluation") or {}
        if delivery_ux.get("path") != str(ux_path) or delivery_ux.get("sha256") != sha256_file(ux_path):
            raise ValueError("交付报告未绑定同一份 Skill 用户体验复验")


def advance(args: argparse.Namespace) -> dict[str, Any]:
    manifest_path = args.manifest.expanduser().resolve()
    manifest = load_manifest(manifest_path)
    checked = verification(manifest)
    if not checked["valid"]:
        raise ValueError(checked["userConclusion"])
    if unresolved_invalidation(manifest):
        raise ValueError(checked["userConclusion"])
    target = args.state
    if target in {
        "CHECKER_ACCEPTANCE_RECORDED",
        "CHECKER_REWORK_REQUIRED",
        "CHECKER_OBSERVATION_RETRY",
        "CHECKER_BLOCKED_EXTERNAL",
    }:
        raise ValueError("Checker 结论状态只能由 record-checker-outcome 根据验签证据自动分类，不能由调用方手工选择")
    if target == "READY_FOR_MANUAL_ACCEPTANCE":
        raise ValueError("READY_FOR_MANUAL_ACCEPTANCE 已废止；新运行必须使用 READY_FOR_MANUAL_PLATFORM_ACCEPTANCE")
    active = active_history(manifest)
    if active:
        current = active[-1][1]["state"]
        if not can_advance(current, target):
            raise ValueError(f"不能从 {current} 跳到 {target}")
    elif target != "DISCOVERED":
        raise ValueError("新运行必须先绑定 DISCOVERED 证据")
    parsed = evidence_values(args.evidence)
    missing = REQUIRED_EVIDENCE[target] - set(parsed)
    if missing:
        raise ValueError(f"{target} 缺少证据：{', '.join(sorted(missing))}")
    validate_state_evidence(target, parsed, manifest)
    record = {
        "attemptId": str(uuid.uuid4()),
        "state": target,
        "recordedAt": utc_now(),
        "userConclusion": USER_CONCLUSIONS[target],
        "evidence": {name: evidence_ref(path) for name, path in sorted(parsed.items())},
    }
    if args.note:
        record["note"] = args.note
    manifest["history"].append(record)
    manifest["status"] = target
    manifest["userConclusion"] = USER_CONCLUSIONS[target]
    manifest["updatedAt"] = utc_now()
    write_json_atomic(manifest_path, manifest)
    return manifest


def record_checker_outcome(args: argparse.Namespace) -> dict[str, Any]:
    manifest_path = args.manifest.expanduser().resolve()
    manifest = load_manifest(manifest_path)
    checked = verification(manifest)
    if not checked["valid"] or unresolved_invalidation(manifest):
        raise ValueError(checked["userConclusion"])
    active = active_history(manifest)
    current = active[-1][1].get("state") if active else None
    if current != "CHECKER_IN_PROGRESS":
        raise ValueError("只有 CHECKER_IN_PROGRESS 可以记录 Checker 机器分类结论")
    preflight_argument = getattr(args, "preflight", None)
    acceptance_argument = getattr(args, "checker_acceptance", None)
    markdown_argument = getattr(args, "checker_markdown", None)
    if preflight_argument:
        if acceptance_argument or markdown_argument:
            raise ValueError("--preflight 外部阻塞分支不能同时提供 acceptance")
        preflight_path = preflight_argument.expanduser().resolve()
        preflight = load_json(preflight_path)
        checker_url = str((preflight or {}).get("checkerUrl") or "") if isinstance(preflight, dict) else ""
        checked_preflight = validate_checker_preflight(preflight_path, checker_url, require_available=False)
        if checked_preflight.get("status") != "UNREACHABLE":
            raise ValueError("--preflight 只接受状态 UNREACHABLE 的 Checker 外部阻塞证据")
        acceptance = None
        conclusion = "BLOCKED_EXTERNAL"
        parsed = {"checkerPreflight": preflight_path}
    else:
        if not acceptance_argument or not markdown_argument:
            raise ValueError("非 preflight 分支必须同时提供 --checker-acceptance 与 --checker-markdown")
        acceptance_path = acceptance_argument.expanduser().resolve()
        markdown_path = markdown_argument.expanduser().resolve()
        acceptance = load_checker_acceptance(acceptance_path)
        if markdown_path.read_text(encoding="utf-8") != render_checker_markdown(acceptance):
            raise ValueError("Checker 中文报告与验签 JSON 不一致")
        conclusion = str((acceptance.get("summary") or {}).get("conclusion") or "")
        parsed = {
            "checkerAcceptanceJson": acceptance_path,
            "checkerAcceptanceMarkdown": markdown_path,
        }
    target = {
        "PASS": "CHECKER_ACCEPTANCE_RECORDED",
        "REWORK_REQUIRED": "CHECKER_REWORK_REQUIRED",
        "OBSERVATION_RETRY": "CHECKER_OBSERVATION_RETRY",
        "INCOMPLETE": "CHECKER_OBSERVATION_RETRY",
        "BLOCKED_EXTERNAL": "CHECKER_BLOCKED_EXTERNAL",
    }.get(conclusion)
    if target is None:
        raise ValueError(f"Checker 总体结论无法分类：{conclusion}")
    if not can_advance(str(current), target):
        raise ValueError(f"不能从 {current} 自动写入 {target}")
    affected = []
    for entry in (acceptance or {}).get("platforms") or []:
        if entry.get("classification") == "PASS":
            continue
        affected.append({
            "platform": entry.get("platform"),
            "deliveryKey": entry.get("deliveryKey"),
            "classification": entry.get("classification"),
            "conclusion": entry.get("conclusion"),
            "artifact": entry.get("artifact"),
            "attemptId": entry.get("attemptId"),
            "observationSha256": entry.get("observationSha256"),
            "evidenceSha256": [
                item.get("sha256") for item in entry.get("evidence") or [] if isinstance(item, dict)
            ],
        })
    next_action = {
        "CHECKER_ACCEPTANCE_RECORDED": "生成并验签最终交付报告，再进入 READY_FOR_MANUAL_PLATFORM_ACCEPTANCE",
        "CHECKER_REWORK_REQUIRED": "立即修复受影响平台真实生成链、重建并 final-recheck；用 queue supersede 新 SHA 后继续 Checker",
        "CHECKER_OBSERVATION_RETRY": "保留本地 final-recheck；可先生成交付报告，后续保持 artifact SHA 不变并用新 attempt 补录 observation-v2",
        "CHECKER_BLOCKED_EXTERNAL": "保留本地 final-recheck并生成交付提醒；待 Checker 或目标页签恢复后补做外部验证",
    }[target]
    if acceptance is None:
        affected.append({
            "platform": "checker-service",
            "deliveryKey": None,
            "classification": "EXTERNAL_CHECKER_BLOCK",
            "conclusion": "UNAVAILABLE",
            "artifact": None,
            "attemptId": None,
            "reason": checked_preflight.get("reason"),
            "evidenceSha256": [
                item.get("sha256") for item in checked_preflight.get("evidence") or [] if isinstance(item, dict)
            ],
        })
    record = {
        "attemptId": str(uuid.uuid4()),
        "state": target,
        "recordedAt": utc_now(),
        "userConclusion": USER_CONCLUSIONS[target],
        "evidence": {name: evidence_ref(path) for name, path in sorted(parsed.items())},
        "checkerOutcome": {
            "sourceConclusion": conclusion,
            "affectedPlatforms": affected,
            "continuationRequired": target == "CHECKER_REWORK_REQUIRED",
            "blocksLocalReady": target == "CHECKER_REWORK_REQUIRED",
            "nextAction": next_action,
            "invalidatedScopes": (
                ["affected candidate", "affected final-recheck", "affected Checker attempt", "delivery eligibility"]
                if target == "CHECKER_REWORK_REQUIRED" else
                ["affected Checker attempt"] if target == "CHECKER_OBSERVATION_RETRY" else []
            ),
        },
    }
    manifest["history"].append(record)
    manifest["status"] = target
    manifest["userConclusion"] = USER_CONCLUSIONS[target]
    manifest["updatedAt"] = utc_now()
    write_json_atomic(manifest_path, manifest)
    return manifest


def invalidate(args: argparse.Namespace) -> dict[str, Any]:
    manifest_path = args.manifest.expanduser().resolve()
    manifest = load_manifest(manifest_path)
    if unresolved_invalidation(manifest):
        raise ValueError("当前已有待重新绑定的失效记录，请先完成 rebind")
    active = active_history(manifest)
    matching = [(index, item) for index, item in active if item.get("state") == args.from_state]
    if not matching:
        raise ValueError(f"当前有效历史中没有阶段 {args.from_state}")
    start_index = matching[-1][0]
    superseded = [index for index, _ in active if index >= start_index]
    previous = [item for index, item in active if index < start_index]
    replacement = evidence_values(args.replacement_evidence)
    invalidation = {
        "invalidationId": str(uuid.uuid4()),
        "fromState": args.from_state,
        "detectedAt": utc_now(),
        "reason": args.reason.strip(),
        "supersededHistoryIndices": superseded,
        "previousStatus": manifest.get("status"),
        "resumeFromState": previous[-1].get("state") if previous else None,
        "replacementEvidence": {name: evidence_ref(path) for name, path in sorted(replacement.items())},
    }
    if not invalidation["reason"]:
        raise ValueError("失效原因不能为空")
    manifest.setdefault("invalidations", []).append(invalidation)
    manifest["status"] = invalidation["resumeFromState"] or "DISCOVERED"
    manifest["userConclusion"] = (
        f"已保留旧记录；请从“{USER_CONCLUSIONS[args.from_state]}”重新生成并绑定证据"
    )
    manifest["updatedAt"] = utc_now()
    write_json_atomic(manifest_path, manifest)
    return manifest


def rebind(args: argparse.Namespace) -> dict[str, Any]:
    manifest_path = args.manifest.expanduser().resolve()
    manifest = load_manifest(manifest_path)
    pending = unresolved_invalidation(manifest)
    if not pending:
        raise ValueError("当前没有待重新绑定的失效阶段")
    if args.state != pending.get("fromState"):
        raise ValueError(f"必须先重新绑定 {pending.get('fromState')}，不能绑定 {args.state}")
    checked = verification(manifest)
    if not checked["valid"]:
        raise ValueError(checked["userConclusion"])
    parsed = evidence_values(args.evidence)
    missing = REQUIRED_EVIDENCE[args.state] - set(parsed)
    if missing:
        raise ValueError(f"{args.state} 缺少证据：{', '.join(sorted(missing))}")
    validate_state_evidence(args.state, parsed, manifest)
    active = active_history(manifest)
    current = active[-1][1]["state"] if active else None
    if current is not None and not can_advance(current, args.state):
        raise ValueError(f"不能从最后有效阶段 {current} 重新绑定 {args.state}")
    if current is None and args.state != "DISCOVERED":
        raise ValueError("没有有效历史时只能重新绑定 DISCOVERED")
    attempt_id = str(uuid.uuid4())
    record = {
        "attemptId": attempt_id,
        "rebindsInvalidationId": pending["invalidationId"],
        "state": args.state,
        "recordedAt": utc_now(),
        "userConclusion": USER_CONCLUSIONS[args.state],
        "evidence": {name: evidence_ref(path) for name, path in sorted(parsed.items())},
    }
    if args.note:
        record["note"] = args.note
    manifest["history"].append(record)
    pending["resolvedAt"] = utc_now()
    pending["replacementAttemptId"] = attempt_id
    manifest["status"] = args.state
    manifest["userConclusion"] = USER_CONCLUSIONS[args.state]
    manifest["updatedAt"] = utc_now()
    write_json_atomic(manifest_path, manifest)
    return manifest


def main() -> int:
    args = parser().parse_args()
    try:
        if args.command == "init":
            manifest, manifest_path = initialize(args)
            write_json_atomic(manifest_path, manifest)
            result = {
                "ok": True,
                "status": manifest["status"],
                "userConclusion": manifest["userConclusion"],
                "runRoot": manifest["runRoot"],
                "manifest": str(manifest_path),
            }
        elif args.command == "advance":
            manifest = advance(args)
            result = {"ok": True, "status": manifest["status"], "userConclusion": manifest["userConclusion"], "manifest": str(args.manifest.resolve())}
        elif args.command == "invalidate":
            manifest = invalidate(args)
            result = {
                "ok": True,
                "status": manifest["status"],
                "userConclusion": manifest["userConclusion"],
                "manifest": str(args.manifest.resolve()),
            }
        elif args.command == "rebind":
            manifest = rebind(args)
            result = {"ok": True, "status": manifest["status"], "userConclusion": manifest["userConclusion"], "manifest": str(args.manifest.resolve())}
        elif args.command == "wait-start":
            manifest = wait_start(args)
            result = {
                "ok": True,
                "status": manifest["status"],
                "waitingFor": manifest["waitingFor"],
                "userConclusion": manifest["userConclusion"],
                "manifest": str(args.manifest.resolve()),
            }
        elif args.command == "wait-finish":
            manifest = wait_finish(args)
            result = {
                "ok": True,
                "status": manifest["status"],
                "waitingFor": None,
                "userConclusion": manifest["userConclusion"],
                "manifest": str(args.manifest.resolve()),
            }
        elif args.command == "record-checker-outcome":
            manifest = record_checker_outcome(args)
            outcome = manifest["history"][-1].get("checkerOutcome") or {}
            result = {
                "ok": manifest["status"] == "CHECKER_ACCEPTANCE_RECORDED",
                "status": manifest["status"],
                "userConclusion": manifest["userConclusion"],
                "continuationRequired": outcome.get("continuationRequired"),
                "nextAction": outcome.get("nextAction"),
                "manifest": str(args.manifest.resolve()),
            }
        else:
            manifest = load_manifest(args.manifest.expanduser().resolve())
            result = verification(manifest)
    except (OSError, ValueError, json.JSONDecodeError, TimelineError) as exc:
        print(json.dumps({"ok": False, "error": str(exc)}, ensure_ascii=False, indent=2))
        return 1
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0 if result.get("valid", True) else 1


if __name__ == "__main__":
    raise SystemExit(main())
