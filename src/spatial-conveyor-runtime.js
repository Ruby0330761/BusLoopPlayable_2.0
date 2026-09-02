import * as THREE from 'three';

export const SPATIAL_CONVEYOR_PREFIX = 'spatial:';

export const SPATIAL_CONVEYOR_DISPLAY = Object.freeze({
  version: 6,
  pointScale: 1.45,
  rotationYDegrees: 180,
  modelRotationXDegrees: 0,
  modelRotationYDegrees: 180,
  modelRotationZDegrees: 0,
  mirrorZ: 1,
  center: Object.freeze({ x: 0, y: 0.42, z: -2.15 }),
  trackWidthScale: 0.67
});

const packageRegistry = new Map();

export function isSpatialConveyorSelection(value) {
  return typeof value === 'string' && value.startsWith(SPATIAL_CONVEYOR_PREFIX);
}

export function getSpatialConveyorId(value) {
  return isSpatialConveyorSelection(value)
    ? value.slice(SPATIAL_CONVEYOR_PREFIX.length)
    : String(value ?? '');
}

export function getSpatialConveyorPackage(value) {
  return packageRegistry.get(getSpatialConveyorId(value)) ?? null;
}

export function registerSpatialConveyorPackage(packageData) {
  if (packageData?.kind !== 'spatial' || typeof packageData.id !== 'string') {
    throw new Error('Spatial conveyor package data is invalid.');
  }
  packageRegistry.set(packageData.id, packageData);
  return packageData;
}

