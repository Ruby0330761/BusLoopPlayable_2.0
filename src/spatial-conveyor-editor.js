import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import './spatial-conveyor-editor.css';
import { SpatialConveyorEditModel } from './spatial-conveyor-edit-model.js';
import {
  getSpatialConveyorWorldNormals,
  getSpatialConveyorWorldPoints,
  mapSpatialWorldPointToPackage,
  registerSpatialConveyorPackage
} from './spatial-conveyor-runtime.js';

const EDITOR_CAMERA_FOV = 40;
const EDITOR_CAMERA_NEAR = 0.01;
const EDITOR_CAMERA_FAR = 100000;
const EDITOR_CAMERA_MIN_DISTANCE = 0.01;
const EDITOR_CAMERA_MAX_DISTANCE = 100000;

function makeButton(label, title, className = '') {
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = label;
  button.title = title;
  if (className) button.className = className;
  return button;
}

function round(value) {
  return Number(value).toFixed(3);
}

function setPointPosition(point, position) {
  const previous = point.position ?? { x: 0, y: 0, z: 0 };
  const tangentMatched = ['x', 'y', 'z'].every((axis) => (
    Math.abs((Number(point.tangent?.[axis]) || 0) - (Number(previous[axis]) || 0)) < 0.000001
  ));
  const tangent2Matched = ['x', 'y', 'z'].every((axis) => (
    Math.abs((Number(point.tangent2?.[axis]) || 0) - (Number(previous[axis]) || 0)) < 0.000001
  ));
  point.position = { x: position.x, y: position.y, z: position.z };
  if (tangentMatched) point.tangent = { ...point.position };
  if (tangent2Matched) point.tangent2 = { ...point.position };
}

function makeWorldCurve(points) {
  return new THREE.CatmullRomCurve3(points, false, 'catmullrom', 0.35);
}

function captureCameraState(camera) {
  return {
    position: camera.position.clone(),
    quaternion: camera.quaternion.clone(),
    up: camera.up.clone(),
    fov: camera.fov,
    near: camera.near,
    far: camera.far,
    zoom: camera.zoom
  };
}

function restoreCameraState(camera, state) {
  camera.position.copy(state.position);
  camera.quaternion.copy(state.quaternion);
  camera.up.copy(state.up);
  camera.fov = state.fov;
  camera.near = state.near;
  camera.far = state.far;
  camera.zoom = state.zoom;
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld(true);
}

