#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime
from pathlib import Path

LIB_ROOT = Path(__file__).resolve().parent / "lib"
sys.path.insert(0, str(LIB_ROOT))

from artifact import ArtifactError, load_artifact
from rules import RulesetError, evaluate_rules, load_platform_rules


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="使用 Skill 内置规则检查 playable 最终产物")
    parser.add_argument("--platform", required=True)
    parser.add_argument("--artifact", required=True)
    parser.add_argument(
        "--target-os",
        choices=["android", "ios", "both", "unspecified"],
        default="unspecified",
        help="实际投放目标端；未声明时只提示确认商店地址，不产生 warning",
    )
    parser.add_argument("--json-out")
    parser.add_argument("--md-out")
    parser.add_argument("--check-batch-id", help="本轮静态、运行时和载荷检查共用的唯一批次 ID")
    return parser.parse_args()


def safe_cell(value: object) -> str:
    return str(value).replace("|", "\\|").replace("\n", "<br>")


def render_markdown(report: dict) -> str:
    artifact = report["artifact"]
    summary = report["summary"]
    lines = [
        "# Playable 最终产物静态检查",
        "",
        f"- 平台：{report['platform']}",
        f"- 投放目标端：{report['deliveryContext']['targetOs']}",
        f"- 文件：{artifact['path']}",
        f"- SHA-256：{artifact['sha256']}",
        f"- 规则集：{report['ruleset']['rulesetVersion']} / {report['ruleset']['rulesetSha256']}",
        f"- 结论：{report['conclusion']}",
        f"- 统计：pass={summary['pass']} / warning={summary['warning']} / manual={summary['manual']} / fail={summary['fail']}",
        "",
        "| 规则 | 严重级别 | 状态 | 结果 | 修复方向 |",
        "|---|---|---|---|---|",
    ]
    for check in report["checks"]:
        lines.append(
            "| {id} {title} | {severity} | {status} | {summary} | {repair} |".format(
                id=safe_cell(check["id"]),
                title=safe_cell(check["title"]),
                severity=safe_cell(check["severity"]),
                status=safe_cell(check["status"]),
                summary=safe_cell(check["summary"]),
                repair=safe_cell(check["repairHint"]),
            )
        )
        for evidence in check.get("evidence", []):
            lines.append(f"| ↳ 证据 |  |  | {safe_cell(evidence)} |  |")
    manual = [item for item in report["checks"] if item["status"] == "manual"]
    if manual:
        lines.extend(["", "## 人工门禁", ""])
        for item in manual:
            lines.append(f"- {item['id']}：{item.get('manualGate', item['summary'])}")
    lines.append("")
    return "\n".join(lines)


def write_text(path_value: str | None, text: str) -> None:
    if not path_value:
        return
    path = Path(path_value).expanduser().resolve()
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")


def main() -> int:
    args = parse_args()
    delivery_context = {"targetOs": args.target_os}
    checking = {
        "schemaVersion": "playable-static-report-v1",
        "generatedAt": datetime.now().astimezone().isoformat(timespec="seconds"),
        "status": "CHECKING",
        "platform": args.platform,
        "checkBatchId": args.check_batch_id,
        "deliveryContext": delivery_context,
        "artifact": {"path": str(Path(args.artifact).expanduser().resolve())},
        "checks": [],
        "summary": {"pass": 0, "warning": 0, "manual": 0, "fail": 0},
        "conclusion": "IN_PROGRESS",
    }
    write_text(args.json_out, json.dumps(checking, ensure_ascii=False, indent=2) + "\n")
    try:
        artifact = load_artifact(args.artifact)
        verification, rules = load_platform_rules(args.platform)
        checks, summary, conclusion = evaluate_rules(
            artifact,
            rules,
            context={**delivery_context, "platform": args.platform},
        )
    except (ArtifactError, RulesetError, OSError) as exc:
        error = {
            "schemaVersion": "playable-static-report-v1",
            "generatedAt": datetime.now().astimezone().isoformat(timespec="seconds"),
            "platform": args.platform,
            "checkBatchId": args.check_batch_id,
            "deliveryContext": delivery_context,
            "conclusion": "FAIL",
            "error": str(exc),
        }
        text = json.dumps(error, ensure_ascii=False, indent=2) + "\n"
        write_text(args.json_out, text)
        print(text, end="")
        return 1

    report = {
        "schemaVersion": "playable-static-report-v1",
        "generatedAt": datetime.now().astimezone().isoformat(timespec="seconds"),
        "platform": args.platform,
        "checkBatchId": args.check_batch_id,
        "deliveryContext": delivery_context,
        "artifact": artifact.to_report_dict(),
        "ruleset": {
            "schemaVersion": verification["schemaVersion"],
            "rulesetVersion": verification["rulesetVersion"],
            "rulesetSha256": verification["rulesetSha256"],
            "sourceProvenance": verification["sourceProvenance"],
        },
        "checks": checks,
        "summary": summary,
        "conclusion": conclusion,
    }
    json_text = json.dumps(report, ensure_ascii=False, indent=2) + "\n"
    write_text(args.json_out, json_text)
    write_text(args.md_out, render_markdown(report))
    print(json_text, end="")
    if conclusion == "FAIL":
        return 1
    if conclusion == "REVIEW":
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
