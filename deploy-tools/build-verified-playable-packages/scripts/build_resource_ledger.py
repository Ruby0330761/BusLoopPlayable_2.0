#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import re
import sys
from collections import defaultdict
from pathlib import Path
from typing import Any

LIB_ROOT = Path(__file__).resolve().parent / "lib"
sys.path.insert(0, str(LIB_ROOT))

from resource_common import (
    classify_bucket,
    iter_files,
    load_json,
    relative_to_project,
    resolve_project_path,
    sha256_file,
    sha256_object,
    utc_now,
    write_json_atomic,
)


TEXT_EXTENSIONS = {".html", ".css", ".js", ".mjs", ".cjs", ".ts", ".tsx", ".jsx", ".json", ".yaml", ".yml", ".xml", ".csv"}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="建立资源账本、引用图和当前变体资源准入白名单")
    parser.add_argument("--project-root", required=True, type=Path)
    parser.add_argument("--root", action="append", required=True, help="项目内资源根，可重复")
    parser.add_argument("--entrypoint", action="append", required=True, help="当前素材的源码、HTML 或配置入口，可重复")
    parser.add_argument("--runtime-evidence", type=Path, help="可选；运行时加载证据 JSON")
    parser.add_argument("--classification-overrides", type=Path, help="可选；人工确认的分类覆盖 JSON")
    parser.add_argument("--variant", default="default")
    parser.add_argument("--ledger-out", required=True, type=Path)
    parser.add_argument("--graph-out", required=True, type=Path)
    parser.add_argument("--allowlist-out", required=True, type=Path)
    parser.add_argument("--excluded-out", required=True, type=Path)
    return parser.parse_args()


def read_text(path: Path) -> str:
    if path.suffix.lower() not in TEXT_EXTENSIONS:
        return ""
    try:
        return path.read_text(encoding="utf-8", errors="replace")
    except OSError:
        return ""


def normalized_runtime_evidence(path: Path | None) -> tuple[set[str], bool, dict[str, Any] | None]:
    if path is None:
        return set(), False, None
    value = load_json(path.expanduser().resolve())
    if not isinstance(value, dict) or value.get("schemaVersion") != "playable-runtime-resource-evidence-v1":
        raise ValueError("运行时资源证据 schemaVersion 必须为 playable-runtime-resource-evidence-v1")
    loaded = value.get("loadedResources")
    if not isinstance(loaded, list) or not all(isinstance(item, str) for item in loaded):
        raise ValueError("运行时资源证据 loadedResources 必须是字符串数组")
    return {item.lstrip("./") for item in loaded}, value.get("fullCoverage") is True, value


def classification_overrides(path: Path | None) -> dict[str, dict[str, Any]]:
    if path is None:
        return {}
    value = load_json(path.expanduser().resolve())
    if not isinstance(value, dict) or value.get("schemaVersion") != "playable-resource-classification-overrides-v1":
        raise ValueError("分类覆盖 schemaVersion 无效")
    items = value.get("resources")
    if not isinstance(items, list):
        raise ValueError("分类覆盖 resources 必须是数组")
    result: dict[str, dict[str, Any]] = {}
    for item in items:
        if not isinstance(item, dict) or item.get("classification") not in {"REQUIRED", "CONDITIONAL", "UNREFERENCED", "UNKNOWN"}:
            raise ValueError("分类覆盖项必须包含 path 和合法 classification")
        path_value = item.get("path")
        if not isinstance(path_value, str) or not path_value:
            raise ValueError("分类覆盖项 path 无效")
        evidence = item.get("evidence")
        if not isinstance(evidence, list) or not evidence:
            raise ValueError(f"分类覆盖项必须提供证据：{path_value}")
        result[path_value.lstrip("./")] = item
    return result


def path_tokens(relative: str, root_relative: str) -> set[str]:
    tokens = {relative, Path(relative).name}
    try:
        tokens.add(Path(relative).relative_to(root_relative).as_posix())
    except ValueError:
        pass
    return {token for token in tokens if len(token) >= 3}


