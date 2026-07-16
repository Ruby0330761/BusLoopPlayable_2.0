import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { SCENE_TUNING } from '../src/scene-tuning.js';

test('guide hand targets vehicle 89 with timed editable mask highlight', async () => {
  const tuning = SCENE_TUNING.vehicleGuideHand;
  const firstClickGuide = SCENE_TUNING.firstClickGuide;
  const mainSource = await readFile(new URL('../src/main.js', import.meta.url), 'utf8');
  const editorSource = await readFile(new URL('../src/scene-editor.js', import.meta.url), 'utf8');
  const viewSource = await readFile(new URL('../src/scene-view.js', import.meta.url), 'utf8');

  assert.equal(tuning.vehicleId, 89);
  assert.equal(tuning.offsetX, 0.38);
  assert.equal(tuning.approachOffsetX, 0.62);
  assert.equal(firstClickGuide.enabled, 1);
  assert.equal(firstClickGuide.vehicleId, 89);
  assert.equal(firstClickGuide.durationSeconds, 2);
  assert.equal(firstClickGuide.maskOpacity, 0.8);
  assert.equal(firstClickGuide.holeScaleX, 1);
  assert.equal(firstClickGuide.holeScaleY, 1);
  assert.match(viewSource, /texture\.wrapS = THREE\.RepeatWrapping/);
  assert.match(viewSource, /texture\.repeat\.x = -1/);
  assert.match(viewSource, /texture\.offset\.x = 1/);
  assert.match(viewSource, /createFirstClickGuideMask/);
  assert.match(viewSource, /updateFirstClickGuideMask/);
  assert.match(viewSource, /first-click-guide-mask/);
  assert.match(viewSource, /durationSeconds/);
  assert.match(viewSource, /holeScaleX/);
  assert.match(viewSource, /holeScaleY/);
  assert.doesNotMatch(mainSource, /guide-locked/);
  assert.doesNotMatch(mainSource, /getActiveFirstClickGuideTargetId/);
  assert.match(editorSource, /firstClickGuide\.enabled/);
  assert.match(editorSource, /firstClickGuide\.vehicleId/);
  assert.match(editorSource, /firstClickGuide\.durationSeconds/);
  assert.match(editorSource, /firstClickGuide\.maskOpacity/);
  assert.match(editorSource, /firstClickGuide\.holeScaleX/);
  assert.match(editorSource, /firstClickGuide\.holeScaleY/);
});
