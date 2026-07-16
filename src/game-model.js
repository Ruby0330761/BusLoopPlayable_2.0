import { LEVEL_1 } from './level-data.js';
import { SCENE_TUNING } from './scene-tuning.js';
import {
  UNITY_CURVES,
  UNITY_VEHICLE_MOTION,
  buildOutStationPoints,
  buildRoundedPath,
  buildToStationPoints,
  evaluateUnityCurve,
  getCollisionMotion,
  getHitDirection,
  getStationMotion
} from './vehicle-motion.js';
import {
  createVehicleCollisionContext,
  findCollisionContact
} from './vehicle-collision.js';

const clamp01 = (value) => Math.max(0, Math.min(1, value));
const wrap01 = (value) => ((value % 1) + 1) % 1;
const clampNumber = (value, min, max) => Math.max(min, Math.min(max, value));
const INITIAL_ENTRY_OFFSET_PERCENT = 0.0001;
const PASSENGER_READY_DISTANCE_THRESHOLD = 0.02;

function visualToVehicleAreaPoint(x, z) {
  const area = SCENE_TUNING.vehicleArea;
  const unitScale = area.positionUnitScale ?? LEVEL_1.mapScale;
  const rotation = -(area.rotationDegrees || 0) * Math.PI / 180;
  const dx = x - area.pivotX;
  const dz = z - area.pivotZ;
  const unrotatedX = area.pivotX + dx * Math.cos(rotation) - dz * Math.sin(rotation);
  const unrotatedZ = area.pivotZ + dx * Math.sin(rotation) + dz * Math.cos(rotation);
  const unityX = (unrotatedX - area.offsetX) / area.unityToWorldScale - area.sourceRootX;
  const unityZ = (
    (unrotatedZ - area.offsetZ)
    / (area.unityToWorldScale * (area.mirrorZ ? -1 : 1))
  ) - area.sourceRootZ;
  return {
    x: (unityX - area.positionPivotX) / unitScale + area.positionPivotX,
    z: (unityZ - area.positionPivotZ) / unitScale + area.positionPivotZ
  };
}

function visualYawToVehicleAreaYaw(yawDegrees) {
  const area = SCENE_TUNING.vehicleArea;
  const local = yawDegrees - (area.rotationDegrees || 0);
  return area.mirrorZ ? 180 - local : local;
}

function vehicleForward(vehicle) {
  const yaw = vehicle.yaw * Math.PI / 180;
  return { x: Math.sin(yaw), z: Math.cos(yaw) };
}

function vehicleRight(forward) {
  return { x: forward.z, z: -forward.x };
}

function dot(a, b) {
  return a.x * b.x + a.z * b.z;
}

function makeVehicleBox(vehicle, dimensions, scanForward = false) {
  const forward = vehicleForward(vehicle);
  const right = vehicleRight(forward);
  const length = scanForward ? 500 : dimensions.length;
  const centerOffset = scanForward ? (length - dimensions.length) * 0.5 : 0;
  return {
    center: {
      x: vehicle.x + forward.x * centerOffset,
      z: vehicle.z + forward.z * centerOffset
    },
    forward,
    right,
    halfLength: length * 0.5,
    halfWidth: dimensions.width * 0.5
  };
}

function projectedRadius(box, axis) {
  return Math.abs(dot(box.forward, axis)) * box.halfLength
    + Math.abs(dot(box.right, axis)) * box.halfWidth;
}

function overlapsOnAxis(a, b, axis) {
  const delta = { x: b.center.x - a.center.x, z: b.center.z - a.center.z };
  return Math.abs(dot(delta, axis)) <= projectedRadius(a, axis) + projectedRadius(b, axis);
}

function blocksVehicleExit(attacker, candidate, dimensions) {
  const exitBox = makeVehicleBox(attacker, dimensions, true);
  const candidateBox = makeVehicleBox(candidate, dimensions);
  return [
    exitBox.right,
    exitBox.forward,
    candidateBox.right,
    candidateBox.forward
  ].every((axis) => overlapsOnAxis(exitBox, candidateBox, axis));
}

