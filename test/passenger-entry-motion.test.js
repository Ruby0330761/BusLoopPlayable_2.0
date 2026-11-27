import test from 'node:test';
import assert from 'node:assert/strict';
import { CatmullRomCurve3, LineCurve3, Vector3 } from 'three';
import { createPassengerEntryTurn, samplePassengerEntryTurn } from '../src/passenger-entry-motion.js';
import { SceneView } from '../src/scene-view.js';
import { SCENE_TUNING } from '../src/scene-tuning.js';
import { LEVEL_1 } from '../src/level-data.js';
import { BusLoopGame } from '../src/game-model.js';

function assertPoint(actual, expected, message = 'positions differ') {
  assert.ok(actual.distanceTo(expected) < 1e-7, message);
}

function fixture() {
  const view = Object.create(SceneView.prototype);
  const queue = new LineCurve3(new Vector3(), new Vector3(-4, 0, 0));
  view.curve = new LineCurve3(new Vector3(), new Vector3(0, 0, 10));
  view.queueCurves = [queue, new LineCurve3(new Vector3(0, 0, 5), new Vector3(4, 0, 5))];
  view.entryPercents = [0, 0.5];
  view.activeConveyorLayout = { conveyorCapacity: 10 };
  view.initialEntryPathStates = new Map();
  view.queueEntryPathStates = new Map();
  view.queueEntryTurns = view.queueCurves.map((queueCurve, index) => createPassengerEntryTurn({
    queueCurve, conveyorCurve: view.curve, entryPercent: view.entryPercents[index], distance: 1
  }));
  return view;
}

function slotFor(entryIndex = 0, progress = 0.03) {
  return {
    index: 0, progress,
    entryMotion: { entryIndex, passengerId: 99, fromQueueDistance: 0, startedAt: 0, initialFill: false }
  };
}

function sampleSlot(view, slot, time = 0, delta = 0, speed = 1) {
  return view.getInitialEntryPathVisual(
    slot,
    view.curve.getPointAt(slot.progress), view.curve.getTangentAt(slot.progress),
    time, delta, speed, 0
  );
}

test('left entry arc joins both roads with continuous positions and headings', () => {
  const view = fixture();
  const turn = view.queueEntryTurns[0];
  const start = samplePassengerEntryTurn(turn, 0);
  const end = samplePassengerEntryTurn(turn, turn.distance);
  assertPoint(start.position, view.queueCurves[0].getPointAt(0));
  assert.ok(start.tangent.dot(new Vector3(1, 0, 0)) > 0.9999);
  assertPoint(end.position, new Vector3(0, 0, 1));
  assert.ok(end.tangent.dot(new Vector3(0, 0, 1)) > 0.9999);
  let previous = start;
  for (let index = 1; index <= 480; index += 1) {
    const next = samplePassengerEntryTurn(turn, index / 480);
    assert.ok(next.position.distanceTo(previous.position) < 0.04, 'no positional jump');
    assert.ok(next.tangent.angleTo(previous.tangent) < 0.04, 'no sudden row rotation');
    assert.ok(next.position.x >= -1e-7 && next.position.z >= -1e-7, 'turn follows the forward approach');
    previous = next;
  }
});

for (const queueIndex of [0, 1]) {
test(`queue ${queueIndex} ownership handoff preserves the whole four-person row pose`, () => {
  const view = fixture();
  const curve = view.queueCurves[queueIndex];
  view.queueEntryPathStates.set(`${queueIndex}:99`, { distanceFromHead: 0.15 });
  const queued = view.getQueueEntryVisual(queueIndex, { id: 99, distanceFromHead: 0 },
    curve.getPointAt(0), curve.getTangentAt(0), 0, 1, 0);
  const entered = sampleSlot(view, slotFor(queueIndex, view.entryPercents[queueIndex]));
  assertPoint(entered.position, queued.position, 'handoff must retain the visible queue position');
  assertPoint(entered.tangent, queued.tangent.clone().negate(), 'handoff must retain the facing direction');
  // Every person inherits the row pose, so no inner/outer person can pop at handoff.
  for (let index = 0; index < 4; index += 1) {
    const offset = (index - 1.5) * 0.14;
    const beforeSide = new Vector3(-queued.tangent.z, 0, queued.tangent.x).multiplyScalar(offset);
    const afterSide = new Vector3(entered.tangent.z, 0, -entered.tangent.x).multiplyScalar(offset);
    assertPoint(queued.position.clone().add(beforeSide), entered.position.clone().add(afterSide));
  }
});
}

