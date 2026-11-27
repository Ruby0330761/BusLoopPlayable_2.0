import assert from 'node:assert/strict';
import test from 'node:test';
import { createPlayableExportQueue } from '../scripts/playable-export-queue.mjs';

test('single and all-channel submissions share one FIFO worker and private claim tickets', () => {
  const queue = createPlayableExportQueue();
  const first = queue.reserve({ owner: 'A', platform: 'all' });
  const second = queue.reserve({ owner: 'B', platform: 'applovin' });
  const publicView = queue.view();
  assert.equal(publicView.mine, null);
  assert.deepEqual(publicView.jobs.map(job => job.state), ['ready', 'waiting']);
  assert.ok(!JSON.stringify(publicView).includes(first));
  assert.equal(queue.view(second).mine, publicView.jobs[1].number);
  assert.throws(() => queue.start(second), { statusCode: 409 });
  const finish = queue.start(first);
  assert.throws(() => queue.start(first), { statusCode: 409 });
  assert.throws(() => queue.start(null, {}), { statusCode: 409 });
  queue.cancel(first);
  assert.equal(queue.view().jobs[0].state, 'running');
  finish();
  const finishSecond = queue.start(second);
  finish();
  assert.equal(queue.view().jobs[0].owner, 'B');
  finishSecond();
  assert.deepEqual(queue.view().jobs, []);
});

test('an expired head or a cancelled waiter cannot block the next export', () => {
  let time = 0;
  const queue = createPlayableExportQueue({ now: () => time, leaseMs: 100, capacity: 3 });
  const expired = queue.reserve({});
  const cancelled = queue.reserve({});
  const live = queue.reserve({});
  assert.throws(() => queue.reserve({}), { statusCode: 429 });
  queue.cancel(cancelled);
  time = 75;
  queue.view(live);
  time = 120;
  assert.equal(queue.view(expired).mine, null);
  assert.throws(() => queue.start(expired), { statusCode: 409 });
  assert.deepEqual(queue.view(live).jobs.map(job => job.state), ['ready']);
  const done = queue.start(live);
  time += 500;
  assert.equal(queue.view().jobs[0].state, 'running');
  done();
  const finishLegacy = queue.start(null, { platform: 'all' });
  assert.equal(queue.view().jobs[0].platform, 'all');
  finishLegacy();
});
