from __future__ import annotations

import hashlib
import json
import os
import subprocess
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable


EXCLUDED_DIR_NAMES = {
    ".git",
    ".hg",
    ".svn",
    ".idea",
    ".vscode",
    "node_modules",
    "__pycache__",
}

BUCKET_EXTENSIONS = {
    "textures": {
        ".png", ".jpg", ".jpeg", ".webp", ".avif", ".gif", ".bmp",
        ".tga", ".ktx", ".ktx2", ".dds", ".svg",
    },
    "models": {".gltf", ".glb", ".fbx", ".obj", ".dae", ".bin", ".mesh"},
    "audio": {".mp3", ".wav", ".ogg", ".m4a", ".aac", ".flac", ".opus"},
    "atlas": {".atlas"},
    "video": {".mp4", ".webm", ".mov", ".m4v"},
    "fonts": {".woff", ".woff2", ".ttf", ".otf", ".eot"},
    "config": {".json", ".csv", ".yaml", ".yml", ".xml"},
    "code": {".js", ".mjs", ".cjs", ".ts", ".tsx", ".jsx", ".css", ".html"},
}


def utc_now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def load_json(path: Path) -> Any:
    with path.open("r", encoding="utf-8") as handle:
        return json.load(handle)


def canonical_json_bytes(data: Any) -> bytes:
    return json.dumps(
        data,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    ).encode("utf-8")


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def sha256_object(data: Any) -> str:
    return sha256_bytes(canonical_json_bytes(data))


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def write_json_atomic(path: Path, data: Any) -> None:
    path = path.expanduser().resolve()
    path.parent.mkdir(parents=True, exist_ok=True)
    descriptor, temporary_name = tempfile.mkstemp(
        prefix=f".{path.name}.", suffix=".tmp", dir=str(path.parent)
    )
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8") as handle:
            json.dump(data, handle, ensure_ascii=False, indent=2, sort_keys=True)
            handle.write("\n")
        os.replace(temporary_name, path)
    except Exception:
        try:
            os.unlink(temporary_name)
        except FileNotFoundError:
            pass
        raise


def is_within(root: Path, candidate: Path) -> bool:
    try:
        return os.path.commonpath([str(root.resolve()), str(candidate.resolve())]) == str(root.resolve())
    except ValueError:
        return False


def git_worktree_root(project_root: Path) -> Path | None:
    try:
        completed = subprocess.run(
            ["git", "-C", str(project_root), "rev-parse", "--show-toplevel"],
            capture_output=True,
            text=True,
            timeout=5,
            check=False,
        )
    except (OSError, subprocess.TimeoutExpired):
        return None
    if completed.returncode != 0 or not completed.stdout.strip():
        return None
    root = Path(completed.stdout.strip()).expanduser().resolve()
    if not is_within(root, project_root):
        return None
    return root


def resolve_project_path(project_root: Path, value: str, *, must_exist: bool = False) -> Path:
    if not isinstance(value, str) or not value.strip():
        raise ValueError("路径必须是非空字符串")
    relative = Path(value)
    if relative.is_absolute() or ".." in relative.parts:
        raise ValueError(f"路径必须位于项目内：{value}")
    resolved = (project_root / relative).resolve()
    if not is_within(project_root, resolved):
        raise ValueError(f"路径越过项目根目录：{value}")
    if must_exist and not resolved.exists():
        raise ValueError(f"路径不存在：{value}")
    return resolved


def resolve_boundary_path(
    project_root: Path,
    value: str,
    boundaries: dict[str, Any],
    boundary_name: str,
    *,
    must_exist: bool = False,
) -> Path:
    if not isinstance(value, str) or not value.strip():
        raise ValueError("路径必须是非空字符串")
    raw = Path(value).expanduser()
    if raw.is_absolute():
        resolved = raw.resolve()
    else:
        base = project_root.resolve()
        if boundaries.get("runRootBase") == "product-root":
            product_root = boundaries.get("productRoot")
            if not isinstance(product_root, str) or not product_root:
                raise ValueError("Adapter 未提供已验证的产品仓根")
            base = Path(product_root).expanduser().resolve()
        resolved = resolve_project_path(base, value, must_exist=must_exist)
    roots_value = boundaries.get(boundary_name)
    roots = roots_value if isinstance(roots_value, list) else [roots_value]
    valid_roots = [Path(item).expanduser().resolve() for item in roots if isinstance(item, str) and item]
    if not valid_roots or not any(is_within(root, resolved) for root in valid_roots):
        raise ValueError(f"路径不在 Adapter {boundary_name}：{resolved}")
    if must_exist and not resolved.exists():
        raise ValueError(f"路径不存在：{value}")
    return resolved


