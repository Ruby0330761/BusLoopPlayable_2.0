const VEHICLE_SIZES = Object.freeze({
  4: { width: 0.27, length: 0.47157902 },
  6: { width: 0.27, length: 0.486 },
  10: { width: 0.27, length: 0.6785897 }
});

export const GARAGE_SIZE = Object.freeze({ width: 0.50425464, length: 0.668775 });
export const GARAGE_PARK_POS = 0.7;
export const GARAGE_VEHICLE_SPACING = VEHICLE_SIZES[10].width * 2;
export const CONVEYOR_DEFAULT_WIDTH = 3.8;
export const CONVEYOR_EXTRA_SIZE = Object.freeze({ width: 2.23, length: 1.66 });
export const ELEVATOR_DEFAULT_SIZE = Object.freeze({ width: 1, length: 2 });
export const GATE_DEFAULT_GAP = 0.1;
export const GATE_HIT_WIDTH = VEHICLE_SIZES[4].width * 1.5;
export const GATE_VISUAL_WIDTH = GATE_HIT_WIDTH * 1.25;
export const GATE_TANGENT_HANDLE_RADIUS = 0.14;

export const CONTAINER_TYPES = Object.freeze({
  PARKING: 1,
  GARAGE: 2,
  CONVEYOR: 3,
  GATE_QUEUE: 4,
  ELEVATOR: 5
});

export const VEHICLE_COLOR_OPTIONS = Object.freeze([
  { id: 0, name: 'Blue', label: '蓝', css: '#0000FF' },
  { id: 1, name: 'Green', label: '绿', css: '#00FF00' },
  { id: 2, name: 'Pink', label: '粉', css: '#FF7DCF' },
  { id: 3, name: 'Purple', label: '紫', css: '#9400FF' },
  { id: 4, name: 'Red', label: '红', css: '#FF0000' },
  { id: 5, name: 'Yellow', label: '黄', css: '#FFEB04' },
  { id: 6, name: 'Orange', label: '橙', css: '#FF8C00' },
  { id: 7, name: 'LightBlue', label: '青', css: '#00FFFF' },
  { id: 8, name: 'Brown', label: '棕', css: '#8DAB8B' },
  { id: 9, name: 'DarkGreen', label: '碧', css: '#B9B9B9' },
  { id: 10, name: 'DarkBlue', label: '靛', css: '#555598' },
  { id: 11, name: 'PoliceCar', label: '警车', css: '#000000' },
  { id: 12, name: 'FireTruck', label: '消防车', css: '#196D87' },
  { id: 13, name: 'Ambulance', label: '救护车', css: '#9A0040' },
  { id: 14, name: 'Vip', label: 'VIP 车', css: '#FFDFCE' },
  { id: 15, name: 'Luxury', label: '豪华车', css: '#FFF7A5' }
].map(Object.freeze));

export const VEHICLE_COLORS = Object.freeze(VEHICLE_COLOR_OPTIONS.map((color) => color.css));

const clone = (value) => structuredClone(value);
const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const positiveInt = (value, fallback = 1) => Math.max(1, Math.round(finite(value, fallback)));
const normalizeAngle = (value) => ((finite(value) % 360) + 360) % 360;

function normalizeVehicle(vehicle, fallbackId) {
  return {
    id: positiveInt(vehicle?.id, fallbackId),
    seats: [4, 6, 10].includes(Number(vehicle?.seats)) ? Number(vehicle.seats) : 4,
    colorIndex: Math.max(0, Math.round(finite(vehicle?.colorIndex))),
    x: finite(vehicle?.x ?? vehicle?.position?.x),
    z: finite(vehicle?.z ?? vehicle?.position?.z),
    yaw: normalizeAngle(vehicle?.yaw ?? vehicle?.rotationY),
    isHidden: Boolean(vehicle?.isHidden),
    isTurnVehicle: Boolean(vehicle?.isTurnVehicle),
    containerType: positiveInt(vehicle?.containerType, CONTAINER_TYPES.PARKING),
    containerId: Math.max(0, Math.round(finite(vehicle?.containerId))),
    elevatorLayer: Math.max(0, Math.min(1, Math.round(finite(vehicle?.elevatorLayer)))),
    mechanism: {
      type: vehicle?.mechanism?.type ?? (Number.isInteger(vehicle?.ambulanceStepLimit) ? 'ambulance' : 'normal'),
      pairVehicleId: vehicle?.mechanism?.pairVehicleId == null ? null : positiveInt(vehicle.mechanism.pairVehicleId),
      distance: Math.max(0.15, finite(vehicle?.mechanism?.distance, 0.25)),
      wrenchColor: Math.max(0, Math.round(finite(vehicle?.mechanism?.wrenchColor))),
      secondColorIndex: Math.max(0, Math.round(finite(vehicle?.mechanism?.secondColorIndex))),
      stepLimit: positiveInt(vehicle?.mechanism?.stepLimit ?? vehicle?.ambulanceStepLimit, 35),
      timeLimit: positiveInt(vehicle?.mechanism?.timeLimit ?? vehicle?.firetruckTimeLimit, 30)
    }
  };
}

function normalizeContainer(container, fallbackId) {
  const pathShape = container?.gateQueuePathShape;
  const type = positiveInt(container?.type, CONTAINER_TYPES.PARKING);
  const gateQueueGap = finite(container?.gateQueueGap, GATE_DEFAULT_GAP);
  const conveyorWidth = Math.max(0.1, finite(
    container?.conveyorWidth ?? container?.exitWidth ?? (type === CONTAINER_TYPES.CONVEYOR ? container?.width : undefined),
    CONVEYOR_DEFAULT_WIDTH
  ));
  const width = type === CONTAINER_TYPES.GARAGE
    ? GARAGE_SIZE.width
    : type === CONTAINER_TYPES.CONVEYOR
      ? conveyorWidth + CONVEYOR_EXTRA_SIZE.width
      : type === CONTAINER_TYPES.GATE_QUEUE
        ? GATE_HIT_WIDTH
        : Math.max(0.1, finite(container?.width ?? container?.size?.x, type === CONTAINER_TYPES.ELEVATOR ? ELEVATOR_DEFAULT_SIZE.width : 1.1));
  const length = type === CONTAINER_TYPES.GARAGE
    ? GARAGE_SIZE.length
    : type === CONTAINER_TYPES.CONVEYOR
      ? CONVEYOR_EXTRA_SIZE.length
      : type === CONTAINER_TYPES.GATE_QUEUE
        ? VEHICLE_SIZES[4].length * 1.5
        : Math.max(0.1, finite(container?.length ?? container?.size?.y, type === CONTAINER_TYPES.ELEVATOR ? ELEVATOR_DEFAULT_SIZE.length : 0.8));
  return {
    id: Math.max(0, Math.round(finite(container?.id, fallbackId))),
    type,
    x: finite(container?.x ?? container?.position?.x),
    z: finite(container?.z ?? container?.position?.z),
    yaw: normalizeAngle(container?.yaw ?? container?.rotationY),
    width,
    length,
    conveyorWidth,
    gateQueuePathShape: pathShape === 1 || pathShape === '1' || pathShape === 'Curve' || pathShape === 'Bezier' ? 1 : 0,
    gateQueueLocked: pathShape === 0 || pathShape === '0' || pathShape === 'Line' ? true : container?.gateQueueLocked !== false,
    gateQueueGap: gateQueueGap > 0.01 ? gateQueueGap : GATE_DEFAULT_GAP,
    gateQueueShowCurveHandles: Boolean(container?.gateQueueShowCurveHandles),
    gateQueueTangents: Array.isArray(container?.gateQueueTangents)
      ? container.gateQueueTangents.map((point) => ({ x: finite(point?.x), z: finite(point?.z) }))
      : [],
    gateQueueTangentOverrides: Array.isArray(container?.gateQueueTangentOverrides)
      ? container.gateQueueTangentOverrides.map(Boolean)
      : [],
    gateQueuePathPoints: Array.isArray(container?.gateQueuePathPoints)
      ? container.gateQueuePathPoints.map((point) => ({ x: finite(point?.x), z: finite(point?.z) }))
      : [],
    elevatorEditingLayer: Math.max(0, Math.min(1, Math.round(finite(container?.elevatorEditingLayer))))
  };
}

