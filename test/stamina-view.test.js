import test from 'node:test';
import assert from 'node:assert/strict';
import { statSync } from 'node:fs';
import { createStaminaView } from '../src/stamina-view.js';
import { normalizeStaminaConfig, validateStaminaConfig, STAMINA_ASSETS, STAMINA_INTRO_ASSETS, getStaminaAssetPaths } from '../src/stamina.js';
import { validateTuning } from '../scripts/export-playable-package.mjs';
import { SCENE_TUNING } from '../src/scene-tuning.js';

function element() {
  const attrs = new Map();
  return {
    children: [], dataset: {}, style: { setProperty(key, value) { this[key] = value; } },
    setAttribute: (key, value) => attrs.set(key, value), getAttribute: key => attrs.get(key),
    removeAttribute: key => attrs.delete(key), set src(value) { attrs.set('src', value); },
    replaceChildren(...children) { this.children = children; },
    ownerDocument: { createElement: () => element() }
  };
}

function fixture(width = 390, height = 844, bounds = null, timerRect = null, speedRect = null) {
  const nodes = Object.fromEntries(['root', 'frame', 'hearts', 'intro', 'introFrame'].map(key => [key, element()]));
  const stage = { getBoundingClientRect: () => ({ left: 0, top: 0, width, height }) };
  const timer = { hidden: !timerRect, getBoundingClientRect: () => timerRect };
  const speedButton = { hidden: !speedRect, getBoundingClientRect: () => speedRect };
  const view = createStaminaView({ ...nodes, stage, timer, speedButton });
  view.resize(bounds);
  return { ...nodes, view };
}

test('all ten life counts survive editor export round trips; legacy profiles remain off', () => {
  assert.equal(normalizeStaminaConfig().enabled, 0);
  for (let lives = 1; lives <= 10; lives++) {
    const config = { enabled: 1, lives, introEnabled: 1, offsetX: -100, offsetY: 120, scale: 1.25 };
    assert.deepEqual(validateTuning({ stamina: config }, SCENE_TUNING).stamina, config);
  }
  assert.throws(() => validateStaminaConfig({ lives: 11 }), /integer between 1 and 10/);
  assert.throws(() => validateStaminaConfig({ scale: 0 }), /scale/);
  assert.throws(() => validateStaminaConfig({ lives: '3' }), /integer between 1 and 10/);
  assert.throws(() => validateStaminaConfig({ unknown: 1 }), /not supported/);
});

test('disabled stamina does not fetch any images; each preset paints actual full and empty hearts', () => {
  const f = fixture();
  f.view.render({ remaining: 0 });
  assert.equal(f.root.hidden, true);
  assert.equal(f.frame.getAttribute('src'), undefined);
  for (let lives = 1; lives <= 10; lives++) {
    const config = { enabled: 1, lives };
    f.view.reset(config);
    f.view.render({ remaining: lives - 1 }, { config });
    assert.equal(f.hearts.children.length, lives);
    assert.equal(f.hearts.children.at(-1).getAttribute('src'), STAMINA_ASSETS.empty);
    assert.equal(f.introFrame.getAttribute('src'), STAMINA_INTRO_ASSETS[lives]);
    assert.match(f.introFrame.alt, new RegExp(`^${lives} REVIVE`));
    assert.equal(f.root.getAttribute('aria-label'), `${lives - 1} of ${lives} rescues remaining`);
    assert.equal(f.hearts.dataset.count, String(lives));
  }
  f.view.render({}, { config: { enabled: 0 } });
  assert.equal(f.intro.hidden, true);
  assert.equal(f.hearts.children.length, 0);
  assert.equal(f.frame.getAttribute('src'), undefined);
});

test('intro uses two visible seconds, pauses without catch-up, retries replay and stage handoffs do not', () => {
  const f = fixture();
  f.view.reset({ enabled: 1, lives: 10 });
  f.view.tickIntro({ time: 0 });
  f.view.tickIntro({ time: 800 });
  assert.equal(f.view.introState().remaining, 1.2);
  f.view.tickIntro({ time: 1000, paused: true });
  f.view.tickIntro({ time: 100_000, paused: true });
  f.view.tickIntro({ time: 101_000 });
  assert.equal(f.view.introState().remaining, 1.2);
  f.view.tickIntro({ time: 102_201 });
  assert.equal(f.view.isIntroActive(), false);
  f.view.reset({ enabled: 1, lives: 1 });
  assert.equal(f.view.isIntroActive(), true);
  f.view.tickIntro({ time: 103_000, ended: true });
  assert.equal(f.view.isIntroActive(), false);
  f.view.reset({ enabled: 1, lives: 1 }, { playIntro: false });
  assert.equal(f.view.isIntroActive(), false);
  f.view.reset({ enabled: 1, introEnabled: 0 });
  assert.equal(f.view.isIntroActive(), false);
});

