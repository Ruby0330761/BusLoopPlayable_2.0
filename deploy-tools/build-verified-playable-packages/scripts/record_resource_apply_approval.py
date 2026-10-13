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

from render_resource_apply_confirmation import render_markdown
from resource_common import load_json, resolve_project_path, sha256_file, sha256_object, utc_now, write_json_atomic


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="记录 Gate B：候选不写回，或批准精确资源替换")
    parser.add_argument("--proposal-json", required=True, type=Path)
    parser.add_argument("--proposal-md", required=True, type=Path)
    parser.add_argument("--confirmation-text", required=True)
    parser.add_argument("--application-mode", choices=("candidate-only", "applied"))
    parser.add_argument("--fidelity-decision", choices=("accepted", "rejected"), help="有损候选必须与覆盖选择在同一次 Gate B 回复中记录")
    parser.add_argument("--action-id", action="append", default=[])
    parser.add_argument("--output", required=True, type=Path)
    return parser.parse_args()


def verified_proposal(path: Path) -> dict[str, Any]:
    proposal = load_json(path)
    if not isinstance(proposal, dict) or proposal.get("schemaVersion") != "playable-resource-apply-proposal-v1":
        raise ValueError("资源覆盖提案 schemaVersion 无效")
    core = {key: value for key, value in proposal.items() if key not in {"generatedAt", "proposalHash"}}
    if proposal.get("proposalHash") != "sha256:" + sha256_object(core):
        raise ValueError("资源覆盖提案哈希无效")
    if proposal.get("deleteSupported") is not False:
        raise ValueError("资源覆盖提案不得支持 DELETE")
    return proposal


def main() -> int:
    args = parse_args()
    try:
        proposal_path = args.proposal_json.expanduser().resolve()
        markdown_path = args.proposal_md.expanduser().resolve()
        proposal = verified_proposal(proposal_path)
        if not markdown_path.is_file() or markdown_path.read_text(encoding="utf-8") != render_markdown(proposal):
            raise ValueError("资源覆盖确认单不存在或与 JSON 不一致")
        confirmation = args.confirmation_text.strip()
        if not confirmation:
            raise ValueError("用户确认原话不能为空")
        prior_human = (proposal.get("humanFidelity") or {}).get("statusBeforeGate")
        fidelity_decision = args.fidelity_decision
        if fidelity_decision is None:
            if prior_human in {"APPROVED", "NOT_REQUIRED_NO_LOSSY_CHANGE"}:
                fidelity_decision = "accepted"
            else:
                raise ValueError("本确认单仍需 A/B 人工结论，请提供 --fidelity-decision accepted 或 rejected")
        if fidelity_decision == "rejected":
            if args.application_mode or args.action_id:
                raise ValueError("A/B 不接受时不能批准候选使用或覆盖")
            approval = {
                "schemaVersion": "playable-resource-apply-approval-v1",
                "status": "RESOURCE_CANDIDATE_REJECTED",
                "approvedAt": utc_now(),
                "applicationMode": None,
                "projectRoot": proposal["projectRoot"],
                "confirmationText": confirmation,
                "proposalHash": proposal["proposalHash"],
                "proposalJson": {"path": str(proposal_path), "sha256": sha256_file(proposal_path)},
                "proposalMarkdown": {"path": str(markdown_path), "sha256": sha256_file(markdown_path)},
                "humanFidelity": {"status": "REJECTED", "confirmationText": confirmation},
                "approvedActions": [],
                "deleteSupported": False,
            }
            write_json_atomic(args.output, approval)
            print(json.dumps({
                "ok": True,
                "userConclusion": "A/B 体验未被接受；候选不会写回工程，也不能进入平台构建，请回到最近通过候选",
                "applicationMode": None,
                "approvedActionIds": [],
                "output": str(args.output.resolve()),
            }, ensure_ascii=False, indent=2))
            return 0
        if args.application_mode is None:
            raise ValueError("A/B 可接受时必须同时选择 --application-mode candidate-only 或 applied")
        allowed_decisions = set(proposal.get("allowedDecisions") or [])
        if args.application_mode == "applied" and "apply-approved-replacements" not in allowed_decisions:
            raise ValueError("当前资源结果只允许候选用于平台包，不能覆盖工程资源")
        if args.application_mode == "candidate-only" and "candidate-only" not in allowed_decisions:
            raise ValueError("当前资源结果不允许 candidate-only")
        requested = list(dict.fromkeys(args.action_id))
        available = {item["actionId"]: item for item in proposal.get("actions") or []}
        if args.application_mode == "candidate-only" and requested:
            raise ValueError("candidate-only 不能携带覆盖 action ID")
        if args.application_mode == "applied" and not requested:
            raise ValueError("applied 必须显式提供至少一个 action ID")
        unknown = sorted(set(requested) - set(available))
        if unknown:
            raise ValueError("覆盖确认包含提案外 action ID：" + ", ".join(unknown))

        project_root = Path(proposal["projectRoot"]).resolve()
        approved: list[dict[str, Any]] = []
        for action_id in requested:
            item = available[action_id]
            target = resolve_project_path(project_root, item["targetPath"], must_exist=True)
            if item.get("beforeSha256") != sha256_file(target):
                raise ValueError(f"目标文件已漂移，请重新生成覆盖确认单：{item['targetPath']}")
            approved.append({
                "actionId": action_id,
                "operation": "APPROVED_REPLACE",
                "targetPath": item["targetPath"],
                "targetCurrentSha256": item["beforeSha256"],
                "candidatePath": item["candidatePath"],
                "candidateSha256": item["candidateSha256"],
            })

        approval = {
            "schemaVersion": "playable-resource-apply-approval-v1",
            "status": "RESOURCE_APPLY_APPROVED" if args.application_mode == "applied" else "RESOURCE_APPLY_SKIPPED",
            "approvedAt": utc_now(),
            "applicationMode": args.application_mode,
            "resourceResultType": proposal.get("resourceResultType"),
            "projectRoot": proposal["projectRoot"],
            "confirmationText": confirmation,
            "humanFidelity": {"status": "ACCEPTED", "confirmationText": confirmation},
            "proposalHash": proposal["proposalHash"],
            "proposalJson": {"path": str(proposal_path), "sha256": sha256_file(proposal_path)},
            "proposalMarkdown": {"path": str(markdown_path), "sha256": sha256_file(markdown_path)},
            "approvedActions": approved,
            "deleteSupported": False,
        }
        write_json_atomic(args.output, approval)
    except (OSError, ValueError, json.JSONDecodeError) as exc:
        print(json.dumps({"ok": False, "error": str(exc)}, ensure_ascii=False, indent=2))
        return 1
    print(json.dumps({
        "ok": True,
        "userConclusion": (
            f"已批准覆盖 {len(approval['approvedActions'])} 个精确资源；应用前仍会核对 hash 并创建回滚副本"
            if approval["applicationMode"] == "applied" else
            "已选择候选用于本轮平台包，不写回 playable 工程"
        ),
        "applicationMode": approval["applicationMode"],
        "approvedActionIds": [item["actionId"] for item in approval["approvedActions"]],
        "output": str(args.output.resolve()),
    }, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
