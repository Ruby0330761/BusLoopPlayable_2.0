import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { LEVEL_CATALOG, LEVEL_OPTIONS } from '../src/level-catalog.js';
import { ACTIVE_LEVEL, PLAYABLE_LEVEL_SEQUENCE } from '../src/generated-active-level.js';
import { SCENE_TUNING } from '../src/scene-tuning.js';
import { BusLoopGame } from '../src/game-model.js';
import { boxesOverlap, getVehicleCollisionSize } from '../src/vehicle-collision.js';

const IMPORTED_EXPECTATIONS = {
  level5: { vehicles: 61, queues: [202, 202] },
  level7: { vehicles: 83, queues: [368, 278] },
  level8: { vehicles: 38, queues: [140, 140] },
  level9: { vehicles: 37, queues: [131, 131] },
  level10: { vehicles: 64, queues: [218, 218] },
  level12: { vehicles: 94, queues: [219, 219] },
  level13: { vehicles: 75, queues: [202, 202] },
  level15: { vehicles: 81, queues: [296, 214] },
  level16: { vehicles: 37, queues: [139, 79] },
  level17: { vehicles: 107, queues: [300, 258] },
  level18: { vehicles: 68, queues: [200, 228] }
};

const LEVEL7_QUEUE_RUNS = [
  [
    [4, 10], [6, 10], [1, 10], [7, 10], [0, 6], [3, 10], [4, 10], [6, 10],
    [1, 4], [7, 10], [0, 10], [3, 4], [6, 10], [1, 4], [7, 10], [0, 4],
    [3, 10], [5, 10], [1, 10], [7, 4], [3, 10], [4, 10], [6, 10], [1, 10],
    [7, 6], [0, 4], [3, 10], [4, 4], [6, 6], [1, 10], [7, 4], [0, 10],
    [4, 10], [1, 10], [7, 6], [0, 10], [4, 6], [5, 10], [1, 4], [7, 10],
    [5, 10], [1, 10], [6, 6], [5, 6], [1, 10]
  ],
  [
    [2, 10], [7, 10], [0, 10], [6, 6], [5, 6], [1, 4], [7, 4], [1, 10],
    [7, 4], [6, 10], [5, 10], [6, 6], [5, 10], [1, 10], [5, 4], [7, 10],
    [0, 6], [5, 10], [1, 10], [5, 10], [1, 4], [5, 10], [1, 6], [7, 6],
    [5, 6], [7, 12], [0, 6], [7, 6], [0, 6], [7, 4], [0, 10], [7, 10],
    [0, 10], [7, 4], [0, 18]
  ]
];

const LEVEL15_QUEUE_RUNS = [
  [
    [1, 6], [4, 4], [7, 6], [0, 6], [4, 10], [3, 6], [5, 6], [6, 6],
    [1, 6], [7, 10], [4, 6], [0, 4], [6, 10], [5, 6], [2, 6], [7, 6],
    [1, 4], [2, 4], [0, 6], [4, 6], [3, 6], [5, 6], [0, 10], [4, 6],
    [6, 6], [0, 6], [4, 6], [5, 10], [4, 10], [0, 6], [1, 6], [2, 10],
    [7, 10], [5, 4], [3, 6], [6, 4], [4, 6], [0, 10], [7, 4], [3, 4],
    [2, 4], [1, 4], [6, 6], [3, 6], [5, 6], [6, 4], [7, 6]
  ],
  [
    [7, 4], [6, 10], [3, 4], [6, 6], [2, 6], [0, 10], [6, 10], [1, 4],
    [5, 10], [3, 4], [0, 6], [1, 6], [2, 10], [4, 6], [2, 6], [0, 6],
    [1, 4], [3, 6], [4, 6], [2, 6], [3, 6], [1, 6], [3, 6], [0, 6],
    [4, 6], [7, 6], [0, 4], [2, 6], [7, 4], [1, 6], [0, 6], [2, 6],
    [1, 6], [2, 6], [4, 4]
  ]
];

const LEVEL16_QUEUE_RUNS = [
  [
    [6, 5], [0, 5], [7, 9], [2, 1], [3, 3], [1, 1], [8, 4], [3, 4],
    [0, 24], [8, 4], [5, 12], [8, 4], [7, 2], [5, 6], [1, 10], [5, 2],
    [7, 6], [5, 4], [2, 6], [0, 1], [1, 19], [2, 5], [3, 1], [2, 1]
  ],
  [
    [2, 9], [3, 6], [2, 11], [1, 6], [7, 12], [2, 7], [7, 1], [3, 4],
    [6, 5], [2, 3], [7, 4], [6, 10], [2, 1]
  ]
];

