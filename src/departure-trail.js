import * as THREE from 'three';
import { evaluateUnityCurve } from './vehicle-motion.js';

// BFT编辑器 / BusCrowdEffects: continuous world-space departure ribbon.
// Values are from its bft-effects-data.js, not a row of independent sprites.
export const DEPARTURE_TRAIL_EFFECT = Object.freeze({
  lifetime: 0.35, width: 0.8, minDistance: 0.1,
  color: [2.1016104, 0.7493922, 0], uvOffset: [-0.01, 0],
  widthCurve: [[0.050666656, 0, 1.0873575, 455.759],
    [0.052256998, 0.7248124, 455.759, 1.0190285],
    [0.32230598, 1, 0.013550701, 0.013550701], [1, 0.5734128, -0.5141098, -0.5141098]],
  alpha: [[0.027969787136644542, 0], [0.07287708857862212, 0.35686275], [1, 0.2784314]]
});
const MAX_POINTS = 256;
const keys = DEPARTURE_TRAIL_EFFECT.widthCurve.map(([time, value, inSlope, outSlope]) => ({ time, value, inSlope, outSlope }));
const setting = (tuning, key, fallback, min, max) => {
  const value = tuning?.[key];
  return Number.isFinite(value) ? THREE.MathUtils.clamp(value, min, max) : fallback;
};
function alphaAt(progress) {
  const values = DEPARTURE_TRAIL_EFFECT.alpha;
  if (progress <= values[0][0]) return values[0][1];
  for (let i = 1; i < values.length; i++) if (progress <= values[i][0]) {
    return THREE.MathUtils.lerp(values[i - 1][1], values[i][1],
      (progress - values[i - 1][0]) / (values[i][0] - values[i - 1][0]));
  }
  return values.at(-1)[1];
}

