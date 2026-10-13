from __future__ import annotations

import json
import math
import struct
import wave
from pathlib import Path
from typing import Any

from png_codec import read_rgba
from resource_common import classify_bucket, sha256_file


IMAGE_EXTENSIONS = {".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp"}
AUDIO_EXTENSIONS = {".wav", ".mp3", ".ogg", ".m4a", ".aac", ".flac", ".opus"}
MODEL_EXTENSIONS = {".fbx", ".glb", ".gltf", ".obj", ".dae"}
FONT_EXTENSIONS = {".ttf", ".otf", ".woff", ".woff2"}
CONFIG_EXTENSIONS = {".json", ".yaml", ".yml", ".csv", ".xml"}


def _png_structure(path: Path) -> dict[str, Any]:
    data = path.read_bytes()
    if not data.startswith(b"\x89PNG\r\n\x1a\n"):
        raise ValueError("PNG 文件头无效")
    offset = 8
    color_type = None
    chunks: set[str] = set()
    while offset + 12 <= len(data):
        length = struct.unpack(">I", data[offset:offset + 4])[0]
        kind = data[offset + 4:offset + 8]
        if offset + length + 12 > len(data):
            raise ValueError("PNG chunk 已截断")
        payload = data[offset + 8:offset + 8 + length]
        chunks.add(kind.decode("latin-1"))
        if kind == b"IHDR" and len(payload) == 13:
            color_type = payload[9]
        offset += length + 12
        if kind == b"IEND":
            break
    if color_type is None:
        raise ValueError("PNG 缺少 IHDR")
    profile = (
        "icc" if "iCCP" in chunks else "srgb" if "sRGB" in chunks else
        "gamma-chromaticity" if {"gAMA", "cHRM"} & chunks else "unspecified"
    )
    return {
        "colorType": color_type,
        "alphaCapable": color_type in {4, 6} or "tRNS" in chunks,
        "colorSpaceProfile": profile,
        "colorSpaceChunks": sorted(chunks & {"iCCP", "sRGB", "gAMA", "cHRM"}),
        "orientation": "top-left",
    }



