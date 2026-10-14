#!/usr/bin/env python3
"""Batch-repair legacy BusLoop playable artifacts in place.

Fixes (matching what the exporter/scene-view now produce):

1) FBX internal texture references (all platforms): old bundles derive the FBX
   resource path as `url.slice(0, url.lastIndexOf('/') + 1)`, which on packaged
   `data:...;base64,<gzip>` model URLs produces `data:...base64,<gzip>/Car_P2.png`
   — an invalid URL that Chrome logs as net::ERR_INVALID_URL (Mintegral "代码报错").
   Fix: route the fallback through a "playable-fbx-internal:" scheme and install a
   LoadingManager URL modifier that rewrites those requests to an embedded 1x1 PNG.

2) Mintegral packages only: inline style.css into the main HTML and drop the
   separate file (Mindworks "素材依赖代码的存储要求" / outer_chain).

Usage:
  python3 batch-fix.py --list <paths.txt> --backup-root <dir> [--dry-run]
"""
from __future__ import annotations

import argparse
import io
import json
import os
import re
import shutil
import sys
import time
import zipfile

PLACEHOLDER = (
    "data:image/png;base64,"
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII="
)
FIX_MARKER = "playable-fbx-internal"

MANAGER_RE = re.compile(r"(loadingManager=new [A-Za-z0-9_$.]+),")
RESOURCE_RE = re.compile(
    r',([A-Za-z0-9_$]+)(\?\?|\|\|)([A-Za-z0-9_$]+)\.slice\(0,\3\.lastIndexOf\((["\'])/(["\'])\)\+1\)\)'
)
# Older builds (pre-2026-09 exports) derive the FBX resource path through the
# stock Three.js `LoaderUtils.extractUrlBase`, minified as:
#   static extractUrlBase(e){const t=e.lastIndexOf("/");return t===-1?"./":e.slice(0,t+1)}
LEGACY_EXTRACT_RE = re.compile(
    r'(static extractUrlBase\((\w+)\)\{)(const \w+=\2\.lastIndexOf\("/"\);return)'
)
MANAGER_INJECTION = (
    'this.loadingManager.setURLModifier(function(u){{return String(u).indexOf("{marker}:")===0?"{placeholder}":u}}),'
)

LINK_TAG_RE = re.compile(r'<link\b[^>]*href="style\.css"[^>]*>', re.IGNORECASE)


def patch_text(text: str):
    """Patch a JS/HTML text blob. Returns (status, new_text, detail)."""
    if FIX_MARKER in text:
        return ("already-fixed", text, "")
    injection = MANAGER_INJECTION.format(marker=FIX_MARKER, placeholder=PLACEHOLDER)
    resource = RESOURCE_RE.search(text)
    if resource:
        manager = MANAGER_RE.search(text)
        if not manager:
            return ("anchor-missing", text, "resource path found but loadingManager anchor missing")
        patched = MANAGER_RE.sub(lambda m: f"{m.group(1)},{injection}", text, count=1)
        patched = RESOURCE_RE.sub(lambda m: f',{m.group(1)}{m.group(2)}"{FIX_MARKER}:")', patched, count=1)
        if FIX_MARKER not in patched or RESOURCE_RE.search(patched):
            return ("patch-failed", text, "verification after patch failed")
        return ("patched", patched, "")
    legacy = LEGACY_EXTRACT_RE.search(text)
    if legacy:
        manager = MANAGER_RE.search(text)
        if not manager:
            return ("anchor-missing", text, "legacy extractUrlBase found but loadingManager anchor missing")
        patched = LEGACY_EXTRACT_RE.sub(
            lambda m: f'{m.group(1)}if({m.group(2)}.indexOf("data:")===0)return"{FIX_MARKER}:";{m.group(3)}',
            text, count=1
        )
        patched = MANAGER_RE.sub(lambda m: f"{m.group(1)},{injection}", patched, count=1)
        if FIX_MARKER not in patched or LEGACY_EXTRACT_RE.search(patched):
            return ("patch-failed", text, "verification after legacy patch failed")
        return ("patched", patched, "")
    return ("no-bug", text, "no resource-path fallback pattern")


TEXT_EXTS = (".js", ".html", ".css")


