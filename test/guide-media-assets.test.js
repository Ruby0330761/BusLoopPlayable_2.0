import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

import {
  WEATHER_MODES,
  DEFAULT_WEATHER_CONFIG,
  normalizeWeatherConfig
} from '../src/weather-effect.js';
import {
  FREE_ASSET_LAYER_LIMIT,
  normalizeFreeAssetConfig,
  normalizeFreeAssetLayer
} from '../src/free-asset-layers.js';
import { SCENE_TUNING } from '../src/scene-tuning.js';

const weatherSource = await readFile(new URL('../src/weather-effect.js', import.meta.url), 'utf8');
const freeSource = await readFile(new URL('../src/free-asset-layers.js', import.meta.url), 'utf8');
const vizeSource = await readFile(new URL('../vite.config.js', import.meta.url), 'utf8');
const editorSource = await readFile(new URL('../src/scene-editor.js', import.meta.url), 'utf8');
const mainSource = await readFile(new URL('../src/main.js', import.meta.url), 'utf8');
const exporterSource = await readFile(new URL('../scripts/export-playable-package.mjs', import.meta.url), 'utf8');

test('weather effect ships the four authored modes and is off by default', () => {
  assert.deepEqual(WEATHER_MODES.map(([mode]) => mode), ['rain', 'snow', 'wind', 'leaf']);
  assert.equal(DEFAULT_WEATHER_CONFIG.enabled, 0);
  assert.equal(SCENE_TUNING.weatherEffect.enabled, 0);
  assert.equal(SCENE_TUNING.weatherEffect.mode, 'rain');
});

test('weather config normalizes every authored knob into a safe range', () => {
  const tuned = normalizeWeatherConfig({
    enabled: 1, mode: 'snow', intensity: 2.5, speed: 1.4,
    size: 0.8, opacity: 0.5, windX: -0.4, color: 0xff0000
  });
  assert.equal(tuned.enabled, 1);
  assert.equal(tuned.mode, 'snow');
  assert.equal(tuned.intensity, 2.5);
  assert.equal(tuned.windX, -0.4);
  assert.equal(tuned.color, 0xff0000);
  // Unknown modes fall back instead of rendering nothing.
  assert.equal(normalizeWeatherConfig({ mode: 'meteor' }).mode, 'rain');
  // Out-of-range values clamp rather than throw, so an old profile still plays.
  assert.equal(normalizeWeatherConfig({ intensity: 99 }).intensity, 4);
  assert.equal(normalizeWeatherConfig({ opacity: -3 }).opacity, 0);
  assert.equal(normalizeWeatherConfig({ speed: 0 }).speed, 0.1);
  assert.equal(normalizeWeatherConfig({ color: 0x1000000 }).color, 0xffffff);
});