test('HUD remains within content across portrait, landscape and extreme offsets', () => {
  for (const [width, height, bounds, timerRect, speedRect] of [
    [390, 844, { left: 0, top: 0, right: 390, bottom: 844 }, { bottom: 65 }, null],
    [844, 390, { left: 260, top: 0, right: 584, bottom: 390 }, null, { left: 520, right: 575, top: 12, bottom: 50, height: 38, width: 55 }],
    [1920, 1080, { left: 748, top: 0, right: 1172, bottom: 1080 }, { bottom: 65 }, null]
  ]) {
    const f = fixture(width, height, bounds, timerRect, speedRect);
    if (speedRect) assert.ok(parseFloat(f.root.style.left) + parseFloat(f.root.style.width) / 2 < speedRect.left,
      'the default left HUD clears the right speed button');
    for (let lives = 1; lives <= 10; lives++) for (const direction of [-1, 1]) {
      f.view.resize(bounds, { enabled: 1, lives, offsetX: direction * 1080, offsetY: direction * 2160, scale: 3 }, 0.36);
      const x = parseFloat(f.root.style.left), y = parseFloat(f.root.style.top), w = parseFloat(f.root.style.width);
      const h = parseFloat(f.root.style.height);
      const referenceSizes = [[83, 72], [115, 72], [147, 72], [179, 72], [211, 72],
        [123, 96], [147, 96], [147, 96], [171, 96], [171, 96]];
      const [rw, rh] = referenceSizes[lives - 1];
      assert.ok(Math.abs(w / h - rw / rh) < 1e-6);
      assert.ok(x - w / 2 >= bounds.left - 1e-6);
      assert.ok(x + w / 2 <= bounds.right + 1e-6);
      assert.ok(y >= bounds.top && y + h <= bounds.bottom + 1e-6);
    }
  }
});

test('manual HUD coordinates are independent of the countdown and speed button and preserve X/Y offsets', () => {
  const bounds = { left: 0, top: 0, right: 390, bottom: 844 };
  const plain = fixture(390, 844, bounds);
  const withOtherHud = fixture(390, 844, bounds, { bottom: 200 }, { left: 200, right: 380, top: 0, bottom: 180 });
  for (const key of ['left', 'top', 'width']) assert.equal(plain.root.style[key], withOtherHud.root.style[key]);
  const x = parseFloat(plain.root.style.left), y = parseFloat(plain.root.style.top);
  plain.view.resize(bounds, { offsetX: 100, offsetY: 200, scale: 1 }, 0.36);
  assert.ok(Math.abs(parseFloat(plain.root.style.left) - x - 36) < 1e-6);
  assert.ok(Math.abs(parseFloat(plain.root.style.top) - y - 72) < 1e-6);
});

test('exports include only the selected opening artwork and omit it when the opening is disabled', () => {
  assert.deepEqual(getStaminaAssetPaths({ enabled: 0 }), []);
  for (let lives = 1; lives <= 10; lives++) {
    assert.deepEqual(getStaminaAssetPaths({ enabled: 1, lives }), [...Object.values(STAMINA_ASSETS), STAMINA_INTRO_ASSETS[lives]]);
    assert.deepEqual(getStaminaAssetPaths({ enabled: 1, lives, introEnabled: 0 }), Object.values(STAMINA_ASSETS));
    for (const asset of getStaminaAssetPaths({ enabled: 1, lives })) {
      assert.ok(statSync(new URL(`../public${asset}`, import.meta.url)).size > 0, `export resource exists: ${asset}`);
    }
  }
});

test('odd second rows center with matching gaps and depletion never repositions any heart', () => {
  const f = fixture();
  for (let lives = 1; lives <= 10; lives++) {
    const config = { enabled: 1, lives };
    f.view.render({ remaining: lives }, { config });
    const before = f.hearts.children.map(image => ({ ...image.style }));
    const rows = new Map();
    for (const image of f.hearts.children) {
      const y = image.style.top;
      if (!rows.has(y)) rows.set(y, []);
      rows.get(y).push(image);
    }
    assert.deepEqual([...rows.values()].map(row => row.length), lives <= 5 ? [lives] : [Math.ceil(lives / 2), Math.floor(lives / 2)]);
    let expectedGap;
    for (const row of rows.values()) {
      const left = parseFloat(row[0].style.left);
      const right = parseFloat(row.at(-1).style.left) + parseFloat(row.at(-1).style.width);
      assert.ok(Math.abs(left + right - 100) < 1e-6);
      for (let i = 1; i < row.length; i++) {
        const gap = parseFloat(row[i].style.left) - parseFloat(row[i - 1].style.left) - parseFloat(row[i - 1].style.width);
        expectedGap ??= gap;
        assert.ok(Math.abs(gap - expectedGap) < 1e-6);
      }
    }
    for (const remaining of [lives - 1, 0, lives]) {
      f.view.render({ remaining }, { config });
      assert.deepEqual(f.hearts.children.map(image => ({ ...image.style })), before);
      assert.equal(f.hearts.children.filter(image => image.getAttribute('src') === STAMINA_ASSETS.heart).length, remaining);
    }
  }
});