function projectedHalfWidth(vehicle, dimensions) {
  const forward = vehicleForward(vehicle);
  const right = vehicleRight(forward);
  return Math.abs(forward.x) * dimensions.length * 0.5
    + Math.abs(right.x) * dimensions.width * 0.5;
}

function overlapsScreenColumn(vehicle, candidate, dimensions) {
  return Math.abs(candidate.x - vehicle.x) <= (
    projectedHalfWidth(vehicle, dimensions) + projectedHalfWidth(candidate, dimensions)
  );
}

function getVisualDepth(vehicle) {
  const depthSign = SCENE_TUNING.vehicleArea?.mirrorZ ? -1 : 1;
  return vehicle.z * depthSign;
}

function hasParallelFootprint(vehicle, candidate) {
  return Math.abs(dot(vehicleForward(vehicle), vehicleForward(candidate))) >= 0.7;
}

function getDirectVisualBlocker(vehicle, candidates, dimensions) {
  const vehicleDepth = getVisualDepth(vehicle);
  const maxLocalDepth = Math.max(dimensions.length * 1.75, dimensions.width * 4);
  let target = null;
  for (const candidate of candidates) {
    const depthDelta = getVisualDepth(candidate) - vehicleDepth;
    if (depthDelta <= 1e-6 || depthDelta > maxLocalDepth) continue;
    if (!hasParallelFootprint(vehicle, candidate)) continue;
    if (!overlapsScreenColumn(vehicle, candidate, dimensions)) continue;
    const centerDistance = Math.hypot(candidate.x - vehicle.x, candidate.z - vehicle.z);
    if (
      !target
      || depthDelta > target.depthDelta + 1e-6
      || (Math.abs(depthDelta - target.depthDelta) <= 1e-6 && centerDistance < target.centerDistance)
    ) {
      target = { vehicle: candidate, depthDelta, centerDistance };
    }
  }
  return target?.vehicle ?? null;
}


export class BusLoopGame {
  constructor(level = LEVEL_1) {
    this.level = level;
    this.listeners = new Set();
    this.resetVersion = 0;
    this.reset();
  }

  reset() {
    this.resetVersion += 1;
    this.time = 0;
    this.status = 'playing';
    this.speedMultiplier = 1;
    this.boardingEventId = 0;
    this.boardingEvents = [];
    this.nextPassengerId = 1;
    this.initialFillActive = true;
    this.initialFilledSlotIndices = new Set();
    this.failureConditionStartedAt = null;
    this.conveyorPathLength = Math.max(0.0001, this.level.conveyorPathLength ?? 1);
    const authoredQueues = this.level.passengerQueues ?? [this.level.passengerSequence];
    this.conveyorCapacity = Math.max(1, Math.floor(this.conveyorCapacity ?? this.level.conveyorCapacity));
    this.queueCapacities = authoredQueues.map((_, index) => Math.max(
      0,
      Math.floor(this.queueCapacities?.[index] ?? this.level.queueCapacity)
    ));
    this.entryPercents = [...(this.entryPercents ?? this.level.entryPercents)];
    this.exitStart = this.exitStart ?? this.level.exitStart;
    this.exitEnd = this.exitEnd ?? this.level.exitEnd;
    this.queueSpacing = this.level.passengerQueue?.spacing ?? 0.4;
    this.queueAvailableLengths = authoredQueues.map((_, index) => Math.max(
      0,
      (this.queueCapacities[index] - 1) * this.queueSpacing
    ));
    this.queues = authoredQueues.map((queue, queueIndex) => (
      this.createQueueItems(queue.slice(0, this.queueCapacities[queueIndex]), queueIndex)
    ));
    this.sourceQueues = authoredQueues.map((queue, index) => queue.slice(this.queueCapacities[index]));
    this.vehicles = this.level.vehicles.map((vehicle) => ({
      ...vehicle, state: 'parked', spotIndex: null, boardedGroups: 0, motion: 0,
      motionData: null, collision: null, hit: null
    }));
    const spotCount = SCENE_TUNING.parkingSpots.count ?? this.level.spotCount;
    this.spots = Array.from({ length: spotCount }, (_, index) => ({
      index, vehicleId: null
    }));
    this.slots = Array.from({ length: this.conveyorCapacity }, (_, index) => ({
      index,
      progress: wrap01(index / this.conveyorCapacity),
      previousProgress: wrap01(index / this.conveyorCapacity),
      colorIndex: null,
      entryIndex: null,
      entryMotion: null
    }));
    this.collisionContext = createVehicleCollisionContext(this.level);
    this.lastEvent = { type: 'reset' };
    this.emit();
  }

