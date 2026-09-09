import * as THREE from 'three';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { gunzipSync, unzlibSync } from 'three/addons/libs/fflate.module.js';
import { clone as cloneSkeleton } from 'three/addons/utils/SkeletonUtils.js';
import { COLORS, LEVEL_1, PASSENGER_COUNT_BOARD_COLORS } from './level-data.js';
import {
  MAX_CONVEYOR_CAPACITY,
  MAX_QUEUE_CAPACITY,
  getConveyorLayout
} from './conveyor-layouts.js';
import { SCENE_TUNING } from './scene-tuning.js';
import {
  SPATIAL_CONVEYOR_DISPLAY,
  buildSpatialConveyorExitGeometry,
  buildSpatialConveyorGeometry,
  createSpatialCurveLookup,
  getSpatialConveyorPackage,
  getSpatialConveyorWorldPoints,
  sampleSpatialCurveLookup
} from './spatial-conveyor-runtime.js';
import { CONVEYOR_MECHANISM_TUNING } from './conveyor-mechanism-config.js';
import { MECHANISM_ASSETS } from './mechanism-resources.js';
import { GARAGE_SIZE_MULTIPLIER } from './vehicle-collision.js';
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
const ENTRY_BANNER_TIMELINE_SECONDS = 1.45;
const ENTRY_BANNER_DURATION_SECONDS = ENTRY_BANNER_TIMELINE_SECONDS;
const ARROW_OUTLINE_SCALE = 1.28;
const GUIDE_HAND_TEXTURE_URL = '/assets/applovin/main-guide-hand_q80.webp';
const TURN_ARROW_ASSET_URL = MECHANISM_ASSETS.turnVehicle.arrow;
const TURN_ARROW_SCALE = 0.8;
const TURN_ARROW_FORWARD_OFFSET = 0.18;
const VEHICLE_ARROW_HIDDEN_STATES = new Set(['at-spot', 'boarding-final', 'departing', 'done']);
export const shouldHideVehicleArrow = (state) => VEHICLE_ARROW_HIDDEN_STATES.has(state);
const HIDDEN_QUESTION_MARK_FORWARD_FACTOR = 0.45;
const HIDDEN_VEHICLE_BODY_COLOR = 0x2a2a2a;
const HIDDEN_VEHICLE_ASSETS = MECHANISM_ASSETS.hiddenVehicle;
const HIDDEN_REVEAL_DURATION = 0.5;
const GARAGE_ASSETS = MECHANISM_ASSETS.garage;
const GARAGE_MODEL_TARGET = Object.freeze({ width: 1.00850928, depth: 1.33755 });
const GARAGE_MODEL_YAW_OFFSET = Math.PI;
const GARAGE_SHADOW_FORWARD_OFFSET = 0.1;
const GARAGE_DOOR_SWING = deg(144.25);
const CONVEYOR_VEHICLE_ASSETS = MECHANISM_ASSETS.vehicleTransportBelt;
const CONVEYOR_MODEL_DEPTH = 1.15;
const CONVEYOR_BUILD_CAP_WIDTH = 1.02;
const CONVEYOR_BUILD_CAP_DEPTH = 1.24;
// Keep these named constants for the existing conveyor contract; their
// values are also part of the isolated, non-resettable mechanism config.
// CONVEYOR_LEFT_DOOR_OUTWARD_SCALE = 1.17
// CONVEYOR_RIGHT_DOOR_OUTWARD_SCALE = 1.2
const CONVEYOR_LEFT_DOOR_OUTWARD_SCALE = CONVEYOR_MECHANISM_TUNING.leftDoorOutwardScale;
const CONVEYOR_RIGHT_DOOR_OUTWARD_SCALE = CONVEYOR_MECHANISM_TUNING.rightDoorOutwardScale;
const CONVEYOR_BUILD_SIDE_SIZE = Object.freeze({ width: 0.34, depth: 0.38 });
const DEFAULT_CONVEYOR_LAYOUT_ID = 'dualQueue2';
const SPATIAL_PASSENGER_CHUNK_COUNT = 4;
const AMBULANCE_COLOR_INDEX = 13;
const LUXURY_COLOR_INDEX = 15;
// The VAT mesh already uses the runtime forward axis; no extra yaw is needed.
const AMBULANCE_PASSENGER_YAW_OFFSET_DEGREES = 0;
const AMBULANCE_STEP_BOARD_BASE_SCALE = 0.56 * 1.2 * 1.2;
const AMBULANCE_STEP_BOARD_OFFSET_Y = 0.42 * 0.9;
const AMBULANCE_STEP_BOARD_FONT_SIZE = 76 * 1.1;
const AMBULANCE_ASSETS = MECHANISM_ASSETS.ambulance;
const AMBULANCE_PASSENGER_ANIMATIONS = Object.freeze({
  textureWidth: 859,
  textureHeight: 79,
  idle: { uvMin: 0, uvMax: 59 / 79, duration: 2 },
  move: { uvMin: 60 / 79, uvMax: 78 / 79, duration: 0.60000014 }
});
// Unity's passenger_luxury prefab applies a 90 degree root yaw. FBXLoader's
// imported root is corrected separately below; no extra roll is required.
const LUXURY_PASSENGER_YAW_OFFSET_DEGREES = 90;
const LUXURY_PASSENGER_MODEL_ROTATION_DEGREES = Object.freeze({
  x: 90,
  y: 0,
  z: -90
});
const LUXURY_PASSENGER_VISUAL_OFFSET = Object.freeze({
  x: -0.12,
  y: 0,
  z: 0
});
// Unity's bus_limousine material is the dark base group; its separate metal
// material is the gold group shown on the limousine body.
const LUXURY_VEHICLE_MATCAP_BRIGHTNESS = 4.1;
const LUXURY_VEHICLE_DIFFUSE_STRENGTH = 0.65;
const LUXURY_VEHICLE_BASE_EMISSION = Object.freeze({ r: 0.71488965, g: 0.73663896, b: 0.8018868 });
const LUXURY_VEHICLE_METAL_EMISSION = Object.freeze({ r: 0.8207547, g: 0.65016747, b: 0.2981043 });
const LUXURY_PASSENGER_BODY_EMISSION = Object.freeze({ r: 0.6431373, g: 0.6431373, b: 0.6431373 });
const LUXURY_PASSENGER_CLOTH_EMISSION = Object.freeze({ r: 0.78431374, g: 0.73587906, b: 0.3882353 });
const LUXURY_PASSENGER_ANIMATION_ASSET = MECHANISM_ASSETS.luxuryVehicle.animation;
const LUXURY_ASSETS = MECHANISM_ASSETS.luxuryVehicle;
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

function decodeOptionalGzip(buffer) {
  const bytes = buffer instanceof Uint8Array
    ? buffer
    : new Uint8Array(buffer);
  if (bytes[0] === 0x1f && bytes[1] === 0x8b) return gunzipSync(bytes);
  return bytes;
}

function isGarageType(value) {
  return value === 2 || String(value ?? '').trim().toLowerCase() === 'garage';
}

function isConveyorType(value) {
  const normalized = String(value ?? '').trim().toLowerCase();
  return value === 3 || normalized === 'conveyorbelt' || normalized === 'conveyor-belt';
}

function getSelectedBackgroundUrl() {
  return SCENE_TUNING.background?.asset || LEVEL_1.assets.background;
}

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

function getSelectedSpatialConveyor() {
  return getSpatialConveyorPackage(SCENE_TUNING.conveyorLayout?.selected);
}

function isConfiguredSpatialOptimizationEnabled(key) {
  const optimizations = SCENE_TUNING.spatialConveyor?.optimizations;
  return Boolean(
    getSelectedSpatialConveyor()
    && optimizations?.enabled
    && optimizations?.[key]
  );
}

function getSpatialRuntimeCapacity(packageData) {
  const authoredGroupCount = (LEVEL_1.passengerQueues ?? [LEVEL_1.passengerSequence])
    .reduce((sum, queue) => sum + queue.length, 0);
  const importedCapacity = Math.max(1, Math.floor(packageData?.gameplay?.capacity ?? 1));
  const configuredCapacity = Number(SCENE_TUNING.spatialConveyor?.capacity);
  const requestedCapacity = Number.isFinite(configuredCapacity) && configuredCapacity >= 1
    ? Math.floor(configuredCapacity)
    : importedCapacity;
  return Math.max(1, Math.min(requestedCapacity, authoredGroupCount || requestedCapacity));
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
  const bytes = decodeOptionalGzip(buffer);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const magic = String.fromCharCode(...bytes.subarray(0, 4));
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
  const bytes = decodeOptionalGzip(buffer);
  if (bytes.byteLength !== width * height * 8) throw new Error('Unexpected VAT texture size.');
  const texture = new THREE.DataTexture(
    new Uint16Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 2),
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

function createWhiteAlphaTexture(source) {
  const image = source?.image;
  if (!image?.width || !image?.height) return source;
  const canvas = document.createElement('canvas');
  canvas.width = image.width;
  canvas.height = image.height;
  const context = canvas.getContext('2d');
  context.drawImage(image, 0, 0);
  const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
  for (let index = 0; index < pixels.data.length; index += 4) {
    pixels.data[index] = 255;
    pixels.data[index + 1] = 255;
    pixels.data[index + 2] = 255;
  }
  context.putImageData(pixels, 0, 0);
  return configureColorTexture(new THREE.CanvasTexture(canvas));
}

async function loadPackedVatTexture(url, loadingManager) {
  loadingManager?.itemStart(url);
  let buffer;
  try {
    buffer = await fetch(url).then((response) => {
      if (!response.ok) throw new Error(`Packed VAT texture request failed: ${response.status}`);
      return response.arrayBuffer();
    });
    loadingManager?.itemEnd(url);
  } catch (error) {
    loadingManager?.itemError(url);
    loadingManager?.itemEnd(url);
    throw error;
  }
  const bytes = decodeOptionalGzip(buffer);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const magic = String.fromCharCode(...bytes.subarray(0, 4));
  if (magic !== 'VATQ' || view.getUint32(4, true) !== 1) {
    throw new Error('Unsupported packed VAT texture binary.');
  }
  const width = view.getUint32(8, true);
  const height = view.getUint32(12, true);
  const positionMin = new THREE.Vector3(
    view.getFloat32(16, true),
    view.getFloat32(20, true),
    view.getFloat32(24, true)
  );
  const positionMax = new THREE.Vector3(
    view.getFloat32(28, true),
    view.getFloat32(32, true),
    view.getFloat32(36, true)
  );
  const packed = unzlibSync(bytes.subarray(40));
  if (packed.byteLength !== width * height * 3) throw new Error('Unexpected packed VAT texture size.');
  // Use RGBA8 on the GPU for broader WebGL/WebView compatibility than RGB8.
  const data = new Uint8Array(width * height * 4);
  for (let source = 0, target = 0; source < packed.length; source += 3, target += 4) {
    data[target] = packed[source];
    data[target + 1] = packed[source + 1];
    data[target + 2] = packed[source + 2];
    data[target + 3] = 255;
  }
  const texture = new THREE.DataTexture(
    data,
    width,
    height,
    THREE.RGBAFormat,
    THREE.UnsignedByteType
  );
  texture.minFilter = THREE.NearestFilter;
  texture.magFilter = THREE.NearestFilter;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.generateMipmaps = false;
  texture.flipY = false;
  texture.needsUpdate = true;
  return {
    texture,
    width,
    height,
    positionMin,
    positionRange: positionMax.sub(positionMin)
  };
}

async function loadPackedFbx(url, loader, loadingManager, resourcePath = null) {
  loadingManager?.itemStart(url);
  try {
    const buffer = await fetch(url).then((response) => {
      if (!response.ok) throw new Error(`Packed FBX request failed: ${response.status}`);
      return response.arrayBuffer();
    });
    const bytes = decodeOptionalGzip(buffer);
    loadingManager?.itemEnd(url);
    return loader.parse(
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
      resourcePath ?? url.slice(0, url.lastIndexOf('/') + 1)
    );
  } catch (error) {
    loadingManager?.itemError(url);
    loadingManager?.itemEnd(url);
    throw error;
  }
}

async function loadJsonAsset(url, loadingManager) {
  loadingManager?.itemStart(url);
  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`JSON asset request failed: ${response.status}`);
    const data = await response.json();
    loadingManager?.itemEnd(url);
    return data;
  } catch (error) {
    loadingManager?.itemError(url);
    loadingManager?.itemEnd(url);
    throw error;
  }
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

function findFirstMaterialMap(root) {
  let map = null;
  root?.traverse((child) => {
    if (map || !child.isMesh) return;
    forEachMaterial(child.material, (material) => {
      if (!map && material.map) map = material.map;
    });
  });
  return map;
}

function copyGeometryGroups(source, target) {
  target.clearGroups();
  for (const group of source?.groups ?? []) {
    target.addGroup(group.start, group.count, group.materialIndex);
  }
  return target;
}

function applyUnityMatcapLook(
  material,
  { brightness = 1, contrast = 1, diffuseStrength = 1, emissionColor = null, emissionStrength = 0 } = {}
) {
  const previousOnBeforeCompile = material.onBeforeCompile;
  const emissionMultiplier = emissionColor
    ? ` * (vec3(1.0) + vec3(${emissionColor.r}, ${emissionColor.g}, ${emissionColor.b}) * ${emissionStrength})`
    : '';
  material.userData.unityMatcapLook = {
    baseBrightness: brightness,
    multiplier: 1,
    brightness
  };
  material.onBeforeCompile = function onUnityMatcapCompile(shader, renderer) {
    previousOnBeforeCompile?.call(this, shader, renderer);
    const look = this.userData.unityMatcapLook;
    shader.uniforms.busloopUnityMatcapBrightness = {
      value: look?.brightness ?? brightness
    };
    if (look) look.uniform = shader.uniforms.busloopUnityMatcapBrightness;
    shader.fragmentShader = shader.fragmentShader
      .replace(
        'void main() {',
        'uniform float busloopUnityMatcapBrightness;\nvoid main() {'
      )
      .replace(
        'vec3 outgoingLight = diffuseColor.rgb * matcapColor.rgb;',
        `matcapColor.rgb = pow(max(matcapColor.rgb, vec3(0.0)), vec3(${contrast})) * busloopUnityMatcapBrightness;
\tvec3 outgoingLight = diffuseColor.rgb * matcapColor.rgb * ${diffuseStrength}${emissionMultiplier};`
      );
  };
  material.customProgramCacheKey = () => (
    `busloop-unity-matcap-${contrast}-${diffuseStrength}-${emissionColor ? `${emissionColor.r},${emissionColor.g},${emissionColor.b}` : 'none'}-${emissionStrength}`
  );
  return material;
}

function updateUnityMatcapBrightness(material, multiplier) {
  if (!material?.userData?.unityMatcapLook) return;
  const look = material.userData.unityMatcapLook;
  look.multiplier = multiplier;
  look.brightness = look.baseBrightness * multiplier;
  if (look.uniform) look.uniform.value = look.brightness;
}

function forEachMaterial(material, callback) {
  for (const entry of (Array.isArray(material) ? material : [material])) {
    if (entry) callback(entry);
  }
}

function applyLuxuryPassengerBrightness(material, brightness) {
  forEachMaterial(material, (entry) => {
    if (entry.userData.luxuryPassengerBody) {
      entry.color.setScalar(brightness);
      entry.emissiveIntensity = brightness;
    } else if (entry.userData.unityMatcapLook) {
      updateUnityMatcapBrightness(entry, 1);
      entry.color?.setScalar(brightness);
    }
  });
}

function removeImportedLights(root) {
  const importedLights = [];
  root.traverse((child) => {
    if (child.isLight) importedLights.push(child);
  });
  for (const light of importedLights) light.parent?.remove(light);
  return root;
}

function disposeMaterial(material) {
  for (const entry of (Array.isArray(material) ? material : [material])) entry?.dispose?.();
}

