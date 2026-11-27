import test from 'node:test';
import assert from 'node:assert/strict';
import { createCountdownView } from '../src/countdown-view.js';
import { COUNTDOWN_TIMER_ASSET, COUNTDOWN_ALARM_ASSET } from '../src/countdown.js';

const PLACEHOLDER_SRC = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';

function fixture(width, height, bounds, speedBounds = null, frame = {}) {
  const attrs = new Map();
  const properties = new Map();
  const root = { style: {}, dataset: {}, setAttribute: (key, value) => attrs.set(key, value) };
  // `index.html` ships a transparent 1x1 GIF as the placeholder src, so the
  // fixture starts from the same state the real page does.
  attrs.set('img:src', PLACEHOLDER_SRC);
  const image = { getAttribute: key => attrs.get(`img:${key}`), removeAttribute: key => attrs.delete(`img:${key}`),
    set src(value) { attrs.set('img:src', value); } };
  const value = { textContent: '' };
  const warning = {
    style: { setProperty: (name, value) => properties.set(name, value) },
    properties
  };
  const stage = { ...frame, getBoundingClientRect: () => ({ left: 0, top: 0, width, height }) };
  const speedButton = { hidden: !speedBounds, getBoundingClientRect: () => speedBounds };
  const view = createCountdownView({ root, image, value, warning, stage, speedButton });
  view.resize(bounds);
  return { view, root, value, warning, attrs };
}

test('alarm icon is opt-in, uses the supplied SVG and can return to the original frame', () => {
  const attrs = new Map();
  const icon = { style: {}, getAttribute: key => attrs.get(key), set src(value) { attrs.set('src', value); } };
  const image = { getAttribute: () => COUNTDOWN_TIMER_ASSET };
  const root = { dataset: {}, setAttribute() {} };
  const view = createCountdownView({ root, icon, image });
  view.render({ enabled: 0, remaining: 30 });
  assert.equal(attrs.size, 0);
  view.render({ enabled: 1, iconEnabled: 1, iconScale: 1.3, iconOffsetX: 5, iconOffsetY: -4, remaining: 30 });
  assert.equal(attrs.get('src'), COUNTDOWN_ALARM_ASSET);
  assert.equal(image.hidden, true);
  assert.equal(icon.hidden, false);
  assert.equal(icon.style.transform, 'translate(5%, -4%) scale(1.3)');
  view.render({ enabled: 1, iconEnabled: 0, remaining: 30 });
  assert.equal(icon.hidden, true);
  assert.equal(image.hidden, false);
});

test('timer stays within portrait, landscape and letterboxed content and clears the speed button', () => {
  for (const [width, height, bounds, button] of [
    [390, 844, { left: 0, top: 0, right: 390, bottom: 844 }, { left: 315, right: 380, top: 18, height: 44, width: 65 }],
    [844, 390, { left: 260, top: 0, right: 584, bottom: 390 }, { left: 520, right: 575, top: 12, height: 38, width: 55 }],
    [1920, 480, { left: 748, top: 0, right: 1172, bottom: 480 }, { left: 1095, right: 1160, top: 14, height: 44, width: 65 }],
    [2560, 360, { left: 1119, top: 0, right: 1441, bottom: 360 }, null]
  ]) {
    const f = fixture(width, height, bounds, button);
    const timerWidth = parseFloat(f.root.style.width);
    const center = parseFloat(f.root.style.left);
    const top = parseFloat(f.root.style.top);
    assert.ok(timerWidth > 100);
    assert.ok(center - timerWidth / 2 >= bounds.left);
    assert.ok(center + timerWidth / 2 <= bounds.right);
    assert.ok(top >= bounds.top && top + timerWidth * 392 / 1001 <= bounds.bottom);
    if (button) {
      assert.ok(center + timerWidth / 2 < button.left);
      const frameTop = top + timerWidth * 47 / 1001;
      const frameBottom = top + timerWidth * 354 / 1001;
      assert.ok(Math.abs(frameTop - (button.top + button.height * 17 / 340)) < 0.001);
      assert.ok(Math.abs(frameBottom - (button.top + button.height * 329 / 340)) < 0.001);
      assert.ok(timerWidth * 392 / 1001 > button.height, 'clock artwork extends beyond the aligned blue frame');
    }
  }
});

test('a phone preview border is excluded when clearing the speed button', () => {
  const button = { left: 128, right: 158, top: 18, width: 30, height: 20 };
  const f = fixture(177, 354, { left: 0, top: 0, right: 157, bottom: 334 }, button,
    { clientLeft: 10, clientTop: 10, clientWidth: 157, clientHeight: 334 });
  const actualRight = 10 + parseFloat(f.root.style.left) + parseFloat(f.root.style.width) / 2;
  assert.ok(actualRight <= button.left - 3, `timer right ${actualRight}, button left ${button.left}`);
});

test('display adjustments move and scale the whole HUD, keep its aspect ratio and stay inside content', () => {
  const bounds = { left: 0, top: 0, right: 390, bottom: 844 };
  const button = { left: 315, right: 380, top: 18, height: 44, width: 65 };
  const f = fixture(390, 844, bounds, button);
  const read = () => {
    const width = parseFloat(f.root.style.width);
    const height = width * 392 / 1001;
    return { width, height, x: parseFloat(f.root.style.left), y: parseFloat(f.root.style.top) + height / 2 };
  };
  const initial = read();
  f.view.resize(bounds, { offsetX: -100, offsetY: 200, scale: 1.4 }, 0.36);
  const adjusted = read();
  assert.ok(Math.abs(adjusted.width - initial.width * 1.4) < 0.001);
  assert.ok(Math.abs(adjusted.x - initial.x + 36) < 0.001);
  assert.ok(Math.abs(adjusted.y - initial.y - 72) < 0.001);
  assert.ok(Math.abs(parseFloat(f.root.style.fontSize) / adjusted.width - 0.171) < 0.001);
  for (const direction of [-1, 1]) {
    f.view.resize(bounds, { offsetX: direction * 1080, offsetY: direction * 2160, scale: 3 }, 0.36);
    const edge = read();
    assert.ok(edge.x - edge.width / 2 >= bounds.left && edge.x + edge.width / 2 <= bounds.right);
    assert.ok(edge.y - edge.height / 2 >= bounds.top && edge.y + edge.height / 2 <= bounds.bottom);
  }
});

test('disabled HUD never loads an image; enabled display formats time and pauses the warning', () => {
  const f = fixture(390, 844);
  f.view.render({ enabled: 0, remaining: 30, state: 'disabled', urgent: false });
  assert.equal(f.root.hidden, true);
  // A disabled countdown must not request the timer artwork at all.
  assert.equal(f.attrs.get('img:src'), PLACEHOLDER_SRC);
  f.view.render({ enabled: 1, remaining: 90, state: 'idle', urgent: false });
  assert.equal(f.attrs.get('img:src'), COUNTDOWN_TIMER_ASSET);
  assert.equal(f.value.textContent, '01:30');
  f.view.render({ enabled: 1, remaining: 7, state: 'paused', urgent: true, paused: true });
  assert.equal(f.warning.hidden, false);
  assert.equal(f.warning.properties.get('--countdown-warning-play'), 'paused');
  f.view.render({ enabled: 1, remaining: 6, state: 'running', urgent: true, paused: false });
  assert.equal(f.warning.properties.get('--countdown-warning-play'), 'running');
  f.view.render({ enabled: 1, remaining: 0, state: 'timeout', urgent: false });
  assert.equal(f.warning.hidden, true);
  assert.equal(f.value.textContent, '00:00');
});
