import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  LEVEL_AUDIO_CONFIG,
  isLevelAudioConfigComplete,
  resolveLevelAudioConfig
} from '../src/level-audio-config.js';
import { LEVEL_1, setActiveLevel } from '../src/level-data.js';
import { LEVEL_CATALOG } from '../src/level-catalog.js';
import { MECHANISM_AUDIO_NAMES, MECHANISM_TYPE_ORDER, getMechanismAudioConfig } from '../src/mechanism-resources.js';

// The remote editor points PLAYABLE_LEVEL_CATALOG_PATH at a data volume that is
// seeded once and never reseeded. The catalog in that volume was written before
// `vehicle_tap` was added, so exports from there produced levels whose audio map
// had no tap clip: the runtime still emitted `vehicle-dispatched`, the controller
// looked up a sound that did not exist and returned without a warning. The
// packaged ad simply had no tap sound, and nothing in the static or runtime
// checks noticed. These tests pin the sound list to code so catalog age cannot
// remove a sound the event wiring plays.

test('canonical sound table covers every non-mechanism event the game plays', () => {
  assert.deepEqual(Object.keys(LEVEL_AUDIO_CONFIG).sort(), [
    'bus_full', 'bus_hit', 'passenger_up', 'vehicle_tap'
  ]);
  assert.deepEqual(LEVEL_AUDIO_CONFIG.vehicle_tap.clips, [
    '/assets/unity/audio/vehicle_tap.mp3'
  ]);
  assert.equal(LEVEL_AUDIO_CONFIG.vehicle_tap.volume, 0.7);
  for (const [name, entry] of Object.entries(LEVEL_AUDIO_CONFIG)) {
    assert.ok(entry.clips.length > 0, `${name} must have at least one clip`);
    for (const clip of entry.clips) assert.match(clip, /^\/assets\/unity\/audio\/.+\.mp3$/u);
  }
});

test('every sound name the audio controller can play is reachable from a table', () => {
  // A name played by the controller but missing from both tables is unreachable
  // by construction: `play()` finds no config and returns silently.
  const controllerSource = readFileSync('src/audio-controller.js', 'utf8');
  const played = new Set([
    ...[...controllerSource.matchAll(/name: '([a-z_]+)'/gu)].map((match) => match[1]),
    ...[...controllerSource.matchAll(/this\.play\('([a-z_]+)'\)/gu)].map((match) => match[1])
  ]);
  assert.ok(played.has('vehicle_tap'), 'the controller must still emit the tap sound');
  const reachable = new Set([
    ...Object.keys(LEVEL_AUDIO_CONFIG),
    ...MECHANISM_AUDIO_NAMES
  ]);
  for (const name of played) {
    assert.ok(reachable.has(name), `"${name}" is played but no table provides a clip for it`);
  }
});

test('a level whose catalog predates the tap sound is completed, not stripped', () => {
  // This is the exact audio map an old catalog produced: three names, no tap.
  const stale = {
    bus_hit: { clips: ['/assets/unity/audio/bus_hit_V5.mp3'], volume: 0.503268 },
    passenger_up: { clips: ['/assets/unity/audio/passenger_up_01.mp3'], volume: 0.825528 },
    bus_full: { clips: ['/assets/unity/audio/bus_full.mp3'], volume: 0.50023913 }
  };
  assert.equal(isLevelAudioConfigComplete(stale), false);

  const completed = resolveLevelAudioConfig(stale);
  assert.equal(isLevelAudioConfigComplete(completed), true);
  assert.deepEqual(completed.vehicle_tap, LEVEL_AUDIO_CONFIG.vehicle_tap);
  // Names the level already carries are preserved, not overwritten.
  assert.equal(completed.bus_hit, stale.bus_hit);
  assert.equal(completed.passenger_up, stale.passenger_up);
});

test('an explicit level sound wins over the canonical fallback', () => {
  const custom = {
    ...LEVEL_AUDIO_CONFIG,
    vehicle_tap: { clips: ['/assets/custom/tap_alt.mp3'], volume: 0.4 }
  };
  assert.equal(resolveLevelAudioConfig(custom).vehicle_tap.clips[0], '/assets/custom/tap_alt.mp3');
  // An entry with no clips is treated as missing: it would play nothing.
  const emptyClips = { ...LEVEL_AUDIO_CONFIG, vehicle_tap: { clips: [], volume: 0.4 } };
  assert.deepEqual(resolveLevelAudioConfig(emptyClips).vehicle_tap, LEVEL_AUDIO_CONFIG.vehicle_tap);
});

test('activating a legacy level completes its sound list', () => {
  const { audio: _audio, ...assetsWithoutAudio } = LEVEL_CATALOG.level5.assets;
  const legacy = { ...LEVEL_CATALOG.level5, assets: assetsWithoutAudio };
  assert.equal(legacy.assets.audio, undefined);

  const activated = setActiveLevel(legacy);
  assert.equal(isLevelAudioConfigComplete(activated.assets.audio), true);
  assert.deepEqual(activated.assets.audio.vehicle_tap, LEVEL_AUDIO_CONFIG.vehicle_tap);
  assert.deepEqual(LEVEL_1.assets.audio.vehicle_tap, LEVEL_AUDIO_CONFIG.vehicle_tap);
});

