#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import subprocess
import sys
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

SCRIPT_ROOT = Path(__file__).resolve().parent
LIB_ROOT = SCRIPT_ROOT / "lib"
sys.path.insert(0, str(LIB_ROOT))
sys.path.insert(0, str(SCRIPT_ROOT))

from checker_acceptance import (
    OBSERVATION_ITEM_SCHEMA,
    OBSERVATION_SCHEMA,
    CheckerAcceptanceError,
    observation_content_hash,
    validate_observation,
)
from execution_timeline_core import TimelineError, finish_event, load_timeline, start_event
from record_candidate import CandidateError, verify_manifest_file
from resource_common import load_json, sha256_file, utc_now, write_json_atomic
from rules import RulesetError


SCHEMA = "playable-checker-ui-queue-v1"
PREFLIGHT_INSTRUCTIONS_SCHEMA = "playable-checker-browser-preflight-instructions-v1"
PREFLIGHT_SCHEMA = "playable-checker-browser-preflight-v1"
PREFLIGHT_MAX_AGE_MINUTES = 30
PLATFORM_ORDER = {
    "applovin": 0,
    "google-ads": 1,
    "meta": 2,
    "unityads": 3,
    "mintegral": 4,
    "moloco": 5,
    "tiktok": 6,
}
PLATFORM_LABELS = {
    "applovin": "AppLovin",
    "google-ads": "Google Ads",
    "meta": "Meta",
    "unityads": "UnityAds",
    "mintegral": "Mintegral",
    "moloco": "Moloco",
    "tiktok": "TikTok",
}


def parser() -> argparse.ArgumentParser:
    root = argparse.ArgumentParser(description="管理 Playable Ad Checker 浏览器页签队列与断点证据")
    sub = root.add_subparsers(dest="command", required=True)

    preflight = sub.add_parser("preflight")
    preflight.add_argument("--checker-url", required=True)
    preflight.add_argument("--output", required=True, type=Path)

    preflight_record = sub.add_parser("preflight-record")
    preflight_record.add_argument("--instructions", required=True, type=Path)
    preflight_record.add_argument("--status", required=True, choices=("available", "unreachable"))
    preflight_record.add_argument("--final-url")
    preflight_record.add_argument("--visible-marker")
    preflight_record.add_argument("--reason")
    preflight_record.add_argument("--evidence", action="append", required=True, type=Path)
    preflight_record.add_argument("--output", required=True, type=Path)

    init = sub.add_parser("init")
    init.add_argument("--manifest", action="append", required=True, type=Path)
    init.add_argument("--checker-url", required=True)
    init.add_argument("--preflight", required=True, type=Path)
    init.add_argument("--timeline", required=True, type=Path)
    init.add_argument("--output", required=True, type=Path)
    init.add_argument("--compact", action="store_true", help="只输出下一项和队列摘要")

    next_item = sub.add_parser("next")
    next_item.add_argument("--queue", required=True, type=Path)
    next_item.add_argument("--compact", action="store_true", help="只输出下一项和队列摘要")

    start = sub.add_parser("start")
    start.add_argument("--queue", required=True, type=Path)
    start.add_argument("--platform", required=True, choices=sorted(PLATFORM_ORDER))
    start.add_argument("--delivery-key", required=True)
    start.add_argument("--retry", action="store_true")
    start.add_argument("--compact", action="store_true", help="只输出当前 attempt 和队列摘要")

    record = sub.add_parser("record")
    record.add_argument("--queue", required=True, type=Path)
    record.add_argument("--platform", required=True, choices=sorted(PLATFORM_ORDER))
    record.add_argument("--delivery-key", required=True)
    record.add_argument(
        "--observation",
        required=True,
        type=Path,
        help="当前可见浏览器会话生成的 playable-checker-observation-v2 JSON",
    )
    record.add_argument(
        "--provenance",
        type=Path,
        help="固定 CDP collector 生成的 external browser provenance envelope；AVAILABLE attempt 必须提供",
    )
    record.add_argument("--compact", action="store_true", help="只输出下一项和队列摘要")

    cancel = sub.add_parser("cancel")
    cancel.add_argument("--queue", required=True, type=Path)
    cancel.add_argument("--reason", required=True)
    cancel.add_argument("--compact", action="store_true", help="只输出下一项和队列摘要")

    enqueue = sub.add_parser("enqueue")
    enqueue.add_argument("--queue", required=True, type=Path)
    enqueue.add_argument("--manifest", required=True, type=Path)
    enqueue.add_argument("--compact", action="store_true", help="只输出下一项和队列摘要")

    supersede = sub.add_parser("supersede")
    supersede.add_argument("--queue", required=True, type=Path)
    supersede.add_argument("--platform", required=True, choices=sorted(PLATFORM_ORDER))
    supersede.add_argument("--manifest", required=True, type=Path)
    supersede.add_argument(
        "--reason",
        default="平台 artifact 已重建，旧 Checker 证据按新 SHA-256 失效",
    )
    supersede.add_argument("--compact", action="store_true", help="只输出下一项和队列摘要")

    export = sub.add_parser("export")
    export.add_argument("--queue", required=True, type=Path)
    export.add_argument("--output", required=True, type=Path)
    export.add_argument("--compact", action="store_true", help="只输出导出路径和观察数量")
    return root


def file_ref(path: Path) -> dict[str, Any]:
    resolved = path.expanduser().resolve()
    if not resolved.is_file():
        raise ValueError(f"文件不存在：{resolved}")
    return {"path": str(resolved), "bytes": resolved.stat().st_size, "sha256": sha256_file(resolved)}


def normalized_url(value: str) -> str:
    shown = value.strip().rstrip("/")
    if not shown.startswith(("http://", "https://")):
        raise ValueError("Checker URL 必须是浏览器可访问的 http(s) 地址")
    return shown