export function createLevelDocument(level = {}) {
  const vehicles = (level.vehicles ?? []).map((vehicle, index) => normalizeVehicle(vehicle, index + 1));
  const conveyorWidths = new Map((level.conveyorBelts ?? []).map((belt) => [Number(belt.vcId), belt.width]));
  const containers = (level.containers?.length ? level.containers : [{ id: 0, type: 1 }])
    .map((container, index) => normalizeContainer({
      ...container,
      ...(conveyorWidths.has(Number(container.id)) ? { conveyorWidth: conveyorWidths.get(Number(container.id)) } : {})
    }, index));
  const passengerQueues = Array.isArray(level.passengerQueues)
    ? level.passengerQueues.map((queue) => queue.map((value) => Math.max(0, Math.round(finite(value)))))
    : [[], []];
  return {
    format: 'bus-loop-web-level-v1',
    key: level.key ?? `level${positiveInt(level.unityId ?? level.id, 1)}`,
    displayName: level.displayName ?? level.key ?? 'New Level',
    unityId: positiveInt(level.unityId ?? level.id, 1),
    mapScale: Math.max(0.1, finite(level.mapScale, 1)),
    difficulty: level.difficulty ?? 'Normal',
    conveyorBeltName: level.conveyorBeltName ?? level.sceneName ?? 'GameSceneDualQueue2',
    background: level.background ?? null,
    passengerMethod: level.passengerMethod ?? 'FixedSequence',
    vehicles,
    containers,
    passengerQueues,
    vehicleDepthes: clone(level.vehicleDepthes ?? {}),
    editor: {
      gridGap: Math.max(0.05, finite(level.editor?.gridGap, 0.27)),
      gridRotation: normalizeAngle(level.editor?.gridRotation),
      gridSnap: level.editor?.gridSnap !== false,
      vehicleSnap: level.editor?.vehicleSnap !== false,
      alignmentGuides: level.editor?.alignmentGuides !== false
    }
  };
}

function selectedItems(document, selection) {
  const keys = new Set(selection);
  return [
    ...document.vehicles.filter((item) => keys.has(`vehicle:${item.id}`)),
    ...document.containers.filter((item) => keys.has(`container:${item.id}`))
  ];
}

function nextId(items) {
  return items.reduce((max, item) => Math.max(max, finite(item.id)), 0) + 1;
}

function worldBounds(items) {
  if (!items.length) return null;
  return items.reduce((bounds, item) => ({
    minX: Math.min(bounds.minX, item.x), maxX: Math.max(bounds.maxX, item.x),
    minZ: Math.min(bounds.minZ, item.z), maxZ: Math.max(bounds.maxZ, item.z)
  }), { minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity });
}

function vehicleSize(vehicle) {
  return VEHICLE_SIZES[vehicle.seats] ?? VEHICLE_SIZES[4];
}

function localAxes(yaw) {
  const radians = normalizeAngle(yaw) * Math.PI / 180;
  return {
    x: { x: Math.cos(radians), z: -Math.sin(radians) },
    forward: { x: Math.sin(radians), z: Math.cos(radians) }
  };
}

function vehiclesInContainer(document, container, layer = null) {
  return document.vehicles.filter((vehicle) => (
    vehicle.containerId === container.id
    && (layer == null || vehicle.elevatorLayer === layer)
  ));
}

function translateContainerContents(document, container, dx, dz) {
  if (![CONTAINER_TYPES.GATE_QUEUE, CONTAINER_TYPES.ELEVATOR].includes(container.type)) return;
  for (const vehicle of vehiclesInContainer(document, container)) {
    vehicle.x += dx;
    vehicle.z += dz;
  }
  if (container.type === CONTAINER_TYPES.GATE_QUEUE) {
    for (const point of container.gateQueuePathPoints) {
      point.x += dx;
      point.z += dz;
    }
  }
}

function rotateContainerContents(document, container, delta) {
  if (![CONTAINER_TYPES.GATE_QUEUE, CONTAINER_TYPES.ELEVATOR].includes(container.type)) return;
  const radians = -delta * Math.PI / 180;
  const cosine = Math.cos(radians);
  const sine = Math.sin(radians);
  const rotatePoint = (point) => {
    const x = point.x - container.x;
    const z = point.z - container.z;
    point.x = container.x + x * cosine - z * sine;
    point.z = container.z + x * sine + z * cosine;
  };
  for (const vehicle of vehiclesInContainer(document, container)) {
    rotatePoint(vehicle);
    vehicle.yaw = normalizeAngle(vehicle.yaw + delta);
  }
  if (container.type === CONTAINER_TYPES.GATE_QUEUE) {
    for (const point of container.gateQueuePathPoints) rotatePoint(point);
    for (const tangent of container.gateQueueTangents) {
      const x = tangent.x;
      const z = tangent.z;
      tangent.x = x * cosine - z * sine;
      tangent.z = x * sine + z * cosine;
    }
  }
}

function resetConveyorVehiclePositions(document, conveyor) {
  const vehicles = vehiclesInContainer(document, conveyor);
  if (!vehicles.length) return false;
  const axes = localAxes(conveyor.yaw);
  const size = VEHICLE_SIZES[10];
  const gap = size.width;
  const rowWidth = vehicles.length * (size.width + gap) - gap;
  const forward = conveyor.length + size.length;
  let offset = (size.width - rowWidth) * 0.5;
  let changed = false;
  for (const vehicle of vehicles) {
    const x = conveyor.x + axes.x.x * offset + axes.forward.x * forward;
    const z = conveyor.z + axes.x.z * offset + axes.forward.z * forward;
    changed ||= Math.abs(vehicle.x - x) > 1e-9 || Math.abs(vehicle.z - z) > 1e-9 || vehicle.yaw !== conveyor.yaw;
    vehicle.x = x;
    vehicle.z = z;
    vehicle.yaw = conveyor.yaw;
    vehicle.containerType = CONTAINER_TYPES.CONVEYOR;
    offset += size.width + gap;
  }
  return changed;
}

