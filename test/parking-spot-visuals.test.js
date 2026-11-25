import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { SceneView } from '../src/scene-view.js';
import { SCENE_TUNING } from '../src/scene-tuning.js';
import { BusLoopGame } from '../src/game-model.js';

function fixture(count = 2) {
  const view = Object.create(SceneView.prototype);
  view.layoutRoot = new THREE.Group();
  view.spotRoots = [];
  view.spotPositions = [];
  view.spotShadows = [];
  view.seatCountBoards = [];
  view.parkingMaterial = new THREE.MeshStandardMaterial({ map: new THREE.Texture(), alphaTest: 0.02 });
  view.parkingTemplate = new THREE.Group();
  for (const [x, z, width, depth] of [[-0.3, 0, 0.03, 1], [0.3, 0, 0.03, 1], [0, -0.5, 0.6, 0.03]]) {
    const bar = new THREE.Mesh(new THREE.BoxGeometry(width, 0.05, depth), view.parkingMaterial);
    bar.position.set(x, 0, z);
    view.parkingTemplate.add(bar);
  }
  view.createSeatCountBoard = () => {
    const board = new THREE.Group();
    board.userData.boardMesh = new THREE.Mesh(new THREE.PlaneGeometry(), new THREE.MeshBasicMaterial());
    return board;
  };
  for (let index = 0; index < count; index += 1) {
    const root = new THREE.Group();
    const board = view.createSeatCountBoard();
    root.add(board);
    view.spotRoots.push(root);
    view.spotPositions.push(new THREE.Vector3());
    view.seatCountBoards.push(board);
    view.layoutRoot.add(root);
  }
  view.upgradeSpotViews();
  view.updateParkingSpotVisuals();
  return view;
}

test('parking shadow copies the authored outline silhouette and renders below the paint and cars', () => {
  const view = fixture();
  const shadow = view.spotShadows[0];
  const outline = view.spotOutlines[0];
  assert.equal(shadow.children.length, outline.children.length);
  shadow.children.forEach((mesh, index) => {
    assert.strictEqual(mesh.geometry, outline.children[index].geometry, 'retain the authored shape');
    assert.deepEqual(mesh.position.toArray(), outline.children[index].position.toArray());
    assert.ok(mesh.renderOrder < outline.children[index].renderOrder);
    assert.ok(outline.children[index].renderOrder < 0, 'paint stays below the vehicle layer');
    assert.equal(mesh.material.color.getHex(), 0x000000);
    assert.notStrictEqual(mesh.material, outline.children[index].material);
  });
  for (const material of [view.parkingMaterial, view.parkingShadowMaterial, view.parkingFillMaterial]) {
    assert.equal(material.transparent, false, 'keep ground decals before opaque cars');
    assert.equal(material.blending, THREE.CustomBlending, 'blend opacity without the transparent draw queue');
    assert.equal(material.blendSrc, THREE.SrcAlphaFactor);
    assert.equal(material.blendDst, THREE.OneMinusSrcAlphaFactor);
    assert.equal(material.depthTest, false);
    assert.equal(material.depthWrite, false);
  }
});

test('parking opacity and shadow opacity work independently without hiding seat badges', () => {
  const view = fixture();
  view.seatCountBoards[0].visible = true;
  view.updateParkingSpotVisuals({ opacity: 0, shadowOpacity: 0.7, shadowDistance: 0.1 });
  assert.equal(view.parkingMaterial.opacity, 0);
  assert.equal(view.parkingShadowMaterial.opacity, 0.7);
  assert.equal(view.spotOutlines[0].visible, false);
  assert.equal(view.spotShadows[0].visible, true);
  assert.equal(view.seatCountBoards[0].visible, true);
  view.updateParkingSpotVisuals({ opacity: 0.4, shadowOpacity: 0, shadowDistance: 0.1 });
  assert.equal(view.parkingMaterial.opacity, 0.4);
  assert.equal(view.spotOutlines[0].visible, true);
  assert.equal(view.spotShadows[0].visible, false);
});

test('shadow distance remains constant through spot scaling, rotation and movement, without accumulating', () => {
  const view = fixture(1);
  const root = view.spotRoots[0];
  for (const scaleZ of [0.25, 0.65, 1, 3]) {
    root.scale.set(1.7, 1, scaleZ);
    root.position.set(2, 0.03, -1);
    root.rotation.y = Math.PI * 0.37;
    for (let repeat = 0; repeat < 3; repeat += 1) {
      view.updateParkingSpotVisuals({ opacity: 0.6, shadowOpacity: 0.3, shadowDistance: 0.12 });
      root.updateMatrixWorld(true);
      const paint = view.spotOutlines[0].getWorldPosition(new THREE.Vector3());
      const shadow = view.spotShadows[0].getWorldPosition(new THREE.Vector3());
      const delta = shadow.clone().sub(paint);
      assert.ok(Math.abs(Math.hypot(delta.x, delta.z) - 0.12) < 1e-9);
      assert.ok(shadow.y < paint.y);
    }
  }
  view.updateParkingSpotVisuals({ opacity: 1, shadowOpacity: 1, shadowDistance: 0 });
  assert.equal(view.spotShadows[0].position.z, view.spotOutlines[0].position.z);
});

