import * as THREE from 'three';

const HISTORY_LIMIT = 100;
const ANCHOR_SAMPLE_COUNT = 2048;

function clone(value) {
  return structuredClone(value);
}

function makeTransformMatrix(transform = {}) {
  const scale = transform.scale ?? { x: 1, y: 1, z: 1 };
  const rotation = transform.rotation ?? { x: 0, y: 0, z: 0, w: 1 };
  const position = transform.position ?? { x: 0, y: 0, z: 0 };
  return new THREE.Matrix4().compose(
    new THREE.Vector3(position.x ?? 0, position.y ?? 0, position.z ?? 0),
    new THREE.Quaternion(
      rotation.x ?? 0,
      rotation.y ?? 0,
      rotation.z ?? 0,
      rotation.w ?? 1
    ).normalize(),
    new THREE.Vector3(scale.x ?? 1, scale.y ?? 1, scale.z ?? 1)
  );
}

function nextPointId(points) {
  const used = new Set(points.map((point) => point.id));
  let index = points.length + 1;
  while (used.has(`point-${index}`)) index += 1;
  return `point-${index}`;
}

function midpointColor(left = {}, right = {}) {
  return {
    r: ((left.r ?? 1) + (right.r ?? 1)) * 0.5,
    g: ((left.g ?? 1) + (right.g ?? 1)) * 0.5,
    b: ((left.b ?? 1) + (right.b ?? 1)) * 0.5,
    a: ((left.a ?? 1) + (right.a ?? 1)) * 0.5
  };
}

function makeCurveFromPoints(points, pointMapper = null) {
  const curvePoints = pointMapper
    ? pointMapper(points)
    : points.map((point) => new THREE.Vector3(
      Number(point.position?.x) || 0,
      Number(point.position?.y) || 0,
      Number(point.position?.z) || 0
    ));
  return new THREE.CatmullRomCurve3(curvePoints, false, 'catmullrom', 0.35);
}

function findNearestCurveProgress(curve, target, sampleCount = ANCHOR_SAMPLE_COUNT) {
  let nearestProgress = 0;
  let nearestDistanceSquared = Infinity;
  for (let index = 0; index <= sampleCount; index += 1) {
    const progress = index / sampleCount;
    const distanceSquared = curve.getPointAt(progress).distanceToSquared(target);
    if (distanceSquared < nearestDistanceSquared) {
      nearestDistanceSquared = distanceSquared;
      nearestProgress = progress;
    }
  }
  let radius = 1 / sampleCount;
  for (let iteration = 0; iteration < 8; iteration += 1) {
    const left = THREE.MathUtils.clamp(nearestProgress - radius, 0, 1);
    const right = THREE.MathUtils.clamp(nearestProgress + radius, 0, 1);
    const leftDistance = curve.getPointAt(left).distanceToSquared(target);
    const rightDistance = curve.getPointAt(right).distanceToSquared(target);
    if (leftDistance < nearestDistanceSquared) {
      nearestProgress = left;
      nearestDistanceSquared = leftDistance;
    }
    if (rightDistance < nearestDistanceSquared) {
      nearestProgress = right;
      nearestDistanceSquared = rightDistance;
    }
    radius *= 0.5;
  }
  return nearestProgress;
}

function sampleSegmentMidpoint(points, segmentIndex) {
  const curve = makeCurveFromPoints(points);
  const start = segmentIndex / Math.max(1, points.length - 1);
  const end = (segmentIndex + 1) / Math.max(1, points.length - 1);
  const samples = 24;
  const sampled = [];
  let total = 0;
  let previous = curve.getPoint(start);
  sampled.push({ progress: start, distance: 0, point: previous });
  for (let index = 1; index <= samples; index += 1) {
    const progress = THREE.MathUtils.lerp(start, end, index / samples);
    const point = curve.getPoint(progress);
    total += point.distanceTo(previous);
    sampled.push({ progress, distance: total, point });
    previous = point;
  }
  const target = total * 0.5;
  const upperIndex = Math.max(1, sampled.findIndex((entry) => entry.distance >= target));
  const lower = sampled[upperIndex - 1];
  const upper = sampled[upperIndex];
  const alpha = upper.distance === lower.distance
    ? 0
    : (target - lower.distance) / (upper.distance - lower.distance);
  return curve.getPoint(THREE.MathUtils.lerp(lower.progress, upper.progress, alpha));
}

