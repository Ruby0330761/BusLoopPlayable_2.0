#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import os
import stat
import subprocess
import sys
from pathlib import Path
from typing import Any


RELATIVE_CONFIG = Path(".config/build-verified-playable-packages/tinify.json")
TEMPLATE = '{"apiKey":""}'


def config_path(*, home: Path | None = None) -> Path:
    base = (home or Path.home()).expanduser().resolve()
    return base / RELATIVE_CONFIG


def _secure_file(path: Path) -> os.stat_result:
    try:
        details = path.lstat()
    except FileNotFoundError as exc:
        raise ValueError("尚未配置 Tinify；请先确认创建并打开用户配置文件") from exc
    if stat.S_ISLNK(details.st_mode) or not stat.S_ISREG(details.st_mode):
        raise ValueError("Tinify 配置必须是普通文件，不能是目录、链接或其他文件类型")
    if hasattr(os, "getuid") and details.st_uid != os.getuid():
        raise ValueError("Tinify 配置文件所有者不是当前用户")
    if stat.S_IMODE(details.st_mode) & 0o077:
        raise ValueError("Tinify 配置文件权限不能宽于 0600；请收紧为仅当前用户可读写")
    return details


def load_api_key(*, path: Path | None = None, environment: dict[str, str] | None = None) -> tuple[str, dict[str, Any]]:
    env = os.environ if environment is None else environment
    injected = env.get("TINIFY_API_KEY")
    if isinstance(injected, str) and injected.strip():
        return injected.strip(), {
            "keySource": "process-secret-variable", "keyAvailable": True,
            "secretCopiedToEvidence": False,
        }
    resolved = (path or config_path()).expanduser().resolve()
    _secure_file(resolved)
    try:
        value = json.loads(resolved.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError) as exc:
        raise ValueError("Tinify 配置 JSON 格式无效；请打开配置文件修正") from exc
    if not isinstance(value, dict):
        raise ValueError("Tinify 配置 JSON 根必须是对象")
    key = value.get("apiKey")
    if not isinstance(key, str) or not key.strip():
        raise ValueError("Tinify 配置中的 apiKey 不能为空")
    return key.strip(), {
        "keySource": "user-config-file", "keyAvailable": True,
        "secretCopiedToEvidence": False,
    }


def validate_config(*, path: Path | None = None, environment: dict[str, str] | None = None) -> dict[str, Any]:
    _key, evidence = load_api_key(path=path, environment=environment)
    return evidence


def create_config(*, home: Path | None = None) -> Path:
    path = config_path(home=home)
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    os.chmod(path.parent, 0o700)
    if path.exists():
        _secure_file(path)
        return path
    descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    try:
        os.write(descriptor, TEMPLATE.encode("utf-8"))
    finally:
        os.close(descriptor)
    os.chmod(path, 0o600)
    return path


def open_config(*, path: Path | None = None) -> Path:
    resolved = (path or config_path()).expanduser().resolve()
    if not resolved.exists():
        raise ValueError("Tinify 配置文件不存在；请先确认创建配置文件")
    _secure_file(resolved)
    if sys.platform == "darwin":
        command = ["open", "-t", str(resolved)]
    elif os.name == "nt":
        command = ["cmd", "/c", "start", "", str(resolved)]
    else:
        command = ["xdg-open", str(resolved)]
    completed = subprocess.run(command, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=False)
    if completed.returncode != 0:
        raise ValueError("无法使用系统默认文本编辑器打开 Tinify 配置文件")
    return resolved


def main() -> int:
    parser = argparse.ArgumentParser(description="安全创建、打开或校验当前用户的 Tinify 配置")
    parser.add_argument("action", choices=("create", "open", "validate"))
    parser.add_argument("--config", type=Path, help=argparse.SUPPRESS)
    args = parser.parse_args()
    try:
        if args.action == "create":
            path = create_config()
            result = {"ok": True, "created": True, "nextStep": "请在已创建的配置文件中填写 apiKey，然后运行校验"}
        elif args.action == "open":
            path = open_config(path=args.config)
            result = {"ok": True, "opened": True, "nextStep": "填写并关闭编辑器后运行校验"}
        else:
            path = (args.config or config_path()).expanduser().resolve()
            result = {"ok": True, **validate_config(path=path)}
        result["configPath"] = str(path)
    except (OSError, ValueError) as exc:
        result = {"ok": False, "error": str(exc)}
        print(json.dumps(result, ensure_ascii=False, indent=2))
        return 1
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
