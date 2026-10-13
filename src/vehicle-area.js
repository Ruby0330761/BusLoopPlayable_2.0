import { LEVEL_1 } from './level-data.js';
import { SCENE_TUNING } from './scene-tuning.js';

// Map one authored vehicle coordinate into runtime world space, before the
// formation rotation is applied. Shared by the pivot and the scene view so the
// rotation center and the rotated points use exactly the same mapping.
export function mapVehicleAreaBasePoint(vehicle, area) {
  const unitScale = area.positionUnitScale ?? LEVEL_1.mapScale;
  const scaledX = (vehicle.x - area.positionPivotX) * unitScale + area.positionPivotX;
  const scaledZ = (vehicle.z - area.positionPivotZ) * unitScale + area.positionPivotZ;
  return {
    x: (area.sourceRootX + scaledX) * area.unityToWorldScale + area.offsetX,
    z: (area.sourceRootZ + scaledZ) * area.unityToWorldScale * (area.mirrorZ ? -1 : 1) + area.offsetZ
  };
}

// The formation rotates around its own center. The authored source cube only
// describes the Unity vehicle region and sits off the actual vehicle cluster,
// so rotating around it slides the whole layout sideways.
function getVehicleClusterCenter(area) {
  const vehicles = LEVEL_1.vehicles ?? [];
  if (!vehicles.length) return null;
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const vehicle of vehicles) {
    const point = mapVehicleAreaBasePoint(vehicle, area);
    if (point.x < minX) minX = point.x;
    if (point.x > maxX) maxX = point.x;
    if (point.z < minZ) minZ = point.z;
    if (point.z > maxZ) maxZ = point.z;
  }
  if (![minX, maxX, minZ, maxZ].every(Number.isFinite)) return null;
  return { x: (minX + maxX) / 2, z: (minZ + maxZ) / 2 };
}

// Resolve the center of the authored vehicle area in runtime world space.
// Rotation must follow the vehicle field when its translation or map scale changes.
// Callers pass the area explicitly; the parameter stays optional only so a missing
// value resolves through the tuning module without a load-time import cycle.
export function getVehicleAreaPivot(area) {
  if (!area) {
    area = SCENE_TUNING.vehicleArea;
  }
  const clusterCenter = getVehicleClusterCenter(area);
  if (clusterCenter) return clusterCenter;
  const fallbackX = Number(area?.pivotX);
  const fallbackZ = Number(area?.pivotZ);
  const sourceCube = area?.sourceCube;
  const centerX = Number(sourceCube?.centerX);
  const centerZ = Number(sourceCube?.centerZ);
  if (![centerX, centerZ].every(Number.isFinite)) {
    return {
      x: Number.isFinite(fallbackX) ? fallbackX : 0,
      z: Number.isFinite(fallbackZ) ? fallbackZ : 0
    };
  }
  const unitScale = Number.isFinite(Number(area?.positionUnitScale))
    ? Number(area.positionUnitScale)
    : 1;
  const positionPivotX = Number(area?.positionPivotX) || 0;
  const positionPivotZ = Number(area?.positionPivotZ) || 0;
  const scaledCenterX = (centerX - positionPivotX) * unitScale + positionPivotX;
  const scaledCenterZ = (centerZ - positionPivotZ) * unitScale + positionPivotZ;
  const unityToWorldScale = Number(area?.unityToWorldScale) || 1;
  const mirror = area?.mirrorZ ? -1 : 1;
  return {
    x: (Number(area?.sourceRootX) || 0) * unityToWorldScale
      + scaledCenterX * unityToWorldScale
      + (Number(area?.offsetX) || 0),
    z: ((Number(area?.sourceRootZ) || 0) + scaledCenterZ)
      * unityToWorldScale * mirror
      + (Number(area?.offsetZ) || 0)
  };
}
