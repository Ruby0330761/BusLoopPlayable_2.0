import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { LEVEL_CATALOG } from '../src/level-catalog.js';
import { createLevelDocument, levelDocumentToRuntime } from '../src/level-editor-model.js';
import { deriveLevelMechanics } from '../src/mechanism-resources.js';
import { resolvePlayableSession, PLAYABLE_SESSION_FORMAT } from '../src/playable-session-config.js';
import { COUNTDOWN_SIREN_ASSET, COUNTDOWN_TIMER_ASSET, validateCountdownConfig } from '../src/countdown.js';
import { SCENE_TUNING } from '../src/scene-tuning.js';
import {
  SUPPORTED_PLATFORMS,
  buildPlayableArtifactName,
  validateTuning
} from '../scripts/export-playable-package.mjs';

const LEVEL_PATH = new URL('../artifacts/web-levels/level26.json', import.meta.url);
const SESSION_PATH = new URL('../artifacts/playable-session.json', import.meta.url);
const TUNING_PATH = new URL('../artifacts/q165-timed-tuning.json', import.meta.url);
const PUBLIC = (asset) => new URL(`../public${asset}`, import.meta.url);
const MAIN_SOURCE = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

test('BL-2610285 keeps level26 as the shipped board but drops the ambulance step limit', () => {
  const document = readJson(LEVEL_PATH);
  assert.equal(document.format, 'bus-loop-web-level-v1');
  assert.equal(document.key, 'level26');
  assert.equal(document.vehicles.length, 70);
  // A timed level ends on the clock, not on a 35-move heart. The ambulance is
  // still an ambulance (model, rescuer passengers, siren), it just carries no
  // step budget.
  const ambulance = document.vehicles.filter((vehicle) => vehicle.mechanism.type === 'ambulance');
  assert.equal(ambulance.length, 1);
  assert.equal(ambulance[0].id, 162);
  assert.equal(ambulance[0].mechanism.stepLimited, false);
  assert.equal(document.vehicles.some((vehicle) => Number.isInteger(vehicle.mechanism.stepLimit) && vehicle.mechanism.stepLimited), false);

  const runtime = levelDocumentToRuntime(document, LEVEL_CATALOG.level5);
  assert.equal(runtime.vehicles.length, 70);
  assert.equal(runtime.vehicles.some((vehicle) => Number.isInteger(vehicle.ambulanceStepLimit)), false);
  // The family must survive the removal: the packager inlines the ambulance
  // model and rescuer passengers from this metadata.
  const mechanics = deriveLevelMechanics(runtime);
  assert.deepEqual(mechanics.types, ['ordinaryConveyor', 'ambulance']);
  assert.equal(mechanics.counts.ambulance, 1);
});

test('the authored level26 document matches the imported catalog board exactly', () => {
  const authored = createLevelDocument(readJson(LEVEL_PATH));
  const imported = createLevelDocument(LEVEL_CATALOG.level26);
  assert.equal(authored.mapScale, imported.mapScale);
  assert.deepEqual(authored.passengerQueues, imported.passengerQueues);
  assert.deepEqual(authored.containers, imported.containers);
  // Yaw survives a JSON round-trip through `normalizeAngle`, so compare it with
  // a tolerance instead of requiring bit-identical floats.
  assert.equal(authored.vehicles.length, imported.vehicles.length);
  for (const [index, candidate] of authored.vehicles.entries()) {
    const source = imported.vehicles[index];
    assert.equal(candidate.id, source.id);
    assert.equal(candidate.seats, source.seats);
    assert.equal(candidate.colorIndex, source.colorIndex);
    assert.ok(Math.abs(candidate.x - source.x) < 1e-9, `vehicle ${candidate.id} x`);
    assert.ok(Math.abs(candidate.z - source.z) < 1e-9, `vehicle ${candidate.id} z`);
    assert.ok(Math.abs(candidate.yaw - source.yaw) < 1e-6, `vehicle ${candidate.id} yaw`);
  }
});

test('Q165 session ships one untimed-guide level26 stage with the delivery naming', () => {
  const config = readJson(SESSION_PATH);
  assert.equal(config.format, PLAYABLE_SESSION_FORMAT);
  const session = resolvePlayableSession(config, 'q165-timed');
  assert.equal(session.stages.length, 1);
  assert.equal(session.stages[0].levelKey, 'level26');
  assert.equal(session.stages[0].opening.firstClickGuide.enabled, 0);
  assert.equal(session.preRollEnabled, false);
  assert.equal(config.sessions['q165-timed'].exportNaming.materialCode, 'Q165V1');
  // The stage must keep the artwork the delivered package shipped with. The
  // editor-backgrounds folder holds a same-composition pink recolour; matching
  // on grayscale structure alone picked that one once and silently changed the
  // board colour, so the exact asset is pinned here.
  assert.equal(session.stages[0].scene.background, '/assets/applovin/textures/BG01_split01_q60.jpg');
});