const LEVEL12_QUEUE_RUNS = [
  [
    [5, 2], [3, 2], [0, 3], [5, 2], [1, 9], [8, 6], [7, 6], [4, 4],
    [2, 4], [5, 6], [1, 6], [7, 8], [6, 10], [0, 4], [5, 4], [6, 6],
    [0, 10], [5, 10], [3, 10], [6, 4], [0, 6], [5, 8], [2, 10], [1, 10],
    [8, 4], [3, 4], [5, 4], [1, 4], [8, 4], [5, 4], [7, 10], [0, 4],
    [2, 4], [5, 4], [4, 4], [5, 4], [1, 4], [4, 4], [5, 7]
  ],
  [
    [5, 2], [3, 2], [0, 3], [5, 2], [1, 1], [5, 9], [3, 4], [7, 8],
    [5, 8], [7, 4], [5, 14], [7, 8], [5, 16], [7, 4], [5, 4], [7, 4],
    [5, 12], [0, 4], [5, 24], [0, 6], [5, 4], [0, 8], [5, 12], [0, 20],
    [5, 36]
  ]
];

function queueRuns(values) {
  return values.reduce((runs, value) => {
    const last = runs.at(-1);
    if (last?.[0] === value) last[1] += 1;
    else runs.push([value, 1]);
    return runs;
  }, []);
}

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

test('production active module contains only the selected playable session levels', () => {
  const selectedLevel = readFileSync('artifacts/selected-level.txt', 'utf8').trim()
    || SCENE_TUNING.level.selected;
  assert.equal(ACTIVE_LEVEL.key, selectedLevel);
  const sessionKeys = new Set(PLAYABLE_LEVEL_SEQUENCE.map((level) => level.key));
  assert.deepEqual([...sessionKeys], selectedLevel === 'level9' ? ['level9', 'level7'] : [selectedLevel]);
  const source = readFileSync('src/generated-active-level.js', 'utf8');
  for (const level of PLAYABLE_LEVEL_SEQUENCE) {
    assert.match(source, new RegExp(`"sourceFile": "${level.sourceFile}"`));
  }
  for (const key of Object.keys(IMPORTED_EXPECTATIONS)) {
    if (sessionKeys.has(key)) continue;
    assert.doesNotMatch(source, new RegExp(`"key": "${key}"`));
  }
});

test('level7 uses the tuned vehicle data and supplied passenger queue order', () => {
  const level = LEVEL_CATALOG.level7;
  assert.deepEqual(
    [66, 82].map((id) => {
      const vehicle = level.vehicles.find((entry) => entry.id === id);
      return [id, vehicle?.x, vehicle?.z];
    }),
    [
      [66, -0.15425447, 0.95464253],
      [82, 0.77715284, 0.57091796]
    ]
  );
  for (const id of [66, 82]) {
    const movedVehicle = level.vehicles.find((vehicle) => vehicle.id === id);
    for (const otherVehicle of level.vehicles) {
      if (otherVehicle.id === id) continue;
      assert.equal(
        boxesOverlap(collisionBox(level, movedVehicle), collisionBox(level, otherVehicle)),
        false,
        `level7 vehicles ${id} and ${otherVehicle.id}`
      );
    }
  }
  assert.equal(level.vehicles.find((vehicle) => vehicle.id === 89)?.colorIndex, 2);
  assert.deepEqual(level.passengerQueues.map(queueRuns), LEVEL7_QUEUE_RUNS);
});

test('level13 vehicle 130 is nudged clear of vehicle 135 collision body', () => {
  const level = LEVEL_CATALOG.level13;
  const vehicle130 = level.vehicles.find((vehicle) => vehicle.id === 130);
  const vehicle135 = level.vehicles.find((vehicle) => vehicle.id === 135);
  assert.equal(vehicle130.z, 1.3369986);
  assert.equal(boxesOverlap(collisionBox(level, vehicle130), collisionBox(level, vehicle135)), false);
  assert.deepEqual(new BusLoopGame(structuredClone(level)).getBlockers(130), []);
});