function catmullRom(p0, p1, p2, p3, t) {
  const t2 = t * t;
  const t3 = t2 * t;
  return {
    x: 0.5 * (2 * p1.x + (-p0.x + p2.x) * t + (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 + (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3),
    z: 0.5 * (2 * p1.z + (-p0.z + p2.z) * t + (2 * p0.z - 5 * p1.z + 4 * p2.z - p3.z) * t2 + (-p0.z + 3 * p1.z - 3 * p2.z + p3.z) * t3)
  };
}

function hermite(p0, m0, p1, m1, t) {
  const t2 = t * t;
  const t3 = t2 * t;
  return {
    x: (2 * t3 - 3 * t2 + 1) * p0.x + (t3 - 2 * t2 + t) * m0.x + (-2 * t3 + 3 * t2) * p1.x + (t3 - t2) * m1.x,
    z: (2 * t3 - 3 * t2 + 1) * p0.z + (t3 - 2 * t2 + t) * m0.z + (-2 * t3 + 3 * t2) * p1.z + (t3 - t2) * m1.z
  };
}

function gateControlPoints(document, gate) {
  if (gate.gateQueuePathShape === 1 && gate.gateQueueLocked && gate.gateQueuePathPoints.length >= 2) {
    return gate.gateQueuePathPoints.map((point) => ({ ...point }));
  }
  const points = [{ x: gate.x, z: gate.z }];
  for (const vehicle of vehiclesInContainer(document, gate)) {
    if (points.length === 1 && Math.hypot(vehicle.x - gate.x, vehicle.z - gate.z) <= 0.0001) continue;
    points.push({ x: vehicle.x, z: vehicle.z });
  }
  if (points.length === 1) {
    const axes = localAxes(gate.yaw);
    points.push({ x: gate.x - axes.x.x, z: gate.z - axes.x.z });
  }
  return points;
}

export function getGateQueuePath(document, gate) {
  const control = gateControlPoints(document, gate);
  if (gate.gateQueuePathShape !== 1 || control.length < 2 || (gate.gateQueueLocked && gate.gateQueuePathPoints.length >= 2)) return control;
  const samples = [{ ...control[0] }];
  for (let index = 0; index < control.length - 1; index += 1) {
    const p0 = control[Math.max(0, index - 1)];
    const p1 = control[index];
    const p2 = control[index + 1];
    const p3 = control[Math.min(control.length - 1, index + 2)];
    const useHandles = gate.gateQueueTangentOverrides[index] || gate.gateQueueTangentOverrides[index + 1];
    const m0 = gate.gateQueueTangentOverrides[index] && gate.gateQueueTangents[index]
      ? gate.gateQueueTangents[index]
      : { x: (p2.x - p0.x) * 0.5, z: (p2.z - p0.z) * 0.5 };
    const m1 = gate.gateQueueTangentOverrides[index + 1] && gate.gateQueueTangents[index + 1]
      ? gate.gateQueueTangents[index + 1]
      : { x: (p3.x - p1.x) * 0.5, z: (p3.z - p1.z) * 0.5 };
    for (let step = 1; step <= 12; step += 1) {
      const t = step / 12;
      samples.push(useHandles ? hermite(p1, m0, p2, m1, t) : catmullRom(p0, p1, p2, p3, t));
    }
  }
  return samples;
}

export function getGateQueueTangentHandles(document, gate, vehicle) {
  if (!gate || !vehicle || gate.gateQueuePathShape !== 1 || gate.gateQueueLocked) return null;
  const vehicles = vehiclesInContainer(document, gate);
  const vehicleIndex = vehicles.indexOf(vehicle);
  if (vehicleIndex < 0) return null;
  const control = gateControlPoints(document, gate);
  const anchorIndex = vehicleIndex;
  const center = control[Math.min(anchorIndex, control.length - 1)];
  const previous = control[Math.max(0, anchorIndex - 1)];
  const next = control[Math.min(control.length - 1, anchorIndex + 1)];
  let vector = gate.gateQueueTangentOverrides[anchorIndex] && gate.gateQueueTangents[anchorIndex]
    ? gate.gateQueueTangents[anchorIndex]
    : { x: next.x - previous.x, z: next.z - previous.z };
  let length = Math.hypot(vector.x, vector.z);
  if (length <= 0.0001) {
    const axes = localAxes(gate.yaw);
    vector = { x: -axes.x.x, z: -axes.x.z };
    length = 1;
  }
  const handleLength = vehicleSize(vehicle).length * 1.5;
  const half = { x: vector.x / length * handleLength, z: vector.z / length * handleLength };
  return {
    anchorIndex,
    center: { ...center },
    negative: { x: center.x - half.x, z: center.z - half.z },
    positive: { x: center.x + half.x, z: center.z + half.z }
  };
}

function pointAndTangentAtDistance(path, targetDistance) {
  if (!path.length) return { point: { x: 0, z: 0 }, tangent: { x: 0, z: 1 } };
  let distance = 0;
  for (let index = 1; index < path.length; index += 1) {
    const a = path[index - 1];
    const b = path[index];
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const length = Math.hypot(dx, dz);
    if (length <= 0.0001) continue;
    if (distance + length >= targetDistance) {
      const t = Math.max(0, Math.min(1, (targetDistance - distance) / length));
      return { point: { x: a.x + dx * t, z: a.z + dz * t }, tangent: { x: dx, z: dz } };
    }
    distance += length;
  }
  const a = path[Math.max(0, path.length - 2)];
  const b = path[path.length - 1];
  return { point: { ...b }, tangent: { x: b.x - a.x, z: b.z - a.z } };
}

function nearestPathTangent(path, point) {
  let bestDistance = Number.POSITIVE_INFINITY;
  let bestTangent = { x: 0, z: 0 };
  for (let index = 1; index < path.length; index += 1) {
    const a = path[index - 1];
    const b = path[index];
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const lengthSquared = dx * dx + dz * dz;
    if (lengthSquared <= 0.00000001) continue;
    const t = Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.z - a.z) * dz) / lengthSquared));
    const px = a.x + dx * t;
    const pz = a.z + dz * t;
    const distance = (point.x - px) ** 2 + (point.z - pz) ** 2;
    if (distance < bestDistance) {
      bestDistance = distance;
      bestTangent = { x: dx, z: dz };
    }
  }
  return bestTangent;
}

function updateGateVehicleRotations(document, gate) {
  const path = getGateQueuePath(document, gate);
  for (const vehicle of vehiclesInContainer(document, gate)) {
    const tangent = nearestPathTangent(path, vehicle);
    if (Math.hypot(tangent.x, tangent.z) > 0.0001) {
      vehicle.yaw = normalizeAngle(Math.atan2(-tangent.x, -tangent.z) * 180 / Math.PI);
    }
  }
}

function resetGateQueueVehiclePositions(document, gate) {
  const vehicles = vehiclesInContainer(document, gate);
  gate.gateQueueGap = Math.max(0.01, finite(gate.gateQueueGap, GATE_DEFAULT_GAP));
  if (!vehicles.length) return false;
  if (gate.gateQueuePathShape === 0) {
    gate.gateQueueLocked = true;
    const axes = localAxes(gate.yaw);
    vehicles[0].x = gate.x;
    vehicles[0].z = gate.z;
    for (let index = 1; index < vehicles.length; index += 1) {
      const distance = vehicleSize(vehicles[index - 1]).length * 0.5 + vehicleSize(vehicles[index]).length * 0.5 + gate.gateQueueGap;
      vehicles[index].x = vehicles[index - 1].x - axes.x.x * distance;
      vehicles[index].z = vehicles[index - 1].z - axes.x.z * distance;
    }
  } else {
    const path = getGateQueuePath(document, gate);
    let distance = 0;
    for (let index = 0; index < vehicles.length; index += 1) {
      if (index > 0) distance += vehicleSize(vehicles[index - 1]).length * 0.5 + vehicleSize(vehicles[index]).length * 0.5 + gate.gateQueueGap;
      const { point } = pointAndTangentAtDistance(path, distance);
      vehicles[index].x = point.x;
      vehicles[index].z = point.z;
    }
  }
  const path = getGateQueuePath(document, gate);
  let distance = 0;
  for (let index = 0; index < vehicles.length; index += 1) {
    if (index > 0) distance += vehicleSize(vehicles[index - 1]).length * 0.5 + vehicleSize(vehicles[index]).length * 0.5 + gate.gateQueueGap;
    const { tangent } = pointAndTangentAtDistance(path, distance);
    if (Math.hypot(tangent.x, tangent.z) > 0.0001) vehicles[index].yaw = normalizeAngle(Math.atan2(-tangent.x, -tangent.z) * 180 / Math.PI);
    vehicleInGate(vehicles[index], gate);
  }
  gate.gateQueuePathPoints = getGateQueuePath(document, gate).map((point) => ({ ...point }));
  return true;
}

function vehicleInGate(vehicle, gate) {
  vehicle.containerType = CONTAINER_TYPES.GATE_QUEUE;
  vehicle.containerId = gate.id;
}

export function getGateQueueBounds(document, gate) {
  const path = getGateQueuePath(document, gate);
  if (path.length < 2) return [];
  const vehicles = vehiclesInContainer(document, gate);
  const maxWidth = Math.max(GATE_HIT_WIDTH, ...vehicles.map((vehicle) => vehicleSize(vehicle).width));
  const halfWidth = maxWidth * 0.5 * 1.25;
  const extended = path.map((point) => ({ ...point }));
  const first = path[0];
  const second = path[1];
  const last = path.at(-1);
  const beforeLast = path.at(-2);
  const extendPoint = (point, other, amount) => {
    const dx = point.x - other.x;
    const dz = point.z - other.z;
    const length = Math.hypot(dx, dz) || 1;
    return { x: point.x + dx / length * amount, z: point.z + dz / length * amount };
  };
  extended.unshift(extendPoint(first, second, vehicles.length ? vehicleSize(vehicles[0]).length * 0.5 : 0));
  extended.push(extendPoint(last, beforeLast, vehicles.length ? vehicleSize(vehicles.at(-1)).length * 0.5 : 0));
  const left = [];
  const right = [];
  extended.forEach((point, index) => {
    const previous = extended[Math.max(0, index - 1)];
    const next = extended[Math.min(extended.length - 1, index + 1)];
    const dx = next.x - previous.x;
    const dz = next.z - previous.z;
    const length = Math.hypot(dx, dz) || 1;
    const nx = -dz / length;
    const nz = dx / length;
    left.push({ x: point.x + nx * halfWidth, z: point.z + nz * halfWidth });
    right.push({ x: point.x - nx * halfWidth, z: point.z - nz * halfWidth });
  });
  return [...left, ...right.reverse()];
}

