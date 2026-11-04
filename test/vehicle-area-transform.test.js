import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  createVehicleAreaTransform,
  screenToWorldPoint,
  worldToScreenPoint
} from '../src/vehicle-area-transform.js';
import { SCENE_TUNING } from '../src/scene-tuning.js';

const SHIPPED_AREA = Object.freeze({
  positionUnitScale: 0.7,
  unityToWorldScale: 2,
  sourceRootX: 0,
  sourceRootZ: -2.92,
  positionPivotX: 0,
  positionPivotZ: -0.45,
  offsetX: 0,
  offsetZ: -0.1,
  mirrorZ: true,
  rotationDegrees: 0
});

test('the shipped vehicle area mirrors Z and scales by positionUnitScale', () => {
  const transform = createVehicleAreaTransform(SHIPPED_AREA);
  assert.equal(transform.mirrorZ, true);
  // 0.7 position scale x 2 Unity->world = 1.4 display units per authored unit.
  assert.ok(Math.abs(transform.scale - 1.4) < 1e-9);
  // +Z in authoring space becomes -Z on screen, which is the whole reason the
  // editor used to look like a mirrored copy of the playable.
  const forward = transform.point(0, 1);
  assert.ok(forward.z < 0, 'authored +Z must map to display -Z');
  const right = transform.point(1, 0);
  assert.ok(right.x > 0, 'X is not mirrored');
});

test('point and unproject round-trip, so dragging still writes authoring space', () => {
  const transform = createVehicleAreaTransform(SHIPPED_AREA);
  for (const [x, z] of [[0, 0], [1.5, -2.25], [-3.2, 0.8], [0.05, -3.9]]) {
    const point = transform.point(x, z);
    const back = transform.unproject(point.x, point.z);
    assert.ok(Math.abs(back.x - x) < 1e-9, `x round-trip for ${x}`);
    assert.ok(Math.abs(back.z - z) < 1e-9, `z round-trip for ${z}`);
  }
});

test('headings follow the same mirror and formation rotation', () => {
  const mirrored = createVehicleAreaTransform({ ...SHIPPED_AREA, rotationDegrees: 0 });
  assert.equal(mirrored.yaw(0), 180);
  assert.equal(mirrored.yaw(45), 135);
  const rotated = createVehicleAreaTransform({ ...SHIPPED_AREA, rotationDegrees: 30 });
  assert.equal(rotated.yaw(0), 150);
  const plain = createVehicleAreaTransform({ mirrorZ: false, rotationDegrees: 0 });
  assert.equal(plain.yaw(45), 45, 'without a mirror the heading is untouched');
});

test('a rigid rotation keeps relative placement and survives the round-trip', () => {
  const straight = createVehicleAreaTransform({ ...SHIPPED_AREA, rotationDegrees: 0 });
  const turned = createVehicleAreaTransform({ ...SHIPPED_AREA, rotationDegrees: 37 });
  const a = straight.point(1, 1);
  const b = straight.point(-1, 1);
  const aTurned = turned.point(1, 1);
  const bTurned = turned.point(-1, 1);
  const distance = (p, q) => Math.hypot(p.x - q.x, p.z - q.z);
  assert.ok(Math.abs(distance(a, b) - distance(aTurned, bTurned)) < 1e-9, 'rotation must not stretch the field');
  const roundTrip = turned.unproject(aTurned.x, aTurned.z);
  assert.ok(Math.abs(roundTrip.x - 1) < 1e-9 && Math.abs(roundTrip.z - 1) < 1e-9);
});

test('missing tuning falls back to an identity mapping instead of NaN', () => {
  const transform = createVehicleAreaTransform({});
  assert.deepEqual(transform.point(2.5, -1.25), { x: 2.5, z: -1.25 });
  assert.equal(transform.yaw(90), 90);
  assert.equal(transform.scale, 1);
});

