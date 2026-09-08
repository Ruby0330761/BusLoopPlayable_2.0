import test from 'node:test';
import assert from 'node:assert/strict';
import { BusLoopGame } from '../src/game-model.js';
import {
  findCollisionContact,
  getVehicleCollisionSize,
  getGarageCollisionSize,
  GARAGE_SIZE_MULTIPLIER,
  CONVEYOR_GAP_GUARD_FACTOR
} from '../src/vehicle-collision.js';

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

function createGarageLevel(overrides = {}) {
  return createLevel({
    garage: { parkOffset: 0.7, outDelay: 0.2, outDuration: 0.3 },
    collision: {
      vehicleSizes: {
        4: { width: 0.4, length: 0.4 },
        6: { width: 0.4, length: 0.6 },
        10: { width: 0.4, length: 0.8 }
      },
      maxVehicleSize: { width: 0.4, length: 0.8 },
      garageSize: { width: 0.5, length: 0.6 }
    },
    containers: [
      { id: 0, type: 1, x: 0, z: 0, yaw: 0 },
      { id: 1, type: 2, x: 0, z: 0, yaw: 0 }
    ],
    vehicles: [
      { id: 1, seats: 4, colorIndex: 0, x: -1, z: -1, yaw: 90, containerType: 2, containerId: 1 },
      { id: 2, seats: 6, colorIndex: 1, x: 1, z: -1, yaw: 90, containerType: 2, containerId: 1 }
    ],
    ...overrides
  });
}

