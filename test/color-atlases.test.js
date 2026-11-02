import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  COLOR_ATLAS_PATHS,
  isColorAtlasTableComplete,
  resolveColorAtlasPaths
} from '../src/color-atlases.js';
import { LEVEL_1, setActiveLevel } from '../src/level-data.js';
import { LEVEL_CATALOG } from '../src/level-catalog.js';

// The remote editor mounts a data volume at /app/artifacts and points the level
// catalog at it, and that volume is seeded once and never reseeded. Exports made
// there therefore read a catalog written before the colour supplement existed:
// eleven atlases, with no slot 17 (black) or 18 (white). The level data still
// used those indices, the renderer fell back to index 0, and every black and
// white car shipped blue. These tests pin the slot table and the completion
// path that makes a level immune to catalog age.

test('canonical colour atlas table covers every paint index and leaves special slots empty', () => {
  assert.equal(COLOR_ATLAS_PATHS.length, 26);
  for (let index = 0; index <= 10; index += 1) {
    assert.match(COLOR_ATLAS_PATHS[index], new RegExp(`color_${index}_[a-z]+_q85\\.webp$`));
  }
  assert.deepEqual(COLOR_ATLAS_PATHS.slice(11, 17), Array(6).fill(null));
  for (let index = 17; index <= 25; index += 1) {
    assert.match(COLOR_ATLAS_PATHS[index], new RegExp(`color_${index}_[a-z]+_q85\\.webp$`));
  }
  assert.match(COLOR_ATLAS_PATHS[17], /color_17_black_q85\.webp$/);
  assert.match(COLOR_ATLAS_PATHS[18], /color_18_white_q85\.webp$/);
});

test('a pre-supplement catalog table is completed instead of falling back to blue', () => {
  const stale = COLOR_ATLAS_PATHS.slice(0, 11);
  // This is the exact table an old catalog produced: 11 entries, indices 17-25
  // absent. Without completion the renderer reads undefined and uses slot 0.
  assert.equal(stale[17], undefined);
  assert.equal(stale[18], undefined);
  assert.equal(isColorAtlasTableComplete(stale), false);

  const completed = resolveColorAtlasPaths(stale);
  assert.equal(completed.length, 26);
  assert.equal(completed[17], COLOR_ATLAS_PATHS[17]);
  assert.equal(completed[18], COLOR_ATLAS_PATHS[18]);
  assert.equal(isColorAtlasTableComplete(completed), true);
  // Slots the level already supplied are preserved, not overwritten.
  for (let index = 0; index <= 10; index += 1) assert.equal(completed[index], stale[index]);
});

test('an explicit level atlas path wins over the canonical fallback', () => {
  const custom = Array.from({ length: 26 }, (_unused, index) => (
    index === 17 ? '/assets/custom/black_variant.webp' : COLOR_ATLAS_PATHS[index]
  ));
  assert.equal(resolveColorAtlasPaths(custom)[17], '/assets/custom/black_variant.webp');
  assert.equal(resolveColorAtlasPaths(custom)[18], COLOR_ATLAS_PATHS[18]);
});

test('activating a legacy level completes its colour slots', () => {
  const legacy = {
    ...LEVEL_CATALOG.level5,
    assets: {
      ...LEVEL_CATALOG.level5.assets,
      colorTextures: COLOR_ATLAS_PATHS.slice(0, 11)
    }
  };
  const activated = setActiveLevel(legacy);
  assert.equal(activated.assets.colorTextures.length, 26);
  assert.equal(activated.assets.colorTextures[17], COLOR_ATLAS_PATHS[17]);
  assert.equal(activated.assets.colorTextures[18], COLOR_ATLAS_PATHS[18]);
  assert.equal(LEVEL_1.assets.colorTextures[17], COLOR_ATLAS_PATHS[17]);
});

test('every production stage carries a complete colour table', async () => {
  const { PLAYABLE_LEVEL_SEQUENCE } = await import('../src/generated-active-level.js');
  for (const level of PLAYABLE_LEVEL_SEQUENCE) {
    const table = level.assets.colorTextures;
    assert.ok(Array.isArray(table), `${level.key} must expose colorTextures`);
    assert.equal(
      isColorAtlasTableComplete(table),
      true,
      `${level.key} must cover every colour index its vehicles use (catalog-independent)`
    );
    const used = new Set(level.vehicles.map((vehicle) => vehicle.colorIndex));
    for (const colorIndex of used) {
      if (colorIndex > 10 && (colorIndex < 17 || colorIndex > 25)) continue;
      assert.ok(
        table[colorIndex],
        `${level.key} uses colour ${colorIndex} but has no atlas for it`
      );
    }
  }
});

test('the production generator completes colour atlases for catalog and web levels', () => {
  const generator = readFileSync('scripts/generate-active-level.mjs', 'utf8');
  assert.match(generator, /from '\.\.\/src\/color-atlases\.js'|color-atlases/);
  assert.match(generator, /completeColorAtlases/);
  // Both resolution paths must pass through the completion helper, which now
  // also completes the level's sound list.
  assert.ok(
    (generator.match(/return completeLevelAssets\(/g) ?? []).length >= 2,
    'both the web-level and catalog paths must complete the level assets'
  );
  assert.match(generator, /completeLevelAudio\(completeColorAtlases\(level\)\)/);
});

test('the runtime also completes the table so editor previews cannot fall back', () => {
  const levelDataSource = readFileSync('src/level-data.js', 'utf8');
  assert.match(levelDataSource, /resolveColorAtlasPaths/);
  assert.match(levelDataSource, /withCompleteLevelAssets\(ACTIVE_LEVEL\)/);
  assert.match(levelDataSource, /LEVEL_1 = withCompleteLevelAssets\(level\)/);
});
