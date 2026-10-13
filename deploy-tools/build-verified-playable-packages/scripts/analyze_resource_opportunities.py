#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import math
import shutil
import subprocess
import sys
import wave
from pathlib import Path
from typing import Any

LIB_ROOT = Path(__file__).resolve().parent / "lib"
sys.path.insert(0, str(LIB_ROOT))

from resource_common import load_json, sha256_file, sha256_object, utc_now, write_json_atomic
from resource_metadata import probe_path


SCHEMA = "resource-opportunity-audit-v1"
AUDIO_EXTENSIONS = {".aac", ".flac", ".m4a", ".mp3", ".ogg", ".opus", ".wav"}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="主动检测白名单资源的可优化机会并生成机器可验签审计")
    parser.add_argument("--ledger", required=True, type=Path)
    parser.add_argument("--toolchain", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--md-out", type=Path)
    parser.add_argument("--usage-evidence", type=Path, help="当前玩法、关卡、变体、平台的资源实际使用证据")
    parser.add_argument("--audio-max-bitrate-kbps", type=int, default=96)
    parser.add_argument("--audio-max-channels", type=int, default=1)
    parser.add_argument("--audio-target-bitrate-kbps", type=int, default=64)
    parser.add_argument("--audio-target-sample-rate-hz", type=int, default=44100)
    parser.add_argument("--probe-timeout-seconds", type=int, default=15)
    return parser.parse_args()


def require(path: Path, schema: str) -> dict[str, Any]:
    value = load_json(path.expanduser().resolve())
    if not isinstance(value, dict) or value.get("schemaVersion") != schema:
        raise ValueError(f"{path.name} schemaVersion 必须为 {schema}")
    return value


def locked_tools(toolchain: dict[str, Any]) -> list[dict[str, Any]]:
    tools = toolchain.get("tools")
    if not isinstance(tools, list):
        raise ValueError("工具锁 tools 必须是数组")
    result: list[dict[str, Any]] = []
    for item in tools:
        if not isinstance(item, dict):
            raise ValueError("工具锁包含无效工具项")
        executable = Path(str(item.get("executable") or "")).expanduser().resolve()
        expected = str(item.get("executableSha256") or "").removeprefix("sha256:")
        if not executable.is_file() or not expected or sha256_file(executable) != expected:
            raise ValueError(f"锁定工具不存在或已漂移：{executable}")
        result.append(item)
    return result


def ffprobe_path(tools: list[dict[str, Any]]) -> Path | None:
    for item in tools:
        if "audio-reencode" not in (item.get("capabilities") or []):
            continue
        executable = Path(str(item.get("executable") or "")).resolve()
        sibling = executable.with_name("ffprobe")
        if sibling.is_file():
            return sibling
    discovered = shutil.which("ffprobe")
    return Path(discovered).resolve() if discovered else None


def probe_audio(path: Path, probe: Path | None, timeout: int) -> dict[str, Any]:
    if path.suffix.lower() == ".wav":
        try:
            with wave.open(str(path), "rb") as handle:
                channels = handle.getnchannels()
                sample_rate = handle.getframerate()
                frames = handle.getnframes()
                duration = frames / sample_rate if sample_rate else 0.0
                bitrate = round(path.stat().st_size * 8 / duration / 1000) if duration else None
                return {
                    "probe": "python-wave",
                    "channels": channels,
                    "sampleRateHz": sample_rate,
                    "bitRateKbps": bitrate,
                    "durationSeconds": round(duration, 3),
                }
        except (wave.Error, OSError):
            pass
    if probe is None:
        raise ValueError(f"RESOURCE_MEDIA_PROBE_MISSING：无法读取音频元数据：{path}")
    completed = subprocess.run(
        [
            str(probe), "-v", "error", "-select_streams", "a:0",
            "-show_entries", "stream=channels,sample_rate,bit_rate:format=duration,bit_rate",
            "-of", "json", str(path),
        ],
        capture_output=True,
        text=True,
        timeout=timeout,
        check=False,
        env={"PATH": str(probe.parent), "NO_PROXY": "*"},
    )
    if completed.returncode != 0:
        raise ValueError(f"RESOURCE_MEDIA_PROBE_FAILED：{path.name} / exit={completed.returncode}")
    value = json.loads(completed.stdout)
    stream = ((value.get("streams") or [{}])[0]) if isinstance(value, dict) else {}
    format_value = value.get("format") or {} if isinstance(value, dict) else {}
    bit_rate = stream.get("bit_rate") or format_value.get("bit_rate")
    return {
        "probe": str(probe),
        "channels": int(stream["channels"]) if stream.get("channels") else None,
        "sampleRateHz": int(stream["sample_rate"]) if stream.get("sample_rate") else None,
        "bitRateKbps": round(int(bit_rate) / 1000) if bit_rate else None,
        "durationSeconds": round(float(format_value["duration"]), 3) if format_value.get("duration") else None,
    }


def supported_tool(tools: list[dict[str, Any]], capability: str) -> dict[str, Any] | None:
    return next((item for item in tools if capability in (item.get("capabilities") or [])), None)


def load_usage(
    path: Path | None,
    project_root: Path,
) -> tuple[dict[str, dict[str, Any]], dict[str, Any], dict[str, Any] | None]:
    if path is None:
        return {}, {}, None
    resolved = path.expanduser().resolve()
    value = require(resolved, "playable-resource-usage-evidence-v1")
    if Path(str(value.get("projectRoot") or "")).expanduser().resolve() != project_root:
        raise ValueError("资源使用证据不属于当前项目")
    resources = value.get("resources")
    if not isinstance(resources, list):
        raise ValueError("资源使用证据 resources 必须是数组")
    result: dict[str, dict[str, Any]] = {}
    for item in resources:
        if not isinstance(item, dict) or not isinstance(item.get("path"), str):
            raise ValueError("资源使用证据项必须包含 path")
        if item["path"] in result:
            raise ValueError(f"资源使用证据路径重复：{item['path']}")
        result[item["path"]] = item
    evidence_mode = str(value.get("evidenceMode") or "legacy-read-only")
    return result, value.get("textCoverage") or {}, {
        "path": str(resolved),
        "sha256": sha256_file(resolved),
        "evidenceMode": evidence_mode,
        "newAuditEligible": evidence_mode == "per-resource-v2",
    }


def tool_ref(tool: dict[str, Any] | None, capability: str) -> dict[str, Any] | None:
    if tool is None:
        return None
    return {
        "name": tool.get("name"), "version": tool.get("version"), "executable": tool.get("executable"),
        "executableSha256": tool.get("executableSha256"), "capability": capability,
    }


def priority_inputs(*, savings: int, confidence: float, risk: float, compatibility: float = 1.0, validation: float = 1.0) -> dict[str, Any]:
    return {
        "estimatedNetSavingsBytes": max(0, savings), "evidenceConfidence": confidence,
        "effectRisk": risk, "compatibilityCost": compatibility, "validationCost": validation,
    }


def missing_guidance(capabilities: set[str]) -> dict[str, str] | None:
    if not capabilities:
        return None
    labels = {
        "audio-reencode": "FFmpeg（音频候选重编码）",
        "image-resize": "FFmpeg 或项目批准的本地图片工具（图片降采样）",
        "image-reencode": "FFmpeg 或项目批准的本地图片工具（图片格式/质量候选）",
        "atlas-repack": "Skill 通用图片合集执行器或项目 Adapter 声明的图片合集工具",
        "model-convert": "FBX2glTF（网页三维格式转换）",
        "model-compact": "gltf-transform（紧凑保存三维数据）",
        "model-simplify": "gltf-transform（适量减少三维物体面数）",
        "font-subset": "项目 Adapter 明确声明的本地字体子集工具",
        "config-prune": "Skill 内建配置引用闭包执行器",
    }
    shown = "、".join(labels.get(item, item) for item in sorted(capabilities))
    return {
        "missing": f"当前电脑缺少：{shown}。",
        "purpose": "这些工具只用于在本机候选目录生成对应资源的单变量优化版本。",
        "install": "请按项目文档或工具官方安装方式安装到本机；本流程不会静默安装，也不会上传在线服务。",
        "impactWithoutInstall": "如果暂不安装，本轮会保持这些资源的原文件，无法完成对应的有损候选和保真对比。",
        "resume": "安装后请从同一运行重新执行工具发现与锁定；版本、路径和 SHA-256 验签通过后会继续当前资源阶段。",
    }


def common_result(common: dict[str, Any], metadata: dict[str, Any], **values: Any) -> dict[str, Any]:
    return {
        **common, "metadata": metadata, "riskProfile": values.pop("riskProfile", "NORMAL"),
        "abRequirements": values.pop("abRequirements", []), "candidatePolicy": "single-variable",
        **values,
    }


IMAGE_RISK_TYPES = {
    "TEXT", "CTA", "KEY_UI", "NINE_SLICE", "TRANSPARENT_EDGE",
    "LOGO", "NORMAL", "NORMAL_MAP", "DATA", "DATA_IMAGE", "MASK", "PIXEL_MASK",
    "LUT", "LOOKUP_TABLE", "INDEX", "INDEX_IMAGE", "QR_CODE", "BARCODE", "PIXEL_PROTOCOL",
}

PIXEL_SENSITIVE_IMAGE_RISKS = {
    "NORMAL", "NORMAL_MAP", "DATA", "DATA_IMAGE", "MASK", "PIXEL_MASK", "LUT",
    "LOOKUP_TABLE", "INDEX", "INDEX_IMAGE", "QR_CODE", "BARCODE", "PIXEL_PROTOCOL",
}


def normalized_image_risks(
    usage: dict[str, Any],
    *,
    strict: bool,
) -> tuple[list[dict[str, Any]], list[str]]:
    errors: list[str] = []
    raw_features = usage.get("riskFeatures")
    legacy = usage.get("protections") or []
    if raw_features is None:
        if strict and legacy:
            errors.append("新用途证据不能只提供 protections；每个风险特征必须绑定逐资源 evidence")
            raw_features = []
        else:
            raw_features = [
                {"type": item, "evidence": ["legacy-protection"], "constraints": []}
                for item in legacy
            ]
    if not isinstance(raw_features, list):
        return [], ["riskFeatures 必须是数组"]
    features: list[dict[str, Any]] = []
    seen: set[str] = set()
    for raw in raw_features:
        if not isinstance(raw, dict):
            errors.append("riskFeatures 每项必须是对象")
            continue
        feature_type = str(raw.get("type") or "").upper().replace("-", "_")
        evidence = raw.get("evidence")
        constraints = raw.get("constraints") or []
        if feature_type not in IMAGE_RISK_TYPES:
            errors.append(f"未知图片风险特征：{feature_type or '空值'}")
            continue
        if feature_type in seen:
            errors.append(f"图片风险特征重复：{feature_type}")
            continue
        if strict and (not isinstance(evidence, list) or not evidence or not all(isinstance(item, str) and item.strip() for item in evidence)):
            errors.append(f"图片风险特征 {feature_type} 缺少逐资源 evidence")
            continue
        if not isinstance(constraints, list) or not all(isinstance(item, str) and item.strip() for item in constraints):
            errors.append(f"图片风险特征 {feature_type} 的 constraints 必须是字符串数组")
            continue
        features.append({
            "type": feature_type,
            "evidence": sorted({str(item).strip() for item in (evidence or []) if str(item).strip()}),
            "constraints": sorted({str(item).strip() for item in constraints}),
        })
        seen.add(feature_type)
    return features, errors


def image_candidate(
    *,
    variable: str,
    action: str,
    capability: str,
    parameters: dict[str, Any],
    tool: dict[str, Any] | None,
    savings: int,
    confidence: float,
    risk: float,
) -> dict[str, Any]:
    return {
        "variable": variable,
        "action": action,
        "requiredCapability": capability,
        "parameters": parameters,
        "tool": tool_ref(tool, capability),
        "executable": tool is not None,
        "priorityInputs": priority_inputs(
            savings=savings, confidence=confidence, risk=risk, validation=2.5 if risk >= 2 else 1.5,
        ),
    }


def audit_image(
    common: dict[str, Any],
    source: Path,
    usage: dict[str, Any],
    tools: list[dict[str, Any]],
    *,
    strict_evidence: bool,
    tinify_enabled: bool = False,
) -> dict[str, Any]:
    metadata = probe_path(source)
    display = usage.get("display") or {}
    risk_records, risk_errors = normalized_image_risks(usage, strict=strict_evidence)
    risk_features = [item["type"] for item in risk_records]
    risk_set = set(risk_features)
    if risk_errors:
        return common_result(
            common, metadata, decision="UNSUPPORTED", ruleId="RESOURCE-OPP-IMAGE-PROTECTION-EVIDENCE-MISSING",
            reason="；".join(risk_errors), suggestedAction=None, tool=None, riskProfile="HIGH",
            riskFeatures=risk_features, riskFeatureEvidence=risk_records,
            opportunityChecks={
                "dimensions": {"status": "NOT_EVALUATED", "reason": "风险特征证据无效"},
                "format": {"status": "NOT_EVALUATED", "reason": "风险特征证据无效"},
                "quality": {"status": "NOT_EVALUATED", "reason": "风险特征证据无效"},
            },
            abRequirements=["whole", "zoom"], transformConstraints=[],
        )
    transform_constraints: list[str] = []
    if metadata.get("hasAlpha") or "TRANSPARENT_EDGE" in risk_set:
        transform_constraints.append("preserve-alpha")
    if "NINE_SLICE" in risk_set and not (usage.get("sliceMapping") or usage.get("nineSliceBorders")):
        transform_constraints.append("slice-map-missing")
    pixel_sensitive = bool(risk_set & PIXEL_SENSITIVE_IMAGE_RISKS)
    if pixel_sensitive:
        transform_constraints.extend([
            "pixel-equivalent-only", "preserve-color-space", "preserve-channels",
            "semantic-validation-required",
        ])
    transform_constraints = list(dict.fromkeys(transform_constraints))
    high_risk = bool(risk_set)
    ab = ["whole", "zoom"]
    if metadata.get("hasAlpha") or "TRANSPARENT_EDGE" in risk_set:
        ab.append("transparent-background")
    if risk_set & {"TEXT", "CTA", "LOGO", "KEY_UI", "NINE_SLICE", "TRANSPARENT_EDGE"}:
        ab.append("runtime-scene")
    semantic_requirements = []
    if pixel_sensitive:
        semantic_requirements.extend(["decoded-rgba", "color-space", "channel-values", "runtime-semantic"])
    if risk_set & {"QR_CODE", "BARCODE", "PIXEL_PROTOCOL"}:
        semantic_requirements.append("decode-result")
    atlas_inputs = usage.get("atlasInputs")
    atlas_axis_checks = {
        "dimensions": {
            "status": "PRESERVED_BY_ATLAS_ACTION",
            "reason": "图片合集动作只调整装箱位置，不改变单图像素尺寸",
        },
        "format": {
            "status": "PRESERVED_BY_ATLAS_ACTION",
            "reason": "图片合集动作保留 PNG 与 alpha，不夹带格式变换",
        },
        "quality": {
            "status": "PRESERVED_BY_ATLAS_ACTION",
            "reason": "图片合集动作使用逐像素复制，不夹带质量变化",
        },
    }
    if isinstance(atlas_inputs, list) and len(atlas_inputs) >= 2:
        if usage.get("atlasRuntimeSupported") is not True or usage.get("atlasCandidatesStable") is not True:
            return common_result(
                common, metadata, decision="KEEP", ruleId="RESOURCE-OPP-ATLAS-RUNTIME-OR-INPUTS-NOT-READY",
                reason="图片合集只在 runtime 明确支持位置表且所有输入候选稳定后试做；当前保持各单图原文件",
                suggestedAction=None, tool=None, riskProfile="HIGH", abRequirements=ab,
                riskFeatures=risk_features, riskFeatureEvidence=risk_records,
                transformConstraints=transform_constraints,
                opportunityChecks=atlas_axis_checks,
                completedOpportunityAxes=["dimensions", "format", "quality"],
            )
        tool = supported_tool(tools, "atlas-repack")
        output_path = usage.get("atlasOutputPath")
        if not isinstance(output_path, str) or not output_path.lower().endswith(".png"):
            return common_result(
                common, metadata, decision="UNSUPPORTED", ruleId="RESOURCE-OPP-ATLAS-OUTPUT-MISSING",
                reason="图片合集缺少项目内目标路径证据，不能生成候选",
                suggestedAction=None, tool=None, riskProfile="HIGH", abRequirements=ab,
            )
        parameters = {
            "inputPaths": atlas_inputs,
            "outputPath": output_path,
            "parameterRanges": {"padding": [2], "edgeExtrude": [1]},
            "runtimeMappingEvidence": usage.get("runtimeMappingEvidence"),
            "candidateOnlyUnlessAdapterMapsWrites": True,
        }
        total_input_bytes = int(usage.get("atlasInputBytes") or source.stat().st_size)
        runtime_cost = int(usage.get("additionalRuntimeBytes") or 0)
        return common_result(
            common, metadata, decision="OPTIMIZE" if tool else "UNSUPPORTED", ruleId="RESOURCE-OPP-ATLAS-SMALL-IMAGE-GROUP",
            reason="一组已稳定的小图片可生成带位置表、padding 和边缘扩展的图片合集" + ("" if tool else "；缺少已锁定的图片合集执行能力"),
            suggestedAction={"action": "REPACK_ATLAS", "requiredCapability": "atlas-repack", "parameters": parameters},
            tool=tool_ref(tool, "atlas-repack"), riskProfile="HIGH",
            abRequirements=["round-trip-sprites", "edge-extrusion", "runtime-scene"],
            riskFeatures=risk_features, riskFeatureEvidence=risk_records,
            transformConstraints=transform_constraints,
            opportunityChecks=atlas_axis_checks,
            completedOpportunityAxes=["dimensions", "format", "quality"],
            priorityInputs=priority_inputs(
                savings=max(0, total_input_bytes // 4 - runtime_cost), confidence=0.85,
                risk=2.5, compatibility=2.5, validation=3,
            ),
        )
    if usage.get("atlasOwner"):
        return common_result(
            common, metadata, decision="KEEP", ruleId="RESOURCE-OPP-ATLAS-GROUP-MEMBER",
            reason=f"该小图片由图片合集主动作 {usage.get('atlasOwner')} 统一处置，项目原文件保持不变",
            suggestedAction=None, tool=None, abRequirements=ab,
            riskFeatures=risk_features, riskFeatureEvidence=risk_records,
            transformConstraints=transform_constraints,
            opportunityChecks=atlas_axis_checks,
            completedOpportunityAxes=["dimensions", "format", "quality"],
        )
    width = display.get("maxWidthPx")
    height = display.get("maxHeightPx")
    dpr = display.get("maxDevicePixelRatio", 1)
    if not isinstance(width, (int, float)) or not isinstance(height, (int, float)) or width <= 0 or height <= 0 or not isinstance(dpr, (int, float)) or dpr <= 0:
        return common_result(
            common, metadata, decision="UNSUPPORTED", ruleId="RESOURCE-OPP-IMAGE-DISPLAY-EVIDENCE-MISSING",
            reason="缺少真实显示尺寸证据，不能安全建议降采样", suggestedAction=None, tool=None,
            riskProfile="HIGH", abRequirements=ab, riskFeatures=risk_features,
            riskFeatureEvidence=risk_records, transformConstraints=transform_constraints,
            opportunityChecks={
                "dimensions": {"status": "NOT_EVALUATED", "reason": "显示尺寸证据缺失"},
                "format": {"status": "NOT_EVALUATED", "reason": "显示尺寸证据缺失"},
                "quality": {"status": "NOT_EVALUATED", "reason": "显示尺寸证据缺失"},
            },
        )
    target_width = max(1, math.ceil(width * dpr))
    target_height = max(1, math.ceil(height * dpr))
    source_width = int(metadata.get("widthPx") or 0)
    source_height = int(metadata.get("heightPx") or 0)
    oversize = source_width > target_width or source_height > target_height
    lossless_only = bool(risk_set & {"NORMAL", "NORMAL_MAP", "DATA", "DATA_IMAGE"})
    resize_blocked = "slice-map-missing" in transform_constraints or "pixel-equivalent-only" in transform_constraints
    checks: dict[str, dict[str, Any]] = {}
    candidates: list[dict[str, Any]] = []
    if oversize and not resize_blocked:
        resize_tool = supported_tool(tools, "image-resize")
        savings = max(1, source.stat().st_size - round(
            source.stat().st_size * min(1.0, target_width * target_height / max(1, source_width * source_height))
        ))
        parameters = {
            "candidateVariable": "dimensions",
            "parameterRanges": {"maxWidthPx": [target_width], "maxHeightPx": [target_height]},
            "preserveAspectRatio": True,
            "preserveAlpha": bool(metadata.get("hasAlpha")),
            "colorSpace": "unchanged",
            "format": "unchanged",
            "riskFeatures": risk_features,
            "transformConstraints": transform_constraints,
        }
        candidates.append(image_candidate(
            variable="dimensions", action="RESIZE", capability="image-resize", parameters=parameters,
            tool=resize_tool, savings=savings, confidence=0.95, risk=2.5 if high_risk else 1.5,
        ))
        checks["dimensions"] = {
            "status": "OPPORTUNITY", "source": [source_width, source_height],
            "target": [target_width, target_height], "requiredCapability": "image-resize",
        }
    elif oversize:
        checks["dimensions"] = {
            "status": "BLOCKED_BY_CONSTRAINT", "source": [source_width, source_height],
            "target": [target_width, target_height], "constraints": transform_constraints,
        }
    else:
        checks["dimensions"] = {
            "status": "NO_OPPORTUNITY", "source": [source_width, source_height],
            "target": [target_width, target_height], "reason": "源图片没有超过真实显示需求；不会放大",
        }
    raw_formats = usage.get("formatCandidates")
    format_candidates = [str(item) for item in raw_formats] if isinstance(raw_formats, list) else []
    if lossless_only:
        format_candidates = [item for item in format_candidates if "lossless" in item.lower() or item.lower() in {"png", "unchanged"}]
    if format_candidates:
        format_tool = supported_tool(tools, "image-reencode")
        parameters = {
            "candidateVariable": "format",
            "parameterRanges": {"format": format_candidates},
            "preserveAlpha": bool(metadata.get("hasAlpha")),
            "colorSpace": "unchanged",
            "losslessOnly": lossless_only or all("lossless" in item.lower() or item.lower() in {"png", "unchanged"} for item in format_candidates),
            "riskFeatures": risk_features,
            "transformConstraints": transform_constraints,
        }
        candidates.append(image_candidate(
            variable="format", action="REENCODE", capability="image-reencode", parameters=parameters,
            tool=format_tool, savings=max(1, source.stat().st_size // 10), confidence=0.65,
            risk=2.5 if high_risk else 1.5,
        ))
        checks["format"] = {"status": "OPPORTUNITY", "candidates": format_candidates, "requiredCapability": "image-reencode"}
    else:
        checks["format"] = {
            "status": "EVALUATED_NO_OPPORTUNITY",
            "reason": "当前格式没有已证明兼容且可产生正收益的单变量替代；保留原格式",
        }
    raw_quality = usage.get("qualityCandidates")
    quality_candidates = list(raw_quality) if isinstance(raw_quality, list) else []
    if quality_candidates and not lossless_only:
        quality_tool = supported_tool(tools, "image-reencode")
        parameters = {
            "candidateVariable": "quality",
            "parameterRanges": {"quality": quality_candidates},
            "preserveAlpha": bool(metadata.get("hasAlpha")),
            "colorSpace": "unchanged",
            "losslessOnly": False,
            "riskFeatures": risk_features,
            "transformConstraints": transform_constraints,
        }
        candidates.append(image_candidate(
            variable="quality", action="REENCODE", capability="image-reencode", parameters=parameters,
            tool=quality_tool, savings=max(1, source.stat().st_size // 8), confidence=0.55,
            risk=3 if high_risk else 2,
        ))
        checks["quality"] = {"status": "OPPORTUNITY", "candidates": quality_candidates, "requiredCapability": "image-reencode"}
    else:
        checks["quality"] = {
            "status": "EVALUATED_NO_OPPORTUNITY",
            "reason": "数值/数据用途禁止有损质量变化" if lossless_only else "没有已批准且可证明正收益的质量范围",
        }
    local_candidates = candidates
    tinify_candidate = None
    if tinify_enabled:
        tinify_parameters = {
            "operation": "shrink",
            "preserveFormat": True,
            "preserveDimensions": True,
            "preserveAspectRatio": True,
            "preserveAlphaCapability": True,
            "riskFeatures": risk_features,
            "semanticValidationRequirements": semantic_requirements,
        }
        tinify_candidate = {
            "variable": "encoded-bytes",
            "action": "TINIFY_SHRINK",
            "parameters": tinify_parameters,
            "provider": "tinify",
            "service": "Tinify Developer API",
            "executable": True,
            "estimatedRequestCount": 1,
            "priorityInputs": priority_inputs(
                savings=max(1, source.stat().st_size // 5), confidence=0.7,
                risk=3 if pixel_sensitive else 2.5 if high_risk else 1.5,
                compatibility=1.5, validation=3 if high_risk else 2,
            ),
        }
    executable = [item for item in local_candidates if item["executable"]]
    selected = tinify_candidate or (executable[0] if executable else local_candidates[0] if local_candidates else None)
    if selected is None:
        keep_rule = (
            "RESOURCE-OPP-IMAGE-NO-UPSCALE"
            if checks["dimensions"]["status"] == "NO_OPPORTUNITY"
            else "RESOURCE-OPP-IMAGE-AUDITED-NO-BENEFIT"
        )
        return common_result(
            common, metadata, decision="KEEP", ruleId=keep_rule,
            reason="尺寸、格式和质量已分别审计；当前没有可证明正向收益的安全单变量候选",
            suggestedAction=None, tool=None, riskProfile="HIGH" if high_risk else "NORMAL",
            abRequirements=ab, riskFeatures=risk_features, riskFeatureEvidence=risk_records,
            transformConstraints=transform_constraints, opportunityChecks=checks, candidates=[],
            pixelSensitive=pixel_sensitive, semanticValidationRequirements=semantic_requirements,
            completedOpportunityAxes=["dimensions", "format", "quality"],
        )
    selected_action = {
        "action": selected["action"],
        "parameters": selected["parameters"],
    }
    if selected.get("requiredCapability"):
        selected_action["requiredCapability"] = selected["requiredCapability"]
    if selected.get("provider"):
        selected_action["provider"] = selected["provider"]
        selected_action["service"] = selected["service"]
        selected_action["estimatedRequestCount"] = selected["estimatedRequestCount"]
    decision = "OPTIMIZE" if selected["executable"] else "UNSUPPORTED"
    if selected["action"] == "TINIFY_SHRINK":
        selected_rule = "RESOURCE-OPP-IMAGE-TINIFY-SHRINK"
        reason = "图片可在保持原格式、宽高、宽高比和透明能力的前提下试做 Tinify shrink 候选"
    else:
        selected_rule = {
            "dimensions": "RESOURCE-OPP-IMAGE-DISPLAY-SIZE",
            "format": "RESOURCE-OPP-IMAGE-FORMAT-CANDIDATE",
            "quality": "RESOURCE-OPP-IMAGE-QUALITY-CANDIDATE",
        }[selected["variable"]]
        reason = {
            "dimensions": f"源图片 {source_width}×{source_height} 超过真实显示需求 {target_width}×{target_height}",
            "format": "尺寸无需调整或受结构约束，但独立格式审计发现安全的单变量候选",
            "quality": "尺寸与格式审计后，独立质量审计发现受约束的单变量候选",
        }[selected["variable"]]
    if not selected["executable"]:
        reason += "；缺少已锁定的本地图片处理能力"
    return common_result(
        common, metadata, decision=decision, ruleId=selected_rule, reason=reason,
        suggestedAction=selected_action, tool=selected.get("tool"),
        provider=selected.get("provider"), service=selected.get("service"),
        riskProfile="HIGH" if high_risk else "NORMAL", abRequirements=ab,
        priorityInputs=selected["priorityInputs"], riskFeatures=risk_features,
        riskFeatureEvidence=risk_records, transformConstraints=transform_constraints,
        opportunityChecks=checks, candidates=([tinify_candidate] if tinify_candidate else []) + local_candidates,
        localFallbackCandidates=local_candidates if tinify_candidate else [],
        pixelSensitive=pixel_sensitive, semanticValidationRequirements=semantic_requirements,
        completedOpportunityAxes=["dimensions", "format", "quality"],
    )


def audit_model(common: dict[str, Any], source: Path, usage: dict[str, Any], tools: list[dict[str, Any]]) -> dict[str, Any]:
    metadata = probe_path(source)
    runtime_formats = {str(item).lower().lstrip(".") for item in usage.get("runtimeFormats") or []}
    protections = usage.get("protections") or ["UV", "NORMAL", "TANGENT", "TRANSPARENT_FACE", "SKIN", "ANIMATION"]
    costs = {"loaderBytes": int(usage.get("additionalLoaderBytes") or 0), "decoderBytes": int(usage.get("additionalDecoderBytes") or 0), "fallbackBytes": int(usage.get("fallbackBytes") or 0)}
    if metadata.get("format") == "fbx" and not ({"glb", "gltf"} & runtime_formats):
        return common_result(
            common, metadata, decision="KEEP", ruleId="RESOURCE-OPP-MODEL-RUNTIME-FORMAT-PROTECTED",
            reason="当前 runtime 没有声明可消费 GLB/GLTF，不能执行格式转换", suggestedAction=None, tool=None,
            riskProfile="HIGH", abRequirements=["runtime-near-view", "animation-mid-frame"], protectedFeatures=protections, netBenefitCosts=costs,
        )
    target = usage.get("targetTriangleCount")
    triangles = metadata.get("triangleCount")
    if isinstance(target, int) and target > 0 and isinstance(triangles, int) and triangles > target:
        required = "model-simplify"
        tool = supported_tool(tools, required)
        estimated = max(1, round(source.stat().st_size * (1 - target / triangles)) - sum(costs.values()))
        return common_result(
            common, metadata, decision="OPTIMIZE" if tool else "UNSUPPORTED", ruleId="RESOURCE-OPP-MODEL-TRIANGLE-BUDGET",
            reason=f"三维物体约 {triangles} 个三角面，高于用途证据给出的 {target} 个目标" + ("" if tool else "；缺少已锁定的三维物体减面工具"),
            suggestedAction={"action": "SIMPLIFY", "requiredCapability": required, "parameters": {"parameterRanges": {"targetTriangleCount": [target], "ratio": [round(target / triangles, 6)]}, "preserve": protections}},
            tool=tool_ref(tool, required), riskProfile="HIGH", abRequirements=["runtime-near-view", "animation-mid-frame"],
            protectedFeatures=protections, netBenefitCosts=costs,
            priorityInputs=priority_inputs(savings=estimated, confidence=0.9, risk=3, compatibility=2, validation=3),
        )
    if metadata.get("format") == "fbx" and ({"glb", "gltf"} & runtime_formats):
        required = "model-convert"
        tool = supported_tool(tools, required)
        return common_result(
            common, metadata, decision="OPTIMIZE" if tool else "UNSUPPORTED", ruleId="RESOURCE-OPP-MODEL-WEB-FORMAT",
            reason="runtime 已声明支持网页三维格式，可单独试做 FBX 到 GLB 转换" + ("" if tool else "；缺少已锁定的格式转换工具"),
            suggestedAction={"action": "REENCODE", "requiredCapability": required, "parameters": {"parameterRanges": {"format": ["glb"]}, "preserve": protections}},
            tool=tool_ref(tool, required), riskProfile="HIGH", abRequirements=["runtime-near-view", "animation-mid-frame"],
            protectedFeatures=protections, netBenefitCosts=costs,
            priorityInputs=priority_inputs(savings=max(0, source.stat().st_size // 3 - sum(costs.values())), confidence=0.8, risk=3, compatibility=3, validation=3),
        )
    compact_bytes = metadata.get("compactJsonBytes")
    if metadata.get("format") == "gltf" and isinstance(compact_bytes, int) and source.stat().st_size - compact_bytes >= 64:
        required = "model-compact"
        tool = supported_tool(tools, required)
        estimated = max(0, source.stat().st_size - compact_bytes - sum(costs.values()))
        return common_result(
            common, metadata, decision="OPTIMIZE" if tool else "UNSUPPORTED", ruleId="RESOURCE-OPP-MODEL-COMPACT-STORAGE",
            reason="三维物体 JSON 存在可证明的紧凑存储空间" + ("" if tool else "；缺少已锁定的紧凑存储工具"),
            suggestedAction={"action": "REENCODE", "requiredCapability": required, "parameters": {"operation": "compact", "parameterRanges": {"format": ["gltf"]}, "preserve": protections}},
            tool=tool_ref(tool, required), riskProfile="HIGH", abRequirements=["runtime-near-view", "animation-mid-frame"],
            protectedFeatures=protections, netBenefitCosts=costs,
            priorityInputs=priority_inputs(savings=estimated, confidence=0.9, risk=2, compatibility=1.5, validation=3),
        )
    return common_result(
        common, metadata, decision="KEEP", ruleId="RESOURCE-OPP-MODEL-WITHIN-EVIDENCE",
        reason="没有命中可证明正向净收益的格式、紧凑存储或减面机会", suggestedAction=None, tool=None,
        riskProfile="HIGH", abRequirements=["runtime-near-view", "animation-mid-frame"], protectedFeatures=protections, netBenefitCosts=costs,
    )


def audit_font_legacy(common: dict[str, Any], source: Path, text_coverage: dict[str, Any], tools: list[dict[str, Any]]) -> dict[str, Any]:
    metadata = probe_path(source)
    static = "".join(str(item) for item in text_coverage.get("staticTexts") or [])
    dynamic = "".join(str(item) for item in text_coverage.get("dynamicTexts") or [])
    languages = text_coverage.get("targetLanguageCharacters") or {}
    language_characters = "".join(str(value) for value in languages.values()) if isinstance(languages, dict) else ""
    characters = "".join(sorted(set(static + dynamic + language_characters)))
    complete = text_coverage.get("dynamicSourcesComplete") is True and bool(characters)
    proof = {"status": "COMPLETE" if complete else "INCOMPLETE", "requiredCharacters": characters, "requiredCharacterCount": len(characters), "staticTextCount": len(text_coverage.get("staticTexts") or []), "dynamicTextCount": len(text_coverage.get("dynamicTexts") or []), "targetLanguages": sorted(languages) if isinstance(languages, dict) else []}
    if not complete:
        return common_result(
            common, metadata, decision="KEEP", ruleId="RESOURCE-OPP-FONT-DYNAMIC-INCOMPLETE",
            reason="历史全局 textCoverage 的动态来源不完整；只读保留旧 KEEP 语义，不能作为新审计通过",
            suggestedAction=None, tool=None, riskProfile="HIGH", coverageProof=proof,
            abRequirements=["glyph-grid", "runtime-text"], legacyReadOnly=True,
        )
    tool = supported_tool(tools, "font-subset")
    return common_result(
        common, metadata, decision="KEEP", ruleId="RESOURCE-OPP-FONT-LEGACY-GLOBAL-COVERAGE",
        reason="历史运行只提供项目级 textCoverage；保留旧结果只读兼容，不生成新的逐字体精简结论",
        suggestedAction=None, tool=None, riskProfile="HIGH", coverageProof=proof,
        abRequirements=["glyph-grid", "runtime-text"], legacyReadOnly=True,
    )


def string_list(value: Any) -> list[str] | None:
    if not isinstance(value, list) or not all(isinstance(item, str) and item.strip() for item in value):
        return None
    return [item.strip() for item in value]


def audit_font(
    common: dict[str, Any],
    source: Path,
    usage: dict[str, Any],
    tools: list[dict[str, Any]],
) -> dict[str, Any]:
    metadata = probe_path(source)
    font_usage = usage.get("fontUsage")
    if not isinstance(font_usage, dict):
        return common_result(
            common, metadata, decision="UNSUPPORTED", ruleId="RESOURCE-OPP-FONT-USAGE-EVIDENCE-MISSING",
            reason="当前字体缺少独立 fontUsage，不能用项目级字符集合代替逐字体用途证据",
            suggestedAction=None, tool=None, riskProfile="HIGH",
            coverageProof={"status": "INCOMPLETE", "dynamicSourcesComplete": False},
            abRequirements=["glyph-grid", "runtime-text", "layout", "fallback"],
        )
    roles = string_list(font_usage.get("roles"))
    static_texts = string_list(font_usage.get("staticTexts"))
    dynamic_texts = string_list(font_usage.get("dynamicTexts"))
    dynamic_sources = string_list(font_usage.get("dynamicSources"))
    fallback_chain = string_list(font_usage.get("fallbackChain"))
    style_contexts = string_list(font_usage.get("styleContexts"))
    evidence = string_list(font_usage.get("evidence"))
    languages = font_usage.get("targetLanguageCharacters")
    errors: list[str] = []
    for name, value in (
        ("roles", roles), ("staticTexts", static_texts), ("dynamicTexts", dynamic_texts),
        ("dynamicSources", dynamic_sources), ("fallbackChain", fallback_chain),
        ("styleContexts", style_contexts), ("evidence", evidence),
    ):
        if value is None:
            errors.append(f"fontUsage.{name} 必须是字符串数组")
    if not roles:
        errors.append("fontUsage.roles 不能为空")
    if not style_contexts:
        errors.append("fontUsage.styleContexts 不能为空")
    if not evidence:
        errors.append("fontUsage.evidence 不能为空")
    if not isinstance(languages, dict) or not all(isinstance(key, str) and isinstance(value, str) for key, value in languages.items()):
        errors.append("fontUsage.targetLanguageCharacters 必须是语言到字符的对象")
        languages = {}
    static = "".join(static_texts or [])
    dynamic = "".join(dynamic_texts or [])
    language_characters = "".join(str(value) for value in languages.values())
    icon_codepoints = string_list(font_usage.get("iconCodepoints")) or []
    if roles and "icon" in {item.lower() for item in roles} and not icon_codepoints:
        errors.append("图标字体必须逐项声明 iconCodepoints")
    icon_characters = ""
    for codepoint in icon_codepoints:
        try:
            icon_characters += chr(int(codepoint.removeprefix("U+").removeprefix("u+"), 16))
        except (ValueError, OverflowError):
            errors.append(f"图标码位无效：{codepoint}")
    fallback_characters_value = font_usage.get("fallbackCharacters") or {}
    if not isinstance(fallback_characters_value, dict) or not all(
        isinstance(key, str) and isinstance(value, str) for key, value in fallback_characters_value.items()
    ):
        errors.append("fontUsage.fallbackCharacters 必须是 fallback 到字符的对象")
        fallback_characters_value = {}
    fallback_characters = set("".join(fallback_characters_value.values()))
    all_characters = set(static + dynamic + language_characters + icon_characters)
    characters = "".join(sorted(all_characters - fallback_characters))
    complete = font_usage.get("dynamicSourcesComplete") is True and bool(characters) and not errors
    proof = {
        "status": "COMPLETE" if complete else "INCOMPLETE",
        "roles": roles or [],
        "requiredCharacters": characters,
        "requiredCharacterCount": len(characters),
        "staticTextCount": len(static_texts or []),
        "dynamicTextCount": len(dynamic_texts or []),
        "dynamicSources": dynamic_sources or [],
        "dynamicSourcesComplete": font_usage.get("dynamicSourcesComplete") is True,
        "targetLanguages": sorted(languages),
        "fallbackChain": fallback_chain or [],
        "fallbackCharacters": "".join(sorted(fallback_characters)),
        "styleContexts": style_contexts or [],
        "fontWeights": font_usage.get("fontWeights") or [],
        "fontStyles": font_usage.get("fontStyles") or [],
        "variableAxes": font_usage.get("variableAxes") or {},
        "shapingLanguages": font_usage.get("shapingLanguages") or [],
        "iconCodepoints": icon_codepoints,
        "evidence": evidence or [],
        "errors": errors,
    }
    if not complete:
        reason_parts = list(errors)
        if font_usage.get("dynamicSourcesComplete") is not True:
            reason_parts.append("当前字体的动态文案来源尚未闭合")
        if not characters:
            reason_parts.append("当前字体的独立字符集合为空")
        return common_result(
            common, metadata, decision="UNSUPPORTED", ruleId="RESOURCE-OPP-FONT-COVERAGE-INCOMPLETE",
            reason="；".join(dict.fromkeys(reason_parts)), suggestedAction=None, tool=None,
            riskProfile="HIGH", coverageProof=proof,
            abRequirements=["glyph-grid", "runtime-text", "layout", "fallback"],
        )
    tool = supported_tool(tools, "font-subset")
    parameters = {
        "parameterRanges": {"characters": [characters]},
        "roles": roles,
        "targetLanguages": sorted(languages),
        "fallbackChain": fallback_chain,
        "styleContexts": style_contexts,
        "fontWeights": font_usage.get("fontWeights") or [],
        "fontStyles": font_usage.get("fontStyles") or [],
        "variableAxes": font_usage.get("variableAxes") or {},
        "shapingLanguages": font_usage.get("shapingLanguages") or [],
        "iconCodepoints": icon_codepoints,
        "verifyMissingGlyphs": True,
        "verifyFallback": True,
        "verifyLayout": True,
    }
    return common_result(
        common, metadata, decision="OPTIMIZE" if tool else "UNSUPPORTED",
        ruleId="RESOURCE-OPP-FONT-COVERAGE-COMPLETE",
        reason="当前字体的用途、动态来源、目标语言、样式和 fallback 已形成独立覆盖证明"
        + ("" if tool else "；缺少已锁定的字体子集工具"),
        suggestedAction={"action": "SUBSET_FONT", "requiredCapability": "font-subset", "parameters": parameters},
        tool=tool_ref(tool, "font-subset"), riskProfile="HIGH", coverageProof=proof,
        abRequirements=["glyph-grid", "runtime-text", "layout", "fallback", "font-metrics"],
        priorityInputs=priority_inputs(savings=source.stat().st_size // 2, confidence=0.85, risk=3, validation=3),
    )


def audit_config(common: dict[str, Any], source: Path, usage: dict[str, Any], tools: list[dict[str, Any]]) -> dict[str, Any]:
    metadata = probe_path(source)
    pointers = usage.get("reachablePointers")
    complete = usage.get("dynamicReadsComplete") is True
    proof = {"dynamicReadsComplete": complete, "reachablePointers": sorted(set(pointers or [])), "method": "explicit-reference-closure"}
    if not complete or not isinstance(pointers, list) or not pointers:
        return common_result(common, metadata, decision="KEEP", ruleId="RESOURCE-OPP-CONFIG-DYNAMIC-INCOMPLETE", reason="动态配置读取路径尚未闭合，保持原配置", suggestedAction=None, tool=None, riskProfile="HIGH", closureProof=proof)
    top_keys = set()
    for pointer in pointers:
        if isinstance(pointer, str) and pointer.startswith("/"):
            top_keys.add(pointer.split("/", 2)[1])
    if int(metadata.get("topLevelEntryCount") or 0) <= len(top_keys):
        return common_result(common, metadata, decision="KEEP", ruleId="RESOURCE-OPP-CONFIG-CLOSURE-USES-ALL", reason="引用闭包覆盖全部顶层配置，保持原文件", suggestedAction=None, tool=None, closureProof=proof)
    tool = supported_tool(tools, "config-prune")
    return common_result(
        common, metadata, decision="OPTIMIZE" if tool else "UNSUPPORTED", ruleId="RESOURCE-OPP-CONFIG-UNREACHABLE-CLOSURE",
        reason="引用闭包证明存在确定不可达配置；结论不依赖字段名或关键词" + ("" if tool else "；缺少已锁定的配置闭包执行能力"),
        suggestedAction={"action": "PRUNE_CONFIG", "requiredCapability": "config-prune", "parameters": {"parameterRanges": {"reachablePointers": [sorted(set(pointers))]}}},
        tool=tool_ref(tool, "config-prune"), riskProfile="HIGH", closureProof=proof,
        priorityInputs=priority_inputs(savings=source.stat().st_size // 3, confidence=0.95, risk=2, validation=2),
    )


def audit_audio(
    common: dict[str, Any],
    source: Path,
    usage: dict[str, Any],
    tools: list[dict[str, Any]],
    probe: Path | None,
    args: argparse.Namespace,
    *,
    usage_enabled: bool,
) -> dict[str, Any]:
    if source.suffix.lower() == ".wav":
        metadata = probe_path(source)
    else:
        metadata = {
            **probe_path(source),
            **probe_audio(source, probe, args.probe_timeout_seconds),
            "qualityMetrics": "external-metadata-only",
        }
    audio_class = str(usage.get("audioClass") or "").upper()
    if audio_class not in {"BGM", "SFX", "VOICE"}:
        if usage_enabled:
            return common_result(
                common, metadata, decision="UNSUPPORTED", ruleId="RESOURCE-OPP-AUDIO-CLASS-MISSING",
                reason="缺少 BGM、SFX 或语音分类，不能给全部音频套用同一参数",
                suggestedAction=None, tool=None, riskProfile="HIGH",
            )
        audio_class = "REQUIRES_CLASSIFICATION"

    profiles = {
        "BGM": {"bitRateKbps": 80, "sampleRateHz": 44100, "channels": 2, "risk": 2.0},
        "SFX": {"bitRateKbps": 48, "sampleRateHz": 44100, "channels": 1, "risk": 1.5},
        "VOICE": {"bitRateKbps": 64, "sampleRateHz": 32000, "channels": 1, "risk": 2.0},
        "REQUIRES_CLASSIFICATION": {
            "bitRateKbps": args.audio_target_bitrate_kbps,
            "sampleRateHz": args.audio_target_sample_rate_hz,
            "channels": args.audio_max_channels,
            "risk": 3.0,
        },
    }
    profile = profiles[audio_class]
    reasons: list[str] = []
    bitrate = metadata.get("bitRateKbps")
    channels = metadata.get("channels")
    sample_rate = metadata.get("sampleRateHz")
    if isinstance(bitrate, int) and bitrate > max(args.audio_max_bitrate_kbps, int(profile["bitRateKbps"])):
        reasons.append(f"码率 {bitrate} kbps 高于该类音频候选目标")
    if isinstance(channels, int) and channels > int(profile["channels"]):
        reasons.append(f"声道数 {channels} 高于该类音频候选目标")
    if isinstance(sample_rate, int) and sample_rate > int(profile["sampleRateHz"]):
        reasons.append(f"采样率 {sample_rate} Hz 高于该类音频候选目标")
    if not reasons:
        return common_result(
            common, metadata, decision="KEEP", ruleId="RESOURCE-OPP-AUDIO-WITHIN-BUDGET",
            reason="音频码率、声道和采样率没有超过当前分类的审计线",
            suggestedAction=None, tool=None, audioClass=audio_class,
        )

    tool = supported_tool(tools, "audio-reencode")
    parameters = {
        "audioClass": audio_class,
        "candidateVariable": "encoding-profile",
        "format": "mp3",
        "parameterRanges": {
            "bitRateKbps": [profile["bitRateKbps"]],
            "sampleRateHz": [profile["sampleRateHz"]],
            "channels": [profile["channels"]],
            "metadata": ["remove"],
        },
        "preserveDuration": True,
        "allowTrim": False,
        "postEncodeChecks": [
            "duration", "loudness", "peak", "silence", "encoder-delay",
            *(["loop-seam"] if usage.get("loop") is True or audio_class == "BGM" else []),
        ],
    }
    target_ratio = int(profile["bitRateKbps"]) / max(1, int(bitrate or int(profile["bitRateKbps"]) * 2))
    estimated_output = round(source.stat().st_size * max(0.1, min(0.9, target_ratio)))
    return common_result(
        common, metadata, decision="OPTIMIZE" if tool else "UNSUPPORTED", ruleId="RESOURCE-OPP-AUDIO-BUDGET",
        reason="；".join(reasons) + ("" if tool else "；缺少已锁定的本地音频重编码工具"),
        suggestedAction={"action": "REENCODE", "requiredCapability": "audio-reencode", "parameters": parameters},
        tool=tool_ref(tool, "audio-reencode"), audioClass=audio_class,
        abRequirements=["waveform", "listen-before-after"] + (["loop-seam"] if audio_class == "BGM" else []),
        priorityInputs=priority_inputs(
            savings=max(1, source.stat().st_size - estimated_output), confidence=0.9,
            risk=float(profile["risk"]), validation=2.5,
        ),
    )


def audit_resource(
    resource: dict[str, Any],
    project_root: Path,
    tools: list[dict[str, Any]],
    probe: Path | None,
    args: argparse.Namespace,
    usage_by_path: dict[str, dict[str, Any]],
    text_coverage: dict[str, Any],
    usage_mode: str,
    *,
    usage_enabled: bool,
) -> dict[str, Any]:
    relative = str(resource.get("path") or "")
    source = (project_root / relative).resolve()
    if not source.is_file():
        raise ValueError(f"账本资源不存在：{relative}")
    if source.stat().st_size != resource.get("bytes") or sha256_file(source) != resource.get("sha256"):
        raise ValueError(f"账本资源已漂移：{relative}")
    classification = resource.get("classification")
    common = {
        "path": relative,
        "resourceId": resource.get("resourceId"),
        "bucket": resource.get("bucket"),
        "classification": classification,
        "input": {"bytes": source.stat().st_size, "sha256": sha256_file(source)},
    }
    if classification == "UNREFERENCED":
        return {
            **common,
            "decision": "KEEP",
            "ruleId": "RESOURCE-OPP-UNREFERENCED",
            "reason": "资源已由引用闭包判定为未引用；是否从候选载荷排除由 package-only 动作单独决定",
            "metadata": {"extension": source.suffix.lower()},
            "suggestedAction": None,
            "tool": None,
        }
    if classification not in {"REQUIRED", "CONDITIONAL"}:
        return {
            **common,
            "decision": "UNSUPPORTED",
            "ruleId": "RESOURCE-OPP-REFERENCE-UNRESOLVED",
            "reason": "引用分类尚未闭合，不能证明保持或优化均安全",
            "metadata": {"extension": source.suffix.lower()},
            "suggestedAction": None,
            "tool": None,
        }
    usage = usage_by_path.get(relative)
    if usage_enabled and usage is None:
        return common_result(
            common, probe_path(source), decision="UNSUPPORTED", ruleId="RESOURCE-OPP-USAGE-EVIDENCE-MISSING",
            reason="当前资源缺少玩法、关卡、主题、变体、目标端或平台使用证据，不能安全处置",
            suggestedAction=None, tool=None, riskProfile="HIGH",
        )
    usage = usage or {}
    if source.suffix.lower() in AUDIO_EXTENSIONS:
        return audit_audio(common, source, usage, tools, probe, args, usage_enabled=usage_enabled)
    if not usage_enabled:
        return {
            **common,
            "decision": "KEEP",
            "ruleId": "RESOURCE-OPP-NO-REGISTERED-RULE",
            "reason": "旧运行未提供多资源使用证据；按历史兼容行为保持非音频原字节",
            "metadata": {"extension": source.suffix.lower(), "bytes": source.stat().st_size},
            "suggestedAction": None,
            "tool": None,
        }
    bucket = str(resource.get("bucket") or "")
    suffix = source.suffix.lower()
    if bucket in {"textures", "atlas"} or suffix in {".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp"}:
        return audit_image(
            common, source, usage, tools,
            strict_evidence=usage_mode == "per-resource-v2",
            tinify_enabled=usage_mode == "per-resource-v2",
        )
    if bucket == "models" or suffix in {".fbx", ".glb", ".gltf", ".obj", ".dae"}:
        return audit_model(common, source, usage, tools)
    if bucket == "fonts" or suffix in {".ttf", ".otf", ".woff", ".woff2"}:
        if usage_mode == "per-resource-v2":
            return audit_font(common, source, usage, tools)
        return audit_font_legacy(common, source, text_coverage, tools)
    if bucket == "config" or suffix in {".json", ".yaml", ".yml", ".csv", ".xml"}:
        return audit_config(common, source, usage, tools)
    return {
        **common,
        "decision": "KEEP",
        "ruleId": "RESOURCE-OPP-NO-REGISTERED-RULE",
        "reason": "当前 Skill 没有命中该类型的可执行优化规则，保持原字节",
        "metadata": {"extension": source.suffix.lower(), "bytes": source.stat().st_size},
        "suggestedAction": None,
        "tool": None,
    }


def build_bucket_audit(
    items: list[dict[str, Any]],
    *,
    strict_per_resource: bool,
) -> tuple[dict[str, dict[str, Any]], list[dict[str, Any]], list[dict[str, Any]]]:
    buckets: dict[str, dict[str, Any]] = {}
    blockers: list[dict[str, Any]] = []
    warnings: list[dict[str, Any]] = []
    for item in items:
        bucket = str(item.get("bucket") or "other")
        record = buckets.setdefault(bucket, {
            "total": 0, "bytes": 0, "OPTIMIZE": 0, "KEEP": 0, "UNSUPPORTED": 0,
            "keepReasons": {}, "highRiskOptimizeCount": 0,
            "suppressedOpportunityCount": 0, "auditComplete": True,
        })
        record["total"] += 1
        record["bytes"] += int((item.get("input") or {}).get("bytes") or 0)
        decision = str(item.get("decision") or "UNSUPPORTED")
        if decision in {"OPTIMIZE", "KEEP", "UNSUPPORTED"}:
            record[decision] += 1
        else:
            record["UNSUPPORTED"] += 1
            record["auditComplete"] = False
        if decision == "KEEP":
            rule = str(item.get("ruleId") or "RESOURCE-OPP-KEEP-UNKNOWN")
            record["keepReasons"][rule] = int(record["keepReasons"].get(rule, 0)) + 1
        if decision == "OPTIMIZE" and item.get("riskProfile") == "HIGH":
            record["highRiskOptimizeCount"] += 1
        if item.get("classification") in {"REQUIRED", "CONDITIONAL"} and decision == "UNSUPPORTED":
            record["auditComplete"] = False
        if (
            strict_per_resource
            and bucket in {"textures", "atlas"}
            and item.get("classification") in {"REQUIRED", "CONDITIONAL"}
        ):
            checks = item.get("opportunityChecks")
            if not isinstance(checks, dict) or set(checks) != {"dimensions", "format", "quality"}:
                record["auditComplete"] = False
                blockers.append({
                    "code": "RESOURCE_BUCKET_AUDIT_INCOMPLETE",
                    "bucket": bucket,
                    "path": item.get("path"),
                    "message": f"图片没有完成尺寸、格式和质量三条独立审计：{item.get('path')}",
                })
            elif not isinstance(checks.get("format"), dict) or checks["format"].get("status") in {None, "NOT_EVALUATED"}:
                record["auditComplete"] = False
                blockers.append({
                    "code": "RESOURCE_IMAGE_FORMAT_AUDIT_MISSING",
                    "bucket": bucket,
                    "path": item.get("path"),
                    "message": f"图片缺少独立格式审计结论：{item.get('path')}",
                })
            if isinstance(checks, dict) and (checks.get("dimensions") or {}).get("status") == "OPPORTUNITY" and decision == "KEEP":
                record["suppressedOpportunityCount"] += 1
                blockers.append({
                    "code": "RESOURCE_IMAGE_OPPORTUNITY_SUPPRESSED",
                    "bucket": bucket,
                    "path": item.get("path"),
                    "message": f"图片存在显示尺寸余量，却被保持原文件：{item.get('path')}",
                })
        if item.get("ruleId") == "RESOURCE-OPP-IMAGE-PROTECTION-EVIDENCE-MISSING":
            blockers.append({
                "code": "RESOURCE_IMAGE_PROTECTION_EVIDENCE_MISSING",
                "bucket": bucket,
                "path": item.get("path"),
                "message": f"图片保护特征缺少逐资源证据：{item.get('path')}",
            })
        if item.get("ruleId") == "RESOURCE-OPP-FONT-USAGE-EVIDENCE-MISSING":
            blockers.append({
                "code": "RESOURCE_FONT_USAGE_EVIDENCE_MISSING",
                "bucket": bucket,
                "path": item.get("path"),
                "message": f"字体缺少独立 fontUsage：{item.get('path')}",
            })
        if item.get("ruleId") == "RESOURCE-OPP-FONT-COVERAGE-INCOMPLETE":
            blockers.append({
                "code": "RESOURCE_FONT_COVERAGE_INCOMPLETE",
                "bucket": bucket,
                "path": item.get("path"),
                "message": f"字体字符覆盖证据不完整：{item.get('path')}",
            })

    image_items = [
        item for item in items
        if strict_per_resource
        and item.get("bucket") in {"textures", "atlas"}
        and item.get("classification") in {"REQUIRED", "CONDITIONAL"}
        and item.get("riskFeatures")
    ]
    minimum_repeated = max(5, math.ceil(len(image_items) * 0.8)) if image_items else 5
    risk_groups: dict[tuple[str, ...], list[dict[str, Any]]] = {}
    for item in image_items:
        key = tuple(sorted(str(value) for value in item.get("riskFeatures") or []))
        risk_groups.setdefault(key, []).append(item)
    for risk_set, group in risk_groups.items():
        if len(group) < minimum_repeated:
            continue
        warnings.append({
            "code": "RESOURCE_IMAGE_PROTECTION_SET_REPEATED",
            "bucket": "textures",
            "count": len(group),
            "riskFeatures": list(risk_set),
            "message": f"同一图片保护集合覆盖 {len(group)} 张图片，需要确认每张图片的具体用途依据",
        })
        evidence_groups: dict[str, list[dict[str, Any]]] = {}
        for item in group:
            evidence_records = item.get("riskFeatureEvidence") or []
            evidence_signature = json.dumps([
                {"type": record.get("type"), "evidence": record.get("evidence")}
                for record in evidence_records if isinstance(record, dict)
            ], ensure_ascii=False, sort_keys=True)
            evidence_groups.setdefault(evidence_signature, []).append(item)
        copied = max(evidence_groups.values(), key=len)
        if len(copied) >= minimum_repeated:
            blockers.append({
                "code": "RESOURCE_IMAGE_PROTECTION_SET_SUSPICIOUS",
                "bucket": "textures",
                "count": len(copied),
                "paths": [item.get("path") for item in copied],
                "message": f"{len(copied)} 张图片复制了同一保护集合和通用证据，不能确认逐图成立",
            })
            for bucket in {str(item.get("bucket") or "other") for item in copied}:
                buckets[bucket]["auditComplete"] = False

    font_items = [
        item for item in items
        if strict_per_resource
        and item.get("bucket") == "fonts"
        and item.get("classification") in {"REQUIRED", "CONDITIONAL"}
        and isinstance(item.get("coverageProof"), dict)
        and not item.get("legacyReadOnly")
    ]
    coverage_groups: dict[str, list[dict[str, Any]]] = {}
    for item in font_items:
        proof = item["coverageProof"]
        signature = json.dumps({
            "requiredCharacters": proof.get("requiredCharacters"),
            "targetLanguages": proof.get("targetLanguages"),
            "fallbackChain": proof.get("fallbackChain"),
            "styleContexts": proof.get("styleContexts"),
            "evidence": proof.get("evidence"),
        }, ensure_ascii=False, sort_keys=True)
        coverage_groups.setdefault(signature, []).append(item)
    for group in coverage_groups.values():
        if len(group) < 2:
            continue
        blockers.append({
            "code": "RESOURCE_FONT_COVERAGE_NOT_ISOLATED",
            "bucket": "fonts",
            "paths": [item.get("path") for item in group],
            "message": "多个字体复制了相同字符集合和通用证据，缺少逐字体角色证明",
        })
        if "fonts" in buckets:
            buckets["fonts"]["auditComplete"] = False

    for bucket, record in buckets.items():
        if record["UNSUPPORTED"] and not any(
            blocker.get("code") == "RESOURCE_BUCKET_AUDIT_INCOMPLETE" and blocker.get("bucket") == bucket
            for blocker in blockers
        ):
            blockers.append({
                "code": "RESOURCE_BUCKET_AUDIT_INCOMPLETE",
                "bucket": bucket,
                "message": f"{bucket} 资源桶仍有 {record['UNSUPPORTED']} 项暂时无法审计，不能由其他资源桶的机会替代",
            })
    return dict(sorted(buckets.items())), blockers, warnings


def build_audit(args: argparse.Namespace) -> dict[str, Any]:
    if min(args.audio_max_bitrate_kbps, args.audio_max_channels, args.audio_target_bitrate_kbps, args.audio_target_sample_rate_hz) < 1:
        raise ValueError("音频审计阈值必须为正整数")
    ledger_path = args.ledger.expanduser().resolve()
    toolchain_path = args.toolchain.expanduser().resolve()
    ledger = require(ledger_path, "playable-resource-ledger-v2")
    toolchain = require(toolchain_path, "playable-resource-toolchain-lock-v1")
    if toolchain.get("networkPolicy") != "DENY" or toolchain.get("externalAssetsUsed") is not False:
        raise ValueError("机会审计只接受 networkPolicy=DENY 的离线工具锁")
    project_root = Path(str(ledger.get("projectRoot") or "")).expanduser().resolve()
    usage_by_path, text_coverage, usage_ref = load_usage(args.usage_evidence, project_root)
    usage_mode = str((usage_ref or {}).get("evidenceMode") or "not-provided")
    tools = locked_tools(toolchain)
    probe = ffprobe_path(tools)
    resources = ledger.get("files")
    if not isinstance(resources, list):
        raise ValueError("资源账本 files 必须是数组")
    items = [
        audit_resource(
            item, project_root, tools, probe, args, usage_by_path, text_coverage,
            usage_mode,
            usage_enabled=args.usage_evidence is not None,
        )
        for item in resources if isinstance(item, dict)
    ]
    items.sort(key=lambda item: item["path"])
    bucket_audit, audit_blockers, audit_warnings = build_bucket_audit(
        items,
        strict_per_resource=usage_mode == "per-resource-v2",
    )
    if args.usage_evidence is not None and usage_mode != "per-resource-v2":
        audit_blockers.append({
            "code": "RESOURCE_USAGE_EVIDENCE_LEGACY_READ_ONLY",
            "message": "旧 textCoverage/用途证据只按历史契约读取，不能升级为新的逐资源审计通过",
        })
    summary = {
        "resourceCount": len(items),
        "optimizeCount": sum(item["decision"] == "OPTIMIZE" for item in items),
        "keepCount": sum(item["decision"] == "KEEP" for item in items),
        "unsupportedCount": sum(item["decision"] == "UNSUPPORTED" for item in items),
    }
    missing_capabilities = {
        str((item.get("suggestedAction") or {}).get("requiredCapability"))
        for item in items
        if item.get("decision") == "UNSUPPORTED" and (item.get("suggestedAction") or {}).get("requiredCapability")
    }
    inputs = {
        "ledger": {"path": str(ledger_path), "sha256": sha256_file(ledger_path)},
        "toolchain": {"path": str(toolchain_path), "sha256": sha256_file(toolchain_path)},
    }
    if usage_ref is not None:
        inputs["usageEvidence"] = usage_ref
    core = {
        "schemaVersion": SCHEMA,
        "projectRoot": str(project_root),
        "inputs": inputs,
        "thresholds": {
            "audioMaxBitRateKbps": args.audio_max_bitrate_kbps,
            "audioMaxChannels": args.audio_max_channels,
            "audioTargetBitRateKbps": args.audio_target_bitrate_kbps,
            "audioTargetSampleRateHz": args.audio_target_sample_rate_hz,
        },
        "items": items,
        "summary": summary,
        "bucketAudit": bucket_audit,
        "blockers": audit_blockers,
        "warnings": audit_warnings,
        "compatibility": {
            "usageEvidenceMode": usage_mode,
            "newAuditEligible": usage_mode == "per-resource-v2",
            "legacyEvidenceReadOnly": usage_mode != "per-resource-v2",
        },
        "userGuidance": missing_guidance(missing_capabilities),
        "conclusion": "BLOCKED" if summary["unsupportedCount"] or audit_blockers else "READY",
    }
    result = dict(core)
    result["generatedAt"] = utc_now()
    result["auditHash"] = "sha256:" + sha256_object(core)
    return result


def render_markdown(audit: dict[str, Any]) -> str:
    summary = audit["summary"]
    decisions = {"OPTIMIZE": "可以试做", "KEEP": "保持原文件", "UNSUPPORTED": "暂时无法优化"}
    reference_status = {
        "REQUIRED": "是",
        "CONDITIONAL": "是",
        "UNREFERENCED": "否",
        "UNKNOWN": "待确认",
    }
    lines = [
        "# 资源优化机会审计",
        "",
        f"- 可试做：{summary['optimizeCount']} 项",
        f"- 保持不变：{summary['keepCount']} 项",
        f"- 尚不能处置：{summary['unsupportedCount']} 项",
        f"- 结论：{'可生成 Gate A 计划' if audit['conclusion'] == 'READY' else '存在未处置资源，不能生成可批准计划'}",
        "",
        "## 分资源桶结论",
        "",
    ]
    for bucket, record in audit.get("bucketAudit", {}).items():
        lines.append(
            f"- {bucket}：可试做 {record['OPTIMIZE']}、保持原文件 {record['KEEP']}、"
            f"暂时无法优化 {record['UNSUPPORTED']}；审计{'完整' if record['auditComplete'] else '不完整'}。"
        )
        if record.get("keepReasons"):
            reasons = "、".join(f"{rule}={count}" for rule, count in sorted(record["keepReasons"].items()))
            lines.append(f"  - KEEP 原因分布：{reasons}")
    if audit.get("warnings"):
        lines.extend(["", "## 证据提示", ""])
        lines.extend(f"- {item.get('message')}" for item in audit["warnings"])
    if audit.get("blockers"):
        lines.extend(["", "## 尚不能进入 Gate A", ""])
        lines.extend(f"- {item.get('message')}" for item in audit["blockers"])
    lines.extend([
        "",
        "## 逐项结论",
        "",
        "| 文件 | 是否引用 | 结论 | 证据与原因 | 建议工具 |",
        "|---|---|---|---|---|",
    ])
    reference_order = {"REQUIRED": 0, "CONDITIONAL": 0, "UNKNOWN": 1, "UNREFERENCED": 2}
    ordered_items = sorted(
        enumerate(audit["items"]),
        key=lambda pair: (reference_order.get(str(pair[1].get("classification") or ""), 1), pair[0]),
    )
    for _, item in ordered_items:
        tool = item.get("tool") or {}
        tool_text = f"{tool.get('name')} / {tool.get('version')}" if tool else "不适用"
        referenced = reference_status.get(str(item.get("classification") or ""), "待确认")
        lines.append(
            f"| `{item['path']}` | {referenced} | {decisions.get(item['decision'], item['decision'])} | "
            f"{str(item['reason']).replace('|', '\\|')} | {tool_text} |"
        )
    guidance = audit.get("userGuidance")
    if isinstance(guidance, dict):
        lines.extend(["", "## 如何继续", ""])
        for key in ("missing", "purpose", "install", "impactWithoutInstall", "resume"):
            if guidance.get(key):
                lines.append(f"- {guidance[key]}")
    lines.append("")
    return "\n".join(lines)


def main() -> int:
    args = parse_args()
    try:
        audit = build_audit(args)
        write_json_atomic(args.output, audit)
        if args.md_out:
            path = args.md_out.expanduser().resolve()
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(render_markdown(audit), encoding="utf-8")
    except (OSError, ValueError, json.JSONDecodeError, subprocess.SubprocessError) as exc:
        print(json.dumps({"ok": False, "error": str(exc)}, ensure_ascii=False, indent=2))
        return 1
    print(json.dumps({
        "ok": audit["conclusion"] == "READY",
        "output": str(args.output.resolve()),
        "auditHash": audit["auditHash"],
        "summary": audit["summary"],
    }, ensure_ascii=False, indent=2))
    return 0 if audit["conclusion"] == "READY" else 1


if __name__ == "__main__":
    raise SystemExit(main())