export function getElevatorStats(document, elevator) {
  const upper = vehiclesInContainer(document, elevator, 0);
  const lower = vehiclesInContainer(document, elevator, 1);
  const active = elevator.elevatorEditingLayer === 0 ? upper : lower;
  return {
    upperCount: upper.length,
    lowerCount: lower.length,
    outsideCount: active.filter((vehicle) => !isVehicleInsideElevator(vehicle, elevator)).length
  };
}

export function isVehicleInsideElevator(vehicle, elevator) {
  const elevatorAxes = localAxes(elevator.yaw);
  const vehicleAxes = localAxes(vehicle.yaw);
  const half = { x: elevator.width * 0.5, z: elevator.length * 0.5 };
  const size = vehicleSize(vehicle);
  const corners = [
    [1, 1], [1, -1], [-1, 1], [-1, -1]
  ];
  return corners.every(([sx, sz]) => {
    const x = vehicle.x + vehicleAxes.x.x * size.width * 0.5 * sx + vehicleAxes.forward.x * size.length * 0.5 * sz - elevator.x;
    const z = vehicle.z + vehicleAxes.x.z * size.width * 0.5 * sx + vehicleAxes.forward.z * size.length * 0.5 * sz - elevator.z;
    const localX = x * elevatorAxes.x.x + z * elevatorAxes.x.z;
    const localZ = x * elevatorAxes.forward.x + z * elevatorAxes.forward.z;
    return Math.abs(localX) <= half.x + 1e-9 && Math.abs(localZ) <= half.z + 1e-9;
  });
}

function resetGarageVehiclePositions(document, garage) {
  const vehicles = document.vehicles.filter((vehicle) => vehicle.containerId === garage.id);
  if (!vehicles.length) return false;
  const vehicle = VEHICLE_SIZES[10];
  const width = vehicles.length * GARAGE_VEHICLE_SPACING - vehicle.width;
  const radians = garage.yaw * Math.PI / 180;
  const axisX = { x: Math.cos(radians), z: -Math.sin(radians) };
  const axisY = { x: Math.sin(radians), z: Math.cos(radians) };
  const forward = garage.length + vehicle.length;
  let offset = (vehicle.width - width) * 0.5;
  let changed = false;
  for (const item of vehicles) {
    const x = garage.x + axisX.x * offset + axisY.x * forward;
    const z = garage.z + axisX.z * offset + axisY.z * forward;
    changed ||= Math.abs(item.x - x) > 1e-9 || Math.abs(item.z - z) > 1e-9 || item.yaw !== garage.yaw || item.containerType !== CONTAINER_TYPES.GARAGE;
    item.x = x;
    item.z = z;
    item.yaw = garage.yaw;
    item.containerType = CONTAINER_TYPES.GARAGE;
    offset += GARAGE_VEHICLE_SPACING;
  }
  return changed;
}

function overlapsAhead(source, target) {
  const a = vehicleSize(source);
  const b = target.seats ? vehicleSize(target) : { width: target.width, length: target.length };
  const rad = source.yaw * Math.PI / 180;
  const forward = { x: Math.sin(rad), z: Math.cos(rad) };
  const side = { x: Math.cos(rad), z: -Math.sin(rad) };
  const dx = target.x - source.x;
  const dz = target.z - source.z;
  const ahead = dx * forward.x + dz * forward.z;
  const lateral = Math.abs(dx * side.x + dz * side.z);
  return ahead > 0.001 && lateral <= (a.width + b.width) * 0.5 && ahead <= 500;
}

function buildVehicleDepthGraph(document) {
  const blockers = {};
  const targets = [...document.vehicles, ...document.containers.filter((item) => item.type !== CONTAINER_TYPES.PARKING)];
  for (const vehicle of document.vehicles.filter((item) => item.containerType === CONTAINER_TYPES.PARKING)) {
    blockers[vehicle.id] = targets.filter((target) => target !== vehicle && overlapsAhead(vehicle, target)).map((target) => target.id);
  }
  return blockers;
}

export function sortPassengerQueuesByVehicleDepth(document, initialCount = 8) {
  const queueLengths = document.passengerQueues.map((queue) => queue.length);
  const sourcePassengers = document.passengerQueues.flat();
  const remainingByColor = new Map();
  sourcePassengers.forEach((color) => remainingByColor.set(color, (remainingByColor.get(color) ?? 0) + 1));

  const orderedPassengers = [];
  document.vehicles
    .map((vehicle, index) => ({
      vehicle,
      index,
      depth: Array.isArray(document.vehicleDepthes?.[vehicle.id])
        ? new Set(document.vehicleDepthes[vehicle.id]).size
        : 0
    }))
    .sort((a, b) => a.depth - b.depth || a.index - b.index)
    .forEach(({ vehicle }) => {
      const count = Math.min(vehicle.seats, remainingByColor.get(vehicle.colorIndex) ?? 0);
      orderedPassengers.push(...Array(count).fill(vehicle.colorIndex));
      remainingByColor.set(vehicle.colorIndex, (remainingByColor.get(vehicle.colorIndex) ?? 0) - count);
    });

  sourcePassengers.forEach((color) => {
    if ((remainingByColor.get(color) ?? 0) <= 0) return;
    orderedPassengers.push(color);
    remainingByColor.set(color, remainingByColor.get(color) - 1);
  });

  const queues = queueLengths.map(() => []);
  const headLength = Math.max(0, Math.round(finite(initialCount, 8)));
  let offset = 0;
  const fill = (queueId, count) => {
    queues[queueId].push(...orderedPassengers.slice(offset, offset + count));
    offset += count;
  };
  queueLengths.forEach((length, queueId) => fill(queueId, Math.min(headLength, length)));
  queueLengths.forEach((length, queueId) => fill(queueId, Math.max(0, length - headLength)));
  return queues;
}

export function validateLevelDocument(document) {
  const errors = [];
  const warnings = [];
  const vehicleIds = new Set();
  const containerIds = new Set();
  for (const container of document.containers) {
    if (containerIds.has(container.id)) errors.push(`容器 ID ${container.id} 重复`);
    containerIds.add(container.id);
  }
  const conveyors = document.containers.filter((container) => container.type === CONTAINER_TYPES.CONVEYOR);
  if (conveyors.length > 1) errors.push('运输带：每个关卡最多只能有一条');
  for (const conveyor of conveyors) {
    if (!Number.isFinite(conveyor.conveyorWidth) || conveyor.conveyorWidth < 0.1) errors.push(`运输带 ${conveyor.id} 的出口宽度无效`);
  }
  for (const vehicle of document.vehicles) {
    if (vehicleIds.has(vehicle.id)) errors.push(`车辆 ID ${vehicle.id} 重复`);
    vehicleIds.add(vehicle.id);
    if (![4, 6, 10].includes(vehicle.seats)) errors.push(`车辆 ${vehicle.id} 的座位数无效`);
    if (!containerIds.has(vehicle.containerId)) errors.push(`车辆 ${vehicle.id} 引用了不存在的容器 ${vehicle.containerId}`);
    if (vehicle.mechanism.type !== 'normal' && ['linkHead', 'linkTail', 'wrench', 'gear'].includes(vehicle.mechanism.type)) {
      if (!vehicleIds.has(vehicle.mechanism.pairVehicleId) && !document.vehicles.some((v) => v.id === vehicle.mechanism.pairVehicleId)) {
        errors.push(`车辆 ${vehicle.id} 的关联车辆不存在`);
      }
    }
  }
  const seatCounts = new Map();
  const passengerCounts = new Map();
  for (const vehicle of document.vehicles) seatCounts.set(vehicle.colorIndex, (seatCounts.get(vehicle.colorIndex) ?? 0) + vehicle.seats);
  for (const queue of document.passengerQueues) for (const color of queue) passengerCounts.set(color, (passengerCounts.get(color) ?? 0) + 1);
  for (const color of new Set([...seatCounts.keys(), ...passengerCounts.keys()])) {
    const seats = seatCounts.get(color) ?? 0;
    const passengers = passengerCounts.get(color) ?? 0;
    if (seats !== passengers) errors.push(`颜色 ${color}：${seats} 个座位，${passengers} 名乘客`);
  }
  if (!document.vehicles.length) warnings.push('关卡中没有车辆');
  if (document.containers.filter((item) => item.type === CONTAINER_TYPES.PARKING).length !== 1) {
    warnings.push('建议仅保留一个停车区容器');
  }
  for (const elevator of document.containers.filter((container) => container.type === CONTAINER_TYPES.ELEVATOR)) {
    const stats = getElevatorStats(document, elevator);
    if (stats.upperCount === 0 || stats.lowerCount === 0) warnings.push(`升降舱 ${elevator.id} 的上层或下层没有车辆`);
    if (stats.outsideCount > 0) warnings.push(`升降舱 ${elevator.id} 当前层有 ${stats.outsideCount} 辆车位于舱外`);
  }
  return { valid: errors.length === 0, errors, warnings };
}

