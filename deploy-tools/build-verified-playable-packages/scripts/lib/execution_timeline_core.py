from __future__ import annotations

import uuid
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable

import fcntl

from resource_common import load_json, path_bytes, sha256_tree, write_json_atomic


SCHEMA = "playable-execution-timeline-v1"
TIME_CLASSES = {"automatic", "user-wait", "checker-ui-wait", "rework"}
EVENT_STATUSES = {"RUNNING", "SUCCEEDED", "FAILED", "CANCELLED"}
CACHE_STATUSES = {"HIT", "MISS", "NOT_APPLICABLE"}


class TimelineError(ValueError):
    pass


@contextmanager
def timeline_lock(path: Path):
    resolved = path.expanduser().resolve()
    resolved.parent.mkdir(parents=True, exist_ok=True)
    lock_path = resolved.with_name(resolved.name + ".lock")
    with lock_path.open("a+", encoding="utf-8") as handle:
        fcntl.flock(handle.fileno(), fcntl.LOCK_EX)
        try:
            yield resolved
        finally:
            fcntl.flock(handle.fileno(), fcntl.LOCK_UN)


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds")


def parse_timestamp(value: str, label: str) -> datetime:
    if not isinstance(value, str) or not value.strip():
        raise TimelineError(f"{label} 必须是带时区的 ISO-8601 时间")
    normalized = value.strip().replace("Z", "+00:00")
    try:
        parsed = datetime.fromisoformat(normalized)
    except ValueError as exc:
        raise TimelineError(f"{label} 不是有效 ISO-8601 时间：{value}") from exc
    if parsed.tzinfo is None:
        raise TimelineError(f"{label} 必须包含时区：{value}")
    return parsed.astimezone(timezone.utc)


def duration_ms(started_at: str, finished_at: str) -> int:
    started = parse_timestamp(started_at, "startedAt")
    finished = parse_timestamp(finished_at, "finishedAt")
    milliseconds = round((finished - started).total_seconds() * 1000)
    if milliseconds < 0:
        raise TimelineError("finishedAt 不能早于 startedAt")
    return milliseconds


def evidence_ref(path: Path) -> dict[str, Any]:
    resolved = path.expanduser().resolve()
    if not resolved.exists():
        raise TimelineError(f"输出证据不存在：{resolved}")
    return {
        "path": str(resolved),
        "type": "file" if resolved.is_file() else "directory",
        "bytes": path_bytes(resolved),
        "sha256": sha256_tree(resolved),
    }


def empty_timeline(run_id: str, project_root: Path | None = None) -> dict[str, Any]:
    if not isinstance(run_id, str) or not run_id.strip():
        raise TimelineError("runId 不能为空")
    created_at = now_iso()
    return {
        "schemaVersion": SCHEMA,
        "runId": run_id.strip(),
        "projectRoot": str(project_root.expanduser().resolve()) if project_root else None,
        "createdAt": created_at,
        "updatedAt": created_at,
        "events": [],
        "summary": summarize_events([]),
    }


def create_timeline(path: Path, run_id: str, project_root: Path | None = None) -> dict[str, Any]:
    with timeline_lock(path) as resolved:
        if resolved.exists():
            raise TimelineError(f"时间账本已存在：{resolved}")
        timeline = empty_timeline(run_id, project_root)
        write_json_atomic(resolved, timeline)
        return timeline


def validate_event(event: object, index: int) -> dict[str, Any]:
    if not isinstance(event, dict):
        raise TimelineError(f"events[{index}] 必须是对象")
    event_id = event.get("eventId")
    if not isinstance(event_id, str) or not event_id.strip():
        raise TimelineError(f"events[{index}].eventId 不能为空")
    for name in ("phase", "operation"):
        if not isinstance(event.get(name), str) or not event[name].strip():
            raise TimelineError(f"events[{index}].{name} 不能为空")
    if event.get("timeClass") not in TIME_CLASSES:
        raise TimelineError(f"events[{index}].timeClass 无效")
    if event.get("status") not in EVENT_STATUSES:
        raise TimelineError(f"events[{index}].status 无效")
    if event.get("cacheStatus") not in CACHE_STATUSES:
        raise TimelineError(f"events[{index}].cacheStatus 无效")
    parse_timestamp(str(event.get("startedAt") or ""), f"events[{index}].startedAt")
    if event["status"] == "RUNNING":
        if event.get("finishedAt") is not None or event.get("durationMs") is not None:
            raise TimelineError(f"events[{index}] 仍在运行，不能包含结束时间")
    else:
        calculated = duration_ms(
            str(event.get("startedAt") or ""),
            str(event.get("finishedAt") or ""),
        )
        if event.get("durationMs") != calculated:
            raise TimelineError(f"events[{index}].durationMs 与时间区间不一致")
    input_hashes = event.get("inputHashes")
    if not isinstance(input_hashes, dict) or not all(
        isinstance(name, str) and name and isinstance(value, str) and value
        for name, value in input_hashes.items()
    ):
        raise TimelineError(f"events[{index}].inputHashes 必须是字符串映射")
    evidence = event.get("outputEvidence")
    if not isinstance(evidence, list):
        raise TimelineError(f"events[{index}].outputEvidence 必须是数组")
    return event


