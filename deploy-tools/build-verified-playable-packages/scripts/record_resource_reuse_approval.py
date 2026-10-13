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

from prepare_resource_reuse_confirmation import render_markdown, verified_confirmation
from resource_common import file_ref, sha256_file, utc_now, write_json_atomic


SCHEMA = "playable-resource-reuse-approval-v1"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="记录本轮是否复用已展示的历史资源候选")
    parser.add_argument("--confirmation-json", required=True, type=Path)
    parser.add_argument("--confirmation-md", required=True, type=Path)
    parser.add_argument("--decision", required=True, choices=("reuse-existing", "reanalyze", "use-original"))
    parser.add_argument("--confirmation-text", required=True)
    parser.add_argument("--output", required=True, type=Path)
    return parser.parse_args()


def verified_approval(path: Path) -> dict[str, Any]:
    value = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(value, dict) or value.get("schemaVersion") != SCHEMA:
        raise ValueError("资源复用批准 schemaVersion 无效")
    return value


def main() -> int:
    args = parse_args()
    try:
        json_path = args.confirmation_json.expanduser().resolve()
        markdown_path = args.confirmation_md.expanduser().resolve()
        confirmation = verified_confirmation(json_path)
        if not markdown_path.is_file() or markdown_path.read_text(encoding="utf-8") != render_markdown(confirmation):
            raise ValueError("资源复用确认单 Markdown 缺失或与 JSON 不一致")
        if confirmation.get("status") != "AWAITING_USER_CONFIRMATION":
            raise ValueError("历史资源候选尚未通过验签，不能记录复用批准")
        decision = args.decision
        if decision not in set(confirmation.get("allowedDecisions") or []):
            raise ValueError("该选择不在当前确认单允许范围内")
        text = args.confirmation_text.strip()
        if not text:
            raise ValueError("用户确认原话不能为空；沉默或历史批准不能代替本轮确认")
        status = {
            "reuse-existing": "RESOURCE_REUSE_CONFIRMED",
            "reanalyze": "RESOURCE_REANALYSIS_REQUIRED",
            "use-original": "UNOPTIMIZED_GATE_A_REQUIRED",
        }[decision]
        result = {
            "schemaVersion": SCHEMA,
            "status": status,
            "recordedAt": utc_now(),
            "projectRoot": confirmation.get("projectRoot"),
            "decision": decision,
            "confirmationText": text,
            "confirmationHash": confirmation.get("confirmationHash"),
            "confirmationJson": file_ref(json_path),
            "confirmationMarkdown": file_ref(markdown_path),
            "historicalRun": confirmation.get("historicalRun"),
            "historicalResourceState": (confirmation.get("historicalRun") or {}).get("resourceState"),
            "currentContext": confirmation.get("currentContext"),
            "resourceSummary": confirmation.get("resourceSummary"),
            "reports": confirmation.get("reports"),
            "authorizesPlatformBuild": decision == "reuse-existing",
        }
        write_json_atomic(args.output, result)
    except (OSError, ValueError, json.JSONDecodeError) as exc:
        print(json.dumps({"ok": False, "error": str(exc)}, ensure_ascii=False, indent=2))
        return 1
    conclusion = {
        "reuse-existing": "已按本轮明确选择复用确认单中的历史资源候选；平台构建仍会重新证明最终包真实消费候选字节",
        "reanalyze": "已选择从当前原始资源重新分析；请进入新的机会审计和 Gate A，不复用历史候选",
        "use-original": "已选择考虑使用原资源；还必须进入未优化明确批准的 Gate A 分支，当前未授权平台构建",
    }[result["decision"]]
    print(json.dumps({
        "ok": True,
        "status": result["status"],
        "userConclusion": conclusion,
        "output": str(args.output.expanduser().resolve()),
    }, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
