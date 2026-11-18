#!/usr/bin/env node
// Injects a self-contained performance HUD into an exported single-HTML
// playable so a real device can be measured without a remote debugger.
//
//   node scripts/inject-perf-hud.mjs <input.html> <output.html> [--label "BL optimized"]
//
// Why a HUD and not a separate test page: a phone cannot reach
// `window.__busLoop.view.renderer.info`, and a separate page would load the ad
// in an iframe where cross-document access is blocked under file:// and
// unreliable under mixed origins. Injecting into the artifact keeps every
// measurement on the same page and the same frame loop the player sees.
//
// The HUD reads only public runtime surfaces:
//   - `requestAnimationFrame` deltas  -> fps, frame-time percentiles, jank
//   - `view.renderer.info.render`     -> draw calls, triangles, lines
//   - `performance.memory`            -> JS heap (Chromium only)
// A package whose runtime never exposes the renderer still gets frame timing.

import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const args = process.argv.slice(2);
const positional = args.filter((arg) => !arg.startsWith('--'));
const flag = (name, fallback = null) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] : fallback;
};

const [inputPath, outputPath] = positional;
if (!inputPath || !outputPath) {
  console.error('Usage: node scripts/inject-perf-hud.mjs <input.html> <output.html> [--label "text"]');
  process.exit(2);
}

const label = flag('label', path.basename(inputPath));

