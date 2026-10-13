#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

SCRIPT_ROOT = Path(__file__).resolve().parent
SKILL_ROOT = SCRIPT_ROOT.parent
LIB_ROOT = SCRIPT_ROOT / "lib"
sys.path.insert(0, str(LIB_ROOT))
sys.path.insert(0, str(SCRIPT_ROOT))

from record_candidate import CandidateError, verify_manifest_file
from resource_common import (
    is_within,
    load_json,
    path_bytes,
    resolve_project_path,
    sha256_file,
    sha256_object,
    sha256_paths,
    sha256_tree,
    utc_now,
    write_json_atomic,
)
from validate_adapter import validate as validate_adapter


SCHEMA = "playable-source-freeze-v1"


def parser() -> argparse.ArgumentParser:
    root = argparse.ArgumentParser(description="在 hardening 前冻结源码、Adapter、资源、规则和 plain 候选清单")
    sub = root.add_subparsers(dest="command", required=True)
    create = sub.add_parser("create")
    create.add_argument("--project-root", required=True, type=Path)
    create.add_argument("--adapter", required=True, type=Path)
    create.add_argument("--plain-manifest", action="append", required=True, type=Path)
    create.add_argument("--platform", action="append")
    create.add_argument("--rules-manifest", type=Path, default=SKILL_ROOT / "rules/manifest.json")
    create.add_argument("--output", required=True, type=Path)
    verify = sub.add_parser("verify")
    verify.add_argument("--freeze", required=True, type=Path)
    verify.add_argument("--output", required=True, type=Path)
    return root


def path_ref(path: Path) -> dict[str, Any]:
    resolved = path.expanduser().resolve()
    if not resolved.exists():
        raise ValueError(f"冻结输入不存在：{resolved}")
    return {
        "path": str(resolved),
        "type": "file" if resolved.is_file() else "directory",
        "bytes": path_bytes(resolved),
        "sha256": sha256_tree(resolved),
    }


def file_ref(path: Path) -> dict[str, Any]:
    resolved = path.expanduser().resolve()
    if not resolved.is_file():
        raise ValueError(f"冻结文件不存在：{resolved}")
    return {"path": str(resolved), "bytes": resolved.stat().st_size, "sha256": sha256_file(resolved)}


def freeze_fingerprint(value: dict[str, Any]) -> str:
    return sha256_object({
        "adapter": value.get("adapter"),
        "rulesManifest": value.get("rulesManifest"),
        "rebuildPolicy": value.get("rebuildPolicy"),
        "platforms": value.get("platforms"),
        "applicationMode": value.get("applicationMode"),
        "consumedResourceTree": value.get("consumedResourceTree"),
        "inputs": value.get("inputs"),
        "plainManifests": value.get("plainManifests"),
    })


def add_input(
    inputs: dict[str, dict[str, Any]],
    path: Path,
    *,
    scopes: set[str],
    platforms: set[str],
) -> None:
    resolved = path.expanduser().resolve()
    key = str(resolved)
    if key not in inputs:
        inputs[key] = {**path_ref(resolved), "scopes": [], "platforms": []}
    inputs[key]["scopes"] = sorted(set(inputs[key]["scopes"]) | scopes)
    inputs[key]["platforms"] = sorted(set(inputs[key]["platforms"]) | platforms)


