#!/usr/bin/env python3
from __future__ import annotations

import argparse
import hashlib
import json
import os
import tempfile
import zipfile
from datetime import datetime, timezone
from pathlib import Path


FILE_MODE = 0o100644
FIXED_TIMESTAMP = (1980, 1, 1, 0, 0, 0)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="生成成员顺序、时间、权限和压缩参数固定的 ZIP，并执行双写哈希校验")
    parser.add_argument("--root", required=True, type=Path, help="ZIP 成员所在根目录")
    parser.add_argument("--output", required=True, type=Path, help="最终 ZIP 路径，必须位于 root 之外")
    parser.add_argument("--entry", action="append", required=True, help="相对 root 的文件或目录；可重复传入")
    parser.add_argument("--compression-level", type=int, default=9, choices=range(0, 10))
    parser.add_argument("--timestamp", help="ZIP 成员时间，ISO 8601 格式；未提供时使用当前 UTC 时间")
    return parser.parse_args()


def parse_timestamp(value: str | None) -> tuple[tuple[int, int, int, int, int, int], str]:
    if not value:
        return FIXED_TIMESTAMP, "1980-01-01T00:00:00Z"
    parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    parsed = parsed.astimezone(timezone.utc).replace(
        microsecond=0,
        second=parsed.second - parsed.second % 2,
    )
    if parsed.year < 1980 or parsed.year > 2107:
        raise ValueError("timestamp 必须落在 ZIP 支持的 1980-2107 年范围内")
    timestamp = (parsed.year, parsed.month, parsed.day, parsed.hour, parsed.minute, parsed.second)
    return timestamp, parsed.isoformat().replace("+00:00", "Z")


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def collect_files(root: Path, entries: list[str]) -> list[tuple[Path, str]]:
    selected: dict[str, Path] = {}
    for value in entries:
        raw = Path(value)
        if raw.is_absolute() or ".." in raw.parts:
            raise ValueError(f"entry 必须是 root 内相对路径：{value}")
        source = (root / raw).resolve()
        try:
            source.relative_to(root)
        except ValueError as exc:
            raise ValueError(f"entry 越出 root：{value}") from exc
        if not source.exists():
            raise ValueError(f"entry 不存在：{value}")
        candidates = [source] if source.is_file() else [item for item in source.rglob("*") if item.is_file()]
        for file_path in candidates:
            if file_path.is_symlink():
                raise ValueError(f"ZIP 不接受符号链接：{file_path}")
            archive_name = file_path.relative_to(root).as_posix()
            selected[archive_name] = file_path
    if not selected:
        raise ValueError("ZIP 没有文件成员")
    return [(selected[name], name) for name in sorted(selected)]


def write_zip(path: Path, files: list[tuple[Path, str]], compression_level: int, timestamp: tuple[int, int, int, int, int, int]) -> None:
    with zipfile.ZipFile(
        path,
        "w",
        compression=zipfile.ZIP_DEFLATED,
        compresslevel=compression_level,
        strict_timestamps=True,
    ) as archive:
        for source, archive_name in files:
            info = zipfile.ZipInfo(archive_name, timestamp)
            info.create_system = 3
            info.external_attr = FILE_MODE << 16
            info.compress_type = zipfile.ZIP_DEFLATED
            info.flag_bits = 0
            archive.writestr(info, source.read_bytes(), compress_type=zipfile.ZIP_DEFLATED, compresslevel=compression_level)


def main() -> int:
    args = parse_args()
    try:
        root = args.root.expanduser().resolve()
        output = args.output.expanduser().resolve()
        timestamp, timestamp_label = parse_timestamp(args.timestamp)
        if not root.is_dir():
            raise ValueError(f"root 不存在：{root}")
        try:
            output.relative_to(root)
        except ValueError:
            pass
        else:
            raise ValueError("output 必须位于 root 之外，避免把 ZIP 自身打入包内")
        output.parent.mkdir(parents=True, exist_ok=True)
        files = collect_files(root, args.entry)
        temporary_paths: list[Path] = []
        try:
            for _ in range(2):
                descriptor, temporary = tempfile.mkstemp(prefix=f".{output.name}.", suffix=".zip", dir=output.parent)
                os.close(descriptor)
                temporary_path = Path(temporary)
                temporary_paths.append(temporary_path)
                write_zip(temporary_path, files, args.compression_level, timestamp)
            hashes = [sha256_file(path) for path in temporary_paths]
            if hashes[0] != hashes[1]:
                raise ValueError("DETERMINISTIC_ZIP_MISMATCH：相同输入连续打包哈希不一致")
            os.replace(temporary_paths[1], output)
            temporary_paths.pop()
        finally:
            for path in temporary_paths:
                path.unlink(missing_ok=True)
        result = {
            "ok": True,
            "schemaVersion": "playable-deterministic-zip-result-v1",
            "output": str(output),
            "bytes": output.stat().st_size,
            "sha256": sha256_file(output),
            "entryCount": len(files),
            "entries": [name for _, name in files],
            "timestamp": timestamp_label,
            "fileMode": "0644",
            "compression": "deflate",
            "compressionLevel": args.compression_level,
            "doubleWriteVerified": True,
        }
        print(json.dumps(result, ensure_ascii=False, indent=2))
        return 0
    except (OSError, ValueError, zipfile.BadZipFile) as exc:
        print(json.dumps({"ok": False, "error": str(exc)}, ensure_ascii=False, indent=2))
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
