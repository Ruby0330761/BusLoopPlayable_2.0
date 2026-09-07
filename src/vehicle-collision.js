const FORWARD_SCAN_LENGTH = 500;
const EPSILON = 0.00001;
export const CONVEYOR_GAP_GUARD_FACTOR = 1.2;

const point = (x = 0, z = 0) => ({ x, z });
const add = (a, b) => point(a.x + b.x, a.z + b.z);
const subtract = (a, b) => point(a.x - b.x, a.z - b.z);
const scale = (value, amount) => point(value.x * amount, value.z * amount);
const dot = (a, b) => a.x * b.x + a.z * b.z;
const magnitude = (value) => Math.hypot(value.x, value.z);

function forwardFromYaw(yawDegrees = 0) {
  const yaw = yawDegrees * Math.PI / 180;
  return point(Math.sin(yaw), Math.cos(yaw));
}

function rightFromForward(forward) {
  return point(forward.z, -forward.x);
}

function normalizeSize(value, fallback = null) {
  if (!value || typeof value !== 'object') return fallback;
  const width = Number(value.width ?? value.x);
  const length = Number(value.length ?? value.z ?? value.depth);
  if (!(width > 0) || !(length > 0)) return fallback;
  return { width, length };
}

function legacyVehicleSize(level) {
  const scaleValue = Number(level.mapScale) || 1;
  const size = normalizeSize(level.vehicleSize, { width: 0.27, length: 0.6785897 });
  return {
    width: size.width / scaleValue,
    length: size.length / scaleValue
  };
}

export function getVehicleCollisionSize(level, vehicle) {
  const collision = level.collision ?? {};
  const sizeKey = vehicle?.collisionSizeKey
    ?? collision.vehicleSizeKeyByColor?.[vehicle?.colorIndex]
    ?? vehicle?.seats;
  return normalizeSize(
    vehicle?.collisionSize
      ?? collision.vehicleSizes?.[sizeKey]
      ?? level.vehicleCollisionSizes?.[sizeKey],
    legacyVehicleSize(level)
  );
}

function getMaximumVehicleSize(level, vehicles) {
  const configured = normalizeSize(level.collision?.maxVehicleSize);
  if (configured) return configured;
  return vehicles.reduce((maximum, vehicle) => {
    const sizeValue = getVehicleCollisionSize(level, vehicle);
    return {
      width: Math.max(maximum.width, sizeValue.width),
      length: Math.max(maximum.length, sizeValue.length)
    };
  }, { width: 0, length: 0 });
}

function makeBox(position, yaw, sizeValue) {
  const forward = forwardFromYaw(yaw);
  return {
    position: point(position.x, position.z),
    yaw,
    size: { ...sizeValue },
    forward,
    right: rightFromForward(forward)
  };
}

function getVehiclePose(vehicle) {
  if (vehicle.state === 'leaving-garage' && vehicle.motionData?.from && vehicle.motionData?.to) {
    const rawProgress = Math.max(0, Math.min(1, Number(vehicle.motion) || 0));
    const progress = rawProgress * rawProgress * (3 - 2 * rawProgress);
    return {
      x: vehicle.motionData.from.x + (vehicle.motionData.to.x - vehicle.motionData.from.x) * progress,
      z: vehicle.motionData.from.z + (vehicle.motionData.to.z - vehicle.motionData.from.z) * progress,
      yaw: vehicle.motionData.from.yaw
        + (vehicle.motionData.to.yaw - vehicle.motionData.from.yaw) * progress
    };
  }
  if (vehicle.state === 'colliding' && vehicle.collision) {
    const forward = forwardFromYaw(vehicle.yaw);
    return {
      x: vehicle.x + forward.x * (vehicle.collision.offset ?? 0),
      z: vehicle.z + forward.z * (vehicle.collision.offset ?? 0),
      yaw: vehicle.yaw
    };
  }
  return vehicle;
}

function boxForVehicle(level, vehicle) {
  const pose = getVehiclePose(vehicle);
  return makeBox(pose, pose.yaw, getVehicleCollisionSize(level, vehicle));
}

function extendBoxForward(box, length = FORWARD_SCAN_LENGTH) {
  const centerOffset = (length - box.size.length) * 0.5;
  return {
    ...box,
    position: add(box.position, scale(box.forward, centerOffset)),
    size: { width: box.size.width, length }
  };
}

function getMinimumVehicleWidth(level, vehicles) {
  let minimum = Infinity;
  for (const vehicle of vehicles ?? []) {
    const width = getVehicleCollisionSize(level, vehicle)?.width;
    if (width > 0) minimum = Math.min(minimum, width);
  }
  if (Number.isFinite(minimum)) return minimum;
  return getVehicleCollisionSize(level, null)?.width ?? 0;
}