function makeSharedAttributeGeometry(source) {
  const geometry = new THREE.BufferGeometry();
  geometry.setIndex(source.index);
  for (const [name, attribute] of Object.entries(source.attributes)) {
    geometry.setAttribute(name, attribute);
  }
  for (const [name, attributes] of Object.entries(source.morphAttributes ?? {})) {
    geometry.morphAttributes[name] = [...attributes];
  }
  geometry.morphTargetsRelative = source.morphTargetsRelative;
  geometry.groups = source.groups.map((group) => ({ ...group }));
  geometry.setDrawRange(source.drawRange.start, source.drawRange.count);
  geometry.boundingBox = source.boundingBox?.clone() ?? null;
  geometry.boundingSphere = source.boundingSphere?.clone() ?? null;
  return geometry;
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

function makeCenteredArrow(template) {
  const visual = template.clone(true);
  const root = new THREE.Group();
  root.userData.fittedSize = visual.userData.fittedSize?.clone?.() ?? visual.userData.fittedSize;
  root.add(visual);
  return root;
}

function sampleQuaternionCurve(keys, time, duration, target) {
  if (!keys?.length) return target.identity();
  const wrappedTime = ((time % duration) + duration) % duration;
  if (keys.length === 1 || wrappedTime <= keys[0][0]) {
    return target.set(keys[0][1], keys[0][2], keys[0][3], keys[0][4]).normalize();
  }
  for (let index = 1; index < keys.length; index += 1) {
    const next = keys[index];
    if (wrappedTime > next[0]) continue;
    const previous = keys[index - 1];
    const span = Math.max(0.000001, next[0] - previous[0]);
    const amount = THREE.MathUtils.clamp((wrappedTime - previous[0]) / span, 0, 1);
    const from = new THREE.Quaternion(previous[1], previous[2], previous[3], previous[4]);
    const to = new THREE.Quaternion(next[1], next[2], next[3], next[4]);
    return target.copy(from).slerp(to, amount).normalize();
  }
  const last = keys.at(-1);
  return target.set(last[1], last[2], last[3], last[4]).normalize();
}

function sampleUnityQuaternionCurve(keys, time, duration, target) {
  sampleQuaternionCurve(keys, time, duration, target);
  // FBXLoader converts the model from Unity's basis. Mirror the Unity Y/Z
  // quaternion components before applying the authored bone rotation.
  return target.set(target.x, -target.y, -target.z, target.w).normalize();
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
  root.userData.pickMeshes = [body];
  storeHitBase(body);
  storeHitBase(arrow);
  return root;
}

function createGarageCounterBoard() {
  const canvas = document.createElement('canvas');
  canvas.width = 192;
  canvas.height = 192;
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const board = new THREE.Sprite(new THREE.SpriteMaterial({
    map: texture,
    transparent: true,
    depthTest: false,
    depthWrite: false
  }));
  board.position.set(0, 1.02, 0.06);
  board.scale.set(0.48, 0.48, 1);
  board.renderOrder = 110;
  board.raycast = () => {};
  board.userData.canvas = canvas;
  board.userData.texture = texture;
  board.userData.count = null;
  return board;
}

function makeGaragePlaceholder(container) {
  const root = new THREE.Group();
  root.userData.garageId = container.id;
  const bodyMaterial = new THREE.MeshStandardMaterial({ color: 0xa84138, roughness: 0.54 });
  const doorMaterial = new THREE.MeshStandardMaterial({ color: 0xd9aa55, roughness: 0.42 });
  const addBox = (width, height, depth, x, y, z, material = bodyMaterial) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), material);
    mesh.position.set(x, y, z);
    root.add(mesh);
    return mesh;
  };
  addBox(0.16, 0.66, 1.2, -0.46, 0.33, 0);
  addBox(0.16, 0.66, 1.2, 0.46, 0.33, 0);
  addBox(0.76, 0.66, 0.16, 0, 0.33, -0.52);
  addBox(1.08, 0.14, 1.2, 0, 0.73, 0);
  const leftPivot = new THREE.Group();
  const rightPivot = new THREE.Group();
  leftPivot.position.set(-0.42, 0, 0.57);
  rightPivot.position.set(0.42, 0, 0.57);
  const leftDoor = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.54, 0.06), doorMaterial);
  const rightDoor = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.54, 0.06), doorMaterial);
  leftDoor.position.set(0.21, 0.32, 0);
  rightDoor.position.set(-0.21, 0.32, 0);
  leftPivot.add(leftDoor);
  rightPivot.add(rightDoor);
  root.add(leftPivot, rightPivot);
  const counter = createGarageCounterBoard();
  root.add(counter);
  root.userData.doorRoots = [leftPivot, rightPivot];
  root.userData.doorBaseQuaternions = [leftPivot.quaternion.clone(), rightPivot.quaternion.clone()];
  root.userData.counter = counter;
  return root;
}

function makeConveyorPlaceholder(container) {
  const root = new THREE.Group();
  root.userData.conveyorId = container.id;
  const belt = new THREE.Mesh(
    new THREE.PlaneGeometry(1, 1),
    new THREE.MeshBasicMaterial({ color: 0x59606f, transparent: true, opacity: 0.96, side: THREE.DoubleSide })
  );
  belt.rotation.x = -Math.PI / 2;
  belt.scale.set(3.8, CONVEYOR_MODEL_DEPTH, 1);
  belt.position.y = 0.012;
  const arrow = new THREE.Mesh(
    new THREE.PlaneGeometry(1, 1),
    new THREE.MeshBasicMaterial({ color: 0xbec7d6, transparent: true, opacity: 0.8, side: THREE.DoubleSide })
  );
  arrow.rotation.x = -Math.PI / 2;
  arrow.scale.set(3.8, CONVEYOR_MODEL_DEPTH * 0.7, 1);
  arrow.position.y = 0.018;
  const components = {
    belt: setConveyorComponentBase(makeConveyorComponent('Belt', belt)),
    arrow: setConveyorComponentBase(makeConveyorComponent('Arrow', arrow))
  };
  root.add(...Object.values(components));
  root.userData.components = components;
  root.userData.belt = belt;
  root.userData.arrow = arrow;
  root.userData.width = 3.8;
  root.userData.buildParts = Object.values(components);
  return root;
}

function makeConveyorComponent(name, object) {
  const component = new THREE.Group();
  component.name = `Conveyor ${name}`;
  if (object) component.add(object);
  return component;
}

function setConveyorComponentBase(component, position = { x: 0, y: 0, z: 0 }) {
  component.position.set(position.x, position.y, position.z);
  component.userData.basePosition = component.position.clone();
  component.userData.baseScale = component.scale.clone();
  component.userData.baseRotation = component.rotation.clone();
  return component;
}

function makeConveyorBuildOverlay(texture, width, depth, name) {
  const overlay = new THREE.Mesh(
    new THREE.PlaneGeometry(1, 1),
    new THREE.MeshBasicMaterial({
      map: texture,
      color: 0xffffff,
      transparent: true,
      alphaTest: 0.02,
      depthWrite: false,
      // The Unity build planes are an authored top-down occlusion layer:
      // opaque cap pixels should cover belt vehicles at the two ends.
      depthTest: false,
      side: THREE.DoubleSide
    })
  );
  overlay.name = name;
  overlay.rotation.x = -Math.PI / 2;
  overlay.scale.set(width, depth, 1);
  overlay.position.y = 0.022;
  overlay.renderOrder = 12;
  return overlay;
}

