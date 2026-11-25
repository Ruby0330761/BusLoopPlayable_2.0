import * as THREE from 'three';
import { SMOKE_TRAIL_ANIMATION, SMOKE_TRAIL_DEFAULTS } from './vehicle-effect-assets.js';
import { DepartureStars, sampleParticleCurve, departureStarSizeScale, departureStarTuning, departureStarColors } from './departure-stars.js';

const DEG = Math.PI / 180;

export const UNITY_EFFECTS = Object.freeze({
  aboardSmoke: Object.freeze({
    burst: 20,
    lifetime: Object.freeze([0.3, 0.4]),
    speed: Object.freeze([0.3, 0.8]),
    size: Object.freeze([0.06, 0.12]),
    localPosition: Object.freeze([0, 0.05, -0.25])
  }),
  ribbon: Object.freeze({
    burst: 50,
    lifetime: Object.freeze([0.6, 1.2]),
    speed: Object.freeze([6, 8]),
    speedOverLifetime: Object.freeze([[0, 1], [0.38, 0.85], [1, 0.18]]),
    moveRange: 2.15,
    initialSize: Object.freeze([0.1, 0.15]),
    sizeOverLifetime: Object.freeze([[0, 0.45], [1, 1.45]]),
    fadeOutSpeed: 0.35,
    atlas: Object.freeze({ columns: 3, rows: 3, frames: 9 }),
    localPosition: Object.freeze([0.03, 0.17, 0.25]),
    localEuler: Object.freeze([-111.451, 12.11, -11.293]),
    coneDegrees: 25,
    gravity: -7.85
  }),
  ribbonSmoke: Object.freeze({
    burst: Object.freeze([6, 8]),
    lifetime: Object.freeze([0.4, 0.7]),
    speed: Object.freeze([6, 10]),
    speedOverLifetime: Object.freeze([[0, 1], [0.22, 0.55], [1, 0.08]]),
    moveRange: 1.35,
    initialSize: Object.freeze([0.1, 0.32]),
    sizeOverLifetime: Object.freeze([[0, 0.45], [1, 1.45]]),
    fadeOutSpeed: 0.28,
    localPosition: Object.freeze([0.01, 0.41, 0.16]),
    localEuler: Object.freeze([-111.451, 12.11, -11.293]),
    coneDegrees: 25,
    gravity: -7.85
  }),
  hit: Object.freeze({
    emitters: Object.freeze([
      Object.freeze({
        name: 'ParticleHit_2', texture: 'hitCircle', material: 'Circle_01_Add', delay: 0.02,
        burst: 2, lifetime: [0.2, 0.2], speed: [0, 0], initialSize: [0.4, 0.4],
        sizeOverLifetime: [[0, 0.05115664], [1, 1]], colorOverLifetime: [
          { t: 0, color: [1, 1, 1], alpha: 0 },
          { t: 0.026474, color: [1, 0.8937694, 0], alpha: 1 },
          { t: 0.40589, color: [1, 0.8937694, 0], alpha: 0.39215687 },
          { t: 0.997055, color: [1, 0.8937694, 0], alpha: 0 }
        ], blending: 'additive', localEuler: [-90, 0, 0], startRotation: [0, Math.PI * 2]
      }),
      Object.freeze({
        name: 'ParticleHit_1', texture: 'hitRound2', material: 'Round_02_Add', delay: 0,
        burst: 2, lifetime: [0.15, 0.15], speed: [0, 0], initialSize: [0.4, 0.4],
        sizeOverLifetime: [[0, 1], [1, 1]], colorOverLifetime: [
          { t: 0, color: [1, 1, 1], alpha: 1 },
          { t: 0.379416, color: [1, 1, 1], alpha: 1 },
          { t: 0.997055, color: [1, 1, 1], alpha: 0 }
        ], blending: 'additive', localEuler: [-90, 0, 0], startRotation: [0, Math.PI * 2]
      }),
      Object.freeze({
        name: 'ParticleHit', texture: 'hitRound1', material: 'Round_01_Add', delay: 0.03,
        burst: [9, 10], lifetime: [0.1, 0.3], speed: [4, 6], initialSize: [0.005, 0.04],
        sizeOverLifetime: [[0, 0], [0.2368057, 0.052092046], [0.3267007, 1], [1, 0]],
        colorOverLifetime: [{ t: 0, color: [1, 1, 1], alpha: 1 }, { t: 1, color: [1, 1, 1], alpha: 1 }],
        blending: 'additive', coneDegrees: 50, localEuler: [0, 90, 0], startRotation: [0, Math.PI * 2]
      })
    ])
  }),
  smokeTrail: Object.freeze({
    name: 'ParticleTrail', texture: 'smokeTrail', material: 'DrivingSmoke_Alp', rateOverTime: 25,
    atlas: SMOKE_TRAIL_ANIMATION.atlas,
    lifetime: [0.2, 0.3], speed: [0.2, 0.3], initialSize: [0.06, 0.15],
    sizeOverLifetime: [[0, 0.60634995], [0.1144952, 0.95818204], [0.5231409, 1], [1, 0.2797222]],
    colorOverLifetime: [
      { t: 0, color: [1, 1, 1], alpha: 0 },
      { t: 0.091173, color: [1, 1, 1], alpha: 1 },
      { t: 0.652949, color: [1, 1, 1], alpha: 1 },
      { t: 1, color: [1, 1, 1], alpha: 0 }
    ],
    localPosition: [0, 0.08, -0.46], localEuler: [0, 180, 0], shapeScale: [1, 0.5, 1],
    gravity: -0.5, blending: 'normal'
  })
});

