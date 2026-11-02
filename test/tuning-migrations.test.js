import test from 'node:test';
import assert from 'node:assert/strict';
import { pruneUnknownTuning } from '../src/tuning-migrations.js';
import { SCENE_TUNING } from '../src/scene-tuning.js';
import { validateTuning } from '../scripts/export-playable-package.mjs';

test('pruneUnknownTuning drops fields this build no longer defines', () => {
  const template = { parkingSpots: { count: 4, y: 0.035 }, camera: { fovDegrees: 2.2 } };
  const target = {
    parkingSpots: { count: 4, y: 0.035, hideOutlineWhenOccupied: 1 },
    camera: { fovDegrees: 2.2 },
    conveyorLayouts: { notARealLayout: { art: { x: 0 } } }
  };
  assert.equal(pruneUnknownTuning(target, template), true);
  assert.deepEqual(target, { parkingSpots: { count: 4, y: 0.035 }, camera: { fovDegrees: 2.2 } });
});

test('pruneUnknownTuning reports no change when the payload matches the template', () => {
  const template = { a: { b: 1 }, list: [{ c: 2 }] };
  const target = { a: { b: 1 }, list: [{ c: 2 }] };
  assert.equal(pruneUnknownTuning(target, template), false);
  assert.deepEqual(target, { a: { b: 1 }, list: [{ c: 2 }] });
});

test('pruneUnknownTuning keeps known array entries and cleans each one', () => {
  const template = { points: [{ x: 0, z: 0 }] };
  const target = { points: [{ x: 1, z: 2, stale: 9 }, { x: 3, z: 4 }] };
  assert.equal(pruneUnknownTuning(target, template), true);
  assert.deepEqual(target, { points: [{ x: 1, z: 2 }, { x: 3, z: 4 }] });
});

test('pruning stale cached fields makes an otherwise-rejected payload exportable', () => {
  // This is the exact production failure: an editor whose localStorage still
  // held removed keys could not export at all.
  const template = structuredClone(SCENE_TUNING);
  const cached = structuredClone(SCENE_TUNING);
  cached.parkingSpots.hideOutlineWhenOccupied = 1;
  cached.conveyorLayouts.notARealLayout = { art: { x: 0 } };

  assert.throws(() => validateTuning(cached, template), /is not supported/);
  pruneUnknownTuning(cached, template);
  assert.doesNotThrow(() => validateTuning(cached, template));
});

test('pruning preserves optional conveyor layouts such as dualQueueShape', () => {
  const template = structuredClone(SCENE_TUNING);
  assert.ok(template.conveyorLayouts?.dualQueueShape, 'dualQueueShape is a real layout in this build');
  const cached = structuredClone(SCENE_TUNING);
  cached.parkingSpots.hideOutlineWhenOccupied = 1;

  pruneUnknownTuning(cached, template);
  assert.ok(cached.conveyorLayouts.dualQueueShape, 'a real layout must not be pruned');
  assert.equal(cached.parkingSpots.hideOutlineWhenOccupied, undefined);
});
