import * as THREE from 'three';
import { evaluateUnityCurve } from './vehicle-motion.js';
import { DepartureTrail } from './departure-trail.js';
import { DEPARTURE_STAR_DEFAULTS } from './vehicle-effect-assets.js';

// Original star_01 / eff_yan_caise settings from the supplied reference editor.
// Four-element keys retain Unity's incoming/outgoing tangents, not linear ramps.
export const DEPARTURE_STAR_EFFECT = Object.freeze({
  duration: 1,
  rateOverDistance: 9,
  emissionCurve: [[0, 0.39041138, 0.6095886, 0.6095886], [1, 1, 0.6095886, 0.6095886]],
  lifetime: [0.25, 0.4],
  speed: [0.45, 0.25],
  size: [0.1, 0.25],
  rotation: [0, 6.283185],
  spin: [-1.5707963, 1.5707963],
  radius: 0.03,
  mount: [0, 0.21, -0.15],
  sizeCurve: [[0, 0.65251136, 1.5791423, 1.5791423],
    [0.32784963, 1, 0.008494311, 0.008494311],
    [1, 0.080581665, -2.1997929, -2.1997929]],
  colorOverLifetime: [0, 0.06590371557183185, 0.41893644617380027, 1].map((t, i) => ({
    t, color: [1.0717734, 0.7838845, 0.638861], alpha: i === 0 ? 0 : 1
  })),
  sourceDepth: { 4: 0.9830938153013711, 6: 1.2093046278573434, 10: 1.5729418423909518,
    ambulance: 1.18880437905002, police: 0.9767275804473069, firetruck: 1.5953032983473907 },
  sourceOrigin: {
    4: [-3.814697265625e-8, -0.0012205852301063276, -0.0387624643509087],
    6: [7.62939453125e-8, -0.0014214530472096655, -0.010338580762076362],
    10: [0.0010514640808105468, 0.0010489215400383096, -0.000009486473515636363],
    ambulance: [0, 0.0003595765106547044, -9.20788767899694e-9],
    police: [2.2694066501571796e-8, -0.0011856901266832328, 0.003661069529736949],
    firetruck: [3.910618033842184e-9, -0.0011005107290808932, -2.3237688395738586e-8]
  }
});

export function sampleParticleCurve(keys, progress) {
  if (!keys?.length) return 1;
  if (typeof keys[0] === 'object' && !Array.isArray(keys[0])) return evaluateUnityCurve(keys, progress);
  if (!Array.isArray(keys[0])) return keys[0];
  if (keys.some(key => key.length > 2)) return evaluateUnityCurve(keys.map(([time, value, inSlope = 0, outSlope = inSlope]) => (
    { time, value, inSlope, outSlope }
  )), THREE.MathUtils.clamp(progress, 0, 1));
  if (progress <= keys[0][0]) return keys[0][1];
  if (progress >= keys.at(-1)[0]) return keys.at(-1)[1];
  const index = keys.findIndex(key => progress <= key[0]);
  const a = keys[index - 1], b = keys[index];
  const duration = Math.max(0.0001, b[0] - a[0]);
  const t = (progress - a[0]) / duration;
  return THREE.MathUtils.lerp(a[1], b[1], t);
}

const random = range => THREE.MathUtils.lerp(range[0], range[1], Math.random());
const value = (tuning, key, fallback) => Number.isFinite(tuning?.[key]) ? tuning[key] : fallback;
const scale = (tuning, key) => Math.max(0, value(tuning, key, 1));
export const departureStarSizeScale = tuning => Math.min(4, scale(tuning, 'sizeScale'));
export function departureStarTuning(tuning = {}) {
  return Object.fromEntries(Object.entries(DEPARTURE_STAR_DEFAULTS).map(([key, fallback]) => {
    const min = key.startsWith('offset') ? -1.5 : key === 'lifetimeScale' ? 0.1 : 0;
    const max = key.startsWith('offset') ? 1.5 : key === 'opacity' ? 1 : key === 'color' ? 0xffffff : 4;
    return [key, THREE.MathUtils.clamp(value(tuning, key, fallback), min, max)];
  }));
}
export function departureStarColors(tuning) {
  const tint = new THREE.Color(tuning.color).toArray();
  return DEPARTURE_STAR_EFFECT.colorOverLifetime.map(key => ({ ...key,
    color: key.color.map((channel, i) => channel * tint[i]) }));
}

export class DepartureStars {
  constructor({ scene, vehicleViews, texture, addParticle, camera = null, trailTexture = null }) {
    Object.assign(this, { scene, vehicleViews, texture, addParticle });
    this.emitters = new Map();
    this.trail = new DepartureTrail({ scene, camera, vehicleViews, texture: trailTexture,
      anchor: (view, vehicle, tuning) => this.anchor(view, vehicle, tuning) });
    this.trails = this.trail.trails;
  }

  clear() { this.emitters.clear(); this.trail.clear(); }

