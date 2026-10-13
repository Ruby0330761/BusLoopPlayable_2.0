#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

LIB_ROOT = Path(__file__).resolve().parent / "lib"
sys.path.insert(0, str(LIB_ROOT))

from resource_common import relative_to_project, resolve_project_path, utc_now, write_json_atomic
from resource_metadata import probe_path


def main() -> int:
    parser = argparse.ArgumentParser(description="统一探测资源格式、尺寸、媒体与结构元数据")
    parser.add_argument("--project-root", required=True, type=Path)
    parser.add_argument("--input", action="append", required=True)
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()
    try:
        project_root = args.project_root.expanduser().resolve()
        items = []
        for value in args.input:
            path = resolve_project_path(project_root, value, must_exist=True)
            if not path.is_file():
                raise ValueError(f"资源不是文件：{value}")
            items.append({"path": relative_to_project(path, project_root), **probe_path(path)})
        report = {
            "schemaVersion": "playable-resource-metadata-probe-v1", "generatedAt": utc_now(),
            "projectRoot": str(project_root), "items": items, "conclusion": "PASS",
        }
        write_json_atomic(args.output, report)
    except (OSError, ValueError, json.JSONDecodeError) as exc:
        print(json.dumps({"ok": False, "error": str(exc)}, ensure_ascii=False, indent=2))
        return 1
    print(json.dumps({"ok": True, "output": str(args.output.resolve()), "resourceCount": len(items)}, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
