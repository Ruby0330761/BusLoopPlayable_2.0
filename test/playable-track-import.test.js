import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { CONVEYOR_LAYOUTS, getConveyorLayout } from '../src/conveyor-layouts.js';
import { PLAYABLE_TRACK_LAYOUTS } from '../src/playable-track-layouts.js';
import {
  createPlayableTrackMatrix,
  createPlayableTrackSurface,
  decodePlayableTrackContainer,
  mapPlayableTrackPoints,
  resolvePlayableTrackBoarding,
  usesAuthoredTrackTransform
} from '../src/playable-track-runtime.js';
import { PLAYABLE_TRACK_RESOURCES } from '../src/mechanism-resources.js';
import { SCENE_TUNING } from '../src/scene-tuning.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TRACK_IDS = ['footage8', 'footage9', 'footage10', 'footage11'];

function readTrack(id) {
  const layout = PLAYABLE_TRACK_LAYOUTS.find((entry) => entry.id === id);
  assert.ok(layout, `${id} must be in the imported catalog`);
  return layout;
}

function readContainerBytes(id) {
  const raw = fs.readFileSync(path.join(ROOT, 'public/assets/unity/conveyors/tracks', `${id}.ctk`));
  // The shipped container is gzip'd; the runtime decompresses before decoding.
  return raw[0] === 0x1f && raw[1] === 0x8b ? zlib.gunzipSync(raw) : raw;
}

test('imported tracks are registered in the shared conveyor catalog', () => {
  for (const id of TRACK_IDS) {
    assert.ok(CONVEYOR_LAYOUTS[id], `${id} must resolve through CONVEYOR_LAYOUTS`);
    assert.equal(getConveyorLayout(id).id, id);
  }
});

test('every imported track keeps the authored geometry the playable shipped', () => {
  for (const layout of PLAYABLE_TRACK_LAYOUTS) {
    assert.ok(layout.splinePoints.length >= 12, `${layout.id} curve is suspiciously short`);
    assert.ok(layout.queuePaths.length >= 1, `${layout.id} has no entrance queue`);
    assert.ok(Array.isArray(layout.pivot) && layout.pivot.length === 3, `${layout.id} has no pivot`);
    // Every authored 3D point must be a triple; the playable's own spline is 2D
    // and cannot be substituted for it.
    for (const point of layout.points3D) assert.equal(point.length, 3);
    for (const queue of layout.queuePoints3D) {
      for (const point of queue) assert.equal(point.length, 3);
    }
  }
});

test('the 3D tracks carry a real mesh container and the sprite track does not', () => {
  for (const id of ['footage8', 'footage9', 'footage10']) {
    const layout = readTrack(id);
    assert.equal(layout.kind, 'model');
    assert.ok(usesAuthoredTrackTransform(layout));
    const meshes = decodePlayableTrackContainer(readContainerBytes(id));
    assert.equal(meshes.length, 2, `${id} ships a road mesh and a shadow decal`);
    const road = meshes.find((mesh) => !mesh.shadow);
    const shadow = meshes.find((mesh) => mesh.shadow);
    assert.ok(road.position.length > 3000, `${id} road mesh lost its vertices`);
    assert.equal(road.position.length, road.normal.length);
    assert.equal(road.position.length / 3 * 2, road.uv.length);
    assert.ok(road.index.length >= 1000, `${id} road mesh lost its triangles`);
    assert.equal(shadow.position.length, 18, `${id} shadow decal is a single quad`);
  }
  const sprite = readTrack('footage11');
  assert.equal(sprite.kind, 'sprite');
  assert.equal(sprite.splinePoints.length, sprite.points3D.length);
});

test('the container decoder rejects a foreign or truncated buffer', () => {
  assert.throws(
    () => decodePlayableTrackContainer(new Uint8Array([0x41, 0x42, 0x43, 0x44, 1, 1])),
    /magic/
  );
  const bytes = readContainerBytes('footage9');
  assert.throws(() => decodePlayableTrackContainer(bytes.subarray(0, 40)), /truncated/);
});

