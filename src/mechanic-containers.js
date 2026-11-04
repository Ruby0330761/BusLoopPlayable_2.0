// Runtime support for the two container mechanisms that only the newer level
// pack uses: the gate queue (type 4) and the two-storey elevator (type 5).
//
// Both are authored as ordinary containers with their own child vehicles, so
// this module owns the pure geometry that turns those authored records into
// runtime placement. Keeping it separate from src/game-model.js means the
// spacing rules can be tested without constructing a game, and the editor's
// authoring model stays the single writer of the same numbers.

export const GATE_QUEUE_CONTAINER_TYPE = 4;
export const ELEVATOR_CONTAINER_TYPE = 5;

export const GATE_QUEUE_DEFAULT_GAP = 0.1;

// Unity's vehicle body lengths. The gate queue packs cars nose-to-tail using
// the real footprint, so a 10-seat bus takes more lane than a 4-seat car.
export const GATE_VEHICLE_LENGTH_BY_SEATS = Object.freeze({
  4: 0.47157902,
  6: 0.486,
  10: 0.6785897
});

export function gateVehicleLength(vehicle) {
  const direct = Number(vehicle?.collisionSize?.length ?? vehicle?.length);
  if (direct > 0) return direct;
  return GATE_VEHICLE_LENGTH_BY_SEATS[vehicle?.seats] ?? GATE_VEHICLE_LENGTH_BY_SEATS[10];
}

export function isGateQueueType(value) {
  const normalized = String(value ?? '').trim().toLowerCase();
  return value === GATE_QUEUE_CONTAINER_TYPE
    || normalized === 'gatequeue'
    || normalized === 'gate-queue';
}

export function isElevatorType(value) {
  const normalized = String(value ?? '').trim().toLowerCase();
  return value === ELEVATOR_CONTAINER_TYPE || normalized === 'elevator';
}

function point(value) {
  return { x: Number(value?.x) || 0, z: Number(value?.z) || 0 };
}

function distance(a, b) {
  return Math.hypot(b.x - a.x, b.z - a.z);
}

/**
 * The authored gate queue path, head first.
 *
 * Unity levels carry the smoothed path in `gateQueuePathPoints`, and it is the
 * only source that survives curve interpolation — sampling the vehicle centres
 * instead would straighten every curved gate. Levels without it fall back to
 * the container anchor plus the authored vehicle order, which is how the web
 * editor rebuilds a line queue.
 */
export function gateQueuePath(container, vehicles = []) {
  const authored = Array.isArray(container?.gateQueuePathPoints)
    ? container.gateQueuePathPoints.map(point).filter((entry) => Number.isFinite(entry.x) && Number.isFinite(entry.z))
    : [];
  if (authored.length >= 2) return authored;
  const anchor = point(container);
  const rest = vehicles.map(point).filter((entry) => distance(entry, anchor) > 0.0001);
  return rest.length ? [anchor, ...rest] : [anchor, { x: anchor.x, z: anchor.z - 1 }];
}

function projectOnSegment(entry, start, end) {
  const dx = end.x - start.x;
  const dz = end.z - start.z;
  const lengthSquared = dx * dx + dz * dz;
  if (lengthSquared <= 0.00000001) return 0;
  return Math.max(0, Math.min(1, ((entry.x - start.x) * dx + (entry.z - start.z) * dz) / lengthSquared));
}

/**
 * Distance from the path start to the closest point on the path.
 *
 * Gate queues are one-dimensional lanes, so an authored car only needs its
 * order along the lane; lateral offset is a level-authoring error that the
 * editor already reports.
 */
export function distanceAlongPath(path, entry) {
  const target = point(entry);
  let travelled = 0;
  let best = { distance: Number.POSITIVE_INFINITY, travelled: 0 };
  for (let index = 1; index < path.length; index += 1) {
    const start = path[index - 1];
    const end = path[index];
    const segmentLength = distance(start, end);
    if (segmentLength <= 0.00000001) continue;
    const t = projectOnSegment(target, start, end);
    const projected = {
      x: start.x + (end.x - start.x) * t,
      z: start.z + (end.z - start.z) * t
    };
    const offset = distance(target, projected);
    if (offset < best.distance) best = { distance: offset, travelled: travelled + segmentLength * t };
    travelled += segmentLength;
  }
  return best.travelled;
}

