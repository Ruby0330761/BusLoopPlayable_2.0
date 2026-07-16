const clamp01 = (value) => Math.max(0, Math.min(1, value));
const EPSILON = 1e-6;

export const UNITY_VEHICLE_MOTION = Object.freeze({
  turnRadius: 0.5,
  turnInController: 0.25,
  turnOutController: 0.25,
  parkingBounds: { minX: -2.1, maxX: 2.1, minZ: -2.7075, maxZ: 1.9675 },
  stationScaleBySeats: { 4: 1.15, 6: 1.1, 10: 1.1 },
  moveOut: { speedBackward: 2.5, speedForward: 10 },
  hitDuration: 0.5
});

const key = (time, value, inSlope, outSlope, weightedMode = 0, inWeight = 1 / 3, outWeight = 1 / 3) => ({
  time, value, inSlope, outSlope, weightedMode, inWeight, outWeight
});

export const UNITY_CURVES = Object.freeze({
  smoothScale: [key(0, 0, 0, 0), key(1, 1, 0, 0)],
  station2: [
    key(0, 0, 1.3032428, 1.3032428, 2, 0, .15392782),
    key(.28186098, .27368808, .6049988, .6049988, 3, .30336973, .19986926),
    key(1, 1, .9271869, .9271869, 1, .48973098, 0)
  ],
  station5: [
    key(0, 0, 1.6697798, 1.6697798, 2, 0, .1383159),
    key(.24481952, .25914273, .60722464, .60722464, 3, .26059097, .29096454),
    key(1, 1, .93280613, .93280613, 1, .49376464, 0)
  ],
  station12: [
    key(0, 0, 1.4418416, 1.4418416, 2, 0, .17878926),
    key(.21307343, .199367, .6521476, .6521476, 3, .36744636, .24110806),
    key(1, 1, .9472908, .9472908, 1, .45410168, 0)
  ],
  outBackward: [
    key(0, 0, .016594088, .016594088, 2, 0, .097354494),
    key(1, 1, .0027068628, .0027068628, 1, .59682536, 0)
  ],
  outForward: [key(0, 0, 0, 0), key(1, 1, 2, 2)],
  collideShort: [key(0, 0, 2, 2), key(1, 1, 0, 0)],
  collideLong: [
    key(0, 0, 2.7093616, 2.7093616, 2, 0, .3332819),
    key(.6995948, .945431, .47799712, .47799712, 3, .17109992, .380026),
    key(1, 1, .021502407, .021502407, 1, .09625319, 0)
  ],
  collideBackward: [
    key(0, 0, 0, 0, 2, 0, .35026455),
    key(1, 1, 0, 0, 1, .4994709, 0)
  ]
});

export function evaluateUnityCurve(keys, time) {
  if (time <= keys[0].time) return keys[0].value;
  const last = keys[keys.length - 1];
  if (time >= last.time) return last.value;
  let a = keys[0];
  let b = keys[1];
  for (let index = 1; index < keys.length; index += 1) {
    b = keys[index];
    if (time <= b.time) break;
    a = b;
  }
  const duration = b.time - a.time;
  const outWeight = (a.weightedMode & 2) ? a.outWeight : 1 / 3;
  const inWeight = (b.weightedMode & 1) ? b.inWeight : 1 / 3;
  const p0x = a.time;
  const p1x = a.time + duration * outWeight;
  const p2x = b.time - duration * inWeight;
  const p3x = b.time;
  const p0y = a.value;
  const p1y = a.value + a.outSlope * duration * outWeight;
  const p2y = b.value - b.inSlope * duration * inWeight;
  const p3y = b.value;
  let low = 0;
  let high = 1;
  for (let index = 0; index < 18; index += 1) {
    const u = (low + high) * .5;
    const x = cubic(p0x, p1x, p2x, p3x, u);
    if (x < time) low = u; else high = u;
  }
  return cubic(p0y, p1y, p2y, p3y, (low + high) * .5);
}

