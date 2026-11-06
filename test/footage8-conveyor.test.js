import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import * as THREE from 'three';
import { extractFootage8Paths } from '../scripts/extract-footage8-conveyor.mjs';
import { FOOTAGE8_LAYOUT as layout } from '../src/generated-footage8-layout.js';
import { getFootage8DisplayMatrix, getFootage8Paths, getFootage8RuntimeConfig, getFootage8QueueSpacing, connectFootage8Queues, getFootage8MergePose, getFootage8PassengerSizeMultiplier, Footage8BoardingPreview } from '../src/footage8-conveyor.js';
import { evaluateDreamteckClosedBSpline } from '../src/scene-layout.js';
import { BusLoopGame } from '../src/game-model.js';
import { makeClosedConveyorCurve } from '../src/scene-view.js';
import { Footage8Surface, Footage8RoadJoin, getFootage8RoadJoinCorners, clipFootage8RoadJoin } from '../src/footage8-surface.js';

const sourceRoot = new URL('../artifacts/footage8-source/', import.meta.url);
const source = readFileSync(new URL('ConveyorBelt_Footage8.prefab', sourceRoot), 'utf8');
const base = readFileSync(new URL('dependencies/Paths.prefab', sourceRoot), 'utf8');

test('Footage8 incoming feet stay on asphalt with body margin and continuous height through both turns', () => {
  const payload = JSON.parse(gunzipSync(readFileSync(new URL('../public/assets/unity/conveyors/footage8/track.mesh.bin', import.meta.url))));
  const geometry = new THREE.BufferGeometryLoader().parse(payload.meshes.find((m) => !m.shadow).geometry);
  const surface = new Footage8Surface(geometry, .15, { roadOnly: true });
  const inverse = getFootage8DisplayMatrix().invert();
  const { curve, entries } = makeContinuousGame();
  for (const [lane, entry] of entries.entries()) {
    let previous = [];
    for (let i = 0; i <= 600; i += 1) {
      const pose = getFootage8MergePose(curve, entry.curve, entry.entryPercent, entry.mergeDistance, entry.mergeDistance * (1 - i / 600));
      assert.ok(pose.widthScale >= .75 && pose.widthScale <= 1);
      for (const [foot, point] of rowFeet(pose.position, pose.tangent, pose.widthScale).entries()) {
        for (const [dx, dz] of [[0,0],[.05,0],[-.05,0],[0,.05],[0,-.05]]) {
          const local = point.clone().add(new THREE.Vector3(dx, 0, dz)).applyMatrix4(inverse);
          const height = surface.heightAt(local, { highest: true });
          assert.notEqual(height, null, `Lane ${lane} phase ${i}/600 foot ${foot} reaches a curb`);
          if (dx === 0 && dz === 0) {
            if (previous[foot] != null) assert.ok(Math.abs(height - previous[foot]) * 2 < .02, 'No curb/bridge height jump');
            previous[foot] = height;
          }
        }
      }
    }
  }
  geometry.dispose();
});

test('Footage8 passenger size is independent of every other conveyor', () => {
  const tuning={passengerSizeMultiplier:1.3};
  assert.equal(getFootage8PassengerSizeMultiplier('footage8',tuning),1.3);
  for(const layout of ['footage9','dualQueue3','spatial',undefined])assert.equal(getFootage8PassengerSizeMultiplier(layout,tuning),1);
  assert.equal(getFootage8PassengerSizeMultiplier('footage8'),1.2);
  assert.equal(getFootage8PassengerSizeMultiplier('footage8',{passengerSizeMultiplier:9}),1.6);
  assert.deepEqual(tuning,{passengerSizeMultiplier:1.3});
});

