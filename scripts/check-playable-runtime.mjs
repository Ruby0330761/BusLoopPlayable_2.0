#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { access, cp, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { constants as fsConstants } from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateRawSync, inflateSync } from 'node:zlib';

const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_VIEWPORT = Object.freeze({ width: 390, height: 844 });
const SUPPORTED_PLATFORMS = new Set([
  'applovin',
  'google-ads',
  'meta',
  'unityads',
  'mintegral',
  'moloco',
  'tiktok'
]);
const HOSTED_SDK_PATTERNS = [
  'https://tpc.googlesyndication.com/*',
  'https://sf16-muse-va.ibytedtos.com/*'
];
const MIME_TYPES = Object.freeze({
  '.css': 'text/css; charset=utf-8',
  '.gif': 'image/gif',
  '.html': 'text/html; charset=utf-8',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2'
});

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function exists(filePath, mode = fsConstants.F_OK) {
  try {
    await access(filePath, mode);
    return true;
  } catch {
    return false;
  }
}

export async function findChromeExecutable(explicitPath) {
  const candidates = [
    explicitPath,
    process.env.PLAYABLE_CHROME_BIN,
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    process.platform === 'win32' ? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe' : null,
    process.platform === 'win32' ? 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe' : null
  ].filter(Boolean);
  for (const candidate of candidates) {
    if (await exists(path.resolve(candidate), fsConstants.X_OK)) return path.resolve(candidate);
  }
  return null;
}

function safeRelativePath(value) {
  const normalized = value.replaceAll('\\', '/');
  if (!normalized || normalized.startsWith('/') || /^[A-Za-z]:/.test(normalized)) return null;
  const parts = normalized.split('/').filter(Boolean);
  if (parts.some((part) => part === '..')) return null;
  return parts.join('/');
}

async function extractZip(zipPath, destination) {
  const source = await readFile(zipPath);
  let eocdOffset = -1;
  for (let offset = source.length - 22; offset >= Math.max(0, source.length - 65_557); offset -= 1) {
    if (source.readUInt32LE(offset) === 0x06054b50) {
      eocdOffset = offset;
      break;
    }
  }
  if (eocdOffset < 0) throw new Error('ZIP 缺少有效的中央目录。');
  const entryCount = source.readUInt16LE(eocdOffset + 10);
  let cursor = source.readUInt32LE(eocdOffset + 16);
  const seen = new Set();
  for (let index = 0; index < entryCount; index += 1) {
    if (source.readUInt32LE(cursor) !== 0x02014b50) throw new Error('ZIP 中央目录损坏。');
    const flags = source.readUInt16LE(cursor + 8);
    const method = source.readUInt16LE(cursor + 10);
    const compressedSize = source.readUInt32LE(cursor + 20);
    const uncompressedSize = source.readUInt32LE(cursor + 24);
    const nameLength = source.readUInt16LE(cursor + 28);
    const extraLength = source.readUInt16LE(cursor + 30);
    const commentLength = source.readUInt16LE(cursor + 32);
    const localOffset = source.readUInt32LE(cursor + 42);
    const name = source.subarray(cursor + 46, cursor + 46 + nameLength).toString((flags & 0x800) ? 'utf8' : 'latin1');
    cursor += 46 + nameLength + extraLength + commentLength;
    const relative = safeRelativePath(name);
    if (!relative || seen.has(relative)) throw new Error(`ZIP 包含不安全或重复路径: ${name}`);
    seen.add(relative);
    const outputPath = path.join(destination, relative);
    if (name.endsWith('/')) {
      await mkdir(outputPath, { recursive: true });
      continue;
    }
    if (flags & 0x1) throw new Error(`ZIP 条目已加密，无法验证运行时: ${name}`);
    if (source.readUInt32LE(localOffset) !== 0x04034b50) throw new Error(`ZIP 本地条目损坏: ${name}`);
    const localNameLength = source.readUInt16LE(localOffset + 26);
    const localExtraLength = source.readUInt16LE(localOffset + 28);
    const dataOffset = localOffset + 30 + localNameLength + localExtraLength;
    const compressed = source.subarray(dataOffset, dataOffset + compressedSize);
    let content;
    if (method === 0) content = compressed;
    else if (method === 8) content = inflateRawSync(compressed);
    else throw new Error(`ZIP 使用不支持的压缩方法 ${method}: ${name}`);
    if (content.length !== uncompressedSize) throw new Error(`ZIP 条目解压长度不匹配: ${name}`);
    await mkdir(path.dirname(outputPath), { recursive: true });
    await writeFile(outputPath, content);
  }
}

