import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { ACTIVE_LEVEL, PLAYABLE_LEVEL_SEQUENCE, PLAYABLE_STAGES } from '../src/generated-active-level.js';
import { BusLoopGame } from '../src/game-model.js';
import { LEVEL_CATALOG } from '../src/level-catalog.js';
import { createLevelSession } from '../src/level-session.js';
import { resolvePlayableSession } from '../src/playable-session-config.js';

// The Level9 -> Level7 handoff is a generator rule for the level9 selection;
// the currently generated production payload follows the selected level.
const HANDOFF_SEQUENCE = [LEVEL_CATALOG.level9, LEVEL_CATALOG.level7];
// Catalog entries are keyed by the LEVEL_CATALOG map, not by a `key` field;
// the runtime levels always carry one. Choice sessions are asserted on that
// field, so the fixtures add it the same way the generator/bundle does.
const withKey = (key) => ({ ...LEVEL_CATALOG[key], key });
const SESSION_CONFIG_PATH = new URL('../artifacts/playable-session.json', import.meta.url);

function readActiveSession() {
  if (!existsSync(SESSION_CONFIG_PATH)) return null;
  const config = JSON.parse(readFileSync(SESSION_CONFIG_PATH, 'utf8'));
  const key = process.env.PLAYABLE_SESSION_KEY ?? config.active ?? null;
  return key ? resolvePlayableSession(config, key) : null;
}

test('production session follows the selected level and keeps the Level9 to Level7 handoff wiring', () => {
  const session = readActiveSession();
  if (session) {
    assert.deepEqual(
      PLAYABLE_LEVEL_SEQUENCE.map((level) => level.key),
      session.stages.map((stage) => stage.levelKey)
    );
    assert.deepEqual(PLAYABLE_STAGES.map((stage) => stage.id), session.stages.map((stage) => stage.id));
    assert.equal(ACTIVE_LEVEL.key, session.stages[0].levelKey);
    const generatorSource = readFileSync(new URL('../scripts/generate-active-level.mjs', import.meta.url), 'utf8');
    assert.match(generatorSource, /resolvePlayableSession/);
    assert.match(generatorSource, /PLAYABLE_STAGES/);
    return;
  }
  const selectedLevel = readFileSync('artifacts/selected-level.txt', 'utf8').trim() || ACTIVE_LEVEL.key;
  assert.equal(ACTIVE_LEVEL.key, selectedLevel);
  const expectedKeys = selectedLevel === 'level9' ? ['level9', 'level7'] : [selectedLevel];
  assert.deepEqual(PLAYABLE_LEVEL_SEQUENCE.map((level) => level.key), expectedKeys);
  const catalogLevel = LEVEL_CATALOG[selectedLevel];
  if (catalogLevel) {
    assert.deepEqual(PLAYABLE_LEVEL_SEQUENCE.map((level) => level.vehicles.length), [catalogLevel.vehicles.length]);
    assert.deepEqual(
      PLAYABLE_LEVEL_SEQUENCE.map((level) => level.passengerQueues.map((queue) => queue.length)),
      [catalogLevel.passengerQueues.map((queue) => queue.length)]
    );
  }
  const generatorSource = readFileSync(new URL('../scripts/generate-active-level.mjs', import.meta.url), 'utf8');
  assert.match(generatorSource, /const sessionLevelKeys = selected === 'level9' \? \['level9', 'level7'\] : \[selected\];/);
});

test('successful-operation count survives the level handoff and namespaces repeated vehicle ids', () => {
  const session = createLevelSession(HANDOFF_SEQUENCE);
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
    installReady: true,
    levelCount: 2,
    choicePending: false
  });
  assert.equal(session.advanceAfterWin(), null);

  assert.equal(session.reset().key, 'level9');
  assert.deepEqual(session.state(), {
    levelIndex: 0,
    levelKey: 'level9',
    successfulOperationCount: 0,
    installReady: false,
    levelCount: 2,
    choicePending: false
  });
});