function mayBlockForwardSweep(attackerBox, candidateBox) {
  const delta = subtract(candidateBox.position, attackerBox.position);
  const forwardDistance = dot(delta, attackerBox.forward);
  const candidateRadius = Math.hypot(candidateBox.size.width, candidateBox.size.length) * 0.5;
  const minForward = -attackerBox.size.length * 0.5;
  const maxForward = FORWARD_SCAN_LENGTH - attackerBox.size.length * 0.5;
  // The conservative radius is only a gap guard for bodies genuinely ahead
  // of the attacker's front. Overlapping/rear bodies remain governed by SAT.
  if (forwardDistance < attackerBox.size.length * 0.5 - EPSILON) return false;
  if (forwardDistance + candidateRadius < minForward
    || forwardDistance - candidateRadius > maxForward) return false;
  const lateralDistance = Math.max(
    0,
    dot(delta, delta) - forwardDistance * forwardDistance
  );
  const maximumLateralDistance = candidateRadius + attackerBox.size.width * 0.5;
  return lateralDistance <= maximumLateralDistance * maximumLateralDistance;
}

function projectedRadius(box, axis) {
  return Math.abs(dot(box.forward, axis)) * box.size.length * 0.5
    + Math.abs(dot(box.right, axis)) * box.size.width * 0.5;
}

export function boxesOverlap(a, b) {
  const delta = subtract(b.position, a.position);
  return [a.forward, a.right, b.forward, b.right].every((axis) => (
    Math.abs(dot(delta, axis)) <= projectedRadius(a, axis) + projectedRadius(b, axis)
  ));
}

function isGarageType(value) {
  return value === 2 || String(value ?? '').trim().toLowerCase() === 'garage';
}

// Unity's garage visual/collision footprint is intentionally enlarged in the
// playable by one shared factor so the visible shell and blocking volume grow
// together.
export const GARAGE_SIZE_MULTIPLIER = 1.3;

function isConveyorType(value) {
  const normalized = String(value ?? '').trim().toLowerCase();
  return value === 3 || normalized === 'conveyorbelt' || normalized === 'conveyor-belt';
}

export function getGarageCollisionSize(level) {
  const size = normalizeSize(level.collision?.garageSize ?? level.garageCollisionSize);
  if (!size) return null;
  return {
    width: size.width * GARAGE_SIZE_MULTIPLIER,
    length: size.length * GARAGE_SIZE_MULTIPLIER
  };
}

function getConveyorConfig(level) {
  const source = level.collision?.conveyor;
  if (!source) return null;
  const sizeValue = normalizeSize(source.size);
  const exitWidth = Number(source.exitWidth);
  const wallThickness = Number(source.wallThickness);
  if (!sizeValue || !(exitWidth > 0) || !(wallThickness > 0)) return null;
  return { size: sizeValue, exitWidth, wallThickness };
}

function containerPosition(container) {
  return container.position ?? container;
}

function containerYaw(container) {
  return Number(container.yaw ?? container.yawDegrees ?? 0);
}

function projectedBoxRange(box, axis) {
  const radius = projectedRadius(box, axis);
  const center = dot(box.position, axis);
  return { min: center - radius, max: center + radius };
}

function nodeKey(kind, id, role = '') {
  return `${kind}:${id}${role ? `:${role}` : ''}`;
}

class DirectedGraph {
  constructor() {
    this.nodes = new Map();
    this.exits = new Map();
  }

  add(node) {
    if (!this.nodes.has(node.key)) {
      this.nodes.set(node.key, node);
      this.exits.set(node.key, new Set());
    }
    return this.nodes.get(node.key);
  }

  link(from, to) {
    this.add(from);
    this.add(to);
    this.exits.get(from.key).add(to.key);
  }

  get(key) {
    return this.nodes.get(key) ?? null;
  }

  getExits(key) {
    return [...(this.exits.get(key) ?? [])].map((targetKey) => this.nodes.get(targetKey));
  }
}

function createGarageGeometry(level, garage, maximumVehicleSize) {
  const garageSize = getGarageCollisionSize(level);
  if (!garageSize) return null;
  const body = makeBox(garage.position, garage.yaw, garageSize);
  const forward = body.forward;
  const doorPosition = add(
    body.position,
    scale(forward, garageSize.length * 0.5 + maximumVehicleSize.length * 0.5)
  );
  const door = makeBox(doorPosition, garage.yaw, maximumVehicleSize);
  return { body, door, out: extendBoxForward(door) };
}

function collisionLineOffset(rayStart, ray, linePosition, lineDirection) {
  const directionToLine = subtract(linePosition, rayStart);
  const perpendicular = subtract(scale(ray, dot(directionToLine, ray)), directionToLine);
  const perpendicularLength = magnitude(perpendicular);
  if (perpendicularLength <= EPSILON) return 0;
  const directionDot = dot(scale(perpendicular, 1 / perpendicularLength), lineDirection);
  if (Math.abs(directionDot) <= EPSILON) return null;
  return perpendicularLength / directionDot;
}

