#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import math
import os
import subprocess
import sys
import tempfile
from pathlib import Path

LIB_ROOT = Path(__file__).resolve().parent / "lib"
sys.path.insert(0, str(LIB_ROOT))

from resource_common import load_json, sha256_file, utc_now, write_json_atomic
from resource_metadata import probe_path
from png_codec import read_rgba
from verify_toolchain_lock import verify_lock_hash


def safe_environment() -> dict[str, str]:
    environment = dict(os.environ)
    for name in list(environment):
        if name.lower() in {"http_proxy", "https_proxy", "all_proxy"}:
            environment.pop(name, None)
    environment["NO_PROXY"] = "*"
    return environment


def locked_audio_tool(path: Path | None) -> dict | None:
    if path is None:
        return None
    lock = load_json(path.expanduser().resolve())
    if not isinstance(lock, dict) or lock.get("schemaVersion") != "playable-resource-toolchain-lock-v1":
        raise ValueError("音频编码后复探需要有效工具链锁")
    verify_lock_hash(lock)
    for tool in lock.get("tools") or []:
        if not isinstance(tool, dict) or "audio-reencode" not in (tool.get("capabilities") or []):
            continue
        executable = Path(str(tool.get("executable") or "")).resolve()
        if not executable.is_file() or tool.get("executableSha256") != "sha256:" + sha256_file(executable):
            raise ValueError("音频复探工具路径或 SHA-256 已漂移")
        return tool
    raise ValueError("音频编码后复探缺少已锁定的 FFmpeg 能力")


def probe_audio_quality(path: Path, tool: dict | None) -> dict:
    resolved = path.expanduser().resolve()
    if resolved.suffix.lower() == ".wav":
        return probe_path(resolved)
    if tool is None:
        raise ValueError("非 WAV 音频必须使用已锁定的 FFmpeg 解码后重新探测")
    executable = Path(str(tool["executable"])).resolve()
    with tempfile.TemporaryDirectory(prefix="playable-audio-fidelity-") as temporary:
        decoded = Path(temporary) / "decoded.wav"
        completed = subprocess.run(
            [
                str(executable), "-hide_banner", "-loglevel", "error", "-y", "-i", str(resolved),
                "-map_metadata", "-1", "-vn", "-codec:a", "pcm_s16le", str(decoded),
            ],
            capture_output=True, text=True, timeout=60, check=False, env=safe_environment(),
        )
        if completed.returncode != 0 or not decoded.is_file():
            raise ValueError(f"音频编码后复探失败：{resolved.name} / exit={completed.returncode}")
        quality = probe_path(decoded)
    return {
        **quality,
        "format": resolved.suffix.lower().lstrip("."),
        "bytes": resolved.stat().st_size,
        "sha256": sha256_file(resolved),
        "analysisProbe": {
            "tool": tool.get("name"), "executable": str(executable),
            "executableSha256": tool.get("executableSha256"), "decodedToPcmForMeasurement": True,
        },
    }


def pointer_parts(pointer: str) -> list[str]:
    if not pointer.startswith("/"):
        raise ValueError(f"JSON Pointer 必须以 / 开头：{pointer}")
    return [part.replace("~1", "/").replace("~0", "~") for part in pointer[1:].split("/")]


def pointer_value(value: object, pointer: str) -> object:
    current = value
    for part in pointer_parts(pointer):
        if isinstance(current, dict) and part in current:
            current = current[part]
        elif isinstance(current, list) and part.isdigit() and int(part) < len(current):
            current = current[int(part)]
        else:
            raise ValueError(f"配置候选缺少已批准的引用路径：{pointer}")
    return current


PIXEL_SENSITIVE_IMAGE_RISKS = {
    "NORMAL", "NORMAL_MAP", "DATA", "DATA_IMAGE", "MASK", "PIXEL_MASK", "LUT",
    "LOOKUP_TABLE", "INDEX", "INDEX_IMAGE", "QR_CODE", "BARCODE", "PIXEL_PROTOCOL",
}


def _ssim(first: list[int], second: list[int]) -> float:
    if not first or len(first) != len(second):
        return 0.0
    mean_a = sum(first) / len(first)
    mean_b = sum(second) / len(second)
    variance_a = sum((value - mean_a) ** 2 for value in first) / len(first)
    variance_b = sum((value - mean_b) ** 2 for value in second) / len(second)
    covariance = sum((a - mean_a) * (b - mean_b) for a, b in zip(first, second)) / len(first)
    c1 = (0.01 * 255) ** 2
    c2 = (0.03 * 255) ** 2
    denominator = (mean_a**2 + mean_b**2 + c1) * (variance_a + variance_b + c2)
    return round(((2 * mean_a * mean_b + c1) * (2 * covariance + c2)) / denominator, 6) if denominator else 1.0


