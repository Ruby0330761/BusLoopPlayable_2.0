import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DEFAULT_PROGRESS_HUD_CONFIG,
  normalizeProgressHudConfig,
  validateProgressHudConfig,
  resolveProgressHudRatio,
  PROGRESS_HUD_SPECTRUM_STOPS
} from '../src/progress-hud-config.js';

test('progress HUD defaults are off so existing levels are untouched', () => {
  assert.equal(DEFAULT_PROGRESS_HUD_CONFIG.enabled, 0);
  const normalized = normalizeProgressHudConfig(undefined);
  assert.equal(normalized.enabled, 0);
  assert.equal(normalized.nodePercent, 50);
  assert.equal(normalized.failPercent, 29);
  // The bar must be exported even from a stale or empty profile.
  assert.equal(validateProgressHudConfig({}).enabled, 0);
});

test('node and copy percentages are clamped to sane ranges', () => {
  assert.equal(normalizeProgressHudConfig({ nodePercent: 0 }).nodePercent, 1);
  assert.equal(normalizeProgressHudConfig({ nodePercent: 120 }).nodePercent, 99);
  assert.equal(normalizeProgressHudConfig({ failPercent: -5 }).failPercent, 0);
  assert.equal(normalizeProgressHudConfig({ failPercent: 150 }).failPercent, 100);
  // Enabled profiles reject a node outside 1–99 so the marker can never leave
  // the track.
  assert.throws(() => validateProgressHudConfig({ enabled: 1, nodePercent: 120 }), /1–99/);
  assert.throws(() => validateProgressHudConfig({ enabled: 1, failPercent: 101 }), /0–100/);
  assert.throws(() => validateProgressHudConfig({ enabled: 1, scale: 9 }), /0\.2–3/);
});

test('the progress ratio follows cleared passengers, not the CTA counter', () => {
  // The level is played to the end, so 100% means every passenger is out.
  assert.equal(resolveProgressHudRatio(510, 510), 0);
  assert.equal(resolveProgressHudRatio(255, 510), 0.5);
  assert.equal(resolveProgressHudRatio(0, 510), 1);
  // Guard rails: a half-built or stale snapshot must never slam the marker to
  // either end.
  assert.equal(resolveProgressHudRatio(Number.NaN, 510), 0);
  assert.equal(resolveProgressHudRatio(10, 0), 0);
  assert.equal(resolveProgressHudRatio(-20, 510), 1);
  assert.equal(resolveProgressHudRatio(999, 510), 0);
});

test('the track gradient ships four editable colour anchors', () => {
  // Percentages are fixed so the meter keeps an even distribution; only the
  // colours are author-editable.
  assert.deepEqual(PROGRESS_HUD_SPECTRUM_STOPS.map(([key]) => key),
    ['spectrumStart', 'spectrumEarly', 'spectrumLate', 'spectrumEnd']);
  assert.deepEqual(PROGRESS_HUD_SPECTRUM_STOPS.map(([, at]) => at), [0, 40, 58, 100]);
  for (const [key] of PROGRESS_HUD_SPECTRUM_STOPS) {
    const value = DEFAULT_PROGRESS_HUD_CONFIG[key];
    assert.equal(Number.isInteger(value), true, `${key} is an integer`);
    assert.ok(value >= 0 && value <= 0xffffff, `${key} is a 24-bit colour`);
  }
});

test('authored gradient colours survive normalization and are validated', () => {
  const tuned = normalizeProgressHudConfig({ enabled: 1, spectrumStart: 0x00ff00, spectrumEnd: 0x0000ff });
  assert.equal(tuned.spectrumStart, 0x00ff00);
  assert.equal(tuned.spectrumEnd, 0x0000ff);
  // Out-of-range values clamp on normalize, and an enabled profile rejects them.
  assert.equal(normalizeProgressHudConfig({ spectrumStart: -5 }).spectrumStart, 0);
  assert.equal(normalizeProgressHudConfig({ spectrumStart: 0x1000000 }).spectrumStart, 0xffffff);
  assert.throws(
    () => validateProgressHudConfig({ enabled: 1, spectrumLate: 0x1000000 }),
    /轨道渐变颜色/
  );
});

test('the bar sits on the reference ground line by default', () => {
  // 0 pushed the bar into the level's top edge once bubble head-room was
  // reserved; -109 is where it reads against the conveyor band.
  assert.equal(DEFAULT_PROGRESS_HUD_CONFIG.offsetY, -109);
  assert.equal(normalizeProgressHudConfig({}).offsetY, -109);
  // An explicit 0 is still honoured so older authored profiles keep working.
  assert.equal(normalizeProgressHudConfig({ offsetY: 0 }).offsetY, 0);
});

test('the whole HUD is off by default, and enabling it shows the full design', () => {
  // The bar used to default to on. Levels must not show it (markers, pointers,
  // pills, failure bubble) unless someone opts in, so `enabled` defaults to 0.
  assert.equal(DEFAULT_PROGRESS_HUD_CONFIG.enabled, 0);
  assert.equal(normalizeProgressHudConfig({}).enabled, 0);
  assert.equal(normalizeProgressHudConfig({ enabled: 1 }).enabled, 1);

  // With the HUD itself off by default, opting in has to yield the complete
  // design, so the coloured band defaults to visible rather than hidden.
  assert.equal(DEFAULT_PROGRESS_HUD_CONFIG.trackVisible, 1);
  assert.equal(normalizeProgressHudConfig({}).trackVisible, 1);
  assert.equal(normalizeProgressHudConfig({ trackVisible: 0 }).trackVisible, 0);
  // A non-1 truthy value does not count as "on".
  assert.equal(normalizeProgressHudConfig({ trackVisible: 2 }).trackVisible, 0);
  // A disabled profile still exports, and an explicit on survives validation.
  assert.equal(validateProgressHudConfig({ enabled: 0 }).trackVisible, 1);
  assert.equal(validateProgressHudConfig({ enabled: 1, trackVisible: 1 }).trackVisible, 1);
});