export async function loadSpatialConveyorPackage(id, { force = false } = {}) {
  const packageId = getSpatialConveyorId(id);
  const cached = packageRegistry.get(packageId);
  if (cached && !force) return cached;
  const response = await fetch(`/__spatial-conveyors/package/${encodeURIComponent(packageId)}`, {
    cache: 'no-store'
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || `HTTP ${response.status}`);
  return registerSpatialConveyorPackage(payload.packageData);
}

export async function refreshSpatialConveyorPackages() {
  const response = await fetch('/__spatial-conveyors', { cache: 'no-store' });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || `HTTP ${response.status}`);
  const items = Array.isArray(payload.items) ? payload.items : [];
  await Promise.all(items.map((item) => loadSpatialConveyorPackage(item.id, { force: true })));
  const activeIds = new Set(items.map((item) => item.id));
  for (const id of packageRegistry.keys()) {
    if (!activeIds.has(id)) packageRegistry.delete(id);
  }
  return items;
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

function getSpatialSourceMatrix(packageData) {
  const transforms = packageData?.transforms ?? {};
  return new THREE.Matrix4()
    .multiply(makeTransformMatrix(transforms.prefabRoot))
    .multiply(makeTransformMatrix(transforms.pathsRoot))
    .multiply(makeTransformMatrix(transforms.path));
}

function getSpatialRawPivot(packageData) {
  const configured = packageData?.path?.editorPivot;
  if (configured) {
    return new THREE.Vector3(
      Number(configured.x) || 0,
      Number(configured.y) || 0,
      Number(configured.z) || 0
    );
  }
  const rawPoints = (packageData?.path?.points ?? []).map((point) => new THREE.Vector3(
    Number(point.position?.x) || 0,
    Number(point.position?.y) || 0,
    Number(point.position?.z) || 0
  ));
  return rawPoints.length
    ? new THREE.Box3().setFromPoints(rawPoints).getCenter(new THREE.Vector3())
    : new THREE.Vector3();
}

function getSpatialDisplayMatrix(packageData, displayTuning = {}) {
  const sourceMatrix = getSpatialSourceMatrix(packageData);
  const sourceCenter = getSpatialRawPivot(packageData).applyMatrix4(sourceMatrix);
  const displayScale = Number.isFinite(Number(displayTuning.scale))
    ? Number(displayTuning.scale)
    : SPATIAL_CONVEYOR_DISPLAY.pointScale;
  const scale = new THREE.Vector3(
    displayScale * (Number.isFinite(Number(displayTuning.scaleX)) ? Number(displayTuning.scaleX) : 1),
    displayScale * (Number.isFinite(Number(displayTuning.scaleY)) ? Number(displayTuning.scaleY) : 1),
    displayScale * (Number.isFinite(Number(displayTuning.scaleZ)) ? Number(displayTuning.scaleZ) : 1)
      * (Number(displayTuning.mirrorZ ?? SPATIAL_CONVEYOR_DISPLAY.mirrorZ) !== 0 ? -1 : 1)
  );
  const coordinateRotationY = THREE.MathUtils.degToRad(SPATIAL_CONVEYOR_DISPLAY.rotationYDegrees);
  const rotationX = THREE.MathUtils.degToRad(
    Number(displayTuning.rotationXDegrees ?? SPATIAL_CONVEYOR_DISPLAY.modelRotationXDegrees)
  );
  const rotationY = THREE.MathUtils.degToRad(
    Number(displayTuning.rotationYDegrees ?? SPATIAL_CONVEYOR_DISPLAY.modelRotationYDegrees)
  );
  const rotationZ = THREE.MathUtils.degToRad(
    Number(displayTuning.rotationZDegrees ?? SPATIAL_CONVEYOR_DISPLAY.modelRotationZDegrees)
  );
  const center = new THREE.Vector3(
    Number(displayTuning.positionX ?? SPATIAL_CONVEYOR_DISPLAY.center.x),
    Number(displayTuning.positionY ?? SPATIAL_CONVEYOR_DISPLAY.center.y),
    Number(displayTuning.positionZ ?? SPATIAL_CONVEYOR_DISPLAY.center.z)
  );
  return new THREE.Matrix4()
    .makeTranslation(center.x, center.y, center.z)
    .multiply(new THREE.Matrix4().makeRotationZ(rotationZ))
    .multiply(new THREE.Matrix4().makeRotationY(rotationY))
    .multiply(new THREE.Matrix4().makeRotationX(rotationX))
    .multiply(new THREE.Matrix4().makeRotationY(coordinateRotationY))
    .multiply(new THREE.Matrix4().makeScale(scale.x, scale.y, scale.z))
    .multiply(new THREE.Matrix4().makeTranslation(-sourceCenter.x, -sourceCenter.y, -sourceCenter.z))
    .multiply(sourceMatrix);
}

export function mapSpatialPackagePointToWorld(packageData, point, displayTuning = {}) {
  return new THREE.Vector3(
    Number(point?.x) || 0,
    Number(point?.y) || 0,
    Number(point?.z) || 0
  ).applyMatrix4(getSpatialDisplayMatrix(packageData, displayTuning));
}

export function mapSpatialWorldPointToPackage(packageData, point, displayTuning = {}) {
  return new THREE.Vector3(
    Number(point?.x) || 0,
    Number(point?.y) || 0,
    Number(point?.z) || 0
  ).applyMatrix4(getSpatialDisplayMatrix(packageData, displayTuning).invert());
}

export function getSpatialConveyorWorldPoints(packageData, displayTuning = {}) {
  return (packageData?.path?.points ?? []).map((point) => (
    mapSpatialPackagePointToWorld(packageData, point.position, displayTuning)
  ));
}

export function getSpatialConveyorWorldNormals(packageData, displayTuning = {}) {
  const normalMatrix = new THREE.Matrix3().getNormalMatrix(
    getSpatialDisplayMatrix(packageData, displayTuning)
  );
  return (packageData?.path?.points ?? []).map((point) => {
    const normal = new THREE.Vector3(
      Number(point.normal?.x) || 0,
      Number(point.normal?.y) || 1,
      Number(point.normal?.z) || 0
    );
    const rotation = point.editorRotationDegrees;
    if (rotation) {
      normal.applyEuler(new THREE.Euler(
        THREE.MathUtils.degToRad(Number(rotation.x) || 0),
        THREE.MathUtils.degToRad(Number(rotation.y) || 0),
        THREE.MathUtils.degToRad(Number(rotation.z) || 0),
        'XYZ'
      ));
    }
    return normal.applyMatrix3(normalMatrix).normalize();
  });
}

function makeSpatialFrameSampler(packageData, curve, displayTuning = {}) {
  const normals = getSpatialConveyorWorldNormals(packageData, displayTuning);
  const points = packageData?.path?.points ?? [];
  return (progress) => {
    const tangent = curve.getTangent(progress).normalize();
    const scaled = THREE.MathUtils.clamp(progress, 0, 1) * Math.max(0, normals.length - 1);
    const lower = Math.min(Math.max(0, normals.length - 1), Math.floor(scaled));
    const upper = Math.min(Math.max(0, normals.length - 1), lower + 1);
    const alpha = scaled - lower;
    const preferredUp = normals[lower]?.clone().lerp(normals[upper] ?? normals[lower], alpha).normalize()
      ?? new THREE.Vector3(0, 1, 0);
    preferredUp.addScaledVector(tangent, -preferredUp.dot(tangent));
    if (preferredUp.lengthSq() < 0.000001) {
      preferredUp.copy(Math.abs(tangent.y) > 0.98
        ? new THREE.Vector3(0, 0, 1)
        : new THREE.Vector3(0, 1, 0));
      preferredUp.addScaledVector(tangent, -preferredUp.dot(tangent));
    }
    const up = preferredUp.normalize();
    const lateral = up.clone().cross(tangent).normalize();
    const lowerSize = Number(points[lower]?.size) || 1;
    const upperSize = Number(points[upper]?.size) || lowerSize;
    return {
      tangent,
      lateral,
      up: tangent.clone().cross(lateral).normalize(),
      size: THREE.MathUtils.lerp(lowerSize, upperSize, alpha)
    };
  };
}

export function createSpatialCurveLookup(curve, sampleCount = 4096) {
  if (!curve) return null;
  const segments = Math.max(2, Math.floor(Number(sampleCount) || 4096));
  const positions = new Float32Array((segments + 1) * 3);
  const tangents = new Float32Array((segments + 1) * 3);
  const point = new THREE.Vector3();
  const tangent = new THREE.Vector3();
  for (let index = 0; index <= segments; index += 1) {
    const progress = index / segments;
    curve.getPointAt(progress, point);
    curve.getTangentAt(progress, tangent).normalize();
    const offset = index * 3;
    positions[offset] = point.x;
    positions[offset + 1] = point.y;
    positions[offset + 2] = point.z;
    tangents[offset] = tangent.x;
    tangents[offset + 1] = tangent.y;
    tangents[offset + 2] = tangent.z;
  }
  return { segments, positions, tangents };
}

export function sampleSpatialCurveLookup(
  lookup,
  progress,
  targetPoint = new THREE.Vector3(),
  targetTangent = new THREE.Vector3()
) {
  if (!lookup?.segments) return null;
  const scaled = THREE.MathUtils.clamp(Number(progress) || 0, 0, 1) * lookup.segments;
  const lower = Math.min(lookup.segments - 1, Math.floor(scaled));
  const upper = Math.min(lookup.segments, lower + 1);
  const alpha = scaled - lower;
  const lowerOffset = lower * 3;
  const upperOffset = upper * 3;
  targetPoint.set(
    THREE.MathUtils.lerp(lookup.positions[lowerOffset], lookup.positions[upperOffset], alpha),
    THREE.MathUtils.lerp(lookup.positions[lowerOffset + 1], lookup.positions[upperOffset + 1], alpha),
    THREE.MathUtils.lerp(lookup.positions[lowerOffset + 2], lookup.positions[upperOffset + 2], alpha)
  );
  targetTangent.set(
    THREE.MathUtils.lerp(lookup.tangents[lowerOffset], lookup.tangents[upperOffset], alpha),
    THREE.MathUtils.lerp(lookup.tangents[lowerOffset + 1], lookup.tangents[upperOffset + 1], alpha),
    THREE.MathUtils.lerp(lookup.tangents[lowerOffset + 2], lookup.tangents[upperOffset + 2], alpha)
  ).normalize();
  return { point: targetPoint, tangent: targetTangent };
}

export function buildSpatialConveyorExitGeometry(packageData, curve, displayTuning = {}) {
  const transforms = packageData?.transforms ?? {};
  const geometry = new THREE.BufferGeometry();
  if (!curve || !transforms.loopExit) return geometry;

  const size = packageData?.visual?.exitSprite?.size ?? { x: 2.14, y: 0.89 };
  const displayScale = Number.isFinite(Number(displayTuning.scale))
    ? Number(displayTuning.scale)
    : SPATIAL_CONVEYOR_DISPLAY.pointScale;
  const displayScaleY = Number.isFinite(Number(displayTuning.scaleY))
    ? Number(displayTuning.scaleY)
    : 1;
  const roadWidth = Number.isFinite(Number(displayTuning.roadWidth))
    ? Number(displayTuning.roadWidth)
    : 1;
  const halfWidth = (Number(size.x) || 2.14) * (transforms.loopExit.scale?.x ?? 1) * displayScale * 0.5;
  const halfLength = (Number(size.y) || 0.89) * (transforms.loopExit.scale?.y ?? 1) * displayScale * roadWidth * 0.5;
  const exitStart = packageData?.exit?.startPercent ?? 0.8;
  const exitEnd = packageData?.exit?.endPercent ?? 0.9;
  const exitProgress = THREE.MathUtils.clamp((exitStart + exitEnd) * 0.5, 0, 1);
  const visualAnchor = packageData?.exit?.visualAnchor;
  let frame;
  let anchorCenter;
  if (visualAnchor?.position && visualAnchor?.tangent && visualAnchor?.normal) {
    const displayMatrix = getSpatialDisplayMatrix(packageData, displayTuning);
    const tangent = new THREE.Vector3(
      Number(visualAnchor.tangent.x) || 0,
      Number(visualAnchor.tangent.y) || 0,
      Number(visualAnchor.tangent.z) || 1
    ).transformDirection(displayMatrix).normalize();
    const preferredUp = new THREE.Vector3(
      Number(visualAnchor.normal.x) || 0,
      Number(visualAnchor.normal.y) || 1,
      Number(visualAnchor.normal.z) || 0
    ).applyMatrix3(new THREE.Matrix3().getNormalMatrix(displayMatrix));
    preferredUp.addScaledVector(tangent, -preferredUp.dot(tangent));
    if (preferredUp.lengthSq() < 0.000001) {
      preferredUp.copy(Math.abs(tangent.y) > 0.98
        ? new THREE.Vector3(0, 0, 1)
        : new THREE.Vector3(0, 1, 0));
      preferredUp.addScaledVector(tangent, -preferredUp.dot(tangent));
    }
    preferredUp.normalize();
    const lateral = preferredUp.clone().cross(tangent).normalize();
    frame = {
      tangent,
      lateral,
      up: tangent.clone().cross(lateral).normalize(),
      size: Number(visualAnchor.size) || 1
    };
    anchorCenter = mapSpatialPackagePointToWorld(packageData, visualAnchor.position, displayTuning);
  } else {
    frame = makeSpatialFrameSampler(packageData, curve, displayTuning)(exitProgress);
    anchorCenter = curve.getPoint(exitProgress);
  }
  const exitPositionX = Number.isFinite(Number(displayTuning.exitPositionX))
    ? Number(displayTuning.exitPositionX)
    : 0;
  const exitPositionY = Number.isFinite(Number(displayTuning.exitPositionY))
    ? Number(displayTuning.exitPositionY)
    : 0;
  const exitPositionZ = Number.isFinite(Number(displayTuning.exitPositionZ))
    ? Number(displayTuning.exitPositionZ)
    : 0;
  const center = anchorCenter
    .addScaledVector(frame.lateral, (transforms.loopExit.position?.x ?? 0) * displayScale)
    .addScaledVector(frame.up, 0.018 * displayScaleY)
    .add(new THREE.Vector3(exitPositionX, exitPositionY, exitPositionZ));
  const corners = [
    center.clone().addScaledVector(frame.lateral, -halfWidth * frame.size).addScaledVector(frame.tangent, -halfLength * frame.size),
    center.clone().addScaledVector(frame.lateral, halfWidth * frame.size).addScaledVector(frame.tangent, -halfLength * frame.size),
    center.clone().addScaledVector(frame.lateral, halfWidth * frame.size).addScaledVector(frame.tangent, halfLength * frame.size),
    center.clone().addScaledVector(frame.lateral, -halfWidth * frame.size).addScaledVector(frame.tangent, halfLength * frame.size)
  ];
  for (const corner of corners) {
    corner.sub(center).applyAxisAngle(frame.up, Math.PI * 1.5).add(center);
  }

  geometry.setAttribute('position', new THREE.Float32BufferAttribute(
    corners.flatMap((point) => [point.x, point.y, point.z]),
    3
  ));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute([
    0, 0,
    1, 0,
    1, 1,
    0, 1
  ], 2));
  geometry.setIndex([0, 1, 2, 0, 2, 3]);
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}