test('the track display matrix mirrors Z and applies the authored pivot', () => {
  const layout = readTrack('footage8');
  const tuning = SCENE_TUNING.playableTracks.footage8;
  const matrix = createPlayableTrackMatrix(THREE, tuning, layout);
  const [px, py, pz] = layout.pivot;
  // The pivot itself lands on the track origin, which is what the playable's
  // transform guarantees and what keeps a re-scaled track centred.
  const pivot = new THREE.Vector3(px, py, pz).applyMatrix4(matrix);
  assert.ok(Math.abs(pivot.x - tuning.positionX) < 1e-9);
  assert.ok(Math.abs(pivot.z - tuning.positionZ) < 1e-9);
  // Z is mirrored, so an authored point in front of the pivot ends up behind it.
  const front = new THREE.Vector3(px, py, pz + 1).applyMatrix4(matrix);
  assert.ok(front.z < tuning.positionZ);
});

test('mapped track points land in the playable field, not 15 units away', () => {
  const layout = readTrack('footage8');
  const matrix = createPlayableTrackMatrix(THREE, SCENE_TUNING.playableTracks.footage8, layout);
  const points = mapPlayableTrackPoints(THREE, layout.points3D, matrix);
  for (const point of points) {
    assert.ok(Math.abs(point.x) < 8, `x ${point.x} is outside the field`);
    assert.ok(point.z > -8 && point.z < 2, `z ${point.z} is outside the field`);
  }
});

test('track surface sampling follows the mesh and refuses off-road points', () => {
  const meshes = decodePlayableTrackContainer(readContainerBytes('footage9'));
  const road = meshes.find((mesh) => !mesh.shadow);
  const surface = createPlayableTrackSurface(road, { cellSize: 0.15 });
  assert.ok(surface.roadTriangles > 100, 'road triangles must be recognised by UV');
  // A point on the road returns a finite height; a point far away returns null
  // so the caller keeps the flat-track fallback instead of teleporting a rider.
  let sampled = null;
  for (let index = 0; index < road.position.length && sampled == null; index += 3) {
    sampled = surface.heightAt(road.position[index], road.position[index + 2]);
  }
  assert.equal(typeof sampled, 'number');
  assert.ok(Number.isFinite(sampled));
  assert.equal(surface.heightAt(999, 999), null);
});

test('stacked tracks resolve to the layer the passenger is walking on', () => {
  // The spiral (footage10) passes over itself. Several triangles share one XZ
  // cell, so a sampler that scores by distance to y=0 snaps the inner turns onto
  // an outer one -- the clipping this test exists to prevent. Scoring by
  // distance to the caller's own height keeps every passenger within a
  // foot-clearance of the curve.
  const layout = readTrack('footage10');
  const tuning = SCENE_TUNING.playableTracks.footage10;
  const matrix = createPlayableTrackMatrix(THREE, tuning, layout);
  const inverse = matrix.clone().invert();
  const meshes = decodePlayableTrackContainer(readContainerBytes('footage10'));
  const road = meshes.find((mesh) => !mesh.shadow);
  const surface = createPlayableTrackSurface(road, { cellSize: 0.15 });
  const curve = new THREE.CatmullRomCurve3(
    mapPlayableTrackPoints(THREE, layout.points3D, matrix),
    true,
    'catmullrom',
    0.35
  );

  let worstReference = 0;
  let worstNaive = 0;
  let stackedSlots = 0;
  const capacity = 79;
  for (let i = 0; i < capacity; i += 1) {
    const point = curve.getPointAt(i / capacity);
    const local = point.clone().applyMatrix4(inverse);
    const naive = surface.heightAt(local.x, local.z);
    const resolved = surface.heightAt(local.x, local.z, { referenceY: local.y });
    if (naive == null || resolved == null) continue;
    const toWorldY = (height) => new THREE.Vector3(local.x, height, local.z)
      .applyMatrix4(matrix).y;
    const naiveErr = Math.abs(toWorldY(naive) - point.y);
    const resolvedErr = Math.abs(toWorldY(resolved) - point.y);
    if (naiveErr > 0.2) stackedSlots += 1;
    worstNaive = Math.max(worstNaive, naiveErr);
    worstReference = Math.max(worstReference, resolvedErr);
  }
  assert.ok(
    stackedSlots > 0,
    'this fixture must actually contain an overlapping section, or the test proves nothing'
  );
  assert.ok(
    worstNaive > 0.5,
    `the naive sampler should visibly jump layers on this track (saw ${worstNaive.toFixed(2)})`
  );
  assert.ok(
    worstReference < 0.2,
    `every slot must stay near its curve layer, worst was ${worstReference.toFixed(3)}`
  );
});

