import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { LevelEditorModel, createLevelDocument, levelDocumentToRuntime } from '../src/level-editor-model.js';
import { resolveVehiclePaint, resolvePassengerBodyColor } from '../src/vehicle-display-colors.js';
import { resolveVehicleColor } from '../src/level-layout-thumbnail.js';

const grey = '#868d98';
const full = { body: grey, highlight: grey, shadow: grey, window: '#263238', detail: grey };

test('the same authored grey on blue and purple survives save, export and thumbnail rendering', () => {
  for (const colorOverrides of [full, { body: grey }]) {
    const vehicles = [0, 3].map((colorIndex, id) => ({ id: id + 1, colorIndex, seats: 6, colorOverrides }));
    const document = createLevelDocument({ vehicles, passengerQueues: [[0, 3]] });
    const runtime = levelDocumentToRuntime(JSON.parse(JSON.stringify(document)));
    for (const pair of [document.vehicles, runtime.vehicles]) {
      const [a, b] = pair.map(resolveVehiclePaint);
      assert.equal(a.body, b.body);
      assert.equal(a.body, grey);
      assert.equal(resolveVehicleColor(pair[0]), grey);
      assert.equal(a.body, resolvePassengerBodyColor(runtime, 0));
      assert.equal(b.body, resolvePassengerBodyColor(runtime, 3));
      assert.notEqual(a.window, a.body);
      assert.deepEqual(pair.map(vehicle => vehicle.colorIndex), [0, 3]);
    }
  }
});

test('partial paints inherit only from the body and legacy levels get their initial colour', () => {
  const base = resolveVehiclePaint({ colorIndex: 0 });
  assert.equal(base.body, '#4ea4ff');
  assert.deepEqual(resolveVehiclePaint({ colorIndex: 0, colorOverrides: { window: '#f1f2f3' } }), base);
  assert.equal(resolveVehiclePaint({ colorIndex: 3, colorOverrides: { body: '#0061E8' } }).body, '#0061e8');
});

test('choosing a colour preset applies its paint and moves its seat demand', () => {
  const model = new LevelEditorModel({ vehicles: [{ id: 1, seats: 4, colorIndex: 0 }], passengerQueues: [[0, 0, 0, 0]] });
  model.select('vehicle:1');
  model.setSelectedField('colorIndex', 3);
  assert.equal(resolveVehiclePaint(model.document.vehicles[0]).body, '#b53dff');
  assert.deepEqual(model.document.passengerQueues[0], [3, 3, 3, 3]);
});

test('single and batch panels share a preset and one body picker', () => {
  const source = readFileSync('src/level-layout-editor.js', 'utf8');
  assert.ok(source.includes("vehicleColorField('预设颜色', 'colorIndex'"));
  assert.ok(source.includes('type="color" data-field="colorOverrides.body"'));
  assert.doesNotMatch(source, /小人颜色微调|data-field="colorOverrides\.(highlight|window|shadow|detail)"/);
  assert.match(source, /const regions = resolveVehiclePaint\(vehicle\)/);
  assert.match(source, /context.fillStyle = midColor/);
});
