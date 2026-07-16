import test from 'node:test';
import assert from 'node:assert/strict';
import { BusLoopGame } from '../src/game-model.js';
import { findCollisionContact, getVehicleCollisionSize } from '../src/vehicle-collision.js';

function createLevel(overrides = {}) {
  return {
    id: 501,
    key: 'collisionTest',
    mapScale: 1,
    sceneName: 'VehicleCollisionTest',
    groupSize: 4,
    spotCount: 2,
    conveyorCapacity: 1,
    conveyorSpeed: 0.5,
    conveyorPathLength: 1,
    queueCount: 2,
    queueCapacity: 0,
    entryPercents: [0, 0.5],
    longPressThreshold: 0.2,
    longPressMultiplier: 3,
    exitStart: 0.6,
    exitEnd: 0.8,
    boardingDepartureDelay: 0.1,
    passengerQueue: { spacing: 0.4 },
    passengerEntryMotion: { passengerSpeed: 1 },
    vehicleSize: { width: 0.4, length: 0.8 },
    collision: {
      vehicleSizes: {
        4: { width: 0.4, length: 0.4 },
        6: { width: 0.4, length: 0.6 },
        10: { width: 0.4, length: 0.8 }
      },
      maxVehicleSize: { width: 0.4, length: 0.8 }
    },
    vehicleMotion: {
      spotStartX: -2,
      spotSpacing: 1,
      spotZ: 4,
      spotYaw: 0,
      spotApproachOffsetZ: 0,
      spotApproachDirection: 'screen-down'
    },
    containers: [{ id: 0, type: 1, x: 0, z: 0, yaw: 0 }],
    vehicles: [
      { id: 1, seats: 4, colorIndex: 0, x: 0, z: 0, yaw: 0 },
      { id: 2, seats: 10, colorIndex: 1, x: 0, z: 2, yaw: 90 }
    ],
    vehicleDepthes: { 1: [] },
    passengerSequence: [],
    passengerQueues: [[], []],
    assets: { audio: {} },
    ...overrides
  };
}

test('collision size selection uses the Unity vehicle type size', () => {
  const level = createLevel();
  assert.deepEqual(getVehicleCollisionSize(level, level.vehicles[0]), { width: 0.4, length: 0.4 });
  assert.deepEqual(getVehicleCollisionSize(level, level.vehicles[1]), { width: 0.4, length: 0.8 });
});

test('runtime collision graph uses current geometry instead of legacy depth chains', () => {
  const game = new BusLoopGame(createLevel({ vehicleDepthes: { 1: [] } }));
  assert.deepEqual(game.getBlockers(1), [2]);
  game.getVehicle(2).state = 'moving-to-spot';
  assert.deepEqual(game.getBlockers(1), []);
});

test('reset rebuilds collision decisions from restored parked state', () => {
  const game = new BusLoopGame(createLevel());
  game.getVehicle(2).state = 'at-spot';
  assert.deepEqual(game.getBlockers(1), []);
  game.reset();
  assert.deepEqual(game.getBlockers(1), [2]);
});

test('full station is rejected before collision feedback like Unity input', () => {
  const game = new BusLoopGame(createLevel({ spotCount: 1 }));
  for (const spot of game.spots) spot.vehicleId = 99;
  assert.deepEqual(game.clickVehicle(1), { ok: false, reason: 'spots-full' });
  assert.equal(game.getVehicle(1).state, 'parked');
});

test('edge contact uses attacker and target sizes', () => {
  const level = createLevel();
  const [attacker, target] = level.vehicles;
  const contact = findCollisionContact(level, attacker, [{
    type: 'vehicle',
    id: target.id,
    vehicle: target,
    box: {
      position: { x: target.x, z: target.z },
      yaw: target.yaw,
      size: getVehicleCollisionSize(level, target),
      forward: { x: 1, z: 0 },
      right: { x: 0, z: -1 }
    }
  }]);
  assert.ok(contact);
  assert.ok(Math.abs(contact.distance - 1.6) < 1e-6);
  assert.ok(Math.abs(contact.position.z - 1.8) < 1e-6);
});

test('blocked vehicle selects a direct geometry candidate and animates collision', () => {
  const game = new BusLoopGame(createLevel());
  const result = game.clickVehicle(1);
  assert.deepEqual(result, { ok: false, reason: 'blocked', blockers: [2] });
  assert.equal(game.getVehicle(1).state, 'colliding');
  assert.equal(game.getVehicle(1).collision.targetId, 2);
  assert.equal(game.getVehicle(1).collision.targetType, 'vehicle');
});
