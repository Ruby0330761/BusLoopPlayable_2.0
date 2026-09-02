import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import * as THREE from 'three';
import {
  ensureSpatialEditorMetadata,
  SpatialConveyorEditModel
} from '../src/spatial-conveyor-edit-model.js';
import {
  buildSpatialConveyorExitGeometry,
  getSpatialConveyorWorldPoints,
  mapSpatialWorldPointToPackage
} from '../src/spatial-conveyor-runtime.js';
import { SCENE_TUNING } from '../src/scene-tuning.js';

function makePackageCurve(packageData) {
  return new THREE.CatmullRomCurve3(
    packageData.path.points.map((point) => new THREE.Vector3(
      point.position.x,
      point.position.y,
      point.position.z
    )),
    false,
    'catmullrom',
    0.35
  );
}

async function loadPackage() {
  return JSON.parse(await readFile(
    new URL('../artifacts/spatial-conveyors/ConveyorBeltShape.json', import.meta.url),
    'utf8'
  ));
}

test('spatial point editor inserts a curve-sampled point and supports undo and redo', async () => {
  const model = new SpatialConveyorEditModel(await loadPackage());
  const originalCount = model.points.length;
  model.select(4);
  assert.equal(model.insertAfter(4), true);
  assert.equal(model.points.length, originalCount + 1);
  assert.equal(model.activeIndex, 5);
  assert.equal(model.undo(), true);
  assert.equal(model.points.length, originalCount);
  assert.equal(model.redo(), true);
  assert.equal(model.points.length, originalCount + 1);
});

test('spatial point editor keeps a stable imported pivot and minimum point count', async () => {
  const model = new SpatialConveyorEditModel(await loadPackage());
  const pivot = structuredClone(model.packageData.path.editorPivot);
  model.select(0);
  model.transact(() => {
    model.points[0].position.x += 100;
  });
  assert.deepEqual(model.packageData.path.editorPivot, pivot);
  model.selectIndices(model.points.map((_point, index) => index).slice(0, -2));
  assert.equal(model.deleteSelection(), false);
});

test('topology edits preserve the physical entrance and exit anchors', async () => {
  const model = new SpatialConveyorEditModel(await loadPackage());
  const beforeCurve = makePackageCurve(model.packageData);
  const entranceBefore = beforeCurve.getPointAt(model.packageData.entrances[0].percent);
  const exitStartBefore = beforeCurve.getPointAt(model.packageData.exit.startPercent);
  const exitEndBefore = beforeCurve.getPointAt(model.packageData.exit.endPercent);

  assert.equal(model.append('start'), true);
  model.select(20);
  assert.equal(model.insertAfter(20), true);
  model.select(10);
  assert.equal(model.deleteSelection(), true);

  const afterCurve = makePackageCurve(model.packageData);
  const entranceAfter = afterCurve.getPointAt(model.packageData.entrances[0].percent);
  const exitStartAfter = afterCurve.getPointAt(model.packageData.exit.startPercent);
  const exitEndAfter = afterCurve.getPointAt(model.packageData.exit.endPercent);
  assert.ok(entranceAfter.distanceTo(entranceBefore) < 0.02);
  assert.ok(exitStartAfter.distanceTo(exitStartBefore) < 0.02);
  assert.ok(exitEndAfter.distanceTo(exitEndBefore) < 0.02);
  assert.ok(model.packageData.entrances[0].percent > 0);
});

test('entrance editing participates in undo and redo history', async () => {
  const model = new SpatialConveyorEditModel(await loadPackage());
  const original = model.packageData.entrances[0].percent;
  model.select(12);
  assert.equal(model.setEntranceFromPoint(12), true);
  const changed = model.packageData.entrances[0].percent;
  assert.notEqual(changed, original);
  assert.equal(model.undo(), true);
  assert.equal(model.packageData.entrances[0].percent, original);
  assert.equal(model.redo(), true);
  assert.equal(model.packageData.entrances[0].percent, changed);
});

test('boarding detection is independent from the passenger track entrance', async () => {
  const model = new SpatialConveyorEditModel(await loadPackage());
  const entrance = model.packageData.entrances[0].percent;
  const originalWidth = model.getBoardingRangeWidth();
  assert.equal(model.setBoardingPercent(0.5), true);
  assert.equal(model.setBoardingPercent(0.5), false);
  assert.ok(Math.abs(model.getBoardingPercent() - 0.5) < 1e-9);
  assert.ok(Math.abs(model.getBoardingRangeWidth() - originalWidth) < 1e-9);
  assert.equal(model.packageData.entrances[0].percent, entrance);
  assert.equal(model.undo(), true);
  assert.ok(Math.abs(model.getBoardingPercent() - 0.8575) < 1e-9);
});

