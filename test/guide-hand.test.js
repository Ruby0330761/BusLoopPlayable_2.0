import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { SCENE_TUNING } from '../src/scene-tuning.js';
import {
  getVehicleIdOptions,
  normalizeVehicleIdSelection
} from '../src/scene-editor.js';
import {
  isGuideLevelActive,
  SceneView,
  shouldBlockVehicleInput,
  shouldShowVehicleGuideHand
} from '../src/scene-view.js';

test('opening guide vehicle choices use the active level vehicle ids', () => {
  assert.deepEqual(getVehicleIdOptions([
    { id: 91 },
    { id: 43 },
    { id: 91 },
    { id: 0 },
    { id: '88' }
  ]), [
    ['43', '43'],
    ['88', '88'],
    ['91', '91']
  ]);
  assert.equal(normalizeVehicleIdSelection('91'), 91);
  assert.equal(normalizeVehicleIdSelection(88), 88);
  assert.equal(normalizeVehicleIdSelection('missing'), null);
});

test('level36 uses an opening and five-second idle hand without a dimming mask', async () => {
  const tuning = SCENE_TUNING.vehicleGuideHand;
  const firstClickGuide = SCENE_TUNING.firstClickGuide;
  const mainSource = await readFile(new URL('../src/main.js', import.meta.url), 'utf8');
  const editorSource = await readFile(new URL('../src/scene-editor.js', import.meta.url), 'utf8');
  const stylesSource = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8');
  const viewSource = await readFile(new URL('../src/scene-view.js', import.meta.url), 'utf8');

  assert.equal(tuning.levelKey, 'level36');
  assert.equal(tuning.vehicleId, 1);
  assert.equal(tuning.showAtStart, 1);
  assert.equal(tuning.idleDelaySeconds, 5);
  assert.equal(tuning.size, 2.2);
  assert.equal(tuning.offsetX, 0.25);
  assert.equal(tuning.approachOffsetX, 0.62);
  assert.ok(tuning.farScale > tuning.nearScale, 'hand should shrink while moving from right to left');
  assert.equal(firstClickGuide.enabled, 0);
  assert.equal(firstClickGuide.levelKey, undefined);
  assert.equal(firstClickGuide.vehicleId, 1);
  assert.equal(firstClickGuide.durationSeconds, 3);
  assert.equal(firstClickGuide.maskEnabled, 1);
  assert.equal(firstClickGuide.maskOpacity, 0.68);
  assert.equal(firstClickGuide.holePadding, 30);
  // The spotlight box follows the delivered playables: a tight frame around one
  // car body rather than the older oversized square.
  assert.equal(firstClickGuide.holeRadius, 5);
  assert.equal(firstClickGuide.holeOffsetX, 0);
  assert.equal(firstClickGuide.holeOffsetY, 0);
  assert.equal(firstClickGuide.holeScaleX, 0.54);
  assert.equal(firstClickGuide.holeScaleY, 0.4);
  assert.equal(isGuideLevelActive(tuning, 'level36'), true);
  assert.equal(isGuideLevelActive(tuning, 'level33'), false);
  assert.equal(shouldBlockVehicleInput({
    firstClickGuideEnabled: 1,
    firstClickGuideDuration: 3,
    firstClickGuideLockInput: 1,
    time: 2.99
  }), true);
  assert.equal(shouldBlockVehicleInput({
    firstClickGuideEnabled: 1,
    firstClickGuideDuration: 3,
    firstClickGuideLockInput: 1,
    time: 3
  }), true);
  assert.equal(shouldBlockVehicleInput({
    firstClickGuideEnabled: 1,
    firstClickGuideDuration: 3,
    firstClickGuideLockInput: 1,
    time: 3.01
  }), false);
  assert.equal(shouldBlockVehicleInput({ entryBannerActive: true, time: 10 }), true);
  assert.equal(shouldShowVehicleGuideHand({ enabled: 1, showAtStart: 1 }), true);
  assert.equal(shouldShowVehicleGuideHand({
    enabled: 1,
    showAtStart: 0,
    hasInteracted: false,
    inactiveSeconds: 4.99,
    idleDelaySeconds: 5
  }), false);
  assert.equal(shouldShowVehicleGuideHand({
    enabled: 1,
    showAtStart: 0,
    hasInteracted: false,
    inactiveSeconds: 5,
    idleDelaySeconds: 5
  }), true);
  assert.equal(shouldShowVehicleGuideHand({
    enabled: 1,
    showAtStart: 1,
    hasInteracted: true,
    inactiveSeconds: 4.99,
    idleDelaySeconds: 5
  }), false);
  assert.equal(shouldShowVehicleGuideHand({
    enabled: 1,
    showAtStart: 1,
    hasInteracted: true,
    inactiveSeconds: 5,
    idleDelaySeconds: 5
  }), true);
  assert.match(viewSource, /texture\.wrapS = THREE\.RepeatWrapping/);
  assert.match(viewSource, /texture\.repeat\.x = -1/);
  assert.match(viewSource, /texture\.offset\.x = 1/);
  assert.match(viewSource, /createFirstClickGuideMask/);
  assert.match(viewSource, /updateFirstClickGuideMask/);
  assert.match(viewSource, /updateFirstClickGuideHand/);
  assert.match(viewSource, /first-click-guide-mask/);
  assert.match(viewSource, /first-click-guide-hand/);
  assert.match(viewSource, /durationSeconds/);
  assert.match(viewSource, /holeScaleX/);
  assert.match(viewSource, /holeScaleY/);
  assert.match(viewSource, /Number\(guide\.holeRadius\)/);
  assert.match(viewSource, /maskEnabled/);
  assert.match(viewSource, /is-hand-only/);
  assert.match(viewSource, /--first-click-guide-radius/);
  assert.match(viewSource, /holeOffsetX/);
  assert.match(viewSource, /holeOffsetY/);
  assert.match(viewSource, /shouldShowVehicleGuideHand/);
  assert.match(viewSource, /recordGuideInteraction/);
  assert.match(viewSource, /isVehicleInputLocked/);
  assert.match(viewSource, /isOpeningGuideActive/);
  assert.match(viewSource, /is-input-blocking/);
  assert.match(viewSource, /this\.isVehicleInputLocked\(\)/);
  assert.match(mainSource, /view\?\.isVehicleInputLocked\?\.\(\)/);
  // Only the surrounding mask pieces capture input; the spotlight hole must
  // stay clickable or the highlighted car cannot be dispatched.
  assert.match(stylesSource, /\.first-click-guide-mask\.is-input-blocking \.first-click-guide-mask-piece\s*\{\s*pointer-events:\s*auto/);
  assert.doesNotMatch(stylesSource, /\.first-click-guide-mask\.is-input-blocking\s*\{\s*pointer-events:\s*auto/);
  assert.match(mainSource, /isFirstClickGuideTarget/);
  assert.match(viewSource, /resolveGuideHandTarget/);
  assert.match(viewSource, /resolveFirstClickGuideTarget/);
  assert.match(viewSource, /getFirstClickGuidePreferredId/);
  assert.match(viewSource, /canvas\.addEventListener\('pointerdown'/);
  assert.match(viewSource, /idleDelaySeconds/);
  assert.match(viewSource, /levelKey === activeLevelKey/);
  assert.match(viewSource, /enabled: tuning\.enabled && isGuideLevelActive\(tuning\)/);
  assert.match(viewSource, /if \(!guide\.enabled\) return false;/);
  assert.doesNotMatch(mainSource, /guide-locked/);
  assert.doesNotMatch(mainSource, /getActiveFirstClickGuideTargetId/);
  assert.match(mainSource, /migrateGuideHandMotionTuning/);
  assert.match(mainSource, /migrateFirstClickGuideMaskTuning/);
  assert.match(mainSource, /Number\(guideHand\.vehicleId\) === 1/);
  assert.match(mainSource, /Number\(guideHand\.offsetX\) === -0\.38/);
  assert.match(mainSource, /Number\(guideHand\.approachOffsetX\) === -0\.62/);
  assert.match(mainSource, /migrateLevel33EnhancementTuning/);
  assert.match(mainSource, /Number\(guideHand\.size\) === 1\.63/);
  assert.match(mainSource, /guideHand\.size = 2\.2/);
  assert.match(mainSource, /Number\(firstClickGuide\.holePadding\) === 15/);
  assert.match(mainSource, /firstClickGuide\.holePadding = 30/);
  assert.match(mainSource, /Number\(bounds\?\.minX\) === -2\.1/);
  assert.match(mainSource, /minX: -3/);
  assert.match(mainSource, /maxX: 2\.95/);
  assert.match(mainSource, /minZ: -3\.22/);
  assert.match(mainSource, /maxZ: 2\.82/);
  assert.match(mainSource, /migrateLevel36TimedGuideTuning/);
  assert.match(mainSource, /LEVEL36_TIMED_GUIDE_MIGRATION_KEY/);
  assert.match(mainSource, /idleDelaySeconds: 5/);
  assert.match(mainSource, /maskOpacity: 0/);
  assert.match(mainSource, /guide\.levelKey = 'level12'/);
  assert.match(mainSource, /guide\.vehicleId = 34/);
  assert.match(stylesSource, /\.first-click-guide-hand/);
  assert.match(stylesSource, /scaleX\(-1\)/);
  assert.match(stylesSource, /\.first-click-guide-mask\s*\{[^}]*overflow:\s*hidden/s);
  // The pieces used to be display:none because the whole mask captured input.
  // They now carry the outside-the-hole input area instead.
  assert.match(stylesSource, /\.first-click-guide-mask-piece\s*\{[^}]*display:\s*block/s);
  assert.match(stylesSource, /0 0 0 9999px rgba\(0, 0, 0, var\(--first-click-guide-opacity, \.8\)\)/);
  assert.match(stylesSource, /border-radius:\s*var\(--first-click-guide-radius, 16px\)/);
  assert.match(editorSource, /firstClickGuide\.enabled/);
  assert.match(editorSource, /vehicleGuideHand\.levelKey/);
  assert.match(editorSource, /vehicleGuideHand\.showAtStart/);
  assert.match(editorSource, /vehicleGuideHand\.idleDelaySeconds/);
  assert.doesNotMatch(editorSource, /\['[^']*', 'firstClickGuide\.levelKey'/);
  assert.match(editorSource, /firstClickGuide\.vehicleId/);
  assert.match(editorSource, /firstClickGuide\.vehicleId'.*'vehicle-id-select'/);
  assert.match(editorSource, /firstClickGuide\.durationSeconds/);
  assert.match(editorSource, /firstClickGuide\.maskEnabled/);
  assert.match(editorSource, /firstClickGuide\.maskOpacity/);
  assert.match(editorSource, /firstClickGuide\.holeRadius/);
  assert.match(editorSource, /firstClickGuide\.holeOffsetX/);
  assert.match(editorSource, /firstClickGuide\.holeOffsetY/);
  assert.match(editorSource, /firstClickGuide\.holeScaleX/);
  assert.match(editorSource, /firstClickGuide\.holeScaleY/);
});

test('opening guide animation has an editor toggle that restarts its preview', async () => {
  const mainSource = await readFile(new URL('../src/main.js', import.meta.url), 'utf8');
  const editorSource = await readFile(new URL('../src/scene-editor.js', import.meta.url), 'utf8');
  const stylesSource = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8');
  const viewSource = await readFile(new URL('../src/scene-view.js', import.meta.url), 'utf8');

  assert.match(editorSource, /firstClickGuide\.enabled', 0, 1, 1, null, 'toggle'/);
  assert.match(editorSource, /type="checkbox" role="switch"/);
  assert.doesNotMatch(editorSource, /const guideKey = path\.split\('\.'\)\[0\]/);
  assert.match(editorSource, /path === 'vehicleGuideHand\.enabled'/);
  assert.match(mainSource, /path\?\.startsWith\('firstClickGuide\.'\)/);
  assert.match(mainSource, /if \(restartOpeningGuide\) reset\(\)/);
  assert.match(mainSource, /path\?\.startsWith\('entryBanner\.'\)/);
  assert.match(mainSource, /if \(restartEntryBanner\) view\.showEntryBanner\?\.\(\)/);
  assert.match(viewSource, /if \(!this\.getEntryBannerTuning\(\)\?\.enabled\)/);
  assert.match(viewSource, /this\.updateEntryBannerTuning\(\);\r?\n    const banner = this\.entryBanner/);
  assert.match(editorSource, /document\.createElement\('details'\)/);
  assert.match(editorSource, /editor-section-summary/);
  assert.match(editorSource, /section\.open = Boolean\(group\.defaultOpen\)/);
  assert.match(stylesSource, /\.editor-section\[open\] > \.editor-section-summary/);
});

const guideView = (vehicles) => ({
  vehicleViews: new Map(vehicles.map((vehicle) => [vehicle.id, {
    visible: true,
    userData: { vehicleId: vehicle.id }
  }])),
  lastGame: {
    getBlockers: (id) => vehicles.find((vehicle) => vehicle.id === id)?.blockers ?? []
  },
  getVehicleBlockers(game, id) {
    return game.getBlockers(id);
  }
});

test('both guides point at the configured vehicle even when it is blocked', () => {
  const vehicles = [
    { id: 43, state: 'parked', blockers: [] },
    { id: 100, state: 'parked', blockers: [98, 99] }
  ];
  // A blocked car is still the honest target: the player taps it, sees the bump,
  // and learns the blocking rule. Substituting an unblocked car used to make the
  // editor's id look ignored.
  const blocked = SceneView.prototype.resolveGuideHandTarget.call(
    guideView(vehicles),
    { vehicles },
    { vehicleId: 100 }
  );
  assert.equal(blocked.userData.vehicleId, 100, 'the blocked configured car must still be highlighted');

  const openingGuideView = {
    ...guideView(vehicles),
    resolveGuideHandTarget: SceneView.prototype.resolveGuideHandTarget,
    resolveActionableFirstClickGuideTarget: SceneView.prototype.resolveActionableFirstClickGuideTarget,
    getFirstClickGuidePreferredId: () => 100
  };
  const openingTarget = SceneView.prototype.resolveFirstClickGuideTarget.call(
    openingGuideView,
    { vehicles, queues: [] }
  );
  assert.equal(
    openingTarget.userData.vehicleId,
    100,
    'the opening guide must not swap a blocked target for a dispatchable one'
  );

  // A belt-head colour used to win a fallback; it must not influence the target
  // at all now that the configured car is authoritative.
  const withBeltColour = SceneView.prototype.resolveFirstClickGuideTarget.call(
    openingGuideView,
    { vehicles, queues: [[{ colorIndex: 43 }]] }
  );
  assert.equal(withBeltColour.userData.vehicleId, 100, 'belt colours must not redirect the guide');

  const clear = SceneView.prototype.resolveGuideHandTarget.call(
    guideView([{ id: 100, state: 'parked', blockers: [] }]),
    { vehicles: [{ id: 100, state: 'parked', blockers: [] }] },
    { vehicleId: 100 }
  );
  assert.equal(clear.userData.vehicleId, 100);

  const missing = SceneView.prototype.resolveGuideHandTarget.call(
    guideView(vehicles),
    { vehicles },
    { vehicleId: 7 }
  );
  assert.equal(missing, null, 'an unknown vehicle id must not highlight some other vehicle');
});

test('the opening spotlight only locks the board when the level asks for it', () => {
  // Centre-rescue levels spotlight a car that is deliberately unreachable at the
  // start. Locking input for the spotlight's duration froze the game with nothing
  // tappable, so the lock is opt-in per level.
  assert.equal(shouldBlockVehicleInput({
    firstClickGuideEnabled: true,
    firstClickGuideDuration: 3,
    firstClickGuideLockInput: 0,
    time: 1
  }), false);
  assert.equal(shouldBlockVehicleInput({
    firstClickGuideEnabled: true,
    firstClickGuideDuration: 3,
    firstClickGuideLockInput: 1,
    time: 1
  }), true);
  assert.equal(shouldBlockVehicleInput({
    firstClickGuideEnabled: true,
    firstClickGuideDuration: 3,
    firstClickGuideLockInput: 1,
    time: 4
  }), false);
  // The entry banner still locks regardless of the guide setting.
  assert.equal(shouldBlockVehicleInput({ entryBannerActive: true, time: 10 }), true);
});

test('the Christmas opening guide blocks input while the board is dimmed', async () => {
  // Requirement: while the opening mask dims every other car, the player must
  // not be able to tap them. The lock is what makes the dimmed state mean
  // something; it releases when the guide's duration elapses.
  const session = JSON.parse(await readFile('artifacts/playable-session.json', 'utf8'));
  const opening = session.sessions['q24-christmas'].stages[0].opening.firstClickGuide;
  assert.equal(Number(opening.enabled), 1);
  assert.equal(Number(opening.maskEnabled), 1, 'the guide must dim the other cars');
  assert.equal(Number(opening.lockInput), 1, 'a dimmed board must not accept taps');
  assert.ok(Number(opening.durationSeconds) > 0);
  assert.equal(Number(opening.vehicleId), 162);
});
