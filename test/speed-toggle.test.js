import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { SCENE_TUNING } from '../src/scene-tuning.js';
import { BASE_RUNTIME_ASSET_PATHS } from '../src/mechanism-resources.js';
import { BusLoopGame } from '../src/game-model.js';
import { LEVEL_1 } from '../src/level-data.js';
import { formatSpeedLabel, normalizeSpeedMultiplier, resolveTimeScale } from '../src/speed-toggle.js';

const SPEED_TOGGLE_ASSETS = [
  '/assets/applovin/speed-toggle-bg_q90.webp',
  '/assets/applovin/speed-toggle-icon-normal.png',
  '/assets/applovin/speed-toggle-icon-boost.png'
];

test('speed toggle scales the whole simulation clock and defaults to x1', () => {
  assert.equal(resolveTimeScale({ multiplier: 2, boosted: false }), 1);
  assert.equal(resolveTimeScale({ multiplier: 2, boosted: true }), 2);
  assert.equal(resolveTimeScale({ multiplier: 3.5, boosted: true }), 3.5);
  // A bad configured value must not stop the simulation or freeze it at zero.
  assert.equal(resolveTimeScale({ multiplier: 0, boosted: true }), 2);
  assert.equal(resolveTimeScale({ multiplier: 'nope', boosted: true }), 2);
  assert.equal(normalizeSpeedMultiplier('1.8', 2), 1.8);
  assert.equal(normalizeSpeedMultiplier(-3, 2), 2);
  assert.equal(formatSpeedLabel(2), 'x2');
  assert.equal(formatSpeedLabel(1.75), 'x1.75');
});

test('scaled substeps advance the game twice as far as real time at x2', () => {
  const run = (timeScale) => {
    const game = new BusLoopGame(LEVEL_1);
    game.initializeQueues(
      [8, 8], 0.4, [4, 4], 10,
      { speed: 1, exitStart: 0, exitEnd: 1, slotCount: 1, resetSlots: true }
    );
    let remaining = 1;
    while (remaining > 0) {
      const step = Math.min(remaining, 0.05);
      game.update(step * timeScale);
      remaining -= step;
    }
    return game.snapshot().time;
  };
  // The model clamps a single update to 0.1s, which is why the frame loop feeds
  // scaled time in substeps instead of one large delta.
  assert.equal(run(1), 1);
  assert.equal(run(2), 2);
});

test('speed toggle tuning ships visible in the top-right corner and stays switchable', () => {
  const tuning = SCENE_TUNING.speedToggle;
  // The delivered playables show the difficulty pill at top centre and the
  // play-speed control in the top-right corner, so the switch is on for every
  // export built from this tuning. A tuning object that omits the flag still
  // resolves to hidden -- see the next test.
  assert.equal(tuning.enabled, 1);
  assert.equal(tuning.multiplier, 2);
  assert.ok(tuning.width > 0 && tuning.height > 0);
  // Design space is 1080x2160, so the button's centre sits far right and near
  // the top rather than at the old 84%/14% default.
  assert.ok(tuning.x > 1080 * 0.8, `speedToggle.x ${tuning.x} is not in the right-hand column`);
  assert.ok(tuning.y < 2160 * 0.1, `speedToggle.y ${tuning.y} is not in the top band`);
  for (const path of SPEED_TOGGLE_ASSETS) {
    assert.ok(BASE_RUNTIME_ASSET_PATHS.includes(path), `${path} must be in the export whitelist`);
    assert.equal(existsSync(new URL(`../public${path}`, import.meta.url)), true, `${path} is missing`);
  }
});

test('a missing speedToggle.enabled stays hidden and stale caches are migrated', async () => {
  const mainSource = await readFile(new URL('../src/main.js', import.meta.url), 'utf8');
  // A tuning object without the flag (an older level file, a hand-written
  // profile) must not resurrect the button.
  assert.match(mainSource, /const enabled = Boolean\(config\.enabled \?\? 0\)/u);
  // Every save used to write enabled: 1 as the default, so cached profiles keep
  // it even though the operator never touched the switch. One marker-guarded
  // pass clears both the global cache and every per-level profile.
  assert.match(mainSource, /const SPEED_TOGGLE_HIDDEN_MIGRATION_KEY = 'bus-loop-speed-toggle-hidden-v1'/u);
  assert.match(mainSource, /function migrateSpeedToggleHiddenProfiles\(\)/u);
  assert.match(mainSource, /function applySpeedToggleHiddenMigration\(source\)/u);
  assert.match(mainSource, /migrateSpeedToggleHiddenProfiles\(\);[\s\S]*SPEED_TOGGLE_HIDDEN_MIGRATION_KEY, '1'/u);
});

test('the playable renders the speed button and wires it to the simulation clock', async () => {
  const [html, mainSource, editorSource, stylesSource] = await Promise.all([
    readFile(new URL('../index.html', import.meta.url), 'utf8'),
    readFile(new URL('../src/main.js', import.meta.url), 'utf8'),
    readFile(new URL('../src/scene-editor.js', import.meta.url), 'utf8'),
    readFile(new URL('../src/styles.css', import.meta.url), 'utf8')
  ]);

  assert.match(html, /id="speed-toggle"/u);
  assert.match(html, /speed-toggle-icon-normal\.png/u);
  assert.match(html, /id="speed-toggle-label"[^>]*>x1</u);
  assert.match(mainSource, /resolveTimeScale\(\{/u);
  assert.match(mainSource, /delta \* getTimeScale\(\)/u);
  assert.match(mainSource, /setSpeedToggleBoosted\(!speedToggleBoosted\)/u);
  assert.match(mainSource, /speedToggle\?\.enabled/u);
  // The stickiest regression here is the button being treated as a gameplay
  // tap, which would start the AppLovin challenge funnel on an x1/x2 flip.
  assert.match(mainSource, /event\.stopPropagation\(\);\r?\n\s+audio\.unlock\(\);\r?\n\s+setSpeedToggleBoosted/u);
  assert.match(editorSource, /speedToggle\.enabled/u);
  assert.match(editorSource, /speedToggle\.multiplier/u);
  assert.match(stylesSource, /\.speed-toggle \{/u);
});
