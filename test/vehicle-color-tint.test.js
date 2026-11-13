import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

import { PNG } from 'pngjs';

import {
  dominantOpaqueColor,
  hexToRgb,
  normalizeTintOverrides,
  resolveTintReference,
  rgbToHex,
  shadePixelToPaint,
  tintAtlasPixels
} from '../src/vehicle-color-tint.js';
import { COLORS } from '../src/level-data.js';
import { COLOR_ATLAS_PATHS } from '../src/color-atlases.js';

const ATLAS_DIR = 'public/assets/unity/textures';
const ATLAS_FILES = readdirSync(ATLAS_DIR);
const atlasCache = new Map();

/** The shipped atlas PNG for a paint slot, or null when the slot has none. */
function atlasFileFor(colorIndex) {
  if (!COLOR_ATLAS_PATHS[colorIndex]) return null;
  const name = ATLAS_FILES.find((file) => file.startsWith(`color_${colorIndex}_`) && file.endsWith('.png'));
  return name ? `${ATLAS_DIR}/${name}` : null;
}

function loadAtlas(colorIndex) {
  // Decoding a 512x512 PNG is the slow part; these tests repaint the same
  // atlases repeatedly, so decode once and hand out a fresh pixel copy.
  if (!atlasCache.has(colorIndex)) {
    const file = atlasFileFor(colorIndex);
    if (!file) {
      atlasCache.set(colorIndex, null);
    } else {
      const png = PNG.sync.read(readFileSync(file));
      atlasCache.set(colorIndex, { png, pixels: Uint8ClampedArray.from(png.data) });
    }
  }
  const cached = atlasCache.get(colorIndex);
  if (!cached) return null;
  return { png: cached.png, data: Uint8ClampedArray.from(cached.pixels) };
}

const PAINT_SLOTS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 17, 18, 19, 20, 21, 22, 23, 24, 25];

function maxChannelDelta(left, right, alphaMask) {
  let worst = 0;
  let changedPixels = 0;
  for (let offset = 0; offset < left.length; offset += 4) {
    if (alphaMask[offset + 3] < 250) continue;
    const delta = Math.max(
      Math.abs(left[offset] - right[offset]),
      Math.abs(left[offset + 1] - right[offset + 1]),
      Math.abs(left[offset + 2] - right[offset + 2])
    );
    if (delta > 0) changedPixels += 1;
    if (delta > worst) worst = delta;
  }
  return { worst, changedPixels };
}

/** The modal opaque pixel, i.e. what a repaint should make the body colour. */
function modalOpaqueColor(data) {
  return rgbToHex(dominantOpaqueColor(data));
}

test('repainting an atlas with its own body colour changes nothing', () => {
  // This is the contract that makes a per-vehicle body override equal to the
  // built-in atlas: the editor stores paint values, so overriding the blue slot
  // with the blue slot's own paint has to be a no-op. When it was not, the same
  // car looked like two different colours depending on which path drew it.
  for (const colorIndex of PAINT_SLOTS) {
    const atlas = loadAtlas(colorIndex);
    assert.ok(atlas, `atlas slot ${colorIndex} should ship a PNG to repaint`);
    const reference = dominantOpaqueColor(atlas.data);
    assert.ok(reference, `slot ${colorIndex} must have an opaque body`);
    const before = Uint8ClampedArray.from(atlas.data);
    tintAtlasPixels(atlas.data, { reference, overrides: { body: rgbToHex(reference) } });
    const { worst } = maxChannelDelta(atlas.data, before, before);
    assert.equal(worst, 0, `slot ${colorIndex} self-repaint must be pixel-identical`);
  }
});

test('a body override lands exactly on the requested paint', () => {
  // The repainted body must read as the authored paint, not as a blend of it.
  const cases = [
    { colorIndex: 0, paint: '#8f1d2c' },
    { colorIndex: 4, paint: '#8f1d2c' },
    { colorIndex: 7, paint: '#c9363e' },
    { colorIndex: 18, paint: '#124832' },
    { colorIndex: 21, paint: '#fff9ef' },
    { colorIndex: 25, paint: '#c9363e' }
  ];
  for (const { colorIndex, paint } of cases) {
    const atlas = loadAtlas(colorIndex);
    assert.ok(atlas, `slot ${colorIndex} needs an atlas`);
    const reference = dominantOpaqueColor(atlas.data);
    tintAtlasPixels(atlas.data, { reference, overrides: { body: paint } });
    assert.equal(
      modalOpaqueColor(atlas.data),
      paint.toLowerCase(),
      `slot ${colorIndex} body should become ${paint}`
    );
  }
});

