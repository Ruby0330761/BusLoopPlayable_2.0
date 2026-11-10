#!/usr/bin/env python3
"""基于已完成的 AppLovin 基线 HTML 生成其他平台候选包。

适用前提：该产物已内建多平台 CTA 桥接（mraid / FbPlayableAd / ExitApi /
__aepUnityOpen / window.install / openAppStore），通过 `__AEP_PLATFORM`
开关选择实际调用哪一个。

设计约束：

* 只做平台必需的转换，不改造业务代码。除 `__AEP_PLATFORM` 翻转和平台官方
  要求的 meta / SDK 声明外，产物字节保持不变。
* 目标平台需要本产物不具备的真实能力时 fail closed，绝不注入空生命周期、
  假 CTA 或占位实现（与 repair-policy 的禁止行为一致）。
* 每个转换逐条记入 receipt，包含输入/输出 SHA-256 与全部变换项。
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path
from typing import Any


SKILL_ROOT = Path(__file__).resolve().parents[1]
SCRIPTS = SKILL_ROOT / "scripts"
sys.path.insert(0, str(SCRIPTS / "lib"))

SCHEMA = "playable-applovin-baseline-conversion-v1"
GOOGLE_EXIT_API = "https://tpc.googlesyndication.com/pagead/gadgets/html5/api/exitapi.js"
TIKTOK_SDK = "https://sf16-muse-va.ibytedtos.com/obj/union-fe-nc-i18n/playable/sdk/playable-sdk.js"
PLATFORM_FLAG = re.compile(r'window\.__AEP_PLATFORM\s*=\s*"[^"]*"')

# 平台 -> (交付形态, 是否可转换, 不可转换原因)
PLATFORMS: dict[str, dict[str, Any]] = {
    "meta": {
        "delivery": "zip",
        "convertible": True,
        "flag": "meta",
        "note": "翻转平台标识后打 ZIP，根目录 index.html；CTA 走 FbPlayableAd.onCTAClick",
    },
    "moloco": {
        "delivery": "html",
        "convertible": True,
        "flag": "moloco",
        "note": "单 HTML 直接交付；CTA 走 FbPlayableAd.onCTAClick",
    },
    "unityads": {
        "delivery": "html",
        "convertible": True,
        "flag": "unity",
        "note": "单 HTML；CTA 走 __aepUnityOpen",
    },
    # 包内分支判断用的是 "google"，不是 "google-ads"；写错会掉到 mraid 兜底
    "google-ads": {
        "delivery": "zip",
        "convertible": True,
        "flag": "google",
        "note": "注入官方 exitapi.js 与 ad.orientation；CTA 走 ExitApi.exit",
        "inject": ["exitapi", "ad-meta"],
    },
    "mintegral": {
        "delivery": "zip",
        "convertible": True,
        "flag": "mintegral",
        "note": "单文件 ZIP；模块脚本降级为经典脚本，并补 Mintegral 生命周期契约层",
        "inject": ["classic-script", "mintegral-lifecycle"],
    },
    "tiktok": {
        "delivery": "zip",
        "convertible": True,
        "flag": "tiktok",
        "note": "四件套 ZIP；注入官方 playable SDK 与 config.json；CTA 走 openAppStore",
        "inject": ["tiktok-sdk", "tiktok-config", "tiktok-layout"],
    },
}


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def sha256_file(path: Path) -> str:
    return sha256_bytes(path.read_bytes())


def detect_orientation(html: str) -> str:
    """从产物里显式声明的宽高推断横竖屏；找不到时按竖屏处理。"""
    match = re.search(r'width\s*=\s*(\d{3,5})[^>]*?height\s*=\s*(\d{3,5})', html)
    if match:
        width, height = int(match.group(1)), int(match.group(2))
        return "landscape" if width > height else "portrait"
    return "portrait"


def flip_platform(html: str, value: str) -> tuple[str, str | None]:
    matches = PLATFORM_FLAG.findall(html)
    if len(matches) != 1:
        # 多于一处说明包里可能同时写了多个平台开关，交给调用方判断风险
        return html, f"__AEP_PLATFORM 出现 {len(matches)} 处，仅支持唯一声明"
    replaced = PLATFORM_FLAG.sub(f'window.__AEP_PLATFORM="{value}"', html, count=1)
    return replaced, None


def inject_google_exitapi(html: str) -> tuple[str, dict | None]:
    if GOOGLE_EXIT_API in html:
        return html, None
    # Google Ads 官方要求注入 exitapi.js。用 async 避免本地或弱网环境下
    # 这个外链阻塞 HTML 解析导致整页白屏；线上容器里 SDK 早于用户点击就绪。
    tag = f'<script async src="{GOOGLE_EXIT_API}"></script>'
    match = re.search(r"<head(?:\s[^>]*)?>", html, re.IGNORECASE)
    if not match:
        return html, {"error": "缺少 <head>，无法注入 exitapi.js"}
    return html[: match.end()] + tag + html[match.end():], {
        "action": "inject-exitapi",
        "source": GOOGLE_EXIT_API,
        "loading": "async",
    }


def inject_google_meta(html: str, orientation: str, ad_size: str | None) -> tuple[str, dict | None]:
    tags = []
    if 'name="ad.orientation"' not in html and "name='ad.orientation'" not in html:
        tags.append(f'<meta name="ad.orientation" content="{orientation}" />')
    if ad_size and 'name="ad.size"' not in html and "name='ad.size'" not in html:
        tags.append(f'<meta name="ad.size" content="{ad_size}" />')
    if not tags:
        return html, None
    match = re.search(r"<head(?:\s[^>]*)?>", html, re.IGNORECASE)
    if not match:
        return html, {"error": "缺少 <head>，无法注入 ad meta"}
    return html[: match.end()] + "".join(tags) + html[match.end():], {
        "action": "inject-ad-meta",
        "orientation": orientation,
        "adSize": ad_size,
    }


def build_zip(root: Path, output: Path, entries: list[str]) -> None:
    command = [
        sys.executable, str(SCRIPTS / "deterministic_zip.py"),
        "--root", str(root),
        "--output", str(output),
    ]
    for entry in entries:
        command.extend(["--entry", entry])
    completed = subprocess.run(command, capture_output=True, text=True)
    if completed.returncode != 0:
        raise RuntimeError(completed.stderr.strip() or completed.stdout.strip() or "ZIP 打包失败")


MODULE_SCRIPT = re.compile(
    r'<script\s+type\s*=\s*["\']module["\']\s*>(?P<body>.*?)</script>', re.DOTALL | re.IGNORECASE
)
STYLE_BLOCK = re.compile(r'<style(?:\s[^>]*)?>(?P<body>.*?)</style>', re.DOTALL | re.IGNORECASE)
HEAD_END = re.compile(r"</head\s*>", re.IGNORECASE)


def split_into_four_parts(html: str) -> tuple[dict[str, str], dict[str, Any] | None]:
    """把单文件产物拆成 index.html / index.js / style.css。

    只在模块块自包含（无顶层 import/export、无 import.meta）时才允许拆分：
    内联脚本被移到外部文件后，顶层变量不再共享同一作用域，行为可能改变。
    这里保留模块块为 `<script type="module" src="index.js">`，语义与原来一致。
    """
    module_match = MODULE_SCRIPT.search(html)
    if not module_match:
        return {}, {"error": "未找到 type=module 脚本块，无法拆分 index.js"}
    body = module_match.group("body")
    if re.search(r"(?m)^\s*(?:import|export)\s", body) or "import.meta" in body:
        return {}, {"error": "模块块含 import/export 或 import.meta，移出为独立文件会改变加载语义"}

    styles = list(STYLE_BLOCK.finditer(html))
    css = "\n".join(item.group("body") for item in styles)
    if not styles:
        return {}, {"error": "未找到 <style> 块，无法生成 style.css"}

    # 移除原 style 块与模块块，改写为外部引用
    without_styles = STYLE_BLOCK.sub("", html)
    marker = '<link rel="stylesheet" href="style.css">'
    head_close = HEAD_END.search(without_styles)
    if not head_close:
        return {}, {"error": "缺少 </head>，无法插入 style.css 引用"}
    without_styles = without_styles[: head_close.start()] + marker + without_styles[head_close.start():]

    external_module = '<script type="module" src="index.js"></script>'
    final_html = MODULE_SCRIPT.sub(external_module, without_styles, count=1)
    return {"index.html": final_html, "index.js": body, "style.css": css}, None


def flatten_module_script(html: str, use_classic: bool) -> tuple[str, dict | None]:
    """Mintegral 禁止模块语法。模块块自包含时可安全降级为经典脚本。

    只有确认无顶层 import/export、无 import.meta、无顶层 await 时才降级；
    否则模块语义无法保留，必须 fail closed 回源码重建。
    """
    if not use_classic:
        return html, None
    match = MODULE_SCRIPT.search(html)
    if not match:
        return html, {"error": "未找到模块脚本块，无法降级为经典脚本"}
    body = match.group("body")
    if re.search(r"(?m)^\s*(?:import|export)\s", body) or "import.meta" in body:
        return html, {"error": "模块块含 import/export 或 import.meta，无法安全降级为经典脚本"}
    if re.search(r"(?m)^\s*await\s", body):
        return html, {"error": "模块块含顶层 await，无法安全降级为经典脚本"}
    plain = f"<script>{body}</script>"
    # 用函数替换：bundle 内含 \x 等转义，会被 re.sub 当作替换模板解析
    return MODULE_SCRIPT.sub(lambda _match: plain, html, count=1), {
        "action": "flatten-module-script",
        "to": "classic",
    }


MINTEGRAL_LIFECYCLE_ADAPTER = """
(function(){
  // 必须早于运行时探针定义这些全局函数，否则探针不会包装它们。
  // 但此刻 __AEP_PLATFORM 还没赋值，实际转调延后到 DOMContentLoaded 再绑定。
  if (window.__AEP_PLATFORM && window.__AEP_PLATFORM !== "mintegral") return;
  var flagged = {};
  function mark(name){
    if (flagged[name]) return;
    flagged[name] = true;
    try { if (window.console && window.console.log) window.console.log("[mintegral] " + name); } catch(e) {}
  }
  var pending = {};
  function define(name, bridge){
    if (typeof window[name] === "function") return;
    window[name] = function(){
      mark(name);
      try {
        if (window.__AEP_PLATFORM !== "mintegral") return;
        if (bridge && typeof bridge() === "function") { bridge()(); return; }
        if (typeof pending[name] === "function") pending[name]();
      } catch(e) {}
    };
  }
  define("gameReady");
  define("gameRetry", function(){ return window.__aepReset; });
  define("gameClose");
  define("gameEnd", function(){ return window.__aepGameEnd; });
  define("install", function(){
    return function(){
      var url = window.__AEP_STORE_URL || window.__AEP_STORE_URL_ANDROID;
      if (!url) return;
      if (window.mraid && window.mraid.open) { window.mraid.open(url); return; }
      if (typeof window.openAppStore === "function") { window.openAppStore(); return; }
      if (window.playableSDK && window.playableSDK.openAppStore) { window.playableSDK.openAppStore(); }
    };
  });
  // gameStart：由首次真实用户输入触发，并支持注册回调
  var startListeners = [];
  var started = false;
  window.gameStart = function(callback){
    if (typeof callback === "function") {
      startListeners.push(callback);
      if (started) { try { callback(); } catch(e) {} }
      return;
    }
    if (started) return;
    started = true;
    window.__aepStarted = true;
    mark("gameStart");
    for (var i = 0; i < startListeners.length; i++) {
      try { startListeners[i](); } catch(e) {}
    }
  };
  ["pointerdown","touchstart","mousedown","keydown"].forEach(function(type){
    window.addEventListener(type, function(){ window.gameStart(); }, { once: true, passive: true });
  });
})();
"""


def inject_mintegral_lifecycle(html: str) -> tuple[str, dict | None]:
    """补 Mintegral 生命周期契约层。转调真实内部挂钩，不注入假状态。"""
    if "__AEP_PLATFORM" not in html:
        return html, {"error": "缺少 __AEP_PLATFORM，无法定位 Mintegral 分支"}
    tag = f"<script>{MINTEGRAL_LIFECYCLE_ADAPTER}</script>"
    # 放在 <head> 内：运行时探针在业务脚本前安装，只包装"加载时已存在"的函数。
    # 适配层必须早于探针完成定义，否则真实调用不会被记录。
    # 适配层自身延迟到 DOMContentLoaded 后再读取产物内部挂钩，避免抢跑。
    match = re.search(r"<head(?:\s[^>]*)?>", html, re.IGNORECASE)
    if not match:
        return html, {"error": "缺少 <head>，无法注入生命周期适配层"}
    return html[: match.end()] + tag + html[match.end():], {
        "action": "inject-mintegral-lifecycle",
        "exposed": ["install", "gameReady", "gameStart", "gameEnd", "gameClose", "gameRetry"],
        "note": "转调产物内部真实挂钩，未注入假游戏状态",
    }


def inject_tiktok_sdk(html: str) -> tuple[str, dict | None]:
    if TIKTOK_SDK in html:
        return html, None
    tag = f'<script async src="{TIKTOK_SDK}"></script>'
    match = re.search(r"<head(?:\s[^>]*)?>", html, re.IGNORECASE)
    if not match:
        return html, {"error": "缺少 <head>，无法注入 TikTok playable SDK"}
    return html[: match.end()] + tag + html[match.end():], {
        "action": "inject-tiktok-sdk",
        "source": TIKTOK_SDK,
        "loading": "async",
    }


def write_receipt(path: Path, receipt: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(receipt, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def main() -> int:
    parser = argparse.ArgumentParser(
        description="基于 AppLovin 基线 HTML 生成其他平台候选包；无法安全转换时 fail closed"
    )
    parser.add_argument("--artifact", required=True, type=Path)
    parser.add_argument("--platform", required=True, choices=sorted(PLATFORMS))
    parser.add_argument("--output-dir", required=True, type=Path)
    parser.add_argument("--file-base", help="输出基础名；缺省沿用输入的去掉平台段")
    parser.add_argument("--receipt", required=True, type=Path)
    parser.add_argument("--ad-size", help="Google Ads 的 ad.size，形如 width=1080,height=1920")
    parser.add_argument("--orientation", choices=("portrait", "landscape"),
                        help="Google Ads 的方向；缺省按产物尺寸推断")
    args = parser.parse_args()

    spec = PLATFORMS[args.platform]
    artifact = args.artifact.expanduser().resolve()

    def blocked(errors: list[str], detail: dict | None = None) -> int:
        receipt = {
            "schemaVersion": SCHEMA,
            "status": "BLOCKED",
            "platform": args.platform,
            "source": {"path": str(artifact)} if artifact.is_file() else None,
            "errors": errors,
            "detail": detail or {},
            "userConclusion": "该平台无法由此 AppLovin 产物安全转换，未生成任何产物。",
        }
        write_receipt(args.receipt, receipt)
        print(json.dumps(receipt, ensure_ascii=False, indent=2))
        return 1

    if not spec["convertible"]:
        return blocked([spec["reason"]], {"platformNote": spec.get("note") or spec.get("reason")})
    if not artifact.is_file():
        return blocked([f"输入产物不存在: {artifact}"])

    source_bytes = artifact.read_bytes()
    html = source_bytes.decode("utf-8", errors="surrogateescape")
    transformations: list[dict] = []

    flipped, flag_error = flip_platform(html, spec["flag"])
    if flag_error:
        return blocked([flag_error])
    if flipped != html:
        transformations.append({
            "action": "flip-platform-flag",
            "to": spec["flag"],
        })
    html = flipped

    if "exitapi" in spec.get("inject", []):
        html, detail = inject_google_exitapi(html)
        if detail and detail.get("error"):
            return blocked([detail["error"]])
        if detail:
            transformations.append(detail)

    if "ad-meta" in spec.get("inject", []):
        orientation = args.orientation or detect_orientation(html)
        html, detail = inject_google_meta(html, orientation, args.ad_size)
        if detail and detail.get("error"):
            return blocked([detail["error"]])
        if detail:
            transformations.append(detail)

    if "tiktok-sdk" in spec.get("inject", []):
        html, detail = inject_tiktok_sdk(html)
        if detail and detail.get("error"):
            return blocked([detail["error"]])
        if detail:
            transformations.append(detail)

    if "classic-script" in spec.get("inject", []):
        html, detail = flatten_module_script(html, True)
        if detail and detail.get("error"):
            return blocked([detail["error"]])
        if detail:
            transformations.append(detail)

    if "mintegral-lifecycle" in spec.get("inject", []):
        html, detail = inject_mintegral_lifecycle(html)
        if detail and detail.get("error"):
            return blocked([detail["error"]])
        if detail:
            transformations.append(detail)

    if html == source_bytes.decode("utf-8", errors="surrogateescape"):
        return blocked(["平台翻转与平台必需注入均未产生任何变化，转换无意义"])

    output_dir = args.output_dir.expanduser().resolve()
    output_dir.mkdir(parents=True, exist_ok=True)
    base = args.file_base or artifact.stem
    output_path = output_dir / f"{base}.{'zip' if spec['delivery'] == 'zip' else 'html'}"
    want_four_parts = "tiktok-layout" in spec.get("inject", [])

    if spec["delivery"] == "html":
        output_path.write_bytes(html.encode("utf-8", errors="surrogateescape"))
    elif want_four_parts:
        # TikTok 要求根目录四件套；Mintegral 用同名目录承载同样内容
        parts, split_error = split_into_four_parts(html)
        if split_error:
            return blocked([split_error["error"]])
        parts["config.json"] = json.dumps(
            {"orientation": 0, "playable_orientation": 0}, ensure_ascii=False
        )
        transformations.append({
            "action": "split-four-parts",
            "files": sorted(parts),
        })
        with tempfile.TemporaryDirectory() as temporary:
            staging = Path(temporary)
            for name, content in parts.items():
                (staging / name).write_text(content, encoding="utf-8")
            build_zip(staging, output_path, ["index.html", "index.js", "style.css", "config.json"])
    else:
        with tempfile.TemporaryDirectory() as temporary:
            staging = Path(temporary)
            (staging / "index.html").write_text(html, encoding="utf-8")
            build_zip(staging, output_path, ["index.html"])

    after = output_path.read_bytes()
    receipt = {
        "schemaVersion": SCHEMA,
        "status": "CONVERTED",
        "platform": args.platform,
        "delivery": spec["delivery"],
        "source": {
            "path": str(artifact),
            "sha256": sha256_bytes(source_bytes),
            "bytes": len(source_bytes),
        },
        "output": {
            "path": str(output_path),
            "sha256": sha256_bytes(after),
            "bytes": len(after),
        },
        "transformations": transformations,
        "platformNote": spec["note"],
        "tracking": (
            "其他平台没有 AppLovin 的 12 事件标准；产物内 ALPlayableAnalytics 调用由 "
            "typeof 守护，在这些平台静默跳过，不上报任何数据。"
        ),
        "userConclusion": "已生成目标平台候选包；必须重新执行本地检查后才可以交付。",
    }
    write_receipt(args.receipt, receipt)
    print(json.dumps(receipt, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
