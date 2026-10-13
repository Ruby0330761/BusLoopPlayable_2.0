#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

LIB_ROOT = Path(__file__).resolve().parent / "lib"
sys.path.insert(0, str(LIB_ROOT))

from png_codec import read_rgba, write_rgba
from resource_common import is_within, sha256_file, sha256_object, utc_now, write_json_atomic


TRANSPARENT = (0, 0, 0, 0)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="离线合并小图片并生成图片合集位置表")
    parser.add_argument("--project-root", required=True, type=Path)
    parser.add_argument("--input", action="append", default=[])
    parser.add_argument("--input-json", help="可选；Gate A 执行器传入的 JSON 路径数组")
    parser.add_argument("--padding", required=True, type=int)
    parser.add_argument("--edge-extrude", required=True, type=int)
    parser.add_argument("--atlas-out", required=True, type=Path)
    parser.add_argument("--manifest-out", required=True, type=Path)
    parser.add_argument("--receipt-out", required=True, type=Path)
    return parser.parse_args()


def project_source(project_root: Path, relative: str) -> Path:
    source = (project_root / relative).resolve()
    if not is_within(project_root, source) or not source.is_file():
        raise ValueError(f"图片合集输入必须是当前项目文件：{relative}")
    if source.suffix.lower() != ".png":
        raise ValueError(f"图片合集内建执行器当前只接受 PNG：{relative}")
    return source


def build(args: argparse.Namespace) -> tuple[dict[str, Any], dict[str, Any]]:
    project_root = args.project_root.expanduser().resolve()
    if not project_root.is_dir():
        raise ValueError("项目根不存在")
    if args.padding < 1 or args.edge_extrude < 0 or args.edge_extrude > args.padding:
        raise ValueError("padding 必须至少为 1，边缘扩展必须位于 0..padding")
    inputs = list(args.input)
    if args.input_json:
        decoded = json.loads(args.input_json)
        if not isinstance(decoded, list) or not all(isinstance(item, str) and item for item in decoded):
            raise ValueError("--input-json 必须是非空路径数组")
        inputs.extend(decoded)
    if len(set(inputs)) != len(inputs):
        raise ValueError("图片合集输入不能重复")
    atlas_out = args.atlas_out.expanduser().resolve()
    manifest_out = args.manifest_out.expanduser().resolve()
    receipt_out = args.receipt_out.expanduser().resolve()
    for output in (atlas_out, manifest_out, receipt_out):
        if output.exists():
            raise ValueError(f"输出已存在，不能覆盖：{output}")

    loaded = []
    for relative in inputs:
        source = project_source(project_root, relative)
        width, height, pixels = read_rgba(source)
        loaded.append((relative, source, width, height, pixels))
    if len(loaded) < 2:
        raise ValueError("图片合集至少需要两张小图片")
    atlas_width = sum(item[2] for item in loaded) + args.padding * (len(loaded) + 1)
    atlas_height = max(item[3] for item in loaded) + args.padding * 2
    atlas_pixels = [TRANSPARENT] * (atlas_width * atlas_height)
    sprites: list[dict[str, Any]] = []
    cursor = args.padding
    for relative, source, width, height, pixels in loaded:
        x = cursor
        y = args.padding
        for target_y in range(y - args.edge_extrude, y + height + args.edge_extrude):
            for target_x in range(x - args.edge_extrude, x + width + args.edge_extrude):
                source_x = min(width - 1, max(0, target_x - x))
                source_y = min(height - 1, max(0, target_y - y))
                atlas_pixels[target_y * atlas_width + target_x] = pixels[source_y * width + source_x]
        sprites.append({
            "path": relative,
            "x": x,
            "y": y,
            "width": width,
            "height": height,
            "padding": args.padding,
            "edgeExtrude": args.edge_extrude,
            "inputBytes": source.stat().st_size,
            "inputSha256": sha256_file(source),
        })
        cursor += width + args.padding
    write_rgba(atlas_out, atlas_width, atlas_height, atlas_pixels)
    manifest_core = {
        "schemaVersion": "playable-image-atlas-manifest-v1",
        "projectRoot": str(project_root),
        "layout": "single-row-deterministic",
        "padding": args.padding,
        "edgeExtrude": args.edge_extrude,
        "atlas": {
            "path": str(atlas_out), "width": atlas_width, "height": atlas_height,
            "bytes": atlas_out.stat().st_size, "sha256": sha256_file(atlas_out),
        },
        "sprites": sprites,
    }
    manifest = dict(manifest_core)
    manifest["generatedAt"] = utc_now()
    manifest["manifestHash"] = "sha256:" + sha256_object(manifest_core)
    write_json_atomic(manifest_out, manifest)
    input_bytes = sum(item[1].stat().st_size for item in loaded)
    receipt = {
        "schemaVersion": "playable-resource-conversion-receipt-v1",
        "generatedAt": utc_now(),
        "action": "REPACK_ATLAS",
        "changedVariables": ["packing"],
        "tool": {
            "name": "Skill 内建图片合集执行器",
            "path": str(Path(__file__).resolve()),
            "sha256": sha256_file(Path(__file__).resolve()),
            "offline": True,
        },
        "parameters": {"padding": args.padding, "edgeExtrude": args.edge_extrude, "layout": "single-row-deterministic"},
        "inputs": [
            {"path": str(item[1]), "bytes": item[1].stat().st_size, "sha256": sha256_file(item[1])}
            for item in loaded
        ],
        "output": {"path": str(atlas_out), "bytes": atlas_out.stat().st_size, "sha256": sha256_file(atlas_out)},
        "manifest": {"path": str(manifest_out), "sha256": sha256_file(manifest_out)},
        "inputBytes": input_bytes,
        "outputBytes": atlas_out.stat().st_size + manifest_out.stat().st_size,
        "savedBytesBeforeRuntimeCost": input_bytes - atlas_out.stat().st_size - manifest_out.stat().st_size,
        "conclusion": "CANDIDATE_ONLY",
    }
    write_json_atomic(receipt_out, receipt)
    return manifest, receipt


def main() -> int:
    args = parse_args()
    try:
        manifest, receipt = build(args)
    except (OSError, ValueError, json.JSONDecodeError) as exc:
        print(json.dumps({"ok": False, "error": str(exc)}, ensure_ascii=False, indent=2))
        return 1
    print(json.dumps({
        "ok": True, "atlas": manifest["atlas"], "spriteCount": len(manifest["sprites"]),
        "savedBytesBeforeRuntimeCost": receipt["savedBytesBeforeRuntimeCost"],
    }, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