def create_preflight_instructions(args: argparse.Namespace) -> dict[str, Any]:
    output = args.output.expanduser().resolve()
    if output.exists():
        raise ValueError(f"Checker preflight 指令已存在，不能覆盖复用：{output}")
    checker_url = normalized_url(args.checker_url)
    now = datetime.now(timezone.utc)
    result = {
        "schemaVersion": PREFLIGHT_INSTRUCTIONS_SCHEMA,
        "generatedAt": now.isoformat(timespec="seconds"),
        "expiresAt": (now + timedelta(minutes=PREFLIGHT_MAX_AGE_MINUTES)).isoformat(timespec="seconds"),
        "checkerUrl": checker_url,
        "uploadForbidden": True,
        "steps": [
            "仅在浏览器导航到 checkerUrl，不上传任何平台包。",
            "等待页面主体出现，并记录能够识别 Checker 的可见标题、页签区或上传区域文案。",
            "记录浏览器最终 URL 和一张页面证据；页面不可达时记录可见错误与原因。",
        ],
        "userConclusion": "请先只验证 Checker 页面是否可达；此步骤不创建平台队列，也不上传文件",
    }
    write_json_atomic(output, result)
    return result


def parse_iso(value: object, label: str) -> datetime:
    if not isinstance(value, str) or not value:
        raise ValueError(f"{label} 缺少带时区时间")
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError as exc:
        raise ValueError(f"{label} 时间无效") from exc
    if parsed.tzinfo is None:
        raise ValueError(f"{label} 必须包含时区")
    return parsed.astimezone(timezone.utc)


def record_preflight(args: argparse.Namespace) -> dict[str, Any]:
    output = args.output.expanduser().resolve()
    if output.exists():
        raise ValueError(f"Checker preflight 记录已存在，不能覆盖复用：{output}")
    instructions_path = args.instructions.expanduser().resolve()
    instructions = load_json(instructions_path)
    if not isinstance(instructions, dict) or instructions.get("schemaVersion") != PREFLIGHT_INSTRUCTIONS_SCHEMA:
        raise ValueError("Checker preflight 指令 schemaVersion 无效")
    expires_at = parse_iso(instructions.get("expiresAt"), "preflight.expiresAt")
    if datetime.now(timezone.utc) > expires_at:
        raise ValueError("Checker preflight 指令已过期，请重新导航检查")
    checker_url = normalized_url(str(instructions.get("checkerUrl") or ""))
    status = args.status.upper()
    final_url = normalized_url(args.final_url) if args.final_url else None
    visible_marker = str(args.visible_marker or "").strip()
    reason = str(args.reason or "").strip()
    if status == "AVAILABLE":
        if final_url != checker_url:
            raise ValueError("Checker 可达记录的 final-url 与配置 URL 不一致")
        if not visible_marker:
            raise ValueError("Checker 可达时必须记录页面可见标记")
    elif not reason:
        raise ValueError("Checker 不可达时必须记录失败原因")
    result = {
        "schemaVersion": PREFLIGHT_SCHEMA,
        "recordedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "expiresAt": instructions["expiresAt"],
        "checkerUrl": checker_url,
        "finalUrl": final_url,
        "status": status,
        "visibleMarker": visible_marker or None,
        "reason": reason or None,
        "uploadAttempted": False,
        "instructions": file_ref(instructions_path),
        "evidence": [file_ref(path) for path in args.evidence],
        "userConclusion": (
            "Checker 页面可达，可以创建逐平台浏览器队列"
            if status == "AVAILABLE" else
            "Checker 页面当前不可达；平台本地检查结果保持有效，但不创建上传队列"
        ),
    }
    write_json_atomic(output, result)
    return result


def validate_preflight(path: Path, checker_url: str, *, require_available: bool = True) -> dict[str, Any]:
    resolved = path.expanduser().resolve()
    value = load_json(resolved)
    if not isinstance(value, dict) or value.get("schemaVersion") != PREFLIGHT_SCHEMA:
        raise ValueError("Checker preflight schemaVersion 无效")
    expected_url = normalized_url(checker_url)
    if normalized_url(str(value.get("checkerUrl") or "")) != expected_url:
        raise ValueError("Checker preflight 与当前 URL 不一致")
    if value.get("uploadAttempted") is not False:
        raise ValueError("Checker preflight 不得包含上传动作")
    if datetime.now(timezone.utc) > parse_iso(value.get("expiresAt"), "preflight.expiresAt"):
        raise ValueError("Checker preflight 已过期，请重新检查页面可达性")
    for reference in value.get("evidence") or []:
        verify_ref(reference, "Checker preflight 页面证据")
    if require_available and (
        value.get("status") != "AVAILABLE"
        or normalized_url(str(value.get("finalUrl") or "")) != expected_url
        or not str(value.get("visibleMarker") or "").strip()
    ):
        raise ValueError("Checker 页面尚未证明可达，不能创建或推进逐平台队列")
    return value


def ensure_queue_preflight(queue: dict[str, Any]) -> None:
    reference = queue.get("preflight")
    if not isinstance(reference, dict):
        raise ValueError("旧 Checker 队列缺少可达性 preflight；只允许导出审计，不能新增或开始 attempt")
    path = verify_ref(reference, "Checker preflight")
    validate_preflight(path, str(queue.get("checkerUrl") or ""), require_available=True)


def verify_ref(reference: object, label: str) -> Path:
    if not isinstance(reference, dict):
        raise ValueError(f"{label} 缺少文件引用")
    path = Path(str(reference.get("path") or "")).expanduser().resolve()
    if (
        not path.is_file()
        or path.stat().st_size != reference.get("bytes")
        or sha256_file(path) != reference.get("sha256")
    ):
        raise ValueError(f"{label} 不存在或已变化：{path}")
    return path


