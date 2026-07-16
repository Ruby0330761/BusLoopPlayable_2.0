import * as THREE from 'three';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { COLORS, LEVEL_1, PASSENGER_COUNT_BOARD_COLORS } from './level-data.js';
import {
  MAX_CONVEYOR_CAPACITY,
  MAX_QUEUE_CAPACITY,
  getConveyorLayout
} from './conveyor-layouts.js';
import { SCENE_TUNING } from './scene-tuning.js';
import { VehicleEffects } from './vehicle-effects.js';
import {
  calculateDesignCoverHalfHeight,
  calculateOrthographicHalfHeight,
  calculatePerspectiveDistance,
  evaluateDreamteckClosedBSpline,
  resolveCameraFit,
  resolveResponsiveCropFit,
  transformCurveCoordinates
} from './scene-layout.js';
import {
  UNITY_CURVES,
  UNITY_VEHICLE_MOTION,
  chooseHitClip,
  evaluatePath,
  evaluateUnityCurve,
  forwardFromYaw,
  sampleHitClip,
  buildRoundedPath,
  buildToStationPoints,
  buildOutStationPoints
} from './vehicle-motion.js';

const ease = (t) => 1 - Math.pow(1 - t, 3);
const deg = (value) => THREE.MathUtils.degToRad(value);
const ARROW_OUTLINE_SCALE = 1.28;
const GUIDE_HAND_TEXTURE_URL = '/assets/applovin/main-guide-hand_q80.webp';
const DEFAULT_CONVEYOR_LAYOUT_ID = 'dualQueue2';
const PASSENGER_DEFAULT_MATERIAL_COLORS = Object.freeze([
  { baseColor: 0xffffff, emissionColor: 0x36a6ff },
  { baseColor: 0xffffff, emissionColor: 0xadd98a },
  { baseColor: 0xff6331, emissionColor: 0xd445ac },
  { baseColor: 0xffffff, emissionColor: 0xc474fd },
  { baseColor: 0xffffff, emissionColor: 0xc57272 },
  { baseColor: 0xffffff, emissionColor: 0xa49584 },
  { baseColor: 0xffffff, emissionColor: 0xc09d9d },
  { baseColor: 0xffffff, emissionColor: 0x65c1e2 },
  { baseColor: 0xffffff, emissionColor: 0xd68c8c },
  { baseColor: 0xffffff, emissionColor: 0x4a4a4a },
  { baseColor: 0xffffff, emissionColor: 0x8b7caf }
]);
const scratchPassengerBaseColor = new THREE.Color();
const scratchPassengerEmissionColor = new THREE.Color();

function setPassengerMaterialMaps(material, map, emissiveMap) {
  const nextMap = map ?? null;
  const nextEmissiveMap = emissiveMap ?? null;
  const mapChanged = material.map !== nextMap || material.emissiveMap !== nextEmissiveMap;
  material.map = nextMap;
  material.emissiveMap = nextEmissiveMap;
  if (mapChanged) material.needsUpdate = true;
}

function directionalLightDirection(eulerDegrees) {
  return new THREE.Vector3(0, 0, 1)
    .applyEuler(new THREE.Euler(
      deg(eulerDegrees.x ?? 0),
      deg(eulerDegrees.y ?? 0),
      deg(eulerDegrees.z ?? 0),
      'XYZ'
    ))
    .normalize();
}

function deepMerge(target, source) {
  for (const [key, value] of Object.entries(source ?? {})) {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      target[key] ??= {};
      deepMerge(target[key], value);
    } else {
      target[key] = value;
    }
  }
  return target;
}

function rotateVehicleAreaPoint(x, z) {
  const area = SCENE_TUNING.vehicleArea;
  const rotation = deg(area.rotationDegrees);
  const deltaX = x - area.pivotX;
  const deltaZ = z - area.pivotZ;
  return new THREE.Vector2(
    area.pivotX + deltaX * Math.cos(rotation) - deltaZ * Math.sin(rotation),
    area.pivotZ + deltaX * Math.sin(rotation) + deltaZ * Math.cos(rotation)
  );
}

function mapVehicleAreaPoint(vehicle) {
  const area = SCENE_TUNING.vehicleArea;
  const unitScale = area.positionUnitScale ?? LEVEL_1.mapScale;
  const scaledX = (vehicle.x - area.positionPivotX) * unitScale + area.positionPivotX;
  const scaledZ = (vehicle.z - area.positionPivotZ) * unitScale + area.positionPivotZ;
  const unityX = area.sourceRootX + scaledX;
  const unityZ = area.sourceRootZ + scaledZ;
  return rotateVehicleAreaPoint(
    unityX * area.unityToWorldScale + area.offsetX,
    unityZ * area.unityToWorldScale * (area.mirrorZ ? -1 : 1) + area.offsetZ
  );
}

function mapMotionPoint(value, y = SCENE_TUNING.vehicleArea.y) {
  const mapped = mapVehicleAreaPoint(value);
  return new THREE.Vector3(mapped.x, y, mapped.y);
}

function mapMotionTangentYaw(tangent, reverse = false) {
  const direction = reverse ? { x: -tangent.x, z: -tangent.z } : tangent;
  const sourceYaw = Math.atan2(direction.x, direction.z) * 180 / Math.PI;
  return mapVehicleAreaYaw(sourceYaw) + deg(SCENE_TUNING.facing.vehicleYawOffsetDegrees);
}

function mapVehicleAreaYaw(yawDegrees) {
  const sourceYaw = deg(yawDegrees);
  const mirroredYaw = SCENE_TUNING.vehicleArea.mirrorZ ? Math.PI - sourceYaw : sourceYaw;
  return mirroredYaw + deg(SCENE_TUNING.vehicleArea.rotationDegrees);
}

function toWorldPoint([x, z]) {
  const tuning = SCENE_TUNING.path;
  return new THREE.Vector3(
    x * tuning.scaleX + tuning.offsetX,
    tuning.groundY,
    (tuning.centerZ - z) * tuning.scaleZ + tuning.offsetZ
  );
}
function makeTunedCurvePoints(points, tuning, anchorMode) {
  const worldPoints = points.map((point) => toWorldPoint(point));
  const coordinates = transformCurveCoordinates(worldPoints, tuning, anchorMode);
  return worldPoints.map((point, index) => new THREE.Vector3(
    coordinates[index].x,
    point.y,
    coordinates[index].z
  ));
}

function getSelectedConveyorLayout() {
  return getConveyorLayout(SCENE_TUNING.conveyorLayout?.selected ?? DEFAULT_CONVEYOR_LAYOUT_ID);
}

function getSelectedConveyorTuning(layoutId = getSelectedConveyorLayout().id) {
  return SCENE_TUNING.conveyorLayouts?.[layoutId] ?? {
    art: SCENE_TUNING.conveyorArt,
    curve: SCENE_TUNING.conveyorCurve,
    queueCurves: SCENE_TUNING.queueCurves
  };
}

function cloneCurvePoint(point) {
  return new THREE.Vector3(point.x, point.y, point.z);
}

export class DreamteckClosedBSplineCurve3 extends THREE.Curve {
  constructor(points) {
    super();
    this.type = 'DreamteckClosedBSplineCurve3';
    this.points = points.map(cloneCurvePoint);
  }

  getPoint(progress, target = new THREE.Vector3()) {
    const point = evaluateDreamteckClosedBSpline(this.points, progress);
    return target.set(point.x, point.y, point.z);
  }
}

export function makeClosedConveyorCurve(points, splineType) {
  if (splineType === 'bSpline') {
    return new DreamteckClosedBSplineCurve3(points);
  }
  return new THREE.CatmullRomCurve3(
    points.map(cloneCurvePoint),
    true,
    'catmullrom',
    0.35
  );
}

function makeOpenCurve(points) {
  const curvePoints = points.length >= 2
    ? points.map(cloneCurvePoint)
    : [cloneCurvePoint(points[0] ?? new THREE.Vector3()), cloneCurvePoint(points[0] ?? new THREE.Vector3())];
  return new THREE.CatmullRomCurve3(curvePoints, false, 'catmullrom', 0.35);
}

function makeSubCurve(curve, startProgress, endProgress) {
  const start = THREE.MathUtils.clamp(startProgress, 0, 1);
  const end = THREE.MathUtils.clamp(endProgress, start, 1);
  const samples = Math.max(8, Math.ceil((end - start) * 36));
  const points = [];
  for (let i = 0; i <= samples; i += 1) {
    const t = start + (end - start) * (i / samples);
    points.push(curve.getPointAt(t));
  }
  return makeOpenCurve(points);
}


function configureColorTexture(texture) {
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.needsUpdate = true;
  return texture;
}

function applyPassengerUnityMaterial(material, colorIndex, map) {
  const materialTuning = SCENE_TUNING.passengerMaterial ?? {};
  const colorTuning = materialTuning.colors?.[colorIndex] ?? {};
  const defaults = PASSENGER_DEFAULT_MATERIAL_COLORS[colorIndex] ?? PASSENGER_DEFAULT_MATERIAL_COLORS[0];
  const baseStrength = THREE.MathUtils.clamp(materialTuning.baseColorStrength ?? 1, 0, 2);
  const brightness = THREE.MathUtils.clamp(materialTuning.brightness ?? 1, 0, 3);
  const emissionStrength = THREE.MathUtils.clamp(materialTuning.emissionStrength ?? 1, 0, 5);
  scratchPassengerBaseColor.setHex(colorTuning.baseColor ?? defaults.baseColor);
  scratchPassengerEmissionColor.setHex(colorTuning.emissionColor ?? defaults.emissionColor);
  setPassengerMaterialMaps(material, map, map);
  material.color.setRGB(
    THREE.MathUtils.clamp(THREE.MathUtils.lerp(1, scratchPassengerBaseColor.r, baseStrength) * brightness, 0, 3),
    THREE.MathUtils.clamp(THREE.MathUtils.lerp(1, scratchPassengerBaseColor.g, baseStrength) * brightness, 0, 3),
    THREE.MathUtils.clamp(THREE.MathUtils.lerp(1, scratchPassengerBaseColor.b, baseStrength) * brightness, 0, 3)
  );
  material.emissive.copy(scratchPassengerEmissionColor);
  material.emissiveIntensity = emissionStrength;
  material.roughness = materialTuning.roughness ?? 0.58;
  material.metalness = materialTuning.metalness ?? 0;
  material.userData.passengerColorIndex = colorIndex;
}

function applyPassengerSolidMaterial(material, colorIndex) {
  const materialTuning = SCENE_TUNING.passengerMaterial ?? {};
  const defaults = PASSENGER_DEFAULT_MATERIAL_COLORS[colorIndex] ?? PASSENGER_DEFAULT_MATERIAL_COLORS[0];
  const solidColor = materialTuning.solidColors?.[colorIndex] ?? defaults.emissionColor;
  const brightness = THREE.MathUtils.clamp(materialTuning.brightness ?? 1, 0, 3);
  const emissionStrength = THREE.MathUtils.clamp(materialTuning.emissionStrength ?? 1, 0, 5);
  scratchPassengerBaseColor.setHex(solidColor);
  setPassengerMaterialMaps(material, null, null);
  material.color.setRGB(
    THREE.MathUtils.clamp(scratchPassengerBaseColor.r * brightness, 0, 3),
    THREE.MathUtils.clamp(scratchPassengerBaseColor.g * brightness, 0, 3),
    THREE.MathUtils.clamp(scratchPassengerBaseColor.b * brightness, 0, 3)
  );
  material.emissive.copy(scratchPassengerBaseColor);
  material.emissiveIntensity = emissionStrength;
  material.roughness = materialTuning.roughness ?? 0.58;
  material.metalness = materialTuning.metalness ?? 0;
  material.userData.passengerColorIndex = colorIndex;
}

function applyPassengerMaterial(material, colorIndex, map) {
  if (SCENE_TUNING.passengerMaterial?.mode === 'solidColor') {
    applyPassengerSolidMaterial(material, colorIndex);
  } else {
    applyPassengerUnityMaterial(material, colorIndex, map);
  }
}

