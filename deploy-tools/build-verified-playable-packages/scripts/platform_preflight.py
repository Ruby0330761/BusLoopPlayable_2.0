#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

SCRIPT_ROOT = Path(__file__).resolve().parent
LIB_ROOT = SCRIPT_ROOT / "lib"
sys.path.insert(0, str(LIB_ROOT))
sys.path.insert(0, str(SCRIPT_ROOT))

from resource_common import is_within, load_json, resolve_project_path, utc_now, write_json_atomic
from rules import verify_ruleset
from validate_adapter import PLATFORMS, validate as validate_adapter


EXPECTED_DELIVERY = {
    "applovin": "html",
    "google-ads": "zip",
    "meta": "zip",
    "unityads": "html",
    "mintegral": "zip",
    "moloco": "html",
    "tiktok": "zip",
}
SOURCE_TOKENS = {
    "applovin": ("ALPlayableAnalytics", "mraid.open"),
    "google-ads": ("ExitApi", "imageAsset"),
    "meta": ("FbPlayableAd", "imageAsset"),
    "unityads": ("mraid.open", "viewableChange", "sizeChange"),
    "mintegral": ("install", "gameReady", "gameStart", "gameEnd"),
    "moloco": ("FbPlayableAd", "onCTAClick"),
    "tiktok": ("openAppStore",),
}
TEXT_SUFFIXES = {".js", ".mjs", ".cjs", ".ts", ".tsx", ".jsx", ".html", ".json", ".css"}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="在平台构建前只读检查 Adapter、输出隔离和关键契约入口")
    parser.add_argument("--project-root", required=True, type=Path)
    parser.add_argument("--adapter", required=True, type=Path)
    parser.add_argument("--platform", action="append", choices=sorted(PLATFORMS))
    parser.add_argument("--output", required=True, type=Path)
    return parser.parse_args()


def path_text(paths: list[str]) -> str:
    chunks: list[str] = []
    for value in paths:
        path = Path(value)
        candidates = [path] if path.is_file() else [
            item for item in path.rglob("*")
            if item.is_file() and item.suffix.lower() in TEXT_SUFFIXES
        ]
        for item in candidates:
            if item.suffix.lower() not in TEXT_SUFFIXES or item.stat().st_size > 8 * 1024 * 1024:
                continue
            try:
                chunks.append(item.read_text(encoding="utf-8", errors="ignore"))
            except OSError:
                continue
    return "\n".join(chunks)