def item_key(item: dict[str, Any]) -> tuple[str, str]:
    return str(item.get("platform") or ""), str(item.get("deliveryKey") or "")


def browser_instructions(checker_url: str, item: dict[str, Any]) -> dict[str, Any]:
    platform, delivery_key = item_key(item)
    artifact = dict(item.get("artifact") or {})
    return {
        "schemaVersion": "playable-checker-browser-instructions-v1",
        "checkerUrl": checker_url,
        "platform": platform,
        "deliveryKey": delivery_key,
        "expectedTabLabel": PLATFORM_LABELS.get(platform, platform),
        "artifact": artifact,
        "uploadPolicy": {
            "visibleControlRequired": True,
            "fileChooserRequired": True,
            "directHiddenInputForbidden": True,
        },
        "resultWaitPolicy": {
            "specificResultNodesOnly": True,
            "genericNetworkIdleForbidden": True,
            "waitFor": ["当前文件名", "静态结果计数", "运行时结果计数", "warning 明细"],
        },
        "screenshotPolicy": {
            "finalEvidenceCount": 1,
            "captureAfterResultsStable": True,
            "format": "png",
            "rejectBlankOrSolid": True,
            "rejectDuplicateSha256": True,
        },
        "observationPolicy": {
            "schemaVersion": OBSERVATION_ITEM_SCHEMA,
            "deriveCountsFromNodes": True,
            "deriveCtaFromR2TrustedInputAndBridge": True,
            "deriveMintegralLifecycleFromR5AndOrderedCalls": True,
            "manualConclusionBooleansForbidden": True,
            "externalBrowserProvenanceRequired": True,
            "collector": "checker_browser_collector.mjs",
            "collectorVersion": "checker-browser-cdp-collector@2",
        },
        "steps": [
            f"打开 Checker 并切换到 {PLATFORM_LABELS.get(platform, platform)} 页签；没有该页签时记录不可用，不借用其他平台页签。",
            f"点击页面可见上传区域或上传按钮，等待浏览器文件选择器后选择 exact artifact：{artifact.get('path')}；不得直接操作隐藏 file input。",
            "页面显示已载入文件后，再开始页面提供的静态与运行时检查；不要沿用刷新前、其他平台或其他文件的结果。",
            "运行时监测启动后，在右侧广告完成真实流程，并用浏览器可信 pointer/touch 输入点击可见 CTA。",
            "只等待当前页签的文件名、结果计数和 warning 明细节点达到稳定状态；不要等待通用 network idle 或无关页面区域。",
            "检查结束后从当前可见 DOM、可信输入和桥接调用生成 checker-observation-v2；不得手填计数、CTA 或生命周期布尔值。",
            "保存一张真实 PNG 最终截图，必须包含当前页签、当前文件与稳定结果区域；标题页、空白图、preflight/其他平台/旧 attempt 重复图会被拒绝。",
            "用固定 checker_browser_collector.mjs 在真实 Chrome/CDP 会话生成全新 provenance 输出；不得手写或复用旧 capture。",
        ],
        "failureHandling": "可见上传动作未打开文件选择器、页面未显示当前文件或浏览器操作中断时，立即 cancel 当前 attempt 并记录原因；不要改用隐藏 input 反复试错。",
    }


def validate_browser_instructions(instructions: object, checker_url: str, item: dict[str, Any], label: str) -> None:
    if instructions is None:
        return
    if not isinstance(instructions, dict):
        raise ValueError(f"{label} Checker 浏览器步骤必须是对象")
    if instructions.get("schemaVersion") != "playable-checker-browser-instructions-v1":
        raise ValueError(f"{label} Checker 浏览器步骤 schemaVersion 无效")
    if instructions.get("checkerUrl") != checker_url or instructions.get("artifact") != item.get("artifact"):
        raise ValueError(f"{label} Checker 浏览器步骤未绑定当前 exact artifact")
    policy = instructions.get("uploadPolicy") or {}
    if not (
        policy.get("visibleControlRequired") is True
        and policy.get("fileChooserRequired") is True
        and policy.get("directHiddenInputForbidden") is True
    ):
        raise ValueError(f"{label} Checker 浏览器步骤没有强制可见上传与文件选择器")
    observation_policy = instructions.get("observationPolicy") or {}
    if observation_policy and not (
        observation_policy.get("schemaVersion") == OBSERVATION_ITEM_SCHEMA
        and observation_policy.get("deriveCountsFromNodes") is True
        and observation_policy.get("deriveCtaFromR2TrustedInputAndBridge") is True
        and observation_policy.get("deriveMintegralLifecycleFromR5AndOrderedCalls") is True
        and observation_policy.get("manualConclusionBooleansForbidden") is True
        and observation_policy.get("externalBrowserProvenanceRequired") is True
        and observation_policy.get("collector") == "checker_browser_collector.mjs"
        and observation_policy.get("collectorVersion") == "checker-browser-cdp-collector@2"
    ):
        raise ValueError(f"{label} Checker 浏览器步骤未启用结构化观察派生门禁")


def queue_summary(items: list[dict[str, Any]]) -> dict[str, int]:
    return {
        "total": len(items),
        "pending": sum(item.get("status") == "PENDING" for item in items),
        "running": sum(item.get("status") == "RUNNING" for item in items),
        "completed": sum(item.get("status") == "COMPLETED" for item in items),
    }