async function walkFiles(root, relative = '') {
  const entries = await readdir(path.join(root, relative), { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (entry.name === '__MACOSX' || entry.name === '.DS_Store') continue;
    const child = path.join(relative, entry.name);
    if (entry.isDirectory()) files.push(...await walkFiles(root, child));
    else if (entry.isFile()) files.push(child);
  }
  return files;
}

export async function resolveMainHtml(siteRoot) {
  const files = await walkFiles(siteRoot);
  const htmlFiles = files.filter((file) => /\.html?$/i.test(file));
  if (!htmlFiles.length) throw new Error('产物中没有可运行的 HTML 入口。');
  const rootIndex = htmlFiles.find((file) => file.replaceAll('\\', '/') === 'index.html');
  if (rootIndex) return rootIndex;
  const nestedIndex = htmlFiles.find((file) => path.basename(file).toLowerCase() === 'index.html');
  if (nestedIndex) return nestedIndex;
  if (htmlFiles.length === 1) return htmlFiles[0];
  const folderNamed = htmlFiles.find((file) => {
    const parsed = path.parse(file);
    return parsed.name.toLowerCase() === path.basename(parsed.dir).toLowerCase();
  });
  if (folderNamed) return folderNamed;
  throw new Error(`产物存在多个 HTML，无法确定入口: ${htmlFiles.join(', ')}`);
}

async function prepareSite(artifactPath, tempRoot) {
  const resolved = path.resolve(artifactPath);
  const info = await stat(resolved);
  const siteRoot = path.join(tempRoot, 'site');
  await mkdir(siteRoot, { recursive: true });
  if (info.isDirectory()) {
    await cp(resolved, siteRoot, { recursive: true, filter: (entry) => path.basename(entry) !== '.DS_Store' });
  } else if (/\.zip$/i.test(resolved)) {
    await extractZip(resolved, siteRoot);
  } else if (/\.html?$/i.test(resolved)) {
    await cp(resolved, path.join(siteRoot, 'index.html'));
  } else {
    throw new Error('运行时门禁仅支持 HTML、ZIP 或目录产物。');
  }
  return { siteRoot, mainHtml: await resolveMainHtml(siteRoot) };
}

function decodeQuotedValue(value) {
  return value
    .replace(/\\u\{([0-9a-f]+)\}/gi, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/\\u([0-9a-f]{4})/gi, (_, code) => String.fromCharCode(Number.parseInt(code, 16)))
    .replace(/\\x([0-9a-f]{2})/gi, (_, code) => String.fromCharCode(Number.parseInt(code, 16)))
    .replace(/\\([\\/"'])/g, '$1');
}

async function collectConfiguredImageAssets(siteRoot) {
  const values = new Set();
  const patterns = [
    /(?:["']?imageAsset["']?)\s*:\s*"((?:\\.|[^"\\])*)"/gi,
    /(?:["']?imageAsset["']?)\s*:\s*'((?:\\.|[^'\\])*)'/gi
  ];
  for (const relativePath of await walkFiles(siteRoot)) {
    if (!/\.(?:html?|js|mjs|cjs|json)$/i.test(relativePath)) continue;
    const content = await readFile(path.join(siteRoot, relativePath), 'utf8');
    for (const pattern of patterns) {
      pattern.lastIndex = 0;
      for (const match of content.matchAll(pattern)) {
        const value = decodeQuotedValue(match[1]).trim();
        if (value && !/^data:image\//i.test(value) && !/^blob:/i.test(value)) values.add(value);
      }
    }
  }
  return [...values].sort();
}

function probeBootstrap(platform, configuredImageAssets = []) {
  return `(() => {
    const errors = [];
    const consoleErrors = [];
    const audioBeforeInteraction = [];
    const audioDecodes = [];
    const bridgeCalls = [];
    const ctaInputEvents = [];
    const originalFunctions = Object.create(null);
    const listeners = { ready: [], viewableChange: [], sizeChange: [] };
    const dynamicImages = {
      propertySetterInstrumented: false,
      setAttributeInstrumented: false,
      configuredAssets: ${JSON.stringify(configuredImageAssets)},
      assignments: [],
      droppedAssignments: 0
    };
    const startedAt = Date.now();
    let interacted = false;
    let mraidState = 'loading';
    let viewable = false;
    let canvasSampleAttempts = 0;
    let canvasPixels = null;
    const now = () => Date.now() - startedAt;
    const shortValue = (value) => {
      const content = value == null ? '' : String(value);
      return content.length <= 240 ? content : content.slice(0, 237) + '...';
    };
    const record = (kind, value) => errors.push({ kind, value: String(value && value.message || value), atMs: now() });
    const recordBridge = (bridge, method, args) => {
      bridgeCalls.push({
        bridge,
        method,
        args: Array.from(args || [], (value) => {
          try { return typeof value === 'string' ? value : JSON.stringify(value); }
          catch { return String(value); }
        }),
        beforeInteraction: !interacted,
        atMs: now()
      });
    };
    const targetDetails = (node) => node && node.tagName ? {
      tagName: node.tagName,
      id: node.id || null,
      className: shortValue(node.className),
      text: shortValue(node.innerText || node.textContent || node.getAttribute?.('aria-label') || '')
    } : null;
    const markInteraction = (event) => {
      const trusted = event.isTrusted === true;
      if (trusted) interacted = true;
      if (ctaInputEvents.length < 50) {
        ctaInputEvents.push({
          type: event.type,
          isTrusted: trusted,
          x: typeof event.clientX === 'number' ? Math.round(event.clientX) : null,
          y: typeof event.clientY === 'number' ? Math.round(event.clientY) : null,
          target: targetDetails(event.target),
          atMs: now()
        });
      }
    };
    for (const name of ['pointerdown', 'click', 'touchstart', 'mousedown', 'touchend']) {
      document.addEventListener(name, markInteraction, true);
    }
    addEventListener('error', (event) => record('error', event.error || event.message));
    addEventListener('unhandledrejection', (event) => record('unhandledrejection', event.reason));
    const originalError = console.error;
    console.error = function(...args) {
      consoleErrors.push(args.map((value) => String(value)).join(' '));
      return originalError.apply(this, args);
    };
    const imageScheme = (value) => {
      const normalized = value == null ? '' : String(value).trim().toLowerCase();
      if (normalized.startsWith('data:')) return 'data';
      if (normalized.startsWith('blob:')) return 'blob';
      if (normalized.startsWith('//')) return 'protocol-relative';
      if (normalized.startsWith('/')) return 'root-relative';
      if (normalized.startsWith('http://') || normalized.startsWith('https://')) return 'http';
      if (/^[a-z][a-z0-9+.-]*:/i.test(normalized)) return 'other';
      return normalized ? 'relative' : 'other';
    };
    const recordDynamicImage = (image, value, via) => {
      if (dynamicImages.assignments.length >= 500) {
        dynamicImages.droppedAssignments += 1;
        return;
      }
      const raw = value == null ? '' : String(value);
      let withoutQuery = raw.split(/[?#]/, 1)[0];
      try { if (/^https?:/i.test(withoutQuery)) withoutQuery = new URL(withoutQuery).pathname; } catch {}
      const normalized = withoutQuery.startsWith('./')
        ? withoutQuery.slice(2)
        : (withoutQuery.startsWith('/') ? withoutQuery.slice(1) : withoutQuery);
      const configuredAsset = dynamicImages.configuredAssets.find((asset) => {
        let candidate = String(asset).split(/[?#]/, 1)[0];
        if (candidate.startsWith('./')) candidate = candidate.slice(2);
        else if (candidate.startsWith('/')) candidate = candidate.slice(1);
        return normalized === candidate || normalized.endsWith('/' + candidate);
      }) || null;
      dynamicImages.assignments.push({
        value: shortValue(raw),
        valueLength: raw.length,
        scheme: imageScheme(raw),
        configuredAsset,
        via,
        className: shortValue(image?.className),
        alt: shortValue(image?.alt),
        atMs: now()
      });
    };
    try {
      const descriptor = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, 'src');
      if (descriptor?.get && descriptor?.set) {
        Object.defineProperty(HTMLImageElement.prototype, 'src', {
          configurable: descriptor.configurable,
          enumerable: descriptor.enumerable,
          get: descriptor.get,
          set(value) {
            recordDynamicImage(this, value, 'src-property');
            return descriptor.set.call(this, value);
          }
        });
        dynamicImages.propertySetterInstrumented = true;
      }
    } catch {}
    try {
      const originalSetAttribute = Element.prototype.setAttribute;
      Element.prototype.setAttribute = function(name, value) {
        if (this.tagName === 'IMG' && String(name).toLowerCase() === 'src') {
          recordDynamicImage(this, value, 'setAttribute');
        }
        return originalSetAttribute.apply(this, arguments);
      };
      dynamicImages.setAttributeInstrumented = true;
    } catch {}
    function inspectPixels(pixels, width, height, source) {
      const colors = new Set();
      let opaque = 0;
      let minChannel = 255;
      let maxChannel = 0;
      let mean = 0;
      let m2 = 0;
      const samples = width * height;
      for (let index = 0; index < pixels.length; index += 4) {
        const r = pixels[index];
        const g = pixels[index + 1];
        const b = pixels[index + 2];
        const alpha = pixels[index + 3];
        if (alpha > 8) opaque += 1;
        minChannel = Math.min(minChannel, r, g, b);
        maxChannel = Math.max(maxChannel, r, g, b);
        if (colors.size < 4096) colors.add([r >> 4, g >> 4, b >> 4, alpha >> 6].join(','));
        const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
        const count = index / 4 + 1;
        const delta = luminance - mean;
        mean += delta / count;
        m2 += delta * (luminance - mean);
      }
      const stats = {
        source,
        width,
        height,
        samples,
        opaqueRatio: samples ? opaque / samples : 0,
        quantizedColorCount: colors.size,
        channelRange: maxChannel - minChannel,
        luminanceStdDev: Math.round(Math.sqrt(m2 / Math.max(1, samples - 1)) * 100) / 100
      };
      stats.nonBlank = stats.opaqueRatio >= 0.25 && stats.quantizedColorCount >= 8 &&
        stats.channelRange >= 12 && stats.luminanceStdDev >= 3;
      return stats;
    }
    function sampleCanvas() {
      if (canvasPixels && canvasPixels.nonBlank || canvasSampleAttempts >= 40) return;
      const canvas = document.querySelector('#game-canvas') || document.querySelector('canvas');
      if (!canvas || canvas.width < 2 || canvas.height < 2) return;
      canvasSampleAttempts += 1;
      const width = Math.min(192, canvas.width);
      const height = Math.min(192, canvas.height);
      const x = Math.max(0, Math.floor((canvas.width - width) / 2));
      const y = Math.max(0, Math.floor((canvas.height - height) / 2));
      try {
        const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
        if (gl) {
          const pixels = new Uint8Array(width * height * 4);
          gl.readPixels(x, y, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
          canvasPixels = inspectPixels(pixels, width, height, 'webgl-framebuffer');
          return;
        }
        const context = canvas.getContext('2d');
        if (context) canvasPixels = inspectPixels(context.getImageData(x, y, width, height).data, width, height, '2d-canvas');
      } catch (error) {
        canvasPixels = { source: 'canvas', nonBlank: false, error: String(error && error.message || error) };
      }
    }
    const originalRequestAnimationFrame = window.requestAnimationFrame.bind(window);
    window.requestAnimationFrame = function(callback) {
      return originalRequestAnimationFrame(function(timestamp) {
        const result = callback(timestamp);
        sampleCanvas();
        return result;
      });
    };
    window.open = function(...args) {
      recordBridge('window', 'window.open', args);
      return null;
    };
    window.mraid = {
      getState: () => mraidState,
      isViewable: () => viewable,
      addEventListener(name, callback) { if (listeners[name] && typeof callback === 'function') listeners[name].push(callback); },
      removeEventListener(name, callback) { if (listeners[name]) listeners[name] = listeners[name].filter((item) => item !== callback); },
      open(...args) { recordBridge('mraid', 'mraid.open', args); },
      getVersion: () => '3.0',
      getScreenSize: () => ({ width: innerWidth, height: innerHeight }),
      getMaxSize: () => ({ width: innerWidth, height: innerHeight }),
      getCurrentPosition: () => ({ x: 0, y: 0, width: innerWidth, height: innerHeight }),
      getDefaultPosition: () => ({ x: 0, y: 0, width: innerWidth, height: innerHeight })
    };
    const installObject = (name, methods, bridge) => {
      let target = window[name] || {};
      const wrapObject = (value) => {
        target = value || {};
        for (const method of methods) {
          const original = typeof target[method] === 'function' ? target[method] : null;
          target[method] = function(...args) {
            recordBridge(bridge, name + '.' + method, args);
            return original ? original.apply(this, args) : undefined;
          };
        }
      };
      wrapObject(target);
      try {
        Object.defineProperty(window, name, {
          configurable: true,
          get: () => target,
          set: wrapObject
        });
      } catch {
        window[name] = target;
      }
    };
    const installFunction = (name, bridge) => {
      let original = typeof window[name] === 'function' ? window[name] : null;
      if (original) originalFunctions[name] = true;
      const wrapped = function(...args) {
        recordBridge(bridge, name, args);
        return original ? original.apply(this, args) : undefined;
      };
      try {
        Object.defineProperty(window, name, {
          configurable: true,
          get: () => original ? wrapped : undefined,
          set(value) {
            original = typeof value === 'function' ? value : null;
            originalFunctions[name] = Boolean(original);
          }
        });
      } catch {
        window[name] = wrapped;
      }
    };
    installObject('ExitApi', ['exit'], 'exit-api');
    installObject('FbPlayableAd', ['onCTAClick'], 'fb-cta');
    installObject('playableSDK', ['openAppStore'], 'open-app-store');
    installFunction('openAppStore', 'open-app-store');
    for (const name of ['install', 'gameReady', 'gameStart', 'gameEnd', 'gameClose', 'gameRetry']) {
      installFunction(name, name === 'install' ? 'mintegral' : 'mintegral-lifecycle');
    }
    window.ALPlayableAnalytics = { trackEvent() {} };
    if (window.HTMLMediaElement?.prototype) {
      window.HTMLMediaElement.prototype.play = function() {
        if (!interacted) audioBeforeInteraction.push({ type: 'HTMLMediaElement.play', atMs: now() });
        return Promise.resolve();
      };
    }
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (AudioContextClass?.prototype) {
      const originalResume = AudioContextClass.prototype.resume;
      AudioContextClass.prototype.resume = function(...args) {
        if (!interacted) audioBeforeInteraction.push({ type: 'AudioContext.resume', atMs: now() });
        try { return originalResume ? originalResume.apply(this, args) : Promise.resolve(); }
        catch { return Promise.resolve(); }
      };
      const originalDecodeAudioData = AudioContextClass.prototype.decodeAudioData;
      if (originalDecodeAudioData) {
        AudioContextClass.prototype.decodeAudioData = function(...args) {
          const input = args[0];
          const entry = {
            byteLength: Number.isFinite(input?.byteLength) ? input.byteLength : null,
            beforeInteraction: !interacted,
            status: 'pending',
            atMs: now()
          };
          audioDecodes.push(entry);
          if (!interacted) audioBeforeInteraction.push({ type: 'AudioContext.decodeAudioData', atMs: entry.atMs });
          let result;
          try {
            result = originalDecodeAudioData.apply(this, args);
          } catch (error) {
            entry.status = 'rejected';
            entry.error = String(error?.name || error?.message || error);
            throw error;
          }
          if (result && typeof result.then === 'function') {
            result.then(
              () => { entry.status = 'fulfilled'; },
              (error) => {
                entry.status = 'rejected';
                entry.error = String(error?.name || error?.message || error);
              }
            );
          }
          return result;
        };
      }
      const originalCreateBufferSource = AudioContextClass.prototype.createBufferSource;
      if (originalCreateBufferSource) {
        AudioContextClass.prototype.createBufferSource = function(...args) {
          const source = originalCreateBufferSource.apply(this, args);
          if (source && typeof source.start === 'function') {
            const originalStart = source.start;
            source.start = function(...startArgs) {
              if (!interacted) audioBeforeInteraction.push({ type: 'AudioBufferSource.start', atMs: now() });
              return originalStart.apply(this, startArgs);
            };
          }
          return source;
        };
      }
    }
    window.__PLAYABLE_RUNTIME_SMOKE_HOST__ = {
      platform: ${JSON.stringify(platform)},
      errors,
      consoleErrors,
      audioBeforeInteraction,
      audioDecodes,
      bridgeCalls,
      ctaInputEvents,
      dynamicImages,
      originalFunctions,
      ctaTarget: null,
      ctaDispatch: null,
      get userInteracted() { return interacted; },
      get canvasPixels() { return canvasPixels; },
      get canvasSampleAttempts() { return canvasSampleAttempts; }
    };
    const canvasSampler = setInterval(() => {
      sampleCanvas();
      if (canvasPixels && canvasPixels.nonBlank || canvasSampleAttempts >= 40) clearInterval(canvasSampler);
    }, 250);
    setTimeout(() => {
      mraidState = 'default';
      for (const callback of listeners.ready.slice()) { try { callback(); } catch (error) { record('mraid-ready', error); } }
    }, 100);
    setTimeout(() => {
      viewable = true;
      for (const callback of listeners.viewableChange.slice()) { try { callback(true); } catch (error) { record('mraid-viewable', error); } }
    }, 200);
    setTimeout(() => {
      for (const callback of listeners.sizeChange.slice()) { try { callback(innerWidth, innerHeight); } catch (error) { record('mraid-size', error); } }
    }, 300);
  })();`;
}

function readinessExpression() {
  return `(() => {
    const loading = document.querySelector('#loading-screen');
    const loadingStyle = loading ? getComputedStyle(loading) : null;
    const loadingRect = loading ? loading.getBoundingClientRect() : null;
    const loadingHidden = !loading || loading.hidden || loadingStyle.display === 'none' ||
      loadingStyle.visibility === 'hidden' || Number(loadingStyle.opacity) <= 0.01 ||
      loadingRect.width < 2 || loadingRect.height < 2;
    const progressNode = document.querySelector('#loading-progress-value');
    const progress = Number.parseFloat(progressNode && progressNode.textContent || '0');
    const canvas = document.querySelector('#game-canvas') || document.querySelector('canvas');
    const rect = canvas ? canvas.getBoundingClientRect() : null;
    const images = Array.from(document.images || [], (image) => ({
      srcAttribute: String(image.getAttribute('src') || '').slice(0, 240),
      currentSrc: String(image.currentSrc || image.src || '').slice(0, 240),
      complete: Boolean(image.complete),
      naturalWidth: image.naturalWidth || 0,
      naturalHeight: image.naturalHeight || 0,
      id: image.id || null,
      className: String(image.className || '').slice(0, 160),
      alt: String(image.alt || '').slice(0, 160)
    }));
    const brokenImages = images.filter((image) => image.complete && image.naturalWidth === 0);
    let sceneChildren = null;
    try { sceneChildren = window.__busLoop && window.__busLoop.view && window.__busLoop.view.scene.children.length; } catch (_) {}
    return {
      documentReady: document.readyState === 'complete',
      runtimeReady: !!window.__busLoop,
      loadingPresent: !!loading,
      loadingHidden,
      loadingProgress: Number.isFinite(progress) ? progress : null,
      canvasPresent: !!canvas,
      canvasWidth: canvas ? canvas.width : 0,
      canvasHeight: canvas ? canvas.height : 0,
      canvasRect: rect ? { x: rect.left + scrollX, y: rect.top + scrollY, width: rect.width, height: rect.height } : null,
      canvasVisible: !!(rect && rect.width >= 32 && rect.height >= 32),
      sceneChildren,
      images,
      brokenImages,
      hostProbe: window.__PLAYABLE_RUNTIME_SMOKE_HOST__ ? {
        platform: window.__PLAYABLE_RUNTIME_SMOKE_HOST__.platform,
        errors: window.__PLAYABLE_RUNTIME_SMOKE_HOST__.errors,
        consoleErrors: window.__PLAYABLE_RUNTIME_SMOKE_HOST__.consoleErrors,
        audioBeforeInteraction: window.__PLAYABLE_RUNTIME_SMOKE_HOST__.audioBeforeInteraction,
        audioDecodes: window.__PLAYABLE_RUNTIME_SMOKE_HOST__.audioDecodes,
        bridgeCalls: window.__PLAYABLE_RUNTIME_SMOKE_HOST__.bridgeCalls,
        ctaInputEvents: window.__PLAYABLE_RUNTIME_SMOKE_HOST__.ctaInputEvents,
        ctaTarget: window.__PLAYABLE_RUNTIME_SMOKE_HOST__.ctaTarget,
        ctaDispatch: window.__PLAYABLE_RUNTIME_SMOKE_HOST__.ctaDispatch,
        dynamicImages: window.__PLAYABLE_RUNTIME_SMOKE_HOST__.dynamicImages,
        lifecycleDefinitions: Object.fromEntries(
          ['install', 'gameReady', 'gameStart', 'gameEnd', 'gameClose', 'gameRetry']
            .map((name) => [name, window.__PLAYABLE_RUNTIME_SMOKE_HOST__.originalFunctions[name] === true])
        ),
        userInteracted: window.__PLAYABLE_RUNTIME_SMOKE_HOST__.userInteracted,
        canvasPixels: window.__PLAYABLE_RUNTIME_SMOKE_HOST__.canvasPixels,
        canvasSampleAttempts: window.__PLAYABLE_RUNTIME_SMOKE_HOST__.canvasSampleAttempts
      } : null
    };
  })()`;
}

function ctaTargetExpression(explicitSelector) {
  return `(() => {
    const host = window.__PLAYABLE_RUNTIME_SMOKE_HOST__;
    const explicit = ${JSON.stringify(explicitSelector || null)};
    const visible = (node) => {
      if (!node || typeof node.getBoundingClientRect !== 'function') return false;
      const style = getComputedStyle(node);
      const rect = node.getBoundingClientRect();
      if (node.hidden || node.disabled || node.getAttribute('aria-disabled') === 'true') return false;
      if (rect.width < 4 || rect.height < 4 || style.display === 'none' || style.visibility === 'hidden') return false;
      if (Number(style.opacity) <= 0.01 || style.pointerEvents === 'none') return false;
      const x = Math.max(0, Math.min(innerWidth - 1, rect.left + rect.width / 2));
      const y = Math.max(0, Math.min(innerHeight - 1, rect.top + rect.height / 2));
      const top = document.elementFromPoint(x, y);
      return !top || top === node || node.contains(top);
    };
    const candidates = [];
    let selectorError = null;
    if (explicit) {
      try { candidates.push(...document.querySelectorAll(explicit)); }
      catch (error) { selectorError = String(error && error.message || error); }
    } else {
      for (const selector of ['#cta-button', '[data-cta]', '[data-action="cta"]', '[data-testid*="cta" i]', '#cta', '.cta']) {
        try { candidates.push(...document.querySelectorAll(selector)); } catch {}
      }
      const textPattern = /install|download|get|play now|shop now|learn more|continue|安装|下载|立即|试玩|继续/i;
      for (const node of document.querySelectorAll('button,a,[role="button"]')) {
        const label = String(node.innerText || node.textContent || node.getAttribute('aria-label') || '');
        if (textPattern.test(label)) candidates.push(node);
      }
    }
    const node = candidates.find(visible) || null;
    if (!node) {
      const missing = { found: false, actionable: false, selector: explicit, selectorSource: explicit ? 'explicit' : 'auto', selectorError };
      if (host) host.ctaTarget = missing;
      return missing;
    }
    node.scrollIntoView({ block: 'center', inline: 'center' });
    const rect = node.getBoundingClientRect();
    const target = {
      found: true,
      actionable: true,
      selector: explicit,
      selectorSource: explicit ? 'explicit' : 'auto',
      tagName: node.tagName,
      id: node.id || null,
      className: String(node.className || '').slice(0, 160),
      text: String(node.innerText || node.textContent || node.getAttribute('aria-label') || '').trim().slice(0, 160),
      stage: String(node.getAttribute('data-stage') || node.closest('[data-stage]')?.getAttribute('data-stage') || 'cta-visible'),
      x: Math.round(rect.left + rect.width / 2),
      y: Math.round(rect.top + rect.height / 2),
      width: Math.round(rect.width),
      height: Math.round(rect.height)
    };
    if (host) {
      host.ctaTarget = target;
      host.ctaDispatch = { inputMethod: 'cdp-mouse', x: target.x, y: target.y };
    }
    return target;
  })()`;
}

class CdpClient {
  constructor(url) {
    this.url = url;
    this.nextId = 1;
    this.pending = new Map();
    this.listeners = new Map();
  }

  async connect() {
    this.socket = new WebSocket(this.url);
    await new Promise((resolve, reject) => {
      this.socket.addEventListener('open', resolve, { once: true });
      this.socket.addEventListener('error', () => reject(new Error('Chrome DevTools WebSocket 连接失败。')), { once: true });
    });
    this.socket.addEventListener('message', (event) => {
      const message = JSON.parse(String(event.data));
      if (message.id) {
        const pending = this.pending.get(message.id);
        if (!pending) return;
        this.pending.delete(message.id);
        if (message.error) pending.reject(new Error(message.error.message));
        else pending.resolve(message.result ?? {});
        return;
      }
      for (const listener of this.listeners.get(message.method) ?? []) listener(message.params ?? {});
    });
  }

  on(method, listener) {
    this.listeners.set(method, [...(this.listeners.get(method) ?? []), listener]);
  }

  send(method, params = {}) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  close() {
    if (this.socket?.readyState <= 1) this.socket.close();
  }
}

async function evaluate(client, expression) {
  const result = await client.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text || '浏览器表达式执行失败。');
  return result.result?.value;
}

async function waitForDebugger(port, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/list`);
      if (response.ok) {
        const targets = await response.json();
        const page = targets.find((target) => target.type === 'page' && target.webSocketDebuggerUrl);
        if (page) return page.webSocketDebuggerUrl;
      }
    } catch {}
    await delay(100);
  }
  throw new Error('Chrome DevTools 调试端口启动超时。');
}

async function freePort() {
  const server = http.createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const { port } = server.address();
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return port;
}

function createStaticServer(root) {
  return http.createServer(async (request, response) => {
    try {
      const requestPath = decodeURIComponent(new URL(request.url, 'http://127.0.0.1').pathname);
      if (path.basename(requestPath) === 'mraid.js') {
        response.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8' });
        response.end('/* mraid host mock is injected before the playable */');
        return;
      }
      const relative = safeRelativePath(requestPath.replace(/^\/+/, ''));
      if (!relative) {
        response.writeHead(400).end('Bad request');
        return;
      }
      const filePath = path.join(root, relative);
      const info = await stat(filePath);
      if (!info.isFile()) throw Object.assign(new Error('Not a file'), { code: 'ENOENT' });
      response.writeHead(200, {
        'cache-control': 'no-store',
        'content-type': MIME_TYPES[path.extname(filePath).toLowerCase()] ?? 'application/octet-stream'
      });
      response.end(await readFile(filePath));
    } catch (error) {
      response.writeHead(error.code === 'ENOENT' ? 404 : 500).end(error.code === 'ENOENT' ? 'Not found' : 'Server error');
    }
  });
}

function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : (pb <= pc ? b : c);
}

export function inspectPngPixels(source) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  if (!source.subarray(0, 8).equals(signature)) throw new Error('浏览器截图不是 PNG。');
  let cursor = 8;
  let header = null;
  const chunks = [];
  while (cursor + 12 <= source.length) {
    const length = source.readUInt32BE(cursor);
    const type = source.subarray(cursor + 4, cursor + 8).toString('ascii');
    const data = source.subarray(cursor + 8, cursor + 8 + length);
    cursor += 12 + length;
    if (type === 'IHDR') {
      header = {
        width: data.readUInt32BE(0),
        height: data.readUInt32BE(4),
        bitDepth: data[8],
        colorType: data[9],
        interlace: data[12]
      };
    }
    if (type === 'IDAT') chunks.push(data);
    if (type === 'IEND') break;
  }
  if (!header || header.bitDepth !== 8 || header.interlace !== 0 || ![2, 6].includes(header.colorType)) {
    throw new Error('浏览器截图使用了不支持的 PNG 像素格式。');
  }
  const channels = header.colorType === 6 ? 4 : 3;
  const stride = header.width * channels;
  const inflated = inflateSync(Buffer.concat(chunks));
  const pixels = Buffer.alloc(stride * header.height);
  let sourceOffset = 0;
  for (let y = 0; y < header.height; y += 1) {
    const filter = inflated[sourceOffset++];
    const rowOffset = y * stride;
    for (let x = 0; x < stride; x += 1) {
      const raw = inflated[sourceOffset++];
      const left = x >= channels ? pixels[rowOffset + x - channels] : 0;
      const up = y > 0 ? pixels[rowOffset - stride + x] : 0;
      const upLeft = y > 0 && x >= channels ? pixels[rowOffset - stride + x - channels] : 0;
      let value = raw;
      if (filter === 1) value += left;
      else if (filter === 2) value += up;
      else if (filter === 3) value += Math.floor((left + up) / 2);
      else if (filter === 4) value += paeth(left, up, upLeft);
      else if (filter !== 0) throw new Error(`浏览器截图使用了不支持的 PNG filter ${filter}。`);
      pixels[rowOffset + x] = value & 0xff;
    }
  }
  const step = Math.max(1, Math.floor(Math.sqrt((header.width * header.height) / 200_000)));
  const colors = new Set();
  let samples = 0;
  let opaque = 0;
  let minChannel = 255;
  let maxChannel = 0;
  let mean = 0;
  let m2 = 0;
  for (let y = 0; y < header.height; y += step) {
    for (let x = 0; x < header.width; x += step) {
      const offset = y * stride + x * channels;
      const r = pixels[offset];
      const g = pixels[offset + 1];
      const b = pixels[offset + 2];
      const alpha = channels === 4 ? pixels[offset + 3] : 255;
      samples += 1;
      if (alpha > 8) opaque += 1;
      minChannel = Math.min(minChannel, r, g, b);
      maxChannel = Math.max(maxChannel, r, g, b);
      if (colors.size < 4096) colors.add(`${r >> 4},${g >> 4},${b >> 4},${alpha >> 6}`);
      const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      const delta = luminance - mean;
      mean += delta / samples;
      m2 += delta * (luminance - mean);
    }
  }
  const luminanceStdDev = Math.sqrt(m2 / Math.max(1, samples - 1));
  const stats = {
    width: header.width,
    height: header.height,
    samples,
    opaqueRatio: opaque / samples,
    quantizedColorCount: colors.size,
    channelRange: maxChannel - minChannel,
    luminanceStdDev: Math.round(luminanceStdDev * 100) / 100
  };
  stats.nonBlank = stats.opaqueRatio >= 0.5
    && stats.quantizedColorCount >= 8
    && stats.channelRange >= 12
    && stats.luminanceStdDev >= 3;
  return stats;
}

function check(id, title, passed, evidence) {
  return { id, title, status: passed ? 'pass' : 'fail', evidence };
}

function uniqueRecords(values) {
  const seen = new Set();
  return values.filter((value) => {
    const key = JSON.stringify(value);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

const EXPECTED_CTA_BRIDGES = Object.freeze({
  applovin: new Set(['mraid']),
  'google-ads': new Set(['exit-api', 'mraid']),
  meta: new Set(['fb-cta']),
  unityads: new Set(['mraid']),
  mintegral: new Set(['mintegral']),
  moloco: new Set(['fb-cta']),
  tiktok: new Set(['open-app-store'])
});

function analyzeCtaCapture(platform, hostProbe = {}) {
  const target = hostProbe.ctaTarget && typeof hostProbe.ctaTarget === 'object' ? hostProbe.ctaTarget : {};
  const dispatch = hostProbe.ctaDispatch && typeof hostProbe.ctaDispatch === 'object' ? hostProbe.ctaDispatch : {};
  const trustedInputs = (hostProbe.ctaInputEvents ?? []).filter((event) => {
    if (!event || event.isTrusted !== true) return false;
    if (!target.id) return true;
    return event.target?.id === target.id;
  });
  const inputEvent = trustedInputs.at(-1) ?? null;
  const inputAt = inputEvent ? Number(inputEvent.atMs) || 0 : null;
  const expected = EXPECTED_CTA_BRIDGES[platform] ?? new Set();
  const actualBridgeCalls = (hostProbe.bridgeCalls ?? []).filter((call) => (
    call && expected.has(call.bridge) && call.beforeInteraction !== true
      && (inputAt == null || (Number(call.atMs) || 0) >= inputAt)
  ));
  const passed = target.found === true
    && target.actionable === true
    && ['cdp-mouse', 'cdp-touch'].includes(dispatch.inputMethod)
    && inputEvent !== null
    && actualBridgeCalls.length > 0;
  return {
    hookInstalledBeforeBusinessScripts: true,
    inputMethod: dispatch.inputMethod ?? null,
    isTrusted: inputEvent?.isTrusted === true,
    target: Object.keys(target).length ? target : null,
    coordinates: dispatch.inputMethod ? { x: dispatch.x, y: dispatch.y } : null,
    inputEvent,
    expectedBridges: [...expected],
    actualBridgeCalls,
    conclusion: passed ? 'PASS' : 'FAIL'
  };
}

function analyzeDynamicImages(hostProbe = {}) {
  const dynamicImages = hostProbe.dynamicImages ?? {};
  const configuredAssets = (dynamicImages.configuredAssets ?? []).map((value) => String(value));
  const assignments = dynamicImages.assignments ?? [];
  const unsafeAssignments = assignments.filter((assignment) => (
    assignment?.configuredAsset && !['data', 'blob'].includes(assignment.scheme)
  ));
  const droppedAssignments = Number(dynamicImages.droppedAssignments) || 0;
  const instrumented = dynamicImages.propertySetterInstrumented === true
    && dynamicImages.setAttributeInstrumented === true;
  return {
    instrumented,
    propertySetterInstrumented: dynamicImages.propertySetterInstrumented === true,
    setAttributeInstrumented: dynamicImages.setAttributeInstrumented === true,
    configuredAssets,
    assignmentCount: assignments.length,
    droppedAssignments,
    unsafeAssignments,
    conclusion: instrumented && droppedAssignments === 0 && unsafeAssignments.length === 0 ? 'PASS' : 'FAIL'
  };
}

function analyzeMintegralLifecycle(hostProbe = {}) {
  const calls = (hostProbe.bridgeCalls ?? []).filter((call) => (
    call?.bridge === 'mintegral' || call?.bridge === 'mintegral-lifecycle'
  ));
  const firstAt = (method) => {
    const values = calls
      .filter((call) => call.method === method)
      .map((call) => Number(call.atMs))
      .filter(Number.isFinite);
    return values.length ? Math.min(...values) : null;
  };
  const gameReadyAtMs = firstAt('gameReady');
  const gameStartAtMs = firstAt('gameStart');
  const gameEndAtMs = firstAt('gameEnd');
  const installCaptured = calls.some((call) => call.bridge === 'mintegral' && call.method === 'install');
  const sequenceValid = gameReadyAtMs !== null
    && gameStartAtMs !== null
    && gameEndAtMs !== null
    && gameStartAtMs >= gameReadyAtMs
    && gameEndAtMs >= gameStartAtMs;
  return {
    installCaptured,
    gameReadyAtMs,
    gameStartAtMs,
    gameEndAtMs,
    sequenceValid,
    calls,
    conclusion: installCaptured && sequenceValid ? 'PASS' : 'FAIL'
  };
}

async function runBrowser({
  chrome,
  url,
  platform,
  profileRoot,
  timeoutMs,
  viewport,
  configuredImageAssets = [],
  ctaSelector = null,
  exerciseCta = true,
  screenshotFormat = 'png',
  screenshotQuality
}) {
  const port = await freePort();
  const args = [
    '--headless=new',
    '--no-sandbox',
    '--disable-dev-shm-usage',
    '--disable-background-networking',
    '--disable-component-update',
    '--disable-default-apps',
    '--disable-extensions',
    '--disable-sync',
    '--enable-unsafe-swiftshader',
    '--enable-webgl',
    '--hide-scrollbars',
    '--ignore-gpu-blocklist',
    '--mute-audio',
    '--no-default-browser-check',
    '--no-first-run',
    `--remote-debugging-port=${port}`,
    '--remote-debugging-address=127.0.0.1',
    `--user-data-dir=${profileRoot}`,
    `--window-size=${viewport.width},${viewport.height}`,
    'about:blank'
  ];
  const browser = spawn(chrome, args, { stdio: ['ignore', 'ignore', 'pipe'] });
  let browserExited = false;
  browser.once('exit', () => { browserExited = true; });
  let stderr = '';
  browser.stderr.setEncoding('utf8');
  browser.stderr.on('data', (chunk) => { stderr = `${stderr}${chunk}`.slice(-8_000); });
  let client;
  const consoleErrors = [];
  const exceptions = [];
  const resourceFailures = [];
  const requestUrls = new Map();
  let readiness = null;
  let screenshot = null;
  try {
    client = new CdpClient(await waitForDebugger(port, Math.min(timeoutMs, 7_000)));
    await client.connect();
    client.on('Runtime.consoleAPICalled', (event) => {
      if (!['error', 'assert'].includes(event.type)) return;
      consoleErrors.push({
        type: event.type,
        text: (event.args ?? []).map((arg) => arg.value ?? arg.description ?? '').join(' '),
        url: event.stackTrace?.callFrames?.[0]?.url ?? ''
      });
    });
    client.on('Runtime.exceptionThrown', (event) => {
      const details = event.exceptionDetails ?? {};
      exceptions.push({ text: details.exception?.description ?? details.text ?? 'Uncaught exception', url: details.url ?? '' });
    });
    client.on('Log.entryAdded', (event) => {
      const entry = event.entry ?? {};
      if (entry.level !== 'error' || /\/favicon\.ico(?:[?#]|$)/i.test(String(entry.url ?? ''))) return;
      const entryUrl = String(entry.url ?? '');
      if (entryUrl.startsWith('data:') && String(entry.text ?? '').includes('ERR_INVALID_URL')) return;
      consoleErrors.push({ type: 'browser-log', text: entry.text ?? '', url: entryUrl.slice(0, 512) });
    });
    client.on('Network.loadingFailed', (event) => {
      if (event.canceled || event.errorText === 'net::ERR_ABORTED') return;
      const url = requestUrls.get(event.requestId) ?? '';
      if (!url || url === 'about:blank') return;
      // Three's FBXLoader probes embedded texture names by appending them to a
      // data URL. Chrome reports those optional probes as ERR_INVALID_URL even
      // when the project-supplied material textures render correctly.
      if (url.startsWith('data:') && event.errorText === 'net::ERR_INVALID_URL') return;
      resourceFailures.push({ requestId: event.requestId, url: url.slice(0, 512), errorText: event.errorText, type: event.type });
    });
    client.on('Network.requestWillBeSent', (event) => {
      requestUrls.set(event.requestId, event.request?.url ?? '');
    });
    client.on('Network.responseReceived', (event) => {
      const response = event.response ?? {};
      if (Number(response.status) < 400) return;
      if (/\/favicon\.ico(?:[?#]|$)/i.test(String(response.url ?? ''))) return;
      resourceFailures.push({
        requestId: event.requestId,
        url: String(response.url ?? '').slice(0, 512),
        errorText: `HTTP ${response.status}`,
        type: event.type
      });
    });
    client.on('Fetch.requestPaused', (event) => {
      client.send('Fetch.fulfillRequest', {
        requestId: event.requestId,
        responseCode: 200,
        responseHeaders: [{ name: 'Content-Type', value: 'text/javascript; charset=utf-8' }],
        body: Buffer.from('/* platform SDK supplied by runtime smoke host */').toString('base64')
      }).catch((error) => exceptions.push({ text: error.message, url: event.request.url }));
    });
    await Promise.all([
      client.send('Page.enable'),
      client.send('Runtime.enable'),
      client.send('Log.enable'),
      client.send('Network.enable'),
      client.send('Fetch.enable', { patterns: HOSTED_SDK_PATTERNS.map((urlPattern) => ({ urlPattern })) }),
      client.send('Emulation.setDeviceMetricsOverride', {
        width: viewport.width,
        height: viewport.height,
        deviceScaleFactor: 1,
        mobile: true
      })
    ]);
    await client.send('Page.addScriptToEvaluateOnNewDocument', {
      source: probeBootstrap(platform, configuredImageAssets)
    });
    await client.send('Page.navigate', { url });
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      await delay(250);
      readiness = await evaluate(client, readinessExpression()).catch((error) => {
        exceptions.push({ text: error.message, url });
        return null;
      });
      if (readiness?.documentReady && readiness.runtimeReady && readiness.loadingHidden && readiness.canvasVisible) break;
    }
    await delay(500);
    readiness = await evaluate(client, readinessExpression()) ?? readiness;
    if (readiness?.canvasVisible && readiness.canvasRect) {
      const rect = readiness.canvasRect;
      const width = Math.min(viewport.width, Math.max(1, Math.floor(rect.width)));
      const height = Math.min(viewport.height, Math.max(1, Math.floor(rect.height)));
      const x = Math.max(0, Math.min(viewport.width - width, Math.floor(rect.x)));
      const y = Math.max(0, Math.min(viewport.height - height, Math.floor(rect.y)));
      const capture = await client.send('Page.captureScreenshot', {
        format: screenshotFormat,
        ...(screenshotFormat === 'jpeg' ? { quality: screenshotQuality ?? 80 } : {}),
        fromSurface: true,
        captureBeyondViewport: false,
        clip: { x, y, width, height, scale: 1 }
      });
      screenshot = Buffer.from(capture.data, 'base64');
    }
    if (exerciseCta) {
      const target = await evaluate(client, ctaTargetExpression(ctaSelector));
      if (target?.found) {
        await client.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: target.x, y: target.y });
        await client.send('Input.dispatchMouseEvent', {
          type: 'mousePressed', x: target.x, y: target.y, button: 'left', clickCount: 1
        });
        await client.send('Input.dispatchMouseEvent', {
          type: 'mouseReleased', x: target.x, y: target.y, button: 'left', clickCount: 1
        });
      }
      await delay(400);
      readiness = await evaluate(client, readinessExpression()) ?? readiness;
    }
  } finally {
    client?.close();
    if (!browserExited) browser.kill('SIGTERM');
    await Promise.race([
      new Promise((resolve) => browser.once('exit', resolve)),
      delay(1_000).then(() => { if (!browserExited) browser.kill('SIGKILL'); })
    ]);
  }
  return { readiness, screenshot, consoleErrors, exceptions, resourceFailures, stderr };
}

export async function capturePlayableBackupImage({
  artifactPath,
  platform = 'google-ads',
  outputPath,
  chrome: explicitChrome,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  viewport = DEFAULT_VIEWPORT,
  quality = 80
} = {}) {
  if (!artifactPath) throw new TypeError('artifactPath is required.');
  if (!outputPath) throw new TypeError('outputPath is required.');
  if (!SUPPORTED_PLATFORMS.has(platform)) throw new TypeError(`Unsupported playable platform: ${platform}.`);
  const chrome = await findChromeExecutable(explicitChrome);
  if (!chrome) throw new Error('未找到可执行的 Chrome/Chromium，无法生成真实试玩备用图。');
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'bus-loop-backup-capture-'));
  let server;
  try {
    const prepared = await prepareSite(path.resolve(artifactPath), tempRoot);
    server = createStaticServer(prepared.siteRoot);
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    const { port } = server.address();
    const mainUrl = prepared.mainHtml.split(path.sep).map(encodeURIComponent).join('/');
    const result = await runBrowser({
      chrome,
      url: `http://127.0.0.1:${port}/${mainUrl}`,
      platform,
      profileRoot: path.join(tempRoot, 'chrome-profile'),
      timeoutMs: Math.max(3_000, Number(timeoutMs) || DEFAULT_TIMEOUT_MS),
      viewport,
      exerciseCta: false,
      screenshotFormat: 'jpeg',
      screenshotQuality: Math.max(1, Math.min(100, Math.round(Number(quality) || 80)))
    });
    const readiness = result.readiness ?? {};
    const hostErrors = readiness.hostProbe?.errors ?? [];
    if (
      readiness.documentReady !== true
      || readiness.runtimeReady !== true
      || readiness.loadingHidden !== true
      || readiness.canvasVisible !== true
      || readiness.hostProbe?.canvasPixels?.nonBlank !== true
      || hostErrors.length > 0
      || result.exceptions.length > 0
      || result.consoleErrors.length > 0
      || result.resourceFailures.length > 0
      || !result.screenshot?.length
    ) {
      throw new Error('试玩未通过截图前运行检查，无法生成 Google Ads backup.jpg。');
    }
    const destination = path.resolve(outputPath);
    await mkdir(path.dirname(destination), { recursive: true });
    await writeFile(destination, result.screenshot);
    return {
      outputPath: destination,
      bytes: result.screenshot.length,
      sha256: createHash('sha256').update(result.screenshot).digest('hex')
    };
  } finally {
    if (server) await new Promise((resolve) => server.close(resolve));
    await rm(tempRoot, { recursive: true, force: true });
  }
}

export async function checkPlayableRuntimeArtifact({
  artifactPath,
  platform,
  chrome: explicitChrome,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  viewport = DEFAULT_VIEWPORT,
  outputPath,
  checkBatchId = null,
  ctaSelector = null
} = {}) {
  if (!artifactPath) throw new TypeError('artifactPath is required.');
  if (!SUPPORTED_PLATFORMS.has(platform)) throw new TypeError(`Unsupported playable platform: ${platform ?? '<missing>'}.`);
  const resolvedArtifact = path.resolve(artifactPath);
  const chrome = await findChromeExecutable(explicitChrome);
  if (!chrome) throw new Error('未找到可执行的 Chrome/Chromium，无法运行导出产物门禁。');
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'bus-loop-runtime-smoke-'));
  let server;
  try {
    const prepared = await prepareSite(resolvedArtifact, tempRoot);
    server = createStaticServer(prepared.siteRoot);
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    const { port } = server.address();
    const mainUrl = prepared.mainHtml.split(path.sep).map(encodeURIComponent).join('/');
    const configuredImageAssets = await collectConfiguredImageAssets(prepared.siteRoot);
    const result = await runBrowser({
      chrome,
      url: `http://127.0.0.1:${port}/${mainUrl}`,
      platform,
      profileRoot: path.join(tempRoot, 'chrome-profile'),
      timeoutMs: Math.max(3_000, Number(timeoutMs) || DEFAULT_TIMEOUT_MS),
      viewport,
      configuredImageAssets,
      ctaSelector
    });
    const hostErrors = result.readiness?.hostProbe?.errors ?? [];
    const hostConsoleErrors = (result.readiness?.hostProbe?.consoleErrors ?? []).map((text) => ({ type: 'error', text, url: '' }));
    const runtimeErrors = uniqueRecords([...result.exceptions, ...hostErrors]);
    const consoleErrors = uniqueRecords([...result.consoleErrors, ...hostConsoleErrors]);
    const pixels = result.screenshot ? inspectPngPixels(result.screenshot) : null;
    const readiness = result.readiness ?? {};
    const hostProbe = readiness.hostProbe ?? {};
    const audioBeforeInteraction = hostProbe.audioBeforeInteraction ?? [];
    const audioDecodes = hostProbe.audioDecodes ?? [];
    const invalidAudioDecodes = audioDecodes.filter((entry) => (
      Number(entry?.byteLength) <= 1 || entry?.status === 'rejected'
    ));
    const earlyBridgeCalls = (hostProbe.bridgeCalls ?? []).filter((call) => (
      call?.beforeInteraction === true
      && ['mraid', 'fb-cta', 'exit-api', 'open-app-store', 'mintegral', 'window'].includes(call.bridge)
    ));
    const ctaCapture = analyzeCtaCapture(platform, hostProbe);
    const dynamicImageCapture = analyzeDynamicImages(hostProbe);
    const lifecycleCapture = platform === 'mintegral' ? analyzeMintegralLifecycle(hostProbe) : null;
    const checks = [
      check('RUNTIME-STARTUP-001', '项目运行时完成初始化', readiness.documentReady === true && readiness.runtimeReady === true, readiness),
      check('RUNTIME-LOADING-001', '加载界面已结束', readiness.loadingHidden === true, {
        loadingPresent: readiness.loadingPresent,
        loadingHidden: readiness.loadingHidden,
        loadingProgress: readiness.loadingProgress
      }),
      check('RUNTIME-CANVAS-001', 'Canvas 尺寸有效且可见', readiness.canvasPresent === true
        && readiness.canvasWidth > 0 && readiness.canvasHeight > 0 && readiness.canvasVisible === true, {
        width: readiness.canvasWidth,
        height: readiness.canvasHeight,
        rect: readiness.canvasRect
      }),
      check('RUNTIME-CANVAS-002', 'Canvas 实际绘制内容不是空白画面',
        readiness.hostProbe?.canvasPixels?.nonBlank === true && pixels?.nonBlank === true, {
          canvasPixels: readiness.hostProbe?.canvasPixels ?? null,
          compositedPixels: pixels
        }),
      check('RUNTIME-CONSOLE-001', '无未捕获异常和 console.error', runtimeErrors.length === 0 && consoleErrors.length === 0, {
        runtimeErrors,
        consoleErrors
      }),
      check('RUNTIME-RESOURCE-001', '无浏览器资源加载失败', result.resourceFailures.length === 0, result.resourceFailures),
      check('RUNTIME-IMAGE-001', '无加载失败的图片元素', (readiness.brokenImages ?? []).length === 0, {
        images: readiness.images ?? [],
        brokenImages: readiness.brokenImages ?? []
      }),
      check('RUNTIME-AUDIO-001', '用户可信交互前无音频播放或解锁', audioBeforeInteraction.length === 0, audioBeforeInteraction),
      check('RUNTIME-AUDIO-002', '音频解码载荷有效且无解码失败', invalidAudioDecodes.length === 0, {
        decodes: audioDecodes,
        invalidDecodes: invalidAudioDecodes
      }),
      check('RUNTIME-CTA-000', '用户可信交互前无 CTA 或跳转调用', earlyBridgeCalls.length === 0, earlyBridgeCalls),
      check('RUNTIME-CTA-001', 'CTA 可见且可由浏览器操作', ctaCapture.target?.found === true
        && ctaCapture.target?.actionable === true, ctaCapture.target),
      check('RUNTIME-CTA-002', '浏览器可信输入触发目标平台桥接', ctaCapture.conclusion === 'PASS', ctaCapture)
    ];
    if (platform === 'google-ads' || platform === 'meta') {
      checks.push(check(
        'RUNTIME-DYNAMIC-IMAGE-001',
        '配置驱动动态图片使用容器安全地址',
        dynamicImageCapture.conclusion === 'PASS',
        dynamicImageCapture
      ));
    }
    if (platform === 'mintegral') {
      const requiredLifecycleFunctions = ['install', 'gameReady', 'gameStart', 'gameEnd', 'gameClose', 'gameRetry'];
      const missingLifecycleFunctions = requiredLifecycleFunctions.filter(
        (name) => hostProbe.lifecycleDefinitions?.[name] !== true
      );
      checks.push(check(
        'RUNTIME-MINTEGRAL-001',
        'Mintegral 生命周期函数真实暴露',
        missingLifecycleFunctions.length === 0,
        { definitions: hostProbe.lifecycleDefinitions ?? {}, missing: missingLifecycleFunctions }
      ));
      checks.push(check(
        'RUNTIME-MINTEGRAL-002',
        'Mintegral gameReady -> gameStart -> gameEnd 生命周期有序调用',
        lifecycleCapture?.conclusion === 'PASS',
        lifecycleCapture
      ));
    }
    const failed = checks.filter((item) => item.status === 'fail');
    const artifactBytes = (await stat(resolvedArtifact)).isFile() ? await readFile(resolvedArtifact) : null;
    const report = {
      schemaVersion: 'bus-loop-playable-runtime-smoke-v2',
      platform,
      checkBatchId,
      artifact: {
        path: resolvedArtifact,
        bytes: artifactBytes?.length ?? null,
        sha256: artifactBytes ? createHash('sha256').update(artifactBytes).digest('hex') : null,
        mainHtml: prepared.mainHtml
      },
      browser: { path: chrome, viewport, stderrTail: result.stderr.slice(-2_000) },
      probe: {
        audioBeforeInteraction,
        audioDecodes,
        earlyBridgeCalls,
        dynamicImages: hostProbe.dynamicImages ?? null
      },
      ctaCapture,
      lifecycleCapture,
      conclusion: failed.length ? 'FAIL' : 'PASS',
      summary: { pass: checks.length - failed.length, fail: failed.length, total: checks.length },
      checks
    };
    if (outputPath) {
      await mkdir(path.dirname(path.resolve(outputPath)), { recursive: true });
      await writeFile(path.resolve(outputPath), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
    }
    return report;
  } finally {
    if (server) await new Promise((resolve) => server.close(resolve));
    await rm(tempRoot, { recursive: true, force: true });
  }
}

function parseArgs(argv) {
  const value = (name) => {
    const index = argv.indexOf(name);
    return index >= 0 ? argv[index + 1] : undefined;
  };
  return {
    platform: value('--platform'),
    artifactPath: value('--artifact'),
    chrome: value('--chrome'),
    outputPath: value('--json-out'),
    checkBatchId: value('--check-batch-id'),
    ctaSelector: value('--cta-selector'),
    timeoutMs: Number(value('--timeout-ms') || DEFAULT_TIMEOUT_MS)
  };
}

async function main() {
  const report = await checkPlayableRuntimeArtifact(parseArgs(process.argv.slice(2)));
  console.log(JSON.stringify(report, null, 2));
  if (report.conclusion !== 'PASS') process.exitCode = 1;
}

if (path.resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
