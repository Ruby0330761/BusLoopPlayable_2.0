import test from 'node:test';
import assert from 'node:assert/strict';
import { Box3, BoxGeometry, Group, Mesh, Object3D, Vector3 } from 'three';
import { BusLoopGame } from '../src/game-model.js';
import { SceneView } from '../src/scene-view.js';
import { LEVEL_1 } from '../src/level-data.js';
import { SCENE_TUNING } from '../src/scene-tuning.js';
import { BOARDING_CONTACT_HIDE_FRAMES, getBoardingContactProgress, getBoardingPassengerOrder, getBoardingRowTiming } from '../src/passenger-boarding-motion.js';

function lateCarFixture(wrapped = false) {
  const game = new BusLoopGame();
  game.initialFillActive = false;
  game.conveyorPathLength = 100;
  game.queues = game.queues.map(() => []);
  game.sourceQueues = game.sourceQueues.map(() => []);
  game.exitStart = wrapped ? 0.92 : 0.6;
  game.exitEnd = wrapped ? 0.08 : 0.8;
  for (const slot of game.slots) Object.assign(slot, { colorIndex: null, entryMotion: null });
  // Deliberately different from both slot-index order and array order.
  const progress = wrapped ? [0.94, 0.07, 0.98, 0.03] : [0.62, 0.79, 0.7, 0.75];
  progress.forEach((value, index) => Object.assign(game.slots[index], { progress: value, colorIndex: 0 }));
  const vehicle = game.vehicles[0];
  Object.assign(vehicle, { state: 'at-spot', spotIndex: 0, colorIndex: 0, seats: 10, boardedGroups: 0,
    isHidden: false, hiddenReveal: null });
  game.spots[0].vehicleId = vehicle.id;
  return { game, vehicle };
}

function viewFixture(targetX = 2) {
  const view = Object.create(SceneView.prototype);
  view.personTemplate = {};
  view.layoutRoot = new Group();
  view.spotPositions = [new Vector3(targetX, 0, 3)];
  view.boardingViews = [];
  view.pendingBoardingSounds = [];
  view.vehicleViews = new Map();
  view.vehicleBoardingPulses = new Map();
  view.hooks = {};
  view.sampleActiveCurve = (progress, point, tangent) => {
    point.set(0, 0, progress);
    tangent.set(0, 0, 1);
  };
  view.acquireBoardingVisual = () => {
    const root = new Object3D();
    root.userData.vatMaterial = {};
    return root;
  };
  view.setVatAnimation = (material, clip) => { material.clipName = clip; };
  view.releaseBoardingVisual = () => {};
  return view;
}

test('the third passenger determines the next row release, with safe legacy defaults', () => {
  assert.deepEqual(getBoardingRowTiming(), { passengerInterval: 0.05, rowInterval: 0.1 });
  assert.deepEqual(getBoardingRowTiming({ aboardInterval: 0.12 }, 4), {
    passengerInterval: 0.12, rowInterval: 0.24
  });
  for (const value of [0, -1, NaN, Infinity]) {
    assert.equal(getBoardingRowTiming({ aboardInterval: value }).rowInterval, 0.1);
  }
  assert.equal(getBoardingRowTiming({}, 1).rowInterval, 0.05);
  assert.equal(getBoardingRowTiming({}, 2).rowInterval, 0.05);
});

for (const fps of [30, 60, 120]) {
  for (const wrapped of [false, true]) {
    test(`late car releases rows in travel order at ${fps} FPS${wrapped ? ' across the loop seam' : ''}`, () => {
      const { game, vehicle } = lateCarFixture(wrapped);
      const initialProgress = game.slots[0].progress;
      game.update(1 / fps);
      assert.equal(game.boardingEvents.length, 1, 'rows must not all start in the arrival frame');
      assert.equal(vehicle.boardedGroups, 1);
      assert.equal(game.slots[0].colorIndex, 0, 'waiting rows stay on the belt');
      assert.ok(game.slots[0].progress > initialProgress, 'waiting rows continue moving');
      for (let i = 0; i < fps; i += 1) game.update(1 / fps);
      const events = game.boardingEvents;
      assert.deepEqual(events.map(event => event.slotIndex), [1, 3, 2, 0]);
      assert.equal(vehicle.boardedGroups, 4);
      for (let index = 1; index < events.length; index += 1) {
        const thirdStartsAt = events[index - 1].startedAt + events[index - 1].passengerInterval * 2;
        assert.ok(events[index].startedAt >= thirdStartsAt - 1e-9);
        assert.ok(events[index].startedAt < thirdStartsAt + 1 / fps + 1e-9);
      }
    });
  }
}

test('the shared exit also staggers rows going to different same-color cars', () => {
  const { game, vehicle } = lateCarFixture();
  vehicle.seats = 1;
  const other = game.vehicles[1];
  Object.assign(other, { state: 'at-spot', spotIndex: 1, colorIndex: 0, seats: 10, boardedGroups: 0,
    isHidden: false, hiddenReveal: null });
  game.spots[1].vehicleId = other.id;
  game.update(0.01);
  assert.equal(vehicle.state, 'boarding-final');
  assert.equal(other.boardedGroups, 0);
  game.update(0.05);
  assert.equal(other.boardedGroups, 0);
  game.update(0.05);
  assert.equal(other.boardedGroups, 1);
});

