#!/usr/bin/env python3
from __future__ import annotations

import argparse
import hashlib
import json
import shutil
import subprocess
import sys
from datetime import datetime
from pathlib import Path

REQUIRED_FILES = [
    "checker_rules.js",
    "checker_static_validators.js",
    "checker_artifact.js",
    "hook_normal.js",
    "hook_nowebgl.js",
]
SKILL_ROOT = Path(__file__).resolve().parents[2]
RULES_ROOT = SKILL_ROOT / "rules"


class ImportErrorForReview(RuntimeError):
    pass


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="维护期导出 playable_check 上游快照；不直接替换 Skill rules"
    )
    parser.add_argument("--source-root", required=True)
    parser.add_argument("--output", required=True)
    return parser.parse_args()


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def git_value(source: Path, *args: str) -> str | None:
    try:
        completed = subprocess.run(
            ["git", "-C", str(source), *args],
            capture_output=True,
            text=True,
            timeout=10,
            check=False,
        )
    except (OSError, subprocess.TimeoutExpired):
        return None
    if completed.returncode != 0:
        return None
    return completed.stdout.strip()


def export_rule_index(checker_rules: Path) -> dict:
    node = shutil.which("node")
    if not node:
        raise ImportErrorForReview("维护导出需要 node 读取 checker_rules.js")
    program = (
        "global.window={};"
        "require(process.argv[1]);"
        "process.stdout.write(JSON.stringify(window.CHECKER_RULES));"
    )
    completed = subprocess.run(
        [node, "-e", program, str(checker_rules)],
        capture_output=True,
        text=True,
        timeout=20,
        check=False,
    )
    if completed.returncode != 0:
        raise ImportErrorForReview(
            "checker_rules.js 导出失败: " + completed.stderr[-2000:]
        )
    try:
        value = json.loads(completed.stdout)
    except json.JSONDecodeError as exc:
        raise ImportErrorForReview(f"checker rule index 不是合法 JSON: {exc}") from exc
    if not isinstance(value, dict):
        raise ImportErrorForReview("checker rule index 顶层不是对象")
    return value


def main() -> int:
    args = parse_args()
    source = Path(args.source_root).expanduser().resolve()
    output = Path(args.output).expanduser().resolve()
    if not source.is_dir():
        print(json.dumps({"ok": False, "error": f"上游目录不存在: {source}"}, ensure_ascii=False, indent=2))
        return 1
    try:
        output.relative_to(RULES_ROOT.resolve())
    except ValueError:
        pass
    else:
        print(json.dumps({
            "ok": False,
            "error": "维护快照不能直接写入 rules/；请输出到独立 review 目录并人工审阅",
        }, ensure_ascii=False, indent=2))
        return 1

    try:
        missing = [name for name in REQUIRED_FILES if not (source / name).is_file()]
        if missing:
            raise ImportErrorForReview("上游缺少文件: " + ", ".join(missing))
        if output.exists() and any(output.iterdir()):
            raise ImportErrorForReview(f"输出目录必须为空: {output}")
        output.mkdir(parents=True, exist_ok=True)
        snapshot = output / "upstream"
        snapshot.mkdir()

        files = []
        for name in REQUIRED_FILES:
            source_file = source / name
            target = snapshot / name
            shutil.copy2(source_file, target)
            files.append({
                "name": name,
                "sha256": sha256(source_file),
                "size": source_file.stat().st_size,
            })

        rules_export = export_rule_index(source / "checker_rules.js")
        (output / "checker-rules-export.json").write_text(
            json.dumps(rules_export, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
        status = git_value(source, "status", "--short")
        provenance = {
            "schemaVersion": "playable-check-upstream-review-v1",
            "generatedAt": datetime.now().astimezone().isoformat(timespec="seconds"),
            "sourceRoot": str(source),
            "gitCommit": git_value(source, "rev-parse", "HEAD"),
            "gitStatus": status.splitlines() if status else [],
            "files": files,
            "rulesExportSha256": sha256(output / "checker-rules-export.json"),
            "nextSteps": [
                "对比当前 rules/ 与 checker-rules-export.json。",
                "把确认差异转换为稳定规则 ID 和 Skill check schema。",
                "补齐失败夹具与历史包回归。",
                "人工审阅后升级 rulesetVersion；不要直接复制覆盖 rules/。",
            ],
        }
        (output / "provenance.json").write_text(
            json.dumps(provenance, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
    except (ImportErrorForReview, OSError, subprocess.TimeoutExpired) as exc:
        print(json.dumps({"ok": False, "error": str(exc)}, ensure_ascii=False, indent=2))
        return 1

    print(json.dumps({
        "ok": True,
        "output": str(output),
        "gitCommit": provenance["gitCommit"],
        "files": files,
    }, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