def validate_attempts(attempts: object, label: str) -> None:
    if not isinstance(attempts, list):
        raise ValueError(f"{label} attempts 必须是数组")
    for attempt in attempts:
        if not isinstance(attempt, dict) or not attempt.get("attemptId"):
            raise ValueError(f"{label} Checker attempt 无效")
        for evidence in attempt.get("evidence") or []:
            verify_ref(evidence, f"{label} Checker 页面证据")
        if isinstance(attempt.get("observationFile"), dict):
            verify_ref(attempt["observationFile"], f"{label} Checker 结构化观察")
        if isinstance(attempt.get("screenshot"), dict):
            verify_ref(attempt["screenshot"], f"{label} Checker 最终截图")
        if isinstance(attempt.get("externalProvenanceFile"), dict):
            verify_ref(attempt["externalProvenanceFile"], f"{label} external browser provenance")
        observation = attempt.get("observation")
        if observation is not None and (
            not isinstance(observation, dict)
            or observation.get("schemaVersion") != OBSERVATION_ITEM_SCHEMA
        ):
            raise ValueError(f"{label} Checker observation schemaVersion 无效")


def load_queue(path: Path) -> dict[str, Any]:
    value = load_json(path.expanduser().resolve())
    if not isinstance(value, dict) or value.get("schemaVersion") != SCHEMA:
        raise ValueError(f"Checker 队列 schemaVersion 必须为 {SCHEMA}")
    items = value.get("items")
    if not isinstance(items, list) or not items:
        raise ValueError("Checker 队列缺少目标平台")
    seen: set[tuple[str, str]] = set()
    running = 0
    for index, item in enumerate(items):
        if not isinstance(item, dict):
            raise ValueError(f"items[{index}] 必须是对象")
        key = item_key(item)
        if not all(key) or key in seen:
            raise ValueError(f"Checker 队列平台与交付组合缺失或重复：{key}")
        seen.add(key)
        if item.get("status") not in {"PENDING", "RUNNING", "COMPLETED"}:
            raise ValueError(f"Checker 队列状态无效：{key}")
        running += item.get("status") == "RUNNING"
        manifest_path = verify_ref(item.get("candidateManifest"), f"{key} final-recheck 清单")
        manifest = verify_manifest_file(str(manifest_path))
        if manifest.get("status") != "FINAL_RECHECK_READY":
            raise ValueError(f"{key} 不是 final-recheck 清单")
        artifact = manifest.get("artifact") or {}
        expected_bytes = artifact.get("size") if artifact.get("size") is not None else artifact.get("bytes")
        if item.get("artifact") != {
            "path": artifact.get("path"),
            "bytes": expected_bytes,
            "sha256": artifact.get("sha256"),
        }:
            raise ValueError(f"{key} 队列未绑定清单中的 exact final artifact")
        validate_attempts(item.get("attempts"), str(key))
        checker_url = str(value.get("checkerUrl") or "")
        validate_browser_instructions(item.get("browserInstructions"), checker_url, item, str(key))
        superseded_versions = item.get("supersededVersions") or []
        if not isinstance(superseded_versions, list):
            raise ValueError(f"{key} supersededVersions 必须是数组")
        for version_index, version in enumerate(superseded_versions):
            version_label = f"{key} supersededVersions[{version_index}]"
            if not isinstance(version, dict) or not version.get("supersededAt") or not version.get("reason"):
                raise ValueError(f"{version_label} 缺少失效时间或原因")
            verify_ref(version.get("candidateManifest"), f"{version_label} final-recheck 清单")
            validate_attempts(version.get("attempts"), version_label)
            historical_item = {"artifact": version.get("artifact")}
            validate_browser_instructions(
                version.get("browserInstructions"), checker_url, historical_item, version_label,
            )
    if running > 1:
        raise ValueError("同一 Checker 浏览器队列最多只能有一个正在执行的页签")
    timeline = load_timeline(Path(str(value.get("timeline") or "")))
    if timeline.get("runId") != value.get("runId"):
        raise ValueError("Checker 队列与时间账本 runId 不一致")
    if value.get("summary") != queue_summary(items):
        raise ValueError("Checker 队列 summary 与逐项状态不一致")
    if isinstance(value.get("preflight"), dict):
        verify_ref(value["preflight"], "Checker preflight")
    return value


def persist(path: Path, queue: dict[str, Any]) -> dict[str, Any]:
    queue["updatedAt"] = utc_now()
    queue["summary"] = queue_summary(queue["items"])
    write_json_atomic(path.expanduser().resolve(), queue)
    return queue


def queue_item_from_manifest(manifest: dict[str, Any], checker_url: str) -> dict[str, Any]:
    key = (str(manifest.get("platform") or ""), str(manifest.get("deliveryKey") or ""))
    artifact = manifest.get("artifact") or {}
    artifact_bytes = artifact.get("size") if artifact.get("size") is not None else artifact.get("bytes")
    item = {
        "platform": key[0],
        "deliveryKey": key[1],
        "candidateManifest": file_ref(Path(manifest["manifestPath"])),
        "artifact": {
            "path": artifact.get("path"),
            "bytes": artifact_bytes,
            "sha256": artifact.get("sha256"),
        },
        "status": "PENDING",
        "attempts": [],
    }
    item["browserInstructions"] = browser_instructions(checker_url, item)
    return item