test('boarding capacity follows row spacing but never exceeds the passenger supply', () => {
  const layout = readTrack('footage8');
  const tuning = SCENE_TUNING.playableTracks.footage8;
  const base = resolvePlayableTrackBoarding(20, tuning, layout, { passengerTotal: 36 });
  const tighter = resolvePlayableTrackBoarding(20, { ...tuning, rowSpacing: 0.1 }, layout, { passengerTotal: 36 });
  assert.ok(tighter.geometricCapacity > base.geometricCapacity, 'a tighter row spacing must fit more rows');
  // The hard ceiling: a level with 36 passengers can never fill more than 36
  // slots, so a 20-unit track must not claim 100 of them.
  assert.equal(base.capacity, 36);
  assert.equal(tighter.capacity, 36);
  // Without a supply figure the geometric capacity is the fallback.
  const unbounded = resolvePlayableTrackBoarding(20, tuning, layout);
  assert.equal(unbounded.capacity, unbounded.geometricCapacity);
  assert.ok(base.exitStart < base.exitEnd);
  assert.ok(base.continuousSpeed > 0);
  assert.ok(base.initialFillSpeedMultiplier >= 1);
});

test('a short belt still reports a usable capacity when the level is small', () => {
  const layout = readTrack('footage9');
  // A one-passenger level must still produce a belt with one usable slot rather
  // than a zero-length slot ring.
  const boarding = resolvePlayableTrackBoarding(13, SCENE_TUNING.playableTracks.footage9, layout, { passengerTotal: 1 });
  assert.equal(boarding.capacity, 1);
});

test('a hidden entrance lane is removed for the model, not just the renderer', () => {
  // footage10 authors showLeftQueue: 0 -- the reference never draws its left
  // lane. Hiding it only at draw time left the gameplay model still filling that
  // lane, which is the extra column of people this test guards against. The lane
  // has to be gone from the curve list, the entry percents AND the capacities.
  const source = fs.readFileSync(path.join(ROOT, 'src/scene-view.js'), 'utf8');
  assert.match(source, /isQueueLaneVisible/, 'the view needs a lane-visibility rule');
  assert.match(
    source,
    /const visibleQueuePaths[\s\S]{0,160}laneVisible/,
    'the hidden lane must be filtered out of the queue curves'
  );
  assert.match(
    source,
    /queueCapacities = \(layout\.queueCapacities \?\? \[\]\)[\s\S]{0,120}laneVisible/,
    'the hidden lane must also drop its queue capacity'
  );
  // The flag is authored per track, and only footage10 hides a lane.
  assert.equal(SCENE_TUNING.playableTracks.footage10.showLeftQueue, 0);
  for (const id of ['footage8', 'footage9']) {
    assert.equal(
      SCENE_TUNING.playableTracks[id].showLeftQueue ?? 1,
      1,
      `${id} is a two-entrance track and must keep both lanes`
    );
  }
});