test('Footage8 extends a solid outlet landing into stairs or a continuous ramp with paint protection', () => {
  const matrix=getFootage8DisplayMatrix(),spots={y:.035,z:.55,modelDepth:1.46,scaleZ:.65};
  const camera=new THREE.PerspectiveCamera(25,.5,.1,100);
  camera.position.set(0,12,12);camera.lookAt(0,0,-1);camera.updateMatrixWorld(true);
  const project=p=>p.clone().project(camera);
  const minimumY=project(new THREE.Vector3(1.6,.035,spots.z-spots.modelDepth*spots.scaleZ/2)).y+.01;
  const join=new Footage8RoadJoin();
  const texture=new THREE.Texture();
  for(const steps of [0,1,3,5]) {
    join.update(matrix,spots,{roadJoinEnabled:1,roadJoinExtension:2,roadJoinLanding:.14,roadJoinSteps:steps},true,{map:texture},{project,minimumY});
    assert.equal(join.root.material.map,texture);
    assert.ok(join.sides.geometry.attributes.position.count>12);
    assert.ok(join.edges.geometry.attributes.position.count>12);
    const [left,right,endLeft,endRight]=join.corners;
    assert.equal(endLeft.y,spots.y-.012);
    for(let i=0;i<=300;i++) {
      const point=left.clone().lerp(right,.5).lerp(endLeft.clone().lerp(endRight,.5),i/300);
      const height=join.surface.heightAt(point);
      assert.notEqual(height,null,'No holes between landing, steps, and final tread');
      assert.ok(height>=endLeft.y-1e-6&&height<=left.y+1e-6);
    }
    join.root.traverse(mesh=>{
      if(!mesh.isMesh)return;
      const positions=mesh.geometry.attributes.position;
      for(let i=0;i<positions.count;i++)assert.ok(project(new THREE.Vector3().fromBufferAttribute(positions,i)).y>=minimumY-1e-6,'Protect paint from the sides and curbs as well as the road');
    });
  }
});

test('Footage8 road connection protects projected parking paint even with excessive saved extension', () => {
  const spots = { y: .035, z: .55, modelDepth: 1.46, scaleZ: .65 };
  const camera = new THREE.PerspectiveCamera(25, .5, .1, 100);
  camera.position.set(0, 12, 12);camera.lookAt(0,0,-1);camera.updateMatrixWorld(true);
  const project = (p) => p.clone().project(camera);
  const minimumY = project(new THREE.Vector3(1.6, .035, spots.z - spots.modelDepth * spots.scaleZ / 2)).y + .01;
  for (const extension of [.25,2]) {
    const corners = getFootage8RoadJoinCorners(getFootage8DisplayMatrix(), spots, extension);
    assert.ok(corners.slice(2).some((p) => project(p).y < minimumY), 'Cover the original paint overlap');
    const clipped = clipFootage8RoadJoin(corners, project, minimumY);
    assert.ok(clipped.every((p) => project(p).y >= minimumY - 1e-7));
    assert.ok(clipped[2].distanceTo(clipped[0]) < corners[2].distanceTo(corners[0]));
  }
});

test('Footage8 individual feet match actual road triangles around the full loop and both bridge levels', () => {
  const payload = JSON.parse(gunzipSync(readFileSync(new URL('../public/assets/unity/conveyors/footage8/track.mesh.bin', import.meta.url))));
  const geometry = new THREE.BufferGeometryLoader().parse(payload.meshes.find((m) => !m.shadow).geometry);
  const surface = new Footage8Surface(geometry);
  const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
  mesh.updateMatrixWorld();
  const matrix = getFootage8DisplayMatrix(), inverse = matrix.clone().invert();
  const { curve } = makeContinuousGame();
  const ray = new THREE.Raycaster(), down = new THREE.Vector3(0, -1, 0);
  let largestPriorError = 0;
  const sampledHeights = [];
  for (let i = 0; i < 512; i += 1) {
    const point = curve.getPointAt(i / 512), tangent = curve.getTangentAt(i / 512);
    for (const foot of rowFeet(point, tangent)) {
      const local = foot.clone().applyMatrix4(inverse), height = surface.heightAt(local);
      assert.notEqual(height, null);
      ray.set(new THREE.Vector3(local.x, 10, local.z), down);
      const hits = ray.intersectObject(mesh).sort((a, b) => Math.abs(a.point.y - local.y) - Math.abs(b.point.y - local.y));
      assert.ok(hits.length);
      assert.ok(Math.abs(height - hits[0].point.y) < 1e-6);
      local.y = height;
      const roadY = local.applyMatrix4(matrix).y;
      sampledHeights.push(roadY);
      largestPriorError = Math.max(largestPriorError, Math.abs(foot.y - roadY));
    }
  }
  assert.ok(largestPriorError > .15, 'Regression must cover the original floating/sinking feet');
  assert.ok(Math.max(...sampledHeights) - Math.min(...sampledHeights) > 1, 'Keep both bridge levels');
  assert.equal(surface.heightAt(new THREE.Vector3(1000, 0, 1000)), null);
  mesh.material.dispose();geometry.dispose();
});