export class LevelEditorModel {
  constructor(document, { historyLimit = 100 } = {}) {
    this.document = createLevelDocument(document);
    this.selection = new Set();
    this.activeContainerId = 0;
    this.historyLimit = historyLimit;
    this.undoStack = [];
    this.redoStack = [];
    this.clipboard = [];
    this.changeVersion = 0;
  }

  snapshot() { return clone(this.document); }
  selected() { return selectedItems(this.document, this.selection); }

  transact(mutator) {
    const before = this.snapshot();
    const beforeSelection = [...this.selection];
    mutator(this.document);
    this.undoStack.push({ document: before, selection: beforeSelection });
    if (this.undoStack.length > this.historyLimit) this.undoStack.shift();
    this.redoStack.length = 0;
    this.changeVersion += 1;
    return this.document;
  }

  restore(entry, destination) {
    if (!entry) return false;
    destination.push({ document: this.snapshot(), selection: [...this.selection] });
    this.document = clone(entry.document);
    this.selection = new Set(entry.selection);
    this.changeVersion += 1;
    return true;
  }

  undo() { return this.restore(this.undoStack.pop(), this.redoStack); }
  redo() { return this.restore(this.redoStack.pop(), this.undoStack); }

  select(key, { add = false, toggle = false } = {}) {
    if (!add && !toggle) this.selection.clear();
    if (toggle && this.selection.has(key)) this.selection.delete(key);
    else this.selection.add(key);
  }

  selectMany(keys) { this.selection = new Set(keys); }
  clearSelection() { this.selection.clear(); }

  enterContainer(containerId) {
    const container = this.document.containers.find((item) => item.id === Number(containerId) && item.type !== CONTAINER_TYPES.PARKING);
    if (!container) return false;
    this.activeContainerId = container.id;
    if (container.type === CONTAINER_TYPES.GARAGE && resetGarageVehiclePositions(this.document, container)) this.changeVersion += 1;
    if (container.type === CONTAINER_TYPES.CONVEYOR && resetConveyorVehiclePositions(this.document, container)) this.changeVersion += 1;
    if (container.type === CONTAINER_TYPES.GATE_QUEUE && resetGateQueueVehiclePositions(this.document, container)) this.changeVersion += 1;
    this.clearSelection();
    return true;
  }

  exitActiveContainer() {
    if (this.activeContainerId === 0) return false;
    const previousId = this.activeContainerId;
    const previous = this.document.containers.find((item) => item.id === previousId);
    if (previous?.type === CONTAINER_TYPES.ELEVATOR) previous.elevatorEditingLayer = 0;
    this.activeContainerId = 0;
    this.selection = new Set([`container:${previousId}`]);
    return true;
  }

  addVehicle(values = {}) {
    let vehicle;
    this.transact((document) => {
      const activeContainer = document.containers.find((item) => item.id === this.activeContainerId)
        ?? document.containers.find((item) => item.type === CONTAINER_TYPES.PARKING);
      vehicle = normalizeVehicle({
        containerType: activeContainer?.type,
        containerId: activeContainer?.id ?? 0,
        x: activeContainer?.x ?? 0,
        z: activeContainer?.z ?? 0,
        yaw: activeContainer?.yaw ?? 0,
        elevatorLayer: activeContainer?.type === CONTAINER_TYPES.ELEVATOR ? activeContainer.elevatorEditingLayer : 0,
        ...values
      }, nextId(document.vehicles));
      vehicle.id = nextId(document.vehicles);
      document.vehicles.push(vehicle);
      if (activeContainer?.type === CONTAINER_TYPES.GARAGE) resetGarageVehiclePositions(document, activeContainer);
      if (activeContainer?.type === CONTAINER_TYPES.CONVEYOR) resetConveyorVehiclePositions(document, activeContainer);
      if (activeContainer?.type === CONTAINER_TYPES.GATE_QUEUE) resetGateQueueVehiclePositions(document, activeContainer);
      this.selection = new Set([`vehicle:${vehicle.id}`]);
    });
    return vehicle;
  }

  addContainer(type, values = {}) {
    let container;
    this.transact((document) => {
      container = normalizeContainer({ type, ...values }, nextId(document.containers));
      container.id = nextId(document.containers);
      document.containers.push(container);
      this.selection = new Set([`container:${container.id}`]);
    });
    return container;
  }

  removeSelected() {
    const keys = new Set(this.selection);
    if (!keys.size) return;
    this.transact((document) => {
      const removedContainers = new Set(document.containers.filter((item) => keys.has(`container:${item.id}`)).map((item) => item.id));
      document.vehicles = document.vehicles.filter((item) => !keys.has(`vehicle:${item.id}`) && !removedContainers.has(item.containerId));
      document.containers = document.containers.filter((item) => !keys.has(`container:${item.id}`) || item.type === CONTAINER_TYPES.PARKING);
      const active = document.containers.find((item) => item.id === this.activeContainerId);
      if (active?.type === CONTAINER_TYPES.GARAGE) resetGarageVehiclePositions(document, active);
      if (active?.type === CONTAINER_TYPES.CONVEYOR) resetConveyorVehiclePositions(document, active);
      if (active?.type === CONTAINER_TYPES.GATE_QUEUE) resetGateQueueVehiclePositions(document, active);
      this.selection.clear();
    });
  }

  copy() { this.clipboard = clone(this.selected().map((item) => ({ ...item, kind: item.seats ? 'vehicle' : 'container' }))); }
  cut() { this.copy(); this.removeSelected(); }
  duplicate() { this.copy(); return this.paste(); }

  paste() {
    if (!this.clipboard.length) return [];
    const pastedKeys = [];
    this.transact((document) => {
      const idMap = new Map();
      let vehicleId = nextId(document.vehicles);
      let containerId = nextId(document.containers);
      for (const source of this.clipboard) idMap.set(`${source.kind}:${source.id}`, source.kind === 'vehicle' ? vehicleId++ : containerId++);
      for (const source of this.clipboard) {
        const item = clone(source);
        delete item.kind;
        item.id = idMap.get(`${source.kind}:${source.id}`);
        item.x += 0.27;
        item.z += 0.27;
        if (source.kind === 'vehicle') {
          item.containerId = idMap.get(`container:${source.containerId}`) ?? source.containerId;
          if (item.mechanism?.pairVehicleId != null) item.mechanism.pairVehicleId = idMap.get(`vehicle:${item.mechanism.pairVehicleId}`) ?? null;
          document.vehicles.push(item);
        } else document.containers.push(item);
        pastedKeys.push(`${source.kind}:${item.id}`);
      }
      this.selection = new Set(pastedKeys);
    });
    return pastedKeys;
  }