test('the Q37 pit is a real fail condition, not decoration', () => {
  // footage11's whole point is that the passenger column creeps into the pit and
  // the run fails there. Two separate mistakes are guarded here: shipping the pit
  // as artwork only (no rule at all), and percent normalization that clamped
  // before dividing, which turned 52.2 into 0.01 and made the pit unreachable.
  const source = fs.readFileSync(path.join(ROOT, 'src/game-model.js'), 'utf8');
  assert.match(source, /tailQueue/, 'the model must know about tail-queue tracks');
  assert.match(source, /q37-pit/, 'the pit must be able to end the run');
  assert.match(
    source,
    /this\.tailQueue\s*&&\s*this\.q37Danger\s*>=\s*this\.tailQueue\.failurePercent/,
    'the pit rule must compare danger against the failure threshold'
  );
  assert.match(source, /function readPercent/, 'percent inputs need a dedicated reader');
  assert.match(source, /number > 1 \? number \/ 100 : number/);

  assert.equal(SCENE_TUNING.playableTracks.footage11.initialHeadPercent, 42);
  assert.equal(SCENE_TUNING.playableTracks.footage11.warningStartPercent, 52.2);
  assert.ok(
    SCENE_TUNING.playableTracks.footage11.passengerSpeed >= 0.2,
    'the column has to actually creep, or the pit never arrives'
  );
});

test('the entry-walk call site matches its signature exactly', () => {
  // Removing the old `key` argument from the signature but not the call site
  // shifted every argument by one: `slot` landed in `key`, `target` landed in
  // `slot`, so `slot.entryMotion` read undefined and the transition silently
  // returned the queue position. Every passenger stayed where it spawned and the
  // track looked empty with no error anywhere.
  const source = fs.readFileSync(path.join(ROOT, 'src/scene-view.js'), 'utf8');
  const sig = source.match(/getInitialEntryPathVisual\(([^)]*)\)\s*\{/);
  assert.ok(sig, 'the entry-walk method must exist');
  const params = sig[1].split(',').map((p) => p.trim()).filter(Boolean);
  assert.deepEqual(params, [
    'slot', 'target', 'targetTangent', 'time', 'delta', 'speedMultiplier', 'passengerHeight'
  ]);
  const call = source.match(/this\.getInitialEntryPathVisual\(\s*([\s\S]*?)\);/);
  assert.ok(call, 'the entry-walk call site must exist');
  const args = call[1].split(',').map((a) => a.trim()).filter(Boolean);
  assert.equal(
    args.length,
    params.length,
    `call passes ${args.length} args but the method takes ${params.length}`
  );
  // The first argument must be the slot, not a leftover key.
  assert.equal(args[0], 'slot');
});

test('a starved entrance pauses the loop instead of skipping the entrance', () => {
  // The belt is rigid: every slot keeps its spacing, so it can only stop or start
  // as one piece. Two mistakes have been made here and both are guarded:
  //   - reversing the whole loop every frame after advancing (the belt rocked
  //     forwards and back; that is the stutter this started from), and
  //   - letting waiting slots flow on individually, which slid them past the
  //     entrance empty and left the track visibly bare.
  // The advance is now capped up front so the loop simply waits short of the
  // entrance.
  const source = fs.readFileSync(path.join(ROOT, 'src/game-model.js'), 'utf8');
  assert.match(source, /limitAdvanceToWaitingEntrance/, 'the belt must cap its advance');
  assert.match(
    source,
    /const progressDelta = this\.limitAdvanceToWaitingEntrance\(progressDelta0\)/,
    'the cap must be applied before slots move'
  );
  // No per-slot wake-up: that is the bug that emptied the track.
  assert.doesNotMatch(source, /initialFillHolds/, 'waiting slots must not flow independently');
});

