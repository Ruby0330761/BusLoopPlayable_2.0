import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CONVEYOR_DEFAULT_WIDTH,
  CONVEYOR_EXTRA_SIZE,
  CONTAINER_TYPES,
  ELEVATOR_DEFAULT_SIZE,
  GATE_DEFAULT_GAP,
  GARAGE_PARK_POS,
  GARAGE_SIZE,
  GARAGE_VEHICLE_SPACING,
  LevelEditorModel,
  VEHICLE_COLOR_OPTIONS,
  createLevelDocument,
  exportLevelCsv,
  exportLevelExcelXml,
  exportUnityLevelAsset,
  getElevatorStats,
  getGateQueueBounds,
  getGateQueuePath,
  levelDocumentToRuntime,
  sortPassengerQueuesByVehicleDepth,
  validateLevelDocument
} from '../src/level-editor-model.js';

test('uses the complete Unity LevelEditor color map', () => {
  assert.deepEqual(VEHICLE_COLOR_OPTIONS.map(({ id, name, css }) => ({ id, name, css })), [
    { id: 0, name: 'Blue', css: '#0000FF' },
    { id: 1, name: 'Green', css: '#00FF00' },
    { id: 2, name: 'Pink', css: '#FF7DCF' },
    { id: 3, name: 'Purple', css: '#9400FF' },
    { id: 4, name: 'Red', css: '#FF0000' },
    { id: 5, name: 'Yellow', css: '#FFEB04' },
    { id: 6, name: 'Orange', css: '#FF8C00' },
    { id: 7, name: 'LightBlue', css: '#00FFFF' },
    { id: 8, name: 'Brown', css: '#8DAB8B' },
    { id: 9, name: 'DarkGreen', css: '#B9B9B9' },
    { id: 10, name: 'DarkBlue', css: '#555598' },
    { id: 11, name: 'PoliceCar', css: '#000000' },
    { id: 12, name: 'FireTruck', css: '#196D87' },
    { id: 13, name: 'Ambulance', css: '#9A0040' },
    { id: 14, name: 'Vip', css: '#FFDFCE' },
    { id: 15, name: 'Luxury', css: '#FFF7A5' }
  ]);
});

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

test('matches Unity garage dimensions, vehicle layout, and exit selection', () => {
  const document = makeDocument();
  document.containers.push({ id: 1, type: CONTAINER_TYPES.GARAGE, x: 2, z: 3, yaw: 90, width: 9, length: 9 });
  const model = new LevelEditorModel(document);
  const garage = model.document.containers[1];
  assert.equal(garage.width, GARAGE_SIZE.width);
  assert.equal(garage.length, GARAGE_SIZE.length);
  assert.equal(model.enterContainer(garage.id), true);
  const vehicles = [model.addVehicle(), model.addVehicle(), model.addVehicle()];
  const forward = GARAGE_SIZE.length + 0.6785897;
  assert.deepEqual(vehicles.map(({ containerType, containerId, yaw }) => ({ containerType, containerId, yaw })), [
    { containerType: CONTAINER_TYPES.GARAGE, containerId: 1, yaw: 90 },
    { containerType: CONTAINER_TYPES.GARAGE, containerId: 1, yaw: 90 },
    { containerType: CONTAINER_TYPES.GARAGE, containerId: 1, yaw: 90 }
  ]);
  assert.deepEqual(vehicles.map((vehicle) => Number(vehicle.x.toFixed(7))), [
    Number((2 + forward).toFixed(7)), Number((2 + forward).toFixed(7)), Number((2 + forward).toFixed(7))
  ]);
  assert.deepEqual(vehicles.map((vehicle) => Number(vehicle.z.toFixed(7))), [
    Number((3 + GARAGE_VEHICLE_SPACING).toFixed(7)), 3, Number((3 - GARAGE_VEHICLE_SPACING).toFixed(7))
  ]);
  assert.equal(GARAGE_PARK_POS, 0.7);
  assert.equal(model.exitActiveContainer(), true);
  assert.equal(model.activeContainerId, 0);
  assert.deepEqual([...model.selection], ['container:1']);
});