  moveSelected(dx, dz, { snap = this.document.editor.gridSnap } = {}) {
    const items = this.selected();
    if (!items.length) return;
    const gap = this.document.editor.gridGap;
    this.transact((document) => {
      const selectedContainers = new Set(items.filter((item) => !item.seats).map((item) => item.id));
      for (const item of items) {
        if (item.seats && selectedContainers.has(item.containerId)) continue;
        const previous = { x: item.x, z: item.z };
        item.x += finite(dx);
        item.z += finite(dz);
        if (snap) {
          const radians = -this.document.editor.gridRotation * Math.PI / 180;
          const localX = item.x * Math.cos(radians) - item.z * Math.sin(radians);
          const localZ = item.x * Math.sin(radians) + item.z * Math.cos(radians);
          const snappedX = Math.round(localX / gap) * gap;
          const snappedZ = Math.round(localZ / gap) * gap;
          item.x = snappedX * Math.cos(-radians) - snappedZ * Math.sin(-radians);
          item.z = snappedX * Math.sin(-radians) + snappedZ * Math.cos(-radians);
        }
        if (!item.seats) translateContainerContents(document, item, item.x - previous.x, item.z - previous.z);
      }
      if (this.document.editor.vehicleSnap) {
        const selectedSet = new Set(items);
        const others = this.document.vehicles.filter((item) => !selectedSet.has(item));
        const anchor = items[0];
        const threshold = Math.max(0.04, gap * 0.35);
        const xTarget = others.map((item) => item.x).find((value) => Math.abs(value - anchor.x) <= threshold);
        const zTarget = others.map((item) => item.z).find((value) => Math.abs(value - anchor.z) <= threshold);
        if (xTarget != null) { const correction = xTarget - anchor.x; for (const item of items) item.x += correction; }
        if (zTarget != null) { const correction = zTarget - anchor.z; for (const item of items) item.z += correction; }
      }
      const active = document.containers.find((item) => item.id === this.activeContainerId);
      if (active?.type === CONTAINER_TYPES.CONVEYOR) {
        const movingVehicles = items.filter((item) => item.seats && item.containerId === active.id);
        if (movingVehicles.length) {
          const axes = localAxes(active.yaw);
          const ordered = document.vehicles.filter((vehicle) => vehicle.containerId === active.id).sort((a, b) => {
            const ax = (a.x - active.x) * axes.x.x + (a.z - active.z) * axes.x.z;
            const bx = (b.x - active.x) * axes.x.x + (b.z - active.z) * axes.x.z;
            return ax - bx;
          });
          let order = 0;
          document.vehicles = document.vehicles.map((vehicle) => vehicle.containerId === active.id ? ordered[order++] : vehicle);
          resetConveyorVehiclePositions(document, active);
        }
      }
      if (active?.type === CONTAINER_TYPES.GATE_QUEUE && items.some((item) => item.seats && item.containerId === active.id)) {
        resetGateQueueVehiclePositions(document, active);
      }
    });
  }

  rotateSelected(angle, { absolute = false } = {}) {
    const items = this.selected();
    if (!items.length) return;
    this.transact((document) => {
      const selectedContainers = new Set(items.filter((item) => !item.seats).map((item) => item.id));
      for (const item of items) {
        if (item.seats && selectedContainers.has(item.containerId)) continue;
        const previous = item.yaw;
        item.yaw = normalizeAngle(absolute ? angle : item.yaw + angle);
        if (!item.seats) rotateContainerContents(document, item, absolute ? item.yaw - previous : angle);
      }
    });
  }

  selectionCenter() {
    const items = this.selected();
    const bounds = worldBounds(items);
    return bounds ? { x: (bounds.minX + bounds.maxX) / 2, z: (bounds.minZ + bounds.maxZ) / 2 } : null;
  }

  rotateSelectedAroundCenter(angle, center = this.selectionCenter()) {
    const items = this.selected();
    if (!items.length || !center) return;
    const radians = -angle * Math.PI / 180;
    const cosine = Math.cos(radians);
    const sine = Math.sin(radians);
    this.transact((document) => {
      const selectedContainers = new Set(items.filter((item) => !item.seats).map((item) => item.id));
      for (const item of items) {
        if (item.seats && selectedContainers.has(item.containerId)) continue;
        const previous = { x: item.x, z: item.z };
        const x = item.x - center.x;
        const z = item.z - center.z;
        if (!item.seats) rotateContainerContents(document, item, angle);
        item.x = center.x + x * cosine - z * sine;
        item.z = center.z + x * sine + z * cosine;
        item.yaw = normalizeAngle(item.yaw + angle);
        if (!item.seats) {
          translateContainerContents(document, item, item.x - previous.x, item.z - previous.z);
        }
      }
    });
  }

  mirror(axis = 'x') {
    const items = this.selected();
    const bounds = worldBounds(items);
    if (!bounds) return;
    const cx = (bounds.minX + bounds.maxX) / 2;
    const cz = (bounds.minZ + bounds.maxZ) / 2;
    this.transact(() => {
      for (const item of items) {
        if (axis === 'x') { item.x = cx - (item.x - cx); item.yaw = normalizeAngle(-item.yaw); }
        else { item.z = cz - (item.z - cz); item.yaw = normalizeAngle(180 - item.yaw); }
      }
    });
  }

  align(mode) {
    const items = this.selected();
    if (items.length < 2) return;
    this.transact(() => {
      if (mode === 'horizontal') {
        const z = items.reduce((sum, item) => sum + item.z, 0) / items.length;
        for (const item of items) item.z = z;
      } else if (mode === 'vertical') {
        const x = items.reduce((sum, item) => sum + item.x, 0) / items.length;
        for (const item of items) item.x = x;
      } else {
        const sorted = [...items].sort((a, b) => a.x - b.x || a.z - b.z);
        const first = sorted[0]; const last = sorted.at(-1);
        sorted.forEach((item, index) => {
          const t = index / Math.max(1, sorted.length - 1);
          item.x = first.x + (last.x - first.x) * t;
          item.z = first.z + (last.z - first.z) * t;
        });
      }
    });
  }

  centerAll() {
    const items = [...this.document.vehicles, ...this.document.containers.filter((item) => item.type !== CONTAINER_TYPES.PARKING)];
    const bounds = worldBounds(items);
    if (!bounds) return;
    const dx = -(bounds.minX + bounds.maxX) / 2;
    const dz = -(bounds.minZ + bounds.maxZ) / 2;
    this.transact(() => { for (const item of items) { item.x += dx; item.z += dz; } });
  }

  setSelectedField(field, value) {
    const items = this.selected();
    if (!items.length) return;
    this.transact((document) => {
      for (const item of items) {
        const previous = { x: item.x, z: item.z, yaw: item.yaw };
        const unlockedGatePath = !item.seats && item.type === CONTAINER_TYPES.GATE_QUEUE && field === 'gateQueueLocked' && value
          ? getGateQueuePath(document, item)
          : null;
        const path = field.split('.');
        const key = path.pop();
        const parent = path.reduce((target, part) => target[part], item);
        parent[key] = value;
        if (!item.seats) {
          if (field === 'x' || field === 'z') translateContainerContents(document, item, item.x - previous.x, item.z - previous.z);
          if (field === 'yaw') rotateContainerContents(document, item, normalizeAngle(item.yaw) - normalizeAngle(previous.yaw));
          if (field === 'conveyorWidth') {
            item.conveyorWidth = Math.max(0.1, finite(value, CONVEYOR_DEFAULT_WIDTH));
            item.width = item.conveyorWidth + CONVEYOR_EXTRA_SIZE.width;
            item.length = CONVEYOR_EXTRA_SIZE.length;
          }
          if (field === 'gateQueuePathShape' && Number(value) === 0) item.gateQueueLocked = true;
          if (unlockedGatePath) item.gateQueuePathPoints = unlockedGatePath;
        }
      }
      const active = document.containers.find((item) => item.id === this.activeContainerId);
      if (active?.type === CONTAINER_TYPES.CONVEYOR && ['seats', 'conveyorWidth'].includes(field)) resetConveyorVehiclePositions(document, active);
      if (active?.type === CONTAINER_TYPES.GATE_QUEUE && ['seats', 'gateQueuePathShape', 'gateQueueLocked', 'gateQueueGap'].includes(field)) resetGateQueueVehiclePositions(document, active);
    });
  }