def create_queue(args: argparse.Namespace) -> dict[str, Any]:
    output = args.output.expanduser().resolve()
    if output.exists():
        raise ValueError(f"Checker 队列已存在，不能复用：{output}")
    checker_url = normalized_url(args.checker_url)
    preflight_path = args.preflight.expanduser().resolve()
    validate_preflight(preflight_path, checker_url, require_available=True)
    timeline_path = args.timeline.expanduser().resolve()
    timeline = load_timeline(timeline_path)
    items = []
    seen: set[tuple[str, str]] = set()
    for manifest_path in args.manifest:
        manifest = verify_manifest_file(str(manifest_path.expanduser().resolve()))
        if manifest.get("status") != "FINAL_RECHECK_READY":
            raise ValueError("Checker 队列只接受 FINAL_RECHECK_READY 清单")
        key = (str(manifest.get("platform") or ""), str(manifest.get("deliveryKey") or ""))
        if not all(key) or key in seen:
            raise ValueError(f"Checker 目标平台与交付组合缺失或重复：{key}")
        seen.add(key)
        items.append(queue_item_from_manifest(manifest, checker_url))
    items.sort(key=lambda item: (item["deliveryKey"], PLATFORM_ORDER.get(item["platform"], 99)))
    queue = {
        "schemaVersion": SCHEMA,
        "runId": timeline["runId"],
        "checkerUrl": checker_url,
        "preflight": file_ref(preflight_path),
        "timeline": str(timeline_path),
        "createdAt": utc_now(),
        "updatedAt": utc_now(),
        "items": items,
        "summary": queue_summary(items),
        "userConclusion": "Checker 浏览器上传队列已按交付组合和平台排好；当前尚未产生任何页面通过结论",
    }
    write_json_atomic(output, queue)
    return queue


def find_item(queue: dict[str, Any], platform: str, delivery_key: str) -> dict[str, Any]:
    matches = [item for item in queue["items"] if item_key(item) == (platform, delivery_key)]
    if len(matches) != 1:
        raise ValueError(f"找不到唯一 Checker 目标：{platform}/{delivery_key}")
    return matches[0]


def next_pending(queue: dict[str, Any]) -> dict[str, Any] | None:
    running = [item for item in queue["items"] if item.get("status") == "RUNNING"]
    if running:
        return running[0]
    return next((item for item in queue["items"] if item.get("status") == "PENDING"), None)


def start_item(args: argparse.Namespace) -> dict[str, Any]:
    path = args.queue.expanduser().resolve()
    queue = load_queue(path)
    ensure_queue_preflight(queue)
    if any(item.get("status") == "RUNNING" for item in queue["items"]):
        raise ValueError("已有页签正在执行；先记录或取消当前页签")
    item = find_item(queue, args.platform, args.delivery_key)
    if item.get("status") == "COMPLETED" and not args.retry:
        raise ValueError("该页签已有记录；需要重新观察时显式使用 --retry，旧 attempt 会保留")
    manifest_ref = item["candidateManifest"]
    artifact = item["artifact"]
    event = start_event(
        Path(queue["timeline"]),
        phase="checker-ui",
        operation=f"在 Checker 浏览器界面检查 {args.platform}/{args.delivery_key}",
        time_class="checker-ui-wait",
        platform=args.platform,
        delivery_key=args.delivery_key,
        input_hashes={
            "candidateManifest": manifest_ref["sha256"],
            "artifact": artifact["sha256"],
        },
        concurrency_group="checker-browser-slot",
    )
    item["status"] = "RUNNING"
    instructions = browser_instructions(queue["checkerUrl"], item)
    item["browserInstructions"] = instructions
    item["currentAttempt"] = {
        "attemptId": str(uuid.uuid4()),
        "startedAt": event["startedAt"],
        "timelineEventId": event["eventId"],
        "browserInstructions": instructions,
    }
    queue["userConclusion"] = f"请按当前 attempt 返回的浏览器步骤，在 Checker 的 {args.platform} 页签上传绑定的 exact final artifact；完成页面检查后记录可见结果"
    return persist(path, queue)


def used_screenshot_hashes(queue: dict[str, Any]) -> set[str]:
    result: set[str] = set()
    preflight_reference = queue.get("preflight")
    if isinstance(preflight_reference, dict):
        preflight_path = verify_ref(preflight_reference, "Checker preflight")
        preflight = load_json(preflight_path)
        if isinstance(preflight, dict):
            for reference in preflight.get("evidence") or []:
                if isinstance(reference, dict) and reference.get("sha256"):
                    result.add(str(reference["sha256"]))
    for item in queue.get("items") or []:
        attempt_groups = [item.get("attempts") or []]
        attempt_groups.extend(
            version.get("attempts") or []
            for version in item.get("supersededVersions") or []
            if isinstance(version, dict)
        )
        for attempts in attempt_groups:
            for attempt in attempts:
                if not isinstance(attempt, dict):
                    continue
                screenshot = attempt.get("screenshot")
                if isinstance(screenshot, dict) and screenshot.get("sha256"):
                    result.add(str(screenshot["sha256"]))
                for reference in attempt.get("evidence") or []:
                    if isinstance(reference, dict) and reference.get("sha256"):
                        result.add(str(reference["sha256"]))
    return result


def reject_current_observation(
    path: Path,
    queue: dict[str, Any],
    item: dict[str, Any],
    current: dict[str, Any],
    observation_reference: dict[str, Any],
    reason: str,
    observation: dict[str, Any] | None = None,
) -> None:
    timeline_path = Path(queue["timeline"])
    event_id = str(current.get("timelineEventId") or "")
    timeline = load_timeline(timeline_path)
    events = [event for event in timeline["events"] if event.get("eventId") == event_id]
    if len(events) != 1:
        raise ValueError("Checker 页签与时间账本事件不一致")
    event = (
        finish_event(timeline_path, event_id=event_id, status="CANCELLED", message=reason)
        if events[0].get("status") == "RUNNING"
        else events[0]
    )
    item["attempts"].append({
        **current,
        "finishedAt": event.get("finishedAt"),
        "durationMs": event.get("durationMs"),
        "status": "REJECTED",
        "classification": "OBSERVATION_RETRY",
        "reason": reason,
        "observationFile": observation_reference,
        "observation": observation,
        "evidence": [],
    })
    item.pop("currentAttempt", None)
    item["status"] = "PENDING"
    queue["lastOutcome"] = {
        "classification": "OBSERVATION_RETRY",
        "platform": item["platform"],
        "deliveryKey": item["deliveryKey"],
        "artifact": item["artifact"],
        "attemptId": current.get("attemptId"),
        "reason": reason,
        "continuationRequired": True,
        "nextAction": "使用相同 artifact SHA-256 创建新 Checker attempt 并重录结构化页面观察",
    }
    queue["userConclusion"] = "当前 Checker 观察已拒绝并自动回到待重录；artifact 保持不变，必须创建新 attempt 继续"
    persist(path, queue)


