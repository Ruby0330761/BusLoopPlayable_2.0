#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

LIB_ROOT = Path(__file__).resolve().parent / "lib"
sys.path.insert(0, str(LIB_ROOT))

from execution_timeline_core import (
    CACHE_STATUSES,
    EVENT_STATUSES,
    TIME_CLASSES,
    TimelineError,
    create_timeline,
    finish_event,
    load_timeline,
    record_event,
    start_event,
)
from resource_common import write_json_atomic


def parser() -> argparse.ArgumentParser:
    root = argparse.ArgumentParser(description="记录并汇总 playable 流程的可解释耗时")
    sub = root.add_subparsers(dest="command", required=True)
    init = sub.add_parser("init")
    init.add_argument("--timeline", required=True, type=Path)
    init.add_argument("--run-id", required=True)
    init.add_argument("--project-root", type=Path)

    def event_arguments(command: argparse.ArgumentParser, *, include_start: bool) -> None:
        command.add_argument("--timeline", required=True, type=Path)
        command.add_argument("--event-id")
        command.add_argument("--phase", required=True)
        command.add_argument("--operation", required=True)
        command.add_argument("--time-class", required=True, choices=sorted(TIME_CLASSES))
        command.add_argument("--attempt-id")
        command.add_argument("--platform")
        command.add_argument("--delivery-key")
        command.add_argument("--input-hash", action="append", default=[], metavar="NAME=SHA256")
        command.add_argument("--cache-status", choices=sorted(CACHE_STATUSES), default="NOT_APPLICABLE")
        command.add_argument("--concurrency-group")
        if include_start:
            command.add_argument("--started-at")

    start = sub.add_parser("start")
    event_arguments(start, include_start=True)

    finish = sub.add_parser("finish")
    finish.add_argument("--timeline", required=True, type=Path)
    finish.add_argument("--event-id", required=True)
    finish.add_argument("--status", required=True, choices=sorted(EVENT_STATUSES - {"RUNNING"}))
    finish.add_argument("--finished-at")
    finish.add_argument("--evidence", action="append", default=[], type=Path)
    finish.add_argument("--rule-id", action="append", default=[])
    finish.add_argument("--failure-scope")
    finish.add_argument("--message")

    record = sub.add_parser("record")
    event_arguments(record, include_start=True)
    record.add_argument("--finished-at", required=True)
    record.add_argument("--status", choices=sorted(EVENT_STATUSES - {"RUNNING"}), default="SUCCEEDED")
    record.add_argument("--evidence", action="append", default=[], type=Path)
    record.add_argument("--rule-id", action="append", default=[])
    record.add_argument("--failure-scope")
    record.add_argument("--message")

    summary = sub.add_parser("summarize")
    summary.add_argument("--timeline", required=True, type=Path)
    summary.add_argument("--output", type=Path)
    return root


def key_values(values: list[str]) -> dict[str, str]:
    result: dict[str, str] = {}
    for value in values:
        if "=" not in value:
            raise TimelineError(f"参数必须是 name=value：{value}")
        name, item = value.split("=", 1)
        if not name.strip() or not item.strip():
            raise TimelineError(f"参数无效：{value}")
        result[name.strip()] = item.strip()
    return result


def start_kwargs(args: argparse.Namespace) -> dict:
    return {
        "phase": args.phase,
        "operation": args.operation,
        "time_class": args.time_class,
        "event_id": args.event_id,
        "attempt_id": args.attempt_id,
        "platform": args.platform,
        "delivery_key": args.delivery_key,
        "input_hashes": key_values(args.input_hash),
        "cache_status": args.cache_status,
        "concurrency_group": args.concurrency_group,
        "started_at": args.started_at,
    }


def main() -> int:
    args = parser().parse_args()
    try:
        if args.command == "init":
            result = create_timeline(args.timeline, args.run_id, args.project_root)
        elif args.command == "start":
            event = start_event(args.timeline, **start_kwargs(args))
            result = {"event": event, "summary": load_timeline(args.timeline)["summary"]}
        elif args.command == "finish":
            event = finish_event(
                args.timeline,
                event_id=args.event_id,
                status=args.status,
                output_paths=args.evidence,
                finished_at=args.finished_at,
                rule_ids=args.rule_id,
                failure_scope=args.failure_scope,
                message=args.message,
            )
            result = {"event": event, "summary": load_timeline(args.timeline)["summary"]}
        elif args.command == "record":
            event = record_event(
                args.timeline,
                **start_kwargs(args),
                finished_at=args.finished_at,
                status=args.status,
                output_paths=args.evidence,
                rule_ids=args.rule_id,
                failure_scope=args.failure_scope,
                message=args.message,
            )
            result = {"event": event, "summary": load_timeline(args.timeline)["summary"]}
        else:
            timeline = load_timeline(args.timeline)
            result = timeline["summary"]
            if args.output:
                write_json_atomic(args.output, result)
        print(json.dumps(result, ensure_ascii=False, indent=2))
        return 0
    except (OSError, json.JSONDecodeError, TimelineError) as exc:
        print(json.dumps({"ok": False, "error": str(exc)}, ensure_ascii=False, indent=2))
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