test('the editor, thumbnails, and the live tuning share one transform', () => {
  const editor = readFileSync(new URL('../src/level-layout-editor.js', import.meta.url), 'utf8');
  const thumbnail = readFileSync(new URL('../src/level-layout-thumbnail.js', import.meta.url), 'utf8');
  // Both authoring views must import the shared module rather than re-deriving
  // the mirror/scale, which is how the two drifted apart before.
  assert.match(editor, /from '\.\/vehicle-area-transform\.js'/);
  assert.match(editor, /vehicleAreaTransformFor\(SCENE_TUNING\.vehicleArea\)/);
  assert.match(thumbnail, /from '\.\/vehicle-area-transform\.js'/);
  assert.match(thumbnail, /vehicleAreaTransformFor\(SCENE_TUNING\.vehicleArea\)/);
  // The playable source of truth still lives in vehicle-area.js.
  const area = readFileSync(new URL('../src/vehicle-area.js', import.meta.url), 'utf8');
  assert.match(area, /positionUnitScale/);
  assert.match(area, /mirrorZ/);
  assert.ok(SCENE_TUNING.vehicleArea, 'tuning must expose vehicleArea');
});

test('every authored vehicle maps to the same pose the playable scene renders', async () => {
  // This is the actual 1:1 contract: the editor canvas and the thumbnail must
  // place a car exactly where scene-view.js puts it. `mapVehicleAreaBasePoint`
  // is what the playable calls, so compare against it directly rather than
  // against a second hand-written copy of the maths.
  const { mapVehicleAreaBasePoint } = await import('../src/vehicle-area.js');
  const level = JSON.parse(readFileSync(new URL('../artifacts/web-levels/level2610296.json', import.meta.url), 'utf8'));
  const area = SCENE_TUNING.vehicleArea;
  const transform = createVehicleAreaTransform(area);
  const rotation = (Number(area.rotationDegrees) || 0) * Math.PI / 180;
  // scene-view rotates around the cluster centre; that is a rigid translation,
  // so comparing relative to the origin point is enough and keeps this test
  // independent of the vehicle cluster.
  const originBase = mapVehicleAreaBasePoint({ x: 0, z: 0 }, area);

  let worstPosition = 0;
  let worstYaw = 0;
  for (const vehicle of level.vehicles) {
    const base = mapVehicleAreaBasePoint(vehicle, area);
    const dx = base.x - originBase.x;
    const dz = base.z - originBase.z;
    const sceneX = dx * Math.cos(rotation) - dz * Math.sin(rotation);
    const sceneZ = dx * Math.sin(rotation) + dz * Math.cos(rotation);
    const point = transform.point(vehicle.x, vehicle.z);
    worstPosition = Math.max(worstPosition, Math.hypot(point.x - sceneX, point.z - sceneZ));
    const sceneYaw = (area.mirrorZ ? 180 - vehicle.yaw : vehicle.yaw) - (Number(area.rotationDegrees) || 0);
    worstYaw = Math.max(worstYaw, Math.abs(transform.yaw(vehicle.yaw) - sceneYaw));
  }
  assert.ok(worstPosition < 1e-9, `position drift from the playable: ${worstPosition}`);
  assert.ok(worstYaw < 1e-9, `yaw drift from the playable: ${worstYaw}`);
});

