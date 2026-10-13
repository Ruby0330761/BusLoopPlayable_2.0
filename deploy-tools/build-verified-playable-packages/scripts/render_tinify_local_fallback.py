#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

LIB_ROOT = Path(__file__).resolve().parent / "lib"
sys.path.insert(0, str(LIB_ROOT))

from resource_common import load_json, sha256_file, sha256_object, utc_now, write_json_atomic


def build_local_fallback_actions(
    plan: dict[str, Any], report: dict[str, Any], confirmation_text: str,
) -> dict[str, Any]:
    confirmation = confirmation_text.strip()
    if not confirmation:
        raise ValueError("切换本地备用方案必须绑定用户确认原话")
    if (
        report.get("schemaVersion") != "playable-tinify-batch-report-v1"
        or report.get("status") != "QUOTA_EXHAUSTED"
        or report.get("localFallbackDecisionRequired") is not True
    ):
        raise ValueError("只有 Tinify 明确额度不足时才能生成本地备用提案")
    remaining = report.get("remainingActionIds")
    if not isinstance(remaining, list) or not remaining:
        raise ValueError("Tinify 额度不足报告没有剩余未测试项")
    statuses = {
        item.get("actionId"): item.get("status")
        for item in report.get("items") or [] if isinstance(item, dict)
    }
    by_id = {
        item.get("actionId"): item
        for item in plan.get("items") or [] if isinstance(item, dict)
    }
    actions = []
    for action_id in remaining:
        if statuses.get(action_id) != "NOT_TESTED_QUOTA":
            raise ValueError(f"本地备用范围包含非 NOT_TESTED_QUOTA 项：{action_id}")
        planned = by_id.get(action_id)
        if not isinstance(planned, dict) or planned.get("action") != "TINIFY_SHRINK":
            raise ValueError(f"剩余项没有绑定 Tinify Gate A 动作：{action_id}")
        candidates = [
            item for item in planned.get("localFallbackCandidates") or []
            if isinstance(item, dict) and item.get("action") in {"RESIZE", "REENCODE"}
            and item.get("executable") is True
        ]
        if not candidates:
            raise ValueError(f"剩余项没有已审计且可执行的本地图片候选：{action_id}")
        selected = candidates[0]
        actions.append({
            "path": planned.get("path"),
            "action": selected["action"],
            "requiredCapability": selected.get("requiredCapability"),
            "parameters": selected.get("parameters") or {},
            "provider": "local",
            "tinifySourceActionId": action_id,
            "risk": "Tinify 额度不足后的用户明确本地备用；参数仍需重新确认",
            "validation": "重新执行本地自动保真、逐图 A/B、exact artifact 消费和 Gate B",
        })
    core = {
        "schemaVersion": "playable-resource-plan-actions-v1",
        "scope": {
            "reason": "TINIFY_QUOTA_EXHAUSTED",
            "requiresNewGateA": True,
            "onlyRemainingNotTestedQuota": True,
            "sourceOptimizationPlanHash": plan.get("optimizationPlanHash"),
            "confirmationText": confirmation,
        },
        "actions": actions,
    }
    value = dict(core)
    value["generatedAt"] = utc_now()
    value["fallbackPlanHash"] = "sha256:" + sha256_object(core)
    return value


def main() -> int:
    parser = argparse.ArgumentParser(description="为 Tinify 额度不足的剩余图片生成需重新确认的本地备用动作")
    parser.add_argument("--plan-json", required=True, type=Path)
    parser.add_argument("--tinify-report", required=True, type=Path)
    parser.add_argument("--confirmation-text", required=True)
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()
    try:
        plan_path = args.plan_json.expanduser().resolve()
        report_path = args.tinify_report.expanduser().resolve()
        plan = load_json(plan_path)
        report = load_json(report_path)
        if not isinstance(plan, dict) or plan.get("schemaVersion") != "playable-resource-optimization-plan-v1":
            raise ValueError("资源优化计划无效")
        core = {key: value for key, value in plan.items() if key not in {"generatedAt", "optimizationPlanHash"}}
        if plan.get("optimizationPlanHash") != "sha256:" + sha256_object(core):
            raise ValueError("资源优化计划哈希无效")
        if not isinstance(report, dict):
            raise ValueError("Tinify 批处理报告无效")
        value = build_local_fallback_actions(plan, report, args.confirmation_text)
        value["inputs"] = {
            "plan": {"path": str(plan_path), "sha256": sha256_file(plan_path)},
            "tinifyReport": {"path": str(report_path), "sha256": sha256_file(report_path)},
        }
        write_json_atomic(args.output, value)
    except (OSError, ValueError, json.JSONDecodeError) as exc:
        print(json.dumps({"ok": False, "error": str(exc)}, ensure_ascii=False, indent=2))
        return 1
    print(json.dumps({
        "ok": True,
        "userConclusion": "已为额度不足的剩余图片生成本地备用提案；必须重新展示并确认本地参数，尚未执行转换",
        "output": str(args.output.expanduser().resolve()),
        "actionCount": len(value["actions"]),
    }, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
