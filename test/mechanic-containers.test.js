// Gate queue (container type 4), two-floor elevator (type 5), and surplus-seat
// colours. Those three cases only appear in the newer Level_Escape_E pack and
// were the reason those levels could not be imported at all.

import test from 'node:test';
import assert from 'node:assert/strict';
import { BusLoopGame } from '../src/game-model.js';
import { LEVEL_1 } from '../src/level-data.js';
import {
  gateQueuePath,
  gateVehicleLength,
  layoutGateQueue,
  sortGateQueueVehicles
} from '../src/mechanic-containers.js';

function baseLevel(overrides = {}) {
  return {
    ...structuredClone(LEVEL_1),
    key: 'mechanism-probe',
    displayName: 'mechanism probe',
    vehicles: [],
    containers: [],
    vehicleDepthes: {},
    vehicleAmbulances: [],
    passengerQueues: [[]],
    passengerSequence: [],
    queueCapacity: 0,
    conveyorCapacity: 1,
    spotCount: 4,
    ...overrides
  };
}

// A straight gate lane pointing down -Z, head at the container anchor.
function gateLevel() {
  const path = [
    { x: 0, z: 0 },
    { x: 0, z: -0.6 },
    { x: 0, z: -1.2 }
  ];
  return baseLevel({
    vehicles: [
      { id: 1, seats: 4, colorIndex: 2, x: 0, z: 0, yaw: 0, containerType: 4, containerId: 7 },
      { id: 2, seats: 4, colorIndex: 2, x: 0, z: -0.6, yaw: 0, containerType: 4, containerId: 7 },
      { id: 3, seats: 4, colorIndex: 2, x: 0, z: -1.2, yaw: 0, containerType: 4, containerId: 7 }
    ],
    containers: [{
      id: 7,
      type: 4,
      x: 0,
      z: 0,
      yaw: 0,
      gateQueueGap: 0.1,
      gateQueuePathShape: 0,
      gateQueuePathPoints: path
    }]
  });
}

test('the gate queue path is read head first from the authored points', () => {
  const level = gateLevel();
  const container = level.containers[0];
  const path = gateQueuePath(container, level.vehicles);
  assert.deepEqual(path, container.gateQueuePathPoints);
  const ordered = sortGateQueueVehicles(level.vehicles, path).map((vehicle) => vehicle.id);
  assert.deepEqual(ordered, [1, 2, 3]);
});

test('gate cars are placed nose-to-tail with the authored gap', () => {
  const level = gateLevel();
  const path = gateQueuePath(level.containers[0], level.vehicles);
  const placements = layoutGateQueue(level.vehicles, path, 0.1, gateVehicleLength);
  // 4-seat cars are 0.47157902 long, so consecutive centres sit half of each.
  const first = placements.get(1);
  const second = placements.get(2);
  const spacing = Math.hypot(second.x - first.x, second.z - first.z);
  assert.ok(Math.abs(spacing - (0.47157902 + 0.1)) < 0.001, `spacing was ${spacing}`);
  assert.ok(Math.abs(first.z) < 1e-6);
});

test('only the head of a gate queue can drive out', () => {
  const game = new BusLoopGame(gateLevel());
  assert.equal(game.collisionContext.canVehicleDriveOut(game, 1), true);
  assert.equal(game.collisionContext.canVehicleDriveOut(game, 2), false);
  assert.deepEqual(game.getBlockers(2), [1]);
});

test('dispatching the head advances the queue by one footprint', () => {
  const game = new BusLoopGame(gateLevel());
  const before = game.getVehicle(2).z;
  game.clickVehicle(1);
  const after = game.getVehicle(2);
  assert.equal(after.gateIndex, 0);
  assert.ok(after.z > before, 'second car should move up toward the gate');
  assert.equal(game.collisionContext.canVehicleDriveOut(game, 2), true);
});