function cubic(a, b, c, d, t) {
  const it = 1 - t;
  return it * it * it * a + 3 * it * it * t * b + 3 * it * t * t * c + t * t * t * d;
}

const point = (x, z) => ({ x, z });
const add = (a, b) => point(a.x + b.x, a.z + b.z);
const sub = (a, b) => point(a.x - b.x, a.z - b.z);
const mul = (a, scalar) => point(a.x * scalar, a.z * scalar);
const length = (a) => Math.hypot(a.x, a.z);
const normalize = (a) => {
  const value = length(a);
  return value < EPSILON ? point(0, 0) : mul(a, 1 / value);
};
const dot = (a, b) => a.x * b.x + a.z * b.z;
const cross = (a, b) => a.x * b.z - a.z * b.x;
export const forwardFromYaw = (yawDegrees) => {
  const yaw = yawDegrees * Math.PI / 180;
  return point(Math.sin(yaw), Math.cos(yaw));
};

function appendDistinct(points, value) {
  const previous = points.at(-1);
  if (!previous || Math.abs(previous.x - value.x) > EPSILON || Math.abs(previous.z - value.z) > EPSILON) {
    points.push(value);
  }
}

function rayBox(start, direction, bounds) {
  const hits = [];
  const addHit = (distance, x, z, edge) => {
    if (distance >= -EPSILON && x >= bounds.minX - EPSILON && x <= bounds.maxX + EPSILON
      && z >= bounds.minZ - EPSILON && z <= bounds.maxZ + EPSILON) hits.push({ distance, point: point(x, z), edge });
  };
  if (Math.abs(direction.z) > EPSILON) {
    let distance = (bounds.minZ - start.z) / direction.z;
    addHit(distance, start.x + direction.x * distance, bounds.minZ, 1);
    distance = (bounds.maxZ - start.z) / direction.z;
    addHit(distance, start.x + direction.x * distance, bounds.maxZ, 0);
  }
  if (Math.abs(direction.x) > EPSILON) {
    let distance = (bounds.minX - start.x) / direction.x;
    addHit(distance, bounds.minX, start.z + direction.z * distance, 2);
    distance = (bounds.maxX - start.x) / direction.x;
    addHit(distance, bounds.maxX, start.z + direction.z * distance, 3);
  }
  return hits.sort((a, b) => a.distance - b.distance)[0];
}

function lineIntersection(a, directionA, b, directionB) {
  const denominator = cross(directionA, directionB);
  if (Math.abs(denominator) < EPSILON) return point(b.x, a.z);
  const distance = cross(sub(b, a), directionB) / denominator;
  return add(a, mul(directionA, distance));
}

export function buildToStationPoints(vehicle, spot, motion = UNITY_VEHICLE_MOTION) {
  const base = motion.parkingBounds ?? UNITY_VEHICLE_MOTION.parkingBounds;
  const bounds = {
    minX: Math.min(base.minX, vehicle.x - .1), maxX: Math.max(base.maxX, vehicle.x + .1),
    minZ: Math.min(base.minZ, vehicle.z - .1), maxZ: Math.max(base.maxZ, vehicle.z + .1)
  };
  const start = point(vehicle.x, vehicle.z);
  const direction = normalize(forwardFromYaw(vehicle.yaw));
  const hit = rayBox(start, direction, bounds);
  const boxStart = hit?.point ?? start;
  const boxTL = point(bounds.minX, bounds.maxZ);
  const boxTR = point(bounds.maxX, bounds.maxZ);
  const boxBL = point(bounds.minX, bounds.minZ);
  const boxBR = point(bounds.maxX, bounds.minZ);
  const spotDirection = normalize(forwardFromYaw(spot.yaw ?? 180));
  const outBound = lineIntersection(boxTL, point(1, 0), spot, spotDirection);
  const points = [];
  appendDistinct(points, start);
  appendDistinct(points, boxStart);
  if (hit?.edge === 1) {
    if (boxStart.x + outBound.x - 2 * boxTL.x > 2 * boxTR.x - boxStart.x - outBound.x) {
      appendDistinct(points, boxBR); appendDistinct(points, boxTR);
    } else {
      appendDistinct(points, boxBL); appendDistinct(points, boxTL);
    }
  } else if (hit?.edge === 2) appendDistinct(points, boxTL);
  else if (hit?.edge === 3) appendDistinct(points, boxTR);
  appendDistinct(points, outBound);
  appendDistinct(points, point(spot.x, spot.z));
  return points;
}

