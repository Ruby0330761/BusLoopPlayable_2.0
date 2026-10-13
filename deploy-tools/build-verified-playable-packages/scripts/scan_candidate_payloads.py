#!/usr/bin/env python3
from __future__ import annotations

import argparse
import base64
import binascii
import hashlib
import json
import re
import sys
import zipfile
from collections import defaultdict
from pathlib import Path
from typing import Any
from urllib.parse import unquote_to_bytes

LIB_ROOT = Path(__file__).resolve().parent / "lib"
sys.path.insert(0, str(LIB_ROOT))

from artifact import ArtifactError, TEXT_EXTENSIONS, load_artifact
from resource_common import load_json, utc_now, write_json_atomic


DATA_URI = re.compile(
    r"data:(?P<mime>[A-Za-z0-9.+/-]*)(?P<params>(?:;[A-Za-z0-9.+_-]+(?:=[^;,\"'\s)]*)?)*)?,(?P<data>[^\"'\s)<]+)",
    re.IGNORECASE,
)
BASE64_LITERAL = re.compile(r"(?<![A-Za-z0-9+/])(?P<data>[A-Za-z0-9+/]{128,}={0,2})(?![A-Za-z0-9+/=])")
REJECTED_EXEMPTION_REASON = re.compile(r"(?:构建器当前|builder currently|重复没关系|工具会重复)", re.IGNORECASE)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="扫描最终 HTML/ZIP 的真实资源载荷、分桶与内容哈希重复")
    parser.add_argument("--artifact", required=True, type=Path)
    parser.add_argument("--platform", required=True)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--md-out", type=Path)
    parser.add_argument("--duplicate-threshold-bytes", type=int, default=4096)
    parser.add_argument("--budget-bytes", type=int)
    parser.add_argument("--exemptions", type=Path)
    parser.add_argument("--check-batch-id", help="本轮静态、运行时和载荷检查共用的唯一批次 ID")
    return parser.parse_args()


def bucket_for(label: str, mime: str) -> str:
    lowered = label.lower()
    suffix = Path(label.split("?", 1)[0]).suffix.lower()
    if any(token in lowered for token in ("/ui/", "icon", "button", "cta", "hand", "logo")):
        return "UI"
    if mime.startswith("image/") or suffix in {".png", ".jpg", ".jpeg", ".webp", ".avif", ".gif", ".svg"}:
        return "textures"
    if mime.startswith("audio/") or suffix in {".mp3", ".wav", ".ogg", ".aac", ".m4a", ".opus"}:
        return "audio"
    if mime.startswith("model/") or suffix in {".glb", ".gltf", ".fbx", ".obj", ".bin", ".mesh"}:
        return "models"
    if mime == "application/json" or suffix in {".json", ".csv", ".yaml", ".yml"}:
        return "JSON"
    if mime in {"application/javascript", "text/javascript", "text/css", "text/html"} or suffix in {".js", ".css", ".html"}:
        return "runtime"
    if "blob" in lowered:
        return "blob"
    return "other"


def payload_record(*, data: bytes, origin: str, kind: str, mime: str = "", encoded_length: int | None = None) -> dict[str, Any]:
    return {
        "sha256": hashlib.sha256(data).hexdigest(),
        "origin": origin,
        "kind": kind,
        "mime": mime or "application/octet-stream",
        "bucket": bucket_for(origin, mime),
        "decodedBytes": len(data),
        "encodedChars": encoded_length if encoded_length is not None else len(data),
    }


def scan_text(name: str, text: str) -> list[dict[str, Any]]:
    result: list[dict[str, Any]] = []
    occupied: list[tuple[int, int]] = []
    for index, match in enumerate(DATA_URI.finditer(text), start=1):
        raw = match.group("data")
        params = (match.group("params") or "").lower()
        mime = match.group("mime") or "application/octet-stream"
        try:
            if ";base64" in params:
                compact = re.sub(r"\s+", "", raw)
                data = base64.b64decode(compact, validate=True)
                encoded = len(compact)
                kind = "data-uri-base64"
            else:
                data = unquote_to_bytes(raw)
                encoded = len(raw)
                kind = "data-uri"
        except (binascii.Error, ValueError):
            continue
        result.append(payload_record(
            data=data,
            origin=f"{name}#data-uri-{index}",
            kind=kind,
            mime=mime,
            encoded_length=encoded,
        ))
        occupied.append(match.span("data"))

    literal_index = 0
    for match in BASE64_LITERAL.finditer(text):
        if any(start <= match.start("data") < end for start, end in occupied):
            continue
        compact = match.group("data")
        try:
            data = base64.b64decode(compact, validate=True)
        except binascii.Error:
            continue
        if len(data) < 96:
            continue
        literal_index += 1
        result.append(payload_record(
            data=data,
            origin=f"{name}#inline-base64-{literal_index}",
            kind="inline-base64",
            encoded_length=len(compact),
        ))
    return result