function randomRange(value) {
  if (!Array.isArray(value)) return value;
  return THREE.MathUtils.lerp(value[0], value[1], Math.random());
}

function randomIntRange(value) {
  if (!Array.isArray(value)) return Math.round(value);
  return THREE.MathUtils.randInt(Math.round(value[0]), Math.round(value[1]));
}

function sampleCurve(keys, progress) {
  if (!keys?.length) return 1;
  if (progress <= keys[0][0]) return keys[0][1];
  const last = keys.at(-1);
  if (progress >= last[0]) return last[1];
  let previous = keys[0];
  let next = keys[1];
  for (let index = 1; index < keys.length; index += 1) {
    next = keys[index];
    if (progress <= next[0]) break;
    previous = next;
  }
  const duration = Math.max(0.0001, next[0] - previous[0]);
  const ratio = (progress - previous[0]) / duration;
  return THREE.MathUtils.lerp(previous[1], next[1], ratio);
}

function sampleColor(keys, progress) {
  if (!keys?.length) return { color: new THREE.Color(0xffffff), alpha: 1 };
  if (progress <= keys[0].t) return keyToColor(keys[0]);
  const last = keys.at(-1);
  if (progress >= last.t) return keyToColor(last);
  let previous = keys[0];
  let next = keys[1];
  for (let index = 1; index < keys.length; index += 1) {
    next = keys[index];
    if (progress <= next.t) break;
    previous = next;
  }
  const ratio = (progress - previous.t) / Math.max(0.0001, next.t - previous.t);
  return {
    color: new THREE.Color(
      THREE.MathUtils.lerp(previous.color[0], next.color[0], ratio),
      THREE.MathUtils.lerp(previous.color[1], next.color[1], ratio),
      THREE.MathUtils.lerp(previous.color[2], next.color[2], ratio)
    ),
    alpha: THREE.MathUtils.lerp(previous.alpha, next.alpha, ratio)
  };
}

function keyToColor(key) {
  return { color: new THREE.Color(key.color[0], key.color[1], key.color[2]), alpha: key.alpha };
}

function randomConeDirection(axis, angleDegrees) {
  const angle = Math.acos(THREE.MathUtils.lerp(Math.cos(angleDegrees * DEG), 1, Math.random()));
  const azimuth = Math.random() * Math.PI * 2;
  const direction = new THREE.Vector3(
    Math.sin(angle) * Math.cos(azimuth),
    Math.sin(angle) * Math.sin(azimuth),
    Math.cos(angle)
  );
  return direction.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(
    new THREE.Vector3(0, 0, 1),
    axis.clone().normalize()
  ));
}

function particleAlpha(progress, fadeOutSpeed) {
  if (progress < 0.12) return progress / 0.12;
  return THREE.MathUtils.clamp((1 - progress) / fadeOutSpeed, 0, 1);
}

function setAtlasFrame(texture, atlas, frameIndex) {
  const columns = atlas.columns;
  const rows = atlas.rows;
  const frame = frameIndex % atlas.frames;
  const column = frame % columns;
  const rowFromTop = Math.floor(frame / columns);
  texture.repeat.set(1 / columns, 1 / rows);
  texture.offset.set(column / columns, 1 - (rowFromTop + 1) / rows);
}

