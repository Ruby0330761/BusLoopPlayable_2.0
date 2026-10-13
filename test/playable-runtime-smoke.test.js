import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  capturePlayableBackupImage,
  checkPlayableRuntimeArtifact,
  findChromeExecutable,
  resolveMainHtml
} from '../scripts/check-playable-runtime.mjs';

const NONBLANK_CANVAS_FIXTURE = `<!doctype html>
  <html><body style="margin:0;position:relative">
    <canvas id="game-canvas" width="390" height="844" style="display:block;width:390px;height:844px"></canvas>
    <button id="cta-button" style="position:absolute;left:95px;top:740px;width:200px;height:64px">Play Now</button>
    <script>
      const canvas = document.querySelector('#game-canvas');
      const context = canvas.getContext('2d');
      const gradient = context.createLinearGradient(0, 0, canvas.width, canvas.height);
      gradient.addColorStop(0, '#1677ff');
      gradient.addColorStop(0.5, '#f7d354');
      gradient.addColorStop(1, '#dc3545');
      context.fillStyle = gradient;
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.fillStyle = '#102030';
      for (let x = 0; x < canvas.width; x += 24) context.fillRect(x, 100 + x, 12, 180);
      window.__busLoop = { view: { scene: { children: [1] } } };
      const platform = window.__PLAYABLE_RUNTIME_SMOKE_HOST__.platform;
      if (platform === 'mintegral') {
        for (const name of ['install', 'gameReady', 'gameStart', 'gameEnd', 'gameClose', 'gameRetry']) window[name] = () => {};
        window.gameReady();
        window.gameStart();
      }
      document.querySelector('#cta-button').addEventListener('click', () => {
        if (platform === 'applovin' || platform === 'unityads') window.mraid.open('https://example.test');
        else if (platform === 'google-ads') window.ExitApi.exit('install');
        else if (platform === 'meta' || platform === 'moloco') window.FbPlayableAd.onCTAClick();
        else if (platform === 'tiktok') window.playableSDK.openAppStore();
        else if (platform === 'mintegral') { window.gameEnd(); window.install(); }
      });
    </script>
  </body></html>`;

const DEVICE_PROBE_FIXTURE = NONBLANK_CANVAS_FIXTURE.replace(
  '</body>',
  `<script>
    document.querySelector('#cta-button').addEventListener('click', () => {
      const ios = /iPhone|iPad|iPod/i.test(navigator.userAgent);
      if (!ios) throw new Error('device probe expected an iPhone user agent, got ' + navigator.userAgent);
    });
  </script></body>`
);

const EARLY_AUDIO_FIXTURE = NONBLANK_CANVAS_FIXTURE.replace(
  '</body>',
  '<script>document.createElement("audio").play();</script></body>'
);

const MUTED_PRE_ROLL_FIXTURE = NONBLANK_CANVAS_FIXTURE.replace(
  '</body>',
  `<div id="pre-roll-overlay" style="position:fixed;inset:0;background:#000;z-index:20">
    <video id="pre-roll-video" muted playsinline></video>
  </div>
  <script>
    const preRoll = document.querySelector('#pre-roll-overlay');
    const video = document.querySelector('#pre-roll-video');
    video.addEventListener('ended', () => { preRoll.hidden = true; });
    video.autoplay = true;
    video.load();
  </script></body>`
);

const INVALID_AUDIO_ON_CTA_FIXTURE = NONBLANK_CANVAS_FIXTURE.replace(
  '</body>',
  `<script>
    document.querySelector('#cta-button').addEventListener('click', () => {
      const context = new AudioContext();
      context.decodeAudioData(new Uint8Array([0]).buffer).catch(() => {});
    });
  </script></body>`
);

const SYNTHETIC_CTA_FIXTURE = NONBLANK_CANVAS_FIXTURE.replace(
  '</body>',
  '<script>document.querySelector("#cta-button").click();</script></body>'
);

const UNSAFE_DYNAMIC_IMAGE_FIXTURE = NONBLANK_CANVAS_FIXTURE.replace(
  '</body>',
  `<script>
    const creativeConfig = { imageAsset: 'unsafe.png' };
    const dynamicImage = new Image();
    dynamicImage.alt = 'configured dynamic image';
    dynamicImage.src = creativeConfig.imageAsset;
    document.body.append(dynamicImage);
  </script></body>`
);