// The HUD is written as one IIFE. It must never contain the literal
// `</script` sequence, or the HTML parser would close the tag early.
const HUD_SCRIPT = String.raw`
(function () {
  'use strict';
  var LABEL = __LABEL__;
  var WINDOW_MS = 5000;
  var samples = [];
  var lastFrame = 0;
  var startedAt = performance.now();
  var frameCount = 0;
  var longFrames = { over17: 0, over33: 0, over50: 0 };
  var collapsed = false;

  function percentile(sorted, p) {
    if (!sorted.length) return 0;
    var index = Math.min(sorted.length - 1, Math.floor(sorted.length * p));
    return sorted[index];
  }

  function readRenderer() {
    var api = window.__busLoop;
    var view = api && api.view;
    var renderer = view && view.renderer;
    if (!renderer || !renderer.info) return null;
    var info = renderer.info;
    return {
      calls: info.render ? info.render.calls : null,
      triangles: info.render ? info.render.triangles : null,
      lines: info.render ? info.render.lines : null,
      programs: info.programs ? info.programs.length : null,
      geometries: info.memory ? info.memory.geometries : null,
      textures: info.memory ? info.memory.textures : null,
      pixelRatio: renderer.getPixelRatio ? renderer.getPixelRatio() : null,
      width: renderer.domElement ? renderer.domElement.width : null,
      height: renderer.domElement ? renderer.domElement.height : null
    };
  }

  function readHeap() {
    var memory = performance.memory;
    if (!memory) return null;
    return Math.round((memory.usedJSHeapSize / 1048576) * 10) / 10;
  }

  var root = document.createElement('div');
  root.id = 'perf-hud';
  root.style.cssText = [
    'position:fixed', 'left:0', 'top:0', 'z-index:2147483647',
    'font:11px/1.45 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace',
    'color:#e8ffe8', 'background:rgba(6,12,20,.86)', 'padding:6px 8px',
    'border-radius:0 0 8px 0', 'pointer-events:auto', 'user-select:none',
    'text-shadow:0 1px 2px #000', 'white-space:pre', 'letter-spacing:.02em'
  ].join(';');
  root.addEventListener('click', function () {
    collapsed = !collapsed;
    if (collapsed) root.style.padding = '2px 5px';
    else root.style.padding = '6px 8px';
    render();
  });

  // Long-press copies the current readings as plain text, so a tester can paste
  // them into a chat instead of transcribing a screenshot.
  var pressTimer = 0;
  function copyReport() {
    var now = performance.now();
    var windowed = samples.filter(function (entry) { return now - entry.t <= WINDOW_MS; });
    var times = windowed.map(function (entry) { return entry.dt; }).sort(function (a, b) { return a - b; });
    var avg = times.length ? times.reduce(function (a, b) { return a + b; }, 0) / times.length : 0;
    var renderer = readRenderer() || {};
    var report = [
      'PERF ' + LABEL,
      'fps=' + (avg ? (1000 / avg).toFixed(1) : '--'),
      'avgMs=' + (avg ? avg.toFixed(2) : '--'),
      'p50=' + percentile(times, 0.5).toFixed(2),
      'p95=' + percentile(times, 0.95).toFixed(2),
      'max=' + (times.length ? times[times.length - 1].toFixed(2) : '--'),
      'drawCalls=' + (renderer.calls == null ? '--' : renderer.calls),
      'triangles=' + (renderer.triangles == null ? '--' : renderer.triangles),
      'pixelRatio=' + window.devicePixelRatio,
      'canvas=' + renderer.width + 'x' + renderer.height,
      'screen=' + screen.width + 'x' + screen.height,
      'ua=' + navigator.userAgent,
      'runSeconds=' + Math.round((now - startedAt) / 1000)
    ].join('\n');
    var done = function () {
      root.style.background = 'rgba(20,90,40,.95)';
      setTimeout(function () { root.style.background = 'rgba(6,12,20,.86)'; }, 600);
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(report).then(done, function () {
        window.prompt('性能数据（手动复制）', report);
      });
    } else {
      window.prompt('性能数据（手动复制）', report);
    }
  }
  root.addEventListener('pointerdown', function () {
    pressTimer = setTimeout(copyReport, 700);
  });
  ['pointerup', 'pointercancel', 'pointerleave'].forEach(function (name) {
    root.addEventListener(name, function () { clearTimeout(pressTimer); });
  });

  function line(text, color) {
    return '<div style="color:' + (color || '#e8ffe8') + '">' + text + '</div>';
  }

  function render() {
    if (collapsed) {
      root.innerHTML = 'perf ' + fpsText();
      return;
    }
    var now = performance.now();
    var windowed = samples.filter(function (entry) { return now - entry.t <= WINDOW_MS; });
    var times = windowed.map(function (entry) { return entry.dt; }).sort(function (a, b) { return a - b; });
    var avg = times.length ? times.reduce(function (a, b) { return a + b; }, 0) / times.length : 0;
    var renderer = readRenderer();
    var heap = readHeap();
    var elapsed = Math.round((now - startedAt) / 1000);
    var jank = frameCount ? (longFrames.over33 / frameCount) * 100 : 0;

    var html = '';
    html += line('PERF ' + LABEL, '#9fe3ff');
    html += line('fps ' + (avg ? (1000 / avg).toFixed(1) : '--') +
      '   avg ' + (avg ? avg.toFixed(1) : '--') + 'ms');
    html += line('p50 ' + percentile(times, 0.5).toFixed(1) +
      '  p95 ' + percentile(times, 0.95).toFixed(1) +
      '  max ' + (times.length ? times[times.length - 1].toFixed(1) : '--'));
    if (renderer) {
      html += line('draw ' + (renderer.calls == null ? '--' : renderer.calls) +
        '   tri ' + (renderer.triangles == null ? '--' : Math.round(renderer.triangles / 1000) + 'k'));
      html += line('geo ' + renderer.geometries + '  tex ' + renderer.textures +
        '  prog ' + renderer.programs, '#bfe8bf');
      html += line('canvas ' + renderer.width + 'x' + renderer.height + ' @' + renderer.pixelRatio, '#bfe8bf');
    } else {
      html += line('renderer not exposed', '#ffb86b');
    }
    html += line('jank>33ms ' + jank.toFixed(1) + '%  (' + longFrames.over33 + '/' + frameCount + ')',
      jank > 5 ? '#ff9a9a' : '#bfe8bf');
    html += line('run ' + elapsed + 's' + (heap == null ? '' : '  heap ' + heap + 'MB'), '#9aa8b8');
    html += line('dpr ' + window.devicePixelRatio + '  ' + screen.width + 'x' + screen.height, '#9aa8b8');
    html += line('tap to ' + (collapsed ? 'expand' : 'collapse'), '#6b7b8c');
    root.innerHTML = html;
  }

  function fpsText() {
    var now = performance.now();
    var recent = samples.filter(function (entry) { return now - entry.t <= 2000; });
    if (!recent.length) return '--';
    var avg = recent.reduce(function (a, b) { return a + b.dt; }, 0) / recent.length;
    return (1000 / avg).toFixed(0);
  }

  function tick(now) {
    if (lastFrame) {
      var dt = now - lastFrame;
      // Ignore the tab-switch / pre-roll pause spikes: a 2 s gap is a stall, not
      // a rendered frame, and it would poison every percentile.
      if (dt > 0 && dt < 2000) {
        samples.push({ t: now, dt: dt });
        frameCount += 1;
        if (dt > 17) longFrames.over17 += 1;
        if (dt > 33) longFrames.over33 += 1;
        if (dt > 50) longFrames.over50 += 1;
        if (samples.length > 4000) samples.shift();
      }
    }
    lastFrame = now;
    requestAnimationFrame(tick);
  }

  // The script is injected into <head>, so document.body does not exist yet.
  // Mounting on DOMContentLoaded (with a body-appeared fallback) is what keeps
  // the HUD alive on a page whose runtime boots before <body> is parsed.
  function mount() {
    if (document.getElementById('perf-hud')) return;
    (document.body || document.documentElement).appendChild(root);
    render();
  }
  if (document.body) mount();
  else if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mount, { once: true });
  } else {
    mount();
  }
  // The playable may replace or hide overlays during pre-roll; re-assert the HUD.
  setInterval(function () {
    if (!root.isConnected) mount();
  }, 2000);

  setInterval(render, 400);
  requestAnimationFrame(tick);
})();
`;

const html = await readFile(inputPath, 'utf8');

// Serialise the label safely into the injected IIFE.
const script = HUD_SCRIPT.replace('__LABEL__', JSON.stringify(String(label)));
if (script.includes('</script')) {
  throw new Error('Injected HUD contains a script-closing sequence.');
}

const headEnd = html.indexOf('</head>');
if (headEnd === -1) throw new Error('Input HTML has no </head> to inject before.');

const output = `${html.slice(0, headEnd)}    <script>${script}</script>\n  ${html.slice(headEnd)}`;
await writeFile(outputPath, output, 'utf8');

const delta = Buffer.byteLength(output) - Buffer.byteLength(html);
console.log(`Injected perf HUD "${label}" into ${path.basename(outputPath)} (+${delta} bytes).`);
