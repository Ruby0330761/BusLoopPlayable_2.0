#!/usr/bin/env python3
"""为 AppLovin playable 注入 12 个标准事件。

设计约束（与本 Skill 的埋点红线一致）：

* 生命周期事件（LOADING / LOADED / DISPLAYED）和首次交互（CHALLENGE_STARTED）
  由统一 runtime 观察真实容器状态与真实输入触发，可以安全自动注入。
* 玩法事件（进度、通关、失败、重试、结束页、CTA）必须在被测代码里命中真实
  挂载点才注入。命中不到的记为 UNWIRED 并让本次运行失败——绝不写入占位调用、
  空函数或不会触发的假埋点。
* 已存在 `ALPlayableAnalytics` 或其他事件埋点的 artifact 默认拒绝注入，避免
  重复上报污染漏斗；确实需要重写时用 `--replace` 显式声明。
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
from pathlib import Path
from typing import Any


SKILL_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(SKILL_ROOT / "scripts" / "lib"))

from artifact import ArtifactError, load_artifact  # noqa: E402

SCHEMA = "playable-applovin-event-injection-v1"
EVENT_SCHEMA = "playable-applovin-event-map-v1"
RUNTIME_MARKER = "__playableEventRuntime"
TRACKER_MARKER = "__playableTrack"

LIFECYCLE_EVENTS = ("LOADING", "LOADED", "DISPLAYED")
AUTO_EVENTS = ("CHALLENGE_STARTED",)
GAMEPLAY_EVENTS = (
    "CHALLENGE_PASS_25",
    "CHALLENGE_PASS_50",
    "CHALLENGE_PASS_75",
    "CHALLENGE_SOLVED",
    "CHALLENGE_FAILED",
    "CHALLENGE_RETRY",
    "ENDCARD_SHOWN",
    "CTA_CLICKED",
)
ALL_EVENTS = LIFECYCLE_EVENTS + AUTO_EVENTS + GAMEPLAY_EVENTS

EVENT_CALLS = {
    "CHALLENGE_PASS_25": "__playableEventRuntime.progress(25)",
    "CHALLENGE_PASS_50": "__playableEventRuntime.progress(50)",
    "CHALLENGE_PASS_75": "__playableEventRuntime.progress(75)",
    "CHALLENGE_SOLVED": "__playableEventRuntime.solved()",
    "CHALLENGE_FAILED": "__playableEventRuntime.failed()",
    "CHALLENGE_RETRY": "__playableEventRuntime.retry()",
    "ENDCARD_SHOWN": "__playableEventRuntime.endcard()",
    "CTA_CLICKED": "__playableEventRuntime.cta()",
}

# (正则, 事件, 注入位置, 说明)
#   expr  = 表达式位置，用逗号接入同一语句，不改变分支语义
#   block = 函数声明/代码块开头，命中后把调用插进块内
AUTO_ANCHORS: tuple[tuple[str, str, str, str], ...] = (
    (r"mraid\s*\.\s*open\s*\(", "CTA_CLICKED", "expr", "mraid.open"),
    (r"ExitApi\s*\.\s*exit\s*\(", "CTA_CLICKED", "expr", "ExitApi.exit"),
    (r"FbPlayableAd\s*\.\s*onCTAClick\s*\(", "CTA_CLICKED", "expr", "FbPlayableAd.onCTAClick"),
    (r"\bfunction\s+(?:showEnd(?:Page|Card|Layer)|createEndPage|gameEnd)\s*\([^)]*\)\s*\{",
     "ENDCARD_SHOWN", "block", "结束页函数"),
    (r"\bfunction\s+(?:retry|restart|replay|tryAgain|resetGame)\s*\([^)]*\)\s*\{",
     "CHALLENGE_RETRY", "block", "重试函数"),
)


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def existing_events(text: str) -> list[str]:
    return [name for name in ALL_EVENTS if re.search(re.escape(name), text)]


def instrumentation_present(text: str) -> bool:
    return bool(
        re.search(r"ALPlayableAnalytics", text)
        or re.search(re.escape(RUNTIME_MARKER), text)
        or len(existing_events(text)) >= 2
    )


def build_runtime() -> str:
    """统一 runtime：观察真实容器状态与真实输入，只在真实时机发事件。"""
    return """
