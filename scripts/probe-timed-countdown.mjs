#!/usr/bin/env node
// One-off behavioural probe for the BL-2610285 timed level.
//
// Loads an exported single-HTML artifact in headless Chrome and drives the real
// runtime through `window.__busLoop` (present in production builds), then reads
// the HUD DOM and the QA hooks. This is deliberately separate from the platform
// runtime gate: it proves *what the countdown does*, not that the ad boots.
//
//   node scripts/probe-timed-countdown.mjs <artifact.html> [--timeout 90]
//
// The clock runs on real wall time, so a 60 s countdown needs ~65 s.

import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { findChromeExecutable } from './check-playable-runtime.mjs';

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const artifactPath = path.resolve(process.argv[2] ?? '');
if (!artifactPath) {
  console.error('Usage: node scripts/probe-timed-countdown.mjs <artifact.html> [--timeout 90]');
  process.exit(2);
}
const timeoutFlag = process.argv.indexOf('--timeout');
const observeSeconds = timeoutFlag > 0 ? Number(process.argv[timeoutFlag + 1]) : 90;

const html = await readFile(artifactPath, 'utf8');
const siteRoot = await mkdtemp(path.join(os.tmpdir(), 'timed-countdown-probe-'));
const htmlName = 'index.html';
await writeFile(path.join(siteRoot, htmlName), html, 'utf8');

const server = http.createServer((request, response) => {
  const pathname = decodeURIComponent(new URL(request.url, 'http://127.0.0.1').pathname);
  if (pathname === '/mraid.js') {
    response.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8' });
    response.end('/* mraid stub */');
    return;
  }
  if (pathname === '/' || pathname === `/${htmlName}`) {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    response.end(html);
    return;
  }
  response.writeHead(404);
  response.end('not found');
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const pageUrl = `http://127.0.0.1:${server.address().port}/`;

const chrome = await findChromeExecutable();
if (!chrome) throw new Error('No Chrome executable found for the countdown probe.');
const profile = path.join(siteRoot, 'chrome-profile');
// Same browser flags as the platform runtime gate: headless THREE.js needs the
// unsafe SwiftShader path or the canvas never gets a WebGL context.
const chromeProcess = spawn(chrome, [
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
  '--remote-debugging-port=0',
  '--remote-debugging-address=127.0.0.1',
  `--user-data-dir=${profile}`,
  '--window-size=390,844',
  'about:blank'
], { stdio: ['ignore', 'ignore', 'pipe'] });
let chromeStderr = '';
chromeProcess.stderr.on('data', (chunk) => { chromeStderr = `${chromeStderr}${chunk}`.slice(-4000); });

async function debuggerUrl() {
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    const match = chromeStderr.match(/DevTools listening on (ws:\/\/\S+)/u);
    if (match) {
      const port = Number(new URL(match[1]).port);
      const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      const page = targets.find((target) => target.type === 'page' && target.webSocketDebuggerUrl);
      if (page) return page.webSocketDebuggerUrl;
    }
    await delay(120);
  }
  throw new Error(`Chrome DevTools did not start.\n${chromeStderr}`);
}

class Cdp {
  constructor(url) { this.url = url; this.nextId = 1; this.pending = new Map(); }
  async connect() {
    this.socket = new WebSocket(this.url);
    await new Promise((resolve, reject) => {
      this.socket.addEventListener('open', resolve, { once: true });
      this.socket.addEventListener('error', () => reject(new Error('CDP socket failed')), { once: true });
    });
    this.socket.addEventListener('message', (event) => {
      const message = JSON.parse(String(event.data));
      if (!message.id) return;
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      if (message.error) pending.reject(new Error(message.error.message));
      else pending.resolve(message.result ?? {});
    });
  }
  send(method, params = {}) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }
  close() { try { this.socket?.close(); } catch {} }
}

const evaluate = async (client, expression) => {
  const result = await client.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text ?? 'evaluation failed');
  return result.result?.value;
};

const report = { artifact: path.basename(artifactPath), sha256: createHash('sha256').update(html).digest('hex'),
  startedAt: new Date().toISOString(), steps: [], holes: [], screenshots: [] };
const step = (name, value) => { report.steps.push({ name, at: Date.now(), value }); console.log(`[probe] ${name}:`, JSON.stringify(value)); };
const hole = (message) => { report.holes.push(message); console.warn(`[probe] HOLE: ${message}`); };

