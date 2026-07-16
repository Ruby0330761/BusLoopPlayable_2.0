import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { SCENE_TUNING } from '../src/scene-tuning.js';

test('guide hand targets vehicle 130 with mirrored art and motion', async () => {
  const tuning = SCENE_TUNING.vehicleGuideHand;
  const viewSource = await readFile(new URL('../src/scene-view.js', import.meta.url), 'utf8');

  assert.equal(tuning.vehicleId, 130);
  assert.equal(tuning.offsetX, 0.38);
  assert.equal(tuning.approachOffsetX, 0.62);
  assert.match(viewSource, /texture\.wrapS = THREE\.RepeatWrapping/);
  assert.match(viewSource, /texture\.repeat\.x = -1/);
  assert.match(viewSource, /texture\.offset\.x = 1/);
});