function createConveyorGapLevel(gap, attackerOnConveyor = true) {
  const blockerWidth = 0.2;
  const centerOffset = (blockerWidth + gap) * 0.5;
  return createLevel({
    spotCount: 2,
    containers: [{ id: 4, type: 3, x: 0, z: 0, yaw: 0 }],
    conveyorBelts: [{ vcId: 4, width: 1 }],
    conveyorMechanic: {
      width: 1,
      extraWidth: 1.2,
      vehicleWidth: 0.1,
      minGap: 0,
      speed: 0.4
    },
    collision: {
      vehicleSizes: {
        4: { width: 0.1, length: 0.2 },
        6: { width: blockerWidth, length: 0.4 }
      },
      maxVehicleSize: { width: blockerWidth, length: 0.4 },
      conveyor: { size: { width: 1, length: 1 }, exitWidth: 1, wallThickness: 0.02 }
    },
    vehicles: [
      {
        id: 1,
        seats: 4,
        colorIndex: 0,
        x: 0,
        z: 0,
        yaw: 0,
        ...(attackerOnConveyor ? { containerType: 3, containerId: 4 } : { containerType: 1, containerId: 0 })
      },
      { id: 2, seats: 6, colorIndex: 1, x: -centerOffset, z: 2, yaw: 0, containerType: 1, containerId: 0 },
      { id: 3, seats: 6, colorIndex: 2, x: centerOffset, z: 2, yaw: 0, containerType: 1, containerId: 0 }
    ],
    ...(!attackerOnConveyor ? { containers: [{ id: 0, type: 1, x: 0, z: 0, yaw: 0 }, { id: 4, type: 3, x: 2, z: 0, yaw: 0 }] } : {})
  });
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

test('ordinary vehicles do not block on a non-overlapping narrow gap', () => {
  const game = new BusLoopGame(createLevel({
    vehicles: [
      { id: 1, seats: 4, colorIndex: 0, x: 0, z: 0, yaw: 0 },
      { id: 2, seats: 4, colorIndex: 1, x: -0.45, z: 2, yaw: 0 },
      { id: 3, seats: 4, colorIndex: 2, x: 0.45, z: 2, yaw: 0 }
    ]
  }));
  assert.deepEqual(game.getBlockers(1), []);
  const result = game.clickVehicle(1);
  assert.deepEqual(result, { ok: true, spotIndex: 0 });
  assert.equal(game.getVehicle(1).state, 'moving-to-spot');
});

test('conveyor vehicles treat sub-1.2-minimum-width forward gaps as blocked', () => {
  const game = new BusLoopGame(createConveyorGapLevel(0.1));
  const entry = game.collisionContext.ensure(game).conveyors.get(4);
  assert.equal(entry.gapGuard, 0.1 * CONVEYOR_GAP_GUARD_FACTOR);
  assert.equal(game.collisionContext.canVehicleDriveOut(game, 1), false);
  assert.deepEqual(game.getBlockers(1), [2]);
  const result = game.clickVehicle(1);
  assert.equal(result.reason, 'blocked');
  assert.equal(game.getVehicle(1).collision.targetId, 2);
});

test('conveyor gap guard does not block a gap at or above the threshold', () => {
  const game = new BusLoopGame(createConveyorGapLevel(0.13));
  assert.equal(game.collisionContext.canVehicleDriveOut(game, 1), true);
  assert.deepEqual(game.getBlockers(1), []);
});

test('narrow-gap guard is scoped to conveyor attackers', () => {
  const game = new BusLoopGame(createConveyorGapLevel(0.1, false));
  const candidates = game.collisionContext.getCollisionCandidates(game, 1);
  assert.equal(candidates.some((candidate) => candidate.conveyorGapGuard), false);
});

test('garage collision footprint uses the shared 1.3x playable scale', () => {
  const level = createGarageLevel();
  assert.equal(GARAGE_SIZE_MULTIPLIER, 1.3);
  assert.deepEqual(getGarageCollisionSize(level), { width: 0.65, length: 0.78 });
});

test('garage releases vehicles in authored order and waits for the door vehicle to leave', () => {
  const game = new BusLoopGame(createGarageLevel());
  assert.deepEqual(game.vehicles.map((vehicle) => vehicle.state), ['in-garage', 'in-garage']);
  assert.deepEqual(game.mechanicState.garages[0].vehicleIds, [1, 2]);

  game.update(0.1);
  assert.equal(game.getVehicle(1).state, 'leaving-garage');
  assert.equal(game.getVehicle(2).state, 'in-garage');
  assert.deepEqual(game.snapshot().lastEvent.garageReleasedVehicleIds, [1]);

  for (let index = 0; index < 5; index += 1) game.update(0.1);
  assert.equal(game.getVehicle(1).state, 'parked');
  assert.equal(game.getVehicle(1).z, 0.7);
  assert.equal(game.getVehicle(2).state, 'in-garage');
  assert.deepEqual(game.mechanicState.garages[0].vehicleIds, [2]);

  assert.equal(game.clickVehicle(1).ok, true);
  assert.equal(game.getVehicle(2).state, 'leaving-garage');
  assert.deepEqual(game.lastEvent.garageReleasedVehicleIds, [2]);
});

test('garage remains closed while a parked vehicle blocks its exact door box', () => {
  const game = new BusLoopGame(createGarageLevel({
    vehicles: [
      { id: 1, seats: 4, colorIndex: 0, x: -1, z: -1, yaw: 90, containerType: 2, containerId: 1 },
      { id: 3, seats: 4, colorIndex: 2, x: 0, z: 0.5, yaw: 90, containerType: 1, containerId: 0 }
    ]
  }));
  game.update(0.1);
  assert.equal(game.getVehicle(1).state, 'in-garage');
  assert.equal(game.clickVehicle(3).ok, true);
  assert.equal(game.getVehicle(1).state, 'leaving-garage');
});

test('garage hides after its final vehicle finishes leaving', () => {
  const game = new BusLoopGame(createGarageLevel({
    vehicles: [
      { id: 1, seats: 4, colorIndex: 0, x: -1, z: -1, yaw: 90, containerType: 2, containerId: 1 }
    ]
  }));
  game.update(0.1);
  for (let index = 0; index < 5; index += 1) game.update(0.1);
  const garage = game.mechanicState.garages[0];
  assert.equal(garage.hidden, true);
  assert.deepEqual(garage.vehicleIds, []);
  assert.deepEqual(game.lastEvent.garageClearedIds, [1]);
});