function clippedEdgeOffset(first, second, limit, sign) {
  let minimum = Math.min(first, second);
  let maximum = Math.max(first, second);
  if (maximum < -limit - EPSILON || minimum > limit + EPSILON) return null;
  minimum = Math.max(minimum, -limit);
  maximum = Math.min(maximum, limit);
  if (Math.abs(sign) < EPSILON) return (minimum + maximum) * 0.5;
  return sign > 0 ? minimum : maximum;
}

function contactAgainstEdge(attackerBox, rayStartA, rayStartB, edgeStart, edgeEnd) {
  const edge = subtract(edgeEnd, edgeStart);
  const edgeLength = magnitude(edge);
  if (edgeLength <= EPSILON) return null;
  const lineDirection = scale(edge, 1 / edgeLength);
  const linePosition = scale(add(edgeStart, edgeEnd), 0.5);
  const first = collisionLineOffset(rayStartA, attackerBox.forward, linePosition, lineDirection);
  const second = collisionLineOffset(rayStartB, attackerBox.forward, linePosition, lineDirection);
  if (first == null || second == null) return null;
  const offset = clippedEdgeOffset(
    first,
    second,
    edgeLength * 0.5,
    dot(attackerBox.forward, lineDirection)
  );
  if (offset == null) return null;
  const position = add(linePosition, scale(lineDirection, offset));
  const distance = Math.max(
    0,
    dot(subtract(position, attackerBox.position), attackerBox.forward) - attackerBox.size.length * 0.5
  );
  return { distance, position };
}

function isForwardObstacle(attackerBox, candidateBox) {
  const delta = subtract(candidateBox.position, attackerBox.position);
  const nearestForward = dot(delta, attackerBox.forward)
    - projectedRadius(candidateBox, attackerBox.forward);
  return nearestForward >= attackerBox.size.length * 0.5 - EPSILON;
}

// Close a narrow lateral gap only for a conveyor vehicle's forward exit
// sweep. The returned box is transient; the real vehicle geometry is left
// unchanged for rendering and all ordinary collision paths.
function inflateConveyorGapBox(box, axis, gap) {
  const currentRadius = projectedRadius(box, axis);
  if (!(currentRadius > EPSILON) || !(gap > 0)) return box;
  const factor = (currentRadius + gap + EPSILON) / currentRadius;
  return {
    ...box,
    size: {
      width: box.size.width * factor,
      length: box.size.length * factor
    }
  };
}

function projectedFallbackContact(attackerBox, candidateBox) {
  const delta = subtract(candidateBox.position, attackerBox.position);
  const forwardDistance = dot(delta, attackerBox.forward);
  const lateralDistance = dot(delta, attackerBox.right);
  const candidateForwardRadius = projectedRadius(candidateBox, attackerBox.forward);
  const candidateLateralRadius = projectedRadius(candidateBox, attackerBox.right);
  const lateralLimit = attackerBox.size.width * 0.5 + candidateLateralRadius;
  if (Math.abs(lateralDistance) > lateralLimit + EPSILON) return null;
  const distance = Math.max(
    0,
    forwardDistance - attackerBox.size.length * 0.5 - candidateForwardRadius
  );
  const contactForward = attackerBox.size.length * 0.5 + distance;
  const contactLateral = Math.max(
    -attackerBox.size.width * 0.5,
    Math.min(attackerBox.size.width * 0.5, lateralDistance)
  );
  return {
    distance,
    position: add(
      add(attackerBox.position, scale(attackerBox.forward, contactForward)),
      scale(attackerBox.right, contactLateral)
    )
  };
}

function corners(box) {
  const halfRight = scale(box.right, box.size.width * 0.5);
  const halfForward = scale(box.forward, box.size.length * 0.5);
  return [
    subtract(subtract(box.position, halfRight), halfForward),
    add(subtract(box.position, halfForward), halfRight),
    add(add(box.position, halfRight), halfForward),
    add(subtract(box.position, halfRight), halfForward)
  ];
}

