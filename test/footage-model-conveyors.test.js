import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import * as THREE from 'three';
import { extractFootage8Paths } from '../scripts/extract-footage8-conveyor.mjs';
import { FOOTAGE9_LAYOUT } from '../src/generated-footage9-layout.js';
import { FOOTAGE10_LAYOUT } from '../src/generated-footage10-layout.js';
import { getFootage8Paths, getFootage8DisplayMatrix, getFootage8RuntimeConfig, connectFootage8Queues, getFootage8QueueSpacing } from '../src/footage8-conveyor.js';
import { Footage8Surface } from '../src/footage8-surface.js';
import { SceneView, makeClosedConveyorCurve } from '../src/scene-view.js';
import { BusLoopGame } from '../src/game-model.js';
import { SCENE_TUNING } from '../src/scene-tuning.js';
import { normalizeSessionStages } from '../src/playable-session-config.js';

const file = (path) => readFileSync(new URL(`../${path}`, import.meta.url));

for (const layout of [FOOTAGE9_LAYOUT, FOOTAGE10_LAYOUT]) {
  const id = layout.id;
  const tuning = SCENE_TUNING[`${id}Conveyor`];
  const paths = getFootage8Paths(tuning, layout);
  const curve = makeClosedConveyorCurve(paths.belt, layout.splineType);
  const entries = connectFootage8Queues(curve, paths.queues);
  const config = getFootage8RuntimeConfig(curve, tuning);

  test(`${id} preserves the supplied source hashes, inherited paths, and both real meshes`, () => {
    const sourceRoot = `artifacts/${id}-source/`;
    const manifest = JSON.parse(file(`${sourceRoot}source-manifest.json`));
    assert.equal(manifest.assets.length, 7);
    for (const asset of manifest.assets) {
      assert.equal(createHash('sha256').update(file(sourceRoot + asset.file)).digest('hex'), asset.sha256);
    }
    const extracted = extractFootage8Paths(file(sourceRoot + layout.sourcePrefab).toString(), file(sourceRoot + 'dependencies/Paths.prefab').toString());
    assert.deepEqual(layout.points3D, extracted.main.points);
    assert.deepEqual(layout.queuePoints3D, extracted.queues.map((q) => q.points));
    assert.equal(layout.source.sha256, createHash('sha256').update(file(sourceRoot + layout.sourcePrefab)).digest('hex'));
    const payload = JSON.parse(gunzipSync(file(`public${layout.assets.model}`)));
    assert.equal(payload.meshes.length, 2);
    assert.ok(payload.meshes.some((mesh) => mesh.shadow));
    assert.ok(payload.meshes.some((mesh) => !mesh.shadow));
    for (const url of Object.values(layout.assets)) assert.ok(file(`public${url}`).length > 1000);
  });

  test(`${id} moves road and both queue paths together and samples its layered road surface`, () => {
    const moved = { ...tuning, positionX: 1.1, positionY: 0.5, scale: 1.7, rotationYDegrees: 40 };
    const matrix = getFootage8DisplayMatrix(moved, layout);
    const transformed = getFootage8Paths(moved, layout);
    for (const [source, target] of [[layout.points3D, transformed.belt], ...layout.queuePoints3D.map((q, i) => [q, transformed.queues[i]])]) {
      source.forEach((p, i) => assert.ok(new THREE.Vector3(...p).applyMatrix4(matrix).distanceTo(target[i]) < 1e-9));
    }
    const road = JSON.parse(gunzipSync(file(`public${layout.assets.model}`))).meshes.find((m) => !m.shadow);
    const surface = new Footage8Surface(new THREE.BufferGeometryLoader().parse(road.geometry), 0.15, { roadOnly: true });
    const inverse = getFootage8DisplayMatrix(tuning, layout).invert();
    let covered = 0;
    for (let i = 0; i < 120; i++) {
      const point = curve.getPointAt(i / 120).applyMatrix4(inverse);
      if (surface.heightAt(point) != null) covered++;
    }
    assert.ok(covered >= 114, `${covered}/120 authored loop samples are over asphalt`);
  });

  test(`${id} uses its authored boarding range and is selectable in stitched sessions and the editor`, () => {
    assert.ok(Math.abs(config.exitStart - layout.exitStart) < 1e-6);
    assert.ok(Math.abs(config.exitEnd - layout.exitEnd) < 1e-6);
    const [stage] = normalizeSessionStages([{ id: 'new-track', levelKey: 'level33', scene: { conveyorLayout: id } }]);
    assert.equal(stage.scene.conveyorLayout, id);
    const editor = file('src/scene-editor.js').toString();
    assert.match(editor, new RegExp(`\\['${id}', 'Footage`));
    assert.match(editor, /const MODEL_CONVEYOR_FIELD_GROUPS = \['footage9', 'footage10'\]/);
    assert.equal(SceneView.prototype.isFootageConveyor.call({}, layout), true);
  });

  test(`${id} fills continuously, preserves every passenger, and applies live speed/boarding changes`, () => {
    const game = new BusLoopGame();
    const spacing = getFootage8QueueSpacing(curve.getLength() / config.capacity, SCENE_TUNING.passengers.modelScale);
    const capacities = entries.map((e) => Math.min(18, Math.floor(e.curve.getLength() / spacing) + 1));
    game.initializeQueues(capacities, spacing, entries.map((e) => e.curve.getLength()), curve.getLength(), {
      ...config, queueCapacities: layout.queueCapacities,
      entryPercents: entries.map((e) => e.entryPercent), entryLeadDistances: entries.map((e) => e.mergeDistance), resetSlots: true
    });
    const total = game.getRemainingGroups();
    for (let i = 0; i < 3000 && game.initialFillActive; i++) game.update(0.05);
    assert.equal(game.initialFillActive, false);
    assert.equal(game.slots.filter((s) => s.colorIndex !== null).length, config.capacity);
    assert.equal(game.getRemainingGroups(), total);
    const before = game.snapshot();
    game.configureConveyorRuntime(getFootage8RuntimeConfig(curve, { ...tuning, speed: 1.25, boardingPositionPercent: 99, boardingWidthPercent: 8 }));
    assert.deepEqual(game.snapshot().queueItems, before.queueItems);
    assert.deepEqual(game.snapshot().slots, before.slots);
    const passenger = game.slots.find((s) => s.colorIndex !== null);
    const vehicle = game.vehicles.find((v) => v.colorIndex === passenger.colorIndex);
    Object.assign(vehicle, { state: 'at-spot', spotIndex: 0, boardedGroups: 0 });
    game.spots[0].vehicleId = vehicle.id;
    for (let i = 0; i < 800; i++) game.update(0.05);
    assert.ok(game.boardingEvents.length > 0);
    assert.ok(game.boardingEvents.every((event) => event.progress >= 0.95 || event.progress <= 0.03));
  });

  test(`${id} renders the reserved queue merge continuously instead of replaying the flat-belt entry animation`, () => {
    const view = { curve, queueCurves: entries.map((e) => e.curve), entryPercents: entries.map((e) => e.entryPercent), isFootageConveyor: () => true };
    entries.forEach((entry, index) => {
      const slot = { entryMotion: { entryIndex: index, mergeDistance: entry.mergeDistance, remainingDistance: entry.mergeDistance } };
      const pose = SceneView.prototype.getInitialEntryPathVisual.call(view, 'row', slot, null, null, 0, .05, 1, .1);
      assert.ok(pose.position.distanceTo(entry.curve.getPointAt(0).add(new THREE.Vector3(0, .1, 0))) < .005);
    });
  });
}
