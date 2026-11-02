import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { LEVEL_CATALOG } from '../src/level-catalog.js';
import { BusLoopGame } from '../src/game-model.js';
import { setActiveLevel } from '../src/level-data.js';
import {
  levelDocumentToRuntime,
  validateLevelDocument
} from '../src/level-editor-model.js';
import {
  MECHANISM_TYPES,
  deriveLevelMechanics
} from '../src/mechanism-resources.js';
import { resolvePlayableSession, PLAYABLE_SESSION_FORMAT } from '../src/playable-session-config.js';
import {
  SUPPORTED_PLATFORMS,
  buildPlayableArtifactName
} from '../scripts/export-playable-package.mjs';

const LEVEL_PATH = new URL('../artifacts/web-levels/level2602.json', import.meta.url);
const SESSION_PATH = new URL('../artifacts/playable-session.json', import.meta.url);

function readLevel() {
  return JSON.parse(readFileSync(LEVEL_PATH, 'utf8'));
}

function readSession(key) {
  const config = JSON.parse(readFileSync(SESSION_PATH, 'utf8'));
  assert.equal(config.format, PLAYABLE_SESSION_FORMAT);
  return { config, session: resolvePlayableSession(config, key) };
}

function createRuntime(document) {
  return levelDocumentToRuntime(document, LEVEL_CATALOG.level5);
}

test('Q159 centre-rescue board keeps the diagonal sled inside its ring', () => {
  const document = readLevel();
  const sled = document.vehicles.find((vehicle) => vehicle.colorIndex === 16);
  assert.ok(sled, 'the board must contain the Christmas sled');

  // The reference shot places the rescue vehicle diagonally in the middle of
  // the ring; squaring it up or opening a lane would erase the mechanic.
  assert.equal(sled.seats, 10, 'the sled is authored at the 10-seat footprint');
  assert.equal(sled.mechanism.type, 'christmas');
  assert.equal(sled.mechanism.stepLimited, true);
  assert.equal(sled.mechanism.stepLimit, 35);
  assert.ok(Math.abs(sled.yaw - 315) < 0.01, `sled yaw must stay diagonal, got ${sled.yaw}`);
  assert.ok(Math.abs(sled.x) < 0.1 && Math.abs(sled.z) < 0.1, 'sled sits at the centre');

  // 红绿双色: red on the left of the sled, green on the right.
  const ring = document.vehicles.filter((vehicle) => vehicle !== sled);
  assert.equal(ring.length, 69);
  const left = ring.filter((vehicle) => vehicle.x < sled.x);
  const right = ring.filter((vehicle) => vehicle.x > sled.x);
  assert.deepEqual([...new Set(left.map((vehicle) => vehicle.colorIndex))], [2]);
  assert.deepEqual([...new Set(right.map((vehicle) => vehicle.colorIndex))], [1]);
  assert.equal(left.length, 34);
  assert.equal(right.length, 35);
  assert.deepEqual(Object.keys(document.passengerColorOverrides).sort(), ['1', '2']);

  assert.equal(validateLevelDocument(document).valid, true);
});

test('the Q159 sled is step-limited without becoming an ambulance', () => {
  const runtime = createRuntime(readLevel());
  const sled = runtime.vehicles.find((vehicle) => vehicle.colorIndex === 16);
  assert.equal(sled.ambulanceStepLimit, 35);
  assert.equal(sled.mechanism.type, 'christmas');

  // The step limit is a gameplay contract. Counting it as the ambulance family
  // would pull the ambulance FBX, rescuer passengers and countdown clip into a
  // sled-only package.
  const mechanics = deriveLevelMechanics(runtime);
  assert.equal(mechanics.types.includes(MECHANISM_TYPES.ambulance), false);
  assert.equal(mechanics.types.includes(MECHANISM_TYPES.christmas), true);

  setActiveLevel(runtime);
  const game = new BusLoopGame(runtime);
  const state = game.getVehicle(sled.id);
  assert.equal(state.ambulanceRemainingSteps, 35);
  assert.equal(state.ambulanceActive, true);
});

test('the step budget can reach the sled before the heart runs out', () => {
  const runtime = createRuntime(readLevel());
  const sled = runtime.vehicles.find((vehicle) => vehicle.colorIndex === 16);
  setActiveLevel(runtime);
  const game = new BusLoopGame(runtime);

  // Every car in the transitive blocker closure has to leave before the sled
  // can drive out. A budget below this count would make the board impossible.
  const closure = new Set();
  const stack = game.getBlockers(sled.id).filter((entry) => typeof entry === 'number');
  while (stack.length) {
    const id = stack.pop();
    if (closure.has(id)) continue;
    closure.add(id);
    for (const blocker of game.getBlockers(id).filter((entry) => typeof entry === 'number')) {
      if (!closure.has(blocker)) stack.push(blocker);
    }
  }
  assert.ok(closure.size > 0, 'the sled starts blocked in its ring');
  assert.ok(closure.size <= 35, `35 moves must clear the ${closure.size}-car blocker closure`);
});