test('matches Unity conveyor dimensions, exit-width serialization, and vehicle row layout', () => {
  const document = createLevelDocument({
    key: 'level30', unityId: 30,
    containers: [{ id: 0, type: 1 }, { id: 5, type: CONTAINER_TYPES.CONVEYOR, x: 2, z: 3, yaw: 90 }],
    conveyorBelts: [{ vcId: 5, width: 4.2 }],
    vehicles: [
      { id: 1, seats: 4, colorIndex: 0, containerType: 3, containerId: 5 },
      { id: 2, seats: 10, colorIndex: 1, containerType: 3, containerId: 5 }
    ],
    passengerQueues: [Array(4).fill(0), Array(10).fill(1)]
  });
  const conveyor = document.containers[1];
  assert.equal(CONVEYOR_DEFAULT_WIDTH, 3.8);
  assert.equal(conveyor.conveyorWidth, 4.2);
  assert.equal(conveyor.width, 4.2 + CONVEYOR_EXTRA_SIZE.width);
  assert.equal(conveyor.length, CONVEYOR_EXTRA_SIZE.length);

  const model = new LevelEditorModel(document);
  assert.equal(model.enterContainer(5), true);
  const vehicles = model.document.vehicles;
  assert.deepEqual(vehicles.map((vehicle) => Number(vehicle.x.toFixed(7))), [
    Number((2 + CONVEYOR_EXTRA_SIZE.length + 0.6785897).toFixed(7)),
    Number((2 + CONVEYOR_EXTRA_SIZE.length + 0.6785897).toFixed(7))
  ]);
  assert.deepEqual(vehicles.map((vehicle) => Number(vehicle.z.toFixed(7))), [3.27, 2.73]);
  assert.deepEqual(vehicles.map((vehicle) => vehicle.yaw), [90, 90]);
  model.addVehicle({ colorIndex: 2 });
  assert.deepEqual(model.document.vehicles.filter((vehicle) => vehicle.containerId === 5).map((vehicle) => Number(vehicle.z.toFixed(7))), [3.54, 3, 2.46]);

  const runtime = levelDocumentToRuntime(model.document);
  assert.deepEqual(runtime.conveyorBelts, [{ vcId: 5, width: 4.2 }]);
  assert.match(exportUnityLevelAsset(model.document), /conveyorBelts:\n  - vcId: 5\n    width: 4\.2/);
});

test('matches Unity gate line spacing, path bounds, and grouped transforms', () => {
  const document = createLevelDocument({
    key: 'level31', unityId: 31,
    containers: [{ id: 0, type: 1 }, {
      id: 6, type: CONTAINER_TYPES.GATE_QUEUE, x: 2, z: 3, yaw: 0,
      gateQueuePathShape: 0, gateQueueLocked: false, gateQueueGap: 0
    }],
    vehicles: [
      { id: 1, seats: 4, colorIndex: 0, containerType: 4, containerId: 6 },
      { id: 2, seats: 10, colorIndex: 1, containerType: 4, containerId: 6 }
    ],
    passengerQueues: [Array(4).fill(0), Array(10).fill(1)]
  });
  const model = new LevelEditorModel(document);
  const gate = model.document.containers[1];
  assert.equal(gate.gateQueueLocked, true);
  assert.equal(gate.gateQueueGap, GATE_DEFAULT_GAP);
  assert.equal(model.addContainer(CONTAINER_TYPES.GATE_QUEUE).gateQueueGap, GATE_DEFAULT_GAP);
  model.removeSelected();
  model.enterContainer(6);
  const centerDistance = 0.47157902 * 0.5 + 0.6785897 * 0.5 + GATE_DEFAULT_GAP;
  assert.deepEqual(model.document.vehicles.map(({ x, z, yaw }) => ({ x: Number(x.toFixed(7)), z, yaw })), [
    { x: 2, z: 3, yaw: 90 },
    { x: Number((2 - centerDistance).toFixed(7)), z: 3, yaw: 90 }
  ]);
  assert.ok(getGateQueuePath(model.document, gate).length >= 2);
  assert.ok(getGateQueueBounds(model.document, gate).length >= 4);

  model.select('container:6');
  model.moveSelected(1, -2, { snap: false });
  assert.deepEqual(model.document.vehicles.map(({ x, z }) => ({ x: Number(x.toFixed(7)), z })), [
    { x: 3, z: 1 },
    { x: Number((3 - centerDistance).toFixed(7)), z: 1 }
  ]);
  model.rotateSelected(90);
  assert.deepEqual(model.document.vehicles.map((vehicle) => vehicle.yaw), [180, 180]);
  assert.ok(Math.abs(model.document.vehicles[1].x - 3) < 1e-9);
  assert.ok(Math.abs(model.document.vehicles[1].z - (1 + centerDistance)) < 1e-9);
});

