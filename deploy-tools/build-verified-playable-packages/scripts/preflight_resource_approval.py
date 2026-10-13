#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

SCRIPT_ROOT = Path(__file__).resolve().parent
LIB_ROOT = SCRIPT_ROOT / "lib"
sys.path.insert(0, str(LIB_ROOT))
sys.path.insert(0, str(SCRIPT_ROOT))

from record_resource_approval import validate_inputs
from resource_common import utc_now, write_json_atomic


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Gate A 展示前确认批准记录和验证结果都可生成")
    parser.add_argument("--plan-json", required=True, type=Path)
    parser.add_argument("--plan-md", required=True, type=Path)
    parser.add_argument("--toolchain-lock", required=True, type=Path)
    parser.add_argument("--approval-out", required=True, type=Path)
    parser.add_argument("--verification-out", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    return parser.parse_args()


def writable_target(path: Path) -> bool:
    parent = path.expanduser().resolve().parent
    while not parent.exists() and parent != parent.parent:
        parent = parent.parent
    return parent.is_dir() and os.access(parent, os.W_OK)


def main() -> int:
    args = parse_args()
    errors: list[str] = []
    try:
        validate_inputs(args.plan_json, args.plan_md, args.toolchain_lock)
        outputs = [args.approval_out.expanduser().resolve(), args.verification_out.expanduser().resolve()]
        if outputs[0] == outputs[1]:
            errors.append("批准记录与验证结果不能写到同一文件")
        for path in outputs:
            if not writable_target(path):
                errors.append(f"输出目录不可写：{path.parent}")
        report = {
            "schemaVersion": "playable-resource-approval-preflight-v1",
            "generatedAt": utc_now(),
            "ready": not errors,
            "userConclusion": "确认后可以一次生成批准记录和验证结果" if not errors else "批准记录输出尚未准备好，请先处理下面缺项",
            "approvalOutput": str(outputs[0]),
            "verificationOutput": str(outputs[1]),
            "errors": errors,
        }
    except (OSError, ValueError, json.JSONDecodeError) as exc:
        report = {"schemaVersion": "playable-resource-approval-preflight-v1", "generatedAt": utc_now(), "ready": False, "userConclusion": "批准记录输出尚未准备好", "errors": [str(exc)]}
    write_json_atomic(args.output, report)
    print(json.dumps(report, ensure_ascii=False, indent=2))
    return 0 if report["ready"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