test('logical catch-up keeps rendering the left turn and finishes exactly on the conveyor', () => {
  const view = fixture();
  const slot = slotFor(0, 0.03);
  const halfway = sampleSlot(view, slot, 0.5, 0.5);
  assert.equal(halfway.snapped, true);
  assertPoint(halfway.position, samplePassengerEntryTurn(view.queueEntryTurns[0], 0.3).position);
  assert.ok(halfway.position.distanceTo(view.curve.getPointAt(slot.progress)) > 0.01);
  slot.progress = 0.1;
  const completed = sampleSlot(view, slot, 1, 0.1);
  assertPoint(completed.position, view.curve.getPointAt(0.1));
  assertPoint(completed.tangent, view.curve.getTangentAt(0.1));
  assert.equal(view.initialEntryPathStates.values().next().value.turnComplete, true);
  slot.progress = 0.01;
  assertPoint(sampleSlot(view, slot, 20, 0.1).position, view.curve.getPointAt(0.01),
    'a completed row must not re-enter the turn on its next lap');
});

test('right entry rounds its own junction and keeps the forward conveyor direction', () => {
  const view = fixture();
  const slot = slotFor(1, 0.53);
  const right = sampleSlot(view, slot, 0.5, 0.5);
  const turn = view.queueEntryTurns[1];
  assertPoint(right.position, samplePassengerEntryTurn(turn, 0.3).position);
  assert.ok(right.position.distanceTo(view.curve.getPointAt(slot.progress)) > 0.01);
  assert.ok(samplePassengerEntryTurn(turn, 0).tangent.dot(new Vector3(-1, 0, 0)) > 0.9999);
  slot.progress = 0.6;
  const joined = sampleSlot(view, slot, 1, 0.5);
  assertPoint(joined.position, view.curve.getPointAt(0.6));
  assertPoint(joined.tangent, new Vector3(0, 0, 1));
  slot.progress = 0.51;
  assertPoint(sampleSlot(view, slot, 20, 0.1).position, view.curve.getPointAt(0.51),
    'a completed right row must not replay its turn on the next lap');
});

test('direct entrances bypass queued entry animation', () => {
  const view = fixture();
  view.activeConveyorLayout.directEntrance = true;
  const direct = sampleSlot(view, slotFor(0));
  assertPoint(direct.position, view.curve.getPointAt(0.03));
});

for (const queueIndex of [0, 1]) {
test(`queue ${queueIndex} reports walking while advancing and idle while waiting`, () => {
  const view = fixture();
  const curve = view.queueCurves[queueIndex];
  const target = curve.getPointAt(0.3 / curve.getLength());
  const tangent = curve.getTangentAt(0);
  const item = { id: 99, distanceFromHead: 0.3 };
  view.queueEntryPathStates.set(`${queueIndex}:99`, { distanceFromHead: 0.5 });
  const walking = view.getQueueEntryVisual(queueIndex, item, target, tangent, 0.05, 1, 0);
  assert.equal(walking.moving, true);
  view.queueEntryPathStates.set(`${queueIndex}:99`, { distanceFromHead: 0.3 });
  const waiting = view.getQueueEntryVisual(queueIndex, item, target, tangent, 0.05, 1, 0);
  assert.equal(waiting.moving, false);
});
}

test('both queues follow the passing-slot speed and use passenger speed for initial filling', () => {
  const view = fixture();
  assert.equal(view.getQueueAdvanceSpeed(0, { initialFillActive: false }), LEVEL_1.conveyorSpeed);
  assert.equal(view.getQueueAdvanceSpeed(0, { initialFillActive: true }), LEVEL_1.passengerEntryMotion.passengerSpeed);
  assert.equal(view.getQueueAdvanceSpeed(1, { initialFillActive: false }), LEVEL_1.conveyorSpeed);
  assert.equal(view.getQueueAdvanceSpeed(1, { initialFillActive: true }), LEVEL_1.passengerEntryMotion.passengerSpeed);
});