def packaged_payloads(path: Path) -> list[dict[str, Any]]:
    if path.suffix.lower() != ".zip":
        return []
    result: list[dict[str, Any]] = []
    with zipfile.ZipFile(path) as archive:
        for info in archive.infolist():
            if info.is_dir() or Path(info.filename).suffix.lower() in TEXT_EXTENSIONS:
                continue
            data = archive.read(info)
            result.append(payload_record(data=data, origin=info.filename, kind="zip-entry"))
    return result


def load_exemptions(path: Path | None) -> dict[str, dict[str, Any]]:
    if path is None:
        return {}
    value = load_json(path.expanduser().resolve())
    if not isinstance(value, dict) or value.get("schemaVersion") != "playable-candidate-payload-exemptions-v1":
        raise ValueError("重复载荷豁免 schemaVersion 无效")
    groups = value.get("groups")
    if not isinstance(groups, list):
        raise ValueError("重复载荷豁免 groups 必须是数组")
    result: dict[str, dict[str, Any]] = {}
    for item in groups:
        if not isinstance(item, dict) or not isinstance(item.get("sha256"), str):
            raise ValueError("重复载荷豁免项缺少 sha256")
        reason = str(item.get("reason") or "").strip()
        maximum = item.get("maxWastedBytes")
        if not reason or REJECTED_EXEMPTION_REASON.search(reason):
            raise ValueError(f"重复载荷豁免必须提供真实 runtime 原因：{item.get('sha256')}")
        if not isinstance(maximum, int) or maximum < 0 or item.get("humanApproval") is not True:
            raise ValueError(f"重复载荷豁免必须有上限和人工确认：{item.get('sha256')}")
        result[item["sha256"].removeprefix("sha256:")] = item
    return result


def render_markdown(report: dict[str, Any]) -> str:
    lines = [
        "# 最终候选载荷报告",
        "",
        f"- 平台：{report['platform']}",
        f"- 文件：`{report['artifact']['path']}`",
        f"- 大小：{report['artifact']['bytes']} bytes",
        f"- payload：{report['summary']['totalPayloads']} 个；唯一内容 {report['summary']['uniquePayloads']} 个",
        f"- 重复组：{report['summary']['duplicateGroupCount']}；额外内联/条目 {report['summary']['extraOccurrences']} 次",
        f"- 重复解码浪费：{report['summary']['duplicateWasteBytes']} bytes",
        f"- Base64 膨胀：{report['summary']['base64InflationChars']} chars",
        f"- 结论：{'通过' if report['conclusion'] == 'PASS' else '阻断'}",
        "",
        "## 资源分桶",
        "",
    ]
    for bucket, value in sorted(report["buckets"].items(), key=lambda item: -item[1]["decodedBytes"]):
        lines.append(f"- {bucket}：{value['occurrences']} 次，{value['decodedBytes']} decoded bytes")
    if report["duplicateGroups"]:
        lines.extend(["", "## 重复内容", ""])
        for item in report["duplicateGroups"]:
            state = "已豁免" if item["exempted"] else ("阻断" if item["blocking"] else "低于阈值")
            lines.append(f"- `{item['sha256']}`：{item['occurrences']} 次，浪费 {item['wastedBytes']} bytes（{state}）")
            for origin in item["origins"]:
                lines.append(f"  - `{origin}`")
    lines.append("")
    return "\n".join(lines)


