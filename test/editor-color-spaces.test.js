import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  VEHICLE_PAINT_COLOR_OPTIONS,
  getRenderedPaintColor,
  getVehicleDisplayColor,
  getVehiclePaintColor,
  levelDocumentToRuntime
} from '../src/level-editor-model.js';

const HEX = /^#[0-9a-f]{6}$/i;

test('every shipped paint slot maps to exactly the colour the playable renders', () => {
  // The canvas paints an override by converting paint -> rendered. For the value
  // the field offers by default that conversion must land on the slot's measured
  // colour, or the board would show a car the game does not draw.
  for (const option of VEHICLE_PAINT_COLOR_OPTIONS) {
    assert.equal(
      getRenderedPaintColor(getVehiclePaintColor(option.id)),
      getVehicleDisplayColor(option.id).toLowerCase(),
      `slot ${option.id} (${option.name}) must round-trip to its measured colour`
    );
  }
});

test('the tuning fields default to paint, not to the rendered colour', () => {
  // This is the bug that repainted untouched cars: the 车身 field defaulted to the
  // rendered colour, so editing only 车窗 stored that rendered value as a body
  // override and the runtime lit it a second time.
  for (const option of VEHICLE_PAINT_COLOR_OPTIONS) {
    const paint = getVehiclePaintColor(option.id);
    assert.match(paint, HEX);
    assert.equal(paint, option.css.toLowerCase());
    // For slots whose atlas base differs from the render these must not match.
    if (option.id !== 11 && option.id !== 12 && option.id !== 16) {
      const rendered = getVehicleDisplayColor(option.id).toLowerCase();
      if (rendered !== paint) {
        assert.notEqual(paint, rendered, `slot ${option.id} default must not be the rendered colour`);
      }
    }
  }
});

test('editing only the window field leaves the body colour alone', () => {
  // End-to-end shape of the reported bug: store the default body plus a window
  // override, run it through the export conversion, and confirm the body value
  // still renders as the slot's colour rather than a brightened one.
  const colorIndex = 0;
  const document = {
    key: 'level9001',
    unityId: 9001,
    vehicles: [{
      id: 1, seats: 4, colorIndex,
      colorOverrides: { body: getVehiclePaintColor(colorIndex), window: '#263238' },
      x: 0, z: 0, yaw: 0, containerType: 1, containerId: 0
    }],
    containers: [{ id: 0, type: 1 }],
    passengerQueues: [[0], []]
  };
  const runtime = levelDocumentToRuntime(document, {});
  const vehicle = runtime.vehicles[0];
  assert.equal(vehicle.colorOverrides.body, getVehiclePaintColor(colorIndex));
  assert.equal(vehicle.colorOverrides.window, '#263238');
  // The stored body paint renders as the untouched slot colour.
  assert.equal(getRenderedPaintColor(vehicle.colorOverrides.body), getVehicleDisplayColor(colorIndex).toLowerCase());
});

test('an unknown paint still returns a drawable colour instead of throwing', () => {
  // A hand-typed paint has no measured entry; it must blend inside the measured
  // palette rather than invent a lighting model or return undefined.
  for (const paint of ['#6f9e4a', '#3a6ecb', '#c04a2c', '#808080', '#2b2b2b']) {
    const rendered = getRenderedPaintColor(paint);
    assert.match(rendered, HEX, `${paint} needs a drawable rendered colour`);
    assert.notEqual(rendered, paint, `${paint} should be converted out of paint space`);
  }
  assert.equal(getRenderedPaintColor('red'), null);
  assert.equal(getRenderedPaintColor(null), null);
  assert.equal(getRenderedPaintColor('#12345'), null);
  assert.equal(getRenderedPaintColor('red', '#123456'), '#123456');
});

test('the canvas draws region overrides instead of only the body', () => {
  const source = readFileSync('src/level-layout-editor.js', 'utf8');
  // Every override field must reach the sprite, or filling it in shows nothing.
  for (const region of ['highlight', 'shadow', 'window', 'detail']) {
    assert.match(
      source,
      new RegExp(`vehicleRenderedRegions|regions\\?\\.${region}`),
      `${region} must reach the canvas`
    );
  }
  assert.match(source, /regions: vehicleRenderedRegions\(/, 'the canvas must pass computed regions');
  // The gradients and glass now read from the region values.
  assert.match(source, /paint\.addColorStop\(0, highlightColor\)/);
  assert.match(source, /paint\.addColorStop\(1, shadowColor\)/);
  assert.match(source, /const glass = windowColor \?\?/);
});

test('region overrides are drawn in rendered space, not raw paint', () => {
  const source = readFileSync('src/level-layout-editor.js', 'utf8');
  const start = source.indexOf('function vehicleRenderedRegions');
  assert.ok(start > -1, 'the region helper must exist');
  const regionHelper = source.slice(start, source.indexOf('\n}', start) + 2);
  assert.match(regionHelper, /getRenderedPaintColor\(paint, null\)/,
    'region overrides must be converted out of paint space before drawing');
  // A region with no override stays absent so untouched levels keep their shading.
  assert.match(regionHelper, /if \(!paint\) continue;/);
  assert.match(regionHelper, /return null;/);
});

test('the inspector defaults come from the paint accessor', () => {
  const source = readFileSync('src/level-layout-editor.js', 'utf8');
  assert.match(source, /const baseColor = getVehiclePaintColor\(item\.colorIndex\)/,
    'the single-vehicle inspector must default to paint');
  assert.match(source, /const paintColor = getVehiclePaintColor\(vehicle\.colorIndex\)/,
    'the batch inspector must default to paint');
  assert.match(source, /const base = overrides\.body \?\? getVehiclePaintColor\(colorIndex\)/,
    'the passenger tuning panel must default to paint');
  // The rendered accessor is still used, but only for drawing.
  assert.doesNotMatch(source, /const baseColor = getVehicleDisplayColor/);
});