def patch_zip_file(path: str, is_mintegral: bool):
    """Returns (status, new_bytes_or_None, detail)."""
    with zipfile.ZipFile(path) as zf:
        infos = zf.infolist()
        texts = {}
        for info in infos:
            if info.filename.endswith(TEXT_EXTS):
                texts[info.filename] = zf.read(info).decode("utf-8", errors="surrogateescape")
        if any(FIX_MARKER in t for t in texts.values()):
            return ("already-fixed", None, "")

        js_status = None
        changed = False
        for name in list(texts):
            if not name.endswith((".js", ".html")):
                continue
            status, new_text, _detail = patch_text(texts[name])
            if status == "patched":
                texts[name] = new_text
                changed = True
                if js_status is None:
                    js_status = "patched"
            elif js_status is None:
                js_status = status
        if not changed:
            return (js_status or "no-bug", None, "")

        css_status = "n/a"
        if is_mintegral:
            css_name = next((n for n in texts if n.endswith("style.css")), None)
            html_name = next((n for n in texts if n.endswith(".html")), None)
            if css_name and html_name:
                css = texts[css_name]
                html = texts[html_name]
                if "</style" in css.lower():
                    css_status = "css-contains-style-close"
                elif LINK_TAG_RE.search(html):
                    texts[html_name] = LINK_TAG_RE.sub(lambda m: f"<style>{css}</style>", html, count=1)
                    del texts[css_name]
                    css_status = "inlined"
                else:
                    css_status = "no-link-tag"
            else:
                css_status = "no-css-pair"

        buffer = io.BytesIO()
        dropped_css = is_mintegral and css_status == "inlined"
        with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as out:
            for info in infos:
                name = info.filename
                if dropped_css and name.endswith("style.css"):
                    continue
                if name in texts:
                    out.writestr(info, texts[name].encode("utf-8", "surrogateescape"))
                else:
                    out.writestr(info, zf.read(name))
        return ("patched", buffer.getvalue(), f"css={css_status}")


def patch_html_file(path: str):
    with open(path, "r", encoding="utf-8", errors="surrogateescape") as fh:
        text = fh.read()
    status, new_text, detail = patch_text(text)
    return status, new_text if status == "patched" else None, detail


def backup(path: str, backup_root: str, source_label: str):
    rel = os.path.relpath(path, "/")
    dest = os.path.join(backup_root, source_label, rel)
    os.makedirs(os.path.dirname(dest), exist_ok=True)
    shutil.copy2(path, dest)
    return dest


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--list", required=True)
    ap.add_argument("--backup-root", required=True)
    ap.add_argument("--source-label", default="local")
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--log", default=None)
    args = ap.parse_args()

    with open(args.list, encoding="utf-8") as fh:
        paths = [ln.strip() for ln in fh if ln.strip()]

    stats = {"patched": 0, "already-fixed": 0, "no-bug": 0, "anchor-missing": 0, "patch-failed": 0, "error": 0}
    details = []
    t0 = time.time()
    for i, path in enumerate(paths, 1):
        name = os.path.basename(path)
        is_mintegral = "_MT_" in name
        try:
            if name.endswith(".zip"):
                status, new_bytes, detail = patch_zip_file(path, is_mintegral)
                if status == "patched" and not args.dry_run:
                    backup(path, args.backup_root, args.source_label)
                    tmp = path + ".tmp-patch"
                    with open(tmp, "wb") as fh:
                        fh.write(new_bytes)
                    os.replace(tmp, path)
            elif name.endswith(".html"):
                status, new_text, detail = patch_html_file(path)
                if status == "patched" and not args.dry_run:
                    backup(path, args.backup_root, args.source_label)
                    tmp = path + ".tmp-patch"
                    with open(tmp, "w", encoding="utf-8", errors="surrogateescape") as fh:
                        fh.write(new_text)
                    os.replace(tmp, path)
            else:
                status, detail = "error", "unsupported extension"
        except Exception as exc:  # noqa: BLE001
            status, detail = "error", f"{type(exc).__name__}: {exc}"
        stats[status] = stats.get(status, 0) + 1
        if status not in ("already-fixed",):
            details.append({"path": path, "status": status, "detail": detail})
        if i % 25 == 0 or i == len(paths):
            print(f"[{i}/{len(paths)}] {stats}", file=sys.stderr, flush=True)

    report = {
        "list": args.list,
        "source": args.source_label,
        "dryRun": args.dry_run,
        "count": len(paths),
        "stats": stats,
        "elapsedSeconds": round(time.time() - t0, 1),
        "details": details,
    }
    text = json.dumps(report, ensure_ascii=False, indent=1)
    print(text)
    if args.log:
        with open(args.log, "w", encoding="utf-8") as fh:
            fh.write(text + "\n")


if __name__ == "__main__":
    main()
