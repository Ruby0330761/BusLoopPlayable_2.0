import { createVehicleAreaTransform, displayVehicleSize } from './vehicle-area-transform.js';
import { UNITY_VEHICLE_MOTION, forwardFromYaw } from './vehicle-motion.js';

const VEHICLE_PATH_CONFIG_VERSION = 3;

// These are the old editor defaults, not a second set of automatic bounds.
// Old profiles with different bounds remain manual until the author opts in.
export const LEGACY_VEHICLE_PATH_BOUNDS = Object.freeze({ minX: -3, maxX: 2.95, minZ: -3.22, maxZ: 2.82 });

export function migrateVehiclePathTuning(tuning) {
  const path = tuning?.vehiclePath;
  if (!path || path.autoBounds !== undefined) return false;
  path.autoBounds = Object.entries(path.parkingBounds ?? {}).some(([key, value]) => (
    value !== LEGACY_VEHICLE_PATH_BOUNDS[key]
  )) ? 0 : 1;
  return true;
}

function freezeTree(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.values(value).forEach(freezeTree);
    Object.freeze(value);
  }
  return value;
}

// The canvas helper intentionally removes translation. Restore that translation
// and rotate around this level's cluster (never the mutable active-level singleton).
export function createVehicleRouteTransform(level, area, capturedOffset = null) {
  const transform = createVehicleAreaTransform(area);
  const base = createVehicleAreaTransform({ ...area, rotationDegrees: 0 });
  const vehicles = capturedOffset ? [] : level?.vehicles ?? [];
  const points = vehicles.map((v) => base.point(v.x, v.z));
  const center = points.length ? {
    x: (Math.min(...points.map((p) => p.x)) + Math.max(...points.map((p) => p.x))) / 2,
    z: (Math.min(...points.map((p) => p.z)) + Math.max(...points.map((p) => p.z))) / 2
  } : { x: 0, z: 0 };
  const angle = (area.rotationDegrees ?? 0) * Math.PI / 180;
  const c = Math.cos(angle), s = Math.sin(angle);
  const offset = capturedOffset ?? {
    x: base.origin.x + center.x - (center.x * c - center.z * s),
    z: base.origin.z + center.z - (center.x * s + center.z * c)
  };
  return {
    offset,
    point(x, z) {
      const p = transform.point(x, z);
      return { x: p.x + offset.x, z: p.z + offset.z };
    },
    unproject(x, z) { return transform.unproject(x - offset.x, z - offset.z); },
    yaw: (yaw) => transform.yaw(yaw),
    sourceYaw: (yaw) => area.mirrorZ
      ? 180 - yaw - (area.rotationDegrees ?? 0)
      : yaw + (area.rotationDegrees ?? 0)
  };
}

// Only route inputs enter this key: HUD edits must not invalidate geometry.
export function vehiclePathInputKey(level, tuning, parkingSpots = tuning.parkingSpots) {
  const source = JSON.stringify([
    VEHICLE_PATH_CONFIG_VERSION,
    level.key, level.mapScale, level.vehicleMotion, level.vehicleSize, level.vehicles, level.containers,
    tuning.vehicleArea, parkingSpots, tuning.facing?.parkingSpotYawDegrees,
    tuning.vehiclePath, tuning.vehicleDeparturePath
  ]);
  let a = 2166136261, b = 5381;
  for (let i = 0; i < source.length; i += 1) {
    a = Math.imul(a ^ source.charCodeAt(i), 16777619);
    b = Math.imul(b, 33) ^ source.charCodeAt(i);
  }
  return `${source.length}:${a >>> 0}:${b >>> 0}`;
}

