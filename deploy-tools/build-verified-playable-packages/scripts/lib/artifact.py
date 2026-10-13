from __future__ import annotations

import hashlib
import html
import json
import posixpath
import re
import zipfile
from dataclasses import asdict, dataclass
from html.parser import HTMLParser
from pathlib import Path
from typing import Iterable
from urllib.parse import unquote, urlsplit

TEXT_EXTENSIONS = {
    ".html", ".htm", ".css", ".js", ".mjs", ".cjs", ".json",
    ".txt", ".xml", ".svg", ".md",
}
MAX_TEXT_ENTRY_BYTES = 24 * 1024 * 1024
MAX_COMBINED_TEXT_BYTES = 64 * 1024 * 1024


class ArtifactError(RuntimeError):
    pass


@dataclass(frozen=True)
class Entry:
    name: str
    size: int
    compressed_size: int
    is_dir: bool


@dataclass
class Artifact:
    path: str
    file_name: str
    kind: str
    size: int
    sha256: str
    entries: list[Entry]
    entry_texts: dict[str, str]
    main_html_path: str | None
    main_html_text: str
    combined_text: str
    uncompressed_size: int

    def to_report_dict(self) -> dict:
        return {
            "path": self.path,
            "fileName": self.file_name,
            "kind": self.kind,
            "size": self.size,
            "sha256": self.sha256,
            "entryCount": len(self.entries),
            "uncompressedSize": self.uncompressed_size,
            "mainHtmlPath": self.main_html_path,
            "mainHtmlBytes": len(self.main_html_text.encode("utf-8")),
            "entries": [asdict(entry) for entry in self.entries],
        }

    @property
    def entry_names(self) -> list[str]:
        return [entry.name for entry in self.entries]

    def entry_text(self, name: str) -> str | None:
        wanted = name.lower()
        for entry_name, text in self.entry_texts.items():
            if entry_name.lower() == wanted:
                return text
        return None


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def decode_text(data: bytes, label: str) -> str:
    if b"\x00" in data[:4096]:
        raise ArtifactError(f"{label} 看起来是二进制文件，不能作为文本入口")
    for encoding in ("utf-8-sig", "utf-8"):
        try:
            return data.decode(encoding)
        except UnicodeDecodeError:
            continue
    return data.decode("utf-8", errors="replace")


def normalize_zip_name(name: str) -> str:
    return name.replace("\\", "/")


def choose_main_html(names: Iterable[str], zip_stem: str) -> str | None:
    candidates = [name for name in names if name.lower().endswith((".html", ".htm"))]
    if not candidates:
        return None
    priorities = [
        lambda name: name.lower() == "index.html",
        lambda name: posixpath.basename(name).lower() == f"{zip_stem.lower()}.html",
        lambda name: posixpath.basename(name).lower() == "index.html",
    ]
    for predicate in priorities:
        for name in sorted(candidates, key=lambda value: (value.count("/"), value.lower())):
            if predicate(name):
                return name
    return sorted(candidates, key=lambda value: (value.count("/"), value.lower()))[0]


def load_html(path: Path) -> Artifact:
    data = path.read_bytes()
    text = decode_text(data, str(path))
    return Artifact(
        path=str(path.resolve()),
        file_name=path.name,
        kind="html",
        size=len(data),
        sha256=hashlib.sha256(data).hexdigest(),
        entries=[],
        entry_texts={path.name: text},
        main_html_path=path.name,
        main_html_text=text,
        combined_text=text,
        uncompressed_size=len(data),
    )