def _webp_probe(path: Path) -> dict[str, Any]:
    try:
        from PIL import Image
    except ImportError as exc:
        raise ValueError("当前环境无法读取 WebP：缺少 Pillow") from exc
    with Image.open(path) as image:
        image.load()
        width, height = image.size
        mode = image.mode
        has_alpha = mode in {"RGBA", "LA", "PA"} or "transparency" in image.info
        alpha_capable = has_alpha or mode in {"RGBA", "LA", "PA"}
        transparent_bounds = None
        if has_alpha:
            rgba = image.convert("RGBA")
            alpha_values = [pixel[3] for pixel in rgba.getdata()]
            visible = [(index % width, index // width) for index, value in enumerate(alpha_values) if value > 0]
            if visible:
                xs = [item[0] for item in visible]
                ys = [item[1] for item in visible]
                transparent_bounds = {
                    "x": min(xs), "y": min(ys),
                    "width": max(xs) - min(xs) + 1, "height": max(ys) - min(ys) + 1,
                }
        return {
            "format": "webp", "widthPx": width, "heightPx": height, "hasAlpha": has_alpha,
            "alphaCapable": alpha_capable, "transparentBounds": transparent_bounds,
            "colorType": 6 if alpha_capable else 2, "colorSpaceProfile": "unspecified",
            "colorSpaceChunks": [], "orientation": "top-left",
        }


def _jpeg_size(path: Path) -> tuple[int, int]:
    data = path.read_bytes()
    if not data.startswith(b"\xff\xd8"):
        raise ValueError("JPEG 文件头无效")
    offset = 2
    while offset + 9 < len(data):
        if data[offset] != 0xFF:
            offset += 1
            continue
        marker = data[offset + 1]
        offset += 2
        if marker in {0xD8, 0xD9}:
            continue
        length = struct.unpack(">H", data[offset:offset + 2])[0]
        if marker in {0xC0, 0xC1, 0xC2, 0xC3, 0xC5, 0xC6, 0xC7, 0xC9, 0xCA, 0xCB, 0xCD, 0xCE, 0xCF}:
            return struct.unpack(">HH", data[offset + 3:offset + 7])[::-1]
        offset += length
    raise ValueError("JPEG 中没有找到尺寸")


def probe_image(path: Path) -> dict[str, Any]:
    suffix = path.suffix.lower()
    if suffix == ".png":
        width, height, pixels = read_rgba(path)
        structure = _png_structure(path)
        alpha_values = [pixel[3] for pixel in pixels]
        has_alpha = any(value != 255 for value in alpha_values)
        transparent_bounds = None
        visible = [(index % width, index // width) for index, value in enumerate(alpha_values) if value > 0]
        if visible:
            xs = [item[0] for item in visible]
            ys = [item[1] for item in visible]
            transparent_bounds = {"x": min(xs), "y": min(ys), "width": max(xs) - min(xs) + 1, "height": max(ys) - min(ys) + 1}
        return {
            "format": "png", "widthPx": width, "heightPx": height, "hasAlpha": has_alpha,
            "transparentBounds": transparent_bounds, **structure,
        }
    if suffix in {".jpg", ".jpeg"}:
        width, height = _jpeg_size(path)
        return {
            "format": "jpeg", "widthPx": width, "heightPx": height, "hasAlpha": False,
            "alphaCapable": False, "orientation": "exif-or-default", "colorSpaceProfile": "unspecified",
        }
    if suffix == ".webp":
        return _webp_probe(path)
    raise ValueError(f"当前元数据探测器尚不支持该图片格式：{suffix}")


def _dbfs(value: float, maximum: float) -> float | None:
    if value <= 0 or maximum <= 0:
        return None
    return round(20 * math.log10(value / maximum), 3)


def probe_wav(path: Path) -> dict[str, Any]:
    with wave.open(str(path), "rb") as handle:
        channels = handle.getnchannels()
        sample_width = handle.getsampwidth()
        sample_rate = handle.getframerate()
        frames = handle.getnframes()
        raw = handle.readframes(frames)
    duration = frames / sample_rate if sample_rate else 0.0
    maximum = float((1 << (sample_width * 8 - 1)) - 1)
    if sample_width not in {1, 2, 4}:
        raise ValueError(f"Python wave 探测暂不支持 {sample_width} 字节采样")
    if sample_width == 1:
        samples = [int(value) - 128 for value in raw]
    else:
        code = "h" if sample_width == 2 else "i"
        sample_count = len(raw) // sample_width
        samples = list(struct.unpack("<" + code * sample_count, raw[:sample_count * sample_width]))
    peak = max((abs(value) for value in samples), default=0)
    rms = math.sqrt(sum(value * value for value in samples) / len(samples)) if samples else 0.0
    frame_bytes = sample_width * channels
    threshold = max(1, int(maximum * 0.001))
    amplitudes: list[int] = []
    for offset in range(0, len(raw), frame_bytes):
        frame_index = offset // frame_bytes
        frame = samples[frame_index * channels:(frame_index + 1) * channels]
        amplitudes.append(max((abs(value) for value in frame), default=0))
    first = next((index for index, value in enumerate(amplitudes) if value > threshold), len(amplitudes))
    last = next((index for index, value in enumerate(reversed(amplitudes)) if value > threshold), len(amplitudes))
    first_sample = amplitudes[0] if amplitudes else 0
    last_sample = amplitudes[-1] if amplitudes else 0
    return {
        "probe": "python-wave", "format": "wav", "channels": channels, "sampleWidthBytes": sample_width,
        "sampleRateHz": sample_rate, "frameCount": frames, "durationSeconds": round(duration, 6),
        "bitRateKbps": round(path.stat().st_size * 8 / duration / 1000) if duration else None,
        "peakDbfs": _dbfs(float(peak), maximum), "estimatedLoudnessDbfs": _dbfs(float(rms), maximum),
        "leadingSilenceSeconds": round(first / sample_rate, 6) if sample_rate else 0.0,
        "trailingSilenceSeconds": round(last / sample_rate, 6) if sample_rate else 0.0,
        "loopSeamDelta": round(abs(first_sample - last_sample) / maximum, 6) if maximum else 0.0,
        "encoderDelaySamples": 0,
    }


def _gltf_json(path: Path) -> dict[str, Any]:
    if path.suffix.lower() == ".gltf":
        value = json.loads(path.read_text(encoding="utf-8"))
        if not isinstance(value, dict):
            raise ValueError("glTF 根必须是对象")
        return value
    data = path.read_bytes()
    if len(data) < 20 or data[:4] != b"glTF":
        raise ValueError("GLB 文件头无效")
    json_length, json_type = struct.unpack("<II", data[12:20])
    if json_type != 0x4E4F534A:
        raise ValueError("GLB 缺少 JSON chunk")
    return json.loads(data[20:20 + json_length].rstrip(b"\x00 \t\r\n").decode("utf-8"))


def probe_model(path: Path) -> dict[str, Any]:
    suffix = path.suffix.lower()
    if suffix in {".gltf", ".glb"}:
        value = _gltf_json(path)
        accessors = value.get("accessors") or []
        primitives = [primitive for mesh in value.get("meshes") or [] for primitive in mesh.get("primitives") or []]
        index_counts = []
        for primitive in primitives:
            index = primitive.get("indices")
            if isinstance(index, int) and 0 <= index < len(accessors):
                index_counts.append(int(accessors[index].get("count") or 0))
        attributes = {name for primitive in primitives for name in (primitive.get("attributes") or {})}
        materials = value.get("materials") or []
        return {
            "format": suffix.lstrip("."), "meshCount": len(value.get("meshes") or []),
            "primitiveCount": len(primitives), "triangleCount": sum(index_counts) // 3 if index_counts else None,
            "attributes": sorted(attributes), "hasNormals": "NORMAL" in attributes, "hasTangents": "TANGENT" in attributes,
            "hasSkin": bool(value.get("skins")), "skinCount": len(value.get("skins") or []),
            "animationCount": len(value.get("animations") or []),
            "animationChannelCount": sum(len(item.get("channels") or []) for item in value.get("animations") or []),
            "hasTransparentMaterial": any(item.get("alphaMode") in {"BLEND", "MASK"} for item in materials),
            "hasNormalTexture": any(isinstance(item.get("normalTexture"), dict) for item in materials),
            "materialCount": len(materials), "imageCount": len(value.get("images") or []),
            "compactJsonBytes": len(json.dumps(value, ensure_ascii=False, separators=(",", ":")).encode("utf-8")),
        }
    if suffix == ".fbx":
        binary = path.read_bytes().startswith(b"Kaydara FBX Binary")
        return {"format": "fbx", "binary": binary, "featureInventoryRequiresConverter": True}
    return {"format": suffix.lstrip("."), "featureInventoryRequiresConverter": True}


def probe_font(path: Path) -> dict[str, Any]:
    data = path.read_bytes()
    signature = data[:4]
    container = "woff2" if signature == b"wOF2" else "woff" if signature == b"wOFF" else "sfnt"
    return {"format": path.suffix.lower().lstrip("."), "container": container, "characterCoverage": None}


def probe_config(path: Path) -> dict[str, Any]:
    if path.suffix.lower() == ".json":
        value = json.loads(path.read_text(encoding="utf-8"))
        return {
            "format": "json", "topLevelEntryCount": len(value) if isinstance(value, (dict, list)) else 1,
            "rootType": type(value).__name__,
        }
    return {"format": path.suffix.lower().lstrip("."), "structuredProbe": "not-registered"}


def probe_path(path: Path) -> dict[str, Any]:
    suffix = path.suffix.lower()
    common = {
        "bucket": classify_bucket(path), "extension": suffix, "bytes": path.stat().st_size,
        "sha256": sha256_file(path),
    }
    if suffix in IMAGE_EXTENSIONS:
        return {**common, **probe_image(path)}
    if suffix == ".wav":
        return {**common, **probe_wav(path)}
    if suffix in AUDIO_EXTENSIONS:
        return {**common, "format": suffix.lstrip("."), "probe": "external-probe-required"}
    if suffix in MODEL_EXTENSIONS:
        return {**common, **probe_model(path)}
    if suffix in FONT_EXTENSIONS:
        return {**common, **probe_font(path)}
    if suffix in CONFIG_EXTENSIONS:
        return {**common, **probe_config(path)}
    return {**common, "format": suffix.lstrip(".") or "unknown"}
