import test from 'node:test';
import assert from 'node:assert/strict';
import { SCENE_TUNING } from '../src/scene-tuning.js';
import { LEVEL_CATALOG } from '../src/level-catalog.js';
import { BusLoopGame } from '../src/game-model.js';
import { PLAYABLE_STAGES } from '../src/generated-active-level.js';
import { mapVehicleAreaBasePoint } from '../src/vehicle-area.js';
import { buildToStationPoints, buildRoundedPath, evaluatePath } from '../src/vehicle-motion.js';
import { createVehicleRouteTransform, migrateVehiclePathTuning, resolveVehiclePathConfig } from '../src/vehicle-path-config.js';

const tuning = () => structuredClone(SCENE_TUNING);
const level = LEVEL_CATALOG.currentLevel12;
const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-8, `${a} != ${b}`);

test('source/world position and yaw round-trip through mirror, scaling, translation and formation rotation', () => {
  for (const mirrorZ of [true, false]) for (const rotationDegrees of [-70, 0, 37, 180]) {
    const area = { ...SCENE_TUNING.vehicleArea, mirrorZ, rotationDegrees, offsetX: 1.7, offsetZ: -2.3 };
    const transform = createVehicleRouteTransform(level, area);
    const base = level.vehicles.map((v) => mapVehicleAreaBasePoint(v, area));
    const pivot = { x: (Math.min(...base.map(p => p.x)) + Math.max(...base.map(p => p.x))) / 2,
      z: (Math.min(...base.map(p => p.z)) + Math.max(...base.map(p => p.z))) / 2 };
    const angle = rotationDegrees * Math.PI / 180;
    for (const [index, vehicle] of level.vehicles.entries()) {
      const world = transform.point(vehicle.x, vehicle.z);
      const dx = base[index].x - pivot.x, dz = base[index].z - pivot.z;
      close(world.x, pivot.x + dx * Math.cos(angle) - dz * Math.sin(angle));
      close(world.z, pivot.z + dx * Math.sin(angle) + dz * Math.cos(angle));
      const source = transform.unproject(world.x, world.z);
      close(source.x, vehicle.x); close(source.z, vehicle.z);
      close(transform.sourceYaw(transform.yaw(vehicle.yaw)), vehicle.yaw);
    }
  }
});

test('legacy manual bounds survive migration, including zero values, and migration is idempotent', () => {
  const old = { vehiclePath: { parkingBounds: { minX: -4, maxX: 5, minZ: -3.22, maxZ: 0 } } };
  assert.equal(migrateVehiclePathTuning(old), true);
  assert.equal(old.vehiclePath.autoBounds, 0);
  assert.equal(migrateVehiclePathTuning(old), false);
  const config = resolveVehiclePathConfig(level, { ...tuning(), vehiclePath: old.vehiclePath });
  assert.deepEqual(config.station.parkingBounds, old.vehiclePath.parkingBounds);
});

test('automatic bounds follow the complete field, model size and parking approach lane', () => {
  const original = tuning();
  const initial = resolveVehiclePathConfig(level, original);
  const expanded = structuredClone(level);
  expanded.vehicles.push({ id: 999, x: 9, z: 2, yaw: 45, seats: 10 });
  const config = resolveVehiclePathConfig(expanded, original);
  assert.ok(config.station.parkingBounds.maxX > 9);
  assert.ok(config.station.parkingBounds.maxX > initial.station.parkingBounds.maxX);
  original.vehicleArea.modelScale *= 2;
  const larger = resolveVehiclePathConfig(expanded, original);
  assert.ok(larger.station.parkingBounds.maxX > config.station.parkingBounds.maxX);
  const movedRow = resolveVehiclePathConfig(level, tuning(), { ...SCENE_TUNING.parkingSpots, z: -5 });
  assert.notEqual(movedRow.station.parkingBounds.maxZ, initial.station.parkingBounds.maxZ);
});

test('explicit editor spot tuning wins and native source-space values are only fallbacks', () => {
  const explicit = tuning();
  explicit.facing.parkingSpotYawDegrees = 35;
  explicit.vehicleArea.rotationDegrees = 30;
  const resolved = resolveVehiclePathConfig(level, explicit);
  const transform = createVehicleRouteTransform(level, explicit.vehicleArea);
  for (const spot of resolved.spots) {
    close(transform.yaw(spot.yaw), 35);
    const world = transform.point(spot.x, spot.z);
    close(world.x, spot.visualX); close(world.z, spot.visualZ);
  }
  const native = resolveVehiclePathConfig(level, { vehicleArea: explicit.vehicleArea });
  close(native.spots[0].x, level.vehicleMotion.spotStartX);
  close(native.spots[0].z, level.vehicleMotion.spotZ);
  close(native.spots[0].yaw, level.vehicleMotion.spotYaw);
});