def load_zip(path: Path) -> Artifact:
    entries: list[Entry] = []
    texts: dict[str, str] = {}
    combined_parts: list[str] = []
    combined_size = 0
    try:
        archive = zipfile.ZipFile(path)
    except (zipfile.BadZipFile, OSError) as exc:
        raise ArtifactError(f"ZIP 无法读取: {exc}") from exc

    with archive:
        for info in archive.infolist():
            name = normalize_zip_name(info.filename)
            entries.append(Entry(
                name=name,
                size=int(info.file_size),
                compressed_size=int(info.compress_size),
                is_dir=info.is_dir(),
            ))
            if info.is_dir() or Path(name).suffix.lower() not in TEXT_EXTENSIONS:
                continue
            if info.file_size > MAX_TEXT_ENTRY_BYTES:
                continue
            try:
                data = archive.read(info)
            except (RuntimeError, zipfile.BadZipFile) as exc:
                raise ArtifactError(f"无法读取 ZIP 条目 {name}: {exc}") from exc
            text = decode_text(data, name)
            texts[name] = text
            encoded_size = len(text.encode("utf-8"))
            if combined_size + encoded_size <= MAX_COMBINED_TEXT_BYTES:
                combined_parts.append(text)
                combined_size += encoded_size

    main_path = choose_main_html(texts.keys(), path.stem)
    main_text = texts.get(main_path or "", "")
    return Artifact(
        path=str(path.resolve()),
        file_name=path.name,
        kind="zip",
        size=path.stat().st_size,
        sha256=sha256_file(path),
        entries=entries,
        entry_texts=texts,
        main_html_path=main_path,
        main_html_text=main_text,
        combined_text="\n".join(combined_parts),
        uncompressed_size=sum(entry.size for entry in entries if not entry.is_dir),
    )


def load_artifact(path_value: str) -> Artifact:
    path = Path(path_value).expanduser().resolve()
    if not path.is_file():
        raise ArtifactError(f"产物不存在: {path}")
    suffix = path.suffix.lower()
    if suffix in {".html", ".htm"}:
        return load_html(path)
    if suffix == ".zip":
        return load_zip(path)
    raise ArtifactError(f"不支持的最终产物类型: {suffix or '<none>'}")


RESOURCE_TAGS = {"script", "link", "img", "audio", "video", "source", "track", "iframe", "image"}
RESOURCE_ATTRS = {"src", "href", "xlink:href"}


def find_css_refs(text: str) -> list[str]:
    refs: list[str] = []
    css_pattern = re.compile(r"url\(\s*(['\"]?)(.*?)\1\s*\)", re.IGNORECASE)
    import_pattern = re.compile(
        r"@import\s+(?:url\()?\s*(['\"]?)([^'\"\s)]+)\1",
        re.IGNORECASE,
    )
    for match in css_pattern.finditer(text or ""):
        refs.append(html.unescape(match.group(2).strip()))
    for match in import_pattern.finditer(text or ""):
        refs.append(html.unescape(match.group(2).strip()))
    return refs


class ResourceReferenceParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.refs: list[str] = []
        self.style_depth = 0

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        lowered_tag = tag.lower()
        if lowered_tag == "style":
            self.style_depth += 1
        for name, value in attrs:
            lowered_name = name.lower()
            if value is not None and lowered_tag in RESOURCE_TAGS and lowered_name in RESOURCE_ATTRS:
                self.refs.append(html.unescape(value.strip()))
            if value is not None and lowered_name == "style":
                self.refs.extend(find_css_refs(value))

    def handle_startendtag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        self.handle_starttag(tag, attrs)
        if tag.lower() == "style":
            self.style_depth = max(0, self.style_depth - 1)

    def handle_endtag(self, tag: str) -> None:
        if tag.lower() == "style":
            self.style_depth = max(0, self.style_depth - 1)

    def handle_data(self, data: str) -> None:
        if self.style_depth:
            self.refs.extend(find_css_refs(data))


def find_attr_refs(text: str) -> list[str]:
    parser = ResourceReferenceParser()
    parser.feed(text or "")
    parser.close()
    return parser.refs


def is_inline_ref(value: str) -> bool:
    lowered = value.strip().lower()
    return (
        not lowered
        or lowered.startswith(("data:", "blob:", "#", "javascript:", "mailto:", "tel:"))
    )


