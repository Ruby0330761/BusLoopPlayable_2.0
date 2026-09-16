import test from 'node:test';
import assert from 'node:assert/strict';
import { RandomPlayableAudioScheduler } from '../src/random-playable-audio.js';

function createScheduler(config = {}) {
  let now = 0;
  const plays = [];
  const scheduler = new RandomPlayableAudioScheduler({
    getConfig: () => config,
    now: () => now,
    play: (clip, volume) => plays.push({ clip: clip.key, volume, at: now })
  });
  return {
    scheduler,
    plays,
    setNow: (value) => { now = value; }
  };
}

test('random audio waits for the first cooldown and uses the configured volume product', () => {
  const { scheduler, plays, setNow } = createScheduler({
    enabled: 1,
    minIntervalSeconds: 5,
    maxIntervalSeconds: 5,
    masterVolume: 0.8,
    policeRingVolume: 0.5,
    moveVolume: 0.25,
    heyMoveItVolume: 1
  });
  assert.equal(scheduler.activate(0), true);
  scheduler.update(4999);
  assert.equal(plays.length, 0);
  setNow(5000);
  scheduler.update(5000);
  assert.equal(plays.length, 1);
  assert.ok(plays[0].volume >= 0 && plays[0].volume <= 0.8);
});

test('later successful clicks do not reset the initial cooldown', () => {
  const { scheduler, plays } = createScheduler({
    enabled: 1,
    minIntervalSeconds: 5,
    maxIntervalSeconds: 5
  });
  assert.equal(scheduler.activate(0), true);
  assert.equal(scheduler.activate(4000), false);
  scheduler.update(4999);
  assert.equal(plays.length, 0);
  scheduler.update(5000);
  assert.equal(plays.length, 1);
});

test('random audio never repeats the immediately previous clip and CTA stops future playback', () => {
  const { scheduler, plays } = createScheduler({
    enabled: 1,
    minIntervalSeconds: 5,
    maxIntervalSeconds: 5
  });
  scheduler.activate(0);
  for (const time of [5000, 10000, 15000, 20000]) scheduler.update(time);
  assert.equal(plays.length, 4);
  for (let index = 1; index < plays.length; index += 1) {
    assert.notEqual(plays[index].clip, plays[index - 1].clip);
  }
  scheduler.stop();
  scheduler.update(25000);
  assert.equal(plays.length, 4);
});

test('disabled random audio cannot activate', () => {
  const { scheduler, plays } = createScheduler({ enabled: 0 });
  assert.equal(scheduler.activate(0), false);
  scheduler.update(60000);
  assert.equal(plays.length, 0);
});