function cloneAtlasFrame(texture, atlas, frameIndex) {
  if (!atlas) return texture;
  const clone = texture.clone();
  setAtlasFrame(clone, atlas, frameIndex);
  clone.needsUpdate = true;
  return clone;
}

function effectTuningCurve(tuning, fallback) {
  if (!tuning) return fallback;
  return [
    [0, Number.isFinite(Number(tuning.speedStart)) ? Number(tuning.speedStart) : fallback[0][1]],
    [THREE.MathUtils.clamp(Number(tuning.speedMidTime), 0, 1), Number.isFinite(Number(tuning.speedMid)) ? Number(tuning.speedMid) : fallback[1][1]],
    [1, Number.isFinite(Number(tuning.speedEnd)) ? Number(tuning.speedEnd) : fallback.at(-1)[1]]
  ];
}

function effectMoveRange(tuning, fallback) {
  return Number.isFinite(Number(tuning?.moveRange)) ? Number(tuning.moveRange) : fallback;
}

function positiveScale(value, fallback = 1) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

function hitEmitterSizeScale(tuning, emitterName) {
  const keys = {
    ParticleHit_2: 'particleHit2SizeScale',
    ParticleHit_1: 'particleHit1SizeScale',
    ParticleHit: 'particleHitSizeScale'
  };
  return positiveScale(tuning?.sizeScale) * positiveScale(tuning?.[keys[emitterName]]);
}

// Older saved levels may override only some of the editor's smoke settings.
function smokeTrailTuning(effectsTuning) {
  const tuning = effectsTuning?.smokeTrail;
  const number = (key, min = -Infinity) => {
    const parsed = Number(tuning?.[key] ?? SMOKE_TRAIL_DEFAULTS[key]);
    return Number.isFinite(parsed) ? Math.max(min, parsed) : SMOKE_TRAIL_DEFAULTS[key];
  };
  const lifetimeMin = number('lifetimeMin', 0.01);
  const sizeMin = number('sizeMin', 0.001);
  return {
    rateOverTime: number('rateOverTime', 0),
    lifetimeMin,
    // A max below the min would collapse the random range to a constant, so the
    // lower bound wins and the effect keeps a spread.
    lifetimeMax: Math.max(lifetimeMin, number('lifetimeMax', 0.01)),
    sizeMin,
    sizeMax: Math.max(sizeMin, number('sizeMax', 0.001)),
    speedScale: number('speedScale', 0),
    offsetZ: number('offsetZ'),
    offsetY: number('offsetY'),
    spread: number('spread', 0),
    gravity: number('gravity'),
    rotationSpeed: number('rotationSpeed'),
    rotationRandomness: Math.min(1, number('rotationRandomness', 0) / 100),
    sizeRandomness: Math.min(1, number('sizeRandomness', 0) / 100),
    opacity: Math.min(1, number('opacity', 0))
  };
}

function smokeTrailSpin(baseSpin, randomness, speedRandom, directionRandom) {
  // At 100%, half the particles reverse direction. The per-particle sample
  // stays fixed, while the slider controls how likely reversal is.
  const direction = directionRandom < randomness * 0.5 ? -1 : 1;
  return baseSpin * (1 + speedRandom * randomness) * direction;
}

function disposeParticle(particle) {
  particle.sprite.parent?.remove(particle.sprite);
  particle.material.dispose();
  if (particle.ownsTexture) particle.material.map?.dispose();
}

function isVehicleMoving(vehicle, starsEnabled) {
  return ['colliding', 'moving-to-spot'].includes(vehicle.state)
    || (vehicle.state === 'departing' && (!starsEnabled || vehicle.surplusReleased));
}

export class VehicleEffects {
  constructor({ scene, vehicleViews, spotRoots, textures, effectsTuning = {}, resolveHitContact = null, camera = null }) {
    this.scene = scene;
    // Group order is sorted before sprite order, including on hidden vehicle markers.
    this.hitLayer = new THREE.Group();
    this.hitLayer.name = 'Collision flashes';
    this.hitLayer.renderOrder = 1001;
    this.vehicleViews = vehicleViews;
    this.spotRoots = spotRoots;
    this.textures = textures;
    this.effectsTuning = effectsTuning;
    // Container contacts arrive from the gameplay engine in level source space
    // (the same space as vehicle x/z), not world space, and their raw point can
    // land inside or behind the car because garage/conveyor volumes overlap a
    // parked car. The renderer owns that mapping and clamps the point into the
    // gap ahead of the bumper.
    this.resolveHitContact = resolveHitContact;
    this.particles = [];
    this.previousSpotVehicles = null;
    this.celebratedVehicles = new Set();
    this.resetVersion = null;
    this.lastTime = null;
    this.lastCollisionContactKey = null;
    this.smokeTrailRemainders = new Map();
    this.departureStars = new DepartureStars({ scene, vehicleViews, texture: textures.departureStar,
      camera, trailTexture: textures.departureTrail,
      addParticle: (particle) => this.addParticle(particle) });
  }

