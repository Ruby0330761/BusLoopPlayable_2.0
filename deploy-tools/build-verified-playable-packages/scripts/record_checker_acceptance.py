#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

SCRIPT_ROOT = Path(__file__).resolve().parent
LIB_ROOT = SCRIPT_ROOT / "lib"
sys.path.insert(0, str(LIB_ROOT))
sys.path.insert(0, str(SCRIPT_ROOT))

from checker_acceptance import (
    PASSING_SUMMARIES,
    CheckerAcceptanceError,
    build_acceptance,
    load_and_validate,
    render_markdown,
    validate_acceptance,
)
from record_candidate import CandidateError, verify_manifest_file
from resource_common import load_json, write_json_atomic
from rules import RulesetError


def parser() -> argparse.ArgumentParser:
    root = argparse.ArgumentParser(description="记录并验签可选 Playable Ad Checker 逐平台补充验证结果")
    sub = root.add_subparsers(dest="command", required=True)
    create = sub.add_parser("create")
    create.add_argument("--manifest", action="append", required=True)
    create.add_argument("--observations", required=True, type=Path)
    create.add_argument("--json-out", required=True, type=Path)
    create.add_argument("--md-out", required=True, type=Path)
    verify = sub.add_parser("verify")
    verify.add_argument("--acceptance", required=True, type=Path)
    return root


def create(args: argparse.Namespace) -> dict:
    manifests = [verify_manifest_file(value) for value in args.manifest]
    observations = load_json(args.observations.expanduser().resolve())
    if not isinstance(observations, dict):
        raise CheckerAcceptanceError("Checker 观察记录必须是 JSON 对象")
    acceptance = build_acceptance(observations, manifests)
    validate_acceptance(acceptance)
    write_json_atomic(args.json_out, acceptance)
    markdown = render_markdown(acceptance)
    md_path = args.md_out.expanduser().resolve()
    md_path.parent.mkdir(parents=True, exist_ok=True)
    md_path.write_text(markdown, encoding="utf-8")
    load_and_validate(args.json_out)
    return acceptance


def main() -> int:
    args = parser().parse_args()
    try:
        acceptance = create(args) if args.command == "create" else load_and_validate(args.acceptance)
    except (CheckerAcceptanceError, CandidateError, RulesetError, OSError, json.JSONDecodeError) as exc:
        print(json.dumps({"ok": False, "error": str(exc)}, ensure_ascii=False, indent=2))
        return 1
    conclusion = (acceptance.get("summary") or {}).get("conclusion")
    print(json.dumps({
        "ok": conclusion in PASSING_SUMMARIES,
        "conclusion": conclusion,
        "userConclusion": acceptance.get("userConclusion"),
        "json": str(args.json_out.resolve()) if args.command == "create" else str(args.acceptance.resolve()),
        "markdown": str(args.md_out.resolve()) if args.command == "create" else None,
    }, ensure_ascii=False, indent=2))
    return 0 if conclusion in PASSING_SUMMARIES else 2


if __name__ == "__main__":
    raise SystemExit(main())
