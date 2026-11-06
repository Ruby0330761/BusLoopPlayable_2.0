import test from 'node:test';
import assert from 'node:assert/strict';
import { pruneUnknownTuning, migrateFootage8PresentationTuning } from '../src/tuning-migrations.js';
import { SCENE_TUNING } from '../src/scene-tuning.js';
import { validateTuning } from '../scripts/export-playable-package.mjs';

test('Footage8 density migration updates old defaults once and preserves custom spacing and speed', () => {
  for (const spacing of [0.2, 0.26, 0.32, 0.5]) {
    const source = { footage8Conveyor: { rowSpacing: spacing, speed: 1.05, initialFillSpeedMultiplier: 5 } };
    assert.equal(migrateFootage8PresentationTuning(source), true);
    assert.equal(source.footage8Conveyor.rowSpacing, [.26,.32].includes(spacing) ? .2 : spacing);
    assert.equal(source.footage8Conveyor.speed, 1.05);
    assert.equal(source.footage8Conveyor.initialFillSpeedMultiplier, 5);
    source.footage8Conveyor.rowSpacing = .32;
    assert.equal(migrateFootage8PresentationTuning(source), false);
    assert.equal(source.footage8Conveyor.rowSpacing, .32);
  }
  assert.equal(migrateFootage8PresentationTuning({}), false);
});

test('Footage8 refinement revision two also fixes saved revision-one density and the long road default', () => {
  const source = { footage8Conveyor: { presentationRevision: 1, rowSpacing: .26, roadJoinExtension: .25, speed: .8 } };
  assert.equal(migrateFootage8PresentationTuning(source), true);
  assert.deepEqual(source.footage8Conveyor, { presentationRevision: 2, rowSpacing: .2, roadJoinExtension: -.18, speed: .8 });
  source.footage8Conveyor.rowSpacing = .26;
  assert.equal(migrateFootage8PresentationTuning(source), false);
  assert.equal(source.footage8Conveyor.rowSpacing, .26);
});

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
