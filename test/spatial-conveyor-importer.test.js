import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import * as THREE from 'three';
import {
  buildSpatialConveyorPackage,
  importSpatialConveyorPrefab
} from '../scripts/spatial-conveyor-importer.mjs';
import { BusLoopGame } from '../src/game-model.js';
import {
  SPATIAL_CONVEYOR_DISPLAY,
  buildSpatialConveyorExitGeometry,
  buildSpatialConveyorGeometry,
  getSpatialConveyorWorldPoints
} from '../src/spatial-conveyor-runtime.js';
import {
  createGeneratedSpatialConveyorSource,
  getSpatialConveyorId as getGeneratedSpatialConveyorId
} from '../scripts/generate-active-spatial-conveyor.mjs';
import { SCENE_TUNING } from '../src/scene-tuning.js';

const TEMPLATE_GUID = 'e5a3779fb659c934bbca7df9e4f50681';

function modification(targetFileId, propertyPath, value) {
  return `    - target: {fileID: ${targetFileId}, guid: ${TEMPLATE_GUID}, type: 3}\n` +
    `      propertyPath: ${propertyPath}\n` +
    `      value: ${value}\n` +
    '      objectReference: {fileID: 0}';
}

function makeVariantSource() {
  const modifications = [
    modification('1852251880068840175', '_spline.points.Array.size', 3),
    modification('1852251880068840175', '_spline.points.Array.data[0].position.x', 10),
    modification('1852251880068840175', '_spline.points.Array.data[2].position.z', 30),
    modification('1852251880068840175', '_spline.points.Array.data[8].position.x', 99),
    modification('3144417120642309377', '_channels.Array.data[0]._count', 225),
    modification('5715585421532965618', 'capacity', 300),
    modification('5715585421532965618', 'exitStartPercent', 0.85),
    modification('5715585421532965618', 'exitEndPercent', 0.865),
    modification('5715585421532965618', 'directBoardingExitDistance', 0.2),
    modification('6447817737181092483', 'queues.Array.size', 0)
  ];
  return `--- !u!1001 &1\nPrefabInstance:\n  m_Modification:\n    m_Modifications:\n${modifications.join('\n')}\n  m_SourcePrefab: {fileID: 100100000, guid: ${TEMPLATE_GUID}, type: 3}\n`;
}

test('standalone spatial conveyor import packages effective 3D spline data and embedded assets', async () => {
  const packageData = await buildSpatialConveyorPackage({
    filename: 'StandaloneShape.prefab',
    source: makeVariantSource()
  });

  assert.equal(packageData.id, 'StandaloneShape');
  assert.equal(packageData.kind, 'spatial');
  assert.equal(packageData.path.points.length, 3);
  assert.equal(packageData.path.points[0].position.x, 10);
  assert.equal(packageData.path.points[2].position.z, 30);
  assert.equal(packageData.visual.channel.count, 225);
  assert.equal(packageData.visual.channel.vertices.length, 14);
  assert.equal(packageData.visual.channel.indices.length, 36);
  assert.equal(packageData.gameplay.capacity, 300);
  assert.equal(packageData.gameplay.queueCount, 0);
  assert.equal(packageData.entranceMode, 'direct');
  assert.deepEqual(packageData.entrances, [{ id: 'entrance-1', mode: 'direct', percent: 0 }]);
  assert.equal(packageData.exit.startPercent, 0.85);
  assert.equal(packageData.exit.endPercent, 0.865);
  assert.equal(packageData.exit.directBoardingExitDistance, 0.2);
  assert.deepEqual(packageData.visual.exitSprite.size, { x: 2.14, y: 0.89 });
  assert.match(packageData.visual.material.loopTextureDataUrl, /^data:image\/png;base64,/);
  assert.match(packageData.visual.material.exitTextureDataUrl, /^data:image\/png;base64,/);
});

test('spatial conveyor output uses the prefab basename and can be removed as one JSON package', async () => {
  const outputRoot = await mkdtemp(path.join(os.tmpdir(), 'bus-loop-spatial-'));
  try {
    const result = await importSpatialConveyorPrefab({
      filename: 'StandaloneShape.prefab',
      source: makeVariantSource(),
      outputRoot
    });
    assert.equal(path.basename(result.outputPath), 'StandaloneShape.json');
    const saved = JSON.parse(await readFile(result.outputPath, 'utf8'));
    assert.equal(saved.id, 'StandaloneShape');
  } finally {
    await rm(outputRoot, { recursive: true, force: true });
  }
});

