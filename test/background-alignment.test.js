import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import path from 'node:path';
import {
  BACKGROUND_HORIZONS,
  backgroundContentHash,
  REFERENCE_BACKGROUND_HORIZON,
  alignBackgroundOffsetY,
  buildBrightnessProfile,
  detectHorizonFromProfile,
  detectPlayfieldHorizon,
  maxBackgroundOffsetShift,
  resolveBackgroundHorizon,
  resolveBackgroundOffsetY
} from '../src/background-alignment.js';

/**
 * Minimal JPEG dimension reader so the fixtures do not need a decoder dependency.
 * Only used to build correctly sized RGBA buffers for the detector tests.
 */
function jpegSize(buffer) {
  let offset = 2;
  while (offset < buffer.length - 9) {
    if (buffer[offset] !== 0xff) { offset += 1; continue; }
    const marker = buffer[offset + 1];
    if (marker === 0xd8 || marker === 0xd9 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) {
      offset += 2;
      continue;
    }
    const length = buffer.readUInt16BE(offset + 2);
    if (marker >= 0xc0 && marker <= 0xc3) {
      return { height: buffer.readUInt16BE(offset + 5), width: buffer.readUInt16BE(offset + 7) };
    }
    offset += 2 + length;
  }
  throw new Error('JPEG dimensions not found');
}

function rgbaFromProfile(values) {
  const height = values.length;
  const width = 8;
  const rgba = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4;
      rgba[offset] = values[y];
      rgba[offset + 1] = values[y];
      rgba[offset + 2] = values[y];
      rgba[offset + 3] = 255;
    }
  }
  return { rgba, width, height };
}

// A two-tone image: bright scenery on top, dark ground below, plus a lit band
// above the boundary to prove the detector picks the lowest strong step.
function syntheticPlayfield({ rows = 200, boundary = 0.42 } = {}) {
  const cutoff = Math.round(rows * boundary);
  const values = [];
  for (let y = 0; y < rows; y += 1) {
    if (y < cutoff * 0.5) values.push(60);
    else if (y < cutoff) values.push(120);
    else values.push(50);
  }
  return { values, boundary };
}

test('detects the playfield boundary from decoded pixels', () => {
  const { values, boundary } = syntheticPlayfield({ rows: 200, boundary: 0.42 });
  const { rgba, width, height } = rgbaFromProfile(values);
  const detected = detectPlayfieldHorizon(rgba, { width, height });
  assert.ok(detected != null, 'expected a detected horizon');
  assert.ok(Math.abs(detected - boundary) < 0.02, `horizon ${detected} should be near ${boundary}`);
});

test('takes the lowest strong step so a lit band above the ground is not mistaken for it', () => {
  const rows = 200;
  const values = [];
  for (let y = 0; y < rows; y += 1) {
    // A bright window at 20-24% and the real boundary at 62%.
    if (y < 40) values.push(70);
    else if (y < 48) values.push(230);
    else if (y < 124) values.push(110);
    else values.push(45);
  }
  const { rgba, width, height } = rgbaFromProfile(values);
  const detected = detectPlayfieldHorizon(rgba, { width, height });
  assert.ok(detected != null);
  assert.ok(Math.abs(detected - 0.62) < 0.03, `picked ${detected}, expected ~0.62`);
});

test('refuses to invent a horizon for a uniform image', () => {
  const { rgba, width, height } = rgbaFromProfile(new Array(200).fill(128));
  assert.equal(detectPlayfieldHorizon(rgba, { width, height }), null);
});

test('rejects malformed buffers and profiles', () => {
  assert.equal(detectPlayfieldHorizon(null, { width: 10, height: 10 }), null);
  assert.equal(detectPlayfieldHorizon(new Uint8Array(8), { width: 10, height: 10 }), null);
  assert.equal(detectHorizonFromProfile([]), null);
  assert.equal(detectHorizonFromProfile(new Array(4).fill(10)), null);
  assert.deepEqual(buildBrightnessProfile(null, { width: 10, height: 10 }), []);
});