function makeInsertedPoint(points, segmentIndex) {
  const left = points[segmentIndex];
  const right = points[segmentIndex + 1];
  const position = sampleSegmentMidpoint(points, segmentIndex);
  const normal = new THREE.Vector3(
    (Number(left.normal?.x) || 0) + (Number(right.normal?.x) || 0),
    (Number(left.normal?.y) || 0) + (Number(right.normal?.y) || 0),
    (Number(left.normal?.z) || 0) + (Number(right.normal?.z) || 0)
  ).multiplyScalar(0.5);
  const result = clone(left);
  result.id = nextPointId(points);
  result.position = { x: position.x, y: position.y, z: position.z };
  result.tangent = clone(result.position);
  result.tangent2 = clone(result.position);
  result.normal = { x: normal.x, y: normal.y, z: normal.z };
  result.size = ((Number(left.size) || 1) + (Number(right.size) || 1)) * 0.5;
  result.color = midpointColor(left.color, right.color);
  return result;
}

function getRawPointNormal(point) {
  const normal = new THREE.Vector3(
    Number(point?.normal?.x) || 0,
    Number(point?.normal?.y) || 1,
    Number(point?.normal?.z) || 0
  );
  const rotation = point?.editorRotationDegrees;
  if (rotation) {
    normal.applyEuler(new THREE.Euler(
      THREE.MathUtils.degToRad(Number(rotation.x) || 0),
      THREE.MathUtils.degToRad(Number(rotation.y) || 0),
      THREE.MathUtils.degToRad(Number(rotation.z) || 0),
      'XYZ'
    ));
  }
  return normal.normalize();
}

function makeExitVisualAnchor(packageData) {
  const points = packageData.path?.points ?? [];
  if (points.length < 2 || !packageData.exit) return null;
  const progress = THREE.MathUtils.clamp(
    ((Number(packageData.exit.startPercent) || 0) + (Number(packageData.exit.endPercent) || 0)) * 0.5,
    0,
    1
  );
  const curve = makeCurveFromPoints(points);
  const scaled = progress * Math.max(0, points.length - 1);
  const lower = Math.min(points.length - 1, Math.floor(scaled));
  const upper = Math.min(points.length - 1, lower + 1);
  const alpha = scaled - lower;
  const normal = getRawPointNormal(points[lower])
    .lerp(getRawPointNormal(points[upper]), alpha)
    .normalize();
  const size = THREE.MathUtils.lerp(
    Number(points[lower]?.size) || 1,
    Number(points[upper]?.size) || 1,
    alpha
  );
  const position = curve.getPoint(progress);
  const tangent = curve.getTangent(progress).normalize();
  return {
    version: 1,
    position: { x: position.x, y: position.y, z: position.z },
    tangent: { x: tangent.x, y: tangent.y, z: tangent.z },
    normal: { x: normal.x, y: normal.y, z: normal.z },
    size
  };
}

export function ensureSpatialEditorMetadata(packageData) {
  const result = clone(packageData);
  const points = result.path?.points ?? [];
  if (!result.path) result.path = { points };
  const rawPoints = points.map((point) => new THREE.Vector3(
    Number(point.position?.x) || 0,
    Number(point.position?.y) || 0,
    Number(point.position?.z) || 0
  ));
  if (!result.path.editorPivot && points.length) {
    const transforms = result.transforms ?? {};
    const sourceMatrix = new THREE.Matrix4()
      .multiply(makeTransformMatrix(transforms.prefabRoot))
      .multiply(makeTransformMatrix(transforms.pathsRoot))
      .multiply(makeTransformMatrix(transforms.path));
    const sourceCenter = new THREE.Box3()
      .setFromPoints(rawPoints.map((point) => point.clone().applyMatrix4(sourceMatrix)))
      .getCenter(new THREE.Vector3());
    const pivot = sourceCenter.applyMatrix4(sourceMatrix.clone().invert());
    result.path.editorPivot = { x: pivot.x, y: pivot.y, z: pivot.z };
  }
  if (result.exit && !result.exit.visualAnchor) {
    result.exit.visualAnchor = makeExitVisualAnchor(result);
  }
  result.editor = {
    ...(result.editor ?? {}),
    schema: 'spatial-conveyor-editor-v1',
    revision: Number(result.editor?.revision) || 0
  };
  return result;
}

export class SpatialConveyorEditModel {
  constructor(packageData, { historyLimit = HISTORY_LIMIT, curvePointMapper = null } = {}) {
    this.packageData = ensureSpatialEditorMetadata(packageData);
    this.historyLimit = historyLimit;
    this.curvePointMapper = curvePointMapper;
    this.undoStack = [];
    this.redoStack = [];
    this.selection = new Set();
    this.activeIndex = null;
    this.savedSnapshot = JSON.stringify(this.packageData);
  }

  get points() {
    return this.packageData.path.points;
  }

  get dirty() {
    return JSON.stringify(this.packageData) !== this.savedSnapshot;
  }