test('spatial conveyor runtime builds repeated mesh geometry from transformed 3D points', async () => {
  const packageData = await buildSpatialConveyorPackage({
    filename: 'StandaloneShape.prefab',
    source: makeVariantSource()
  });
  const points = getSpatialConveyorWorldPoints(packageData);
  const curve = new THREE.CatmullRomCurve3(points, false, 'catmullrom', 0.35);
  const geometry = buildSpatialConveyorGeometry(packageData, curve);
  const wideGeometry = buildSpatialConveyorGeometry(packageData, curve, { roadWidth: 2 });
  const exitGeometry = buildSpatialConveyorExitGeometry(packageData, curve, {
    scale: 1,
    scaleY: 1,
    positionX: 0,
    positionY: 0,
    positionZ: 0,
    mirrorZ: 0,
    rotationYDegrees: 180
  });
  const shiftedExitGeometry = buildSpatialConveyorExitGeometry(packageData, curve, {
    scale: 1,
    scaleY: 1,
    positionX: 0,
    positionY: 0,
    positionZ: 0,
    exitPositionX: 1.25,
    exitPositionZ: -0.75,
    mirrorZ: 0,
    rotationYDegrees: 180
  });
  const wideExitGeometry = buildSpatialConveyorExitGeometry(packageData, curve, {
    scale: 1,
    scaleY: 1,
    roadWidth: 2,
    positionX: 0,
    positionY: 0,
    positionZ: 0,
    mirrorZ: 0,
    rotationYDegrees: 180
  });
  const bounds = new THREE.Box3().setFromPoints(points);
  const center = bounds.getCenter(new THREE.Vector3());
  const centeredDisplay = { scale: 1, positionX: 0, positionY: 0, positionZ: 0 };
  const unmirrored = getSpatialConveyorWorldPoints(packageData, {
    ...centeredDisplay,
    mirrorZ: 0
  });
  const mirrored = getSpatialConveyorWorldPoints(packageData, {
    ...centeredDisplay,
    mirrorZ: 1
  });
  const verticalScaleCenterY = 2.5;
  const verticalScaleBase = getSpatialConveyorWorldPoints(packageData, {
    ...centeredDisplay,
    positionY: verticalScaleCenterY,
    scaleY: 1,
    mirrorZ: 0
  });
  const verticalScaleDouble = getSpatialConveyorWorldPoints(packageData, {
    ...centeredDisplay,
    positionY: verticalScaleCenterY,
    scaleY: 2,
    mirrorZ: 0
  });
  const horizontalScaleBase = getSpatialConveyorWorldPoints(packageData, {
    ...centeredDisplay,
    scaleX: 1,
    scaleZ: 1,
    mirrorZ: 0
  });
  const horizontalScaleXDouble = getSpatialConveyorWorldPoints(packageData, {
    ...centeredDisplay,
    scaleX: 2,
    scaleZ: 1,
    mirrorZ: 0
  });
  const horizontalScaleZDouble = getSpatialConveyorWorldPoints(packageData, {
    ...centeredDisplay,
    scaleX: 1,
    scaleZ: 2,
    mirrorZ: 0
  });
  const rotationBaseTuning = {
    ...centeredDisplay,
    mirrorZ: 0,
    rotationXDegrees: 0,
    rotationYDegrees: 0,
    rotationZDegrees: 0
  };
  const rotationBase = getSpatialConveyorWorldPoints(packageData, rotationBaseTuning);
  const rotatedX = getSpatialConveyorWorldPoints(packageData, {
    ...rotationBaseTuning,
    rotationXDegrees: 90
  });
  const rotatedZ = getSpatialConveyorWorldPoints(packageData, {
    ...rotationBaseTuning,
    rotationZDegrees: 90
  });
  const exitPositions = exitGeometry.getAttribute('position');
  const shiftedExitPositions = shiftedExitGeometry.getAttribute('position');
  const wideExitPositions = wideExitGeometry.getAttribute('position');
  const exitCorner = (index) => new THREE.Vector3().fromBufferAttribute(exitPositions, index);
  const shiftedExitCorner = (index) => new THREE.Vector3().fromBufferAttribute(shiftedExitPositions, index);
  const wideExitCorner = (index) => new THREE.Vector3().fromBufferAttribute(wideExitPositions, index);
  const exitProgress = (packageData.exit.startPercent + packageData.exit.endPercent) * 0.5;
  const exitTangent = curve.getTangent(exitProgress).normalize();
  const exitWidthDirection = exitCorner(1).sub(exitCorner(0)).normalize();
  const sourceVertices = packageData.visual.channel.vertices;
  const trackWidthVertexIndex = sourceVertices.findIndex((vertex) => Math.abs(Number(vertex.x) || 0) > 1e-6);
  const zValues = sourceVertices.map((vertex) => Number(vertex.z) || 0);
  const minZ = Math.min(...zValues);
  const zRange = Math.max(0.000001, Math.max(...zValues) - minZ);
  const trackProgress = THREE.MathUtils.clamp(
    (((Number(sourceVertices[trackWidthVertexIndex].z) || 0) - minZ) / zRange) /
      packageData.visual.channel.count,
    0,
    1
  );
  const trackCenter = curve.getPoint(trackProgress);
  const trackTangent = curve.getTangent(trackProgress).normalize();
  const trackPreferredUp = Math.abs(trackTangent.y) > 0.98
    ? new THREE.Vector3(0, 0, 1)
    : new THREE.Vector3(0, 1, 0);
  const trackLateral = trackPreferredUp.clone().cross(trackTangent).normalize();
  const trackUp = trackTangent.clone().cross(trackLateral).normalize();
  const trackPosition = new THREE.Vector3().fromBufferAttribute(
    geometry.getAttribute('position'),
    trackWidthVertexIndex
  );
  const wideTrackPosition = new THREE.Vector3().fromBufferAttribute(
    wideGeometry.getAttribute('position'),
    trackWidthVertexIndex
  );
  const trackOffset = trackPosition.sub(trackCenter);
  const wideTrackOffset = wideTrackPosition.sub(trackCenter);

  assert.equal(points.length, 3);
  assert.equal(SPATIAL_CONVEYOR_DISPLAY.rotationYDegrees, 180);
  assert.equal(SPATIAL_CONVEYOR_DISPLAY.modelRotationXDegrees, 0);
  assert.equal(SPATIAL_CONVEYOR_DISPLAY.modelRotationYDegrees, 180);
  assert.equal(SPATIAL_CONVEYOR_DISPLAY.modelRotationZDegrees, 0);
  assert.equal(SPATIAL_CONVEYOR_DISPLAY.mirrorZ, 1);
  for (let index = 0; index < mirrored.length; index += 1) {
    assert.ok(Math.abs(mirrored[index].x - unmirrored[index].x) < 1e-6);
    assert.ok(Math.abs(mirrored[index].y - unmirrored[index].y) < 1e-6);
    assert.ok(Math.abs(mirrored[index].z + unmirrored[index].z) < 1e-6);
    assert.ok(Math.abs(verticalScaleDouble[index].x - verticalScaleBase[index].x) < 1e-6);
    assert.ok(Math.abs(verticalScaleDouble[index].z - verticalScaleBase[index].z) < 1e-6);
    assert.ok(Math.abs(
      (verticalScaleDouble[index].y - verticalScaleCenterY) -
      (verticalScaleBase[index].y - verticalScaleCenterY) * 2
    ) < 1e-6);
    assert.ok(Math.abs(horizontalScaleXDouble[index].x - horizontalScaleBase[index].x * 2) < 1e-6);
    assert.ok(Math.abs(horizontalScaleXDouble[index].y - horizontalScaleBase[index].y) < 1e-6);
    assert.ok(Math.abs(horizontalScaleXDouble[index].z - horizontalScaleBase[index].z) < 1e-6);
    assert.ok(Math.abs(horizontalScaleZDouble[index].x - horizontalScaleBase[index].x) < 1e-6);
    assert.ok(Math.abs(horizontalScaleZDouble[index].y - horizontalScaleBase[index].y) < 1e-6);
    assert.ok(Math.abs(horizontalScaleZDouble[index].z - horizontalScaleBase[index].z * 2) < 1e-6);
    assert.ok(rotatedX[index].distanceTo(
      rotationBase[index].clone().applyAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2)
    ) < 1e-6);
    assert.ok(rotatedZ[index].distanceTo(
      rotationBase[index].clone().applyAxisAngle(new THREE.Vector3(0, 0, 1), Math.PI / 2)
    ) < 1e-6);
  }
  assert.ok(center.distanceTo(new THREE.Vector3(
    SPATIAL_CONVEYOR_DISPLAY.center.x,
    SPATIAL_CONVEYOR_DISPLAY.center.y,
    SPATIAL_CONVEYOR_DISPLAY.center.z
  )) < 1e-6);
  assert.equal(geometry.getAttribute('position').count, 14 * 225);
  assert.equal(geometry.index.count, 36 * 225);
  assert.equal(geometry.groups.length, 225);
  assert.ok(geometry.groups.every((group) => group.materialIndex === 0));
  assert.ok(Math.abs(wideTrackOffset.dot(trackLateral) - trackOffset.dot(trackLateral) * 2) < 1e-6);
  assert.ok(Math.abs(wideTrackOffset.dot(trackUp) - trackOffset.dot(trackUp)) < 1e-6);
  assert.ok(Math.abs(wideTrackOffset.dot(trackTangent) - trackOffset.dot(trackTangent)) < 1e-6);
  assert.equal(exitPositions.count, 4);
  assert.equal(exitGeometry.index.count, 6);
  assert.ok(Math.abs(
    exitCorner(0).distanceTo(exitCorner(1)) -
    2.14 * packageData.transforms.loopExit.scale.x
  ) < 1e-6);
  assert.ok(Math.abs(
    exitCorner(1).distanceTo(exitCorner(2)) -
    0.89 * packageData.transforms.loopExit.scale.y
  ) < 1e-6);
  assert.ok(Math.abs(
    wideExitCorner(0).distanceTo(wideExitCorner(1)) -
    exitCorner(0).distanceTo(exitCorner(1))
  ) < 1e-6);
  assert.ok(Math.abs(
    wideExitCorner(1).distanceTo(wideExitCorner(2)) -
    exitCorner(1).distanceTo(exitCorner(2)) * 2
  ) < 1e-6);
  assert.ok(Math.abs(exitWidthDirection.dot(exitTangent) - 1) < 1e-6);
  for (let index = 0; index < exitPositions.count; index += 1) {
    assert.ok(Math.abs(shiftedExitCorner(index).x - exitCorner(index).x - 1.25) < 1e-6);
    assert.ok(Math.abs(shiftedExitCorner(index).y - exitCorner(index).y) < 1e-6);
    assert.ok(Math.abs(shiftedExitCorner(index).z - exitCorner(index).z + 0.75) < 1e-6);
  }
  geometry.dispose();
  wideGeometry.dispose();
  exitGeometry.dispose();
  shiftedExitGeometry.dispose();
  wideExitGeometry.dispose();
});