def _psnr(first: list[int], second: list[int]) -> float | None:
    mse = sum((a - b) ** 2 for a, b in zip(first, second)) / len(first) if first else 0.0
    return None if mse == 0 else round(10 * math.log10(255**2 / mse), 3)


def verify_image_fidelity(
    before_path: Path, after_path: Path, *, action: str | None = None,
    risk_features: list[str] | None = None, semantic_report: dict | None = None,
) -> dict:
    before = probe_path(before_path.expanduser().resolve())
    after = probe_path(after_path.expanduser().resolve())
    blockers: list[dict] = []
    if before.get("format") != after.get("format") and action == "TINIFY_SHRINK":
        blockers.append({"code": "IMAGE_FORMAT_CHANGED", "before": before.get("format"), "after": after.get("format")})
    before_width, before_height = int(before.get("widthPx") or 0), int(before.get("heightPx") or 0)
    after_width, after_height = int(after.get("widthPx") or 0), int(after.get("heightPx") or 0)
    if (
        before.get("alphaCapable") and not after.get("alphaCapable")
    ) or (
        before.get("hasAlpha") and not after.get("hasAlpha")
    ):
        blockers.append({"code": "IMAGE_ALPHA_LOST"})
    if action == "TINIFY_SHRINK" and (after_width, after_height) != (before_width, before_height):
        blockers.append({"code": "IMAGE_DIMENSIONS_CHANGED", "before": [before_width, before_height], "after": [after_width, after_height]})
    elif after_width > before_width or after_height > before_height:
        blockers.append({"code": "IMAGE_UPSCALED", "before": [before_width, before_height], "after": [after_width, after_height]})
    if before_height and after_height and abs(before_width / before_height - after_width / after_height) > 0.01:
        blockers.append({"code": "IMAGE_ASPECT_RATIO_CHANGED", "before": [before_width, before_height], "after": [after_width, after_height]})
    if action == "TINIFY_SHRINK" and before.get("orientation") != after.get("orientation"):
        blockers.append({"code": "IMAGE_ORIENTATION_CHANGED"})

    metrics: dict[str, object] = {"decodedPixelMetricsAvailable": False}
    if before.get("format") == "png" and after.get("format") == "png" and (before_width, before_height) == (after_width, after_height):
        _, _, before_pixels = read_rgba(before_path.expanduser().resolve())
        _, _, after_pixels = read_rgba(after_path.expanduser().resolve())
        rgba_before = [value for pixel in before_pixels for value in pixel]
        rgba_after = [value for pixel in after_pixels for value in pixel]
        rgb_before = [value for pixel in before_pixels for value in pixel[:3]]
        rgb_after = [value for pixel in after_pixels for value in pixel[:3]]
        alpha_before = [pixel[3] for pixel in before_pixels]
        alpha_after = [pixel[3] for pixel in after_pixels]
        metrics = {
            "decodedPixelMetricsAvailable": True,
            "rgbaExact": rgba_before == rgba_after,
            "rgbaChangedValueCount": sum(a != b for a, b in zip(rgba_before, rgba_after)),
            "rgbPsnrDb": _psnr(rgb_before, rgb_after),
            "rgbSsim": _ssim(rgb_before, rgb_after),
            "alphaPsnrDb": _psnr(alpha_before, alpha_after),
            "alphaSsim": _ssim(alpha_before, alpha_after),
            "transparentPixelCountBefore": sum(value == 0 for value in alpha_before),
            "transparentPixelCountAfter": sum(value == 0 for value in alpha_after),
            "visibleBoundsMatch": before.get("transparentBounds") == after.get("transparentBounds"),
            "colorSpaceProfileMatch": before.get("colorSpaceProfile") == after.get("colorSpaceProfile"),
            "colorSpaceChunksMatch": before.get("colorSpaceChunks") == after.get("colorSpaceChunks"),
        }
    normalized_risks = {str(value).upper().replace("-", "_") for value in risk_features or []}
    if normalized_risks & PIXEL_SENSITIVE_IMAGE_RISKS:
        required = {
            "pixelEquivalent", "colorSpaceMatch", "channelValuesMatch", "runtimeSemanticMatch",
        }
        if normalized_risks & {"QR_CODE", "BARCODE", "PIXEL_PROTOCOL"}:
            required.add("decodeResultMatch")
        if not isinstance(semantic_report, dict) or semantic_report.get("schemaVersion") != "playable-image-semantic-verification-v1":
            blockers.append({"code": "IMAGE_SEMANTIC_REPORT_REQUIRED"})
        else:
            failed = sorted(name for name in required if semantic_report.get(name) is not True)
            if failed:
                blockers.append({"code": "IMAGE_SEMANTIC_VALIDATION_FAILED", "checks": failed})
    return {
        "before": before, "after": after, "metrics": metrics, "blockers": blockers,
        "semanticValidation": semantic_report,
        "conclusion": "FAIL" if blockers else "PASS",
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="对资源候选执行编码后重新探测与自动保真检查")
    parser.add_argument("--resource-type", required=True, choices=["audio", "image", "model", "font", "config"])
    parser.add_argument("--audio-class", choices=["BGM", "SFX", "VOICE"])
    parser.add_argument("--before", required=True, type=Path)
    parser.add_argument("--after", required=True, type=Path)
    parser.add_argument("--action")
    parser.add_argument("--risk-feature", action="append", default=[])
    parser.add_argument("--image-semantic-report", type=Path)
    parser.add_argument("--font-coverage-report", type=Path)
    parser.add_argument("--toolchain-lock", type=Path, help="非 WAV 音频编码后复探必须绑定")
    parser.add_argument("--reachable-pointer", action="append", default=[])
    parser.add_argument("--dynamic-reads-complete", action="store_true")
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()
    blockers = []
    try:
        if args.resource_type == "audio":
            tool = locked_audio_tool(args.toolchain_lock) if args.toolchain_lock else None
            before = probe_audio_quality(args.before, tool)
            after = probe_audio_quality(args.after, tool)
            if args.audio_class is None:
                raise ValueError("音频保真必须声明 BGM、SFX 或语音分类")
            duration_before = float(before.get("durationSeconds") or 0)
            duration_after = float(after.get("durationSeconds") or 0)
            tolerance = max(0.02, duration_before * 0.02)
            if abs(duration_before - duration_after) > tolerance:
                blockers.append({"code": "AUDIO_DURATION_CHANGED", "before": duration_before, "after": duration_after, "tolerance": tolerance})
            peak = after.get("peakDbfs")
            if isinstance(peak, (int, float)) and peak > -0.1:
                blockers.append({"code": "AUDIO_PEAK_TOO_HIGH", "peakDbfs": peak})
            if args.audio_class == "BGM" and float(after.get("loopSeamDelta") or 0) > 0.25:
                blockers.append({"code": "AUDIO_LOOP_SEAM_RISK", "loopSeamDelta": after.get("loopSeamDelta")})
            loudness_before = before.get("estimatedLoudnessDbfs")
            loudness_after = after.get("estimatedLoudnessDbfs")
            if isinstance(loudness_before, (int, float)) and isinstance(loudness_after, (int, float)) and abs(loudness_before - loudness_after) > 2:
                blockers.append({"code": "AUDIO_LOUDNESS_CHANGED", "before": loudness_before, "after": loudness_after})
            for key in ("leadingSilenceSeconds", "trailingSilenceSeconds"):
                if abs(float(before.get(key) or 0) - float(after.get(key) or 0)) > 0.05:
                    blockers.append({"code": "AUDIO_SILENCE_CHANGED", "metric": key, "before": before.get(key), "after": after.get(key)})
            silence_delay = max(0.0, float(after.get("leadingSilenceSeconds") or 0) - float(before.get("leadingSilenceSeconds") or 0))
            delay = max(int(after.get("encoderDelaySamples") or 0), round(silence_delay * int(after.get("sampleRateHz") or 0)))
            after["estimatedEncoderDelaySamples"] = delay
            sample_rate = int(after.get("sampleRateHz") or 0)
            if sample_rate and delay > sample_rate * 0.05:
                blockers.append({"code": "AUDIO_ENCODER_DELAY_TOO_HIGH", "encoderDelaySamples": delay})
        else:
            before = probe_path(args.before.expanduser().resolve())
            after = probe_path(args.after.expanduser().resolve())
        if args.resource_type == "audio":
            pass
        elif args.resource_type == "image":
            semantic = load_json(args.image_semantic_report.expanduser().resolve()) if args.image_semantic_report else None
            image_result = verify_image_fidelity(
                args.before, args.after, action=args.action,
                risk_features=args.risk_feature, semantic_report=semantic if isinstance(semantic, dict) else None,
            )
            before, after = image_result["before"], image_result["after"]
            blockers.extend(image_result["blockers"])
        elif args.resource_type == "model":
            for key in ("hasNormals", "hasTangents", "hasSkin", "animationCount", "hasTransparentMaterial"):
                if before.get(key) and not after.get(key):
                    blockers.append({"code": "MODEL_PROTECTED_FEATURE_LOST", "feature": key})
        elif args.resource_type == "font":
            if args.font_coverage_report is None:
                raise ValueError("字体保真必须绑定字符覆盖验证报告")
            coverage = load_json(args.font_coverage_report.expanduser().resolve())
            if not isinstance(coverage, dict) or coverage.get("schemaVersion") != "playable-font-coverage-verification-v1":
                raise ValueError("字体字符覆盖验证报告无效")
            if str((coverage.get("font") or {}).get("sha256") or "").removeprefix("sha256:") != sha256_file(args.after.expanduser().resolve()):
                blockers.append({"code": "FONT_COVERAGE_REPORT_DRIFT"})
            if coverage.get("dynamicSourcesComplete") is not True or coverage.get("missingGlyphs") not in ([], None):
                blockers.append({"code": "FONT_GLYPH_COVERAGE_INCOMPLETE", "missingGlyphs": coverage.get("missingGlyphs")})
            if coverage.get("styleMetricsMatch") is not True or coverage.get("fallbackMatch") is not True:
                blockers.append({"code": "FONT_STYLE_OR_FALLBACK_CHANGED"})
            if coverage.get("evidenceMode") == "per-resource-v2":
                layout_checks = {
                    key: coverage.get(key)
                    for key in (
                        "widthMetricsMatch", "lineHeightMatch", "lineBreaksMatch",
                        "buttonOverflowFree",
                    )
                }
                if any(value is not True for value in layout_checks.values()):
                    blockers.append({"code": "FONT_LAYOUT_CHANGED", "checks": layout_checks})
                weight_axis_checks = {
                    key: coverage.get(key)
                    for key in ("fontWeightsMatch", "fontStylesMatch", "variableAxesMatch")
                }
                if any(value is not True for value in weight_axis_checks.values()):
                    blockers.append({"code": "FONT_WEIGHT_OR_AXIS_CHANGED", "checks": weight_axis_checks})
                if coverage.get("languageShapingMatch") is not True:
                    blockers.append({
                        "code": "FONT_LANGUAGE_SHAPING_CHANGED",
                        "languageShapingMatch": coverage.get("languageShapingMatch"),
                    })
                required_icons = coverage.get("requiredIconCodepoints") or coverage.get("iconCodepoints") or []
                if coverage.get("iconFont") is True or required_icons:
                    missing_icons = coverage.get("missingIconCodepoints")
                    if coverage.get("iconCodepointsMatch") is not True or missing_icons not in ([], None):
                        blockers.append({
                            "code": "FONT_ICON_CODEPOINT_COVERAGE_INCOMPLETE",
                            "requiredIconCodepoints": required_icons,
                            "missingIconCodepoints": missing_icons,
                        })
        else:
            if not args.dynamic_reads_complete or not args.reachable_pointer:
                raise ValueError("配置保真必须证明动态读取闭合并声明全部 reachable pointer")
            before_value = json.loads(args.before.expanduser().resolve().read_text(encoding="utf-8"))
            after_value = json.loads(args.after.expanduser().resolve().read_text(encoding="utf-8"))
            for pointer in args.reachable_pointer:
                try:
                    if pointer_value(before_value, pointer) != pointer_value(after_value, pointer):
                        blockers.append({"code": "CONFIG_REACHABLE_VALUE_CHANGED", "pointer": pointer})
                except ValueError:
                    blockers.append({"code": "CONFIG_REACHABLE_VALUE_MISSING", "pointer": pointer})
        report = {
            "schemaVersion": "playable-resource-automatic-fidelity-v1", "generatedAt": utc_now(),
            "resourceType": args.resource_type, "audioClass": args.audio_class,
            "before": before, "after": after, "blockers": blockers,
            **({"imageMetrics": image_result["metrics"], "semanticValidation": image_result["semanticValidation"]} if args.resource_type == "image" else {}),
            "conclusion": "FAIL" if blockers else "PASS",
        }
        write_json_atomic(args.output, report)
    except (OSError, ValueError, json.JSONDecodeError, subprocess.SubprocessError) as exc:
        print(json.dumps({"ok": False, "error": str(exc)}, ensure_ascii=False, indent=2))
        return 1
    print(json.dumps(report, ensure_ascii=False, indent=2))
    return 1 if blockers else 0


if __name__ == "__main__":
    raise SystemExit(main())