test('queue and entry rendering use the same combined passenger multiplier as the simulation', () => {
  const previous = SCENE_TUNING.conveyorLayout.passengerSpeedMultiplier;
  try {
    const sample = factor => {
      SCENE_TUNING.conveyorLayout.passengerSpeedMultiplier = factor;
      const game = new BusLoopGame(LEVEL_1);
      game.setSpeedMultiplier(2);
      const snapshot = game.snapshot();
      const view = fixture();
      const slot = slotFor(0, 0.08);
      sampleSlot(view, slot, 0.01, 0.01, snapshot.passengerSpeedMultiplier);
      const entryDistance = view.initialEntryPathStates.get(view.getInitialEntryPathKey(slot)).distance;
      view.queueEntryPathStates.set('0:100', { distanceFromHead: 1, advancing: true });
      view.getQueueEntryVisual(0, { id: 100, distanceFromHead: 0 }, new Vector3(), new Vector3(-1, 0, 0),
        0.01, snapshot.passengerSpeedMultiplier, 0, view.getQueueAdvanceSpeed(0, snapshot), 0);
      return { entryDistance, queueDistance: 1 - view.queueEntryPathStates.get('0:100').distanceFromHead };
    };
    const base = sample(1);
    const fast = sample(2.2);
    assert.ok(Math.abs(fast.entryDistance / base.entryDistance - 2.2) < 1e-9);
    assert.ok(Math.abs(fast.queueDistance / base.queueDistance - 2.2) < 1e-9);
  } finally {
    SCENE_TUNING.conveyorLayout.passengerSpeedMultiplier = previous;
  }
});

for (const queueIndex of [0, 1]) {
test(`consecutive real vacancies keep queue ${queueIndex} advancing every frame through handoff`, () => {
  for (const fps of [30, 60, 120]) {
    for (const multiplier of [1, 2, 3]) {
      for (const initialFill of [true, false]) {
        const view = fixture();
        view.entryPercents = [0, 0.5];
        const game = new BusLoopGame(LEVEL_1);
        game.initializeQueues([5, 5], 1, [4, 4], 10, {
          capacity: 10, queueCapacities: [5, 5], entryPercents: view.entryPercents,
          exitStart: 0.6, exitEnd: 0.8, resetSlots: true
        });
        game.initialFillActive = initialFill;
        game.setSpeedMultiplier(multiplier);
        for (const slot of game.slots) {
          slot.colorIndex = 0;
          slot.entryMotion = null;
        }
        for (let index = 0; index < 4; index += 1) {
          Object.assign(game.slots[index], {
            colorIndex: null, progress: (view.entryPercents[queueIndex] + 0.99 - index * 0.1) % 1
          });
        }
        const trackedId = game.queues[queueIndex][3].id;
        const queueCurve = view.queueCurves[queueIndex];
        let previous = null;
        let started = false;
        let handedOff = false;
        const renderQueue = delta => {
          for (const [index, item] of game.queues[queueIndex].entries()) {
            const target = queueCurve.getPointAt(item.distanceFromHead / queueCurve.getLength());
            const visual = view.getQueueEntryVisual(queueIndex, item, target, queueCurve.getTangentAt(0),
              delta, multiplier, 0, view.getQueueAdvanceSpeed(queueIndex, game), index * game.queueSpacing);
            if (item.id !== trackedId) continue;
            if (previous) {
              const distance = visual.position.distanceTo(previous);
              if (distance > 1e-7) started = true;
              if (started && delta > 0) {
                assert.ok(distance > 1e-7, `${fps} fps x${multiplier}: no stationary frame inside a refill at ${game.time}, logical ${item.distanceFromHead}, visual ${-visual.position.x}`);
                assert.ok((visual.position.x - previous.x) * (queueIndex === 0 ? 1 : -1) > 0,
                  'always advance toward the entrance');
                assert.equal(visual.moving, true);
              }
            }
            previous = visual.position.clone();
          }
        };
        renderQueue(0);
        for (let frame = 0; frame < fps * 20 && !handedOff; frame += 1) {
          game.update(1 / fps);
          const entered = game.slots.find(slot => slot.entryMotion?.passengerId === trackedId);
          if (entered) {
            const visual = sampleSlot(view, entered, game.time, 0, multiplier);
            assertPoint(visual.position, previous, 'handoff retains the last moving queue pose');
            game.update(1 / fps);
            const next = sampleSlot(view, entered, game.time, 1 / fps, multiplier);
            assert.ok(next.position.distanceTo(visual.position) > 1e-7, 'entering row keeps advancing');
            handedOff = true;
          } else {
            renderQueue(1 / fps);
          }
        }
        assert.equal(handedOff, true, `${fps} fps x${multiplier}: tracked row must enter`);
      }
    }
  }
});
}