def build_report(args: argparse.Namespace) -> dict[str, Any]:
    if args.duplicate_threshold_bytes < 0:
        raise ValueError("重复阈值不能为负数")
    artifact_path = args.artifact.expanduser().resolve()
    artifact = load_artifact(str(artifact_path))
    occurrences: list[dict[str, Any]] = []
    for name, text in artifact.entry_texts.items():
        occurrences.extend(scan_text(name, text))
    occurrences.extend(packaged_payloads(artifact_path))

    by_hash: dict[str, list[dict[str, Any]]] = defaultdict(list)
    buckets: dict[str, dict[str, int]] = defaultdict(lambda: {"occurrences": 0, "decodedBytes": 0, "encodedChars": 0})
    base64_inflation = 0
    for item in occurrences:
        by_hash[item["sha256"]].append(item)
        bucket = buckets[item["bucket"]]
        bucket["occurrences"] += 1
        bucket["decodedBytes"] += item["decodedBytes"]
        bucket["encodedChars"] += item["encodedChars"]
        if item["kind"] in {"data-uri-base64", "inline-base64"}:
            base64_inflation += max(0, item["encodedChars"] - item["decodedBytes"])

    exemptions = load_exemptions(args.exemptions)
    duplicate_groups: list[dict[str, Any]] = []
    blockers: list[dict[str, Any]] = []
    for sha, group in by_hash.items():
        if len(group) < 2:
            continue
        decoded = group[0]["decodedBytes"]
        wasted = decoded * (len(group) - 1)
        wasted_chars = sum(item["encodedChars"] for item in group[1:])
        exemption = exemptions.get(sha)
        exempted = bool(exemption and wasted <= exemption["maxWastedBytes"])
        blocking = wasted >= args.duplicate_threshold_bytes and not exempted
        record = {
            "sha256": sha,
            "occurrences": len(group),
            "extraOccurrences": len(group) - 1,
            "decodedBytesEach": decoded,
            "wastedBytes": wasted,
            "wastedEncodedChars": wasted_chars,
            "origins": [item["origin"] for item in group],
            "buckets": sorted({item["bucket"] for item in group}),
            "exempted": exempted,
            "exemption": exemption,
            "blocking": blocking,
        }
        duplicate_groups.append(record)
        if blocking:
            blockers.append({
                "code": "FINAL_PAYLOAD_DUPLICATE_WASTE",
                "sha256": sha,
                "wastedBytes": wasted,
                "thresholdBytes": args.duplicate_threshold_bytes,
                "origins": record["origins"],
            })
    duplicate_groups.sort(key=lambda item: (-item["wastedBytes"], item["sha256"]))

    total_waste = sum(item["wastedBytes"] for item in duplicate_groups)
    total_waste_chars = sum(item["wastedEncodedChars"] for item in duplicate_groups)
    top_assets = sorted(occurrences, key=lambda item: (-item["decodedBytes"], item["origin"]))[:20]
    budget = args.budget_bytes
    report = {
        "schemaVersion": "playable-candidate-payload-report-v1",
        "generatedAt": utc_now(),
        "platform": args.platform,
        "checkBatchId": args.check_batch_id,
        "artifact": {
            "path": artifact.path,
            "bytes": artifact.size,
            "sha256": artifact.sha256,
            "kind": artifact.kind,
        },
        "thresholds": {"duplicateWasteBytes": args.duplicate_threshold_bytes, "platformBudgetBytes": budget},
        "summary": {
            "totalPayloads": len(occurrences),
            "uniquePayloads": len(by_hash),
            "duplicateGroupCount": len(duplicate_groups),
            "extraOccurrences": sum(item["extraOccurrences"] for item in duplicate_groups),
            "duplicateWasteBytes": total_waste,
            "duplicateWasteEncodedChars": total_waste_chars,
            "base64InflationChars": base64_inflation,
            "unknownBusinessPayloads": sum(item["bucket"] == "other" for item in occurrences),
        },
        "buckets": dict(sorted(buckets.items())),
        "payloads": sorted(occurrences, key=lambda item: (item["sha256"], item["origin"])),
        "duplicateGroups": duplicate_groups,
        "topAssets": top_assets,
        "platformMarginBytes": budget - artifact.size if budget is not None else None,
        "blobConstructorOccurrences": len(re.findall(r"\bnew\s+Blob\s*\(|\bBlob\s*\(", artifact.combined_text)),
        "blockers": blockers,
        "conclusion": "FAIL" if blockers else "PASS",
    }
    return report


def main() -> int:
    args = parse_args()
    write_json_atomic(args.output, {
        "schemaVersion": "playable-candidate-payload-report-v1",
        "generatedAt": utc_now(),
        "status": "CHECKING",
        "platform": args.platform,
        "checkBatchId": args.check_batch_id,
        "artifact": {"path": str(args.artifact.expanduser().resolve())},
        "blockers": [],
        "conclusion": "IN_PROGRESS",
    })
    try:
        report = build_report(args)
        write_json_atomic(args.output, report)
        if args.md_out:
            markdown = args.md_out.expanduser().resolve()
            markdown.parent.mkdir(parents=True, exist_ok=True)
            markdown.write_text(render_markdown(report), encoding="utf-8")
    except (ArtifactError, OSError, ValueError, json.JSONDecodeError, zipfile.BadZipFile) as exc:
        failure = {
            "schemaVersion": "playable-candidate-payload-report-v1",
            "generatedAt": utc_now(),
            "status": "FAILED",
            "platform": args.platform,
            "checkBatchId": args.check_batch_id,
            "artifact": {"path": str(args.artifact.expanduser().resolve())},
            "blockers": [{"code": "PAYLOAD_SCAN_FAILED", "message": str(exc)}],
            "conclusion": "FAIL",
        }
        write_json_atomic(args.output, failure)
        print(json.dumps({"ok": False, "error": str(exc), "output": str(args.output.resolve())}, ensure_ascii=False, indent=2))
        return 1
    print(json.dumps({
        "ok": report["conclusion"] == "PASS",
        "userConclusion": (
            "最终候选载荷扫描通过，未发现达到阈值的未解释重复载荷"
            if report["conclusion"] == "PASS" else
            "最终候选存在达到阈值的重复载荷，必须修复生成链路并重建"
        ),
        "summary": report["summary"],
        "blockers": report["blockers"],
        "output": str(args.output.resolve()),
    }, ensure_ascii=False, indent=2))
    return 0 if report["conclusion"] == "PASS" else 2


if __name__ == "__main__":
    raise SystemExit(main())
