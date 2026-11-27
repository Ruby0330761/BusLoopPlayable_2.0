import test from 'node:test';
import assert from 'node:assert/strict';
import { SCENE_TUNING } from '../src/scene-tuning.js';
import { LEVEL_CATALOG } from '../src/level-catalog.js';
import { BusLoopGame } from '../src/game-model.js';
import { PLAYABLE_STAGES } from '../src/generated-active-level.js';
import { mapVehicleAreaBasePoint } from '../src/vehicle-area.js';
import { buildToStationPoints, buildOutStationPoints, buildDepartureForwardPoints, buildRoundedPath, evaluatePath } from '../src/vehicle-motion.js';
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

test('automatic bounds follow vehicle positions with a fixed exit clearance', () => {
  const original = tuning();
  original.vehiclePath.autoBounds = 1;
  const initial = resolveVehiclePathConfig(level, original);
  const expanded = structuredClone(level);
  expanded.vehicles.push({ id: 999, x: 9, z: 2, yaw: 45, seats: 10 });
  const config = resolveVehiclePathConfig(expanded, original);
  assert.ok(config.station.parkingBounds.maxX > 9);
  assert.ok(config.station.parkingBounds.maxX > initial.station.parkingBounds.maxX);
  original.vehicleArea.modelScale *= 2;
  const larger = resolveVehiclePathConfig(expanded, original);
  assert.deepEqual(larger.station.parkingBounds, config.station.parkingBounds);
  const rowTuning = tuning();
  rowTuning.vehiclePath.autoBounds = 1;
  const movedRow = resolveVehiclePathConfig(level, rowTuning, { ...SCENE_TUNING.parkingSpots, z: -5 });
  assert.equal(movedRow.station.parkingBounds.maxZ, initial.station.parkingBounds.maxZ);
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

test('automatic side lanes have a fixed clearance plus the editable padding', () => {
  const fixture = {
    key: 'compact-sides',
    vehicles: [{ id: 1, x: 0, z: 0, yaw: 0, seats: 4, collisionSize: { width: 0.4, length: 1 } }]
  };
  const settings = tuning();
  settings.vehicleArea = {
    positionUnitScale: 1, unityToWorldScale: 1,
    modelScale: 1, modelDepthBySeats: { 4: 1 }
  };
  settings.vehiclePath = { autoBounds: 1, boundsPadding: 0.1, turnRadius: 0.5 };
  const initial = resolveVehiclePathConfig(fixture, settings);
  close(initial.station.parkingBounds.minX, -0.6);
  close(initial.station.parkingBounds.maxX, 0.6);

  settings.vehiclePath.turnRadius = 1;
  const widerTurns = resolveVehiclePathConfig(fixture, settings);
  close(widerTurns.station.parkingBounds.minX, initial.station.parkingBounds.minX);
  close(widerTurns.station.parkingBounds.maxX, initial.station.parkingBounds.maxX);
  close(widerTurns.station.parkingBounds.minZ, initial.station.parkingBounds.minZ);
  close(widerTurns.station.parkingBounds.maxZ, initial.station.parkingBounds.maxZ);
  assert.deepEqual(widerTurns.spots, initial.spots);

  settings.vehiclePath.boundsPadding = 0.2;
  const padded = resolveVehiclePathConfig(fixture, settings);
  close(padded.station.parkingBounds.minX, -0.7);
  close(padded.station.parkingBounds.maxX, 0.7);
});

test('older baked path versions are recalculated even when their input key matches', () => {
  const current = resolveVehiclePathConfig(level, tuning());
  const stale = structuredClone(current);
  stale.version = 3;
  stale.station.parkingBounds.minX -= 10;
  const restored = resolveVehiclePathConfig({ ...level, vehiclePathSnapshot: stale }, tuning());
  assert.deepEqual(restored, current);
});

test('all spots share the incoming top edge and outgoing lane in manual and automatic mode', () => {
  const settings = tuning();
  Object.assign(settings.vehicleDeparturePath, { y: -1, backDistance: 1.5, exitTargetZOffset: 0.75 });
  settings.vehiclePath.y = 0.145;
  for (const autoBounds of [0, 1]) for (const laneZ of [2.8, 3.6]) {
    settings.vehiclePath.autoBounds = autoBounds;
    settings.vehiclePath.parkingBounds.maxZ = laneZ;
    settings.vehicleArea.rotationDegrees = 27;
    const config = resolveVehiclePathConfig(level, settings);
    close(config.station.y, config.vehicleArea.y);
    close(config.departure.y, config.station.y);
    for (const spot of config.spots) {
      const arrival = buildToStationPoints({ x: 0, z: laneZ + 0.4, yaw: 0 }, spot, config.station);
      close(arrival.at(-2).z, laneZ);
      const reverse = buildOutStationPoints(spot, config.departure);
      close(reverse[1].z, laneZ);
      const [start, end] = buildDepartureForwardPoints(reverse.at(-1), config.departure);
      close(start.z, laneZ);
      close(end.z, laneZ);
      close(end.x - start.x, settings.vehicleDeparturePath.exitDistance);
    }
  }
});

test('resizing or replacing the car leaves its rounded driving path unchanged', () => {
  const fixture = { key: 'fixed-route', vehicles: [{ id: 1, x: -1, z: 0, yaw: -90, seats: 4 }] };
  const settings = tuning();
  const route = () => {
    const c = resolveVehiclePathConfig(fixture, settings);
    return buildRoundedPath(buildToStationPoints(fixture.vehicles[0], c.spots[0], c.station), c.station);
  };
  const initial = route();
  for (const seats of [4, 6, 10]) for (const scale of [0.5, 1, 2.5]) {
    Object.assign(fixture.vehicles[0], { seats, collisionSize: { width: scale, length: 2 * scale } });
    Object.assign(settings.vehicleArea, { modelScale: scale, sizeMultiplier: scale });
    assert.deepEqual(route(), initial);
  }
});

test('compact entries delay the first turn and fit the upper turn to the joining gap', () => {
  const config = resolveVehiclePathConfig(LEVEL_CATALOG.level33, tuning());
  const vehicle = LEVEL_CATALOG.level33.vehicles.find((entry) => entry.id === 49);
  const points = buildToStationPoints(vehicle, config.spots[0], config.station);
  const path = buildRoundedPath(points, config.station);
  const curves = path.segments.filter((segment) => segment.type === 'cubic');
  close(Math.abs(curves[0].p0.x - points[1].x), SCENE_TUNING.vehiclePath.boundsPadding);
  close(Math.abs(curves[1].p1.x - points[2].x), config.station.topTurnRadius);
  assert.ok(config.station.topTurnRadius <= SCENE_TUNING.vehiclePath.turnRadius);

  const zeroPadding = tuning();
  zeroPadding.vehiclePath.boundsPadding = 0;
  const tight = resolveVehiclePathConfig(LEVEL_CATALOG.level33, zeroPadding);
  const sharp = buildRoundedPath(buildToStationPoints(vehicle, tight.spots[0], tight.station), tight.station);
  assert.ok(sharp.segments.every((segment) => segment.length > 0));
  assert.deepEqual(evaluatePath(sharp, sharp.length).position, { x: tight.spots[0].x, z: tight.spots[0].z });
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