async function loadVatGeometry(url, loadingManager) {
  loadingManager?.itemStart(url);
  let buffer;
  try {
    buffer = await fetch(url).then((response) => {
      if (!response.ok) throw new Error(`VAT mesh request failed: ${response.status}`);
      return response.arrayBuffer();
    });
    loadingManager?.itemEnd(url);
  } catch (error) {
    loadingManager?.itemError(url);
    loadingManager?.itemEnd(url);
    throw error;
  }
  const view = new DataView(buffer);
  const magic = String.fromCharCode(...new Uint8Array(buffer, 0, 4));
  if (magic !== 'VATM' || view.getUint32(4, true) !== 1) {
    throw new Error('Unsupported VAT mesh binary.');
  }
  const vertexCount = view.getUint32(8, true);
  const indexCount = view.getUint32(12, true);
  let offset = 16;
  const readFloatArray = (length) => {
    const values = new Float32Array(length);
    for (let i = 0; i < length; i += 1, offset += 4) values[i] = view.getFloat32(offset, true);
    return values;
  };
  const position = readFloatArray(vertexCount * 3);
  const normal = readFloatArray(vertexCount * 3);
  const uv = readFloatArray(vertexCount * 2);
  const index = new Uint32Array(indexCount);
  for (let i = 0; i < indexCount; i += 1, offset += 4) index[i] = view.getUint32(offset, true);
  const vatIndex = Float32Array.from({ length: vertexCount }, (_, indexValue) => indexValue);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(position, 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(normal, 3));
  geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geometry.setAttribute('vatIndex', new THREE.BufferAttribute(vatIndex, 1));
  geometry.setIndex(new THREE.BufferAttribute(index, 1));
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

async function loadVatTexture(url, width, height, loadingManager) {
  loadingManager?.itemStart(url);
  let buffer;
  try {
    buffer = await fetch(url).then((response) => {
      if (!response.ok) throw new Error(`VAT texture request failed: ${response.status}`);
      return response.arrayBuffer();
    });
    loadingManager?.itemEnd(url);
  } catch (error) {
    loadingManager?.itemError(url);
    loadingManager?.itemEnd(url);
    throw error;
  }
  if (buffer.byteLength !== width * height * 8) throw new Error('Unexpected VAT texture size.');
  const texture = new THREE.DataTexture(
    new Uint16Array(buffer),
    width,
    height,
    THREE.RGBAFormat,
    THREE.HalfFloatType
  );
  texture.minFilter = THREE.NearestFilter;
  texture.magFilter = THREE.NearestFilter;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.generateMipmaps = false;
  texture.flipY = false;
  texture.needsUpdate = true;
  return texture;
}

function setMaterial(root, material, meshFilter = null) {
  const meshes = [];
  root.traverse((child) => {
    if (!child.isMesh || (meshFilter && !meshFilter(child))) return;
    child.material = material;
    child.castShadow = false;
    child.receiveShadow = false;
    meshes.push(child);
  });
  return meshes;
}

function storeHitBase(object) {
  object.userData.hitBasePosition = object.position.clone();
  object.userData.hitBaseRotation = object.rotation.clone();
}

function applyArrowOutlineTuning(root, { color = 0x171717, scale = ARROW_OUTLINE_SCALE, depthTest = false } = {}) {
  root?.traverse?.((child) => {
    if ((!child.isMesh && !child.isLineSegments) || !child.userData.isArrowOutline) return;
    const materials = Array.isArray(child.material) ? child.material : [child.material];
    for (const material of materials) {
      if (!material) continue;
      material.color?.setHex(color);
      material.depthTest = Boolean(depthTest);
      if ('linewidth' in material) material.linewidth = Math.max(1, scale);
      material.needsUpdate = true;
    }
    if (child.userData.outlineBaseScale) {
      child.scale.copy(child.userData.outlineBaseScale).multiplyScalar(scale);
    }
  });
}

function addArrowOutline(root, tuning = {}) {
  const shellMaterial = new THREE.MeshBasicMaterial({
    color: tuning.color ?? 0x171717,
    side: THREE.DoubleSide,
    depthWrite: false,
    depthTest: Boolean(tuning.depthTest),
    toneMapped: false
  });
  const edgeMaterial = new THREE.LineBasicMaterial({
    color: tuning.color ?? 0x171717,
    depthWrite: false,
    depthTest: Boolean(tuning.depthTest),
    toneMapped: false
  });
  const outlines = [];
  root.traverse((child) => {
    if (!child.isMesh || child.userData.isArrowOutline) return;
    const edge = new THREE.LineSegments(new THREE.EdgesGeometry(child.geometry, 25), edgeMaterial);
    outlines.push({
      parent: child.parent,
      mesh: child,
      shell: new THREE.Mesh(child.geometry, shellMaterial),
      edge
    });
  });
  for (const { parent, mesh, shell, edge } of outlines) {
    const baseScale = mesh.scale.clone();
    shell.name = `${mesh.name || 'Arrow'}_OutlineShell`;
    shell.position.copy(mesh.position);
    shell.quaternion.copy(mesh.quaternion);
    shell.userData.outlineBaseScale = baseScale.clone();
    shell.scale.copy(shell.userData.outlineBaseScale).multiplyScalar(tuning.scale ?? ARROW_OUTLINE_SCALE);
    shell.renderOrder = mesh.renderOrder - 1;
    shell.userData.isArrowOutline = true;
    edge.name = `${mesh.name || 'Arrow'}_OutlineEdge`;
    edge.position.copy(mesh.position);
    edge.quaternion.copy(mesh.quaternion);
    edge.userData.outlineBaseScale = baseScale.clone();
    edge.scale.copy(edge.userData.outlineBaseScale).multiplyScalar(tuning.scale ?? ARROW_OUTLINE_SCALE);
    edge.renderOrder = mesh.renderOrder + 2;
    edge.userData.isArrowOutline = true;
    mesh.renderOrder += 1;
    parent.add(shell, edge);
  }
  applyArrowOutlineTuning(root, tuning);
}

function toStaticMeshGroup(source) {
  const root = new THREE.Group();
  source.updateMatrixWorld(true);
  source.traverse((child) => {
    if (!child.isMesh) return;
    const geometry = child.geometry.clone();
    if (child.isSkinnedMesh && geometry.attributes.skinIndex) {
      child.skeleton.update();
      const position = geometry.attributes.position;
      const vertex = new THREE.Vector3();
      for (let i = 0; i < position.count; i += 1) {
        vertex.fromBufferAttribute(position, i);
        child.applyBoneTransform(i, vertex);
        position.setXYZ(i, vertex.x, vertex.y, vertex.z);
      }
      position.needsUpdate = true;
      geometry.deleteAttribute('skinIndex');
      geometry.deleteAttribute('skinWeight');
    }
    geometry.applyMatrix4(child.matrixWorld);
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
    const mesh = new THREE.Mesh(geometry);
    mesh.name = child.name;
    root.add(mesh);
  });
  return root;
}

function normalizeObject(root, targets) {
  root.updateMatrixWorld(true);
  let bounds = new THREE.Box3().setFromObject(root);
  const size = bounds.getSize(new THREE.Vector3());
  const ratios = [];
  if (targets.width) ratios.push(targets.width / Math.max(size.x, 0.0001));
  if (targets.height) ratios.push(targets.height / Math.max(size.y, 0.0001));
  if (targets.depth) ratios.push(targets.depth / Math.max(size.z, 0.0001));
  const scale = Math.min(...ratios);
  root.scale.multiplyScalar(scale);
  root.updateMatrixWorld(true);
  bounds = new THREE.Box3().setFromObject(root);
  const center = bounds.getCenter(new THREE.Vector3());
  root.position.x -= center.x;
  root.position.y -= bounds.min.y;
  root.position.z -= center.z;
  root.updateMatrixWorld(true);
  root.userData.fittedSize = new THREE.Box3().setFromObject(root).getSize(new THREE.Vector3());
  return root;
}

function makeVehiclePlaceholder(vehicle) {
  const root = new THREE.Group();
  root.userData.vehicleId = vehicle.id;
  const material = new THREE.MeshStandardMaterial({
    color: COLORS[vehicle.colorIndex].hex,
    roughness: 0.42
  });
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.4, 1.28), material);
  body.position.y = 0.25;
  body.userData.vehicleId = vehicle.id;
  root.add(body);
  const arrow = new THREE.Mesh(
    new THREE.ConeGeometry(0.15, 0.4, 3),
    new THREE.MeshBasicMaterial({ color: 0xffffff })
  );
  arrow.rotation.x = Math.PI / 2;
  arrow.position.set(0, 0.62, 0.1);
  arrow.userData.vehicleId = vehicle.id;
  root.add(arrow);
  root.userData.bodyMeshes = [body];
  root.userData.hitMeshes = [body, arrow];
  storeHitBase(body);
  storeHitBase(arrow);
  return root;
}

function makePassengerGroup(groupScale) {
  const group = new THREE.Group();
  group.scale.setScalar(groupScale);
  group.userData.personSlots = [];
  const spacing = SCENE_TUNING.passengers.groupSpacing;
  for (let i = 0; i < 4; i += 1) {
    const slot = new THREE.Group();
    const fallback = new THREE.Mesh(
      new THREE.CapsuleGeometry(0.075, 0.16, 3, 6),
      new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.62 })
    );
    fallback.position.y = 0.2;
    slot.add(fallback);
    slot.userData.fallback = fallback;
    slot.position.set((i - 1.5) * spacing, 0, 0);
    group.userData.personSlots.push(slot);
    group.add(slot);
  }
  return group;
}

export class SceneView {
  constructor(canvas, onVehicleClick, hooks = {}) {
    this.canvas = canvas;
    this.onVehicleClick = onVehicleClick;
    this.hooks = hooks;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.setClearColor(0xc9d7ed, 1);
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(SCENE_TUNING.camera.fovDegrees, 1, 0.1, 1000);
    this.raycaster = new THREE.Raycaster();
    this.pointer = new THREE.Vector2();
    this.loadingManager = new THREE.LoadingManager();
    this.loadingManager.onProgress = (_url, loaded, total) => {
      this.hooks.onLoadingProgress?.(total > 0 ? loaded / total : 0);
    };
    this.loadingManager.onLoad = () => {
      this.hooks.onLoadingProgress?.(1);
    };
    this.textureLoader = new THREE.TextureLoader(this.loadingManager);
    this.artworkTextureCache = new Map();
    this.fbxLoader = new FBXLoader(this.loadingManager);
    this.vehicleViews = new Map();
    this.passengerViews = [];
    this.queuePassengerViews = [[], []];
    this.spotRoots = [];
    this.spotPositions = [];
    this.seatCountBoards = [];
    this.passengerMaterials = [];
    this.passengerColorTextures = [];
    this.vehicleMaterials = [];
    this.vehicleColorTextures = [];
    this.vatTimeUniform = { value: 0 };
    this.boardingViews = [];
    this.vehicleBoardingPulses = new Map();
    this.initialEntryPathStates = new Map();
    this.queueEntryPathStates = new Map();
    this.lastBoardingEventId = 0;
    this.vehicleEffects = null;
    this.guideHand = null;
    this.guideHandMaterial = null;
    this.firstClickGuideMask = this.createFirstClickGuideMask();
    this.vehiclePathLines = [];
    this.vehicleDeparturePathLines = [];
    this.lastSnapshot = null;
    this.lastGame = null;
    this.buildWorld();
    this.applyTuning();
    this.ready = this.loadUnityAssets();
    window.addEventListener('resize', () => this.resize());
    if ('ResizeObserver' in window) {
      this.resizeObserver = new ResizeObserver(() => this.resize());
      this.resizeObserver.observe(canvas);
    }
    canvas.addEventListener('pointerup', (event) => this.pick(event));
  }

  createFirstClickGuideMask() {
    const parent = this.canvas.parentElement;
    if (!parent) return null;
    const root = document.createElement('div');
    root.className = 'first-click-guide-mask';
    root.hidden = true;
    const pieces = {};
    for (const side of ['top', 'right', 'bottom', 'left']) {
      const piece = document.createElement('div');
      piece.className = `first-click-guide-mask-piece is-${side}`;
      pieces[side] = piece;
      root.append(piece);
    }
    const hole = document.createElement('div');
    hole.className = 'first-click-guide-hole';
    root.append(hole);
    const hand = document.createElement('img');
    hand.className = 'first-click-guide-hand';
    hand.alt = '';
    hand.draggable = false;
    hand.src = GUIDE_HAND_TEXTURE_URL;
    root.append(hand);
    parent.append(root);
    return { root, pieces, hole, hand };
  }