test('direct spatial entrance merges authored queues and supplies the belt at one start point', () => {
  const game = new BusLoopGame();
  const totalGroups = game.level.passengerQueues.flat().length;
  game.initializeQueues([0], 0.4, [0], 8, {
    capacity: Math.min(75, totalGroups),
    queueCapacities: [0],
    entryPercents: [0],
    directEntrance: true,
    resetSlots: true
  });

  assert.equal(game.queues.length, 1);
  assert.equal(game.queues[0].length, 0);
  assert.equal(game.snapshot().sourceRemaining, totalGroups);
  const passenger = game.dequeuePassenger(0, true);
  assert.equal(typeof passenger.colorIndex, 'number');
  assert.equal(game.snapshot().sourceRemaining, totalGroups - 1);
});

test('spatial conveyor can start full without entrance upload motion', () => {
  const game = new BusLoopGame();
  const totalGroups = game.level.passengerQueues.flat().length;
  const capacity = Math.min(12, totalGroups);
  game.initializeQueues([0], 0.4, [0], 8, {
    capacity,
    queueCapacities: [0],
    entryPercents: [0],
    directEntrance: true,
    initiallyFull: true,
    resetSlots: true
  });

  const state = game.snapshot();
  assert.equal(state.initialFillActive, false);
  assert.equal(state.slots.filter((slot) => slot.colorIndex !== null).length, capacity);
  assert.deepEqual(
    state.slots.map((slot) => slot.colorIndex),
    game.level.passengerQueues.flat().slice(0, capacity).reverse()
  );
  assert.ok(state.slots.every((slot) => slot.entryMotion === null));
  assert.equal(state.sourceRemaining, totalGroups - capacity);
  assert.equal(state.remainingGroups, totalGroups);
  game.setSpeedMultiplier(1.7);
  assert.equal(game.snapshot().speedMultiplier, 1.7);
  game.setSpeedMultiplier(0.6);
  assert.equal(game.snapshot().speedMultiplier, 0.6);
  game.setSpeedMultiplier(1);
  assert.equal(game.snapshot().speedMultiplier, 1);
});