test('old presets get visible paint and shadow defaults, and invalid opacity is bounded', () => {
  const view = fixture(1);
  view.updateParkingSpotVisuals({});
  assert.equal(view.parkingMaterial.opacity, 1);
  assert.equal(view.parkingShadowMaterial.opacity, 0.35);
  assert.ok(Math.abs(view.spotShadows[0].position.z - view.spotOutlines[0].position.z - 0.04) < 1e-9);
  view.updateParkingSpotVisuals({ opacity: -5, shadowOpacity: 10, shadowDistance: -1 });
  assert.equal(view.parkingMaterial.opacity, 0);
  assert.equal(view.parkingShadowMaterial.opacity, 1);
  assert.equal(view.spotShadows[0].position.z, view.spotOutlines[0].position.z);
});

test('newly added spots get exactly one shadow and keep the seat board when upgraded again', () => {
  const view = fixture(2);
  const originalCount = SCENE_TUNING.parkingSpots.count;
  try {
    SCENE_TUNING.parkingSpots.count = 6;
    view.ensureSpotRootCount();
    view.upgradeSpotViews();
    view.upgradeSpotViews();
    view.updateParkingSpotVisuals({ opacity: 0.5, shadowOpacity: 0.2, shadowDistance: 0.1 });
    assert.equal(view.spotShadows.length, 6);
    for (let index = 0; index < 6; index += 1) {
      assert.equal(view.spotRoots[index].children.length, 4);
      assert.strictEqual(view.seatCountBoards[index].parent, view.spotRoots[index]);
      assert.strictEqual(view.spotShadows[index].parent, view.spotRoots[index]);
      assert.strictEqual(view.spotFills[index].parent, view.spotRoots[index]);
    }
    SCENE_TUNING.parkingSpots.count = 2;
    view.ensureSpotRootCount();
    assert.equal(view.spotRoots[5].visible, false);
    assert.strictEqual(view.spotRoots[5].children[0], view.spotShadows[5], 'pool retains its shadow');
  } finally {
    SCENE_TUNING.parkingSpots.count = originalCount;
  }
});

test('parking visual settings do not change the vehicle parking target', () => {
  const game = new BusLoopGame();
  const before = game.getSpotPosition(0);
  const view = fixture(1);
  view.updateParkingSpotVisuals({ opacity: 0.2, shadowOpacity: 0.8, shadowDistance: 0.5 });
  assert.deepEqual(game.getSpotPosition(0), before);
});

test('parking fill stays inside the outline and follows the spot transform below the paint and cars', () => {
  const view = fixture(1);
  const fill = view.spotFills[0];
  const outline = view.spotOutlines[0];
  const bounds = new THREE.Box3().setFromObject(outline);
  const fillBounds = new THREE.Box3().setFromObject(fill);
  assert.ok(fillBounds.min.x > bounds.min.x && fillBounds.max.x < bounds.max.x);
  assert.ok(fillBounds.min.z > bounds.min.z && fillBounds.max.z < bounds.max.z);
  assert.ok(fillBounds.max.y < bounds.max.y);
  assert.ok(fill.renderOrder > view.spotShadows[0].children[0].renderOrder);
  assert.ok(fill.renderOrder < outline.children[0].renderOrder);
  const local = fill.position.clone();
  const root = view.spotRoots[0];
  root.position.set(4, 0.2, -3);
  root.rotation.y = 0.7;
  root.scale.set(2, 1, 0.5);
  root.updateMatrixWorld(true);
  assert.ok(fill.getWorldPosition(new THREE.Vector3()).distanceTo(root.localToWorld(local)) < 1e-9);
});

test('fill colour and alpha are independent of the outline, shadow and seat board', () => {
  const view = fixture(1);
  view.seatCountBoards[0].visible = true;
  view.updateParkingSpotVisuals({ opacity: 0, shadowOpacity: 0, fillColor: 0xaaccff, fillOpacity: 0.6 });
  assert.equal(view.parkingFillMaterial.color.getHex(), 0xaaccff);
  assert.equal(view.parkingFillMaterial.opacity, 0.6);
  assert.equal(view.spotFills[0].visible, true);
  assert.equal(view.spotOutlines[0].visible, false);
  assert.equal(view.spotShadows[0].visible, false);
  assert.equal(view.seatCountBoards[0].visible, true);
  view.updateParkingSpotVisuals({ opacity: 1, shadowOpacity: 0.5, fillOpacity: 0 });
  assert.equal(view.spotFills[0].visible, false);
  assert.equal(view.spotOutlines[0].visible, true);
  assert.equal(view.spotShadows[0].visible, true);
  view.updateParkingSpotVisuals({});
  assert.equal(view.parkingFillMaterial.color.getHex(), 0xe8eaf2);
  assert.equal(view.parkingFillMaterial.opacity, 0.18);
});