  buildWorld() {
    this.hemisphereLight = new THREE.HemisphereLight();
    this.directionalLight = new THREE.DirectionalLight();
    this.directionalLight.name = 'Directional Light';
    this.directionalLightTarget = new THREE.Object3D();
    this.directionalLightTarget.name = 'Directional Light Target';
    this.directionalLight.target = this.directionalLightTarget;
    this.scene.add(
      this.hemisphereLight,
      this.directionalLight,
      this.directionalLightTarget
    );
    this.applySceneLighting();


    this.backgroundPlane = this.makeArtworkPlane(LEVEL_1.assets.background);
    this.backgroundPlane.rotation.set(0, 0, 0);
    this.backgroundPlane.material.depthWrite = false;
    this.backgroundPlane.renderOrder = -100;
    const conveyorLayout = getSelectedConveyorLayout();
    this.loopPlane = this.makeArtworkPlane(
      conveyorLayout.assets.loopScene,
      conveyorLayout.assets.loopSpriteRect
    );
    this.camera.add(this.backgroundPlane);
    this.scene.add(this.camera, this.loopPlane);
    this.buildPathCurves();
    this.buildSpots();
    this.buildGuideHand();

    for (const vehicle of LEVEL_1.vehicles) {
      const view = makeVehiclePlaceholder(vehicle);
      this.vehicleViews.set(vehicle.id, view);
      this.scene.add(view);
    }
    for (let i = 0; i < MAX_CONVEYOR_CAPACITY; i += 1) {
      const view = makePassengerGroup(SCENE_TUNING.passengers.modelScale);
      view.visible = false;
      this.passengerViews.push(view);
      this.scene.add(view);
    }
    for (let queueIndex = 0; queueIndex < LEVEL_1.queueCount; queueIndex += 1) {
      for (let i = 0; i < MAX_QUEUE_CAPACITY; i += 1) {
        const view = makePassengerGroup(SCENE_TUNING.passengers.modelScale);
        view.visible = false;
        this.queuePassengerViews[queueIndex].push(view);
        this.scene.add(view);
      }
    }
  }

