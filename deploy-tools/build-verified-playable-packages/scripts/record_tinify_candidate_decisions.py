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

from record_resource_approval import verified_plan
from resource_common import load_json, sha256_file, sha256_object, utc_now, write_json_atomic


SUCCESS_STATUSES = {"SUCCESS", "REUSED_SUCCESS_RECEIPT"}
DECISIONS = {
    "accepted": "ELIGIBLE_FOR_GATE_B",
    "rejected": "CANDIDATE_REJECTED",
    "paused": "CANDIDATE_PAUSED",
}


def parse_assignment(value: str, *, label: str) -> tuple[str, str]:
    action_id, separator, assigned = value.partition("=")
    if not separator or not action_id.strip() or not assigned.strip():
        raise ValueError(f"{label} 必须使用 actionId=value 格式")
    return action_id.strip(), assigned.strip()


def file_ref(path: Path) -> dict[str, Any]:
    resolved = path.expanduser().resolve()
    if not resolved.is_file():
        raise ValueError(f"证据文件不存在：{resolved}")
    return {"path": str(resolved), "sha256": sha256_file(resolved)}


def verified_fidelity(path: Path, source_sha: str, candidate_sha: str, action_id: str) -> dict[str, Any]:
    resolved = path.expanduser().resolve()
    report = load_json(resolved)
    if not isinstance(report, dict) or report.get("schemaVersion") != "playable-resource-automatic-fidelity-v1":
        raise ValueError(f"自动保真报告无效：{action_id}")
    before = report.get("before") or {}
    after = report.get("after") or {}
    if before.get("sha256") != source_sha or after.get("sha256") != candidate_sha:
        raise ValueError(f"自动保真报告与 Tinify receipt 不一致：{action_id}")
    return {"report": report, "reference": file_ref(resolved)}


def build_decisions(
    *, plan_path: Path, batch_path: Path, change_records_path: Path, review_path: Path,
    decision_values: list[str], fidelity_values: list[str], confirmation_text: str,
    quota_resolution: str | None = None, local_fallback_proposal: Path | None = None,
) -> dict[str, Any]:
    plan_path = plan_path.expanduser().resolve()
    batch_path = batch_path.expanduser().resolve()
    change_records_path = change_records_path.expanduser().resolve()
    review_path = review_path.expanduser().resolve()
    plan = verified_plan(plan_path)
    batch = load_json(batch_path)
    changes = load_json(change_records_path)
    if not isinstance(batch, dict) or batch.get("schemaVersion") != "playable-tinify-batch-report-v1":
        raise ValueError("Tinify 批处理报告无效")
    if not isinstance(changes, dict) or changes.get("schemaVersion") != "playable-resource-change-records-v1":
        raise ValueError("Tinify 逐图决策必须绑定 change records")
    if not review_path.is_file() or review_path.suffix.lower() != ".html":
        raise ValueError("Tinify 逐图决策必须绑定统一 A/B HTML 审阅页")
    if not str(confirmation_text or "").strip():
        raise ValueError("Tinify 逐图决策必须记录本次审阅结论原话")

    plan_by_id = {
        item.get("actionId"): item for item in plan.get("items") or []
        if isinstance(item, dict) and item.get("action") == "TINIFY_SHRINK"
    }
    batch_items = [item for item in batch.get("items") or [] if isinstance(item, dict)]
    batch_by_id = {item.get("actionId"): item for item in batch_items}
    if set(batch_by_id) != set(plan_by_id):
        raise ValueError("Tinify 批处理报告与当前计划 action IDs 不一致")
    change_by_id = {
        item.get("actionId"): item for item in changes.get("actions") or []
        if isinstance(item, dict) and item.get("operation") == "REPLACE"
    }

    requested = dict(parse_assignment(value, label="--decision") for value in decision_values)
    fidelity_paths = {
        action_id: Path(value) for action_id, value in (
            parse_assignment(item, label="--fidelity-report") for item in fidelity_values
        )
    }
    successful_ids = [item.get("actionId") for item in batch_items if item.get("status") in SUCCESS_STATUSES]
    if set(requested) != set(successful_ids) or set(fidelity_paths) != set(successful_ids):
        raise ValueError("每个 Tinify 成功候选都必须有且仅有一个逐图决策和自动保真报告")

    decisions = []
    for action_id in successful_ids:
        raw_decision = requested[action_id].lower()
        if raw_decision not in DECISIONS:
            raise ValueError(f"Tinify 逐图决策无效：{action_id}={raw_decision}")
        batch_item = batch_by_id[action_id]
        receipt = batch_item.get("receipt") or {}
        source_sha = receipt.get("sourceSha256")
        candidate_sha = receipt.get("candidateSha256")
        if not isinstance(source_sha, str) or not isinstance(candidate_sha, str):
            raise ValueError(f"Tinify receipt 缺少 source/candidate SHA：{action_id}")
        fidelity = verified_fidelity(fidelity_paths[action_id], source_sha, candidate_sha, action_id)
        change = change_by_id.get(action_id)
        if not isinstance(change, dict):
            raise ValueError(f"Tinify 成功候选缺少 A/B change record：{action_id}")
        if change.get("beforeSha256") != source_sha or change.get("candidateSha256") != candidate_sha:
            raise ValueError(f"Tinify A/B change record 与 receipt 不一致：{action_id}")
        views = (change.get("abReview") or {}).get("views")
        required_views = {"side-by-side", "overlay", "blink", "difference", "actual-display-size"}
        if not isinstance(views, list) or not required_views <= set(views):
            raise ValueError(f"Tinify 逐图 A/B 视图不完整：{action_id}")
        status = DECISIONS[raw_decision]
        if status == "ELIGIBLE_FOR_GATE_B" and fidelity["report"].get("conclusion") != "PASS":
            raise ValueError(f"自动保真未通过的 Tinify 候选不能接受：{action_id}")
        decisions.append({
            "actionId": action_id,
            "path": plan_by_id[action_id].get("path"),
            "status": status,
            "sourceSha256": source_sha,
            "candidateSha256": candidate_sha,
            "automaticFidelity": fidelity["reference"],
            "fidelityConclusion": fidelity["report"].get("conclusion"),
            "abReviewViews": views,
        })

    quota_items = [item for item in batch_items if item.get("status") == "NOT_TESTED_QUOTA"]
    fallback_ref = None
    quota_status = "NOT_APPLICABLE"
    if quota_items:
        if quota_resolution not in {"keep-original", "local-fallback"}:
            raise ValueError("额度不足后必须明确选择 keep-original 或 local-fallback")
        if quota_resolution == "keep-original":
            quota_status = "REMAINING_KEEP_ORIGINAL"
            if local_fallback_proposal is not None:
                raise ValueError("keep-original 不得绑定本地备用提案")
        else:
            quota_status = "LOCAL_FALLBACK_GATE_A_REQUIRED"
            if local_fallback_proposal is None:
                raise ValueError("local-fallback 必须绑定待重新 Gate A 的本地备用提案")
            fallback = load_json(local_fallback_proposal.expanduser().resolve())
            expected = {item.get("actionId") for item in quota_items}
            actual = {item.get("tinifySourceActionId") for item in (fallback or {}).get("actions") or [] if isinstance(item, dict)}
            if not isinstance(fallback, dict) or (fallback.get("scope") or {}).get("requiresNewGateA") is not True or actual != expected:
                raise ValueError("本地备用提案未精确覆盖额度未测试项，或未要求重新 Gate A")
            fallback_ref = file_ref(local_fallback_proposal)
    elif quota_resolution is not None or local_fallback_proposal is not None:
        raise ValueError("Tinify 未发生额度不足，不得记录额度备用决策")

    core = {
        "schemaVersion": "playable-tinify-candidate-decisions-v1",
        "provider": "tinify",
        "operation": "shrink",
        "optimizationPlanHash": plan.get("optimizationPlanHash"),
        "plan": file_ref(plan_path),
        "batchReport": file_ref(batch_path),
        "changeRecords": file_ref(change_records_path),
        "fidelityReview": file_ref(review_path),
        "confirmationText": confirmation_text.strip(),
        "decisions": decisions,
        "quotaResolution": {
            "status": quota_status,
            "actionIds": [item.get("actionId") for item in quota_items],
            "localFallbackProposal": fallback_ref,
        },
        "summary": {
            "eligibleActionIds": [item["actionId"] for item in decisions if item["status"] == "ELIGIBLE_FOR_GATE_B"],
            "rejectedActionIds": [item["actionId"] for item in decisions if item["status"] == "CANDIDATE_REJECTED"],
            "pausedActionIds": [item["actionId"] for item in decisions if item["status"] == "CANDIDATE_PAUSED"],
            "notTestedQuotaActionIds": [item.get("actionId") for item in quota_items],
        },
    }
    result = dict(core)
    result["generatedAt"] = utc_now()
    result["decisionHash"] = "sha256:" + sha256_object(core)
    return result


