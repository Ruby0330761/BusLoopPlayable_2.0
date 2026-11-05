import test from 'node:test';
import assert from 'node:assert/strict';
import { createCountdown, formatCountdownTime, normalizeCountdownConfig, validateCountdownConfig } from '../src/countdown.js';
import { BusLoopGame } from '../src/game-model.js';
import { LEVEL_1 } from '../src/level-data.js';
import { SCENE_TUNING } from '../src/scene-tuning.js';
import { validateTuning } from '../scripts/export-playable-package.mjs';

function fixture(config = {}) {
  let time = 0;
  let timeouts = 0;
  const countdown = createCountdown({ enabled: 1, durationSeconds: 30, ...config }, {
    now: () => time,
    onTimeout: () => { timeouts += 1; }
  });
  return { countdown, timeouts: () => timeouts,
    advance(ms, options) { time += ms; return countdown.tick(options); },
    move(ms) { time += ms; } };
}

test('legacy and disabled countdowns remain inert; minutes use ceil without negative time', () => {
  const clock = createCountdown();
  clock.start();
  assert.equal(clock.tick({ time: 100000 }).state, 'disabled');
  assert.equal(clock.snapshot().started, false);
  assert.equal(formatCountdownTime(90), '01:30');
  assert.equal(formatCountdownTime(0.001), '00:01');
  assert.equal(formatCountdownTime(-1), '00:00');
  assert.equal(formatCountdownTime(5999), '99:59');
});

test('idle does not consume time and first start is idempotent', () => {
  const f = fixture();
  assert.equal(f.advance(60000).remaining, 30);
  f.countdown.start();
  assert.equal(f.advance(5000).remaining, 25);
  f.countdown.start();
  assert.equal(f.advance(2000).remaining, 23);
});

test('real elapsed time is not truncated by a long frame and expires exactly once', () => {
  const f = fixture();
  f.countdown.start();
  assert.equal(f.advance(21000).remaining, 9);
  assert.equal(f.countdown.snapshot().urgent, true);
  assert.equal(f.advance(10000).remaining, 0);
  assert.equal(f.countdown.snapshot().urgent, false);
  f.advance(30000);
  assert.equal(f.timeouts(), 1);
});

test('pause boundaries preserve elapsed time and do not charge hidden intervals', () => {
  const f = fixture();
  f.countdown.start();
  f.move(2500);
  f.countdown.setPaused(true);
  assert.equal(f.advance(60000, { paused: true }).remaining, 27.5);
  f.countdown.setPaused(false);
  assert.equal(f.advance(1000).remaining, 26.5);
  assert.equal(f.countdown.snapshot().state, 'running');
});

test('starting while paused waits for a playable interval', () => {
  const f = fixture();
  f.countdown.start({ paused: true });
  assert.equal(f.advance(5000, { paused: true }).remaining, 30);
  f.countdown.setPaused(false);
  assert.equal(f.advance(1000).remaining, 29);
});

test('original win, loss and CTA endings win over a simultaneous deadline', () => {
  for (const options of [{ status: 'won' }, { status: 'lost' }, { ended: true }]) {
    const f = fixture();
    f.countdown.start();
    f.advance(40000, options);
    assert.equal(f.timeouts(), 0);
    assert.equal(f.countdown.snapshot().urgent, false);
    f.advance(10000);
    assert.equal(f.timeouts(), 0);
  }
});

test('retry or next stage gets a fresh idle clock without a stale timeout', () => {
  const f = fixture();
  f.countdown.start();
  f.advance(30000);
  assert.equal(f.timeouts(), 1);
  assert.equal(f.countdown.reset().remaining, 30);
  assert.equal(f.countdown.snapshot().started, false);
  assert.equal(f.advance(90000).remaining, 30);
  f.countdown.start();
  f.advance(30000);
  assert.equal(f.timeouts(), 2);
});

test('warning edits apply live; duration or enabled edits reset the round clock', () => {
  const f = fixture();
  f.countdown.start();
  f.advance(23000);
  assert.equal(f.countdown.snapshot().urgent, true);
  f.countdown.configure({ enabled: 1, durationSeconds: 30, warningEnabled: 0 });
  assert.equal(f.countdown.snapshot().remaining, 7);
  assert.equal(f.countdown.snapshot().urgent, false);
  assert.equal(f.countdown.configure({ enabled: 1, durationSeconds: 90 }).remaining, 90);
  assert.equal(f.countdown.snapshot().started, false);
  assert.equal(f.countdown.configure({ enabled: 0 }).state, 'disabled');
});

test('configuration validates active ranges and normalizes inactive or old profiles', () => {
  assert.equal(normalizeCountdownConfig().enabled, 0);
  assert.equal(normalizeCountdownConfig({ durationSeconds: 5 }).warningSeconds, 5);
  for (const durationSeconds of [0, 6000, 2.5, NaN, '30']) {
    assert.throws(() => validateCountdownConfig({ enabled: 1, durationSeconds }));
  }
  assert.throws(() => validateCountdownConfig({ enabled: 1, durationSeconds: 5, warningSeconds: 10 }));
  assert.doesNotThrow(() => validateCountdownConfig({ enabled: 0, durationSeconds: 0 }));
  assert.doesNotThrow(() => validateCountdownConfig({ enabled: 1, warningEnabled: 0, warningSeconds: 0 }));
});

test('timeout uses a single model loss event, freezes input and resets with the game', () => {
  const game = new BusLoopGame(LEVEL_1);
  const events = [];
  game.subscribe(state => events.push(state.lastEvent));
  const clock = createCountdown({ enabled: 1, durationSeconds: 1 }, {
    now: () => 0, onTimeout: () => game.failCountdown()
  });
  clock.start();
  clock.tick({ time: 1000, status: game.status });
  assert.equal(game.status, 'lost');
  assert.equal(game.lastEvent.reason, 'challenge-timeout');
  assert.equal(game.clickVehicle(game.vehicles[0].id).reason, 'finished');
  const frozenTime = game.time;
  game.update(0.1);
  assert.equal(game.time, frozenTime);
  assert.equal(game.failCountdown(), false);
  assert.equal(events.filter(event => event.reason === 'challenge-timeout').length, 1);
  game.reset();
  assert.equal(game.status, 'playing');
});

test('timeout cannot overwrite an existing game result and export rejects invalid active settings', () => {
  const game = new BusLoopGame(LEVEL_1);
  game.status = 'won';
  assert.equal(game.failCountdown(), false);
  assert.equal(game.status, 'won');
  assert.throws(() => validateTuning({ countdown: {
    enabled: 1, durationSeconds: 0, warningEnabled: 1, warningSeconds: 1
  } }, SCENE_TUNING), /倒计时时长/);
  const output = validateTuning({ countdown: {
    enabled: 1, durationSeconds: 90, warningEnabled: 1, warningSeconds: 10
  } }, SCENE_TUNING);
  assert.equal(output.countdown.durationSeconds, 90);
  assert.equal(validateTuning({}, SCENE_TUNING).countdown, undefined);
});
