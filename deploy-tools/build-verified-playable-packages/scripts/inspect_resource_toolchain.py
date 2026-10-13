#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys
from pathlib import Path
from typing import Any

LIB_ROOT = Path(__file__).resolve().parent / "lib"
sys.path.insert(0, str(LIB_ROOT))

from resource_common import load_json, sha256_file, sha256_object, utc_now, write_json_atomic
from resource_metadata import probe_path


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="只读检查本地资源优化工具并生成锁文件")
    parser.add_argument("--declaration", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--project-root", type=Path)
    parser.add_argument("--actions", type=Path, help="资源动作声明；用于计算所需工具能力")
    parser.add_argument("--ledger", type=Path, help="可选；主动机会审计前用于选择只读探测的代表性本地资源")
    parser.add_argument("--discover-supported", action="store_true", help="只读发现 Skill 已登记支持的本地工具")
    parser.add_argument("--required-capability", action="append", default=[])
    parser.add_argument("--timeout-seconds", type=int, default=10)
    return parser.parse_args()


def safe_environment() -> dict[str, str]:
    environment = dict(os.environ)
    for name in list(environment):
        if name.lower() in {"http_proxy", "https_proxy", "all_proxy"}:
            environment.pop(name, None)
    environment["NO_PROXY"] = "*"
    return environment


def command(value: object, executable: Path) -> list[str]:
    if not isinstance(value, list) or not value or not all(isinstance(item, str) and item for item in value):
        raise ValueError("versionArgv 必须是非空 argv 数组")
    result = [item.replace("{executable}", str(executable)) for item in value]
    if Path(result[0]).expanduser().resolve() != executable:
        raise ValueError("versionArgv 必须直接调用声明的绝对 executable")
    return result


def inspect_tool(item: object, timeout: int) -> dict[str, Any]:
    if not isinstance(item, dict):
        raise ValueError("工具声明项必须是对象")
    required_strings = ("name", "executable", "source", "license")
    for field in required_strings:
        if not isinstance(item.get(field), str) or not item[field].strip():
            raise ValueError(f"工具缺少 {field}")
    executable = Path(item["executable"]).expanduser()
    if not executable.is_absolute():
        raise ValueError(f"工具 executable 必须是绝对路径：{item['name']}")
    executable = executable.resolve()
    if not executable.is_file():
        raise ValueError(f"工具不存在：{executable}")
    if item.get("offline") is not True:
        raise ValueError(f"工具必须明确声明 offline=true：{item['name']}")
    argv_template = item.get("argvTemplate")
    if not isinstance(argv_template, list) or not argv_template or not all(isinstance(value, str) and value for value in argv_template):
        raise ValueError(f"工具 argvTemplate 必须是非空 argv 数组：{item['name']}")
    version_argv = command(item.get("versionArgv"), executable)
    completed = subprocess.run(
        version_argv,
        capture_output=True,
        text=True,
        timeout=timeout,
        check=False,
        env=safe_environment(),
    )
    if completed.returncode != 0:
        raise ValueError(f"工具版本命令失败：{item['name']} / exit={completed.returncode}")
    version_output = (completed.stdout or completed.stderr).strip()
    if not version_output:
        raise ValueError(f"工具版本命令没有输出：{item['name']}")
    expected = item.get("expectedVersion")
    if expected and expected not in version_output:
        raise ValueError(f"工具版本不符合 expectedVersion：{item['name']}")
    capabilities = item.get("capabilities") or []
    if not isinstance(capabilities, list) or not all(isinstance(value, str) and value for value in capabilities):
        raise ValueError(f"工具 capabilities 必须是字符串数组：{item['name']}")
    if not capabilities and item["name"].lower() == "ffmpeg":
        capabilities = ["audio-reencode", "image-reencode", "image-resize"]
    result = {
        "name": item["name"],
        "version": expected or version_output.splitlines()[0],
        "versionOutput": version_output,
        "versionArgv": version_argv,
        "executable": str(executable),
        "executableSha256": "sha256:" + sha256_file(executable),
        "source": item["source"],
        "license": item["license"],
        "offline": True,
        "argvTemplate": argv_template,
        "parameters": item.get("parameters") if isinstance(item.get("parameters"), dict) else {},
        "determinismProbe": item.get("determinismProbe"),
        "capabilities": sorted(set(capabilities)),
    }
    bundled_script = item.get("bundledScript")
    if bundled_script is not None:
        script_path = Path(str(bundled_script)).expanduser().resolve()
        if item.get("source") != "skill-bundled" or not script_path.is_file():
            raise ValueError(f"Skill 内建工具脚本无效：{item['name']}")
        result["bundledScript"] = str(script_path)
        result["bundledScriptSha256"] = "sha256:" + sha256_file(script_path)
    return result


def load_action_requirements(path: Path | None) -> tuple[set[str], list[dict[str, Any]]]:
    if path is None:
        return set(), []
    value = load_json(path.expanduser().resolve())
    if not isinstance(value, dict) or value.get("schemaVersion") != "playable-resource-plan-actions-v1":
        raise ValueError("资源动作声明 schemaVersion 无效")
    actions = value.get("actions")
    if not isinstance(actions, list):
        raise ValueError("资源动作声明 actions 必须是数组")
    requirements: set[str] = set()
    selected: list[dict[str, Any]] = []
    for item in actions:
        if not isinstance(item, dict) or not isinstance(item.get("path"), str):
            raise ValueError("资源动作声明项必须包含 path")
        action = item.get("action")
        suffix = Path(item["path"]).suffix.lower()
        declared_capability = item.get("requiredCapability")
        if isinstance(declared_capability, str) and declared_capability:
            capability = declared_capability
        elif action == "REENCODE":
            capability = (
                "audio-reencode" if suffix in {".aac", ".flac", ".m4a", ".mp3", ".ogg", ".wav"}
                else "model-convert" if suffix in {".fbx", ".glb", ".gltf", ".obj", ".dae"}
                else "image-reencode"
            )
        elif action == "RESIZE":
            capability = "image-resize"
        elif action == "SIMPLIFY":
            capability = "model-simplify"
        elif action == "REPACK_ATLAS":
            capability = "atlas-repack"
        elif action == "SUBSET_FONT":
            capability = "font-subset"
        elif action == "PRUNE_CONFIG":
            capability = "config-prune"
        else:
            continue
        requirements.add(capability)
        selected.append({**item, "requiredCapability": capability})
    return requirements, selected


def representative_audio_from_ledger(path: Path | None) -> list[dict[str, Any]]:
    if path is None:
        return []
    value = load_json(path.expanduser().resolve())
    if not isinstance(value, dict) or value.get("schemaVersion") != "playable-resource-ledger-v2":
        raise ValueError("资源账本 schemaVersion 无效")
    for item in value.get("files") or []:
        if (
            isinstance(item, dict)
            and item.get("bucket") == "audio"
            and item.get("classification") in {"REQUIRED", "CONDITIONAL"}
            and isinstance(item.get("path"), str)
        ):
            return [{
                "path": item["path"],
                "action": "REENCODE",
                "requiredCapability": "audio-reencode",
                "parameters": {
                    "audioClass": "SFX",
                    "format": "mp3",
                    "parameterRanges": {
                        "codec": ["libmp3lame"],
                        "bitRateKbps": [64],
                        "sampleRateHz": [44100],
                        "channels": [1],
                        "metadata": ["remove"],
                    },
                },
            }]
    return []


def representative_actions_from_ledger(path: Path | None) -> list[dict[str, Any]]:
    audio = representative_audio_from_ledger(path)
    if path is None:
        return audio
    value = load_json(path.expanduser().resolve())
    if not isinstance(value, dict) or value.get("schemaVersion") != "playable-resource-ledger-v2":
        raise ValueError("资源账本 schemaVersion 无效")
    project_root = Path(str(value.get("projectRoot") or "")).expanduser().resolve()
    actions = list(audio)
    seen_capabilities = {item["requiredCapability"] for item in actions}
    valid_images: list[str] = []
    for item in value.get("files") or []:
        if (
            not isinstance(item, dict)
            or item.get("classification") not in {"REQUIRED", "CONDITIONAL"}
            or not isinstance(item.get("path"), str)
        ):
            continue
        relative = item["path"]
        source = (project_root / relative).resolve()
        bucket = item.get("bucket")
        try:
            metadata = probe_path(source)
        except (OSError, ValueError, json.JSONDecodeError):
            continue
        if bucket in {"textures", "atlas"} and isinstance(metadata.get("widthPx"), int):
            valid_images.append(relative)
            if "image-resize" not in seen_capabilities:
                width = max(1, int(metadata["widthPx"]) // 2)
                height = max(1, int(metadata["heightPx"]) // 2)
                actions.append({
                    "path": relative, "action": "RESIZE", "requiredCapability": "image-resize",
                    "parameters": {"format": "unchanged", "parameterRanges": {"maxWidthPx": [width], "maxHeightPx": [height]}},
                })
                seen_capabilities.add("image-resize")
            if "image-reencode" not in seen_capabilities:
                actions.append({
                    "path": relative, "action": "REENCODE", "requiredCapability": "image-reencode",
                    "parameters": {"parameterRanges": {"format": [metadata.get("format")], "quality": [75]}},
                })
                seen_capabilities.add("image-reencode")
        elif bucket == "models":
            if metadata.get("format") == "fbx" and "model-convert" not in seen_capabilities:
                actions.append({
                    "path": relative, "action": "REENCODE", "requiredCapability": "model-convert",
                    "parameters": {"parameterRanges": {"format": ["glb"]}},
                })
                seen_capabilities.add("model-convert")
            elif metadata.get("format") in {"gltf", "glb"}:
                if "model-compact" not in seen_capabilities:
                    actions.append({
                        "path": relative, "action": "REENCODE", "requiredCapability": "model-compact",
                        "parameters": {"parameterRanges": {"format": [metadata.get("format")]}},
                    })
                    seen_capabilities.add("model-compact")
                triangles = metadata.get("triangleCount")
                if isinstance(triangles, int) and triangles > 1 and "model-simplify" not in seen_capabilities:
                    actions.append({
                        "path": relative, "action": "SIMPLIFY", "requiredCapability": "model-simplify",
                        "parameters": {"parameterRanges": {"ratio": [0.5], "targetTriangleCount": [max(1, triangles // 2)]}},
                    })
                    seen_capabilities.add("model-simplify")
        elif bucket == "config" and "config-prune" not in seen_capabilities:
            actions.append({"path": relative, "action": "PRUNE_CONFIG", "requiredCapability": "config-prune", "parameters": {}})
            seen_capabilities.add("config-prune")
    if len(valid_images) >= 2 and "atlas-repack" not in seen_capabilities:
        actions.append({"path": valid_images[0], "action": "REPACK_ATLAS", "requiredCapability": "atlas-repack", "parameters": {}})
    return actions


def parameter_values(parameters: dict[str, Any], name: str, default: object) -> list[object]:
    ranges = parameters.get("parameterRanges") or {}
    value = ranges.get(name, parameters.get(name, default)) if isinstance(ranges, dict) else parameters.get(name, default)
    return value if isinstance(value, list) and value else [value]


def discover_ffmpeg(project_root: Path, actions: list[dict[str, Any]], timeout: int) -> dict[str, Any] | None:
    executable_value = shutil.which("ffmpeg")
    if not executable_value:
        return None
    executable = Path(executable_value).resolve()
    audio_actions = [item for item in actions if item.get("requiredCapability") == "audio-reencode"]
    if not audio_actions:
        return None
    audio_action = audio_actions[0]
    input_path = (project_root / audio_action["path"]).resolve()
    if not input_path.is_file():
        raise ValueError(f"自动发现 ffmpeg 时找不到代表性输入：{input_path}")
    def combined_values(name: str, default: object) -> list[object]:
        result: list[object] = []
        for item in audio_actions:
            parameters = item.get("parameters") or {}
            if not isinstance(parameters, dict):
                raise ValueError(f"音频动作 parameters 无效：{item['path']}")
            for candidate in parameter_values(parameters, name, default):
                if candidate not in result:
                    result.append(candidate)
        return result

    bitrates = combined_values("bitRateKbps", 64)
    sample_rates = combined_values("sampleRateHz", 44100)
    channels = combined_values("channels", 1)
    formats = combined_values("format", "mp3")
    codecs = combined_values("codec", "libmp3lame")
    metadata = combined_values("metadata", "remove")
    if any(str(value).lower() not in {"remove", "removed", "strip"} for value in metadata):
        raise ValueError("自动发现的 ffmpeg 工具链只支持移除音频 metadata；其他策略需显式声明工具 argv")
    version_argv = [str(executable), "-version"]
    completed = subprocess.run(version_argv, capture_output=True, text=True, timeout=timeout, check=False, env=safe_environment())
    version_output = (completed.stdout or completed.stderr).strip()
    if completed.returncode != 0 or not version_output:
        raise ValueError("自动发现的 ffmpeg 无法读取版本")
    license_name = "GPL-2.0-or-later" if "--enable-gpl" in version_output else "LGPL-2.1-or-later"
    discovered = {
        "name": "ffmpeg",
        "executable": str(executable),
        "source": "system-installed",
        "license": license_name,
        "offline": True,
        "capabilities": ["audio-reencode"],
        "versionArgv": version_argv,
        "argvTemplate": [
            str(executable), "-hide_banner", "-loglevel", "error", "-y", "-i", "{input}",
            "-map_metadata", "-1", "-vn", "-codec:a", "{codec}", "-b:a", "{bitRateKbps}k",
            "-ar", "{sampleRateHz}", "-ac", "{channels}", "{output}",
        ],
        "parameters": {
            "codec": codecs,
            "bitRateKbps": bitrates,
            "sampleRateHz": sample_rates,
            "channels": channels,
            "format": formats,
            "metadata": metadata,
        },
        "determinismProbe": {
            "input": str(input_path),
            "outputSuffix": "." + str(formats[0]).lstrip("."),
            "parameters": {
                "codec": codecs[0],
                "bitRateKbps": bitrates[0],
                "sampleRateHz": sample_rates[0],
                "channels": channels[0],
                "format": formats[0],
                "metadata": metadata[0],
            },
        },
    }
    return inspect_tool(discovered, timeout)


def discover_ffmpeg_image(
    project_root: Path,
    actions: list[dict[str, Any]],
    capability: str,
    timeout: int,
) -> dict[str, Any] | None:
    executable_value = shutil.which("ffmpeg")
    selected = [item for item in actions if item.get("requiredCapability") == capability]
    if not executable_value or not selected:
        return None
    executable = Path(executable_value).resolve()
    action = selected[0]
    input_path = (project_root / action["path"]).resolve()
    if not input_path.is_file():
        raise ValueError(f"自动发现 ffmpeg 图片能力时找不到代表性输入：{input_path}")
    def combined_values(name: str, default: object) -> list[object]:
        result: list[object] = []
        for item in selected:
            parameters = item.get("parameters") or {}
            if not isinstance(parameters, dict):
                raise ValueError(f"图片动作 parameters 无效：{item.get('path')}")
            for candidate in parameter_values(parameters, name, default):
                if candidate not in result:
                    result.append(candidate)
        return result

    if capability == "image-resize":
        widths = combined_values("maxWidthPx", 1024)
        heights = combined_values("maxHeightPx", 1024)
        formats = combined_values("format", "unchanged")
        argv_template = [
            str(executable), "-hide_banner", "-loglevel", "error", "-y", "-i", "{input}",
            "-vf", "scale={maxWidthPx}:{maxHeightPx}:force_original_aspect_ratio=decrease", "{output}",
        ]
        allowed = {"maxWidthPx": widths, "maxHeightPx": heights, "format": formats}
        probe_parameters_value = {"maxWidthPx": widths[0], "maxHeightPx": heights[0], "format": formats[0]}
    else:
        qualities = combined_values("quality", 75)
        formats = combined_values("format", input_path.suffix.lstrip("."))
        argv_template = [
            str(executable), "-hide_banner", "-loglevel", "error", "-y", "-i", "{input}",
            "-q:v", "{quality}", "{output}",
        ]
        allowed = {"quality": qualities, "format": formats}
        probe_parameters_value = {"quality": qualities[0], "format": formats[0]}
    version_argv = [str(executable), "-version"]
    version = subprocess.run(version_argv, capture_output=True, text=True, timeout=timeout, check=False, env=safe_environment())
    version_output = (version.stdout or version.stderr).strip()
    if version.returncode != 0 or not version_output:
        raise ValueError("自动发现的 ffmpeg 无法读取版本")
    discovered = {
        "name": "ffmpeg-image-resize" if capability == "image-resize" else "ffmpeg-image-reencode",
        "executable": str(executable), "source": "system-installed",
        "license": "GPL-2.0-or-later" if "--enable-gpl" in version_output else "LGPL-2.1-or-later",
        "offline": True, "capabilities": [capability], "versionArgv": version_argv,
        "argvTemplate": argv_template, "parameters": allowed,
        "determinismProbe": {
            "input": str(input_path), "outputSuffix": input_path.suffix,
            "parameters": probe_parameters_value,
        },
    }
    return inspect_tool(discovered, timeout)


def discover_model_tool(
    project_root: Path,
    actions: list[dict[str, Any]],
    capability: str,
    timeout: int,
) -> dict[str, Any] | None:
    selected = [item for item in actions if item.get("requiredCapability") == capability]
    if not selected:
        return None
    candidates = ["FBX2glTF", "fbx2gltf"] if capability == "model-convert" else ["gltf-transform"]
    executable_value = next((shutil.which(name) for name in candidates if shutil.which(name)), None)
    if not executable_value:
        return None
    executable = Path(executable_value).resolve()
    action = selected[0]
    input_path = (project_root / action["path"]).resolve()
    if not input_path.is_file():
        raise ValueError(f"自动发现三维物体工具时找不到代表性输入：{input_path}")
    parameters = action.get("parameters") or {}
    if capability == "model-convert":
        formats = parameter_values(parameters, "format", "glb")
        argv_template = [str(executable), "-i", "{input}", "-o", "{output}"]
        allowed = {"format": formats}
        selected_parameters = {"format": formats[0]}
        suffix = "." + str(formats[0]).lstrip(".")
        license_name = "BSD-3-Clause"
    elif capability == "model-compact":
        formats = parameter_values(parameters, "format", "gltf")
        argv_template = [str(executable), "optimize", "{input}", "{output}"]
        allowed = {"format": formats}
        selected_parameters = {"format": formats[0]}
        suffix = "." + str(formats[0]).lstrip(".")
        license_name = "MIT"
    else:
        ratios = parameter_values(parameters, "ratio", 0.5)
        targets = parameter_values(parameters, "targetTriangleCount", 1000)
        argv_template = [str(executable), "simplify", "{input}", "{output}", "--ratio", "{ratio}"]
        allowed = {"ratio": ratios, "targetTriangleCount": targets}
        selected_parameters = {"ratio": ratios[0], "targetTriangleCount": targets[0]}
        suffix = input_path.suffix
        license_name = "MIT"
    return inspect_tool({
        "name": "fbx2gltf" if capability == "model-convert" else f"gltf-transform-{capability.removeprefix('model-')}",
        "executable": str(executable), "source": "system-installed", "license": license_name,
        "offline": True, "capabilities": [capability], "versionArgv": [str(executable), "--version"],
        "argvTemplate": argv_template, "parameters": allowed,
        "determinismProbe": {"input": str(input_path), "outputSuffix": suffix, "parameters": selected_parameters},
    }, timeout)


def bundled_tool(capability: str, timeout: int) -> dict[str, Any]:
    script_root = Path(__file__).resolve().parent
    executable = Path(sys.executable).resolve()
    if capability == "config-prune":
        script = script_root / "prune_config_by_references.py"
        name = "skill-config-reference-closure"
        argv_template = [
            str(executable), str(script), "--input", "{input}", "--output", "{output}",
            "--reachable-pointers-json", "{reachablePointers}",
        ]
        parameters: dict[str, Any] = {}
    elif capability == "atlas-repack":
        script = script_root / "build_image_atlas.py"
        name = "skill-image-atlas"
        argv_template = [
            str(executable), str(script), "--project-root", "{projectRoot}",
            "--input-json", "{inputPaths}", "--padding", "{padding}", "--edge-extrude", "{edgeExtrude}",
            "--atlas-out", "{output}", "--manifest-out", "{manifest}", "--receipt-out", "{receipt}",
        ]
        parameters = {"padding": [1, 2, 4, 8], "edgeExtrude": [0, 1, 2, 4]}
    else:
        raise ValueError(f"没有登记的 Skill 内建能力：{capability}")
    return inspect_tool({
        "name": name,
        "executable": str(executable),
        "source": "skill-bundled",
        "license": "Apache-2.0",
        "offline": True,
        "capabilities": [capability],
        "versionArgv": [str(executable), "--version"],
        "argvTemplate": argv_template,
        "parameters": parameters,
        "bundledScript": str(script),
    }, timeout)


def main() -> int:
    args = parse_args()
    try:
        declaration_path = args.declaration.expanduser().resolve()
        declaration = load_json(declaration_path)
        if not isinstance(declaration, dict) or declaration.get("schemaVersion") != "playable-resource-toolchain-declaration-v1":
            raise ValueError("工具链声明 schemaVersion 无效")
        if declaration.get("networkPolicy") != "DENY" or declaration.get("externalAssetsUsed") is not False:
            raise ValueError("工具链声明必须使用 networkPolicy=DENY 且 externalAssetsUsed=false")
        raw_tools = declaration.get("tools")
        if not isinstance(raw_tools, list):
            raise ValueError("工具链声明 tools 必须是数组")
        tools = [inspect_tool(item, args.timeout_seconds) for item in raw_tools]
        action_requirements, selected_actions = load_action_requirements(args.actions)
        representative_actions = representative_actions_from_ledger(args.ledger)
        if not selected_actions:
            selected_actions = representative_actions
        required_capabilities = action_requirements | set(args.required_capability)
        selected_capabilities = {item.get("requiredCapability") for item in selected_actions}
        for capability in ("atlas-repack", "config-prune"):
            if (capability in required_capabilities or capability in selected_capabilities) and not any(
                capability in item.get("capabilities", []) for item in tools
            ):
                tools.append(bundled_tool(capability, args.timeout_seconds))
        should_discover_audio = "audio-reencode" in required_capabilities or bool(representative_actions)
        if args.discover_supported and should_discover_audio and not any(
            "audio-reencode" in item.get("capabilities", []) for item in tools
        ):
            if args.project_root is None:
                raise ValueError("启用本地工具发现时必须提供 --project-root")
            discovered = discover_ffmpeg(args.project_root.expanduser().resolve(), selected_actions, args.timeout_seconds)
            if discovered is not None:
                tools.append(discovered)
        if args.discover_supported:
            if args.project_root is None and required_capabilities & {
                "image-resize", "image-reencode", "model-convert", "model-compact", "model-simplify",
            }:
                raise ValueError("启用本地工具发现时必须提供 --project-root")
            if args.project_root is not None:
                project_root = args.project_root.expanduser().resolve()
                for capability in ("image-resize", "image-reencode"):
                    if (capability in required_capabilities or capability in selected_capabilities) and not any(capability in item.get("capabilities", []) for item in tools):
                        discovered_image = discover_ffmpeg_image(project_root, selected_actions, capability, args.timeout_seconds)
                        if discovered_image is not None:
                            tools.append(discovered_image)
                for capability in ("model-convert", "model-compact", "model-simplify"):
                    if (capability in required_capabilities or capability in selected_capabilities) and not any(capability in item.get("capabilities", []) for item in tools):
                        discovered_model = discover_model_tool(project_root, selected_actions, capability, args.timeout_seconds)
                        if discovered_model is not None:
                            tools.append(discovered_model)
        names = [item["name"] for item in tools]
        if len(names) != len(set(names)):
            raise ValueError("工具名称必须唯一")
        available_capabilities = {
            capability for item in tools for capability in item.get("capabilities", [])
        }
        missing_capabilities = sorted(required_capabilities - available_capabilities)
        core = {
            "schemaVersion": "playable-resource-toolchain-lock-v1",
            "networkPolicy": "DENY",
            "externalAssetsUsed": False,
            "tools": tools,
            "requiredCapabilities": sorted(required_capabilities),
            "availableCapabilities": sorted(available_capabilities),
            "missingCapabilities": missing_capabilities,
            "conclusion": "BLOCKED" if missing_capabilities else "READY",
            "declaration": {"path": str(declaration_path), "sha256": sha256_file(declaration_path)},
        }
        lock = dict(core)
        lock["generatedAt"] = utc_now()
        lock["toolchainLockHash"] = "sha256:" + sha256_object(core)
        write_json_atomic(args.output, lock)
        if missing_capabilities:
            labels = {
                "audio-reencode": "FFmpeg（音频候选重编码）",
                "image-resize": "FFmpeg（图片降采样）",
                "image-reencode": "FFmpeg（图片格式或质量候选）",
                "model-convert": "FBX2glTF（三维物体网页格式转换）",
                "model-compact": "gltf-transform（三维物体紧凑存储）",
                "model-simplify": "gltf-transform（三维物体减面）",
                "font-subset": "项目声明的本地字体子集工具",
            }
            shown = "、".join(labels.get(item, item) for item in missing_capabilities)
            raise ValueError(
                f"当前电脑缺少 {shown}，它用于在本机候选目录生成对应优化版本。"
                "请按项目文档或工具官方说明安装；本流程不会自动安装或使用在线压缩服务，也不会使用云转码或远程 AI 服务。"
                "如果不安装，对应资源会保持原文件且无法完成候选和保真对比。安装后请重新执行当前运行的工具发现，"
                "版本、路径和 SHA-256 验签通过后即可继续。"
            )
    except (OSError, ValueError, json.JSONDecodeError, subprocess.SubprocessError) as exc:
        print(json.dumps({"ok": False, "error": str(exc)}, ensure_ascii=False, indent=2))
        return 1
    print(json.dumps({"ok": True, "output": str(args.output.resolve()), "toolchainLockHash": lock["toolchainLockHash"]}, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
