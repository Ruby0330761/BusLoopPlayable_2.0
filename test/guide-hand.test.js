import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { SCENE_TUNING } from '../src/scene-tuning.js';
import { isGuideLevelActive, shouldShowVehicleGuideHand } from '../src/scene-view.js';

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
  assert.equal(firstClickGuide.levelKey, 'level36');
  assert.equal(firstClickGuide.vehicleId, 1);
  assert.equal(firstClickGuide.durationSeconds, 3);
  assert.equal(firstClickGuide.maskOpacity, 0);
  assert.equal(firstClickGuide.holePadding, 30);
  assert.equal(firstClickGuide.holeRadius, 16);
  assert.equal(firstClickGuide.holeOffsetX, 0);
  assert.equal(firstClickGuide.holeOffsetY, 0);
  assert.equal(firstClickGuide.holeScaleX, 0.62);
  assert.equal(firstClickGuide.holeScaleY, 0.62);
  assert.equal(isGuideLevelActive(tuning, 'level36'), true);
  assert.equal(isGuideLevelActive(tuning, 'level33'), false);
  assert.equal(isGuideLevelActive(firstClickGuide, 'level36'), true);
  assert.equal(isGuideLevelActive(firstClickGuide, 'level33'), false);
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
  assert.match(viewSource, /--first-click-guide-radius/);
  assert.match(viewSource, /holeOffsetX/);
  assert.match(viewSource, /holeOffsetY/);
  assert.match(viewSource, /shouldShowVehicleGuideHand/);
  assert.match(viewSource, /recordGuideInteraction/);
  assert.match(viewSource, /resolveGuideHandTarget/);
  assert.match(viewSource, /canvas\.addEventListener\('pointerdown'/);
  assert.match(viewSource, /idleDelaySeconds/);
  assert.match(viewSource, /levelKey === activeLevelKey/);
  assert.match(viewSource, /enabled: tuning\.enabled && isGuideLevelActive\(tuning\)/);
  assert.match(viewSource, /!guide\.enabled \|\| !isGuideLevelActive\(guide\)/);
  assert.doesNotMatch(mainSource, /guide-locked/);
  assert.doesNotMatch(mainSource, /getActiveFirstClickGuideTargetId/);
  assert.match(mainSource, /migrateGuideHandMotionTuning/);
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
  assert.match(stylesSource, /\.first-click-guide-mask-piece\s*\{[^}]*display:\s*none/s);
  assert.match(stylesSource, /0 0 0 9999px rgba\(0, 0, 0, var\(--first-click-guide-opacity, \.8\)\)/);
  assert.match(stylesSource, /border-radius:\s*var\(--first-click-guide-radius, 16px\)/);
  assert.match(editorSource, /firstClickGuide\.enabled/);
  assert.match(editorSource, /vehicleGuideHand\.levelKey/);
  assert.match(editorSource, /vehicleGuideHand\.showAtStart/);
  assert.match(editorSource, /vehicleGuideHand\.idleDelaySeconds/);
  assert.match(editorSource, /firstClickGuide\.levelKey/);
  assert.match(editorSource, /firstClickGuide\.vehicleId/);
  assert.match(editorSource, /firstClickGuide\.durationSeconds/);
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

  assert.match(editorSource, /firstClickGuide\.enabled', 0, 1, 1, null, 'toggle'/);
  assert.match(editorSource, /type="checkbox" role="switch"/);
  assert.match(editorSource, /const guideKey = path\.split\('\.'\)\[0\]/);
  assert.match(editorSource, /setAtPath\(next, `\$\{guideKey\}\.levelKey`, getAtPath\(next, 'level\.selected'\)\)/);
  assert.match(mainSource, /path\?\.startsWith\('firstClickGuide\.'\)/);
  assert.match(mainSource, /if \(restartOpeningGuide\) reset\(\)/);
  assert.match(editorSource, /document\.createElement\('details'\)/);
  assert.match(editorSource, /editor-section-summary/);
  assert.match(editorSource, /section\.open = Boolean\(group\.defaultOpen\)/);
  assert.match(stylesSource, /\.editor-section\[open\] > \.editor-section-summary/);
});