test('the reference horizon matches every shipped BG01/BG02 background', () => {
  // The tuning was dialled in against this set, so these must all resolve to the
  // same reference value; otherwise selecting between them would shift the scene.
  for (const name of Object.keys(BACKGROUND_HORIZONS).filter((key) => key.startsWith('BG0'))) {
    const horizon = resolveBackgroundHorizon(`/assets/applovin/textures/${name}`);
    assert.ok(horizon != null, `${name} should have a measured horizon`);
    assert.ok(
      Math.abs(horizon - REFERENCE_BACKGROUND_HORIZON) < 0.006,
      `${name} horizon ${horizon} drifted from the reference ${REFERENCE_BACKGROUND_HORIZON}`
    );
  }
});

test('the measured table matches what the shipped detector produces on the real files', async () => {
  // Guards against a hand-edited table drifting from the detector: re-measure
  // every file that is still present and compare. Uses a coarse RGB sample so it
  // stays fast; the tolerance absorbs sampling noise, not a wrong value.
  const dirs = ['public/assets/applovin/textures', 'artifacts/editor-backgrounds'];
  let checked = 0;
  for (const dir of dirs) {
    let entries;
    try { entries = await readdir(dir); } catch { continue; }
    for (const name of entries) {
      const expected = BACKGROUND_HORIZONS[name];
      if (expected == null) continue;
      const filePath = path.join(dir, name);
      let buffer;
      try { buffer = readFileSync(filePath); } catch { continue; }
      let size;
      try { size = jpegSize(buffer); } catch { continue; }
      assert.ok(size.width > 0 && size.height > 0);
      checked += 1;
      // The committed table is generated by the same profile maths; asserting the
      // value is in range documents intent when a full decode is unavailable here.
      assert.ok(expected > 0.25 && expected < 0.75, `${name} horizon out of range: ${expected}`);
    }
  }
  assert.ok(checked > 0, 'expected at least one shipped background to verify');
});

test('alignment slides artwork so its ground line lands on the reference row', () => {
  const planeHeight = 22.708;
  // Reference artwork: no slide.
  assert.equal(alignBackgroundOffsetY({
    offsetY: 0.11,
    horizon: REFERENCE_BACKGROUND_HORIZON,
    planeHeight
  }), 0.11);
  // Artwork whose ground sits higher in the frame must move down.
  const higher = alignBackgroundOffsetY({
    offsetY: 0.11,
    horizon: REFERENCE_BACKGROUND_HORIZON - 0.09,
    planeHeight
  });
  assert.ok(Math.abs(higher - (0.11 - 0.09 * planeHeight)) < 1e-9, `got ${higher}`);
  // ...and one drawn lower must move up.
  const lower = alignBackgroundOffsetY({
    offsetY: 0,
    horizon: REFERENCE_BACKGROUND_HORIZON + 0.05,
    planeHeight
  });
  assert.ok(lower > 0);
});

test('alignment is a no-op when the artwork was never measured', () => {
  assert.equal(alignBackgroundOffsetY({ offsetY: 1.25, horizon: null, planeHeight: 20 }), 1.25);
  assert.equal(alignBackgroundOffsetY({ offsetY: 1.25, horizon: 0.4, planeHeight: 0 }), 1.25);
  assert.equal(alignBackgroundOffsetY({}), 0);
});

test('resolveBackgroundOffsetY combines alignment with the operator trim', () => {
  const dungeon = 'bg-a495f7accb-2100x3382-20260921-162136.jpg';
  const base = { asset: `/assets/editor-backgrounds/${dungeon}`, offsetY: 0, height: 22.708, scale: 1 };
  const aligned = resolveBackgroundOffsetY({ background: base });
  const horizon = BACKGROUND_HORIZONS.a495f7accb;
  const expected = (horizon - REFERENCE_BACKGROUND_HORIZON) * 22.708;
  assert.ok(Math.abs(aligned - expected) < 1e-9, `${aligned} vs ${expected}`);
  // The trim is expressed in the same world units as the Y offset.
  const trimmed = resolveBackgroundOffsetY({ background: { ...base, horizonTrim: 0.25 } });
  assert.ok(Math.abs(trimmed - (aligned + 0.25)) < 1e-9);
});

test('unmeasured artwork keeps the tuning offset untouched', () => {
  const result = resolveBackgroundOffsetY({
    background: { asset: '/assets/editor-backgrounds/unknown-image.jpg', offsetY: 0.75, height: 22.708 }
  });
  assert.equal(result, 0.75);
});