export function isGuideLevelActive(tuning, activeLevelKey = LEVEL_1.key) {
  const levelKey = String(tuning?.levelKey ?? '').trim();
  return !levelKey || levelKey === activeLevelKey;
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
    const rendererOptions = { canvas, antialias: true, alpha: true };
    if (isConfiguredSpatialOptimizationEnabled('highPerformanceRenderer')) {
      rendererOptions.powerPreference = 'high-performance';
    }
    this.renderer = new THREE.WebGLRenderer(rendererOptions);
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.setClearColor(0xc9d7ed, 1);
    this.scene = new THREE.Scene();
    this.layoutRoot = new THREE.Group();
    this.layoutRoot.name = 'Level Layout Root';
    this.vehicleRoot = new THREE.Group();
    this.vehicleRoot.name = 'Vehicle Layout Root';
    this.layoutRoot.add(this.vehicleRoot);
    this.scene.add(this.layoutRoot);
    this.vehicleEntrance = null;
    this.camera = new THREE.PerspectiveCamera(SCENE_TUNING.camera.fovDegrees, 1, 0.1, 1000);
    this.raycaster = new THREE.Raycaster();
    this.inputEnabled = true;
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
    this.garageViews = new Map();
    this.conveyorViews = new Map();
    this.passengerViews = [];
    this.queuePassengerViews = [[], []];
    this.spotRoots = [];
    this.spotPositions = [];
    this.seatCountBoards = [];
    this.passengerMaterials = [];
    this.passengerColorTextures = [];
    this.unityAssetsFailed = false;
    this.vehicleMaterials = [];
    this.vehicleColorTextures = [];
    this.turnArrowTemplate = null;
    this.questionMarkTemplate = null;
    this.questionMarkTexture = null;
    this.hiddenVehicleTemplates = {};
    this.garageTemplate = null;
    this.garageShadowTemplate = null;
    this.garageMaterial = null;
    this.garageShadowMaterial = null;
    this.conveyorBeltTemplate = null;
    this.conveyorArrowTemplate = null;
    this.conveyorBeltTexture = null;
    this.conveyorArrowTexture = null;
    this.ambulanceVehicleTemplate = null;
    this.ambulanceVehicleMaterial = null;
    this.ambulancePassengerTemplate = null;
    this.ambulancePassengerTexture = null;
    this.ambulancePassengerVat = null;
    this.ambulanceStepBubbleTexture = null;
    this.luxuryVehicleTemplate = null;
    this.luxuryVehicleMaterial = null;
    this.luxuryPassengerTemplate = null;
    this.luxuryPassengerMaterial = null;
    this.luxuryPassengerAnimations = null;
    this.luxurySeatCountBoardTexture = null;
    this.vatTimeUniform = { value: 0 };
    this.boardingViews = [];
    this.vehicleBoardingPulses = new Map();
    this.initialEntryPathStates = new Map();
    this.queueEntryPathStates = new Map();
    this.boardingVisualPool = [];
    this.staticVehicleTransforms = new Map();
    this.blockerCache = new Map();
    this.blockerCacheSignature = '';
    this.spatialCurveLookup = null;
    this.spatialPassengerBatchRoot = null;
    this.spatialPassengerBatches = null;
    this.spatialPassengerBatchKey = '';
    this.spatialBatchScratch = {
      point: new THREE.Vector3(),
      tangent: new THREE.Vector3(),
      upAxis: new THREE.Vector3(0, 1, 0),
      quaternion: new THREE.Quaternion(),
      scale: new THREE.Vector3(),
      groupMatrix: new THREE.Matrix4(),
      slotMatrix: new THREE.Matrix4(),
      finalMatrix: new THREE.Matrix4()
    };
    this.lastBoardingEventId = 0;
    this.vehicleEffects = null;
    this.guideHand = null;
    this.guideHandMaterial = null;
    this.firstClickGuideMask = this.createFirstClickGuideMask();
    this.entryBanner = this.createEntryBanner();
    this.entryBannerState = null;
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

  createEntryBanner() {
    const parent = this.canvas.parentElement;
    if (!parent) return null;
    const assets = MECHANISM_ASSETS.entryBanner;
    const root = document.createElement('div');
    root.className = 'entry-banner-overlay';
    root.hidden = true;

    const mask = document.createElement('div');
    mask.className = 'entry-banner-screen-mask';
    const scene = document.createElement('div');
    scene.className = 'entry-banner-scene';
    const content = document.createElement('div');
    content.className = 'entry-banner-content';
    const bannerGroup = document.createElement('div');
    bannerGroup.className = 'entry-banner-banner-group';
    const arrowGroup = document.createElement('div');
    arrowGroup.className = 'entry-banner-arrow-group';
    const labelGroup = document.createElement('div');
    labelGroup.className = 'entry-banner-label-group';

    const makeImage = (className, source, alt = '') => {
      const image = document.createElement('img');
      image.className = className;
      image.src = source;
      image.alt = alt;
      image.draggable = false;
      return image;
    };

    const card = makeImage('entry-banner-card', assets.hardBackground);
    const arrows = Array.from({ length: 6 }, (_, index) => {
      const arrow = makeImage(`entry-banner-arrow entry-banner-arrow-${index + 1}`, assets.redArrows);
      arrow.dataset.arrowIndex = String(index);
      return arrow;
    });
    const label = makeImage('entry-banner-label', assets.hardTitle, 'HARD');
    arrowGroup.append(...arrows);
    labelGroup.append(label);
    bannerGroup.append(card, arrowGroup, labelGroup);
    content.append(bannerGroup);
    scene.append(content);
    root.append(mask, scene);
    parent.append(root);
    return { root, mask, scene, content, bannerGroup, card, arrowGroup, arrows, labelGroup, label };
  }

  updateEntryBannerComponentTransforms() {
    const banner = this.entryBanner;
    if (!banner) return;
    const components = SCENE_TUNING.entryBanner?.components ?? {};
    const toNumber = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
    const transform = (component = {}, defaultScale = 1) => {
      const position = component.position ?? {};
      const scale = component.scale ?? {};
      const rotation = component.rotation ?? {};
      return `translate3d(${toNumber(position.x) / 10.8}cqw, ${toNumber(position.y) / 10.8}cqw, ${toNumber(position.z) / 10.8}cqw) rotateX(${toNumber(rotation.x)}deg) rotateY(${toNumber(rotation.y)}deg) rotateZ(${toNumber(rotation.z)}deg) scale3d(${toNumber(scale.x, defaultScale)}, ${toNumber(scale.y, defaultScale)}, ${toNumber(scale.z, defaultScale)})`;
    };
    banner.card.style.transform = transform(components.banner);
    banner.arrowGroup.style.transform = transform(components.arrows);
    banner.labelGroup.style.transform = transform(components.label);
  }

  updateEntryBannerLayout() {
    const banner = this.entryBanner;
    const parent = banner?.root?.parentElement;
    if (!banner || !parent) return;
    const canvasRect = this.canvas.getBoundingClientRect();
    const parentRect = parent.getBoundingClientRect();
    const canvasWidth = Math.max(1, Number(canvasRect.width) || this.canvas.clientWidth || 1);
    const canvasHeight = Math.max(1, Number(canvasRect.height) || this.canvas.clientHeight || 1);
    const designWidth = Math.max(1, Number(SCENE_TUNING.preview?.width) || 1080);
    const designHeight = Math.max(1, Number(SCENE_TUNING.preview?.height) || 2160);
    const backgroundBounds = this.getBackgroundCanvasBounds?.();
    const playableLeft = Number.isFinite(backgroundBounds?.left) ? backgroundBounds.left : 0;
    const playableRight = Number.isFinite(backgroundBounds?.right) ? backgroundBounds.right : canvasWidth;
    const playableTop = Number.isFinite(backgroundBounds?.top) ? backgroundBounds.top : 0;
    const playableBottom = Number.isFinite(backgroundBounds?.bottom) ? backgroundBounds.bottom : canvasHeight;
    const playableWidth = Math.max(1, Math.min(canvasWidth, playableRight) - Math.max(0, playableLeft));
    const playableHeight = Math.max(1, Math.min(canvasHeight, playableBottom) - Math.max(0, playableTop));
    const uiScale = Math.min(1, playableWidth / designWidth, playableHeight / designHeight);
    const positionX = Number.isFinite(Number(SCENE_TUNING.entryBanner?.positionX))
      ? Number(SCENE_TUNING.entryBanner.positionX)
      : designWidth / 2;
    const positionY = Number.isFinite(Number(SCENE_TUNING.entryBanner?.positionY))
      ? Number(SCENE_TUNING.entryBanner.positionY)
      : designHeight / 2;

    const parentContentLeft = parentRect.left + (parent.clientLeft || 0);
    const parentContentTop = parentRect.top + (parent.clientTop || 0);
    banner.root.style.left = `${canvasRect.left - parentContentLeft + Math.max(0, playableLeft)}px`;
    banner.root.style.top = `${canvasRect.top - parentContentTop + Math.max(0, playableTop)}px`;
    banner.root.style.right = 'auto';
    banner.root.style.bottom = 'auto';
    banner.root.style.width = `${playableWidth}px`;
    banner.root.style.height = `${playableHeight}px`;
    banner.scene.style.left = `${playableWidth / 2 + (positionX - designWidth / 2) * uiScale}px`;
    banner.scene.style.top = `${playableHeight / 2 + (positionY - designHeight / 2) * uiScale}px`;
    banner.scene.style.width = `${1080 * uiScale}px`;
  }

  updateEntryBannerTuning() {
    const banner = this.entryBanner;
    if (!banner) return;
    const tuning = SCENE_TUNING.entryBanner ?? {};
    const enabled = Boolean(tuning.enabled);
    if (!enabled) {
      this.hideEntryBanner();
      return;
    }
    const style = String(tuning.style ?? 'hard').toLowerCase() === 'superhard' ? 'superhard' : 'hard';
    const assets = MECHANISM_ASSETS.entryBanner;
    banner.root.classList.toggle('is-superhard', style === 'superhard');
    banner.mask.hidden = !Boolean(tuning.maskEnabled);
    banner.mask.style.setProperty('--entry-banner-mask-opacity', String(
      THREE.MathUtils.clamp(Number(tuning.maskOpacity ?? 0.62), 0, 1)
    ));
    banner.card.src = style === 'superhard' ? assets.superHardBackground : assets.hardBackground;
    for (const arrow of banner.arrows) {
      arrow.src = style === 'superhard' ? assets.purpleArrows : assets.redArrows;
    }
    banner.label.src = style === 'superhard' ? assets.superHardTitle : assets.hardTitle;
    banner.label.alt = style === 'superhard' ? 'SUPER HARD' : 'HARD';
    this.updateEntryBannerComponentTransforms();
    banner.scene.style.setProperty('--entry-banner-scale', String(
      THREE.MathUtils.clamp(Number(tuning.scale ?? 1), 0.3, 2)
    ));
    this.updateEntryBannerLayout();
    banner.root.classList.remove('is-preview');
    this.updateEntryBannerFrame(0);
  }

  showEntryBanner() {
    const banner = this.entryBanner;
    if (!banner || !SCENE_TUNING.entryBanner?.enabled) return;
    this.entryBannerState = { startedAt: globalThis.performance?.now?.() ?? Date.now() };
    this.updateEntryBannerTuning();
    banner.root.hidden = false;
    banner.root.classList.remove('is-active');
    void banner.root.offsetWidth;
    banner.root.classList.add('is-active');
  }

  hideEntryBanner() {
    if (!this.entryBanner) return;
    this.entryBannerState = null;
    this.entryBanner.root.classList.remove('is-active');
    this.entryBanner.root.hidden = true;
  }

  updateEntryBanner(time = globalThis.performance?.now?.() ?? Date.now()) {
    if (!this.entryBannerState || !SCENE_TUNING.entryBanner?.enabled) return;
    const duration = Math.max(0.5, Number(SCENE_TUNING.entryBanner.durationSeconds) || ENTRY_BANNER_DURATION_SECONDS);
    const progress = (time - this.entryBannerState.startedAt) / (duration * 1000);
    this.updateEntryBannerFrame(progress * ENTRY_BANNER_TIMELINE_SECONDS);
    if (progress >= 1) this.hideEntryBanner();
  }

  updateEntryBannerFrame(time) {
    const banner = this.entryBanner;
    if (!banner) return;
    const frame = (keys, valueAtEnd = 0) => {
      if (time <= keys[0][0]) return keys[0][1];
      for (let index = 1; index < keys.length; index += 1) {
        const [endTime, endValue] = keys[index];
        const [startTime, startValue] = keys[index - 1];
        if (time <= endTime) return THREE.MathUtils.lerp(startValue, endValue, (time - startTime) / Math.max(0.0001, endTime - startTime));
      }
      return valueAtEnd ?? keys[keys.length - 1][1];
    };
    const bannerScaleY = frame([[0, 0.1], [0.233, 1.1], [0.383, 1], [1.283, 1], [ENTRY_BANNER_TIMELINE_SECONDS, 0]], 0);
    const fade = frame([[0, 0], [0.12, 1], [1.25, 1], [ENTRY_BANNER_TIMELINE_SECONDS, 0]], 0);
    const maskFade = frame([[0, 0], [0.12, 1], [1.22, 1], [ENTRY_BANNER_TIMELINE_SECONDS, 0]], 0);
    const labelScale = frame([[0, 0], [0.266, 1.1], [0.416, 1]], 1);
    banner.bannerGroup.style.opacity = String(fade);
    banner.mask.style.opacity = String(maskFade);
    banner.bannerGroup.style.transform = `translateY(-50%) scale(1, ${bannerScaleY})`;
    banner.bannerGroup.hidden = time >= ENTRY_BANNER_TIMELINE_SECONDS;
    banner.label.style.transform = `translate(-50%, -50%) scale(${labelScale})`;
    const arrowKeys = [[0.533, 0.8], [0.383, 0.65], [0.266, 0.683], [0.35, 0.633], [0.466, 0.7], [0.55, 0.783]];
    for (let index = 0; index < banner.arrows.length; index += 1) {
      const arrow = banner.arrows[index];
      const [start, end] = arrowKeys[index];
      const alpha = frame([[start, 0], [end, 1], [end + 0.25, 1], [end + 0.32, 0]], 0);
      arrow.style.opacity = String(alpha);
      arrow.style.transform = `translate(-50%, -50%) translateY(${frame([[start, 55], [end, 3]], 3)}px)`;
      arrow.hidden = alpha <= 0.001;
    }
  }

  buildGarageViews() {
    for (const container of (LEVEL_1.containers ?? []).filter((item) => isGarageType(item.type))) {
      const view = makeGaragePlaceholder(container);
      const position = mapVehicleAreaPoint(container);
      view.position.set(position.x, SCENE_TUNING.vehicleArea.y, position.y);
      view.rotation.y = mapVehicleAreaYaw(container.yaw);
      view.scale.setScalar(SCENE_TUNING.vehicleArea.modelScale * GARAGE_SIZE_MULTIPLIER);
      this.garageViews.set(container.id, view);
      this.vehicleRoot.add(view);
    }
  }

  buildConveyorViews() {
    for (const container of (LEVEL_1.containers ?? []).filter((item) => isConveyorType(item.type))) {
      const view = makeConveyorPlaceholder(container);
      const position = mapVehicleAreaPoint(container);
      view.position.set(position.x, SCENE_TUNING.vehicleArea.y, position.y);
      view.rotation.y = mapVehicleAreaYaw(container.yaw);
      view.renderOrder = -2;
      this.conveyorViews.set(container.id, view);
      this.vehicleRoot.add(view);
    }
  }

  clearConveyorViews() {
    for (const view of this.conveyorViews.values()) this.vehicleRoot.remove(view);
    this.conveyorViews.clear();
  }

  upgradeConveyorViews() {
    if (!this.conveyorBeltTemplate || !this.conveyorArrowTemplate) return;
    for (const [id, view] of this.conveyorViews) {
      const width = Number(view.userData.width) || 3.8;
      const belt = normalizeObject(toStaticMeshGroup(this.conveyorBeltTemplate.clone(true)), {
        width,
        depth: CONVEYOR_MODEL_DEPTH
      });
      const arrow = normalizeObject(toStaticMeshGroup(this.conveyorArrowTemplate.clone(true)), {
        width,
        depth: CONVEYOR_MODEL_DEPTH * 0.7
      });
      setMaterial(belt, new THREE.MeshBasicMaterial({
        map: this.conveyorBeltTexture,
        color: 0xffffff,
        transparent: true,
        side: THREE.DoubleSide
      }));
      setMaterial(arrow, new THREE.MeshBasicMaterial({
        map: this.conveyorArrowTexture,
        color: 0xffffff,
        transparent: true,
        alphaTest: 0.01,
        depthWrite: false,
        side: THREE.DoubleSide
      }));
      belt.position.y = 0.012;
      arrow.position.y = 0.018;
      const capWidth = Math.min(CONVEYOR_BUILD_CAP_WIDTH, width * 0.32);
      const capDepth = CONVEYOR_BUILD_CAP_DEPTH;
      // Keep the visible door inner edges on the same opening width used by
      // the conveyor collision context. This prevents a car from appearing
      // to clear a door while the matching collision box still blocks it.
      const configuredExitWidth = Number(LEVEL_1.collision?.conveyor?.exitWidth);
      const openingHalfWidth = configuredExitWidth > 0
        ? configuredExitWidth * 0.5
        : Math.max(0, width * 0.5 - 0.06);
      const doorCenterOffset = openingHalfWidth + capWidth * 0.5;
      const leftDoor = this.conveyorDoorLeftTexture
        ? makeConveyorBuildOverlay(this.conveyorDoorLeftTexture, capWidth, capDepth, 'Conveyor Door Left')
        : null;
      const rightDoor = this.conveyorDoorRightTexture
        ? makeConveyorBuildOverlay(this.conveyorDoorRightTexture, capWidth, capDepth, 'Conveyor Door Right')
        : null;
      const leftSide = this.conveyorLeftSideTexture
        ? makeConveyorBuildOverlay(
          this.conveyorLeftSideTexture,
          CONVEYOR_BUILD_SIDE_SIZE.width,
          CONVEYOR_BUILD_SIDE_SIZE.depth,
          'Conveyor Left Side'
        )
        : null;
      const rightSide = this.conveyorRightSideTexture
        ? makeConveyorBuildOverlay(
          this.conveyorRightSideTexture,
          CONVEYOR_BUILD_SIDE_SIZE.width,
          CONVEYOR_BUILD_SIDE_SIZE.depth,
          'Conveyor Right Side'
        )
        : null;
      const components = {
        belt: setConveyorComponentBase(makeConveyorComponent('Belt', belt)),
        arrow: setConveyorComponentBase(makeConveyorComponent('Arrow', arrow)),
        doorLeft: setConveyorComponentBase(
          makeConveyorComponent('Door Left', leftDoor),
          { x: -doorCenterOffset * CONVEYOR_LEFT_DOOR_OUTWARD_SCALE, y: 0, z: 0 }
        ),
        doorRight: setConveyorComponentBase(
          makeConveyorComponent('Door Right', rightDoor),
          { x: doorCenterOffset * CONVEYOR_RIGHT_DOOR_OUTWARD_SCALE, y: 0, z: 0 }
        ),
        sideLeft: setConveyorComponentBase(
          makeConveyorComponent('Side Left', leftSide),
          { x: -width * 0.5 + 0.12, y: 0, z: -CONVEYOR_MODEL_DEPTH * 0.45 }
        ),
        sideRight: setConveyorComponentBase(
          makeConveyorComponent('Side Right', rightSide),
          { x: width * 0.5 - 0.12, y: 0, z: CONVEYOR_MODEL_DEPTH * 0.45 }
        )
      };
      view.clear();
      view.add(...Object.values(components));
      view.userData.components = components;
      view.userData.belt = belt;
      view.userData.arrow = arrow;
      view.userData.buildParts = Object.values(components);
      view.userData.conveyorId = id;
    }
  }

  updateConveyorViews(snapshot) {
    const states = new Map((snapshot.mechanicState?.conveyors ?? []).map((item) => [Number(item.id), item]));
    for (const [id, view] of this.conveyorViews) {
      const state = states.get(Number(id));
      // A conveyor container owns all six imported visual components. Only
      // an explicitly hidden state (the empty conveyor state) removes them.
      view.visible = state ? !state.hidden : true;
      for (const part of view.userData.buildParts ?? []) part.visible = view.visible;
      if (!state) continue;
      const map = findFirstMaterialMap(view.userData.arrow);
      if (map) {
        map.wrapS = THREE.RepeatWrapping;
        map.offset.x = (snapshot.time * (state.speed ?? 0.4)) % 1;
        map.needsUpdate = true;
      }
    }
  }

  applyConveyorVisualTuning() {
    const tuning = CONVEYOR_MECHANISM_TUNING;
    const rootScale = Math.max(0.01, Number(tuning.visualRootScale) || 1);
    for (const view of this.conveyorViews.values()) {
      view.scale.setScalar(rootScale);
      for (const [key, component] of Object.entries(view.userData.components ?? {})) {
        const config = tuning.components?.[key] ?? {};
        const basePosition = component.userData.basePosition ?? new THREE.Vector3();
        const baseScale = component.userData.baseScale ?? new THREE.Vector3(1, 1, 1);
        const baseRotation = component.userData.baseRotation ?? new THREE.Euler();
        const numberOr = (value, fallback) => Number.isFinite(Number(value)) ? Number(value) : fallback;
        component.position.set(
          basePosition.x + numberOr(config.positionX, 0),
          basePosition.y + numberOr(config.positionY, 0),
          basePosition.z + numberOr(config.positionZ, 0)
        );
        component.scale.set(
          baseScale.x * Math.max(0.01, numberOr(config.scaleX, 1)),
          baseScale.y * Math.max(0.01, numberOr(config.scaleY, 1)),
          baseScale.z * Math.max(0.01, numberOr(config.scaleZ, 1))
        );
        component.rotation.set(
          baseRotation.x + deg(numberOr(config.rotationXDegrees, 0)),
          baseRotation.y + deg(numberOr(config.rotationYDegrees, 0)),
          baseRotation.z + deg(numberOr(config.rotationZDegrees, 0))
        );
      }
    }
  }

  clearGarageViews() {
    for (const view of this.garageViews.values()) this.vehicleRoot.remove(view);
    this.garageViews.clear();
  }

  updateGarageCounter(board, count) {
    if (!board || board.userData.count === count) return;
    const canvas = board.userData.canvas;
    const context = canvas.getContext('2d');
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.beginPath();
    context.arc(96, 96, 72, 0, Math.PI * 2);
    context.fillStyle = '#e45143';
    context.fill();
    context.lineWidth = 14;
    context.strokeStyle = '#6f211d';
    context.stroke();
    context.font = '900 92px "Poppins Branding"';
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.lineJoin = 'round';
    context.lineWidth = 12;
    context.strokeStyle = '#6f211d';
    context.fillStyle = '#ffffff';
    context.strokeText(String(count), 96, 100);
    context.fillText(String(count), 96, 100);
    board.userData.texture.needsUpdate = true;
    board.userData.count = count;
  }

  upgradeGarageViews() {
    if (!this.garageTemplate) return;
    for (const view of this.garageViews.values()) {
      const model = cloneSkeleton(this.garageTemplate);
      setMaterial(model, this.garageMaterial);
      // Garage.prefab rotates the Truck child 180 degrees around Y. The FBX
      // is imported without that prefab instance transform.
      model.rotation.y = GARAGE_MODEL_YAW_OFFSET;
      const shadow = this.garageShadowTemplate?.clone(true) ?? null;
      if (shadow) {
        setMaterial(shadow, this.garageShadowMaterial);
        shadow.rotation.y = GARAGE_MODEL_YAW_OFFSET;
        // The garage doors face local +Z after the prefab's 180-degree yaw.
        // Move only the fake shadow toward that front edge; keep its tuned
        // ground offset and the shared parent scale unchanged.
        shadow.position.set(0, SCENE_TUNING.vehicleShadows.y, GARAGE_SHADOW_FORWARD_OFFSET);
      }
      const counter = createGarageCounterBoard();
      view.clear();
      if (shadow) view.add(shadow);
      view.add(model, counter);
      const doorRoots = [
        model.getObjectByName('Bone_Door01'),
        model.getObjectByName('Bone_Door02')
      ].filter(Boolean);
      view.userData.modelRoot = model;
      view.userData.doorRoots = doorRoots;
      view.userData.doorBaseQuaternions = doorRoots.map((door) => door.quaternion.clone());
      view.userData.counter = counter;
    }
  }

  updateGarageViews(snapshot) {
    for (const garage of snapshot.mechanicState?.garages ?? []) {
      const view = this.garageViews.get(garage.id);
      if (!view) continue;
      view.visible = !garage.hidden;
      if (!view.visible) continue;
      this.updateGarageCounter(view.userData.counter, garage.vehicleIds.length);
      const exitingVehicle = garage.exitingVehicleId == null
        ? null
        : snapshot.vehicles.find((vehicle) => vehicle.id === garage.exitingVehicleId);
      const motion = exitingVehicle?.motionData;
      const progress = motion
        ? THREE.MathUtils.clamp(
          (motion.elapsed - motion.delay) / Math.max(0.001, motion.duration),
          0,
          1
        )
        : 0;
      const swing = Math.sin(progress * Math.PI) * GARAGE_DOOR_SWING;
      for (let index = 0; index < (view.userData.doorRoots?.length ?? 0); index += 1) {
        const door = view.userData.doorRoots[index];
        const base = view.userData.doorBaseQuaternions[index];
        door.quaternion.copy(base);
        // Unity's Ani_Truck clips animate each door around its local Z hinge
        // axis, with opposite signs for the two leaves.
        door.rotateZ((index === 0 ? -1 : 1) * swing);
      }
    }
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


    this.backgroundPlane = this.makeArtworkPlane(getSelectedBackgroundUrl());
    this.backgroundPlane.rotation.set(0, 0, 0);
    this.backgroundPlane.material.depthWrite = false;
    this.backgroundPlane.renderOrder = -100;
    const conveyorLayout = getSelectedConveyorLayout();
    this.loopPlane = this.makeArtworkPlane(
      conveyorLayout.assets.loopScene,
      conveyorLayout.assets.loopSpriteRect
    );
    this.spatialConveyorRoot = new THREE.Group();
    this.spatialConveyorRoot.name = 'Spatial Conveyor Root';
    this.camera.add(this.backgroundPlane);
    this.scene.add(this.camera);
    this.layoutRoot.add(this.loopPlane, this.spatialConveyorRoot);
    this.buildPathCurves();
    this.buildSpots();
    this.buildGuideHand();

    this.buildGarageViews();
    this.buildConveyorViews();
    for (const vehicle of LEVEL_1.vehicles) {
      const view = makeVehiclePlaceholder(vehicle);
      this.vehicleViews.set(vehicle.id, view);
      this.vehicleRoot.add(view);
    }
    if (!this.shouldUseSpatialPassengerInstancing()) {
      this.ensurePassengerViewCapacity(Math.max(
        MAX_CONVEYOR_CAPACITY,
        this.activeConveyorLayout?.conveyorCapacity ?? 0
      ));
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
    this.layoutRoot.add(sprite);
  }

  buildPathCurves() {
    const spatialPackage = getSelectedSpatialConveyor();
    if (spatialPackage) {
      const points = getSpatialConveyorWorldPoints(spatialPackage, SCENE_TUNING.spatialConveyor);
      const capacity = getSpatialRuntimeCapacity(spatialPackage);
      this.activeSpatialConveyor = spatialPackage;
      this.activeConveyorLayout = {
        id: `spatial:${spatialPackage.id}`,
        kind: 'spatial',
        conveyorCapacity: capacity,
        queueCapacities: [0],
        exitStart: spatialPackage.exit?.startPercent ?? 0.8,
        exitEnd: spatialPackage.exit?.endPercent ?? 0.9,
        directEntrance: true
      };
      this.curve = makeOpenCurve(points);
      this.spatialCurveLookup = this.isSpatialOptimizationEnabled('curveLookup')
        ? createSpatialCurveLookup(this.curve)
        : null;
      this.fullQueueCurves = [];
      this.queueCurves = [];
      this.entryPercents = [spatialPackage.entrances?.[0]?.percent ?? 0];
      if (!this.shouldUseSpatialPassengerInstancing()) {
        this.ensurePassengerViewCapacity(capacity);
      }
      if (!this.isSpatialOptimizationEnabled('skipUnusedQueues')) {
        this.ensureQueuePassengerViewCapacity(LEVEL_1.queueCount, MAX_QUEUE_CAPACITY);
      }
      return;
    }

    const layout = getSelectedConveyorLayout();
    const tuning = getSelectedConveyorTuning(layout.id);
    this.activeSpatialConveyor = null;
    this.spatialCurveLookup = null;
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
    this.ensureQueuePassengerViewCapacity(LEVEL_1.queueCount, MAX_QUEUE_CAPACITY);
  }

  ensurePassengerViewCapacity(capacity) {
    let added = false;
    while (this.passengerViews.length < capacity) {
      const view = makePassengerGroup(SCENE_TUNING.passengers.modelScale);
      view.visible = false;
      this.passengerViews.push(view);
      this.layoutRoot.add(view);
      added = true;
    }
    if (added && this.personTemplate) this.upgradePassengerViews();
  }

  ensureQueuePassengerViewCapacity(queueCount, capacity) {
    let added = false;
    while (this.queuePassengerViews.length < queueCount) this.queuePassengerViews.push([]);
    for (let queueIndex = 0; queueIndex < queueCount; queueIndex += 1) {
      const views = this.queuePassengerViews[queueIndex];
      while (views.length < capacity) {
        const view = makePassengerGroup(SCENE_TUNING.passengers.modelScale);
        view.visible = false;
        views.push(view);
        this.layoutRoot.add(view);
        added = true;
      }
    }
    if (added && this.personTemplate) this.upgradePassengerViews();
  }

  isSpatialOptimizationEnabled(key) {
    const optimizations = SCENE_TUNING.spatialConveyor?.optimizations;
    return Boolean(
      this.activeSpatialConveyor
      && optimizations?.enabled
      && optimizations?.[key]
    );
  }

  shouldUseSpatialPassengerInstancing() {
    return this.isSpatialOptimizationEnabled('instancedPassengers')
      && this.isSpatialOptimizationEnabled('instancedShadows')
      && !this.hasAmbulanceVehicles()
      && !this.hasLuxuryVehicles();
  }

  hasAmbulanceVehicles() {
    return LEVEL_1.vehicles.some((vehicle) => Number.isInteger(vehicle.ambulanceStepLimit));
  }

  hasLuxuryVehicles() {
    return LEVEL_1.vehicles.some((vehicle) => vehicle.colorIndex === LUXURY_COLOR_INDEX || vehicle.isLuxury);
  }

  hasConveyorVehicles() {
    return LEVEL_1.vehicles.some((vehicle) => isConveyorType(vehicle.containerType));
  }

  sampleActiveCurve(progress, targetPoint = new THREE.Vector3(), targetTangent = new THREE.Vector3()) {
    if (this.spatialCurveLookup && this.isSpatialOptimizationEnabled('curveLookup')) {
      return sampleSpatialCurveLookup(
        this.spatialCurveLookup,
        progress,
        targetPoint,
        targetTangent
      );
    }
    this.curve.getPointAt(progress, targetPoint);
    this.curve.getTangentAt(progress, targetTangent).normalize();
    return { point: targetPoint, tangent: targetTangent };
  }

  disposeSpatialPassengerBatches() {
    const batches = this.spatialPassengerBatches;
    if (!batches) return;
    this.layoutRoot.remove(batches.root);
    for (const geometry of batches.ownedGeometries) geometry.dispose();
    for (const material of batches.ownedMaterials) material.dispose();
    this.spatialPassengerBatches = null;
    this.spatialPassengerBatchRoot = null;
    this.spatialPassengerBatchKey = '';
  }

  makeSpatialChunkSphere(chunkIndex, chunkCount) {
    const points = [];
    const samples = 64;
    const start = chunkIndex / chunkCount;
    const end = (chunkIndex + 1) / chunkCount;
    for (let index = 0; index <= samples; index += 1) {
      const progress = THREE.MathUtils.lerp(start, end, index / samples);
      const point = new THREE.Vector3();
      const tangent = new THREE.Vector3();
      this.sampleActiveCurve(progress, point, tangent);
      points.push(point);
    }
    const sphere = new THREE.Box3().setFromPoints(points).getBoundingSphere(new THREE.Sphere());
    sphere.radius += Math.max(1.5, SCENE_TUNING.passengers.modelScale * 1.5);
    return sphere;
  }

  buildSpatialPassengerBatches(capacity) {
    this.disposeSpatialPassengerBatches();
    if (!this.personTemplate || !this.shadowTemplate || !this.passengerColorTextures.length) return null;

    const chunkCount = SPATIAL_PASSENGER_CHUNK_COUNT;
    const maxInstancesPerChunk = Math.ceil(capacity / chunkCount) * LEVEL_1.groupSize + LEVEL_1.groupSize;
    const root = new THREE.Group();
    root.name = 'Spatial Passenger Instance Batches';
    const ownedGeometries = new Set();
    const ownedMaterials = new Set();

    this.personTemplate.updateMatrixWorld(true);
    const personSources = [];
    this.personTemplate.traverse((mesh) => {
      if (!mesh.isMesh) return;
      personSources.push({
        geometry: mesh.geometry,
        matrix: mesh.matrixWorld.clone()
      });
    });

    this.shadowTemplate.updateMatrixWorld(true);
    const shadowRootMatrix = new THREE.Matrix4().compose(
      new THREE.Vector3(
        SCENE_TUNING.passengerShadows.conveyor.offsetX,
        SCENE_TUNING.shadows.y,
        SCENE_TUNING.passengerShadows.conveyor.offsetZ
      ),
      new THREE.Quaternion().setFromAxisAngle(
        new THREE.Vector3(0, 1, 0),
        deg(SCENE_TUNING.facing.passengerShadowYawDegrees)
      ),
      new THREE.Vector3(
        SCENE_TUNING.passengers.shadowScale * SCENE_TUNING.passengerShadows.conveyor.scaleX,
        1,
        SCENE_TUNING.passengers.shadowScale * 1.2
          * SCENE_TUNING.passengerShadows.conveyor.scaleZ / 1.26
      )
    );
    const shadowSources = [];
    this.shadowTemplate.traverse((mesh) => {
      if (!mesh.isMesh) return;
      shadowSources.push({
        geometry: mesh.geometry,
        matrix: shadowRootMatrix.clone().multiply(mesh.matrixWorld)
      });
    });

    const personPivotMatrix = new THREE.Matrix4().compose(
      new THREE.Vector3(0, SCENE_TUNING.shadows.y + 0.002, 0),
      new THREE.Quaternion().setFromAxisAngle(
        new THREE.Vector3(0, 1, 0),
        deg(SCENE_TUNING.facing.passengerModelYawDegrees)
      ),
      new THREE.Vector3(1, 1, 1)
    );
    const personBaseMatrices = personSources.map((source) => (
      personPivotMatrix.clone().multiply(source.matrix)
    ));
    const chunkSpheres = Array.from(
      { length: chunkCount },
      (_, chunkIndex) => this.makeSpatialChunkSphere(chunkIndex, chunkCount)
    );
    const useCulling = this.isSpatialOptimizationEnabled('frustumCulling');

    const passengerBatches = this.passengerColorTextures.map((_map, colorIndex) => {
      const material = this.createVatMaterial(colorIndex, { instanced: true });
      this.setVatAnimation(material, 'move');
      ownedMaterials.add(material);
      return Array.from({ length: chunkCount }, (_, chunkIndex) => {
        const meshes = personSources.map((source) => {
          const geometry = makeSharedAttributeGeometry(source.geometry);
          const phaseOffset = new THREE.InstancedBufferAttribute(
            new Float32Array(maxInstancesPerChunk),
            1
          );
          phaseOffset.setUsage(THREE.DynamicDrawUsage);
          geometry.setAttribute('vatPhaseOffset', phaseOffset);
          ownedGeometries.add(geometry);
          const mesh = new THREE.InstancedMesh(geometry, material, maxInstancesPerChunk);
          mesh.name = 'Spatial Passengers ' + colorIndex + ':' + chunkIndex;
          mesh.count = 0;
          mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
          mesh.frustumCulled = useCulling;
          mesh.boundingSphere = chunkSpheres[chunkIndex].clone();
          root.add(mesh);
          return mesh;
        });
        return { meshes, count: 0 };
      });
    });

    const shadowGeometries = shadowSources.map((source) => {
      const geometry = source.geometry.clone();
      ownedGeometries.add(geometry);
      return geometry;
    });
    const shadowBatches = Array.from({ length: chunkCount }, (_, chunkIndex) => {
      const meshes = shadowGeometries.map((geometry) => {
        const mesh = new THREE.InstancedMesh(geometry, this.shadowMaterial, maxInstancesPerChunk);
        mesh.name = 'Spatial Passenger Shadows ' + chunkIndex;
        mesh.count = 0;
        mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        mesh.frustumCulled = useCulling;
        mesh.boundingSphere = chunkSpheres[chunkIndex].clone();
        root.add(mesh);
        return mesh;
      });
      return { meshes, count: 0 };
    });

    this.layoutRoot.add(root);
    this.spatialPassengerBatchRoot = root;
    this.spatialPassengerBatches = {
      root,
      capacity,
      chunkCount,
      maxInstancesPerChunk,
      passengerBatches,
      shadowBatches,
      personBaseMatrices,
      shadowBaseMatrices: shadowSources.map((source) => source.matrix),
      ownedGeometries,
      ownedMaterials
    };
    this.spatialPassengerBatchKey = [
      capacity,
      SCENE_TUNING.passengers.modelScale,
      SCENE_TUNING.passengers.groupSpacing,
      SCENE_TUNING.passengers.shadowScale,
      SCENE_TUNING.facing.passengerModelYawDegrees,
      SCENE_TUNING.facing.passengerShadowYawDegrees,
      SCENE_TUNING.passengerShadows.conveyor.offsetX,
      SCENE_TUNING.passengerShadows.conveyor.offsetZ,
      SCENE_TUNING.passengerShadows.conveyor.scaleX,
      SCENE_TUNING.passengerShadows.conveyor.scaleZ,
      useCulling ? 1 : 0
    ].join(':');
    return this.spatialPassengerBatches;
  }

  updateSpatialPassengerBatches(snapshot) {
    const useInstancing = this.shouldUseSpatialPassengerInstancing();
    if (!useInstancing || !this.personTemplate || !this.shadowTemplate) {
      if (this.spatialPassengerBatchRoot) this.spatialPassengerBatchRoot.visible = false;
      return false;
    }
    const capacity = this.activeConveyorLayout?.conveyorCapacity ?? snapshot.slots.length;
    const expectedKey = [
      capacity,
      SCENE_TUNING.passengers.modelScale,
      SCENE_TUNING.passengers.groupSpacing,
      SCENE_TUNING.passengers.shadowScale,
      SCENE_TUNING.facing.passengerModelYawDegrees,
      SCENE_TUNING.facing.passengerShadowYawDegrees,
      SCENE_TUNING.passengerShadows.conveyor.offsetX,
      SCENE_TUNING.passengerShadows.conveyor.offsetZ,
      SCENE_TUNING.passengerShadows.conveyor.scaleX,
      SCENE_TUNING.passengerShadows.conveyor.scaleZ,
      this.isSpatialOptimizationEnabled('frustumCulling') ? 1 : 0
    ].join(':');
    const batches = this.spatialPassengerBatchKey === expectedKey
      ? this.spatialPassengerBatches
      : this.buildSpatialPassengerBatches(capacity);
    if (!batches) return false;

    batches.root.visible = true;
    for (const colorBatches of batches.passengerBatches) {
      for (const batch of colorBatches) batch.count = 0;
    }
    for (const batch of batches.shadowBatches) batch.count = 0;

    const scratch = this.spatialBatchScratch;
    const passengerHeight = SCENE_TUNING.passengers.heightAbovePath;
    const passengerYaw = deg(SCENE_TUNING.facing.passengerYawDegrees);
    const groupScale = SCENE_TUNING.passengers.modelScale;
    const groupSpacing = SCENE_TUNING.passengers.groupSpacing;
    for (const slot of snapshot.slots) {
      if (slot.colorIndex == null) continue;
      this.sampleActiveCurve(slot.progress, scratch.point, scratch.tangent);
      scratch.point.y += passengerHeight;
      const yaw = Math.atan2(scratch.tangent.x, scratch.tangent.z) + passengerYaw;
      scratch.quaternion.setFromAxisAngle(scratch.upAxis, yaw);
      scratch.scale.setScalar(groupScale);
      scratch.groupMatrix.compose(scratch.point, scratch.quaternion, scratch.scale);
      const chunkIndex = Math.min(
        batches.chunkCount - 1,
        Math.floor(THREE.MathUtils.clamp(slot.progress, 0, 0.999999) * batches.chunkCount)
      );
      const passengerBatch = batches.passengerBatches[slot.colorIndex]?.[chunkIndex];
      const shadowBatch = batches.shadowBatches[chunkIndex];
      if (!passengerBatch || !shadowBatch) continue;
      const phase = slot.index > 0 && slot.index % 2 === 0 ? 0.3 : 0;
      for (let personIndex = 0; personIndex < LEVEL_1.groupSize; personIndex += 1) {
        scratch.slotMatrix.makeTranslation((personIndex - 1.5) * groupSpacing, 0, 0);
        const passengerInstanceIndex = passengerBatch.count;
        for (let sourceIndex = 0; sourceIndex < passengerBatch.meshes.length; sourceIndex += 1) {
          scratch.finalMatrix
            .multiplyMatrices(scratch.groupMatrix, scratch.slotMatrix)
            .multiply(batches.personBaseMatrices[sourceIndex]);
          const mesh = passengerBatch.meshes[sourceIndex];
          mesh.setMatrixAt(passengerInstanceIndex, scratch.finalMatrix);
          mesh.geometry.getAttribute('vatPhaseOffset').setX(passengerInstanceIndex, phase);
        }
        passengerBatch.count += 1;

        const shadowInstanceIndex = shadowBatch.count;
        for (let sourceIndex = 0; sourceIndex < shadowBatch.meshes.length; sourceIndex += 1) {
          scratch.finalMatrix
            .multiplyMatrices(scratch.groupMatrix, scratch.slotMatrix)
            .multiply(batches.shadowBaseMatrices[sourceIndex]);
          shadowBatch.meshes[sourceIndex].setMatrixAt(shadowInstanceIndex, scratch.finalMatrix);
        }
        shadowBatch.count += 1;
      }
    }

    for (const colorBatches of batches.passengerBatches) {
      for (const batch of colorBatches) {
        for (const mesh of batch.meshes) {
          mesh.count = batch.count;
          mesh.instanceMatrix.needsUpdate = true;
          mesh.geometry.getAttribute('vatPhaseOffset').needsUpdate = true;
        }
      }
    }
    for (const batch of batches.shadowBatches) {
      for (const mesh of batch.meshes) {
        mesh.count = batch.count;
        mesh.instanceMatrix.needsUpdate = true;
      }
    }
    return true;
  }

  clearSpatialConveyorVisual() {
    for (const mesh of [this.spatialConveyorMesh, this.spatialConveyorExitMesh]) {
      if (!mesh) continue;
      this.spatialConveyorRoot.remove(mesh);
      mesh.geometry.dispose();
      mesh.material.map?.dispose();
      mesh.material.dispose();
    }
    this.spatialConveyorMesh = null;
    this.spatialConveyorExitMesh = null;
    this.activeSpatialConveyorVisualId = null;
  }

  updateSpatialConveyorVisual(packageData) {
    const display = SCENE_TUNING.spatialConveyor ?? {};
    const visualId = [
      packageData.id,
      packageData.editor?.revision ?? 0,
      SPATIAL_CONVEYOR_DISPLAY.version,
      display.scale,
      display.scaleX,
      display.scaleY,
      display.scaleZ,
      display.roadWidth,
      display.positionX,
      display.positionY,
      display.positionZ,
      display.exitPositionX,
      display.exitPositionY,
      display.exitPositionZ,
      display.rotationXDegrees,
      display.rotationYDegrees,
      display.rotationZDegrees,
      display.mirrorZ
    ].join(':');
    if (
      this.activeSpatialConveyorVisualId === visualId &&
      this.spatialConveyorMesh &&
      this.spatialConveyorExitMesh
    ) return;
    const makeMaterial = (dataUrl, overlay = false) => {
      const texture = configureColorTexture(this.textureLoader.load(dataUrl));
      const material = new THREE.MeshBasicMaterial({
        map: texture,
        color: 0xffffff,
        transparent: true,
        alphaTest: 0.01,
        depthTest: true,
        depthWrite: !overlay,
        side: THREE.DoubleSide,
        vertexColors: !overlay
      });
      if (overlay) {
        material.polygonOffset = true;
        material.polygonOffsetFactor = -1;
        material.polygonOffsetUnits = -1;
      }
      material.vertexAlphas = !overlay;
      return material;
    };
    const geometry = buildSpatialConveyorGeometry(packageData, this.curve, display);
    const exitGeometry = buildSpatialConveyorExitGeometry(packageData, this.curve, display);
    if (this.spatialConveyorMesh && this.spatialConveyorExitMesh) {
      this.spatialConveyorMesh.geometry.dispose();
      this.spatialConveyorExitMesh.geometry.dispose();
      this.spatialConveyorMesh.geometry = geometry;
      this.spatialConveyorExitMesh.geometry = exitGeometry;
      this.spatialConveyorMesh.name = packageData.label || packageData.id;
      this.spatialConveyorExitMesh.name = `${this.spatialConveyorMesh.name} Exit`;
      this.activeSpatialConveyorVisualId = visualId;
      return;
    }
    const mesh = new THREE.Mesh(
      geometry,
      makeMaterial(packageData.visual.material.loopTextureDataUrl)
    );
    const exitMesh = new THREE.Mesh(
      exitGeometry,
      makeMaterial(packageData.visual.material.exitTextureDataUrl, true)
    );
    mesh.name = packageData.label || packageData.id;
    exitMesh.name = `${mesh.name} Exit`;
    mesh.frustumCulled = false;
    exitMesh.frustumCulled = false;
    exitMesh.renderOrder = 1;
    this.spatialConveyorMesh = mesh;
    this.spatialConveyorExitMesh = exitMesh;
    this.activeSpatialConveyorVisualId = visualId;
    this.spatialConveyorRoot.add(mesh, exitMesh);
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
      this.layoutRoot.add(root);
    }
  }


  clearVehiclePathLines() {
    for (const line of [...this.vehiclePathLines, ...this.vehicleDeparturePathLines]) {
      this.layoutRoot.remove(line);
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
    const tuning = SCENE_TUNING.vehiclePath;
    const departureTuning = SCENE_TUNING.vehicleDeparturePath;
    if (
      this.isSpatialOptimizationEnabled('skipDisabledPathPreview')
      && !tuning?.enabled
      && !departureTuning?.enabled
    ) {
      if (this.vehiclePathLines.length || this.vehicleDeparturePathLines.length) {
        this.clearVehiclePathLines();
      }
      return;
    }
    this.clearVehiclePathLines();
    if (!snapshot || !game) return;
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
          this.layoutRoot.add(line);
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
        this.layoutRoot.add(line);
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
      const hasTurnVehicles = LEVEL_1.vehicles.some((vehicle) => vehicle.isTurnVehicle);
      const hasHiddenVehicles = LEVEL_1.vehicles.some((vehicle) => vehicle.isHidden);
      const hasGarage = (LEVEL_1.containers ?? []).some((container) => isGarageType(container.type));
      const turnArrowPromise = hasTurnVehicles
        ? loadPackedFbx(TURN_ARROW_ASSET_URL, this.fbxLoader, this.loadingManager)
        : Promise.resolve(null);
      const questionMarkPromise = hasHiddenVehicles
        ? loadPackedFbx(HIDDEN_VEHICLE_ASSETS.questionMark, this.fbxLoader, this.loadingManager)
        : Promise.resolve(null);
      const hiddenVehiclePromises = [4, 6, 10].map((seats) => (
        hasHiddenVehicles
          ? loadPackedFbx(HIDDEN_VEHICLE_ASSETS.vehicleBySeats[seats], this.fbxLoader, this.loadingManager)
          : Promise.resolve(null)
      ));
      const questionMarkTexturePromise = hasHiddenVehicles
        ? this.textureLoader.loadAsync(HIDDEN_VEHICLE_ASSETS.questionTexture)
        : Promise.resolve(null);
      const garageModelPromise = hasGarage
        ? loadPackedFbx(GARAGE_ASSETS.model, this.fbxLoader, this.loadingManager)
        : Promise.resolve(null);
      const garageShadowModelPromise = hasGarage
        ? loadPackedFbx(GARAGE_ASSETS.shadowModel, this.fbxLoader, this.loadingManager)
        : Promise.resolve(null);
      const garageTexturePromise = hasGarage
        ? this.textureLoader.loadAsync(GARAGE_ASSETS.texture)
        : Promise.resolve(null);
      const garageShadowTexturePromise = hasGarage
        ? this.textureLoader.loadAsync(GARAGE_ASSETS.shadowTexture)
        : Promise.resolve(null);
      const [
        passengerVatGeometry,
        passengerVatTexture,
        shadowFbx,
        arrowFbx,
        turnArrowFbx,
        questionMarkFbx,
        hiddenCarFbx,
        hiddenVanFbx,
        hiddenBusFbx,
        questionMarkTexture,
        garageFbx,
        garageShadowFbx,
        garageTexture,
        garageShadowTexture,
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
        loadPackedFbx(modelPaths.shadow, this.fbxLoader, this.loadingManager),
        loadPackedFbx(modelPaths.arrow, this.fbxLoader, this.loadingManager),
        turnArrowPromise,
        questionMarkPromise,
        hiddenVehiclePromises[0],
        hiddenVehiclePromises[1],
        hiddenVehiclePromises[2],
        questionMarkTexturePromise,
        garageModelPromise,
        garageShadowModelPromise,
        garageTexturePromise,
        garageShadowTexturePromise,
        loadPackedFbx(vehiclePaths[4], this.fbxLoader, this.loadingManager),
        loadPackedFbx(vehiclePaths[6], this.fbxLoader, this.loadingManager),
        loadPackedFbx(vehiclePaths[10], this.fbxLoader, this.loadingManager),
        loadPackedFbx(modelPaths.parkingSpot, this.fbxLoader, this.loadingManager),
        loadPackedFbx(modelPaths.vehicleShadowBySeats[4], this.fbxLoader, this.loadingManager),
        loadPackedFbx(modelPaths.vehicleShadowBySeats[6], this.fbxLoader, this.loadingManager),
        loadPackedFbx(modelPaths.vehicleShadowBySeats[10], this.fbxLoader, this.loadingManager),
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
      // Unity's question texture stores a black glyph with the glyph shape in alpha.
      // Convert it to a white-alpha texture so the browser material matches the Unity shader.
      this.questionMarkTexture = questionMarkTexture ? createWhiteAlphaTexture(questionMarkTexture) : null;
      if (garageTexture) configureColorTexture(garageTexture);
      if (garageShadowTexture) configureColorTexture(garageShadowTexture);
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
        scene: this.layoutRoot,
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
      this.garageMaterial = garageTexture ? new THREE.MeshStandardMaterial({
        map: garageTexture,
        roughness: 0.5,
        metalness: 0
      }) : null;
      this.garageShadowMaterial = garageShadowTexture ? new THREE.MeshBasicMaterial({
        map: garageShadowTexture,
        transparent: true,
        opacity: 0.78,
        depthWrite: false,
        side: THREE.DoubleSide
      }) : null;
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
      this.turnArrowTemplate = turnArrowFbx
        ? normalizeObject(toStaticMeshGroup(turnArrowFbx), { depth: 0.56 })
        : null;
      if (this.turnArrowTemplate) {
        setMaterial(this.turnArrowTemplate, new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide }));
        addArrowOutline(this.turnArrowTemplate, {
          color: SCENE_TUNING.vehicleArrow.outlineColor,
          scale: SCENE_TUNING.vehicleArrow.outlineScale,
          depthTest: SCENE_TUNING.vehicleArrow.outlineDepthTest
        });
      }
      if (questionMarkFbx) {
        this.questionMarkTemplate = normalizeObject(toStaticMeshGroup(questionMarkFbx), { depth: 0.56 });
        setMaterial(this.questionMarkTemplate, new THREE.MeshBasicMaterial({
          map: this.questionMarkTexture,
          color: 0xffffff,
          side: THREE.DoubleSide,
          transparent: true,
          alphaTest: 0.02,
          depthTest: false,
          depthWrite: false
        }));
        addArrowOutline(this.questionMarkTemplate, {
          color: SCENE_TUNING.vehicleArrow.outlineColor,
          scale: SCENE_TUNING.vehicleArrow.outlineScale,
          depthTest: SCENE_TUNING.vehicleArrow.outlineDepthTest
        });
      }
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
      this.hiddenVehicleTemplates = {
        4: hiddenCarFbx ? this.prepareVehicleTemplate(hiddenCarFbx, 4) : null,
        6: hiddenVanFbx ? this.prepareVehicleTemplate(hiddenVanFbx, 6) : null,
        10: hiddenBusFbx ? this.prepareVehicleTemplate(hiddenBusFbx, 10) : null
      };
      this.vehicleShadowTemplates = {
        4: this.prepareVehicleShadowTemplate(carShadowFbx, 4),
        6: this.prepareVehicleShadowTemplate(vanShadowFbx, 6),
        10: this.prepareVehicleShadowTemplate(busShadowFbx, 10)
      };
      // FBXLoader converts the garage file's AmbientColor metadata into an
      // AmbientLight. Keep lighting owned by the playable scene so a garage
      // cannot brighten every other material while it is visible.
      this.garageTemplate = garageFbx
        ? normalizeObject(removeImportedLights(garageFbx), GARAGE_MODEL_TARGET)
        : null;
      this.garageShadowTemplate = garageShadowFbx
        ? normalizeObject(toStaticMeshGroup(garageShadowFbx), GARAGE_MODEL_TARGET)
        : null;
      if (this.hasConveyorVehicles()) await this.loadConveyorVehicleAssets();
      if (this.hasAmbulanceVehicles()) await this.loadAmbulanceAssets();
      if (this.hasLuxuryVehicles()) await this.loadLuxuryAssets();
      this.upgradePassengerViews();
      this.upgradeVehicleViews();
      this.upgradeGarageViews();
      this.upgradeConveyorViews();
      this.upgradeSpotViews();
      this.applyTuning();
    } catch (error) {
      this.unityAssetsFailed = true;
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

  async loadConveyorVehicleAssets() {
    const [
      beltModel,
      arrowModel,
      beltTexture,
      arrowTexture,
      doorLeftTexture,
      doorRightTexture,
      leftSideTexture,
      rightSideTexture
    ] = await Promise.all([
      loadPackedFbx(CONVEYOR_VEHICLE_ASSETS.beltModel, this.fbxLoader, this.loadingManager),
      loadPackedFbx(CONVEYOR_VEHICLE_ASSETS.arrowModel, this.fbxLoader, this.loadingManager),
      this.textureLoader.loadAsync(CONVEYOR_VEHICLE_ASSETS.beltTexture),
      this.textureLoader.loadAsync(CONVEYOR_VEHICLE_ASSETS.arrowTexture),
      this.textureLoader.loadAsync(CONVEYOR_VEHICLE_ASSETS.doorLeftTexture),
      this.textureLoader.loadAsync(CONVEYOR_VEHICLE_ASSETS.doorRightTexture),
      this.textureLoader.loadAsync(CONVEYOR_VEHICLE_ASSETS.leftSideTexture),
      this.textureLoader.loadAsync(CONVEYOR_VEHICLE_ASSETS.rightSideTexture)
    ]);
    [
      beltTexture,
      arrowTexture,
      doorLeftTexture,
      doorRightTexture,
      leftSideTexture,
      rightSideTexture
    ].forEach(configureColorTexture);
    this.conveyorBeltTemplate = beltModel;
    this.conveyorArrowTemplate = arrowModel;
    this.conveyorBeltTexture = beltTexture;
    this.conveyorArrowTexture = arrowTexture;
    this.conveyorDoorLeftTexture = doorLeftTexture;
    this.conveyorDoorRightTexture = doorRightTexture;
    this.conveyorLeftSideTexture = leftSideTexture;
    this.conveyorRightSideTexture = rightSideTexture;
  }

  async loadAmbulanceAssets() {
    const [
      vehicleFbx,
      passengerVatGeometry,
      passengerVatTexture,
      vehicleTexture,
      passengerTexture,
      stepBubbleTexture
    ] = await Promise.all([
      loadPackedFbx(AMBULANCE_ASSETS.vehicleModel, this.fbxLoader, this.loadingManager),
      loadVatGeometry(AMBULANCE_ASSETS.passengerVatMesh, this.loadingManager),
      loadPackedVatTexture(AMBULANCE_ASSETS.passengerVatTexture, this.loadingManager),
      this.textureLoader.loadAsync(AMBULANCE_ASSETS.vehicleTexture),
      this.textureLoader.loadAsync(AMBULANCE_ASSETS.passengerTexture),
      this.textureLoader.loadAsync(AMBULANCE_ASSETS.stepBubble)
    ]);
    [vehicleTexture, passengerTexture, stepBubbleTexture].forEach(configureColorTexture);
    this.ambulanceVehicleTemplate = this.prepareVehicleTemplate(vehicleFbx, 6);
    this.ambulanceVehicleMaterial = new THREE.MeshStandardMaterial({
      map: vehicleTexture,
      emissiveMap: vehicleTexture,
      emissive: 0x101010,
      emissiveIntensity: 0.35,
      roughness: 0.42,
      metalness: 0
    });
    const passengerVatRoot = new THREE.Group();
    const passengerVatMesh = new THREE.Mesh(passengerVatGeometry);
    passengerVatMesh.userData.isVatPassenger = true;
    passengerVatMesh.frustumCulled = false;
    passengerVatRoot.add(passengerVatMesh);
    this.ambulancePassengerTemplate = normalizeObject(passengerVatRoot, {
      height: SCENE_TUNING.passengers.modelHeight
    });
    this.ambulancePassengerTexture = passengerTexture;
    this.ambulancePassengerVat = {
      ...passengerVatTexture,
      animation: AMBULANCE_PASSENGER_ANIMATIONS,
      key: 'ambulance-rgba8-packed'
    };
    this.ambulanceStepBubbleTexture = stepBubbleTexture;
  }

  async loadLuxuryAssets() {
    const [
      vehicleFbx,
      passengerFbx,
      vehicleTexture,
      vehicleMetalTexture,
      passengerTexture,
      passengerClothTexture,
      seatCountBoardTexture,
      passengerAnimations
    ] = await Promise.all([
      loadPackedFbx(LUXURY_ASSETS.vehicleModel, this.fbxLoader, this.loadingManager),
      loadPackedFbx(LUXURY_ASSETS.passengerModel, this.fbxLoader, this.loadingManager),
      this.textureLoader.loadAsync(LUXURY_ASSETS.vehicleTexture),
      this.textureLoader.loadAsync(LUXURY_ASSETS.vehicleMetalTexture),
      this.textureLoader.loadAsync(LUXURY_ASSETS.passengerTexture),
      this.textureLoader.loadAsync(LUXURY_ASSETS.passengerClothTexture),
      this.textureLoader.loadAsync(LUXURY_ASSETS.seatCountBoard),
      loadJsonAsset(LUXURY_PASSENGER_ANIMATION_ASSET, this.loadingManager)
    ]);
    [vehicleTexture, vehicleMetalTexture, passengerTexture, passengerClothTexture, seatCountBoardTexture]
      .forEach(configureColorTexture);
    this.luxuryVehicleTemplate = this.prepareVehicleTemplate(vehicleFbx, 10);
    this.luxuryVehicleMaterial = [
      applyUnityMatcapLook(new THREE.MeshMatcapMaterial({
        // Unity bus_limousine uses Idle_wealthy as its main albedo and the
        // limousine texture only as the authored Matcap lighting sphere.
        map: passengerTexture,
        matcap: vehicleTexture,
        color: 0xffffff,
        side: THREE.DoubleSide
      }), {
        brightness: LUXURY_VEHICLE_MATCAP_BRIGHTNESS,
        contrast: 1,
        diffuseStrength: LUXURY_VEHICLE_DIFFUSE_STRENGTH,
        emissionColor: LUXURY_VEHICLE_BASE_EMISSION,
        emissionStrength: 1
      }),
      applyUnityMatcapLook(new THREE.MeshMatcapMaterial({
        map: passengerTexture,
        matcap: vehicleMetalTexture,
        color: 0xffffff,
        side: THREE.DoubleSide
      }), {
        brightness: LUXURY_VEHICLE_MATCAP_BRIGHTNESS,
        contrast: 1,
        diffuseStrength: LUXURY_VEHICLE_DIFFUSE_STRENGTH,
        emissionColor: LUXURY_VEHICLE_METAL_EMISSION,
        emissionStrength: 1
      })
    ];
    // FBXLoader keeps the source file's +90 degree X conversion on the mesh.
    // Unity's passenger_luxury prefab does not have that tilt, so cancel it
    // at the imported root before fitting and applying the authored Y yaw.
    passengerFbx.rotation.x = -Math.PI / 2;
    this.luxuryPassengerTemplate = normalizeObject(removeImportedLights(passengerFbx), {
      height: SCENE_TUNING.passengers.modelHeight
    });
    const luxuryPassengerBodyMaterial = new THREE.MeshStandardMaterial({
        map: passengerTexture,
        emissiveMap: passengerTexture,
        emissive: new THREE.Color().setRGB(
          LUXURY_PASSENGER_BODY_EMISSION.r,
          LUXURY_PASSENGER_BODY_EMISSION.g,
          LUXURY_PASSENGER_BODY_EMISSION.b
        ),
        emissiveIntensity: 1,
        roughness: 1,
        metalness: 0,
        side: THREE.DoubleSide
    });
    luxuryPassengerBodyMaterial.userData.luxuryPassengerBody = true;
    this.luxuryPassengerMaterial = [
      luxuryPassengerBodyMaterial,
      applyUnityMatcapLook(new THREE.MeshMatcapMaterial({
          map: passengerTexture,
          matcap: passengerClothTexture,
          color: 0xffffff,
          side: THREE.DoubleSide
        }), {
          brightness: 1,
          contrast: 1,
          diffuseStrength: 0.78,
          emissionColor: LUXURY_PASSENGER_CLOTH_EMISSION,
          emissionStrength: 1
        })
    ];
    this.luxuryPassengerAnimations = passengerAnimations;
    this.luxurySeatCountBoardTexture = seatCountBoardTexture;
  }

  createVatMaterial(
    colorIndex = 0,
    { instanced = false, vat = null, colorMap = null, emissiveMap = null, matcapMap = null } = {}
  ) {
    const animation = vat?.animation ?? LEVEL_1.assets.passengerAnimations;
    const vatTexture = vat?.texture ?? this.passengerVatTexture;
    const idle = animation.idle;
    const clip = new THREE.Vector4(idle.uvMin, idle.uvMax, 1 / idle.duration, 0);
    const map = this.passengerColorTextures[colorIndex] ?? this.passengerColorTextures[0];
    const material = matcapMap
      ? new THREE.MeshMatcapMaterial({
          map: colorMap,
          matcap: matcapMap,
          color: 0xffffff,
          side: THREE.DoubleSide
        })
      : new THREE.MeshStandardMaterial({
          roughness: 0.58,
          metalness: 0,
          side: THREE.DoubleSide
        });
    if (colorMap) {
      setPassengerMaterialMaps(material, colorMap, emissiveMap);
      material.color.setHex(0xffffff);
      if (material.emissive) {
        material.emissive.setHex(emissiveMap ? 0xffffff : 0x000000);
        material.emissiveIntensity = emissiveMap ? 0.12 : 0;
      }
      material.userData.passengerColorIndex = colorIndex;
    } else {
      applyPassengerMaterial(material, colorIndex, map);
    }
    material.userData.vat = { animation, clip, clipName: null };
    material.userData.vatInstanced = instanced;
    material.onBeforeCompile = (shader) => {
      shader.uniforms.vatMap = { value: vatTexture };
      shader.uniforms.vatTime = this.vatTimeUniform;
      shader.uniforms.vatClip = { value: clip };
      if (vat?.positionMin && vat?.positionRange) {
        shader.uniforms.vatPositionMin = { value: vat.positionMin };
        shader.uniforms.vatPositionRange = { value: vat.positionRange };
      }
      let vertexShader = `
        uniform sampler2D vatMap;
        uniform float vatTime;
        uniform vec4 vatClip;
        ${vat?.positionMin ? 'uniform vec3 vatPositionMin; uniform vec3 vatPositionRange;' : ''}
        attribute float vatIndex;
        ${instanced ? 'attribute float vatPhaseOffset;' : ''}
      ` + shader.vertexShader.replace(
        '#include <begin_vertex>',
        `
          float vatPhase = fract(vatTime * vatClip.z + vatClip.w${instanced ? ' + vatPhaseOffset' : ''});
          float vatX = (vatIndex + 0.5) / ${animation.textureWidth.toFixed(1)};
          float vatY = mix(vatClip.x, vatClip.y, vatPhase)
            + 0.5 / ${animation.textureHeight.toFixed(1)};
          vec3 vatPosition = texture2D(vatMap, vec2(vatX, vatY)).xyz;
          vec3 transformed = ${vat?.positionMin
            ? 'vatPositionMin + vatPosition * vatPositionRange'
            : 'vatPosition'};
        `
      );
      shader.vertexShader = vertexShader;
    };
    material.customProgramCacheKey = () => (
      `busloop-passenger-vat-${vat?.key ?? 'default'}-${instanced ? 'instanced' : 'single'}-v2`
    );
    this.setVatAnimation(material, 'idle');
    return material;
  }

  setVatAnimation(material, clipName, normalizedPhase = 0) {
    if (Array.isArray(material)) {
      for (const entry of material) this.setVatAnimation(entry, clipName, normalizedPhase);
      return;
    }
    const state = material?.userData?.vat;
    const clip = state?.animation?.[clipName];
    if (!state || !clip || state.clipName === clipName) return;
    state.clipName = clipName;
    // Material.clone serializes userData, so a cloned Vector4 can come back
    // as a plain object. Rehydrate it before updating the shared shader clip.
    if (!state.clip?.set) {
      state.clip = new THREE.Vector4(
        state.clip?.x ?? clip.uvMin,
        state.clip?.y ?? clip.uvMax,
        state.clip?.z ?? 1 / clip.duration,
        state.clip?.w ?? 0
      );
    }
    state.clip.set(
      clip.uvMin,
      clip.uvMax,
      1 / clip.duration,
      normalizedPhase - this.vatTimeUniform.value / clip.duration
    );
  }

  setPassengerAnimation(view, clipName, normalizedPhase = 0) {
    for (const slot of view.userData.personSlots) {
      const visual = slot.userData.visualRoot;
      if (visual?.userData.isLuxuryPassenger) {
        visual.userData.animationClipName = clipName;
        visual.userData.animationPhase = normalizedPhase;
      } else {
        this.setVatAnimation(slot.userData.vatMaterial, clipName, normalizedPhase);
      }
    }
  }

  createPassengerVisual(colorIndex = 0, shadowKind = 'conveyor') {
    const root = new THREE.Group();
    const shadow = this.makeShadow(
      SCENE_TUNING.passengers.shadowScale,
      SCENE_TUNING.passengers.shadowScale * 1.2,
      shadowKind
    );
    const useAmbulancePassenger = colorIndex === AMBULANCE_COLOR_INDEX
      && this.ambulancePassengerTemplate
      && this.ambulancePassengerVat;
    const useLuxuryPassenger = colorIndex === LUXURY_COLOR_INDEX
      && this.luxuryPassengerTemplate
      && this.luxuryPassengerMaterial;
    const person = (useAmbulancePassenger
      ? this.ambulancePassengerTemplate
      : (useLuxuryPassenger ? this.luxuryPassengerTemplate : this.personTemplate));
    const personClone = useLuxuryPassenger ? cloneSkeleton(person) : person.clone(true);
    const personPivot = new THREE.Group();
    const modelYaw = useLuxuryPassenger
      ? LUXURY_PASSENGER_YAW_OFFSET_DEGREES
      : SCENE_TUNING.facing.passengerModelYawDegrees
        + (useAmbulancePassenger ? AMBULANCE_PASSENGER_YAW_OFFSET_DEGREES : 0);
    personPivot.rotation.y = deg(modelYaw);
    if (useLuxuryPassenger) {
      personPivot.rotation.set(
        deg(LUXURY_PASSENGER_MODEL_ROTATION_DEGREES.x),
        deg(LUXURY_PASSENGER_MODEL_ROTATION_DEGREES.y),
        deg(LUXURY_PASSENGER_MODEL_ROTATION_DEGREES.z)
      );
    }
    personPivot.position.y = SCENE_TUNING.shadows.y + 0.002;
    personPivot.add(personClone);
    const material = useAmbulancePassenger
      ? this.createVatMaterial(colorIndex, {
          vat: this.ambulancePassengerVat,
          colorMap: this.ambulancePassengerTexture
        })
      : (useLuxuryPassenger
        ? this.luxuryPassengerMaterial.map((entry) => entry.clone())
        : this.createVatMaterial(colorIndex));
    setMaterial(personClone, material);
    if (useLuxuryPassenger) {
      const visualOffsetRoot = new THREE.Group();
      visualOffsetRoot.position.set(
        LUXURY_PASSENGER_VISUAL_OFFSET.x,
        LUXURY_PASSENGER_VISUAL_OFFSET.y,
        LUXURY_PASSENGER_VISUAL_OFFSET.z
      );
      visualOffsetRoot.add(shadow, personPivot);
      root.add(visualOffsetRoot);
      root.userData.visualOffsetRoot = visualOffsetRoot;
    } else {
      root.add(shadow, personPivot);
    }
    root.userData.modelRoot = personClone;
    root.userData.modelPivot = personPivot;
    root.userData.vatMaterial = material;
    root.userData.material = material;
    root.userData.isAmbulancePassenger = Boolean(useAmbulancePassenger);
    root.userData.isLuxuryPassenger = Boolean(useLuxuryPassenger);
    if (useLuxuryPassenger) {
      root.userData.animationClipName = 'idle';
      root.userData.animationPhase = 0;
      root.userData.luxuryBones = new Map();
      personClone.traverse((object) => {
        if (object.isBone) root.userData.luxuryBones.set(object.name, object);
      });
      const brightness = THREE.MathUtils.clamp(
        SCENE_TUNING.luxuryMaterial?.passengerBrightness ?? 1,
        0,
        3
      );
      applyLuxuryPassengerBrightness(material, brightness);
    }
    return root;
  }

  updateLuxuryPassengerAnimations(time) {
    const animations = this.luxuryPassengerAnimations?.clips;
    if (!animations) return;
    const roots = [
      ...this.passengerViews.flatMap((view) => view.userData.personSlots ?? [])
        .map((slot) => slot.userData.visualRoot),
      ...this.queuePassengerViews.flatMap((views) => views)
        .flatMap((view) => view.userData.personSlots ?? [])
        .map((slot) => slot.userData.visualRoot),
      ...this.boardingViews.map((entry) => entry.root)
    ];
    const quaternion = new THREE.Quaternion();
    for (const visual of roots) {
      if (!visual?.userData.isLuxuryPassenger) continue;
      const clip = animations[visual.userData.animationClipName] ?? animations.idle;
      const phase = Number(visual.userData.animationPhase) || 0;
      const clipTime = time + phase * clip.duration;
      for (const [boneName, keys] of Object.entries(clip.curves ?? {})) {
        const bone = visual.userData.luxuryBones?.get(boneName);
        if (!bone) continue;
        sampleUnityQuaternionCurve(keys, clipTime, clip.duration, quaternion);
        bone.quaternion.copy(quaternion);
      }
    }
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
    const luxuryRoots = [
      ...this.passengerViews,
      ...this.queuePassengerViews.flat(),
      ...this.boardingViews.map((entry) => entry.root)
    ];
    for (const root of luxuryRoots) {
      root.traverse((object) => {
        if (!object.userData.isLuxuryPassenger || !object.userData.modelPivot) return;
        object.userData.modelPivot.rotation.set(
          deg(LUXURY_PASSENGER_MODEL_ROTATION_DEGREES.x),
          deg(LUXURY_PASSENGER_MODEL_ROTATION_DEGREES.y),
          deg(LUXURY_PASSENGER_MODEL_ROTATION_DEGREES.z)
        );
      });
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
    for (const material of this.spatialPassengerBatches?.ownedMaterials ?? []) {
      const colorIndex = material.userData.passengerColorIndex ?? 0;
      if (!shouldUpdateColor(colorIndex)) continue;
      const map = this.passengerColorTextures[colorIndex] ?? this.passengerColorTextures[0];
      applyPassengerMaterial(material, colorIndex, map);
    }

    const roots = [
      ...this.passengerViews,
      ...this.queuePassengerViews.flat(),
      ...this.boardingViews.map((entry) => entry.root)
    ];
    for (const root of roots) {
      if (root.userData.vatMaterial && !root.userData.isAmbulancePassenger && !root.userData.isLuxuryPassenger) {
        const colorIndex = root.userData.vatMaterial.userData.passengerColorIndex ?? root.userData.colorIndex ?? 0;
        if (!shouldUpdateColor(colorIndex)) continue;
        const map = this.passengerColorTextures[colorIndex] ?? this.passengerColorTextures[0];
        applyPassengerMaterial(root.userData.vatMaterial, colorIndex, map);
      }
      for (const slot of root.userData.personSlots ?? []) {
        if (slot.userData.visualRoot?.userData.isAmbulancePassenger || slot.userData.visualRoot?.userData.isLuxuryPassenger) continue;
        const material = slot.userData.vatMaterial;
        if (!material) continue;
        const colorIndex = material.userData.passengerColorIndex ?? root.userData.colorIndex ?? 0;
        if (!shouldUpdateColor(colorIndex)) continue;
        const map = this.passengerColorTextures[colorIndex] ?? this.passengerColorTextures[0];
        applyPassengerMaterial(material, colorIndex, map);
      }
    }
  }

  releasePassengerViewsForInstancing() {
    const allViews = [...this.passengerViews, ...this.queuePassengerViews.flat()];
    for (const view of allViews) {
      if (!view.userData.modelReady) continue;
      for (const slot of view.userData.personSlots) {
        disposeMaterial(slot.userData.visualRoot?.userData.material);
        slot.clear();
        slot.userData.visualRoot = null;
        slot.userData.modelRoot = null;
        slot.userData.vatMaterial = null;
      }
      view.userData.modelReady = false;
      view.userData.colorIndex = null;
      view.visible = false;
    }
  }

  upgradePassengerViews({ force = false } = {}) {
    if (!force && this.shouldUseSpatialPassengerInstancing()) {
      this.releasePassengerViewsForInstancing();
      return;
    }
    const allViews = [...this.passengerViews, ...this.queuePassengerViews.flat()];
    for (const view of allViews) {
      for (const slot of view.userData.personSlots) {
        slot.clear();
        const queueIndex = this.queuePassengerViews[0].includes(view) ? 0 : (this.queuePassengerViews[1].includes(view) ? 1 : -1);
        const shadowKind = queueIndex === 0 ? 'leftQueue' : (queueIndex === 1 ? 'rightQueue' : 'conveyor');
        const visual = this.createPassengerVisual(0, shadowKind);
        slot.add(visual);
        slot.userData.shadowKind = shadowKind;
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
      const isAmbulance = Number.isInteger(vehicle.ambulanceStepLimit);
      const isLuxury = vehicle.colorIndex === LUXURY_COLOR_INDEX || vehicle.isLuxury;
      const template = isAmbulance && this.ambulanceVehicleTemplate
        ? this.ambulanceVehicleTemplate
        : (isLuxury && this.luxuryVehicleTemplate
          ? this.luxuryVehicleTemplate
          : (this.vehicleTemplates[vehicle.seats] ?? this.vehicleTemplates[10]));
      const size = template.userData.fittedSize;
      const material = isAmbulance && this.ambulanceVehicleMaterial
        ? this.ambulanceVehicleMaterial.clone()
        : (isLuxury && this.luxuryVehicleMaterial
          ? (Array.isArray(this.luxuryVehicleMaterial)
            ? this.luxuryVehicleMaterial.map((entry) => entry.clone())
            : this.luxuryVehicleMaterial.clone())
          : (this.vehicleMaterials[vehicle.colorIndex] ?? this.vehicleMaterials[0]).clone());
      view.clear();
      const shadow = this.makeVehicleShadow(isLuxury ? 10 : vehicle.seats);
      const model = template.clone(true);
      const bodyMeshes = setMaterial(model, material);
      const hiddenTemplate = vehicle.isHidden
        ? (this.hiddenVehicleTemplates[vehicle.seats] ?? this.hiddenVehicleTemplates[10])
        : null;
      // Unity's bus_hidden material is intentionally untextured black. Use a
      // slightly lifted charcoal so the hidden shape keeps readable lighting.
      const hiddenCollisionModel = hiddenTemplate?.clone(true) ?? null;
      const hiddenBodyMeshes = hiddenCollisionModel
        ? setMaterial(hiddenCollisionModel, new THREE.MeshStandardMaterial({
          color: HIDDEN_VEHICLE_BODY_COLOR,
          roughness: 0.58,
          metalness: 0
        }))
        : [];
      if (hiddenCollisionModel) {
        const hiddenSize = new THREE.Box3().setFromObject(hiddenCollisionModel)
          .getSize(new THREE.Vector3());
        hiddenCollisionModel.scale.multiply(new THREE.Vector3(
          size.x / Math.max(hiddenSize.x, 0.0001),
          size.y / Math.max(hiddenSize.y, 0.0001),
          size.z / Math.max(hiddenSize.z, 0.0001)
        ));
      }
      const arrowTemplate = vehicle.isTurnVehicle && this.turnArrowTemplate
        ? this.turnArrowTemplate
        : this.arrowTemplate;
      const arrow = makeCenteredArrow(arrowTemplate);
      const hitRoot = new THREE.Group();
      this.applyVehicleArrowTuning(arrow, size, { isTurnVehicle: vehicle.isTurnVehicle });
      arrow.rotation.y = deg(vehicle.isTurnVehicle ? 0 : SCENE_TUNING.facing.arrowYawDegrees);
      if (vehicle.isTurnVehicle) arrow.scale.multiplyScalar(TURN_ARROW_SCALE);
      const hiddenRoot = new THREE.Group();
      const hiddenArrow = vehicle.isHidden && this.questionMarkTemplate
        ? makeCenteredArrow(this.questionMarkTemplate)
        : null;
      if (hiddenArrow) {
        this.applyVehicleArrowTuning(hiddenArrow, size, { isHiddenQuestionMark: true });
        hiddenArrow.rotation.y = deg(SCENE_TUNING.facing.arrowYawDegrees);
        hiddenArrow.renderOrder = 30;
        hiddenArrow.traverse((child) => {
          if (!child.isMesh) return;
          child.renderOrder = 30;
          const materials = Array.isArray(child.material) ? child.material : [child.material];
          for (const material of materials) {
            if (!material) continue;
            material.depthTest = false;
            material.depthWrite = false;
          }
        });
        hiddenRoot.add(hiddenArrow);
      }
      model.visible = !vehicle.isHidden;
      arrow.visible = !vehicle.isHidden;
      hiddenRoot.visible = Boolean(vehicle.isHidden);
      if (hiddenCollisionModel) hiddenCollisionModel.visible = Boolean(vehicle.isHidden);
      hitRoot.add(model, arrow, hiddenRoot);
      if (hiddenCollisionModel) hitRoot.add(hiddenCollisionModel);
      for (const child of [hitRoot, shadow]) {
        child.traverse((object) => { object.userData.vehicleId = vehicle.id; });
      }
      view.add(shadow, hitRoot);
      if (isAmbulance && this.ambulanceStepBubbleTexture) {
        const board = this.createAmbulanceStepBoard();
        board.position.set(0, size.y + AMBULANCE_STEP_BOARD_OFFSET_Y, 0);
        view.add(board);
        view.userData.ambulanceStepBoard = board;
      } else {
        view.userData.ambulanceStepBoard = null;
      }
      view.userData.bodyMeshes = bodyMeshes;
      view.userData.hiddenBodyMeshes = hiddenBodyMeshes;
      view.userData.hitMeshes = [hitRoot];
      view.userData.pickMeshes = vehicle.isHidden ? hiddenBodyMeshes : bodyMeshes;
      view.userData.modelRoot = model;
      view.userData.arrowRoot = arrow;
      view.userData.hiddenRoot = hiddenRoot;
      view.userData.hiddenModelRoot = hiddenCollisionModel;
      view.userData.hiddenArrowRoot = hiddenArrow;
      view.userData.templateSize = size;
      view.userData.unityHitScale = size.z / .6785897;
      view.userData.isLuxury = isLuxury;
      storeHitBase(hitRoot);
      view.userData.modelReady = true;
    }
  }

  updateLuxuryMaterialTuning() {
    const tuning = SCENE_TUNING.luxuryMaterial ?? {};
    const vehicleBrightness = THREE.MathUtils.clamp(tuning.vehicleBrightness ?? 1, 0, 3);
    const passengerBrightness = THREE.MathUtils.clamp(tuning.passengerBrightness ?? 1, 0, 3);
    const boardBrightness = THREE.MathUtils.clamp(tuning.boardBrightness ?? 1, 0, 3);

    forEachMaterial(this.luxuryVehicleMaterial, (material) => {
      updateUnityMatcapBrightness(material, 1);
      material.color?.setScalar(vehicleBrightness);
    });
    for (const view of this.vehicleViews.values()) {
      if (!view.userData.isLuxury) continue;
      for (const mesh of view.userData.bodyMeshes ?? []) {
        forEachMaterial(mesh.material, (material) => {
          updateUnityMatcapBrightness(material, 1);
          material.color?.setScalar(vehicleBrightness);
        });
      }
    }

    const luxuryPassengerVisuals = [
      ...this.passengerViews.flatMap((view) => view.userData.personSlots ?? [])
        .map((slot) => slot.userData.visualRoot),
      ...this.queuePassengerViews.flatMap((views) => views)
        .flatMap((view) => view.userData.personSlots ?? [])
        .map((slot) => slot.userData.visualRoot),
      ...this.boardingViews.map((entry) => entry.root)
    ].filter((visual) => visual?.userData.isLuxuryPassenger);
    for (const visual of luxuryPassengerVisuals) {
      applyLuxuryPassengerBrightness(visual.userData.material, passengerBrightness);
    }

    for (const board of this.seatCountBoards) {
      if (!board.userData.isLuxuryBoard) continue;
      board.userData.boardMesh.material.color.setScalar(boardBrightness);
      board.userData.textSprite.material.color.setScalar(boardBrightness);
    }
  }

  createAmbulanceStepBoard() {
    const canvas = document.createElement('canvas');
    canvas.width = 192;
    canvas.height = 192;
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
      map: texture,
      transparent: true,
      depthTest: false,
      depthWrite: false
    }));
    sprite.scale.set(AMBULANCE_STEP_BOARD_BASE_SCALE, AMBULANCE_STEP_BOARD_BASE_SCALE, 1);
    sprite.renderOrder = 120;
    // The board is visual-only; vehicle picking must remain limited to the body and arrow.
    sprite.raycast = () => {};
    sprite.userData.canvas = canvas;
    sprite.userData.texture = texture;
    sprite.userData.remainingSteps = null;
    sprite.userData.warning = null;
    return sprite;
  }

  updateAmbulanceStepBoard(board, vehicle, time) {
    const visible = vehicle.state === 'parked' && vehicle.ambulanceActive;
    board.visible = visible;
    if (!visible) return;
    const remainingSteps = vehicle.ambulanceRemainingSteps;
    const warning = remainingSteps <= 5;
    if (board.userData.remainingSteps !== remainingSteps || board.userData.warning !== warning) {
      const canvas = board.userData.canvas;
      const context = canvas.getContext('2d');
      context.clearRect(0, 0, canvas.width, canvas.height);
      context.drawImage(this.ambulanceStepBubbleTexture.image, 8, 8, 176, 176);
      context.font = `900 ${AMBULANCE_STEP_BOARD_FONT_SIZE}px "Poppins Branding"`;
      context.textAlign = 'center';
      context.textBaseline = 'middle';
      context.lineJoin = 'round';
      context.lineWidth = 12;
      context.strokeStyle = warning ? '#721313' : '#5b1820';
      context.fillStyle = warning ? '#ffe45e' : '#ffffff';
      context.strokeText(String(remainingSteps), 96, 91);
      context.fillText(String(remainingSteps), 96, 91);
      board.userData.texture.needsUpdate = true;
      board.userData.remainingSteps = remainingSteps;
      board.userData.warning = warning;
    }
    const pulse = warning ? 1 + (Math.sin(time * Math.PI * 4) + 1) * 0.07 : 1;
    board.scale.set(
      AMBULANCE_STEP_BOARD_BASE_SCALE * pulse,
      AMBULANCE_STEP_BOARD_BASE_SCALE * pulse,
      1
    );
  }

  applyVehicleArrowTuning(arrow, size, { isTurnVehicle = false, isHiddenQuestionMark = false } = {}) {
    const tuning = SCENE_TUNING.vehicleArrow;
    const markerDepth = (arrow.userData.fittedSize?.z ?? 0.56) * (isTurnVehicle ? TURN_ARROW_SCALE : 1);
    const maxForwardOffset = Math.max(0, (size.z - markerDepth) * 0.5);
    const forwardOffset = isTurnVehicle
      ? Math.min(TURN_ARROW_FORWARD_OFFSET, maxForwardOffset)
      : 0;
    const hiddenQuestionOffset = isHiddenQuestionMark
      ? -maxForwardOffset * HIDDEN_QUESTION_MARK_FORWARD_FACTOR
      : 0;
    arrow.position.set(
      tuning.offsetX,
      size.y + tuning.offsetY,
      tuning.offsetZ + forwardOffset + hiddenQuestionOffset
    );
    applyArrowOutlineTuning(arrow, {
      color: tuning.outlineColor,
      scale: tuning.outlineScale,
      depthTest: tuning.outlineDepthTest
    });
  }

  updateVehicleArrowTuning() {
    for (const template of [this.arrowTemplate, this.turnArrowTemplate]) {
      if (!template) continue;
      applyArrowOutlineTuning(template, {
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
        this.applyVehicleArrowTuning(arrow, size, { isTurnVehicle: vehicle.isTurnVehicle });
        arrow.rotation.y = deg(vehicle.isTurnVehicle ? 0 : SCENE_TUNING.facing.arrowYawDegrees);
      }
      const hiddenArrow = view?.userData.hiddenArrowRoot;
      if (hiddenArrow && size) {
        this.applyVehicleArrowTuning(hiddenArrow, size, { isHiddenQuestionMark: true });
        hiddenArrow.rotation.y = deg(SCENE_TUNING.facing.arrowYawDegrees);
      }
      const hitRoot = view?.userData.hitMeshes?.[0];
      if (hitRoot) storeHitBase(hitRoot);
    }
  }

  updateHiddenVehicleVisual(view, vehicle) {
    if (!view?.userData.hiddenRoot || !vehicle.isHidden) return;
    const reveal = vehicle.hiddenReveal;
    const progress = reveal
      ? THREE.MathUtils.clamp(reveal.elapsed / Math.max(0.001, reveal.duration || HIDDEN_REVEAL_DURATION), 0, 1)
      : (vehicle.hiddenRevealed ? 1 : 0);
    const showingNormal = progress >= 0.55;
    view.userData.modelRoot.visible = showingNormal;
    view.userData.arrowRoot.visible = showingNormal;
    view.userData.hiddenRoot.visible = !showingNormal;
    if (view.userData.hiddenModelRoot) view.userData.hiddenModelRoot.visible = !showingNormal;
    view.userData.pickMeshes = vehicle.hiddenRevealed ? view.userData.bodyMeshes : view.userData.hiddenBodyMeshes;
    view.userData.hiddenRoot.scale.setScalar(1);
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
    board.userData.isLuxuryBoard = vehicle.colorIndex === LUXURY_COLOR_INDEX;
    const vehicleChanged = board.userData.vehicleId !== vehicle.id;
    board.visible = visible;
    if (!visible) {
      board.userData.vehicleId = null;
      board.userData.remaining = null;
      board.userData.isLuxuryBoard = false;
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
    const boardTexture = vehicle.colorIndex === LUXURY_COLOR_INDEX && this.luxurySeatCountBoardTexture
      ? this.luxurySeatCountBoardTexture
      : this.seatCountBoardTexture;
    if (board.userData.boardMesh.material.map !== boardTexture) {
      board.userData.boardMesh.material.map = boardTexture;
      board.userData.boardMesh.material.needsUpdate = true;
    }
    // The luxury board texture already contains Unity's gold background;
    // multiplying it by the generic color swatch makes it needlessly dark.
    board.userData.boardMesh.material.color.setHex(
      boardTexture === this.luxurySeatCountBoardTexture ? 0xffffff : config.background
    );
    if (board.userData.isLuxuryBoard) {
      this.updateLuxuryMaterialTuning();
    } else {
      board.userData.textSprite.material.color.setHex(0xffffff);
    }

    const canvas = board.userData.textCanvas;
    const context = canvas.getContext('2d');
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.font = '700 112px "Poppins Branding"';
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
      const visual = slot.userData.visualRoot;
      const wantsAmbulancePassenger = colorIndex === AMBULANCE_COLOR_INDEX
        && this.ambulancePassengerTemplate
        && this.ambulancePassengerVat;
      const wantsLuxuryPassenger = colorIndex === LUXURY_COLOR_INDEX
        && this.luxuryPassengerTemplate
        && this.luxuryPassengerMaterial;
      if (visual && (
        visual.userData.isAmbulancePassenger !== Boolean(wantsAmbulancePassenger)
        || visual.userData.isLuxuryPassenger !== Boolean(wantsLuxuryPassenger)
      )) {
        disposeMaterial(visual.userData.material);
        slot.clear();
        const replacement = this.createPassengerVisual(colorIndex, slot.userData.shadowKind ?? 'conveyor');
        slot.add(replacement);
        slot.userData.visualRoot = replacement;
        slot.userData.modelRoot = replacement.userData.modelRoot;
        slot.userData.vatMaterial = replacement.userData.vatMaterial;
      }
      const material = slot.userData.vatMaterial;
      if (material && colorIndex !== AMBULANCE_COLOR_INDEX && colorIndex !== LUXURY_COLOR_INDEX) {
        const map = this.passengerColorTextures[colorIndex] ?? this.passengerColorTextures[0];
        applyPassengerMaterial(material, colorIndex, map);
      }
    }
  }

  applyTuning() {
    this.staticVehicleTransforms.clear();
    this.blockerCache.clear();
    this.blockerCacheSignature = '';
    for (const view of this.vehicleViews.values()) {
      view.userData.spatialStaticParked = false;
      view.userData.spatialMovable = undefined;
    }
    if (!this.isSpatialOptimizationEnabled('poolBoardingPassengers')) {
      this.disposeBoardingVisualPool();
    }
    this.applySceneLighting();
    const background = SCENE_TUNING.background;
    this.setArtworkPlaneTexture(this.backgroundPlane, getSelectedBackgroundUrl());
    this.backgroundPlane.material.opacity = background.opacity;
    if (this.vehicleShadowMaterials) {
      Object.entries(this.vehicleShadowMaterials).forEach(([seats, material]) => {
        material.opacity = seats === '10' ? 0.8 : SCENE_TUNING.vehicleShadows.opacity;
      });
    }
    this.updatePassengerVisualTuning();
    this.updatePassengerMaterialTuning();
    this.updateLuxuryMaterialTuning();
    this.updateVehicleArrowTuning();
    this.updateGuideHandTuning();
    this.updateEntryBannerTuning();
    this.applyConveyorVisualTuning();

    this.buildPathCurves();
    if (this.personTemplate) {
      if (this.shouldUseSpatialPassengerInstancing()) {
        this.releasePassengerViewsForInstancing();
      } else {
        this.ensurePassengerViewCapacity(Math.max(
          MAX_CONVEYOR_CAPACITY,
          this.activeConveyorLayout?.conveyorCapacity ?? 0
        ));
        if (this.passengerViews.some((view) => !view.userData.modelReady)) {
          this.upgradePassengerViews({ force: true });
        }
      }
    }
    if (this.activeSpatialConveyor) {
      this.loopPlane.visible = false;
      this.spatialConveyorRoot.visible = true;
      this.updateSpatialConveyorVisual(this.activeSpatialConveyor);
    } else {
      const layout = getSelectedConveyorLayout();
      const layoutTuning = getSelectedConveyorTuning(layout.id);
      const conveyor = layoutTuning.art;
      this.clearSpatialConveyorVisual();
      this.spatialConveyorRoot.visible = false;
      this.loopPlane.visible = true;
      this.setArtworkPlaneTexture(this.loopPlane, layout.assets.loopScene, layout.assets.loopSpriteRect);
      this.loopPlane.position.set(conveyor.x, conveyor.y, conveyor.z);
      this.loopPlane.rotation.set(-Math.PI / 2, 0, 0);
      this.loopPlane.scale.set(conveyor.width, conveyor.depth, 1);
      this.loopPlane.material.opacity = conveyor.opacity;
    }

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

  replaceActiveLevel({ animate = false } = {}) {
    this.clearVehiclePathLines();
    this.clearBoardingViews();
    this.vehicleEffects?.clear();
    this.clearGarageViews();
    this.clearConveyorViews();
    for (const view of this.vehicleViews.values()) this.vehicleRoot.remove(view);
    this.vehicleViews.clear();
    this.buildGarageViews();
    this.buildConveyorViews();
    for (const vehicle of LEVEL_1.vehicles) {
      const view = makeVehiclePlaceholder(vehicle);
      this.vehicleViews.set(vehicle.id, view);
      this.vehicleRoot.add(view);
    }
    if (this.vehicleTemplates) this.upgradeVehicleViews();
    if (this.garageTemplate) this.upgradeGarageViews();
    this.setArtworkPlaneTexture(this.backgroundPlane, getSelectedBackgroundUrl());
    this.lastSnapshot = null;
    this.lastGame = null;
    this.staticVehicleTransforms.clear();
    this.blockerCache.clear();
    this.blockerCacheSignature = '';
    this.initialEntryPathStates.clear();
    this.queueEntryPathStates.clear();
    this.applyTuning();
    if (animate) {
      this.startVehicleEntrance();
    } else {
      this.vehicleEntrance = null;
      this.vehicleRoot.position.set(0, 0, 0);
    }
  }

  startVehicleEntrance({ durationSeconds = 0.85, startOffsetZ = 8 } = {}) {
    this.vehicleEntrance = {
      startedAt: globalThis.performance?.now?.() ?? Date.now(),
      durationMs: Math.max(1, durationSeconds * 1000),
      startOffsetZ: Math.max(0, Number(startOffsetZ) || 0)
    };
    this.updateVehicleEntrance(this.vehicleEntrance.startedAt);
  }

  updateVehicleEntrance(now = globalThis.performance?.now?.() ?? Date.now()) {
    const entrance = this.vehicleEntrance;
    if (!entrance) return;
    const progress = Math.max(0, Math.min(1, (now - entrance.startedAt) / entrance.durationMs));
    const eased = 1 - (1 - progress) ** 3;
    this.vehicleRoot.position.set(0, 0, entrance.startOffsetZ * (1 - eased));
    if (progress >= 1) {
      this.vehicleRoot.position.set(0, 0, 0);
      this.vehicleEntrance = null;
    }
  }

  setInputEnabled(enabled) {
    this.inputEnabled = Boolean(enabled);
  }

  refreshSpatialConveyorDraft() {
    this.activeSpatialConveyorVisualId = null;
    this.applyTuning();
  }

  prepareSpatialBlockerCache(snapshot) {
    this.blockerCacheAvailable = false;
    if (!this.isSpatialOptimizationEnabled('cacheBlockers')) {
      this.blockerCache.clear();
      this.blockerCacheSignature = '';
      return;
    }
    if (snapshot.vehicles.some((vehicle) => vehicle.state === 'colliding')) {
      this.blockerCache.clear();
      this.blockerCacheSignature = '';
      return;
    }
    this.blockerCacheAvailable = true;
    const signature = snapshot.vehicles
      .filter((vehicle) => vehicle.state === 'parked')
      .map((vehicle) => vehicle.id)
      .join(',');
    if (signature === this.blockerCacheSignature) return;
    this.blockerCacheSignature = signature;
    this.blockerCache.clear();
  }

  getVehicleBlockers(game, vehicleId) {
    if (!this.blockerCacheAvailable) return game.getBlockers(vehicleId);
    if (!this.blockerCache.has(vehicleId)) {
      this.blockerCache.set(vehicleId, game.getBlockers(vehicleId));
    }
    return this.blockerCache.get(vehicleId);
  }

  getStaticVehicleTransform(vehicle) {
    let cached = this.staticVehicleTransforms.get(vehicle.id);
    if (cached) return cached;
    const layoutStart = mapVehicleAreaPoint(vehicle);
    cached = {
      position: new THREE.Vector3(
        layoutStart.x,
        SCENE_TUNING.vehicleArea.y,
        layoutStart.y
      ),
      yaw: mapVehicleAreaYaw(vehicle.yaw) + deg(SCENE_TUNING.facing.vehicleYawOffsetDegrees)
    };
    this.staticVehicleTransforms.set(vehicle.id, cached);
    return cached;
  }

  update(snapshot, game) {
    const previousUpdateTime = this.lastSnapshot?.time ?? snapshot.time;
    const visualDelta = Math.max(0, Math.min(snapshot.time - previousUpdateTime, 0.1));
    this.lastSnapshot = snapshot;
    this.lastGame = game;
    this.vatTimeUniform.value = snapshot.time;
    if (snapshot.lastEvent.type === 'reset' && snapshot.time === 0) this.clearBoardingViews();
    const deduplicateBoardingUpdates = this.isSpatialOptimizationEnabled('deduplicateBoardingUpdates');
    if (!deduplicateBoardingUpdates) {
      this.processBoardingEvents(snapshot);
      this.updateBoardingViews(snapshot.time);
    }
    const vehicleArea = SCENE_TUNING.vehicleArea;
    const vehicleYawOffset = deg(SCENE_TUNING.facing.vehicleYawOffsetDegrees);
    this.prepareSpatialBlockerCache(snapshot);
    this.updateGarageViews(snapshot);
    this.updateConveyorViews(snapshot);
    for (const board of this.seatCountBoards) {
      board.visible = false;
    }
    for (const vehicle of snapshot.vehicles) {
      const view = this.vehicleViews.get(vehicle.id);
      const useStaticCache = vehicle.state === 'parked'
        && !vehicle.isTurnVehicle
        && this.isSpatialOptimizationEnabled('cacheStaticVehicles');
      const staticTransform = useStaticCache ? this.getStaticVehicleTransform(vehicle) : null;
      const layoutStart = staticTransform ? null : mapVehicleAreaPoint(vehicle);
      const startYaw = staticTransform?.yaw ?? (mapVehicleAreaYaw(vehicle.yaw) + vehicleYawOffset);
      const start = staticTransform?.position ?? new THREE.Vector3(
        layoutStart.x,
        vehicleArea.y,
        layoutStart.y
      );
      const spot = this.spotPositions[vehicle.spotIndex ?? 0];
      const garageMotionVisible = vehicle.state !== 'leaving-garage'
        || (vehicle.motionData?.elapsed ?? 0) >= (vehicle.motionData?.delay ?? 0);
      const conveyorVisible = !isConveyorType(vehicle.containerType) || vehicle.conveyorVisible !== false;
      view.visible = !['done', 'in-garage'].includes(vehicle.state) && garageMotionVisible && conveyorVisible;
      const activeHit = Boolean(
        vehicle.hit
        && snapshot.time - vehicle.hit.startedAt < UNITY_VEHICLE_MOTION.hitDuration
      );
      const reuseStaticTransform = Boolean(
        useStaticCache
        && view.userData.spatialStaticParked
        && !activeHit
        && !view.userData.spatialHadActiveHit
      );
      let vehicleScale = ['parked', 'colliding', 'leaving-garage'].includes(vehicle.state)
        ? 1 : (UNITY_VEHICLE_MOTION.stationScaleBySeats[vehicle.seats] ?? 1);
      if (vehicle.state === 'parked') {
        if (!reuseStaticTransform) {
          view.position.copy(start);
          view.rotation.y = startYaw;
        }
        view.userData.spatialStaticParked = useStaticCache;
      } else if (vehicle.state === 'leaving-garage') {
        view.userData.spatialStaticParked = false;
        const progress = ease(vehicle.motion);
        const from = vehicle.motionData.from;
        const to = vehicle.motionData.to;
        view.position.copy(mapMotionPoint({
          x: THREE.MathUtils.lerp(from.x, to.x, progress),
          z: THREE.MathUtils.lerp(from.z, to.z, progress)
        }));
        view.rotation.y = mapVehicleAreaYaw(
          THREE.MathUtils.lerp(from.yaw, to.yaw, progress)
        ) + vehicleYawOffset;
      } else if (vehicle.state === 'colliding') {
        view.userData.spatialStaticParked = false;
        const direction = forwardFromYaw(vehicle.yaw);
        const position = {
          x: vehicle.x + direction.x * vehicle.collision.offset,
          z: vehicle.z + direction.z * vehicle.collision.offset
        };
        view.position.copy(mapMotionPoint(position));
        view.rotation.y = startYaw;
      } else if (vehicle.state === 'moving-to-spot') {
        view.userData.spatialStaticParked = false;
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
        view.userData.spatialStaticParked = false;
        view.position.copy(spot);
        view.rotation.y = deg(SCENE_TUNING.facing.parkingSpotYawDegrees + 180) + vehicleYawOffset;
      } else if (vehicle.state === 'departing') {
        view.userData.spatialStaticParked = false;
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
      if (!reuseStaticTransform || boardingPulseScale !== 1) {
        view.scale.setScalar(vehicleScale * SCENE_TUNING.vehicleArea.modelScale * boardingPulseScale);
      }
      if (!reuseStaticTransform || activeHit || view.userData.spatialHadActiveHit) {
        this.applyVehicleHit(view, vehicle, snapshot.time);
      }
      view.userData.spatialHadActiveHit = activeHit;
      this.updateHiddenVehicleVisual(view, vehicle);
      const hideArrowAtSpot = shouldHideVehicleArrow(vehicle.state);
      if (view.userData.arrowRoot && (!vehicle.isHidden || hideArrowAtSpot)) {
        view.userData.arrowRoot.visible = !hideArrowAtSpot;
      }
      const isMovable = vehicle.state === 'parked'
        && !vehicle.turnRotation?.active
        && !vehicle.hiddenReveal
        && this.getVehicleBlockers(game, vehicle.id).length === 0;
      if (view.userData.spatialMovable !== isMovable) {
        view.userData.spatialMovable = isMovable;
        const activeMeshes = vehicle.isHidden && !vehicle.hiddenRevealed
          ? view.userData.hiddenBodyMeshes
          : view.userData.bodyMeshes;
        for (const mesh of [
          ...(view.userData.bodyMeshes ?? []),
          ...(view.userData.hiddenBodyMeshes ?? [])
        ]) {
          if (!mesh.material.emissive) continue;
          const highlighted = isMovable && activeMeshes?.includes(mesh);
          mesh.material.emissive.setHex(highlighted ? 0x123a20 : 0x000000);
          mesh.material.emissiveIntensity = highlighted ? 0.22 : 0;
        }
      }
      view.userData.boardedGroups = vehicle.boardedGroups;
      if (view.userData.ambulanceStepBoard) {
        this.updateAmbulanceStepBoard(view.userData.ambulanceStepBoard, vehicle, snapshot.time);
      }
      if (vehicle.spotIndex != null && snapshot.spots[vehicle.spotIndex]?.vehicleId === vehicle.id) {
        const board = this.seatCountBoards[vehicle.spotIndex];
        if (board) this.updateSeatCountBoard(board, vehicle, snapshot.time);
      }
    }

    const passengerYaw = deg(SCENE_TUNING.facing.passengerYawDegrees);
    const passengerHeight = SCENE_TUNING.passengers.heightAbovePath;
    const usingSpatialPassengerBatches = this.updateSpatialPassengerBatches(snapshot);
    const awaitingSpatialPassengerAssets = this.shouldUseSpatialPassengerInstancing()
      && !this.personTemplate
      && !this.unityAssetsFailed;
    if (usingSpatialPassengerBatches || awaitingSpatialPassengerAssets) {
      for (const view of this.passengerViews) view.visible = false;
      this.initialEntryPathStates.clear();
    } else {
      this.ensurePassengerViewCapacity(snapshot.slots.length);
      const activeInitialEntryKeys = new Set();
      for (const slot of snapshot.slots) {
        const view = this.passengerViews[slot.index];
        view.visible = slot.colorIndex !== null;
        if (!view.visible) continue;
        const point = new THREE.Vector3();
        const tangent = new THREE.Vector3();
        this.sampleActiveCurve(slot.progress, point, tangent);
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
    }

    const queueSnapshots = snapshot.queueItems ?? snapshot.queues.map((queue) => (
      queue.map((colorIndex, index) => ({
        colorIndex,
        distanceFromHead: index * this.getQueueSpacing()
      }))
    ));
    queueSnapshots.forEach((queue, queueIndex) => {
      const curve = this.queueCurves[queueIndex];
      const views = this.queuePassengerViews[queueIndex] ?? [];
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
    this.updateLuxuryPassengerAnimations(snapshot.time);
    this.vehicleEffects?.update(snapshot);
    this.updateVehiclePathPreview(snapshot, game);
    this.updateGuideHand(snapshot.time, snapshot);
    this.updateEntryBanner();
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
    if (!tuning.enabled || !isGuideLevelActive(tuning) || !target || !target.visible || targetState !== 'parked') {
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
    if (!guide.enabled || !isGuideLevelActive(guide)) return false;
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
    if (this.activeConveyorLayout?.directEntrance) return [0];
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
      exitEnd: layout.exitEnd,
      directEntrance: Boolean(layout.directEntrance),
      initiallyFull: layout.kind === 'spatial' && Boolean(SCENE_TUNING.spatialConveyor?.startFilled)
    };
  }

  getQueueLengths() {
    return this.queueCurves.map((curve) => curve?.getLength?.() ?? 0);
  }

  getInitialEntryPathKey(slot) {
    return `${slot.entryMotion?.passengerId ?? slot.index}:${slot.entryMotion?.startedAt ?? 0}`;
  }

  getInitialEntryPathVisual(key, slot, target, targetTangent, time, delta, speedMultiplier, passengerHeight) {
    if (this.activeConveyorLayout?.directEntrance || !this.queueCurves?.length) {
      return { position: target, tangent: targetTangent, snapped: true };
    }
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
    const multiplier = Math.max(0.1, speedMultiplier);
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
    const step = speed * Math.max(0, delta) * Math.max(0.1, speedMultiplier);
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
      this.layoutRoot.remove(entry.root);
      this.releaseBoardingVisual(entry.root);
    }
    this.boardingViews.length = 0;
    this.vehicleBoardingPulses.clear();
    this.initialEntryPathStates.clear();
    this.queueEntryPathStates.clear();
    this.lastBoardingEventId = 0;
  }

  disposeBoardingVisualPool() {
    for (const visual of this.boardingVisualPool) {
      disposeMaterial(visual.userData.material);
    }
    this.boardingVisualPool.length = 0;
  }

  acquireBoardingVisual(colorIndex) {
    const wantsAmbulancePassenger = colorIndex === AMBULANCE_COLOR_INDEX;
    const wantsLuxuryPassenger = colorIndex === LUXURY_COLOR_INDEX
      && this.luxuryPassengerTemplate
      && this.luxuryPassengerMaterial;
    const usePool = this.isSpatialOptimizationEnabled('poolBoardingPassengers')
      && !wantsAmbulancePassenger
      && !wantsLuxuryPassenger;
    let visual = usePool && this.boardingVisualPool.length
      ? this.boardingVisualPool.pop()
      : this.createPassengerVisual(colorIndex);
    if (
      visual.userData.isAmbulancePassenger !== wantsAmbulancePassenger
      || visual.userData.isLuxuryPassenger !== wantsLuxuryPassenger
    ) {
      disposeMaterial(visual.userData.material);
      visual = this.createPassengerVisual(colorIndex);
    }
    const material = visual.userData.vatMaterial;
    if (material) {
      if (!wantsAmbulancePassenger && !wantsLuxuryPassenger) {
        const map = this.passengerColorTextures[colorIndex] ?? this.passengerColorTextures[0];
        applyPassengerMaterial(material, colorIndex, map);
      }
      this.setVatAnimation(material, 'move');
    } else if (wantsLuxuryPassenger) {
      visual.userData.animationClipName = 'move';
      visual.userData.animationPhase = 0;
    }
    visual.visible = true;
    return visual;
  }

  releaseBoardingVisual(visual) {
    if (
      this.isSpatialOptimizationEnabled('poolBoardingPassengers')
      && !visual.userData.isAmbulancePassenger
      && !visual.userData.isLuxuryPassenger
      && this.boardingVisualPool.length < 64
    ) {
      visual.visible = false;
      this.boardingVisualPool.push(visual);
      return;
    }
    disposeMaterial(visual.userData.material);
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
    const startCenter = new THREE.Vector3();
    const tangent = new THREE.Vector3();
    this.sampleActiveCurve(event.progress, startCenter, tangent);
    startCenter.y += SCENE_TUNING.passengers.heightAbovePath;
    const pathYaw = Math.atan2(tangent.x, tangent.z) + deg(SCENE_TUNING.facing.passengerYawDegrees);
    const target = spot.clone();
    target.y = SCENE_TUNING.path.groundY + SCENE_TUNING.passengers.heightAbovePath;

    for (let index = 0; index < LEVEL_1.groupSize; index += 1) {
      const visual = this.acquireBoardingVisual(event.colorIndex);
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
      if (visual.userData.isLuxuryPassenger) {
        visual.userData.animationClipName = 'move';
        visual.userData.animationPhase = 0;
      } else {
        this.setVatAnimation(visual.userData.vatMaterial, 'move');
      }
      this.layoutRoot.add(visual);
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
      this.layoutRoot.remove(entry.root);
      this.releaseBoardingVisual(entry.root);
      this.boardingViews.splice(index, 1);
    }
  }

  pick(event) {
    if (!this.inputEnabled) return;
    const rect = this.canvas.getBoundingClientRect();
    this.pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const pickMeshes = [...this.vehicleViews.values()]
      .flatMap((view) => view.userData.pickMeshes ?? view.userData.bodyMeshes ?? []);
    const hits = this.raycaster.intersectObjects(pickMeshes, true);
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

  getBackgroundCanvasBounds() {
    if (!this.backgroundPlane) return null;
    const rect = this.canvas.getBoundingClientRect();
    const canvasWidth = Math.max(0, rect.width);
    const canvasHeight = Math.max(0, rect.height);
    if (canvasWidth <= 0 || canvasHeight <= 0) return null;

    this.camera.updateMatrixWorld(true);
    this.backgroundPlane.updateMatrixWorld(true);
    const projectedCorners = [
      [-0.5, -0.5],
      [0.5, -0.5],
      [0.5, 0.5],
      [-0.5, 0.5]
    ].map(([x, y]) => (
      new THREE.Vector3(x, y, 0)
        .applyMatrix4(this.backgroundPlane.matrixWorld)
        .project(this.camera)
    ));
    if (projectedCorners.some((point) => (
      !Number.isFinite(point.x) || !Number.isFinite(point.y) || !Number.isFinite(point.z)
    ))) {
      return null;
    }

    const canvasPoints = projectedCorners.map((point) => ({
      x: (point.x + 1) * canvasWidth / 2,
      y: (1 - point.y) * canvasHeight / 2
    }));
    const left = Math.max(0, Math.min(...canvasPoints.map((point) => point.x)));
    const right = Math.min(canvasWidth, Math.max(...canvasPoints.map((point) => point.x)));
    const top = Math.max(0, Math.min(...canvasPoints.map((point) => point.y)));
    const bottom = Math.min(canvasHeight, Math.max(...canvasPoints.map((point) => point.y)));
    if (right <= left || bottom <= top) return null;
    return {
      left,
      right,
      top,
      bottom,
      width: right - left,
      height: bottom - top
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
    this.updateEntryBannerLayout();
    if (this.fullQueueCurves) this.updateQueueCurvesForCamera();
  }

  render() {
    this.updateVehicleEntrance();
    this.renderer.render(this.scene, this.camera);
  }
}
