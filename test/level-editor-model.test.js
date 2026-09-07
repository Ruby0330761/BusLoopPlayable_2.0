import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CONTAINER_TYPES,
  LevelEditorModel,
  createLevelDocument,
  exportLevelCsv,
  exportLevelExcelXml,
  exportUnityLevelAsset,
  levelDocumentToRuntime,
  validateLevelDocument
} from '../src/level-editor-model.js';

function makeDocument() {
  return createLevelDocument({
    key: 'level20', unityId: 20, mapScale: 1,
    vehicles: [
      { id: 1, seats: 4, colorIndex: 2, x: 0, z: 0, yaw: 0, containerType: 1, containerId: 0 },
      { id: 2, seats: 4, colorIndex: 3, x: 0, z: 1, yaw: 0, containerType: 1, containerId: 0 }
    ],
    containers: [{ id: 0, type: 1, x: 0, z: 0, yaw: 0 }],
    passengerQueues: [[2, 2, 2, 2], [3, 3, 3, 3]]
  });
}

test('normalizes imported runtime levels without losing authoring fields', () => {
  const document = makeDocument();
  assert.equal(document.format, 'bus-loop-web-level-v1');
  assert.equal(document.vehicles[0].mechanism.type, 'normal');
  assert.equal(document.containers[0].type, CONTAINER_TYPES.PARKING);
  assert.deepEqual(document.passengerQueues.map((queue) => queue.length), [4, 4]);
});

test('supports selection transforms, clipboard, undo, and redo', () => {
  const model = new LevelEditorModel(makeDocument());
  model.select('vehicle:1');
  model.moveSelected(0.31, 0, { snap: false });
  assert.equal(model.document.vehicles[0].x, 0.31);
  model.rotateSelected(90);
  assert.equal(model.document.vehicles[0].yaw, 90);
  model.duplicate();
  assert.equal(model.document.vehicles.length, 3);
  assert.equal(model.document.vehicles[2].id, 3);
  assert.ok(Math.abs(model.document.vehicles[2].x - 0.58) < 1e-9);
  assert.equal(model.undo(), true);
  assert.equal(model.document.vehicles.length, 2);
  assert.equal(model.redo(), true);
  assert.equal(model.document.vehicles.length, 3);
});

test('snaps movement in a rotated grid and aligns with nearby vehicles', () => {
  const model = new LevelEditorModel(makeDocument());
  model.document.editor.gridRotation = 90;
  model.document.editor.gridGap = 0.25;
  model.select('vehicle:1');
  model.moveSelected(0.24, 0.7);
  assert.ok(Math.abs(model.document.vehicles[0].x - 0.25) < 1e-9);
  assert.equal(model.document.vehicles[0].z, 0.75);
  model.document.editor.gridSnap = false;
  model.moveSelected(-0.24, 0.24);
  assert.equal(model.document.vehicles[0].x, 0);
  assert.equal(model.document.vehicles[0].z, 1);
});

test('rotates multiple selections individually or around their shared center', () => {
  const model = new LevelEditorModel(makeDocument());
  model.document.vehicles[0].x = -1;
  model.document.vehicles[1].x = 1;
  model.document.vehicles[1].z = 0;
  model.selectMany(['vehicle:1', 'vehicle:2']);
  model.rotateSelected(-15);
  assert.deepEqual(model.document.vehicles.map(({ x, z, yaw }) => ({ x, z, yaw })), [
    { x: -1, z: 0, yaw: 345 },
    { x: 1, z: 0, yaw: 345 }
  ]);
  model.rotateSelectedAroundCenter(90);
  assert.ok(Math.abs(model.document.vehicles[0].x) < 1e-9);
  assert.ok(Math.abs(model.document.vehicles[0].z - 1) < 1e-9);
  assert.ok(Math.abs(model.document.vehicles[1].x) < 1e-9);
  assert.ok(Math.abs(model.document.vehicles[1].z + 1) < 1e-9);
  assert.deepEqual(model.document.vehicles.map((vehicle) => vehicle.yaw), [75, 75]);
});