export function buildOutStationPoints(spot, motion = UNITY_VEHICLE_MOTION) {
  const start = point(spot.x, spot.z);
  const turnOffsetX = motion.exitTurnOffsetX ?? -UNITY_VEHICLE_MOTION.turnRadius;
  if (Number.isFinite(spot.approachX) && Number.isFinite(spot.approachZ)) {
    const boxPosition = point(spot.approachX, spot.approachZ);
    return [start, boxPosition, add(boxPosition, point(turnOffsetX, 0))];
  }
  if (Number.isFinite(spot.approachZ)) {
    const boxPosition = point(spot.x, spot.approachZ);
    return [start, boxPosition, add(boxPosition, point(turnOffsetX, 0))];
  }
  if (Number.isFinite(motion.backDistance)) {
    const backward = mul(normalize(forwardFromYaw(spot.yaw ?? 180)), -motion.backDistance);
    const boxPosition = add(start, backward);
    return [start, boxPosition, add(boxPosition, point(turnOffsetX, 0))];
  }
  const bounds = UNITY_VEHICLE_MOTION.parkingBounds;
  const topLeft = point(bounds.minX, bounds.maxZ);
  const backward = mul(normalize(forwardFromYaw(spot.yaw ?? 180)), -1);
  const boxPosition = lineIntersection(topLeft, point(1, 0), start, backward);
  return [start, boxPosition, add(boxPosition, point(turnOffsetX, 0))];
}

export function buildRoundedPath(points, motion = UNITY_VEHICLE_MOTION) {
  const segments = [];
  let start = points[0];
  const addLine = (a, b) => {
    const distance = length(sub(b, a));
    if (distance > EPSILON) segments.push({ type: 'line', p0: a, p1: b, length: distance });
  };
  for (let index = 1; index < points.length - 1; index += 1) {
    const turn = points[index];
    const end = points[index + 1];
    const inVector = sub(start, turn);
    const outVector = sub(end, turn);
    const inLength = length(inVector);
    const outLength = length(outVector);
    if (inLength < EPSILON || outLength < EPSILON) continue;
    const inDirection = mul(inVector, 1 / inLength);
    const outDirection = mul(outVector, 1 / outLength);
    const radius = Math.min(inLength, motion.turnRadius ?? UNITY_VEHICLE_MOTION.turnRadius, outLength * .5);
    const turnStart = add(turn, mul(inDirection, radius));
    const turnEnd = add(turn, mul(outDirection, radius));
    addLine(start, turnStart);
    const c1 = add(turnStart, mul(inDirection, -Math.min(motion.turnInController ?? UNITY_VEHICLE_MOTION.turnInController, radius)));
    const c2 = add(turnEnd, mul(outDirection, -Math.min(motion.turnOutController ?? UNITY_VEHICLE_MOTION.turnOutController, radius)));
    const baked = bakeCubic(turnStart, c1, c2, turnEnd, 64);
    segments.push({ type: 'cubic', p0: turnStart, c1, c2, p1: turnEnd, ...baked });
    start = turnEnd;
  }
  addLine(start, points.at(-1));
  const totalLength = segments.reduce((sum, segment) => sum + segment.length, 0);
  return { segments, length: totalLength };
}

function bakeCubic(p0, c1, c2, p1, sampleRate) {
  const samples = [];
  let total = 0;
  let previous = p0;
  for (let index = 0; index < sampleRate; index += 1) {
    const t = (index + 1) / sampleRate;
    const next = point(cubic(p0.x, c1.x, c2.x, p1.x, t), cubic(p0.z, c1.z, c2.z, p1.z, t));
    const delta = sub(next, previous);
    const segmentLength = length(delta);
    samples.push({ distance: total, point: previous, tangent: normalize(delta), segmentLength });
    total += segmentLength;
    previous = next;
  }
  return { samples, length: total };
}

