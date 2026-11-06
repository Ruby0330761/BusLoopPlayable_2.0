import * as THREE from 'three';
import { gunzipSync } from 'three/addons/libs/fflate.module.js';
import { FOOTAGE8_LAYOUT } from './generated-footage8-layout.js';
import { Footage8Surface } from './footage8-surface.js';

export const FOOTAGE8_DEFAULT_TUNING = Object.freeze({
  positionX: 0, positionY: 0.025, positionZ: -2.2,
  scale: 2, rotationYDegrees: 0,
  rowSpacing: 0.2, speed: 0.8, initialFillSpeedMultiplier: 4,
  passengerSizeMultiplier: 1.2, roadJoinLanding: .14, roadJoinSteps: 3,
  presentationRevision: 2, footClearance: 0.008, roadJoinEnabled: 1, roadJoinExtension: -0.18,
  boardingPositionPercent: 30, boardingWidthPercent: 6, showBoardingZone: 1
});

export function getFootage8PassengerSizeMultiplier(layoutId, tuning = {}) {
  return layoutId === 'footage8'
    ? THREE.MathUtils.clamp(Number(tuning.passengerSizeMultiplier) || FOOTAGE8_DEFAULT_TUNING.passengerSizeMultiplier, .75, 1.6)
    : 1;
}

export function getFootage8RuntimeConfig(curve, tuning = {}, defaults = FOOTAGE8_DEFAULT_TUNING) {
  const value = (key) => Number.isFinite(Number(tuning[key])) ? Number(tuning[key]) : defaults[key];
  const capacity = THREE.MathUtils.clamp(Math.round(curve.getLength() / Math.max(0.12, value('rowSpacing'))), 8, 200);
  const center = value('boardingPositionPercent') / 100;
  const halfWidth = THREE.MathUtils.clamp(value('boardingWidthPercent'), 1, 40) / 200;
  const wrap = (v) => ((v % 1) + 1) % 1;
  return {
    capacity,
    continuousSpeed: THREE.MathUtils.clamp(value('speed'), 0.1, 3),
    initialFillSpeedMultiplier: THREE.MathUtils.clamp(value('initialFillSpeedMultiplier'), 1, 8),
    exitStart: wrap(center - halfWidth), exitEnd: wrap(center + halfWidth)
  };
}

export function getFootage8QueueSpacing(slotSpacing, passengerScale = 1.25) {
  // Waiting rows need room to turn while the next row advances at the cadence
  // of the denser belt. This spacing does not determine the release interval.
  return Math.max(slotSpacing, passengerScale * 0.256);
}

// Keep the authored queue heads outside the circulating lane. A vacant belt
// slot is reserved alongside the head, then both advance to a downstream join.
export function connectFootage8Queues(belt, queuePoints) {
  return queuePoints.map((points) => {
    const queue = new THREE.CatmullRomCurve3(points, false, 'catmullrom', 0.35);
    let entryPercent = 0;
    let nearest = Infinity;
    for (let i = 0; i < 4096; i += 1) {
      const distance = belt.getPointAt(i / 4096).distanceToSquared(points[0]);
      if (distance < nearest) { nearest = distance; entryPercent = i / 4096; }
    }
    const mergeDistance = Math.sqrt(nearest) * 1.6;
    return { curve: queue, releasePercent: entryPercent, mergeDistance,
      entryPercent: (entryPercent + mergeDistance / belt.getLength()) % 1 };
  });
}