test('edits Unity-style gate tangent handles and keeps the change undoable', () => {
  const document = createLevelDocument({
    key: 'level33', unityId: 33,
    containers: [{ id: 0, type: 1 }, {
      id: 6, type: CONTAINER_TYPES.GATE_QUEUE, x: 0, z: 0, yaw: 0,
      gateQueuePathShape: 1, gateQueueLocked: false, gateQueueShowCurveHandles: true
    }],
    vehicles: [
      { id: 1, seats: 4, colorIndex: 0, x: 0, z: 0, containerType: 4, containerId: 6 },
      { id: 2, seats: 4, colorIndex: 1, x: -1, z: 0, containerType: 4, containerId: 6 },
      { id: 3, seats: 4, colorIndex: 2, x: -2, z: 0, containerType: 4, containerId: 6 }
    ]
  });
  const model = new LevelEditorModel(document);
  const gate = model.document.containers[1];
  assert.equal(model.setGateQueueTangentHandle(6, 2, 1, { x: -1, z: 1 }), true);
  assert.equal(gate.gateQueueTangentOverrides[1], true);
  assert.ok(getGateQueuePath(model.document, gate).some((point) => Math.abs(point.z) > 0.001));
  assert.equal(model.undo(), true);
  assert.deepEqual(model.document.containers[1].gateQueueTangentOverrides, []);
});

test('matches Unity elevator layers, warnings, centering, and grouped transforms', () => {
  const document = createLevelDocument({
    key: 'level32', unityId: 32,
    containers: [{ id: 0, type: 1 }, { id: 7, type: CONTAINER_TYPES.ELEVATOR, x: 2, z: 3, yaw: 0 }],
    vehicles: [
      { id: 1, seats: 4, colorIndex: 0, x: 2.25, z: 3, containerType: 5, containerId: 7, elevatorLayer: 0 },
      { id: 2, seats: 4, colorIndex: 1, x: 2, z: 3, containerType: 5, containerId: 7, elevatorLayer: 1 }
    ],
    passengerQueues: [Array(4).fill(0), Array(4).fill(1)]
  });
  const model = new LevelEditorModel(document);
  const elevator = model.document.containers[1];
  assert.deepEqual({ width: elevator.width, length: elevator.length }, ELEVATOR_DEFAULT_SIZE);
  assert.deepEqual(getElevatorStats(model.document, elevator), { upperCount: 1, lowerCount: 1, outsideCount: 0 });
  model.enterContainer(7);
  const historyLength = model.undoStack.length;
  assert.equal(model.setElevatorEditingLayer(1), true);
  assert.equal(model.undoStack.length, historyLength);
  const added = model.addVehicle({ colorIndex: 2 });
  assert.equal(added.elevatorLayer, 1);
  assert.equal(model.centerActiveElevatorLayer(), true);
  const lower = model.document.vehicles.filter((vehicle) => vehicle.elevatorLayer === 1);
  const lowerCenterX = (Math.min(...lower.map((vehicle) => vehicle.x)) + Math.max(...lower.map((vehicle) => vehicle.x))) * 0.5;
  assert.ok(Math.abs(lowerCenterX - elevator.x) < 1e-9);

  model.select('container:7');
  model.moveSelected(1, 1, { snap: false });
  assert.ok(model.document.vehicles.every((vehicle) => vehicle.x >= 3 - 1e-9 && vehicle.z >= 4 - 1e-9));
  model.rotateSelected(90);
  assert.ok(model.document.vehicles.every((vehicle) => vehicle.yaw === 90));
  model.exitActiveContainer();
  assert.equal(elevator.elevatorEditingLayer, 0);
});

