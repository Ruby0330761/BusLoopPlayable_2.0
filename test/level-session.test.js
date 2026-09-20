import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ACTIVE_LEVEL, PLAYABLE_LEVEL_SEQUENCE } from '../src/generated-active-level.js';
import { BusLoopGame } from '../src/game-model.js';
import {
  createLevelSession,
  shouldBlockGameplayForStore,
  shouldGameOverRetryOpenStore
} from '../src/level-session.js';

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

test('retry preserves the operation total while allowing current-level vehicle ids to count again', () => {
  const session = createLevelSession([{ key: 'levelA' }]);
  const vehicleExitConfig = {
    enabled: true,
    levelKey: 'levelA',
    vehicleIds: '2'
  };

  assert.equal(session.recordSuccessfulVehicle(1, 3), false);
  assert.equal(session.recordSuccessfulVehicle(2, 3), false);
  assert.equal(session.recordVehicleExit(2, vehicleExitConfig), true);
  assert.equal(session.state().successfulOperationCount, 2);

  assert.equal(session.restartCurrentLevel().key, 'levelA');
  assert.equal(session.hasCountedVehicle(1), false);
  assert.equal(session.isVehicleExitGateReady(vehicleExitConfig), true);

  assert.equal(session.recordSuccessfulVehicle(1, 3), true);
  assert.equal(session.state().successfulOperationCount, 3);
  assert.equal(session.state().installReady, true);
  assert.equal(session.recordSuccessfulVehicle(1, 3), false);
  assert.equal(session.state().successfulOperationCount, 3);

  const mainSource = readFileSync('src/main.js', 'utf8');
  assert.match(mainSource, /levelSession\.restartCurrentLevel\(\);\s*game\.reset\(\);/);
});

test('vehicle-exit install gate requires every configured id from the selected level', () => {
  const session = createLevelSession([
    { key: 'levelA' },
    { key: 'levelB' }
  ]);
  const config = {
    enabled: true,
    levelKey: 'levelA',
    vehicleIds: '2, 5，8 8 invalid'
  };

  assert.equal(session.recordVehicleExit(2, config), false);
  assert.equal(session.recordVehicleExit(5, config), false);
  assert.equal(session.recordVehicleExit(7, config), false);
  assert.equal(session.isVehicleExitGateReady(config), false);
  assert.equal(session.recordVehicleExit(8, config), true);
  assert.equal(session.isVehicleExitGateReady(config), true);

  session.advanceAfterWin();
  assert.equal(session.isVehicleExitGateReady(config), true);
  session.reset();
  assert.equal(session.isVehicleExitGateReady(config), false);
});

test('vehicle-exit install gate stays inactive when disabled or on another level', () => {
  const session = createLevelSession([{ key: 'levelA' }]);
  assert.equal(session.recordVehicleExit(3, {
    enabled: false,
    levelKey: 'levelA',
    vehicleIds: '3'
  }), false);
  assert.equal(session.recordVehicleExit(3, {
    enabled: true,
    levelKey: 'levelB',
    vehicleIds: '3'
  }), false);
});

test('game-over Retry follows default and special install-gate rules', () => {
  assert.equal(shouldGameOverRetryOpenStore(), true);
  assert.equal(shouldGameOverRetryOpenStore({ vehicleExitGateEnabled: true }), false);
  assert.equal(shouldGameOverRetryOpenStore({
    vehicleExitGateEnabled: true,
    operationGateReady: true
  }), true);
  assert.equal(shouldGameOverRetryOpenStore({
    vehicleExitGateEnabled: true,
    vehicleExitGateReady: true
  }), true);
});

test('store-ready gameplay unblocks only after a redirect when continuation is enabled', () => {
  assert.equal(shouldBlockGameplayForStore({ storeReady: false }), false);
  assert.equal(shouldBlockGameplayForStore({ storeReady: true }), true);
  assert.equal(shouldBlockGameplayForStore({
    storeReady: true,
    storeRedirectTriggered: true
  }), true);
  assert.equal(shouldBlockGameplayForStore({
    storeReady: true,
    storeRedirectTriggered: true,
    continueAfterStoreOpen: true
  }), false);
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