  markSaved() {
    this.savedSnapshot = JSON.stringify(this.packageData);
  }

  snapshot() {
    return clone(this.packageData);
  }

  restore(snapshot) {
    this.packageData = clone(snapshot);
    const maxIndex = this.points.length - 1;
    this.selection = new Set([...this.selection].filter((index) => index <= maxIndex));
    if (this.activeIndex > maxIndex) this.activeIndex = this.selection.values().next().value ?? null;
  }

  commit(before) {
    const after = JSON.stringify(this.packageData);
    if (JSON.stringify(before) === after) return false;
    this.undoStack.push(clone(before));
    if (this.undoStack.length > this.historyLimit) this.undoStack.shift();
    this.redoStack.length = 0;
    this.packageData.editor.revision = (Number(this.packageData.editor.revision) || 0) + 1;
    return true;
  }

  transact(mutator) {
    const before = this.snapshot();
    mutator(this.packageData);
    return this.commit(before);
  }

  makeCurve() {
    const mapped = this.curvePointMapper?.(this.packageData);
    return makeCurveFromPoints(this.points, mapped ? () => mapped : null);
  }

  capturePathAnchors() {
    const curve = this.makeCurve();
    return {
      entrances: (this.packageData.entrances ?? []).map((entrance) => ({
        id: entrance.id,
        point: curve.getPointAt(THREE.MathUtils.clamp(Number(entrance.percent) || 0, 0, 1))
      })),
      exitStart: curve.getPointAt(THREE.MathUtils.clamp(Number(this.packageData.exit?.startPercent) || 0, 0, 1)),
      exitEnd: curve.getPointAt(THREE.MathUtils.clamp(Number(this.packageData.exit?.endPercent) || 0, 0, 1))
    };
  }

  restorePathAnchors(anchors) {
    const curve = this.makeCurve();
    for (const anchor of anchors.entrances) {
      const entrance = (this.packageData.entrances ?? []).find((item) => item.id === anchor.id);
      if (entrance) entrance.percent = findNearestCurveProgress(curve, anchor.point);
    }
    if (this.packageData.exit) {
      this.packageData.exit.startPercent = findNearestCurveProgress(curve, anchors.exitStart);
      this.packageData.exit.endPercent = findNearestCurveProgress(curve, anchors.exitEnd);
    }
  }

  setEntrancePercent(percent, entranceIndex = 0) {
    const next = THREE.MathUtils.clamp(Number(percent) || 0, 0, 1);
    return this.transact((packageData) => {
      if (!Array.isArray(packageData.entrances)) packageData.entrances = [];
      if (!packageData.entrances[entranceIndex]) {
        packageData.entrances[entranceIndex] = {
          id: `entrance-${entranceIndex + 1}`,
          mode: 'direct',
          percent: next
        };
      } else {
        packageData.entrances[entranceIndex].percent = next;
      }
    });
  }

  setEntranceFromPoint(index, entranceIndex = 0) {
    if (index < 0 || index >= this.points.length) return false;
    const curve = this.makeCurve();
    const mapped = this.curvePointMapper?.(this.packageData);
    const target = mapped?.[index] ?? new THREE.Vector3(
      Number(this.points[index].position?.x) || 0,
      Number(this.points[index].position?.y) || 0,
      Number(this.points[index].position?.z) || 0
    );
    return this.setEntrancePercent(findNearestCurveProgress(curve, target), entranceIndex);
  }

  getBoardingPercent() {
    const exit = this.packageData.exit ?? {};
    return THREE.MathUtils.clamp(
      ((Number(exit.startPercent) || 0) + (Number(exit.endPercent) || 0)) * 0.5,
      0,
      1
    );
  }

  getBoardingRangeWidth() {
    const exit = this.packageData.exit ?? {};
    return THREE.MathUtils.clamp(
      Math.abs((Number(exit.endPercent) || 0) - (Number(exit.startPercent) || 0)),
      0.001,
      1
    );
  }

  setBoardingPercent(percent) {
    const center = THREE.MathUtils.clamp(Number(percent) || 0, 0, 1);
    if (Math.abs(this.getBoardingPercent() - center) < 0.0000001) return false;
    const width = this.getBoardingRangeWidth();
    return this.transact((packageData) => {
      if (!packageData.exit) packageData.exit = {};
      const half = width * 0.5;
      const adjustedCenter = THREE.MathUtils.clamp(center, half, 1 - half);
      packageData.exit.startPercent = adjustedCenter - half;
      packageData.exit.endPercent = adjustedCenter + half;
      packageData.exit.allowWrappedEnd = false;
    });
  }