test('stage spot count changes share centered positions and invalidate the snapshot', () => {
  const four = resolveVehiclePathConfig(level, tuning());
  const six = resolveVehiclePathConfig(level, tuning(), { ...SCENE_TUNING.parkingSpots, count: 6 });
  assert.equal(four.spots.length, 4); assert.equal(six.spots.length, 6);
  close(six.spots[0].visualX, -six.spots.at(-1).visualX);
  assert.notEqual(four.inputKey, six.inputKey);
});

test('serialized export snapshot and editor produce identical paths for every vehicle and spot', () => {
  const config = resolveVehiclePathConfig(level, tuning());
  const exportedLevel = JSON.parse(JSON.stringify({ ...level, vehiclePathSnapshot: config }));
  const restored = resolveVehiclePathConfig(exportedLevel, tuning());
  assert.deepEqual(restored, config);
  assert.ok(Object.isFrozen(restored.spots[0]));
  const captured = createVehicleRouteTransform(null, restored.vehicleArea, restored.transformOffset);
  const live = createVehicleRouteTransform(level, SCENE_TUNING.vehicleArea);
  assert.deepEqual(captured.point(2, 1), live.point(2, 1));
  for (const vehicle of level.vehicles) for (const [index, spot] of config.spots.entries()) {
    const preview = buildRoundedPath(buildToStationPoints(vehicle, spot, config.station), config.station);
    const runtime = buildRoundedPath(buildToStationPoints(vehicle, restored.spots[index], restored.station), restored.station);
    for (const ratio of [0, .25, .5, .99, 1]) {
      assert.deepEqual(evaluatePath(preview, preview.length * ratio), evaluatePath(runtime, runtime.length * ratio));
    }
  }
});

test('actual generated stages retain the same snapshot and paths with their stage spot overrides', () => {
  for (const stage of PLAYABLE_STAGES) {
    const spots = { ...SCENE_TUNING.parkingSpots, ...(stage.scene?.parkingSpots ?? {}) };
    const snapshot = stage.level.vehiclePathSnapshot;
    assert.ok(snapshot, 'production generation must record the resolved path config');
    const { vehiclePathSnapshot: _snapshot, ...editorLevel } = stage.level;
    const preview = resolveVehiclePathConfig(editorLevel, tuning(), spots);
    const production = resolveVehiclePathConfig(stage.level, tuning(), spots);
    assert.deepEqual(snapshot, preview);
    assert.deepEqual(production, preview);
    for (const vehicle of stage.level.vehicles) for (const [index, target] of preview.spots.entries()) {
      const expected = buildRoundedPath(buildToStationPoints(vehicle, target, preview.station), preview.station);
      const actual = buildRoundedPath(buildToStationPoints(vehicle, production.spots[index], production.station), production.station);
      assert.deepEqual(actual, expected);
    }
  }
});

test('captured dispatch config stays frozen while edits invalidate the next route', () => {
  const game = new BusLoopGame(level);
  assert.equal(game.clickVehicle(4).ok, true);
  const dispatch = game.getVehicle(4).motionData;
  const previewConfig = game.getVehiclePathConfig();
  assert.equal(dispatch.routeConfig, previewConfig);
  const before = JSON.stringify(dispatch.routeConfig);
  const original = SCENE_TUNING.vehiclePath.turnRadius;
  try {
    SCENE_TUNING.vehiclePath.turnRadius = original + .1;
    assert.notEqual(game.getVehiclePathConfig().inputKey, dispatch.routeConfig.inputKey);
    assert.equal(JSON.stringify(dispatch.routeConfig), before);
  } finally { SCENE_TUNING.vehiclePath.turnRadius = original; }
});

test('100% route sampling reaches the endpoint even when segment subtraction rounds down', () => {
  const config = resolveVehiclePathConfig(LEVEL_CATALOG.level15, tuning());
  for (const vehicle of LEVEL_CATALOG.level15.vehicles) {
    const spot = config.spots[0];
    const path = buildRoundedPath(buildToStationPoints(vehicle, spot, config.station), config.station);
    assert.deepEqual(evaluatePath(path, path.length).position, { x: spot.x, z: spot.z });
  }
});
