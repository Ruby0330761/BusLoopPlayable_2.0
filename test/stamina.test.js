import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { BusLoopGame } from '../src/game-model.js';
import { LEVEL_1 } from '../src/level-data.js';
import { SCENE_TUNING } from '../src/scene-tuning.js';
import { SceneView } from '../src/scene-view.js';
import { normalizeStaminaConfig, validateStaminaConfig } from '../src/stamina.js';

const advance = (game, seconds, step = 0.02) => {
  for (let elapsed = 0; elapsed < seconds; elapsed += step) game.update(Math.min(step, seconds - elapsed));
};
const until = (game, predicate, limit = 20) => {
  for (let elapsed = 0; !predicate() && elapsed < limit; elapsed += 0.02) game.update(0.02);
  assert.ok(predicate(), 'expected state was reached before the simulation limit');
};
const makeLevel = (overrides = {}) => ({
  ...structuredClone(LEVEL_1), key: 'stamina-test', id: 902,
  containers: [], vehicleDepthes: {}, vehicleAmbulances: [], conveyorBelts: [],
  queueCapacity: 6, conveyorCapacity: 6, passengerQueues: [[]], passengerSequence: [],
  vehicleSize: { width: 0.4, length: 0.4 },
  collision: { vehicleSizes: { 4: { width: 0.4, length: 0.4 } }, maxVehicleSize: { width: 0.4, length: 0.4 } },
  vehicles: [
    { id: 1, seats: 4, colorIndex: 4, x: 0, z: 0.7, yaw: 0, containerType: 1, containerId: 0 },
    { id: 2, seats: 4, colorIndex: 0, x: 0, z: 0, yaw: 0, containerType: 1, containerId: 0 },
    ...[3, 4, 5, 6].map((id) => ({ id, seats: 4, colorIndex: 1, x: id * 2, z: 0, yaw: 0, containerType: 1, containerId: 0 }))
  ], ...overrides
});
const withConfig = (config, callback) => {
  const previous = SCENE_TUNING.stamina;
  const delay = SCENE_TUNING.gameOver.failureDelaySeconds;
  SCENE_TUNING.stamina = { enabled: 1, lives: 3, ...config };
  try { return callback(); } finally {
    SCENE_TUNING.stamina = previous;
    SCENE_TUNING.gameOver.failureDelaySeconds = delay;
  }
};
const makeStalled = (game) => {
  game.initialFillActive = false;
  game.queues.forEach((queue) => { queue.length = 0; });
  game.sourceQueues.forEach((queue) => { queue.length = 0; });
  for (const [index, spot] of game.spots.entries()) {
    const vehicle = game.vehicles[index];
    Object.assign(vehicle, { state: 'at-spot', spotIndex: index, colorIndex: 4 });
    spot.vehicleId = vehicle.id;
  }
  for (const slot of game.slots) slot.colorIndex = 1;
};

test('stamina supports integers 1–10 and defaults legacy profiles off with three hearts', () => {
  assert.equal(normalizeStaminaConfig().enabled, 0);
  assert.equal(normalizeStaminaConfig().collisionPenaltyEnabled, 1);
  assert.equal(normalizeStaminaConfig().parkingRescueEnabled, 1);
  for (const key of ['collisionPenaltyEnabled', 'parkingRescueEnabled']) {
    for (const value of [0, 1]) assert.equal(validateStaminaConfig({ [key]: value })[key], value);
    for (const value of [-1, 2, '1', true, null]) assert.throws(() => validateStaminaConfig({ [key]: value }), /must be 0 or 1/);
  }
  for (let lives = 1; lives <= 10; lives++) assert.equal(validateStaminaConfig({ enabled: 1, lives }).lives, lives);
  for (const lives of [0, -1, 1.5, 11, '3', NaN]) assert.throws(() => validateStaminaConfig({ lives }));
  for (const lives of [undefined, null, '', 'invalid', Infinity]) assert.equal(normalizeStaminaConfig({ lives }).lives, 3);
  assert.equal(normalizeStaminaConfig({ lives: 2 }).lives, 2);
  assert.equal(normalizeStaminaConfig({ lives: 2.6 }).lives, 3);
  assert.equal(normalizeStaminaConfig({ lives: -3 }).lives, 1);
  assert.equal(normalizeStaminaConfig({ lives: 15 }).lives, 10);
});

