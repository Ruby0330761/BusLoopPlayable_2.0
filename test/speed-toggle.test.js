import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { SCENE_TUNING } from '../src/scene-tuning.js';
import { BASE_RUNTIME_ASSET_PATHS, SPEED_TOGGLE_ASSET_PATHS } from '../src/mechanism-resources.js';
import { BusLoopGame } from '../src/game-model.js';
import { LEVEL_1 } from '../src/level-data.js';
import {
  SPEED_TOGGLE_STYLES,
  formatSpeedLabel,
  normalizeSpeedMultiplier,
  normalizeSpeedToggleStyle,
  resolveSpeedToggleIcon,
  resolveTimeScale
} from '../src/speed-toggle.js';

const SPEED_TOGGLE_ASSETS = [
  '/assets/applovin/speed-toggle-bg_q90.webp',
  '/assets/applovin/speed-toggle-icon-normal.png',
  '/assets/applovin/speed-toggle-icon-boost.png',
  '/assets/applovin/speed-toggle-icon-light-normal.png',
  '/assets/applovin/speed-toggle-icon-light-boost.png'
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

test('the light skin prints the numeral first and picks its own badge art', () => {
  // The reference art reads "2x", the original skin has always read "x2", so the
  // label format follows the skin instead of forcing one order on both.
  assert.equal(formatSpeedLabel(2), 'x2');
  assert.equal(formatSpeedLabel(2, 'default'), 'x2');
  assert.equal(formatSpeedLabel(1), 'x1');
  assert.equal(formatSpeedLabel(2, 'light'), '2x');
  assert.equal(formatSpeedLabel(1, 'light'), '1x');
  assert.equal(formatSpeedLabel(1.5, 'light'), '1.5x');

  // A saved profile can predate the skin field or name a skin this build dropped.
  assert.equal(normalizeSpeedToggleStyle(undefined), 'default');
  assert.equal(normalizeSpeedToggleStyle(''), 'default');
  assert.equal(normalizeSpeedToggleStyle('Light'), 'light');
  assert.equal(normalizeSpeedToggleStyle('neon'), 'default');

  assert.match(resolveSpeedToggleIcon('default', false), /speed-toggle-icon-normal\.png$/u);
  assert.match(resolveSpeedToggleIcon('default', true), /speed-toggle-icon-boost\.png$/u);
  assert.match(resolveSpeedToggleIcon('light', false), /speed-toggle-icon-light-normal\.png$/u);
  assert.match(resolveSpeedToggleIcon('light', true), /speed-toggle-icon-light-boost\.png$/u);
  // An unknown style still has to resolve to something drawable.
  assert.match(resolveSpeedToggleIcon('neon', true), /speed-toggle-icon-boost\.png$/u);
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

test('speed toggle tuning keeps its top-right geometry and a valid multiplier', () => {
  const tuning = SCENE_TUNING.speedToggle;
  // The switch is off by default: the progress-bar delivery owns the top-right
  // corner and the button crowded the bar. The geometry and multiplier stay
  // valid so a level that wants it can just flip `enabled` back on.
  assert.equal(tuning.enabled, 0);
  assert.equal(tuning.multiplier, 2);
  // The skin is part of the tuning, so an exported level carries its look; the
  // default has to name a real option or the editor select starts blank.
  assert.ok(SPEED_TOGGLE_STYLES.some((style) => style.value === tuning.style),
    `speedToggle.style ${tuning.style} is not a known skin`);
  assert.ok(tuning.width > 0 && tuning.height > 0);
  // Design space is 1080x2160, so the button's centre sits far right and near
  // the top rather than at the old 84%/14% default.
  assert.ok(tuning.x > 1080 * 0.8, `speedToggle.x ${tuning.x} is not in the right-hand column`);
  assert.ok(tuning.y < 2160 * 0.1, `speedToggle.y ${tuning.y} is not in the top band`);
  for (const path of SPEED_TOGGLE_ASSETS) {
    assert.ok(SPEED_TOGGLE_ASSET_PATHS.includes(path), `${path} must be in the switch's export whitelist`);
    assert.equal(existsSync(new URL(`../public${path}`, import.meta.url)), true, `${path} is missing`);
  }
  // The switch owns its own opt-in list. Keeping it out of the unconditional base
  // list is what stops a delivery that never shows the button from paying ~58 KB.
  for (const path of SPEED_TOGGLE_ASSETS) {
    assert.ok(!BASE_RUNTIME_ASSET_PATHS.includes(path),
      `${path} must not be in the unconditional base runtime assets`);
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
  // The badge starts from a transparent pixel, not a root-relative URL: a build
  // with the switch disabled ships no badge art, and a real src here would make
  // the packager inline (or omit) an image the element can never show.
  assert.match(html, /id="speed-toggle-icon"[^>]*src="data:image\/gif;base64,R0lGOD/u);
  assert.doesNotMatch(html, /speed-toggle-icon-normal\.png/u);
  assert.match(mainSource, /SPEED_TOGGLE_SEED_SRC/u);
  assert.match(html, /id="speed-toggle-label"[^>]*>x1</u);
  assert.match(mainSource, /resolveTimeScale\(\{/u);
  assert.match(mainSource, /delta \* getTimeScale\(\)/u);
  assert.match(mainSource, /setSpeedToggleBoosted\(!speedToggleBoosted\)/u);
  assert.match(mainSource, /speedToggle\?\.enabled/u);
  // The stickiest regression here is the button being treated as a gameplay
  // tap, which would start the AppLovin challenge funnel on an x1/x2 flip.
  assert.match(mainSource, /event\.stopPropagation\(\);\n\s+audio\.unlock\(\);\n\s+setSpeedToggleBoosted/u);
  assert.match(editorSource, /speedToggle\.enabled/u);
  assert.match(editorSource, /speedToggle\.multiplier/u);
  // The skin picker and the runtime it drives.
  assert.match(editorSource, /'speedToggle\.style'/u);
  assert.match(mainSource, /normalizeSpeedToggleStyle\(config\.style\)/u);
  assert.match(mainSource, /speedToggleButton\.dataset\.speedStyle = style/u);
  assert.match(mainSource, /resolveSpeedToggleIcon\(style, speedToggleBoosted\)/u);
  assert.match(stylesSource, /\.speed-toggle\[data-speed-style="light"\]/u);
  // The light skin draws the pill in CSS and only ships the round badge, so the
  // icon has to keep `contain` or the square asset would stretch into an ellipse.
  assert.match(stylesSource, /\.speed-toggle-icon \{[\s\S]*?object-fit: contain/u);
  assert.match(stylesSource, /\.speed-toggle \{/u);
});

test('the speed button maps its design position into the painted scene strip', async () => {
  const mainSource = await readFile(new URL('../src/main.js', import.meta.url), 'utf8');
  // Reported symptom: on a wide (letterboxed) viewport the button landed in the
  // flat-blue margin beside the artwork. Scaling design X across the whole stage
  // is the cause, so the position has to be mapped into the background bounds.
  assert.match(mainSource, /function applySpeedToggleTuning\(backgroundBounds = null\)/u);
  assert.match(mainSource, /boundsLeft \+ centerX \/ metrics\.designWidth \* boundsWidth/u);
  assert.match(mainSource, /boundsTop \+ centerY \/ metrics\.designHeight \* boundsHeight/u);
  // Every call site has to feed the measured bounds, or the edit path silently
  // keeps using the old stage-wide maths.
  const calls = [...mainSource.matchAll(/applySpeedToggleTuning\(([^)]*)\)/gu)]
    .map((match) => match[1].trim())
    .filter((argument) => argument !== 'backgroundBounds = null');
  assert.ok(calls.length >= 2, `expected the resize and edit call sites, saw ${calls.length}`);
  for (const argument of calls) assert.equal(argument, 'backgroundBounds');
});
