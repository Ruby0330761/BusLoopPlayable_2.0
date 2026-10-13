#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

LIB_ROOT = Path(__file__).resolve().parent / "lib"
sys.path.insert(0, str(LIB_ROOT))

from resource_common import is_within, load_json, utc_now, write_json_atomic

from source_freeze import SCHEMA, validate_freeze


FAILURE_SCOPES = {"resource", "shared-source", "platform-source", "packaging", "hardening", "checker-observation"}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="根据冻结输入图计算失败后的最小安全重建范围")
    parser.add_argument("--freeze", required=True, type=Path)
    parser.add_argument("--failure-scope", required=True, choices=sorted(FAILURE_SCOPES))
    parser.add_argument(
        "--changed-path", action="append", default=[], type=Path,
        help="变化文件；相对路径固定按 source freeze 中的项目根目录解析",
    )
    parser.add_argument("--platform", action="append", default=[])
    parser.add_argument("--output", required=True, type=Path)
    return parser.parse_args()


def resolve_changed_paths(freeze: dict[str, Any], changed_paths: list[Path]) -> list[Path]:
    project_root_value = str(freeze.get("projectRoot") or "").strip()
    project_root = Path(project_root_value).expanduser().resolve() if project_root_value else None
    resolved_paths = []
    for changed in changed_paths:
        expanded = changed.expanduser()
        if expanded.is_absolute():
            resolved_paths.append(expanded.resolve())
            continue
        if project_root is None:
            raise ValueError("source freeze 缺少 projectRoot，--changed-path 必须使用绝对路径")
        resolved_paths.append((project_root / expanded).resolve())
    return resolved_paths


def matching_platforms(freeze: dict[str, Any], changed_paths: list[Path]) -> tuple[set[str], bool]:
    matched: set[str] = set()
    shared = False
    for changed in changed_paths:
        resolved = changed.resolve()
        for reference in freeze.get("inputs") or []:
            root = Path(str(reference.get("path") or "")).expanduser().resolve()
            if resolved == root or is_within(root, resolved) or (resolved.exists() and resolved.is_dir() and is_within(resolved, root)):
                scopes = set(reference.get("scopes") or [])
                if "resource" in scopes or "shared-source" in scopes:
                    shared = True
                matched.update(reference.get("platforms") or [])
    return matched, shared


def build_plan(freeze: dict[str, Any], scope: str, changed_paths: list[Path], declared_platforms: list[str]) -> dict[str, Any]:
    platforms = set(freeze.get("platforms") or [])
    unknown = sorted(set(declared_platforms) - platforms)
    if unknown:
        raise ValueError("指定平台不在冻结矩阵中：" + "、".join(unknown))
    resolved_changed_paths = resolve_changed_paths(freeze, changed_paths)
    matched, shared_match = matching_platforms(freeze, resolved_changed_paths)
    explicit = set(declared_platforms)
    policy = freeze.get("rebuildPolicy")
    requires_gate_a = scope == "resource"
    requires_gate_b = scope == "resource"
    if scope == "checker-observation":
        rebuild: set[str] = set()
        invalidate = "CHECKER_ACCEPTANCE_RECORDED"
    elif scope == "hardening" and not explicit and not matched:
        # A freeze-wide final hardening pass changes every target artifact. When
        # no narrower platform/input scope is declared, the only safe plan is
        # the complete frozen matrix, even under impact-aware policy.
        rebuild = set(platforms)
        invalidate = "APPLOVIN_CANDIDATE_BUILT"
    elif policy == "full-matrix" or scope in {"resource", "shared-source"} or shared_match:
        rebuild = set(platforms)
        invalidate = "RESOURCE_TRIAL_PROPOSED" if scope == "resource" else "APPLOVIN_CANDIDATE_BUILT"
    else:
        rebuild = explicit | matched
        if not rebuild:
            raise ValueError("无法证明安全影响范围；请指定 --platform，或使用 full-matrix 策略")
        invalidate = "APPLOVIN_CANDIDATE_BUILT" if "applovin" in rebuild else "PLATFORM_CANDIDATE_BUILT"
    return {
        "schemaVersion": "playable-rebuild-scope-plan-v1",
        "generatedAt": utc_now(),
        "sourceFreezeFingerprint": freeze.get("sourceFingerprint"),
        "failureScope": scope,
        "changedPaths": [str(item) for item in resolved_changed_paths],
        "declaredPlatforms": sorted(explicit),
        "matchedPlatforms": sorted(matched),
        "sharedInputMatched": shared_match,
        "rebuildPolicy": policy,
        "rebuildPlatforms": sorted(rebuild),
        "invalidateFromState": invalidate,
        "requiresNewGateA": requires_gate_a,
        "requiresNewGateB": requires_gate_b,
        "checkerOnly": scope == "checker-observation",
        "userConclusion": (
            "仅需重新记录 Checker 页面证据和交付报告，artifact 无需重建"
            if scope == "checker-observation" else
            "必须从真实生成链重建这些平台：" + "、".join(sorted(rebuild))
        ),
    }


def main() -> int:
    args = parse_args()
    try:
        freeze = validate_freeze(load_json(args.freeze.expanduser().resolve()))
        report = build_plan(freeze, args.failure_scope, args.changed_path, args.platform)
        write_json_atomic(args.output, report)
        print(json.dumps(report, ensure_ascii=False, indent=2))
        return 0
    except (OSError, ValueError, json.JSONDecodeError) as exc:
        print(json.dumps({"ok": False, "error": str(exc)}, ensure_ascii=False, indent=2))
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