test('a wrong click spends one heart at contact and keeps the ordinary bump without rescuing either car', () => withConfig({}, () => {
  const game = new BusLoopGame(makeLevel({ passengerQueues: [[4, 4, 4, 4]] }));
  const remainingGroups = game.getRemainingGroups();
  const result = game.clickVehicle(2);
  assert.equal(result.reason, 'blocked');
  assert.equal(game.stamina.remaining, 3);
  assert.equal(game.isStaminaBusy(), false);
  const attacker = game.getVehicle(2);
  advance(game, attacker.collision.forwardDuration / 2, 0.001);
  assert.equal(game.stamina.remaining, 3);
  until(game, () => attacker.collision.contactTriggered);
  assert.equal(game.stamina.remaining, 2);
  assert.equal(game.getVehicle(1).state, 'parked');
  assert.equal(game.getVehicle(1).rescueDispatched, false);
  assert.equal(attacker.rescueDispatched, false);
  assert.equal(game.lastEvent.type, 'vehicle-collision-contact');
  assert.ok(game.getVehicle(1).hit);
  assert.deepEqual(game.snapshot().stamina, { enabled: true, lives: 3, remaining: 2, busy: false });
  until(game, () => attacker.state === 'parked');
  advance(game, 1);
  assert.equal(game.getVehicle(1).state, 'parked');
  assert.equal(attacker.state, 'parked');
  assert.equal(attacker.motion, 0);
  assert.equal(game.getVehicle(1).boardedGroups, 0);
  assert.equal(game.getRemainingGroups(), remainingGroups);
  assert.equal(game.stamina.remaining, 2);
  assert.equal(game.status, 'playing');
}));

test('disabled stamina retains collision feedback and the original full-belt loss', () => withConfig({ enabled: 0 }, () => {
  const game = new BusLoopGame(makeLevel());
  game.clickVehicle(2);
  advance(game, 2);
  assert.equal(game.getVehicle(1).state, 'parked');
  assert.equal(game.isStaminaBusy(), false);
  assert.equal(game.stamina.remaining, 3);
  SCENE_TUNING.gameOver.failureDelaySeconds = 0.1;
  makeStalled(game);
  advance(game, 0.3);
  assert.equal(game.status, 'lost');
  assert.equal(game.lastEvent.reason, 'exceed-parking-spot');
}));

test('invalid clicks, a successful dispatch and a hidden reveal do not consume stamina', () => withConfig({}, () => {
  const game = new BusLoopGame(makeLevel());
  assert.equal(game.clickVehicle(9999).ok, false);
  const hidden = game.getVehicle(3);
  Object.assign(hidden, { isHidden: true, hiddenRevealed: false });
  assert.equal(game.clickVehicle(hidden.id).reason, 'hidden-reveal');
  assert.equal(game.stamina.remaining, 3);
  assert.equal(game.clickVehicle(4).ok, true);
  assert.equal(game.stamina.remaining, 3);
  assert.equal(game.isStaminaBusy(), false);
}));

test('a wrong click with occupied bays still only spends stamina and returns the attacker', () => withConfig({}, () => {
  const game = new BusLoopGame(makeLevel());
  for (const spot of game.spots) spot.vehicleId = 6;
  assert.equal(game.clickVehicle(2).reason, 'blocked');
  until(game, () => game.stamina.remaining === 2);
  assert.equal(game.getVehicle(1).state, 'parked');
  assert.equal(game.isStaminaBusy(), false);
  until(game, () => game.getVehicle(2).state === 'parked');
}));

test('a blocked container contact costs one heart and preserves its bump without a rescue', () => withConfig({}, () => {
  const game = new BusLoopGame(makeLevel());
  const attacker = game.getVehicle(2);
  Object.assign(attacker, { state: 'colliding', collision: {
    forwardDuration: 0.1, delay: 0.1, backwardDuration: 0.1, distance: 0,
    elapsed: 0, contactTriggered: false, targetId: null, targetContainerId: 20,
    hitDirection: null, forwardCurve: [{ time: 0, value: 0 }, { time: 1, value: 1 }],
    backwardCurve: [{ time: 0, value: 0 }, { time: 1, value: 1 }]
  } });
  game.update(0.1);
  assert.equal(game.lastEvent.type, 'vehicle-collision-contact');
  assert.equal(game.stamina.remaining, 2);
  assert.equal(game.isStaminaBusy(), false);
}));

