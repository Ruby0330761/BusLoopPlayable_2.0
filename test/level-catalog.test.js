import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { LEVEL_CATALOG, LEVEL_OPTIONS } from '../src/level-catalog.js';
import { ACTIVE_LEVEL } from '../src/generated-active-level.js';
import { SCENE_TUNING } from '../src/scene-tuning.js';
import { BusLoopGame } from '../src/game-model.js';
import { boxesOverlap, getVehicleCollisionSize } from '../src/vehicle-collision.js';

const IMPORTED_EXPECTATIONS = {
  level5: { vehicles: 61, queues: [202, 202] },
  level8: { vehicles: 38, queues: [140, 140] },
  level9: { vehicles: 37, queues: [131, 131] },
  level10: { vehicles: 64, queues: [218, 218] },
  level13: { vehicles: 75, queues: [202, 202] }
};

function collisionBox(level, vehicle) {
  const yaw = vehicle.yaw * Math.PI / 180;
  const forward = { x: Math.sin(yaw), z: Math.cos(yaw) };
  return {
    position: { x: vehicle.x, z: vehicle.z },
    yaw: vehicle.yaw,
    size: getVehicleCollisionSize(level, vehicle),
    forward,
    right: { x: forward.z, z: -forward.x }
  };
}

test('Unity level catalog imports each supplied layout and its paired queues', () => {
  assert.deepEqual(LEVEL_OPTIONS.map(([key]) => key), Object.keys(IMPORTED_EXPECTATIONS));
  for (const [key, expected] of Object.entries(IMPORTED_EXPECTATIONS)) {
    const level = LEVEL_CATALOG[key];
    assert.equal(level.vehicles.length, expected.vehicles, key);
    assert.deepEqual(level.passengerQueues.map((queue) => queue.length), expected.queues, key);
    assert.equal(
      level.vehicles.reduce((sum, vehicle) => sum + vehicle.seats, 0),
      level.passengerQueues.flat().length,
      `${key} seat/passenger total`
    );
    assert.ok(level.vehicles.every((vehicle) => Number.isFinite(vehicle.yaw)), `${key} yaw`);
  }
});

test('production active module contains the editor-selected level only', () => {
  const selectedLevel = readFileSync('artifacts/selected-level.txt', 'utf8').trim()
    || SCENE_TUNING.level.selected;
  assert.equal(ACTIVE_LEVEL.key, selectedLevel);
  const source = readFileSync('src/generated-active-level.js', 'utf8');
  assert.match(source, new RegExp(`"sourceFile": "${ACTIVE_LEVEL.sourceFile}"`));
  for (const key of Object.keys(IMPORTED_EXPECTATIONS)) {
    if (key === ACTIVE_LEVEL.key) continue;
    assert.doesNotMatch(source, new RegExp(`"key": "${key}"`));
  }
});

test('level13 vehicle 130 is nudged clear of vehicle 135 collision body', () => {
  const level = LEVEL_CATALOG.level13;
  const vehicle130 = level.vehicles.find((vehicle) => vehicle.id === 130);
  const vehicle135 = level.vehicles.find((vehicle) => vehicle.id === 135);
  assert.equal(vehicle130.z, 1.3369986);
  assert.equal(boxesOverlap(collisionBox(level, vehicle130), collisionBox(level, vehicle135)), false);
  assert.deepEqual(new BusLoopGame(structuredClone(level)).getBlockers(130), []);
});

test('editor level selection reloads the runtime and production build regenerates active data', () => {
  const editorSource = readFileSync('src/scene-editor.js', 'utf8');
  const mainSource = readFileSync('src/main.js', 'utf8');
  const packageJson = JSON.parse(readFileSync('package.json', 'utf8'));
  assert.match(editorSource, /'level\.selected'/);
  assert.match(editorSource, /LEVEL_OPTIONS/);
  assert.match(mainSource, /setActiveLevel\(getLevelDefinition\(SCENE_TUNING\.level\?\.selected\)\)/);
  assert.match(mainSource, /path === 'level\.selected'/);
  assert.match(mainSource, /fetch\('\/__playable-level'/);
  assert.match(mainSource, /window\.location\.reload\(\)/);
  assert.equal(packageJson.scripts.prebuild, 'node scripts/generate-active-level.mjs');
  const generatorSource = readFileSync('scripts/generate-active-level.mjs', 'utf8');
  assert.match(generatorSource, /selected-level\.txt/);
});