  refreshActiveGateQueue() {
    const gate = this.document.containers.find((item) => item.id === this.activeContainerId && item.type === CONTAINER_TYPES.GATE_QUEUE)
      ?? this.selected().find((item) => item.type === CONTAINER_TYPES.GATE_QUEUE);
    if (!gate) return false;
    this.transact((document) => resetGateQueueVehiclePositions(document, gate));
    return true;
  }

  setGateQueueTangentHandle(gateId, vehicleId, side, point) {
    const gate = this.document.containers.find((item) => item.id === Number(gateId) && item.type === CONTAINER_TYPES.GATE_QUEUE);
    const vehicle = this.document.vehicles.find((item) => item.id === Number(vehicleId) && item.containerId === gate?.id);
    const handles = getGateQueueTangentHandles(this.document, gate, vehicle);
    if (!handles || !point || ![-1, 1].includes(side)) return false;
    const dx = finite(point.x) - handles.center.x;
    const dz = finite(point.z) - handles.center.z;
    const length = Math.hypot(dx, dz);
    if (length <= 0.0001) return false;
    this.transact((document) => {
      const handleLength = vehicleSize(vehicle).length * 1.5;
      const direction = side < 0 ? -1 : 1;
      gate.gateQueueTangents[handles.anchorIndex] = {
        x: dx / length * handleLength * direction,
        z: dz / length * handleLength * direction
      };
      gate.gateQueueTangentOverrides[handles.anchorIndex] = true;
      updateGateVehicleRotations(document, gate);
    });
    return true;
  }

  setElevatorEditingLayer(layer) {
    const elevator = this.document.containers.find((item) => item.id === this.activeContainerId && item.type === CONTAINER_TYPES.ELEVATOR)
      ?? this.selected().find((item) => item.type === CONTAINER_TYPES.ELEVATOR);
    if (!elevator) return false;
    elevator.elevatorEditingLayer = Math.max(0, Math.min(1, Math.round(finite(layer))));
    this.clearSelection();
    this.changeVersion += 1;
    return true;
  }

  resizeElevatorByHandle(elevatorId, handleIndex, point) {
    const elevator = this.document.containers.find((item) => item.id === Number(elevatorId) && item.type === CONTAINER_TYPES.ELEVATOR);
    if (!elevator || handleIndex < 0 || handleIndex > 7 || !point) return false;
    this.transact(() => {
      const axes = localAxes(elevator.yaw);
      const dx = finite(point.x) - elevator.x;
      const dz = finite(point.z) - elevator.z;
      const local = { x: dx * axes.x.x + dz * axes.x.z, z: dx * axes.forward.x + dz * axes.forward.z };
      const half = { x: elevator.width * 0.5, z: elevator.length * 0.5 };
      const min = { x: -half.x, z: -half.z };
      const max = { x: half.x, z: half.z };
      if (handleIndex === 0) { min.x = local.x; max.z = local.z; }
      else if (handleIndex === 1) max.z = local.z;
      else if (handleIndex === 2) { max.x = local.x; max.z = local.z; }
      else if (handleIndex === 3) min.x = local.x;
      else if (handleIndex === 4) max.x = local.x;
      else if (handleIndex === 5) { min.x = local.x; min.z = local.z; }
      else if (handleIndex === 6) min.z = local.z;
      else if (handleIndex === 7) { max.x = local.x; min.z = local.z; }
      const center = { x: (min.x + max.x) * 0.5, z: (min.z + max.z) * 0.5 };
      elevator.x += axes.x.x * center.x + axes.forward.x * center.z;
      elevator.z += axes.x.z * center.x + axes.forward.z * center.z;
      elevator.width = Math.max(0.1, max.x - min.x);
      elevator.length = Math.max(0.1, max.z - min.z);
    });
    return true;
  }

  centerActiveElevatorLayer() {
    const elevator = this.document.containers.find((item) => item.id === this.activeContainerId && item.type === CONTAINER_TYPES.ELEVATOR)
      ?? this.selected().find((item) => item.type === CONTAINER_TYPES.ELEVATOR);
    if (!elevator) return false;
    const vehicles = vehiclesInContainer(this.document, elevator, elevator.elevatorEditingLayer);
    if (!vehicles.length) return false;
    this.transact(() => {
      const axes = localAxes(elevator.yaw);
      const corners = [];
      for (const vehicle of vehicles) {
        const vAxes = localAxes(vehicle.yaw);
        const size = vehicleSize(vehicle);
        for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
          const x = vehicle.x + vAxes.x.x * size.width * 0.5 * sx + vAxes.forward.x * size.length * 0.5 * sz - elevator.x;
          const z = vehicle.z + vAxes.x.z * size.width * 0.5 * sx + vAxes.forward.z * size.length * 0.5 * sz - elevator.z;
          corners.push({ x: x * axes.x.x + z * axes.x.z, z: x * axes.forward.x + z * axes.forward.z });
        }
      }
      const bounds = worldBounds(corners);
      const localX = (bounds.minX + bounds.maxX) * 0.5;
      const localZ = (bounds.minZ + bounds.maxZ) * 0.5;
      const dx = -(axes.x.x * localX + axes.forward.x * localZ);
      const dz = -(axes.x.z * localX + axes.forward.z * localZ);
      for (const vehicle of vehicles) { vehicle.x += dx; vehicle.z += dz; }
    });
    return true;
  }

  convertSelectedToGateQueue() {
    const vehicles = this.selected().filter((item) => item.seats);
    if (!vehicles.length) return null;
    let gate;
    this.transact((document) => {
      const bounds = worldBounds(vehicles);
      gate = normalizeContainer({
        id: nextId(document.containers), type: CONTAINER_TYPES.GATE_QUEUE,
        x: (bounds.minX + bounds.maxX) / 2, z: (bounds.minZ + bounds.maxZ) / 2,
        gateQueuePathPoints: vehicles.map((vehicle) => ({ x: vehicle.x, z: vehicle.z }))
      }, nextId(document.containers));
      document.containers.push(gate);
      vehicles.forEach((vehicle) => { vehicle.containerType = CONTAINER_TYPES.GATE_QUEUE; vehicle.containerId = gate.id; });
      this.selection = new Set([`container:${gate.id}`]);
    });
    return gate;
  }

  rebuildDepthGraph() {
    this.transact((document) => {
      document.vehicleDepthes = buildVehicleDepthGraph(document);
    });
    return this.document.vehicleDepthes;
  }

  sortPassengerQueuesByDepth(initialCount = 8) {
    this.transact((document) => {
      document.vehicleDepthes = buildVehicleDepthGraph(document);
      document.passengerQueues = sortPassengerQueuesByVehicleDepth(document, initialCount);
    });
    return this.document.passengerQueues;
  }

  setQueue(queueIndex, colors) {
    this.transact((document) => {
      while (document.passengerQueues.length <= queueIndex) document.passengerQueues.push([]);
      document.passengerQueues[queueIndex] = colors.map((value) => Math.max(0, Math.round(finite(value))));
    });
  }
}