test('a stage with a map picker parks the session until one option is chosen', () => {
  const simple = withKey('level27');
  const options = [
    { id: 'fish', levelKey: 'level13', level: withKey('level13') },
    { id: 'matrix', levelKey: 'level5', level: withKey('level5') }
  ];
  const session = createLevelSession([simple], { choices: [options] });

  // Winning does not advance and does not end the ad: the picker is open.
  assert.equal(session.advanceAfterWin(), null);
  assert.equal(session.state().choicePending, true);
  assert.equal(session.state().levelKey, 'level27');
  assert.equal(session.shouldOpenStore(), false);

  // A pick appends that map as the final stage.
  assert.equal(session.choose('matrix').key, 'level5');
  assert.equal(session.state().choicePending, false);
  assert.equal(session.state().levelKey, 'level5');
  assert.equal(session.state().levelCount, 2);
  assert.equal(session.shouldOpenStore(), false);

  // Only finishing the picked map opens the store.
  assert.equal(session.recordSuccessfulVehicle(1, 1), true);
  assert.equal(session.shouldOpenStore(), true);
});

test('an unknown pick leaves the picker open instead of starting a broken stage', () => {
  const session = createLevelSession([withKey('level27')], {
    choices: [[{ id: 'fish', levelKey: 'level13', level: withKey('level13') }]]
  });
  session.advanceAfterWin();
  assert.equal(session.choose('nope'), null);
  assert.equal(session.state().choicePending, true);
  assert.equal(session.state().levelCount, 1);
  // A picker option without a baked level is refused the same way.
  assert.equal(session.choose('ghost'), null);
});

test('reset drops the picked map so a retry starts from the simple stage', () => {
  const session = createLevelSession([withKey('level27')], {
    choices: [[{ id: 'fish', levelKey: 'level13', level: withKey('level13') }]]
  });
  session.advanceAfterWin();
  session.choose('fish');
  assert.equal(session.state().levelCount, 2);

  assert.equal(session.reset().key, 'level27');
  assert.deepEqual(session.state(), {
    levelIndex: 0,
    levelKey: 'level27',
    successfulOperationCount: 0,
    installReady: false,
    levelCount: 1,
    choicePending: false
  });
  // The picker is available again on the next win.
  session.advanceAfterWin();
  assert.equal(session.state().choicePending, true);
});

test('an early CTA threshold does not block Level9 before the Level7 handoff', () => {
  const session = createLevelSession(HANDOFF_SEQUENCE);
  assert.equal(session.recordSuccessfulVehicle(1, 1), false);
  assert.equal(session.state().installReady, true);
  assert.equal(session.shouldOpenStore(), false);
  session.advanceAfterWin();
  assert.equal(session.shouldOpenStore(), true);
});

test('fresh Level7 queues restart passenger entry from both sides', () => {
  const level7 = LEVEL_CATALOG.level7;
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
  // A final-session win reports the solved challenge before the overlay, and the
  // overlay must not fall back to the failure branch of the challenge funnel.
  assert.match(mainSource, /platformBridge\?\.challengeSolved\?\.\(\);[\s\S]*?showResultOverlay\('You Win!', \{ failed: false \}\);/);
  assert.match(viewSource, /this\.layoutRoot\.add\(this\.loopPlane, this\.spatialConveyorRoot\)/);
  assert.match(viewSource, /this\.layoutRoot\.add\(this\.vehicleRoot\)/);
  assert.match(viewSource, /this\.vehicleRoot\.add\(view\)/);
  assert.match(viewSource, /startVehicleEntrance\(/);
  assert.match(viewSource, /this\.vehicleRoot\.position\.set\(0, 0, entrance\.startOffsetZ \* \(1 - eased\)\)/);
  assert.doesNotMatch(viewSource, /this\.layoutRoot\.scale\.setScalar/);
  assert.doesNotMatch(viewSource, /this\.layoutRoot\.position\.set/);
});