  initializeQueues(
    queueCapacities = [],
    queueSpacing = this.queueSpacing,
    queueLengths = [],
    conveyorPathLength = this.conveyorPathLength,
    conveyorConfig = {}
  ) {
    const authoredQueues = this.level.passengerQueues ?? [this.level.passengerSequence];
    const nextConveyorCapacity = Math.max(1, Math.floor(conveyorConfig.capacity ?? this.conveyorCapacity));
    const conveyorCapacityChanged = nextConveyorCapacity !== this.conveyorCapacity;
    this.conveyorCapacity = nextConveyorCapacity;
    this.entryPercents = [...(conveyorConfig.entryPercents ?? this.entryPercents)];
    this.exitStart = conveyorConfig.exitStart ?? this.exitStart;
    this.exitEnd = conveyorConfig.exitEnd ?? this.exitEnd;
    this.queueSpacing = Math.max(0.01, queueSpacing ?? this.level.passengerQueue?.spacing ?? 0.4);
    this.conveyorPathLength = Math.max(0.0001, conveyorPathLength ?? this.conveyorPathLength ?? 1);
    this.queueAvailableLengths = authoredQueues.map((_, index) => Math.max(
      0,
      queueLengths[index] ?? ((this.level.queueCapacity - 1) * this.queueSpacing)
    ));
    this.queueCapacities = authoredQueues.map((_, index) => {
      const authoredCapacity = conveyorConfig.queueCapacities?.[index] ?? this.level.queueCapacity;
      return Math.max(0, Math.min(
        Math.floor(authoredCapacity),
        Math.floor(queueCapacities[index] ?? authoredCapacity)
      ));
    });
    this.queues = authoredQueues.map((queue, index) => {
      const capacity = Math.max(0, Math.min(
        this.queueCapacities[index],
        Math.floor(queueCapacities[index] ?? this.queueCapacities[index])
      ));
      return this.createQueueItems(queue.slice(0, capacity), index);
    });
    this.sourceQueues = authoredQueues.map((queue, index) => (
      queue.slice(this.queues[index]?.length ?? 0)
    ));
    if (conveyorCapacityChanged || conveyorConfig.resetSlots) {
      this.initialFillActive = true;
      this.initialFilledSlotIndices.clear();
      this.slots = Array.from({ length: this.conveyorCapacity }, (_, index) => ({
        index,
        progress: wrap01(index / this.conveyorCapacity),
        previousProgress: wrap01(index / this.conveyorCapacity),
        colorIndex: null,
        entryIndex: null,
        entryMotion: null
      }));
    }
    this.failureConditionStartedAt = null;
    this.lastEvent = { type: 'queues-initialized' };
    this.emit();
  }

  subscribe(listener) {
    this.listeners.add(listener);
    listener(this.snapshot());
    return () => this.listeners.delete(listener);
  }

  emit() {
    const snapshot = this.snapshot();
    for (const listener of this.listeners) listener(snapshot);
  }

  snapshot() {
    return {
      time: this.time,
      resetVersion: this.resetVersion,
      status: this.status,
      speedMultiplier: this.speedMultiplier,
      initialFillActive: this.initialFillActive,
      sourceRemaining: this.sourceQueues.reduce((sum, queue) => sum + queue.length, 0),
      queues: this.queues.map((queue) => queue.map((item) => item.colorIndex)),
      queueItems: this.queues.map((queue) => queue.map((item) => ({ ...item }))),
      queueRemaining: this.queues.map((queue) => queue.length),
      vehicles: this.vehicles.map((vehicle) => ({
        ...vehicle,
        motionData: vehicle.motionData ? { ...vehicle.motionData } : null,
        collision: vehicle.collision ? { ...vehicle.collision } : null,
        hit: vehicle.hit ? { ...vehicle.hit } : null
      })),
      spots: this.spots.map((spot) => ({ ...spot })),
      slots: this.slots.map((slot) => ({
        ...slot,
        entryMotion: slot.entryMotion ? { ...slot.entryMotion } : null
      })),
      boardingEvents: this.boardingEvents.map((event) => ({ ...event })),
      lastEvent: { ...this.lastEvent },
      remainingGroups: this.getRemainingGroups(),
      remainingByColor: this.getRemainingByColor()
    };
  }

