#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

LIB_ROOT = Path(__file__).resolve().parent / "lib"
sys.path.insert(0, str(LIB_ROOT))

from png_codec import read_rgba
from resource_common import is_within, load_json, sha256_file, sha256_object, utc_now, write_json_atomic


def blocker(code: str, path: str, detail: str) -> dict[str, str]:
    return {"code": code, "path": path, "detail": detail}


def validate(project_root: Path, atlas: Path, manifest: dict[str, Any]) -> dict[str, Any]:
    blockers: list[dict[str, str]] = []
    if manifest.get("schemaVersion") != "playable-image-atlas-manifest-v1":
        raise ValueError("图片合集位置表 schemaVersion 无效")
    manifest_core = {key: value for key, value in manifest.items() if key not in {"generatedAt", "manifestHash"}}
    if manifest.get("manifestHash") != "sha256:" + sha256_object(manifest_core):
        blockers.append(blocker("ATLAS_POSITION_ERROR", str(manifest.get("atlas", {}).get("path") or ""), "图片合集位置表哈希已漂移"))
    if Path(str(manifest.get("projectRoot") or "")).expanduser().resolve() != project_root:
        raise ValueError("图片合集位置表不属于当前项目")
    atlas_width, atlas_height, atlas_pixels = read_rgba(atlas)
    atlas_ref = manifest.get("atlas") or {}
    if [atlas_width, atlas_height] != [atlas_ref.get("width"), atlas_ref.get("height")]:
        blockers.append(blocker("ATLAS_DIMENSION_ERROR", str(atlas), "图片合集尺寸与位置表不一致"))
    if atlas_ref.get("sha256") != sha256_file(atlas):
        blockers.append(blocker("ATLAS_BYTES_DRIFT", str(atlas), "图片合集字节已漂移"))
    occupied: list[tuple[int, int, int, int, str]] = []
    checked = []
    for sprite in manifest.get("sprites") or []:
        if not isinstance(sprite, dict):
            raise ValueError("图片合集位置表包含无效小图片项")
        relative = str(sprite.get("path") or "")
        source = (project_root / relative).resolve()
        if not is_within(project_root, source) or not source.is_file():
            blockers.append(blocker("ATLAS_SOURCE_MISSING", relative, "原始小图片不存在"))
            continue
        source_width, source_height, source_pixels = read_rgba(source)
        if sha256_file(source) != sprite.get("inputSha256"):
            blockers.append(blocker("ATLAS_SOURCE_DRIFT", relative, "原始小图片 SHA-256 已漂移"))
        x, y = int(sprite.get("x") or 0), int(sprite.get("y") or 0)
        width, height = int(sprite.get("width") or 0), int(sprite.get("height") or 0)
        if width != source_width or height != source_height:
            blockers.append(blocker("ATLAS_SCALE_ERROR", relative, "位置表尺寸与输入图片不一致，疑似发生缩放"))
        if x < 0 or y < 0 or width < 1 or height < 1 or x + width > atlas_width or y + height > atlas_height:
            blockers.append(blocker("ATLAS_POSITION_ERROR", relative, "小图片位置超出图片合集边界"))
            continue
        if any(not (x + width <= ox or ox + ow <= x or y + height <= oy or oy + oh <= y) for ox, oy, ow, oh, _ in occupied):
            blockers.append(blocker("ATLAS_POSITION_ERROR", relative, "小图片位置与另一张图片重叠"))
        occupied.append((x, y, width, height, relative))
        crop = [atlas_pixels[(y + row) * atlas_width + x + column] for row in range(height) for column in range(width)]
        if crop != source_pixels:
            blockers.append(blocker("ATLAS_PIXEL_MISMATCH", relative, "从大图反裁后的像素与输入图片不同，可能错图、串色或位置错误"))
            blockers.append(blocker("ATLAS_POSITION_ERROR", relative, "位置表无法反裁回原始小图片"))
        extrude = int(sprite.get("edgeExtrude") or 0)
        polluted = False
        for target_y in range(max(0, y - extrude), min(atlas_height, y + height + extrude)):
            for target_x in range(max(0, x - extrude), min(atlas_width, x + width + extrude)):
                if x <= target_x < x + width and y <= target_y < y + height:
                    continue
                source_x = min(source_width - 1, max(0, target_x - x))
                source_y = min(source_height - 1, max(0, target_y - y))
                if atlas_pixels[target_y * atlas_width + target_x] != source_pixels[source_y * source_width + source_x]:
                    polluted = True
                    break
            if polluted:
                break
        if polluted:
            blockers.append(blocker("ATLAS_EDGE_POLLUTION", relative, "padding 区域的边缘扩展像素与输入边缘不一致"))
        checked.append({
            "path": relative, "inputSha256": sha256_file(source), "roundTripPixelMatch": crop == source_pixels,
            "padding": sprite.get("padding"), "edgeExtrude": extrude,
        })
    return {
        "schemaVersion": "playable-image-atlas-validation-v1", "generatedAt": utc_now(),
        "atlas": {"path": str(atlas), "bytes": atlas.stat().st_size, "sha256": sha256_file(atlas)},
        "checkedSprites": checked, "blockers": blockers, "conclusion": "FAIL" if blockers else "PASS",
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="逐张反裁图片合集并检查位置、串色、边缘、缩放和像素一致性")
    parser.add_argument("--project-root", required=True, type=Path)
    parser.add_argument("--atlas", required=True, type=Path)
    parser.add_argument("--manifest", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()
    try:
        project_root = args.project_root.expanduser().resolve()
        atlas = args.atlas.expanduser().resolve()
        manifest = load_json(args.manifest.expanduser().resolve())
        if not project_root.is_dir() or not atlas.is_file() or not isinstance(manifest, dict):
            raise ValueError("图片合集验证输入无效")
        report = validate(project_root, atlas, manifest)
        write_json_atomic(args.output, report)
    except (OSError, ValueError, json.JSONDecodeError) as exc:
        print(json.dumps({"ok": False, "error": str(exc)}, ensure_ascii=False, indent=2))
        return 1
    print(json.dumps({"ok": report["conclusion"] == "PASS", "output": str(args.output.resolve()), "blockers": report["blockers"]}, ensure_ascii=False, indent=2))
    return 0 if report["conclusion"] == "PASS" else 1


if __name__ == "__main__":
    raise SystemExit(main())