test('left replacement reaches the final waiting position without an early snap and waits idle for the next group', () => {
  const view = fixture();
  const item = { id: 101, distanceFromHead: 0 };
  view.queueEntryPathStates.set('0:101', { distanceFromHead: 0.03 });
  const speed = view.getQueueAdvanceSpeed(0, { initialFillActive: false });
  let previous = new Vector3(-0.03, 0, 0);
  for (let frame = 0; frame < 3; frame += 1) {
    const visual = view.getQueueEntryVisual(0, item, new Vector3(), new Vector3(-1, 0, 0),
      0.01, 1, 0, speed);
    assert.ok(Math.abs(visual.position.distanceTo(previous) - speed * 0.01) < 1e-8);
    previous = visual.position;
  }
  view.getQueueEntryVisual(0, item, new Vector3(), new Vector3(-1, 0, 0), 1, 1, 0, speed);
  for (let frame = 0; frame < 60; frame += 1) {
    const visual = view.getQueueEntryVisual(0, item, new Vector3(), new Vector3(-1, 0, 0), 1 / 60, 1, 0, speed);
    assertPoint(visual.position, new Vector3());
    assert.equal(visual.moving, false, 'wait standing even while another row might still be turning');
  }
});

for (const queueIndex of [0, 1]) {
test(`initial queue ${queueIndex} front row stays at its original waiting point until dequeued`, () => {
  const view = fixture();
  const item = { id: 99, distanceFromHead: 0 };
  const target = view.queueCurves[queueIndex].getPointAt(0);
  const tangent = view.queueCurves[queueIndex].getTangentAt(0);
  for (let frame = 0; frame < 120; frame += 1) {
    const visual = view.getQueueEntryVisual(queueIndex, item, target, tangent, 1 / 60, 1, 0);
    assertPoint(visual.position, target, 'waiting must not shift the row into the turn');
    assertPoint(visual.tangent, tangent, 'waiting must not pre-rotate the row');
    assert.equal(visual.moving, false);
    assert.equal(view.initialEntryPathStates.size, 0);
  }
  const slot = slotFor(queueIndex, view.entryPercents[queueIndex]);
  const firstEntryFrame = sampleSlot(view, slot);
  assertPoint(firstEntryFrame.position, target, 'the called-in row must start at its waiting position');
  assert.ok(firstEntryFrame.tangent.dot(tangent.clone().negate()) > 0.9999);
  slot.progress += 0.03;
  const entering = sampleSlot(view, slot, 0.1, 0.1);
  assert.ok(entering.position.distanceTo(target) > 0.01, 'movement begins after the row is called in');
});
}

