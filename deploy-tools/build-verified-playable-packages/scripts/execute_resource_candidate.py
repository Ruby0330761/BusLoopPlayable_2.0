#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
from pathlib import Path
from typing import Any

LIB_ROOT = Path(__file__).resolve().parent / "lib"
sys.path.insert(0, str(LIB_ROOT))

from resource_common import load_json, sha256_file, utc_now, write_json_atomic


def safe_environment() -> dict[str, str]:
    environment = dict(os.environ)
    for name in list(environment):
        if name.lower() in {"http_proxy", "https_proxy", "all_proxy"}:
            environment.pop(name, None)
    environment["NO_PROXY"] = "*"
    return environment


def execute(request: dict[str, Any]) -> dict[str, Any]:
    if request.get("schemaVersion") != "playable-resource-candidate-request-v1":
        raise ValueError("候选执行请求 schemaVersion 无效")
    changed = request.get("changedVariables")
    if not isinstance(changed, list) or len(changed) != 1 or not isinstance(changed[0], str):
        raise ValueError("每个候选必须且只能改变一个变量")
    source = Path(str(request.get("input") or "")).expanduser().resolve()
    output = Path(str(request.get("output") or "")).expanduser().resolve()
    argv = request.get("execute")
    if not source.is_file() or not isinstance(argv, list) or not argv or not all(isinstance(item, str) and item for item in argv):
        raise ValueError("候选执行输入或 argv 无效")
    output.parent.mkdir(parents=True, exist_ok=True)
    completed = subprocess.run(argv, capture_output=True, text=True, timeout=60, check=False, env=safe_environment())
    if completed.returncode != 0 or not output.is_file():
        raise ValueError(f"候选转换失败：exit={completed.returncode}")
    input_bytes = source.stat().st_size
    output_bytes = output.stat().st_size
    if output_bytes >= input_bytes:
        output.unlink(missing_ok=True)
        raise ValueError("候选没有减少 bytes，已拒绝采用")
    return {
        "schemaVersion": "playable-resource-conversion-receipt-v1", "generatedAt": utc_now(),
        "actionId": request.get("actionId"), "action": request.get("action"),
        "changedVariables": changed, "argv": argv,
        "input": {"path": str(source), "bytes": input_bytes, "sha256": sha256_file(source)},
        "output": {"path": str(output), "bytes": output_bytes, "sha256": sha256_file(output)},
        "savedBytes": input_bytes - output_bytes, "actualParameters": request.get("actualParameters") or {},
        "conclusion": "PASS",
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="执行一个单变量资源候选并记录转换 receipt")
    parser.add_argument("--request", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()
    try:
        request = load_json(args.request.expanduser().resolve())
        if not isinstance(request, dict):
            raise ValueError("候选执行请求必须是对象")
        receipt = execute(request)
        write_json_atomic(args.output, receipt)
    except (OSError, ValueError, json.JSONDecodeError, subprocess.SubprocessError) as exc:
        failure = {"schemaVersion": "playable-resource-conversion-receipt-v1", "generatedAt": utc_now(), "conclusion": "BLOCKED", "error": str(exc)}
        write_json_atomic(args.output, failure)
        print(json.dumps({"ok": False, "error": str(exc), "output": str(args.output.resolve())}, ensure_ascii=False, indent=2))
        return 1
    print(json.dumps({"ok": True, "output": str(args.output.resolve()), "savedBytes": receipt["savedBytes"]}, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