  setSpeedMultiplier(multiplier) {
    const next = multiplier >= this.level.longPressMultiplier
      ? this.level.longPressMultiplier : 1;
    if (next === this.speedMultiplier) return;
    this.speedMultiplier = next;
    this.lastEvent = { type: 'speed', multiplier: next };
    this.emit();
  }

  getVehicle(id) {
    return this.vehicles.find((vehicle) => vehicle.id === id);
  }

  canMoveToStation(vehicle) {
    return Boolean(vehicle && vehicle.state === 'parked');
  }

  isVehicleBlocking(candidate) {
    return Boolean(candidate && ['parked', 'colliding'].includes(candidate.state));
  }

  getBlockers(id) {
    const vehicle = this.getVehicle(id);
    if (!this.canMoveToStation(vehicle)) return [];
    return this.collisionContext.getCollisionCandidates(this, id).map((candidate) => (
      candidate.type === 'vehicle'
        ? candidate.id
        : `container:${candidate.id}:${candidate.role}`
    ));
  }

  clickVehicle(id) {
    if (this.status !== 'playing') return { ok: false, reason: 'finished' };
    const vehicle = this.getVehicle(id);
    if (!this.canMoveToStation(vehicle)) return { ok: false, reason: 'unavailable' };
    const spot = this.spots.find((candidate) => candidate.vehicleId === null);
    if (!spot) {
      this.lastEvent = { type: 'spots-full', vehicleId: id };
      this.checkEndState();
      this.emit();
      return { ok: false, reason: 'spots-full' };
    }

    if (!this.collisionContext.canVehicleDriveOut(this, id)) {
      const candidates = this.collisionContext.getCollisionCandidates(this, id);
      const blockers = candidates.map((candidate) => (
        candidate.type === 'vehicle'
          ? candidate.id
          : `container:${candidate.id}:${candidate.role}`
      ));
      const contact = findCollisionContact(this.level, vehicle, candidates);
      if (!contact) {
        this.lastEvent = { type: 'blocked', vehicleId: id, blockers, targetId: null };
        this.emit();
        return { ok: false, reason: 'blocked', blockers };
      }
      const target = contact.candidate.vehicle ?? null;
      const motion = getCollisionMotion(contact.distance);
      Object.assign(vehicle, {
        state: 'colliding', motion: 0,
        collision: {
          ...motion,
          targetType: contact.candidate.type,
          targetId: target?.id ?? null,
          targetContainerId: contact.candidate.type === 'container' ? contact.candidate.id : null,
          targetContainerRole: contact.candidate.role ?? null,
          contactPosition: { ...contact.position },
          elapsed: 0,
          offset: 0,
          contactTriggered: false,
          hitDirection: target ? getHitDirection(vehicle, target) : null
        }
      });
      this.lastEvent = {
        type: 'blocked',
        vehicleId: id,
        blockers,
        targetId: target?.id ?? null,
        targetContainerId: contact.candidate.type === 'container' ? contact.candidate.id : null
      };
      this.emit();
      return { ok: false, reason: 'blocked', blockers };
    }
    spot.vehicleId = id;
    const target = this.getSpotPosition(spot.index);
    const path = buildRoundedPath(buildToStationPoints(vehicle, target, SCENE_TUNING.vehiclePath), SCENE_TUNING.vehiclePath);
    const stationMotion = getStationMotion(path.length);
    Object.assign(vehicle, {
      state: 'moving-to-spot', spotIndex: spot.index, motion: 0,
      motionData: { path, duration: stationMotion.duration, curve: stationMotion.curve }
    });
    this.lastEvent = { type: 'vehicle-dispatched', vehicleId: id, spotIndex: spot.index };
    this.emit();
    return { ok: true, spotIndex: spot.index };
  }