(function(){
  if (window.%(runtime)s) return;
  var fired = {};
  function track(name){
    if (fired[name]) return;
    fired[name] = true;
    try {
      if (window.ALPlayableAnalytics && typeof window.ALPlayableAnalytics.trackEvent === 'function') {
        window.ALPlayableAnalytics.trackEvent(name);
      }
    } catch (error) { /* 上报失败不影响玩法 */ }
  }
  window.%(tracker)s = track;
  var started = false, ended = false;
  var runtime = {
    loading: function(){ track('LOADING'); },
    loaded: function(){ track('LOADED'); },
    displayed: function(){ track('DISPLAYED'); },
    started: function(){
      if (started) return;
      started = true;
      track('CHALLENGE_STARTED');
    },
    progress: function(percent){
      if (ended) return;
      if (percent >= 25) track('CHALLENGE_PASS_25');
      if (percent >= 50) track('CHALLENGE_PASS_50');
      if (percent >= 75) track('CHALLENGE_PASS_75');
    },
    solved: function(){
      if (ended) return;
      ended = true;
      track('CHALLENGE_SOLVED');
    },
    failed: function(){
      if (ended) return;
      ended = true;
      track('CHALLENGE_FAILED');
    },
    retry: function(){
      ended = false;
      started = true;
      track('CHALLENGE_RETRY');
    },
    endcard: function(){
      if (ended) return;
      ended = true;
      track('ENDCARD_SHOWN');
    },
    cta: function(){
      runtime.started();
      track('CTA_CLICKED');
    }
  };
  window.%(runtime)s = runtime;
  runtime.loading();
  var markReady = function(){ runtime.loaded(); runtime.displayed(); };
  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    markReady();
  } else {
    document.addEventListener('DOMContentLoaded', markReady, { once: true });
  }
  var onFirstInput = function(){ runtime.started(); };
  ['pointerdown','touchstart','mousedown','keydown'].forEach(function(type){
    window.addEventListener(type, onFirstInput, { once: true, passive: true });
  });
})();
""" % {"runtime": RUNTIME_MARKER, "tracker": TRACKER_MARKER}


def inject_head(html: str, script: str) -> tuple[str, str]:
    tag = f"<script>{script}</script>"
    match = re.search(r"<head(?:\s[^>]*)?>", html, re.IGNORECASE)
    if match:
        return html[: match.end()] + tag + html[match.end():], "head"
    match = re.search(r"<html(?:\s[^>]*)?>", html, re.IGNORECASE)
    if match:
        return html[: match.end()] + "<head>" + tag + "</head>" + html[match.end():], "head-created"
    raise ArtifactError("HTML 缺少 <head> 或 <html>，无法安全注入 runtime")


def guard_call(event: str) -> str:
    return f"window.{TRACKER_MARKER}&&{EVENT_CALLS[event]}"


def insert_html(html: str, index: int, event: str, place: str) -> str:
    """按注入位置插入。expr 用逗号保持同一语句；block/after 用分号。"""
    if place == "expr":
        return html[:index] + guard_call(event) + "," + html[index:]
    return html[:index] + guard_call(event) + ";" + html[index:]


def anchor_matches(html: str, pattern: str) -> list[re.Match]:
    return list(re.finditer(pattern, html))


def apply_event_map(
    html: str, event_map: dict[str, Any], already_wired: set[str]
) -> tuple[str, list[dict], list[str]]:
    wired: list[dict] = []
    problems: list[str] = []
    for event in sorted(event_map):
        spec = event_map[event]
        if event not in GAMEPLAY_EVENTS:
            problems.append(f"{event}: 不是可映射的玩法事件")
            continue
        if event in already_wired:
            continue
        if not isinstance(spec, dict):
            problems.append(f"{event}: 映射必须是对象")
            continue
        pattern = spec.get("anchor")
        occurrence = spec.get("occurrence", 1)
        place = spec.get("place", "expr")
        if not isinstance(pattern, str) or not pattern.strip():
            problems.append(f"{event}: 缺少 anchor 正则")
            continue
        if place not in {"expr", "block", "after"}:
            problems.append(f"{event}: place 只允许 expr、block 或 after")
            continue
        if not isinstance(occurrence, int) or occurrence < 1:
            problems.append(f"{event}: occurrence 必须是正整数")
            continue
        try:
            matches = anchor_matches(html, pattern)
        except re.error as exc:
            problems.append(f"{event}: 锚点正则无效 {exc}")
            continue
        if len(matches) < occurrence:
            problems.append(f"{event}: 锚点未命中（期望第 {occurrence} 个，实际 {len(matches)} 个）")
            continue
        match = matches[occurrence - 1]
        if place == "after":
            # 锚点自带语句结束符时直接插在它后面；否则向后找语句结尾。
            if match.group(0).rstrip().endswith(";"):
                index = match.end()
            else:
                tail = html[match.end():]
                if tail.lstrip().startswith(";"):
                    index = match.end() + (len(tail) - len(tail.lstrip())) + 1
                else:
                    end = html.find(";", match.end())
                    if end < 0:
                        problems.append(f"{event}: after 模式找不到语句结束符")
                        continue
                    index = end + 1
            html = insert_html(html, index, event, "after")
        else:
            html = insert_html(html, match.end() if place == "block" else match.start(), event, place)
        wired.append({"event": event, "place": place, "anchor": pattern, "occurrence": occurrence})
    return html, wired, problems


def apply_auto_anchors(html: str, already_wired: set[str]) -> tuple[str, list[dict], list[str]]:
    """自动锚点：只在唯一命中时注入；多解不猜，交给事件映射。"""
    wired: list[dict] = []
    ambiguous: list[str] = []
    covered = set(already_wired)
    for pattern, event, place, label in AUTO_ANCHORS:
        if event in covered:
            continue
        try:
            matches = anchor_matches(html, pattern)
        except re.error:
            continue
        if len(matches) == 1:
            html = insert_html(html, matches[0].end() if place == "block" else matches[0].start(), event, place)
            wired.append({"event": event, "place": place, "anchor": label, "occurrence": 1})
            covered.add(event)
        elif len(matches) > 1:
            ambiguous.append(f"{event}: {label} 命中 {len(matches)} 处，需要事件映射指定第几个")
    return html, wired, ambiguous


def load_event_map(path: Path | None) -> dict[str, Any]:
    if path is None:
        return {}
    value = json.loads(path.expanduser().read_text(encoding="utf-8"))
    if not isinstance(value, dict):
        raise ValueError("事件映射根必须是对象")
    if value.get("schemaVersion") != EVENT_SCHEMA:
        raise ValueError(f"事件映射 schemaVersion 必须为 {EVENT_SCHEMA}")
    events = value.get("events")
    if not isinstance(events, dict):
        raise ValueError("事件映射缺少 events 对象")
    return events


def write_receipt(path: Path, receipt: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(receipt, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def blocked(path: Path, errors: list[str]) -> int:
    receipt = {
        "schemaVersion": SCHEMA,
        "status": "BLOCKED",
        "platform": "applovin",
        "errors": errors,
        "userConclusion": "事件注入未执行；未生成任何产物。",
    }
    write_receipt(path, receipt)
    print(json.dumps(receipt, ensure_ascii=False, indent=2))
    return 1


def main() -> int:
    parser = argparse.ArgumentParser(
        description="为 AppLovin playable 注入 12 个标准事件；缺真实锚点即失败，不写占位埋点"
    )
    parser.add_argument("--artifact", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--receipt", required=True, type=Path)
    parser.add_argument("--event-map", type=Path, help="显式锚点映射，用于自动锚点无法唯一命中的玩法事件")
    parser.add_argument("--replace", action="store_true", help="已存在埋点时仍强制注入（默认拒绝，避免重复上报）")
    args = parser.parse_args()

    artifact_path = args.artifact.expanduser().resolve()
    output_path = args.output.expanduser().resolve()
    receipt_path = args.receipt.expanduser().resolve()

    try:
        artifact = load_artifact(str(artifact_path))
    except ArtifactError as exc:
        return blocked(receipt_path, [str(exc)])

    if artifact.kind != "html":
        return blocked(receipt_path, ["事件注入只支持单 HTML；ZIP 请在构建阶段注入后再打包"])

    source = artifact_path.read_bytes()
    html = source.decode("utf-8", errors="surrogateescape")
    before_sha = sha256_bytes(source)
    pre_existing = existing_events(html)

    if instrumentation_present(html) and not args.replace:
        receipt = {
            "schemaVersion": SCHEMA,
            "status": "ALREADY_INSTRUMENTED",
            "platform": "applovin",
            "artifact": {"input": {"path": str(artifact_path), "sha256": before_sha, "bytes": len(source)}},
            "preExistingEvents": pre_existing,
            "userConclusion": "artifact 已含 AppLovin 埋点，为避免重复上报未做任何注入；如需重写请显式声明 replace。",
        }
        write_receipt(receipt_path, receipt)
        print(json.dumps(receipt, ensure_ascii=False, indent=2))
        return 0

    try:
        events_map = load_event_map(args.event_map)
    except (OSError, ValueError, json.JSONDecodeError) as exc:
        return blocked(receipt_path, [str(exc)])

    html, mapped, map_problems = apply_event_map(html, events_map, set())
    html, auto, ambiguous = apply_auto_anchors(html, {item["event"] for item in mapped})
    html, location = inject_head(html, build_runtime())

    wired_events = {item["event"] for item in mapped} | {item["event"] for item in auto}
    covered = set(LIFECYCLE_EVENTS) | set(AUTO_EVENTS) | wired_events
    unwired = [name for name in ALL_EVENTS if name not in covered]
    status = "INJECTED" if not unwired and not map_problems else "BLOCKED"

    after_entry = None
    if status == "INJECTED":
        output_path.parent.mkdir(parents=True, exist_ok=True)
        output_path.write_bytes(html.encode("utf-8", errors="surrogateescape"))
        payload = output_path.read_bytes()
        after_entry = {"path": str(output_path), "sha256": sha256_bytes(payload), "bytes": len(payload)}

    receipt = {
        "schemaVersion": SCHEMA,
        "status": status,
        "platform": "applovin",
        "artifact": {
            "input": {"path": str(artifact_path), "sha256": before_sha, "bytes": len(source)},
            "output": after_entry,
        },
        "runtimeInsertedAt": location,
        "events": {
            "lifecycle": list(LIFECYCLE_EVENTS),
            "auto": list(AUTO_EVENTS),
            "wired": sorted(wired_events),
            "wiredDetail": mapped + auto,
            "unwired": unwired,
        },
        "ambiguousAnchors": ambiguous,
        "mapProblems": map_problems,
        "preExistingEvents": pre_existing,
        "userConclusion": (
            "12 个 AppLovin 事件已接入真实容器状态、真实交互和真实代码锚点；必须完整重建并复检后才可交付。"
            if status == "INJECTED" else
            "事件注入因缺少真实挂载点而阻塞，未生成产物；请补充事件映射或改用替代锚点。"
        ),
    }
    write_receipt(receipt_path, receipt)
    print(json.dumps(receipt, ensure_ascii=False, indent=2))
    return 0 if status == "INJECTED" else 1


if __name__ == "__main__":
    raise SystemExit(main())