  setBoardingRangeWidth(width) {
    const nextWidth = THREE.MathUtils.clamp(Number(width) || 0.001, 0.001, 1);
    if (Math.abs(this.getBoardingRangeWidth() - nextWidth) < 0.0000001) return false;
    const center = this.getBoardingPercent();
    return this.transact((packageData) => {
      if (!packageData.exit) packageData.exit = {};
      const half = nextWidth * 0.5;
      const adjustedCenter = THREE.MathUtils.clamp(center, half, 1 - half);
      packageData.exit.startPercent = adjustedCenter - half;
      packageData.exit.endPercent = adjustedCenter + half;
      packageData.exit.allowWrappedEnd = false;
    });
  }

  setBoardingFromPoint(index) {
    if (index < 0 || index >= this.points.length) return false;
    const curve = this.makeCurve();
    const mapped = this.curvePointMapper?.(this.packageData);
    const target = mapped?.[index] ?? new THREE.Vector3(
      Number(this.points[index].position?.x) || 0,
      Number(this.points[index].position?.y) || 0,
      Number(this.points[index].position?.z) || 0
    );
    return this.setBoardingPercent(findNearestCurveProgress(curve, target));
  }

  undo() {
    const previous = this.undoStack.pop();
    if (!previous) return false;
    this.redoStack.push(this.snapshot());
    this.restore(previous);
    return true;
  }

  redo() {
    const next = this.redoStack.pop();
    if (!next) return false;
    this.undoStack.push(this.snapshot());
    this.restore(next);
    return true;
  }

  select(index, { toggle = false, range = false } = {}) {
    if (index < 0 || index >= this.points.length) return;
    if (range && this.activeIndex != null) {
      const start = Math.min(this.activeIndex, index);
      const end = Math.max(this.activeIndex, index);
      this.selection = new Set(Array.from({ length: end - start + 1 }, (_, offset) => start + offset));
    } else if (toggle) {
      if (this.selection.has(index)) this.selection.delete(index);
      else this.selection.add(index);
    } else {
      this.selection = new Set([index]);
    }
    this.activeIndex = this.selection.has(index)
      ? index
      : (this.selection.values().next().value ?? null);
  }

  selectIndices(indices, { append = false } = {}) {
    const next = append ? new Set(this.selection) : new Set();
    for (const index of indices) {
      if (index >= 0 && index < this.points.length) next.add(index);
    }
    this.selection = next;
    this.activeIndex = next.values().next().value ?? null;
  }

  clearSelection() {
    this.selection.clear();
    this.activeIndex = null;
  }

  selectAll() {
    this.selection = new Set(this.points.map((_point, index) => index));
    this.activeIndex = this.points.length ? 0 : null;
  }

  insertAfter(index) {
    if (this.points.length < 2) return false;
    const segmentIndex = Math.max(0, Math.min(this.points.length - 2, index));
    const before = this.snapshot();
    const anchors = this.capturePathAnchors();
    this.points.splice(segmentIndex + 1, 0, makeInsertedPoint(this.points, segmentIndex));
    this.restorePathAnchors(anchors);
    this.selection = new Set([segmentIndex + 1]);
    this.activeIndex = segmentIndex + 1;
    return this.commit(before);
  }

  append(side = 'end') {
    if (this.points.length < 2) return false;
    const before = this.snapshot();
    const anchors = this.capturePathAnchors();
    const atStart = side === 'start';
    const anchor = atStart ? this.points[0] : this.points.at(-1);
    const neighbour = atStart ? this.points[1] : this.points.at(-2);
    const result = clone(anchor);
    result.id = nextPointId(this.points);
    result.position = {
      x: (Number(anchor.position?.x) || 0) * 2 - (Number(neighbour.position?.x) || 0),
      y: (Number(anchor.position?.y) || 0) * 2 - (Number(neighbour.position?.y) || 0),
      z: (Number(anchor.position?.z) || 0) * 2 - (Number(neighbour.position?.z) || 0)
    };
    result.tangent = clone(result.position);
    result.tangent2 = clone(result.position);
    if (atStart) this.points.unshift(result);
    else this.points.push(result);
    this.restorePathAnchors(anchors);
    const index = atStart ? 0 : this.points.length - 1;
    this.selection = new Set([index]);
    this.activeIndex = index;
    return this.commit(before);
  }

  deleteSelection() {
    if (!this.selection.size || this.points.length - this.selection.size < 3) return false;
    const before = this.snapshot();
    const anchors = this.capturePathAnchors();
    this.packageData.path.points = this.points.filter((_point, index) => !this.selection.has(index));
    this.restorePathAnchors(anchors);
    this.clearSelection();
    return this.commit(before);
  }
}