test('spatial conveyor import rejects unrelated prefabs and unsafe package names', async () => {
  await assert.rejects(
    buildSpatialConveyorPackage({
      filename: 'Other.prefab',
      source: 'm_SourcePrefab: {fileID: 100100000, guid: 00000000000000000000000000000000, type: 3}'
    }),
    /Unsupported spatial conveyor prefab/
  );
  await assert.rejects(
    buildSpatialConveyorPackage({ filename: '../Unsafe.prefab', source: makeVariantSource() }),
    /filename is not valid/
  );
});

test('production generator embeds only the selected spatial conveyor package', async () => {
  const packageData = JSON.parse(await readFile(
    path.resolve('artifacts', 'spatial-conveyors', 'ConveyorBeltShape.json'),
    'utf8'
  ));
  const source = createGeneratedSpatialConveyorSource(
    'spatial:ConveyorBeltShape',
    packageData
  );
  assert.equal(getGeneratedSpatialConveyorId('dualQueue2'), null);
  assert.equal(getGeneratedSpatialConveyorId('spatial:ConveyorBeltShape'), 'ConveyorBeltShape');
  assert.match(source, /ACTIVE_SPATIAL_CONVEYOR_PACKAGE/);
  assert.match(source, /spatial:ConveyorBeltShape/);
  assert.match(source, /data:image\/png;base64/);
  assert.throws(
    () => createGeneratedSpatialConveyorSource('spatial:Other', packageData),
    /does not match selection/
  );
});