  anchor(view, vehicle, tuning) {
    tuning = departureStarTuning(tuning);
    const effect = DEPARTURE_STAR_EFFECT;
    const kind = Number.isInteger(vehicle.ambulanceStepLimit) ? 'ambulance'
      : vehicle.mechanism?.type === 'firetruck' || Number.isInteger(vehicle.firetruckTimeLimit) ? 'firetruck'
        : vehicle.mechanism?.type === 'police' || vehicle.colorIndex === 11 ? 'police' : vehicle.seats;
    const sourceDepth = effect.sourceDepth[kind] ?? effect.sourceDepth[4];
    const unit = (view.userData.templateSize?.z ?? 1.05) / sourceDepth;
    const local = new THREE.Vector3(...effect.mount)
      .sub(new THREE.Vector3(...(effect.sourceOrigin[kind] ?? effect.sourceOrigin[4])))
      .add(new THREE.Vector3(...['offsetX', 'offsetY', 'offsetZ'].map(key => value(tuning, key, 0))))
      .multiplyScalar(unit);
    view.updateWorldMatrix(true, false);
    return { world: view.localToWorld(local),
      rotation: view.getWorldQuaternion(new THREE.Quaternion()),
      worldUnit: Math.max(1e-6, unit * Math.abs(view.getWorldScale(new THREE.Vector3()).x)) };
  }

  update(snapshot, delta, tuning = {}, trailTuning = {}) {
    tuning = departureStarTuning(tuning);
    this.trail.begin(snapshot, trailTuning);
    const active = new Set();
    for (const vehicle of snapshot.vehicles ?? []) {
      if (vehicle.state !== 'departing' || vehicle.surplusReleased) continue;
      const view = this.vehicleViews.get(vehicle.id);
      if (!view) continue;
      if (this.texture) { active.add(vehicle.id); this.updateEmitter(vehicle, view, delta, tuning); }
      if (this.trail.texture) this.trail.updateTrailHead(vehicle, view);
    }
    for (const id of this.emitters.keys()) if (!active.has(id)) this.emitters.delete(id);
    this.trail.finish();
  }

  updateEmitter(vehicle, view, delta, tuning) {
      const effect = DEPARTURE_STAR_EFFECT;
      const anchor = this.anchor(view, vehicle, tuning);
      const signature = ['offsetX', 'offsetY', 'offsetZ'].map(key => value(tuning, key, 0)).join(',');
      let emitter = this.emitters.get(vehicle.id);
      if (!emitter) {
        emitter = { previous: anchor.world.clone(), elapsed: 0, remainder: 0, signature };
        this.emitters.set(vehicle.id, emitter);
        return;
      }
      if (emitter.signature !== signature) { emitter.previous = null; emitter.signature = signature; }
      emitter.elapsed += delta;
      if (!emitter.previous) { emitter.previous = anchor.world.clone(); return; }
      const previous = emitter.previous.clone();
      emitter.previous.copy(anchor.world);
      if (delta <= 0) return;
      const distance = previous.distanceTo(anchor.world) / anchor.worldUnit;
      const total = emitter.remainder + distance * effect.rateOverDistance * scale(tuning, 'rateScale')
        * sampleParticleCurve(effect.emissionCurve, (emitter.elapsed % effect.duration) / effect.duration);
      const count = Math.min(80, Math.floor(total));
      emitter.remainder = total - Math.floor(total);
      for (let i = 0; i < count; i++) {
        this.spawn({ ...anchor, world: previous.clone().lerp(anchor.world, (i + 0.5) / count) }, tuning);
      }
  }

  spawn(anchor, tuning) {
    tuning = departureStarTuning(tuning);
    const effect = DEPARTURE_STAR_EFFECT;
    const direction = new THREE.Vector3().randomDirection().applyQuaternion(anchor.rotation);
    this.scene.updateWorldMatrix(true, false);
    const world = anchor.world.clone().addScaledVector(direction,
      effect.radius * scale(tuning, 'spreadScale') * anchor.worldUnit * Math.cbrt(Math.random()));
    const position = this.scene.worldToLocal(world.clone());
    const velocity = this.scene.worldToLocal(world.clone()
      .addScaledVector(direction, random(effect.speed) * anchor.worldUnit)).sub(position);
    const sceneScale = Math.max(1e-6, Math.abs(this.scene.getWorldScale(new THREE.Vector3()).x));
    const baseLifetime = random(effect.lifetime);
    const departureStarBaseSize = random(effect.size) * anchor.worldUnit / sceneScale;
    const departureStarBase = { size: departureStarBaseSize, lifetime: baseLifetime,
      speed: velocity.length(), direction: velocity.clone().normalize() };
    velocity.multiplyScalar(scale(tuning, 'speedScale'));
    this.addParticle({ parent: this.scene, texture: this.texture, position, velocity,
      lifetime: baseLifetime * Math.max(0.1, scale(tuning, 'lifetimeScale')),
      initialSize: departureStarBaseSize * departureStarSizeScale(tuning), departureStarBaseSize, departureStarBase,
      sizeOverLifetime: effect.sizeCurve, colorOverLifetime: departureStarColors(tuning),
      speedOverLifetime: [[0, 1], [1, 1]], gravity: 0, moveRange: 0,
      opacity: THREE.MathUtils.clamp(value(tuning, 'opacity', 1), 0, 1), color: 0xffffff,
      blending: 'additive', toneMapped: false, fadeOutSpeed: 0.2,
      rotation: random(effect.rotation), spin: random(effect.spin), effectKind: 'departure-star' });
  }
}