test('the initial fill runs at the track\'s authored speed multiplier', () => {
  // A 79-slot 3D track only looks like the reference if it fills fast: the
  // shipped playables run the belt at initialFillSpeedMultiplier (4x) until every
  // slot is occupied. The multiplier was parsed but never reached the model, so
  // the opening minute showed a nearly empty track.
  const source = fs.readFileSync(path.join(ROOT, 'src/game-model.js'), 'utf8');
  assert.match(source, /initialFillSpeedMultiplier/, 'the model must accept the fill multiplier');
  assert.match(
    source,
    /this\.initialFillActive\s*\?\s*\(entryMotion\.passengerSpeed[\s\S]{0,120}initialFillSpeedMultiplier/,
    'the fill speed must be scaled by the multiplier'
  );
  const viewSource = fs.readFileSync(path.join(ROOT, 'src/scene-view.js'), 'utf8');
  assert.match(
    viewSource,
    /initialFillSpeedMultiplier:\s*Math\.max\(1,\s*Number\(layout\.initialFillSpeedMultiplier\)/,
    'the view must pass the layout multiplier into the conveyor config'
  );
  for (const id of ['footage8', 'footage9', 'footage10', 'footage11']) {
    assert.ok(
      SCENE_TUNING.playableTracks[id].initialFillSpeedMultiplier >= 1,
      `${id} must author a fill multiplier`
    );
  }
});

test('the initial fill can finish even when the queues cannot fill the belt', () => {
  // Regression for the deadlock the imported tracks exposed: the fill used to
  // end only at conveyorCapacity, so a belt larger than its passenger supply
  // froze forever and no bus ever saw a passenger.
  const source = fs.readFileSync(path.join(ROOT, 'src/game-model.js'), 'utf8');
  assert.match(source, /sourcesExhausted/, 'the model must recognise an exhausted source');
  assert.match(
    source,
    /this\.initialFilledSlotIndices\.size >= this\.conveyorCapacity \|\| sourcesExhausted/,
    'the fill must also end when the queues are empty'
  );
});

test('each imported track declares exactly the assets it renders', () => {
  for (const id of TRACK_IDS) {
    const layout = readTrack(id);
    // A model track needs its mesh, shared surface texture and its own shadow
    // decal; a sprite track needs its matte and the gameplay detail texture.
    const declared = PLAYABLE_TRACK_RESOURCES[id];
    assert.ok(declared.length >= 2, `${id} must declare its assets`);
    const files = declared.map((asset) => asset.split('/').pop());
    if (layout.kind === 'model') {
      assert.ok(files.includes(`${id}.ctk`), `${id} must ship its mesh container`);
      assert.ok(files.includes(`${id}_shadow.png`), `${id} must ship its shadow decal`);
    } else {
      assert.ok(files.includes('footage11_loop.png'), `${id} must ship its matte`);
    }
    for (const asset of declared) {
      assert.ok(asset.startsWith('/assets/unity/conveyors/tracks/'), `${asset} is outside the track folder`);
      const filePath = path.join(ROOT, 'public', asset.replace(/^\//u, ''));
      assert.ok(fs.existsSync(filePath), `${asset} is declared but missing`);
      assert.ok(fs.statSync(filePath).size > 100, `${asset} is a placeholder`);
    }
  }
});

test('every imported track has a tuning block so the editor can drive it', () => {
  for (const id of TRACK_IDS) {
    const tuning = SCENE_TUNING.playableTracks?.[id];
    assert.ok(tuning, `${id} has no editor tuning block`);
    for (const key of ['positionX', 'positionY', 'positionZ', 'scale', 'rowSpacing', 'speed', 'boardingPositionPercent']) {
      assert.equal(typeof tuning[key], 'number', `${id}.${key} must be a number`);
    }
  }
});

test('the generated defaults and the editor tuning block agree', () => {
  // The catalog entry and SCENE_TUNING are two copies of the same numbers, and
  // they drifted once: the catalog held the playable's active value while the
  // tuning block still had an inactive preset's. Keep them locked together.
  for (const id of TRACK_IDS) {
    const layout = readTrack(id);
    const tuning = SCENE_TUNING.playableTracks[id];
    for (const key of ['rowSpacing', 'boardingPositionPercent', 'boardingWidthPercent', 'scale', 'positionX', 'positionY', 'positionZ']) {
      assert.equal(
        layout.defaults[key],
        tuning[key],
        `${id}.${key}: catalog says ${layout.defaults[key]}, tuning says ${tuning[key]}`
      );
    }
  }
});

test('capacity and boarding window match the reference playable', () => {
  // Measured on the shipped build: footage10 ran a 79-slot belt over an 18.17
  // unit path with exit 0.811-0.889. Its tuning is rowSpacing 0.23 and boarding
  // 85%/7.8%; reading those numbers out of a playable that shows a *different*
  // track produced 0.32/70.75% and a visibly thinner row of passengers.
  const layout = readTrack('footage10');
  const tuning = SCENE_TUNING.playableTracks.footage10;
  const curve = new THREE.CatmullRomCurve3(
    mapPlayableTrackPoints(THREE, layout.points3D, createPlayableTrackMatrix(THREE, tuning, layout)),
    true,
    'catmullrom',
    0.35
  );
  const boarding = resolvePlayableTrackBoarding(curve.getLength(), tuning, layout);
  assert.ok(Math.abs(boarding.exitStart - 0.811) < 0.01, `exitStart ${boarding.exitStart} should be ~0.811`);
  assert.ok(Math.abs(boarding.exitEnd - 0.889) < 0.01, `exitEnd ${boarding.exitEnd} should be ~0.889`);
  assert.ok(boarding.capacity >= 72 && boarding.capacity <= 90, `capacity ${boarding.capacity} should be near the reference 79`);
});

test('the editor offers every imported track and a field group for each', () => {
  const source = fs.readFileSync(path.join(ROOT, 'src/scene-editor.js'), 'utf8');
  for (const id of TRACK_IDS) {
    assert.match(source, new RegExp(`\\['${id}',`), `${id} is missing from the layout dropdown`);
  }
  assert.match(source, /PLAYABLE_TRACK_FIELD_GROUPS/, 'imported tracks must expose tuning fields');
  assert.match(source, /\.\.\.PLAYABLE_TRACK_FIELD_GROUPS/, 'imported track fields must be installed');
});

test('the renderer drives imported tracks through the authored transform', () => {
  const source = fs.readFileSync(path.join(ROOT, 'src/scene-view.js'), 'utf8');
  assert.match(source, /buildImportedTrackCurves/, 'scene-view must build imported track curves');
  assert.match(source, /loadThreeDimensionalTrackVisual/, 'scene-view must render the 3D track mesh');
  assert.match(source, /loadSpriteTrackVisual/, 'scene-view must render the sprite track');
  assert.match(source, /resolveTrackSurfaceOffset/, 'passengers must ride the track surface');
  assert.match(source, /decodePlayableTrackContainer/, 'the CTK1 container must be decoded at runtime');
});

test('the camera fits an imported track by its curve, not a missing art plane', () => {
  // A regression this caught: imported tracks carry no art.width/depth, so the
  // standard fit collapsed to zero and cropped the outer loop off screen.
  const source = fs.readFileSync(path.join(ROOT, 'src/scene-view.js'), 'utf8');
  const fitBlock = source.slice(source.indexOf('if (includeConveyor)'), source.indexOf('if (includeConveyor)') + 1400);
  assert.match(fitBlock, /usesAuthoredTrackTransform/, 'the fit must branch for imported tracks');
  assert.match(fitBlock, /this\.curve, \.\.\.\(this\.fullQueueCurves/, 'the fit must read the track curve');
});

test('mirrored track materials are double sided so faces are not culled', () => {
  // The track root applies a Z mirror, which flips winding. Every track surface
  // (3D road, shadow decal, sprite matte, Q37 pit) has to tolerate that.
  const source = fs.readFileSync(path.join(ROOT, 'src/scene-view.js'), 'utf8');
  const start = source.indexOf('loadThreeDimensionalTrackVisual');
  const end = source.indexOf('updateSpriteTrackDanger');
  const block = source.slice(start, end);
  const doubleSided = (block.match(/side: THREE\.DoubleSide/g) ?? []).length;
  assert.ok(doubleSided >= 4, `expected every track surface double sided, found ${doubleSided}`);
});