test('runtime smoke resolves root, nested, and single platform HTML entries', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'runtime-smoke-entry-'));
  try {
    await mkdir(path.join(root, 'nested'), { recursive: true });
    await writeFile(path.join(root, 'nested', 'playable.html'), '<!doctype html>', 'utf8');
    assert.equal(await resolveMainHtml(root), path.join('nested', 'playable.html'));
    await writeFile(path.join(root, 'index.html'), '<!doctype html>', 'utf8');
    assert.equal(await resolveMainHtml(root), 'index.html');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('runtime smoke isolates Chromium in a process group and cleans up descendants', async () => {
  const runtime = await readFile(new URL('../scripts/check-playable-runtime.mjs', import.meta.url), 'utf8');
  assert.match(runtime, /detached: process\.platform !== 'win32'/);
  assert.match(runtime, /process\.kill\(-browser\.pid, signal\)/);
  assert.match(runtime, /signalBrowserTree\('SIGKILL'\)/);
});

test('runtime smoke accepts a loaded, nonblank playable canvas without console errors', { timeout: 30_000 }, async (context) => {
  const chrome = await findChromeExecutable();
  if (!chrome) {
    context.skip('Chrome/Chromium is unavailable.');
    return;
  }
  const root = await mkdtemp(path.join(os.tmpdir(), 'runtime-smoke-fixture-'));
  try {
    const artifactPath = path.join(root, 'fixture.html');
    await writeFile(artifactPath, NONBLANK_CANVAS_FIXTURE, 'utf8');
    const report = await checkPlayableRuntimeArtifact({
      artifactPath,
      platform: 'meta',
      chrome,
      timeoutMs: 8_000
    });
    assert.equal(report.conclusion, 'PASS', JSON.stringify(report.checks, null, 2));
    assert.equal(report.summary.fail, 0);
    assert.equal(report.checks.find((item) => item.id === 'RUNTIME-CANVAS-002').status, 'pass');
    assert.equal(report.checks.find((item) => item.id === 'RUNTIME-AUDIO-001').status, 'pass');
    assert.equal(report.checks.find((item) => item.id === 'RUNTIME-AUDIO-002').status, 'pass');
    assert.equal(report.checks.find((item) => item.id === 'RUNTIME-CTA-002').status, 'pass');
    assert.equal(report.checks.find((item) => item.id === 'RUNTIME-DYNAMIC-IMAGE-001').status, 'pass');
    assert.equal(report.ctaCapture.isTrusted, true);
    assert.equal(report.ctaCapture.actualBridgeCalls[0].bridge, 'fb-cta');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('runtime smoke emulates the branding variant device instead of the host browser', { timeout: 30_000 }, async (context) => {
  const chrome = await findChromeExecutable();
  if (!chrome) {
    context.skip('Chrome/Chromium is unavailable.');
    return;
  }
  const root = await mkdtemp(path.join(os.tmpdir(), 'runtime-device-fixture-'));
  try {
    const artifactPath = path.join(root, 'fixture.html');
    await writeFile(artifactPath, DEVICE_PROBE_FIXTURE, 'utf8');
    // Without a device the page sees the desktop host, so an iOS-only path fails the check.
    const hostReport = await checkPlayableRuntimeArtifact({
      artifactPath,
      platform: 'applovin',
      chrome,
      timeoutMs: 8_000
    });
    assert.equal(hostReport.checks.find((item) => item.id === 'RUNTIME-CONSOLE-001').status, 'fail');
    // The ios device profile must reach the page before its scripts run, matching a real iPhone.
    const iosReport = await checkPlayableRuntimeArtifact({
      artifactPath,
      platform: 'applovin',
      chrome,
      timeoutMs: 8_000,
      device: 'ios'
    });
    assert.equal(iosReport.conclusion, 'PASS', JSON.stringify(iosReport.checks, null, 2));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('runtime smoke captures the complete Mintegral lifecycle from the real CTA path', { timeout: 30_000 }, async (context) => {
  const chrome = await findChromeExecutable();
  if (!chrome) {
    context.skip('Chrome/Chromium is unavailable.');
    return;
  }
  const root = await mkdtemp(path.join(os.tmpdir(), 'runtime-mintegral-fixture-'));
  try {
    const artifactPath = path.join(root, 'fixture.html');
    await writeFile(artifactPath, NONBLANK_CANVAS_FIXTURE, 'utf8');
    const report = await checkPlayableRuntimeArtifact({
      artifactPath,
      platform: 'mintegral',
      chrome,
      timeoutMs: 8_000
    });
    assert.equal(report.conclusion, 'PASS', JSON.stringify(report.checks, null, 2));
    assert.equal(report.checks.find((item) => item.id === 'RUNTIME-MINTEGRAL-001').status, 'pass');
    assert.equal(report.checks.find((item) => item.id === 'RUNTIME-MINTEGRAL-002').status, 'pass');
    assert.equal(report.lifecycleCapture.installCaptured, true);
    assert.equal(report.lifecycleCapture.sequenceValid, true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('runtime smoke rejects audio playback attempted before trusted interaction', { timeout: 30_000 }, async (context) => {
  const chrome = await findChromeExecutable();
  if (!chrome) {
    context.skip('Chrome/Chromium is unavailable.');
    return;
  }
  const root = await mkdtemp(path.join(os.tmpdir(), 'runtime-audio-fixture-'));
  try {
    const artifactPath = path.join(root, 'fixture.html');
    await writeFile(artifactPath, EARLY_AUDIO_FIXTURE, 'utf8');
    const report = await checkPlayableRuntimeArtifact({
      artifactPath,
      platform: 'meta',
      chrome,
      timeoutMs: 8_000
    });
    assert.equal(report.conclusion, 'FAIL');
    assert.equal(report.checks.find((item) => item.id === 'RUNTIME-AUDIO-001').status, 'fail');
    assert.equal(report.probe.audioBeforeInteraction[0].type, 'HTMLMediaElement.play');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('runtime smoke accepts muted pre-roll playback and waits for its transition', { timeout: 30_000 }, async (context) => {
  const chrome = await findChromeExecutable();
  if (!chrome) {
    context.skip('Chrome/Chromium is unavailable.');
    return;
  }
  const root = await mkdtemp(path.join(os.tmpdir(), 'runtime-preroll-fixture-'));
  try {
    const artifactPath = path.join(root, 'fixture.html');
    await writeFile(artifactPath, MUTED_PRE_ROLL_FIXTURE, 'utf8');
    const report = await checkPlayableRuntimeArtifact({
      artifactPath,
      platform: 'meta',
      chrome,
      timeoutMs: 8_000
    });
    assert.equal(report.conclusion, 'PASS', JSON.stringify(report.checks, null, 2));
    assert.equal(report.checks.find((item) => item.id === 'RUNTIME-PREROLL-001').status, 'pass');
    assert.equal(report.checks.find((item) => item.id === 'RUNTIME-AUDIO-001').status, 'pass');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('runtime smoke rejects one-byte audio decoded after trusted interaction', { timeout: 30_000 }, async (context) => {
  const chrome = await findChromeExecutable();
  if (!chrome) {
    context.skip('Chrome/Chromium is unavailable.');
    return;
  }
  const root = await mkdtemp(path.join(os.tmpdir(), 'runtime-invalid-audio-fixture-'));
  try {
    const artifactPath = path.join(root, 'fixture.html');
    await writeFile(artifactPath, INVALID_AUDIO_ON_CTA_FIXTURE, 'utf8');
    const report = await checkPlayableRuntimeArtifact({
      artifactPath,
      platform: 'meta',
      chrome,
      timeoutMs: 8_000
    });
    assert.equal(report.conclusion, 'FAIL');
    assert.equal(report.checks.find((item) => item.id === 'RUNTIME-AUDIO-002').status, 'fail');
    assert.equal(report.probe.audioDecodes[0].byteLength, 1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('runtime smoke rejects a CTA bridge invoked by a synthetic pre-interaction click', { timeout: 30_000 }, async (context) => {
  const chrome = await findChromeExecutable();
  if (!chrome) {
    context.skip('Chrome/Chromium is unavailable.');
    return;
  }
  const root = await mkdtemp(path.join(os.tmpdir(), 'runtime-synthetic-cta-fixture-'));
  try {
    const artifactPath = path.join(root, 'fixture.html');
    await writeFile(artifactPath, SYNTHETIC_CTA_FIXTURE, 'utf8');
    const report = await checkPlayableRuntimeArtifact({
      artifactPath,
      platform: 'meta',
      chrome,
      timeoutMs: 8_000
    });
    assert.equal(report.conclusion, 'FAIL');
    assert.equal(report.checks.find((item) => item.id === 'RUNTIME-CTA-000').status, 'fail');
    assert.equal(report.probe.earlyBridgeCalls[0].beforeInteraction, true);
    assert.equal(report.ctaCapture.isTrusted, true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('runtime smoke rejects unsafe assignments for configured Google or Meta images', { timeout: 30_000 }, async (context) => {
  const chrome = await findChromeExecutable();
  if (!chrome) {
    context.skip('Chrome/Chromium is unavailable.');
    return;
  }
  const root = await mkdtemp(path.join(os.tmpdir(), 'runtime-dynamic-image-fixture-'));
  try {
    await writeFile(path.join(root, 'index.html'), UNSAFE_DYNAMIC_IMAGE_FIXTURE, 'utf8');
    await writeFile(
      path.join(root, 'unsafe.png'),
      Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64')
    );
    const report = await checkPlayableRuntimeArtifact({
      artifactPath: root,
      platform: 'meta',
      chrome,
      timeoutMs: 8_000
    });
    assert.equal(report.conclusion, 'FAIL');
    const dynamicCheck = report.checks.find((item) => item.id === 'RUNTIME-DYNAMIC-IMAGE-001');
    assert.equal(dynamicCheck.status, 'fail');
    assert.deepEqual(dynamicCheck.evidence.configuredAssets, ['unsafe.png']);
    assert.equal(dynamicCheck.evidence.unsafeAssignments[0].scheme, 'relative');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('runtime capture writes a real JPEG backup from the playable canvas', { timeout: 30_000 }, async (context) => {
  const chrome = await findChromeExecutable();
  if (!chrome) {
    context.skip('Chrome/Chromium is unavailable.');
    return;
  }
  const root = await mkdtemp(path.join(os.tmpdir(), 'runtime-backup-fixture-'));
  try {
    const artifactPath = path.join(root, 'fixture.html');
    const outputPath = path.join(root, 'backup.jpg');
    await writeFile(artifactPath, NONBLANK_CANVAS_FIXTURE, 'utf8');
    const result = await capturePlayableBackupImage({
      artifactPath,
      outputPath,
      chrome,
      timeoutMs: 8_000
    });
    const bytes = await readFile(outputPath);
    assert.equal(bytes[0], 0xff);
    assert.equal(bytes[1], 0xd8);
    assert.equal(bytes.at(-2), 0xff);
    assert.equal(bytes.at(-1), 0xd9);
    assert.equal(result.bytes, bytes.length);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('runtime smoke rejects a packaged page that never finishes loading', { timeout: 30_000 }, async (context) => {
  const chrome = await findChromeExecutable();
  if (!chrome) {
    context.skip('Chrome/Chromium is unavailable.');
    return;
  }
  const root = await mkdtemp(path.join(os.tmpdir(), 'runtime-smoke-broken-'));
  try {
    const artifactPath = path.join(root, 'broken.html');
    await writeFile(artifactPath, `<!doctype html>
      <html><body>
        <canvas id="game-canvas"></canvas>
        <div id="loading-screen"><span id="loading-progress-value">0%</span></div>
        <script>Promise.reject(new Error('startup failed'));</script>
      </body></html>`, 'utf8');
    const report = await checkPlayableRuntimeArtifact({
      artifactPath,
      platform: 'google-ads',
      chrome,
      timeoutMs: 3_000
    });
    assert.equal(report.conclusion, 'FAIL');
    assert.equal(report.checks.find((item) => item.id === 'RUNTIME-STARTUP-001').status, 'fail');
    assert.equal(report.checks.find((item) => item.id === 'RUNTIME-LOADING-001').status, 'fail');
    assert.equal(report.checks.find((item) => item.id === 'RUNTIME-CONSOLE-001').status, 'fail');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
