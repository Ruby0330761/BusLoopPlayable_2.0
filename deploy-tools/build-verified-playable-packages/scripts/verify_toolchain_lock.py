#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path
from typing import Any

LIB_ROOT = Path(__file__).resolve().parent / "lib"
sys.path.insert(0, str(LIB_ROOT))

from resource_common import load_json, sha256_file, sha256_object, utc_now, write_json_atomic


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="验签工具链锁并重复转换代表性输入以验证确定性")
    parser.add_argument("--lock", required=True, type=Path)
    parser.add_argument("--approval", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--timeout-seconds", type=int, default=60)
    return parser.parse_args()


def safe_environment() -> dict[str, str]:
    environment = dict(os.environ)
    for name in list(environment):
        if name.lower() in {"http_proxy", "https_proxy", "all_proxy"}:
            environment.pop(name, None)
    environment["NO_PROXY"] = "*"
    return environment


def verify_lock_hash(lock: dict[str, Any]) -> str:
    core = {key: value for key, value in lock.items() if key not in {"generatedAt", "toolchainLockHash"}}
    actual = "sha256:" + sha256_object(core)
    if lock.get("toolchainLockHash") != actual:
        raise ValueError("toolchainLockHash 无效")
    return actual


def probe_parameters(tool: dict[str, Any], probe: dict[str, Any]) -> dict[str, Any]:
    allowed = tool.get("parameters") or {}
    selected = probe.get("parameters") or {}
    if not isinstance(allowed, dict) or not isinstance(selected, dict):
        raise ValueError(f"确定性探针参数无效：{tool.get('name')}")
    result: dict[str, Any] = {}
    for name, values in allowed.items():
        if not isinstance(values, list) or not values:
            raise ValueError(f"工具链允许参数无效：{tool.get('name')} / {name}")
        value = selected.get(name, values[0])
        if value not in values:
            raise ValueError(f"确定性探针参数超出工具链锁：{tool.get('name')} / {name}")
        result[name] = value
    return result


def substitute(
    argv: list[str],
    executable: Path,
    input_path: Path,
    output_path: Path,
    parameters: dict[str, Any],
) -> list[str]:
    replacements = {
        "executable": str(executable),
        "input": str(input_path),
        "output": str(output_path),
        **{name: str(value) for name, value in parameters.items()},
    }
    result = []
    for value in argv:
        rendered = value
        for name, replacement in replacements.items():
            rendered = rendered.replace("{" + name + "}", replacement)
        if "{" in rendered or "}" in rendered:
            raise ValueError(f"确定性探针 argv 含未解析占位符：{rendered}")
        result.append(rendered)
    if Path(result[0]).expanduser().resolve() != executable:
        raise ValueError("确定性探针必须直接调用已锁定 executable")
    return result


def run_probe(tool: dict[str, Any], timeout: int, project_root: Path) -> dict[str, Any]:
    probe = tool.get("determinismProbe")
    if probe is None:
        if tool.get("source") == "skill-bundled":
            return {"status": "SKIPPED_SKILL_BUNDLED", "reason": "由 Skill 包哈希覆盖"}
        raise ValueError(f"非 Skill 内建工具缺少 determinismProbe：{tool.get('name')}")
    if not isinstance(probe, dict) or not isinstance(probe.get("input"), str):
        raise ValueError(f"determinismProbe 格式无效：{tool.get('name')}")
    input_path = Path(probe["input"]).expanduser()
    if not input_path.is_absolute():
        input_path = project_root / input_path
    input_path = input_path.resolve()
    if not input_path.is_file():
        raise ValueError(f"确定性探针输入不存在：{input_path}")
    argv_template = probe.get("argv") or tool.get("argvTemplate")
    if not isinstance(argv_template, list) or not all(isinstance(item, str) for item in argv_template):
        raise ValueError(f"确定性探针 argv 无效：{tool.get('name')}")
    executable = Path(tool["executable"]).resolve()
    parameters = probe_parameters(tool, probe)
    output_suffix = probe.get("outputSuffix")
    if not isinstance(output_suffix, str) or not output_suffix.strip():
        output_format = parameters.get("format")
        output_suffix = f".{output_format}" if output_format else ".bin"
    if not output_suffix.startswith(".") or "/" in output_suffix or "\\" in output_suffix:
        raise ValueError(f"确定性探针输出扩展名无效：{tool.get('name')}")
    hashes = []
    with tempfile.TemporaryDirectory(prefix="playable-toolchain-probe-") as temporary:
        root = Path(temporary)
        for index in (1, 2):
            output_path = root / f"output-{index}{output_suffix}"
            argv = substitute(argv_template, executable, input_path, output_path, parameters)
            completed = subprocess.run(
                argv,
                capture_output=True,
                text=True,
                timeout=timeout,
                check=False,
                env=safe_environment(),
            )
            if completed.returncode != 0 or not output_path.is_file():
                raise ValueError(f"确定性探针失败：{tool.get('name')} / exit={completed.returncode}")
            hashes.append(sha256_file(output_path))
    if hashes[0] != hashes[1]:
        raise ValueError(f"TOOLCHAIN_NONDETERMINISTIC：{tool.get('name')}")
    return {"status": "DETERMINISTIC", "input": str(input_path), "outputSha256": "sha256:" + hashes[0]}


def main() -> int:
    args = parse_args()
    errors = []
    tool_results = []
    try:
        lock_path = args.lock.expanduser().resolve()
        approval_path = args.approval.expanduser().resolve()
        lock = load_json(lock_path)
        approval = load_json(approval_path)
        if not isinstance(lock, dict) or lock.get("schemaVersion") != "playable-resource-toolchain-lock-v1":
            raise ValueError("工具链锁 schemaVersion 无效")
        if not isinstance(approval, dict) or approval.get("schemaVersion") not in {
            "playable-resource-optimization-approval-v1", "playable-resource-trial-approval-v2",
        }:
            raise ValueError("资源计划 approval 无效")
        verify_lock_hash(lock)
        approval_lock = approval.get("toolchainLock") or {}
        if approval_lock.get("path") != str(lock_path) or approval_lock.get("sha256") != sha256_file(lock_path):
            raise ValueError("用户确认未绑定当前工具链锁")
        if lock.get("networkPolicy") != "DENY" or lock.get("externalAssetsUsed") is not False:
            raise ValueError("工具链锁网络/外部素材策略无效")
        required_capabilities = set(lock.get("requiredCapabilities") or [])
        available_capabilities = {
            capability
            for tool in lock.get("tools", []) if isinstance(tool, dict)
            for capability in tool.get("capabilities", []) if isinstance(capability, str)
        }
        missing_capabilities = sorted(required_capabilities - available_capabilities)
        if missing_capabilities:
            raise ValueError("TOOLCHAIN_MISSING：" + ", ".join(missing_capabilities))
        project_root_value = approval.get("projectRoot")
        if not isinstance(project_root_value, str) or not project_root_value.strip():
            raise ValueError("资源计划 approval 缺少 projectRoot")
        project_root = Path(project_root_value).expanduser().resolve()
        if not project_root.is_dir():
            raise ValueError(f"项目根目录不存在：{project_root}")
        for tool in lock.get("tools", []):
            executable = Path(str(tool.get("executable", ""))).resolve()
            if not executable.is_file() or tool.get("executableSha256") != "sha256:" + sha256_file(executable):
                raise ValueError(f"工具可执行文件漂移：{tool.get('name')}")
            version_argv = tool.get("versionArgv")
            if not isinstance(version_argv, list) or Path(version_argv[0]).resolve() != executable:
                raise ValueError(f"工具版本命令无效：{tool.get('name')}")
            completed = subprocess.run(version_argv, capture_output=True, text=True, timeout=args.timeout_seconds, check=False, env=safe_environment())
            version_output = (completed.stdout or completed.stderr).strip()
            if completed.returncode != 0 or version_output != tool.get("versionOutput"):
                raise ValueError(f"工具版本输出漂移：{tool.get('name')}")
            if tool.get("source") == "skill-bundled":
                bundled_script = Path(str(tool.get("bundledScript") or "")).resolve()
                if (
                    not bundled_script.is_file()
                    or tool.get("bundledScriptSha256") != "sha256:" + sha256_file(bundled_script)
                ):
                    raise ValueError(f"Skill 内建工具脚本漂移：{tool.get('name')}")
            tool_results.append({"name": tool.get("name"), **run_probe(tool, args.timeout_seconds, project_root)})
        status = "TOOLCHAIN_VERIFIED"
    except (OSError, ValueError, json.JSONDecodeError, subprocess.SubprocessError) as exc:
        errors.append(str(exc))
        status = "BLOCKED"
    report = {
        "schemaVersion": "playable-resource-toolchain-verification-v1",
        "generatedAt": utc_now(),
        "status": status,
        "userConclusion": (
            "本地优化工具已验证，可以按照已确认计划执行资源优化"
            if status == "TOOLCHAIN_VERIFIED"
            else "本地优化工具未通过验证，尚不能执行资源优化"
        ),
        "toolchainLock": {"path": str(args.lock.resolve()), "sha256": sha256_file(args.lock.resolve()) if args.lock.is_file() else None},
        "tools": tool_results,
        "errors": errors,
    }
    write_json_atomic(args.output, report)
    print(json.dumps(report, ensure_ascii=False, indent=2))
    return 0 if status == "TOOLCHAIN_VERIFIED" else 1


if __name__ == "__main__":
    raise SystemExit(main())
