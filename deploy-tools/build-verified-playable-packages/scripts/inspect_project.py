#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

LIB_ROOT = Path(__file__).resolve().parent / "lib"
sys.path.insert(0, str(LIB_ROOT))

from resource_common import sha256_file, utc_now, write_json_atomic


PLATFORMS = ("applovin", "google-ads", "meta", "unityads", "mintegral", "moloco", "tiktok")
PROJECT_MARKERS = ("package.json", "vite.config.ts", "vite.config.js", "src", "public")
DOCUMENTS = (
    "AGENTS.md",
    "CLAUDE.md",
    "README.md",
    "docs/project/playable-project-progress.md",
    "docs/project/playable-core-rules.md",
    "docs/project/playable-resource-status.md",
    "docs/project/playable-multi-platform-execution-plan.md",
)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="识别具体 playable 工程、资源根和平台构建事实")
    parser.add_argument("--project-root", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    return parser.parse_args()


def read_package(path: Path) -> tuple[dict[str, Any], str | None]:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        return {}, str(exc)
    if not isinstance(value, dict):
        return {}, "package.json 顶层不是对象"
    return value, None


def package_files(root: Path) -> list[Path]:
    results: list[Path] = []
    for candidate in root.rglob("package.json"):
        relative = candidate.relative_to(root)
        if any(part in {"node_modules", ".git", "dist", "build"} for part in relative.parts):
            continue
        if len(relative.parts) <= 5:
            results.append(candidate)
    return sorted(results)


def classify_scripts(scripts: dict[str, Any]) -> tuple[dict[str, str], dict[str, dict[str, str]]]:
    generic: dict[str, str] = {}
    platform: dict[str, dict[str, str]] = {name: {} for name in PLATFORMS}
    aliases = {
        "google-ads": ("google", "adwords"),
        "unityads": ("unity", "unityads"),
        "applovin": ("applovin", "app-lovin"),
        "mintegral": ("mintegral", "playturbo"),
        "meta": ("meta", "facebook"),
        "moloco": ("moloco",),
        "tiktok": ("tiktok", "tik-tok"),
    }
    for name, command in scripts.items():
        if not isinstance(name, str) or not isinstance(command, str):
            continue
        lower = f"{name} {command}".lower()
        matched = False
        for platform_name, terms in aliases.items():
            if any(term in lower for term in terms):
                platform[platform_name][name] = command
                matched = True
        if not matched and (name == "build" or name.startswith("build:")):
            generic[name] = command
    return generic, {name: value for name, value in platform.items() if value}


def inspect(root: Path) -> dict[str, Any]:
    root = root.expanduser().resolve()
    if not root.is_dir():
        raise ValueError(f"项目目录不存在或不是目录：{root}")
    nested_projects = []
    for child in sorted(item for item in root.iterdir() if item.is_dir()):
        if any((child / marker).exists() for marker in PROJECT_MARKERS):
            nested_projects.append(str(child))
    root_has_markers = any((root / marker).exists() for marker in PROJECT_MARKERS)
    if not root_has_markers and len(nested_projects) > 1:
        raise ValueError("目标目录像多项目工作区，请指定一个具体 playable 工程：" + ", ".join(nested_projects))

    packages = []
    all_generic: list[dict[str, Any]] = []
    all_platform: dict[str, list[dict[str, Any]]] = {name: [] for name in PLATFORMS}
    warnings: list[str] = []
    for package_path in package_files(root):
        value, error = read_package(package_path)
        if error:
            warnings.append(f"PACKAGE_JSON_INVALID:{package_path}:{error}")
            continue
        scripts = value.get("scripts") if isinstance(value.get("scripts"), dict) else {}
        generic, platform = classify_scripts(scripts)
        package_record = {
            "path": str(package_path),
            "sha256": sha256_file(package_path),
            "name": value.get("name"),
            "genericBuildScripts": generic,
            "platformBuildScripts": platform,
        }
        packages.append(package_record)
        for name, command in generic.items():
            all_generic.append({"packageJson": str(package_path), "name": name, "command": command})
        for platform_name, items in platform.items():
            for name, command in items.items():
                all_platform[platform_name].append(
                    {"packageJson": str(package_path), "name": name, "command": command}
                )

    locks = [name for name in ("pnpm-lock.yaml", "package-lock.json", "yarn.lock", "bun.lockb") if (root / name).is_file()]
    if "pnpm-lock.yaml" in locks:
        manager = "pnpm"
    elif "package-lock.json" in locks:
        manager = "npm"
    elif "yarn.lock" in locks:
        manager = "yarn"
    elif "bun.lockb" in locks:
        manager = "bun"
    else:
        manager = None

    documents = []
    for relative in DOCUMENTS:
        path = root / relative
        if path.is_file():
            documents.append({"path": relative, "sha256": sha256_file(path)})

    adapters = []
    for relative in (
        "docs/project/playable-package-build-adapter.json",
        "docs/project/playable-resource-optimizer-adapter.json",
    ):
        path = root / relative
        if path.is_file():
            adapters.append({"path": relative, "sha256": sha256_file(path)})

    return {
        "schemaVersion": "playable-package-project-inspection-v1",
        "generatedAt": utc_now(),
        "projectRoot": str(root),
        "packageManager": manager,
        "lockfiles": locks,
        "packages": packages,
        "documents": documents,
        "adapters": adapters,
        "buildCapabilities": {
            "generic": all_generic,
            "platform": {name: items for name, items in all_platform.items() if items},
            "note": "普通 build 不自动视为任一平台的正式构建入口",
        },
        "warnings": warnings,
    }


def main() -> int:
    args = parse_args()
    try:
        report = inspect(args.project_root)
        write_json_atomic(args.output, report)
    except (OSError, ValueError) as exc:
        print(json.dumps({"ok": False, "error": str(exc)}, ensure_ascii=False, indent=2))
        return 1
    print(json.dumps({"ok": True, "output": str(args.output.resolve())}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