export function createSpatialConveyorEditor({
  view,
  packageData,
  displayTuning,
  baseRevision = null,
  onClose = () => {},
  onSaved = () => {}
}) {
  let lastSavedPackage = structuredClone(packageData);
  const model = new SpatialConveyorEditModel(packageData, {
    curvePointMapper: (data) => getSpatialConveyorWorldPoints(data, displayTuning)
  });
  const originalCameraState = captureCameraState(view.camera);
  const originalBackgroundVisible = view.backgroundPlane?.visible ?? true;
  view.camera.fov = EDITOR_CAMERA_FOV;
  view.camera.near = EDITOR_CAMERA_NEAR;
  view.camera.far = EDITOR_CAMERA_FAR;
  view.camera.zoom = 1;
  view.camera.updateProjectionMatrix();
  if (view.backgroundPlane) view.backgroundPlane.visible = false;
  let currentRevision = baseRevision;
  let disposed = false;
  let previewFrame = 0;
  let transformBefore = null;
  let transformWorldPoints = [];
  let transformPivot = new THREE.Vector3();
  let transformPivotQuaternion = new THREE.Quaternion();
  let pivotMode = 'center';
  let pointerStart = null;
  let boxSelecting = false;
  let editorCameraState = null;
  let toolbarDrag = null;
  let toolbarMoved = false;

  const overlay = document.createElement('div');
  overlay.className = 'spatial-point-editor';
  overlay.innerHTML = `
    <div class="spatial-point-toolbar" role="toolbar" aria-label="立体轨道点位工具"></div>
    <aside class="spatial-point-panel">
      <header>
        <div><span>SPATIAL PATH</span><h2>${packageData.label || packageData.id}</h2></div>
        <button class="spatial-point-close" type="button" aria-label="关闭">×</button>
      </header>
      <div class="spatial-point-summary"></div>
      <section>
        <h3>活动点坐标</h3>
        <div class="spatial-point-vector" data-vector="position"></div>
      </section>
      <section>
        <h3>截面旋转</h3>
        <div class="spatial-point-vector" data-vector="rotation"></div>
      </section>
      <section>
        <h3>点宽度</h3>
        <label class="spatial-point-field"><span>Size</span><input data-point-size type="number" min="0.05" max="20" step="0.05"></label>
      </section>
      <section>
        <h3>乘客进入轨道点</h3>
        <div class="spatial-point-entrance-row">
          <label class="spatial-point-field"><span>轨道百分比</span><input data-entrance-percent type="number" min="0" max="1" step="0.001"></label>
          <button data-entrance-from-active type="button" title="将乘客进入轨道点移动到当前活动点">设为活动点</button>
        </div>
        <input class="spatial-point-entrance-range" data-entrance-range type="range" min="0" max="1" step="0.001">
      </section>
      <section>
        <h3>同色车辆上车检测点</h3>
        <div class="spatial-point-entrance-row">
          <label class="spatial-point-field"><span>检测中心</span><input data-boarding-percent type="number" min="0" max="1" step="0.001"></label>
          <button data-boarding-from-active type="button" title="将上车检测中心移动到当前活动点">设为活动点</button>
        </div>
        <input class="spatial-point-entrance-range is-boarding" data-boarding-range type="range" min="0" max="1" step="0.001">
        <label class="spatial-point-field spatial-point-boarding-width"><span>检测范围</span><input data-boarding-width type="number" min="0.001" max="1" step="0.001"></label>
      </section>
      <p class="spatial-point-status" aria-live="polite"></p>
      <div class="spatial-point-save-actions"></div>
    </aside>
    <div class="spatial-point-selection-box" hidden></div>
  `;
  document.body.append(overlay);

  const toolbar = overlay.querySelector('.spatial-point-toolbar');
  const panel = overlay.querySelector('.spatial-point-panel');
  const summary = overlay.querySelector('.spatial-point-summary');
  const status = overlay.querySelector('.spatial-point-status');
  const selectionBox = overlay.querySelector('.spatial-point-selection-box');
  const saveActions = overlay.querySelector('.spatial-point-save-actions');
  const sizeInput = overlay.querySelector('[data-point-size]');
  const entranceInput = overlay.querySelector('[data-entrance-percent]');
  const entranceRange = overlay.querySelector('[data-entrance-range]');
  const entranceFromActiveButton = overlay.querySelector('[data-entrance-from-active]');
  const boardingInput = overlay.querySelector('[data-boarding-percent]');
  const boardingRange = overlay.querySelector('[data-boarding-range]');
  const boardingWidthInput = overlay.querySelector('[data-boarding-width]');
  const boardingFromActiveButton = overlay.querySelector('[data-boarding-from-active]');
  const positionInputs = {};
  const rotationInputs = {};

  for (const [container, target, min, max, step] of [
    [overlay.querySelector('[data-vector="position"]'), positionInputs, -1000, 1000, 0.01],
    [overlay.querySelector('[data-vector="rotation"]'), rotationInputs, -360, 360, 1]
  ]) {
    for (const axis of ['x', 'y', 'z']) {
      const label = document.createElement('label');
      label.className = 'spatial-point-field';
      label.innerHTML = `<span>${axis.toUpperCase()}</span><input type="number" min="${min}" max="${max}" step="${step}">`;
      target[axis] = label.querySelector('input');
      container.append(label);
    }
  }

  const toolbarHandle = makeButton('⠿', '拖动工具栏', 'spatial-point-toolbar-handle is-icon');
  toolbarHandle.setAttribute('aria-label', '拖动工具栏');
  const undoButton = makeButton('↶', '撤销 Ctrl+Z', 'is-icon');
  const redoButton = makeButton('↷', '反撤销 Ctrl+Y', 'is-icon');
  const moveButton = makeButton('W 移动', '移动选中点');
  const rotateButton = makeButton('E 旋转', '围绕选区中心旋转点位');
  const scaleButton = makeButton('R 缩放', '围绕选区中心缩放点位');
  const spaceButton = makeButton('世界轴', '切换世界轴和局部轴');
  const pivotButton = makeButton('选区中心', '切换选区中心和活动点轴心');
  const focusButton = makeButton('F 聚焦', '聚焦选中点；未选点时显示全部轨道');
  const resetViewButton = makeButton('Home 复位', '恢复轨道编辑器初始视角');
  const prependButton = makeButton('首部加点', '在轨道起点外增加一点');
  const insertButton = makeButton('中间插点', '在活动点与下一点之间插入');
  const appendButton = makeButton('尾部加点', '在轨道终点外增加一点');
  const deleteButton = makeButton('删除', '删除选中点 Delete');
  toolbar.append(
    toolbarHandle,
    undoButton,
    redoButton,
    moveButton,
    rotateButton,
    scaleButton,
    spaceButton,
    pivotButton,
    focusButton,
    resetViewButton,
    prependButton,
    insertButton,
    appendButton,
    deleteButton
  );

  const saveButton = makeButton('保存', '写入当前轨道JSON', 'is-primary');
  const saveAsButton = makeButton('另存副本', '以新名称保存轨道副本');
  const closeButton = makeButton('关闭', '退出点位编辑器');
  saveActions.append(saveButton, saveAsButton, closeButton);

  const pointRoot = new THREE.Group();
  pointRoot.name = 'Spatial Point Editor Handles';
  const pointMeshes = [];
  const normalArrow = new THREE.ArrowHelper(
    new THREE.Vector3(0, 1, 0),
    new THREE.Vector3(),
    0.8,
    0xffb000,
    0.18,
    0.1
  );
  normalArrow.renderOrder = 2100;
  pointRoot.add(normalArrow);
  const entranceMarker = new THREE.Mesh(
    new THREE.SphereGeometry(0.19, 16, 10),
    new THREE.MeshBasicMaterial({ color: 0x24c56f, depthTest: false, depthWrite: false })
  );
  entranceMarker.name = 'Spatial Passenger Entrance';
  entranceMarker.renderOrder = 2110;
  const exitStartMarker = new THREE.Mesh(
    new THREE.SphereGeometry(0.14, 14, 8),
    new THREE.MeshBasicMaterial({ color: 0xff9f1c, depthTest: false, depthWrite: false })
  );
  exitStartMarker.name = 'Spatial Exit Start';
  exitStartMarker.renderOrder = 2105;
  const exitEndMarker = exitStartMarker.clone();
  exitEndMarker.material = exitStartMarker.material.clone();
  exitEndMarker.material.color.setHex(0xf04444);
  exitEndMarker.name = 'Spatial Exit End';
  const boardingMarker = new THREE.Mesh(
    new THREE.OctahedronGeometry(0.21, 0),
    new THREE.MeshBasicMaterial({ color: 0xd946ef, depthTest: false, depthWrite: false })
  );
  boardingMarker.name = 'Spatial Boarding Detection Center';
  boardingMarker.renderOrder = 2110;
  pointRoot.add(entranceMarker, boardingMarker, exitStartMarker, exitEndMarker);
  view.scene.add(pointRoot);

  const pivot = new THREE.Object3D();
  pivot.name = 'Spatial Point Editor Pivot';
  view.scene.add(pivot);
  const transformControls = new TransformControls(view.camera, view.canvas);
  const transformHelper = transformControls.getHelper();
  transformHelper.renderOrder = 2200;
  view.scene.add(transformHelper);
  transformControls.attach(pivot);
  transformControls.setMode('translate');
  transformControls.setSpace('world');
  transformControls.setSize(0.72);
  const orbitControls = new OrbitControls(view.camera, view.canvas);
  orbitControls.enableDamping = false;
  orbitControls.screenSpacePanning = true;
  orbitControls.zoomToCursor = true;
  orbitControls.zoomSpeed = 1.2;
  orbitControls.panSpeed = 0.9;
  orbitControls.rotateSpeed = 0.7;
  orbitControls.minDistance = EDITOR_CAMERA_MIN_DISTANCE;
  orbitControls.maxDistance = EDITOR_CAMERA_MAX_DISTANCE;
  orbitControls.mouseButtons.LEFT = null;
  orbitControls.mouseButtons.MIDDLE = THREE.MOUSE.PAN;
  orbitControls.mouseButtons.RIGHT = THREE.MOUSE.ROTATE;
  orbitControls.touches.ONE = THREE.TOUCH.ROTATE;
  orbitControls.touches.TWO = THREE.TOUCH.DOLLY_PAN;

  function selectedIndices() {
    return [...model.selection].sort((a, b) => a - b);
  }

  function preserveEditorCamera(action) {
    const cameraState = captureCameraState(view.camera);
    const target = orbitControls.target.clone();
    action();
    restoreCameraState(view.camera, cameraState);
    if (view.backgroundPlane) view.backgroundPlane.visible = false;
    orbitControls.target.copy(target);
    orbitControls.update();
  }

  function focusWorldPoints(points, { remember = false } = {}) {
    if (!points.length) return;
    const bounds = new THREE.Box3().setFromPoints(points);
    const center = bounds.getCenter(new THREE.Vector3());
    const radius = Math.max(0.5, bounds.getBoundingSphere(new THREE.Sphere()).radius);
    const direction = view.camera.position.clone().sub(orbitControls.target);
    if (direction.lengthSq() < 0.000001) direction.set(0, 1, 1);
    direction.normalize();
    const verticalFov = THREE.MathUtils.degToRad(view.camera.fov);
    const horizontalFov = 2 * Math.atan(Math.tan(verticalFov * 0.5) * Math.max(0.1, view.camera.aspect));
    const fitFov = Math.max(THREE.MathUtils.degToRad(8), Math.min(verticalFov, horizontalFov));
    const distance = Math.max(radius * 2, radius / Math.sin(fitFov * 0.5) * 1.15);
    orbitControls.target.copy(center);
    view.camera.position.copy(center).addScaledVector(direction, distance);
    view.camera.near = EDITOR_CAMERA_NEAR;
    view.camera.far = EDITOR_CAMERA_FAR;
    orbitControls.minDistance = EDITOR_CAMERA_MIN_DISTANCE;
    orbitControls.maxDistance = EDITOR_CAMERA_MAX_DISTANCE;
    orbitControls.update();
    view.camera.updateProjectionMatrix();
    if (remember) {
      editorCameraState = {
        camera: captureCameraState(view.camera),
        target: orbitControls.target.clone()
      };
    }
  }

  function focusSelection() {
    const worldPoints = getSpatialConveyorWorldPoints(model.packageData, displayTuning);
    const selected = selectedIndices().map((index) => worldPoints[index]).filter(Boolean);
    focusWorldPoints(selected.length ? selected : worldPoints);
    status.textContent = selected.length ? '已聚焦选中点' : '已显示全部轨道';
  }

  function resetEditorView() {
    if (!editorCameraState) return;
    restoreCameraState(view.camera, editorCameraState.camera);
    orbitControls.target.copy(editorCameraState.target);
    orbitControls.update();
    status.textContent = '已恢复轨道编辑视角';
  }

  function clampToolbarPosition() {
    if (!toolbarMoved) return;
    const configuredWidth = Number.parseFloat(toolbar.style.width) || toolbar.getBoundingClientRect().width;
    toolbar.style.width = `${Math.min(configuredWidth, Math.max(120, window.innerWidth - 12))}px`;
    const rect = toolbar.getBoundingClientRect();
    const left = THREE.MathUtils.clamp(Number.parseFloat(toolbar.style.left) || 0, 6, Math.max(6, window.innerWidth - rect.width - 6));
    const top = THREE.MathUtils.clamp(Number.parseFloat(toolbar.style.top) || 0, 6, Math.max(6, window.innerHeight - rect.height - 6));
    toolbar.style.left = `${left}px`;
    toolbar.style.top = `${top}px`;
  }

  function onToolbarPointerDown(event) {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    const rect = toolbar.getBoundingClientRect();
    toolbarMoved = true;
    toolbar.style.transform = 'none';
    toolbar.style.right = 'auto';
    toolbar.style.width = `${rect.width}px`;
    toolbar.style.left = `${rect.left}px`;
    toolbar.style.top = `${rect.top}px`;
    toolbarDrag = { pointerId: event.pointerId, offsetX: event.clientX - rect.left, offsetY: event.clientY - rect.top };
    toolbarHandle.setPointerCapture(event.pointerId);
    toolbarHandle.classList.add('is-dragging');
  }

  function onToolbarPointerMove(event) {
    if (!toolbarDrag || event.pointerId !== toolbarDrag.pointerId) return;
    toolbar.style.left = `${event.clientX - toolbarDrag.offsetX}px`;
    toolbar.style.top = `${event.clientY - toolbarDrag.offsetY}px`;
    clampToolbarPosition();
  }

  function onToolbarPointerUp(event) {
    if (!toolbarDrag || event.pointerId !== toolbarDrag.pointerId) return;
    toolbarDrag = null;
    toolbarHandle.classList.remove('is-dragging');
    if (toolbarHandle.hasPointerCapture(event.pointerId)) toolbarHandle.releasePointerCapture(event.pointerId);
    clampToolbarPosition();
  }

  function updatePointMeshes() {
    const worldPoints = getSpatialConveyorWorldPoints(model.packageData, displayTuning);
    while (pointMeshes.length < worldPoints.length) {
      const material = new THREE.MeshBasicMaterial({
        color: 0x38bdf8,
        depthTest: false,
        depthWrite: false,
        transparent: true,
        opacity: 0.95
      });
      const mesh = new THREE.Mesh(new THREE.SphereGeometry(0.115, 12, 8), material);
      mesh.renderOrder = 2000;
      mesh.userData.spatialPointIndex = pointMeshes.length;
      pointMeshes.push(mesh);
      pointRoot.add(mesh);
    }
    while (pointMeshes.length > worldPoints.length) {
      const mesh = pointMeshes.pop();
      pointRoot.remove(mesh);
      mesh.geometry.dispose();
      mesh.material.dispose();
    }
    for (let index = 0; index < worldPoints.length; index += 1) {
      const mesh = pointMeshes[index];
      mesh.userData.spatialPointIndex = index;
      mesh.position.copy(worldPoints[index]);
      mesh.material.color.setHex(model.selection.has(index) ? 0xffd43b : 0x38bdf8);
      mesh.scale.setScalar(model.activeIndex === index ? 1.35 : 1);
    }
    let line = pointRoot.getObjectByName('Spatial Point Centerline');
    if (!line) {
      line = new THREE.Line(
        new THREE.BufferGeometry(),
        new THREE.LineBasicMaterial({ color: 0xffffff, depthTest: false, transparent: true, opacity: 0.72 })
      );
      line.name = 'Spatial Point Centerline';
      line.renderOrder = 1990;
      pointRoot.add(line);
    }
    line.geometry.dispose();
    line.geometry = new THREE.BufferGeometry().setFromPoints(worldPoints);

    const curve = makeWorldCurve(worldPoints);
    const entrancePercent = THREE.MathUtils.clamp(Number(model.packageData.entrances?.[0]?.percent) || 0, 0, 1);
    entranceMarker.position.copy(curve.getPointAt(entrancePercent));
    const exit = model.packageData.exit;
    boardingMarker.visible = Boolean(exit);
    exitStartMarker.visible = Boolean(exit);
    exitEndMarker.visible = Boolean(exit);
    if (exit) {
      boardingMarker.position.copy(curve.getPointAt(model.getBoardingPercent()));
      exitStartMarker.position.copy(curve.getPointAt(THREE.MathUtils.clamp(Number(exit.startPercent) || 0, 0, 1)));
      exitEndMarker.position.copy(curve.getPointAt(THREE.MathUtils.clamp(Number(exit.endPercent) || 0, 0, 1)));
    }

    const selected = selectedIndices();
    transformHelper.visible = selected.length > 0;
    if (selected.length && !transformControls.dragging) {
      if (pivotMode === 'active' && model.activeIndex != null) {
        transformPivot.copy(worldPoints[model.activeIndex]);
      } else {
        transformPivot.set(0, 0, 0);
        for (const index of selected) transformPivot.add(worldPoints[index]);
        transformPivot.multiplyScalar(1 / selected.length);
      }
      pivot.position.copy(transformPivot);
      pivot.quaternion.identity();
      if (transformControls.space === 'local' && model.activeIndex != null) {
        const activeIndex = model.activeIndex;
        const previous = worldPoints[Math.max(0, activeIndex - 1)];
        const next = worldPoints[Math.min(worldPoints.length - 1, activeIndex + 1)];
        const tangent = next.clone().sub(previous).normalize();
        const normal = getSpatialConveyorWorldNormals(model.packageData, displayTuning)[activeIndex];
        normal.addScaledVector(tangent, -normal.dot(tangent)).normalize();
        const lateral = normal.clone().cross(tangent).normalize();
        const up = tangent.clone().cross(lateral).normalize();
        pivot.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(lateral, up, tangent));
      }
      pivot.scale.set(1, 1, 1);
    }
    const activePoint = model.points[model.activeIndex];
    const activeWorld = worldPoints[model.activeIndex];
    const activeNormal = getSpatialConveyorWorldNormals(model.packageData, displayTuning)[model.activeIndex];
    normalArrow.visible = Boolean(activePoint && activeWorld && activeNormal);
    if (normalArrow.visible) {
      normalArrow.position.copy(activeWorld);
      normalArrow.setDirection(activeNormal);
    }
  }

  function syncPanel() {
    const active = model.points[model.activeIndex];
    summary.textContent = `${model.points.length} 个点 · 已选 ${model.selection.size} 个${model.dirty ? ' · 未保存' : ''}`;
    undoButton.disabled = model.undoStack.length === 0;
    redoButton.disabled = model.redoStack.length === 0;
    deleteButton.disabled = !model.selection.size || model.points.length - model.selection.size < 3;
    insertButton.disabled = model.activeIndex == null || model.activeIndex >= model.points.length - 1;
    for (const axis of ['x', 'y', 'z']) {
      positionInputs[axis].disabled = !active;
      rotationInputs[axis].disabled = !active;
      positionInputs[axis].value = active ? round(active.position?.[axis] ?? 0) : '';
      rotationInputs[axis].value = active ? round(active.editorRotationDegrees?.[axis] ?? 0) : '';
    }
    sizeInput.disabled = !active;
    sizeInput.value = active ? round(active.size ?? 1) : '';
    const entrancePercent = THREE.MathUtils.clamp(Number(model.packageData.entrances?.[0]?.percent) || 0, 0, 1);
    entranceInput.value = round(entrancePercent);
    entranceRange.value = String(entrancePercent);
    entranceFromActiveButton.disabled = model.activeIndex == null;
    const boardingPercent = model.getBoardingPercent();
    boardingInput.value = round(boardingPercent);
    boardingRange.value = String(boardingPercent);
    boardingWidthInput.value = round(model.getBoardingRangeWidth());
    boardingFromActiveButton.disabled = model.activeIndex == null;
  }

  function schedulePreview() {
    if (previewFrame) return;
    previewFrame = requestAnimationFrame(() => {
      previewFrame = 0;
      registerSpatialConveyorPackage(model.packageData);
      preserveEditorCamera(() => view.refreshSpatialConveyorDraft());
      updatePointMeshes();
      syncPanel();
    });
  }

  function updateSelectionOnly() {
    updatePointMeshes();
    syncPanel();
  }

  function commitSimple(action, message) {
    if (!action()) return;
    status.textContent = message;
    schedulePreview();
  }

  function setTransformMode(mode) {
    transformControls.setMode(mode);
    for (const [button, buttonMode] of [
      [moveButton, 'translate'],
      [rotateButton, 'rotate'],
      [scaleButton, 'scale']
    ]) button.classList.toggle('is-active', mode === buttonMode);
  }

  async function save(targetId = model.packageData.id) {
    const isClone = targetId !== model.packageData.id;
    const data = structuredClone(model.packageData);
    if (isClone) {
      data.id = targetId;
      data.label = targetId;
      data.source = { ...(data.source ?? {}), clonedFrom: model.packageData.id };
    }
    status.textContent = '正在保存...';
    const response = await fetch(`/__spatial-conveyors/package/${encodeURIComponent(targetId)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify({ packageData: data, baseRevision: isClone ? null : currentRevision })
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || `HTTP ${response.status}`);
    model.packageData = payload.packageData;
    currentRevision = payload.revision;
    model.markSaved();
    lastSavedPackage = structuredClone(model.packageData);
    registerSpatialConveyorPackage(model.packageData);
    preserveEditorCamera(() => view.refreshSpatialConveyorDraft());
    await onSaved({ packageData: model.packageData, isClone, savedPath: payload.savedPath });
    status.textContent = `已保存 ${payload.savedPath}`;
    updatePointMeshes();
    syncPanel();
  }

  async function close() {
    if (disposed) return;
    if (model.dirty && !window.confirm('轨道点位尚未保存，确定放弃这些修改吗？')) return;
    const restore = model.dirty ? lastSavedPackage : model.packageData;
    registerSpatialConveyorPackage(restore);
    view.refreshSpatialConveyorDraft();
    dispose();
    onClose({ packageData: restore, saved: !model.dirty });
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    if (previewFrame) cancelAnimationFrame(previewFrame);
    window.removeEventListener('keydown', onKeyDown, true);
    window.removeEventListener('pointermove', onPointerMove, true);
    window.removeEventListener('pointerup', onPointerUp, true);
    window.removeEventListener('resize', clampToolbarPosition);
    window.removeEventListener('beforeunload', onBeforeUnload);
    view.canvas.removeEventListener('pointerdown', onPointerDown, true);
    view.canvas.removeEventListener('contextmenu', onContextMenu);
    toolbarHandle.removeEventListener('pointerdown', onToolbarPointerDown);
    toolbarHandle.removeEventListener('pointermove', onToolbarPointerMove);
    toolbarHandle.removeEventListener('pointerup', onToolbarPointerUp);
    toolbarHandle.removeEventListener('pointercancel', onToolbarPointerUp);
    orbitControls.dispose();
    transformControls.dispose();
    view.setInputEnabled(true);
    view.scene.remove(transformHelper, pivot, pointRoot);
    for (const mesh of pointMeshes) {
      mesh.geometry.dispose();
      mesh.material.dispose();
    }
    const line = pointRoot.getObjectByName('Spatial Point Centerline');
    line?.geometry.dispose();
    line?.material.dispose();
    entranceMarker.geometry.dispose();
    entranceMarker.material.dispose();
    exitStartMarker.geometry.dispose();
    exitStartMarker.material.dispose();
    exitEndMarker.material.dispose();
    boardingMarker.geometry.dispose();
    boardingMarker.material.dispose();
    restoreCameraState(view.camera, originalCameraState);
    if (view.backgroundPlane) view.backgroundPlane.visible = originalBackgroundVisible;
    overlay.remove();
  }

  function onBeforeUnload(event) {
    if (!model.dirty) return;
    event.preventDefault();
    event.returnValue = '';
  }

  function onPointerDown(event) {
    if (event.button !== 0 || transformControls.axis || panel.contains(event.target) || toolbar.contains(event.target)) return;
    pointerStart = { x: event.clientX, y: event.clientY, ctrl: event.ctrlKey || event.metaKey, shift: event.shiftKey };
    boxSelecting = false;
  }

  function onContextMenu(event) {
    event.preventDefault();
  }

  function onPointerMove(event) {
    if (!pointerStart || transformControls.dragging) return;
    const dx = event.clientX - pointerStart.x;
    const dy = event.clientY - pointerStart.y;
    if (!boxSelecting && Math.hypot(dx, dy) < 5) return;
    boxSelecting = true;
    const left = Math.min(pointerStart.x, event.clientX);
    const top = Math.min(pointerStart.y, event.clientY);
    selectionBox.hidden = false;
    selectionBox.style.left = `${left}px`;
    selectionBox.style.top = `${top}px`;
    selectionBox.style.width = `${Math.abs(dx)}px`;
    selectionBox.style.height = `${Math.abs(dy)}px`;
  }

  function onPointerUp(event) {
    if (!pointerStart || transformControls.dragging) return;
    const start = pointerStart;
    pointerStart = null;
    selectionBox.hidden = true;
    if (boxSelecting) {
      boxSelecting = false;
      const left = Math.min(start.x, event.clientX);
      const right = Math.max(start.x, event.clientX);
      const top = Math.min(start.y, event.clientY);
      const bottom = Math.max(start.y, event.clientY);
      const rect = view.canvas.getBoundingClientRect();
      const indices = pointMeshes.filter((mesh) => {
        const projected = mesh.position.clone().project(view.camera);
        const x = rect.left + (projected.x + 1) * rect.width * 0.5;
        const y = rect.top + (1 - projected.y) * rect.height * 0.5;
        return projected.z >= -1 && projected.z <= 1 && x >= left && x <= right && y >= top && y <= bottom;
      }).map((mesh) => mesh.userData.spatialPointIndex);
      model.selectIndices(indices, { append: start.ctrl });
      updateSelectionOnly();
      return;
    }
    const rect = view.canvas.getBoundingClientRect();
    const pointer = new THREE.Vector2(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1
    );
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(pointer, view.camera);
    const hit = raycaster.intersectObjects(pointMeshes, false)[0];
    if (hit) {
      model.select(hit.object.userData.spatialPointIndex, { toggle: start.ctrl, range: start.shift });
    } else if (!start.ctrl && !start.shift) {
      model.clearSelection();
    }
    updateSelectionOnly();
  }

  function onKeyDown(event) {
    if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return;
    const command = event.ctrlKey || event.metaKey;
    if (command && event.key.toLowerCase() === 'z') {
      event.preventDefault();
      commitSimple(() => event.shiftKey ? model.redo() : model.undo(), event.shiftKey ? '已反撤销' : '已撤销');
      return;
    }
    if (command && event.key.toLowerCase() === 'y') {
      event.preventDefault();
      commitSimple(() => model.redo(), '已反撤销');
      return;
    }
    if (command && event.key.toLowerCase() === 'a') {
      event.preventDefault();
      model.selectAll();
      updateSelectionOnly();
      return;
    }
    if (event.key === 'Escape') {
      model.clearSelection();
      updateSelectionOnly();
    } else if (event.key === 'Delete' || event.key === 'Backspace') {
      event.preventDefault();
      commitSimple(() => model.deleteSelection(), '已删除选中点');
    } else if (event.key.toLowerCase() === 'w') setTransformMode('translate');
    else if (event.key.toLowerCase() === 'e') setTransformMode('rotate');
    else if (event.key.toLowerCase() === 'r') setTransformMode('scale');
    else if (event.key.toLowerCase() === 'f') focusSelection();
    else if (event.key === 'Home') resetEditorView();
  }

  transformControls.addEventListener('mouseDown', () => {
    transformBefore = model.snapshot();
    transformWorldPoints = getSpatialConveyorWorldPoints(model.packageData, displayTuning);
    transformPivot.copy(pivot.position);
    transformPivotQuaternion.copy(pivot.quaternion);
  });
  transformControls.addEventListener('objectChange', () => {
    if (!transformBefore) return;
    const mode = transformControls.getMode();
    for (const index of selectedIndices()) {
      const initial = transformWorldPoints[index];
      let nextWorld;
      if (mode === 'translate') {
        nextWorld = initial.clone().add(pivot.position.clone().sub(transformPivot));
      } else if (mode === 'rotate') {
        const deltaRotation = pivot.quaternion.clone()
          .multiply(transformPivotQuaternion.clone().invert());
        nextWorld = initial.clone().sub(transformPivot).applyQuaternion(deltaRotation).add(transformPivot);
      } else {
        const offset = initial.clone().sub(transformPivot);
        if (transformControls.space === 'local') {
          offset.applyQuaternion(transformPivotQuaternion.clone().invert())
            .multiply(pivot.scale)
            .applyQuaternion(transformPivotQuaternion);
        } else {
          offset.multiply(pivot.scale);
        }
        nextWorld = offset.add(transformPivot);
      }
      setPointPosition(
        model.points[index],
        mapSpatialWorldPointToPackage(model.packageData, nextWorld, displayTuning)
      );
    }
    schedulePreview();
  });
  transformControls.addEventListener('mouseUp', () => {
    if (!transformBefore) return;
    model.commit(transformBefore);
    transformBefore = null;
    schedulePreview();
  });
  transformControls.addEventListener('dragging-changed', (event) => {
    orbitControls.enabled = !event.value;
  });
  orbitControls.addEventListener('start', () => {
    pointerStart = null;
    boxSelecting = false;
    selectionBox.hidden = true;
  });

  for (const axis of ['x', 'y', 'z']) {
    positionInputs[axis].addEventListener('change', () => {
      const active = model.points[model.activeIndex];
      const next = Number(positionInputs[axis].value);
      if (!active || !Number.isFinite(next)) return;
      const delta = next - (Number(active.position?.[axis]) || 0);
      model.transact(() => {
        for (const index of selectedIndices()) {
          const point = model.points[index];
          setPointPosition(point, {
            ...point.position,
            [axis]: (Number(point.position?.[axis]) || 0) + delta
          });
        }
      });
      schedulePreview();
    });
    rotationInputs[axis].addEventListener('change', () => {
      const next = Number(rotationInputs[axis].value);
      if (!Number.isFinite(next)) return;
      model.transact(() => {
        for (const index of selectedIndices()) {
          const point = model.points[index];
          point.editorRotationDegrees = { x: 0, y: 0, z: 0, ...(point.editorRotationDegrees ?? {}), [axis]: next };
        }
      });
      schedulePreview();
    });
  }
  sizeInput.addEventListener('change', () => {
    const next = Number(sizeInput.value);
    if (!Number.isFinite(next) || next <= 0) return;
    model.transact(() => {
      for (const index of selectedIndices()) model.points[index].size = next;
    });
    schedulePreview();
  });
  function applyEntrancePercent(value) {
    const next = Number(value);
    if (!Number.isFinite(next)) return;
    commitSimple(() => model.setEntrancePercent(next), '已调整乘客进入轨道点');
  }
  entranceInput.addEventListener('change', () => applyEntrancePercent(entranceInput.value));
  entranceInput.addEventListener('blur', () => applyEntrancePercent(entranceInput.value));
  entranceInput.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    applyEntrancePercent(entranceInput.value);
    entranceInput.select();
  });
  entranceRange.addEventListener('change', () => applyEntrancePercent(entranceRange.value));
  entranceRange.addEventListener('input', () => {
    entranceInput.value = round(entranceRange.value);
  });
  entranceFromActiveButton.addEventListener('click', () => {
    commitSimple(() => model.setEntranceFromPoint(model.activeIndex), '已将乘客进入轨道点设为活动点');
  });
  function applyBoardingPercent(value) {
    const next = Number(value);
    if (!Number.isFinite(next)) return;
    commitSimple(() => model.setBoardingPercent(next), '已调整同色车辆上车检测点');
  }
  boardingInput.addEventListener('change', () => applyBoardingPercent(boardingInput.value));
  boardingInput.addEventListener('blur', () => applyBoardingPercent(boardingInput.value));
  boardingInput.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    applyBoardingPercent(boardingInput.value);
    boardingInput.select();
  });
  boardingRange.addEventListener('change', () => applyBoardingPercent(boardingRange.value));
  boardingRange.addEventListener('input', () => {
    boardingInput.value = round(boardingRange.value);
  });
  boardingWidthInput.addEventListener('change', () => {
    const next = Number(boardingWidthInput.value);
    if (!Number.isFinite(next)) return;
    commitSimple(() => model.setBoardingRangeWidth(next), '已调整同色车辆上车检测范围');
  });
  boardingFromActiveButton.addEventListener('click', () => {
    commitSimple(() => model.setBoardingFromPoint(model.activeIndex), '已将上车检测点设为活动点');
  });

  undoButton.addEventListener('click', () => commitSimple(() => model.undo(), '已撤销'));
  redoButton.addEventListener('click', () => commitSimple(() => model.redo(), '已反撤销'));
  moveButton.addEventListener('click', () => setTransformMode('translate'));
  rotateButton.addEventListener('click', () => setTransformMode('rotate'));
  scaleButton.addEventListener('click', () => setTransformMode('scale'));
  spaceButton.addEventListener('click', () => {
    const next = transformControls.space === 'world' ? 'local' : 'world';
    transformControls.setSpace(next);
    spaceButton.textContent = next === 'world' ? '世界轴' : '局部轴';
    updateSelectionOnly();
  });
  pivotButton.addEventListener('click', () => {
    pivotMode = pivotMode === 'center' ? 'active' : 'center';
    pivotButton.textContent = pivotMode === 'center' ? '选区中心' : '活动点轴心';
    updateSelectionOnly();
  });
  focusButton.addEventListener('click', focusSelection);
  resetViewButton.addEventListener('click', resetEditorView);
  prependButton.addEventListener('click', () => commitSimple(() => model.append('start'), '已在首部增加点'));
  insertButton.addEventListener('click', () => commitSimple(() => model.insertAfter(model.activeIndex), '已在点间插入'));
  appendButton.addEventListener('click', () => commitSimple(() => model.append('end'), '已在尾部增加点'));
  deleteButton.addEventListener('click', () => commitSimple(() => model.deleteSelection(), '已删除选中点'));
  saveButton.addEventListener('click', async () => {
    try { await save(); } catch (error) { status.textContent = `保存失败：${error.message}`; }
  });
  saveAsButton.addEventListener('click', async () => {
    const targetId = window.prompt('输入新轨道名称（不含后缀）', `${model.packageData.id}_copy`)?.trim();
    if (!targetId) return;
    if (/[<>:"/\\|?*\x00-\x1f]/.test(targetId)) {
      status.textContent = '名称包含不允许的字符';
      return;
    }
    try { await save(targetId); } catch (error) { status.textContent = `另存失败：${error.message}`; }
  });
  overlay.querySelector('.spatial-point-close').addEventListener('click', close);
  closeButton.addEventListener('click', close);

  view.setInputEnabled(false);
  view.canvas.addEventListener('pointerdown', onPointerDown, true);
  view.canvas.addEventListener('contextmenu', onContextMenu);
  toolbarHandle.addEventListener('pointerdown', onToolbarPointerDown);
  toolbarHandle.addEventListener('pointermove', onToolbarPointerMove);
  toolbarHandle.addEventListener('pointerup', onToolbarPointerUp);
  toolbarHandle.addEventListener('pointercancel', onToolbarPointerUp);
  window.addEventListener('pointermove', onPointerMove, true);
  window.addEventListener('pointerup', onPointerUp, true);
  window.addEventListener('keydown', onKeyDown, true);
  window.addEventListener('resize', clampToolbarPosition);
  window.addEventListener('beforeunload', onBeforeUnload);
  model.select(0);
  setTransformMode('translate');
  updatePointMeshes();
  syncPanel();
  focusWorldPoints(getSpatialConveyorWorldPoints(model.packageData, displayTuning), { remember: true });
  status.textContent = '右键旋转，中键平移，滚轮缩放；只有点击保存才会写入文件';

  return { close, dispose, model };
}