export function getFootage8MergePose(belt, queue, entryPercent, mergeDistance, remainingDistance) {
  const phase = THREE.MathUtils.clamp(1 - remainingDistance / mergeDistance, 0, 1);
  const wrap = (v) => ((v % 1) + 1) % 1;
  const length = belt.getLength();
  const start = wrap(entryPercent - mergeDistance / length);
  const progress = wrap(start + phase * mergeDistance / length);
  const tangent = belt.getTangentAt(progress);
  const startTangent = belt.getTangentAt(start);
  const forward = new THREE.Vector3(tangent.x, 0, tangent.z).normalize();
  const startForward = new THREE.Vector3(startTangent.x, 0, startTangent.z).normalize();
  const normal = new THREE.Vector3(tangent.z, 0, -tangent.x).normalize();
  const startNormal = new THREE.Vector3(startTangent.z, 0, -startTangent.x).normalize();
  const offset = queue.getPointAt(0).sub(belt.getPointAt(start));
  const align = THREE.MathUtils.smoothstep(phase, 0.05, 0.3)
    * (1 - THREE.MathUtils.smoothstep(phase, 0.6, 0.9));
  const fade = 1 - THREE.MathUtils.smoothstep(phase, 0, 1);
  const advance = Math.sin(Math.PI * THREE.MathUtils.clamp(phase / 0.4, 0, 1)) ** 2;
  const position = belt.getPointAt(progress)
    // Move clear of the following queue row before turning, then bring the
    // whole four-person row inboard. A centre-only path leaves the outer feet
    // beyond the mesh edge during the middle of the turn.
    .addScaledVector(normal, offset.dot(startNormal) * fade * (1 - 0.4 * align))
    .addScaledVector(forward, offset.dot(startForward) * fade + mergeDistance / 12 * advance);
  position.y += offset.y * fade;
  // Turn while still outside the lane, then slide in aligned with the reserved
  // row. Rotating a four-person row across the lane sweeps into its neighbours.
  const incoming = queue.getTangentAt(0).negate();
  const turn = THREE.MathUtils.smoothstep(phase, 0, 0.3);
  const yaw0 = Math.atan2(incoming.x, incoming.z);
  const yaw1 = Math.atan2(tangent.x, tangent.z);
  const yaw = yaw0 + Math.atan2(Math.sin(yaw1 - yaw0), Math.cos(yaw1 - yaw0)) * turn;
  // Step closer while turning through the entrance throat, then spread back
  // to the normal four-person row. Bodies keep their original model scale.
  const widthScale = 1 - 0.25 * THREE.MathUtils.smoothstep(phase, 0, 0.12)
    * (1 - THREE.MathUtils.smoothstep(phase, 0.45, 0.75));
  return { position, tangent: new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw)), widthScale };
}

export class Footage8BoardingPreview {
  constructor() {
    this.root = new THREE.Group();
    this.root.name = 'Footage8 boarding zone (editor only)';
    this.root.visible = false;
  }

  update(curve, tuning, visible, defaults = FOOTAGE8_DEFAULT_TUNING) {
    this.root.visible = Boolean(visible && tuning?.showBoardingZone);
    if (!this.root.visible) return;
    for (const child of [...this.root.children]) {
      child.geometry?.dispose();
      child.material?.dispose();
      this.root.remove(child);
    }
    const config = getFootage8RuntimeConfig(curve, tuning, defaults);
    const width = (config.exitEnd - config.exitStart + 1) % 1;
    const points = Array.from({ length: 65 }, (_, i) => {
      const p = curve.getPointAt((config.exitStart + width * i / 64) % 1);
      p.y += 0.07;
      return p;
    });
    const material = (color, opacity = 1) => new THREE.MeshBasicMaterial({
      color, transparent: true, opacity, depthTest: false, depthWrite: false
    });
    const band = new THREE.Mesh(
      new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points), 64, 0.035, 6, false), material(0xffdf3d)
    );
    band.renderOrder = 1000;
    this.root.add(band);
    for (const [point, color] of [[points[0], 0x38ed8a], [points.at(-1), 0xff893b]]) {
      const marker = new THREE.Mesh(new THREE.SphereGeometry(0.09, 12, 8), material(color));
      marker.position.copy(point);
      marker.renderOrder = 1001;
      this.root.add(marker);
    }
    const center = points[32];
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.14, 0.18, 32), material(0xffdf3d));
    ring.rotation.x = -Math.PI / 2;
    ring.position.copy(center);
    ring.renderOrder = 1001;
    this.root.add(ring);
  }
}