export function evaluatePath(path, distance) {
  let remaining = Math.max(0, Math.min(path.length, distance));
  let segment = path.segments.at(-1);
  for (const candidate of path.segments) {
    segment = candidate;
    if (remaining <= candidate.length) break;
    remaining -= candidate.length;
  }
  if (!segment) return { position: point(0, 0), tangent: point(0, 1) };
  if (segment.type === 'line') {
    const tangent = normalize(sub(segment.p1, segment.p0));
    return { position: add(segment.p0, mul(tangent, Math.min(remaining, segment.length))), tangent };
  }
  if (remaining >= segment.length) {
    const sample = segment.samples.at(-1);
    return { position: segment.p1, tangent: sample.tangent };
  }
  const sample = segment.samples.find((entry) => remaining < entry.distance + entry.segmentLength) ?? segment.samples.at(-1);
  return { position: add(sample.point, mul(sample.tangent, remaining - sample.distance)), tangent: sample.tangent };
}

const STATION_CONFIG = [
  { distance: 2, speed: [3, 6], curve: UNITY_CURVES.station2 },
  { distance: 5, speed: [6, 9], curve: UNITY_CURVES.station5 },
  { distance: 12, speed: [9, 12], curve: UNITY_CURVES.station12 }
];

export function getStationMotion(pathLength) {
  let previousDistance = 0;
  let config = STATION_CONFIG.at(-1);
  for (let index = 0; index < STATION_CONFIG.length - 1; index += 1) {
    if (STATION_CONFIG[index].distance >= pathLength) { config = STATION_CONFIG[index]; break; }
    previousDistance = STATION_CONFIG[index].distance;
  }
  const ratio = (pathLength - previousDistance) / Math.max(EPSILON, config.distance - previousDistance);
  const speed = config.speed[0] + (config.speed[1] - config.speed[0]) * ratio;
  return { duration: pathLength / speed, curve: config.curve };
}

const COLLISION_CONFIG = [
  { distance: .1, forwardSpeed: [5, 6], delay: .05, backwardSpeed: [3, 8], curve: UNITY_CURVES.collideShort },
  { distance: 1, forwardSpeed: [6, 15], delay: .03, backwardSpeed: [3, 8], curve: UNITY_CURVES.collideLong },
  { distance: 4.5, forwardSpeed: [15, 40], delay: .01, backwardSpeed: [8, 15], curve: UNITY_CURVES.collideLong }
];

export function getCollisionMotion(distance) {
  let previousDistance = 0;
  let config = COLLISION_CONFIG.at(-1);
  for (let index = 0; index < COLLISION_CONFIG.length - 1; index += 1) {
    if (COLLISION_CONFIG[index].distance >= distance) { config = COLLISION_CONFIG[index]; break; }
    previousDistance = COLLISION_CONFIG[index].distance;
  }
  const ratio = (distance - previousDistance) / Math.max(EPSILON, config.distance - previousDistance);
  const forwardSpeed = config.forwardSpeed[0] + (config.forwardSpeed[1] - config.forwardSpeed[0]) * ratio;
  const backwardSpeed = config.backwardSpeed[0] + (config.backwardSpeed[1] - config.backwardSpeed[0]) * ratio;
  return {
    distance,
    forwardDuration: Math.max(.001, distance / forwardSpeed),
    backwardDuration: Math.max(.001, distance / backwardSpeed),
    delay: config.delay,
    forwardCurve: config.curve,
    backwardCurve: UNITY_CURVES.collideBackward
  };
}

function projectedHalfExtent(vehicle, axis, size) {
  const forward = forwardFromYaw(vehicle.yaw);
  const right = point(forward.z, -forward.x);
  return Math.abs(dot(axis, right)) * size.width * .5 + Math.abs(dot(axis, forward)) * size.length * .5;
}