  update(deltaSeconds) {
    if (this.status !== 'playing') return;
    const delta = Math.max(0, Math.min(deltaSeconds, 0.1));
    this.time += delta;
    let changed = false;

    for (const vehicle of this.vehicles) {
      if (vehicle.hit && this.time - vehicle.hit.startedAt >= UNITY_VEHICLE_MOTION.hitDuration) {
        vehicle.hit = null;
      }
    }

    for (const vehicle of this.vehicles) {
      if (vehicle.state === 'moving-to-spot') {
        vehicle.motion = clamp01(vehicle.motion + delta / vehicle.motionData.duration);
        if (vehicle.motion >= 1) {
          Object.assign(vehicle, { state: 'at-spot', motion: 0, motionData: null });
          this.lastEvent = { type: 'vehicle-arrived', vehicleId: vehicle.id, spotIndex: vehicle.spotIndex };
          changed = true;
        }
      } else if (vehicle.state === 'colliding') {
        const collision = vehicle.collision;
        collision.elapsed += delta;
        const contactTime = collision.forwardDuration;
        const returnStart = contactTime + collision.delay;
        const finishTime = returnStart + collision.backwardDuration;
        if (collision.elapsed < contactTime) {
          const t = clamp01(collision.elapsed / collision.forwardDuration);
          collision.offset = collision.distance * evaluateUnityCurve(collision.forwardCurve, t);
        } else if (collision.elapsed < returnStart) {
          collision.offset = collision.distance;
        } else {
          const t = clamp01((collision.elapsed - returnStart) / collision.backwardDuration);
          collision.offset = collision.distance * (1 - evaluateUnityCurve(collision.backwardCurve, t));
        }
        vehicle.motion = collision.distance > 0 ? collision.offset / collision.distance : 0;
        if (!collision.contactTriggered && collision.elapsed >= contactTime) {
          collision.contactTriggered = true;
          const target = this.getVehicle(collision.targetId);
          if (target) target.hit = { startedAt: this.time, ...collision.hitDirection };
          this.lastEvent = {
            type: 'vehicle-collision-contact',
            vehicleId: vehicle.id,
            targetId: collision.targetId,
            targetContainerId: collision.targetContainerId
          };
          changed = true;
        }
        if (collision.elapsed >= finishTime) {
          Object.assign(vehicle, { state: 'parked', motion: 0, collision: null });
          this.lastEvent = { type: 'vehicle-collision-finished', vehicleId: vehicle.id };
          changed = true;
        }
      } else if (vehicle.state === 'boarding-final') {
        const fullLoadDelay = SCENE_TUNING.vehicleDeparturePath?.fullLoadDelay ?? this.level.boardingDepartureDelay;
        vehicle.motion = fullLoadDelay <= 0 ? 1 : clamp01(vehicle.motion + delta / fullLoadDelay);
        if (vehicle.motion >= 1) {
          const spot = this.spots[vehicle.spotIndex];
          if (spot?.vehicleId === vehicle.id) spot.vehicleId = null;
          const target = this.getSpotPosition(vehicle.spotIndex);
          const departure = SCENE_TUNING.vehicleDeparturePath ?? {};
          const backwardPath = buildRoundedPath(buildOutStationPoints(target, departure), departure);
          const forwardStart = backwardPath.segments.at(-1)?.p1 ?? target;
          const forwardPath = buildRoundedPath([
            forwardStart,
            {
              x: departure.exitTargetX ?? 4.2,
              z: forwardStart.z + (departure.exitTargetZOffset ?? 0)
            }
          ], departure);
          Object.assign(vehicle, {
            state: 'departing', motion: 0,
            motionData: {
              backwardPath,
              forwardPath,
              backwardDuration: backwardPath.length / Math.max(0.001, departure.backwardSpeed ?? 2.5),
              forwardDuration: forwardPath.length / Math.max(0.001, departure.forwardSpeed ?? 10)
            }
          });
          this.lastEvent = { type: 'vehicle-full', vehicleId: vehicle.id };
          changed = true;
        }
      } else if (vehicle.state === 'departing') {
        const totalDuration = vehicle.motionData.backwardDuration + vehicle.motionData.forwardDuration;
        vehicle.motion = clamp01(vehicle.motion + delta / totalDuration);
        if (vehicle.motion >= 1) {
          Object.assign(vehicle, { state: 'done', motion: 0, motionData: null });
          this.lastEvent = { type: 'vehicle-finished', vehicleId: vehicle.id };
          changed = true;
        }
      }
    }

    this.updateQueues(delta);

    const entryMotion = this.level.passengerEntryMotion ?? {};
    const activeConveyorSpeed = this.initialFillActive
      ? (entryMotion.passengerSpeed ?? this.level.conveyorSpeed)
      : this.level.conveyorSpeed;
    const progressDelta = delta * activeConveyorSpeed / this.conveyorPathLength * this.speedMultiplier;
    let initialFillClamp = 0;
    let initialFillHoldSlot = null;
    let initialFillHoldProgress = 0;
    for (const slot of this.slots) {
      slot.previousProgress = slot.progress;
      slot.progress = wrap01(slot.progress + progressDelta);
      if (slot.colorIndex === null) {
        const entry = this.getFirstPassedEntry(slot.previousProgress, slot.progress);
        if (!entry) continue;
        const passenger = this.dequeuePassenger(entry.index, true);
        if (passenger === null) {
          if (this.initialFillActive) {
            const holdProgress = wrap01(entry.percent - INITIAL_ENTRY_OFFSET_PERCENT);
            const clamp = wrap01(slot.progress - holdProgress);
            if (clamp > initialFillClamp) {
              initialFillClamp = clamp;
              initialFillHoldSlot = slot;
              initialFillHoldProgress = holdProgress;
            }
          }
          continue;
        }
        slot.colorIndex = passenger.colorIndex;
        slot.entryIndex = entry.index;
        slot.entryMotion = this.createEntryMotion(entry.index, passenger);
        if (this.initialFillActive) this.initialFilledSlotIndices.add(slot.index);
        this.lastEvent = { type: 'group-entered-belt', colorIndex: passenger.colorIndex, entryIndex: entry.index };
        changed = true;
      }
    }

    if (this.initialFillActive && initialFillClamp > 0) {
      for (const slot of this.slots) {
        slot.progress = wrap01(slot.progress - initialFillClamp);
        slot.previousProgress = wrap01(slot.previousProgress - initialFillClamp);
      }
      if (initialFillHoldSlot) initialFillHoldSlot.progress = initialFillHoldProgress;
    }

    if (
      this.initialFillActive
      && this.initialFilledSlotIndices.size >= this.conveyorCapacity
      && !this.hasEnteringSlots()
    ) {
      this.initialFillActive = false;
    }

    for (const slot of this.slots) {
      if (slot.colorIndex === null || !this.inExitRange(slot.progress)) continue;
      const vehicle = this.findBoardableVehicle(slot.colorIndex);
      if (!vehicle) continue;
      const colorIndex = slot.colorIndex;
      this.boardingEvents.push({
        id: ++this.boardingEventId,
        vehicleId: vehicle.id,
        spotIndex: vehicle.spotIndex,
        colorIndex,
        slotIndex: slot.index,
        progress: slot.progress,
        startedAt: this.time
      });
      if (this.boardingEvents.length > 24) this.boardingEvents.shift();
      slot.colorIndex = null;
      slot.entryIndex = null;
      slot.entryMotion = null;
      vehicle.boardedGroups += 1;
      this.lastEvent = {
        type: 'group-boarded', vehicleId: vehicle.id, colorIndex,
        boardedGroups: vehicle.boardedGroups
      };
      changed = true;
      if (vehicle.boardedGroups >= vehicle.seats) {
        Object.assign(vehicle, { state: 'boarding-final', motion: 0 });
        this.lastEvent = { type: 'vehicle-boarding-final', vehicleId: vehicle.id };
      }
    }

    const previousStatus = this.status;
    this.checkEndState();
    if (changed || this.status !== previousStatus) this.emit();
  }