export function findCollisionContact(level, attacker, candidates) {
  const attackerBox = boxForVehicle(level, attacker);
  const frontCenter = add(attackerBox.position, scale(attackerBox.forward, attackerBox.size.length * 0.5));
  const halfRight = scale(attackerBox.right, attackerBox.size.width * 0.5);
  const rayStartA = subtract(frontCenter, halfRight);
  const rayStartB = add(frontCenter, halfRight);
  const sorted = [...candidates].sort((a, b) => (
    dot(subtract(a.box.position, attackerBox.position), attackerBox.forward)
    - dot(subtract(b.box.position, attackerBox.position), attackerBox.forward)
  ));
  let best = null;
  for (const candidate of sorted) {
    const candidateCorners = corners(candidate.box);
    for (let index = 0; index < candidateCorners.length; index += 1) {
      const contact = contactAgainstEdge(
        attackerBox,
        rayStartA,
        rayStartB,
        candidateCorners[index],
        candidateCorners[(index + 1) % candidateCorners.length]
      );
      if (contact && (!best || contact.distance < best.distance)) best = { ...contact, candidate };
    }
    if (!best || best.candidate !== candidate) {
      const fallback = projectedFallbackContact(attackerBox, candidate.box);
      if (fallback && (!best || fallback.distance < best.distance)) {
        best = { ...fallback, candidate };
      }
    }
  }
  return best;
}

export class VehicleCollisionContext {
  constructor(level) {
    this.level = level;
    this.graph = new DirectedGraph();
    this.vehicleNodes = new Map();
    this.garageNodes = new Map();
    this.conveyors = new Map();
    this.signature = null;
  }

  getStateSignature(game) {
    const vehicleState = (game.vehicles ?? []).map((vehicle) => [
      vehicle.id,
      vehicle.state,
      vehicle.x,
      vehicle.z,
      vehicle.yaw,
      ['colliding', 'leaving-garage'].includes(vehicle.state) ? vehicle.motion : null,
      vehicle.collision?.offset ?? null,
      vehicle.garageId ?? null
    ]);
    const garageState = (game.mechanicState?.garages ?? []).map((garage) => [
      garage.id,
      garage.hidden,
      garage.exitingVehicleId,
      garage.lastOutVehicleId,
      ...garage.vehicleIds
    ]);
    return JSON.stringify([game.resetVersion, vehicleState, garageState]);
  }

  ensure(game) {
    const signature = this.getStateSignature(game);
    if (signature !== this.signature) this.rebuild(game, signature);
    return this;
  }

  rebuild(game, signature = this.getStateSignature(game)) {
    this.graph = new DirectedGraph();
    this.vehicleNodes = new Map();
    this.garageNodes = new Map();
    this.conveyors = new Map();
    const vehicles = game.vehicles ?? [];
    const conveyorConfig = getConveyorConfig(this.level);
    const physicalVehicles = vehicles.filter((vehicle) => ['parked', 'colliding'].includes(vehicle.state));

    for (const vehicle of vehicles) {
      const node = this.graph.add({
        key: nodeKey('vehicle', vehicle.id),
        kind: 'vehicle',
        vehicleId: vehicle.id
      });
      this.vehicleNodes.set(vehicle.id, node);
    }

    for (const attacker of physicalVehicles) {
      // Conveyor vehicles use the belt range resolver below for their own
      // exits. They still need ordinary graph links to non-conveyor vehicles.
      if (conveyorConfig && isConveyorType(attacker.containerType)) continue;
      const attackerNode = this.vehicleNodes.get(attacker.id);
      const scanBox = extendBoxForward(boxForVehicle(this.level, attacker));
      for (const candidate of physicalVehicles) {
        if (candidate.id === attacker.id) continue;
        if (conveyorConfig
          && isConveyorType(attacker.containerType)
          && isConveyorType(candidate.containerType)) continue;
        if (boxesOverlap(scanBox, boxForVehicle(this.level, candidate))) {
          this.graph.link(attackerNode, this.vehicleNodes.get(candidate.id));
        }
      }
    }

    this.buildGarageGraph(game, physicalVehicles);
    if (conveyorConfig) this.buildConveyorContexts(game, physicalVehicles, conveyorConfig);
    this.signature = signature;
    return this;
  }