/** Sample a polyline by arc length, returning the point and its tangent. */
export function samplePath(path, targetDistance) {
  if (!Array.isArray(path) || path.length === 0) {
    return { point: { x: 0, z: 0 }, tangent: { x: 0, z: 1 } };
  }
  if (path.length === 1) return { point: { ...path[0] }, tangent: { x: 0, z: 1 } };
  let travelled = 0;
  for (let index = 1; index < path.length; index += 1) {
    const start = path[index - 1];
    const end = path[index];
    const segmentLength = distance(start, end);
    if (segmentLength <= 0.00000001) continue;
    if (travelled + segmentLength >= targetDistance) {
      const t = Math.max(0, Math.min(1, (targetDistance - travelled) / segmentLength));
      return {
        point: {
          x: start.x + (end.x - start.x) * t,
          z: start.z + (end.z - start.z) * t
        },
        tangent: { x: (end.x - start.x) / segmentLength, z: (end.z - start.z) / segmentLength }
      };
    }
    travelled += segmentLength;
  }
  const beforeLast = path[path.length - 2];
  const last = path[path.length - 1];
  const segmentLength = distance(beforeLast, last) || 1;
  return {
    point: { ...last },
    tangent: { x: (last.x - beforeLast.x) / segmentLength, z: (last.z - beforeLast.z) / segmentLength }
  };
}

/**
 * Heading for a car sitting on the lane.
 *
 * The authored cars face back down the lane toward the gate, so the yaw is the
 * reverse tangent. This matches the editor's gate-refresh convention exactly
 * (`atan2(-tangent.x, -tangent.z)`), which is what makes an imported queue and
 * a refreshed one land on the same numbers.
 */
export function gateQueueYaw(tangent) {
  return Math.atan2(-tangent.x, -tangent.z) * 180 / Math.PI;
}

/**
 * Lay the queue out nose-to-tail along the path.
 *
 * `orderedVehicles` must already be head first. Each entry is placed at the
 * cumulative half-lengths plus the authored gap, so replacing a 10-seat bus
 * with a 4-seat car tightens the queue the same way the editor does.
 */
export function layoutGateQueue(orderedVehicles, path, gap = GATE_QUEUE_DEFAULT_GAP, vehicleLength = null) {
  const spacingGap = Math.max(0, Number(gap) || 0);
  const lengthOf = typeof vehicleLength === 'function'
    ? vehicleLength
    : (vehicle) => Number(vehicle?.length) || 0;
  let travelled = 0;
  const placements = new Map();
  orderedVehicles.forEach((vehicle, index) => {
    if (index > 0) {
      travelled += (lengthOf(orderedVehicles[index - 1]) + lengthOf(vehicle)) * 0.5 + spacingGap;
    }
    const sample = samplePath(path, travelled);
    placements.set(vehicle.id, {
      x: sample.point.x,
      z: sample.point.z,
      yaw: gateQueueYaw(sample.tangent),
      distance: travelled
    });
  });
  return placements;
}

/** Order vehicles head first by their authored position along the lane. */
export function sortGateQueueVehicles(vehicles, path) {
  return vehicles
    .map((vehicle, index) => ({
      vehicle,
      index,
      distance: distanceAlongPath(path, vehicle)
    }))
    .sort((first, second) => first.distance - second.distance || first.index - second.index)
    .map((entry) => entry.vehicle);
}

/** Lowest floor that still holds a car, or `null` when the lift is empty. */
export function firstOccupiedLayer(vehicles) {
  let layer = null;
  for (const vehicle of vehicles) {
    const value = Number.isFinite(Number(vehicle?.elevatorLayer)) ? Number(vehicle.elevatorLayer) : 0;
    if (layer === null || value < layer) layer = value;
  }
  return layer;
}

/** Every floor number that appears in a container's vehicle list. */
export function elevatorLayers(vehicles) {
  return [...new Set(vehicles.map((vehicle) => (
    Number.isFinite(Number(vehicle?.elevatorLayer)) ? Number(vehicle.elevatorLayer) : 0
  )))].sort((first, second) => first - second);
}