test('the two switches independently control wrong-click cost and the existing parking rescue', () => {
  for (const collisionPenaltyEnabled of [0, 1]) for (const parkingRescueEnabled of [0, 1]) {
    withConfig({ collisionPenaltyEnabled, parkingRescueEnabled }, () => {
      const collision = new BusLoopGame(makeLevel());
      collision.clickVehicle(2);
      until(collision, () => collision.getVehicle(2).state === 'parked');
      assert.equal(collision.stamina.remaining, 3 - collisionPenaltyEnabled);
      assert.equal(collision.getVehicle(1).state, 'parked');
      assert.equal(collision.isStaminaBusy(), false);

      SCENE_TUNING.gameOver.failureDelaySeconds = 0.1;
      const parking = new BusLoopGame(makeLevel());
      makeStalled(parking);
      advance(parking, 0.3);
      assert.equal(parking.stamina.remaining, 3 - parkingRescueEnabled);
      assert.equal(parking.isStaminaBusy(), Boolean(parkingRescueEnabled));
      assert.equal(parking.status, parkingRescueEnabled ? 'playing' : 'lost');
      if (!parkingRescueEnabled) assert.equal(parking.lastEvent.reason, 'exceed-parking-spot');
    });
  }
});

test('wrong clicks have the same collision motion, contact event and return with stamina off or on', () => withConfig({}, () => {
  const enabled = new BusLoopGame(makeLevel());
  SCENE_TUNING.stamina.enabled = 0;
  const disabled = new BusLoopGame(makeLevel());
  SCENE_TUNING.stamina.enabled = 1;
  enabled.clickVehicle(2);
  disabled.clickVehicle(2);
  for (let frame = 0; frame < 150; frame++) {
    enabled.update(0.02);
    disabled.update(0.02);
    assert.equal(enabled.getVehicle(2).state, disabled.getVehicle(2).state);
    assert.equal(enabled.getVehicle(2).motion, disabled.getVehicle(2).motion);
    assert.deepEqual(enabled.getVehicle(1).hit, disabled.getVehicle(1).hit);
    assert.deepEqual(enabled.frameAudioEvents, disabled.frameAudioEvents);
  }
  assert.equal(enabled.stamina.remaining, 2);
  assert.equal(disabled.stamina.remaining, 3);
}));

test('switch edits take effect without restoring spent stamina and both behaviors share the pool', () => withConfig({ collisionPenaltyEnabled: 0, parkingRescueEnabled: 0 }, () => {
  const game = new BusLoopGame(makeLevel());
  game.clickVehicle(2);
  until(game, () => game.getVehicle(2).state === 'parked');
  assert.equal(game.stamina.remaining, 3);
  SCENE_TUNING.stamina.collisionPenaltyEnabled = 1;
  game.clickVehicle(2);
  until(game, () => game.getVehicle(2).state === 'parked');
  assert.equal(game.stamina.remaining, 2);
  SCENE_TUNING.stamina.parkingRescueEnabled = 1;
  SCENE_TUNING.gameOver.failureDelaySeconds = 0.1;
  makeStalled(game);
  until(game, () => game.isStaminaBusy());
  assert.equal(game.stamina.remaining, 1);
  until(game, () => !game.isStaminaBusy());
  assert.equal(game.spots[0].vehicleId, null);
  assert.equal(game.status, 'playing');
}));

test('the last wrong click finishes its return before exhaustion and overlapping contacts never go negative', () => withConfig({ lives: 1 }, () => {
  const game = new BusLoopGame(makeLevel());
  game.clickVehicle(2);
  const attacker = game.getVehicle(2);
  Object.assign(game.getVehicle(3), { state: 'colliding', collision: structuredClone(attacker.collision) });
  until(game, () => game.stamina.remaining === 0);
  assert.equal(game.status, 'playing');
  assert.equal(attacker.state, 'colliding');
  assert.equal(game.isStaminaBusy(), false);
  assert.equal(game.collisionContactEventId, 2);
  until(game, () => game.status === 'lost');
  assert.equal(attacker.state, 'parked');
  assert.equal(game.getVehicle(3).state, 'parked');
  assert.equal(game.lastEvent.reason, 'stamina-exhausted');
  advance(game, 2);
  assert.equal(game.stamina.remaining, 0);
  assert.equal(game.lastEvent.reason, 'stamina-exhausted');
}));

