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

function applyTransform(vector, transform = {}) {
  const scale = transform.scale ?? { x: 1, y: 1, z: 1 };
  const rotation = transform.rotation ?? { x: 0, y: 0, z: 0, w: 1 };
  const position = transform.position ?? { x: 0, y: 0, z: 0 };
  vector.multiply(new THREE.Vector3(scale.x ?? 1, scale.y ?? 1, scale.z ?? 1));
  vector.applyQuaternion(new THREE.Quaternion(
    rotation.x ?? 0,
    rotation.y ?? 0,
    rotation.z ?? 0,
    rotation.w ?? 1
  ).normalize());
  vector.add(new THREE.Vector3(position.x ?? 0, position.y ?? 0, position.z ?? 0));
  return vector;
}

export function getSpatialConveyorWorldPoints(packageData, displayTuning = {}) {
  const transforms = packageData?.transforms ?? {};
  const sourcePoints = (packageData?.path?.points ?? []).map((point) => {
    const position = point.position ?? {};
    const vector = new THREE.Vector3(position.x ?? 0, position.y ?? 0, position.z ?? 0);
    applyTransform(vector, transforms.path);
    applyTransform(vector, transforms.pathsRoot);
    applyTransform(vector, transforms.prefabRoot);
    return vector;
  });
  if (!sourcePoints.length) return sourcePoints;

  const mapDisplayPoint = makeSpatialDisplayMapper(sourcePoints, displayTuning);
  return sourcePoints.map(mapDisplayPoint);
}

function makeSpatialDisplayMapper(sourcePoints, displayTuning = {}) {
  const bounds = new THREE.Box3().setFromPoints(sourcePoints);
  const sourceCenter = bounds.getCenter(new THREE.Vector3());
  const displayScale = Number.isFinite(Number(displayTuning.scale))
    ? Number(displayTuning.scale)
    : SPATIAL_CONVEYOR_DISPLAY.pointScale;
  const displayScaleX = Number.isFinite(Number(displayTuning.scaleX))
    ? Number(displayTuning.scaleX)
    : 1;
  const displayScaleY = Number.isFinite(Number(displayTuning.scaleY))
    ? Number(displayTuning.scaleY)
    : 1;
  const displayScaleZ = Number.isFinite(Number(displayTuning.scaleZ))
    ? Number(displayTuning.scaleZ)
    : 1;
  const displayCenter = new THREE.Vector3(
    Number.isFinite(Number(displayTuning.positionX))
      ? Number(displayTuning.positionX)
      : SPATIAL_CONVEYOR_DISPLAY.center.x,
    Number.isFinite(Number(displayTuning.positionY))
      ? Number(displayTuning.positionY)
      : SPATIAL_CONVEYOR_DISPLAY.center.y,
    Number.isFinite(Number(displayTuning.positionZ))
      ? Number(displayTuning.positionZ)
      : SPATIAL_CONVEYOR_DISPLAY.center.z
  );
  const mirrorZ = Number(displayTuning.mirrorZ ?? SPATIAL_CONVEYOR_DISPLAY.mirrorZ) !== 0;
  const rotationAxisX = new THREE.Vector3(1, 0, 0);
  const rotationAxisY = new THREE.Vector3(0, 1, 0);
  const rotationAxisZ = new THREE.Vector3(0, 0, 1);
  const modelRotationX = Number.isFinite(Number(displayTuning.rotationXDegrees))
    ? Number(displayTuning.rotationXDegrees)
    : SPATIAL_CONVEYOR_DISPLAY.modelRotationXDegrees;
  const modelRotationY = Number.isFinite(Number(displayTuning.rotationYDegrees))
    ? Number(displayTuning.rotationYDegrees)
    : SPATIAL_CONVEYOR_DISPLAY.modelRotationYDegrees;
  const modelRotationZ = Number.isFinite(Number(displayTuning.rotationZDegrees))
    ? Number(displayTuning.rotationZDegrees)
    : SPATIAL_CONVEYOR_DISPLAY.modelRotationZDegrees;
  const coordinateRotationY = THREE.MathUtils.degToRad(SPATIAL_CONVEYOR_DISPLAY.rotationYDegrees);
  const rotationX = THREE.MathUtils.degToRad(modelRotationX);
  const rotationY = THREE.MathUtils.degToRad(modelRotationY);
  const rotationZ = THREE.MathUtils.degToRad(modelRotationZ);
  return (point) => {
    const displayPoint = point.clone().sub(sourceCenter).multiplyScalar(displayScale);
    displayPoint.x *= displayScaleX;
    displayPoint.y *= displayScaleY;
    displayPoint.z *= displayScaleZ;
    if (mirrorZ) displayPoint.z *= -1;
    return displayPoint
      .applyAxisAngle(rotationAxisY, coordinateRotationY)
      .applyAxisAngle(rotationAxisX, rotationX)
      .applyAxisAngle(rotationAxisY, rotationY)
      .applyAxisAngle(rotationAxisZ, rotationZ)
      .add(displayCenter);
  };
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
  const frame = makeFrame(curve, exitProgress);
  const exitPositionX = Number.isFinite(Number(displayTuning.exitPositionX))
    ? Number(displayTuning.exitPositionX)
    : 0;
  const exitPositionZ = Number.isFinite(Number(displayTuning.exitPositionZ))
    ? Number(displayTuning.exitPositionZ)
    : 0;
  const center = curve.getPoint(exitProgress)
    .addScaledVector(frame.lateral, (transforms.loopExit.position?.x ?? 0) * displayScale)
    .addScaledVector(frame.up, 0.018 * displayScaleY)
    .add(new THREE.Vector3(exitPositionX, 0, exitPositionZ));
  const corners = [
    center.clone().addScaledVector(frame.lateral, -halfWidth).addScaledVector(frame.tangent, -halfLength),
    center.clone().addScaledVector(frame.lateral, halfWidth).addScaledVector(frame.tangent, -halfLength),
    center.clone().addScaledVector(frame.lateral, halfWidth).addScaledVector(frame.tangent, halfLength),
    center.clone().addScaledVector(frame.lateral, -halfWidth).addScaledVector(frame.tangent, halfLength)
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

function makeFrame(curve, progress) {
  const tangent = curve.getTangent(progress).normalize();
  const preferredUp = Math.abs(tangent.y) > 0.98
    ? new THREE.Vector3(0, 0, 1)
    : new THREE.Vector3(0, 1, 0);
  const lateral = preferredUp.clone().cross(tangent).normalize();
  const up = tangent.clone().cross(lateral).normalize();
  return { tangent, lateral, up };
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

  for (let segment = 0; segment < segmentCount; segment += 1) {
    const vertexOffset = segment * sourceVertices.length;
    for (let index = 0; index < sourceVertices.length; index += 1) {
      const vertex = sourceVertices[index];
      const longitudinal = ((Number(vertex.z) || 0) - minZ) / zRange;
      const progress = THREE.MathUtils.clamp((segment + longitudinal) / segmentCount, 0, 1);
      const center = curve.getPoint(progress);
      const frame = makeFrame(curve, progress);
      const position = center.clone()
        .addScaledVector(
          frame.lateral,
          (Number(vertex.x) || 0) * scale.x * SPATIAL_CONVEYOR_DISPLAY.trackWidthScale * roadWidth
        )
        .addScaledVector(frame.up, (Number(vertex.y) || 0) * scale.y);
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