def build(args: argparse.Namespace) -> tuple[dict[str, Any], dict[str, Any], dict[str, Any], dict[str, Any]]:
    project_root = args.project_root.expanduser().resolve()
    if not project_root.is_dir():
        raise ValueError(f"项目目录不存在：{project_root}")
    roots = [resolve_project_path(project_root, value, must_exist=True) for value in dict.fromkeys(args.root)]
    entrypoints = [resolve_project_path(project_root, value, must_exist=True) for value in dict.fromkeys(args.entrypoint)]
    runtime_paths, full_coverage, runtime_value = normalized_runtime_evidence(args.runtime_evidence)
    overrides = classification_overrides(args.classification_overrides)

    entrypoint_files: list[Path] = []
    for entrypoint in entrypoints:
        files, _ = iter_files(entrypoint)
        entrypoint_files.extend(files)
    entrypoint_files = sorted(set(item.resolve() for item in entrypoint_files))
    texts = [(path, read_text(path)) for path in entrypoint_files]

    files: list[Path] = []
    warnings: list[str] = []
    for root in roots:
        found, found_warnings = iter_files(root, excluded_paths=(args.ledger_out, args.graph_out, args.allowlist_out, args.excluded_out))
        files.extend(found)
        warnings.extend(found_warnings)
    files = sorted(set(item.resolve() for item in files), key=lambda item: relative_to_project(item, project_root))

    entries: list[dict[str, Any]] = []
    edges: list[dict[str, Any]] = []
    hashes: dict[str, list[str]] = defaultdict(list)
    bucket_totals: dict[str, dict[str, int]] = defaultdict(lambda: {"files": 0, "bytes": 0})
    for file_path in files:
        relative = relative_to_project(file_path, project_root)
        root = next(item for item in roots if file_path == item or item in file_path.parents)
        root_relative = relative_to_project(root, project_root)
        sha = sha256_file(file_path)
        direct_evidence: list[dict[str, Any]] = []
        for source_path, text_value in texts:
            for token in path_tokens(relative, root_relative):
                if token in text_value:
                    evidence = {
                        "source": relative_to_project(source_path, project_root),
                        "type": "STATIC_REFERENCE",
                        "token": token,
                    }
                    direct_evidence.append(evidence)
                    edges.append({"from": evidence["source"], "to": relative, "type": evidence["type"], "token": token})
                    break
        runtime_match = relative in runtime_paths or Path(relative).name in runtime_paths
        if runtime_match:
            direct_evidence.append({"source": "runtime-reference-evidence.json", "type": "RUNTIME_LOAD"})
            edges.append({"from": "runtime-reference-evidence.json", "to": relative, "type": "RUNTIME_LOAD"})

        override = overrides.get(relative)
        if override:
            classification = override["classification"]
            direct_evidence.extend({"source": item, "type": "MANUAL_OVERRIDE"} for item in override["evidence"])
        elif file_path in entrypoint_files:
            classification = "REQUIRED"
            direct_evidence.append({"source": relative, "type": "ACTIVE_ENTRYPOINT"})
        elif direct_evidence:
            classification = "REQUIRED"
        elif full_coverage:
            classification = "UNREFERENCED"
        else:
            classification = "UNKNOWN"

        bucket = classify_bucket(file_path)
        record = {
            "resourceId": "sha256:" + sha,
            "path": relative,
            "root": root_relative,
            "bucket": bucket,
            "extension": file_path.suffix.lower(),
            "bytes": file_path.stat().st_size,
            "sha256": sha,
            "classification": classification,
            "variant": args.variant,
            "evidence": direct_evidence,
        }
        entries.append(record)
        hashes[sha].append(relative)
        bucket_totals[bucket]["files"] += 1
        bucket_totals[bucket]["bytes"] += record["bytes"]

    duplicates = []
    for sha, paths in hashes.items():
        if len(paths) > 1:
            size = next(item["bytes"] for item in entries if item["sha256"] == sha)
            duplicates.append({"sha256": sha, "paths": paths, "copies": len(paths), "wastedBytes": size * (len(paths) - 1)})
    duplicates.sort(key=lambda item: (-item["wastedBytes"], item["sha256"]))
    counts = {name: sum(1 for item in entries if item["classification"] == name) for name in ("REQUIRED", "CONDITIONAL", "UNREFERENCED", "UNKNOWN")}

    common = {
        "generatedAt": utc_now(),
        "projectRoot": str(project_root),
        "variant": args.variant,
        "resourceRoots": [relative_to_project(item, project_root) for item in roots],
        "entrypoints": [relative_to_project(item, project_root) for item in entrypoints],
    }
    ledger = {
        "schemaVersion": "playable-resource-ledger-v2",
        **common,
        "totalBytes": sum(item["bytes"] for item in entries),
        "fileCount": len(entries),
        "bucketTotals": dict(sorted(bucket_totals.items())),
        "classificationCounts": counts,
        "duplicateGroups": duplicates,
        "files": entries,
        "warnings": sorted(set(warnings)),
    }
    graph_core = {
        "projectRoot": str(project_root),
        "variant": args.variant,
        "nodes": [{"path": item["path"], "classification": item["classification"], "sha256": item["sha256"]} for item in entries],
        "edges": sorted(edges, key=lambda item: (item["from"], item["to"], item["type"])),
        "runtimeEvidenceFullCoverage": full_coverage,
    }
    graph = {
        "schemaVersion": "playable-resource-reference-graph-v1",
        **common,
        **{key: value for key, value in graph_core.items() if key not in {"projectRoot", "variant"}},
        "graphHash": "sha256:" + sha256_object(graph_core),
        "unresolved": [item["path"] for item in entries if item["classification"] == "UNKNOWN"],
    }
    allowed = [item for item in entries if item["classification"] in {"REQUIRED", "CONDITIONAL"}]
    allowlist_core = {
        "projectRoot": str(project_root),
        "variant": args.variant,
        "resources": [{key: item[key] for key in ("resourceId", "path", "sha256", "classification", "bucket", "variant")} for item in allowed],
    }
    allowlist = {
        "schemaVersion": "playable-resource-allowlist-v1",
        **common,
        "resources": allowlist_core["resources"],
        "allowlistHash": "sha256:" + sha256_object(allowlist_core),
        "blockers": ([{"code": "RESOURCE_REFERENCE_UNRESOLVED", "paths": graph["unresolved"]}] if graph["unresolved"] else []),
    }
    excluded = {
        "schemaVersion": "playable-excluded-resources-v1",
        **common,
        "policy": "EXCLUDE_FROM_CURRENT_CANDIDATE_ONLY",
        "projectFilesMustRemainUnchanged": True,
        "resources": [
            {
                "path": item["path"],
                "sha256": item["sha256"],
                "bytes": item["bytes"],
                "classification": "UNREFERENCED",
                "reason": "CURRENT_CANDIDATE_NOT_REFERENCED",
                "projectAction": "KEEP_UNCHANGED",
            }
            for item in entries if item["classification"] == "UNREFERENCED"
        ],
    }
    if runtime_value is not None:
        graph["runtimeEvidenceSha256"] = sha256_file(args.runtime_evidence.expanduser().resolve())
    return ledger, graph, allowlist, excluded


def main() -> int:
    args = parse_args()
    try:
        ledger, graph, allowlist, excluded = build(args)
        write_json_atomic(args.ledger_out, ledger)
        write_json_atomic(args.graph_out, graph)
        write_json_atomic(args.allowlist_out, allowlist)
        write_json_atomic(args.excluded_out, excluded)
    except (OSError, ValueError, json.JSONDecodeError) as exc:
        print(json.dumps({"ok": False, "error": str(exc)}, ensure_ascii=False, indent=2))
        return 1
    print(json.dumps({
        "ok": True,
        "userConclusion": "已完成当前素材的资源引用分析，可以生成资源优化计划",
        "classificationCounts": ledger["classificationCounts"],
        "blockers": allowlist["blockers"],
    }, ensure_ascii=False, indent=2))
    return 2 if allowlist["blockers"] else 0


if __name__ == "__main__":
    raise SystemExit(main())
