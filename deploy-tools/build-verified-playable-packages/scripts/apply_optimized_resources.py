#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path
from typing import Any

SCRIPT_ROOT = Path(__file__).resolve().parent
LIB_ROOT = SCRIPT_ROOT / "lib"
sys.path.insert(0, str(LIB_ROOT))
sys.path.insert(0, str(SCRIPT_ROOT))

from record_resource_apply_approval import verified_proposal
from resource_common import (
    is_within,
    load_json,
    resolve_boundary_path,
    resolve_project_path,
    sha256_file,
    sha256_paths,
    utc_now,
    write_json_atomic,
)
from validate_adapter import validate as validate_adapter


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="只应用 Gate B 精确批准的 APPROVED_REPLACE 资源")
    parser.add_argument("--project-root", required=True, type=Path)
    parser.add_argument("--adapter", required=True, type=Path)
    parser.add_argument("--proposal", required=True, type=Path)
    parser.add_argument("--approval", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    return parser.parse_args()


def atomic_copy(source: Path, target: Path) -> None:
    target.parent.mkdir(parents=True, exist_ok=True)
    descriptor, temporary_name = tempfile.mkstemp(prefix=f".{target.name}.", suffix=".replace", dir=str(target.parent))
    try:
        with source.open("rb") as input_handle, os.fdopen(descriptor, "wb") as output_handle:
            shutil.copyfileobj(input_handle, output_handle)
            output_handle.flush()
            os.fsync(output_handle.fileno())
        temporary = Path(temporary_name)
        if sha256_file(temporary) != sha256_file(source):
            raise ValueError(f"临时文件校验失败：{target}")
        os.replace(temporary, target)
    except Exception:
        try:
            os.unlink(temporary_name)
        except FileNotFoundError:
            pass
        raise


def git_changes(project_root: Path, paths: list[str]) -> list[str]:
    try:
        completed = subprocess.run(
            ["git", "-C", str(project_root), "status", "--short", "--", *paths],
            capture_output=True,
            text=True,
            timeout=10,
            check=False,
        )
    except (OSError, subprocess.TimeoutExpired):
        return []
    return [line for line in completed.stdout.splitlines() if line.strip()]


def verify_unreferenced(project_root: Path, proposal: dict[str, Any]) -> list[dict[str, Any]]:
    verified: list[dict[str, Any]] = []
    for item in proposal.get("unreferencedResources") or []:
        path = resolve_project_path(project_root, item.get("path"), must_exist=True)
        if not path.is_file() or path.stat().st_size != item.get("bytes") or sha256_file(path) != item.get("sha256"):
            raise ValueError(f"UNREFERENCED 文件发生变化：{item.get('path')}")
        verified.append({"path": item["path"], "bytes": item["bytes"], "sha256": item["sha256"]})
    return verified


def main() -> int:
    args = parse_args()
    replaced: list[dict[str, Any]] = []
    try:
        project_root = args.project_root.expanduser().resolve()
        adapter_path = args.adapter.expanduser().resolve()
        adapter_report = validate_adapter(project_root, adapter_path)
        boundaries = adapter_report.get("resourceBoundaries") or {}
        if not adapter_report.get("valid") or not boundaries.get("applyCapable"):
            raise ValueError("v2 Adapter 未通过，禁止写入 playable 工作资源")

        proposal_path = args.proposal.expanduser().resolve()
        approval_path = args.approval.expanduser().resolve()
        proposal = verified_proposal(proposal_path)
        approval = load_json(approval_path)
        if not isinstance(approval, dict) or approval.get("schemaVersion") != "playable-resource-apply-approval-v1":
            raise ValueError("Gate B approval schemaVersion 无效")
        if approval.get("projectRoot") != str(project_root) or proposal.get("projectRoot") != str(project_root):
            raise ValueError("Gate B 证据不属于当前项目")
        proposal_ref = approval.get("proposalJson") or {}
        if proposal_ref.get("path") != str(proposal_path) or proposal_ref.get("sha256") != sha256_file(proposal_path):
            raise ValueError("Gate B approval 未绑定当前 proposal")
        if approval.get("proposalHash") != proposal.get("proposalHash"):
            raise ValueError("Gate B proposal 已漂移")
        if approval.get("deleteSupported") is not False or proposal.get("deleteSupported") is not False:
            raise ValueError("apply 只支持 APPROVED_REPLACE，不支持 DELETE")

        immutable_roots = [Path(item) for item in boundaries["immutableSourceRoots"]]
        working_roots = [Path(item) for item in boundaries["playableWorkingRoots"]]
        immutable_before = sha256_paths(immutable_roots, base=project_root)
        working_before = sha256_paths(working_roots, base=project_root)
        unreferenced_before = verify_unreferenced(project_root, proposal)

        if approval.get("applicationMode") == "candidate-only":
            if approval.get("status") != "RESOURCE_APPLY_SKIPPED" or approval.get("approvedActions"):
                raise ValueError("candidate-only approval 状态无效")
            report = {
                "schemaVersion": "playable-resource-apply-result-v1",
                "generatedAt": utc_now(),
                "status": "RESOURCE_APPLY_SKIPPED",
                "applicationMode": "candidate-only",
                "resourceResultType": proposal.get("resourceResultType"),
                "projectRoot": str(project_root),
                "proposal": {"path": str(proposal_path), "sha256": sha256_file(proposal_path)},
                "approval": {"path": str(approval_path), "sha256": sha256_file(approval_path)},
                "workingTreeBeforeSha256": working_before,
                "workingTreeAfterSha256": sha256_paths(working_roots, base=project_root),
                "immutableTreeBeforeSha256": immutable_before,
                "immutableTreeAfterSha256": sha256_paths(immutable_roots, base=project_root),
                "unreferencedResources": verify_unreferenced(project_root, proposal),
                "actions": [],
            }
            if report["workingTreeBeforeSha256"] != report["workingTreeAfterSha256"]:
                raise ValueError("candidate-only 模式下 playable 工作资源发生变化")
            write_json_atomic(args.output, report)
            print(json.dumps({
                "ok": True,
                "userConclusion": "候选已保留用于本轮平台包，playable 工程资源没有被覆盖",
                "applicationMode": "candidate-only",
                "output": str(args.output.resolve()),
            }, ensure_ascii=False, indent=2))
            return 0

        if approval.get("applicationMode") != "applied" or approval.get("status") != "RESOURCE_APPLY_APPROVED":
            raise ValueError("覆盖 approval 状态无效")
        available = {item["actionId"]: item for item in proposal.get("actions") or []}
        approved = approval.get("approvedActions") or []
        if not approved:
            raise ValueError("没有批准的 APPROVED_REPLACE action")

        rollback_root = Path(proposal["rollbackRoot"]).resolve()
        if not is_within(Path(boundaries["rollbackRoot"]), rollback_root):
            raise ValueError("回滚目录越过 Adapter rollbackRoot")
        if rollback_root.exists() and any(rollback_root.iterdir()):
            raise ValueError(f"回滚目录必须为空：{rollback_root}")
        rollback_root.mkdir(parents=True, exist_ok=True)

        prepared: list[dict[str, Any]] = []
        for approval_item in approved:
            if approval_item.get("operation") != "APPROVED_REPLACE":
                raise ValueError("apply 只接受 APPROVED_REPLACE")
            action_id = approval_item.get("actionId")
            item = available.get(action_id)
            if not item:
                raise ValueError(f"approval 包含 proposal 外 action：{action_id}")
            target = resolve_project_path(project_root, item["targetPath"], must_exist=True)
            candidate = resolve_boundary_path(
                project_root, item["candidatePath"], boundaries, "candidateRoots", must_exist=True,
            )
            if not any(is_within(Path(root), target) for root in boundaries["overwriteEligibleRoots"]):
                raise ValueError(f"目标越过 overwriteEligibleRoots：{item['targetPath']}")
            if any(is_within(Path(root), target) for root in boundaries["immutableSourceRoots"]):
                raise ValueError(f"禁止写 immutableSourceRoots：{item['targetPath']}")
            if sha256_file(target) != item["beforeSha256"] or sha256_file(target) != approval_item.get("targetCurrentSha256"):
                raise ValueError(f"目标 hash 漂移：{item['targetPath']}")
            if sha256_file(candidate) != item["candidateSha256"] or sha256_file(candidate) != approval_item.get("candidateSha256"):
                raise ValueError(f"候选 hash 漂移：{item['candidatePath']}")
            backup = rollback_root / item["targetPath"]
            backup.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(target, backup)
            if sha256_file(backup) != item["beforeSha256"]:
                raise ValueError(f"回滚副本校验失败：{item['targetPath']}")
            prepared.append({"action": item, "target": target, "candidate": candidate, "backup": backup})

        try:
            for item in prepared:
                atomic_copy(item["candidate"], item["target"])
                if sha256_file(item["target"]) != item["action"]["candidateSha256"]:
                    raise ValueError(f"覆盖后 hash 不匹配：{item['action']['targetPath']}")
                replaced.append(item)
        except Exception:
            for item in reversed(replaced):
                atomic_copy(item["backup"], item["target"])
            if any(sha256_file(item["target"]) != item["action"]["beforeSha256"] for item in replaced):
                raise RuntimeError("覆盖失败且自动回滚未能恢复全部文件")
            raise

        immutable_after = sha256_paths(immutable_roots, base=project_root)
        if immutable_after != immutable_before:
            raise RuntimeError("immutableSourceRoots 发生变化，已停止")
        unreferenced_after = verify_unreferenced(project_root, proposal)
        if unreferenced_after != unreferenced_before:
            raise RuntimeError("UNREFERENCED 资源发生变化，已停止")
        working_after = sha256_paths(working_roots, base=project_root)
        action_results = [{
            "actionId": item["action"]["actionId"],
            "operation": "APPROVED_REPLACE",
            "targetPath": item["action"]["targetPath"],
            "beforeSha256": item["action"]["beforeSha256"],
            "appliedSha256": item["action"]["candidateSha256"],
            "backupPath": str(item["backup"]),
            "backupSha256": sha256_file(item["backup"]),
        } for item in prepared]
        report = {
            "schemaVersion": "playable-resource-apply-result-v1",
            "generatedAt": utc_now(),
            "status": "RESOURCE_APPLIED",
            "applicationMode": "applied",
            "resourceResultType": proposal.get("resourceResultType"),
            "projectRoot": str(project_root),
            "proposal": {"path": str(proposal_path), "sha256": sha256_file(proposal_path)},
            "approval": {"path": str(approval_path), "sha256": sha256_file(approval_path)},
            "rollbackRoot": str(rollback_root),
            "workingTreeBeforeSha256": working_before,
            "workingTreeAfterSha256": working_after,
            "immutableTreeBeforeSha256": immutable_before,
            "immutableTreeAfterSha256": immutable_after,
            "unreferencedResources": unreferenced_after,
            "actions": action_results,
            "gitWorktreeChanges": git_changes(project_root, [item["targetPath"] for item in proposal["actions"]]),
            "rebuildRequired": True,
        }
        write_json_atomic(args.output, report)
    except (OSError, ValueError, RuntimeError, json.JSONDecodeError) as exc:
        print(json.dumps({"ok": False, "error": str(exc)}, ensure_ascii=False, indent=2))
        return 1
    print(json.dumps({
        "ok": True,
        "userConclusion": f"已备份并覆盖 {len(report['actions'])} 个确认资源；未引用资源保持不变，下一步必须从正式工程完整重建",
        "rollbackRoot": report["rollbackRoot"],
        "output": str(args.output.resolve()),
    }, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