  buildGarageGraph(game, physicalVehicles) {
    const garages = game.mechanicState?.garages ?? [];
    const maximumVehicleSize = getMaximumVehicleSize(this.level, game.vehicles ?? []);
    const activeGarages = [];

    for (const garage of garages) {
      if (garage.hidden && garage.vehicleIds.length === 0 && garage.exitingVehicleId == null) continue;
      const geometry = createGarageGeometry(this.level, garage, maximumVehicleSize);
      if (!geometry) continue;
      const nodes = {};
      for (const role of ['head', 'tail', 'door', 'out', 'body']) {
        nodes[role] = this.graph.add({
          key: nodeKey('garage', garage.id, role),
          kind: 'garage',
          containerId: garage.id,
          role,
          box: geometry[role] ?? null
        });
      }
      this.graph.link(nodes.head, nodes.door);
      this.graph.link(nodes.head, nodes.out);
      this.graph.link(nodes.body, nodes.tail);
      this.garageNodes.set(garage.id, { garage, geometry, nodes });
      activeGarages.push({ garage, geometry, nodes });

      for (const vehicle of physicalVehicles) {
        this.linkVehicleToGarage(vehicle, nodes, geometry);
      }

      let lastNode = nodes.head;
      for (const vehicleId of garage.vehicleIds) {
        if (vehicleId === garage.exitingVehicleId) continue;
        const vehicleNode = this.vehicleNodes.get(vehicleId);
        if (!vehicleNode) continue;
        this.graph.link(vehicleNode, lastNode);
        lastNode = vehicleNode;
      }
      this.graph.link(nodes.tail, lastNode);

      if (garage.exitingVehicleId != null) {
        const exitingNode = this.vehicleNodes.get(garage.exitingVehicleId);
        if (exitingNode) {
          this.graph.link(nodes.door, exitingNode);
          this.graph.link(exitingNode, nodes.out);
        }
      }
    }

    for (const current of activeGarages) {
      for (const other of activeGarages) {
        if (current === other) continue;
        if (boxesOverlap(other.geometry.body, current.geometry.door)) {
          this.graph.link(current.nodes.door, other.nodes.body);
        }
        if (boxesOverlap(other.geometry.body, current.geometry.out)) {
          this.graph.link(current.nodes.out, other.nodes.body);
        }
        if (boxesOverlap(other.geometry.door, current.geometry.out)) {
          this.graph.link(current.nodes.out, other.nodes.door);
        }
      }
    }
  }

  linkVehicleToGarage(vehicle, nodes, geometry) {
    const vehicleNode = this.vehicleNodes.get(vehicle.id);
    const vehicleBox = boxForVehicle(this.level, vehicle);
    if (boxesOverlap(vehicleBox, geometry.door)) {
      this.graph.link(nodes.door, vehicleNode);
      return;
    }
    const scanBox = extendBoxForward(vehicleBox);
    let hitsDoor = boxesOverlap(scanBox, geometry.door);
    let hitsBody = boxesOverlap(scanBox, geometry.body);
    if (hitsDoor && hitsBody) {
      const doorDistance = dot(vehicleBox.forward, subtract(geometry.door.position, vehicleBox.position));
      const bodyDistance = dot(vehicleBox.forward, subtract(geometry.body.position, vehicleBox.position));
      if (doorDistance <= bodyDistance) hitsBody = false;
      else hitsDoor = false;
    }
    if (hitsDoor) {
      this.graph.link(vehicleNode, nodes.door);
      return;
    }
    if (hitsBody) {
      this.graph.link(vehicleNode, nodes.body);
      return;
    }
    if (boxesOverlap(vehicleBox, geometry.out)) {
      this.graph.link(nodes.out, vehicleNode);
    }
  }