export function resolveVehiclePathConfig(level, tuning, parkingSpots = tuning.parkingSpots) {
  const inputKey = vehiclePathInputKey(level, tuning, parkingSpots);
  if (level.vehiclePathSnapshot?.version === VEHICLE_PATH_CONFIG_VERSION
    && level.vehiclePathSnapshot.inputKey === inputKey) {
    return freezeTree(structuredClone(level.vehiclePathSnapshot));
  }
  const native = level.vehicleMotion ?? {};
  const area = structuredClone(tuning.vehicleArea ?? {});
  area.positionUnitScale ??= level.mapScale ?? 1;
  area.unityToWorldScale ??= 1;
  const scale = Math.abs(area.positionUnitScale * area.unityToWorldScale);
  if (!(scale > 0)) throw new TypeError('车辆路径的坐标缩放必须大于 0');
  const transform = createVehicleRouteTransform(level, area);
  const path = structuredClone(tuning.vehiclePath ?? {});
  migrateVehiclePathTuning({ vehiclePath: path });
  const departure = structuredClone(tuning.vehicleDeparturePath ?? {});
  const count = Math.max(1, Math.floor(parkingSpots?.count ?? level.spotCount ?? 4));
  const spacing = parkingSpots?.spacing ?? Math.abs(native.spotSpacing ?? 1) * scale;
  const startX = Number(parkingSpots?.autoCenter) ? -(count - 1) * spacing / 2
    : parkingSpots?.startX ?? transform.point(native.spotStartX ?? 0, native.spotZ ?? 0).x;
  const z = parkingSpots?.z ?? transform.point(native.spotStartX ?? 0, native.spotZ ?? 0).z;
  // Explicit per-level editor values win. Unity values are SOURCE coordinates
  // and headings, so convert them before using them as fallbacks.
  const visualYaw = tuning.facing?.parkingSpotYawDegrees ?? transform.yaw(native.spotYaw ?? 180);
  const sourceYaw = transform.sourceYaw(visualYaw);
  const backDistance = departure.backDistance ?? (native.spotApproachOffsetZ ?? 0.5) * scale;
  const forward = forwardFromYaw(visualYaw);
  const approachDirection = native.spotApproachDirection === 'screen-down'
    ? { x: 0, z: 1 } : { x: -forward.x, z: -forward.z };
  const spots = Array.from({ length: count }, (_, index) => {
    const visualX = startX + spacing * index;
    const visualZ = z;
    const visualApproachX = visualX + approachDirection.x * backDistance;
    const visualApproachZ = visualZ + approachDirection.z * backDistance;
    const center = transform.unproject(visualX, visualZ);
    const approach = transform.unproject(visualApproachX, visualApproachZ);
    return { ...center, yaw: sourceYaw, visualX, visualZ, visualYaw,
      approachX: approach.x, approachZ: approach.z, visualApproachX, visualApproachZ };
  });
  const station = { ...UNITY_VEHICLE_MOTION, ...path };
  const padding = Math.max(0, path.boundsPadding ?? 0.1);
  station.sideEntryTurnRadius = Math.min(station.turnRadius, padding);
  const vertices = [];
  let movingRadius = 0;
  let movingHalfWidth = 0;
  let occupiedSpotHalfZ = 0;
  const spotForward = forwardFromYaw(sourceYaw);
  for (const vehicle of level.vehicles ?? []) {
    const size = displayVehicleSize(vehicle, area);
    const width = Math.max(size.width / scale, vehicle.collisionSize?.width ?? level.vehicleSize?.width ?? 0.27);
    const depth = Math.max(size.length / scale, vehicle.collisionSize?.length ?? level.vehicleSize?.length ?? 0.68);
    movingRadius = Math.max(movingRadius, Math.hypot(width, depth) / 2);
    movingHalfWidth = Math.max(movingHalfWidth, width / 2);
    const stationScale = UNITY_VEHICLE_MOTION.stationScaleBySeats[vehicle.seats] ?? 1;
    occupiedSpotHalfZ = Math.max(occupiedSpotHalfZ,
      (Math.abs(spotForward.x) * width + Math.abs(spotForward.z) * depth) * stationScale / 2);
    const f = forwardFromYaw(vehicle.yaw ?? 0);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) vertices.push({
      x: vehicle.x + f.z * width / 2 * sx + f.x * depth / 2 * sz,
      z: vehicle.z - f.x * width / 2 * sx + f.z * depth / 2 * sz
    });
  }
  for (const container of level.containers ?? []) {
    if (Number(container.type) === 1) continue;
    const f = forwardFromYaw(container.yaw ?? 0);
    const width = container.width ?? container.garageSize?.x ?? 0;
    const depth = container.length ?? container.garageSize?.y ?? 0;
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) vertices.push({
      x: container.x + f.z * width / 2 * sx + f.x * depth / 2 * sz,
      z: container.z - f.x * width / 2 * sx + f.z * depth / 2 * sz
    });
  }
  if (Number(path.autoBounds ?? 1) && vertices.length) {
    const tightMargin = movingHalfWidth + padding;
    const topClearance = movingRadius + station.turnRadius + padding;
    const xs = vertices.map((p) => p.x), zs = vertices.map((p) => p.z);
    const fieldTop = Math.max(...zs);
    const bayWidth = (parkingSpots?.modelWidth ?? 0) * (parkingSpots?.scaleX ?? 1) / scale;
    const bayDepth = (parkingSpots?.modelDepth ?? 0) * (parkingSpots?.scaleZ ?? 1) / scale;
    const bayHalfZ = (Math.abs(spotForward.x) * bayWidth + Math.abs(spotForward.z) * bayDepth) / 2;
    const rowNearEdge = Math.min(...spots.map((spot) => spot.z)) - Math.max(occupiedSpotHalfZ, bayHalfZ);
    const freeGap = rowNearEdge - fieldTop;
    // Split a short joining gap between the cars and the occupied parking row.
    // With ample room, keep a full turning margin above the field instead of
    // pushing the joining lane all the way up to the parking approach points.
    const topMargin = freeGap > 0 ? Math.min(topClearance, freeGap / 2) : topClearance;
    const bounds = { minX: Math.min(...xs) - tightMargin, maxX: Math.max(...xs) + tightMargin,
      minZ: Math.min(...zs) - tightMargin, maxZ: fieldTop + topMargin };
    station.bottomTurnRadius = station.sideEntryTurnRadius;
    station.topTurnRadius = Math.min(station.turnRadius,
      Math.max(0, Math.min(topMargin, rowNearEdge - bounds.maxZ) - movingHalfWidth));
    station.parkingBounds = bounds;
  } else station.parkingBounds = path.parkingBounds ?? UNITY_VEHICLE_MOTION.parkingBounds;
  const b = station.parkingBounds;
  if (![b.minX, b.maxX, b.minZ, b.maxZ].every(Number.isFinite) || b.minX >= b.maxX || b.minZ >= b.maxZ) {
    throw new TypeError('车辆路径边界无效，请检查自动边界或手动边界');
  }
  return freezeTree({ version: VEHICLE_PATH_CONFIG_VERSION, inputKey, levelKey: level.key, vehicleArea: area, transformOffset: transform.offset,
    parkingSpots: { ...parkingSpots, count, spacing, startX, z }, visualYaw, spots,
    station, departure });
}