def main() -> int:
    parser = argparse.ArgumentParser(description="记录 Tinify 成功候选的逐图接受、淘汰或暂停结论")
    parser.add_argument("--plan-json", required=True, type=Path)
    parser.add_argument("--tinify-report", required=True, type=Path)
    parser.add_argument("--change-records", required=True, type=Path)
    parser.add_argument("--fidelity-review", required=True, type=Path)
    parser.add_argument("--decision", action="append", default=[], help="actionId=accepted|rejected|paused")
    parser.add_argument("--fidelity-report", action="append", default=[], help="actionId=/absolute/report.json")
    parser.add_argument("--confirmation-text", required=True)
    parser.add_argument("--quota-resolution", choices=("keep-original", "local-fallback"))
    parser.add_argument("--local-fallback-proposal", type=Path)
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()
    try:
        result = build_decisions(
            plan_path=args.plan_json, batch_path=args.tinify_report,
            change_records_path=args.change_records, review_path=args.fidelity_review,
            decision_values=args.decision, fidelity_values=args.fidelity_report,
            confirmation_text=args.confirmation_text, quota_resolution=args.quota_resolution,
            local_fallback_proposal=args.local_fallback_proposal,
        )
        write_json_atomic(args.output, result)
    except (OSError, ValueError, json.JSONDecodeError) as exc:
        print(json.dumps({"ok": False, "error": str(exc)}, ensure_ascii=False, indent=2))
        return 1
    print(json.dumps({
        "ok": not result["summary"]["pausedActionIds"] and result["quotaResolution"]["status"] != "LOCAL_FALLBACK_GATE_A_REQUIRED",
        "eligible": result["summary"]["eligibleActionIds"],
        "rejected": result["summary"]["rejectedActionIds"],
        "paused": result["summary"]["pausedActionIds"],
        "quotaResolution": result["quotaResolution"]["status"],
        "output": str(args.output.expanduser().resolve()),
    }, ensure_ascii=False, indent=2))
    return 2 if result["summary"]["pausedActionIds"] or result["quotaResolution"]["status"] == "LOCAL_FALLBACK_GATE_A_REQUIRED" else 0


if __name__ == "__main__":
    raise SystemExit(main())