  buildConveyorContexts(game, physicalVehicles, config) {
    const maximumVehicleSize = getMaximumVehicleSize(this.level, game.vehicles ?? []);
    const minimumVehicleWidth = getMinimumVehicleWidth(this.level, game.vehicles ?? []);
    const gapGuard = minimumVehicleWidth * CONVEYOR_GAP_GUARD_FACTOR;
    const containers = (this.level.containers ?? []).filter((container) => isConveyorType(container.type));
    for (const container of containers) {
      const position = containerPosition(container);
      const yaw = containerYaw(container);
      const exitBox = makeBox(position, yaw, {
        width: config.exitWidth,
        length: config.size.length
      });
      const right = exitBox.right;
      const viewRange = projectedBoxRange(exitBox, right);
      const obstacles = [];

      for (const vehicle of physicalVehicles) {
        if (isConveyorType(vehicle.containerType)) continue;
        if (!game.isVehicleBlocking(vehicle, null)) continue;
        const box = boxForVehicle(this.level, vehicle);
        const range = projectedBoxRange(box, right);
        if (range.min < viewRange.max && range.max > viewRange.min) {
          obstacles.push({
            ...range,
            candidate: { type: 'vehicle', id: vehicle.id, vehicle, box }
          });
        }
      }
      // Conveyor vehicles move on the same authored lane and therefore do
      // not participate in the ordinary vehicle graph. They still occupy a
      // live collision slot for every other vehicle on this conveyor.
      for (const vehicle of game.vehicles ?? []) {
        if (vehicle.containerType == null
          || !isConveyorType(vehicle.containerType)
          || Number(vehicle.containerId) !== Number(container.id)
          || !game.isVehicleBlocking(vehicle, null)) continue;
        const box = boxForVehicle(this.level, vehicle);
        const range = projectedBoxRange(box, right);
        if (range.min < viewRange.max && range.max > viewRange.min) {
          obstacles.push({
            ...range,
            candidate: { type: 'vehicle', id: vehicle.id, vehicle, box },
            conveyorVehicle: true
          });
        }
      }
      for (const { garage, geometry } of this.garageNodes.values()) {
        const range = projectedBoxRange(geometry.body, right);
        if (range.min < viewRange.max && range.max > viewRange.min) {
          obstacles.push({
            ...range,
            candidate: {
              type: 'container',
              id: garage.id,
              role: 'body',
              box: geometry.body
            }
          });
        }
      }
      obstacles.sort((a, b) => a.min - b.min);

      let cursor = viewRange.min;
      let hasGlobalExit = false;
      for (const obstacle of obstacles) {
        if (obstacle.min > cursor + maximumVehicleSize.width) {
          hasGlobalExit = true;
          break;
        }
        cursor = Math.max(cursor, obstacle.max);
      }
      if (!hasGlobalExit) hasGlobalExit = viewRange.max > cursor + maximumVehicleSize.width;

      const forward = exitBox.forward;
      const wallBox = makeBox(
        add(
          point(position.x, position.z),
          scale(forward, (config.size.length - config.wallThickness) * 0.5)
        ),
        yaw,
        { width: config.size.width, length: config.wallThickness }
      );
      const head = this.graph.add({
        key: nodeKey('conveyor', container.id, 'head'),
        kind: 'conveyor',
        containerId: container.id,
        role: 'head'
      });
      if (!hasGlobalExit) {
        this.graph.link(head, this.graph.add({
          key: nodeKey('conveyor', container.id, 'block'),
          kind: 'conveyor',
          containerId: container.id,
          role: 'block'
        }));
      }
      for (const vehicle of game.vehicles ?? []) {
        if (!isConveyorType(vehicle.containerType) || Number(vehicle.containerId) !== Number(container.id)) continue;
        this.graph.link(this.vehicleNodes.get(vehicle.id), head);
      }
      this.conveyors.set(container.id, {
        container,
        right,
        viewRange,
        gapGuard,
        obstacles,
        wallBox,
        hasGlobalExit,
        slotCount: Math.max(
          1,
          ...((game.vehicles ?? [])
            .filter((vehicle) => isConveyorType(vehicle.containerType)
              && Number(vehicle.containerId) === Number(container.id))
            .map((vehicle) => Number(vehicle.conveyorIndex) + 1)
            .filter((value) => Number.isFinite(value)))
        )
      });
    }
  }

  getConveyorEntry(vehicle) {
    if (!isConveyorType(vehicle?.containerType)) return null;
    return this.conveyors.get(Number(vehicle.containerId)) ?? this.conveyors.get(vehicle.containerId) ?? null;
  }

  getConveyorRange(vehicle, entry) {
    const range = projectedBoxRange(boxForVehicle(this.level, vehicle), entry.right);
    return range.min < entry.viewRange.max && range.max > entry.viewRange.min ? range : null;
  }

  canConveyorVehicleDriveOut(vehicle, entry) {
    if (!entry.hasGlobalExit) return false;
    const range = this.getConveyorRange(vehicle, entry);
    if (!range || range.min < entry.viewRange.min || range.max > entry.viewRange.max) return false;
    const hasDirectObstacle = entry.obstacles.some((obstacle) => (
      obstacle.candidate?.id !== vehicle.id
      && obstacle.min < range.max
      && obstacle.max > range.min
    ));
    if (hasDirectObstacle) return false;
    return this.getConveyorGapCandidates(vehicle, entry, range).length === 0;
  }

  getConveyorGapCandidates(vehicle, entry, range) {
    if (!(entry.gapGuard > EPSILON)) return [];
    const attackerBox = boxForVehicle(this.level, vehicle);
    const obstacles = entry.obstacles
      .filter((obstacle) => obstacle.candidate?.id !== vehicle.id)
      .sort((a, b) => a.min - b.min);
    const candidates = [];
    for (let index = 0; index + 1 < obstacles.length; index += 1) {
      const first = obstacles[index];
      const second = obstacles[index + 1];
      const gap = second.min - first.max;
      if (!(gap > EPSILON && gap < entry.gapGuard - EPSILON)) continue;
      // The attacker's lateral footprint must actually pass through this
      // corridor; unrelated narrow spaces elsewhere on the belt do not block.
      if (range.max <= first.max + EPSILON || range.min >= second.min - EPSILON) continue;
      const forwardObstacles = [first, second]
        .filter((obstacle) => obstacle.candidate?.box && isForwardObstacle(attackerBox, obstacle.candidate.box))
        .sort((a, b) => {
          const aDistance = dot(
            subtract(a.candidate.box.position, attackerBox.position),
            attackerBox.forward
          ) - projectedRadius(a.candidate.box, attackerBox.forward);
          const bDistance = dot(
            subtract(b.candidate.box.position, attackerBox.position),
            attackerBox.forward
          ) - projectedRadius(b.candidate.box, attackerBox.forward);
          return aDistance - bDistance;
        });
      const nearest = forwardObstacles[0];
      if (!nearest) continue;
      const forwardDistance = dot(
        subtract(nearest.candidate.box.position, attackerBox.position),
        attackerBox.forward
      ) - projectedRadius(nearest.candidate.box, attackerBox.forward);
      candidates.push({
        candidate: nearest.candidate,
        box: inflateConveyorGapBox(nearest.candidate.box, entry.right, gap),
        forwardDistance
      });
    }
    candidates.sort((a, b) => a.forwardDistance - b.forwardDistance);
    if (candidates.length === 0) return [];
    return [{
      ...candidates[0].candidate,
      box: candidates[0].box,
      conveyorGapGuard: true
    }];
  }

