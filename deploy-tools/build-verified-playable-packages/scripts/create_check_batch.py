#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import sys
import uuid
from pathlib import Path

LIB_ROOT = Path(__file__).resolve().parent / "lib"
sys.path.insert(0, str(LIB_ROOT))

from artifact import ArtifactError, load_artifact
from resource_common import utc_now, write_json_atomic


def main() -> int:
    parser = argparse.ArgumentParser(description="为一个最终 artifact 创建不可复用的检查批次 ID")
    parser.add_argument("--platform", required=True)
    parser.add_argument("--artifact", required=True)
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()
    try:
        output = args.output.expanduser().resolve()
        if output.exists():
            raise ValueError(f"检查批次文件已存在，拒绝复用：{output}")
        artifact = load_artifact(args.artifact)
        batch = {
            "schemaVersion": "playable-check-batch-v1",
            "createdAt": utc_now(),
            "checkBatchId": str(uuid.uuid4()),
            "platform": args.platform,
            "artifact": artifact.to_report_dict(),
        }
        write_json_atomic(output, batch)
        print(json.dumps(batch, ensure_ascii=False, indent=2))
        return 0
    except (ArtifactError, OSError, ValueError) as exc:
        print(json.dumps({"ok": False, "error": str(exc)}, ensure_ascii=False, indent=2))
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