test('Footage8 road connection overlaps the boarding lip and stops before the parking outlines', () => {
  const spots = { y: .035, z: .55, modelDepth: 1.46, scaleZ: .65 };
  const corners = getFootage8RoadJoinCorners(getFootage8DisplayMatrix(), spots);
  const [left, right, endLeft, endRight] = corners;
  assert.ok(right.x - left.x > 1.6);
  assert.ok(left.z < -.248 && right.z < -.248, 'Overlap the original lip');
  assert.ok(endLeft.z > -.248 && endRight.z > -.248, 'Cover the original gap');
  const parkingFront = spots.z - spots.modelDepth * spots.scaleZ / 2;
  assert.ok(endLeft.z < parkingFront && endRight.z < parkingFront, 'Do not paint over bay outlines');
  assert.equal(endLeft.y, spots.y - .012);
});

test('Footage8 merges inherited path points and ignores overrides outside Unity array size', () => {
  const extracted = extractFootage8Paths(source, base);
  assert.deepEqual(extracted.main.points, layout.points3D);
  assert.deepEqual(extracted.queues.map((q) => q.points), layout.queuePoints3D);
  assert.equal(extracted.main.points.length, 19);
  assert.deepEqual(extracted.queues.map((q) => q.points.length), [20, 20]);
  const changedStale = source.replace(/(propertyPath: _spline\.points\.Array\.data\[28\]\.position\.x\r?\n\s+value:) [^\r\n]+/, '$1 999999');
  assert.notEqual(changedStale, source);
  assert.deepEqual(extractFootage8Paths(changedStale, base).main.points, extracted.main.points);
  const missingOverride = source.replace(/- target: \{fileID: 277259034235598063, guid: [^\n]+\}\r?\n\s+propertyPath: _spline\.points\.Array\.data\[0\]\.position\.y\r?\n\s+value:[^\n]+\r?\n\s+objectReference:[^\n]+/, '');
  assert.notEqual(missingOverride, source);
  const inherited = extractFootage8Paths(missingOverride, base);
  assert.ok(inherited.queues[1].points[0].every(Number.isFinite));
  assert.notDeepEqual(inherited.queues[1].points[0], extracted.queues[1].points[0]);
});

