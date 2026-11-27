import test from 'node:test';
import assert from 'node:assert/strict';
import { migrateSmokeTrailCaches, pruneUnknownTuning } from '../src/tuning-migrations.js';
import { matchesSmokeMigration, migrateAllLevelsSmoke } from '../scripts/migrate-all-levels-smoke.mjs';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { SCENE_TUNING } from '../src/scene-tuning.js';
import { validateTuning } from '../scripts/export-playable-package.mjs';

test('all cached levels and the preview draft reset smoke once, preserving later user edits', () => {
  const old = { effects: { smokeTrail: { rateOverTime: 12 }, departureStars: { enabled: 1 } } };
  const keys = { current: 'active', profiles: 'levels', legacy: 'old', preview: 'draft' };
  const data = new Map(Object.entries({
    active: old, old, levels: { profiles: { level2: { tuning: old }, level3: { tuning: old } } },
    draft: { document: { tuning: old } }
  }).map(([k, v]) => [k, JSON.stringify(v)]));
  const storage = { getItem: k => data.get(k), setItem: (k, v) => data.set(k, v) };
  migrateSmokeTrailCaches(storage, keys);
  const read = key => JSON.parse(data.get(key));
  for (const tuning of [read('active'), read('old'), read('draft').document.tuning,
    ...Object.values(read('levels').profiles).map(entry => entry.tuning)]) {
    assert.deepEqual(tuning.effects.smokeTrail, SCENE_TUNING.effects.smokeTrail);
    assert.equal(tuning.effects.departureStars.enabled, 1);
  }
  data.set('active', JSON.stringify(old));
  migrateSmokeTrailCaches(storage, keys);
  assert.deepEqual(read('active'), old);
});

test('server reset backs up only overwritten levels and keeps later edits on restart', async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'busloop-smoke-migration-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const levels = path.join(root, 'web-levels');
  await mkdir(levels);
  const level = path.join(levels, 'level2.json');
  const source = JSON.stringify({ key: 'level2', tuning: { effects: { smokeTrail: { rateOverTime: 0 } } } });
  await writeFile(level, source);
  await writeFile(path.join(levels, 'level3.json'), '{"key":"level3"}');
  await migrateAllLevelsSmoke(root);
  const migrated = JSON.parse(await readFile(level, 'utf8'));
  assert.deepEqual(migrated.tuning.effects.smokeTrail, SCENE_TUNING.effects.smokeTrail);
  const hash = bytes => createHash('sha256').update(bytes).digest('hex');
  const previous = hash(source);
  const current = hash(await readFile(level));
  assert.equal(await matchesSmokeMigration(root, 'level2', previous, current), true);
  assert.equal(await matchesSmokeMigration(root, 'level2', previous, hash('another edit')), false);
  assert.equal(await readFile(path.join(root, 'web-level-backups/all-levels-smoke-20261123/level2.json'), 'utf8'), source);
  assert.equal(await readFile(path.join(levels, 'level3.json'), 'utf8'), '{"key":"level3"}');
  await writeFile(level, source);
  await migrateAllLevelsSmoke(root);
  assert.equal(await readFile(level, 'utf8'), source);
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

test('a measured background horizon survives pruning and export validation', () => {
  // The editor writes background.horizon whenever the artwork changes (picker
  // switch, custom upload, or the startup auto-measure). When that key was
  // absent from the defaults, the exporter rejected the whole package with
  // "tuning.background.horizon is not supported" and no platform could be
  // built from an editor that had touched the background.
  const template = structuredClone(SCENE_TUNING);
  const cached = structuredClone(SCENE_TUNING);
  cached.background.horizon = 0.5744;

  pruneUnknownTuning(cached, template);
  assert.equal(cached.background.horizon, 0.5744, 'a measured horizon must not be pruned');
  assert.doesNotThrow(() => validateTuning(cached, template));
});

test('an unmeasured background horizon stays valid at the 0 sentinel', () => {
  // 0 means "not measured yet": resolveBackgroundHorizon only accepts 0 < h < 1,
  // so the exported plane falls back to the built-in table instead of shifting
  // by a horizon of zero.
  const template = structuredClone(SCENE_TUNING);
  const cached = structuredClone(SCENE_TUNING);
  cached.background.horizon = 0;

  assert.doesNotThrow(() => validateTuning(cached, template));
});
