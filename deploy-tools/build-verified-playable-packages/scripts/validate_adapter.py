#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
from pathlib import Path
from typing import Any

LIB_ROOT = Path(__file__).resolve().parent / "lib"
sys.path.insert(0, str(LIB_ROOT))

from resource_common import git_worktree_root, load_json, resolve_project_path, sha256_file, utc_now, write_json_atomic


PLATFORMS = {"applovin", "google-ads", "meta", "unityads", "mintegral", "moloco", "tiktok"}
FORBIDDEN_COMMANDS = {"git", "rm", "scp", "rsync", "curl", "wget", "sudo", "ssh"}
FORBIDDEN_TOKENS = re.compile(r"(?:&&|\|\||[;<>`]|\$\(|\r|\n)")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="校验统一资源与平台构建 adapter")
    parser.add_argument("--project-root", required=True, type=Path)
    parser.add_argument("--adapter", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    return parser.parse_args()


def package_scripts(project_root: Path) -> dict[str, set[str]]:
    result: dict[str, set[str]] = {}
    for package_path in project_root.rglob("package.json"):
        if any(part in {"node_modules", ".git", "dist", "build"} for part in package_path.relative_to(project_root).parts):
            continue
        try:
            package = load_json(package_path)
        except (OSError, json.JSONDecodeError):
            continue
        scripts = package.get("scripts") if isinstance(package, dict) else None
        if isinstance(scripts, dict):
            result[str(package_path.parent.resolve())] = {name for name in scripts if isinstance(name, str)}
    return result


def validate_argv(project_root: Path, argv: object, package_map: dict[str, set[str]], label: str) -> list[str]:
    errors = []
    if not isinstance(argv, list) or not argv or not all(isinstance(item, str) and item for item in argv):
        return [f"{label}:命令必须是非空 argv 数组"]
    if Path(argv[0]).name.lower() in FORBIDDEN_COMMANDS:
        errors.append(f"{label}:禁止命令 {argv[0]}")
    if argv[0] in {"sh", "bash", "zsh"} and len(argv) > 1 and argv[1] == "-c":
        errors.append(f"{label}:禁止 shell -c")
    for value in argv:
        if FORBIDDEN_TOKENS.search(value):
            errors.append(f"{label}:包含 shell 元字符")
            break
    executable = Path(argv[0]).name
    if executable in {"npm", "pnpm", "yarn", "bun"} and "run" in argv:
        index = argv.index("run")
        if index + 1 >= len(argv):
            errors.append(f"{label}:缺少 package script 名")
        else:
            script = argv[index + 1]
            if not any(script in names for names in package_map.values()):
                errors.append(f"{label}:package script 不存在：{script}")
    if executable.startswith("python") or executable == "node":
        for value in argv[1:2]:
            if value.startswith("-"):
                continue
            script_path = Path(value)
            if not script_path.is_absolute():
                script_path = project_root / script_path
            if not script_path.is_file():
                errors.append(f"{label}:脚本不存在：{value}")
    return errors


def path_list(project_root: Path, value: object, label: str, errors: list[str]) -> list[str]:
    if not isinstance(value, list) or not all(isinstance(item, str) for item in value):
        errors.append(f"{label}:必须是项目相对路径数组")
        return []
    normalized = []
    for item in value:
        try:
            normalized.append(str(resolve_project_path(project_root, item)))
        except ValueError as exc:
            errors.append(f"{label}:{exc}")
    return normalized


def boundary_path_list(
    project_root: Path,
    value: object,
    label: str,
    errors: list[str],
    *,
    allow_external_absolute: bool = False,
) -> list[str]:
    if not isinstance(value, list) or not value or not all(isinstance(item, str) and item for item in value):
        errors.append(f"{label}:必须是非空路径数组")
        return []
    normalized: list[str] = []
    for item in value:
        raw = Path(item).expanduser()
        try:
            if raw.is_absolute():
                if not allow_external_absolute:
                    raise ValueError("只允许项目相对路径")
                resolved = raw.resolve()
            else:
                resolved = resolve_project_path(project_root, item)
            if resolved.is_symlink():
                raise ValueError("根目录不能是符号链接")
            normalized.append(str(resolved))
        except (OSError, ValueError, TypeError) as exc:
            errors.append(f"{label}:{item}:{exc}")
    return normalized


def contains(root: str, child: str) -> bool:
    first, second = Path(root), Path(child)
    return first == second or first in second.parents


def git_ignored(project_root: Path, target: Path) -> bool:
    repository_root = git_worktree_root(project_root)
    if repository_root is None:
        return False
    try:
        relative = target.resolve().relative_to(repository_root).as_posix()
    except ValueError:
        return False
    try:
        probes = [relative, f"{relative.rstrip('/')}/.codex-run-root-probe"]
        for probe in probes:
            completed = subprocess.run(
                ["git", "-C", str(repository_root), "check-ignore", "-q", "--no-index", "--", probe],
                capture_output=True,
                timeout=5,
                check=False,
            )
            if completed.returncode == 0:
                return True
    except (OSError, subprocess.TimeoutExpired):
        return False
    return False


def validate(project_root: Path, adapter_path: Path) -> dict[str, Any]:
    project_root = project_root.expanduser().resolve()
    adapter_path = adapter_path.expanduser().resolve()
    adapter = load_json(adapter_path)
    if not isinstance(adapter, dict) or adapter.get("schemaVersion") not in {
        "playable-package-build-adapter-v1", "playable-package-build-adapter-v2",
    }:
        raise ValueError("adapter schemaVersion 必须为 playable-package-build-adapter-v1 或 v2")
    schema = adapter["schemaVersion"]
    errors: list[str] = []
    resources = adapter.get("resources")
    if not isinstance(resources, dict):
        errors.append("resources:必须是对象")
        resources = {}
    path_list(project_root, resources.get("referenceEntrypoints"), "resources.referenceEntrypoints", errors)
    path_list(project_root, resources.get("activeVariantConfigs", []), "resources.activeVariantConfigs", errors)
    allowed = path_list(project_root, adapter.get("allowedWriteRoots"), "allowedWriteRoots", errors)
    protected = path_list(project_root, adapter.get("protectedRoots", []), "protectedRoots", errors)

    boundaries: dict[str, Any] = {"applyCapable": False}
    if schema == "playable-package-build-adapter-v2":
        product_root = git_worktree_root(project_root)
        run_root_base_name = resources.get("runRootBase", "project-root")
        if run_root_base_name not in {"project-root", "product-root"}:
            errors.append("resources.runRootBase:只允许 project-root 或 product-root")
            run_root_base_name = "project-root"
        if run_root_base_name == "product-root" and product_root is None:
            errors.append("resources.runRootBase:无法从 playable 工程识别产品 Git 仓根")
        run_boundary_base = product_root if run_root_base_name == "product-root" and product_root else project_root
        immutable = boundary_path_list(
            project_root, resources.get("immutableSourceRoots"), "resources.immutableSourceRoots", errors,
            allow_external_absolute=True,
        )
        working = boundary_path_list(
            project_root, resources.get("playableWorkingRoots"), "resources.playableWorkingRoots", errors,
        )
        candidates = boundary_path_list(
            run_boundary_base, resources.get("candidateRoots"), "resources.candidateRoots", errors,
        )
        overwrite = boundary_path_list(
            project_root, resources.get("overwriteEligibleRoots"), "resources.overwriteEligibleRoots", errors,
        )
        run_root_value = resources.get("runRoot")
        rollback_root_value = resources.get("rollbackRoot")
        try:
            run_root = resolve_project_path(run_boundary_base, run_root_value)
        except (ValueError, TypeError) as exc:
            errors.append(f"resources.runRoot:{exc}")
            run_root = None
        try:
            rollback_root = resolve_project_path(run_boundary_base, rollback_root_value)
        except (ValueError, TypeError) as exc:
            errors.append(f"resources.rollbackRoot:{exc}")
            rollback_root = None

        for left in immutable:
            for right in working + candidates:
                if contains(left, right) or contains(right, left):
                    errors.append(f"资源层级重叠：{left} / {right}")
        for target in overwrite:
            if not any(contains(root, target) for root in working):
                errors.append(f"overwriteEligibleRoot 不在 playableWorkingRoots：{target}")
            if not any(contains(root, target) for root in allowed):
                errors.append(f"overwriteEligibleRoot 不在 allowedWriteRoots：{target}")
        if run_root_base_name == "product-root" and product_root is not None:
            canonical_run_root = (product_root / "playable-runs").resolve()
            if run_root and run_root != canonical_run_root:
                errors.append(f"product-root 模式的 runRoot 必须固定为：{canonical_run_root}")
            for candidate in candidates:
                if not contains(str(canonical_run_root), candidate):
                    errors.append(f"product-root 模式的 candidateRoot 必须位于固定运行根：{candidate}")
        else:
            for candidate in candidates:
                if not any(contains(root, candidate) for root in allowed):
                    errors.append(f"candidateRoot 不在 allowedWriteRoots：{candidate}")
        if run_root and not any(contains(root, str(run_root)) for root in candidates):
            errors.append("runRoot 必须位于 candidateRoots")
        if rollback_root and run_root and not contains(str(run_root), str(rollback_root)):
            errors.append("rollbackRoot 必须位于 runRoot")
        if run_root and not git_ignored(project_root, run_root):
            errors.append(f"runRoot 尚未被 Git 忽略：{run_root}")
        boundaries = {
            "applyCapable": not errors,
            "runRootBase": run_root_base_name,
            "productRoot": str(product_root) if product_root else None,
            "immutableSourceRoots": immutable,
            "playableWorkingRoots": working,
            "candidateRoots": candidates,
            "overwriteEligibleRoots": overwrite,
            "runRoot": str(run_root) if run_root else None,
            "rollbackRoot": str(rollback_root) if rollback_root else None,
        }
    else:
        source_roots = path_list(project_root, resources.get("sourceRoots"), "resources.sourceRoots", errors)
        generated_roots = path_list(project_root, resources.get("generatedRoots"), "resources.generatedRoots", errors)
        for generated in generated_roots:
            for protected_path in source_roots + protected:
                first, second = Path(generated), Path(protected_path)
                if first == second or first in second.parents or second in first.parents:
                    errors.append(f"路径重叠：{generated} / {protected_path}")
            if not any(contains(item, generated) for item in allowed):
                errors.append(f"generatedRoot 不在 allowedWriteRoots：{generated}")
        boundaries["legacyReadOnly"] = True

    package_map = package_scripts(project_root)
    rebuild = resources.get("rebuildCommand")
    if rebuild is not None:
        errors.extend(validate_argv(project_root, rebuild, package_map, "resources.rebuildCommand"))
    builds = adapter.get("platformBuilds")
    if not isinstance(builds, dict):
        errors.append("platformBuilds:必须是对象")
        builds = {}
    capabilities = {}
    has_zip_delivery = False
    for platform, build in builds.items():
        if platform not in PLATFORMS or not isinstance(build, dict):
            errors.append(f"platformBuilds.{platform}:平台或配置无效")
            continue
        command = build.get("command")
        output = build.get("output")
        resource_receipt = build.get("resourceReceipt")
        cta_selector = build.get("ctaSelector")
        if cta_selector is not None and (not isinstance(cta_selector, str) or not cta_selector.strip()):
            errors.append(f"platformBuilds.{platform}.ctaSelector:必须是非空 CSS selector")
        errors.extend(validate_argv(project_root, command, package_map, f"platformBuilds.{platform}.command"))
        try:
            output_path = resolve_project_path(project_root, output)
        except (ValueError, TypeError) as exc:
            errors.append(f"platformBuilds.{platform}.output:{exc}")
            output_path = None
        try:
            resource_receipt_path = resolve_project_path(project_root, resource_receipt) if resource_receipt is not None else None
        except (ValueError, TypeError) as exc:
            errors.append(f"platformBuilds.{platform}.resourceReceipt:{exc}")
            resource_receipt_path = None
        capabilities[platform] = {
            "command": command,
            "output": str(output_path) if output_path else output,
            "delivery": build.get("delivery"),
            "ctaSelector": cta_selector.strip() if isinstance(cta_selector, str) else None,
            "resourceReceipt": str(resource_receipt_path) if resource_receipt_path else None,
        }
        has_zip_delivery = has_zip_delivery or build.get("delivery") == "zip"
    packaging = adapter.get("packaging")
    if has_zip_delivery:
        if not isinstance(packaging, dict):
            errors.append("packaging:存在 ZIP 平台时必须声明确定性打包器")
        else:
            errors.extend(validate_argv(project_root, packaging.get("deterministicZipCommand"), package_map, "packaging.deterministicZipCommand"))
            if packaging.get("doubleWriteVerification") is not True:
                errors.append("packaging.doubleWriteVerification:必须为 true")
    thresholds = adapter.get("performanceThresholds")
    allowed_thresholds = {"maxLongTaskMs", "maxP95FrameIntervalMs", "minApproximateFps", "maxDomContentLoadedMs"}
    if thresholds is not None:
        if not isinstance(thresholds, dict) or not thresholds:
            errors.append("performanceThresholds:必须是非空对象")
        else:
            unknown = sorted(set(thresholds) - allowed_thresholds)
            if unknown:
                errors.append("performanceThresholds:不支持 " + ", ".join(unknown))
            for name, value in thresholds.items():
                if not isinstance(value, (int, float)) or isinstance(value, bool) or value < 0:
                    errors.append(f"performanceThresholds.{name}:必须是非负数")
    efficiency_value = adapter.get("executionEfficiency")
    efficiency_report: dict[str, Any] = {
        "enabled": False,
        "parallelBuilds": False,
        "buildConcurrency": 1,
        "runtimeConcurrency": 1,
        "rebuildPolicy": "impact-aware",
        "sharedInputs": [],
        "platformInputs": {},
        "plainArgs": [],
        "finalArgs": [],
        "resourceArgs": None,
    }
    if efficiency_value is not None:
        if not isinstance(efficiency_value, dict):
            errors.append("executionEfficiency:必须是对象")
        else:
            enabled = efficiency_value.get("enabled", False)
            parallel_builds = efficiency_value.get("parallelBuilds", False)
            if not isinstance(enabled, bool):
                errors.append("executionEfficiency.enabled:必须是布尔值")
                enabled = False
            if not isinstance(parallel_builds, bool):
                errors.append("executionEfficiency.parallelBuilds:必须是布尔值")
                parallel_builds = False

            def concurrency(name: str, default: int) -> int:
                value = efficiency_value.get(name, default)
                if not isinstance(value, int) or isinstance(value, bool) or not 1 <= value <= 8:
                    errors.append(f"executionEfficiency.{name}:必须是 1 到 8 的整数")
                    return default
                return value

            build_concurrency = concurrency("buildConcurrency", 1)
            runtime_concurrency = concurrency("runtimeConcurrency", 1)
            policy = efficiency_value.get("rebuildPolicy", "impact-aware")
            if policy not in {"impact-aware", "full-matrix"}:
                errors.append("executionEfficiency.rebuildPolicy:只允许 impact-aware 或 full-matrix")
                policy = "impact-aware"
            if build_concurrency > 1 and parallel_builds is not True:
                errors.append("executionEfficiency.parallelBuilds:并发构建大于 1 时必须显式为 true")

            def phase_args(name: str) -> list[str]:
                value = efficiency_value.get(name, [])
                if not isinstance(value, list) or not all(isinstance(item, str) and item for item in value):
                    errors.append(f"executionEfficiency.{name}:必须是字符串 argv 片段数组")
                    return []
                if any(FORBIDDEN_TOKENS.search(item) for item in value):
                    errors.append(f"executionEfficiency.{name}:包含 shell 元字符")
                    return []
                return value

            plain_args = phase_args("plainArgs")
            final_args = phase_args("finalArgs")
            resource_args_value = efficiency_value.get("resourceArgs")
            resource_args = None
            if resource_args_value is not None:
                if not isinstance(resource_args_value, dict):
                    errors.append("executionEfficiency.resourceArgs:必须是对象")
                else:
                    unknown = sorted(set(resource_args_value) - {"resourceRootFlag", "allowlistFlag"})
                    if unknown:
                        errors.append("executionEfficiency.resourceArgs:不支持 " + ", ".join(unknown))

                    def resource_flag(name: str) -> str | None:
                        value = resource_args_value.get(name)
                        if (
                            not isinstance(value, str)
                            or not value.startswith("--")
                            or any(character.isspace() for character in value)
                            or FORBIDDEN_TOKENS.search(value)
                        ):
                            errors.append(f"executionEfficiency.resourceArgs.{name}:必须是安全的长参数名")
                            return None
                        return value

                    root_flag = resource_flag("resourceRootFlag")
                    allowlist_flag = resource_flag("allowlistFlag")
                    if root_flag and allowlist_flag and root_flag == allowlist_flag:
                        errors.append("executionEfficiency.resourceArgs:两个参数名不能相同")
                    if root_flag and allowlist_flag:
                        resource_args = {"resourceRootFlag": root_flag, "allowlistFlag": allowlist_flag}

            def existing_inputs(value: object, label: str) -> list[str]:
                resolved = path_list(project_root, value, label, errors)
                if enabled:
                    for item in resolved:
                        if not Path(item).exists():
                            errors.append(f"{label}:输入不存在：{item}")
                return resolved

            shared_inputs = existing_inputs(
                efficiency_value.get("sharedInputs", []),
                "executionEfficiency.sharedInputs",
            )
            platform_input_value = efficiency_value.get("platformInputs", {})
            platform_inputs: dict[str, list[str]] = {}
            if not isinstance(platform_input_value, dict):
                errors.append("executionEfficiency.platformInputs:必须是平台到路径数组的映射")
            else:
                for platform, values in sorted(platform_input_value.items()):
                    if platform not in builds:
                        errors.append(f"executionEfficiency.platformInputs.{platform}:平台未在 platformBuilds 声明")
                        continue
                    platform_inputs[platform] = existing_inputs(
                        values,
                        f"executionEfficiency.platformInputs.{platform}",
                    )
            if enabled:
                if not shared_inputs:
                    errors.append("executionEfficiency.sharedInputs:启用效率编排时不能为空")
                for platform in builds:
                    if not platform_inputs.get(platform):
                        errors.append(f"executionEfficiency.platformInputs.{platform}:启用效率编排时不能为空")
            efficiency_report = {
                "enabled": bool(enabled),
                "parallelBuilds": bool(parallel_builds),
                "buildConcurrency": build_concurrency,
                "runtimeConcurrency": runtime_concurrency,
                "rebuildPolicy": policy,
                "sharedInputs": shared_inputs,
                "platformInputs": platform_inputs,
                "plainArgs": plain_args,
                "finalArgs": final_args,
                "resourceArgs": resource_args,
            }
    capability_outputs = [
        (platform, Path(str(capability.get("output") or "")).expanduser().resolve())
        for platform, capability in capabilities.items()
        if capability.get("output")
    ]
    for index, (left_platform, left_output) in enumerate(capability_outputs):
        for right_platform, right_output in capability_outputs[index + 1:]:
            if left_output == right_output:
                errors.append(
                    f"platformBuilds 输出重复：{left_platform} 与 {right_platform} 共用 {left_output}"
                )
            if (
                efficiency_report.get("enabled")
                and efficiency_report.get("parallelBuilds")
                and int(efficiency_report.get("buildConcurrency") or 1) > 1
            ):
                left_root = left_output.parent
                right_root = right_output.parent
                if left_root == right_root or left_root in right_root.parents or right_root in left_root.parents:
                    errors.append(
                        "executionEfficiency：并行平台必须使用互不重叠的输出目录；"
                        f"{left_platform}={left_root}，{right_platform}={right_root}"
                    )
    action_items = [
        error.replace(":", "：", 1)
        for error in errors
    ]
    return {
        "schemaVersion": "playable-package-build-adapter-validation-v1",
        "generatedAt": utc_now(),
        "projectRoot": str(project_root),
        "adapter": {"path": str(adapter_path), "sha256": sha256_file(adapter_path)},
        "valid": not errors,
        "resourceBoundaries": boundaries,
        "platformCapabilities": capabilities,
        "executionEfficiency": efficiency_report,
        "errors": errors,
        "userConclusion": "打包接入配置已完整，可以进入日常流程" if not errors else "打包接入配置尚未完成，请一次性补齐下面各项",
        "userActionItems": action_items,
        "note": (
            "普通 build 不自动继承为平台构建能力；v2 Adapter 可进入两次确认与精确覆盖流程"
            if schema.endswith("v2") else
            "普通 build 不自动继承为平台构建能力；v1 Adapter 只支持旧流程只读诊断"
        ),
    }


def main() -> int:
    args = parse_args()
    try:
        report = validate(args.project_root, args.adapter)
        write_json_atomic(args.output, report)
    except (OSError, ValueError, json.JSONDecodeError) as exc:
        print(json.dumps({"ok": False, "error": str(exc)}, ensure_ascii=False, indent=2))
        return 1
    print(json.dumps(report, ensure_ascii=False, indent=2))
    return 0 if report["valid"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