test('keeps the Unity anchor fixed across repeated group rotations', () => {
  const model = new LevelEditorModel(makeDocument());
  model.document.vehicles[0].x = -2;
  model.document.vehicles[0].z = 0;
  model.document.vehicles[1].x = 1;
  model.document.vehicles[1].z = 1;
  model.selectMany(['vehicle:1', 'vehicle:2']);
  const center = model.selectionCenter();
  assert.deepEqual(center, { x: -0.5, z: 0.5 });
  model.rotateSelectedAroundCenter(90, center);
  model.rotateSelectedAroundCenter(90, center);
  assert.ok(Math.abs(model.document.vehicles[0].x - 1) < 1e-9);
  assert.ok(Math.abs(model.document.vehicles[0].z - 1) < 1e-9);
  assert.ok(Math.abs(model.document.vehicles[1].x + 2) < 1e-9);
  assert.ok(Math.abs(model.document.vehicles[1].z) < 1e-9);
  assert.deepEqual(model.document.vehicles.map((vehicle) => vehicle.yaw), [180, 180]);
});

test('aligns, mirrors, centers, and converts vehicles to gate queues', () => {
  const model = new LevelEditorModel(makeDocument());
  model.selectMany(['vehicle:1', 'vehicle:2']);
  model.align('vertical');
  assert.equal(model.document.vehicles[0].x, model.document.vehicles[1].x);
  model.mirror('z');
  assert.equal(model.document.vehicles[0].z, 1);
  const gate = model.convertSelectedToGateQueue();
  assert.equal(gate.type, CONTAINER_TYPES.GATE_QUEUE);
  assert.equal(gate.gateQueuePathPoints.length, 2);
  assert.ok(model.document.vehicles.every((vehicle) => vehicle.containerId === gate.id));
  model.centerAll();
  const zValues = model.document.vehicles.map((vehicle) => vehicle.z);
  assert.equal(Math.min(...zValues) + Math.max(...zValues), 0);
});

test('rebuilds forward blockers and validates passenger-seat parity', () => {
  const model = new LevelEditorModel(makeDocument());
  model.rebuildDepthGraph();
  assert.deepEqual(model.document.vehicleDepthes['1'], [2]);
  assert.deepEqual(model.document.vehicleDepthes['2'], []);
  assert.equal(validateLevelDocument(model.document).valid, true);
  model.setQueue(0, [2]);
  const validation = validateLevelDocument(model.document);
  assert.equal(validation.valid, false);
  assert.match(validation.errors.join('\n'), /颜色 2/);
});

test('converts an authored document back to the playable runtime shape', () => {
  const document = makeDocument();
  document.vehicles[0].isTurnVehicle = true;
  document.vehicles[0].mechanism.type = 'ambulance';
  document.vehicles[0].mechanism.stepLimit = 28;
  const runtime = levelDocumentToRuntime(document, { assets: { background: 'bg.jpg' } });
  assert.equal(runtime.key, 'level20');
  assert.equal(runtime.vehicles[0].isTurnVehicle, true);
  assert.equal(runtime.vehicles[0].ambulanceStepLimit, 28);
  assert.equal(runtime.vehicles[0].collisionSize.length, 0.47157902);
  assert.deepEqual(runtime.passengerSequence, [2, 2, 2, 2, 3, 3, 3, 3]);
  assert.equal(runtime.assets.background, 'bg.jpg');
  assert.match(exportLevelCsv(document), /"vehicle","1"/);
  const unity = exportUnityLevelAsset(document);
  assert.match(unity, /m_Name: level20/);
  assert.match(unity, /fixedPassengerSequence:\n  - queueId: 0/);
  assert.match(unity, /rotation: \{x: 0, y: 0, z: 0, w: 1\}/);
  assert.match(unity, /difficulty: 0/);
  assert.match(exportLevelExcelXml(document), /Excel\.Sheet/);
});
