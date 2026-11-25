import assert from 'node:assert/strict';
import test from 'node:test';
import { COMBO_COIN, createComboHud, getComboAssets, normalizeCombo } from '../src/combo-hud.js';
import { collectPlayableInlineAssetUrls } from '../src/playable-inline-assets.js';

function setup() {
  const label = {};
  const fill = { style: {} };
  const root = {
    hidden: true, dataset: {}, parentElement: { clientWidth: 320, clientHeight: 640 },
    offsetWidth: 86, offsetHeight: 32, style: { setProperty() {} }, classList: { add() {}, remove() {} },
    querySelector: selector => selector === '.combo-label' ? label : fill,
    querySelectorAll: () => []
  };
  let coins = 0;
  const combo = createComboHud(root, {
    getView: () => ({ spotRoots: [] }), getGame: () => ({ vehicles: [] }), playCoin: () => { coins++; }
  });
  const dispatch = () => combo.dispatch({ ok: true, spotIndex: 0 }, 7);
  return { combo, label, fill, root, dispatch, coins: () => coins };
}

test('only the selected COMBO art and sound enter the export', () => {
  assert.deepEqual(normalizeCombo(), { mode: 'off', goldSeconds: 0, timedSeconds: 6 });
  assert.equal(normalizeCombo({ timedSeconds: -3 }).timedSeconds, 0.1);
  const all = getComboAssets({ mode: 'timed' });
  assert.equal(all.length, 4);
  for (const [mode, expected] of [['off', []], ['gold', [COMBO_COIN]], ['timed', all]]) {
    const urls = collectPlayableInlineAssetUrls({ tuning: { combo: { mode } } });
    assert.deepEqual(all.filter(url => urls.has(url)), expected);
  }
});

test('gold starts on the second dispatch, survives the popup, and resets on each distinct contact', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { combo, label, root, dispatch, coins } = setup();
  dispatch();
  dispatch();
  assert.equal(coins(), 0);
  combo.configure({ mode: 'gold' });
  combo.dispatch({ ok: true }, 2);
  combo.dispatch({ ok: false, spotIndex: 1 }, 2);
  dispatch();
  assert.equal(root.hidden, true);
  dispatch();
  assert.equal(label.textContent, 'COMBO ×1');
  t.mock.timers.tick(9000);
  assert.equal(root.hidden, true);
  dispatch();
  assert.equal(label.textContent, 'COMBO ×2');
  const contact = { type: 'vehicle-collision-contact', collisionEventId: 3 };
  combo.contact(contact);
  dispatch();
  assert.equal(root.hidden, true);
  combo.contact(contact);
  dispatch();
  assert.equal(label.textContent, 'COMBO ×1');
  combo.reset();
  assert.equal(root.hidden, true);
});

test('both styles honor their own interval, restart it on dispatch and drop the streak on mode change', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  for (const mode of ['gold', 'timed']) {
    const { combo, label, fill, root, dispatch, coins } = setup();
    combo.configure({ mode, timedSeconds: 2.5, goldSeconds: 1.5 });
    const ms = mode === 'timed' ? 2500 : 1500;
    dispatch();
    t.mock.timers.tick(ms - 1);
    dispatch();
    assert.equal(label.textContent, 'COMBO ×1');
    if (mode === 'timed') assert.equal(fill.style.transition, 'width 2500ms linear');
    t.mock.timers.tick(ms - 1);
    dispatch();
    assert.equal(label.textContent, 'COMBO ×2');
    t.mock.timers.tick(ms);
    dispatch();
    assert.equal(root.hidden, true);
    assert.equal(coins(), 2);
    combo.configure({ mode: 'off' });
    dispatch();
    assert.equal(coins(), 2);
  }
});