  clear() {
    for (const particle of this.particles) disposeParticle(particle);
    this.particles.length = 0;
    this.hitLayer.removeFromParent();
    this.previousSpotVehicles = null;
    this.celebratedVehicles.clear();
    this.resetVersion = null;
    this.lastTime = null;
    this.lastCollisionContactKey = null;
    this.smokeTrailRemainders.clear();
    this.departureStars.clear();
  }

  update(snapshot) {
    if ((this.lastTime !== null && snapshot.time < this.lastTime)
      || (this.resetVersion !== null && snapshot.resetVersion !== undefined && snapshot.resetVersion !== this.resetVersion)) this.clear();
    this.resetVersion = snapshot.resetVersion ?? null;
    // Replace the continuous driving smoke with BFT stars/trail. Finite
    // boarding puffs and the one-shot full celebration finish naturally.
    const starsEnabled = Boolean(Number(this.effectsTuning.departureStars?.enabled));
    const departing = new Set((snapshot.vehicles ?? []).filter(vehicle => starsEnabled && vehicle.state === 'departing' && !vehicle.surplusReleased).map(vehicle => vehicle.id));
    for (let index = this.particles.length - 1; index >= 0; index--) {
      const particle = this.particles[index];
      if ((departing.has(particle.vehicleId) && particle.effectKind === 'driving-smoke')
        || (!starsEnabled && particle.departureStarBaseSize != null)) {
        disposeParticle(particle); this.particles.splice(index, 1);
      }
    }
    const delta = this.lastTime === null ? 0 : Math.max(0, snapshot.time - this.lastTime);
    this.spawnSnapshotEvents(snapshot);
    this.spawnSmokeTrails(snapshot, delta);
    if (starsEnabled) this.departureStars.update(snapshot, delta, this.effectsTuning.departureStars, this.effectsTuning.departureTrail);
    else if (this.departureStars.emitters.size || this.departureStars.trails.size) this.departureStars.clear();
    this.lastTime = snapshot.time;
    this.updateParticles(delta);
  }

  spawnSnapshotEvents(snapshot) {
    this.spawnFullConfettiEvents(snapshot);

    // A frame can report several visual events and lastEvent only keeps the
    // final one, so a collision overwritten by a later boarding event would
    // lose its hit effect. Play every collision event of the frame, then the
    // last one, with the key check preventing duplicates.
    const frameCollisions = (snapshot.frameAudioEvents ?? [])
      .filter((event) => event.type === 'vehicle-collision-contact');
    if (frameCollisions.length === 0 && snapshot.lastEvent?.type !== 'vehicle-collision-contact') {
      this.lastCollisionContactKey = null;
      return;
    }
    for (const event of frameCollisions) this.spawnHitForEvent(event);
    if (snapshot.lastEvent?.type === 'vehicle-collision-contact') {
      this.spawnHitForEvent(snapshot.lastEvent);
    }
  }

  spawnFullConfettiEvents(snapshot) {
    const vehicles = new Map((snapshot.vehicles ?? []).map(vehicle => [vehicle.id, vehicle]));
    const spots = (snapshot.spots ?? []).map(spot => spot.vehicleId);
    const celebrate = (vehicleId, spotIndex) => {
      if (this.celebratedVehicles.has(vehicleId) || !Number.isInteger(spotIndex)
        || !this.spotRoots[spotIndex] || !this.textures.ribbon) return;
      this.celebratedVehicles.add(vehicleId);
      this.spawnRibbon(spotIndex, vehicleId);
    };
    // Full events may share a frame with another full car, a collision or a
    // boarding event. Process every recorded full event and deduplicate by car.
    const events = [...(snapshot.frameAudioEvents ?? []), snapshot.lastEvent];
    for (const event of events) {
      if (event?.type !== 'vehicle-full') continue;
      const vehicle = vehicles.get(event.vehicleId);
      const previousSpot = this.previousSpotVehicles?.indexOf(event.vehicleId);
      celebrate(event.vehicleId, vehicle?.spotIndex ?? event.spotIndex ?? previousSpot);
    }
    // Live renderState can overwrite lastEvent and omit the frame event list.
    // Preserve the original spot-empty timing, using its former occupant even
    // when another car has already claimed the spot in the same frame.
    this.previousSpotVehicles?.forEach((vehicleId, spotIndex) => {
      if (vehicleId == null || spots[spotIndex] === vehicleId) return;
      const vehicle = vehicles.get(vehicleId);
      if (vehicle && ['departing', 'done'].includes(vehicle.state)) celebrate(vehicleId, spotIndex);
    });
    this.previousSpotVehicles = spots;
  }

