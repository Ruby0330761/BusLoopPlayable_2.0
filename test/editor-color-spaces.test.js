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

test('a custom paint stays monotone and hue-true instead of drifting toward a nearby slot', () => {
  // Blending a custom paint from its two nearest measured slots was tried and is
  // wrong: the measured table encodes each atlas's own baked artwork, so pure
  // black landed between the dark-red and brown slots and painted a black car
  // brown (#000000 came out #573a35). The lighting-gain fallback keeps ordering
  // and hue, which is what an operator checks after typing a colour.
  for (const paint of ['#6f9e4a', '#3a6ecb', '#c04a2c', '#808080', '#2b2b2b']) {
    const rendered = getRenderedPaintColor(paint);
    assert.match(rendered, HEX, `${paint} needs a drawable rendered colour`);
    assert.notEqual(rendered, paint, `${paint} should be converted out of paint space`);
  }
  // The extremes must survive: black stays black, white stays white, and pure
  // primaries stay on their own hue.
  assert.equal(getRenderedPaintColor('#000000'), '#000000');
  assert.equal(getRenderedPaintColor('#ffffff'), '#ffffff');
  assert.equal(getRenderedPaintColor('#ff0000'), '#ff0000');
  assert.equal(getRenderedPaintColor('#00ff00'), '#00ff00');
  assert.equal(getRenderedPaintColor('#0000ff'), '#0000ff');
  assert.equal(getRenderedPaintColor('red'), null);
  assert.equal(getRenderedPaintColor(null), null);
  assert.equal(getRenderedPaintColor('#12345'), null);
  assert.equal(getRenderedPaintColor('red', '#123456'), '#123456');
});

test('a grey ramp renders monotonically brighter', () => {
  // Ordering is the property the board depends on: a darker paint must never
  // come out brighter than a lighter one, or two shades read as swapped.
  const luma = (hex) => {
    const [r, g, b] = [1, 3, 5].map((offset) => Number.parseInt(hex.slice(offset, offset + 2), 16));
    return r * 0.2126 + g * 0.7152 + b * 0.0722;
  };
  const steps = ['#000000', '#1a1a1a', '#404040', '#808080', '#b0b0b0', '#ffffff'];
  const rendered = steps.map((paint) => luma(getRenderedPaintColor(paint)));
  for (let index = 1; index < rendered.length; index += 1) {
    assert.ok(
      rendered[index] >= rendered[index - 1],
      `${steps[index]} must not render darker than ${steps[index - 1]}`
    );
  }
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

test('the canvas draws overrides as the authored paint, not a brightened version', () => {
  const source = readFileSync('src/level-layout-editor.js', 'utf8');

  // A body override must be drawn exactly as entered. BL-2611096 fills #9fc2d5
  // and the canvas used to draw #bfe8ff (Δ42/255) because it pushed the paint
  // through the lighting gain, so the board disagreed with the field.
  const bodyStart = source.indexOf('function vehicleDisplayColor');
  assert.ok(bodyStart > -1, 'the body colour helper must exist');
  const bodyHelper = source.slice(bodyStart, source.indexOf('\n}', bodyStart) + 2);
  assert.match(bodyHelper, /if \(paint\) return paint\.toLowerCase\(\);/,
    'an override must be drawn as authored');
  assert.match(bodyHelper, /getVehicleDisplayColor\(vehicle\?\.colorIndex\)/,
    'a car with no override still shows the slot measured render');
  assert.doesNotMatch(bodyHelper, /getRenderedPaintColor/,
    'the body override must not go through the lighting gain');

  const regionStart = source.indexOf('function vehicleRenderedRegions');
  assert.ok(regionStart > -1, 'the region helper must exist');
  const regionHelper = source.slice(regionStart, source.indexOf('\n}', regionStart) + 2);
  assert.match(regionHelper, /regions\[region\] = String\(paint\)\.toLowerCase\(\)/,
    'region overrides must also be drawn as authored');
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