  getConveyorCollisionCandidates(vehicle, entry) {
    const range = this.getConveyorRange(vehicle, entry);
    if (!range || range.min < entry.viewRange.min || range.max > entry.viewRange.max) {
      return [{
        type: 'container',
        id: entry.container.id,
        role: 'wall',
        box: entry.wallBox
      }];
    }
    const currentCenter = (range.min + range.max) * 0.5;
    const overlapping = entry.obstacles
      .filter((obstacle) => (
        obstacle.candidate?.id !== vehicle.id
        && obstacle.min < range.max
        && obstacle.max > range.min
      ))
      .sort((a, b) => {
        const overlapStart = Math.max(a.min, range.min);
        const otherOverlapStart = Math.max(b.min, range.min);
        const aCenter = (a.min + a.max) * 0.5;
        const bCenter = (b.min + b.max) * 0.5;
        const currentIndex = Number.isInteger(vehicle.conveyorIndex) ? vehicle.conveyorIndex : null;
        const slotCount = Math.max(1, Number(entry.slotCount) || 1);
        const aIndex = Number.isInteger(a.candidate?.vehicle?.conveyorIndex)
          ? a.candidate.vehicle.conveyorIndex
          : null;
        const bIndex = Number.isInteger(b.candidate?.vehicle?.conveyorIndex)
          ? b.candidate.vehicle.conveyorIndex
          : null;
        const aSlotDistance = currentIndex !== null && aIndex !== null
          ? (aIndex - currentIndex + slotCount) % slotCount || slotCount
          : null;
        const bSlotDistance = currentIndex !== null && bIndex !== null
          ? (bIndex - currentIndex + slotCount) % slotCount || slotCount
          : null;
        if (aSlotDistance !== null && bSlotDistance !== null && aSlotDistance !== bSlotDistance) {
          return aSlotDistance - bSlotDistance;
        }
        const aAhead = aCenter >= currentCenter - EPSILON ? 0 : 1;
        const bAhead = bCenter >= currentCenter - EPSILON ? 0 : 1;
        return aAhead - bAhead
          || (aAhead === 0 ? aCenter - bCenter : bCenter - aCenter)
          || overlapStart - otherOverlapStart
          || a.min - b.min;
    });
    if (overlapping.length > 0) return [overlapping[0].candidate];
    return this.getConveyorGapCandidates(vehicle, entry, range);
  }

  getDirectVehicleCandidates(game, vehicle) {
    if (!vehicle || isConveyorType(vehicle.containerType)) return [];
    const attackerBox = boxForVehicle(this.level, vehicle);
    const scanBox = extendBoxForward(attackerBox);
    const result = [];
    for (const candidate of game.vehicles ?? []) {
      if (candidate.id === vehicle.id
        || !['parked', 'colliding'].includes(candidate.state)
        || !game.isVehicleBlocking(candidate, vehicle)) continue;
      const candidateBox = boxForVehicle(this.level, candidate);
      const exactSweep = boxesOverlap(scanBox, candidateBox);
      if (!exactSweep && !mayBlockForwardSweep(attackerBox, candidateBox)) continue;
      result.push({
        type: 'vehicle',
        id: candidate.id,
        vehicle: candidate,
        box: candidateBox,
        conservativeSweep: !exactSweep
      });
    }
    const conservative = result.filter((candidate) => candidate.conservativeSweep);
    if (conservative.length < 2) return result.filter((candidate) => !candidate.conservativeSweep);
    return result;
  }

  isDriveOutLeaf(node, game, visited = new Set()) {
    if (!node || visited.has(node.key)) return true;
    visited.add(node.key);
    for (const exitNode of this.graph.getExits(node.key)) {
      if (exitNode.kind === 'vehicle') {
        const candidate = game.getVehicle(exitNode.vehicleId);
        if (!candidate) continue;
        if (['in-garage', 'leaving-garage'].includes(candidate.state)) return false;
        if (['parked', 'colliding'].includes(candidate.state)
          && game.isVehicleBlocking(candidate, game.getVehicle(node.vehicleId))) return false;
        continue;
      }
      if (!this.isDriveOutLeaf(exitNode, game, visited)) return false;
    }
    return true;
  }