  crossedPoint(previous, current, point) {
    if (previous <= current) return point > previous && point <= current;
    return point > previous || point <= current;
  }

  getFirstPassedEntry(previous, current) {
    let best = null;
    for (let index = 0; index < this.entryPercents.length; index += 1) {
      const percent = this.entryPercents[index];
      if (!this.crossedPoint(previous, current, percent)) continue;
      const distance = wrap01(percent - previous);
      if (!best || distance < best.distance) best = { index, percent, distance };
    }
    return best;
  }

  hasEnteringSlots() {
    const duration = Math.max(0.1, this.level.passengerEntryMotion?.initialFillCatchUpDuration ?? 0.2);
    return this.slots.some((slot) => (
      slot.entryMotion && this.time - slot.entryMotion.startedAt < duration
    ));
  }

  getSpotPosition(index) {
    const spots = SCENE_TUNING.parkingSpots;
    const visualYaw = SCENE_TUNING.facing.parkingSpotYawDegrees ?? this.level.vehicleMotion.spotYaw;
    const sourceYaw = visualYawToVehicleAreaYaw(visualYaw);
    const approachOffset = SCENE_TUNING.vehicleDeparturePath?.backDistance ?? this.level.vehicleMotion.spotApproachOffsetZ;
    const visualCenter = {
      x: spots.startX + spots.spacing * index,
      z: spots.z
    };
    const visualForward = {
      x: Math.sin(visualYaw * Math.PI / 180),
      z: Math.cos(visualYaw * Math.PI / 180)
    };
    const approachDirection = this.level.vehicleMotion.spotApproachDirection === 'screen-down'
      ? { x: 0, z: 1 }
      : { x: -visualForward.x, z: -visualForward.z };
    const visualApproach = approachOffset == null ? null : {
      x: visualCenter.x + approachDirection.x * approachOffset,
      z: visualCenter.z + approachDirection.z * approachOffset
    };
    const center = visualToVehicleAreaPoint(visualCenter.x, visualCenter.z);
    const approach = visualApproach ? visualToVehicleAreaPoint(visualApproach.x, visualApproach.z) : null;
    return {
      x: center.x,
      z: center.z,
      yaw: sourceYaw,
      visualX: visualCenter.x,
      visualZ: visualCenter.z,
      visualYaw,
      approachX: approach?.x ?? null,
      approachZ: approach?.z ?? null,
      visualApproachX: visualApproach?.x ?? null,
      visualApproachZ: visualApproach?.z ?? null
    };
  }