function getCombinedScale(packageData) {
  const transforms = packageData?.transforms ?? {};
  const result = new THREE.Vector3(1, 1, 1);
  for (const transform of [transforms.path, transforms.pathsRoot, transforms.prefabRoot]) {
    const scale = transform?.scale ?? {};
    result.multiply(new THREE.Vector3(scale.x ?? 1, scale.y ?? 1, scale.z ?? 1));
  }
  return result;
}

export function buildSpatialConveyorGeometry(packageData, curve, displayTuning = {}) {
  const channel = packageData?.visual?.channel ?? {};
  const sourceVertices = channel.vertices ?? [];
  const sourceNormals = channel.normals ?? [];
  const sourceColors = channel.colors ?? [];
  const sourceUv = channel.uv ?? [];
  const sourceIndices = channel.indices ?? [];
  const segmentCount = Math.max(1, Math.floor(channel.count ?? 1));
  const zValues = sourceVertices.map((vertex) => Number(vertex.z) || 0);
  const minZ = Math.min(...zValues);
  const maxZ = Math.max(...zValues);
  const zRange = Math.max(0.000001, maxZ - minZ);
  const scale = getCombinedScale(packageData);
  const roadWidth = Number.isFinite(Number(displayTuning.roadWidth))
    ? Number(displayTuning.roadWidth)
    : 1;
  const positions = [];
  const normals = [];
  const colors = [];
  const uv = [];
  const indices = [];
  const groups = [];
  const sampleFrame = makeSpatialFrameSampler(packageData, curve, displayTuning);

  for (let segment = 0; segment < segmentCount; segment += 1) {
    const vertexOffset = segment * sourceVertices.length;
    for (let index = 0; index < sourceVertices.length; index += 1) {
      const vertex = sourceVertices[index];
      const longitudinal = ((Number(vertex.z) || 0) - minZ) / zRange;
      const progress = THREE.MathUtils.clamp((segment + longitudinal) / segmentCount, 0, 1);
      const center = curve.getPoint(progress);
      const frame = sampleFrame(progress);
      const position = center.clone()
        .addScaledVector(
          frame.lateral,
          (Number(vertex.x) || 0) * scale.x * SPATIAL_CONVEYOR_DISPLAY.trackWidthScale * roadWidth * frame.size
        )
        .addScaledVector(frame.up, (Number(vertex.y) || 0) * scale.y * frame.size);
      positions.push(position.x, position.y, position.z);

      const normal = sourceNormals[index] ?? { x: 0, y: 1, z: 0 };
      const worldNormal = frame.lateral.clone().multiplyScalar(Number(normal.x) || 0)
        .addScaledVector(frame.up, Number(normal.y) || 0)
        .addScaledVector(frame.tangent, Number(normal.z) || 0)
        .normalize();
      normals.push(worldNormal.x, worldNormal.y, worldNormal.z);

      const color = sourceColors[index] ?? { r: 1, g: 1, b: 1, a: 1 };
      colors.push(color.r ?? 1, color.g ?? 1, color.b ?? 1, color.a ?? 1);
      const texcoord = sourceUv[index] ?? { x: 0, y: 0 };
      uv.push(texcoord.x ?? 0, texcoord.y ?? 0);
    }
    for (const sourceIndex of sourceIndices) indices.push(vertexOffset + sourceIndex);
    groups.push({
      start: segment * sourceIndices.length,
      count: sourceIndices.length,
      materialIndex: 0
    });
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 4));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geometry.setIndex(indices);
  for (const group of groups) geometry.addGroup(group.start, group.count, group.materialIndex);
  geometry.computeBoundingSphere();
  return geometry;
}