def strip_ref(value: str) -> str:
    parsed = urlsplit(value)
    path = unquote(parsed.path)
    return path


def packaged_reference_target(main_path: str, value: str) -> str | None:
    if is_inline_ref(value) or re.match(r"^https?://", value, re.IGNORECASE):
        return None
    path = strip_ref(value)
    if not path:
        return None
    if path.startswith("/"):
        return posixpath.normpath(path.lstrip("/"))
    base = posixpath.dirname(main_path)
    return posixpath.normpath(posixpath.join(base, path))


def missing_packaged_refs(artifact: Artifact, allowed: Iterable[str]) -> list[str]:
    if artifact.kind != "zip" or not artifact.main_html_path:
        return []
    allowed_set = {value.lower() for value in allowed}
    names = {entry.name.lower() for entry in artifact.entries if not entry.is_dir}
    missing: list[str] = []
    for ref in find_attr_refs(artifact.main_html_text):
        if ref.lower() in allowed_set or is_inline_ref(ref):
            continue
        if re.match(r"^https?://", ref, re.IGNORECASE):
            continue
        target = packaged_reference_target(artifact.main_html_path, ref)
        if target and target.lower() not in names and ref not in missing:
            missing.append(ref)
    return missing


def external_resource_urls(text: str) -> list[str]:
    found: list[str] = []
    patterns = [
        re.compile(r"(?:src|href|xlink:href)\s*=\s*['\"](https?://[^'\"]+)['\"]", re.IGNORECASE),
        re.compile(r"url\(\s*['\"]?(https?://[^'\")]+)", re.IGNORECASE),
        re.compile(r"@import\s+(?:url\()?['\"]?(https?://[^'\"\s)]+)", re.IGNORECASE),
        re.compile(r"fetch\s*\(\s*['\"](https?://[^'\"]+)['\"]", re.IGNORECASE),
        re.compile(r"new\s+WebSocket\s*\(\s*['\"](https?://[^'\"]+)['\"]", re.IGNORECASE),
        re.compile(r"navigator\.sendBeacon\s*\(\s*['\"](https?://[^'\"]+)['\"]", re.IGNORECASE),
    ]
    for pattern in patterns:
        for match in pattern.finditer(text or ""):
            value = html.unescape(match.group(1))
            if value not in found:
                found.append(value)
    return found


def checker_visible_http_urls(text: str) -> list[str]:
    """Return every raw HTTP(S) URL that broad static checkers can display."""
    found: list[str] = []
    pattern = re.compile(r"https?://[^\s'\"<>`\\]+", re.IGNORECASE)
    for match in pattern.finditer(text or ""):
        value = html.unescape(match.group(0))
        if value not in found:
            found.append(value)
    return found


def unresolved_self_contained_refs(text: str, allowed: Iterable[str]) -> list[str]:
    allowed_set = {value.lower() for value in allowed}
    unresolved: list[str] = []
    # HTMLParser 负责真实标签和样式引用，external_resource_urls 补充脚本里
    # 动态赋值、fetch、WebSocket 等明确的在线请求。两者结合可避开脚本
    # 模板字符串中的普通 src="变量" 误报，同时仍拦截真实在线资源。
    refs = find_attr_refs(text) + external_resource_urls(text)
    for ref in refs:
        if is_inline_ref(ref) or ref.lower() in allowed_set:
            continue
        if ref not in unresolved:
            unresolved.append(ref)
    return unresolved


def read_json_entry(artifact: Artifact, name: str) -> dict:
    text = artifact.entry_text(name)
    if text is None:
        raise ArtifactError(f"ZIP 中缺少 {name}")
    try:
        value = json.loads(text)
    except json.JSONDecodeError as exc:
        raise ArtifactError(f"{name} 不是合法 JSON: {exc}") from exc
    if not isinstance(value, dict):
        raise ArtifactError(f"{name} 顶层必须是对象")
    return value