  dequeuePassenger(queueIndex, includeDetails = false) {
    const queue = this.queues[queueIndex];
    if (!queue?.length) return null;
    if (queue[0].distanceFromHead > PASSENGER_READY_DISTANCE_THRESHOLD) return null;
    const passenger = queue.shift();
    const source = this.sourceQueues[queueIndex];
    if (source?.length) {
      const lastDistance = queue.at(-1)?.distanceFromHead;
      const spawnDistance = Number.isFinite(lastDistance)
        ? lastDistance + this.queueSpacing
        : this.queueAvailableLengths[queueIndex] ?? 0;
      queue.push({
        id: this.nextPassengerId++,
        colorIndex: source.shift(),
        createdAt: this.time,
        distanceFromHead: clampNumber(
          spawnDistance,
          0,
          this.queueAvailableLengths[queueIndex] ?? spawnDistance
        )
      });
    }
    return includeDetails ? { ...passenger } : passenger.colorIndex;
  }

  createQueueItems(colors, queueIndex) {
    const availableLength = this.queueAvailableLengths?.[queueIndex]
      ?? Math.max(0, ((this.queueCapacities?.[queueIndex] ?? this.level.queueCapacity) - 1) * (this.queueSpacing ?? 0.4));
    return colors.map((colorIndex, index) => ({
      id: this.nextPassengerId++,
      colorIndex,
      createdAt: this.time,
      distanceFromHead: Math.min(index * (this.queueSpacing ?? 0.4), availableLength)
    }));
  }