test('resizes an elevator from its Unity-style handles without moving contained vehicles', () => {
  const model = new LevelEditorModel(createLevelDocument({
    containers: [{ id: 0, type: 1 }, { id: 7, type: CONTAINER_TYPES.ELEVATOR, x: 2, z: 3, yaw: 0 }],
    vehicles: [{ id: 1, seats: 4, colorIndex: 0, x: 2, z: 3, containerType: 5, containerId: 7, elevatorLayer: 0 }]
  }));
  const beforeVehicle = { ...model.document.vehicles[0] };
  assert.equal(model.resizeElevatorByHandle(7, 4, { x: 3, z: 3 }), true);
  const elevator = model.document.containers[1];
  assert.deepEqual({ x: elevator.x, z: elevator.z, width: elevator.width, length: elevator.length }, { x: 2.25, z: 3, width: 1.5, length: 2 });
  assert.deepEqual(model.document.vehicles[0], beforeVehicle);
  assert.equal(model.undo(), true);
  assert.deepEqual({ x: model.document.containers[1].x, width: model.document.containers[1].width }, { x: 2, width: 1 });
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

test('sorts passenger blocks by vehicle depth in dual-queue playback order', () => {
  const document = createLevelDocument({
    vehicles: [
      { id: 1, seats: 4, colorIndex: 5 },
      { id: 2, seats: 6, colorIndex: 4 },
      { id: 3, seats: 10, colorIndex: 0 },
      { id: 4, seats: 4, colorIndex: 1 },
      { id: 5, seats: 4, colorIndex: 6 },
      { id: 6, seats: 4, colorIndex: 3 }
    ],
    vehicleDepthes: { 1: [], 2: [1], 3: [1, 2], 4: [1, 2, 3], 5: [1, 2, 3, 4], 6: [1, 2, 3, 4, 5] },
    passengerQueues: [
      [0, 4, 5, 3, 0, 6, 4, 1, 0, 5, 3, 0, 6, 4, 1, 0],
      [4, 0, 5, 3, 0, 6, 4, 1, 0, 5, 3, 0, 6, 4, 1, 0]
    ]
  });

  const queues = sortPassengerQueuesByVehicleDepth(document, 8);
  assert.deepEqual(queues[0], [5, 5, 5, 5, 4, 4, 4, 4, 0, 0, 0, 0, 1, 1, 1, 1]);
  assert.deepEqual(queues[1], [4, 4, 0, 0, 0, 0, 0, 0, 6, 6, 6, 6, 3, 3, 3, 3]);
  assert.deepEqual(
    [...queues[0].slice(0, 8), ...queues[1].slice(0, 8), ...queues[0].slice(8), ...queues[1].slice(8)],
    [5, 5, 5, 5, 4, 4, 4, 4, 4, 4, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 6, 6, 6, 6, 3, 3, 3, 3]
  );
});

test('one-click passenger sorting rebuilds current depths and remains undoable', () => {
  const model = new LevelEditorModel(makeDocument());
  const before = model.snapshot();
  model.sortPassengerQueuesByDepth();
  assert.deepEqual(model.document.vehicleDepthes, { 1: [2], 2: [] });
  assert.deepEqual(model.document.passengerQueues, [[3, 3, 3, 3], [2, 2, 2, 2]]);
  assert.equal(model.undo(), true);
  assert.deepEqual(model.document, before);
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

test('exports Unity vehicle depth to CSV and Excel', () => {
  const document = makeDocument();
  document.vehicles.push({
    id: 3, seats: 4, colorIndex: 2, x: 0, z: 2, yaw: 0,
    containerType: CONTAINER_TYPES.PARKING, containerId: 0,
    mechanism: { type: 'normal' }
  });
  document.vehicleDepthes = {
    1: [2, 3],
    2: [3],
    3: []
  };

  const csv = exportLevelCsv(document);
  const rows = csv.split('\r\n');
  assert.equal(rows[0], '"type","id","x","z","yaw","seats","color","containerType","containerId","depth","mechanism"');
  assert.equal(rows[1], '"vehicle","1","0","0","0","4","2","1","0","2","normal"');
  assert.equal(rows[2], '"vehicle","2","0","1","0","4","3","1","0","1","normal"');
  assert.equal(rows[3], '"vehicle","3","0","2","0","4","2","1","0","0","normal"');

  const excel = exportLevelExcelXml(document);
  assert.match(excel, /<Data ss:Type="String">depth<\/Data>/);
  assert.match(excel, /<Data ss:Type="String">2<\/Data>/);
});
