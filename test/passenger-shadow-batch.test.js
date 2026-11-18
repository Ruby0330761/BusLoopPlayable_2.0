import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';

import { SceneView } from '../src/scene-view.js';
import { SCENE_TUNING } from '../src/scene-tuning.js';

// These tests drive the real prototype methods against real Three.js objects.
// Source-regex assertions could not catch the two defects recorded as R3/R4 in
// docs/architecture/bl/project-review-2026-11-18.md: boarding passengers were
// missing from the batch, and flipping the switch at runtime did not restore the
// per-object meshes. Both are state bugs, so they need object-level coverage.

const SHADOW_MATERIAL = new THREE.MeshBasicMaterial({ transparent: true });

function makeShadowCarrier() {
  // Mirrors what `makeShadow` produces: a group holding one carrier mesh that is
  // tagged as batch-owned.
  const group = new THREE.Group();
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), SHADOW_MATERIAL);
  mesh.userData.isFakeShadow = true;
  mesh.userData.passengerShadowCarrier = true;
  group.add(mesh);
  group.userData.passengerShadowKind = 'conveyor';
  group.userData.shadowBaseWidth = 0.168;
  group.userData.shadowBaseDepth = 0.2;
  return group;
}

function makePassengerVisual({ shadowInsideOffsetRoot = false } = {}) {
  // Mirrors `createPassengerVisual`'s shape: shadow + person pivot under the
  // root, or — for the luxury artwork — both nested inside `visualOffsetRoot`.
  const root = new THREE.Group();
  const shadow = makeShadowCarrier();
  const personPivot = new THREE.Group();
  if (shadowInsideOffsetRoot) {
    const offsetRoot = new THREE.Group();
    offsetRoot.add(shadow, personPivot);
    root.add(offsetRoot);
    root.userData.visualOffsetRoot = offsetRoot;
  } else {
    root.add(shadow, personPivot);
  }
  root.userData.modelPivot = personPivot;
  return root;
}

function makeBeltView(visuals) {
  const view = new THREE.Group();
  view.userData.personSlots = visuals.map((visual) => {
    const slot = new THREE.Group();
    slot.add(visual);
    slot.userData.visualRoot = visual;
    return slot;
  });
  // A visible slot on a visible lane, like a filled belt position.
  view.visible = true;
  view.scale.setScalar(SCENE_TUNING.passengers.modelScale);
  return view;
}

function makeBoard() {
  const board = Object.create(SceneView.prototype);
  board.passengerViews = [];
  board.queuePassengerViews = [];
  board.boardingViews = [];
  board.passengerShadowBatch = null;
  board.passengerShadowMode = null;
  board.shadowMaterial = SHADOW_MATERIAL;
  board.shadowTemplate = new THREE.Group();
  const templateMesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), SHADOW_MATERIAL);
  board.shadowTemplate.add(templateMesh);
  board.layoutRoot = new THREE.Group();
  return board;
}

const carrierMeshesOf = (roots) => {
  const meshes = [];
  for (const root of roots) {
    root.traverse((node) => {
      if (node.isMesh && node.userData.passengerShadowCarrier) meshes.push(node);
    });
  }
  return meshes;
};

test('the shadow batch covers boarding passengers and belt slots alike', () => {
  const board = makeBoard();
  const beltVisual = makePassengerVisual();
  board.passengerViews = [makeBeltView([beltVisual])];

  // A boarding passenger is pushed into `boardingViews`, not into a belt slot.
  const boardingVisual = makePassengerVisual();
  board.boardingViews = [{ root: boardingVisual }];

  const roots = board.collectPassengerShadowRoots();
  assert.equal(roots.length, 2, 'both the belt slot and the boarding passenger must be roots');

  const carriers = board.collectShadowCarriers(roots);
  assert.equal(carriers.length, 2, 'each passenger must contribute exactly one shadow carrier');

  // Regression R3: the boarding passenger's shadow vanished for the whole walk
  // because the collector only walked `passengerViews` / `queuePassengerViews`.
  assert.ok(
    carriers.includes(carrierMeshesOf([boardingVisual])[0]),
    'the boarding passenger shadow is not batched'
  );
});

test('a shadow nested inside the luxury offset root is still collected', () => {
  const board = makeBoard();
  const luxuryVisual = makePassengerVisual({ shadowInsideOffsetRoot: true });
  board.passengerViews = [makeBeltView([luxuryVisual])];

  const carriers = board.collectShadowCarriers(board.collectPassengerShadowRoots());
  // A one-level `visual.children` scan missed this shape.
  assert.equal(carriers.length, 1, 'nested luxury shadow was dropped from the batch');
});