  spawnHitForEvent(event) {
    const key = `${event.vehicleId}:${event.targetId ?? 'container'}:${event.targetContainerId ?? ''}`;
    if (key === this.lastCollisionContactKey) return;
    this.lastCollisionContactKey = key;
    this.spawnHit(
      event.vehicleId,
      event.targetId,
      event.contactDistance,
      event.contactPosition
    );
  }

  spawnSmokeTrails(snapshot, delta) {
    if (delta <= 0 || !this.textures.smokeTrail) return;
    const effect = UNITY_EFFECTS.smokeTrail;
    const { rateOverTime } = smokeTrailTuning(this.effectsTuning);
    for (const vehicle of snapshot.vehicles ?? []) {
      if (!isVehicleMoving(vehicle, Boolean(Number(this.effectsTuning.departureStars?.enabled)))) {
        this.smokeTrailRemainders.delete(vehicle.id);
        continue;
      }
      const parent = this.vehicleViews.get(vehicle.id);
      if (!parent) continue;
      const total = (this.smokeTrailRemainders.get(vehicle.id) ?? 0) + rateOverTime * delta;
      const count = Math.floor(total);
      this.smokeTrailRemainders.set(vehicle.id, total - count);
      for (let index = 0; index < count; index += 1) this.spawnSmokeTrailParticle(parent, effect, vehicle.id);
    }
  }

  updateParticles(delta) {
    const smokeTuning = smokeTrailTuning(this.effectsTuning);
    const smokeSpin = smokeTuning.rotationSpeed * DEG;
    const departureTuning = departureStarTuning(this.effectsTuning.departureStars);
    const departureColors = departureStarColors(departureTuning);
    for (let index = this.particles.length - 1; index >= 0; index -= 1) {
      const particle = this.particles[index];
      if (particle.effectKind === 'departure-star' && Number.isFinite(particle.departureStarBaseSize)) {
        particle.initialSize = particle.departureStarBaseSize * departureStarSizeScale(departureTuning);
        if (particle.departureStarBase) {
          const base = particle.departureStarBase;
          particle.initialSpeed = base.speed * departureTuning.speedScale;
          particle.direction.copy(base.direction);
          particle.lifetime = base.lifetime * departureTuning.lifetimeScale;
          particle.opacity = departureTuning.opacity;
          particle.colorOverLifetime = departureColors;
        }
      }
      particle.age += delta;
      if (particle.age < particle.delay) continue;
      const activeAge = particle.age - particle.delay;
      if (activeAge >= particle.lifetime) {
        disposeParticle(particle);
        this.particles.splice(index, 1);
        continue;
      }
      const progress = activeAge / particle.lifetime;
      if (particle.animatedAtlas) {
        const frame = Math.min(particle.animatedAtlas.frames - 1, Math.floor(progress * particle.animatedAtlas.frames));
        if (frame !== particle.atlasFrame) {
          setAtlasFrame(particle.material.map, particle.animatedAtlas, frame);
          particle.atlasFrame = frame;
        }
      }
      particle.gravityVelocity += particle.gravity * delta;
      const speedScale = sampleCurve(particle.speedOverLifetime, progress);
      particle.velocity.copy(particle.direction).multiplyScalar(particle.initialSpeed * speedScale);
      particle.velocity.y += particle.gravityVelocity;
      particle.sprite.position.addScaledVector(particle.velocity, delta);

      const fromOrigin = particle.sprite.position.clone().sub(particle.origin);
      const distance = fromOrigin.length();
      if (particle.moveRange > 0 && distance > particle.moveRange) {
        particle.sprite.position.copy(particle.origin).add(fromOrigin.multiplyScalar(particle.moveRange / distance));
      }

      if (particle.useColorOverLifetime) {
        const sampled = sampleColor(particle.colorOverLifetime, progress);
        particle.material.color.copy(sampled.color);
        particle.material.opacity = sampled.alpha * particle.opacity;
      } else {
        particle.material.opacity = particleAlpha(progress, particle.fadeOutSpeed) * particle.opacity;
      }
      const scale = particle.initialSize * sampleParticleCurve(particle.sizeOverLifetime, progress);
      particle.sprite.scale.setScalar(scale);
      if (particle.isSmokeTrail) {
        particle.spin = smokeTrailSpin(smokeSpin, smokeTuning.rotationRandomness,
          particle.spinRandom, particle.spinDirectionRandom);
      }
      particle.material.rotation += particle.spin * delta;
    }
  }

