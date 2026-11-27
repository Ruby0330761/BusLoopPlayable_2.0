import assert from 'node:assert/strict';
import test from 'node:test';
import { IqScore, IQ_BADGE, normalizeIq } from '../src/iq-hud.js';
import { BusLoopGame } from '../src/game-model.js';
import { SCENE_TUNING } from '../src/scene-tuning.js';
import { collectPlayableInlineAssetUrls } from '../src/playable-inline-assets.js';

test('old profiles leave IQ disabled and only enabled exports include its badge', () => {
  assert.deepEqual(normalizeIq(), SCENE_TUNING.iq);
  for (const enabled of [undefined, 0, 1]) {
    const urls = collectPlayableInlineAssetUrls({ tuning: { iq: { enabled } }, extraUrls: [IQ_BADGE] });
    assert.equal(urls.has(IQ_BADGE), enabled === 1);
  }
});

test('a new tween interrupts at the displayed value but scores from the last committed integer', () => {
  const score = new IqScore(110);
  score.change(10, 0);
  assert.equal(score.valueAt(0.25), 115);
  score.change(10, 0.25);
  assert.equal(score.valueAt(0.25), 115);
  assert.equal(score.valueAt(0.75), 120);
  score.change(-5, 0.75);
  assert.equal(score.valueAt(1.25), 115);
  const low = new IqScore(3);
  low.change(-5, 0);
  assert.equal(low.valueAt(0.5), 0);
});

test('the model awards arrival and penalizes contact once, independently of clicks and boarding', () => {
  const game = new BusLoopGame();
  assert.equal(game.iq, null);
  game.configureIq({ enabled: 1 });
  const blocked = game.vehicles.find(v => game.canMoveToStation(v) && game.getBlockers(v.id).length);
  assert.equal(game.clickVehicle(blocked.id).reason, 'blocked');
  assert.equal(game.iq.target, 110);
  const step = () => game.update(0.05);
  for (let i = 0; i < 60; i++) step();
  assert.equal(game.iq.valueAt(game.time), 105);
  const clear = game.vehicles.find(v => game.canMoveToStation(v) && !game.getBlockers(v.id).length);
  assert.equal(game.clickVehicle(clear.id).spotIndex, 0);
  assert.equal(game.iq.target, 105);
  for (let i = 0; i < 200; i++) step();
  assert.equal(game.iq.valueAt(game.time), 115);
  game.configureIq({ enabled: 1, scale: 2 });
  assert.equal(game.iq.target, 115);
  game.configureIq({ enabled: 0 });
  assert.equal(game.iq, null);
});