test('the production generator completes the sound list on both resolution paths', () => {
  const generator = readFileSync('scripts/generate-active-level.mjs', 'utf8');
  assert.match(generator, /level-audio-config\.js/);
  assert.ok(
    (generator.match(/return completeLevelAssets\(/gu) ?? []).length >= 2,
    'both the web-level and catalog paths must complete the level assets'
  );
  assert.match(generator, /completeLevelAudio\(completeColorAtlases\(level\)\)/);
});

test('the runtime completes the sound list so editor previews cannot lose it', () => {
  const levelDataSource = readFileSync('src/level-data.js', 'utf8');
  assert.match(levelDataSource, /resolveLevelAudioConfig/);
  assert.match(levelDataSource, /isLevelAudioConfigComplete/);
  assert.match(levelDataSource, /withCompleteLevelAssets/);

  // The controller is assembled from the merged session levels, which bypasses
  // setActiveLevel, so that path has to complete the map as well.
  const mainSource = readFileSync('src/main.js', 'utf8');
  assert.match(
    mainSource,
    /\.\.\.resolveLevelAudioConfig\(\s*Object\.assign\(\{\}, \.\.\.allSessionLevels\.map/u
  );
});

test('every production level a session can reach carries the tap sound', async () => {
  const { PLAYABLE_ALL_LEVELS } = await import('../src/generated-active-level.js');
  assert.ok(PLAYABLE_ALL_LEVELS.length > 0);
  for (const level of PLAYABLE_ALL_LEVELS) {
    const audio = level.assets?.audio;
    assert.ok(audio, `${level.key} must expose assets.audio`);
    assert.equal(
      isLevelAudioConfigComplete(audio),
      true,
      `${level.key} must name every sound the events play (catalog-independent)`
    );
    assert.deepEqual(audio.vehicle_tap, LEVEL_AUDIO_CONFIG.vehicle_tap, `${level.key} tap sound`);
  }
});

test('the tap clip ships as a project asset', () => {
  const clip = LEVEL_AUDIO_CONFIG.vehicle_tap.clips[0];
  assert.ok(
    readFileSync(`public${clip}`).length > 0,
    `${clip} must exist under public/ so the packager can inline it`
  );
});

test('mechanism audio stays separate from level audio', () => {
  const mechanism = getMechanismAudioConfig(MECHANISM_TYPE_ORDER);
  assert.ok(Object.keys(mechanism).length >= MECHANISM_AUDIO_NAMES.length);
  for (const name of MECHANISM_AUDIO_NAMES) assert.ok(name in mechanism, `${name} must resolve`);
  for (const name of Object.keys(LEVEL_AUDIO_CONFIG)) {
    assert.equal(name in mechanism, false, `${name} must not be claimed by a mechanism`);
  }
});

test('the Christmas background music ships and stays off by default', async () => {
  // The loop is addressed from tuning, not from a level document, so nothing
  // else in the asset pass would notice it going missing. BGM is also opt-in:
  // a level that never enables it must not start making noise.
  const { SCENE_TUNING } = await import('../src/scene-tuning.js');
  const bgm = SCENE_TUNING.audio?.bgm;
  assert.ok(bgm, 'tuning must carry an audio.bgm block');
  assert.equal(Number(bgm.enabled), 0, 'BGM is off unless a level turns it on');
  assert.equal(bgm.asset, '/assets/unity/audio/christmas_bgm.mp3');
  const bytes = readFileSync(`public${bgm.asset}`);
  assert.ok(bytes.length > 50_000, 'the loop must be a real track, not a placeholder');
  // 56 kbps mono keeps the whole single-HTML ad inside COMMON-ART-001's 5 MB cap.
  assert.ok(bytes.length < 300_000, 'the loop must stay small enough to inline');
});

test('background music starts on the first successful tap and never on load', () => {
  // Autoplay before a gesture is rejected by every ad platform's browser, and a
  // rejected play is worse than a silent ad. The track therefore has to hang off
  // `result.ok` on the vehicle click, and the controller has to keep it out of
  // the preload/effect pool so reset and stage handoff do not restart it.
  const main = readFileSync('src/main.js', 'utf8');
  const controller = readFileSync('src/audio-controller.js', 'utf8');
  const packager = readFileSync('scripts/package-applovin-single-html.mjs', 'utf8');

  assert.match(main, /function startBackgroundMusic\(\)/);
  assert.match(main, /if \(!Number\(bgm\?\.enabled\)\) return;/);
  assert.match(main, /const result = game\.clickVehicle\(vehicleId\);\s*\n\s*if \(result\?\.ok\) \{\s*\n\s*startBackgroundMusic\(\);/);
  // Starting must never happen at module load: only inside the click handler.
  assert.equal((main.match(/startBackgroundMusic\(\)/g) ?? []).length, 2, 'declaration + one call site');

  // Looping source with its own gain, tracked outside the effect pool.
  assert.match(controller, /source\.loop = true/);
  assert.match(controller, /playBgm\(\{ asset, volume = 0\.5, fadeInSeconds = 0\.8 \} = \{\}\)/);
  assert.match(controller, /this\.bgm = entry/);
  assert.match(controller, /stopBgm\(\)/);
  assert.match(controller, /get isBgmPlaying\(\)/);
  // resetEventHistory must not touch the music source.
  const resetBlock = controller.slice(
    controller.indexOf('resetEventHistory()'),
    controller.indexOf('playPassengerUp()')
  );
  assert.doesNotMatch(resetBlock, /bgm/);

  // The track is addressed from tuning, so the packager needs its own pass or
  // the single-file ad requests a root-relative path that does not exist.
  assert.match(packager, /SCENE_TUNING\.audio\?\.bgm\?\.enabled/);
  assert.match(packager, /realAssetUrls\.add\(SCENE_TUNING\.audio\.bgm\.asset\)/);
});