def build_report(project_root: Path, adapter_path: Path, requested: list[str] | None) -> dict[str, Any]:
    project_root = project_root.expanduser().resolve()
    adapter_path = adapter_path.expanduser().resolve()
    adapter = load_json(adapter_path)
    validation = validate_adapter(project_root, adapter_path)
    configured = validation.get("platformCapabilities") or {}
    targets = requested or sorted(configured)
    blockers: list[str] = []
    notes: list[str] = []
    if not validation.get("valid"):
        blockers.extend(f"Adapter：{item}" for item in validation.get("errors") or [])
    if any(platform != "applovin" for platform in targets) and "applovin" not in configured:
        blockers.append("其他平台必须依赖 AppLovin 基线，但 Adapter 未声明 AppLovin 构建")
    allowed_roots = []
    for value in adapter.get("allowedWriteRoots") or []:
        try:
            allowed_roots.append(resolve_project_path(project_root, value))
        except (TypeError, ValueError):
            continue
    output_paths: dict[str, Path] = {}
    platform_reports: list[dict[str, Any]] = []
    efficiency = validation.get("executionEfficiency") or {}
    shared_inputs = efficiency.get("sharedInputs") or []
    platform_inputs = efficiency.get("platformInputs") or {}
    for platform in targets:
        capability = configured.get(platform)
        platform_blockers: list[str] = []
        platform_notes: list[str] = []
        if not isinstance(capability, dict):
            platform_blockers.append("Adapter 未声明该平台构建")
            platform_reports.append({"platform": platform, "ready": False, "blockers": platform_blockers, "notes": []})
            blockers.extend(f"{platform}：{item}" for item in platform_blockers)
            continue
        delivery = capability.get("delivery")
        if delivery != EXPECTED_DELIVERY[platform]:
            platform_blockers.append(f"交付类型应为 {EXPECTED_DELIVERY[platform]}，当前为 {delivery}")
        output_path = Path(str(capability.get("output") or "")).expanduser().resolve()
        output_paths[platform] = output_path
        expected_suffixes = {".html", ".htm"} if delivery == "html" else {".zip"}
        if output_path.suffix.lower() not in expected_suffixes:
            platform_blockers.append(f"输出扩展名与 {delivery} 交付类型不一致：{output_path.name}")
        if allowed_roots and not any(is_within(root, output_path) for root in allowed_roots):
            platform_blockers.append("输出路径不在 allowedWriteRoots")
        inputs = [*shared_inputs, *(platform_inputs.get(platform) or [])]
        source = path_text(inputs) if inputs else ""
        token_status = {token: token in source for token in SOURCE_TOKENS[platform]}
        if efficiency.get("enabled"):
            missing_tokens = [token for token, found in token_status.items() if not found]
            if missing_tokens:
                platform_notes.append(
                    "只读输入中未定位到关键入口：" + "、".join(missing_tokens) + "；必须在 plain 运行时检查中证明，不能推迟到 Checker"
                )
        else:
            platform_notes.append("效率编排未启用，本轮继续使用现有串行流程")
        if not capability.get("ctaSelector"):
            platform_notes.append("未声明稳定 CTA selector，运行时检查将只识别可见且具有明确 CTA 语义的元素")
        blockers.extend(f"{platform}：{item}" for item in platform_blockers)
        notes.extend(f"{platform}：{item}" for item in platform_notes)
        platform_reports.append({
            "platform": platform,
            "ready": not platform_blockers,
            "delivery": delivery,
            "command": capability.get("command"),
            "output": str(output_path),
            "sourceContractTokens": token_status,
            "blockers": platform_blockers,
            "notes": platform_notes,
            "runtimeProofRequired": True,
        })
    reverse: dict[str, list[str]] = {}
    for platform, path in output_paths.items():
        reverse.setdefault(str(path), []).append(platform)
    for path, platforms in reverse.items():
        if len(platforms) > 1:
            blockers.append(f"平台输出路径重复：{path} 被 {', '.join(sorted(platforms))} 共用")
    if (
        efficiency.get("enabled")
        and efficiency.get("parallelBuilds")
        and int(efficiency.get("buildConcurrency") or 1) > 1
    ):
        platform_paths = sorted(output_paths.items())
        for index, (left_platform, left_output) in enumerate(platform_paths):
            for right_platform, right_output in platform_paths[index + 1:]:
                left_root = left_output.parent
                right_root = right_output.parent
                if left_root == right_root or left_root in right_root.parents or right_root in left_root.parents:
                    blockers.append(
                        "并行输出目录重叠："
                        f"{left_platform}={left_root}，{right_platform}={right_root}；请改为独立目录或串行构建"
                    )
    ruleset = verify_ruleset()
    parallel_ready = bool(
        not blockers
        and efficiency.get("enabled")
        and efficiency.get("parallelBuilds")
        and int(efficiency.get("buildConcurrency") or 1) > 1
    )
    return {
        "schemaVersion": "playable-platform-preflight-v1",
        "generatedAt": utc_now(),
        "projectRoot": str(project_root),
        "adapterValidation": {
            "path": str(adapter_path),
            "valid": validation.get("valid"),
            "sha256": (validation.get("adapter") or {}).get("sha256"),
        },
        "ruleset": {
            "version": ruleset.get("rulesetVersion"),
            "sha256": ruleset.get("rulesetSha256"),
        },
        "targets": targets,
        "platforms": platform_reports,
        "executionEfficiency": efficiency,
        "parallelExecutionReady": parallel_ready,
        "ready": not blockers,
        "blockers": blockers,
        "notes": notes,
        "userConclusion": (
            "平台构建入口和输出隔离已通过只读预检；plain 候选仍须逐平台完成真实运行时证明"
            if not blockers else
            "平台只读预检发现阻塞；修复 Adapter 或构建配置后才能开始平台构建"
        ),
    }


def main() -> int:
    args = parse_args()
    try:
        report = build_report(args.project_root, args.adapter, args.platform)
        write_json_atomic(args.output, report)
        print(json.dumps(report, ensure_ascii=False, indent=2))
        return 0 if report["ready"] else 1
    except (OSError, ValueError, json.JSONDecodeError) as exc:
        print(json.dumps({"ok": False, "error": str(exc)}, ensure_ascii=False, indent=2))
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