test('Footage8 preserves the bridge height and its passenger route follows the supplied road surface', () => {
  const payload = JSON.parse(gunzipSync(readFileSync(new URL('../public/assets/unity/conveyors/footage8/track.mesh.bin', import.meta.url))));
  assert.ok(!JSON.stringify(payload).includes('/assets/'), 'Compressed geometry must not hide texture URLs from packaging');
  const road = payload.meshes.find((m) => !m.shadow);
  const mesh = new THREE.Mesh(new THREE.BufferGeometryLoader().parse(road.geometry), new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
  mesh.updateMatrixWorld();
  const points = layout.points3D.map((p) => new THREE.Vector3(...p));
  assert.ok(Math.max(...points.map((p) => p.y)) - Math.min(...points.map((p) => p.y)) > 0.4);
  for (let i = 0; i < 96; i += 1) {
    const p = evaluateDreamteckClosedBSpline(points, i / 96);
    const hits = new THREE.Raycaster(new THREE.Vector3(p.x, 10, p.z), new THREE.Vector3(0, -1, 0)).intersectObject(mesh);
    assert.ok(hits.length, `Road missing below path at ${i}/96`);
    // The bridge has two surfaces at its crossing; use the surface nearest
    // the authored path height instead of snapping every passenger upstairs.
    assert.ok(Math.min(...hits.map((h) => Math.abs(h.point.y - p.y))) < 0.06);
  }
  mesh.geometry.dispose();
  mesh.material.dispose();
});

test('Footage8 moves and scales the road and both passenger queues together', () => {
  const tuning = { positionX: 1.2, positionY: 0.4, positionZ: -3, scale: 1.6, rotationYDegrees: 45 };
  const matrix = getFootage8DisplayMatrix(tuning);
  const paths = getFootage8Paths(tuning);
  for (const [sourcePoints, actual] of [[layout.points3D, paths.belt], ...layout.queuePoints3D.map((p, i) => [p, paths.queues[i]])]) {
    sourcePoints.forEach((p, i) => assert.ok(new THREE.Vector3(...p).applyMatrix4(matrix).distanceTo(actual[i]) < 1e-9));
  }
  assert.ok(new THREE.Vector3(...layout.pivot).applyMatrix4(matrix).distanceTo(new THREE.Vector3(1.2, 0.4, -3)) < 1e-9);
});

test('Footage8 keeps two entrance queues and completes the initial belt fill', () => {
  const paths = getFootage8Paths();
  const curve = makeClosedConveyorCurve(paths.belt, layout.splineType);
  const queues = paths.queues.map((points) => new THREE.CatmullRomCurve3(points, false, 'catmullrom', 0.35));
  const entries = queues.map((queue) => {
    const head = queue.getPointAt(0);
    let best = 0;
    let distance = Infinity;
    for (let i = 0; i < 2048; i += 1) {
      const value = curve.getPointAt(i / 2048).distanceToSquared(head);
      if (value < distance) { best = i / 2048; distance = value; }
    }
    return best;
  });
  const game = new BusLoopGame();
  game.initializeQueues([5, 5], game.queueSpacing, [2.25, 2.35], curve.getLength(), {
    layoutId: layout.id, capacity: layout.conveyorCapacity, queueCapacities: layout.queueCapacities,
    entryPercents: entries, exitStart: layout.exitStart, exitEnd: layout.exitEnd, resetSlots: true
  });
  for (let i = 0; i < 2400; i += 1) game.update(0.05);
  assert.equal(game.queues.length, 2);
  assert.equal(game.slots.length, 32);
  assert.equal(game.initialFillActive, false);
  assert.equal(game.slots.filter((s) => s.colorIndex !== null).length, 32);
});

function makeContinuousGame(tuning = {}, level) {
  const paths = getFootage8Paths();
  const curve = makeClosedConveyorCurve(paths.belt, layout.splineType);
  const entries = connectFootage8Queues(curve, paths.queues);
  const config = getFootage8RuntimeConfig(curve, tuning);
  const spacing = curve.getLength() / config.capacity;
  const game = new BusLoopGame(level);
  game.initializeQueues([18, 18], getFootage8QueueSpacing(spacing), entries.map((e) => e.curve.getLength()), curve.getLength(), {
    ...config, queueCapacities: [18, 18], entryPercents: entries.map((e) => e.entryPercent),
    entryLeadDistances: entries.map((e) => e.mergeDistance), resetSlots: true
  });
  return { game, curve, entries, config, spacing };
}

test('Footage8 waits outside the belt and merges into reserved rows without position or facing jumps', () => {
  const { curve, entries } = makeContinuousGame();
  for (const entry of entries) {
    const start = getFootage8MergePose(curve, entry.curve, entry.entryPercent, entry.mergeDistance, entry.mergeDistance);
    const end = getFootage8MergePose(curve, entry.curve, entry.entryPercent, entry.mergeDistance, 0);
    assert.ok(start.position.distanceTo(entry.curve.getPointAt(0)) < 0.005);
    assert.ok(end.position.distanceTo(curve.getPointAt(entry.entryPercent)) < 1e-9);
    const incoming = entry.curve.getTangentAt(0).negate();
    assert.ok(incoming.dot(start.tangent) > 0.99);
    const endFacing = curve.getTangentAt(entry.entryPercent); endFacing.y = 0; endFacing.normalize();
    assert.ok(end.tangent.dot(endFacing) > 0.99);
    const near = getFootage8MergePose(curve, entry.curve, entry.entryPercent, entry.mergeDistance, 0.0001);
    assert.ok(near.position.distanceTo(end.position) < 0.002);
  }
});

test('Footage8 keeps every incoming passenger foot and its edge margin over the supplied road mesh', () => {
  const payload = JSON.parse(gunzipSync(readFileSync(new URL('../public/assets/unity/conveyors/footage8/track.mesh.bin', import.meta.url))));
  const road = payload.meshes.find((m) => !m.shadow);
  const mesh = new THREE.Mesh(new THREE.BufferGeometryLoader().parse(road.geometry), new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
  mesh.applyMatrix4(getFootage8DisplayMatrix());
  mesh.updateMatrixWorld();
  const { curve, entries } = makeContinuousGame();
  const ray = new THREE.Raycaster();
  const down = new THREE.Vector3(0, -1, 0);
  for (const [lane, entry] of entries.entries()) {
    for (let i = 0; i <= 200; i += 1) {
      const pose = getFootage8MergePose(curve, entry.curve, entry.entryPercent, entry.mergeDistance, entry.mergeDistance * i / 200);
      for (const foot of rowFeet(pose.position, pose.tangent, pose.widthScale)) {
        for (const [dx, dz] of [[0, 0], [0.04, 0], [-0.04, 0], [0, 0.04], [0, -0.04]]) {
          ray.set(new THREE.Vector3(foot.x + dx, 10, foot.z + dz), down);
          const hits = ray.intersectObject(mesh);
          assert.ok(hits.length, `Lane ${lane} at phase ${i}/200 leaves the road`);
          assert.ok(Math.min(...hits.map((hit) => Math.abs(hit.point.y - foot.y))) < 0.13);
        }
      }
    }
  }
  mesh.geometry.dispose(); mesh.material.dispose();
});

test('Footage8 waiting spacing stays compact at both dense and default belt pitches', () => {
  assert.equal(getFootage8QueueSpacing(0.2), 0.32);
  assert.equal(getFootage8QueueSpacing(0.32), 0.32);
  assert.equal(getFootage8QueueSpacing(0.5), 0.5);
  assert.ok(getFootage8QueueSpacing(0.2, 1.5) > getFootage8QueueSpacing(0.2, 1));
});

function rowFeet(position, tangent, widthScale = 1) {
  const normal = new THREE.Vector3(tangent.z, 0, -tangent.x).normalize();
  return Array.from({ length: 4 }, (_, i) => position.clone().addScaledVector(normal, (i - 1.5) * 0.2 * widthScale));
}

function closestFeet(a, b) {
  return Math.min(...a.flatMap((p) => b.map((q) => p.distanceTo(q))));
}

test('Footage8 waiting rows clear the full moving belt and merging rows clear neighbouring occupied slots', () => {
  const { curve, entries } = makeContinuousGame();
  const length = curve.getLength();
  const wrap = (v) => ((v % 1) + 1) % 1;
  for (const entry of entries) {
    const waiting = rowFeet(entry.curve.getPointAt(0), entry.curve.getTangentAt(0));
    for (let i = 0; i < 2048; i += 1) {
      const progress = i / 2048;
      assert.ok(closestFeet(waiting, rowFeet(curve.getPointAt(progress), curve.getTangentAt(progress))) > 0.3);
    }
    for (const spacing of [0.2, 0.26, 0.32]) {
      for (let i = 0; i <= 100; i += 1) {
        const remaining = entry.mergeDistance * i / 100;
        const pose = getFootage8MergePose(curve, entry.curve, entry.entryPercent, entry.mergeDistance, remaining);
        for (const neighbour of [-2, -1, 1, 2]) {
          const t = wrap(entry.entryPercent + (neighbour * spacing - remaining) / length);
          assert.ok(closestFeet(rowFeet(pose.position, pose.tangent, pose.widthScale), rowFeet(curve.getPointAt(t), curve.getTangentAt(t))) > 0.14);
        }
      }
    }
  }
});

test('Footage8 reserves empty slots early and waits for the merge before boarding', () => {
  const { game, curve, entries } = makeContinuousGame();
  const lane = 0;
  const first = game.queues[lane][0];
  const vehicle = game.vehicles.find((v) => v.colorIndex === first.colorIndex);
  Object.assign(vehicle, { state: 'at-spot', spotIndex: 0, boardedGroups: 0 });
  game.spots[0].vehicleId = vehicle.id;
  game.slots.forEach((s) => { s.progress = 0.2; });
  game.slots[0].progress = (entries[lane].releasePercent - 0.001 + 1) % 1;
  const total = game.getRemainingGroups();
  game.exitStart = 0; game.exitEnd = 1;
  game.update(0.05);
  assert.equal(game.slots[0].colorIndex, first.colorIndex);
  assert.ok(game.slots[0].entryMotion.remainingDistance > 0);
  assert.equal(vehicle.boardedGroups, 0);
  assert.equal(game.getRemainingGroups(), total);
  const remaining = game.slots[0].entryMotion.remainingDistance;
  game.configureConveyorRuntime({ exitStart: 0, exitEnd: 1, continuousSpeed: 1.6, entryLeadDistances: entries.map((e) => e.mergeDistance) });
  game.update(0.05);
  assert.ok(Math.abs(game.slots[0].entryMotion.remainingDistance - (remaining - 0.08)) < 1e-9);
  for (let i = 0; i < 30; i += 1) game.update(0.05);
  assert.ok(vehicle.boardedGroups > 0);
  assert.ok(curve.getLength() > entries[lane].mergeDistance);
});

test('Footage8 denser rows use the startup speed then cruise steadily and preserve every passenger', () => {
  for (const rowSpacing of [0.2, 0.32, 0.8]) {
    const { game, config, curve, spacing } = makeContinuousGame({ rowSpacing });
    const total = game.getRemainingGroups();
    const lanes = new Set();
    for (let i = 0; i < 1800; i += 1) {
      const previous = game.slots.map((s) => s.progress);
      const waiting = game.queues.map((q) => q.map((p) => ({ ...p })));
      const speed = config.continuousSpeed * (game.initialFillActive ? config.initialFillSpeedMultiplier : 1);
      const expectedStep = speed * 0.037 / curve.getLength();
      game.update(0.037);
      game.slots.forEach((slot, j) => {
        assert.ok(Math.abs((slot.progress - previous[j] + 1) % 1 - expectedStep) < 1e-9);
        if (slot.colorIndex !== null) lanes.add(slot.entryIndex);
      });
      for (let lane = 0; lane < 2; lane += 1) {
        for (const item of game.queues[lane]) {
          const before = waiting[lane].find((p) => p.id === item.id);
          if (before) assert.ok(before.distanceFromHead - item.distanceFromHead <= speed * game.queueSpacing / spacing * 0.037 + 1e-8);
        }
      }
      assert.equal(game.getRemainingGroups(), total);
    }
    assert.equal(game.initialFillActive, false);
    assert.equal(game.slots.filter((s) => s.colorIndex !== null).length, config.capacity);
    assert.deepEqual([...lanes].sort(), [0, 1]);
    assert.ok(Math.abs(spacing - rowSpacing) < 0.025);
    assert.equal(game.continuousConveyorSpeed, 0.8);
  }
});

test('Footage8 fills consecutive slots from each queue on the first pass instead of weaving colours through skipped slots', () => {
  const source = new BusLoopGame().level;
  for (const rowSpacing of [0.2, 0.32, 0.8]) {
    const level = { ...source, passengerQueues: [Array(200).fill(0), Array(200).fill(4)] };
    const { game, curve, entries, config } = makeContinuousGame({ rowSpacing }, level);
    const received = [[], []];
    const deadline = (curve.getLength() * 0.55 + Math.max(...entries.map((e) => e.mergeDistance))) / config.continuousSpeed;
    for (let elapsed = 0; elapsed < deadline; elapsed += 0.017) {
      const occupied = game.slots.map((s) => s.colorIndex !== null);
      game.update(0.017);
      for (const slot of game.slots) {
        if (!occupied[slot.index] && slot.colorIndex !== null) received[slot.entryIndex].push(slot.index);
      }
    }
    assert.equal(game.initialFillActive, false, `First-pass fill failed at spacing ${rowSpacing}`);
    assert.ok(game.slots.every((s) => s.colorIndex !== null));
    for (const lane of received) {
      assert.ok(lane.length > 0);
      for (let i = 1; i < lane.length; i += 1) {
        assert.equal(lane[i], (lane[i - 1] - 1 + game.conveyorCapacity) % game.conveyorCapacity);
      }
    }
    const colours = game.slots.map((s) => s.colorIndex);
    assert.equal(colours.filter((colour, i) => colour !== colours[(i + 1) % colours.length]).length, 2);
    assert.equal(game.getRemainingGroups(), 400);
  }
});

test('Footage8 halves startup time and retains the saved cruising and replenishment speeds', () => {
  for (const speed of [0.8, 1.4]) {
    const boosted = makeContinuousGame({ speed, initialFillSpeedMultiplier: 2 });
    const baseline = makeContinuousGame({ speed });
    baseline.game.configureConveyorRuntime({ ...baseline.config, initialFillSpeedMultiplier: 1 });
    const fill = ({ game }) => {
      let elapsed = 0;
      while (game.initialFillActive && elapsed < 40) {
        game.update(0.02);
        elapsed += 0.02;
      }
      assert.equal(game.initialFillActive, false);
      assert.ok(game.slots.every((s) => s.colorIndex !== null && !s.entryMotion));
      return elapsed;
    };
    const fastTime = fill(boosted);
    const normalTime = fill(baseline);
    assert.ok(Math.abs(fastTime * 2 - normalTime) < 0.05, `${fastTime} vs ${normalTime}`);
    for (const { game, curve, config } of [boosted, baseline]) {
      const progress = game.slots[0].progress;
      game.update(0.05);
      assert.ok(Math.abs((game.slots[0].progress - progress + 1) % 1 - speed * 0.05 / curve.getLength()) < 1e-9);
      game.dequeuePassenger(0, true);
      const head = game.queues[0][0];
      const distance = head.distanceFromHead;
      game.updateQueues(0.05);
      const step = speed * game.queueSpacing / (curve.getLength() / config.capacity) * 0.05;
      assert.ok(Math.abs(head.distanceFromHead - Math.max(0, distance - step)) < 1e-9);
      assert.equal(game.continuousConveyorSpeed, speed);
    }
    // Live edits must keep the startup setting without reactivating it.
    boosted.game.configureConveyorRuntime(getFootage8RuntimeConfig(boosted.curve, { speed: 1.05, initialFillSpeedMultiplier: 2 }));
    assert.equal(boosted.game.getContinuousConveyorSpeed(), 1.05);
    boosted.game.reset();
    assert.equal(boosted.game.getContinuousConveyorSpeed(), 2.1);
  }
});

test('Footage8 saved fourfold startup fills twice as fast as the previous package and preserves cruising', () => {
  for (const rowSpacing of [0.2, 0.32]) {
    const runs = [2, 4].map(initialFillSpeedMultiplier => {
      const saved = JSON.parse(JSON.stringify({ rowSpacing, speed: 0.8, initialFillSpeedMultiplier }));
      const { game, config } = makeContinuousGame(saved);
      const inventory = game.getRemainingGroups();
      let elapsed = 0;
      while (game.initialFillActive && elapsed < 20) { game.update(.01); elapsed += .01; }
      assert.equal(config.initialFillSpeedMultiplier, initialFillSpeedMultiplier);
      assert.equal(game.initialFillActive, false);
      assert.ok(game.slots.every(slot => slot.colorIndex !== null && !slot.entryMotion));
      assert.equal(game.getRemainingGroups(), inventory);
      assert.equal(game.getContinuousConveyorSpeed(), .8);
      return elapsed;
    });
    assert.ok(Math.abs(runs[0] - runs[1] * 2) < .04, runs.join(' vs '));
  }
  const { config } = makeContinuousGame();
  assert.equal(config.initialFillSpeedMultiplier, 4);
});

test('Footage8 sparse startup stays fast through the final merge and then returns to cruising', () => {
  const level = { ...new BusLoopGame().level, passengerQueues: [[0, 0, 0], [4, 4, 4]] };
  const { game, config } = makeContinuousGame({}, level);
  let sawFinalMerge = false;
  for (let frame = 0; frame < 500 && game.initialFillActive; frame += 1) {
    game.update(0.02);
    const noWaiting = !game.queues.some((q) => q.length) && !game.sourceQueues.some((q) => q.length);
    if (noWaiting && game.slots.some((s) => s.entryMotion)) {
      sawFinalMerge = true;
      assert.equal(game.initialFillActive, true);
      assert.equal(game.getContinuousConveyorSpeed(), config.continuousSpeed * config.initialFillSpeedMultiplier);
    }
  }
  assert.equal(sawFinalMerge, true);
  assert.equal(game.initialFillActive, false);
  assert.equal(game.getContinuousConveyorSpeed(), 0.8);
  assert.equal(game.getRemainingGroups(), 6);
});

test('Footage8 continuous dense merges clear following queue rows and other incoming rows', () => {
  const { curve, entries } = makeContinuousGame({ rowSpacing: 0.2 });
  const spacing = curve.getLength() / getFootage8RuntimeConfig(curve, { rowSpacing: 0.2 }).capacity;
  const queueSpacing = getFootage8QueueSpacing(spacing);
  for (const entry of entries) {
    for (let i = 0; i <= 240; i += 1) {
      const travelled = entry.mergeDistance * i / 240;
      const remaining = entry.mergeDistance - travelled;
      const pose = getFootage8MergePose(curve, entry.curve, entry.entryPercent, entry.mergeDistance, remaining);
      const feet = rowFeet(pose.position, pose.tangent, pose.widthScale);
      const followingDistance = Math.max(0, queueSpacing * (1 - travelled / spacing));
      const qProgress = followingDistance / entry.curve.getLength();
      assert.ok(closestFeet(feet, rowFeet(entry.curve.getPointAt(qProgress), entry.curve.getTangentAt(qProgress))) > 0.13);
      if (remaining + spacing <= entry.mergeDistance) {
        const following = getFootage8MergePose(curve, entry.curve, entry.entryPercent, entry.mergeDistance, remaining + spacing);
        assert.ok(closestFeet(feet, rowFeet(following.position, following.tangent, following.widthScale)) > 0.13);
      }
    }
  }
});

test('Footage8 live boarding controls share the displayed 3D zone and preserve the queues', () => {
  const { game, curve } = makeContinuousGame();
  const before = game.snapshot();
  const tuning = { boardingPositionPercent: 99, boardingWidthPercent: 8, showBoardingZone: 1 };
  const config = getFootage8RuntimeConfig(curve, tuning);
  game.configureConveyorRuntime(config);
  assert.equal(game.inExitRange(0.99), true);
  assert.equal(game.inExitRange(0.01), true);
  assert.equal(game.inExitRange(0.5), false);
  assert.deepEqual(game.snapshot().queueItems, before.queueItems);
  assert.deepEqual(game.snapshot().slots, before.slots);
  const preview = new Footage8BoardingPreview();
  preview.update(curve, tuning, true);
  assert.equal(preview.root.visible, true);
  const [band, start, end] = preview.root.children;
  assert.ok(band.geometry.getAttribute('position').count > 64);
  for (const [marker, progress] of [[start, config.exitStart], [end, config.exitEnd]]) {
    const expected = curve.getPointAt(progress); expected.y += 0.07;
    assert.ok(marker.position.distanceTo(expected) < 1e-9);
  }
  preview.update(curve, tuning, false);
  assert.equal(preview.root.visible, false, 'Production must hide authoring markers');
});

test('Footage8 boards from the edited zone and handles fewer passengers than slots', () => {
  const { game, curve } = makeContinuousGame();
  for (let i = 0; i < 500; i += 1) game.update(0.05);
  const passenger = game.slots.find((s) => s.colorIndex !== null);
  const vehicle = game.vehicles.find((v) => v.colorIndex === passenger.colorIndex);
  Object.assign(vehicle, { state: 'at-spot', spotIndex: 0, boardedGroups: 0 });
  game.spots[0].vehicleId = vehicle.id;
  game.configureConveyorRuntime(getFootage8RuntimeConfig(curve, { boardingPositionPercent: 99, boardingWidthPercent: 8 }));
  for (let i = 0; i < 600; i += 1) game.update(0.05);
  assert.ok(game.boardingEvents.length > 0);
  assert.ok(game.boardingEvents.every((e) => e.progress >= 0.95 || e.progress <= 0.03));

  const level = { ...new BusLoopGame().level, passengerQueues: [[0, 0, 0], [4, 4, 4]] };
  const { game: small } = makeContinuousGame({ rowSpacing: 0.2 }, level);
  for (let i = 0; i < 700; i += 1) small.update(0.05);
  assert.equal(small.initialFillActive, false);
  assert.equal(small.getRemainingGroups(), 6);
  assert.equal(small.slots.filter((s) => s.colorIndex !== null).length, 6);
});

test('Footage8 catches a narrow boarding zone crossed entirely within one fast frame', () => {
  const { game, curve } = makeContinuousGame();
  const vehicle = game.vehicles[0];
  Object.assign(vehicle, { state: 'at-spot', spotIndex: 0, boardedGroups: 0 });
  game.spots[0].vehicleId = vehicle.id;
  game.configureConveyorRuntime(getFootage8RuntimeConfig(curve, { speed: 3, boardingPositionPercent: 30, boardingWidthPercent: 1 }));
  game.conveyorPathLength = 4;
  Object.assign(game.slots[0], { progress: 0.29, colorIndex: vehicle.colorIndex });
  game.update(0.1);
  const event = game.boardingEvents.find((e) => e.slotIndex === 0);
  assert.ok(event);
  assert.equal(event.progress, game.exitStart);
  assert.equal(game.inExitRange(game.slots[0].progress), false);
});
