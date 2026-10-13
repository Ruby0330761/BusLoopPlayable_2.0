#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import os
import shutil
import sys
import tempfile
from pathlib import Path

SCRIPT_ROOT = Path(__file__).resolve().parent
LIB_ROOT = SCRIPT_ROOT / "lib"
sys.path.insert(0, str(LIB_ROOT))
sys.path.insert(0, str(SCRIPT_ROOT))

from resource_common import load_json, resolve_project_path, sha256_file, sha256_paths, utc_now, write_json_atomic
from validate_adapter import validate as validate_adapter


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="根据 apply manifest 安全恢复资源回滚副本")
    parser.add_argument("--project-root", required=True, type=Path)
    parser.add_argument("--adapter", required=True, type=Path)
    parser.add_argument("--apply-result", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    return parser.parse_args()


def atomic_copy(source: Path, target: Path) -> None:
    descriptor, temporary_name = tempfile.mkstemp(prefix=f".{target.name}.", suffix=".restore", dir=str(target.parent))
    try:
        with source.open("rb") as input_handle, os.fdopen(descriptor, "wb") as output_handle:
            shutil.copyfileobj(input_handle, output_handle)
            output_handle.flush()
            os.fsync(output_handle.fileno())
        os.replace(temporary_name, target)
    except Exception:
        try:
            os.unlink(temporary_name)
        except FileNotFoundError:
            pass
        raise


def main() -> int:
    args = parse_args()
    try:
        project_root = args.project_root.expanduser().resolve()
        adapter_report = validate_adapter(project_root, args.adapter.expanduser().resolve())
        boundaries = adapter_report.get("resourceBoundaries") or {}
        if not adapter_report.get("valid") or not boundaries.get("applyCapable"):
            raise ValueError("v2 Adapter 未通过，禁止恢复")
        apply_path = args.apply_result.expanduser().resolve()
        apply_result = load_json(apply_path)
        if not isinstance(apply_result, dict) or apply_result.get("schemaVersion") != "playable-resource-apply-result-v1":
            raise ValueError("apply result schemaVersion 无效")
        if apply_result.get("status") != "RESOURCE_APPLIED" or apply_result.get("applicationMode") != "applied":
            raise ValueError("只有 RESOURCE_APPLIED 结果可以恢复")
        if apply_result.get("projectRoot") != str(project_root):
            raise ValueError("apply result 不属于当前项目")

        actions = apply_result.get("actions") or []
        prepared = []
        for item in actions:
            if item.get("operation") != "APPROVED_REPLACE":
                raise ValueError("恢复清单包含非 APPROVED_REPLACE 动作")
            target = resolve_project_path(project_root, item.get("targetPath"), must_exist=True)
            backup = Path(str(item.get("backupPath"))).expanduser().resolve()
            if not backup.is_file() or sha256_file(backup) != item.get("backupSha256") or item.get("backupSha256") != item.get("beforeSha256"):
                raise ValueError(f"回滚副本不存在或漂移：{item.get('targetPath')}")
            if sha256_file(target) != item.get("appliedSha256"):
                raise ValueError(f"目标文件在覆盖后又被修改，拒绝覆盖新工作：{item.get('targetPath')}")
            prepared.append((item, target, backup))

        working_roots = [Path(item) for item in boundaries["playableWorkingRoots"]]
        before_restore = sha256_paths(working_roots, base=project_root)
        for _, target, backup in prepared:
            atomic_copy(backup, target)
        for item, target, _ in prepared:
            if sha256_file(target) != item.get("beforeSha256"):
                raise RuntimeError(f"恢复后 hash 不匹配：{item.get('targetPath')}")
        after_restore = sha256_paths(working_roots, base=project_root)
        if after_restore != apply_result.get("workingTreeBeforeSha256"):
            raise RuntimeError("恢复后 playable 工作资源树未回到覆盖前 hash")
        report = {
            "schemaVersion": "playable-resource-restore-result-v1",
            "generatedAt": utc_now(),
            "status": "RESOURCE_RESTORED",
            "projectRoot": str(project_root),
            "applyResult": {"path": str(apply_path), "sha256": sha256_file(apply_path)},
            "workingTreeBeforeRestoreSha256": before_restore,
            "workingTreeAfterRestoreSha256": after_restore,
            "restoredActions": [item["actionId"] for item, _, _ in prepared],
        }
        write_json_atomic(args.output, report)
    except (OSError, ValueError, RuntimeError, json.JSONDecodeError) as exc:
        print(json.dumps({"ok": False, "error": str(exc)}, ensure_ascii=False, indent=2))
        return 1
    print(json.dumps({
        "ok": True,
        "userConclusion": f"已恢复 {len(report['restoredActions'])} 个资源，工作资源树与覆盖前完全一致",
        "output": str(args.output.resolve()),
    }, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