test('an elevator only exposes one floor at a time', () => {
  const level = baseLevel({
    vehicles: [
      { id: 1, seats: 4, colorIndex: 2, x: 0, z: 0, yaw: 0, containerType: 5, containerId: 9, elevatorLayer: 0 },
      { id: 2, seats: 4, colorIndex: 2, x: 0.3, z: 0.3, yaw: 0, containerType: 5, containerId: 9, elevatorLayer: 1 }
    ],
    containers: [{ id: 9, type: 5, x: 0, z: 0, yaw: 0, elevatorSize: { x: 2, y: 2 } }]
  });
  const game = new BusLoopGame(level);
  assert.equal(game.getVehicle(1).state, 'parked');
  assert.equal(game.getVehicle(2).state, 'in-elevator');
  assert.equal(game.mechanicState.elevators[0].activeLayer, 0);
});

test('the elevator promotes its lower floor once the upper one leaves', () => {
  const level = baseLevel({
    vehicles: [
      { id: 1, seats: 4, colorIndex: 2, x: 0, z: 0, yaw: 0, containerType: 5, containerId: 9, elevatorLayer: 0 },
      { id: 2, seats: 4, colorIndex: 2, x: 0.3, z: 0.3, yaw: 0, containerType: 5, containerId: 9, elevatorLayer: 1 }
    ],
    containers: [{ id: 9, type: 5, x: 0, z: 0, yaw: 0, elevatorSize: { x: 2, y: 2 } }]
  });
  const game = new BusLoopGame(level);
  // Remove the only upper-floor car directly, then let the model advance.
  game.getVehicle(1).state = 'done';
  game.refreshElevators();
  assert.equal(game.mechanicState.elevators[0].activeLayer, 1);
  assert.equal(game.getVehicle(2).state, 'parked');
  assert.equal(game.getVehicle(2).elevatorActive, true);
});

test('a car whose colour has surplus seats departs instead of deadlocking', () => {
  // Two 4-seat cars of colour 2 but only four passengers: one car can never
  // fill up. That is exactly the A/B-165 and E-38 shape.
  const level = baseLevel({
    vehicles: [
      { id: 1, seats: 4, colorIndex: 2, x: 0, z: 0, yaw: 0, containerType: 1, containerId: 0 },
      { id: 2, seats: 4, colorIndex: 2, x: 1, z: 0, yaw: 0, containerType: 1, containerId: 0 }
    ],
    containers: [{ id: 0, type: 1, x: 0, z: 0, yaw: 0 }],
    passengerQueues: [[2, 2, 2, 2]],
    passengerSequence: [2, 2, 2, 2]
  });
  const game = new BusLoopGame(level);
  assert.deepEqual([...game.surplusColors()], [2]);
  const surplus = game.getVehicle(2);
  // Park the surplus car on a spot and exhaust its colour, which is what
  // happens once the last passenger of that colour has boarded.
  for (const queue of game.queues) queue.length = 0;
  for (const queue of game.sourceQueues) queue.length = 0;
  for (const slot of game.slots) slot.colorIndex = null;
  assert.equal(game.countPendingPassengers(2), 0);
  game.spots[0].vehicleId = surplus.id;
  Object.assign(surplus, {
    state: 'moving-to-spot',
    spotIndex: 0,
    motion: 0.999,
    motionData: { path: { length: 1 }, duration: 0.01, curve: {} }
  });
  game.update(0.05);
  game.update(0.05);
  assert.equal(surplus.surplusReleased, true);
  assert.equal(surplus.state, 'boarding-final');
});

test('balanced levels never release a car early', () => {
  const level = baseLevel({
    vehicles: [
      { id: 1, seats: 4, colorIndex: 2, x: 0, z: 0, yaw: 0, containerType: 1, containerId: 0 }
    ],
    containers: [{ id: 0, type: 1, x: 0, z: 0, yaw: 0 }],
    passengerQueues: [[2, 2, 2, 2]],
    passengerSequence: [2, 2, 2, 2]
  });
  const game = new BusLoopGame(level);
  assert.equal(game.surplusColors().size, 0);
});