const client = new Cdp(await debuggerUrl());
await client.connect();
const shotDir = path.join(path.dirname(artifactPath), 'timed-countdown-shots');
const shoot = async (name) => {
  const { mkdir, writeFile: write } = await import('node:fs/promises');
  await mkdir(shotDir, { recursive: true });
  const { data } = await client.send('Page.captureScreenshot', { format: 'png', fromSurface: true });
  const file = path.join(shotDir, `${name}.png`);
  await write(file, Buffer.from(data, 'base64'));
  report.screenshots.push(file);
  console.log(`[probe] shot ${name}: ${file}`);
};
try {
  await client.send('Page.enable');
  await client.send('Runtime.enable');
  // Record store navigation attempts without actually leaving the ad.
  await client.send('Page.addScriptToEvaluateOnNewDocument', {
    source: `(() => {
      window.__probeClicks = [];
      const original = HTMLAnchorElement.prototype.click;
      HTMLAnchorElement.prototype.click = function () {
        window.__probeClicks.push({ href: this.href, target: this.target, at: Date.now() });
        return undefined;
      };
      window.__probeOpens = [];
      window.open = (...args) => { window.__probeOpens.push(args); return null; };
    })();`
  });
  await client.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await client.send('Emulation.setUserAgentOverride', {
    userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.6478.122 Mobile Safari/537.36'
  });
  await client.send('Page.navigate', { url: pageUrl });

  const readyDeadline = Date.now() + 30000;
  let booted = false;
  while (Date.now() < readyDeadline) {
    const state = await evaluate(client, `(() => ({
      api: Boolean(window.__busLoop),
      countdown: window.__busLoop?.countdown?.() ?? null,
      cam: Boolean(document.querySelector('#game-canvas'))
    }))()`).catch(() => null);
    if (state?.api && state.countdown && state.countdown.started === false) { booted = true; step('boot', state); break; }
    await delay(250);
  }
  if (!booted) throw new Error('The playable never exposed its countdown state.');

  const initial = await evaluate(client, `(() => {
    const root = document.querySelector('#countdown');
    const warning = document.querySelector('#countdown-warning');
    return {
      countdown: window.__busLoop.countdown(),
      hudHidden: root?.hidden ?? null,
      hudText: document.querySelector('#countdown-value')?.textContent ?? null,
      hudTop: root?.getBoundingClientRect().top ?? null,
      hudWidth: root?.getBoundingClientRect().width ?? null,
      warningHidden: warning?.hidden ?? null,
      ambulanceSteps: window.__busLoop.snapshot().vehicles.filter((v) => Number.isInteger(v.ambulanceRemainingSteps)).length,
      ambulanceBadgeIds: window.__busLoop.snapshot().vehicles.filter((v) => Number.isInteger(v.ambulanceStepLimit)).map((v) => v.id),
      ambulanceStepBoard: Boolean(window.__busLoop.view?.vehicleViews?.get?.(162)?.userData?.ambulanceStepBoard),
      siren: window.__busLoop.countdownSiren?.() ?? null
    };
  })()`);
  step('initial', initial);
  if (initial.countdown.durationSeconds !== 60) hole(`duration ${initial.countdown.durationSeconds} != 60`);
  if (initial.countdown.warningSeconds !== 10) hole(`warning ${initial.countdown.warningSeconds} != 10`);
  if (initial.countdown.enabled !== 1) hole('countdown is disabled');
  if (initial.hudText !== '01:00') hole(`initial HUD text ${initial.hudText} != 01:00`);
  if (initial.hudHidden !== false) hole('HUD hidden before any play');
  if (initial.ambulanceBadgeIds.length) hole(`vehicles still carry a step budget: ${initial.ambulanceBadgeIds}`);
  if (initial.ambulanceStepBoard) hole('the ambulance still shows its step badge');
  if (!initial.siren?.enabled) hole('siren toggle is off');
  await shoot('01-idle');

  // A real tap first: WebAudio only unlocks on trusted user activation, and the
  // siren can never start without it. Then dispatch through the same click path
  // the player uses.
  await client.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: 195, y: 420, button: 'left', clickCount: 1 });
  await client.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: 195, y: 420, button: 'left', clickCount: 1 });
  await delay(500);

  // The clock starts on the first real dispatch, so drive the same click path
  // the player uses. Pick a vehicle that is currently dispatchable.
  const clickTarget = await evaluate(client, `(() => {
    const game = window.__busLoop.game;
    const snapshot = window.__busLoop.snapshot();
    for (const vehicle of snapshot.vehicles) {
      if (vehicle.state !== 'parked') continue;
      if (window.__busLoop.game.getBlockers?.(vehicle.id)?.length) continue;
      return { id: vehicle.id, blockers: window.__busLoop.game.getBlockers?.(vehicle.id) ?? [] };
    }
    return null;
  })()`);
  step('clickTarget', clickTarget);
  if (clickTarget) {
    const result = await evaluate(client, `window.__busLoop.clickVehicle(${Number(clickTarget.id)})`);
    step('click', result);
  }
  await delay(1200);
  const afterTap = await evaluate(client, `(() => ({
    countdown: window.__busLoop.countdown(),
    siren: window.__busLoop.countdownSiren?.() ?? null,
    audioState: (() => { try { return window.__busLoop && document.querySelector('#countdown')?.dataset.state; } catch { return null; } })()
  }))()`);
  step('afterTap', afterTap);
  if (afterTap.countdown.started !== true) hole('countdown did not start after a dispatch');
  if (!afterTap.siren?.playing) hole('siren loop is not playing while the clock runs');
  await shoot('02-running');

  // Observe until the deadline, recording the urgent window and the store jump.
  const startedAt = Date.now();
  let sawUrgent = false;
  let urgentSnapshot = null;
  let sawStoreJump = false;
  let storeJump = null;
  let sawGameOver = false;
  while (Date.now() - startedAt < observeSeconds * 1000) {
    const state = await evaluate(client, `(() => {
      const warning = document.querySelector('#countdown-warning');
      const root = document.querySelector('#countdown');
      const over = document.querySelector('#game-over-overlay');
      const style = warning ? getComputedStyle(warning) : null;
      const before = warning ? getComputedStyle(warning, '::before') : null;
      return {
        countdown: window.__busLoop.countdown(),
        text: document.querySelector('#countdown-value')?.textContent ?? null,
        warningHidden: warning?.hidden ?? null,
        warningOpacity: style?.opacity ?? null,
        warningPulseOpacity: before?.opacity ?? null,
        warningDisplay: style?.display ?? null,
        warningAnimation: style?.animationName ?? null,
        hudHidden: root?.hidden ?? null,
        gameOverHidden: over?.hidden ?? null,
        siren: window.__busLoop.countdownSiren?.() ?? null,
        clicks: (window.__probeClicks ?? []).slice(-3),
        opens: (window.__probeOpens ?? []).slice(-3)
      };
    })()`).catch((error) => ({ error: error.message }));
    if (state?.error) break;
    if (state.countdown?.urgent && !sawUrgent) {
      sawUrgent = true;
      urgentSnapshot = state;
      step('urgent', state);
      if (state.warningHidden !== false) hole('red glow stays hidden inside the last 10 seconds');
      if (Number(state.warningOpacity) <= 0) hole('red glow opacity is zero');
      if (!/countdown-danger/.test(String(state.warningAnimation))) hole('red glow is not animating');
      await shoot('03-urgent');
    }
    if (state.gameOverHidden === false) sawGameOver = true;
    const jumped = (state.clicks?.length ?? 0) > 0 || (state.opens?.length ?? 0) > 0;
    if (jumped && !sawStoreJump) {
      sawStoreJump = true;
      storeJump = state;
      step('storeJump', state);
      await shoot('04-timeout');
    }
    if (state.countdown?.state === 'timeout' || state.countdown?.state === 'lost') {
      await delay(600);
      break;
    }
    await delay(500);
  }

  const final = await evaluate(client, `(() => ({
    countdown: window.__busLoop.countdown(),
    clicks: window.__probeClicks ?? [],
    opens: window.__probeOpens ?? [],
    gameOverHidden: document.querySelector('#game-over-overlay')?.hidden ?? null,
    siren: window.__busLoop.countdownSiren?.() ?? null
  }))()`);
  step('final', final);
  if (!sawUrgent) hole('never observed the last-10s red glow');
  if (!sawStoreJump) hole('the countdown deadline never attempted a store jump');
  if (sawGameOver) hole('a Game Over card appeared over the countdown store jump');
  if (final.siren?.playing) hole('siren kept looping after the clock ended');
  if (!['timeout', 'lost', 'finished'].includes(final.countdown?.state)) {
    hole(`countdown ended in state ${final.countdown?.state}`);
  }
  report.ok = report.holes.length === 0;
  report.finishedAt = new Date().toISOString();
} finally {
  client.close();
  chromeProcess.kill('SIGTERM');
  await new Promise((resolve) => server.close(resolve));
  await rm(siteRoot, { recursive: true, force: true }).catch(() => {});
}

const outputPath = path.resolve(path.dirname(artifactPath), 'timed-countdown-probe.json');
await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
console.log(`\n${report.ok ? 'PASS' : 'FAIL'} — ${outputPath}`);
if (!report.ok) {
  for (const message of report.holes) console.error(` - ${message}`);
  process.exitCode = 1;
}