test('a passenger hidden by its parent contributes no shadow', () => {
  const board = makeBoard();
  const visible = makePassengerVisual();
  const hidden = makePassengerVisual();
  const hiddenView = makeBeltView([hidden]);
  // Hide at the slot, which is the carrier's direct ancestor. Hiding the root
  // group alone would leave the slot visible and is not a real passenger state.
  hiddenView.userData.personSlots[0].visible = false;
  board.passengerViews = [makeBeltView([visible]), hiddenView];

  const carriers = board.collectShadowCarriers(board.collectPassengerShadowRoots());
  assert.equal(carriers.length, 1, 'a hidden passenger must not leave a stray shadow');
});

test('entering the instanced path hides the per-object shadow meshes', () => {
  const board = makeBoard();
  const visual = makePassengerVisual();
  board.passengerViews = [makeBeltView([visual])];

  board.applyPassengerShadowMode(true);
  assert.equal(board.passengerShadowMode, 'instanced');
  for (const mesh of carrierMeshesOf([visual])) {
    assert.equal(mesh.visible, false, 'a per-object shadow would double-draw under the batch');
  }
});

test('switching instancing off at runtime restores the per-object meshes (R4)', () => {
  const board = makeBoard();
  const visual = makePassengerVisual();
  board.passengerViews = [makeBeltView([visual])];

  board.applyPassengerShadowMode(true);
  const batchMesh = new THREE.InstancedMesh(
    new THREE.PlaneGeometry(1, 1),
    SHADOW_MATERIAL,
    4
  );
  batchMesh.count = 3;
  batchMesh.visible = true;
  board.passengerShadowBatch = { mesh: batchMesh, capacity: 4, carriers: [] };

  board.applyPassengerShadowMode(false);
  assert.equal(board.passengerShadowMode, 'per-object');
  for (const mesh of carrierMeshesOf([visual])) {
    assert.equal(mesh.visible, true, 'the per-object shadow did not come back after switching off');
  }
  // The stale batch must stop drawing its last frame's instances.
  assert.equal(batchMesh.visible, false, 'the parked batch is still visible');
  assert.equal(batchMesh.count, 0, 'the parked batch kept its instances');
});

test('the runtime switch is honoured through the tuning value, both ways', () => {
  const board = makeBoard();
  const visual = makePassengerVisual();
  const view = makeBeltView([visual]);
  board.passengerViews = [view];
  board.passengerShadowBatch = {
    mesh: new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), SHADOW_MATERIAL, 8),
    capacity: 8,
    scratch: new THREE.Matrix4(),
    carriers: []
  };

  const original = SCENE_TUNING.passengerShadows.instanced;
  try {
    SCENE_TUNING.passengerShadows.instanced = 0;
    board.syncPassengerShadowBatch();
    assert.equal(board.passengerShadowMode, 'per-object', 'instanced=0 did not leave the batch path');
    assert.equal(carrierMeshesOf([visual])[0].visible, true, 'shadows stayed hidden with instancing off');

    SCENE_TUNING.passengerShadows.instanced = 1;
    board.syncPassengerShadowBatch();
    assert.equal(board.passengerShadowMode, 'instanced', 'instanced=1 did not re-enter the batch path');
    assert.equal(carrierMeshesOf([visual])[0].visible, false, 'shadows were not handed back to the batch');
  } finally {
    SCENE_TUNING.passengerShadows.instanced = original;
  }
});

test('repeated syncs keep every carrier hidden, including late arrivals', () => {
  // Regression: hiding carriers only on the mode-switch frame meant a shadow
  // created later in play (boarding, respawn) drew on top of its own instance,
  // which put the draw calls straight back (890 -> 1514 in the packaged build).
  const board = makeBoard();
  const first = makePassengerVisual();
  board.passengerViews = [makeBeltView([first])];
  board.syncPassengerShadowBatch();

  const late = makePassengerVisual();
  board.boardingViews = [{ root: late }];
  board.syncPassengerShadowBatch();
  board.syncPassengerShadowBatch();

  for (const mesh of carrierMeshesOf([first, late])) {
    assert.equal(mesh.visible, false, 'a carrier stayed visible and double-drew its shadow');
  }
  assert.equal(board.passengerShadowBatch.mesh.count, 2);
});

test('the batch wraps its matrices around freshly created carriers', () => {
  const board = makeBoard();
  const first = makePassengerVisual();
  board.passengerViews = [makeBeltView([first])];
  board.syncPassengerShadowBatch();
  const initialCount = board.passengerShadowBatch.mesh.count;
  assert.equal(initialCount, 1);

  // A boarding passenger appears later; the batch must grow, not clip.
  const boarding = makePassengerVisual();
  board.boardingViews = [{ root: boarding }];
  board.syncPassengerShadowBatch();
  assert.equal(board.passengerShadowBatch.mesh.count, 2, 'the batch kept the old instance count');
});
