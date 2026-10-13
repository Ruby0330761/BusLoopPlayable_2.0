#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

SCRIPT_ROOT = Path(__file__).resolve().parent
LIB_ROOT = SCRIPT_ROOT / "lib"
sys.path.insert(0, str(LIB_ROOT))
sys.path.insert(0, str(SCRIPT_ROOT))

from record_resource_approval import validate_inputs, verification_result
from resource_common import load_json, sha256_file


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="验证资源优化计划确认是否仍绑定当前计划和工具链")
    parser.add_argument("--approval", required=True, type=Path)
    parser.add_argument("--plan-json", required=True, type=Path)
    parser.add_argument("--plan-md", required=True, type=Path)
    parser.add_argument("--toolchain-lock", required=True, type=Path)
    parser.add_argument("--output", type=Path)
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    errors = []
    try:
        approval_path = args.approval.expanduser().resolve()
        plan_path = args.plan_json.expanduser().resolve()
        md_path = args.plan_md.expanduser().resolve()
        lock_path = args.toolchain_lock.expanduser().resolve()
        approval = load_json(approval_path)
        plan_path, md_path, lock_path, plan = validate_inputs(plan_path, md_path, lock_path)
        if not isinstance(approval, dict) or approval.get("schemaVersion") not in {
            "playable-resource-optimization-approval-v1", "playable-resource-trial-approval-v2",
        }:
            raise ValueError("approval schemaVersion 无效")
        result = verification_result(approval, approval_path, plan, plan_path, md_path, lock_path)
        if args.output:
            from resource_common import write_json_atomic
            write_json_atomic(args.output, result)
    except (OSError, ValueError, json.JSONDecodeError) as exc:
        result = {"valid": False, "errors": [str(exc)]}
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0 if result.get("valid") else 1


if __name__ == "__main__":
    raise SystemExit(main())