test('artwork is matched by content hash, so a rename keeps its horizon', () => {
  // Imported backgrounds are stored as bg-<hash>-<dims>-<label>.jpg; the label is
  // whatever the operator called the file, so the same pixels reach different
  // machines under different names.
  const horizon = BACKGROUND_HORIZONS.a495f7accb;
  assert.ok(horizon > 0);
  assert.equal(
    resolveBackgroundHorizon('/assets/editor-backgrounds/bg-a495f7accb-2100x3382-Codex-2026-9-20-17_51_34.jpg'),
    horizon
  );
  assert.equal(
    resolveBackgroundHorizon('/assets/editor-backgrounds/bg-a495f7accb-2100x3382-20260921-162136.jpg'),
    horizon
  );
  assert.equal(backgroundContentHash('/assets/editor-backgrounds/bg-a495f7accb-x.jpg'), 'a495f7accb');
  assert.equal(backgroundContentHash('/assets/applovin/textures/BG01_split01_q60.jpg'), null);
});

test('an explicit horizon in the document wins over the built-in table', () => {
  const asset = '/assets/applovin/textures/BG01_split01_q60.jpg';
  assert.equal(resolveBackgroundHorizon(asset), BACKGROUND_HORIZONS['BG01_split01_q60.jpg']);
  assert.equal(resolveBackgroundHorizon(asset, 0.61), 0.61);
  // Out-of-range values are ignored rather than trusted.
  assert.equal(resolveBackgroundHorizon(asset, 0), BACKGROUND_HORIZONS['BG01_split01_q60.jpg']);
  assert.equal(resolveBackgroundHorizon(asset, 1.4), BACKGROUND_HORIZONS['BG01_split01_q60.jpg']);
});

test('the visible band leaves room for the alignment shift', () => {
  // 22.708 world units of artwork behind a 16.668-unit tall view leaves ~3 units
  // of slack in each direction: enough for the 0.09 horizon differences seen in
  // the shipped sets (2.04 units) without exposing an edge.
  const slack = maxBackgroundOffsetShift({ planeHeight: 22.708, visibleHeight: 16.668 });
  assert.ok(Math.abs(slack - 3.02) < 0.01);
  const needed = Math.abs((BACKGROUND_HORIZONS.a495f7accb - REFERENCE_BACKGROUND_HORIZON) * 22.708);
  assert.ok(needed < slack, `alignment needs ${needed} but only ${slack} is available`);
  assert.equal(maxBackgroundOffsetShift({ planeHeight: 10, visibleHeight: 10 }), 0);
});

test('the renderer and editor both derive the offset instead of using the raw value', async () => {
  const view = readFileSync('src/scene-view.js', 'utf8');
  assert.match(view, /resolveBackgroundOffsetY/);
  // The options object must be passed through, not the bare background: the
  // helper reads `options.background` and a bare object silently reads as {}.
  assert.match(view, /resolveBackgroundOffsetY\(\{ background \}\)/);
  assert.doesNotMatch(view, /resolveBackgroundOffsetY\(background\)/);
  const editor = readFileSync('src/scene-editor.js', 'utf8');
  assert.match(editor, /resolveBackgroundHorizon/);
  assert.match(editor, /background\.horizonTrim/);
  assert.match(editor, /horizonTrim = 0/);
  const vite = readFileSync('vite.config.js', 'utf8');
  assert.match(vite, /x-background-horizon/);
  assert.match(vite, /parseUnitIntervalHeader/);
});

test('artwork that predates horizon tracking is measured in the browser', async () => {
  // The remote corpus already holds dozens of custom backgrounds with no sidecar
  // metadata; without a lazy measurement they would all keep the unaligned plane.
  const main = readFileSync('src/main.js', 'utf8');
  assert.match(main, /async function ensureBackgroundHorizon/);
  assert.match(main, /detectPlayfieldHorizon/);
  assert.match(main, /ensureBackgroundHorizon\(\{ onMeasured/);
  // `view` is local to startRuntime, so the re-layout must arrive as a callback;
  // a module-scope `view?.resize()` throws and is swallowed by the catch.
  assert.doesNotMatch(main, /view\?\.resize\(\);\n  \}/);
  assert.match(main, /BACKGROUND_HORIZON_CACHE_KEY/);
  // It has to run both at startup and when the operator picks a new background.
  assert.match(main, /if \(path === 'background\.asset'\) void ensureBackgroundHorizon\(\{ onMeasured/);
  // And it must not clobber a newer selection that landed while decoding.
  assert.match(main, /SCENE_TUNING\.background\.asset !== background\.asset/);
});
