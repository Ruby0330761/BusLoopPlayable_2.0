import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  VEHICLE_PAINT_COLOR_OPTIONS,
  getVehicleColorOption,
  getVehicleDisplayColor
} from '../src/level-editor-model.js';
import {
  VEHICLE_RENDERED_COLOR_CSS,
  renderedVehicleColor,
  renderedVehicleColorCss
} from '../src/vehicle-display-colors.js';
import { resolveVehicleColor } from '../src/level-layout-thumbnail.js';

const HEX = /^#[0-9a-f]{6}$/i;

test('every paint colour slot has a rendered display colour', () => {
  for (const color of VEHICLE_PAINT_COLOR_OPTIONS) {
    const display = getVehicleDisplayColor(color.id);
    assert.match(display, HEX, `slot ${color.id} (${color.name}) needs a display colour`);
  }
  // The special mechanism slots keep a swatch too, even though they are not
  // selectable paints: the inspector still renders their preview.
  for (const id of [11, 12, 13, 14, 15, 16]) {
    assert.match(renderedVehicleColorCss(id), HEX, `special slot ${id} needs a swatch`);
  }
});

test('display colours stay distinct from the raw atlas paint they replace', () => {
  // If these ever matched, the editor would be back to drawing unlit paint.
  // Spot-check the slots whose atlas base is far darker than the render.
  const clearlyLit = [0, 1, 4, 7, 10];
  for (const id of clearlyLit) {
    const raw = getVehicleColorOption(id).css.toLowerCase();
    const display = getVehicleDisplayColor(id);
    assert.notEqual(display, raw, `slot ${id} should show the lit colour, not the atlas base`);
  }
});

test('the rendered palette matches the measured playable render', () => {
  // These are sampled from the real renderer: the shipped material for that
  // atlas slot, lit by the scene's hemisphere + directional lights, read back
  // through the playable camera. Changing the lighting or the atlas artwork
  // should force this table to be re-measured rather than silently drift.
  assert.equal(renderedVehicleColor(0), '#4ea4ff');
  assert.equal(renderedVehicleColor(1), '#33f145');
  assert.equal(renderedVehicleColor(2), '#ff5ac9');
  assert.equal(renderedVehicleColor(3), '#b53dff');
  assert.equal(renderedVehicleColor(4), '#ff3b3c');
  assert.equal(renderedVehicleColor(5), '#ffd31c');
  assert.equal(renderedVehicleColor(6), '#ff7b1c');
  assert.equal(renderedVehicleColor(7), '#23eeff');
  assert.equal(renderedVehicleColor(8), '#9c4d3b');
  assert.equal(renderedVehicleColor(9), '#34b194');
  assert.equal(renderedVehicleColor(10), '#343aff');
});

test('the display table covers every slot the atlas catalog defines', async () => {
  const { COLOR_ATLAS_PATHS } = await import('../src/color-atlases.js');
  COLOR_ATLAS_PATHS.forEach((path, index) => {
    // Slots 11-16 have no atlas on purpose (special authored models); every
    // other slot must have a measured display colour.
    if (path == null) return;
    assert.ok(
      Object.hasOwn(VEHICLE_RENDERED_COLOR_CSS, index),
      `atlas slot ${index} needs a measured display colour`
    );
  });
});

test('unknown colour indices fall back instead of rendering transparent', () => {
  assert.match(renderedVehicleColor(99), HEX);
  assert.equal(renderedVehicleColorCss(99, '#123456'), '#123456');
  assert.match(resolveVehicleColor({ colorIndex: 99 }), HEX);
});

test('authoring views share one display palette', () => {
  // The canvas, the thumbnails and the inspector swatches must not each carry
  // their own copy of the palette again — that is what let them drift.
  const editor = readFileSync('src/level-layout-editor.js', 'utf8');
  const thumbnail = readFileSync('src/level-layout-thumbnail.js', 'utf8');
  assert.match(editor, /getVehicleDisplayColor/, 'the authoring canvas needs the shared display colour');
  assert.match(thumbnail, /getVehicleDisplayColor/, 'thumbnails need the shared display colour');
  // The queue chips are hand-authored CSS strings, so pin that they use the
  // rendered values rather than the raw atlas bases.
  assert.match(editor, /#4EA4FF/);
  assert.match(editor, /#23EEFF/);
  assert.doesNotMatch(editor, /#014853/, 'the raw teal atlas base must not be used as a chip colour');
});