def validate_timeline(value: object) -> dict[str, Any]:
    if not isinstance(value, dict) or value.get("schemaVersion") != SCHEMA:
        raise TimelineError(f"时间账本 schemaVersion 必须为 {SCHEMA}")
    if not isinstance(value.get("runId"), str) or not value["runId"].strip():
        raise TimelineError("时间账本缺少 runId")
    events = value.get("events")
    if not isinstance(events, list):
        raise TimelineError("时间账本 events 必须是数组")
    seen: set[str] = set()
    for index, event in enumerate(events):
        checked = validate_event(event, index)
        if checked["eventId"] in seen:
            raise TimelineError(f"eventId 重复：{checked['eventId']}")
        seen.add(checked["eventId"])
    expected = summarize_events(events)
    if value.get("summary") != expected:
        raise TimelineError("时间账本 summary 与事件区间不一致")
    return value


def load_timeline(path: Path) -> dict[str, Any]:
    return validate_timeline(load_json(path.expanduser().resolve()))


def interval_union_ms(intervals: Iterable[tuple[datetime, datetime]]) -> int:
    ordered = sorted(intervals, key=lambda item: (item[0], item[1]))
    if not ordered:
        return 0
    total = 0.0
    current_start, current_end = ordered[0]
    for started, finished in ordered[1:]:
        if started <= current_end:
            if finished > current_end:
                current_end = finished
            continue
        total += (current_end - current_start).total_seconds()
        current_start, current_end = started, finished
    total += (current_end - current_start).total_seconds()
    return round(total * 1000)


def completed_intervals(events: Iterable[dict[str, Any]], classes: set[str] | None = None) -> list[tuple[datetime, datetime]]:
    result = []
    for event in events:
        if event.get("status") == "RUNNING" or event.get("finishedAt") is None:
            continue
        if classes is not None and event.get("timeClass") not in classes:
            continue
        result.append((
            parse_timestamp(event["startedAt"], "startedAt"),
            parse_timestamp(event["finishedAt"], "finishedAt"),
        ))
    return result


def summarize_events(events: list[dict[str, Any]]) -> dict[str, Any]:
    per_class = {
        name: interval_union_ms(completed_intervals(events, {name}))
        for name in sorted(TIME_CLASSES)
    }
    phase_names = sorted({str(item.get("phase")) for item in events if item.get("phase")})
    phases = {
        phase: interval_union_ms(completed_intervals(
            [item for item in events if item.get("phase") == phase]
        ))
        for phase in phase_names
    }
    active_classes = {"automatic", "checker-ui-wait", "rework"}
    active_ms = interval_union_ms(completed_intervals(events, active_classes))
    wall_ms = interval_union_ms(completed_intervals(events))
    missing_event_types: list[str] = []
    if not any(item.get("timeClass") == "automatic" for item in events):
        missing_event_types.append("automatic")
    if any(item.get("status") == "RUNNING" for item in events):
        missing_event_types.append("running-events")
    complete = not missing_event_types
    return {
        "eventCount": len(events),
        "completedEventCount": sum(item.get("status") != "RUNNING" for item in events),
        "runningEventCount": sum(item.get("status") == "RUNNING" for item in events),
        "failedEventCount": sum(item.get("status") == "FAILED" for item in events),
        "wallClockDurationMs": wall_ms,
        "activeDurationMs": active_ms,
        "userWaitDurationMs": per_class["user-wait"],
        "perClassDurationMs": per_class,
        "phaseDurationMs": phases,
        "complete": complete,
        "missingEventTypes": missing_event_types,
        "targets": {
            "normalActiveMs": 45 * 60 * 1000,
            "p95ActiveMs": 60 * 60 * 1000,
        },
        "targetAssessment": (
            "INSUFFICIENT_EVIDENCE" if not complete
            else "WITHIN_NORMAL_TARGET" if active_ms <= 45 * 60 * 1000
            else "WITHIN_P95_TARGET" if active_ms <= 60 * 60 * 1000
            else "EFFICIENCY_REVIEW_REQUIRED"
        ),
    }