export function getCollisionDistance(vehicle, target, size) {
  const forward = forwardFromYaw(vehicle.yaw);
  const centerDelta = point(target.x - vehicle.x, target.z - vehicle.z);
  const centerDistance = dot(centerDelta, forward);
  const selfExtent = size.length * .5;
  const targetExtent = projectedHalfExtent(target, forward, size);
  return Math.max(0, centerDistance - selfExtent - targetExtent);
}

export function getHitDirection(attacker, target) {
  const attackerForward = forwardFromYaw(attacker.yaw);
  const targetForward = forwardFromYaw(target.yaw);
  const targetRight = point(targetForward.z, -targetForward.x);
  return { x: dot(attackerForward, targetRight), y: dot(attackerForward, targetForward) };
}

const scalarKeys = (entries) => entries.map(([time, value, slope]) => key(time, value, slope, slope));
const HIT_POSITION_Y = scalarKeys([[0, 0, 0], [.05, .1505738, -1.3360482], [.15, .04188568, -.7952916], [.25, 0, 0]]);

export const UNITY_HIT_CLIPS = Object.freeze({
  right: {
    rotationAxis: 'z', rotation: scalarKeys([[0, 0, 235.56206], [.1, 8.855473, -194.80673], [.2, -6.975039, 175.2557], [.25, 1.2566481, 124.77239], [.3, 2.5782604, -101.14735], [.4, -1.6602025, 38.60026], [.5, 0, 0]]),
    positionAxis: 'x', position: scalarKeys([[0, 0, 0], [.05, -.05, 0], [.15, .01, 0], [.25, 0, 0]]), positionY: HIT_POSITION_Y
  },
  left: {
    rotationAxis: 'z', rotation: scalarKeys([[0, 0, -262.06903], [.1, -7.741545, 112.22822], [.2, 8.48204, -117.50041], [.25, .80576897, -149.98378], [.3, -2.559671, 54.932926], [.4, 1.664262, -24.947739], [.5, 0, 0]]),
    positionAxis: 'x', position: scalarKeys([[0, 0, 0], [.05, .05, 0], [.15, -.01, 0], [.25, 0, 0]]), positionY: HIT_POSITION_Y
  },
  front: {
    rotationAxis: 'x', rotation: scalarKeys([[0, 0, -291.03757], [.1, -8.572966, 164.6131], [.2, 8.623381, -182.97038], [.3, -2.5353012, 67.91191], [.4, 1.6215609, -28.040445], [.5, 0, 0]]),
    positionAxis: 'z', position: scalarKeys([[0, 0, 0], [.05, -.01, 0], [.15, .01, 0], [.25, 0, 0]]), positionY: HIT_POSITION_Y
  },
  back: {
    rotationAxis: 'x', rotation: scalarKeys([[0, 0, 255.85867], [.1, 8.653927, -275.62015], [.2, -8.339767, 130.85188], [.3, 2.510724, -95.49932], [.4, -1.5714287, 28.19432], [.5, 0, 0]]),
    positionAxis: 'z', position: scalarKeys([[0, 0, 0], [.05, .01, 0], [.15, -.01, 0], [.25, 0, 0]]), positionY: HIT_POSITION_Y
  }
});

export function chooseHitClip(direction) {
  if (Math.abs(direction.x) > Math.abs(direction.y)) return direction.x < 0 ? 'right' : 'left';
  return direction.y < 0 ? 'front' : 'back';
}

export function sampleHitClip(name, elapsed) {
  const clip = UNITY_HIT_CLIPS[name];
  const time = Math.max(0, Math.min(UNITY_VEHICLE_MOTION.hitDuration, elapsed));
  return {
    rotationAxis: clip.rotationAxis,
    rotationDegrees: evaluateUnityCurve(clip.rotation, time),
    positionAxis: clip.positionAxis,
    position: evaluateUnityCurve(clip.position, time),
    positionY: evaluateUnityCurve(clip.positionY, time)
  };
}