def record_item(args: argparse.Namespace) -> dict[str, Any]:
    path = args.queue.expanduser().resolve()
    queue = load_queue(path)
    item = find_item(queue, args.platform, args.delivery_key)
    current = item.get("currentAttempt")
    if item.get("status") != "RUNNING" or not isinstance(current, dict):
        raise ValueError("该页签尚未 start，不能记录页面结果")
    observation_path = args.observation.expanduser().resolve()
    observation_reference = file_ref(observation_path)
    raw_observation = load_json(observation_path)
    if not isinstance(raw_observation, dict):
        reject_current_observation(
            path, queue, item, current, observation_reference,
            "结构化观察文件顶层不是对象",
        )
        raise ValueError("结构化观察文件无效；当前 attempt 已取消并进入重录")
    raw_status = (raw_observation.get("activeTab") or {}).get("status")
    if "externalProvenance" in raw_observation:
        reject_current_observation(
            path, queue, item, current, observation_reference,
            "external browser provenance 必须由固定 collector 作为独立输入，调用方不得把它写进 observation 自签",
            raw_observation,
        )
        raise ValueError("observation 不得携带调用方自签 external provenance；当前 attempt 已取消并进入重录")
    if raw_status == "AVAILABLE":
        if args.provenance is None:
            reject_current_observation(
                path, queue, item, current, observation_reference,
                "AVAILABLE Checker observation 必须绑定固定 CDP external provenance",
                raw_observation,
            )
            raise ValueError("AVAILABLE Checker observation 缺少固定 CDP external provenance；当前 attempt 已取消并进入重录")
        provenance_path = args.provenance.expanduser().resolve()
        try:
            provenance_path.relative_to(path.parent.resolve())
        except ValueError:
            reject_current_observation(
                path, queue, item, current, observation_reference,
                "external provenance 输出必须位于当前 Checker 队列目录",
                raw_observation,
            )
            raise ValueError("external provenance 输出越过当前 Checker 队列目录；当前 attempt 已取消并进入重录")
        if provenance_path.exists() or provenance_path.is_symlink():
            reject_current_observation(
                path, queue, item, current, observation_reference,
                "external provenance 输出路径必须是本次固定 collector 新建的文件，不能复用调用方自签 capture",
                raw_observation,
            )
            raise ValueError("external provenance 输出路径已存在；当前 attempt 已取消并进入重录")
        provenance_path.parent.mkdir(parents=True, exist_ok=True)
        collector = SCRIPT_ROOT / "checker_browser_collector.mjs"
        try:
            completed = subprocess.run(
                [
                    "node", str(collector),
                    "--checker-url", str(queue["checkerUrl"]),
                    "--observation", str(observation_path),
                    "--output", str(provenance_path),
                    "--screenshot", str(Path(str((raw_observation.get("screenshot") or {}).get("path") or "")).expanduser().resolve()),
                ],
                capture_output=True,
                text=True,
                check=False,
                timeout=45,
            )
        except (OSError, subprocess.TimeoutExpired) as exc:
            reject_current_observation(
                path, queue, item, current, observation_reference,
                f"固定 CDP collector 未能执行：{exc}", raw_observation,
            )
            raise ValueError("固定 CDP collector 未能执行；当前 attempt 已取消并进入重录") from exc
        if completed.returncode != 0 or not provenance_path.is_file():
            reason = (completed.stderr or completed.stdout or "固定 CDP collector 拒绝观察").strip()
            reject_current_observation(path, queue, item, current, observation_reference, reason, raw_observation)
            raise ValueError(f"external browser provenance 未通过固定 collector：{reason}")
        provenance = load_json(provenance_path)
        if not isinstance(provenance, dict):
            reject_current_observation(
                path, queue, item, current, observation_reference,
                "固定 CDP collector 输出不是对象", raw_observation,
            )
            raise ValueError("固定 CDP collector 输出无效；当前 attempt 已取消并进入重录")
        capture = provenance.get("capture") if isinstance(provenance, dict) else None
        captured_screenshot = capture.get("screenshot") if isinstance(capture, dict) else None
        raw_observation = {
            **raw_observation,
            **({"screenshot": captured_screenshot} if isinstance(captured_screenshot, dict) else {}),
            "externalProvenance": provenance,
        }
        # Seal in two passes: the observation carries the final provenance
        # file ref, while its canonical hash intentionally excludes that ref.
        provenance["observationSha256"] = "0" * 64
        write_json_atomic(provenance_path, provenance)
        provenance_reference = file_ref(provenance_path)
        raw_observation["externalProvenanceFile"] = provenance_reference
        provenance["observationSha256"] = observation_content_hash(raw_observation)
        raw_observation["externalProvenance"] = provenance
        write_json_atomic(provenance_path, provenance)
        provenance_reference = file_ref(provenance_path)
        raw_observation["externalProvenanceFile"] = provenance_reference
    manifest_path = verify_ref(item["candidateManifest"], "Checker final-recheck 清单")
    manifest = verify_manifest_file(str(manifest_path))
    try:
        observation = validate_observation(
            raw_observation,
            manifest,
            checker_url=str(queue["checkerUrl"]),
            expected_attempt_id=str(current.get("attemptId") or ""),
            forbidden_screenshot_hashes=used_screenshot_hashes(queue),
            require_external_provenance=raw_status == "AVAILABLE",
        )
    except CheckerAcceptanceError as exc:
        reject_current_observation(
            path, queue, item, current, observation_reference, str(exc), raw_observation,
        )
        raise ValueError(f"结构化观察未通过真实性门禁：{exc}；当前 attempt 已取消并进入重录") from exc
    if (observation.get("derived") or {}).get("classification") == "OBSERVATION_RETRY":
        reason = "R2/R5、可信输入或桥接调用证据不完整或相互矛盾"
        reject_current_observation(
            path, queue, item, current, observation_reference, reason, observation,
        )
        raise ValueError(reason + "；当前 attempt 已取消，artifact 保持不变并进入重录")
    screenshot = dict(observation["screenshot"])
    evidence = [screenshot]

    timeline = load_timeline(Path(queue["timeline"]))
    event_id = str(current.get("timelineEventId") or "")
    events = [event for event in timeline["events"] if event.get("eventId") == event_id]
    if len(events) != 1:
        raise ValueError("Checker 页签与时间账本事件不一致")
    if events[0].get("status") == "RUNNING":
        event = finish_event(
            Path(queue["timeline"]),
            event_id=event_id,
            status="SUCCEEDED",
            output_paths=[observation_path, Path(str(screenshot["path"]))],
        )
    elif events[0].get("status") == "SUCCEEDED":
        event = events[0]
    else:
        raise ValueError("Checker 页签事件已失败或取消，请重新 start")
    item["attempts"].append({
        **current,
        "finishedAt": event["finishedAt"],
        "durationMs": event["durationMs"],
        "status": "COMPLETED",
        "classification": (observation.get("derived") or {}).get("classification"),
        "observationFile": observation_reference,
        "screenshot": screenshot,
        "evidence": evidence,
        "observation": observation,
        **({"externalProvenanceFile": provenance_reference} if raw_status == "AVAILABLE" else {}),
    })
    item.pop("currentAttempt", None)
    item["status"] = "COMPLETED"
    queue["lastOutcome"] = {
        "classification": (observation.get("derived") or {}).get("classification"),
        "platform": item["platform"],
        "deliveryKey": item["deliveryKey"],
        "artifact": item["artifact"],
        "attemptId": current.get("attemptId"),
        "observationSha256": observation_reference["sha256"],
        "continuationRequired": (observation.get("derived") or {}).get("classification") != "PASS",
    }
    queue["userConclusion"] = f"已保存并验签 {args.platform}/{args.delivery_key} 结构化页面观察；结论由页面节点和桥接明细自动派生"
    return persist(path, queue)


