#!/usr/bin/env node
// Ad-hoc production-language probe: serve the built dist, launch headless
// Chrome with a forced UI language, and read the localized title/CTA from the
// real page. Used to prove the built (non-editor) code path follows the device
// language instead of the editor preview override.
import { spawn } from 'node:child_process';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const DIST = join(ROOT, 'dist');
const CHROME = process.env.PLAYABLE_CHROME_BIN || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.mp3': 'audio/mpeg',
  '.mp4': 'video/mp4'
};

const locale = process.argv[2] || 'ja-JP';

const server = http.createServer(async (request, response) => {
  const url = decodeURIComponent((request.url || '/').split('?')[0]);
  const target = join(DIST, url === '/' ? 'index.html' : url.slice(1));
  if (!target.startsWith(DIST) || !existsSync(target) || !(await stat(target)).isFile()) {
    response.writeHead(404).end('not found');
    return;
  }
  response.writeHead(200, { 'Content-Type': MIME[extname(target)] || 'application/octet-stream' });
  response.end(await readFile(target));
});

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function freePort() {
  const probe = http.createServer();
  await new Promise((resolve) => probe.listen(0, '127.0.0.1', resolve));
  const { port } = probe.address();
  await new Promise((resolve) => probe.close(resolve));
  return port;
}

class Cdp {
  constructor(ws) {
    this.ws = ws;
    this.nextId = 1;
    this.pending = new Map();
    ws.addEventListener('message', (event) => {
      const payload = JSON.parse(String(event.data));
      const entry = this.pending.get(payload.id);
      if (!entry) return;
      this.pending.delete(payload.id);
      payload.error ? entry.reject(new Error(payload.error.message)) : entry.resolve(payload.result);
    });
  }
  send(method, params = {}, sessionId) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    });
  }
}

async function connect(port) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      const info = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
      const ws = new WebSocket(info.webSocketDebuggerUrl);
      await new Promise((resolve, reject) => {
        ws.addEventListener('open', resolve, { once: true });
        ws.addEventListener('error', reject, { once: true });
      });
      return new Cdp(ws);
    } catch {
      await delay(100);
    }
  }
  throw new Error('Chrome debugger did not start');
}

async function main() {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const sitePort = server.address().port;
  const debugPort = await freePort();
  const profile = await mkdtemp(join(os.tmpdir(), 'bus-loop-lang-'));
  const chrome = spawn(CHROME, [
    '--headless=new', '--no-sandbox', '--enable-unsafe-swiftshader', '--enable-webgl',
    '--ignore-gpu-blocklist', '--mute-audio', '--no-first-run',
    `--lang=${locale}`, `--accept-lang=${locale}`,
    `--remote-debugging-port=${debugPort}`, '--remote-debugging-address=127.0.0.1',
    `--user-data-dir=${profile}`, '--window-size=390,844', 'about:blank'
  ], { stdio: ['ignore', 'ignore', 'ignore'], detached: process.platform !== 'win32' });
  try {
    const cdp = await connect(debugPort);
    const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
    await cdp.send('Page.enable', {}, sessionId);
    await cdp.send('Runtime.enable', {}, sessionId);
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: 390, height: 844, deviceScaleFactor: 2, mobile: true
    }, sessionId);
    await cdp.send('Page.navigate', { url: `http://127.0.0.1:${sitePort}/` }, sessionId);
    // Catch the loading screen before it fades out so its localized title can
    // be measured against the screen's padded width.
    await delay(900);
    const loading = await cdp.send('Runtime.evaluate', {
      expression: `(() => {
        const el = document.querySelector('#loading-title');
        const screen = document.querySelector('#loading-screen');
        if (!el || !screen) return null;
        const rect = el.getBoundingClientRect();
        const range = document.createRange();
        range.selectNodeContents(el);
        const text = range.getBoundingClientRect();
        return {
          text: el.textContent,
          hidden: screen.classList.contains('is-hidden'),
          fontSize: getComputedStyle(el).fontSize,
          screenWidth: Math.round(screen.clientWidth),
          textWidth: Math.round(text.width),
          fits: text.width <= screen.clientWidth,
          multiline: Math.round(text.height) > Math.round(parseFloat(getComputedStyle(el).fontSize) * 1.6)
        };
      })()`,
      returnByValue: true
    }, sessionId);
    await delay(5100);
    const result = await cdp.send('Runtime.evaluate', {
      expression: `(() => {
        const read = (selector) => {
          const el = document.querySelector(selector);
          if (!el) return null;
          const style = getComputedStyle(el);
          const rect = el.getBoundingClientRect();
          const range = document.createRange();
          range.selectNodeContents(el);
          const text = range.getBoundingClientRect();
          return { text: el.textContent, fontSize: style.fontSize, boxWidth: Math.round(rect.width),
            textWidth: Math.round(text.width), fits: text.width <= rect.width + 1 };
        };
        return {
          languages: navigator.languages, language: navigator.language,
          lang: document.documentElement.lang,
          title: document.title,
          url: location.href,
          bodyLength: document.body?.innerHTML.length ?? -1,
          bodyHead: (document.body?.innerText || '').slice(0, 160),
          branding: read('#branding-text'), cta: read('#cta-button'),
          editorPresent: !!document.querySelector('#scene-editor')?.children.length
        };
      })()`,
      returnByValue: true
    }, sessionId);
    console.log(JSON.stringify({ loading: loading.result.value, ...result.result.value }, null, 2));
  } finally {
    try { process.kill(-chrome.pid, 'SIGTERM'); } catch { chrome.kill('SIGTERM'); }
    await new Promise((resolve) => server.close(resolve));
    // Chrome can still be flushing its profile when the process dies; a failed
    // cleanup of a temp directory must not mask the probe result.
    await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }).catch(() => {});
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