  makeArtworkPlane(url, uvRect = null) {
    const material = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      depthWrite: false,
      alphaTest: 0.02,
      blending: THREE.NormalBlending,
      fog: false,
      side: THREE.DoubleSide
    });
    let texture = this.artworkTextureCache.get(url);
    if (!texture) {
      texture = this.textureLoader.load(url, (loadedTexture) => {
        loadedTexture.colorSpace = THREE.SRGBColorSpace;
        loadedTexture.anisotropy = Math.min(8, this.renderer.capabilities.getMaxAnisotropy());
        loadedTexture.needsUpdate = true;
      });
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.anisotropy = Math.min(8, this.renderer.capabilities.getMaxAnisotropy());
      this.artworkTextureCache.set(url, texture);
    }
    this.applyArtworkTextureRect(texture, uvRect);
    material.map = texture;
    material.needsUpdate = true;
    const plane = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), material);
    plane.rotation.x = -Math.PI / 2;
    plane.userData.artworkUrl = url;
    return plane;
  }

  applyArtworkTextureRect(texture, uvRect = null) {
    texture.wrapS = THREE.ClampToEdgeWrapping;
    texture.wrapT = THREE.ClampToEdgeWrapping;
    if (uvRect) {
      texture.repeat.set(uvRect.width / uvRect.imageWidth, uvRect.height / uvRect.imageHeight);
      texture.offset.set(uvRect.x / uvRect.imageWidth, uvRect.y / uvRect.imageHeight);
    } else {
      texture.repeat.set(1, 1);
      texture.offset.set(0, 0);
    }
    texture.needsUpdate = true;
  }

  setArtworkPlaneTexture(plane, url, uvRect = null) {
    if (!plane || plane.userData.artworkUrl === url) return;
    let texture = this.artworkTextureCache.get(url);
    if (!texture) {
      texture = this.textureLoader.load(url, (loadedTexture) => {
        loadedTexture.colorSpace = THREE.SRGBColorSpace;
        loadedTexture.anisotropy = Math.min(8, this.renderer.capabilities.getMaxAnisotropy());
        loadedTexture.needsUpdate = true;
      });
      this.artworkTextureCache.set(url, texture);
    }
    this.applyArtworkTextureRect(texture, uvRect);
    plane.material.map = texture;
    plane.material.needsUpdate = true;
    plane.userData.artworkUrl = url;
  }

  buildGuideHand() {
    const material = new THREE.SpriteMaterial({
      transparent: true,
      depthWrite: false,
      depthTest: false,
      opacity: SCENE_TUNING.vehicleGuideHand.opacity ?? 1
    });
    material.map = this.textureLoader.load(GUIDE_HAND_TEXTURE_URL, (texture) => {
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.wrapS = THREE.RepeatWrapping;
      texture.repeat.x = -1;
      texture.offset.x = 1;
      texture.needsUpdate = true;
    });
    const sprite = new THREE.Sprite(material);
    sprite.renderOrder = 1000;
    sprite.visible = false;
    this.guideHand = sprite;
    this.guideHandMaterial = material;
    this.scene.add(sprite);
  }

  buildPathCurves() {
    const layout = getSelectedConveyorLayout();
    const tuning = getSelectedConveyorTuning(layout.id);
    this.activeConveyorLayout = layout;
    this.curve = makeClosedConveyorCurve(
      makeTunedCurvePoints(layout.splinePoints, tuning.curve, 'center'),
      layout.splineType
    );
    this.fullQueueCurves = layout.queuePaths.map((path, index) => (
      makeOpenCurve(makeTunedCurvePoints(path, tuning.queueCurves[index], 'entry'))
    ));
    this.entryPercents = this.calculateConveyorEntryPercents();
    this.updateQueueCurvesForCamera();
  }

  calculateConveyorEntryPercents(sampleCount = 2048) {
    if (!this.curve) return [];
    return (this.fullQueueCurves ?? []).map((queueCurve) => {
      const entryPoint = queueCurve.getPointAt(0);
      let nearestProgress = 0;
      let nearestDistanceSquared = Infinity;
      for (let index = 0; index < sampleCount; index += 1) {
        const progress = index / sampleCount;
        const distanceSquared = this.curve.getPointAt(progress).distanceToSquared(entryPoint);
        if (distanceSquared < nearestDistanceSquared) {
          nearestDistanceSquared = distanceSquared;
          nearestProgress = progress;
        }
      }
      return nearestProgress;
    });
  }

  updateQueueCurvesForCamera() {
    const previous = this.queueCurves;
    this.queueCurves = this.fullQueueCurves.map((curve) => this.makeVisibleQueueCurve(curve));
    if (previous && this.lastSnapshot?.time === 0) this.initialEntryPathStates.clear();
  }

  makeVisibleQueueCurve(curve) {
    if (!curve) return null;
    const length = Math.max(0.0001, curve.getLength());
    const queueConfig = LEVEL_1.passengerQueue ?? {};
    const spacing = queueConfig.spacing ?? 0.4;
    const extraDistance = (queueConfig.screenEdgeOffsetSpacing ?? 4) * spacing;
    const isInScreen = (point) => {
      const projected = point.clone().project(this.camera);
      return projected.z >= -1 && projected.z <= 1
        && projected.x >= -1 && projected.x <= 1
        && projected.y >= -1 && projected.y <= 1;
    };
    if (!isInScreen(curve.getPointAt(0))) return curve;

    let low = 0;
    let high = 1;
    let lastInside = 0;
    for (let i = 0; i < 30; i += 1) {
      const mid = (low + high) * 0.5;
      if (isInScreen(curve.getPointAt(mid))) {
        lastInside = mid;
        low = mid;
      } else {
        high = mid;
      }
    }
    const tailProgress = Math.min(1, lastInside + extraDistance / length);
    return makeSubCurve(curve, 0, tailProgress);
  }

  buildSpots() {
    for (let i = 0; i < SCENE_TUNING.parkingSpots.count; i += 1) {
      const root = new THREE.Group();
      const board = this.createSeatCountBoard();
      board.visible = false;
      board.renderOrder = 40;
      const fallback = new THREE.Mesh(
        new THREE.BoxGeometry(0.82, 0.04, 1.42),
        new THREE.MeshStandardMaterial({ color: 0xb6a9cb, roughness: 0.76 })
      );
      fallback.position.y = 0.02;
      root.add(fallback, board);
      this.spotRoots.push(root);
      this.spotPositions.push(new THREE.Vector3());
      this.seatCountBoards.push(board);
      this.scene.add(root);
    }
  }


  clearVehiclePathLines() {
    for (const line of [...this.vehiclePathLines, ...this.vehicleDeparturePathLines]) {
      this.scene.remove(line);
      line.geometry.dispose();
      line.material.dispose();
    }
    this.vehiclePathLines.length = 0;
    this.vehicleDeparturePathLines.length = 0;
  }

  makeVehiclePathLine(path, material, y = SCENE_TUNING.vehiclePath.y) {
    const points = [];
    const samples = Math.max(8, Math.ceil(path.length / 0.08));
    for (let i = 0; i <= samples; i += 1) {
      const sample = evaluatePath(path, path.length * (i / samples));
      const position = mapMotionPoint(sample.position, y);
      points.push(position);
    }
    const geometry = new THREE.BufferGeometry().setFromPoints(points);
    const line = new THREE.Line(geometry, material.clone());
    line.renderOrder = 80;
    line.frustumCulled = false;
    return line;
  }

  updateVehiclePathPreview(snapshot = this.lastSnapshot, game = this.lastGame) {
    this.clearVehiclePathLines();
    if (!snapshot || !game) return;
    const tuning = SCENE_TUNING.vehiclePath;
    if (tuning?.enabled) {
      const spotIndex = snapshot.spots.findIndex((spot) => spot.vehicleId === null);
      if (spotIndex >= 0) {
        const target = game.getSpotPosition(spotIndex);
        const baseMaterial = new THREE.LineBasicMaterial({
          color: tuning.color ?? 0x20f6ff,
          transparent: true,
          opacity: tuning.opacity ?? 0.88,
          linewidth: tuning.lineWidth ?? 3,
          depthTest: false,
          depthWrite: false
        });
        for (const vehicle of snapshot.vehicles) {
          if (vehicle.state !== 'parked') continue;
          const blockers = game.getBlockers(vehicle.id);
          if (blockers.length && !tuning.showBlocked) continue;
          const points = buildToStationPoints(vehicle, target, tuning);
          const path = buildRoundedPath(points, tuning);
          const line = this.makeVehiclePathLine(path, baseMaterial, tuning.y);
          line.material.opacity = blockers.length ? (tuning.opacity ?? 0.88) * 0.35 : (tuning.opacity ?? 0.88);
          this.vehiclePathLines.push(line);
          this.scene.add(line);
        }
        baseMaterial.dispose();
      }
    }
    this.updateVehicleDeparturePathPreview(snapshot, game);
  }

  updateVehicleDeparturePathPreview(snapshot = this.lastSnapshot, game = this.lastGame) {
    const tuning = SCENE_TUNING.vehicleDeparturePath;
    if (!tuning?.enabled || !snapshot || !game) return;
    const baseMaterial = new THREE.LineBasicMaterial({
      color: tuning.color ?? 0xffc857,
      transparent: true,
      opacity: tuning.opacity ?? 0.88,
      linewidth: tuning.lineWidth ?? 3,
      depthTest: false,
      depthWrite: false
    });
    for (const spot of snapshot.spots) {
      if (spot.vehicleId === null) continue;
      const target = game.getSpotPosition(spot.index);
      const backwardPath = buildRoundedPath(buildOutStationPoints(target, tuning), tuning);
      const forwardStart = backwardPath.segments.at(-1)?.p1 ?? target;
      const forwardPath = buildRoundedPath([
        forwardStart,
        { x: tuning.exitTargetX ?? 4.2, z: forwardStart.z + (tuning.exitTargetZOffset ?? 0) }
      ], tuning);
      for (const path of [backwardPath, forwardPath]) {
        const line = this.makeVehiclePathLine(path, baseMaterial, tuning.y);
        this.vehicleDeparturePathLines.push(line);
        this.scene.add(line);
      }
    }
    baseMaterial.dispose();
  }
  createSeatCountBoard() {
    const group = new THREE.Group();
    const boardMaterial = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide
    });
    const board = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), boardMaterial);
    board.rotation.x = -Math.PI / 2;
    board.position.y = 0.028;

    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 160;
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    const text = new THREE.Sprite(new THREE.SpriteMaterial({
      map: texture,
      transparent: true,
      depthWrite: false
    }));
    text.position.set(0, 0.052, 0);
    text.scale.set(0.42, 0.26, 1);
    group.userData.textSprite = text;

    group.add(board, text);
    group.userData.boardMesh = board;
    group.userData.textCanvas = canvas;
    group.userData.textTexture = texture;
    return group;
  }

  async loadUnityAssets() {
    try {
      const modelPaths = LEVEL_1.assets.models;
      const vehiclePaths = modelPaths.vehicleBySeats;
      const [
        passengerVatGeometry,
        passengerVatTexture,
        shadowFbx,
        arrowFbx,
        carFbx,
        vanFbx,
        busFbx,
        parkingFbx,
        carShadowFbx,
        vanShadowFbx,
        busShadowFbx,
        shadowTexture,
        parkingTexture,
        seatCountBoardTexture,
        carShadowTexture,
        vanShadowTexture,
        busShadowTexture,
        aboardSmokeTexture,
        ribbonTexture,
        ribbonSmokeTexture,
        hitCircleTexture,
        hitRound2Texture,
        hitRound1Texture,
        smokeTrailTexture,
        ...colorTextures
      ] = await Promise.all([
        loadVatGeometry(modelPaths.passengerVatMesh, this.loadingManager),
        loadVatTexture(
          modelPaths.passengerVatTexture,
          LEVEL_1.assets.passengerAnimations.textureWidth,
          LEVEL_1.assets.passengerAnimations.textureHeight,
          this.loadingManager
        ),
        this.fbxLoader.loadAsync(modelPaths.shadow),
        this.fbxLoader.loadAsync(modelPaths.arrow),
        this.fbxLoader.loadAsync(vehiclePaths[4]),
        this.fbxLoader.loadAsync(vehiclePaths[6]),
        this.fbxLoader.loadAsync(vehiclePaths[10]),
        this.fbxLoader.loadAsync(modelPaths.parkingSpot),
        this.fbxLoader.loadAsync(modelPaths.vehicleShadowBySeats[4]),
        this.fbxLoader.loadAsync(modelPaths.vehicleShadowBySeats[6]),
        this.fbxLoader.loadAsync(modelPaths.vehicleShadowBySeats[10]),
        this.textureLoader.loadAsync(LEVEL_1.assets.textures.shadow),
        this.textureLoader.loadAsync(LEVEL_1.assets.textures.parkingSpot),
        this.textureLoader.loadAsync(LEVEL_1.assets.textures.seatCountBoard),
        this.textureLoader.loadAsync(LEVEL_1.assets.textures.vehicleShadowBySeats[4]),
        this.textureLoader.loadAsync(LEVEL_1.assets.textures.vehicleShadowBySeats[6]),
        this.textureLoader.loadAsync(LEVEL_1.assets.textures.vehicleShadowBySeats[10]),
        this.textureLoader.loadAsync(LEVEL_1.assets.textures.effects.aboardSmoke),
        this.textureLoader.loadAsync(LEVEL_1.assets.textures.effects.ribbon),
        this.textureLoader.loadAsync(LEVEL_1.assets.textures.effects.ribbonSmoke),
        this.textureLoader.loadAsync(LEVEL_1.assets.textures.effects.hitCircle),
        this.textureLoader.loadAsync(LEVEL_1.assets.textures.effects.hitRound2),
        this.textureLoader.loadAsync(LEVEL_1.assets.textures.effects.hitRound1),
        this.textureLoader.loadAsync(LEVEL_1.assets.textures.effects.smokeTrail),
        ...LEVEL_1.assets.colorTextures.map((path) => this.textureLoader.loadAsync(path))
      ]);

      this.vehicleColorTextures = colorTextures.map(configureColorTexture);
      this.passengerColorTextures = this.vehicleColorTextures;
      this.passengerVatTexture = passengerVatTexture;
      configureColorTexture(parkingTexture);
      configureColorTexture(seatCountBoardTexture);
      configureColorTexture(shadowTexture);
      [carShadowTexture, vanShadowTexture, busShadowTexture].forEach(configureColorTexture);
      [
        aboardSmokeTexture,
        ribbonTexture,
        ribbonSmokeTexture,
        hitCircleTexture,
        hitRound2Texture,
        hitRound1Texture,
        smokeTrailTexture
      ].forEach(configureColorTexture);
      this.vehicleEffects = new VehicleEffects({
        scene: this.scene,
        vehicleViews: this.vehicleViews,
        spotRoots: this.spotRoots,
        textures: {
          aboardSmoke: aboardSmokeTexture,
          ribbon: ribbonTexture,
          ribbonSmoke: ribbonSmokeTexture,
          hitCircle: hitCircleTexture,
          hitRound2: hitRound2Texture,
          hitRound1: hitRound1Texture,
          smokeTrail: smokeTrailTexture
        },
        effectsTuning: SCENE_TUNING.effects
      });
      this.passengerMaterials = this.passengerColorTextures.map((map, colorIndex) => {
        const material = new THREE.MeshStandardMaterial({
          roughness: 0.58,
          metalness: 0
        });
        applyPassengerMaterial(material, colorIndex, map);
        return material;
      });
      this.vehicleMaterials = this.vehicleColorTextures.map((map) => new THREE.MeshStandardMaterial({
        map,
        roughness: 0.58,
        metalness: 0
      }));
      this.shadowMaterial = new THREE.MeshBasicMaterial({
        map: shadowTexture,
        transparent: true,
        opacity: SCENE_TUNING.shadows.opacity,
        depthWrite: false,
        side: THREE.DoubleSide
      });
      this.vehicleShadowMaterials = {
        4: new THREE.MeshBasicMaterial({ map: carShadowTexture, transparent: true, opacity: SCENE_TUNING.vehicleShadows.opacity, depthWrite: false, side: THREE.DoubleSide }),
        6: new THREE.MeshBasicMaterial({ map: vanShadowTexture, transparent: true, opacity: SCENE_TUNING.vehicleShadows.opacity, depthWrite: false, side: THREE.DoubleSide }),
        10: new THREE.MeshBasicMaterial({ map: busShadowTexture, transparent: true, opacity: 0.8, depthWrite: false, side: THREE.DoubleSide })
      };
      this.parkingMaterial = new THREE.MeshStandardMaterial({
        map: parkingTexture,
        roughness: 0.68,
        transparent: true,
        alphaTest: 0.02
      });
      this.seatCountBoardTexture = seatCountBoardTexture;

      const vatRoot = new THREE.Group();
      const vatMesh = new THREE.Mesh(passengerVatGeometry);
      vatMesh.userData.isVatPassenger = true;
      vatMesh.frustumCulled = false;
      vatRoot.add(vatMesh);
      this.personTemplate = normalizeObject(vatRoot, {
        height: SCENE_TUNING.passengers.modelHeight
      });
      this.shadowTemplate = normalizeObject(toStaticMeshGroup(shadowFbx), { width: 1, depth: 1.26 });
      this.arrowTemplate = normalizeObject(toStaticMeshGroup(arrowFbx), { depth: 0.56 });
      setMaterial(this.arrowTemplate, new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide }));
      addArrowOutline(this.arrowTemplate, {
        color: SCENE_TUNING.vehicleArrow.outlineColor,
        scale: SCENE_TUNING.vehicleArrow.outlineScale,
        depthTest: SCENE_TUNING.vehicleArrow.outlineDepthTest
      });
      this.parkingTemplate = normalizeObject(toStaticMeshGroup(parkingFbx), {
        width: SCENE_TUNING.parkingSpots.modelWidth,
        depth: SCENE_TUNING.parkingSpots.modelDepth
      });
      setMaterial(this.parkingTemplate, this.parkingMaterial);

      this.vehicleTemplates = {
        4: this.prepareVehicleTemplate(carFbx, 4),
        6: this.prepareVehicleTemplate(vanFbx, 6),
        10: this.prepareVehicleTemplate(busFbx, 10)
      };
      this.vehicleShadowTemplates = {
        4: this.prepareVehicleShadowTemplate(carShadowFbx, 4),
        6: this.prepareVehicleShadowTemplate(vanShadowFbx, 6),
        10: this.prepareVehicleShadowTemplate(busShadowFbx, 10)
      };
      this.upgradePassengerViews();
      this.upgradeVehicleViews();
      this.upgradeSpotViews();
      this.applyTuning();
    } catch (error) {
      console.warn('Unity asset load failed; keeping geometric fallbacks.', error);
    }
  }

  prepareVehicleTemplate(source, seats) {
    const targetDepth = SCENE_TUNING.vehicleArea.modelDepthBySeats[seats] ?? 1.2;
    return normalizeObject(toStaticMeshGroup(source), { depth: targetDepth });
  }

  prepareVehicleShadowTemplate(source, seats) {
    const targetDepth = SCENE_TUNING.vehicleShadows.depthBySeats?.[seats]
      ?? SCENE_TUNING.vehicleArea.modelDepthBySeats[seats]
      ?? 1.2;
    return normalizeObject(toStaticMeshGroup(source), { depth: targetDepth });
  }

  createVatMaterial(colorIndex = 0) {
    const animation = LEVEL_1.assets.passengerAnimations;
    const idle = animation.idle;
    const clip = new THREE.Vector4(idle.uvMin, idle.uvMax, 1 / idle.duration, 0);
    const map = this.passengerColorTextures[colorIndex] ?? this.passengerColorTextures[0];
    const material = new THREE.MeshStandardMaterial({
      roughness: 0.58,
      metalness: 0,
      side: THREE.DoubleSide
    });
    applyPassengerMaterial(material, colorIndex, map);
    material.userData.vat = { clip, clipName: null };
    material.onBeforeCompile = (shader) => {
      shader.uniforms.vatMap = { value: this.passengerVatTexture };
      shader.uniforms.vatTime = this.vatTimeUniform;
      shader.uniforms.vatClip = { value: clip };
      shader.vertexShader = `
        uniform sampler2D vatMap;
        uniform float vatTime;
        uniform vec4 vatClip;
        attribute float vatIndex;
      ` + shader.vertexShader.replace(
        '#include <begin_vertex>',
        `
          float vatPhase = fract(vatTime * vatClip.z + vatClip.w);
          float vatX = (vatIndex + 0.5) / ${animation.textureWidth.toFixed(1)};
          float vatY = mix(vatClip.x, vatClip.y, vatPhase)
            + 0.5 / ${animation.textureHeight.toFixed(1)};
          vec3 transformed = texture2D(vatMap, vec2(vatX, vatY)).xyz;
        `
      );
    };
    material.customProgramCacheKey = () => 'busloop-passenger-vat-v1';
    this.setVatAnimation(material, 'idle');
    return material;
  }

  setVatAnimation(material, clipName, normalizedPhase = 0) {
    const state = material?.userData?.vat;
    const clip = LEVEL_1.assets.passengerAnimations[clipName];
    if (!state || !clip || state.clipName === clipName) return;
    state.clipName = clipName;
    state.clip.set(
      clip.uvMin,
      clip.uvMax,
      1 / clip.duration,
      normalizedPhase - this.vatTimeUniform.value / clip.duration
    );
  }

  setPassengerAnimation(view, clipName, normalizedPhase = 0) {
    for (const slot of view.userData.personSlots) {
      this.setVatAnimation(slot.userData.vatMaterial, clipName, normalizedPhase);
    }
  }

  createPassengerVisual(colorIndex = 0, shadowKind = 'conveyor') {
    const root = new THREE.Group();
    const shadow = this.makeShadow(
      SCENE_TUNING.passengers.shadowScale,
      SCENE_TUNING.passengers.shadowScale * 1.2,
      shadowKind
    );
    const person = this.personTemplate.clone(true);
    const personPivot = new THREE.Group();
    personPivot.rotation.y = deg(SCENE_TUNING.facing.passengerModelYawDegrees);
    personPivot.position.y = SCENE_TUNING.shadows.y + 0.002;
    personPivot.add(person);
    const material = this.createVatMaterial(colorIndex);
    setMaterial(person, material);
    root.add(shadow, personPivot);
    root.userData.modelRoot = person;
    root.userData.modelPivot = personPivot;
    root.userData.vatMaterial = material;
    return root;
  }

  makeShadow(width, depth, kind = 'conveyor') {
    const shadow = this.shadowTemplate.clone(true);
    const tuning = SCENE_TUNING.passengerShadows[kind] ?? SCENE_TUNING.passengerShadows.conveyor;
    shadow.scale.set(width * tuning.scaleX, 1, depth * tuning.scaleZ / 1.26);
    setMaterial(shadow, this.shadowMaterial);
    shadow.traverse((object) => {
      if (object.isMesh) object.userData.isFakeShadow = true;
    });
    shadow.rotation.y = deg(SCENE_TUNING.facing.passengerShadowYawDegrees);
    shadow.position.set(tuning.offsetX, SCENE_TUNING.shadows.y, tuning.offsetZ);
    shadow.userData.passengerShadowKind = kind;
    shadow.userData.shadowBaseWidth = width;
    shadow.userData.shadowBaseDepth = depth;
    this.updatePassengerShadowObject(shadow);
    return shadow;
  }

  updatePassengerShadowObject(shadow) {
    const kind = shadow.userData.passengerShadowKind ?? 'conveyor';
    const tuning = SCENE_TUNING.passengerShadows[kind] ?? SCENE_TUNING.passengerShadows.conveyor;
    const width = shadow.userData.shadowBaseWidth ?? SCENE_TUNING.passengers.shadowScale;
    const depth = shadow.userData.shadowBaseDepth ?? SCENE_TUNING.passengers.shadowScale * 1.2;
    shadow.scale.set(width * tuning.scaleX, 1, depth * tuning.scaleZ / 1.26);
    shadow.position.set(tuning.offsetX, SCENE_TUNING.shadows.y, tuning.offsetZ);
  }

  updatePassengerVisualTuning() {
    const scale = SCENE_TUNING.passengers.modelScale;
    const spacing = SCENE_TUNING.passengers.groupSpacing;
    for (const root of [...this.passengerViews, ...this.queuePassengerViews.flat()]) {
      root.scale.setScalar(scale);
      root.userData.personSlots?.forEach((slot, index) => {
        slot.position.x = (index - 1.5) * spacing;
      });
    }
    for (const entry of this.boardingViews) {
      entry.root.scale.setScalar(scale);
    }
    const roots = [
      ...this.passengerViews,
      ...this.queuePassengerViews.flat(),
      ...this.boardingViews.map((entry) => entry.root)
    ];
    for (const root of roots) {
      root.traverse((object) => {
        if (object.userData.passengerShadowKind) this.updatePassengerShadowObject(object);
      });
    }
  }

  updatePassengerMaterialTuning({ colorIndex: changedColorIndex = null } = {}) {
    const shouldUpdateColor = (colorIndex) => changedColorIndex == null || colorIndex === changedColorIndex;
    this.passengerMaterials?.forEach((material, colorIndex) => {
      if (!shouldUpdateColor(colorIndex)) return;
      const map = this.passengerColorTextures[colorIndex] ?? this.passengerColorTextures[0];
      applyPassengerMaterial(material, colorIndex, map);
    });

    const roots = [
      ...this.passengerViews,
      ...this.queuePassengerViews.flat(),
      ...this.boardingViews.map((entry) => entry.root)
    ];
    for (const root of roots) {
      if (root.userData.vatMaterial) {
        const colorIndex = root.userData.vatMaterial.userData.passengerColorIndex ?? root.userData.colorIndex ?? 0;
        if (!shouldUpdateColor(colorIndex)) continue;
        const map = this.passengerColorTextures[colorIndex] ?? this.passengerColorTextures[0];
        applyPassengerMaterial(root.userData.vatMaterial, colorIndex, map);
      }
      for (const slot of root.userData.personSlots ?? []) {
        const material = slot.userData.vatMaterial;
        if (!material) continue;
        const colorIndex = material.userData.passengerColorIndex ?? root.userData.colorIndex ?? 0;
        if (!shouldUpdateColor(colorIndex)) continue;
        const map = this.passengerColorTextures[colorIndex] ?? this.passengerColorTextures[0];
        applyPassengerMaterial(material, colorIndex, map);
      }
    }
  }

  upgradePassengerViews() {
    const allViews = [...this.passengerViews, ...this.queuePassengerViews.flat()];
    for (const view of allViews) {
      for (const slot of view.userData.personSlots) {
        slot.clear();
        const queueIndex = this.queuePassengerViews[0].includes(view) ? 0 : (this.queuePassengerViews[1].includes(view) ? 1 : -1);
        const shadowKind = queueIndex === 0 ? 'leftQueue' : (queueIndex === 1 ? 'rightQueue' : 'conveyor');
        const visual = this.createPassengerVisual(0, shadowKind);
        slot.add(visual);
        slot.userData.visualRoot = visual;
        slot.userData.modelRoot = visual.userData.modelRoot;
        slot.userData.vatMaterial = visual.userData.vatMaterial;
      }
      view.userData.modelReady = true;
      view.userData.colorIndex = null;
    }
  }

  upgradeVehicleViews() {
    for (const vehicle of LEVEL_1.vehicles) {
      const view = this.vehicleViews.get(vehicle.id);
      const template = this.vehicleTemplates[vehicle.seats] ?? this.vehicleTemplates[10];
      const size = template.userData.fittedSize;
      const material = this.vehicleMaterials[vehicle.colorIndex].clone();
      view.clear();
      const shadow = this.makeVehicleShadow(vehicle.seats);
      const model = template.clone(true);
      const bodyMeshes = setMaterial(model, material);
      const arrow = this.arrowTemplate.clone(true);
      const hitRoot = new THREE.Group();
      this.applyVehicleArrowTuning(arrow, size);
      arrow.rotation.y = deg(SCENE_TUNING.facing.arrowYawDegrees);
      hitRoot.add(model, arrow);
      for (const child of [hitRoot, shadow]) {
        child.traverse((object) => { object.userData.vehicleId = vehicle.id; });
      }
      view.add(shadow, hitRoot);
      view.userData.bodyMeshes = bodyMeshes;
      view.userData.hitMeshes = [hitRoot];
      view.userData.modelRoot = model;
      view.userData.arrowRoot = arrow;
      view.userData.templateSize = size;
      view.userData.unityHitScale = size.z / .6785897;
      storeHitBase(hitRoot);
      view.userData.modelReady = true;
    }
  }

  applyVehicleArrowTuning(arrow, size) {
    const tuning = SCENE_TUNING.vehicleArrow;
    arrow.position.set(tuning.offsetX, size.y + tuning.offsetY, tuning.offsetZ);
    applyArrowOutlineTuning(arrow, {
      color: tuning.outlineColor,
      scale: tuning.outlineScale,
      depthTest: tuning.outlineDepthTest
    });
  }

  updateVehicleArrowTuning() {
    if (this.arrowTemplate) {
      applyArrowOutlineTuning(this.arrowTemplate, {
        color: SCENE_TUNING.vehicleArrow.outlineColor,
        scale: SCENE_TUNING.vehicleArrow.outlineScale,
        depthTest: SCENE_TUNING.vehicleArrow.outlineDepthTest
      });
    }
    for (const vehicle of LEVEL_1.vehicles) {
      const view = this.vehicleViews.get(vehicle.id);
      const arrow = view?.userData.arrowRoot;
      const size = view?.userData.templateSize;
      if (arrow && size) {
        this.applyVehicleArrowTuning(arrow, size);
        arrow.rotation.y = deg(SCENE_TUNING.facing.arrowYawDegrees);
      }
      const hitRoot = view?.userData.hitMeshes?.[0];
      if (hitRoot) storeHitBase(hitRoot);
    }
  }

  makeVehicleShadow(seats) {
    const template = this.vehicleShadowTemplates?.[seats] ?? this.vehicleShadowTemplates?.[10];
    if (!template) return this.makeShadow(1, 1, 'conveyor');
    const shadow = template.clone(true);
    const material = this.vehicleShadowMaterials?.[seats] ?? this.vehicleShadowMaterials?.[10];
    setMaterial(shadow, material);
    shadow.traverse((object) => {
      if (object.isMesh) object.userData.isFakeShadow = true;
    });
    shadow.position.y = SCENE_TUNING.vehicleShadows.y;
    const seatScale = SCENE_TUNING.vehicleShadows.scaleBySeats?.[seats] ?? {};
    shadow.scale.multiply(new THREE.Vector3(
      SCENE_TUNING.vehicleShadows.scaleX * (seatScale.x ?? 1),
      1,
      SCENE_TUNING.vehicleShadows.scaleZ * (seatScale.z ?? 1)
    ));
    return shadow;
  }

  upgradeSpotViews() {
    for (let index = 0; index < this.spotRoots.length; index += 1) {
      const root = this.spotRoots[index];
      const board = this.seatCountBoards[index];
      root.clear();
      root.add(this.parkingTemplate.clone(true), board);
      board.userData.boardMesh.material.map = this.seatCountBoardTexture;
      board.userData.boardMesh.material.needsUpdate = true;
    }
  }


  updateSeatCountBoard(board, vehicle, time = 0) {
    const baseRemaining = Math.max(0, vehicle.seats - vehicle.boardedGroups) * LEVEL_1.groupSize;
    let boardingRemaining = 0;
    for (const entry of this.boardingViews) {
      if (entry.vehicleId !== vehicle.id) continue;
      if (time < entry.startedAt + entry.delay + entry.duration) boardingRemaining += 1;
    }
    const remaining = Math.max(0, baseRemaining + boardingRemaining);
    const visible = (
      remaining > 0 &&
      (vehicle.state === 'at-spot' || vehicle.state === 'boarding-final')
    );
    const vehicleChanged = board.userData.vehicleId !== vehicle.id;
    board.visible = visible;
    if (!visible) {
      board.userData.vehicleId = null;
      board.userData.remaining = null;
      return;
    }
    if (
      !vehicleChanged &&
      board.userData.remaining === remaining &&
      board.userData.colorIndex === vehicle.colorIndex
    ) return;
    board.userData.vehicleId = vehicle.id;
    board.userData.remaining = remaining;
    board.userData.colorIndex = vehicle.colorIndex;

    const config = PASSENGER_COUNT_BOARD_COLORS[vehicle.colorIndex] ?? PASSENGER_COUNT_BOARD_COLORS[0];
    board.userData.boardMesh.material.color.setHex(config.background);

    const canvas = board.userData.textCanvas;
    const context = canvas.getContext('2d');
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.font = '700 112px Arial, sans-serif';
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.lineJoin = 'round';
    context.miterLimit = 2;
    context.lineWidth = 18;
    context.strokeStyle = config.outline;
    context.fillStyle = '#ffffff';
    context.strokeText(String(remaining), canvas.width / 2, canvas.height / 2 + 2);
    context.fillText(String(remaining), canvas.width / 2, canvas.height / 2 + 2);
    board.userData.textTexture.needsUpdate = true;
  }

  setPassengerColor(view, colorIndex) {
    if (view.userData.colorIndex === colorIndex) return;
    view.userData.colorIndex = colorIndex;
    if (!view.userData.modelReady) {
      for (const slot of view.userData.personSlots) {
        slot.userData.fallback?.material.color.setHex(COLORS[colorIndex].hex);
      }
      return;
    }
    for (const slot of view.userData.personSlots) {
      const material = slot.userData.vatMaterial;
      if (material) {
        const map = this.passengerColorTextures[colorIndex] ?? this.passengerColorTextures[0];
        applyPassengerMaterial(material, colorIndex, map);
      }
    }
  }

  applyTuning() {
    this.applySceneLighting();
    const background = SCENE_TUNING.background;
    this.backgroundPlane.material.opacity = background.opacity;
    if (this.vehicleShadowMaterials) {
      Object.entries(this.vehicleShadowMaterials).forEach(([seats, material]) => {
        material.opacity = seats === '10' ? 0.8 : SCENE_TUNING.vehicleShadows.opacity;
      });
    }
    this.updatePassengerVisualTuning();
    this.updatePassengerMaterialTuning();
    this.updateVehicleArrowTuning();
    this.updateGuideHandTuning();

    const layout = getSelectedConveyorLayout();
    const layoutTuning = getSelectedConveyorTuning(layout.id);
    const conveyor = layoutTuning.art;
    this.setArtworkPlaneTexture(this.loopPlane, layout.assets.loopScene, layout.assets.loopSpriteRect);
    this.loopPlane.position.set(conveyor.x, conveyor.y, conveyor.z);
    this.loopPlane.rotation.set(-Math.PI / 2, 0, 0);
    this.loopPlane.scale.set(conveyor.width, conveyor.depth, 1);
    this.loopPlane.material.opacity = conveyor.opacity;

    this.buildPathCurves();
    const spots = SCENE_TUNING.parkingSpots;
    for (let i = 0; i < this.spotRoots.length; i += 1) {
      const position = this.spotPositions[i];
      position.set(spots.startX + spots.spacing * i, spots.y, spots.z);
      this.spotRoots[i].position.copy(position);
      this.spotRoots[i].rotation.y = deg(SCENE_TUNING.facing.parkingSpotYawDegrees);
      this.spotRoots[i].scale.set(spots.scaleX, 1, spots.scaleZ);
      const board = this.seatCountBoards[i];
      if (board) {
        const boardTuning = SCENE_TUNING.seatCountBoard;
        board.position.set(boardTuning.x, 0.03, boardTuning.z);
        board.rotation.y = -deg(SCENE_TUNING.facing.parkingSpotYawDegrees);
        board.scale.set(1 / Math.max(spots.scaleX, 0.0001), 1, 1 / Math.max(spots.scaleZ, 0.0001));
        board.userData.boardMesh.scale.set(boardTuning.width, boardTuning.depth, 1);
        board.userData.textSprite.scale.set(0.42 * boardTuning.textScale, 0.26 * boardTuning.textScale, 1);
      }
    }
    this.updateVehiclePathPreview();
    this.resize();
  }

  applySceneLighting() {
    const hemisphere = SCENE_TUNING.lighting?.hemisphere;
    if (this.hemisphereLight && hemisphere) {
      this.hemisphereLight.color.setHex(hemisphere.skyColor ?? 0xffffff);
      this.hemisphereLight.groundColor.setHex(hemisphere.groundColor ?? 0x77828f);
      this.hemisphereLight.intensity = hemisphere.intensity ?? 2.25;
    }

    const directional = SCENE_TUNING.lighting?.directional;
    if (!this.directionalLight || !this.directionalLightTarget || !directional) return;
    const position = directional.position ?? { x: 0, y: 3, z: 0 };
    const lightDirection = directionalLightDirection(directional.eulerDegrees ?? {});
    this.directionalLight.visible = Boolean(directional.enabled ?? 1);
    this.directionalLight.color.setHex(directional.color ?? 0xffffff);
    this.directionalLight.intensity = directional.intensity ?? 1;
    this.directionalLight.castShadow = false;
    this.directionalLight.position.set(position.x ?? 0, position.y ?? 3, position.z ?? 0);
    this.directionalLightTarget.position.copy(this.directionalLight.position).add(lightDirection);
    this.directionalLightTarget.updateMatrixWorld();
  }

  setTuning(patch, { mode = 'full', colorIndex = null } = {}) {
    deepMerge(SCENE_TUNING, patch);
    if (mode === 'passengerMaterial') {
      this.updatePassengerMaterialTuning({ colorIndex });
    } else {
      this.applyTuning();
    }
    return SCENE_TUNING;
  }

  update(snapshot, game) {
    const previousUpdateTime = this.lastSnapshot?.time ?? snapshot.time;
    const visualDelta = Math.max(0, Math.min(snapshot.time - previousUpdateTime, 0.1));
    this.lastSnapshot = snapshot;
    this.lastGame = game;
    this.vatTimeUniform.value = snapshot.time;
    if (snapshot.lastEvent.type === 'reset' && snapshot.time === 0) this.clearBoardingViews();
    this.processBoardingEvents(snapshot);
    this.updateBoardingViews(snapshot.time);
    const vehicleArea = SCENE_TUNING.vehicleArea;
    const vehicleYawOffset = deg(SCENE_TUNING.facing.vehicleYawOffsetDegrees);
    for (const board of this.seatCountBoards) {
      board.visible = false;
    }
    for (const vehicle of snapshot.vehicles) {
      const view = this.vehicleViews.get(vehicle.id);
      const layoutStart = mapVehicleAreaPoint(vehicle);
      const startYaw = mapVehicleAreaYaw(vehicle.yaw) + vehicleYawOffset;
      const start = new THREE.Vector3(
        layoutStart.x,
        vehicleArea.y,
        layoutStart.y
      );
      const spot = this.spotPositions[vehicle.spotIndex ?? 0];
      view.visible = vehicle.state !== 'done';
      let vehicleScale = vehicle.state === 'parked' || vehicle.state === 'colliding'
        ? 1 : (UNITY_VEHICLE_MOTION.stationScaleBySeats[vehicle.seats] ?? 1);
      if (vehicle.state === 'parked') {
        view.position.copy(start);
        view.rotation.y = startYaw;
      } else if (vehicle.state === 'colliding') {
        const direction = forwardFromYaw(vehicle.yaw);
        const position = {
          x: vehicle.x + direction.x * vehicle.collision.offset,
          z: vehicle.z + direction.z * vehicle.collision.offset
        };
        view.position.copy(mapMotionPoint(position));
        view.rotation.y = startYaw;
      } else if (vehicle.state === 'moving-to-spot') {
        const data = vehicle.motionData;
        const curveValue = evaluateUnityCurve(data.curve, vehicle.motion);
        const sample = evaluatePath(data.path, data.path.length * curveValue);
        view.position.copy(mapMotionPoint(sample.position));
        view.rotation.y = mapMotionTangentYaw(sample.tangent);
        vehicleScale = THREE.MathUtils.lerp(
          1,
          UNITY_VEHICLE_MOTION.stationScaleBySeats[vehicle.seats] ?? 1,
          evaluateUnityCurve(UNITY_CURVES.smoothScale, vehicle.motion)
        );
      } else if (vehicle.state === 'at-spot' || vehicle.state === 'boarding-final') {
        view.position.copy(spot);
        view.rotation.y = deg(SCENE_TUNING.facing.parkingSpotYawDegrees + 180) + vehicleYawOffset;
      } else if (vehicle.state === 'departing') {
        const data = vehicle.motionData;
        const total = data.backwardDuration + data.forwardDuration;
        const elapsed = vehicle.motion * total;
        const departureY = SCENE_TUNING.vehicleDeparturePath?.y ?? SCENE_TUNING.vehicleArea.y;
        if (elapsed < data.backwardDuration) {
          const t = evaluateUnityCurve(UNITY_CURVES.outBackward, elapsed / data.backwardDuration);
          const sample = evaluatePath(data.backwardPath, data.backwardPath.length * t);
          view.position.copy(mapMotionPoint(sample.position, departureY));
          view.rotation.y = mapMotionTangentYaw(sample.tangent, true);
        } else {
          const t = evaluateUnityCurve(
            UNITY_CURVES.outForward,
            (elapsed - data.backwardDuration) / data.forwardDuration
          );
          const sample = evaluatePath(data.forwardPath, data.forwardPath.length * t);
          view.position.copy(mapMotionPoint(sample.position, departureY));
          view.rotation.y = mapMotionTangentYaw(sample.tangent);
        }
      }
      const boardingPulseScale = this.getVehicleBoardingPulseScale(vehicle.id, snapshot.time);
      view.scale.setScalar(vehicleScale * SCENE_TUNING.vehicleArea.modelScale * boardingPulseScale);
      this.applyVehicleHit(view, vehicle, snapshot.time);
      const isMovable = vehicle.state === 'parked' && game.getBlockers(vehicle.id).length === 0;
      for (const mesh of view.userData.bodyMeshes ?? []) {
        if (!mesh.material.emissive) continue;
        mesh.material.emissive.setHex(isMovable ? 0x123a20 : 0x000000);
        mesh.material.emissiveIntensity = isMovable ? 0.22 : 0;
      }
      view.userData.boardedGroups = vehicle.boardedGroups;
      if (vehicle.spotIndex != null && snapshot.spots[vehicle.spotIndex]?.vehicleId === vehicle.id) {
        const board = this.seatCountBoards[vehicle.spotIndex];
        if (board) this.updateSeatCountBoard(board, vehicle, snapshot.time);
      }
    }

    const passengerYaw = deg(SCENE_TUNING.facing.passengerYawDegrees);
    const passengerHeight = SCENE_TUNING.passengers.heightAbovePath;
    const activeInitialEntryKeys = new Set();
    for (const slot of snapshot.slots) {
      const view = this.passengerViews[slot.index];
      view.visible = slot.colorIndex !== null;
      if (!view.visible) continue;
      const point = this.curve.getPointAt(slot.progress);
      const tangent = this.curve.getTangentAt(slot.progress);
      point.y += passengerHeight;
      if (slot.entryMotion) {
        const entryKey = this.getInitialEntryPathKey(slot);
        activeInitialEntryKeys.add(entryKey);
        const entryVisual = this.getInitialEntryPathVisual(
          entryKey,
          slot,
          point,
          tangent,
          snapshot.time,
          visualDelta,
          snapshot.speedMultiplier,
          passengerHeight
        );
        view.position.copy(entryVisual.position);
        view.rotation.y = Math.atan2(entryVisual.tangent.x, entryVisual.tangent.z) + passengerYaw;
      } else {
        view.position.copy(point);
        view.rotation.y = Math.atan2(tangent.x, tangent.z) + passengerYaw;
      }
      this.setPassengerColor(view, slot.colorIndex);
      this.setPassengerAnimation(view, 'move', slot.index > 0 && slot.index % 2 === 0 ? 0.3 : 0);
    }
    this.pruneInitialEntryPathStates(activeInitialEntryKeys);

    const queueSnapshots = snapshot.queueItems ?? snapshot.queues.map((queue) => (
      queue.map((colorIndex, index) => ({
        colorIndex,
        distanceFromHead: index * this.getQueueSpacing()
      }))
    ));
    queueSnapshots.forEach((queue, queueIndex) => {
      const curve = this.queueCurves[queueIndex];
      const views = this.queuePassengerViews[queueIndex];
      for (let i = 0; i < views.length; i += 1) {
        const view = views[i];
        const item = queue[i];
        const colorIndex = item?.colorIndex;
        view.visible = colorIndex !== undefined;
        if (!view.visible) continue;
        const t = this.getQueueProgressAtDistance(curve, item.distanceFromHead);
        const point = curve.getPointAt(t);
        const tangent = curve.getTangentAt(t);
        point.y += passengerHeight;
        const queueVisual = this.getQueueEntryVisual(
          queueIndex,
          item,
          point,
          tangent,
          visualDelta,
          snapshot.speedMultiplier,
          passengerHeight
        );
        view.position.copy(queueVisual.position);
        view.rotation.y = Math.atan2(-queueVisual.tangent.x, -queueVisual.tangent.z) + passengerYaw;
        this.setPassengerColor(view, colorIndex);
        this.setPassengerAnimation(view, 'idle', (i % 4) * 0.17);
      }
    });
    this.pruneQueueEntryPathStates(queueSnapshots);
    this.processBoardingEvents(snapshot);
    this.updateBoardingViews(snapshot.time);
    this.vehicleEffects?.update(snapshot);
    this.updateVehiclePathPreview(snapshot, game);
    this.updateGuideHand(snapshot.time, snapshot);
    this.updateFirstClickGuideMask(snapshot);
  }

  updateGuideHandTuning() {
    if (!this.guideHand || !this.guideHandMaterial) return;
    const tuning = SCENE_TUNING.vehicleGuideHand ?? {};
    this.guideHandMaterial.opacity = tuning.opacity ?? 1;
    this.updateGuideHand(this.lastSnapshot?.time ?? 0);
  }

  updateGuideHand(time = 0, snapshot = this.lastSnapshot) {
    if (!this.guideHand) return;
    if (SCENE_TUNING.firstClickGuide?.enabled) {
      this.guideHand.visible = false;
      return;
    }
    const tuning = SCENE_TUNING.vehicleGuideHand ?? {};
    const targetId = Math.round(tuning.vehicleId ?? 1);
    const target = this.vehicleViews.get(targetId);
    const targetState = snapshot?.vehicles?.find((vehicle) => vehicle.id === targetId)?.state;
    if (!tuning.enabled || !target || !target.visible || targetState !== 'parked') {
      this.guideHand.visible = false;
      return;
    }
    const speed = Math.max(0.001, tuning.speed ?? 1);
    const phase = (Math.sin(time * Math.PI * 2 * speed - Math.PI / 2) + 1) / 2;
    const offsetX = (tuning.offsetX ?? 0) + (tuning.approachOffsetX ?? 0) * (1 - phase);
    const offsetZ = (tuning.offsetZ ?? 0) + (tuning.approachOffsetZ ?? 0) * (1 - phase);
    this.guideHand.position.set(
      target.position.x + offsetX,
      target.position.y + (tuning.offsetY ?? 0.5),
      target.position.z + offsetZ
    );
    const scale = (tuning.size ?? 1) * THREE.MathUtils.lerp(tuning.farScale ?? 1.1, tuning.nearScale ?? 0.8, phase);
    this.guideHand.scale.set(
      Math.max(0.001, tuning.width ?? 0.46) * scale,
      Math.max(0.001, tuning.height ?? 0.56) * scale,
      1
    );
    this.guideHand.visible = true;
  }

  getFirstClickGuideTargetId() {
    const guide = SCENE_TUNING.firstClickGuide ?? {};
    return Math.round(guide.vehicleId ?? SCENE_TUNING.vehicleGuideHand?.vehicleId ?? 1);
  }

  isFirstClickGuideActive(snapshot = this.lastSnapshot) {
    const guide = SCENE_TUNING.firstClickGuide ?? {};
    if (!guide.enabled) return false;
    const duration = Math.max(0, Number(guide.durationSeconds) || 0);
    if (duration <= 0) return false;
    if ((snapshot?.time ?? 0) > duration) return false;
    const targetId = this.getFirstClickGuideTargetId();
    const target = this.vehicleViews.get(targetId);
    return Boolean(target && target.visible);
  }

  getObjectCanvasBounds(object) {
    object.updateWorldMatrix(true, true);
    const box = new THREE.Box3().setFromObject(object);
    if (box.isEmpty()) return null;
    const rect = this.canvas.getBoundingClientRect();
    const corners = [
      [box.min.x, box.min.y, box.min.z],
      [box.min.x, box.min.y, box.max.z],
      [box.min.x, box.max.y, box.min.z],
      [box.min.x, box.max.y, box.max.z],
      [box.max.x, box.min.y, box.min.z],
      [box.max.x, box.min.y, box.max.z],
      [box.max.x, box.max.y, box.min.z],
      [box.max.x, box.max.y, box.max.z]
    ];
    const bounds = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
    const projected = new THREE.Vector3();
    for (const [x, y, z] of corners) {
      projected.set(x, y, z).project(this.camera);
      if (!Number.isFinite(projected.x) || !Number.isFinite(projected.y)) return null;
      const canvasX = (projected.x + 1) * rect.width / 2;
      const canvasY = (1 - projected.y) * rect.height / 2;
      bounds.minX = Math.min(bounds.minX, canvasX);
      bounds.minY = Math.min(bounds.minY, canvasY);
      bounds.maxX = Math.max(bounds.maxX, canvasX);
      bounds.maxY = Math.max(bounds.maxY, canvasY);
    }
    return bounds;
  }

  updateFirstClickGuideMask(snapshot = this.lastSnapshot) {
    const mask = this.firstClickGuideMask;
    if (!mask) return;
    if (!this.isFirstClickGuideActive(snapshot)) {
      mask.root.hidden = true;
      return;
    }
    const target = this.vehicleViews.get(this.getFirstClickGuideTargetId());
    const bounds = this.getObjectCanvasBounds(target);
    const rect = this.canvas.getBoundingClientRect();
    if (!bounds || rect.width <= 0 || rect.height <= 0) {
      mask.root.hidden = true;
      return;
    }

    const guide = SCENE_TUNING.firstClickGuide ?? {};
    const padding = Math.max(0, Number(guide.holePadding) || 0);
    const baseCenterX = (bounds.minX + bounds.maxX) * 0.5;
    const baseCenterY = (bounds.minY + bounds.maxY) * 0.5;
    const scaledWidth = Math.max(0, (bounds.maxX - bounds.minX + padding * 2) * Math.max(0.01, Number(guide.holeScaleX) || 1));
    const scaledHeight = Math.max(0, (bounds.maxY - bounds.minY + padding * 2) * Math.max(0.01, Number(guide.holeScaleY) || 1));
    const left = Math.max(0, baseCenterX - scaledWidth * 0.5);
    const top = Math.max(0, baseCenterY - scaledHeight * 0.5);
    const right = Math.min(rect.width, baseCenterX + scaledWidth * 0.5);
    const bottom = Math.min(rect.height, baseCenterY + scaledHeight * 0.5);
    const width = Math.max(0, right - left);
    const height = Math.max(0, bottom - top);
    const setRect = (element, x, y, w, h) => {
      element.style.left = `${x}px`;
      element.style.top = `${y}px`;
      element.style.width = `${Math.max(0, w)}px`;
      element.style.height = `${Math.max(0, h)}px`;
    };

    mask.root.style.setProperty('--first-click-guide-opacity', String(THREE.MathUtils.clamp(guide.maskOpacity ?? 0.8, 0, 1)));
    setRect(mask.pieces.top, 0, 0, rect.width, top);
    setRect(mask.pieces.left, 0, top, left, height);
    setRect(mask.pieces.right, right, top, rect.width - right, height);
    setRect(mask.pieces.bottom, 0, bottom, rect.width, rect.height - bottom);
    setRect(mask.hole, left, top, width, height);
    this.updateFirstClickGuideHand(mask, target, snapshot);
    mask.root.hidden = false;
  }

  updateFirstClickGuideHand(mask, target, snapshot = this.lastSnapshot) {
    if (!mask.hand || !target) return;
    const tuning = SCENE_TUNING.vehicleGuideHand ?? {};
    const time = snapshot?.time ?? 0;
    const speed = Math.max(0.001, tuning.speed ?? 1);
    const phase = (Math.sin(time * Math.PI * 2 * speed - Math.PI / 2) + 1) / 2;
    const offsetX = (tuning.offsetX ?? 0) + (tuning.approachOffsetX ?? 0) * (1 - phase);
    const offsetZ = (tuning.offsetZ ?? 0) + (tuning.approachOffsetZ ?? 0) * (1 - phase);
    const projected = this.projectWorldToCanvas({
      x: target.position.x + offsetX,
      y: target.position.y + (tuning.offsetY ?? 0.5),
      z: target.position.z + offsetZ
    });
    if (!projected) {
      mask.hand.hidden = true;
      return;
    }
    const scale = (tuning.size ?? 1) * THREE.MathUtils.lerp(tuning.farScale ?? 1.1, tuning.nearScale ?? 0.8, phase);
    const rect = this.canvas.getBoundingClientRect();
    const reference = Math.max(1, Math.min(rect.width, rect.height));
    mask.hand.style.left = `${projected.x}px`;
    mask.hand.style.top = `${projected.y}px`;
    mask.hand.style.width = `${Math.max(1, (tuning.width ?? 0.46) * scale * reference * 0.08)}px`;
    mask.hand.style.height = `${Math.max(1, (tuning.height ?? 0.56) * scale * reference * 0.08)}px`;
    mask.hand.style.opacity = String(THREE.MathUtils.clamp(tuning.opacity ?? 1, 0, 1));
    mask.hand.hidden = false;
  }

  getQueueSpacing() {
    return this.getConveyorSlotSpacing();
  }

  getConveyorSlotSpacing() {
    return Math.max(0.01, (this.curve?.getLength?.() ?? 0.01) / Math.max(1, this.activeConveyorLayout?.conveyorCapacity ?? LEVEL_1.conveyorCapacity));
  }

  getConveyorPathLength() {
    return Math.max(0.0001, this.curve?.getLength?.() ?? LEVEL_1.conveyorPathLength ?? 1);
  }

  getQueueProgressAtDistance(curve, distance) {
    const length = Math.max(0.0001, curve?.getLength?.() ?? 0.0001);
    return THREE.MathUtils.clamp(distance / length, 0, 1);
  }

  getQueueCapacities() {
    return this.queueCurves.map((curve, index) => (
      Math.min(
        this.activeConveyorLayout?.queueCapacities?.[index] ?? LEVEL_1.queueCapacity,
        Math.floor((curve?.getLength?.() ?? 0) / this.getQueueSpacing()) + 1
      )
    ));
  }

  getConveyorConfig() {
    const layout = this.activeConveyorLayout ?? getSelectedConveyorLayout();
    return {
      layoutId: layout.id,
      capacity: layout.conveyorCapacity,
      queueCapacities: [...layout.queueCapacities],
      entryPercents: [...(this.entryPercents ?? [])],
      exitStart: layout.exitStart,
      exitEnd: layout.exitEnd
    };
  }

  getQueueLengths() {
    return this.queueCurves.map((curve) => curve?.getLength?.() ?? 0);
  }

  getInitialEntryPathKey(slot) {
    return `${slot.entryMotion?.passengerId ?? slot.index}:${slot.entryMotion?.startedAt ?? 0}`;
  }

  getInitialEntryPathVisual(key, slot, target, targetTangent, time, delta, speedMultiplier, passengerHeight) {
    const motion = LEVEL_1.passengerEntryMotion;
    const entryPercent = this.entryPercents?.[slot.entryMotion.entryIndex] ?? 0;
    let state = this.initialEntryPathStates.get(key);
    if (!state) {
      const queueKey = this.getQueueItemKey(slot.entryMotion.entryIndex, {
        id: slot.entryMotion.passengerId
      });
      const queueState = this.queueEntryPathStates.get(queueKey);
      const fromQueueDistance = this.getEntryMotionQueueDistance(slot.entryMotion);
      state = {
        distance: Math.max(0, fromQueueDistance - (queueState?.distanceFromHead ?? 0)),
        snapped: false
      };
      this.initialEntryPathStates.set(key, state);
    }
    if (!motion || state.snapped) return { position: target, tangent: targetTangent, snapped: true };

    const conveyorLength = Math.max(0.0001, this.curve.getLength());
    const targetConveyorDistance = ((slot.progress - entryPercent + 1) % 1) * conveyorLength;
    const fromQueueDistance = this.getEntryMotionQueueDistance(slot.entryMotion);
    const targetDistance = fromQueueDistance + targetConveyorDistance;
    const pathScale = (Math.abs(SCENE_TUNING.path.scaleX) + Math.abs(SCENE_TUNING.path.scaleZ)) * 0.5;
    const elapsed = Math.max(0, time - slot.entryMotion.startedAt);
    const multiplier = Math.max(1, speedMultiplier);
    const catchUpDuration = Math.max(motion.initialFillCatchUpDuration, 0.01);
    const catchUpT = THREE.MathUtils.clamp(elapsed / catchUpDuration, 0, 1);
    const catchUpSpeed = Math.max(0, motion.catchUpExtraSpeed * catchUpT);
    const stepDistance = (motion.passengerSpeed + catchUpSpeed) * pathScale * multiplier * Math.max(0, delta);
    state.distance = Math.min(targetDistance, state.distance + stepDistance);

    const snapDistance = (motion.snapDistance ?? 0.02) * pathScale;
    if (targetDistance - state.distance <= snapDistance) {
      state.snapped = true;
      state.distance = targetDistance;
      return { position: target, tangent: targetTangent, snapped: true };
    }

    if (state.distance < fromQueueDistance) {
      const queueCurve = this.queueCurves[slot.entryMotion.entryIndex] ?? this.queueCurves[0];
      const queueLength = Math.max(0.0001, queueCurve.getLength());
      const queueProgress = (fromQueueDistance - state.distance) / queueLength;
      const position = queueCurve.getPointAt(queueProgress);
      const tangent = queueCurve.getTangentAt(queueProgress).multiplyScalar(-1);
      position.y += passengerHeight;
      return { position, tangent, snapped: false };
    }

    const conveyorProgress = (entryPercent + (state.distance - fromQueueDistance) / conveyorLength) % 1;
    const position = this.curve.getPointAt(conveyorProgress);
    const tangent = this.curve.getTangentAt(conveyorProgress);
    position.y += passengerHeight;
    return { position, tangent, snapped: false };
  }

  pruneInitialEntryPathStates(activeKeys) {
    for (const key of this.initialEntryPathStates.keys()) {
      if (!activeKeys.has(key)) this.initialEntryPathStates.delete(key);
    }
  }

  getQueueEntrySpawnDistance(queueIndex) {
    const queueCurve = this.queueCurves[queueIndex] ?? this.queueCurves[0];
    const queueLength = Math.max(0.0001, queueCurve?.getLength?.() ?? 0.0001);
    const spacing = this.getQueueSpacing();
    return Math.min(queueLength, spacing);
  }

  getEntryMotionQueueDistance(entryMotion) {
    const queueCurve = this.queueCurves[entryMotion.entryIndex] ?? this.queueCurves[0];
    const queueLength = Math.max(0.0001, queueCurve?.getLength?.() ?? 0.0001);
    const distance = Number.isFinite(entryMotion.fromQueueDistance)
      ? entryMotion.fromQueueDistance
      : (entryMotion.fromQueueProgress ?? 0) * queueLength;
    return THREE.MathUtils.clamp(distance, 0, queueLength);
  }

  getQueueItemKey(queueIndex, item, fallbackIndex = 0) {
    return `${queueIndex}:${item.id ?? `${item.createdAt ?? 0}:${fallbackIndex}:${item.colorIndex}`}`;
  }

  getQueueEntryVisual(queueIndex, item, target, targetTangent, delta, speedMultiplier, passengerHeight) {
    const curve = this.queueCurves[queueIndex] ?? this.queueCurves[0];
    const motion = LEVEL_1.passengerEntryMotion;
    if (!curve || !motion) return { position: target, tangent: targetTangent };

    const key = this.getQueueItemKey(queueIndex, item);
    let state = this.queueEntryPathStates.get(key);
    if (!state) {
      const queueLength = Math.max(0.0001, curve.getLength());
      state = {
        distanceFromHead: Math.min(queueLength, item.distanceFromHead + this.getQueueEntrySpawnDistance(queueIndex))
      };
      this.queueEntryPathStates.set(key, state);
    }

    const speed = Math.max(0.01, motion.passengerSpeed ?? LEVEL_1.conveyorSpeed);
    const step = speed * Math.max(0, delta) * Math.max(1, speedMultiplier);
    state.distanceFromHead = Math.max(item.distanceFromHead, state.distanceFromHead - step);

    const visualDistance = Math.max(item.distanceFromHead, state.distanceFromHead);
    if (visualDistance - item.distanceFromHead <= (motion.snapDistance ?? 0.02)) {
      state.distanceFromHead = item.distanceFromHead;
      return { position: target, tangent: targetTangent };
    }

    const t = this.getQueueProgressAtDistance(curve, visualDistance);
    const position = curve.getPointAt(t);
    const tangent = curve.getTangentAt(t);
    position.y += passengerHeight;
    return { position, tangent, snapped: false };
  }

  pruneQueueEntryPathStates(queueSnapshots) {
    const activeKeys = new Set();
    queueSnapshots.forEach((queue, queueIndex) => {
      queue.forEach((item, index) => activeKeys.add(this.getQueueItemKey(queueIndex, item, index)));
    });
    for (const key of this.queueEntryPathStates.keys()) {
      if (!activeKeys.has(key)) this.queueEntryPathStates.delete(key);
    }
  }

  applyVehicleHit(view, vehicle, time) {
    const meshes = view.userData.hitMeshes ?? [];
    for (const mesh of meshes) {
      mesh.position.copy(mesh.userData.hitBasePosition);
      mesh.rotation.copy(mesh.userData.hitBaseRotation);
    }
    if (!vehicle.hit || time - vehicle.hit.startedAt >= UNITY_VEHICLE_MOTION.hitDuration) return;
    const clipName = chooseHitClip(vehicle.hit);
    const sample = sampleHitClip(clipName, time - vehicle.hit.startedAt);
    const scale = view.userData.unityHitScale ?? 1;
    for (const mesh of meshes) {
      mesh.position[sample.positionAxis] += sample.position * scale;
      mesh.position.y += sample.positionY * scale;
      mesh.rotation[sample.rotationAxis] += deg(sample.rotationDegrees);
    }
  }

  clearBoardingViews() {
    for (const entry of this.boardingViews) {
      this.scene.remove(entry.root);
      entry.material.dispose();
    }
    this.boardingViews.length = 0;
    this.vehicleBoardingPulses.clear();
    this.initialEntryPathStates.clear();
    this.queueEntryPathStates.clear();
    this.lastBoardingEventId = 0;
  }

  triggerVehicleBoardingPulse(vehicleId, time) {
    const tuning = SCENE_TUNING.vehicleBoardingPulse ?? {};
    if ((tuning.scale ?? 1) <= 1 || (tuning.speed ?? 0) <= 0) return;
    const pulses = this.vehicleBoardingPulses.get(vehicleId) ?? [];
    pulses.push(time);
    this.vehicleBoardingPulses.set(vehicleId, pulses.slice(-12));
  }

  getVehicleBoardingPulseScale(vehicleId, time) {
    const tuning = SCENE_TUNING.vehicleBoardingPulse ?? {};
    const maxScale = Math.max(1, tuning.scale ?? 1);
    const speed = Math.max(0, tuning.speed ?? 0);
    const pulses = this.vehicleBoardingPulses.get(vehicleId);
    if (maxScale <= 1 || speed <= 0 || !pulses?.length) return 1;

    let scale = 1;
    let activeCount = 0;
    for (const startedAt of pulses) {
      const progress = (time - startedAt) * speed;
      if (progress < 0) {
        pulses[activeCount] = startedAt;
        activeCount += 1;
        continue;
      }
      if (progress >= 1) continue;
      scale = Math.max(scale, 1 + (maxScale - 1) * Math.sin(Math.PI * progress));
      pulses[activeCount] = startedAt;
      activeCount += 1;
    }
    pulses.length = activeCount;
    if (pulses.length === 0) this.vehicleBoardingPulses.delete(vehicleId);
    return scale;
  }

  processBoardingEvents(snapshot) {
    if (!this.personTemplate) return;
    for (const event of snapshot.boardingEvents ?? []) {
      if (event.id <= this.lastBoardingEventId) continue;
      this.spawnBoardingGroup(event);
      this.lastBoardingEventId = event.id;
    }
  }

  spawnBoardingGroup(event) {
    const spot = this.spotPositions[event.spotIndex];
    if (!spot) return;
    const startCenter = this.curve.getPointAt(event.progress);
    startCenter.y += SCENE_TUNING.passengers.heightAbovePath;
    const tangent = this.curve.getTangentAt(event.progress);
    const pathYaw = Math.atan2(tangent.x, tangent.z) + deg(SCENE_TUNING.facing.passengerYawDegrees);
    const target = spot.clone();
    target.y = SCENE_TUNING.path.groundY + SCENE_TUNING.passengers.heightAbovePath;

    for (let index = 0; index < LEVEL_1.groupSize; index += 1) {
      const visual = this.createPassengerVisual(event.colorIndex);
      visual.scale.setScalar(SCENE_TUNING.passengers.modelScale);
      const rowOffset = new THREE.Vector3(
        (index - 1.5) * SCENE_TUNING.passengers.groupSpacing * SCENE_TUNING.passengers.modelScale,
        0,
        0
      ).applyAxisAngle(new THREE.Vector3(0, 1, 0), pathYaw);
      const start = startCenter.clone().add(rowOffset);
      const direction = target.clone().sub(start);
      visual.position.copy(start);
      visual.rotation.y = Math.atan2(direction.x, direction.z)
        + deg(SCENE_TUNING.facing.passengerYawDegrees);
      this.setVatAnimation(visual.userData.vatMaterial, 'move');
      this.scene.add(visual);
      this.boardingViews.push({
        root: visual,
        material: visual.userData.vatMaterial,
        vehicleId: event.vehicleId,
        start,
        target: target.clone(),
        startedAt: event.startedAt,
        delay: index * SCENE_TUNING.passengers.aboardInterval,
        duration: Math.max(0.25, start.distanceTo(target) / SCENE_TUNING.passengers.aboardSpeed)
      });
    }
  }

  updateBoardingViews(time) {
    for (let index = this.boardingViews.length - 1; index >= 0; index -= 1) {
      const entry = this.boardingViews[index];
      const elapsed = time - entry.startedAt - entry.delay;
      if (elapsed < 0) continue;
      const progress = THREE.MathUtils.clamp(elapsed / entry.duration, 0, 1);
      entry.root.position.lerpVectors(entry.start, entry.target, ease(progress));
      if (progress < 1) continue;
      this.triggerVehicleBoardingPulse(entry.vehicleId, time);
      this.vehicleEffects?.spawnAboardSmoke(entry.vehicleId);
      this.hooks.onPassengerAboard?.(entry.vehicleId);
      this.scene.remove(entry.root);
      entry.material.dispose();
      this.boardingViews.splice(index, 1);
    }
  }

  pick(event) {
    const rect = this.canvas.getBoundingClientRect();
    this.pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const hits = this.raycaster.intersectObjects([...this.vehicleViews.values()], true);
    let object = hits[0]?.object;
    while (object && object.userData.vehicleId == null) object = object.parent;
    if (object?.userData.vehicleId != null) this.onVehicleClick(object.userData.vehicleId);
  }

  projectWorldToCanvas({ x = 0, y = 0, z = 0 } = {}) {
    const rect = this.canvas.getBoundingClientRect();
    const point = new THREE.Vector3(Number(x) || 0, Number(y) || 0, Number(z) || 0).project(this.camera);
    if (!Number.isFinite(point.x) || !Number.isFinite(point.y) || !Number.isFinite(point.z)) {
      return null;
    }
    return {
      x: (point.x + 1) * rect.width / 2,
      y: (1 - point.y) * rect.height / 2,
      depth: point.z
    };
  }

  resize() {
    const rect = this.canvas.getBoundingClientRect();
    const width = Math.max(1, Math.round(rect.width || this.canvas.clientWidth || innerWidth));
    const height = Math.max(1, Math.round(rect.height || this.canvas.clientHeight || innerHeight));
    const aspect = width / height;
    const camera = SCENE_TUNING.camera;
    const crop = SCENE_TUNING.sourceCrop;
    const cropEnabled = Boolean(crop?.enabled);
    const responsiveCrop = cropEnabled
      ? resolveResponsiveCropFit({
        width,
        height,
        crop,
        background: SCENE_TUNING.background
      })
      : null;
    const halfHeight = cropEnabled
      ? calculateDesignCoverHalfHeight({
        width,
        height,
        designWidth: SCENE_TUNING.preview?.width ?? 1080,
        designHeight: SCENE_TUNING.preview?.height ?? 2160,
        fitHeight: camera.fitHeight
      })
      : calculateOrthographicHalfHeight({
        width,
        height,
        ...resolveCameraFit({
          camera,
          responsiveCrop,
          cropEnabled
        }),
        padding: camera.padding
      });
    const distance = calculatePerspectiveDistance(halfHeight, camera.fovDegrees);
    const elevation = deg(camera.elevationDegrees);
    const cropOffsetX = cropEnabled
      ? responsiveCrop.cropOffsetX
      : 0;
    const cropOffsetZ = cropEnabled
      ? responsiveCrop.cropOffsetY
      : 0;
    const target = new THREE.Vector3(
      camera.targetX + cropOffsetX,
      camera.targetY,
      camera.targetZ + cropOffsetZ
    );
    this.camera.fov = camera.fovDegrees;
    this.camera.aspect = aspect;
    this.camera.position.set(
      target.x,
      target.y + Math.sin(elevation) * distance,
      target.z + Math.cos(elevation) * distance
    );
    this.camera.lookAt(target);

    const background = SCENE_TUNING.background;
    const backgroundDistance = distance + background.distanceOffset;
    const backgroundWidth = background.width;
    const backgroundHeight = background.height;
    this.backgroundPlane.position.set(
      background.offsetX - cropOffsetX,
      background.offsetY + cropOffsetZ,
      -backgroundDistance
    );
    this.backgroundPlane.scale.set(
      backgroundWidth,
      backgroundHeight,
      1
    );
    this.camera.near = Math.max(0.1, distance - 35);
    this.camera.far = backgroundDistance + 5;
    this.camera.updateProjectionMatrix();
    this.camera.updateMatrixWorld(true);
    this.renderer.setSize(width, height, false);
    if (this.fullQueueCurves) this.updateQueueCurvesForCamera();
  }

  render() {
    this.renderer.render(this.scene, this.camera);
  }
}