export function getFootage8DisplayMatrix(tuning = {}, layout = FOOTAGE8_LAYOUT, defaults = FOOTAGE8_DEFAULT_TUNING) {
  const value = (key) => Number.isFinite(Number(tuning[key])) ? Number(tuning[key]) : defaults[key];
  const scale = Math.max(0.1, value('scale'));
  return new THREE.Matrix4()
    .makeTranslation(value('positionX'), value('positionY'), value('positionZ'))
    .multiply(new THREE.Matrix4().makeRotationY(THREE.MathUtils.degToRad(value('rotationYDegrees'))))
    .multiply(new THREE.Matrix4().makeScale(scale, scale, -scale))
    .multiply(new THREE.Matrix4().makeTranslation(...layout.pivot.map((v) => -v)));
}

export function getFootage8Paths(tuning, layout = FOOTAGE8_LAYOUT, defaults = FOOTAGE8_DEFAULT_TUNING) {
  const matrix = getFootage8DisplayMatrix(tuning, layout, defaults);
  const map = (points) => points.map((p) => new THREE.Vector3(...p).applyMatrix4(matrix));
  return { belt: map(layout.points3D), queues: layout.queuePoints3D.map(map) };
}

// Geometry is converted once from the supplied FBX. Both road meshes and all
// passenger splines use this one matrix, including height and the Z mirror.
export class Footage8ConveyorView {
  constructor(manager, layout = FOOTAGE8_LAYOUT, defaults = FOOTAGE8_DEFAULT_TUNING) {
    this.manager = manager;
    this.layout = layout;
    this.defaults = defaults;
    this.root = new THREE.Group();
    this.root.name = `${layout.id} Conveyor`;
    this.root.visible = false;
    this.root.matrixAutoUpdate = false;
    this.ready = false;
    this.error = null;
    this.loadPromise = null;
  }

  update(tuning, visible) {
    this.root.visible = visible;
    this.root.matrix.copy(getFootage8DisplayMatrix(tuning, this.layout, this.defaults));
    this.surfaceInverse = this.root.matrix.clone().invert();
    this.root.matrixWorldNeedsUpdate = true;
    if (visible) void this.load().catch((error) => {
      this.error = error.message;
      console.error(`${this.layout.id} track failed to load:`, error);
    });
  }

  load() {
    if (this.loadPromise) return this.loadPromise;
    this.loadPromise = this.loadMeshes().catch((error) => {
      this.loadPromise = null;
      throw error;
    });
    return this.loadPromise;
  }

  async loadMeshes() {
    const url = this.layout.assets.model;
    this.manager.itemStart(url);
    try {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`${this.layout.id} mesh HTTP ${response.status}`);
      const source = new Uint8Array(await response.arrayBuffer());
      const decoded = source[0] === 0x1f && source[1] === 0x8b ? gunzipSync(source) : source;
      const payload = JSON.parse(new TextDecoder().decode(decoded));
      const textures = new THREE.TextureLoader(this.manager);
      const geometryLoader = new THREE.BufferGeometryLoader();
      const meshes = await Promise.all(payload.meshes.map(async (item) => {
        // Keep texture URLs in the JS catalog so single-HTML packaging can
        // replace them. URLs hidden inside the compressed mesh cannot inline.
        const map = await textures.loadAsync(item.shadow
          ? this.layout.assets.shadowTexture : this.layout.assets.loopScene);
        map.colorSpace = THREE.SRGBColorSpace;
        const material = item.shadow
          ? new THREE.MeshBasicMaterial({ map, transparent: true, opacity: 0.419, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1 })
          : new THREE.MeshStandardMaterial({ map, roughness: 1, metalness: 0 });
        const mesh = new THREE.Mesh(geometryLoader.parse(item.geometry), material);
        if (!item.shadow) this.surface = new Footage8Surface(mesh.geometry, 0.15, { roadOnly: true });
        mesh.name = item.name;
        return mesh;
      }));
      this.root.add(...meshes);
      this.ready = true;
      this.error = null;
    } catch (error) {
      this.manager.itemError(url);
      throw error;
    } finally {
      this.manager.itemEnd(url);
    }
  }
}