def create_freeze(args: argparse.Namespace) -> dict[str, Any]:
    project_root = args.project_root.expanduser().resolve()
    adapter_path = args.adapter.expanduser().resolve()
    output = args.output.expanduser().resolve()
    if output.exists():
        raise ValueError(f"源码冻结文件已存在，不能覆盖：{output}")
    validation = validate_adapter(project_root, adapter_path)
    if not validation.get("valid"):
        raise ValueError("Adapter 未通过验证，不能冻结源码")
    efficiency = validation.get("executionEfficiency") or {}
    if efficiency.get("enabled") is not True:
        raise ValueError("Adapter 尚未启用 executionEfficiency，继续使用现有串行流程")
    configured_platforms = set((validation.get("platformCapabilities") or {}).keys())
    targets = set(args.platform or configured_platforms)
    if not targets or not targets <= configured_platforms:
        raise ValueError("冻结目标平台不在 Adapter platformBuilds 范围内")
    if "applovin" not in configured_platforms:
        raise ValueError("源码冻结必须包含 Adapter 已声明的 AppLovin 基线")
    targets.add("applovin")

    manifests: dict[str, dict[str, Any]] = {}
    for manifest_path in args.plain_manifest:
        candidate = verify_manifest_file(str(manifest_path.expanduser().resolve()))
        platform = str(candidate.get("platform") or "")
        if platform in manifests:
            raise ValueError(f"plain 候选清单平台重复：{platform}")
        expected_status = "BASELINE_READY" if platform == "applovin" else "PLATFORM_READY"
        if candidate.get("status") != expected_status:
            raise ValueError(f"{platform} plain 候选清单必须为 {expected_status}")
        manifests[platform] = candidate
    missing = sorted(targets - set(manifests))
    extra = sorted(set(manifests) - targets)
    if missing or extra:
        raise ValueError(f"plain 候选清单集合不匹配；缺少 {missing or '无'}，多余 {extra or '无'}")
    baseline_sha = manifests["applovin"].get("manifestSha256")
    application_mode = manifests["applovin"].get("applicationMode")
    consumed_resource_tree = manifests["applovin"].get("consumedResourceTree")
    if application_mode not in {"applied", "candidate-only"}:
        raise ValueError("AppLovin plain 候选缺少有效的资源应用模式")
    if not isinstance(consumed_resource_tree, dict):
        raise ValueError("AppLovin plain 候选缺少实际消费资源树")
    raw_consumed_roots = consumed_resource_tree.get("roots")
    if not isinstance(raw_consumed_roots, list) or not raw_consumed_roots:
        raise ValueError("实际消费资源树缺少根目录")
    consumed_roots: list[Path] = []
    for value in raw_consumed_roots:
        if not isinstance(value, str) or not value:
            raise ValueError("实际消费资源树包含无效根目录")
        path = Path(value).expanduser()
        if not path.is_absolute():
            path = project_root / path
        path = path.resolve()
        if not is_within(project_root, path) or not path.exists():
            raise ValueError(f"实际消费资源根不存在或越过项目：{value}")
        consumed_roots.append(path)
    if sha256_paths(consumed_roots, base=project_root) != consumed_resource_tree.get("sha256"):
        raise ValueError("实际消费资源树已漂移，不能创建 source freeze")
    for platform, candidate in manifests.items():
        if candidate.get("applicationMode") != application_mode:
            raise ValueError(f"{platform} plain 候选的资源应用模式与 AppLovin 不一致")
        if candidate.get("consumedResourceTree") != consumed_resource_tree:
            raise ValueError(f"{platform} plain 候选的实际消费资源树与 AppLovin 不一致")
        if platform == "applovin":
            continue
        if (candidate.get("baselineManifest") or {}).get("sha256") != baseline_sha:
            raise ValueError(f"{platform} plain 候选未绑定本次提供的 AppLovin 基线")

    inputs: dict[str, dict[str, Any]] = {}
    raw_adapter = load_json(adapter_path)
    resources = raw_adapter.get("resources") or {}
    all_platforms = set(targets)
    for value in resources.get("referenceEntrypoints") or []:
        add_input(inputs, resolve_project_path(project_root, value, must_exist=True), scopes={"shared-source"}, platforms=all_platforms)
    for value in resources.get("activeVariantConfigs") or []:
        add_input(inputs, resolve_project_path(project_root, value, must_exist=True), scopes={"shared-source"}, platforms=all_platforms)
    for value in resources.get("playableWorkingRoots") or []:
        add_input(inputs, resolve_project_path(project_root, value, must_exist=True), scopes={"resource"}, platforms=all_platforms)
    for path in consumed_roots:
        add_input(inputs, path, scopes={"resource"}, platforms=all_platforms)
    for value in efficiency.get("sharedInputs") or []:
        add_input(inputs, Path(value), scopes={"shared-source"}, platforms=all_platforms)
    for platform in targets:
        for value in (efficiency.get("platformInputs") or {}).get(platform) or []:
            add_input(inputs, Path(value), scopes={"platform-source"}, platforms={platform})

    rules_path = args.rules_manifest.expanduser().resolve()
    plain_refs = []
    for platform in sorted(targets):
        candidate = manifests[platform]
        manifest_path = Path(str(candidate.get("manifestPath") or "")).resolve()
        artifact = candidate.get("artifact") or {}
        plain_refs.append({
            "platform": platform,
            "deliveryKey": candidate.get("deliveryKey"),
            "status": candidate.get("status"),
            "manifest": file_ref(manifest_path),
            "artifact": {
                "path": artifact.get("path"),
                "bytes": artifact.get("size") if artifact.get("size") is not None else artifact.get("bytes"),
                "sha256": artifact.get("sha256"),
            },
        })
    freeze = {
        "schemaVersion": SCHEMA,
        "generatedAt": utc_now(),
        "projectRoot": str(project_root),
        "status": "FROZEN",
        "adapter": file_ref(adapter_path),
        "rulesManifest": file_ref(rules_path),
        "rebuildPolicy": efficiency.get("rebuildPolicy"),
        "platforms": sorted(targets),
        "applicationMode": application_mode,
        "consumedResourceTree": consumed_resource_tree,
        "inputs": [inputs[key] for key in sorted(inputs)],
        "plainManifests": plain_refs,
    }
    freeze["sourceFingerprint"] = freeze_fingerprint(freeze)
    freeze["userConclusion"] = "所有目标平台 plain 候选已通过并绑定；源码、Adapter、资源和配置已冻结，可以开始一次最终 hardening 矩阵"
    write_json_atomic(output, freeze)
    return freeze