test('exit artwork keeps an independent anchor when track points move', async () => {
  const original = await loadPackage();
  const packageData = ensureSpatialEditorMetadata(original);
  assert.ok(packageData.exit.visualAnchor);
  const makeExitGeometry = (data) => {
    const points = getSpatialConveyorWorldPoints(data, SCENE_TUNING.spatialConveyor);
    const curve = new THREE.CatmullRomCurve3(points, false, 'catmullrom', 0.35);
    return buildSpatialConveyorExitGeometry(data, curve, SCENE_TUNING.spatialConveyor);
  };
  const fallback = makeExitGeometry(original);
  const before = makeExitGeometry(packageData);
  const movedPackage = structuredClone(packageData);
  for (const point of movedPackage.path.points) point.position.x += 8;
  const after = makeExitGeometry(movedPackage);
  const beforePositions = before.getAttribute('position');
  const fallbackPositions = fallback.getAttribute('position');
  const afterPositions = after.getAttribute('position');
  for (let index = 0; index < beforePositions.count; index += 1) {
    const fallbackPoint = new THREE.Vector3().fromBufferAttribute(fallbackPositions, index);
    const beforePoint = new THREE.Vector3().fromBufferAttribute(beforePositions, index);
    const afterPoint = new THREE.Vector3().fromBufferAttribute(afterPositions, index);
    assert.ok(fallbackPoint.distanceTo(beforePoint) < 1e-6);
    assert.ok(beforePoint.distanceTo(afterPoint) < 1e-6);
  }
  fallback.dispose();
  before.dispose();
  after.dispose();
});

test('spatial display mapping can be inverted for point dragging', async () => {
  const packageData = await loadPackage();
  const worldPoints = getSpatialConveyorWorldPoints(packageData, SCENE_TUNING.spatialConveyor);
  const raw = mapSpatialWorldPointToPackage(packageData, worldPoints[12], SCENE_TUNING.spatialConveyor);
  const source = packageData.path.points[12].position;
  assert.ok(Math.abs(raw.x - source.x) < 1e-6);
  assert.ok(Math.abs(raw.y - source.y) < 1e-6);
  assert.ok(Math.abs(raw.z - source.z) < 1e-6);
});

test('adding stable editor metadata does not move the imported track', async () => {
  const packageData = await loadPackage();
  const before = getSpatialConveyorWorldPoints(packageData, SCENE_TUNING.spatialConveyor);
  const after = getSpatialConveyorWorldPoints(
    ensureSpatialEditorMetadata(packageData),
    SCENE_TUNING.spatialConveyor
  );
  for (let index = 0; index < before.length; index += 1) {
    assert.ok(before[index].distanceTo(after[index]) < 1e-6);
  }
});

test('spatial point editor is an on-demand overlay with validated explicit saves', async () => {
  const [editorSource, sceneEditorSource, mainSource, viteSource, styles, editorStyles] = await Promise.all([
    readFile(new URL('../src/spatial-conveyor-editor.js', import.meta.url), 'utf8'),
    readFile(new URL('../src/scene-editor.js', import.meta.url), 'utf8'),
    readFile(new URL('../src/main.js', import.meta.url), 'utf8'),
    readFile(new URL('../vite.config.js', import.meta.url), 'utf8'),
    readFile(new URL('../src/styles.css', import.meta.url), 'utf8'),
    readFile(new URL('../src/spatial-conveyor-editor.css', import.meta.url), 'utf8')
  ]);
  assert.match(sceneEditorSource, /editor-spatial-edit-points/);
  assert.match(sceneEditorSource, /openSpatialPointEditor/);
  assert.match(editorSource, /TransformControls/);
  assert.match(editorSource, /OrbitControls/);
  assert.match(editorSource, /EDITOR_CAMERA_FOV = 40/);
  assert.match(editorSource, /EDITOR_CAMERA_NEAR = 0\.01/);
  assert.match(editorSource, /EDITOR_CAMERA_FAR = 100000/);
  assert.match(editorSource, /zoomToCursor = true/);
  assert.match(editorSource, /spatial-point-toolbar-handle/);
  assert.match(editorSource, /data-entrance-percent/);
  assert.match(editorSource, /data-boarding-percent/);
  assert.match(editorSource, /同色车辆上车检测点/);
  assert.match(editorSource, /setEntranceFromPoint/);
  assert.match(editorSource, /setBoardingFromPoint/);
  assert.match(editorSource, /spatial-point-selection-box/);
  assert.match(editorSource, /method: 'PUT'/);
  assert.match(mainSource, /if \(!spatialEditorActive\) game\.update/);
  assert.match(viteSource, /validateSpatialPackageData/);
  assert.match(viteSource, /SPATIAL_BACKUP_ROOT/);
  assert.match(styles, /\.scene-editor\.is-spatial-point-editing \{ display: none; \}/);
  assert.match(editorStyles, /\.spatial-point-selection-box/);
});
