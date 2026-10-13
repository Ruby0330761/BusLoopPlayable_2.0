#!/usr/bin/env python3
from __future__ import annotations

import argparse
import html as html_module
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import threading
import zipfile
from datetime import datetime
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import quote

LIB_ROOT = Path(__file__).resolve().parent / "lib"
sys.path.insert(0, str(LIB_ROOT))

from artifact import ArtifactError, load_artifact
from resource_common import load_json
from rules import (
    RulesetError,
    dynamic_image_asset_references,
    is_container_safe_image_value,
    load_platform_rules,
)

DEFAULT_CHROME_PATHS = [
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
]


class QuietHandler(SimpleHTTPRequestHandler):
    def log_message(self, format: str, *args: object) -> None:
        return

    def do_GET(self) -> None:
        clean = self.path.split("?", 1)[0]
        if clean.endswith("/mraid.js") or clean == "/mraid.js":
            payload = b"/* platform mock is injected by runtime_check.py */"
            self.send_response(200)
            self.send_header("Content-Type", "application/javascript")
            self.send_header("Content-Length", str(len(payload)))
            self.end_headers()
            self.wfile.write(payload)
            return
        super().do_GET()


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="在临时副本中运行 playable 浏览器探针")
    parser.add_argument("--platform", required=True)
    parser.add_argument("--artifact", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--chrome")
    parser.add_argument("--cta-selector")
    parser.add_argument("--timeout-seconds", type=int, default=12)
    parser.add_argument("--disable-webgl", action="store_true")
    parser.add_argument("--adapter", type=Path, help="可选；从 performanceThresholds 读取项目已批准阈值")
    parser.add_argument("--check-batch-id", help="本轮静态、运行时和载荷检查共用的唯一批次 ID")
    return parser.parse_args()


def find_chrome(explicit: str | None) -> str | None:
    candidates = []
    if explicit:
        candidates.append(explicit)
    env_value = os.environ.get("PLAYABLE_CHROME_BIN")
    if env_value:
        candidates.append(env_value)
    candidates.extend(DEFAULT_CHROME_PATHS)
    for command in ("google-chrome", "chromium", "chromium-browser"):
        located = shutil.which(command)
        if located:
            candidates.append(located)
    for candidate in candidates:
        path = Path(candidate).expanduser()
        if path.is_file() and os.access(path, os.X_OK):
            return str(path.resolve())
    return None


def safe_extract(archive_path: Path, destination: Path) -> None:
    destination_resolved = destination.resolve()
    with zipfile.ZipFile(archive_path) as archive:
        for info in archive.infolist():
            normalized = info.filename.replace("\\", "/")
            target = (destination / normalized).resolve()
            try:
                target.relative_to(destination_resolved)
            except ValueError as exc:
                raise ArtifactError(f"ZIP 条目越界: {normalized}") from exc
        archive.extractall(destination)


def probe_script(
    platform: str,
    cta_selector: str | None,
    configured_image_assets: list[str] | None = None,
) -> str:
    template = r"""
<script id="playable-runtime-probe-bootstrap">
(function(){
  "use strict";
  var platform = __PLATFORM__;
  var ctaSelector = __CTA_SELECTOR__;
  var interacted = false;
  var originalFunctions = {};
  var listeners = { ready: [], viewableChange: [], sizeChange: [] };
  var probe = {
    platform: platform,
    startedAt: Date.now(),
    userInteracted: false,
    errors: [],
    consoleErrors: [],
    audioBeforeInteraction: [],
    bridgeCalls: [],
    ctaInputEvents: [],
    ctaTarget: null,
    ctaDispatch: null,
    analyticsEvents: [],
    dynamicImages: {
      propertySetterInstrumented: false,
      setAttributeInstrumented: false,
      configuredAssets: __DYNAMIC_IMAGE_ASSETS__,
      assignments: [],
      droppedAssignments: 0
    },
    mraid: {
      getStateCalls: 0,
      isViewableCalls: 0,
      listeners: { ready: 0, viewableChange: 0, sizeChange: 0 },
      readyFired: false,
      viewableTrueFired: false,
      viewableFalseFired: false,
      sizeChangeFired: false
    },
    lifecycleDefinitions: {},
    ctaSelector: ctaSelector,
    ctaSelectorFound: null,
    render: {},
    performance: {
      longTasks: [],
      frameIntervalsMs: [],
      paints: [],
      navigation: null,
      memory: null
    }
  };
  window.__PLAYABLE_RUNTIME_PROBE__ = probe;

  function now(){ return Date.now() - probe.startedAt; }
  function shortValue(value){
    var text = value === null || typeof value === "undefined" ? "" : String(value);
    return text.length <= 240 ? text : text.slice(0, 237) + "...";
  }
  function imageScheme(value){
    var text = value === null || typeof value === "undefined" ? "" : String(value).trim().toLowerCase();
    if (text.indexOf("data:") === 0) return "data";
    if (text.indexOf("blob:") === 0) return "blob";
    if (text.indexOf("//") === 0) return "protocol-relative";
    if (text.indexOf("/") === 0) return "root-relative";
    if (text.indexOf("http://") === 0 || text.indexOf("https://") === 0) return "http";
    if (/^[a-z][a-z0-9+.-]*:/i.test(text)) return "other";
    return text ? "relative" : "other";
  }
  function recordDynamicImage(image, value, via){
    var assignments = probe.dynamicImages.assignments;
    if (assignments.length >= 500) {
      probe.dynamicImages.droppedAssignments++;
      return;
    }
    var raw = value === null || typeof value === "undefined" ? "" : String(value);
    assignments.push({
      value: shortValue(raw),
      valueLength: raw.length,
      scheme: imageScheme(raw),
      via: via,
      className: shortValue(image && image.className),
      alt: shortValue(image && image.alt),
      atMs: now()
    });
  }
  function recordBridge(bridge, method, args){
    probe.bridgeCalls.push({
      bridge: bridge,
      method: method,
      args: Array.prototype.slice.call(args || []).map(function(value){
        try { return typeof value === "string" ? value : JSON.stringify(value); }
        catch(ex) { return String(value); }
      }),
      beforeInteraction: !interacted,
      atMs: now()
    });
  }
  function targetDetails(node){
    if (!node || !node.tagName) return null;
    return {
      tagName: node.tagName,
      id: node.id || null,
      className: shortValue(node.className),
      text: shortValue(node.innerText || node.textContent || (node.getAttribute && node.getAttribute("aria-label")) || "")
    };
  }
  function markInteraction(event){
    interacted = true;
    probe.userInteracted = true;
    if (probe.ctaInputEvents.length < 50) {
      probe.ctaInputEvents.push({
        type: event.type,
        isTrusted: event.isTrusted === true,
        x: typeof event.clientX === "number" ? Math.round(event.clientX) : null,
        y: typeof event.clientY === "number" ? Math.round(event.clientY) : null,
        target: targetDetails(event.target),
        atMs: now()
      });
    }
  }
  ["pointerdown","click","touchstart","mousedown","touchend"].forEach(function(name){
    document.addEventListener(name, markInteraction, true);
  });

  window.addEventListener("error", function(event){
    probe.errors.push({
      message: event.message || "window error",
      source: event.filename || "",
      line: event.lineno || 0,
      atMs: now()
    });
  });
  window.addEventListener("unhandledrejection", function(event){
    var reason = event.reason;
    probe.errors.push({
      message: reason && reason.message ? reason.message : String(reason),
      source: "unhandledrejection",
      line: 0,
      atMs: now()
    });
  });
  var originalConsoleError = console.error;
  console.error = function(){
    probe.consoleErrors.push({
      text: Array.prototype.slice.call(arguments).map(String).join(" "),
      atMs: now()
    });
    if (originalConsoleError) return originalConsoleError.apply(console, arguments);
  };

  try {
    if (window.HTMLImageElement && HTMLImageElement.prototype) {
      var imageSrcDescriptor = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, "src");
      if (imageSrcDescriptor && typeof imageSrcDescriptor.get === "function" && typeof imageSrcDescriptor.set === "function") {
        Object.defineProperty(HTMLImageElement.prototype, "src", {
          configurable: imageSrcDescriptor.configurable,
          enumerable: imageSrcDescriptor.enumerable,
          get: imageSrcDescriptor.get,
          set: function(value){
            recordDynamicImage(this, value, "src-property");
            return imageSrcDescriptor.set.call(this, value);
          }
        });
        probe.dynamicImages.propertySetterInstrumented = true;
      }
    }
  } catch(ex) {}
  try {
    if (window.Element && Element.prototype && typeof Element.prototype.setAttribute === "function") {
      var originalSetAttribute = Element.prototype.setAttribute;
      Element.prototype.setAttribute = function(name, value){
        if (this.tagName === "IMG" && String(name).toLowerCase() === "src") {
          recordDynamicImage(this, value, "setAttribute");
        }
        return originalSetAttribute.apply(this, arguments);
      };
      probe.dynamicImages.setAttributeInstrumented = true;
    }
  } catch(ex) {}

  try {
    var longTaskObserver = new PerformanceObserver(function(list){
      list.getEntries().forEach(function(entry){
        probe.performance.longTasks.push({ startTimeMs: Math.round(entry.startTime), durationMs: Math.round(entry.duration) });
      });
    });
    longTaskObserver.observe({ entryTypes: ["longtask"] });
  } catch(ex) {}
  try {
    var paintObserver = new PerformanceObserver(function(list){
      list.getEntries().forEach(function(entry){
        probe.performance.paints.push({ name: entry.name, startTimeMs: Math.round(entry.startTime) });
      });
    });
    paintObserver.observe({ entryTypes: ["paint"] });
  } catch(ex) {}
  var lastFrameAt = null;
  var frameSamples = 0;
  function sampleFrame(timestamp){
    if (lastFrameAt !== null && probe.performance.frameIntervalsMs.length < 300) {
      probe.performance.frameIntervalsMs.push(Math.round((timestamp - lastFrameAt) * 100) / 100);
    }
    lastFrameAt = timestamp;
    frameSamples++;
    if (frameSamples < 301) requestAnimationFrame(sampleFrame);
  }
  requestAnimationFrame(sampleFrame);

  var originalWindowOpen = window.open;
  window.open = function(){
    recordBridge("window", "window.open", arguments);
    return null;
  };

  var state = "loading";
  var viewable = false;
  window.mraid = {
    getState: function(){ probe.mraid.getStateCalls++; return state; },
    isViewable: function(){ probe.mraid.isViewableCalls++; return viewable; },
    addEventListener: function(name, callback){
      if (!listeners[name]) listeners[name] = [];
      if (typeof callback === "function") listeners[name].push(callback);
      if (Object.prototype.hasOwnProperty.call(probe.mraid.listeners, name)) {
        probe.mraid.listeners[name]++;
      }
    },
    removeEventListener: function(name, callback){
      if (!listeners[name]) return;
      listeners[name] = listeners[name].filter(function(item){ return item !== callback; });
    },
    open: function(){ recordBridge("mraid", "mraid.open", arguments); },
    getVersion: function(){ return "3.0"; },
    getScreenSize: function(){ return { width: innerWidth, height: innerHeight }; },
    getMaxSize: function(){ return { width: innerWidth, height: innerHeight }; },
    getCurrentPosition: function(){ return { x:0, y:0, width:innerWidth, height:innerHeight }; },
    getDefaultPosition: function(){ return { x:0, y:0, width:innerWidth, height:innerHeight }; }
  };

  function installObject(name, methods, bridge){
    var target = window[name] || {};
    function wrapObject(value){
      target = value || {};
      methods.forEach(function(method){
        var original = typeof target[method] === "function" ? target[method] : null;
        target[method] = function(){
          recordBridge(bridge, name + "." + method, arguments);
          if (original) return original.apply(this, arguments);
          return null;
        };
      });
    }
    wrapObject(target);
    try {
      Object.defineProperty(window, name, {
        configurable: true,
        get: function(){ return target; },
        set: function(value){ wrapObject(value); }
      });
    } catch(ex) {
      window[name] = target;
    }
  }

  installObject("FbPlayableAd", ["onCTAClick"], "fb-cta");
  installObject("ExitApi", ["exit"], "exit-api");
  installObject("playableSDK", ["openAppStore"], "open-app-store");

  function installFunction(name, bridge){
    var original = typeof window[name] === "function" ? window[name] : null;
    if (original) originalFunctions[name] = true;
    var wrapped = function(){
      recordBridge(bridge, name, arguments);
      if (original) return original.apply(this, arguments);
      return null;
    };
    try {
      Object.defineProperty(window, name, {
        configurable: true,
        get: function(){ return original ? wrapped : undefined; },
        set: function(value){
          original = typeof value === "function" ? value : null;
          originalFunctions[name] = !!original;
        }
      });
    } catch(ex) {
      window[name] = wrapped;
    }
  }

  installFunction("openAppStore", "open-app-store");
  ["install","gameReady","gameStart","gameEnd","gameClose","gameRetry"].forEach(function(name){
    installFunction(name, name === "install" ? "mintegral" : "mintegral-lifecycle");
  });

  window.ALPlayableAnalytics = {
    trackEvent: function(name){
      probe.analyticsEvents.push({ name: String(name), atMs: now() });
    }
  };

  if (window.HTMLMediaElement && HTMLMediaElement.prototype) {
    HTMLMediaElement.prototype.play = function(){
      if (!interacted) probe.audioBeforeInteraction.push({ type: "HTMLMediaElement.play", atMs: now() });
      return Promise.resolve();
    };
    // Model muted native autoplay without treating it as an explicit audio
    // play call in the checker parity runtime.
    HTMLMediaElement.prototype.load = function(){
      if (this.tagName === "VIDEO" && this.autoplay && this.muted && !this.loop) {
        setTimeout(function(){ this.dispatchEvent(new Event("ended")); }.bind(this), 120);
      }
    };
  }
  var AudioContextCtor = window.AudioContext || window.webkitAudioContext;
  if (AudioContextCtor && AudioContextCtor.prototype) {
    var originalResume = AudioContextCtor.prototype.resume;
    AudioContextCtor.prototype.resume = function(){
      if (!interacted) probe.audioBeforeInteraction.push({ type: "AudioContext.resume", atMs: now() });
      if (originalResume) {
        try { return originalResume.apply(this, arguments); } catch(ex) {}
      }
      return Promise.resolve();
    };
    var originalCreateBufferSource = AudioContextCtor.prototype.createBufferSource;
    if (originalCreateBufferSource) {
      AudioContextCtor.prototype.createBufferSource = function(){
        var node = originalCreateBufferSource.apply(this, arguments);
        if (node && typeof node.start === "function") {
          var originalStart = node.start;
          node.start = function(){
            if (!interacted) probe.audioBeforeInteraction.push({ type: "AudioBufferSource.start", atMs: now() });
            return originalStart.apply(this, arguments);
          };
        }
        return node;
      };
    }
  }

  setTimeout(function(){
    state = "default";
    listeners.ready.slice().forEach(function(callback){ try { callback(); } catch(ex) { throw ex; } });
    probe.mraid.readyFired = true;
  }, 250);
  setTimeout(function(){
    viewable = true;
    listeners.viewableChange.slice().forEach(function(callback){ try { callback(true); } catch(ex) { throw ex; } });
    probe.mraid.viewableTrueFired = true;
  }, 500);
  setTimeout(function(){
    var size = { width: innerWidth, height: innerHeight };
    listeners.sizeChange.slice().forEach(function(callback){ try { callback(size.width, size.height); } catch(ex) { throw ex; } });
    probe.mraid.sizeChangeFired = true;
  }, 750);
  setTimeout(function(){
    viewable = false;
    listeners.viewableChange.slice().forEach(function(callback){ try { callback(false); } catch(ex) { throw ex; } });
    probe.mraid.viewableFalseFired = true;
  }, 3200);

  setTimeout(function(){
    var canvases = Array.prototype.slice.call(document.querySelectorAll("canvas")).map(function(canvas){
      var rect = canvas.getBoundingClientRect();
      return { width: canvas.width || 0, height: canvas.height || 0, cssWidth: Math.round(rect.width), cssHeight: Math.round(rect.height) };
    });
    var images = Array.prototype.slice.call(document.images || []).map(function(image){
      return {
        srcAttribute: shortValue(image.getAttribute("src") || ""),
        currentSrc: shortValue(image.currentSrc || image.src || ""),
        complete: !!image.complete,
        naturalWidth: image.naturalWidth || 0,
        naturalHeight: image.naturalHeight || 0,
        className: shortValue(image.className),
        alt: shortValue(image.alt)
      };
    });
    var brokenImages = images.filter(function(image){
      return image.complete && image.naturalWidth === 0;
    }).map(function(image){ return image.currentSrc || image.srcAttribute || ""; });
    ["install","gameReady","gameStart","gameEnd","gameClose","gameRetry"].forEach(function(name){
      probe.lifecycleDefinitions[name] = !!originalFunctions[name];
    });
    probe.render = {
      bodyTextLength: document.body ? String(document.body.innerText || "").trim().length : 0,
      childElementCount: document.body ? document.body.childElementCount : 0,
      canvasCount: canvases.length,
      canvases: canvases,
      imageCount: document.images ? document.images.length : 0,
      images: images,
      brokenImages: brokenImages
    };
    try {
      var navigation = performance.getEntriesByType("navigation")[0];
      if (navigation) probe.performance.navigation = {
        domContentLoadedMs: Math.round(navigation.domContentLoadedEventEnd),
        loadEventMs: Math.round(navigation.loadEventEnd),
        responseEndMs: Math.round(navigation.responseEnd)
      };
    } catch(ex) {}
    try {
      if (performance.memory) probe.performance.memory = {
        usedJSHeapSize: performance.memory.usedJSHeapSize,
        totalJSHeapSize: performance.memory.totalJSHeapSize,
        jsHeapSizeLimit: performance.memory.jsHeapSizeLimit
      };
    } catch(ex) {}
    var intervals = probe.performance.frameIntervalsMs;
    if (intervals.length) {
      var total = intervals.reduce(function(sum, value){ return sum + value; }, 0);
      var sortedIntervals = intervals.slice().sort(function(a,b){ return a-b; });
      probe.performance.frameSummary = {
        sampleCount: intervals.length,
        averageIntervalMs: Math.round(total / intervals.length * 100) / 100,
        approximateFps: Math.round(1000 / (total / intervals.length) * 10) / 10,
        p95IntervalMs: sortedIntervals[Math.min(sortedIntervals.length - 1, Math.floor(sortedIntervals.length * 0.95))],
        maxIntervalMs: sortedIntervals[sortedIntervals.length - 1]
      };
    }
    probe.finishedAt = Date.now();
    var node = document.createElement("pre");
    node.id = "playable-runtime-probe";
    node.style.display = "none";
    node.textContent = JSON.stringify(probe);
    (document.body || document.documentElement).appendChild(node);
  }, 4500);
})();
</script>
"""
    return (
        template.replace("__PLATFORM__", json.dumps(platform))
        .replace("__CTA_SELECTOR__", json.dumps(cta_selector))
        .replace("__DYNAMIC_IMAGE_ASSETS__", json.dumps(configured_image_assets or []))
    )


def inject_probe(html_text: str, script: str) -> str:
    match = re.search(r"<head(?:\s[^>]*)?>", html_text, re.IGNORECASE)
    if match:
        return html_text[:match.end()] + script + html_text[match.end():]
    html_match = re.search(r"<html(?:\s[^>]*)?>", html_text, re.IGNORECASE)
    if html_match:
        return html_text[:html_match.end()] + "<head>" + script + "</head>" + html_text[html_match.end():]
    return "<html><head>" + script + "</head><body>" + html_text + "</body></html>"


def prepare_runtime_copy(artifact_path: Path, platform: str, cta_selector: str | None, root: Path) -> tuple[Path, str]:
    artifact = load_artifact(str(artifact_path))
    if artifact.kind == "zip":
        safe_extract(artifact_path, root)
        if not artifact.main_html_path:
            raise ArtifactError("ZIP 中没有可运行主 HTML")
        main_relative = artifact.main_html_path
        main_path = root / main_relative
    else:
        main_relative = "index.html"
        main_path = root / main_relative
        shutil.copy2(artifact_path, main_path)

    original = main_path.read_text(encoding="utf-8-sig", errors="replace")
    configured_image_assets = [
        value for value in dynamic_image_asset_references(artifact.combined_text)
        if not is_container_safe_image_value(value)
    ]
    transformed = inject_probe(
        original,
        probe_script(platform, cta_selector, configured_image_assets),
    )
    main_path.write_text(transformed, encoding="utf-8")
    return main_path, main_relative


def run_server(root: Path) -> tuple[ThreadingHTTPServer, threading.Thread]:
    def handler(*args: object, **kwargs: object) -> QuietHandler:
        return QuietHandler(*args, directory=str(root), **kwargs)

    server = ThreadingHTTPServer(("127.0.0.1", 0), handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    return server, thread


def parse_probe(dom: str) -> dict | None:
    match = re.search(
        r"<pre\b[^>]*\bid=['\"]playable-runtime-probe['\"][^>]*>([\s\S]*?)</pre>",
        dom,
        re.IGNORECASE,
    )
    if not match:
        return None
    payload = html_module.unescape(match.group(1))
    try:
        value = json.loads(payload)
    except json.JSONDecodeError:
        return None
    return value if isinstance(value, dict) else None


def expected_bridge(platform: str) -> set[str]:
    mapping = {
        "applovin": {"mraid"},
        "unityads": {"mraid"},
        "moloco": {"fb-cta"},
        "meta": {"fb-cta"},
        "tiktok": {"open-app-store"},
        "mintegral": {"mintegral"},
        "google-ads": {"exit-api", "mraid"},
    }
    return mapping.get(platform, set())


def cta_capture(platform: str, probe: dict) -> dict:
    target = probe.get("ctaTarget") if isinstance(probe.get("ctaTarget"), dict) else {}
    dispatch = probe.get("ctaDispatch") if isinstance(probe.get("ctaDispatch"), dict) else {}
    trusted_inputs = [
        item for item in probe.get("ctaInputEvents") or []
        if isinstance(item, dict) and item.get("isTrusted") is True
    ]
    input_event = trusted_inputs[-1] if trusted_inputs else None
    input_at = int(input_event.get("atMs") or 0) if input_event else None
    bridges = [
        item for item in probe.get("bridgeCalls") or []
        if (
            isinstance(item, dict)
            and item.get("bridge") in expected_bridge(platform)
            and not item.get("beforeInteraction")
            and (input_at is None or int(item.get("atMs") or 0) >= input_at)
        )
    ]
    passed = bool(
        target.get("found") is True
        and target.get("actionable") is True
        and dispatch.get("inputMethod") in {"cdp-mouse", "cdp-touch"}
        and input_event
        and bridges
    )
    return {
        "hookInstalledBeforeBusinessScripts": True,
        "inputMethod": dispatch.get("inputMethod"),
        "isTrusted": input_event.get("isTrusted") if input_event else False,
        "target": target or None,
        "coordinates": (
            {"x": dispatch.get("x"), "y": dispatch.get("y")}
            if dispatch else None
        ),
        "gameplayStage": target.get("stage"),
        "expectedBridges": sorted(expected_bridge(platform)),
        "actualBridgeCalls": bridges,
        "inputEvent": input_event,
        "conclusion": "PASS" if passed else "FAIL",
        "userConclusion": (
            "浏览器可信输入已触发当前平台 CTA"
            if passed else
            "未能用浏览器可信输入触发当前平台 CTA，必须修复后重建"
        ),
    }


def lifecycle_capture(platform: str, probe: dict) -> dict | None:
    if platform != "mintegral":
        return None
    calls = [
        item for item in probe.get("bridgeCalls") or []
        if isinstance(item, dict) and item.get("bridge") in {"mintegral", "mintegral-lifecycle"}
    ]
    install_calls = [item for item in calls if item.get("bridge") == "mintegral" and item.get("method") == "install"]
    ready_calls = [item for item in calls if item.get("method") == "gameReady"]
    start_calls = [item for item in calls if item.get("method") == "gameStart"]
    end_calls = [item for item in calls if item.get("method") == "gameEnd"]
    ready_at = min((int(item.get("atMs") or 0) for item in ready_calls), default=None)
    start_at = min((int(item.get("atMs") or 0) for item in start_calls), default=None)
    end_at = min((int(item.get("atMs") or 0) for item in end_calls), default=None)
    sequence_ok = bool(
        ready_at is not None
        and start_at is not None
        and end_at is not None
        and start_at >= ready_at
        and end_at >= start_at
    )
    passed = bool(install_calls and sequence_ok)
    return {
        "installCaptured": bool(install_calls),
        "gameReadyAtMs": ready_at,
        "gameStartAtMs": start_at,
        "gameEndAtMs": end_at,
        "sequenceValid": sequence_ok,
        "calls": calls,
        "conclusion": "PASS" if passed else "FAIL",
        "userConclusion": (
            "已捕获 install 和 gameReady → gameStart → gameEnd 的真实调用顺序"
            if passed else
            "未完整捕获 Mintegral CTA 或生命周期，必须修复后重建"
        ),
    }


def check_result(rule_id: str, title: str, passed: bool, severity: str, summary: str, evidence: list[object] | None = None) -> dict:
    if passed:
        status = "pass"
    elif severity == "manual":
        status = "manual"
    elif severity == "blocker":
        status = "fail"
    else:
        status = "warning"
    return {
        "id": rule_id,
        "title": title,
        "severity": severity,
        "status": status,
        "summary": summary,
        "evidence": evidence or [],
    }


def performance_assessment(performance: dict, thresholds: dict | None) -> dict:
    frame = performance.get("frameSummary") or {}
    navigation = performance.get("navigation") or {}
    long_tasks = performance.get("longTasks") or []
    collected = bool(frame or navigation or isinstance(long_tasks, list))
    metrics = {
        "maxLongTaskMs": max((float(item.get("durationMs", 0)) for item in long_tasks if isinstance(item, dict)), default=0.0),
        "p95FrameIntervalMs": frame.get("p95IntervalMs"),
        "approximateFps": frame.get("approximateFps"),
        "domContentLoadedMs": navigation.get("domContentLoadedMs"),
    }
    if not thresholds:
        return {
            "dataCollected": collected,
            "thresholdsConfigured": False,
            "thresholdStatus": "NOT_CONFIGURED",
            "metrics": metrics,
            "thresholds": {},
            "violations": [],
            "userConclusion": "性能数据已采样，尚未判定是否合格，需代表设备确认" if collected else "当前未采集到稳定性能数据，需代表设备确认",
        }
    comparisons = {
        "maxLongTaskMs": (metrics["maxLongTaskMs"], "max"),
        "maxP95FrameIntervalMs": (metrics["p95FrameIntervalMs"], "max"),
        "minApproximateFps": (metrics["approximateFps"], "min"),
        "maxDomContentLoadedMs": (metrics["domContentLoadedMs"], "max"),
    }
    violations = []
    for name, limit in thresholds.items():
        if name not in comparisons:
            violations.append({"threshold": name, "reason": "不支持的阈值名称"})
            continue
        actual, direction = comparisons[name]
        if actual is None:
            violations.append({"threshold": name, "limit": limit, "reason": "本轮没有采集到对应数据"})
        elif (direction == "max" and actual > limit) or (direction == "min" and actual < limit):
            violations.append({"threshold": name, "limit": limit, "actual": actual, "reason": "超出已批准阈值"})
    passed = collected and not violations
    return {
        "dataCollected": collected,
        "thresholdsConfigured": True,
        "thresholdStatus": "PASS" if passed else "FAIL",
        "metrics": metrics,
        "thresholds": thresholds,
        "violations": violations,
        "userConclusion": "性能检查通过已批准阈值" if passed else "性能数据未满足已批准阈值，必须修复并重建",
    }


def analyze_probe(platform: str, probe: dict, cta_selector: str | None, thresholds: dict | None = None) -> tuple[list[dict], dict, str]:
    checks: list[dict] = []
    errors = list(probe.get("errors") or [])
    console_errors = list(probe.get("consoleErrors") or [])
    checks.append(check_result(
        "RUNTIME-COMMON-001",
        "无 JavaScript 与 console error",
        not errors and not console_errors,
        "blocker",
        "未观察到运行时异常" if not errors and not console_errors else "观察到运行时异常",
        errors + console_errors,
    ))

    audio = list(probe.get("audioBeforeInteraction") or [])
    checks.append(check_result(
        "RUNTIME-COMMON-002",
        "用户交互前无音频播放",
        not audio,
        "blocker",
        "未观察到交互前音频" if not audio else "观察到交互前音频",
        audio,
    ))

    early_bridges = [
        item for item in probe.get("bridgeCalls", [])
        if item.get("beforeInteraction") and item.get("bridge") in {
            "mraid", "fb-cta", "exit-api", "open-app-store", "mintegral", "window"
        }
    ]
    checks.append(check_result(
        "RUNTIME-COMMON-003",
        "用户交互前无 CTA 或跳转",
        not early_bridges,
        "blocker",
        "未观察到交互前 CTA" if not early_bridges else "观察到交互前 CTA 或跳转",
        early_bridges,
    ))

    render = probe.get("render") or {}
    rendered = (
        int(render.get("bodyTextLength") or 0) > 0
        or int(render.get("canvasCount") or 0) > 0
        or int(render.get("childElementCount") or 0) > 0
    )
    checks.append(check_result(
        "RUNTIME-COMMON-004",
        "页面产生基础渲染",
        rendered,
        "blocker",
        "页面包含文本、Canvas 或 DOM 内容" if rendered else "页面未产生可识别内容",
        [render],
    ))

    broken = list(render.get("brokenImages") or [])
    checks.append(check_result(
        "RUNTIME-COMMON-005",
        "无已加载失败图片",
        not broken,
        "blocker",
        "未观察到破图" if not broken else "观察到破图",
        broken,
    ))

    if platform in {"google-ads", "meta"}:
        dynamic_images = probe.get("dynamicImages") or {}
        instrumented = (
            dynamic_images.get("propertySetterInstrumented") is True
            and dynamic_images.get("setAttributeInstrumented") is True
        )
        assignments = list(dynamic_images.get("assignments") or [])
        configured_assets = {
            str(value).strip().lstrip("./")
            for value in dynamic_images.get("configuredAssets") or []
            if str(value).strip()
        }

        def targets_configured_asset(item: dict) -> bool:
            value = str(item.get("value") or "").strip()
            without_query = re.split(r"[?#]", value, maxsplit=1)[0]
            normalized = without_query.lstrip("./")
            return any(
                normalized == asset or normalized.endswith("/" + asset)
                for asset in configured_assets
            )

        unsafe_assignments = [
            item for item in assignments
            if (
                str(item.get("scheme") or "other") not in {"data", "blob"}
                and targets_configured_asset(item)
            )
        ]
        dropped = int(dynamic_images.get("droppedAssignments") or 0)
        safe = instrumented and not unsafe_assignments and dropped == 0
        if not instrumented:
            summary_text = "动态图片探针未完整安装，不能证明容器安全"
        elif dropped:
            summary_text = f"动态图片赋值超过探针上限，丢弃 {dropped} 条，不能完整证明配置图片安全"
        elif unsafe_assignments:
            summary_text = f"观察到 {len(unsafe_assignments)} 次 imageAsset 配置图片的非 data/blob 赋值"
        elif not configured_assets:
            summary_text = "未检测到 imageAsset 配置；动态图片探针已完整安装"
        else:
            summary_text = f"{len(configured_assets)} 个 imageAsset 配置未观察到不安全动态赋值"
        checks.append(check_result(
            "RUNTIME-DYNAMIC-IMG-001",
            "Google/Meta 配置驱动动态图片使用容器安全地址",
            safe,
            "blocker",
            summary_text,
            [{
                "propertySetterInstrumented": dynamic_images.get("propertySetterInstrumented") is True,
                "setAttributeInstrumented": dynamic_images.get("setAttributeInstrumented") is True,
                "configuredAssets": sorted(configured_assets),
                "unsafeAssignments": unsafe_assignments,
                "assignmentCount": len(assignments),
                "droppedAssignments": dropped,
            }],
        ))

    if platform in {"applovin", "unityads"}:
        mraid = probe.get("mraid") or {}
        listeners = mraid.get("listeners") or {}
        mraid_ok = (
            int(mraid.get("getStateCalls") or 0) > 0
            and int(mraid.get("isViewableCalls") or 0) > 0
            and int(listeners.get("viewableChange") or 0) > 0
        )
        checks.append(check_result(
            "RUNTIME-MRAID-001",
            "MRAID ready/viewable 运行时接入",
            mraid_ok,
            "blocker",
            "观察到 getState、isViewable 与 viewableChange" if mraid_ok else "MRAID 运行时接入不完整",
            [mraid],
        ))
        if platform == "unityads":
            size_ok = int(listeners.get("sizeChange") or 0) > 0
            checks.append(check_result(
                "RUNTIME-UNITY-001",
                "UnityAds sizeChange 监听",
                size_ok,
                "blocker",
                "观察到 sizeChange listener" if size_ok else "未观察到 sizeChange listener",
                [listeners],
            ))

    if platform == "applovin":
        events = list(probe.get("analyticsEvents") or [])
        checks.append(check_result(
            "RUNTIME-APL-001",
            "AppLovin 事件运行时调用",
            bool(events),
            "warning",
            "观察到 ALPlayableAnalytics 事件" if events else "短时探针未观察到事件，需完整玩法复核",
            events,
        ))

    if platform == "mintegral":
        definitions = probe.get("lifecycleDefinitions") or {}
        lifecycle_names = [
            "install", "gameReady", "gameStart", "gameEnd", "gameClose", "gameRetry",
        ]
        missing = [name for name in lifecycle_names if definitions.get(name) is not True]
        checks.append(check_result(
            "RUNTIME-MINTEGRAL-001",
            "Mintegral 生命周期函数真实暴露",
            not missing,
            "blocker",
            "全部生命周期函数在运行时暴露" if not missing else "生命周期函数未全部暴露",
            missing,
        ))

        lifecycle_calls = [
            item for item in probe.get("bridgeCalls", [])
            if item.get("bridge") == "mintegral-lifecycle"
            and item.get("method") in {"gameReady", "gameStart", "gameEnd"}
        ]
        ready_calls = [item for item in lifecycle_calls if item.get("method") == "gameReady"]
        start_calls = [item for item in lifecycle_calls if item.get("method") == "gameStart"]
        end_calls = [item for item in lifecycle_calls if item.get("method") == "gameEnd"]
        ready_at = min((int(item.get("atMs") or 0) for item in ready_calls), default=None)
        start_at = min((int(item.get("atMs") or 0) for item in start_calls), default=None)
        end_at = min((int(item.get("atMs") or 0) for item in end_calls), default=None)
        sequence_ok = (
            ready_at is not None
            and start_at is not None
            and end_at is not None
            and start_at >= ready_at
            and end_at >= start_at
        )
        if ready_at is None:
            lifecycle_summary = "未观察到 gameReady() 真实调用"
        elif start_at is None:
            lifecycle_summary = "已观察到 gameReady()，但未观察到 gameStart() 真实调用"
        elif start_at < ready_at:
            lifecycle_summary = "gameStart() 早于 gameReady()，生命周期顺序错误"
        elif end_at is None:
            lifecycle_summary = "已观察到 gameReady() 和 gameStart()，但未观察到 gameEnd() 真实调用"
        elif end_at < start_at:
            lifecycle_summary = "gameEnd() 早于 gameStart()，生命周期顺序错误"
        else:
            lifecycle_summary = "已观察到 gameReady() → gameStart() → gameEnd() 的真实调用顺序"
        checks.append(check_result(
            "RUNTIME-MINTEGRAL-002",
            "Mintegral 生命周期真实调用顺序",
            sequence_ok,
            "blocker",
            lifecycle_summary,
            lifecycle_calls,
        ))

    if cta_selector:
        capture = cta_capture(platform, probe)
        found = bool((capture.get("target") or {}).get("found"))
        checks.append(check_result(
            "RUNTIME-CTA-001",
            "CTA 处于浏览器可操作状态",
            found,
            "blocker",
            "已定位可见且可操作的 CTA" if found else "未找到可见且可操作的 CTA",
            [capture.get("target") or {"requestedSelector": cta_selector}],
        ))
        checks.append(check_result(
            "RUNTIME-CTA-002",
            "浏览器可信输入触发目标平台桥接",
            capture["conclusion"] == "PASS",
            "blocker",
            capture["userConclusion"],
            [capture],
        ))

    performance = probe.get("performance") or {}
    frame_summary = performance.get("frameSummary") or {}
    long_tasks = performance.get("longTasks") or []
    performance_available = bool(frame_summary or performance.get("navigation") or isinstance(long_tasks, list))
    assessment = performance_assessment(performance, thresholds)
    checks.append(check_result(
        "RUNTIME-PERF-001",
        "候选包性能 smoke",
        assessment["thresholdStatus"] == "PASS",
        "blocker" if assessment["thresholdsConfigured"] else "manual",
        assessment["userConclusion"],
        [performance, assessment],
    ))

    summary = {"pass": 0, "warning": 0, "manual": 0, "fail": 0}
    for check in checks:
        summary[check["status"]] += 1
    conclusion = "FAIL" if summary["fail"] else ("REVIEW" if summary["warning"] else "PASS")
    return checks, summary, conclusion


def write_report(path_value: str, report: dict) -> None:
    path = Path(path_value).expanduser().resolve()
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def captured_text(value: str | bytes | None) -> str:
    if value is None:
        return ""
    if isinstance(value, bytes):
        return value.decode("utf-8", errors="replace")
    return value


def unavailable_report(args: argparse.Namespace, artifact: dict | None, ruleset: dict | None, reason: str) -> dict:
    return {
        "schemaVersion": "playable-runtime-report-v1",
        "generatedAt": datetime.now().astimezone().isoformat(timespec="seconds"),
        "platform": args.platform,
        "checkBatchId": args.check_batch_id,
        "artifact": artifact,
        "ruleset": ruleset,
        "browser": None,
        "checks": [],
        "summary": {"pass": 0, "warning": 1, "fail": 0},
        "conclusion": "UNAVAILABLE",
        "reason": reason,
    }


def main() -> int:
    args = parse_args()
    thresholds = None
    cta_selector = args.cta_selector
    if args.adapter:
        try:
            adapter = load_json(args.adapter.expanduser().resolve())
            raw_thresholds = adapter.get("performanceThresholds") if isinstance(adapter, dict) else None
            if raw_thresholds is not None:
                if not isinstance(raw_thresholds, dict) or not raw_thresholds or not all(isinstance(value, (int, float)) and value >= 0 for value in raw_thresholds.values()):
                    raise ValueError("Adapter performanceThresholds 必须是非空的非负数值对象")
                thresholds = raw_thresholds
            platform_build = ((adapter.get("platformBuilds") or {}).get(args.platform) or {}) if isinstance(adapter, dict) else {}
            adapter_selector = platform_build.get("ctaSelector") if isinstance(platform_build, dict) else None
            if cta_selector is None and isinstance(adapter_selector, str) and adapter_selector.strip():
                cta_selector = adapter_selector.strip()
        except (OSError, ValueError, json.JSONDecodeError) as exc:
            report = unavailable_report(args, None, None, str(exc))
            report["conclusion"] = "FAIL"
            report["summary"] = {"pass": 0, "warning": 0, "manual": 0, "fail": 1}
            write_report(args.output, report)
            print(json.dumps(report, ensure_ascii=False, indent=2))
            return 1
    try:
        artifact = load_artifact(args.artifact)
        verification, _ = load_platform_rules(args.platform)
    except (ArtifactError, RulesetError, OSError) as exc:
        report = unavailable_report(args, None, None, str(exc))
        report["conclusion"] = "FAIL"
        report["summary"] = {"pass": 0, "warning": 0, "fail": 1}
        write_report(args.output, report)
        print(json.dumps(report, ensure_ascii=False, indent=2))
        return 1

    ruleset = {
        "rulesetVersion": verification["rulesetVersion"],
        "rulesetSha256": verification["rulesetSha256"],
    }
    write_report(args.output, {
        "schemaVersion": "playable-runtime-report-v1",
        "generatedAt": datetime.now().astimezone().isoformat(timespec="seconds"),
        "status": "CHECKING",
        "platform": args.platform,
        "checkBatchId": args.check_batch_id,
        "artifact": artifact.to_report_dict(),
        "ruleset": ruleset,
        "checks": [],
        "summary": {"pass": 0, "warning": 0, "manual": 0, "fail": 0},
        "conclusion": "IN_PROGRESS",
    })
    chrome = find_chrome(args.chrome)
    if not chrome:
        report = unavailable_report(args, artifact.to_report_dict(), ruleset, "未找到可执行的 Chrome/Chromium")
        write_report(args.output, report)
        print(json.dumps(report, ensure_ascii=False, indent=2))
        return 3

    with tempfile.TemporaryDirectory(prefix="playable-runtime-") as temp_value:
        temp_root = Path(temp_value)
        site_root = temp_root / "site"
        profile_root = temp_root / "profile"
        site_root.mkdir()
        profile_root.mkdir()
        try:
            _, main_relative = prepare_runtime_copy(
                Path(args.artifact).expanduser().resolve(),
                args.platform,
                cta_selector,
                site_root,
            )
        except (ArtifactError, OSError, zipfile.BadZipFile) as exc:
            report = unavailable_report(args, artifact.to_report_dict(), ruleset, str(exc))
            report["conclusion"] = "FAIL"
            report["summary"] = {"pass": 0, "warning": 0, "fail": 1}
            write_report(args.output, report)
            print(json.dumps(report, ensure_ascii=False, indent=2))
            return 1

        server, thread = run_server(site_root)
        browser_timed_out = False
        driver_result: dict = {}
        try:
            port = server.server_address[1]
            url_path = "/".join(quote(part) for part in Path(main_relative).parts)
            url = f"http://127.0.0.1:{port}/{url_path}"
            node = shutil.which("node")
            if not node:
                report = unavailable_report(args, artifact.to_report_dict(), ruleset, "未找到可执行的 Node.js，无法驱动浏览器可信输入")
                write_report(args.output, report)
                print(json.dumps(report, ensure_ascii=False, indent=2))
                return 3
            driver_output = temp_root / "browser-probe.json"
            command = [
                node,
                str(Path(__file__).resolve().parent / "runtime_browser_probe.mjs"),
                "--chrome", chrome,
                "--url", url,
                "--profile", str(profile_root),
                "--output", str(driver_output),
                "--timeout-ms", str(max(5000, args.timeout_seconds * 1000)),
            ]
            if cta_selector:
                command.extend(["--cta-selector", cta_selector])
            if args.disable_webgl:
                command.append("--disable-webgl")
            try:
                completed = subprocess.run(
                    command,
                    capture_output=True,
                    text=True,
                    timeout=max(8, args.timeout_seconds + 3),
                    check=False,
                )
            except subprocess.TimeoutExpired as exc:
                completed = subprocess.CompletedProcess(
                    command,
                    124,
                    captured_text(exc.stdout),
                    captured_text(exc.stderr),
                )
                browser_timed_out = True
            except OSError as exc:
                report = unavailable_report(args, artifact.to_report_dict(), ruleset, f"浏览器执行失败: {exc}")
                write_report(args.output, report)
                print(json.dumps(report, ensure_ascii=False, indent=2))
                return 3
            if driver_output.is_file():
                try:
                    loaded_driver = load_json(driver_output)
                    if isinstance(loaded_driver, dict):
                        driver_result = loaded_driver
                except (OSError, json.JSONDecodeError):
                    driver_result = {}
        finally:
            server.shutdown()
            server.server_close()
            thread.join(timeout=2)

    probe = driver_result.get("probe") if isinstance(driver_result.get("probe"), dict) else None
    if probe is None:
        report = unavailable_report(
            args,
            artifact.to_report_dict(),
            ruleset,
            "未获取运行时探针；可能被 CSP、浏览器崩溃、页面提前跳转或可信输入驱动异常阻止",
        )
        report["browser"] = {
            "path": chrome,
            "exitCode": completed.returncode,
            "timedOut": browser_timed_out,
            "stderrTail": (completed.stderr + "\n" + str(driver_result.get("error") or ""))[-4000:],
        }
        write_report(args.output, report)
        print(json.dumps(report, ensure_ascii=False, indent=2))
        return 3

    checks, summary, conclusion = analyze_probe(args.platform, probe, cta_selector or "AUTO", thresholds)
    assessment = performance_assessment(probe.get("performance") or {}, thresholds)
    cta = cta_capture(args.platform, probe)
    lifecycle = lifecycle_capture(args.platform, probe)
    report = {
        "schemaVersion": "playable-runtime-report-v1",
        "generatedAt": datetime.now().astimezone().isoformat(timespec="seconds"),
        "platform": args.platform,
        "checkBatchId": args.check_batch_id,
        "artifact": artifact.to_report_dict(),
        "ruleset": ruleset,
        "browser": {
            "path": chrome,
            "exitCode": completed.returncode,
            "timedOut": browser_timed_out,
            "disableWebGL": args.disable_webgl,
            "stderrTail": (completed.stderr + "\n" + str((driver_result.get("browser") or {}).get("stderrTail") or ""))[-4000:],
        },
        "probe": probe,
        "ctaCapture": cta,
        "lifecycleCapture": lifecycle,
        "performanceAssessment": assessment,
        "checks": checks,
        "summary": summary,
        "conclusion": conclusion,
    }
    write_report(args.output, report)
    print(json.dumps(report, ensure_ascii=False, indent=2))
    if conclusion == "FAIL":
        return 1
    if conclusion == "REVIEW":
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