test('replacement left front row advances to the original head point then waits there', () => {
  const view = fixture();
  const item = { id: 100, distanceFromHead: 0.5 };
  let visual = view.getQueueEntryVisual(0, item, new Vector3(-0.5, 0, 0),
    new Vector3(-1, 0, 0), 1 / 60, 1, 0);
  assertPoint(visual.position, new Vector3(-0.5, 0, 0), 'no extra spawn movement for an existing row');
  for (let frame = 1; frame <= 30; frame += 1) {
    item.distanceFromHead = Math.max(0, 0.5 - frame * 0.02);
    const target = new Vector3(-item.distanceFromHead, 0, 0);
    visual = view.getQueueEntryVisual(0, item, target, new Vector3(-1, 0, 0), 1 / 60, 1, 0);
    assert.ok(visual.position.x >= -0.5 && visual.position.x <= target.x + 1e-7,
      'replacement advances on the original queue path without overtaking the target');
    assert.ok(Math.abs(visual.position.z) < 1e-7);
    assertPoint(visual.tangent, new Vector3(-1, 0, 0));
  }
  for (let frame = 0; frame < 120; frame += 1) {
    visual = view.getQueueEntryVisual(0, item, new Vector3(), new Vector3(-1, 0, 0), 1 / 60, 1, 0);
    assertPoint(visual.position, new Vector3());
    assertPoint(visual.tangent, new Vector3(-1, 0, 0));
    assert.equal(visual.moving, false);
  }
});

test('right replacement finishes its last queue segment and stands immediately at the waiting point', () => {
  const view = fixture();
  const curve = view.queueCurves[1];
  const item = { id: 101, distanceFromHead: 0 };
  const target = curve.getPointAt(0);
  const tangent = curve.getTangentAt(0);
  const speed = view.getQueueAdvanceSpeed(1, { initialFillActive: false });
  view.queueEntryPathStates.set('1:101', { distanceFromHead: 0.03, advancing: true });
  let previous = curve.getPointAt(0.03 / curve.getLength());
  for (let frame = 0; frame < 3; frame++) {
    const visual = view.getQueueEntryVisual(1, item, target, tangent, 0.01, 1, 0, speed, 0);
    assert.ok(Math.abs(visual.position.distanceTo(previous) - speed * 0.01) < 1e-8,
      'do not snap over the final segment or stop before the waiting point');
    assert.equal(visual.moving, true);
    previous = visual.position;
  }
  view.getQueueEntryVisual(1, item, target, tangent, 1, 1, 0, speed, 0);
  for (let frame = 0; frame < 120; frame++) {
    const visual = view.getQueueEntryVisual(1, item, target, tangent, 1 / 60, 1, 0, speed, 0);
    assertPoint(visual.position, target);
    assert.equal(visual.moving, false, 'stand while waiting for the next gap');
  }
});

for (const queueIndex of [0, 1]) {
test(`queue ${queueIndex} does not restart its one-frame reserve between consecutive vacancies`, () => {
  const view = fixture(), curve = view.queueCurves[queueIndex];
  const key = `${queueIndex}:105`;
  view.queueEntryPathStates.set(key, { distanceFromHead: 0.3, advancing: true });
  let previous = curve.getPointAt(0.3 / curve.getLength());
  for (const targetDistance of [0.2, 0.1, 0]) {
    const visual = view.getQueueEntryVisual(queueIndex, { id: 105, distanceFromHead: targetDistance },
      curve.getPointAt(targetDistance / curve.getLength()), curve.getTangentAt(0), 0.1, 1, 0, 1, targetDistance);
    assert.ok(Math.abs(visual.position.distanceTo(previous) - 0.1) < 1e-8,
      'keep moving even when a frame exactly reached the previous row position');
    assert.equal(visual.moving, true);
    previous = visual.position;
  }
  const idle = view.getQueueEntryVisual(queueIndex, { id: 105, distanceFromHead: 0 },
    curve.getPointAt(0), curve.getTangentAt(0), 0.1, 1, 0, 1, 0);
  assert.equal(idle.moving, false, 'the reserve fix must not leave a waiting row running');
});
}

test('camera and path rebuilds create a matching turn for each actual queue entrance', () => {
  const view = fixture();
  view.fullQueueCurves = view.queueCurves;
  view.makeVisibleQueueCurve = curve => curve;
  view.getConveyorSlotSpacing = () => 2 / 3;
  view.updateQueueCurvesForCamera();
  assert.equal(view.queueEntryTurns.length, 2);
  for (const [index, turn] of view.queueEntryTurns.entries()) {
    assertPoint(samplePassengerEntryTurn(turn, 0).position, view.queueCurves[index].getPointAt(0));
    assertPoint(samplePassengerEntryTurn(turn, turn.distance).position,
      view.curve.getPointAt(view.entryPercents[index] + 0.1));
  }
});