  spawnAboardSmoke(vehicleId) {
    const parent = this.vehicleViews.get(vehicleId);
    if (!parent || !this.textures.aboardSmoke) return;
    const effect = UNITY_EFFECTS.aboardSmoke;
    for (let index = 0; index < effect.burst; index += 1) {
      const direction = new THREE.Vector3(
        THREE.MathUtils.randFloatSpread(0.7),
        THREE.MathUtils.randFloat(0.45, 1),
        THREE.MathUtils.randFloatSpread(0.7)
      ).normalize();
      this.addParticle({
        parent,
        vehicleId, effectKind: 'boarding-smoke',
        texture: this.textures.aboardSmoke,
        position: new THREE.Vector3(...effect.localPosition),
        velocity: direction.multiplyScalar(randomRange(effect.speed)),
        lifetime: randomRange(effect.lifetime),
        initialSize: randomRange(effect.size),
        sizeOverLifetime: [[0, 0.45], [1, 1.45]],
        fadeOutSpeed: 0.35,
        speedOverLifetime: [[0, 1], [1, 0.2]],
        moveRange: 0,
        opacity: 0.82,
        gravity: 0,
        color: 0xffffff
      });
    }
  }

  spawnRibbon(spotIndex, vehicleId = null) {
    const root = this.spotRoots[spotIndex];
    if (!root) return;
    root.updateWorldMatrix(true, false);
    this.spawnSpotBurst(root, UNITY_EFFECTS.ribbon, this.textures.ribbon, true, undefined, this.effectsTuning.ribbon, vehicleId);
    const smokeCount = Math.round(randomRange(UNITY_EFFECTS.ribbonSmoke.burst));
    this.spawnSpotBurst(root, UNITY_EFFECTS.ribbonSmoke, this.textures.ribbonSmoke, false, smokeCount,
      this.effectsTuning.ribbonSmoke, vehicleId, 'full-completion-smoke');
  }

  spawnHit(vehicleId, targetId, contactDistance = 0, contactPosition = null) {
    const source = this.vehicleViews.get(vehicleId);
    const target = this.vehicleViews.get(targetId);
    if (!source) return;
    source.updateWorldMatrix(true, false);
    const sourcePosition = source.getWorldPosition(new THREE.Vector3());
    let origin;
    let direction;
    // The scene maps gameplay contacts onto the rendered vehicle or obstacle.
    const resolved = this.resolveHitContact
      ? this.resolveHitContact(vehicleId, { targetId, contactPosition })
      : null;
    const point = resolved ?? contactPosition;
    if (Number.isFinite(point?.x) && Number.isFinite(point?.z)) {
      origin = new THREE.Vector3(point.x, point.y ?? sourcePosition.y, point.z);
      direction = origin.clone().sub(sourcePosition).setY(0);
      if (direction.lengthSq() <= 1e-8) direction = new THREE.Vector3(0, 0, 1);
      else direction.normalize();
    } else {
      const sourceQuaternion = source.getWorldQuaternion(new THREE.Quaternion());
      direction = new THREE.Vector3(0, 0, 1).applyQuaternion(sourceQuaternion).normalize();
      origin = sourcePosition.clone().addScaledVector(
        direction,
        Math.max(0.12, Number(contactDistance) || 0) + 0.18
      );
    }
    const sourceHeight = source.userData.templateSize?.y * source.scale.y;
    const targetHeight = target?.userData.templateSize?.y * target?.scale.y;
    origin.y += sourceHeight > 0 && targetHeight > 0 ? Math.min(sourceHeight, targetHeight) * 0.5 : 0.42;
    for (const emitter of UNITY_EFFECTS.hit.emitters) this.spawnHitEmitter(origin, direction, emitter);
  }