test('the weather overlay draws above the canvas and can use an uploaded sprite', () => {
  // Screen-space overlay, not a THREE particle system.
  assert.match(weatherSource, /createWeatherEffect/);
  assert.match(weatherSource, /export function createWeatherEffect/);
  assert.match(weatherSource, /canvas\.className = 'weather-effect-canvas'/);
  assert.match(weatherSource, /if \(sprite\) \{/);
  assert.match(weatherSource, /image\.src = source/);
  // Wrapping keeps a steady field density instead of emptying out.
  assert.match(weatherSource, /if \(particle\.y > height \+ 40\)/);
});

test('free-asset layers carry position, size, opacity, rotation and a lock flag', () => {
  const layer = normalizeFreeAssetLayer({
    id: 'hero', asset: '/assets/editor-free-assets/a.png', x: 120, y: 340,
    width: 200, height: 90, opacity: 0.6, rotation: 15, locked: 1, visible: 0
  });
  assert.deepEqual(layer, {
    id: 'hero',
    asset: '/assets/editor-free-assets/a.png',
    label: '',
    x: 120,
    y: 340,
    width: 200,
    height: 90,
    opacity: 0.6,
    rotation: 15,
    locked: 1,
    visible: 0
  });
  // Defaults land in the middle of the 1080x2160 design space.
  const fallback = normalizeFreeAssetLayer({});
  assert.equal(fallback.id, 'layer-1');
  assert.equal(fallback.x, 540);
  assert.equal(fallback.y, 1080);
  assert.equal(fallback.visible, 1);
  assert.equal(fallback.locked, 0);
});

test('the free-asset layer list is bounded so a tuning payload stays exportable', () => {
  const layers = Array.from({ length: FREE_ASSET_LAYER_LIMIT + 10 }, (_, index) => ({ id: `l${index}` }));
  assert.equal(normalizeFreeAssetConfig({ layers }).layers.length, FREE_ASSET_LAYER_LIMIT);
  assert.equal(normalizeFreeAssetConfig({ layers: 'nope' }).layers.length, 0);
  assert.deepEqual(SCENE_TUNING.freeAssets, { layers: [] });
});

test('a locked layer stops accepting drags while staying visible', () => {
  // The drag handler exits early on a locked layer; the image is still drawn.
  assert.match(freeSource, /element\.style\.pointerEvents = layer\.locked \? 'none' : 'auto'/);
  assert.match(freeSource, /if \(activePointerId == null \|\| activeLayerId !== layer\.id\) return/);
  assert.match(freeSource, /element\.hidden = !layer\.visible/);
});

test('the editor offers upload, download and delete for all three libraries', () => {  // One factory serves bgm/weather/free so the three panels cannot drift apart.
  assert.match(editorSource, /function createGuideAssetPanel/);
  assert.match(editorSource, /const endpoint = `\/__guide-assets\/\$\{kind\}`/);
  // Both library-backed panels are wired through that factory.
  assert.match(editorSource, /kind: 'bgm'/);
  assert.match(editorSource, /kind: 'weather'/);
  // Free-asset layers are a list of draggable layers, not a single selection,
  // so they talk to the same route directly.
  assert.match(editorSource, /\/__guide-assets\/free\/import/);
  assert.match(editorSource, /editor-guide-asset-import/);
  assert.match(editorSource, /editor-guide-asset-download/);
  assert.match(editorSource, /editor-guide-asset-delete/);
  assert.match(editorSource, /editor-free-asset-lock/);
  // The BGM picker is fed from the library, so an upload becomes selectable.
  assert.match(editorSource, /selectPath: 'audio\.bgm\.asset'/);
  assert.match(editorSource, /selectPath: 'weatherEffect\.sprite'/);
  // Uploading an entry-banner plate goes through the same factory and also flips
  // the style that renders it, so the upload is visible without a second step.
  assert.match(editorSource, /kind: 'banner'/);
  assert.match(editorSource, /selectPath: 'entryBanner\.customAsset'/);
  assert.match(editorSource, /setAtPath\(next, 'entryBanner\.style', 'custom'\)/);
});

test('the runtime mounts both overlays inside the stage and renders weather each frame', () => {
  assert.match(mainSource, /createWeatherEffect\(stage/);
  assert.match(mainSource, /mountFreeAssetLayers\(stage/);
  assert.match(mainSource, /syncStageOverlays\(\)/);
  // Weather follows the game clock so the x1/x2 toggle speeds it up too.
  assert.match(mainSource, /weatherEffect\.render\(delta \* getTimeScale\(\)\)/);
  // Dragging a layer writes back to the level's tuning.
  assert.match(mainSource, /path: `freeAssets\.layers\.\$\{index\}\.position`/);
});

test('the editor serves a list/import/rename/delete library per kind', () => {
  assert.match(vizeSource, /GUIDE_ASSET_LIBRARIES/);
  assert.match(vizeSource, /editor-bgm/);
  assert.match(vizeSource, /editor-effects/);
  assert.match(vizeSource, /editor-free-assets/);
  assert.match(vizeSource, /editor-banners/);
  assert.match(vizeSource, /\/\^\\\/__guide-assets\\\/\(bgm\|weather\|free\|banner\)/);
  // Only the declared extensions get through, and path traversal is rejected.
  assert.match(vizeSource, /if \(!library\.extensions\.includes\(ext\) \|\| path\.basename\(filename\) !== filename\)/);
  // Audio needs Range support so a browser can preview/seek a long track.
  assert.match(vizeSource, /Accept-Ranges/);
});

test('the exporter copies only the guide assets a level references', () => {
  assert.match(exporterSource, /copySelectedGuideAssets/);
  assert.match(exporterSource, /GUIDE_ASSET_SOURCES/);
  assert.match(exporterSource, /tuning\.audio\.bgm\.asset/);
  assert.match(exporterSource, /tuning\.weatherEffect\.sprite/);
  assert.match(exporterSource, /tuning\?\.freeAssets\?\.layers/);
  // A custom entry-banner plate lives in its own library and must be staged with
  // the other tuning-addressed media.
  assert.match(exporterSource, /getEntryBannerArt\(banner\)\.card/);
  // A referenced-but-missing file has to fail loudly instead of shipping a
  // package that silently loses its artwork.
  assert.match(exporterSource, /Guide asset is referenced but missing from the editor volume/);
});

test('the guide tab owns the sound groups, not the visual tab', () => {
  // Sound setup belongs with the opening beat. Before this, every `audio.*`
  // group fell through to the visual tab, so the BGM library panel looked
  // missing when an operator opened 引导.
  const mapper = /function editorCategoryForGroup\(group\) \{[\s\S]*?\n\}/.exec(editorSource)?.[0] ?? '';
  assert.match(mapper, /\|audio\)\\\./, 'the guide prefix list must include audio');
  // The BGM section is looked up by its tuning row, which lives on the guide tab
  // once the mapping above is in place.
  assert.match(editorSource, /inputs\.get\('audio\.bgm\.asset'\)\?\.row\.closest\('\.editor-section'\)/);
  assert.match(editorSource, /title: '\\u80cc\\u666f\\u97f3\\u4e50\(BGM\)'/);
});

test('the packager inlines the weather sprite and every free-asset layer', async () => {
  const [packager, inlineAssets] = await Promise.all([
    readFile(new URL('../scripts/package-applovin-single-html.mjs', import.meta.url), 'utf8'),
    readFile(new URL('../src/playable-inline-assets.js', import.meta.url), 'utf8')
  ]);
  // Both are addressed from tuning only, so they need an explicit whitelist
  // entry; the level-document scan cannot see them. The whitelist lives in the
  // shared inline-asset module so the editor's size preflight sees them too.
  assert.match(inlineAssets, /tuning\.weatherEffect\?\.enabled/);
  assert.match(inlineAssets, /urls\.add\(tuning\.weatherEffect\.sprite\)/);
  assert.match(inlineAssets, /tuning\.freeAssets\?\.layers/);
  assert.match(inlineAssets, /urls\.add\(layer\.asset\)/);
  assert.match(packager, /collectPlayableInlineAssetUrls\(\{[\s\S]*?tuning: SCENE_TUNING/u);
});

test('a disabled weather effect does not request its sprite', () => {
  // The packager only inlines the sprite of an enabled effect, so loading it
  // while off would ship a request the single-file ad cannot answer.
  assert.match(weatherSource, /if \(Number\(config\.enabled\) && config\.sprite !== spriteSource\) loadSprite/);
});

test('export accepts real free-asset layers even though the template list is empty', async () => {
  const { validateTuning } = await import('../scripts/export-playable-package.mjs');
  const layer = {
    id: 'l1', asset: '/assets/editor-free-assets/a.webp', label: 'a',
    x: 540, y: 1080, width: 300, height: 300, opacity: 1, rotation: 0, locked: 0, visible: 1
  };
  assert.deepEqual(
    validateTuning({ freeAssets: { layers: [layer] } }, SCENE_TUNING).freeAssets.layers,
    [layer]
  );
  // The template must stay empty so the editor never inherits a phantom layer.
  assert.deepEqual(SCENE_TUNING.freeAssets.layers, []);
  assert.throws(
    () => validateTuning({ freeAssets: { layers: [{ asset: '/a.png', bogus: 1 }] } }, SCENE_TUNING),
    /not supported/
  );
  assert.throws(
    () => validateTuning({ freeAssets: { layers: [{ asset: '/a.png', width: 1 }] } }, SCENE_TUNING),
    /width must be between/
  );
  assert.throws(
    () => validateTuning({ freeAssets: { layers: [{ asset: '' }] } }, SCENE_TUNING),
    /asset is required/
  );
});