test('the Q165 tuning snapshot carries the 60s countdown, siren loop and store jump', () => {
  const tuning = readJson(TUNING_PATH);
  const countdown = validateCountdownConfig(tuning.countdown);
  assert.equal(countdown.enabled, 1);
  assert.equal(countdown.durationSeconds, 60);
  assert.equal(countdown.warningEnabled, 1);
  assert.equal(countdown.warningSeconds, 10);
  assert.equal(countdown.sirenEnabled, 1);
  assert.equal(countdown.timeoutStore, 1);
  assert.equal(tuning.exportNaming.requirementCode, 'BL-2610285');
  assert.equal(tuning.exportNaming.materialCode, 'Q165V1');
  assert.equal(tuning.exportNaming.requester, 'JXY');
  assert.equal(tuning.level.selected, 'level26');
  // This delivery's failure card offers a second way into the store: the red
  // pill is repointed from "restart the round" to "open the store". Every other
  // package keeps the `restart` default in scene-tuning.js.
  assert.equal(tuning.gameOver.retryAction, 'store');
  assert.equal(tuning.gameOver.retryEnabled, 1);
  assert.equal(SCENE_TUNING.gameOver.retryAction, 'restart');
  // This delivery is the timed level only. The BL-42 progress HUD ships enabled
  // by default in scene-tuning.js, so the snapshot has to pin it off or its
  // three bitmaps leak into the package (~193 KB) and draw a bar this brief
  // never asked for.
  assert.equal(tuning.progressHud.enabled, 0);
  // Same rule as the session: shipped artwork, not the pink recolour.
  assert.equal(tuning.background.asset, '/assets/applovin/textures/BG01_split01_q60.jpg');
  assert.ok(existsSync(new URL('../public/assets/applovin/textures/BG01_split01_q60.jpg', import.meta.url)));

  function deepMerge(target, source) {
    for (const [key, value] of Object.entries(source ?? {})) {
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        target[key] ??= {};
        deepMerge(target[key], value);
      } else {
        target[key] = value;
      }
    }
    return target;
  }
  const merged = validateTuning(deepMerge(structuredClone(SCENE_TUNING), tuning), SCENE_TUNING);
  const expected = {
    applovin: 'BL-2610285-Q165V1-N-N-EN-PL-WXJ-JXY-AL-N-N.html',
    'google-ads': 'BL-2610285-Q165V1-N-N-EN-PL-WXJ-JXY-GG-N-N.zip',
    meta: 'BL-2610285-Q165V1-N-N-EN-PL-WXJ-JXY-FB-N-N.zip',
    unityads: 'BL-2610285-Q165V1-N-N-EN-PL-WXJ-JXY-UN-N-N.html',
    mintegral: 'BL_2610285_Q165V1_N_N_EN_PL_WXJ_JXY_MT_N_N.zip',
    moloco: 'BL-2610285-Q165V1-N-N-EN-PL-WXJ-JXY-MO-N-N.html',
    tiktok: 'BL-2610285-Q165V1-N-N-EN-PL-WXJ-JXY-TT-N-N.zip'
  };
  assert.deepEqual([...SUPPORTED_PLATFORMS], Object.keys(expected));
  for (const platform of SUPPORTED_PLATFORMS) {
    assert.equal(buildPlayableArtifactName(merged, platform), expected[platform]);
  }
});

test('the countdown siren clip ships and is only inlined when the toggle is on', () => {
  assert.equal(COUNTDOWN_SIREN_ASSET, '/assets/applovin/countdown/ambulance-siren.mp3');
  assert.ok(existsSync(PUBLIC(COUNTDOWN_SIREN_ASSET)), 'the synthesised siren loop must be committed');
  assert.ok(existsSync(PUBLIC(COUNTDOWN_TIMER_ASSET)), 'the timer artwork must be committed');
  const bytes = readFileSync(PUBLIC(COUNTDOWN_SIREN_ASSET));
  // 2 s at 48 kbps is ~12 KB; anything near a megabyte would blow the ad budget.
  assert.ok(bytes.length > 4000 && bytes.length < 60000, `siren is ${bytes.length} bytes`);
  const packager = readFileSync(new URL('../scripts/package-applovin-single-html.mjs', import.meta.url), 'utf8');
  // The siren/progress/stamina whitelist moved into the shared inline-asset
  // module so the editor's size preflight measures the same package.
  const inlineAssets = readFileSync(new URL('../src/playable-inline-assets.js', import.meta.url), 'utf8');
  assert.match(inlineAssets, /COUNTDOWN_SIREN_ASSET/);
  assert.match(inlineAssets, /countdown\?\.sirenEnabled/);
  assert.match(packager, /collectPlayableInlineAssetUrls\(\{/);
});

test('countdown timeout jump reuses the install gate and suppresses the failure card', () => {
  assert.match(MAIN_SOURCE, /if \(!game\.failCountdown\(\)\) return;/);
  assert.match(MAIN_SOURCE, /platformBridge\?\.challengeFailed\?\.\(\);[\s\S]{0,120}InstallFullGame\(\);/);
  assert.match(MAIN_SOURCE, /function countdownTimeoutJumpOwnsEnding\(state\)/);
  assert.match(MAIN_SOURCE, /lastEvent\?\.reason === 'challenge-timeout'[\s\S]{0,80}timeoutStore\) === 1/);
  assert.match(MAIN_SOURCE, /if \(countdownTimeoutJumpOwnsEnding\(state\)\) return;/);
  // The siren follows the clock, so it must stop wherever the HUD stops.
  assert.match(MAIN_SOURCE, /state\.state === 'running'/);
  assert.match(MAIN_SOURCE, /stopLoop\('countdown_siren'\)/);
  // The jump runs inside the animation frame; a host that refuses the store
  // call must not take the render loop down with it.
  assert.match(MAIN_SOURCE, /Countdown store jump failed\.[\s\S]{0,200}\}\);/);
});