test('level15 uses the supplied passenger queue order', () => {
  const level = LEVEL_CATALOG.level15;
  assert.equal(level.unityId, 15);
  assert.equal(level.sourceFile, 'level15.asset');
  assert.equal(level.vehicles.some((vehicle) => vehicle.id === 157), true);
  assert.deepEqual(level.passengerQueues.map(queueRuns), LEVEL15_QUEUE_RUNS);
});

test('level12 contains guide vehicle 34 and is the baked production selection', () => {
  const level = LEVEL_CATALOG.level12;
  const guideVehicle = level.vehicles.find((vehicle) => vehicle.id === 34);
  assert.deepEqual(
    guideVehicle && { seats: guideVehicle.seats, colorIndex: guideVehicle.colorIndex, isHidden: guideVehicle.isHidden },
    { seats: 6, colorIndex: 0, isHidden: false }
  );
  assert.equal(SCENE_TUNING.level.selected, 'level12');
});

test('level12 uses the supplied layout and AppLovin playable passenger queue order', () => {
  const level = LEVEL_CATALOG.level12;
  assert.equal(level.unityId, 0);
  assert.equal(level.sourceFile, 'level12.asset');
  assert.equal(level.mapScale, 1.0012542);
  assert.deepEqual(level.passengerQueues.map(queueRuns), LEVEL12_QUEUE_RUNS);
  const vehicleIds = new Set(level.vehicles.map((vehicle) => vehicle.id));
  assert.equal(vehicleIds.size, level.vehicles.length);
  for (const [vehicleId, depthIds] of Object.entries(level.vehicleDepthes)) {
    assert.equal(vehicleIds.has(Number(vehicleId)), true, `level12 depth owner ${vehicleId}`);
    for (const depthId of depthIds) {
      assert.equal(vehicleIds.has(depthId), true, `level12 depth reference ${vehicleId} -> ${depthId}`);
    }
  }
  for (let first = 0; first < level.vehicles.length; first += 1) {
    for (let second = first + 1; second < level.vehicles.length; second += 1) {
      const firstVehicle = level.vehicles[first];
      const secondVehicle = level.vehicles[second];
      assert.equal(
        boxesOverlap(collisionBox(level, firstVehicle), collisionBox(level, secondVehicle)),
        false,
        `level12 vehicles ${firstVehicle.id} and ${secondVehicle.id}`
      );
    }
  }
});

test('level16 uses the authored vehicle layout and passenger queue order', () => {
  const level = LEVEL_CATALOG.level16;
  assert.equal(level.unityId, 14);
  assert.equal(level.sourceFile, 'level16.asset');
  assert.equal(level.mapScale, 0.95);
  assert.equal(level.vehicles.some((vehicle) => vehicle.id === 45), true);
  assert.deepEqual(level.passengerQueues.map(queueRuns), LEVEL16_QUEUE_RUNS);
  assert.equal(SCENE_TUNING.vehicleArea.positionUnitScale, 0.8);
  assert.equal(SCENE_TUNING.vehicleArea.modelScale, 0.7);
  assert.equal(SCENE_TUNING.vehiclePath.parkingBounds.minX, -2.2);
  assert.equal(SCENE_TUNING.vehiclePath.parkingBounds.maxX, 2.2);
  for (let first = 0; first < level.vehicles.length; first += 1) {
    for (let second = first + 1; second < level.vehicles.length; second += 1) {
      const firstVehicle = level.vehicles[first];
      const secondVehicle = level.vehicles[second];
      assert.equal(
        boxesOverlap(collisionBox(level, firstVehicle), collisionBox(level, secondVehicle)),
        false,
        `level16 vehicles ${firstVehicle.id} and ${secondVehicle.id}`
      );
    }
  }
});

test('level17 uses the supplied Unity layout and has valid depth and collision data', () => {
  const level = LEVEL_CATALOG.level17;
  assert.equal(level.unityId, 17);
  assert.equal(level.sourceFile, 'level17.asset');
  assert.equal(level.mapScale, 0.9);
  const vehicleIds = new Set(level.vehicles.map((vehicle) => vehicle.id));
  assert.equal(vehicleIds.size, level.vehicles.length);
  for (const [vehicleId, depthIds] of Object.entries(level.vehicleDepthes)) {
    assert.equal(vehicleIds.has(Number(vehicleId)), true, `level17 depth owner ${vehicleId}`);
    for (const depthId of depthIds) {
      assert.equal(vehicleIds.has(depthId), true, `level17 depth reference ${vehicleId} -> ${depthId}`);
    }
  }
  for (let first = 0; first < level.vehicles.length; first += 1) {
    for (let second = first + 1; second < level.vehicles.length; second += 1) {
      const firstVehicle = level.vehicles[first];
      const secondVehicle = level.vehicles[second];
      assert.equal(
        boxesOverlap(collisionBox(level, firstVehicle), collisionBox(level, secondVehicle)),
        false,
        `level17 vehicles ${firstVehicle.id} and ${secondVehicle.id}`
      );
    }
  }
});