  spawnHitEmitter(origin, direction, emitter) {
    const texture = this.textures[emitter.texture];
    if (!texture) return;
    if (!this.hitLayer.parent) this.scene.add(this.hitLayer);
    const baseAxis = direction.lengthSq() > 0 ? direction : new THREE.Vector3(0, 0, 1);
    const emitterRotation = new THREE.Quaternion().setFromEuler(new THREE.Euler(
      (emitter.localEuler?.[0] ?? 0) * DEG,
      (emitter.localEuler?.[1] ?? 0) * DEG,
      (emitter.localEuler?.[2] ?? 0) * DEG,
      'XYZ'
    ));
    const axis = baseAxis.clone().applyQuaternion(emitterRotation).normalize();
    const count = randomIntRange(emitter.burst);
    const sizeScale = hitEmitterSizeScale(this.effectsTuning.hit, emitter.name);
    for (let index = 0; index < count; index += 1) {
      const speed = randomRange(emitter.speed);
      const particleDirection = emitter.coneDegrees
        ? randomConeDirection(axis, emitter.coneDegrees)
        : new THREE.Vector3(0, 1, 0);
      this.addParticle({
        parent: this.hitLayer,
        effectKind: 'collision-hit',
        texture,
        position: origin.clone(),
        velocity: particleDirection.multiplyScalar(speed),
        lifetime: randomRange(emitter.lifetime),
        initialSize: randomRange(emitter.initialSize) * sizeScale,
        sizeOverLifetime: emitter.sizeOverLifetime,
        fadeOutSpeed: 0.35,
        speedOverLifetime: [[0, 1], [1, 1]],
        moveRange: 0,
        opacity: 1,
        gravity: 0,
        color: 0xffffff,
        blending: emitter.blending,
        delay: emitter.delay,
        colorOverLifetime: emitter.colorOverLifetime,
        spin: 0,
        rotation: randomRange(emitter.startRotation)
      });
    }
  }

  spawnSmokeTrailParticle(parent, effect, vehicleId = null) {
    parent.updateWorldMatrix(true, false);
    const tuning = smokeTrailTuning(this.effectsTuning);
    const position = parent.localToWorld(new THREE.Vector3(
      effect.localPosition[0],
      tuning.offsetY,
      tuning.offsetZ
    ));
    const spread = effect.shapeScale[0] * 0.08 * tuning.spread;
    const spreadY = effect.shapeScale[1] * 0.08 * tuning.spread;
    const spreadZ = effect.shapeScale[2] * 0.08 * tuning.spread;
    position.x += THREE.MathUtils.randFloatSpread(spread);
    position.y += THREE.MathUtils.randFloatSpread(spreadY);
    position.z += THREE.MathUtils.randFloatSpread(spreadZ);
    const parentRotation = parent.getWorldQuaternion(new THREE.Quaternion());
    const emitterRotation = new THREE.Quaternion().setFromEuler(new THREE.Euler(
      effect.localEuler[0] * DEG,
      effect.localEuler[1] * DEG,
      effect.localEuler[2] * DEG,
      'XYZ'
    ));
    const axis = new THREE.Vector3(0, 0, 1).applyQuaternion(parentRotation.multiply(emitterRotation));
    // Choose each variation once, so randomization never flickers per frame.
    const spinRandom = THREE.MathUtils.randFloatSpread(2);
    const spinDirectionRandom = Math.random();
    const rotation = THREE.MathUtils.randFloatSpread(Math.PI * 2) * tuning.rotationRandomness;
    const sizeMidpoint = (tuning.sizeMin + tuning.sizeMax) * 0.5;
    const randomSize = THREE.MathUtils.lerp(tuning.sizeMin, tuning.sizeMax, Math.random());
    this.addParticle({
      parent: this.scene,
      vehicleId, effectKind: 'driving-smoke',
      texture: this.textures.smokeTrail,
      atlas: effect.atlas,
      animatedAtlas: true,
      isSmokeTrail: true,
      position,
      velocity: axis.multiplyScalar(randomRange(effect.speed) * tuning.speedScale),
      lifetime: THREE.MathUtils.lerp(tuning.lifetimeMin, tuning.lifetimeMax, Math.random()),
      initialSize: THREE.MathUtils.lerp(sizeMidpoint, randomSize, tuning.sizeRandomness),
      sizeOverLifetime: effect.sizeOverLifetime,
      fadeOutSpeed: 0.35,
      speedOverLifetime: [[0, 1], [1, 1]],
      moveRange: 0,
      opacity: tuning.opacity,
      gravity: tuning.gravity,
      color: 0xffffff,
      blending: effect.blending,
      colorOverLifetime: effect.colorOverLifetime,
      spin: smokeTrailSpin(tuning.rotationSpeed * DEG, tuning.rotationRandomness, spinRandom, spinDirectionRandom),
      spinRandom,
      spinDirectionRandom,
      rotation
    });
  }

