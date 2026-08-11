import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ACTIVE_LEVEL, PLAYABLE_LEVEL_SEQUENCE } from '../src/generated-active-level.js';
import { BusLoopGame } from '../src/game-model.js';
import { createLevelSession } from '../src/level-session.js';

test('production session starts on Level9 and follows with Level7', () => {
  assert.equal(ACTIVE_LEVEL.key, 'level9');
  assert.deepEqual(PLAYABLE_LEVEL_SEQUENCE.map((level) => level.key), ['level9', 'level7']);
  assert.deepEqual(PLAYABLE_LEVEL_SEQUENCE.map((level) => level.vehicles.length), [37, 83]);
  assert.deepEqual(
    PLAYABLE_LEVEL_SEQUENCE.map((level) => level.passengerQueues.map((queue) => queue.length)),
    [[131, 131], [368, 278]]
  );
});

test('successful-operation count survives the level handoff and namespaces repeated vehicle ids', () => {
  const session = createLevelSession(PLAYABLE_LEVEL_SEQUENCE);
  assert.equal(session.currentLevel().key, 'level9');
  assert.equal(session.recordSuccessfulVehicle(1, 3), false);
  assert.equal(session.recordSuccessfulVehicle(1, 3), false);
  assert.equal(session.state().successfulOperationCount, 1);

  assert.equal(session.advanceAfterWin().key, 'level7');
  assert.equal(session.recordSuccessfulVehicle(1, 3), false);
  assert.equal(session.recordSuccessfulVehicle(2, 3), true);
  assert.deepEqual(session.state(), {
    levelIndex: 1,
    levelKey: 'level7',
    successfulOperationCount: 3,
    installReady: true
  });
  assert.equal(session.advanceAfterWin(), null);

  assert.equal(session.reset().key, 'level9');
  assert.deepEqual(session.state(), {
    levelIndex: 0,
    levelKey: 'level9',
    successfulOperationCount: 0,
    installReady: false
  });
});

test('an early CTA threshold does not block Level9 before the Level7 handoff', () => {
  const session = createLevelSession(PLAYABLE_LEVEL_SEQUENCE);
  assert.equal(session.recordSuccessfulVehicle(1, 1), false);
  assert.equal(session.state().installReady, true);
  assert.equal(session.shouldOpenStore(), false);
  session.advanceAfterWin();
  assert.equal(session.shouldOpenStore(), true);
});

test('fresh Level7 queues restart passenger entry from both sides', () => {
  const level7 = PLAYABLE_LEVEL_SEQUENCE[1];
  const game = new BusLoopGame(level7);
  game.initializeQueues(
    [level7.queueCapacity, level7.queueCapacity],
    level7.passengerQueue.spacing,
    [level7.conveyorPathLength, level7.conveyorPathLength],
    level7.conveyorPathLength,
    {
      capacity: level7.conveyorCapacity,
      queueCapacities: [level7.queueCapacity, level7.queueCapacity],
      entryPercents: level7.entryPercents,
      exitStart: level7.exitStart,
      exitEnd: level7.exitEnd,
      resetSlots: true
    }
  );
  for (let index = 0; index < 20; index += 1) game.update(0.05);
  const entryIndices = new Set(
    game.snapshot().slots
      .filter((slot) => slot.entryMotion?.initialFill)
      .map((slot) => slot.entryMotion.entryIndex)
  );
  assert.deepEqual([...entryIndices].sort(), [0, 1]);
});

test('runtime keeps the conveyor fixed and moves only Level7 vehicles in from below', () => {
  const mainSource = readFileSync('src/main.js', 'utf8');
  const viewSource = readFileSync('src/scene-view.js', 'utf8');
  assert.match(mainSource, /levelSession\.advanceAfterWin\(\)/);
  assert.match(mainSource, /view\.replaceActiveLevel\(\{ animate: true \}\)/);
  assert.match(mainSource, /initializeGameQueues\(\{ resetSlots: true \}\)/);
  assert.match(mainSource, /^\s*showResultOverlay\('You Win!'\);/m);
  assert.match(viewSource, /this\.layoutRoot\.add\(this\.loopPlane\)/);
  assert.match(viewSource, /this\.layoutRoot\.add\(this\.vehicleRoot\)/);
  assert.match(viewSource, /this\.vehicleRoot\.add\(view\)/);
  assert.match(viewSource, /startVehicleEntrance\(/);
  assert.match(viewSource, /this\.vehicleRoot\.position\.set\(0, 0, entrance\.startOffsetZ \* \(1 - eased\)\)/);
  assert.doesNotMatch(viewSource, /this\.layoutRoot\.scale\.setScalar/);
  assert.doesNotMatch(viewSource, /this\.layoutRoot\.position\.set/);
});