  collectCandidates(node, game, result = [], visited = new Set()) {
    if (!node || visited.has(node.key)) return result;
    visited.add(node.key);
    for (const exitNode of this.graph.getExits(node.key)) {
      if (exitNode.kind === 'vehicle') {
        const candidate = game.getVehicle(exitNode.vehicleId);
        if (candidate && ['parked', 'colliding'].includes(candidate.state)
          && game.isVehicleBlocking(candidate, game.getVehicle(node.vehicleId))) {
          result.push({
            type: 'vehicle',
            id: candidate.id,
            vehicle: candidate,
            box: boxForVehicle(this.level, candidate)
          });
        }
        continue;
      }
      if (exitNode.kind === 'garage' && exitNode.role === 'body') {
        result.push({
          type: 'container',
          id: exitNode.containerId,
          role: 'body',
          box: exitNode.box
        });
        continue;
      }
      if (exitNode.kind === 'garage' && exitNode.role === 'door') {
        const doorVehicleExits = this.graph.getExits(exitNode.key).filter((item) => item.kind === 'vehicle');
        if (doorVehicleExits.length > 0) {
          for (const vehicleExit of doorVehicleExits) {
            const candidate = game.getVehicle(vehicleExit.vehicleId);
            if (!candidate || !game.isVehicleBlocking(candidate, game.getVehicle(node.vehicleId))) continue;
            result.push({
              type: 'vehicle',
              id: candidate.id,
              vehicle: candidate,
              box: boxForVehicle(this.level, candidate)
            });
          }
        } else {
          result.push({
            type: 'container',
            id: exitNode.containerId,
            role: 'door',
            box: exitNode.box
          });
        }
        continue;
      }
      this.collectCandidates(exitNode, game, result, visited);
    }
    return result;
  }

  getCollisionCandidates(game, vehicleId) {
    this.ensure(game);
    const vehicle = game.getVehicle(vehicleId);
    const node = this.vehicleNodes.get(vehicleId);
    if (!vehicle || vehicle.state !== 'parked' || !node) return [];
    const conveyor = this.getConveyorEntry(vehicle);
    if (conveyor) return this.getConveyorCollisionCandidates(vehicle, conveyor);
    const candidates = this.collectCandidates(node, game);
    const knownVehicleIds = new Set(
      candidates.filter((candidate) => candidate.type === 'vehicle').map((candidate) => candidate.id)
    );
    const directCandidates = this.getDirectVehicleCandidates(game, vehicle);
    const hasExactCandidate = candidates.length > 0
      || directCandidates.some((candidate) => !candidate.conservativeSweep);
    for (const candidate of directCandidates) {
      if (candidate.conservativeSweep && hasExactCandidate) continue;
      if (knownVehicleIds.has(candidate.id)) continue;
      candidates.push(candidate);
      knownVehicleIds.add(candidate.id);
    }
    return candidates;
  }

  canVehicleDriveOut(game, vehicleId) {
    this.ensure(game);
    const vehicle = game.getVehicle(vehicleId);
    const node = this.vehicleNodes.get(vehicleId);
    const conveyor = this.getConveyorEntry(vehicle);
    if (vehicle?.state === 'parked' && conveyor) {
      return this.canConveyorVehicleDriveOut(vehicle, conveyor);
    }
    if (!vehicle || vehicle.state !== 'parked' || !node) return false;
    return this.getCollisionCandidates(game, vehicleId).length === 0;
  }

  isGarageDoorClear(game, garageId, vehicleId = null) {
    this.ensure(game);
    const entry = this.garageNodes.get(Number(garageId)) ?? this.garageNodes.get(garageId);
    if (!entry) return true;
    const nextVehicle = game.getVehicle(vehicleId ?? entry.garage.vehicleIds[0]);
    const geometry = createGarageGeometry(
      this.level,
      entry.garage,
      getVehicleCollisionSize(this.level, nextVehicle)
    );
    if (!geometry) return true;
    for (const vehicle of game.vehicles ?? []) {
      if (!game.isVehicleBlocking(vehicle, nextVehicle)) continue;
      if (boxesOverlap(geometry.door, boxForVehicle(this.level, vehicle))) return false;
    }
    for (const other of game.mechanicState?.garages ?? []) {
      if (Number(other.id) === Number(garageId) || other.hidden) continue;
      if (other.vehicleIds.length === 0 && other.exitingVehicleId == null) continue;
      const body = makeBox(other.position, other.yaw, getGarageCollisionSize(this.level));
      if (boxesOverlap(geometry.door, body)) return false;
    }
    return true;
  }
}

export function createVehicleCollisionContext(level) {
  return new VehicleCollisionContext(level);
}