test('unmatched front rows do not block an eligible row, and reset clears the release gate', () => {
  const { game } = lateCarFixture();
  game.slots[1].colorIndex = 9;
  game.update(0.01);
  assert.equal(game.boardingEvents[0].slotIndex, 3);
  assert.equal(game.slots[1].colorIndex, 9);
  game.reset();
  assert.equal(game.nextBoardingRowAt, 0);
  assert.equal(game.boardingEvents.length, 0);
});

test('world-space ordering always leaves from the vehicle-facing edge, including a mirrored row', () => {
  const starts = [-0.3, -0.1, 0.1, 0.3].map(x => new Vector3(x, 0, 0));
  assert.deepEqual(getBoardingPassengerOrder(starts, new Vector3(2, 0, 3)), [3, 2, 1, 0]);
  assert.deepEqual(getBoardingPassengerOrder(starts, new Vector3(-2, 0, 3)), [0, 1, 2, 3]);
  const rotation = Math.PI * 0.63;
  const up = new Vector3(0, 1, 0);
  const rotated = starts.map(point => point.clone().applyAxisAngle(up, rotation));
  const target = new Vector3(2, 0, 3).applyAxisAngle(up, rotation);
  assert.deepEqual(getBoardingPassengerOrder(rotated, target), [3, 2, 1, 0]);
});

test('visuals wait in idle, then each individual turns and runs at its assigned time', () => {
  const view = viewFixture();
  view.spawnBoardingGroup({ vehicleId: 1, spotIndex: 0, colorIndex: 0, progress: 0.6,
    startedAt: 5, passengerInterval: 0.08 });
  const entries = view.boardingViews;
  assert.equal(entries.length, LEVEL_1.groupSize);
  assert.deepEqual(entries.map(entry => entry.delay), [0, 0.08, 0.16, 0.24]);
  const positions = entries.map(entry => entry.start.clone());
  view.updateBoardingViews(5.1);
  assert.deepEqual(entries.map(entry => entry.moving), [true, true, false, false]);
  assert.ok(entries[0].root.position.distanceTo(positions[0]) > 0);
  assert.ok(entries[1].root.position.distanceTo(positions[1]) > 0);
  assert.equal(entries[2].root.position.distanceTo(positions[2]), 0);
  assert.equal(entries[2].material.clipName, 'idle');
  view.updateBoardingViews(5.16);
  assert.equal(entries[2].moving, true, 'third starts on the release boundary, including float rounding');
  assert.equal(entries[2].material.clipName, 'move');
  assert.equal(entries[3].moving, false);
});

test('a tuning change cannot desynchronize the current row from the model release time', () => {
  const previous = SCENE_TUNING.passengers.aboardInterval;
  try {
    const { game } = lateCarFixture();
    SCENE_TUNING.passengers.aboardInterval = 0.12;
    game.update(0.01);
    const event = game.boardingEvents[0];
    SCENE_TUNING.passengers.aboardInterval = 0.01;
    const view = viewFixture();
    view.spawnBoardingGroup(event);
    assert.equal(view.boardingViews[2].delay, 0.24);
    assert.equal(game.nextBoardingRowAt, event.startedAt + view.boardingViews[2].delay);
  } finally {
    SCENE_TUNING.passengers.aboardInterval = previous;
  }
});

test('boarding keeps a steady pace instead of piling up while easing into the car', () => {
  const view = viewFixture();
  view.spawnBoardingGroup({ vehicleId: 1, spotIndex: 0, colorIndex: 0, progress: 0.6,
    startedAt: 0, passengerInterval: 0.05 });
  const entry = view.boardingViews[0];
  const car=new Group(),body=new Mesh(new BoxGeometry(1,1,1));
  car.add(body);car.position.copy(entry.target);car.userData.bodyMeshes=[body];view.vehicleViews.set(1,car);
  view.updateBoardingViews(entry.duration * 0.25);
  const quarter = entry.root.position.clone();
  view.updateBoardingViews(entry.duration * 0.5);
  const half = entry.root.position.clone();
  const quarterDistance = quarter.distanceTo(entry.start);
  assert.ok(Math.abs(half.distanceTo(quarter) - quarterDistance) < 1e-9);
  assert.ok(Math.abs(half.distanceTo(entry.target) - entry.start.distanceTo(entry.target) * 0.5) < 1e-9);
  view.updateBoardingViews(10);
  assert.equal(view.boardingViews.length,LEVEL_1.groupSize,'centre arrival is not a completion signal');
  assert.equal(view.vehicleBoardingPulses.size, 0);
  view.updateBoardingViews(10+1/60);view.updateBoardingViews(10+2/60);view.updateBoardingViews(10+3/60);
  assert.equal(view.boardingViews.length, 0);
  assert.equal(view.layoutRoot.children.length, 0);
  const end = 10 + 3 / 60;
  assert.deepEqual(view.vehicleBoardingPulses.get(1), [end]);
  assert.equal(view.getVehicleBoardingPulseScale(1, end + 0.5 / 11.7), 1.09);
  view.triggerVehicleBoardingPulse(1, end + 0.04);
  assert.ok(view.getVehicleBoardingPulseScale(1, end + 0.06) <= 1.09);
  assert.equal(view.getVehicleBoardingPulseScale(1, end + 0.2), 1);
  assert.equal(view.vehicleBoardingPulses.size, 0);
});