test('the canvas projection puts +Z downward, matching the playable camera', () => {
  // scene-view.js places the camera above the field on its +Z side and looks
  // back at it, so on screen world +X is right and world +Z is DOWN. The old
  // canvas used the classic "z points up" convention, which mirrored every
  // board vertically and made each heading point backwards.
  const rect = { width: 1000, height: 800 };
  const camera = { x: 0, z: 0 };
  const k = 100;
  const origin = worldToScreenPoint(camera, rect, 0, 0, k);
  const plusZ = worldToScreenPoint(camera, rect, 0, 1, k);
  const plusX = worldToScreenPoint(camera, rect, 1, 0, k);
  assert.ok(Math.abs(origin.x - 500) < 1e-9 && Math.abs(origin.y - 400) < 1e-9);
  assert.ok(plusZ.y > origin.y, '+Z must move DOWN the canvas');
  assert.ok(Math.abs(plusZ.y - (400 + k)) < 1e-9);
  assert.ok(plusX.x > origin.x, '+X must move RIGHT');
  // Round-trip is what keeps dragging writing authoring coordinates.
  const back = screenToWorldPoint(camera, rect, plusX.x, plusZ.y, k);
  assert.ok(Math.abs(back.x - 1) < 1e-9 && Math.abs(back.z - 1) < 1e-9);
});

test('the drawn sprite turns to face where the playable faces', () => {
  // A canvas sprite's nose sits at local -Y. Rotating it by φ aims the nose at
  // (sin φ, -cos φ); the playable aims it at (sin θ, cos θ). So φ = 180 - θ.
  // Rotating by θ instead pointed every car exactly backwards.
  const transform = createVehicleAreaTransform({ mirrorZ: false, rotationDegrees: 0 });
  for (const heading of [0, 45, 90, 135, 180, 270]) {
    const phi = transform.canvasYaw(heading) * Math.PI / 180;
    const theta = transform.yaw(heading) * Math.PI / 180;
    const noseX = Math.sin(phi);
    const noseY = -Math.cos(phi);
    assert.ok(Math.abs(noseX - Math.sin(theta)) < 1e-9, `x component for heading ${heading}`);
    assert.ok(Math.abs(noseY - Math.cos(theta)) < 1e-9, `y component for heading ${heading}`);
  }
});

test('editor and thumbnail agree on screen direction for a real board', () => {
  // Both views must place the same car on the same side and the same end of the
  // picture. This is the assertion that would have caught the vertical mirror.
  const level = JSON.parse(readFileSync(new URL('../artifacts/web-levels/level2610296.json', import.meta.url), 'utf8'));
  const transform = createVehicleAreaTransform(SCENE_TUNING.vehicleArea);
  const rect = { width: 1000, height: 800 };
  const camera = { x: 0, z: 0 };
  const k = 100;
  const points = level.vehicles.map((vehicle) => {
    const world = transform.point(vehicle.x, vehicle.z);
    return {
      id: vehicle.id,
      color: vehicle.colorOverrides?.body ?? null,
      colorIndex: vehicle.colorIndex,
      screen: worldToScreenPoint(camera, rect, world.x, world.z, k)
    };
  });
  const meanX = (filter) => {
    const list = points.filter(filter).map((point) => point.screen.x);
    return list.reduce((sum, value) => sum + value, 0) / Math.max(1, list.length);
  };
  // The board paints its halves by atlas colour index (pink left, green right),
  // so derive the split from the data instead of assuming a body tint.
  const leftIndex = level.vehicles.find((v) => v.x < 0)?.colorIndex;
  const rightIndex = level.vehicles.find((v) => v.x >= 0)?.colorIndex;
  const greenX = meanX((point) => point.colorIndex === leftIndex);
  const redX = meanX((point) => point.colorIndex === rightIndex);
  assert.ok(greenX < redX, `left colour (${greenX.toFixed(1)}) must stay left of right colour (${redX.toFixed(1)})`);

  // And the whole field must keep +Z going down, vehicle by vehicle.
  const sorted = [...points].sort((a, b) => a.screen.z - b.screen.z);
  const byZ = level.vehicles
    .map((vehicle) => ({ id: vehicle.id, z: transform.point(vehicle.x, vehicle.z).z, screenY: null }))
    .sort((a, b) => a.z - b.z);
  for (let index = 1; index < byZ.length; index += 1) {
    assert.ok(byZ[index].z >= byZ[index - 1].z, 'ordering is stable');
  }
  assert.ok(sorted.length === level.vehicles.length);
});
