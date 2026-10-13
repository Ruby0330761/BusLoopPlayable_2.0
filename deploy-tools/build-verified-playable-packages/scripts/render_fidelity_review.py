#!/usr/bin/env python3
from __future__ import annotations

import argparse
import base64
import html
import json
import mimetypes
import sys
from pathlib import Path
from typing import Any

LIB_ROOT = Path(__file__).resolve().parent / "lib"
sys.path.insert(0, str(LIB_ROOT))

from resource_common import git_worktree_root, is_within, load_json, sha256_file


def required_tinify_review_views(risk_features: list[str] | None = None) -> list[str]:
    risks = {str(value).upper().replace("-", "_") for value in risk_features or []}
    views = ["side-by-side", "overlay", "blink", "difference", "actual-display-size"]
    if risks & {"TRANSPARENT_EDGE", "CTA", "LOGO", "KEY_UI", "TEXT", "NINE_SLICE"}:
        views.extend(["transparent-checkerboard", "light-background", "dark-background", "zoom"])
    if risks:
        views.append("runtime-scene")
    return views


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="生成 Gate B 单页内嵌的单文件与完整包 A/B 审阅页")
    parser.add_argument("--project-root", required=True, type=Path)
    parser.add_argument("--change-records", required=True, type=Path)
    parser.add_argument("--before-artifact", required=True, type=Path)
    parser.add_argument("--after-artifact", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    return parser.parse_args()


def require(path: Path, schema: str) -> dict[str, Any]:
    value = load_json(path.expanduser().resolve())
    if not isinstance(value, dict) or value.get("schemaVersion") != schema:
        raise ValueError(f"{path.name} schemaVersion 必须为 {schema}")
    return value


def project_file(project_root: Path, value: object) -> Path:
    path = Path(str(value or "")).expanduser()
    if not path.is_absolute():
        path = project_root / path
    resolved = path.resolve()
    try:
        resolved.relative_to(project_root)
    except ValueError as exc:
        raise ValueError(f"A/B 文件必须位于项目内：{resolved}") from exc
    if not resolved.is_file():
        raise ValueError(f"A/B 文件不存在：{resolved}")
    return resolved


def candidate_file(project_root: Path, value: object) -> Path:
    raw = Path(str(value or "")).expanduser()
    candidates = [raw.resolve()] if raw.is_absolute() else [(project_root / raw).resolve()]
    product_root = git_worktree_root(project_root)
    stable_run_root = (product_root / "playable-runs").resolve() if product_root else None
    if not raw.is_absolute() and product_root is not None:
        candidates.append((product_root / raw).resolve())
    for resolved in candidates:
        if not resolved.is_file():
            continue
        if is_within(project_root, resolved) or (stable_run_root is not None and is_within(stable_run_root, resolved)):
            return resolved
    raise ValueError(f"A/B 候选文件必须位于项目或产品仓 playable-runs 内：{value}")


def data_uri(path: Path, mime: str | None = None) -> str:
    content_type = mime or mimetypes.guess_type(path.name)[0] or "application/octet-stream"
    encoded = base64.b64encode(path.read_bytes()).decode("ascii")
    return f"data:{content_type};base64,{encoded}"


def media_pair(
    original: Path, candidate: Path, label: str, views: list[str] | None = None,
    *, action: str | None = None, risk_features: list[str] | None = None,
    display_size: dict[str, Any] | None = None, receipt: dict[str, Any] | None = None,
) -> str:
    mime = mimetypes.guess_type(original.name)[0] or "application/octet-stream"
    original_uri = data_uri(original, mime)
    candidate_uri = data_uri(candidate, mimetypes.guess_type(candidate.name)[0] or mime)
    escaped = html.escape(label)
    if mime.startswith("audio/"):
        body = (
            f'<div class="pair"><div><h4>Original</h4><audio controls preload="metadata" src="{original_uri}"></audio></div>'
            f'<div><h4>Candidate</h4><audio controls preload="metadata" src="{candidate_uri}"></audio></div></div>'
        )
    elif mime.startswith("image/"):
        requested = set(views or ["whole"])
        if action == "TINIFY_SHRINK":
            requested.update(required_tinify_review_views(risk_features))
        parts = []
        if requested & {"whole", "side-by-side"}:
            parts.append(
                '<h4>整体对比</h4>'
                f'<div class="pair"><div><h5>原图片</h5><img src="{original_uri}" alt="原图片整体"></div>'
                f'<div><h5>候选图片</h5><img src="{candidate_uri}" alt="候选图片整体"></div></div>'
            )
        if "zoom" in requested:
            parts.append(
                '<h4>局部放大</h4><p class="meta">放大检查文字、CTA、关键 UI、九宫格和透明边缘。</p>'
                f'<div class="pair zoom"><div><h5>原图片局部</h5><img src="{original_uri}" alt="原图片局部放大"></div>'
                f'<div><h5>候选图片局部</h5><img src="{candidate_uri}" alt="候选图片局部放大"></div></div>'
            )
        if requested & {"transparent-background", "transparent-checkerboard"}:
            parts.append(
                '<h4>透明背景</h4><p class="meta">在透明棋盘背景上检查白边、黑边、漏色和半透明像素。</p>'
                f'<div class="pair checkerboard"><div><h5>原图片透明边缘</h5><img src="{original_uri}" alt="原图片透明背景"></div>'
                f'<div><h5>候选图片透明边缘</h5><img src="{candidate_uri}" alt="候选图片透明背景"></div></div>'
            )
        if "light-background" in requested or "dark-background" in requested:
            parts.append(
                '<h4>浅色/深色背景</h4><div class="pair background-pair">'
                f'<div class="light"><img src="{candidate_uri}" alt="候选图片浅色背景"></div>'
                f'<div class="dark"><img src="{candidate_uri}" alt="候选图片深色背景"></div></div>'
            )
        if "overlay" in requested:
            parts.append(
                '<h4>50% 叠加</h4><div class="overlay">'
                f'<img src="{original_uri}" alt="原图叠加层"><img class="candidate" src="{candidate_uri}" alt="候选叠加层"></div>'
            )
        if "blink" in requested:
            parts.append(
                '<h4>原图/候选闪烁</h4><div class="blink">'
                f'<img src="{original_uri}" alt="原图闪烁层"><img src="{candidate_uri}" alt="候选闪烁层"></div>'
            )
        if "difference" in requested:
            parts.append(
                '<h4>增强差异定位</h4><p class="meta">差异混合只用于定位变化，不代表实际视觉强度。</p>'
                f'<div class="difference"><img src="{original_uri}" alt="差异原图"><img src="{candidate_uri}" alt="差异候选"></div>'
            )
        if "actual-display-size" in requested:
            width = int((display_size or {}).get("widthPx") or 0)
            height = int((display_size or {}).get("heightPx") or 0)
            style = f'width:{width}px;height:{height}px' if width > 0 and height > 0 else "max-width:100%"
            parts.append(
                '<h4>实际显示尺寸</h4>'
                f'<div class="pair actual"><img style="{style}" src="{original_uri}" alt="原图实际显示尺寸">'
                f'<img style="{style}" src="{candidate_uri}" alt="候选实际显示尺寸"></div>'
            )
        if "runtime-scene" in requested:
            parts.append('<h4>项目代表场景</h4><p class="notice">高风险图片必须在真实运行场景、拉伸或动画关键帧证据中逐项确认。</p>')
        if action == "TINIFY_SHRINK":
            api = (receipt or {}).get("api") or {}
            parts.insert(0, (
                '<p class="meta">左侧原图，右侧 Tinify 候选 · '
                f'API 请求 {api.get("requestCount", "未记录")} 次 · Compression-Count {api.get("compressionCount", "未记录")}</p>'
            ))
        body = "".join(parts) or '<p class="notice">没有声明图片 A/B 视图。</p>'
    elif mime.startswith("video/"):
        body = (
            f'<div class="pair"><div><h4>Original</h4><video controls src="{original_uri}"></video></div>'
            f'<div><h4>Candidate</h4><video controls src="{candidate_uri}"></video></div></div>'
        )
    else:
        body = (
            '<p class="notice">该格式不能在浏览器内直接试听或预览；可在本页下载两个精确字节进行外部检查。</p>'
            f'<div class="pair"><a download="{html.escape(original.name)}" href="{original_uri}">下载 Original</a>'
            f'<a download="{html.escape(candidate.name)}" href="{candidate_uri}">下载 Candidate</a></div>'
        )
    return (
        f'<article><h3>{escaped}</h3><p class="meta">Original {original.stat().st_size:,} B · Candidate {candidate.stat().st_size:,} B</p>{body}</article>'
    )


def artifact_panel(path: Path, title: str) -> str:
    escaped_title = html.escape(title)
    uri = data_uri(path)
    if path.suffix.lower() in {".html", ".htm"}:
        return (
            f'<div><h3>{escaped_title}</h3><p class="meta">{path.stat().st_size:,} B · SHA-256 {sha256_file(path)}</p>'
            f'<iframe title="{escaped_title}" sandbox="allow-scripts allow-pointer-lock" src="{uri}"></iframe></div>'
        )
    return (
        f'<div><h3>{escaped_title}</h3><p class="meta">{path.stat().st_size:,} B · SHA-256 {sha256_file(path)}</p>'
        '<p class="notice">ZIP 无法在本地文件页中直接运行；完整字节已内嵌，可在本页下载后使用目标平台预览。</p>'
        f'<a class="download" download="{html.escape(path.name)}" href="{uri}">下载 {escaped_title}</a></div>'
    )


def render(args: argparse.Namespace) -> str:
    project_root = args.project_root.expanduser().resolve()
    changes = require(args.change_records, "playable-resource-change-records-v1")
    if Path(str(changes.get("projectRoot") or "")).expanduser().resolve() != project_root:
        raise ValueError("change records 与当前项目不一致")
    sections: list[str] = []
    for index, item in enumerate(changes.get("actions") or [], start=1):
        if not isinstance(item, dict) or item.get("operation") != "REPLACE":
            raise ValueError("A/B 页面只接受 REPLACE change record")
        original = project_file(project_root, item.get("targetPath"))
        candidate = candidate_file(project_root, item.get("candidatePath"))
        if sha256_file(original) != item.get("beforeSha256") or sha256_file(candidate) != item.get("candidateSha256"):
            raise ValueError(f"A/B 单文件已漂移：{item.get('actionId')}")
        review = item.get("abReview") or {}
        views = review.get("views") if isinstance(review, dict) else None
        if views is not None and (not isinstance(views, list) or not all(isinstance(view, str) for view in views)):
            raise ValueError(f"A/B 视图声明无效：{item.get('actionId')}")
        sections.append(media_pair(
            original, candidate, f"{index}. {item.get('targetPath')}", views,
            action=item.get("action"), risk_features=item.get("riskFeatures") or [],
            display_size=item.get("displaySize"), receipt=item.get("tinifyReceipt"),
        ))
    before = args.before_artifact.expanduser().resolve()
    after = args.after_artifact.expanduser().resolve()
    if not before.is_file() or not after.is_file():
        raise ValueError("完整包 A/B artifact 不存在")
    return f"""<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>资源候选单页 A/B</title><style>
:root{{color-scheme:light;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:#f4f6fb;color:#172033}}
body{{margin:0}}main{{max-width:1180px;margin:auto;padding:32px 20px 64px}}h1{{margin:0 0 8px}}.lead,.meta{{color:#5f6b7c}}
article,.packages>div{{background:white;border:1px solid #dfe4ec;border-radius:14px;padding:18px;margin:16px 0;box-shadow:0 4px 18px #1f2b4010}}
.pair,.packages{{display:grid;grid-template-columns:1fr 1fr;gap:18px}}audio,video,img{{width:100%;max-height:360px;object-fit:contain}}
.zoom{{overflow:hidden}}.zoom img{{width:200%;max-width:none;transform:translate(-25%,-25%);image-rendering:auto}}
.checkerboard{{background-color:#fff;background-image:linear-gradient(45deg,#d9dde5 25%,transparent 25%),linear-gradient(-45deg,#d9dde5 25%,transparent 25%),linear-gradient(45deg,transparent 75%,#d9dde5 75%),linear-gradient(-45deg,transparent 75%,#d9dde5 75%);background-size:24px 24px;background-position:0 0,0 12px,12px -12px,-12px 0;padding:12px;border-radius:10px}}
.background-pair>div{{min-height:220px;display:grid;place-items:center;padding:12px}}.light{{background:#f7f7f5}}.dark{{background:#20242b}}
.overlay,.blink,.difference{{position:relative;display:grid;place-items:center;min-height:320px;overflow:hidden}}.overlay img,.blink img,.difference img{{position:absolute;inset:0;margin:auto}}
.overlay .candidate{{opacity:.5}}.blink img:last-child{{animation:blink 1s steps(1,end) infinite}}.difference img:last-child{{mix-blend-mode:difference;filter:contrast(4)}}@keyframes blink{{50%{{opacity:0}}}}
.actual{{align-items:start;justify-items:start;overflow:auto}}.actual img{{max-width:none;object-fit:contain}}
iframe{{width:100%;height:620px;border:1px solid #ccd3df;border-radius:10px;background:white}}.notice{{background:#fff7dd;padding:10px;border-radius:8px}}
.download{{display:inline-block;padding:10px 14px;background:#2557d6;color:white;text-decoration:none;border-radius:8px}}
@media(max-width:760px){{.pair,.packages{{grid-template-columns:1fr}}iframe{{height:520px}}}}
</style></head><body><main>
<h1>资源候选单页 A/B</h1><p class="lead">单文件试听/观感与完整包对照都在当前页面完成；本页不会覆盖工程。</p>
<h2>单文件候选（{len(sections)} 项）</h2>{''.join(sections) if sections else '<p class="notice">本轮没有单文件替换动作。</p>'}
<h2>完整包对照</h2><section class="packages">{artifact_panel(before, '未优化对照包')}{artifact_panel(after, '优化候选包')}</section>
</main></body></html>"""


def main() -> int:
    args = parse_args()
    try:
        content = render(args)
        output = args.output.expanduser().resolve()
        if output.exists():
            raise ValueError(f"A/B 页面已存在，不能覆盖复用：{output}")
        output.parent.mkdir(parents=True, exist_ok=True)
        output.write_text(content, encoding="utf-8")
    except (OSError, ValueError, json.JSONDecodeError) as exc:
        print(json.dumps({"ok": False, "error": str(exc)}, ensure_ascii=False, indent=2))
        return 1
    print(json.dumps({"ok": True, "output": str(output), "sha256": sha256_file(output)}, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