  updateQueues(delta) {
    const speed = Math.max(0.01, this.level.passengerEntryMotion?.passengerSpeed ?? this.level.conveyorSpeed);
    const step = speed * Math.max(0, delta) * this.speedMultiplier;
    for (let queueIndex = 0; queueIndex < this.queues.length; queueIndex += 1) {
      const queue = this.queues[queueIndex];
      const availableLength = this.queueAvailableLengths?.[queueIndex] ?? Infinity;
      for (let index = 0; index < queue.length; index += 1) {
        const item = queue[index];
        const target = Math.min(index * this.queueSpacing, availableLength);
        if (item.distanceFromHead > target) {
          item.distanceFromHead = Math.max(target, item.distanceFromHead - step);
        } else if (item.distanceFromHead < target) {
          item.distanceFromHead = Math.min(target, item.distanceFromHead + step);
        }
      }
    }
  }

  createEntryMotion(entryIndex, passenger = null) {
    return {
      entryIndex,
      passengerId: passenger?.id ?? null,
      fromQueueDistance: passenger?.distanceFromHead ?? 0,
      fromQueueProgress: 0,
      startedAt: this.time,
      initialFill: this.initialFillActive
    };
  }

  inExitRange(progress) {
    const { exitStart, exitEnd } = this;
    return exitStart <= exitEnd
      ? progress >= exitStart && progress <= exitEnd
      : progress >= exitStart || progress <= exitEnd;
  }

  findBoardableVehicle(colorIndex) {
    for (const spot of this.spots) {
      if (spot.vehicleId === null) continue;
      const vehicle = this.getVehicle(spot.vehicleId);
      if (
        vehicle?.state === 'at-spot' &&
        vehicle.colorIndex === colorIndex &&
        vehicle.boardedGroups < vehicle.seats
      ) return vehicle;
    }
    return null;
  }

  hasBoardablePassenger() {
    return this.slots.some((slot) => (
      slot.colorIndex !== null && this.findBoardableVehicle(slot.colorIndex) !== null
    ));
  }

  getFailureDelaySeconds() {
    const delay = Number(SCENE_TUNING.gameOver?.failureDelaySeconds);
    return Number.isFinite(delay) ? Math.max(0, delay) : 2;
  }

  areParkingSpotsFullAndSettled() {
    return this.spots.every((spot) => {
      if (spot.vehicleId === null) return false;
      const vehicle = this.getVehicle(spot.vehicleId);
      return vehicle?.state === 'at-spot';
    });
  }

  checkEndState() {
    if (this.vehicles.every((vehicle) => vehicle.state === 'done') && this.getRemainingGroups() === 0) {
      this.status = 'won';
      this.lastEvent = { type: 'win' };
      return;
    }
    const spotsFullAndSettled = this.areParkingSpotsFullAndSettled();
    const beltFull = this.slots.every((slot) => slot.colorIndex !== null);
    const failureCondition = spotsFullAndSettled && beltFull && !this.hasBoardablePassenger();
    if (!failureCondition) {
      this.failureConditionStartedAt = null;
      return;
    }
    if (this.failureConditionStartedAt === null) this.failureConditionStartedAt = this.time;
    if (this.time - this.failureConditionStartedAt >= this.getFailureDelaySeconds()) {
      this.status = 'lost';
      this.lastEvent = { type: 'lose', reason: 'exceed-parking-spot' };
    }
  }

  getRemainingGroups() {
    const queued = this.queues.reduce((sum, queue) => sum + queue.length, 0);
    const sourced = this.sourceQueues.reduce((sum, queue) => sum + queue.length, 0);
    return sourced + queued + this.slots.filter((slot) => slot.colorIndex !== null).length;
  }

  getRemainingByColor() {
    const counts = { 0: 0, 4: 0, 5: 0 };
    for (const queue of [...this.sourceQueues, ...this.queues]) {
      for (const value of queue) {
        const colorIndex = typeof value === 'object' ? value.colorIndex : value;
        counts[colorIndex] = (counts[colorIndex] ?? 0) + 1;
      }
    }
    for (const slot of this.slots) {
      if (slot.colorIndex !== null) {
        counts[slot.colorIndex] = (counts[slot.colorIndex] ?? 0) + 1;
      }
    }
    return counts;
  }
}


