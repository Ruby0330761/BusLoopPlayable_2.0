#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
from typing import Any

from inspect_project import PLATFORMS, inspect

LIB_ROOT = Path(__file__).resolve().parent / "lib"
import sys

sys.path.insert(0, str(LIB_ROOT))

from resource_common import git_worktree_root, utc_now, write_json_atomic


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="为首次接入生成 Adapter 草案、Git 忽略建议和一次性缺项清单")
    parser.add_argument("--project-root", required=True, type=Path)
    parser.add_argument("--adapter-draft-out", required=True, type=Path)
    parser.add_argument("--gitignore-suggestion-out", required=True, type=Path)
    parser.add_argument("--report-out", required=True, type=Path)
    return parser.parse_args()


def existing_relative_roots(project_root: Path, values: tuple[str, ...]) -> list[str]:
    return [value for value in values if (project_root / value).exists()]


def reference_entrypoints(project_root: Path) -> list[str]:
    preferred = ["playable.html", "index.html", "src/main.tsx", "src/main.ts", "src/main.jsx", "src/main.js"]
    result = existing_relative_roots(project_root, tuple(preferred))
    if not result and (project_root / "src").is_dir():
        result = [
            path.relative_to(project_root).as_posix()
            for path in sorted((project_root / "src").rglob("*"))
            if path.is_file() and path.suffix in {".ts", ".tsx", ".js", ".jsx"}
        ][:8]
    return result


def platform_builds(project_root: Path, inspection: dict[str, Any]) -> tuple[dict[str, Any], list[str]]:
    builds: dict[str, Any] = {}
    missing: list[str] = []
    universal = project_root / "scripts/build-platform.mjs"
    detected = (inspection.get("buildCapabilities") or {}).get("platform") or {}
    for platform in PLATFORMS:
        candidates = detected.get(platform) or []
        if universal.is_file():
            command = ["node", "scripts/build-platform.mjs", "--platform", platform]
        elif candidates:
            package = Path(candidates[0]["packageJson"]).parent
            relative_package = package.relative_to(project_root).as_posix()
            prefix = ["npm", "--prefix", relative_package] if relative_package != "." else ["npm"]
            command = [*prefix, "run", candidates[0]["name"]]
        else:
            command = ["TODO", f"填写 {platform} 的真实 argv 构建命令"]
            missing.append(f"{platform}：缺少已证明的平台构建命令和最终输出路径")
        builds[platform] = {
            "command": command,
            "output": f"TODO/{platform}/填写最终文件名",
            "delivery": "html" if platform in {"applovin", "unityads", "moloco"} else "zip",
        }
    return builds, missing


def main() -> int:
    args = parse_args()
    try:
        project_root = args.project_root.expanduser().resolve()
        inspection = inspect(project_root)
        working = existing_relative_roots(project_root, ("public/assets", "public/shapes", "public/levels", "assets"))
        entrypoints = reference_entrypoints(project_root)
        builds, missing = platform_builds(project_root, inspection)
        product_root = git_worktree_root(project_root)
        run_root_base = "product-root" if product_root else "project-root"
        stable_root = (product_root or project_root) / "playable-runs"
        if not working:
            missing.append("资源边界：未识别到 playable 工作资源目录，请填写 playableWorkingRoots")
        if product_root is None:
            missing.append("产品仓根：未识别到 Git worktree；新运行前必须先明确产品仓根，不能把运行目录藏到 playable 工程内")
        missing.extend([
            "只读来源：请填写 Unity/raw/高质量来源的 immutableSourceRoots；这些目录始终只读",
            "覆盖范围：请从工作资源中明确选择允许覆盖的 overwriteEligibleRoots；不要默认覆盖全部资源",
            "输出路径：请把各平台的 TODO 输出替换为真实最终文件路径",
        ])
        draft = {
            "schemaVersion": "playable-package-build-adapter-v2",
            "draft": True,
            "generatedAt": utc_now(),
            "projectRoot": str(project_root),
            "resources": {
                "immutableSourceRoots": ["TODO:填写只读来源目录"],
                "playableWorkingRoots": working or ["TODO:填写 playable 工作资源目录"],
                "candidateRoots": ["playable-runs"],
                "overwriteEligibleRoots": ["TODO:逐项填写允许覆盖的工作资源目录"],
                "referenceEntrypoints": entrypoints or ["TODO:填写实际入口或配置"],
                "activeVariantConfigs": [],
                "runRootBase": run_root_base,
                "runRoot": "playable-runs",
                "rollbackRoot": "playable-runs",
            },
            "platformBuilds": builds,
            "packaging": {
                "deterministicZipCommand": ["python3", str((Path(__file__).resolve().parent / "deterministic_zip.py"))],
                "doubleWriteVerification": True,
            },
            "executionEfficiency": {
                "enabled": False,
                "parallelBuilds": False,
                "buildConcurrency": 1,
                "runtimeConcurrency": 1,
                "rebuildPolicy": "impact-aware",
                "sharedInputs": [],
                "platformInputs": {},
                "plainArgs": [],
                "finalArgs": [],
            },
            "allowedWriteRoots": [*working, "dist-verified", "src", "scripts", "docs/project"],
            "protectedRoots": [],
        }
        write_json_atomic(args.adapter_draft_out, draft)
        ignore_root = product_root or project_root
        relative_project = project_root.relative_to(ignore_root)
        dist_ignore = (
            "dist-verified/"
            if relative_project == Path(".")
            else f"{relative_project.as_posix()}/dist-verified/"
        )
        ignore_entries = ("playable-runs/", dist_ignore)
        suggestion = (
            f"# 建议追加到 {ignore_root}/.gitignore；此文件不会自动修改项目\n"
            + "\n".join(ignore_entries)
            + "\n"
        )
        suggestion_path = args.gitignore_suggestion_out.expanduser().resolve()
        suggestion_path.parent.mkdir(parents=True, exist_ok=True)
        suggestion_path.write_text(suggestion, encoding="utf-8")
        gitignore = ignore_root / ".gitignore"
        existing_ignore = gitignore.read_text(encoding="utf-8") if gitignore.is_file() else ""
        ignored_missing = [value for value in ignore_entries if value not in existing_ignore]
        if ignored_missing:
            missing.append("Git 忽略：建议加入 " + "、".join(ignored_missing) + "；Skill 不会自动修改 .gitignore")
        report = {
            "schemaVersion": "playable-package-onboarding-report-v1",
            "generatedAt": utc_now(),
            "projectRoot": str(project_root),
            "productRoot": str(product_root) if product_root else None,
            "runRootBase": run_root_base,
            "runRoot": str(stable_root.resolve()),
            "gitignoreTarget": str(gitignore.resolve()),
            "ready": False,
            "userConclusion": "首次接入草案已生成；请一次性补齐下面各项，完成后日常打包不再需要处理这些配置",
            "missingItems": missing,
            "adapterDraft": str(args.adapter_draft_out.expanduser().resolve()),
            "gitignoreSuggestion": str(suggestion_path),
        }
        write_json_atomic(args.report_out, report)
        print(json.dumps(report, ensure_ascii=False, indent=2))
        return 0
    except (OSError, ValueError, json.JSONDecodeError) as exc:
        print(json.dumps({"ok": False, "error": str(exc)}, ensure_ascii=False, indent=2))
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