def iter_files(root: Path, excluded_paths: Iterable[Path] = ()) -> tuple[list[Path], list[str]]:
    excluded = {item.resolve() for item in excluded_paths}
    files: list[Path] = []
    warnings: list[str] = []
    if not root.exists():
        return files, [f"MISSING_ROOT:{root}"]
    if root.is_symlink():
        return files, [f"SYMLINK_ROOT_SKIPPED:{root}"]
    if root.is_file():
        return ([root] if root.resolve() not in excluded else []), warnings
    for current_root, directory_names, file_names in os.walk(root, followlinks=False):
        current = Path(current_root)
        kept: list[str] = []
        for directory_name in sorted(directory_names):
            candidate = current / directory_name
            if directory_name in EXCLUDED_DIR_NAMES or candidate.resolve() in excluded:
                continue
            if candidate.is_symlink():
                warnings.append(f"SYMLINK_DIRECTORY_SKIPPED:{candidate}")
                continue
            kept.append(directory_name)
        directory_names[:] = kept
        for file_name in sorted(file_names):
            candidate = current / file_name
            if candidate.resolve() in excluded:
                continue
            if candidate.is_symlink():
                warnings.append(f"SYMLINK_FILE_SKIPPED:{candidate}")
                continue
            if candidate.is_file():
                files.append(candidate)
    return files, warnings


def sha256_tree(path: Path) -> str:
    path = path.resolve()
    if path.is_file():
        return sha256_file(path)
    digest = hashlib.sha256()
    files, _ = iter_files(path)
    for file_path in sorted(files, key=lambda item: item.relative_to(path).as_posix()):
        relative = file_path.relative_to(path).as_posix().encode("utf-8")
        digest.update(len(relative).to_bytes(8, "big"))
        digest.update(relative)
        digest.update(file_path.stat().st_size.to_bytes(8, "big"))
        digest.update(bytes.fromhex(sha256_file(file_path)))
    return digest.hexdigest()


def sha256_paths(paths: Iterable[Path], *, base: Path | None = None) -> str:
    """对多个文件/目录生成与顺序无关、可复现的组合哈希。"""
    resolved = sorted({item.expanduser().resolve() for item in paths}, key=str)
    digest = hashlib.sha256()
    for root in resolved:
        label = (
            root.relative_to(base.expanduser().resolve()).as_posix()
            if base is not None and is_within(base, root)
            else str(root)
        ).encode("utf-8")
        digest.update(len(label).to_bytes(8, "big"))
        digest.update(label)
        if not root.exists():
            digest.update(b"MISSING")
            continue
        digest.update(b"FILE" if root.is_file() else b"DIRECTORY")
        digest.update(bytes.fromhex(sha256_tree(root)))
    return digest.hexdigest()


def snapshot_files(paths: Iterable[Path], *, project_root: Path) -> list[dict[str, Any]]:
    """记录精确文件的路径、bytes 与 SHA-256，供不可变断言使用。"""
    result: list[dict[str, Any]] = []
    for path in sorted({item.expanduser().resolve() for item in paths}, key=str):
        if not path.is_file():
            raise ValueError(f"快照文件不存在：{path}")
        result.append({
            "path": relative_to_project(path, project_root),
            "bytes": path.stat().st_size,
            "sha256": sha256_file(path),
        })
    return result


def path_bytes(path: Path) -> int:
    if path.is_file():
        return path.stat().st_size
    files, _ = iter_files(path)
    return sum(item.stat().st_size for item in files)


def classify_bucket(path: Path) -> str:
    suffix = path.suffix.lower()
    for bucket, extensions in BUCKET_EXTENSIONS.items():
        if suffix in extensions:
            return bucket
    return "other"


def relative_to_project(path: Path, project_root: Path) -> str:
    try:
        return path.resolve().relative_to(project_root.resolve()).as_posix()
    except ValueError:
        return str(path.resolve())


def file_ref(path: Path) -> dict[str, Any]:
    resolved = path.expanduser().resolve()
    if not resolved.is_file():
        raise ValueError(f"证据文件不存在：{resolved}")
    return {
        "path": str(resolved),
        "bytes": resolved.stat().st_size,
        "sha256": sha256_file(resolved),
    }