test('Q159 session ships one six-bay stage with the requested naming', () => {
  const { config, session } = readSession('q159-christmas');
  assert.equal(session.stages.length, 1);
  assert.equal(session.stages[0].levelKey, 'level2602');
  assert.equal(session.stages[0].scene.parkingSpots.count, 6);
  assert.match(session.stages[0].scene.background, /^\/assets\/editor-backgrounds\//);
  // The sled is blocked at start, so the spotlight guide stays off; the idle
  // hand points at a car the player can actually dispatch.
  assert.equal(session.stages[0].opening.firstClickGuide.enabled, 0);
  // Session naming only carries alphanumeric overrides; the hyphenated
  // requirement code lives in the tuning snapshot and survives the merge.
  assert.equal(config.sessions['q159-christmas'].exportNaming.materialCode, 'Q159V1');
});

test('the Q159 tuning snapshot matches the delivery naming', () => {
  const tuning = JSON.parse(readFileSync(new URL('../artifacts/q159-christmas-tuning.json', import.meta.url), 'utf8'));
  assert.equal(tuning.level.selected, 'level2602');
  assert.equal(tuning.installGate.successfulOperationThreshold, 35);
  assert.equal(tuning.exportNaming.requirementCode, 'BL-2610296');
  assert.equal(tuning.exportNaming.materialCode, 'Q159V1');
  assert.equal(tuning.exportNaming.steps, '35moves');
  assert.equal(tuning.exportNaming.stamina, 'N');

  const expected = {
    applovin: 'BL-2610296-Q159V1-N-N-EN-PL-WXJ-TJW-AL-35moves-N.html',
    'google-ads': 'BL-2610296-Q159V1-N-N-EN-PL-WXJ-TJW-GG-35moves-N.zip',
    meta: 'BL-2610296-Q159V1-N-N-EN-PL-WXJ-TJW-FB-35moves-N.zip',
    unityads: 'BL-2610296-Q159V1-N-N-EN-PL-WXJ-TJW-UN-35moves-N.html',
    mintegral: 'BL_2610296_Q159V1_N_N_EN_PL_WXJ_TJW_MT_35moves_N.zip',
    moloco: 'BL-2610296-Q159V1-N-N-EN-PL-WXJ-TJW-MO-35moves-N.html',
    tiktok: 'BL-2610296-Q159V1-N-N-EN-PL-WXJ-TJW-TT-35moves-N.zip'
  };
  assert.deepEqual(Object.keys(expected).sort(), [...SUPPORTED_PLATFORMS].sort());
  for (const platform of SUPPORTED_PLATFORMS) {
    assert.equal(buildPlayableArtifactName(tuning, platform), expected[platform], platform);
  }
});

test('a step-limited sled draws its own heart badge and not the ambulance model', () => {
  const source = readFileSync(new URL('../src/scene-view.js', import.meta.url), 'utf8');
  // The family check must read the mechanism type first: a step-limited sled
  // also carries `ambulanceStepLimit`, and the old check would have swapped in
  // the ambulance FBX on top of it.
  assert.match(source, /function isAmbulanceVehicle\(vehicle\) \{[\s\S]*?vehicle\.mechanism\.type === 'ambulance'/);
  // The badge belongs to the step limit, not to the ambulance body.
  assert.match(source, /const isStepLimited = Number\.isInteger\(vehicle\.ambulanceStepLimit\)/);
  assert.match(source, /if \(isStepLimited\) \{/);
  assert.match(source, /this\.christmasStepBubbleTexture/);
  assert.match(source, /CHRISTMAS_ASSETS\.stepBubble/);
  assert.match(source, /board\.userData\.bubbleTexture/);
});

test('the store jump owns the last move of a step-limited sled ad', () => {
  const source = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
  assert.match(source, /function stepLimitedSledJumpOwnsEnding\(state\)/);
  assert.match(source, /vehicle\.mechanism\.type !== 'ambulance'/);
  assert.match(source, /getSuccessfulOperationThreshold\(\) === stepLimit/);
  // The 35th successful dispatch trips the install gate in handleVehicleClick,
  // so the failure card must not be drawn after it.
  assert.match(source, /if \(stepLimitedSledJumpOwnsEnding\(state\)\) return;/);
});
