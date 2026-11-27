import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createSuperBoost, createSuperBoostView, normalizeSuperBoostConfig } from '../src/super-boost.js';
import { createCountdown, COUNTDOWN_ALARM_ASSET } from '../src/countdown.js';
import { SCENE_TUNING } from '../src/scene-tuning.js';
import { validateTuning } from '../scripts/export-playable-package.mjs';
import { collectPlayableInlineAssetUrls } from '../src/playable-inline-assets.js';
import { GUIDE_HAND_ART, RETRY_BUTTON_ASSET_PATH } from '../src/mechanism-resources.js';
import { getSpeedToggleAssetPaths } from '../src/speed-toggle.js';

test('boost exports its guide, replay button and active speed skin with the ordinary controls off', () => {
  const tuning = { superBoost: { enabled: 1 }, speedToggle: { enabled: 0, style: 'light' } };
  const urls = collectPlayableInlineAssetUrls({ tuning });
  for (const asset of [GUIDE_HAND_ART, RETRY_BUTTON_ASSET_PATH, ...getSpeedToggleAssetPaths({ enabled: 1, style: 'light' })]) {
    assert.ok(urls.has(asset), asset);
  }
  assert.ok(!urls.has('/assets/applovin/speed-toggle-bg_q90.webp'));
});

test('legacy mode is inert; one tap latches 4x and reset requires another tap', () => {
  const old = createSuperBoost();
  assert.equal(old.activate(), false);
  assert.equal(old.snapshot().timeScale, 1);
  const boost = createSuperBoost({ enabled: 1 });
  assert.equal(boost.snapshot().waiting, true);
  assert.equal(boost.snapshot().timeScale, 1);
  assert.equal(boost.activate(), true);
  assert.equal(boost.activate(), false);
  assert.equal(boost.snapshot().timeScale, 4);
  assert.equal(boost.snapshot().waiting, false);
  boost.configure({ enabled: 1, multiplier: 5, flameEnabled: 0 });
  assert.equal(boost.snapshot().timeScale, 5);
  assert.equal(boost.snapshot().active, true);
  boost.reset();
  assert.equal(boost.snapshot().waiting, true);
  assert.equal(boost.snapshot().timeScale, 1);
  boost.activate();
  boost.configure({ enabled: 0 });
  assert.equal(boost.snapshot().active, false);
  assert.equal(boost.snapshot().timeScale, 1);
});

test('guide speed changes its animation duration without starting the challenge', () => {
  const properties = new Map();
  const guide = { style: { setProperty: (key, value) => properties.set(key, value) } };
  const button = { classList: { toggle() {} }, getBoundingClientRect: () => ({ left: 300, top: 20, width: 70, height: 45, bottom: 65 }) };
  const stage = { clientWidth: 390, clientHeight: 844, getBoundingClientRect: () => ({ left: 0, top: 0 }) };
  const view = createSuperBoostView({ guide, button, stage });
  const boost = createSuperBoost({ enabled: 1, guideSpeed: 0.5 });
  view.render(boost.snapshot());
  assert.equal(properties.get('--boost-hand-duration'), '1.6s');
  boost.configure({ enabled: 1, guideSpeed: 2 });
  view.render(boost.snapshot());
  assert.equal(properties.get('--boost-hand-duration'), '0.4s');
  assert.equal(boost.snapshot().timeScale, 1);
  assert.equal(boost.snapshot().waiting, true);
});

test('4x simulation and countdown have independent clocks, including pause and deadline', () => {
  let time = 0, timeouts = 0;
  const boost = createSuperBoost({ enabled: 1 });
  const clock = createCountdown({ enabled: 1, durationSeconds: 30 }, {
    now: () => time, onTimeout: () => { timeouts++; }
  });
  time = 10000;
  assert.equal(clock.tick().remaining, 30);
  boost.activate(); clock.start();
  time += 1000;
  assert.equal(boost.snapshot().timeScale, 4);
  assert.equal(clock.tick().remaining, 29);
  clock.setPaused(true);
  time += 10000;
  assert.equal(clock.tick().remaining, 29);
  clock.setPaused(false);
  time += 29000;
  assert.equal(clock.tick().remaining, 0);
  clock.tick(); assert.equal(timeouts, 1);
});

test('challenge tuning and alarm controls survive validation; referenced SVG is real', () => {
  const superBoost = normalizeSuperBoostConfig({ enabled: 1 });
  const countdown = { ...SCENE_TUNING.countdown, enabled: 1, iconEnabled: 1, iconScale: 1.2, iconOffsetX: 8 };
  const tuning = validateTuning({ superBoost, countdown }, SCENE_TUNING);
  assert.deepEqual(tuning.superBoost, superBoost);
  assert.equal(tuning.countdown.iconEnabled, 1);
  assert.equal(tuning.countdown.iconScale, 1.2);
  assert.equal(tuning.countdown.iconOffsetX, 8);
  assert.ok(collectPlayableInlineAssetUrls({ tuning }).has(COUNTDOWN_ALARM_ASSET));
  assert.match(readFileSync(new URL(`../public${COUNTDOWN_ALARM_ASSET}`, import.meta.url), 'utf8'), /<svg/);
});