test('rescue extracts real matching passengers from belt, visible queue and source in order', () => withConfig({}, () => {
  const game = new BusLoopGame(makeLevel());
  game.initialFillActive = false;
  game.slots.forEach((slot) => { slot.colorIndex = null; });
  game.slots[0].colorIndex = 4;
  game.slots[1].colorIndex = 1;
  game.queues = [[{ id: 100, colorIndex: 1, distanceFromHead: 0 }, { id: 101, colorIndex: 4, distanceFromHead: 0.4 }]];
  game.sourceQueues = [[4, 1, 4, 1]];
  const before = game.getRemainingGroups();
  assert.equal(game.startStaminaRescue(game.getVehicle(1)), true);
  assert.equal(game.getVehicle(1).boardedGroups, 4);
  assert.equal(game.getRemainingGroups(), before - 4);
  assert.equal(game.countPendingPassengers(4), 0);
  assert.deepEqual(game.queues[0].map((item) => item.colorIndex), [1, 1, 1]);
  assert.equal(game.slots[1].colorIndex, 1);
  const events = game.boardingEvents;
  assert.equal(events.length, 4);
  assert.equal(events[0].slotIndex, 0);
  assert.equal(events[1].queueDistance, 0.4);
  assert.equal(events[2].queueIndex, 0);
  assert.equal(events.every((event) => event.targetPosition && event.rescue), true);
  assert.equal(game.startStaminaRescue(game.getVehicle(3)), false);
  assert.equal(game.stamina.remaining, 2);
}));

test('insufficient matching passengers never fabricate a full bus and still allow rescue departure', () => withConfig({}, () => {
  const game = new BusLoopGame(makeLevel());
  game.sourceQueues[0].push(4);
  game.startStaminaRescue(game.getVehicle(1));
  assert.equal(game.getVehicle(1).boardedGroups, 1);
  assert.equal(game.boardingEvents.length, 1);
  until(game, () => !game.isStaminaBusy());
  assert.equal(game.getVehicle(1).state, 'done');
  assert.equal(game.getVehicle(1).boardedGroups, 1);
}));

test('all visible queue lanes are consumed before hidden source passengers', () => withConfig({}, () => {
  const game = new BusLoopGame(makeLevel());
  game.getVehicle(1).seats = 1;
  game.queues = [[], [{ id: 101, colorIndex: 4, distanceFromHead: 0.8 }]];
  game.sourceQueues = [[4], []];
  game.startStaminaRescue(game.getVehicle(1));
  assert.equal(game.boardingEvents[0].queueIndex, 1);
  assert.equal(game.boardingEvents[0].queueDistance, 0.8);
  assert.equal(game.countPendingPassengers(4), 1);
}));

test('stalled parking rescues the first occupied bay only after the original delay', () => withConfig({}, () => {
  SCENE_TUNING.gameOver.failureDelaySeconds = 0.25;
  const game = new BusLoopGame(makeLevel());
  makeStalled(game);
  advance(game, 0.2);
  assert.equal(game.isStaminaBusy(), false);
  until(game, () => game.isStaminaBusy());
  const target = game.getVehicle(game.spots[0].vehicleId);
  assert.equal(target.id, 1);
  assert.equal(target.reviveFromStation, true);
  assert.equal(game.stamina.remaining, 2);
  until(game, () => target.state === 'revive-departing');
  assert.equal(game.spots[0].vehicleId, target.id, 'bay ownership lasts until complete departure');
  until(game, () => !game.isStaminaBusy());
  assert.equal(game.spots[0].vehicleId, null);
  assert.equal(game.status, 'playing');
}));

test('a cleared stall cancels the delay without spending a heart', () => withConfig({}, () => {
  SCENE_TUNING.gameOver.failureDelaySeconds = 0.25;
  const game = new BusLoopGame(makeLevel());
  makeStalled(game);
  game.update(0.1);
  game.slots[0].colorIndex = null;
  advance(game, 0.4);
  assert.equal(game.stamina.remaining, 3);
  assert.equal(game.isStaminaBusy(), false);
  assert.equal(game.failureConditionStartedAt, null);
}));

test('last heart completes its rescue before loss, even when that rescue clears the whole board', () => withConfig({ lives: 1 }, () => {
  const only = { id: 1, seats: 4, colorIndex: 4, x: 0, z: 0, yaw: 0, containerType: 1, containerId: 0 };
  const game = new BusLoopGame(makeLevel({ vehicles: [only], passengerQueues: [[4]] }));
  game.startStaminaRescue(game.getVehicle(1));
  assert.equal(game.stamina.remaining, 0);
  assert.equal(game.status, 'playing');
  until(game, () => game.getVehicle(1).state === 'revive-departing');
  assert.equal(game.status, 'playing');
  until(game, () => game.status === 'lost');
  assert.equal(game.getVehicle(1).state, 'done');
  assert.equal(game.isStaminaBusy(), false);
  assert.equal(game.lastEvent.reason, 'stamina-exhausted');
  advance(game, 1);
  assert.equal(game.lastEvent.reason, 'stamina-exhausted');
}));

