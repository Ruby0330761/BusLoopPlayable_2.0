import test from 'node:test';
import assert from 'node:assert/strict';
import { createPreRollController, normalizePreRollConfig } from '../src/pre-roll.js';

class FakeClassList {
  values = new Set();
  add(value) { this.values.add(value); }
  remove(value) { this.values.delete(value); }
  contains(value) { return this.values.has(value); }
}

class FakeVideo extends EventTarget {
  src = '';
  muted = false;
  defaultMuted = false;
  playsInline = false;
  preload = '';
  playCalls = 0;
  autoplay = false;
  volume = 1;
  pauseCalls = 0;
  loadCalls = 0;
  attributes = new Map();
  play() { this.playCalls += 1; return Promise.resolve(); }
  pause() { this.pauseCalls += 1; }
  load() { this.loadCalls += 1; }
  setAttribute(name, value) { this.attributes.set(name, value); }
  removeAttribute(name) { this.attributes.delete(name); }
}

function makeRoot() {
  const properties = new Map();
  const events = new EventTarget();
  return {
    hidden: true,
    attributes: new Map(),
    classList: new FakeClassList(),
    style: {
      setProperty(name, value) { properties.set(name, value); },
      getPropertyValue(name) { return properties.get(name) ?? ''; }
    },
    setAttribute(name, value) { this.attributes.set(name, value); },
    addEventListener(...args) { events.addEventListener(...args); },
    removeEventListener(...args) { events.removeEventListener(...args); },
    dispatchEvent(event) { return events.dispatchEvent(event); }
  };
}

test('pre-roll config accepts packaged MP4 assets and rejects remote URLs', () => {
  assert.deepEqual(normalizePreRollConfig({
    enabled: 1,
    asset: '/assets/preroll/TP1327.mp4',
    soundEnabled: 1,
    fadeDurationSeconds: 9
  }), {
    enabled: true,
    asset: '/assets/preroll/TP1327.mp4',
    soundEnabled: true,
    fadeDurationSeconds: 2
  });
  assert.equal(normalizePreRollConfig({ enabled: 1, asset: 'https://example.com/a.mp4' }).enabled, false);
  assert.equal(normalizePreRollConfig({
    enabled: 1,
    asset: '/assets/editor-prerolls/preroll-61bb9e7c09d9-TP1331.mp4'
  }).enabled, true);
  assert.equal(normalizePreRollConfig({
    enabled: 1,
    asset: '/assets/editor-prerolls/../secret.mp4'
  }).enabled, false);
});

test('pre-roll reveals only after both video and game are ready', async () => {
  const root = makeRoot();
  const video = new FakeVideo();
  const scheduled = [];
  let reveals = 0;
  const controller = createPreRollController({
    root,
    video,
    onReveal: () => { reveals += 1; },
    schedule: (callback) => { scheduled.push(callback); return scheduled.length; },
    cancel: () => {}
  });

  await controller.play({ enabled: 1, asset: '/assets/preroll/TP1327.mp4', fadeDurationSeconds: 0.4 });
  assert.equal(controller.isActive(), true);
  assert.equal(root.hidden, false);
  controller.setGameReady();
  assert.equal(reveals, 0);
  video.dispatchEvent(new Event('ended'));
  assert.equal(reveals, 1);
  assert.equal(controller.isActive(), false);
  assert.equal(root.classList.contains('is-leaving'), true);
  scheduled.at(-1)();
  assert.equal(root.hidden, true);
});

test('pre-roll uses native muted autoplay and enables sound only after a pointer gesture', async () => {
  const root = makeRoot();
  const video = new FakeVideo();
  const controller = createPreRollController({ root, video, schedule: () => 1, cancel: () => {} });

  await controller.play({
    enabled: 1,
    asset: '/assets/preroll/TP1333.mp4',
    soundEnabled: 1
  });

  assert.equal(video.playCalls, 0);
  assert.equal(video.autoplay, true);
  assert.equal(video.attributes.has('autoplay'), true);
  assert.equal(video.muted, true);
  assert.equal(video.defaultMuted, true);
  assert.equal(video.volume, 0);
  assert.equal(video.loadCalls, 1);
  root.dispatchEvent(new Event('pointerdown'));
  assert.equal(video.muted, false);
  assert.equal(video.volume, 1);
  assert.equal(controller.isActive(), true);
});