test('recolouring a neutral (black/white/grey) atlas still repaints its body', () => {
  // The neutral slots have no hue to match against, so the body test falls back
  // to luma. Anchoring on COLORS[17] (#2d2d30) instead of the atlas's real body
  // (#101010) left the body pixels classified as glass, and the car kept its old
  // colour no matter what the operator picked.
  const black = loadAtlas(17);
  assert.ok(black, 'the black slot ships an atlas');
  const reference = dominantOpaqueColor(black.data);
  assert.deepEqual(reference, [16, 16, 16], 'the black atlas body is #101010, not the catalog #2d2d30');
  tintAtlasPixels(black.data, { reference, overrides: { body: '#218c4a' } });
  assert.equal(modalOpaqueColor(black.data), '#218c4a');

  // White and cream are neutral too.
  for (const [colorIndex, paint] of [[18, '#124832'], [21, '#fff9ef']]) {
    const atlas = loadAtlas(colorIndex);
    const body = dominantOpaqueColor(atlas.data);
    tintAtlasPixels(atlas.data, { reference: body, overrides: { body: paint } });
    assert.equal(modalOpaqueColor(atlas.data), paint, `slot ${colorIndex} should repaint to ${paint}`);
  }
});

test('shading survives a repaint instead of flattening to one flat colour', () => {
  // A flat hue replacement erased the atlas's baked highlight and shadow bands,
  // so a recoloured car read as a sticker next to its neighbours. The repaint
  // must keep distinct light/dark pixels on the body.
  const atlas = loadAtlas(0);
  const reference = dominantOpaqueColor(atlas.data);
  tintAtlasPixels(atlas.data, { reference, overrides: { body: '#8f1d2c' } });
  const tones = new Set();
  for (let offset = 0; offset < atlas.data.length; offset += 4) {
    if (atlas.data[offset + 3] < 250) continue;
    // Only look at pixels close to the new paint's hue family.
    const [r, g, b] = [atlas.data[offset], atlas.data[offset + 1], atlas.data[offset + 2]];
    if (r > 60 && r > g && r > b) tones.add(`${r >> 3}:${g >> 3}:${b >> 3}`);
  }
  assert.ok(tones.size >= 4, `repaint should keep several shading tones, got ${tones.size}`);
});

test('the shading scale is bounded so a near-black body cannot blow out', () => {
  const nearBlack = [2, 2, 2];
  const anchor = [255, 255, 255];
  const [r] = shadePixelToPaint([40, 40, 40], nearBlack, anchor);
  assert.ok(r <= 255, 'channel stays inside 8-bit range');
  // The unbounded ratio here is 127x, which would saturate every channel.
  const bounded = shadePixelToPaint([4, 4, 4], nearBlack, anchor);
  assert.ok(bounded.every((channel) => channel <= 255), 'bounded scale keeps the buffer valid');
});

test('tint input handling rejects malformed colours and unknown regions', () => {
  assert.deepEqual(normalizeTintOverrides({ body: '#AABBCC', wheel: '#ffffff' }), { body: '#AABBCC' });
  assert.deepEqual(normalizeTintOverrides({ body: 'red', highlight: '#12' }), {});
  assert.deepEqual(normalizeTintOverrides(null), {});
  assert.equal(hexToRgb('#0061e8').length, 3);
  assert.equal(hexToRgb('nope'), null);
});

test('the tint reference prefers the measured atlas body over the catalog value', () => {
  // The catalog carries swatches that are not always what the atlas stores.
  const measured = resolveTintReference(hexToRgb(COLORS[17].css), [16, 16, 16]);
  assert.deepEqual(measured, [16, 16, 16]);
  // Without a measurement it still returns a usable array.
  assert.deepEqual(resolveTintReference(hexToRgb(COLORS[0].css), null), hexToRgb(COLORS[0].css));
});

test('every shipped override keeps the hue the level author chose', () => {
  // Real overrides from the committed level documents. The repaint must land on
  // the authored value rather than shifting it, or the Q24/Q159 boards change
  // colour when this code runs.
  const cases = [
    [4, '#8f1d2c'], [2, '#c9363e'], [1, '#218c4a'], [8, '#124832'], [21, '#fff9ef'],
    [1, '#1a6026'], [4, '#bc0609'], [6, '#df560c'], [18, '#f8c332'], [21, '#d87310']
  ];
  for (const [colorIndex, paint] of cases) {
    const atlas = loadAtlas(colorIndex);
    assert.ok(atlas, `slot ${colorIndex} needs an atlas`);
    const reference = dominantOpaqueColor(atlas.data);
    tintAtlasPixels(atlas.data, { reference, overrides: { body: paint } });
    assert.equal(modalOpaqueColor(atlas.data), paint, `override ${paint} on slot ${colorIndex}`);
  }
});

test('scene-view tints through the shared model instead of its own copy', () => {
  // The tint used to live inside scene-view.js with its own HSV maths, which is
  // how it drifted from the authoring palette. It must stay in the tested module.
  const source = readFileSync('src/scene-view.js', 'utf8');
  assert.match(source, /from '\.\/vehicle-color-tint\.js'/, 'scene-view must import the tint model');
  assert.match(source, /tintAtlasPixels\(/, 'scene-view must call the shared repaint');
  assert.match(source, /dominantOpaqueColor\(/, 'scene-view must measure the atlas body as its reference');
  // The old inline HSV replacement is gone.
  assert.doesNotMatch(source, /const sourceHsv = rgbHue\(source\)/, 'the inline HSV tint must be removed');
});