export function levelDocumentToRuntime(document, baseLevel = {}) {
  const doc = createLevelDocument(document);
  const vehicles = doc.vehicles.map((vehicle) => ({
    ...vehicle,
    mechanism: clone(vehicle.mechanism),
    collisionSize: clone(VEHICLE_SIZES[vehicle.seats] ?? VEHICLE_SIZES[4]),
    ...(vehicle.mechanism.type === 'ambulance' ? { ambulanceStepLimit: vehicle.mechanism.stepLimit } : {}),
    ...(vehicle.mechanism.type === 'firetruck' ? { firetruckTimeLimit: vehicle.mechanism.timeLimit } : {})
  }));
  const previousBelts = new Map((baseLevel.conveyorBelts ?? []).map((belt) => [Number(belt.vcId), belt]));
  const conveyorBelts = doc.containers.filter((container) => container.type === CONTAINER_TYPES.CONVEYOR).map((container) => ({
    ...(previousBelts.get(container.id) ?? {}),
    vcId: container.id,
    width: container.conveyorWidth
  }));
  return {
    ...clone(baseLevel),
    key: doc.key,
    displayName: doc.displayName,
    id: doc.unityId,
    unityId: doc.unityId,
    mapScale: doc.mapScale,
    sceneName: doc.conveyorBeltName,
    vehicles,
    containers: clone(doc.containers),
    conveyorBelts,
    vehicleDepthes: clone(doc.vehicleDepthes),
    passengerQueues: clone(doc.passengerQueues),
    passengerSequence: doc.passengerQueues.flat(),
    queueCount: doc.passengerQueues.length
  };
}

function buildLevelTabularRows(document) {
  const rows = [['type', 'id', 'x', 'z', 'yaw', 'seats', 'color', 'containerType', 'containerId', 'depth', 'mechanism']];
  for (const vehicle of document.vehicles) rows.push([
    'vehicle', vehicle.id, vehicle.x, vehicle.z, vehicle.yaw, vehicle.seats, vehicle.colorIndex,
    vehicle.containerType, vehicle.containerId,
    Array.isArray(document.vehicleDepthes?.[vehicle.id]) ? new Set(document.vehicleDepthes[vehicle.id]).size : 0,
    vehicle.mechanism.type
  ]);
  for (const container of document.containers) rows.push([
    'container', container.id, container.x, container.z, container.yaw, '', '', container.type, '', '', ''
  ]);
  return rows;
}

export function exportLevelCsv(document) {
  const rows = buildLevelTabularRows(document);
  return rows.map((row) => row.map((value) => `"${String(value).replaceAll('"', '""')}"`).join(',')).join('\r\n');
}

export function exportLevelExcelXml(document) {
  const xml = (value) => String(value).replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;'
  })[char]);
  const rows = buildLevelTabularRows(document);
  const body = rows.map((row, rowIndex) => `<Row>${row.map((value) => `<Cell${rowIndex === 0 ? ' ss:StyleID="Header"' : ''}><Data ss:Type="String">${xml(value)}</Data></Cell>`).join('')}</Row>`).join('');
  return `<?xml version="1.0"?><?mso-application progid="Excel.Sheet"?><Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"><Styles><Style ss:ID="Header"><Font ss:Bold="1"/><Interior ss:Color="#87CEEB" ss:Pattern="Solid"/></Style></Styles><Worksheet ss:Name="Level"><Table>${body}</Table><WorksheetOptions xmlns="urn:schemas-microsoft-com:office:excel"><FreezePanes/><FrozenNoSplit/><SplitHorizontal>1</SplitHorizontal><TopRowBottomPane>1</TopRowBottomPane></WorksheetOptions></Worksheet></Workbook>`;
}

export function exportUnityLevelAsset(document) {
  const doc = createLevelDocument(document);
  const renderList = (items, render) => items.length ? items.map(render).join('\n') : '  []';
  const vehicles = renderList(doc.vehicles, (vehicle) => {
    const radians = vehicle.yaw * Math.PI / 360;
    return `  - id: ${vehicle.id}\n    seats: ${vehicle.seats}\n    isHidden: ${vehicle.isHidden ? 1 : 0}\n    isTurnVehicle: ${vehicle.isTurnVehicle ? 1 : 0}\n    colorIndex: ${vehicle.colorIndex}\n    position: {x: ${vehicle.x}, y: 0, z: ${vehicle.z}}\n    rotation: {x: 0, y: ${Math.sin(radians)}, z: 0, w: ${Math.cos(radians)}}\n    containerType: ${vehicle.containerType}\n    containerId: ${vehicle.containerId}\n    elevatorLayer: ${vehicle.elevatorLayer}`;
  });
  const containers = renderList(doc.containers, (container) => {
    const radians = container.yaw * Math.PI / 360;
    const base = `  - id: ${container.id}\n    type: ${container.type}\n    position: {x: ${container.x}, y: 0, z: ${container.z}}\n    rotation: {x: 0, y: ${Math.sin(radians)}, z: 0, w: ${Math.cos(radians)}}`;
    if (container.type === CONTAINER_TYPES.GATE_QUEUE) {
      const points = getGateQueuePath(doc, container).map((point) => `      - {x: ${point.x}, y: 0, z: ${point.z}}`).join('\n');
      return `${base}\n    gateQueuePathShape: ${container.gateQueuePathShape}\n    gateQueueLocked: ${container.gateQueueLocked ? 1 : 0}\n    gateQueueGap: ${container.gateQueueGap}\n    gateQueuePathPoints:\n${points || '      []'}`;
    }
    if (container.type === CONTAINER_TYPES.ELEVATOR) return `${base}\n    elevatorSize: {x: ${container.width}, y: ${container.length}}`;
    return base;
  });
  const mechanisms = (types) => doc.vehicles.filter((vehicle) => types.includes(vehicle.mechanism.type));
  const linkages = renderList(mechanisms(['linkHead']), (vehicle) => `  - vidHead: ${vehicle.id}\n    vidTail: ${vehicle.mechanism.pairVehicleId}\n    distance: ${vehicle.mechanism.distance}`);
  const wrenches = renderList(mechanisms(['wrench']), (vehicle) => `  - vidWrench: ${vehicle.id}\n    vidGear: ${vehicle.mechanism.pairVehicleId}\n    color: ${vehicle.mechanism.wrenchColor}`);
  const combinations = renderList(mechanisms(['combination']), (vehicle) => `  - vid: ${vehicle.id}\n    secondColorIndex: ${vehicle.mechanism.secondColorIndex}`);
  const ambulances = renderList(mechanisms(['ambulance']), (vehicle) => `  - vid: ${vehicle.id}\n    stepLimit: ${vehicle.mechanism.stepLimit}`);
  const firetrucks = renderList(mechanisms(['firetruck']), (vehicle) => `  - vid: ${vehicle.id}\n    timeLimit: ${vehicle.mechanism.timeLimit}`);
  const conveyorBelts = renderList(doc.containers.filter((item) => item.type === CONTAINER_TYPES.CONVEYOR), (container) => `  - vcId: ${container.id}\n    width: ${container.conveyorWidth}`);
  const depths = renderList(Object.entries(doc.vehicleDepthes), ([id, ids]) => `  - vid: ${id}\n    depths: [${ids.join(', ')}]`);
  const passengers = renderList(doc.passengerQueues.flatMap((queue, queueId) => queue.map((colorIndex) => ({ queueId, colorIndex }))), (passenger) => `  - queueId: ${passenger.queueId}\n    colorIndex: ${passenger.colorIndex}`);
  const difficultyMap = { Normal: 0, Hard: 1, SupperHard: 2 };
  const difficulty = difficultyMap[doc.difficulty] ?? (Number.isFinite(Number(doc.difficulty)) ? Number(doc.difficulty) : 0);
  const passengerMethod = doc.passengerMethod === 'FixedSequence' ? 0 : Number(doc.passengerMethod) || 0;
  return `%YAML 1.1\n%TAG !u! tag:unity3d.com,2011:\n--- !u!114 &11400000\nMonoBehaviour:\n  m_ObjectHideFlags: 0\n  m_Name: ${doc.key}\n  id: ${doc.unityId}\n  mapScale: ${doc.mapScale}\n  difficulty: ${difficulty}\n  conveyorBeltName: ${doc.conveyorBeltName}\n  passengerMethod: ${passengerMethod}\n  vehicles:\n${vehicles}\n  containers:\n${containers}\n  vehicleLinkages:\n${linkages}\n  vehicleWrenches:\n${wrenches}\n  vehicleCombinations:\n${combinations}\n  vehicleAmbulances:\n${ambulances}\n  vehicleFiretrucks:\n${firetrucks}\n  conveyorBelts:\n${conveyorBelts}\n  vehicleDepthes:\n${depths}\n  fixedPassengerSequence:\n${passengers}\n`;
}