def cancel_current(args: argparse.Namespace) -> dict[str, Any]:
    path = args.queue.expanduser().resolve()
    queue = load_queue(path)
    running = [item for item in queue["items"] if item.get("status") == "RUNNING"]
    if len(running) != 1:
        raise ValueError("当前没有唯一正在执行的 Checker 页签")
    item = running[0]
    current = item.get("currentAttempt") or {}
    reason = args.reason.strip()
    if not reason:
        raise ValueError("中断原因不能为空")
    timeline_path = Path(queue["timeline"])
    event_id = str(current.get("timelineEventId") or "")
    timeline = load_timeline(timeline_path)
    events = [event for event in timeline["events"] if event.get("eventId") == event_id]
    if len(events) != 1:
        raise ValueError("Checker 页签与时间账本事件不一致")
    event = (
        finish_event(timeline_path, event_id=event_id, status="CANCELLED", message=reason)
        if events[0].get("status") == "RUNNING"
        else events[0]
    )
    item["attempts"].append({
        **current,
        "finishedAt": event["finishedAt"],
        "durationMs": event["durationMs"],
        "status": "CANCELLED",
        "reason": reason,
        "evidence": [],
    })
    item.pop("currentAttempt", None)
    item["status"] = "PENDING"
    queue["userConclusion"] = "Checker 浏览器步骤已中断并保留记录；可从该未完成页签继续"
    return persist(path, queue)


def enqueue_item(args: argparse.Namespace) -> dict[str, Any]:
    path = args.queue.expanduser().resolve()
    queue = load_queue(path)
    ensure_queue_preflight(queue)
    if any(item.get("status") == "RUNNING" for item in queue["items"]):
        raise ValueError("已有页签正在执行；先记录或取消当前页签再新增 artifact")
    manifest = verify_manifest_file(str(args.manifest.expanduser().resolve()))
    if manifest.get("status") != "FINAL_RECHECK_READY":
        raise ValueError("enqueue 只接受 FINAL_RECHECK_READY 清单")
    replacement = queue_item_from_manifest(manifest, queue["checkerUrl"])
    key = item_key(replacement)
    if any(item_key(item) == key for item in queue["items"]):
        raise ValueError(f"{key[0]}/{key[1]} 已在队列中；artifact 变化时使用 supersede")
    queue["items"].append(replacement)
    queue["items"].sort(key=lambda item: (item["deliveryKey"], PLATFORM_ORDER.get(item["platform"], 99)))
    queue["userConclusion"] = f"已把 {key[0]}/{key[1]} 的 exact final artifact 加入 Checker 队列"
    return persist(path, queue)