export class DepartureTrail {
  constructor({ scene, camera, vehicleViews, texture, anchor }) {
    Object.assign(this, { scene, camera, vehicleViews, texture, anchor });
    this.trails = new Map();
    this.time = 0;
    this.setTuning({});
  }
  setTuning(tuning) {
    const effect = DEPARTURE_TRAIL_EFFECT;
    this.config = {
      lifetime: effect.lifetime * setting(tuning, 'lifetimeScale', 1, 0.1, 4),
      width: effect.width * setting(tuning, 'widthScale', 1, 0, 4),
      opacity: setting(tuning, 'opacity', 1, 0, 1),
      color: new THREE.Color(...effect.color).multiply(new THREE.Color(setting(tuning, 'color', 0xffffff, 0, 0xffffff))).toArray(),
      offset: ['offsetX', 'offsetY', 'offsetZ'].map(key => setting(tuning, key, 0, -1.5, 1.5))
    };
  }
  clear() {
    for (const trail of this.trails.values()) this.disposeTrail(trail);
    this.trails.clear(); this.time = 0;
  }
  update(snapshot, tuning = {}) {
    this.begin(snapshot, tuning);
    if (this.texture) for (const vehicle of snapshot.vehicles ?? []) {
      const view = this.vehicleViews.get(vehicle.id);
      if (view && vehicle.state === 'departing') this.updateTrailHead(vehicle, view);
    }
    this.finish();
  }
  begin(snapshot, tuning = {}) {
    this.time = Number(snapshot.time) || 0;
    this.setTuning(tuning);
  }
  finish() {
    for (const [id, trail] of this.trails) {
      trail.points = trail.points.filter(point => this.time - point.time < this.config.lifetime);
      if (!trail.points.length) { this.disposeTrail(trail); this.trails.delete(id); continue; }
      this.renderTrail(trail);
    }
  }
  createTrail(id) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(MAX_POINTS * 6), 3).setUsage(THREE.DynamicDrawUsage));
    geometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(MAX_POINTS * 8), 4).setUsage(THREE.DynamicDrawUsage));
    geometry.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(MAX_POINTS * 4), 2).setUsage(THREE.DynamicDrawUsage));
    const indices = [];
    for (let i = 0; i < MAX_POINTS - 1; i++) {
      const vertex = i * 2;
      indices.push(vertex, vertex + 1, vertex + 2, vertex + 1, vertex + 3, vertex + 2);
    }
    geometry.setIndex(indices); geometry.setDrawRange(0, 0);
    const material = new THREE.MeshBasicMaterial({ map: this.texture, color: new THREE.Color(...this.config.color),
      transparent: true, opacity: this.config.opacity, depthWrite: false, side: THREE.DoubleSide,
      vertexColors: true, blending: THREE.AdditiveBlending, toneMapped: false });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = `BFT departure trail ${id}`; mesh.frustumCulled = false; this.scene.add(mesh);
    const trail = { mesh, points: [], lastAnchor: null };
    this.trails.set(id, trail); return trail;
  }
  updateTrailHead(vehicle, view) {
    const offset = Object.fromEntries(['offsetX', 'offsetY', 'offsetZ'].map((key, i) => [key, this.config.offset[i]]));
    const anchor = this.anchor(view, vehicle, offset);
    const trail = this.trails.get(vehicle.id) ?? this.createTrail(vehicle.id);
    trail.points = trail.points.filter(point => !point.head);
    const previous = trail.lastAnchor;
    if (previous && previous.world.distanceToSquared(anchor.world) > 1e-12) {
      const distance = previous.world.distanceTo(anchor.world);
      const count = Math.min(64, Math.floor(distance / (DEPARTURE_TRAIL_EFFECT.minDistance * anchor.worldUnit)));
      for (let i = 1; i <= count; i++) {
        const ratio = i * DEPARTURE_TRAIL_EFFECT.minDistance * anchor.worldUnit / distance;
        trail.points.push({ world: previous.world.clone().lerp(anchor.world, ratio),
          time: THREE.MathUtils.lerp(previous.time, this.time, ratio), unit: anchor.worldUnit });
      }
      if (count) { const last = trail.points.at(-1); trail.lastAnchor = { world: last.world.clone(), time: last.time }; }
      trail.points.push({ world: anchor.world.clone(), time: this.time, unit: anchor.worldUnit, head: true });
    } else if (!previous) trail.points.push({ world: anchor.world.clone(), time: this.time, unit: anchor.worldUnit });
    if (!previous) trail.lastAnchor = { world: anchor.world.clone(), time: this.time };
    if (trail.points.length > MAX_POINTS) trail.points.splice(0, trail.points.length - MAX_POINTS);
  }
  renderTrail(trail) {
    const config = this.config, mesh = trail.mesh, points = trail.points, geometry = mesh.geometry;
    mesh.material.color.setRGB(...config.color); mesh.material.opacity = config.opacity;
    geometry.setDrawRange(0, Math.max(0, points.length - 1) * 6);
    if (points.length < 2) return;
    const camera = this.camera?.getWorldPosition(new THREE.Vector3()) ?? new THREE.Vector3(0, 12, 8);
    const positions = geometry.getAttribute('position'), colors = geometry.getAttribute('color'), uvs = geometry.getAttribute('uv');
    const length = points.reduce((sum, point, i) => i ? sum + point.world.distanceTo(points[i - 1].world) : 0, 0);
    let distance = 0;
    for (let i = 0; i < points.length; i++) {
      const point = points[i];
      if (i) distance += point.world.distanceTo(points[i - 1].world);
      const progress = 1 - distance / Math.max(length, 1e-6);
      const tangent = points[Math.min(i + 1, points.length - 1)].world.clone().sub(points[Math.max(0, i - 1)].world).normalize();
      const normal = new THREE.Vector3().crossVectors(tangent, camera.clone().sub(point.world).normalize()).normalize();
      const halfWidth = config.width * evaluateUnityCurve(keys, THREE.MathUtils.clamp(progress, 0, 1)) * point.unit * 0.5;
      const alpha = alphaAt(progress);
      for (let side = 0; side < 2; side++) {
        const index = i * 2 + side;
        const local = this.scene.worldToLocal(point.world.clone().addScaledVector(normal, halfWidth * (side ? 1 : -1)));
        positions.setXYZ(index, local.x, local.y, local.z); colors.setXYZW(index, 1, 1, 1, alpha);
        uvs.setXY(index, progress + DEPARTURE_TRAIL_EFFECT.uvOffset[0], side);
      }
    }
    positions.needsUpdate = colors.needsUpdate = uvs.needsUpdate = true;
  }
  disposeTrail(trail) {
    trail.mesh.removeFromParent(); trail.mesh.geometry.dispose(); trail.mesh.material.dispose();
  }
}