test('level18 follows the supplied file order and has valid geometry', () => {
  const level = LEVEL_CATALOG.level18;
  assert.equal(level.unityId, 16);
  assert.equal(level.sourceFile, 'level18.asset');
  assert.equal(level.mapScale, 1);
  const vehicleIds = new Set(level.vehicles.map((vehicle) => vehicle.id));
  assert.equal(vehicleIds.size, level.vehicles.length);
  for (const [vehicleId, depthIds] of Object.entries(level.vehicleDepthes)) {
    assert.equal(vehicleIds.has(Number(vehicleId)), true, `level18 depth owner ${vehicleId}`);
    for (const depthId of depthIds) {
      assert.equal(vehicleIds.has(depthId), true, `level18 depth reference ${vehicleId} -> ${depthId}`);
    }
  }
  for (let first = 0; first < level.vehicles.length; first += 1) {
    for (let second = first + 1; second < level.vehicles.length; second += 1) {
      const firstVehicle = level.vehicles[first];
      const secondVehicle = level.vehicles[second];
      assert.equal(
        boxesOverlap(collisionBox(level, firstVehicle), collisionBox(level, secondVehicle)),
        false,
        `level18 vehicles ${firstVehicle.id} and ${secondVehicle.id}`
      );
    }
  }
});

test('level8 and level9 use Unity logical vehicle sizes without initial overlaps', () => {
  const expectedSizes = {
    4: { width: 0.27, length: 0.47157902 },
    6: { width: 0.27, length: 0.486 },
    10: { width: 0.27, length: 0.6785897 }
  };
  for (const key of ['level8', 'level9']) {
    const level = LEVEL_CATALOG[key];
    assert.deepEqual(level.collision.vehicleSizes, expectedSizes, `${key} collision sizes`);
    for (let first = 0; first < level.vehicles.length; first += 1) {
      for (let second = first + 1; second < level.vehicles.length; second += 1) {
        const firstVehicle = level.vehicles[first];
        const secondVehicle = level.vehicles[second];
        assert.equal(
          boxesOverlap(collisionBox(level, firstVehicle), collisionBox(level, secondVehicle)),
          false,
          `${key} vehicles ${firstVehicle.id} and ${secondVehicle.id}`
        );
      }
    }
  }
});

test('editor level selection reloads the runtime and production build regenerates active data', () => {
  const editorSource = readFileSync('src/scene-editor.js', 'utf8');
  const mainSource = readFileSync('src/main.js', 'utf8');
  const packageJson = JSON.parse(readFileSync('package.json', 'utf8'));
  assert.match(editorSource, /'level\.selected'/);
  assert.match(editorSource, /LEVEL_OPTIONS/);
  assert.match(mainSource, /getLevelDefinition\(SCENE_TUNING\.level\?\.selected\)/);
  assert.match(mainSource, /setActiveLevel\(levelSession\.currentLevel\(\)\)/);
  assert.match(mainSource, /path === 'level\.selected'/);
  assert.match(mainSource, /fetch\('\/__playable-level'/);
  assert.match(mainSource, /window\.location\.reload\(\)/);
  assert.equal(packageJson.scripts.prebuild, 'node scripts/generate-active-level.mjs');
  const generatorSource = readFileSync('scripts/generate-active-level.mjs', 'utf8');
  assert.match(generatorSource, /selected-level\.txt/);
  assert.match(generatorSource, /SCENE_TUNING\.background\?\.asset/);
  assert.match(generatorSource, /background: selectedBackground/);
  assert.match(generatorSource, /Selected background asset does not exist/);
  const viteConfigSource = readFileSync('vite.config.js', 'utf8');
  assert.match(viteConfigSource, /'level15'/);
  assert.match(viteConfigSource, /'level16'/);
  assert.match(viteConfigSource, /'level12'/);
  assert.match(viteConfigSource, /'level17'/);
  assert.match(viteConfigSource, /'level18'/);
});