def supersede_item(args: argparse.Namespace) -> dict[str, Any]:
    path = args.queue.expanduser().resolve()
    queue = load_queue(path)
    ensure_queue_preflight(queue)
    if any(item.get("status") == "RUNNING" for item in queue["items"]):
        raise ValueError("已有页签正在执行；先记录或取消当前页签再替换 artifact")
    manifest = verify_manifest_file(str(args.manifest.expanduser().resolve()))
    if manifest.get("status") != "FINAL_RECHECK_READY":
        raise ValueError("supersede 只接受 FINAL_RECHECK_READY 清单")
    if manifest.get("platform") != args.platform:
        raise ValueError("--platform 与新 final-recheck 清单的平台不一致")
    delivery_key = str(manifest.get("deliveryKey") or "")
    item = find_item(queue, args.platform, delivery_key)
    replacement = queue_item_from_manifest(manifest, queue["checkerUrl"])
    if replacement["artifact"] == item.get("artifact"):
        raise ValueError("新清单仍绑定相同 artifact，无需 supersede")
    reason = args.reason.strip()
    if not reason:
        raise ValueError("supersede 原因不能为空")
    history = item.setdefault("supersededVersions", [])
    history.append({
        "supersededAt": utc_now(),
        "reason": reason,
        "candidateManifest": item["candidateManifest"],
        "artifact": item["artifact"],
        "status": item["status"],
        "attempts": item["attempts"],
        "browserInstructions": item.get("browserInstructions"),
    })
    item.update({
        "candidateManifest": replacement["candidateManifest"],
        "artifact": replacement["artifact"],
        "status": "PENDING",
        "attempts": [],
        "browserInstructions": replacement["browserInstructions"],
    })
    item.pop("currentAttempt", None)
    queue["userConclusion"] = (
        f"已用新 SHA-256 替换 {args.platform}/{delivery_key}；仅该平台回到待检查，其他平台记录保持不变"
    )
    return persist(path, queue)


def export_observations(args: argparse.Namespace) -> dict[str, Any]:
    output = args.output.expanduser().resolve()
    if output.exists():
        raise ValueError(f"Checker 观察文件已存在，不能覆盖复用：{output}")
    queue = load_queue(args.queue)
    if any(item.get("status") == "RUNNING" for item in queue["items"]):
        raise ValueError("仍有 Checker 页签正在执行，不能导出")
    observations = []
    for item in queue["items"]:
        completed = [attempt for attempt in item["attempts"] if attempt.get("status") == "COMPLETED"]
        if completed:
            observations.append(completed[-1]["observation"])
    preflight_evidence = []
    preflight_reference = queue.get("preflight")
    if isinstance(preflight_reference, dict):
        preflight_path = verify_ref(preflight_reference, "Checker preflight")
        preflight = load_json(preflight_path)
        if isinstance(preflight, dict):
            preflight_evidence = list(preflight.get("evidence") or [])
    result = {
        "schemaVersion": OBSERVATION_SCHEMA,
        "checkerUrl": queue["checkerUrl"],
        "recordedAt": utc_now(),
        "preflightEvidence": preflight_evidence,
        "platforms": observations,
    }
    write_json_atomic(output, result)
    return result


def compact_queue_result(queue: dict[str, Any]) -> dict[str, Any]:
    item = next_pending(queue)
    result: dict[str, Any] = {
        "ok": True,
        "schemaVersion": queue["schemaVersion"],
        "runId": queue["runId"],
        "summary": queue["summary"],
        "userConclusion": queue["userConclusion"],
        "next": None,
    }
    if item is not None:
        result["next"] = {
            "platform": item["platform"],
            "deliveryKey": item["deliveryKey"],
            "artifact": item["artifact"],
            "status": item["status"],
            "browserInstructions": browser_instructions(queue["checkerUrl"], item),
        }
        if isinstance(item.get("currentAttempt"), dict):
            result["next"]["currentAttempt"] = item["currentAttempt"]
    return result


def main() -> int:
    args = parser().parse_args()
    try:
        if args.command == "preflight":
            result = create_preflight_instructions(args)
        elif args.command == "preflight-record":
            result = record_preflight(args)
        elif args.command == "init":
            result = create_queue(args)
        elif args.command == "next":
            queue = load_queue(args.queue)
            item = next_pending(queue)
            result = {
                "ok": True,
                "summary": queue["summary"],
                "next": None if item is None else {
                    "platform": item["platform"],
                    "deliveryKey": item["deliveryKey"],
                    "artifact": item["artifact"],
                    "status": item["status"],
                    "browserInstructions": browser_instructions(queue["checkerUrl"], item),
                },
                "userConclusion": "Checker 队列已完成" if item is None else "请继续处理返回的下一个浏览器页签",
            }
        elif args.command == "start":
            result = start_item(args)
        elif args.command == "record":
            result = record_item(args)
        elif args.command == "cancel":
            result = cancel_current(args)
        elif args.command == "enqueue":
            result = enqueue_item(args)
        elif args.command == "supersede":
            result = supersede_item(args)
        elif args.command == "export":
            result = export_observations(args)
        else:
            raise ValueError(f"不支持的命令：{args.command}")
        if getattr(args, "compact", False):
            if isinstance(result, dict) and result.get("schemaVersion") == SCHEMA:
                result = compact_queue_result(result)
            elif args.command == "export":
                result = {
                    "ok": True,
                    "schemaVersion": result.get("schemaVersion"),
                    "output": str(args.output.expanduser().resolve()),
                    "platformCount": len(result.get("platforms") or []),
                }
        print(json.dumps(result, ensure_ascii=False, indent=2))
        return 0
    except (
        OSError,
        ValueError,
        json.JSONDecodeError,
        CandidateError,
        RulesetError,
        CheckerAcceptanceError,
        TimelineError,
    ) as exc:
        print(json.dumps({"ok": False, "error": str(exc)}, ensure_ascii=False, indent=2))
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