  spawnSpotBurst(root, effect, texture, rainbow, burst = effect.burst, tuning = null, vehicleId = null,
    effectKind = rainbow ? 'full-confetti' : null) {
    if (!texture) return;
    const position = root.localToWorld(new THREE.Vector3(...effect.localPosition));
    const rootRotation = root.getWorldQuaternion(new THREE.Quaternion());
    const emitterRotation = new THREE.Quaternion().setFromEuler(new THREE.Euler(
      effect.localEuler[0] * DEG,
      effect.localEuler[1] * DEG,
      effect.localEuler[2] * DEG,
      'XYZ'
    ));
    const axis = new THREE.Vector3(0, 0, 1).applyQuaternion(rootRotation.multiply(emitterRotation));
    for (let index = 0; index < burst; index += 1) {
      const velocity = randomConeDirection(axis, effect.coneDegrees).multiplyScalar(randomRange(effect.speed));
      this.addParticle({
        parent: this.scene,
        texture,
        effectKind,
        vehicleId,
        position: position.clone(),
        velocity,
        lifetime: randomRange(effect.lifetime),
        initialSize: randomRange(effect.initialSize),
        sizeOverLifetime: effect.sizeOverLifetime,
        fadeOutSpeed: effect.fadeOutSpeed,
        speedOverLifetime: effectTuningCurve(tuning, effect.speedOverLifetime),
        moveRange: effectMoveRange(tuning, effect.moveRange),
        opacity: rainbow ? 1 : 0.75,
        gravity: effect.gravity,
        color: rainbow ? new THREE.Color().setHSL(index / burst, 0.85, 0.62) : 0xffffff,
        atlas: effect.atlas,
        atlasFrame: effect.atlas ? index % effect.atlas.frames : undefined
      });
    }
  }

  addParticle({
    parent,
    texture,
    position,
    velocity,
    lifetime,
    initialSize,
    sizeOverLifetime,
    fadeOutSpeed,
    speedOverLifetime,
    moveRange,
    opacity,
    gravity,
    color,
    atlas,
    atlasFrame,
    animatedAtlas = false,
    isSmokeTrail = false,
    blending = 'normal',
    delay = 0,
    colorOverLifetime = null,
    spin = THREE.MathUtils.randFloatSpread(5),
    spinRandom = 0,
    spinDirectionRandom = 1,
    rotation = 0,
    toneMapped = true,
    effectKind = null,
    departureStarBaseSize = null,
    departureStarBase = null,
    vehicleId = null
  }) {
    const particleTexture = cloneAtlasFrame(texture, atlas, atlasFrame ?? 0);
    const material = new THREE.SpriteMaterial({
      map: particleTexture,
      color,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      depthTest: effectKind !== 'collision-hit',
      toneMapped,
      blending: blending === 'additive' ? THREE.AdditiveBlending : THREE.NormalBlending
    });
    material.rotation = rotation;
    const sprite = new THREE.Sprite(material);
    sprite.position.copy(position);
    sprite.scale.setScalar(initialSize * sampleParticleCurve(sizeOverLifetime, 0));
    parent.add(sprite);
    const initialSpeed = velocity.length();
    this.particles.push({
      sprite,
      material,
      velocity: velocity.clone(),
      direction: initialSpeed > 0 ? velocity.clone().divideScalar(initialSpeed) : new THREE.Vector3(0, 1, 0),
      initialSpeed,
      gravityVelocity: 0,
      origin: position.clone(),
      lifetime,
      initialSize,
      sizeOverLifetime,
      fadeOutSpeed,
      speedOverLifetime,
      moveRange,
      opacity,
      gravity,
      ownsTexture: particleTexture !== texture,
      animatedAtlas: animatedAtlas ? atlas : null,
      atlasFrame: atlasFrame ?? 0,
      isSmokeTrail,
      effectKind,
      departureStarBaseSize,
      departureStarBase,
      vehicleId,
      spin,
      spinRandom,
      spinDirectionRandom,
      delay,
      colorOverLifetime,
      useColorOverLifetime: Boolean(colorOverLifetime),
      age: 0
    });
  }
}