def persist(path: Path, timeline: dict[str, Any]) -> dict[str, Any]:
    timeline["updatedAt"] = now_iso()
    timeline["summary"] = summarize_events(timeline["events"])
    validate_timeline(timeline)
    write_json_atomic(path.expanduser().resolve(), timeline)
    return timeline


def start_event(
    path: Path,
    *,
    phase: str,
    operation: str,
    time_class: str,
    event_id: str | None = None,
    attempt_id: str | None = None,
    platform: str | None = None,
    delivery_key: str | None = None,
    input_hashes: dict[str, str] | None = None,
    cache_status: str = "NOT_APPLICABLE",
    concurrency_group: str | None = None,
    started_at: str | None = None,
) -> dict[str, Any]:
    if time_class not in TIME_CLASSES:
        raise TimelineError(f"timeClass 无效：{time_class}")
    if cache_status not in CACHE_STATUSES:
        raise TimelineError(f"cacheStatus 无效：{cache_status}")
    with timeline_lock(path) as resolved:
        timeline = load_timeline(resolved)
        identifier = event_id or str(uuid.uuid4())
        if any(item.get("eventId") == identifier for item in timeline["events"]):
            raise TimelineError(f"eventId 已存在：{identifier}")
        event = {
            "eventId": identifier,
            "phase": phase.strip(),
            "operation": operation.strip(),
            "attemptId": attempt_id,
            "platform": platform,
            "deliveryKey": delivery_key,
            "startedAt": started_at or now_iso(),
            "finishedAt": None,
            "durationMs": None,
            "timeClass": time_class,
            "status": "RUNNING",
            "inputHashes": dict(sorted((input_hashes or {}).items())),
            "outputEvidence": [],
            "cacheStatus": cache_status,
            "concurrencyGroup": concurrency_group,
            "failure": None,
        }
        validate_event(event, len(timeline["events"]))
        timeline["events"].append(event)
        persist(resolved, timeline)
        return dict(event)


def finish_event(
    path: Path,
    *,
    event_id: str,
    status: str,
    output_paths: Iterable[Path] = (),
    finished_at: str | None = None,
    rule_ids: Iterable[str] = (),
    failure_scope: str | None = None,
    message: str | None = None,
) -> dict[str, Any]:
    if status not in EVENT_STATUSES - {"RUNNING"}:
        raise TimelineError(f"结束状态无效：{status}")
    with timeline_lock(path) as resolved:
        timeline = load_timeline(resolved)
        matches = [item for item in timeline["events"] if item.get("eventId") == event_id]
        if len(matches) != 1:
            raise TimelineError(f"找不到唯一运行事件：{event_id}")
        event = matches[0]
        if event.get("status") != "RUNNING":
            raise TimelineError(f"事件已经结束：{event_id}")
        end = finished_at or now_iso()
        event["finishedAt"] = end
        event["durationMs"] = duration_ms(event["startedAt"], end)
        event["status"] = status
        event["outputEvidence"] = [evidence_ref(item) for item in output_paths]
        if status == "FAILED":
            event["failure"] = {
                "ruleIds": sorted({item for item in rule_ids if item}),
                "scope": failure_scope,
                "message": message,
            }
        persist(resolved, timeline)
        return dict(event)


def record_event(path: Path, **kwargs: Any) -> dict[str, Any]:
    finished_at = kwargs.pop("finished_at")
    status = kwargs.pop("status", "SUCCEEDED")
    output_paths = tuple(kwargs.pop("output_paths", ()))
    rule_ids = kwargs.pop("rule_ids", ())
    failure_scope = kwargs.pop("failure_scope", None)
    message = kwargs.pop("message", None)
    started_at = kwargs.get("started_at") or now_iso()
    duration_ms(started_at, finished_at)
    for output_path in output_paths:
        evidence_ref(output_path)
    kwargs["started_at"] = started_at
    event = start_event(path, **kwargs)
    return finish_event(
        path,
        event_id=event["eventId"],
        status=status,
        output_paths=output_paths,
        finished_at=finished_at,
        rule_ids=rule_ids,
        failure_scope=failure_scope,
        message=message,
    )