test('existing terminal results prevent rescue or override a rescue already in progress', () => withConfig({}, () => {
  const game = new BusLoopGame(makeLevel());
  game.status = 'won';
  assert.equal(game.startStaminaRescue(game.getVehicle(1)), false);
  assert.equal(game.stamina.remaining, 3);
  game.reset();
  game.startStaminaRescue(game.getVehicle(1));
  game.failCountdown();
  advance(game, 10);
  assert.equal(game.status, 'lost');
  assert.equal(game.lastEvent.reason, 'challenge-timeout');
  assert.equal(game.getVehicle(1).state, 'revive-boarding');
}));

test('rescue never consumes other ambulances moves and deactivates a rescued ambulance', () => withConfig({}, () => {
  const level = makeLevel();
  level.vehicles[0].ambulanceStepLimit = 2;
  level.vehicles[2].ambulanceStepLimit = 2;
  const game = new BusLoopGame(level);
  game.startStaminaRescue(game.getVehicle(1));
  assert.equal(game.getVehicle(1).ambulanceActive, false);
  assert.equal(game.getVehicle(3).ambulanceRemainingSteps, 2);
  assert.equal(game.getVehicle(3).ambulanceActive, true);
}));

test('retry and stage construction restore each confirmed life count without leaking a pending rescue', () => {
  for (let lives = 1; lives <= 10; lives++) withConfig({ lives }, () => {
    const game = new BusLoopGame(makeLevel());
    game.startStaminaRescue(game.getVehicle(1));
    game.reset();
    assert.deepEqual(game.renderState().stamina, { enabled: true, lives, remaining: lives, busy: false });
    assert.equal(game.getVehicle(1).rescueDispatched, false);
    assert.equal(new BusLoopGame(makeLevel()).stamina.remaining, lives);
  });
});

test('complete rescue releases conveyor, garage, gate and elevator ownership and promotes the next floor', () => withConfig({}, () => {
  const game = new BusLoopGame(makeLevel());
  const target = game.getVehicle(1);
  const next = game.getVehicle(3);
  Object.assign(target, { conveyorId: 10, gateId: 12, gateIndex: 0, elevatorId: 13, elevatorLayer: 0 });
  Object.assign(next, { state: 'in-elevator', elevatorId: 13, elevatorLayer: 1, elevatorActive: false });
  game.mechanicState.conveyors.push({ id: 10, vehicleIds: [target.id], position: { x: 0, z: 0 }, hidden: false, yaw: 0, width: 3, extraWidth: 0, minGap: 0.1, speed: 1, vehicleWidth: 0.4, slotCount: 1 });
  game.mechanicState.garages.push({ id: 11, vehicleIds: [target.id], position: { x: 0, z: 0 }, exitingVehicleId: target.id, hidden: false });
  game.mechanicState.gateQueues.push({ id: 12, vehicleIds: [target.id], path: [{ x: 0, z: 0 }], gap: 0.1 });
  game.mechanicState.elevators.push({ id: 13, vehicleIds: [target.id, next.id], activeLayer: 0 });
  game.startStaminaRescue(target);
  const start = { x: target.x, z: target.z };
  game.update(0.1);
  assert.deepEqual({ x: target.x, z: target.z }, start, 'container motion cannot move a boarding rescue');
  until(game, () => !game.isStaminaBusy());
  for (const kind of ['conveyors', 'garages', 'gateQueues', 'elevators']) {
    assert.equal(game.mechanicState[kind][0].vehicleIds.includes(target.id), false);
  }
  assert.equal(next.state, 'parked');
  assert.equal(next.elevatorActive, true);
}));

test('scene boarding accepts a field rescue target and starts queued passengers on their queue curve', () => {
  const view = Object.create(SceneView.prototype);
  view.spotPositions = [];
  view.queueCurves = [new THREE.LineCurve3(new THREE.Vector3(20, 0, 0), new THREE.Vector3(20, 0, 10))];
  view.getQueueProgressAtDistance = () => 0.5;
  view.acquireBoardingVisual = () => new THREE.Group();
  view.setVatAnimation = () => {};
  view.layoutRoot = new THREE.Group();
  view.boardingViews = [];
  view.spawnBoardingGroup({ vehicleId: 1, colorIndex: 4, spotIndex: null, queueIndex: 0,
    queueDistance: 2, targetPosition: { x: 1, z: 1 }, startedAt: 0, duration: 0.65, rescue: true });
  assert.equal(view.boardingViews.length, LEVEL_1.groupSize);
  assert.ok(view.boardingViews.every((entry) => Math.abs(entry.start.x - 20) < 1));
  assert.ok(view.boardingViews.every((entry) => entry.duration === 0.65));
  assert.ok(view.boardingViews.every((entry) => Number.isFinite(entry.target.x) && entry.target.equals(view.boardingViews[0].target)));
});