test('HTML editor, renderer, Vite service, and production build expose selectable spatial conveyors', async () => {
  const [editorSource, viewSource, viteSource, mainSource, packageJsonSource] = await Promise.all([
    readFile(path.resolve('src', 'scene-editor.js'), 'utf8'),
    readFile(path.resolve('src', 'scene-view.js'), 'utf8'),
    readFile(path.resolve('vite.config.js'), 'utf8'),
    readFile(path.resolve('src', 'main.js'), 'utf8'),
    readFile(path.resolve('package.json'), 'utf8')
  ]);
  assert.match(editorSource, /\\u7acb\\u4f53\\u8f68\\u9053\\u7f16\\u8f91/);
  assert.match(editorSource, /accept="\.prefab"/);
  assert.match(editorSource, /__spatial-conveyors\/import/);
  assert.match(editorSource, /data-spatial-conveyor/);
  assert.match(editorSource, /refreshSpatialConveyorPackages/);
  assert.match(editorSource, /spatialConveyor\.positionX/);
  assert.match(editorSource, /spatialConveyor\.positionY/);
  assert.match(editorSource, /spatialConveyor\.positionZ/);
  assert.match(editorSource, /spatialConveyor\.scale/);
  assert.match(editorSource, /spatialConveyor\.scaleY/);
  assert.match(editorSource, /spatialConveyor\.scaleX/);
  assert.match(editorSource, /spatialConveyor\.scaleZ/);
  assert.match(editorSource, /spatialConveyor\.roadWidth/);
  assert.match(editorSource, /spatialConveyor\.exitPositionX/);
  assert.match(editorSource, /spatialConveyor\.exitPositionZ/);
  assert.match(editorSource, /spatialConveyor\.rotationXDegrees/);
  assert.match(editorSource, /spatialConveyor\.rotationYDegrees/);
  assert.match(editorSource, /spatialConveyor\.rotationZDegrees/);
  assert.match(editorSource, /spatialConveyor\.mirrorZ/);
  assert.match(editorSource, /spatialConveyor\.capacity/);
  assert.match(editorSource, /spatialConveyor\.startFilled/);
  assert.match(editorSource, /spatialConveyor\.normalSpeedMultiplier/);
  assert.match(editorSource, /spatialConveyor\.longPressMultiplier/);
  assert.ok(
    editorSource.indexOf('spatialConveyor.startFilled')
      < editorSource.indexOf('spatialConveyor.normalSpeedMultiplier')
  );
  assert.ok(
    editorSource.indexOf('spatialConveyor.normalSpeedMultiplier')
      < editorSource.indexOf('spatialConveyor.longPressMultiplier')
  );
  assert.ok(
    editorSource.indexOf('spatialConveyor.scaleY')
      < editorSource.indexOf('spatialConveyor.scaleX')
  );
  assert.ok(
    editorSource.indexOf('spatialConveyor.scaleX')
      < editorSource.indexOf('spatialConveyor.scaleZ')
  );
  assert.ok(
    editorSource.indexOf('spatialConveyor.scaleZ')
      < editorSource.indexOf('spatialConveyor.roadWidth')
  );
  assert.ok(
    editorSource.indexOf('spatialConveyor.roadWidth')
      < editorSource.indexOf('spatialConveyor.rotationXDegrees')
  );
  assert.match(editorSource, /editor-spatial-open-folder/);
  assert.match(editorSource, /__spatial-conveyors\/open-folder/);
  assert.match(editorSource, /spatialImportAnchor\.before\(spatialSection\)/);
  assert.match(editorSource, /section\.dataset\.spatialImportAnchor = 'true'/);
  assert.match(editorSource, /section\.dataset\.spatialOnly = 'true'/);
  assert.match(editorSource, /section\.hidden = !isSpatialConveyorSelection\(selected\)/);
  const passengerMaterialIndex = editorSource.indexOf("title: 'Passenger Material'");
  const conveyorSelectionIndex = editorSource.indexOf("title: '\\u4f20\\u9001\\u5e26\\u9009\\u62e9'");
  const spatialTransformIndex = editorSource.indexOf(
    "title: '\\u7acb\\u4f53\\u8f68\\u9053\\u4f4d\\u7f6e\\u4e0e\\u7f29\\u653e'"
  );
  const spatialQueueIndex = editorSource.indexOf(
    "title: '\\u7acb\\u4f53\\u8f68\\u9053\\u961f\\u5217'"
  );
  const ordinaryConveyorGroupsIndex = editorSource.indexOf('...CONVEYOR_LAYOUT_FIELD_GROUPS');
  assert.ok(passengerMaterialIndex < conveyorSelectionIndex);
  assert.ok(conveyorSelectionIndex < spatialTransformIndex);
  assert.ok(spatialTransformIndex < spatialQueueIndex);
  assert.ok(spatialQueueIndex < ordinaryConveyorGroupsIndex);
  assert.doesNotMatch(editorSource, /option\.disabled = true/);
  assert.match(viewSource, /buildSpatialConveyorGeometry/);
  assert.match(viewSource, /buildSpatialConveyorExitGeometry/);
  assert.match(viewSource, /directEntrance/);
  assert.match(viewSource, /initiallyFull/);
  assert.match(viewSource, /SCENE_TUNING\.spatialConveyor\?\.capacity/);
  assert.match(viewSource, /Spatial Conveyor Root/);
  assert.doesNotMatch(viewSource, /SPATIAL_CONVEYOR_DISPLAY\.camera/);
  assert.match(viteSource, /DEFAULT_OUTPUT_ROOT/);
  assert.match(viteSource, /listSpatialConveyors/);
  assert.match(viteSource, /readSpatialConveyorPackage/);
  assert.match(viteSource, /__spatial-conveyors\/import/);
  assert.match(viteSource, /importSpatialConveyorPrefab/);
  assert.match(viteSource, /openSpatialConveyorFolder/);
  assert.match(viteSource, /explorer\.exe/);
  assert.match(viteSource, /__spatial-conveyors\/open-folder/);
  assert.match(mainSource, /isSpatialConveyorSelection/);
  assert.match(mainSource, /ACTIVE_SPATIAL_CONVEYOR_PACKAGE/);
  assert.match(mainSource, /registerSpatialConveyorPackage\(ACTIVE_SPATIAL_CONVEYOR_PACKAGE\)/);
  assert.match(mainSource, /path === 'spatialConveyor\.startFilled'/);
  assert.match(mainSource, /spatialConveyor\?\.normalSpeedMultiplier/);
  assert.match(mainSource, /function applyIdleSpeedMultiplier/);
  assert.match(mainSource, /path === 'spatialConveyor\.normalSpeedMultiplier'/);
  assert.match(mainSource, /spatialConveyor\?\.longPressMultiplier/);
  assert.match(mainSource, /: LEVEL_1\.longPressMultiplier/);
  assert.match(
    JSON.parse(packageJsonSource).scripts.prebuild,
    /generate-active-spatial-conveyor\.mjs/
  );
  assert.equal(SCENE_TUNING.spatialConveyor.capacity, 128);
  assert.equal(SCENE_TUNING.spatialConveyor.startFilled, 1);
  assert.equal(SCENE_TUNING.spatialConveyor.scaleX, 1.178);
  assert.equal(SCENE_TUNING.spatialConveyor.scaleZ, 1.05);
  assert.equal(SCENE_TUNING.spatialConveyor.roadWidth, 1.1);
  assert.equal(SCENE_TUNING.spatialConveyor.normalSpeedMultiplier, 2.3);
  assert.equal(SCENE_TUNING.spatialConveyor.longPressMultiplier, 5.4);
});