def validate_freeze(value: object) -> dict[str, Any]:
    if not isinstance(value, dict) or value.get("schemaVersion") != SCHEMA:
        raise ValueError(f"源码冻结 schemaVersion 必须为 {SCHEMA}")
    if value.get("status") != "FROZEN" or value.get("sourceFingerprint") != freeze_fingerprint(value):
        raise ValueError("源码冻结指纹无效")
    return value


def verify_freeze(path: Path) -> dict[str, Any]:
    freeze = validate_freeze(load_json(path.expanduser().resolve()))
    drift: list[dict[str, str]] = []
    for label in ("adapter", "rulesManifest"):
        reference = freeze.get(label) or {}
        current = Path(str(reference.get("path") or "")).expanduser().resolve()
        if not current.is_file() or sha256_file(current) != reference.get("sha256"):
            drift.append({"scope": label, "path": str(current)})
    for reference in freeze.get("inputs") or []:
        current = Path(str(reference.get("path") or "")).expanduser().resolve()
        if not current.exists() or sha256_tree(current) != reference.get("sha256"):
            drift.append({"scope": ",".join(reference.get("scopes") or []), "path": str(current)})
    for item in freeze.get("plainManifests") or []:
        reference = item.get("manifest") or {}
        current = Path(str(reference.get("path") or "")).expanduser().resolve()
        if not current.is_file() or sha256_file(current) != reference.get("sha256"):
            drift.append({"scope": "plain-manifest", "path": str(current)})
            continue
        try:
            candidate = verify_manifest_file(str(current))
        except (CandidateError, OSError, ValueError):
            drift.append({"scope": "plain-artifact-or-evidence", "path": str(current)})
            continue
        artifact = candidate.get("artifact") or {}
        frozen_artifact = item.get("artifact") or {}
        candidate_bytes = artifact.get("size") if artifact.get("size") is not None else artifact.get("bytes")
        if (
            candidate.get("platform") != item.get("platform")
            or candidate.get("deliveryKey") != item.get("deliveryKey")
            or artifact.get("path") != frozen_artifact.get("path")
            or candidate_bytes != frozen_artifact.get("bytes")
            or artifact.get("sha256") != frozen_artifact.get("sha256")
        ):
            drift.append({"scope": "plain-artifact-or-evidence", "path": str(current)})
    return {
        "schemaVersion": "playable-source-freeze-verification-v1",
        "verifiedAt": utc_now(),
        "freeze": file_ref(path),
        "valid": not drift,
        "drift": drift,
        "userConclusion": (
            "源码冻结仍然有效，可以执行或继续最终矩阵"
            if not drift else
            "源码冻结后发生变化，必须停止 hardening，并按影响范围重新生成 plain 候选"
        ),
    }


def main() -> int:
    args = parser().parse_args()
    try:
        if args.command == "create":
            report = create_freeze(args)
        else:
            report = verify_freeze(args.freeze)
            write_json_atomic(args.output, report)
        print(json.dumps(report, ensure_ascii=False, indent=2))
        return 0 if report.get("valid", True) else 1
    except (OSError, ValueError, json.JSONDecodeError, CandidateError) as exc:
        print(json.dumps({"ok": False, "error": str(exc)}, ensure_ascii=False, indent=2))
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
