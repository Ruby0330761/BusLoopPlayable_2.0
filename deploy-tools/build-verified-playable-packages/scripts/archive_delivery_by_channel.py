#!/usr/bin/env python3
"""把本轮各平台最终 artifact 归档到「需求编号/渠道缩写」的交付目录。

目录约定与 NAS 交单一致：

    <delivery-root>/<requirement-id>/
        AL/  GG/  FB/  MT/  MO/  TT/  UN/

七个渠道目录总是建齐，即使某个平台本轮没有产物。文件按原字节复制并复核
SHA-256，`--mode copy|move` 决定归档后是否保留源文件。
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import shutil
import sys
from pathlib import Path
from typing import Any


SKILL_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(SKILL_ROOT / "scripts" / "lib"))

SCHEMA = "playable-delivery-archive-v1"

# 平台 -> 渠道缩写。顺序即目录创建顺序，七个总是建齐。
CHANNELS: tuple[tuple[str, str, str], ...] = (
    ("AL", "applovin", "AppLovin"),
    ("GG", "google-ads", "Google Ads"),
    ("FB", "meta", "Meta"),
    ("MT", "mintegral", "Mintegral"),
    ("MO", "moloco", "Moloco"),
    ("TT", "tiktok", "TikTok"),
    ("UN", "unityads", "UnityAds"),
)
CHANNEL_BY_PLATFORM = {platform: code for code, platform, _ in CHANNELS}

# 需求编号：产品码-需求-素材版本，例如 BFT-2610162-Q134V1、AC-2610157-Q341V1
REQUIREMENT_PATTERN = re.compile(r"^[A-Za-z]{2,4}-\d{6,8}-Q[0-9A-Za-z]+(?:V\d+)?$")


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def derive_requirement(artifact: Path, explicit: str | None) -> tuple[str, str]:
    """优先用显式需求编号；否则从文件名前缀推导。"""
    if explicit:
        value = explicit.strip()
        if not REQUIREMENT_PATTERN.match(value):
            raise ValueError(f"需求编号格式无效：{value}（期望形如 BFT-2610162-Q134V1）")
        return value, "explicit"
    stem = artifact.stem
    parts = stem.split("-")
    for size in (3, 4):
        candidate = "-".join(parts[:size])
        if REQUIREMENT_PATTERN.match(candidate):
            return candidate, f"filename-prefix:{size}segments"
    raise ValueError(
        f"无法从文件名推导需求编号：{artifact.name}；请用 --requirement-id 显式指定"
    )


def load_manifest(path: Path) -> dict[str, Any]:
    value = json.loads(path.expanduser().read_text(encoding="utf-8"))
    if not isinstance(value, dict):
        raise ValueError("平台清单根必须是对象")
    platforms = value.get("platforms")
    if not isinstance(platforms, dict) or not platforms:
        raise ValueError("平台清单缺少 platforms 对象")
    return platforms


def main() -> int:
    parser = argparse.ArgumentParser(
        description="按「需求编号/渠道缩写」归档各平台最终 artifact，七个渠道目录总是建齐"
    )
    parser.add_argument("--delivery-root", required=True, type=Path)
    parser.add_argument("--platforms", required=True, type=Path,
                        help="JSON：{\"platforms\": {\"applovin\": \"/abs/a.html\", \"mintegral\": \"/abs/m.zip\"}}")
    parser.add_argument("--requirement-id", help="需求编号，例如 BFT-2610162-Q134V1；缺省从文件名推导")
    parser.add_argument("--mode", choices=("copy", "move"), default="copy")
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()

    try:
        platforms = load_manifest(args.platforms)
    except (OSError, ValueError, json.JSONDecodeError) as exc:
        receipt = {"schemaVersion": SCHEMA, "status": "BLOCKED", "errors": [str(exc)]}
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(json.dumps(receipt, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        print(json.dumps(receipt, ensure_ascii=False, indent=2))
        return 1

    errors: list[str] = []
    unknown = sorted(set(platforms) - set(CHANNEL_BY_PLATFORM))
    if unknown:
        errors.append("未登记的平台：" + "、".join(unknown))

    resolved: dict[str, dict[str, Any]] = {}
    requirement = None
    requirement_source = None
    for platform, value in sorted(platforms.items()):
        if platform not in CHANNEL_BY_PLATFORM:
            continue
        artifact = Path(str(value)).expanduser().resolve()
        if not artifact.is_file():
            errors.append(f"{platform}: 产物不存在 {artifact}")
            continue
        if requirement is None:
            try:
                requirement, requirement_source = derive_requirement(artifact, args.requirement_id)
            except ValueError as exc:
                errors.append(str(exc))
                continue
        elif args.requirement_id is None:
            try:
                derived, _ = derive_requirement(artifact, None)
            except ValueError:
                derived = None
            if derived and derived != requirement:
                errors.append(
                    f"同名交付混入其它需求编号：{artifact.name} 推导出 {derived}，本轮为 {requirement}"
                )
                continue
        resolved[platform] = {"source": artifact, "sha256": sha256_file(artifact), "bytes": artifact.stat().st_size}

    if errors:
        receipt = {"schemaVersion": SCHEMA, "status": "BLOCKED", "errors": errors}
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(json.dumps(receipt, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        print(json.dumps(receipt, ensure_ascii=False, indent=2))
        return 1

    assert requirement is not None
    delivery_root = args.delivery_root.expanduser().resolve()
    requirement_root = delivery_root / requirement
    created: list[str] = []
    for code, _platform, _label in CHANNELS:
        target = requirement_root / code
        if not target.is_dir():
            target.mkdir(parents=True, exist_ok=True)
            created.append(code)

    archived: list[dict[str, Any]] = []
    for platform, info in sorted(resolved.items()):
        code = CHANNEL_BY_PLATFORM[platform]
        source: Path = info["source"]
        target = requirement_root / code / source.name
        if target.exists() and sha256_file(target) != info["sha256"]:
            errors.append(f"{code}: 目标已存在同名但内容不同的文件 {target.name}")
            continue
        if args.mode == "move":
            shutil.move(str(source), str(target))
        else:
            shutil.copy2(source, target)
        actual = sha256_file(target)
        if actual != info["sha256"]:
            errors.append(f"{code}: 归档后哈希不一致 {target.name}")
            continue
        archived.append({
            "platform": platform,
            "channel": code,
            "path": str(target),
            "sha256": actual,
            "bytes": target.stat().st_size,
        })

    status = "ARCHIVED" if not errors else "BLOCKED"
    receipt = {
        "schemaVersion": SCHEMA,
        "status": status,
        "requirementId": requirement,
        "requirementSource": requirement_source,
        "deliveryRoot": str(delivery_root),
        "requirementRoot": str(requirement_root),
        "mode": args.mode,
        "channels": [code for code, _, _ in CHANNELS],
        "createdChannels": created,
        "archived": archived,
        "emptyChannels": sorted(
            code for code, platform, _ in CHANNELS if platform not in {item["platform"] for item in archived}
        ),
        "errors": errors,
        "userConclusion": (
            f"已按 {requirement} 归档 {len(archived)} 个平台产物，七个渠道目录齐备"
            if status == "ARCHIVED" else
            "交付归档被阻塞，未完成；请修正列出的问题后重跑"
        ),
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(receipt, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(receipt, ensure_ascii=False, indent=2))
    return 0 if status == "ARCHIVED" else 1


if __name__ == "__main__":
    raise SystemExit(main())
