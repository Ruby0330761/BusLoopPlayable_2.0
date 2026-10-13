import {
  CONTAINER_TYPES,
  GARAGE_PARK_POS,
  GARAGE_SIZE,
  GATE_TANGENT_HANDLE_RADIUS,
  LevelEditorModel,
  VEHICLE_PAINT_COLOR_OPTIONS,
  VEHICLE_COLORS,
  getVehicleColorOption,
  isSpecialVehicle,
  createLevelDocument,
  exportLevelCsv,
  exportLevelExcelXml,
  exportUnityLevelAsset,
  getElevatorStats,
  getGateQueueBounds,
  getGateQueuePath,
  getGateQueueTangentHandles,
  retargetLevelDocument,
  validateLevelDocument
} from './level-editor-model.js';
import { SCENE_TUNING } from './scene-tuning.js';
import {
  RECOGNITION_DEFAULTS,
  blobsToWorldVehicles,
  createImageWorldMapping,
  recognizeLevelFromImage
} from './level-image-recognizer.js';
import './level-layout-editor.css';

const TYPE_NAMES = Object.freeze({
  1: '停车区', 2: '车库', 3: '运输带', 4: '闸门队列', 5: '升降舱'
});
const MECHANISM_NAMES = Object.freeze({
  normal: '普通车辆', hidden: '隐藏车辆', combination: '双色组合',
  linkHead: '联动车头', linkTail: '联动车尾', wrench: '扳手车', gear: '齿轮车',
  ambulance: '救护车', firetruck: '消防车', police: '警车'
});
const WORLD_SCALE = 78;
const GARAGE_TEXTURE_URL = '/assets/unity/mechanisms/garage/textures/garage-2d.png';
const CONVEYOR_TEXTURE_URL = '/assets/unity/level-editor/conveyor-belt-2d.png';
const PASSENGER_QUEUE_COLORS = Object.freeze([
  '#0061E8', '#118024', '#F338AF', '#9725CD', '#B10F11', '#C68000',
  '#C24300', '#014853', '#542C16', '#206D53', '#15209E', '#26262E',
  '#F22E14', '#F2F2F2', '#FADB2E', '#D1A861', '#8A8A8A',
  '#2D2D30', '#EBEBE8', '#8C1010', '#C89808', '#EEDEBE', '#69C8AA',
  '#96C882', '#F698C4', '#96989B'
]);
const DEFAULT_INITIAL_PASSENGER_COUNT = 8;
const LEVEL_EDITOR_PREVIEW_STORAGE_KEY = 'bus-loop-level-editor-preview-v3';
const LEVEL_EDITOR_PREVIEW_FORMAT = 'bus-loop-level-editor-preview-v3';
const REFERENCE_IMAGE_MAX_BYTES = 20 * 1024 * 1024;
const REFERENCE_IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);
const REFERENCE_IMAGE_STORAGE_PREFIX = 'bus-loop-level-editor-reference-v1:';
const REFERENCE_IMAGE_STORAGE_MAX_CHARS = 4_000_000;
const REFERENCE_IMAGE_CLEANUP_STORAGE_KEY = 'bus-loop-level-editor-reference-cleanup-v1';
const RECOGNITION_OPTIONS_STORAGE_KEY = 'bus-loop-level-editor-recognition-v1';
const RECOGNITION_WORK_MAX_DIMENSION = 1400;

function createReferenceLayer() {
  return {
    image: null,
    source: '',
    name: '',
    visible: true,
    locked: true,
    x: 0,
    z: 0,
    width: 8,
    height: 8,
    scale: 1,
    rotation: 0,
    opacity: 0.45
  };
}

function referenceStorageKey(levelKey) {
  return `${REFERENCE_IMAGE_STORAGE_PREFIX}${encodeURIComponent(String(levelKey ?? ''))}`;
}

function readReferenceLayer(levelKey) {
  const layer = createReferenceLayer();
  if (typeof localStorage === 'undefined') return layer;
  try {
    const source = JSON.parse(localStorage.getItem(referenceStorageKey(levelKey)) || 'null');
    if (!source || typeof source !== 'object') return layer;
    layer.source = typeof source.source === 'string'
      && source.source.length <= REFERENCE_IMAGE_STORAGE_MAX_CHARS
      && /^data:image\/(?:jpeg|png|webp);base64,/i.test(source.source) ? source.source : '';
    layer.name = typeof source.name === 'string' ? source.name : '';
    layer.visible = source.visible !== false;
    layer.locked = source.locked !== false;
    layer.x = clampNumber(source.x, -100, 100, 0);
    layer.z = clampNumber(source.z, -100, 100, 0);
    layer.width = clampNumber(source.width, 0.1, 100, 8);
    layer.height = clampNumber(source.height, 0.1, 100, 8);
    layer.scale = clampNumber(source.scale, 0.05, 5, 1);
    layer.rotation = clampNumber(source.rotation, -360, 360, 0);
    layer.opacity = clampNumber(source.opacity, 0.05, 1, 0.45);
  } catch {
    // A stale or quota-truncated editor cache should not prevent level editing.
  }
  return layer;
}

function persistReferenceLayer(levelKey, layer) {
  if (!layer?.source || typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(referenceStorageKey(levelKey), JSON.stringify({
      source: layer.source,
      name: layer.name,
      visible: layer.visible,
      locked: layer.locked,
      x: layer.x,
      z: layer.z,
      width: layer.width,
      height: layer.height,
      scale: layer.scale,
      rotation: layer.rotation,
      opacity: layer.opacity
    }));
  } catch {
    // The image remains available for the current editor session if storage is full.
  }
}

function clearPersistedReferenceLayer(levelKey) {
  if (typeof localStorage === 'undefined') return;
  try { localStorage.removeItem(referenceStorageKey(levelKey)); } catch { /* private mode */ }
}

function clearPersistedReferenceLayersOnce() {
  if (typeof localStorage === 'undefined') return;
  try {
    if (localStorage.getItem(REFERENCE_IMAGE_CLEANUP_STORAGE_KEY) === '1') return;
    const keys = [];
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index);
      if (key?.startsWith(REFERENCE_IMAGE_STORAGE_PREFIX)) keys.push(key);
    }
    for (const key of keys) localStorage.removeItem(key);
    localStorage.setItem(REFERENCE_IMAGE_CLEANUP_STORAGE_KEY, '1');
  } catch {
    // A restricted storage implementation should not prevent the editor from opening.
  }
}

function referenceLayerReady(layer) {
  return Boolean(layer?.image?.complete && layer.image.naturalWidth > 0 && layer.image.naturalHeight > 0);
}

function referenceLayerSize(layer) {
  const scale = clampNumber(layer?.scale, 0.05, 5, 1);
  return {
    width: layer.width * scale,
    height: layer.height * scale
  };
}

function snapshotReferenceLayer(layer) {
  return {
    source: layer.source || '',
    name: layer.name || '',
    visible: layer.visible !== false,
    locked: layer.locked !== false,
    x: clampNumber(layer.x, -100, 100, 0),
    z: clampNumber(layer.z, -100, 100, 0),
    width: clampNumber(layer.width, 0.1, 100, 8),
    height: clampNumber(layer.height, 0.1, 100, 8),
    scale: clampNumber(layer.scale, 0.05, 5, 1),
    rotation: clampNumber(layer.rotation, -360, 360, 0),
    opacity: clampNumber(layer.opacity, 0.05, 1, 0.45)
  };
}

function referenceSnapshotsEqual(left, right) {
  return left.source === right.source
    && left.name === right.name
    && left.visible === right.visible
    && left.locked === right.locked
    && left.x === right.x
    && left.z === right.z
    && left.width === right.width
    && left.height === right.height
    && left.scale === right.scale
    && left.rotation === right.rotation
    && left.opacity === right.opacity;
}

function clampNumber(value, min, max, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(min, Math.min(max, number)) : fallback;
}

function writeLevelEditorPreviewDocument(document, mode, baseRevision = null) {
  localStorage.setItem(LEVEL_EDITOR_PREVIEW_STORAGE_KEY, JSON.stringify({
    format: LEVEL_EDITOR_PREVIEW_FORMAT,
    mode,
    baseRevision: typeof baseRevision === 'string' ? baseRevision : null,
    document
  }));
}

function download(filename, content, type = 'application/octet-stream') {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

function itemKey(item) {
  return `${item.seats ? 'vehicle' : 'container'}:${item.id}`;
}

function persistentDocumentSource(document) {
  return JSON.stringify(document, (key, value) => key === 'elevatorEditingLayer' ? undefined : value);
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[char]);
}

function numberField(label, path, value, { min = '', max = '', step = '0.01' } = {}) {
  return `<label class="level-layout-field"><span>${label}</span><input type="number" data-field="${path}" value="${Number(value)}" min="${min}" max="${max}" step="${step}"></label>`;
}

function selectField(label, path, value, options) {
  return `<label class="level-layout-field"><span>${label}</span><select data-field="${path}">${options.map(([key, text]) => `<option value="${key}" ${String(key) === String(value) ? 'selected' : ''}>${text}</option>`).join('')}</select></label>`;
}

function vehicleColorField(label, path, value, options = VEHICLE_PAINT_COLOR_OPTIONS) {
  const current = options.find((color) => color.id === Number(value)) ?? options[0];
  return `<label class="level-layout-field"><span>${label}</span><span class="level-layout-color-select"><span class="level-layout-color-swatch" style="--swatch-color:${current.css}" aria-hidden="true"></span><select data-field="${path}">${options.map((color) => `<option value="${color.id}" ${color.id === Number(value) ? 'selected' : ''}>${color.id}: ${color.name} / ${color.label}</option>`).join('')}</select></span></label>`;
}

function vehicleOverrideField(label, path, value) {
  return `<label class="level-layout-field level-layout-color-input"><span>${label}</span><span class="level-layout-color-input-control"><input type="color" data-field="${path}" value="${value}"><code>${value}</code></span></label>`;
}

function passengerOverrideField(label, region, colorIndex, value) {
  return `<label class="level-layout-field level-layout-color-input"><span>${label}</span><span class="level-layout-color-input-control"><input type="color" data-passenger-color-region="${region}" data-passenger-color-index="${colorIndex}" value="${value}"><code>${value}</code></span></label>`;
}

function vehicleBatchOverrideField(label, path, value, mixed = false) {
  return `<label class="level-layout-field level-layout-color-input"><span>${label}</span><span class="level-layout-color-input-control"><input type="color" data-field="${path}" value="${value}" title="${mixed ? '当前车辆颜色不同，修改后将统一应用' : ''}"><code>${mixed ? '混合值' : value}</code></span></label>`;
}

function passengerColorOverridesMarkup(document, colorIndex) {
  const overrides = document.passengerColorOverrides?.[String(colorIndex)] ?? {};
  const base = overrides.body ?? getVehicleColorOption(colorIndex).css.toLowerCase();
  return `<details class="level-layout-color-details"><summary>小人颜色微调</summary>
    ${passengerOverrideField('小人身体', 'body', colorIndex, base)}
    ${passengerOverrideField('小人高光', 'highlight', colorIndex, overrides.highlight ?? base)}
    ${passengerOverrideField('小人阴影', 'shadow', colorIndex, overrides.shadow ?? base)}
    ${passengerOverrideField('小人车窗', 'window', colorIndex, overrides.window ?? '#263238')}
    ${passengerOverrideField('小人细节', 'detail', colorIndex, overrides.detail ?? base)}
    <p class="level-layout-hint">小人颜色会同步到相同颜色的车辆；修改车身颜色也会同步这里。</p>
  </details>`;
}

function invertHexColor(color) {
  const value = Number.parseInt(color.slice(1), 16);
  return `#${(0xFFFFFF ^ value).toString(16).padStart(6, '0')}`;
}

function vehicleDisplayColor(vehicle) {
  return vehicle?.colorOverrides?.body ?? getVehicleColorOption(vehicle?.colorIndex).css;
}

function passengerColor(colorIndex, document = null) {
  return document?.passengerColorOverrides?.[String(colorIndex)]?.body
    ?? PASSENGER_QUEUE_COLORS[colorIndex]
    ?? '#64748b';
}

function passengerColorName(colorIndex) {
  const color = getVehicleColorOption(colorIndex);
  return color ? `${color.id}: ${color.label}` : String(colorIndex);
}

function incrementCount(counts, colorIndex, amount = 1) {
  counts.set(colorIndex, (counts.get(colorIndex) ?? 0) + amount);
}

function passengerQueueStats(document) {
  const passengers = new Map();
  const capacity = new Map();
  document.passengerQueues.forEach((queue) => queue.forEach((color) => incrementCount(passengers, color)));
  document.vehicles.forEach((vehicle) => {
    if (vehicle.mechanism.type === 'combination') {
      incrementCount(capacity, vehicle.colorIndex, 6);
      incrementCount(capacity, vehicle.mechanism.secondColorIndex, 6);
    } else incrementCount(capacity, vehicle.colorIndex, vehicle.seats);
  });
  return { passengers, capacity };
}

function countTotal(counts) {
  return [...counts.values()].reduce((total, count) => total + count, 0);
}

function toggleField(label, path, value) {
  return `<label class="level-layout-check"><input type="checkbox" data-field="${path}" ${value ? 'checked' : ''}><span>${label}</span></label>`;
}

function referenceNumberField(label, path, value, { min = '', max = '', step = '0.01' } = {}) {
  return `<label class="level-layout-field"><span>${label}</span><input type="number" data-reference-field="${path}" value="${Number(value)}" min="${min}" max="${max}" step="${step}"></label>`;
}

function renderReferencePanel(root, layer) {
  const hasImage = referenceLayerReady(layer);
  root.innerHTML = `<div class="level-layout-reference-actions">
      <button type="button" data-action="import-reference-image">${hasImage ? '更换图片' : '导入图片'}</button>
      <button type="button" data-action="clear-reference-image" ${hasImage ? '' : 'disabled'}>清除</button>
      <button type="button" data-action="recognize-image" ${hasImage ? '' : 'disabled'}>识图摆放</button>
    </div>
    ${hasImage ? `<p class="level-layout-reference-name" title="${escapeHtml(layer.name)}">${escapeHtml(layer.name)}</p>
      <label class="level-layout-check"><input type="checkbox" data-reference-field="visible" ${layer.visible ? 'checked' : ''}><span>显示垫图</span></label>
      <label class="level-layout-check"><input type="checkbox" data-reference-field="locked" ${layer.locked ? 'checked' : ''}><span>锁定位置</span></label>
      ${referenceNumberField('X', 'x', layer.x, { step: 0.05 })}
      ${referenceNumberField('Z', 'z', layer.z, { step: 0.05 })}
      ${referenceNumberField('宽度', 'width', layer.width, { min: 0.1, max: 100, step: 0.05 })}
      ${referenceNumberField('高度', 'height', layer.height, { min: 0.1, max: 100, step: 0.05 })}
      ${referenceNumberField('整体缩放', 'scale', layer.scale, { min: 0.05, max: 5, step: 0.05 })}
      ${referenceNumberField('旋转', 'rotation', layer.rotation, { min: -360, max: 360, step: 1 })}
      <label class="level-layout-reference-opacity"><span>透明度</span><input type="range" data-reference-field="opacity" value="${layer.opacity}" min="0.05" max="1" step="0.01"><output>${Math.round(layer.opacity * 100)}%</output></label>
      <button type="button" class="level-layout-reference-fit" data-action="fit-reference-image">适配当前画布</button>
      <p class="level-layout-hint">取消锁定后可在画布上直接拖动。垫图仅用于编辑，不会保存到关卡或试玩包。</p>`
      : '<p class="level-layout-hint">支持 PNG、JPG、WebP，最大 20 MB。图片只作为编辑辅助，不会进入关卡数据。</p>'}`;
}

function worldToScreen(camera, rect, x, z) {
  const scale = WORLD_SCALE * camera.zoom;
  return {
    x: rect.width * 0.5 + (x - camera.x) * scale,
    y: rect.height * 0.5 - (z - camera.z) * scale
  };
}

function screenToWorld(camera, rect, x, y) {
  const scale = WORLD_SCALE * camera.zoom;
  return {
    x: camera.x + (x - rect.width * 0.5) / scale,
    z: camera.z - (y - rect.height * 0.5) / scale
  };
}

function vehicleDimensions(vehicle) {
  return { width: 0.27, length: vehicle.seats === 10 ? 0.6786 : vehicle.seats === 6 ? 0.486 : 0.4716 };
}

function visibleVehicles(document, activeContainerId) {
  const containers = new Map(document.containers.map((container) => [container.id, container]));
  if (activeContainerId !== 0) {
    const active = containers.get(activeContainerId);
    return document.vehicles.filter((vehicle) => (
      vehicle.containerId === activeContainerId
      && (active?.type !== CONTAINER_TYPES.ELEVATOR || vehicle.elevatorLayer === active.elevatorEditingLayer)
    ));
  }
  return document.vehicles.filter((vehicle) => {
    const container = containers.get(vehicle.containerId);
    if (!container || container.type === CONTAINER_TYPES.PARKING || container.type === CONTAINER_TYPES.GATE_QUEUE) return true;
    if (container.type === CONTAINER_TYPES.ELEVATOR) return vehicle.elevatorLayer === 0;
    return false;
  });
}

function pointInPolygon(point, polygon) {
  let inside = false;
  for (let index = 0, previous = polygon.length - 1; index < polygon.length; previous = index, index += 1) {
    const a = polygon[index];
    const b = polygon[previous];
    if ((a.z > point.z) !== (b.z > point.z) && point.x < (b.x - a.x) * (point.z - a.z) / (b.z - a.z) + a.x) inside = !inside;
  }
  return inside;
}

function hitItem(document, point, activeContainerId = 0) {
  if (activeContainerId === 0) {
    const lockedGate = document.containers.find((item) => (
      item.type === CONTAINER_TYPES.GATE_QUEUE
      && item.gateQueueLocked
      && pointInPolygon(point, getGateQueueBounds(document, item))
    ));
    if (lockedGate) return lockedGate;
  }
  const items = [...document.containers.filter((item) => item.type !== 1), ...visibleVehicles(document, activeContainerId)];
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index];
    const dimensions = item.seats ? vehicleDimensions(item) : { width: item.width, length: item.length };
    const radians = -item.yaw * Math.PI / 180;
    const dx = point.x - item.x;
    const dz = point.z - item.z;
    const localX = dx * Math.cos(radians) - dz * Math.sin(radians);
    const localZ = dx * Math.sin(radians) + dz * Math.cos(radians);
    if (Math.abs(localX) <= dimensions.width * 0.65 && Math.abs(localZ) <= dimensions.length * 0.6) return item;
  }
  return null;
}

function elevatorHandlePoints(elevator) {
  const radians = elevator.yaw * Math.PI / 180;
  const axisX = { x: Math.cos(radians), z: -Math.sin(radians) };
  const axisZ = { x: Math.sin(radians), z: Math.cos(radians) };
  const halfX = elevator.width * 0.5;
  const halfZ = elevator.length * 0.5;
  return [[-1,1],[0,1],[1,1],[-1,0],[1,0],[-1,-1],[0,-1],[1,-1]].map(([x, z]) => ({
    x: elevator.x + axisX.x * halfX * x + axisZ.x * halfZ * z,
    z: elevator.z + axisX.z * halfX * x + axisZ.z * halfZ * z
  }));
}

function hitElevatorResizeHandle(document, activeContainerId, point) {
  const elevator = document.containers.find((item) => item.id === activeContainerId && item.type === CONTAINER_TYPES.ELEVATOR);
  if (!elevator) return null;
  const index = elevatorHandlePoints(elevator).findIndex((handle) => Math.hypot(point.x - handle.x, point.z - handle.z) <= 0.18);
  return index < 0 ? null : { elevator, index };
}

function hitGateTangentHandle(document, activeContainerId, selected, point) {
  const gate = document.containers.find((item) => item.id === activeContainerId && item.type === CONTAINER_TYPES.GATE_QUEUE);
  const vehicle = selected.length === 1 && selected[0]?.seats ? selected[0] : null;
  if (!gate?.gateQueueShowCurveHandles || !vehicle) return null;
  const handles = getGateQueueTangentHandles(document, gate, vehicle);
  if (!handles) return null;
  if (Math.hypot(point.x - handles.negative.x, point.z - handles.negative.z) <= GATE_TANGENT_HANDLE_RADIUS) return { gate, vehicle, side: -1 };
  if (Math.hypot(point.x - handles.positive.x, point.z - handles.positive.z) <= GATE_TANGENT_HANDLE_RADIUS) return { gate, vehicle, side: 1 };
  return null;
}

function drawWorldPath(context, camera, rect, points, offset = { x: 0, z: 0 }, close = false) {
  if (!points.length) return;
  const first = worldToScreen(camera, rect, points[0].x + offset.x, points[0].z + offset.z);
  context.beginPath();
  context.moveTo(first.x, first.y);
  for (let index = 1; index < points.length; index += 1) {
    const point = worldToScreen(camera, rect, points[index].x + offset.x, points[index].z + offset.z);
    context.lineTo(point.x, point.y);
  }
  if (close) context.closePath();
}

function drawContainerBadge(context, text, x, y, color) {
  context.fillStyle = color;
  context.fillRect(x - 9, y - 7, 18, 14);
  context.fillStyle = '#fff';
  context.font = '700 9px "Poppins Branding", Arial, sans-serif';
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.fillText(String(text), x, y + 0.5);
}

function drawArrow(context, length) {
  context.beginPath();
  context.moveTo(0, -length * 0.42);
  context.lineTo(-0.055, -length * 0.24);
  context.lineTo(0.055, -length * 0.24);
  context.closePath();
  context.fill();
}

function drawVehicleSafeFrame(context, camera, rect) {
  const sourceCube = SCENE_TUNING.vehicleArea?.sourceCube;
  const width = Number(sourceCube?.width);
  const depth = Number(sourceCube?.depth);
  const centerX = Number(sourceCube?.centerX);
  const centerZ = Number(sourceCube?.centerZ);
  if (![width, depth, centerX, centerZ].every(Number.isFinite) || width <= 0 || depth <= 0) return;
  const padding = 0.1;
  const halfWidth = width * 0.5 + padding;
  const halfDepth = depth * 0.5 + padding;
  const points = [
    worldToScreen(camera, rect, centerX - halfWidth, centerZ - halfDepth),
    worldToScreen(camera, rect, centerX + halfWidth, centerZ - halfDepth),
    worldToScreen(camera, rect, centerX + halfWidth, centerZ + halfDepth),
    worldToScreen(camera, rect, centerX - halfWidth, centerZ + halfDepth)
  ];
  context.save();
  context.fillStyle = 'rgba(236, 72, 72, .035)';
  context.strokeStyle = 'rgba(231, 62, 62, .92)';
  context.lineWidth = 3;
  context.beginPath();
  context.moveTo(points[0].x, points[0].y);
  points.slice(1).forEach((point) => context.lineTo(point.x, point.y));
  context.closePath();
  context.fill();
  context.stroke();
  context.restore();
}

function fitReferenceLayerToView(layer, camera, rect) {
  if (!referenceLayerReady(layer)) return;
  const scale = WORLD_SCALE * camera.zoom;
  const maxWidth = Math.max(1, rect.width * 0.82 / scale);
  const maxHeight = Math.max(1, rect.height * 0.82 / scale);
  const aspect = layer.image.naturalWidth / layer.image.naturalHeight;
  if (maxWidth / maxHeight < aspect) {
    layer.width = maxWidth;
    layer.height = maxWidth / aspect;
  } else {
    layer.height = maxHeight;
    layer.width = maxHeight * aspect;
  }
  layer.x = camera.x;
  layer.z = camera.z;
  layer.scale = 1;
  layer.rotation = 0;
}

function readRecognitionOptions() {
  const options = {
    tolerance: RECOGNITION_DEFAULTS.tolerance,
    backgroundTolerance: RECOGNITION_DEFAULTS.backgroundTolerance,
    minArea: null,
    maxAreaRatio: RECOGNITION_DEFAULTS.maxAreaRatio,
    fillRatio: RECOGNITION_DEFAULTS.fillRatio,
    mergeGap: RECOGNITION_DEFAULTS.mergeGap,
    seats: 'auto',
    snapToGrid: true,
    alignRows: true,
    splitMerged: RECOGNITION_DEFAULTS.splitMerged,
    allowNeutralColors: RECOGNITION_DEFAULTS.allowNeutralColors,
    mode: 'replace'
  };
  if (typeof localStorage === 'undefined') return options;
  try {
    const stored = JSON.parse(localStorage.getItem(RECOGNITION_OPTIONS_STORAGE_KEY) || 'null');
    if (stored && typeof stored === 'object') Object.assign(options, stored);
  } catch {
    // A stale editor cache should not prevent level editing.
  }
  options.seats = ['auto', '4', '6', '10'].includes(String(options.seats)) ? String(options.seats) : 'auto';
  options.mode = options.mode === 'append' ? 'append' : 'replace';
  return options;
}

function persistRecognitionOptions(options) {
  if (typeof localStorage === 'undefined') return;
  try { localStorage.setItem(RECOGNITION_OPTIONS_STORAGE_KEY, JSON.stringify(options)); } catch { /* private mode */ }
}

function recognitionSettings(options) {
  return {
    tolerance: options.tolerance,
    backgroundTolerance: options.backgroundTolerance,
    minArea: options.minArea,
    maxAreaRatio: options.maxAreaRatio,
    fillRatio: options.fillRatio,
    mergeGap: options.mergeGap,
    seats: options.seats,
    snapToGrid: options.snapToGrid,
    alignRows: options.alignRows,
    splitMerged: options.splitMerged,
    allowNeutralColors: options.allowNeutralColors
  };
}

function referenceLayerMapping(layer, imageWidth, imageHeight) {
  const size = referenceLayerSize(layer);
  return createImageWorldMapping({
    imageWidth,
    imageHeight,
    x: layer.x,
    z: layer.z,
    width: size.width,
    height: size.height,
    rotation: layer.rotation
  });
}

/**
 * Recognition works on a bounded copy of the underlay: it keeps a 1600px reference
 * responsive while leaving the normalized mapping untouched.
 */
function readRecognitionImageData(image, maxDimension = RECOGNITION_WORK_MAX_DIMENSION) {
  const ratio = Math.min(1, maxDimension / Math.max(image.naturalWidth, image.naturalHeight));
  const width = Math.max(8, Math.round(image.naturalWidth * ratio));
  const height = Math.max(8, Math.round(image.naturalHeight * ratio));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  context.drawImage(image, 0, 0, width, height);
  return context.getImageData(0, 0, width, height);
}

function recognitionStatsMarkup(result) {
  const summary = result.summary;
  const colorChips = summary.byColor.length
    ? summary.byColor.map((entry) => `<li><i style="--swatch-color:${entry.css}"></i><span>${entry.id}: ${escapeHtml(entry.label)}</span><b>${entry.count}</b></li>`).join('')
    : '<li class="is-empty">没有识别到车辆颜色</li>';
  const rejected = summary.rejected;
  const skipped = summary.skippedColorIds.length;
  if (result.method === 'editor-overlay') {
    return `<p class="level-image-warning">${escapeHtml(result.warning || '这是一张编辑器结果图，不能作为识图输入。')}</p>
      <p class="level-image-hint">请重新选择没有红色边框、网格线和编号牌的原始车辆图片。</p>`;
  }
  return `<div class="level-image-total"><strong>${summary.total}</strong><span>辆车</span></div>
    ${result.method === 'arrow-markers' ? '<p class="level-image-hint">已使用箭头中心识别：颜色匹配到内置近似色，方向按箭头估算。</p>' : ''}
    <ul class="level-image-colors">${colorChips}</ul>
    <dl class="level-image-metrics">
      <dt>行列</dt><dd>${summary.rows} 行 / 最多 ${summary.columns} 列</dd>
      <dt>网格间距</dt><dd>X ${summary.pitch.x}px · Y ${summary.pitch.y}px</dd>
      <dt>座位</dt><dd>${Object.entries(summary.seats).map(([seats, count]) => `${seats} 座 ${count}`).join(' · ') || '无'}</dd>
      <dt>已过滤</dt><dd>面积 ${rejected.area} · 过大 ${rejected.edge} · 稀疏 ${rejected.fill} · 重复 ${rejected.overlap}</dd>
    </dl>
    ${skipped ? `<p class="level-image-warning">${skipped} 个颜色与图片背景过于接近，无法识别（可能是黑白灰车身或路面同色）。</p>` : ''}
    <p class="level-image-hint">识别使用当前垫图的位置、大小和旋转。摆放后可继续微调，或按 ⌘/Ctrl+Z 撤销。</p>`;
}

function isReferenceImageFile(file) {
  const extension = String(file?.name ?? '').toLowerCase().match(/\.(png|jpe?g|webp)$/)?.[1];
  return REFERENCE_IMAGE_TYPES.has(file?.type) || Boolean(extension);
}

function loadReferenceImage(source) {
  const image = new Image();
  image.decoding = 'async';
  return new Promise((resolve, reject) => {
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('图片无法读取'));
    image.src = source;
  });
}

async function prepareReferenceImage(file) {
  const objectUrl = URL.createObjectURL(file);
  try {
    const sourceImage = await loadReferenceImage(objectUrl);
    const maxDimension = 2048;
    const ratio = Math.min(1, maxDimension / Math.max(sourceImage.naturalWidth, sourceImage.naturalHeight));
    const width = Math.max(1, Math.round(sourceImage.naturalWidth * ratio));
    const height = Math.max(1, Math.round(sourceImage.naturalHeight * ratio));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d', { alpha: false });
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, width, height);
    context.drawImage(sourceImage, 0, 0, width, height);
    let source = '';
    for (const quality of [0.84, 0.7, 0.56, 0.42]) {
      source = canvas.toDataURL('image/jpeg', quality);
      if (source.length <= REFERENCE_IMAGE_STORAGE_MAX_CHARS) break;
    }
    if (source.length > REFERENCE_IMAGE_STORAGE_MAX_CHARS) throw new Error('图片压缩后仍然过大，请换一张较小的图片');
    return { source, image: await loadReferenceImage(source), width, height };
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

function hitReferenceLayer(layer, point) {
  if (!referenceLayerReady(layer) || !layer.visible || layer.locked) return false;
  const radians = layer.rotation * Math.PI / 180;
  const dx = point.x - layer.x;
  const dz = point.z - layer.z;
  const localX = dx * Math.cos(radians) - dz * Math.sin(radians);
  const localZ = -dx * Math.sin(radians) - dz * Math.cos(radians);
  const size = referenceLayerSize(layer);
  return Math.abs(localX) <= size.width * 0.5 && Math.abs(localZ) <= size.height * 0.5;
}

function drawReferenceLayer(context, camera, rect, layer, gesture) {
  if (!referenceLayerReady(layer) || !layer.visible) return;
  const delta = gesture?.type === 'reference-drag' ? gesture.delta : { x: 0, z: 0 };
  const screen = worldToScreen(camera, rect, layer.x + delta.x, layer.z + delta.z);
  const scale = WORLD_SCALE * camera.zoom;
  const size = referenceLayerSize(layer);
  const width = size.width * scale;
  const height = size.height * scale;
  context.save();
  context.translate(screen.x, screen.y);
  context.rotate(layer.rotation * Math.PI / 180);
  context.globalAlpha = layer.opacity;
  context.drawImage(layer.image, -width * 0.5, -height * 0.5, width, height);
  context.globalAlpha = 1;
  if (!layer.locked) {
    context.setLineDash([6, 4]);
    context.strokeStyle = '#1683a2';
    context.lineWidth = 1.5;
    context.strokeRect(-width * 0.5, -height * 0.5, width, height);
    context.setLineDash([]);
    context.beginPath();
    context.moveTo(-6, 0); context.lineTo(6, 0);
    context.moveTo(0, -6); context.lineTo(0, 6);
    context.stroke();
  }
  context.restore();
}

function drawCanvas(canvas, model, camera, gesture, garageTexture, conveyorTexture, referenceLayer, recognitionPreview = null) {
  const ratio = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  const width = Math.max(1, Math.round(rect.width * ratio));
  const height = Math.max(1, Math.round(rect.height * ratio));
  if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
  const context = canvas.getContext('2d');
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  context.clearRect(0, 0, rect.width, rect.height);
  context.fillStyle = '#f3f6f8';
  context.fillRect(0, 0, rect.width, rect.height);

  drawReferenceLayer(context, camera, rect, referenceLayer, gesture);

  const gap = model.document.editor.gridGap;
  const scale = WORLD_SCALE * camera.zoom;
  if (gap * scale >= 8) {
    const radians = model.document.editor.gridRotation * Math.PI / 180;
    const axisX = { x: Math.cos(radians), z: Math.sin(radians) };
    const axisZ = { x: -Math.sin(radians), z: Math.cos(radians) };
    const span = Math.hypot(rect.width, rect.height) / scale * 1.5;
    const count = Math.ceil(span / gap) + 2;
    context.strokeStyle = 'rgba(30, 55, 70, .11)';
    context.lineWidth = 1;
    context.beginPath();
    for (let index = -count; index <= count; index += 1) {
      const offset = index * gap;
      const a = worldToScreen(camera, rect, axisX.x * offset - axisZ.x * span, axisX.z * offset - axisZ.z * span);
      const b = worldToScreen(camera, rect, axisX.x * offset + axisZ.x * span, axisX.z * offset + axisZ.z * span);
      const c = worldToScreen(camera, rect, axisZ.x * offset - axisX.x * span, axisZ.z * offset - axisX.z * span);
      const d = worldToScreen(camera, rect, axisZ.x * offset + axisX.x * span, axisZ.z * offset + axisX.z * span);
      context.moveTo(a.x, a.y); context.lineTo(b.x, b.y); context.moveTo(c.x, c.y); context.lineTo(d.x, d.y);
    }
    context.stroke();
  }

  const origin = worldToScreen(camera, rect, 0, 0);
  context.strokeStyle = 'rgba(15, 90, 110, .34)';
  context.beginPath(); context.moveTo(origin.x, 0); context.lineTo(origin.x, rect.height); context.moveTo(0, origin.y); context.lineTo(rect.width, origin.y); context.stroke();

  const offset = gesture?.type === 'drag' ? gesture.delta : { x: 0, z: 0 };
  for (const container of model.document.containers.filter((item) => item.type !== 1)) {
    const selected = model.selection.has(`container:${container.id}`);
    const moving = selected ? offset : { x: 0, z: 0 };
    const screen = worldToScreen(camera, rect, container.x + moving.x, container.z + moving.z);
    if (container.type === CONTAINER_TYPES.GATE_QUEUE) {
      const path = getGateQueuePath(model.document, container);
      const bounds = getGateQueueBounds(model.document, container);
      context.save();
      context.strokeStyle = selected ? '#24a148' : '#00bcd4';
      context.lineWidth = selected ? 6 : 3;
      drawWorldPath(context, camera, rect, bounds, moving, true);
      context.stroke();
      context.strokeStyle = '#00bcd4';
      context.lineWidth = selected ? 6 : 4;
      drawWorldPath(context, camera, rect, path, moving);
      context.stroke();
      drawContainerBadge(context, container.id, screen.x, screen.y, '#7a858b');
      context.restore();
      continue;
    }
    if (container.type === CONTAINER_TYPES.GARAGE) {
      const radians = container.yaw * Math.PI / 180;
      const exit = worldToScreen(camera, rect,
        container.x + moving.x + Math.sin(radians) * GARAGE_PARK_POS,
        container.z + moving.z + Math.cos(radians) * GARAGE_PARK_POS);
      const exitSize = vehicleDimensions({ seats: 10 });
      context.save();
      context.translate(exit.x, exit.y); context.rotate(radians);
      context.strokeStyle = '#1683e8'; context.lineWidth = 1.5;
      context.strokeRect(-exitSize.width * scale / 2, -exitSize.length * scale / 2, exitSize.width * scale, exitSize.length * scale);
      context.restore();
    }
    context.save();
    context.translate(screen.x, screen.y); context.rotate(container.yaw * Math.PI / 180);
    const drawX = -container.width * scale / 2; const drawY = -container.length * scale / 2;
    const drawWidth = container.width * scale; const drawHeight = container.length * scale;
    if (container.type === CONTAINER_TYPES.GARAGE && garageTexture?.complete && garageTexture.naturalWidth > 0) {
      context.drawImage(garageTexture, drawX, drawY, drawWidth, drawHeight);
      if (selected) { context.strokeStyle = '#24a148'; context.lineWidth = 3; context.strokeRect(drawX - 2, drawY - 2, drawWidth + 4, drawHeight + 4); }
      const count = model.document.vehicles.filter((vehicle) => vehicle.containerId === container.id).length;
      context.font = '700 10px "Poppins Branding", Arial, sans-serif'; context.textAlign = 'center'; context.textBaseline = 'middle';
      context.fillStyle = '#66747c'; context.fillText(String(container.id), 0, -drawHeight * 0.22);
      context.fillStyle = '#1683e8'; context.fillText(String(count), 0, drawHeight * 0.22);
    } else if (container.type === CONTAINER_TYPES.CONVEYOR) {
      const borderWidth = 0.27 * 0.15 * scale;
      context.strokeStyle = selected ? '#24a148' : '#000';
      context.lineWidth = selected ? borderWidth * 2 : borderWidth;
      context.strokeRect(drawX, drawY, drawWidth, drawHeight);
      const innerWidth = container.conveyorWidth * scale;
      const innerHeight = drawHeight * 0.8;
      const innerX = -innerWidth * 0.5;
      const innerY = -innerHeight * 0.5;
      context.fillStyle = '#777';
      context.fillRect(innerX, innerY, innerWidth, innerHeight);
      if (conveyorTexture?.complete && conveyorTexture.naturalWidth > 0) {
        const pattern = context.createPattern(conveyorTexture, 'repeat');
        if (pattern) { context.fillStyle = pattern; context.fillRect(innerX, innerY, innerWidth, innerHeight); }
      }
      context.strokeStyle = '#777';
      context.lineWidth = Math.max(1, borderWidth * 0.5);
      context.strokeRect(innerX, innerY, innerWidth, innerHeight);
      const badgeX = drawX + drawHeight * 0.2;
      drawContainerBadge(context, container.id, badgeX, -drawHeight * 0.25, '#7a858b');
      const count = model.document.vehicles.filter((vehicle) => vehicle.containerId === container.id).length;
      drawContainerBadge(context, count, badgeX, drawHeight * 0.25, '#1683e8');
    } else if (container.type === CONTAINER_TYPES.ELEVATOR) {
      const stats = getElevatorStats(model.document, container);
      context.strokeStyle = stats.upperCount === 0 || stats.lowerCount === 0 ? '#e33131' : '#e9c929';
      context.lineWidth = selected ? 8 : 4;
      context.strokeRect(drawX, drawY, drawWidth, drawHeight);
      if (model.activeContainerId === container.id) {
        context.fillStyle = '#fff';
        context.strokeStyle = '#536973';
        context.lineWidth = 1;
        for (const [hx, hy] of [[-1,-1],[0,-1],[1,-1],[-1,0],[1,0],[-1,1],[0,1],[1,1]]) {
          const x = hx * drawWidth * 0.5;
          const y = hy * drawHeight * 0.5;
          context.fillRect(x - 4, y - 4, 8, 8);
          context.strokeRect(x - 4, y - 4, 8, 8);
        }
      }
    } else {
      context.fillStyle = selected ? 'rgba(8, 145, 178, .24)' : 'rgba(70, 90, 105, .13)';
      context.strokeStyle = selected ? '#0891b2' : '#637786'; context.lineWidth = selected ? 2 : 1;
      context.fillRect(drawX, drawY, drawWidth, drawHeight); context.strokeRect(drawX, drawY, drawWidth, drawHeight);
      context.fillStyle = '#263b48'; context.font = '600 11px "Poppins Branding", Arial, sans-serif'; context.textAlign = 'center'; context.textBaseline = 'middle';
      context.fillText(`${TYPE_NAMES[container.type]} #${container.id}`, 0, 0);
    }
    context.restore();
  }

  if (model.activeContainerId === 0) {
    drawVehicleSafeFrame(context, camera, rect);
  }

  for (const vehicle of visibleVehicles(model.document, model.activeContainerId)) {
    const selected = model.selection.has(`vehicle:${vehicle.id}`);
    const moving = selected ? offset : { x: 0, z: 0 };
    const screen = worldToScreen(camera, rect, vehicle.x + moving.x, vehicle.z + moving.z);
    const size = vehicleDimensions(vehicle);
    context.save();
    context.translate(screen.x, screen.y); context.rotate(vehicle.yaw * Math.PI / 180);
    const vehicleColor = vehicleDisplayColor(vehicle);
    const inverseColor = vehicle.isHidden ? '#ffffff' : invertHexColor(vehicleColor);
    context.fillStyle = vehicleColor;
    context.globalAlpha = vehicle.isHidden ? 0.42 : 1;
    context.strokeStyle = selected ? '#071a25' : 'rgba(7, 26, 37, .55)'; context.lineWidth = selected ? 3 : 1;
    context.fillRect(-size.width * scale / 2, -size.length * scale / 2, size.width * scale, size.length * scale);
    context.strokeRect(-size.width * scale / 2, -size.length * scale / 2, size.width * scale, size.length * scale);
    context.globalAlpha = 1; context.fillStyle = inverseColor; drawArrow(context, size.length * scale);
    context.fillStyle = inverseColor; context.font = '700 10px "Poppins Branding", Arial, sans-serif'; context.textAlign = 'center'; context.textBaseline = 'middle';
    context.fillText(String(vehicle.id), 0, 2);
    if (vehicle.isTurnVehicle) { context.fillStyle = '#0f172a'; context.fillText('T', size.width * scale * 0.3, size.length * scale * 0.35); }
    context.restore();
  }

  const activeGate = model.document.containers.find((container) => (
    container.id === model.activeContainerId
    && container.type === CONTAINER_TYPES.GATE_QUEUE
    && container.gateQueuePathShape === 1
    && !container.gateQueueLocked
    && container.gateQueueShowCurveHandles
  ));
  const selectedVehicle = model.selected().length === 1 && model.selected()[0]?.seats ? model.selected()[0] : null;
  const handles = getGateQueueTangentHandles(model.document, activeGate, selectedVehicle);
  if (handles) {
    const center = worldToScreen(camera, rect, handles.center.x, handles.center.z);
    const negative = worldToScreen(camera, rect, handles.negative.x, handles.negative.z);
    const positive = worldToScreen(camera, rect, handles.positive.x, handles.positive.z);
    context.strokeStyle = '#f5c842';
    context.lineWidth = 2;
    context.beginPath(); context.moveTo(negative.x, negative.y); context.lineTo(positive.x, positive.y); context.stroke();
    context.fillStyle = '#f5c842';
    for (const point of [negative, positive]) {
      context.beginPath(); context.arc(point.x, point.y, GATE_TANGENT_HANDLE_RADIUS * scale, 0, Math.PI * 2); context.fill();
    }
    context.beginPath(); context.arc(center.x, center.y, GATE_TANGENT_HANDLE_RADIUS * 0.5 * scale, 0, Math.PI * 2); context.fill();
  }

  if (model.document.editor.alignmentGuides && model.selected().length === 1) {
    const selected = model.selected()[0];
    const moving = gesture?.type === 'drag' ? gesture.delta : { x: 0, z: 0 };
    const x = selected.x + moving.x; const z = selected.z + moving.z;
    const threshold = Math.max(0.04, gap * 0.35);
    const peers = model.document.vehicles.filter((item) => item !== selected);
    context.strokeStyle = '#06a6c8'; context.lineWidth = 1; context.setLineDash([4, 3]); context.beginPath();
    if (peers.some((item) => Math.abs(item.x - x) <= threshold)) { const point = worldToScreen(camera, rect, x, z); context.moveTo(point.x, 0); context.lineTo(point.x, rect.height); }
    if (peers.some((item) => Math.abs(item.z - z) <= threshold)) { const point = worldToScreen(camera, rect, x, z); context.moveTo(0, point.y); context.lineTo(rect.width, point.y); }
    context.stroke(); context.setLineDash([]);
  }

  if (gesture?.type === 'box') {
    const x = Math.min(gesture.startScreen.x, gesture.currentScreen.x); const y = Math.min(gesture.startScreen.y, gesture.currentScreen.y);
    const widthBox = Math.abs(gesture.currentScreen.x - gesture.startScreen.x); const heightBox = Math.abs(gesture.currentScreen.y - gesture.startScreen.y);
    context.fillStyle = 'rgba(8, 145, 178, .12)'; context.strokeStyle = '#0891b2'; context.setLineDash([5, 4]);
    context.fillRect(x, y, widthBox, heightBox); context.strokeRect(x, y, widthBox, heightBox); context.setLineDash([]);
  }

  if (recognitionPreview?.length) {
    for (const vehicle of recognitionPreview) {
      const screen = worldToScreen(camera, rect, vehicle.x, vehicle.z);
      const size = vehicleDimensions(vehicle);
      const previewSize = vehicle.recognitionWidth && vehicle.recognitionLength
        ? { width: vehicle.recognitionWidth, length: vehicle.recognitionLength }
        : size;
      context.save();
      context.translate(screen.x, screen.y);
      context.rotate((vehicle.yaw ?? 0) * Math.PI / 180);
      context.fillStyle = getVehicleColorOption(vehicle.colorIndex).css;
      context.globalAlpha = 0.28;
      context.fillRect(-previewSize.width * scale / 2, -previewSize.length * scale / 2, previewSize.width * scale, previewSize.length * scale);
      context.globalAlpha = 1;
      context.strokeStyle = '#ef5b25';
      context.lineWidth = 1.25;
      context.setLineDash([3, 3]);
      context.strokeRect(-previewSize.width * scale / 2, -previewSize.length * scale / 2, previewSize.width * scale, previewSize.length * scale);
      context.setLineDash([]);
      context.fillStyle = '#152a37';
      context.globalAlpha = 0.9;
      context.beginPath();
      context.moveTo(0, -previewSize.length * scale * 0.36);
      context.lineTo(previewSize.width * scale * 0.22, -previewSize.length * scale * 0.05);
      context.lineTo(-previewSize.width * scale * 0.22, -previewSize.length * scale * 0.05);
      context.closePath();
      context.fill();
      context.restore();
    }
  }
}

function renderInspector(root, model) {
  let selected = model.selected();
  const selectedVehicles = selected.filter((item) => item.seats);
  const isVehicleBatch = selected.length > 1 && selectedVehicles.length === selected.length;
  const activeContainer = model.activeContainerId === 0
    ? null
    : model.document.containers.find((item) => item.id === model.activeContainerId);
  if (!isVehicleBatch && selected.length !== 1 && activeContainer) {
    model.select(`container:${activeContainer.id}`);
    selected = [activeContainer];
  }
  if (isVehicleBatch) {
    const first = selectedVehicles[0];
    const hasSpecialVehicle = selectedVehicles.some(isSpecialVehicle);
    const colorValue = (vehicle, key) => {
      const overrides = vehicle.colorOverrides ?? {};
      if (key === 'body') return overrides.body ?? getVehicleColorOption(vehicle.colorIndex).css.toLowerCase();
      if (key === 'window') return overrides.window ?? '#263238';
      return overrides[key] ?? (key === 'detail' ? (overrides.body ?? getVehicleColorOption(vehicle.colorIndex).css.toLowerCase()) : (overrides.body ?? getVehicleColorOption(vehicle.colorIndex).css.toLowerCase()));
    };
    const batchValue = (key) => {
      const values = selectedVehicles.map((vehicle) => colorValue(vehicle, key));
      return { value: values[0], mixed: new Set(values).size > 1 };
    };
    const body = batchValue('body');
    const highlight = batchValue('highlight');
    const shadow = batchValue('shadow');
    const window = batchValue('window');
    const detail = batchValue('detail');
    root.innerHTML = `<h3>已选车辆 ${selectedVehicles.length} 辆</h3>
      <p class="level-layout-hint">框选车辆后，修改下面任一参数会统一应用到全部选中车辆；${hasSpecialVehicle ? '选区包含特殊车辆，颜色编辑已禁用。' : '车辆颜色会同步对应小人。'}</p>
      ${hasSpecialVehicle ? '<p class="level-layout-hint">特殊车辆使用专属颜色，不需要手动选择。</p>' : `
        ${vehicleColorField('基础颜色（同步小人）', 'colorIndex', first.colorIndex)}
        ${passengerColorOverridesMarkup(model.document, first.colorIndex)}
        <details class="level-layout-color-details" open><summary>统一调节颜色区域</summary>
          ${vehicleBatchOverrideField('车身', 'colorOverrides.body', body.value, body.mixed)}
          ${vehicleBatchOverrideField('高光', 'colorOverrides.highlight', highlight.value, highlight.mixed)}
          ${vehicleBatchOverrideField('阴影', 'colorOverrides.shadow', shadow.value, shadow.mixed)}
          ${vehicleBatchOverrideField('车窗', 'colorOverrides.window', window.value, window.mixed)}
          ${vehicleBatchOverrideField('细节', 'colorOverrides.detail', detail.value, detail.mixed)}
          <button type="button" data-action="reset-vehicle-colors">恢复选中车辆内置颜色</button>
        </details>`}`;
    return;
  }
  if (selected.length !== 1) {
    const validation = validateLevelDocument(model.document);
    root.innerHTML = `<h3>关卡概览</h3>
      <dl class="level-layout-stats"><dt>关卡</dt><dd>${escapeHtml(model.document.key)}</dd><dt>车辆</dt><dd>${model.document.vehicles.length}</dd><dt>乘客</dt><dd>${model.document.passengerQueues.flat().length}</dd><dt>选择</dt><dd>${selected.length}</dd></dl>
      <div class="level-layout-validation ${validation.valid ? 'is-valid' : 'is-invalid'}">${validation.valid ? '验证通过' : `${validation.errors.length} 个错误`}</div>
      <h3>关卡设置</h3>
      ${numberField('Unity ID', 'document.unityId', model.document.unityId, { min: 1, step: 1 })}
      ${numberField('地图缩放', 'document.mapScale', model.document.mapScale, { min: 0.1, max: 3, step: 0.01 })}
      ${selectField('难度', 'document.difficulty', model.document.difficulty, [['Normal','普通'],['Hard','困难'],['SupperHard','超难']])}
      <label class="level-layout-field"><span>场景/传送带</span><input data-field="document.conveyorBeltName" value="${escapeHtml(model.document.conveyorBeltName)}"></label>
      ${selectField('乘客模式', 'document.passengerMethod', model.document.passengerMethod, [['FixedSequence','固定顺序']])}
      <h3>画布设置</h3>
      ${numberField('网格大小', 'document.editor.gridGap', model.document.editor.gridGap, { min: 0.05, max: 2, step: 0.01 })}
      ${numberField('网格旋转', 'document.editor.gridRotation', model.document.editor.gridRotation, { min: 0, max: 360, step: 1 })}
      ${toggleField('网格吸附', 'document.editor.gridSnap', model.document.editor.gridSnap)}
      ${toggleField('载具吸附', 'document.editor.vehicleSnap', model.document.editor.vehicleSnap)}
      ${toggleField('辅助线', 'document.editor.alignmentGuides', model.document.editor.alignmentGuides)}
      <h3>乘客队列</h3>
      <dl class="level-layout-stats">${model.document.passengerQueues.map((queue, index) => `<dt>队列 ${index}</dt><dd>${queue.length}</dd>`).join('')}</dl>
      <button type="button" data-action="open-passenger-queue">打开队列编辑器</button>`;
    return;
  }
  const item = selected[0];
  if (item.seats) {
    const specialVehicle = isSpecialVehicle(item);
    const baseColor = getVehicleColorOption(item.colorIndex).css.toLowerCase();
    const overrides = item.colorOverrides ?? {};
    const bodyColor = overrides.body ?? baseColor;
    root.innerHTML = `<h3>车辆 #${item.id}</h3>
      ${numberField('X', 'x', item.x)}${numberField('Z', 'z', item.z)}${numberField('旋转', 'yaw', item.yaw, { min: 0, max: 360, step: 1 })}
      ${specialVehicle ? '<p class="level-layout-hint">特殊车辆使用专属颜色，不需要手动选择。</p>' : `
        ${vehicleColorField('颜色（同步小人）', 'colorIndex', item.colorIndex)}
        ${passengerColorOverridesMarkup(model.document, item.colorIndex)}
        <details class="level-layout-color-details" ${Object.keys(overrides).length ? 'open' : ''}><summary>车辆颜色微调</summary>
          ${vehicleOverrideField('车身', 'colorOverrides.body', bodyColor)}
          ${vehicleOverrideField('高光', 'colorOverrides.highlight', overrides.highlight ?? bodyColor)}
          ${vehicleOverrideField('阴影', 'colorOverrides.shadow', overrides.shadow ?? bodyColor)}
          ${vehicleOverrideField('车窗', 'colorOverrides.window', overrides.window ?? '#263238')}
          ${vehicleOverrideField('细节', 'colorOverrides.detail', overrides.detail ?? bodyColor)}
          <p class="level-layout-hint">只保存本车的覆盖颜色；清除后恢复内置贴图。</p>
          <button type="button" data-action="reset-vehicle-colors">恢复内置颜色</button>
        </details>`}
      ${selectField('座位', 'seats', item.seats, [[4, '4 座'], [6, '6 座'], [10, '10 座']])}
      ${selectField('机制', 'mechanism.type', item.mechanism.type, Object.entries(MECHANISM_NAMES))}
      ${toggleField('隐藏', 'isHidden', item.isHidden)}${toggleField('转向车', 'isTurnVehicle', item.isTurnVehicle)}
      ${selectField('容器', 'containerId', item.containerId, model.document.containers.map((container) => [container.id, `${TYPE_NAMES[container.type]} #${container.id}`]))}
      ${item.containerType === CONTAINER_TYPES.ELEVATOR ? selectField('升降层', 'elevatorLayer', item.elevatorLayer, [[0, '上层'], [1, '下层']]) : ''}
      ${['linkHead', 'linkTail', 'wrench', 'gear'].includes(item.mechanism.type) ? numberField('关联车辆', 'mechanism.pairVehicleId', item.mechanism.pairVehicleId ?? 0, { min: 1, step: 1 }) : ''}
      ${['linkHead', 'linkTail'].includes(item.mechanism.type) ? numberField('连接距离', 'mechanism.distance', item.mechanism.distance, { min: 0.15, max: 0.5, step: 0.01 }) : ''}
      ${['wrench', 'gear'].includes(item.mechanism.type) ? selectField('扳手颜色', 'mechanism.wrenchColor', item.mechanism.wrenchColor, [[0,'粉'],[1,'蓝'],[2,'紫'],[3,'绿'],[4,'黄']]) : ''}
      ${item.mechanism.type === 'combination' ? vehicleColorField('组合颜色（同步小人）', 'mechanism.secondColorIndex', item.mechanism.secondColorIndex) : ''}
      ${item.mechanism.type === 'ambulance' ? numberField('步数限制', 'mechanism.stepLimit', item.mechanism.stepLimit, { min: 1, step: 1 }) : ''}
      ${item.mechanism.type === 'firetruck' ? numberField('倒计时', 'mechanism.timeLimit', item.mechanism.timeLimit, { min: 1, step: 1 }) : ''}
      <div class="level-layout-inspector-actions"><button type="button" data-action="rotate-left" title="Q：左转 15°；Alt+Q：绕选区中心左转">左转 15°</button><button type="button" data-action="rotate-right" title="E：右转 15°；Alt+E：绕选区中心右转">右转 15°</button></div>
      <button class="is-danger" type="button" data-action="delete">删除选中对象</button>`;
    return;
  }
  root.innerHTML = `<h3>${TYPE_NAMES[item.type]} #${item.id}</h3>
    ${numberField('X', 'x', item.x)}${numberField('Z', 'z', item.z)}${numberField('旋转', 'yaw', item.yaw, { min: 0, max: 360, step: 1 })}
    ${item.type === CONTAINER_TYPES.CONVEYOR ? `${numberField('出口宽度', 'conveyorWidth', item.conveyorWidth, { min: 0.1 })}<dl class="level-layout-stats"><dt>外框尺寸</dt><dd>${item.width.toFixed(2)} × ${item.length.toFixed(2)}</dd><dt>车辆数量</dt><dd>${model.document.vehicles.filter((vehicle) => vehicle.containerId === item.id).length}</dd></dl>` : ''}
    ${item.type === CONTAINER_TYPES.GATE_QUEUE ? `${selectField('路径形状', 'gateQueuePathShape', item.gateQueuePathShape, [[0,'直线'],[1,'曲线']])}<label class="level-layout-check ${item.gateQueuePathShape === 0 ? 'is-disabled' : ''}"><input type="checkbox" data-field="gateQueueLocked" ${item.gateQueueLocked ? 'checked' : ''} ${item.gateQueuePathShape === 0 ? 'disabled' : ''}><span>锁定</span></label><label class="level-layout-check ${item.gateQueuePathShape === 0 || item.gateQueueLocked ? 'is-disabled' : ''}"><input type="checkbox" data-field="gateQueueShowCurveHandles" ${item.gateQueueShowCurveHandles ? 'checked' : ''} ${item.gateQueuePathShape === 0 || item.gateQueueLocked ? 'disabled' : ''}><span>显示曲线控制点</span></label>${numberField('车辆间距', 'gateQueueGap', item.gateQueueGap, { min: 0.01 })}<p class="level-layout-hint">${item.gateQueuePathShape === 0 ? '直线队列固定锁定；车辆按车长和间距自动排列。' : item.gateQueueLocked ? '锁定后沿已保存路径排列。取消锁定可拖动车辆调整曲线。' : '拖动车辆调整曲线锚点，完成后可重新锁定。'}</p><button type="button" data-action="refresh-gate">刷新队列</button>` : ''}
    ${item.type === CONTAINER_TYPES.ELEVATOR ? (() => { const stats = getElevatorStats(model.document, item); return `${numberField('宽度', 'width', item.width, { min: 0.1 })}${numberField('长度', 'length', item.length, { min: 0.1 })}<div class="level-layout-segments" role="group" aria-label="升降舱编辑层"><button type="button" data-action="elevator-upper" class="${item.elevatorEditingLayer === 0 ? 'is-active' : ''}">上层</button><button type="button" data-action="elevator-lower" class="${item.elevatorEditingLayer === 1 ? 'is-active' : ''}">下层</button></div><dl class="level-layout-stats ${stats.upperCount === 0 || stats.lowerCount === 0 ? 'is-warning' : ''}"><dt>上层车辆</dt><dd>${stats.upperCount}</dd><dt>下层车辆</dt><dd>${stats.lowerCount}</dd><dt>舱外车辆</dt><dd>${stats.outsideCount}</dd></dl>${stats.upperCount === 0 || stats.lowerCount === 0 ? '<p class="level-layout-warning">上层或下层没有车辆</p>' : ''}${stats.outsideCount ? `<p class="level-layout-warning">当前层有 ${stats.outsideCount} 辆车位于舱外</p>` : ''}<button type="button" data-action="center-elevator">在升降舱内居中</button>`; })() : ''}
    <button type="button" data-action="${model.activeContainerId === item.id ? 'exit-container' : 'enter-container'}">${model.activeContainerId === item.id ? '返回关卡' : '编辑容器内车辆'}</button>
    <button class="is-danger" type="button" data-action="delete">删除选中对象</button>`;
}

async function loadSavedDocument(level) {
  try {
    const response = await fetch(`/__level-authoring/${encodeURIComponent(level.key)}`, { cache: 'no-store' });
    if (response.status === 404) return { document: createLevelDocument(level), revision: null };
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || `HTTP ${response.status}`);
    return payload;
  } catch (error) {
    console.warn('Saved level document could not be loaded.', error);
    return { document: createLevelDocument(level), revision: null };
  }
}

function renderReferenceInspector(root, referenceLayer) {
  const section = document.createElement('section');
  section.className = 'level-layout-reference-panel';
  section.innerHTML = '<h3>垫图</h3><div class="level-layout-reference-content"></div>';
  renderReferencePanel(section.querySelector('.level-layout-reference-content'), referenceLayer);
  root.prepend(section);
}

export async function createLevelLayoutEditor({
  baseLevel,
  initialDocument = null,
  initialRevision = null,
  onClose = () => {},
  onPreview = () => {}
}) {
  clearPersistedReferenceLayersOnce();
  const loaded = initialDocument
    ? { document: createLevelDocument(initialDocument), revision: initialRevision }
    : await loadSavedDocument(baseLevel);
  let model = new LevelEditorModel(loaded.document);
  let revision = loaded.revision;
  let savedDocumentSource = initialDocument ? null : persistentDocumentSource(model.document);
  let createOnly = false;
  const camera = { x: 0, z: 0, zoom: 1 };
  let gesture = null;
  let altPressed = false;
  let anchorRotationCenter = null;
  let referenceLayer = readReferenceLayer(model.document.key);
  let referencePersistTimer = null;
  const recognitionState = {
    open: false,
    busy: false,
    options: readRecognitionOptions(),
    result: null,
    message: '',
    messageKind: ''
  };
  const editorHistoryLimit = 100;
  const editorUndoStack = [];
  const editorRedoStack = [];
  model = attachModelHistoryTracker(model);
  const garageTexture = new Image();
  garageTexture.decoding = 'async';
  garageTexture.src = GARAGE_TEXTURE_URL;
  const conveyorTexture = new Image();
  conveyorTexture.decoding = 'async';
  conveyorTexture.src = CONVEYOR_TEXTURE_URL;

  const overlay = document.createElement('div');
  overlay.className = 'level-layout-editor';
  overlay.innerHTML = `<header class="level-layout-toolbar">
    <strong>${escapeHtml(model.document.key)} 关卡编辑器</strong>
    <div class="level-layout-toolbar-group">
      <button type="button" data-action="undo" title="上一步（⌘/Ctrl+Z）" aria-label="上一步">↶</button><button type="button" data-action="redo" title="下一步（⌘/Ctrl+Shift+Z / Ctrl+Y）" aria-label="下一步">↷</button>
      <button type="button" data-action="new-level">新建关卡</button><button type="button" data-action="rebuild">重算深度</button><button type="button" data-action="validate">验证</button><button type="button" data-action="save">保存</button><button type="button" data-action="preview">试玩</button>
      <button type="button" data-action="import-json">导入 JSON</button><button type="button" data-action="export-json">JSON</button><button type="button" data-action="export-unity">Unity</button><button type="button" data-action="export-csv">CSV</button><button type="button" data-action="export-excel">Excel</button>
    </div>
    <div class="level-layout-toolbar-group"><button type="button" data-action="close" aria-label="关闭">×</button></div>
  </header>
  <div class="level-layout-body">
    <aside class="level-layout-palette"><h3>添加元素</h3><button data-add="vehicle">添加车辆</button><button data-add="vehicle-firetruck">添加消防车</button><button data-add="vehicle-ambulance">添加救护车</button><button data-add="vehicle-police">添加警车</button><h3>地图机制</h3><button data-add="garage">添加车库</button><button data-add="conveyor">添加运输带</button><button data-add="gate">添加闸门</button><button data-add="elevator">添加升降舱</button><h3>排列</h3><button data-action="align-horizontal">水平等距</button><button data-action="align-vertical">垂直等距</button><button data-action="align-line">连线等距</button><button data-action="center">全部居中</button><button data-action="to-gate">转为闸门队列</button><h3>辅助</h3><button data-action="import-reference-image">导入垫图</button><button data-action="clear-reference-image">清除垫图</button><button data-action="recognize-image">识图摆放</button><h3>定位</h3><label class="level-layout-locate"><input type="number" min="1" placeholder="车辆 ID"><button data-action="locate">定位</button></label></aside>
    <main class="level-layout-canvas-wrap"><canvas class="level-layout-canvas"></canvas><button type="button" class="level-layout-breadcrumb" data-action="exit-container" hidden>返回关卡</button><div class="level-layout-status" aria-live="polite">就绪</div></main>
    <aside class="level-layout-inspector"></aside>
  </div>
  <section class="passenger-queue-editor" aria-label="乘客队列编辑器" hidden>
    <header class="passenger-queue-toolbar"><strong></strong><span class="passenger-queue-save-state"></span><button type="button" data-passenger-action="save">保存</button><button type="button" data-passenger-action="close" aria-label="关闭乘客队列编辑器">×</button></header>
    <div class="passenger-queue-body"><aside class="passenger-queue-operations"></aside><main class="passenger-queue-center"></main><aside class="passenger-queue-stats"></aside></div>
    <div class="passenger-queue-selection-box" hidden></div>
  </section>
  <section class="level-layout-dialog-backdrop" hidden>
    <form class="level-layout-new-dialog">
      <header><h2>新建关卡</h2><button type="button" data-action="cancel-new-level" aria-label="关闭">×</button></header>
      <label><span>关卡编号</span><input name="levelNumber" type="number" min="1" step="1" required></label>
      <label><span>关卡名称</span><input name="displayName" type="text" maxlength="80" placeholder="例如：Level 20" required></label>
      <p class="level-layout-new-error" aria-live="polite"></p>
      <footer><button type="button" data-action="cancel-new-level">取消</button><button class="is-primary" type="submit">创建</button></footer>
    </form>
  </section>
  <input class="level-layout-json-input" type="file" accept=".json,application/json" hidden>
  <input class="level-layout-reference-input" type="file" accept=".png,.jpg,.jpeg,.webp,image/png,image/jpeg,image/webp" hidden>
  <section class="level-image-backdrop" hidden>
    <form class="level-image-dialog">
      <header>
        <h2>识图摆放</h2>
        <span class="level-image-source"></span>
        <button type="button" data-image-action="close" aria-label="关闭识图摆放">×</button>
      </header>
      <div class="level-image-body">
        <div class="level-image-options">
          <label class="level-image-field level-image-file"><span>参考图</span><input type="file" data-image-action="pick-file" accept=".png,.jpg,.jpeg,.webp,image/png,image/jpeg,image/webp"></label>
          <label class="level-image-field level-image-range"><span>颜色容差</span><input type="range" min="8" max="180" step="2" data-image-field="tolerance" value="${recognitionState.options.tolerance}"><output>${recognitionState.options.tolerance}</output></label>
          <label class="level-image-field"><span>最小车辆面积</span><input type="number" min="2" max="20000" step="1" data-image-field="minArea" placeholder="自动" value="${recognitionState.options.minArea ?? ''}"></label>
          <label class="level-image-field"><span>座位数</span><select data-image-field="seats">${[['auto', '自动'], ['4', '4 座'], ['6', '6 座'], ['10', '10 座（大巴）']].map(([value, text]) => `<option value="${value}" ${String(recognitionState.options.seats) === value ? 'selected' : ''}>${text}</option>`).join('')}</select></label>
          <label class="level-image-check"><input type="checkbox" data-image-field="snapToGrid" ${recognitionState.options.snapToGrid ? 'checked' : ''}><span>吸附网格（同行等距）</span></label>
          <label class="level-image-check"><input type="checkbox" data-image-field="alignRows" ${recognitionState.options.alignRows ? 'checked' : ''}><span>行对齐</span></label>
          <label class="level-image-check"><input type="checkbox" data-image-field="splitMerged" ${recognitionState.options.splitMerged ? 'checked' : ''}><span>拆分粘连车辆</span></label>
          <label class="level-image-check"><input type="checkbox" data-image-field="allowNeutralColors" ${recognitionState.options.allowNeutralColors ? 'checked' : ''}><span>识别黑白灰车身</span></label>
          <label class="level-image-field"><span>摆放方式</span><select data-image-field="mode"><option value="replace" ${recognitionState.options.mode === 'replace' ? 'selected' : ''}>替换停车区车辆</option><option value="append" ${recognitionState.options.mode === 'append' ? 'selected' : ''}>追加到停车区</option></select></label>
          <details class="level-image-advanced">
            <summary>更多设置</summary>
            <label class="level-image-field level-image-range"><span>背景容差</span><input type="range" min="0" max="160" step="2" data-image-field="backgroundTolerance" value="${recognitionState.options.backgroundTolerance}"><output>${recognitionState.options.backgroundTolerance}</output></label>
            <label class="level-image-field"><span>最大面积占比</span><input type="number" min="0.005" max="0.5" step="0.005" data-image-field="maxAreaRatio" value="${recognitionState.options.maxAreaRatio}"></label>
            <label class="level-image-field"><span>最小填充率</span><input type="number" min="0" max="1" step="0.05" data-image-field="fillRatio" value="${recognitionState.options.fillRatio}"></label>
            <label class="level-image-field"><span>碎片合并像素</span><input type="number" min="0" max="12" step="1" data-image-field="mergeGap" value="${recognitionState.options.mergeGap}"></label>
          </details>
        </div>
        <div class="level-image-preview">
          <div class="level-image-stats"></div>
          <p class="level-image-message" aria-live="polite"></p>
        </div>
      </div>
      <footer>
        <button type="button" data-image-action="rescan">重新识别</button>
        <button type="button" data-image-action="close">取消</button>
        <button type="submit" class="is-primary" data-image-action="apply">应用摆放</button>
      </footer>
    </form>
  </section>`;
  document.body.append(overlay);
  const canvas = overlay.querySelector('canvas');
  const toolbarTitle = overlay.querySelector('.level-layout-toolbar > strong');
  const inspector = overlay.querySelector('.level-layout-inspector');
  const status = overlay.querySelector('.level-layout-status');
  const breadcrumb = overlay.querySelector('.level-layout-breadcrumb');
  const jsonInput = overlay.querySelector('.level-layout-json-input');
  const referenceInput = overlay.querySelector('.level-layout-reference-input');
  const recognitionBackdrop = overlay.querySelector('.level-image-backdrop');
  const recognitionForm = overlay.querySelector('.level-image-dialog');
  const recognitionStats = overlay.querySelector('.level-image-stats');
  const recognitionMessage = overlay.querySelector('.level-image-message');
  const recognitionSource = overlay.querySelector('.level-image-source');
  const recognitionRescan = recognitionForm.querySelector('[data-image-action="rescan"]');
  const recognitionApply = recognitionForm.querySelector('[data-image-action="apply"]');
  const locateInput = overlay.querySelector('.level-layout-locate input');
  const passengerEditor = overlay.querySelector('.passenger-queue-editor');
  const passengerOperations = passengerEditor.querySelector('.passenger-queue-operations');
  const passengerCenter = passengerEditor.querySelector('.passenger-queue-center');
  const passengerStats = passengerEditor.querySelector('.passenger-queue-stats');
  const passengerSelectionBox = passengerEditor.querySelector('.passenger-queue-selection-box');
  const newLevelBackdrop = overlay.querySelector('.level-layout-dialog-backdrop');
  const newLevelForm = overlay.querySelector('.level-layout-new-dialog');
  const newLevelError = overlay.querySelector('.level-layout-new-error');
  const newLevelSubmit = newLevelForm.querySelector('[type="submit"]');
  const passengerQueueState = {
    open: false, activeQueueId: 0, selected: new Set(), colorIndex: 0, addCount: 1,
    mode: 'append', clipboard: [], flowStart: 0, flowVisibleCount: 8, flowTimer: null
  };
  let passengerSelectionGesture = null;
  let suppressPassengerClickUntil = 0;
  const resizeObserver = new ResizeObserver(() => render());
  resizeObserver.observe(canvas);
  const recognitionPreview = () => (recognitionState.open ? recognitionVehicles() : null);
  const redrawCanvas = () => drawCanvas(canvas, model, camera, gesture, garageTexture, conveyorTexture, referenceLayer, recognitionPreview());
  garageTexture.addEventListener('load', redrawCanvas);
  conveyorTexture.addEventListener('load', redrawCanvas);

  function render() {
    toolbarTitle.textContent = `${model.document.key} 关卡编辑器`;
    drawCanvas(canvas, model, camera, gesture, garageTexture, conveyorTexture, referenceLayer, recognitionPreview());
    renderInspector(inspector, model);
    renderReferenceInspector(inspector, referenceLayer);
    const activeContainer = model.document.containers.find((item) => item.id === model.activeContainerId);
    const isEditingContainer = model.activeContainerId !== 0 && Boolean(activeContainer);
    breadcrumb.hidden = !isEditingContainer;
    breadcrumb.textContent = isEditingContainer ? `← 返回关卡 · ${TYPE_NAMES[activeContainer.type]} #${activeContainer.id}` : '返回关卡';
    overlay.classList.toggle('is-dirty', persistentDocumentSource(model.document) !== savedDocumentSource);
    overlay.classList.toggle('is-reference-unlocked', referenceLayerReady(referenceLayer) && referenceLayer.visible && !referenceLayer.locked);
    if (passengerQueueState.open) renderPassengerQueueEditor();
  }

  function trimEditorHistory(stack) {
    if (stack.length > editorHistoryLimit) stack.splice(0, stack.length - editorHistoryLimit);
  }

  function recordEditorHistory(entry) {
    if (entry.kind === 'reference') model.redoStack.length = 0;
    editorUndoStack.push(entry);
    trimEditorHistory(editorUndoStack);
    editorRedoStack.length = 0;
  }

  function attachModelHistoryTracker(nextModel) {
    const transact = nextModel.transact.bind(nextModel);
    nextModel.transact = (mutator) => {
      const result = transact(mutator);
      recordEditorHistory({ kind: 'model' });
      return result;
    };
    return nextModel;
  }

  function clearEditorHistory() {
    editorUndoStack.length = 0;
    editorRedoStack.length = 0;
  }

  function writeReferenceLayerStorage(levelKey = model.document.key) {
    if (referenceLayer.source) persistReferenceLayer(levelKey, referenceLayer);
    else clearPersistedReferenceLayer(levelKey);
  }

  function scheduleReferencePersist() {
    if (referencePersistTimer) clearTimeout(referencePersistTimer);
    referencePersistTimer = setTimeout(() => {
      referencePersistTimer = null;
      writeReferenceLayerStorage();
    }, 150);
  }

  function recordReferenceHistory(before) {
    const after = snapshotReferenceLayer(referenceLayer);
    if (referenceSnapshotsEqual(before, after)) return false;
    recordEditorHistory({ kind: 'reference', before });
    return true;
  }

  async function restoreReferenceSnapshot(snapshot) {
    const previousImage = referenceLayer.source === snapshot.source ? referenceLayer.image : null;
    if (!previousImage) releaseReferenceImage();
    Object.assign(referenceLayer, createReferenceLayer(), snapshot);
    referenceLayer.image = previousImage;
    if (referenceLayer.source && !referenceLayer.image) {
      try {
        referenceLayer.image = await loadReferenceImage(referenceLayer.source);
      } catch {
        releaseReferenceImage();
        referenceLayer.source = '';
        referenceLayer.name = '';
        setStatus('历史垫图图片无法读取，已跳过图片恢复', 'error');
      }
    }
    if (referencePersistTimer) clearTimeout(referencePersistTimer);
    referencePersistTimer = null;
    writeReferenceLayerStorage();
  }

  async function undoEditorAction() {
    const entry = editorUndoStack.pop();
    if (!entry) return model.undo();
    if (entry.kind === 'reference') {
      editorRedoStack.push({ kind: 'reference', before: snapshotReferenceLayer(referenceLayer) });
      trimEditorHistory(editorRedoStack);
      await restoreReferenceSnapshot(entry.before);
      return true;
    }
    const restored = model.undo();
    if (restored) {
      editorRedoStack.push({ kind: 'model' });
      trimEditorHistory(editorRedoStack);
    }
    return restored;
  }

  async function redoEditorAction() {
    const entry = editorRedoStack.pop();
    if (!entry) return model.redo();
    if (entry.kind === 'reference') {
      editorUndoStack.push({ kind: 'reference', before: snapshotReferenceLayer(referenceLayer) });
      trimEditorHistory(editorUndoStack);
      await restoreReferenceSnapshot(entry.before);
      return true;
    }
    const restored = model.redo();
    if (restored) {
      editorUndoStack.push({ kind: 'model' });
      trimEditorHistory(editorUndoStack);
    }
    return restored;
  }

  function updateReferenceField(field, value) {
    const before = snapshotReferenceLayer(referenceLayer);
    if (field === 'visible' || field === 'locked') referenceLayer[field] = Boolean(value);
    else if (field === 'opacity') referenceLayer.opacity = clampNumber(value, 0.05, 1, referenceLayer.opacity);
    else if (field === 'width' || field === 'height') referenceLayer[field] = clampNumber(value, 0.1, 100, referenceLayer[field]);
    else if (field === 'scale') referenceLayer.scale = clampNumber(value, 0.05, 5, referenceLayer.scale);
    else if (field === 'rotation') referenceLayer.rotation = clampNumber(value, -360, 360, referenceLayer.rotation);
    else if (field === 'x' || field === 'z') referenceLayer[field] = clampNumber(value, -100, 100, referenceLayer[field]);
    if (recordReferenceHistory(before)) scheduleReferencePersist();
  }

  function releaseReferenceImage() {
    referenceLayer.image = null;
  }

  async function importReferenceImage(file) {
    if (!file) return;
    if (!isReferenceImageFile(file)) throw new Error('仅支持 PNG、JPG 和 WebP 图片');
    if (file.size > REFERENCE_IMAGE_MAX_BYTES) throw new Error('垫图不能超过 20 MB');
    const before = snapshotReferenceLayer(referenceLayer);
    const prepared = await prepareReferenceImage(file);
    releaseReferenceImage();
    referenceLayer.source = prepared.source;
    referenceLayer.image = prepared.image;
    referenceLayer.name = file.name;
    referenceLayer.visible = true;
    referenceLayer.locked = true;
    const rect = canvas.getBoundingClientRect();
    fitReferenceLayerToView(referenceLayer, camera, rect);
    recordReferenceHistory(before);
    writeReferenceLayerStorage();
    setStatus(`已导入垫图 ${file.name}`, 'success');
    render();
  }

  async function restoreReferenceImage() {
    if (!referenceLayer.source) return;
    const source = referenceLayer.source;
    try {
      const image = await loadReferenceImage(source);
      if (referenceLayer.source !== source || !overlay.isConnected) return;
      referenceLayer.image = image;
      render();
    } catch {
      if (referenceLayer.source === source) {
        referenceLayer.source = '';
        referenceLayer.name = '';
        clearPersistedReferenceLayer(model.document.key);
        if (overlay.isConnected) {
          setStatus('已忽略无法读取的历史垫图', 'error');
          render();
        }
      }
    }
  }

  function clearReferenceImage() {
    const before = snapshotReferenceLayer(referenceLayer);
    if (referencePersistTimer) clearTimeout(referencePersistTimer);
    referencePersistTimer = null;
    releaseReferenceImage();
    referenceLayer.source = '';
    referenceLayer.name = '';
    recordReferenceHistory(before);
    writeReferenceLayerStorage();
    gesture = null;
    setStatus('已清除垫图', 'success');
    render();
  }

  function setRecognitionMessage(message, kind = '') {
    recognitionState.message = message;
    recognitionState.messageKind = kind;
  }

  /** Detected pixels are stable; only the underlay transform decides world X/Z. */
  function recognitionVehicles() {
    const result = recognitionState.result;
    if (!result) return null;
    const mapping = referenceLayerMapping(referenceLayer, result.image.width, result.image.height);
    return blobsToWorldVehicles(result.blobs, mapping);
  }

  function syncRecognitionInputs() {
    for (const input of recognitionForm.querySelectorAll('[data-image-field]')) {
      const field = input.dataset.imageField;
      const value = recognitionState.options[field];
      if (input.type === 'checkbox') input.checked = Boolean(value);
      else if (input.type === 'range') {
        input.value = String(value);
        const output = input.parentElement.querySelector('output');
        if (output) output.textContent = String(value);
      } else input.value = value == null ? '' : String(value);
    }
    recognitionSource.textContent = referenceLayerReady(referenceLayer)
      ? `${referenceLayer.name || '参考图'} · ${referenceLayer.image.naturalWidth}×${referenceLayer.image.naturalHeight}`
      : '未导入参考图';
  }

  function renderRecognitionDialog() {
    recognitionBackdrop.hidden = !recognitionState.open;
    if (!recognitionState.open) return;
    recognitionMessage.textContent = recognitionState.message;
    recognitionMessage.className = `level-image-message${recognitionState.messageKind ? ` is-${recognitionState.messageKind}` : ''}`;
    recognitionRescan.disabled = recognitionState.busy;
    recognitionApply.disabled = recognitionState.busy || !recognitionState.result?.blobs?.length;
    recognitionStats.innerHTML = recognitionState.result
      ? recognitionStatsMarkup(recognitionState.result)
      : '<p class="level-image-hint">导入参考图后点击“重新识别”。识别使用垫图当前的位置、大小和旋转。</p>';
  }

  async function runRecognition() {
    if (recognitionState.busy) return;
    // A saved underlay decodes asynchronously; wait for it instead of reporting a
    // missing reference image while the editor is still loading it.
    if (!referenceLayerReady(referenceLayer) && referenceLayer.source) await restoreReferenceImage();
    if (!referenceLayerReady(referenceLayer)) {
      recognitionState.result = null;
      setRecognitionMessage(referenceLayer.source
        ? '参考图仍在加载，请稍后点击【重新识别】。'
        : '请先导入参考图（垫图），或在左侧选择一张图片。', 'error');
      syncRecognitionInputs();
      renderRecognitionDialog();
      return;
    }
    recognitionState.busy = true;
    setRecognitionMessage('正在识别…');
    renderRecognitionDialog();
    await new Promise((resolve) => setTimeout(resolve, 16));
    try {
      const imageData = readRecognitionImageData(referenceLayer.image);
      const mapping = referenceLayerMapping(referenceLayer, imageData.width, imageData.height);
      const result = recognizeLevelFromImage(imageData, mapping, recognitionSettings(recognitionState.options));
      recognitionState.result = result;
      const summary = result.summary;
      if (result.method === 'editor-overlay') {
        setRecognitionMessage(result.warning, 'error');
      } else if (!summary.total) {
        setRecognitionMessage('没有识别到车辆：可以提高颜色容差、调小最小车辆面积，或确认参考图已经完整显示在垫图里。', 'error');
      } else {
        setRecognitionMessage(`识别到 ${summary.total} 辆车（${summary.byColor.map((entry) => `${entry.label} ${entry.count}`).join('，')}），共 ${summary.rows} 行。确认后进行摆放。`, 'success');
      }
    } catch (error) {
      recognitionState.result = null;
      setRecognitionMessage(`识别失败：${error.message}`, 'error');
    } finally {
      recognitionState.busy = false;
      persistRecognitionOptions(recognitionState.options);
      renderRecognitionDialog();
      redrawCanvas();
    }
  }

  function openRecognition() {
    recognitionState.open = true;
    setRecognitionMessage('');
    syncRecognitionInputs();
    renderRecognitionDialog();
    void runRecognition();
  }

  function closeRecognition() {
    recognitionState.open = false;
    recognitionState.result = null;
    setRecognitionMessage('');
    renderRecognitionDialog();
    redrawCanvas();
  }

  function applyRecognition() {
    const vehicles = recognitionVehicles();
    if (!vehicles?.length) {
      setRecognitionMessage('没有可摆放的识别结果。', 'error');
      renderRecognitionDialog();
      return;
    }
    const mode = recognitionState.options.mode === 'append' ? 'append' : 'replace';
    const created = model.applyDetectedVehicles(vehicles, { mode });
    setStatus(`识图摆放：已${mode === 'append' ? '追加' : '替换'} ${created.length} 辆车，乘客队列和深度已同步`, 'success');
    closeRecognition();
    render();
  }

  function passengerKey(queueId, index) { return `${queueId}:${index}`; }  function selectedPassengerEntries() {
    const entries = [];
    model.document.passengerQueues.forEach((queue, queueId) => queue.forEach((color, index) => {
      if (passengerQueueState.selected.has(passengerKey(queueId, index))) entries.push({ queueId, index, color });
    }));
    return entries;
  }

  function renderPassengerQueueEditor() {
    passengerEditor.hidden = !passengerQueueState.open;
    if (!passengerQueueState.open) return;
    const selected = selectedPassengerEntries();
    const hasSelection = selected.length > 0;
    const { passengers, capacity } = passengerQueueStats(model.document);
    const colorIds = [...new Set([...passengers.keys(), ...capacity.keys()])].sort((a, b) => a - b);
    const hasMismatch = colorIds.some((id) => (passengers.get(id) ?? 0) !== (capacity.get(id) ?? 0));
    const currentColor = getVehicleColorOption(passengerQueueState.colorIndex);
    passengerEditor.querySelector('.passenger-queue-toolbar strong').textContent = `乘客队列 - ${model.document.key}`;
    const dirty = persistentDocumentSource(model.document) !== savedDocumentSource;
    const saveState = passengerEditor.querySelector('.passenger-queue-save-state');
    saveState.textContent = dirty ? '未保存修改' : '已保存';
    saveState.classList.toggle('is-dirty', dirty);
    passengerOperations.innerHTML = `<h3>乘客操作区</h3>
      <label class="passenger-queue-field"><span>颜色</span><span class="level-layout-color-select"><span class="level-layout-color-swatch" style="--swatch-color:${passengerColor(currentColor.id, model.document)}"></span><select data-passenger-field="colorIndex">${VEHICLE_PAINT_COLOR_OPTIONS.map((color) => `<option value="${color.id}" ${color.id === currentColor.id ? 'selected' : ''}>${color.id}: ${color.label}</option>`).join('')}</select></span></label>
      <label class="passenger-queue-field"><span>数量</span><input type="number" min="1" step="1" data-passenger-field="addCount" value="${passengerQueueState.addCount}"></label>
      <h4>加入位置</h4><div class="passenger-queue-modes">
        ${[['append','添加到队尾'],['before','插入到前面'],['after','插入到后面']].map(([mode, label]) => `<button type="button" data-passenger-mode="${mode}" class="${passengerQueueState.mode === mode ? 'is-active' : ''}">${label}</button>`).join('')}
      </div>
      <button type="button" class="is-primary" data-passenger-action="add">添加</button>
      <button type="button" data-passenger-action="replace" ${hasSelection ? '' : 'disabled'}>替换所选</button>
      <button type="button" data-passenger-action="copy" ${hasSelection ? '' : 'disabled'}>复制 (Ctrl+C)</button>
      <button type="button" data-passenger-action="paste" ${passengerQueueState.clipboard.length ? '' : 'disabled'}>粘贴 (Ctrl+V)</button>
      <button type="button" data-passenger-action="delete" ${hasSelection ? '' : 'disabled'}>删除 (Delete)</button>
      <button type="button" data-passenger-action="sort-by-depth" ${model.document.passengerQueues.flat().length ? '' : 'disabled'}>一键排序</button>
      <button type="button" data-passenger-action="repair" ${hasMismatch ? '' : 'disabled'}>一键修复</button>
      <div class="passenger-queue-initial"><h4>首次展示数量</h4><strong>${escapeHtml(model.document.conveyorBeltName)}</strong>${model.document.passengerQueues.map((queue, id) => `<span>队列 ${id}<b>${Math.min(DEFAULT_INITIAL_PASSENGER_COUNT, queue.length)}</b></span>`).join('')}</div>`;

    const maxFlowStart = Math.max(0, ...model.document.passengerQueues.map((queue) => queue.length - 1));
    passengerQueueState.flowStart = Math.min(passengerQueueState.flowStart, maxFlowStart);
    passengerCenter.innerHTML = `<section class="passenger-queue-list"><h3>队列编辑区</h3>${model.document.passengerQueues.map((queue, queueId) => `<article class="passenger-queue-row ${passengerQueueState.activeQueueId === queueId ? 'is-active' : ''}" data-passenger-queue="${queueId}"><header><strong>队列 ${queueId}</strong><span>总数: ${queue.length}　首次: ${Math.min(DEFAULT_INITIAL_PASSENGER_COUNT, queue.length)}</span></header><div class="passenger-queue-items" data-passenger-drop-queue="${queueId}">${queue.map((color, index) => { const isSelected = passengerQueueState.selected.has(passengerKey(queueId, index)); return `<button type="button" class="passenger-queue-item ${index < DEFAULT_INITIAL_PASSENGER_COUNT ? 'is-initial' : ''} ${isSelected ? 'is-selected' : ''}" style="--passenger-color:${passengerColor(color, model.document)}" data-passenger-queue-id="${queueId}" data-passenger-index="${index}" title="${passengerColorName(color)}"><small>${String(index + 1).padStart(2, '0')}</small><span>${color}</span></button>`; }).join('')}<button type="button" class="passenger-queue-drop-end" data-passenger-drop-queue="${queueId}" data-passenger-drop-index="${queue.length}" aria-label="添加到队列 ${queueId} 末尾">+</button></div></article>`).join('')}</section>
      <section class="passenger-flow-preview"><h3>Passenger Flow 预览区</h3><div class="passenger-flow-controls"><label>起始位置 <input type="range" min="0" max="${maxFlowStart}" value="${passengerQueueState.flowStart}" data-passenger-field="flowStart"></label><button type="button" data-passenger-action="toggle-flow" aria-label="播放或暂停预览">${passengerQueueState.flowTimer ? 'Ⅱ' : '▶'}</button><label>显示数量 <input type="number" min="1" value="${passengerQueueState.flowVisibleCount}" data-passenger-field="flowVisibleCount"></label></div>${model.document.passengerQueues.map((queue, queueId) => { const start = Math.min(passengerQueueState.flowStart, Math.max(0, queue.length - 1)); const end = Math.min(queue.length, start + passengerQueueState.flowVisibleCount); return `<div class="passenger-flow-row"><span>队列 ${queueId}: Passenger ${queue.length ? start + 1 : 0} - ${end}</span><div>${queue.slice(start, end).map((color) => `<i style="--passenger-color:${passengerColor(color, model.document)}" title="${passengerColorName(color)}"></i>`).join('')}</div></div>`; }).join('')}</section>`;

    const renderCounts = (title, counts) => `<section><h4>${title}</h4><strong>总数: ${countTotal(counts)}</strong>${[...counts.keys()].sort((a, b) => a - b).map((id) => `<button type="button" class="passenger-stat-row" data-passenger-select-color="${id}"><i style="--passenger-color:${passengerColor(id, model.document)}"></i><span>${passengerColorName(id)}</span><b>${counts.get(id)}</b></button>`).join('')}</section>`;
    const selectedCounts = new Map(); selected.forEach((entry) => incrementCount(selectedCounts, entry.color));
    passengerStats.innerHTML = `<h3>数据统计区</h3>${renderCounts('乘客统计', passengers)}${renderCounts('乘客容量', capacity)}<section><h4>匹配结果</h4><strong>总数: ${countTotal(passengers)} / ${countTotal(capacity)}</strong>${colorIds.map((id) => { const p = passengers.get(id) ?? 0; const c = capacity.get(id) ?? 0; const delta = p - c; return `<button type="button" class="passenger-stat-row ${delta === 0 ? 'is-valid' : delta > 0 ? 'is-extra' : 'is-missing'}" data-passenger-select-color="${id}"><i style="--passenger-color:${passengerColor(id, model.document)}"></i><span>${passengerColorName(id)}</span><b>(${p} / ${c}) ${delta === 0 ? '[✓] 正确' : delta > 0 ? `[+${delta}] 超出` : `[${delta}] 缺少`}</b></button>`; }).join('')}</section>${renderCounts('选中统计', selectedCounts)}`;
  }

  function stopPassengerFlow() {
    if (passengerQueueState.flowTimer) clearInterval(passengerQueueState.flowTimer);
    passengerQueueState.flowTimer = null;
  }

  function updatePassengerSelection(queueId, index, additive) {
    const key = passengerKey(queueId, index);
    if (!additive) passengerQueueState.selected.clear();
    if (additive && passengerQueueState.selected.has(key)) passengerQueueState.selected.delete(key);
    else passengerQueueState.selected.add(key);
    passengerQueueState.activeQueueId = queueId;
    renderPassengerQueueEditor();
  }

  function clearPassengerDropMarkers() {
    passengerEditor.querySelectorAll('.is-drop-before, .is-drop-after, .is-drop-target').forEach((element) => {
      element.classList.remove('is-drop-before', 'is-drop-after', 'is-drop-target');
    });
  }

  function passengerRectsOverlap(a, b) {
    return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
  }

  function updatePassengerBoxSelection(event) {
    const gesture = passengerSelectionGesture;
    if (!gesture) return;
    const dx = event.clientX - gesture.startX;
    const dy = event.clientY - gesture.startY;
    if (!gesture.active && Math.hypot(dx, dy) < 4) return;
    if (!gesture.active) {
      gesture.active = true;
      passengerEditor.classList.add(gesture.mode === 'move' ? 'is-moving-passengers' : 'is-box-selecting');
      passengerSelectionBox.hidden = gesture.mode !== 'select';
    }

    event.preventDefault();
    event.stopPropagation();
    if (gesture.mode === 'move') {
      clearPassengerDropMarkers();
      const target = document.elementFromPoint(event.clientX, event.clientY)?.closest('[data-passenger-index],[data-passenger-drop-queue]');
      if (!target || !passengerEditor.contains(target)) {
        gesture.targetQueueId = -1;
        gesture.targetIndex = -1;
        return;
      }
      gesture.targetQueueId = Number(target.dataset.passengerQueueId ?? target.dataset.passengerDropQueue);
      gesture.targetIndex = Number(target.dataset.passengerIndex ?? target.dataset.passengerDropIndex ?? model.document.passengerQueues[gesture.targetQueueId].length);
      if (target.dataset.passengerIndex != null) {
        const rect = target.getBoundingClientRect();
        const after = event.clientX > rect.left + rect.width * 0.5;
        if (after) gesture.targetIndex += 1;
        target.classList.add(after ? 'is-drop-after' : 'is-drop-before');
      } else {
        target.classList.add('is-drop-target');
      }
      return;
    }

    const selectionRect = {
      left: Math.min(gesture.startX, event.clientX),
      top: Math.min(gesture.startY, event.clientY),
      right: Math.max(gesture.startX, event.clientX),
      bottom: Math.max(gesture.startY, event.clientY)
    };
    const editorRect = passengerEditor.getBoundingClientRect();
    passengerSelectionBox.style.left = `${selectionRect.left - editorRect.left}px`;
    passengerSelectionBox.style.top = `${selectionRect.top - editorRect.top}px`;
    passengerSelectionBox.style.width = `${selectionRect.right - selectionRect.left}px`;
    passengerSelectionBox.style.height = `${selectionRect.bottom - selectionRect.top}px`;

    const nextSelection = gesture.additive ? gesture.selection : new Set();
    let activeQueueId = gesture.queueId;
    passengerEditor.querySelectorAll('.passenger-queue-item').forEach((item) => {
      const hit = passengerRectsOverlap(selectionRect, item.getBoundingClientRect());
      const key = passengerKey(Number(item.dataset.passengerQueueId), Number(item.dataset.passengerIndex));
      if (hit) {
        nextSelection.add(key);
        activeQueueId = Number(item.dataset.passengerQueueId);
      }
      item.classList.toggle('is-selected', nextSelection.has(key));
    });
    passengerQueueState.selected = nextSelection;
    passengerQueueState.activeQueueId = activeQueueId;
  }

  function finishPassengerBoxSelection(event) {
    const gesture = passengerSelectionGesture;
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    passengerSelectionGesture = null;
    if (!gesture.active) return;
    event.preventDefault();
    event.stopPropagation();
    suppressPassengerClickUntil = Date.now() + 100;
    passengerEditor.classList.remove('is-box-selecting');
    passengerEditor.classList.remove('is-moving-passengers');
    passengerSelectionBox.hidden = true;
    clearPassengerDropMarkers();
    if (gesture.mode === 'move' && gesture.targetQueueId >= 0 && gesture.targetIndex >= 0) {
      moveSelectedPassengers(gesture.targetQueueId, gesture.targetIndex);
    } else {
      renderPassengerQueueEditor();
    }
  }

  function cancelPassengerBoxSelection() {
    passengerSelectionGesture = null;
    passengerEditor.classList.remove('is-box-selecting');
    passengerEditor.classList.remove('is-moving-passengers');
    passengerSelectionBox.hidden = true;
    clearPassengerDropMarkers();
  }

  function insertPassengers(colors) {
    if (!colors.length) return;
    const queueId = Math.min(passengerQueueState.activeQueueId, model.document.passengerQueues.length - 1);
    const selected = selectedPassengerEntries().filter((entry) => entry.queueId === queueId);
    const primary = selected.length ? Math.min(...selected.map((entry) => entry.index)) : null;
    const queueLength = model.document.passengerQueues[queueId]?.length ?? 0;
    const index = passengerQueueState.mode === 'append' || primary == null ? queueLength : primary + (passengerQueueState.mode === 'after' ? 1 : 0);
    model.transact((doc) => doc.passengerQueues[queueId].splice(index, 0, ...colors));
    passengerQueueState.selected = new Set(colors.map((_, offset) => passengerKey(queueId, index + offset)));
    render();
  }

  function deleteSelectedPassengers() {
    const selected = selectedPassengerEntries();
    if (!selected.length) return;
    model.transact((doc) => [...selected].sort((a, b) => b.queueId - a.queueId || b.index - a.index).forEach(({ queueId, index }) => doc.passengerQueues[queueId].splice(index, 1)));
    passengerQueueState.selected.clear(); render();
  }

  function moveSelectedPassengers(targetQueueId, targetIndex) {
    const moving = selectedPassengerEntries();
    if (!moving.length || !model.document.passengerQueues[targetQueueId]) return;
    const colors = moving.map((entry) => entry.color);
    targetIndex -= moving.filter((entry) => entry.queueId === targetQueueId && entry.index < targetIndex).length;
    targetIndex = Math.max(0, Math.min(targetIndex, model.document.passengerQueues[targetQueueId].length));
    model.transact((doc) => {
      [...moving].sort((a, b) => b.queueId - a.queueId || b.index - a.index).forEach(({ queueId, index }) => doc.passengerQueues[queueId].splice(index, 1));
      doc.passengerQueues[targetQueueId].splice(targetIndex, 0, ...colors);
    });
    passengerQueueState.activeQueueId = targetQueueId;
    passengerQueueState.selected = new Set(colors.map((_, index) => passengerKey(targetQueueId, targetIndex + index)));
    render();
  }

  function repairPassengerQueues() {
    model.transact((doc) => {
      const { passengers, capacity } = passengerQueueStats(doc);
      const ids = [...new Set([...passengers.keys(), ...capacity.keys()])].sort((a, b) => a - b);
      ids.forEach((id) => {
        let delta = (passengers.get(id) ?? 0) - (capacity.get(id) ?? 0);
        for (let queueId = doc.passengerQueues.length - 1; queueId >= 0 && delta > 0; queueId -= 1) {
          const queue = doc.passengerQueues[queueId];
          for (let index = queue.length - 1; index >= 0 && delta > 0; index -= 1) if (queue[index] === id) { queue.splice(index, 1); delta -= 1; }
        }
        while (delta < 0) {
          const queue = doc.passengerQueues.reduce((best, current, index) => current.length < doc.passengerQueues[best].length ? index : best, 0);
          doc.passengerQueues[queue].push(id); delta += 1;
        }
      });
    });
    passengerQueueState.selected.clear(); render();
  }

  function setStatus(message, kind = '') {
    status.textContent = message;
    status.dataset.kind = kind;
  }

  async function save() {
    const validation = validateLevelDocument(model.document);
    if (!validation.valid) { setStatus(`保存前需修复 ${validation.errors.length} 个错误`, 'error'); render(); return false; }
    const response = await fetch(`/__level-authoring/${encodeURIComponent(model.document.key)}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ document: model.document, baseRevision: revision, createOnly })
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) { setStatus(payload.error || `保存失败 HTTP ${response.status}`, 'error'); return false; }
    revision = payload.revision; savedDocumentSource = persistentDocumentSource(model.document); createOnly = false;
    writeLevelEditorPreviewDocument(model.document, 'saved', revision);
    setStatus(`已保存并应用 ${payload.savedPath}`, 'success'); render();
    onPreview(model.snapshot());
    return true;
  }

  function showNewLevelDialog() {
    const currentNumber = Number(model.document.key.match(/^level(\d+)$/)?.[1] ?? model.document.unityId ?? 1);
    newLevelForm.elements.levelNumber.value = String(Math.max(1, currentNumber + 1));
    newLevelForm.elements.displayName.value = '';
    newLevelError.textContent = '';
    newLevelBackdrop.hidden = false;
    newLevelForm.elements.levelNumber.focus();
    newLevelForm.elements.levelNumber.select();
  }

  function hideNewLevelDialog() {
    newLevelBackdrop.hidden = true;
    newLevelError.textContent = '';
  }

  newLevelForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const number = Number(newLevelForm.elements.levelNumber.value);
    if (!Number.isSafeInteger(number) || number < 1) {
      newLevelError.textContent = '请输入大于 0 的整数关卡编号';
      return;
    }
    const displayName = newLevelForm.elements.displayName.value.trim();
    if (!displayName) {
      newLevelError.textContent = '请输入关卡名称';
      newLevelForm.elements.displayName.focus();
      return;
    }
    if (persistentDocumentSource(model.document) !== savedDocumentSource && !window.confirm('当前关卡有未保存修改，仍要新建关卡吗？')) return;
    const key = `level${number}`;
    newLevelError.textContent = '正在检查关卡编号和名称...';
    newLevelSubmit.disabled = true;
    try {
      const response = await fetch(`/__level-authoring-status/${encodeURIComponent(key)}?name=${encodeURIComponent(displayName)}`, { cache: 'no-store' });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || `HTTP ${response.status}`);
      if (!payload.available) {
        if (payload.reason === 'name') throw new Error(`关卡名称已被 ${payload.conflict?.key ?? '其他关卡'} 使用`);
        throw new Error(payload.reason === 'catalog' ? '该编号已被 Unity 关卡使用' : '该网页关卡文件已经存在');
      }
      const previousLevelKey = model.document.key;
      model = attachModelHistoryTracker(new LevelEditorModel(createLevelDocument({ key, unityId: number, displayName })));
      revision = null;
      savedDocumentSource = null;
      createOnly = true;
      camera.x = 0; camera.z = 0; camera.zoom = 1;
      if (referencePersistTimer) clearTimeout(referencePersistTimer);
      referencePersistTimer = null;
      writeReferenceLayerStorage(previousLevelKey);
      releaseReferenceImage();
      referenceLayer = readReferenceLayer(model.document.key);
      clearEditorHistory();
      void restoreReferenceImage();
      passengerQueueState.selected.clear();
      hideNewLevelDialog();
      setStatus(`已新建 ${key}，点击保存创建关卡文件`, 'success');
      render();
    } catch (error) {
      newLevelError.textContent = error.message;
    } finally {
      newLevelSubmit.disabled = false;
    }
  });

  async function runAction(action) {
    const selected = model.selected()[0];
    if (action === 'undo') await undoEditorAction();
    else if (action === 'redo') await redoEditorAction();
    else if (action === 'delete') model.removeSelected();
    else if (action === 'reset-vehicle-colors') model.resetSelectedVehicleColors();
    else if (action === 'align-horizontal') model.align('horizontal');
    else if (action === 'align-vertical') model.align('vertical');
    else if (action === 'align-line') model.align('line');
    else if (action === 'center') model.centerAll();
    else if (action === 'to-gate') model.convertSelectedToGateQueue();
    else if (action === 'rotate-left') model.rotateSelected(-15);
    else if (action === 'rotate-right') model.rotateSelected(15);
    else if (action === 'rebuild') { model.rebuildDepthGraph(); setStatus('深度关系已重算', 'success'); }
    else if (action === 'validate') {
      const result = validateLevelDocument(model.document);
      setStatus(result.valid ? `验证通过${result.warnings.length ? `，${result.warnings.length} 个提醒` : ''}` : result.errors.join('；'), result.valid ? 'success' : 'error');
    } else if (action === 'enter-container' && selected && !selected.seats) model.enterContainer(selected.id);
    else if (action === 'exit-container') model.exitActiveContainer();
    else if (action === 'refresh-gate') model.refreshActiveGateQueue();
    else if (action === 'elevator-upper') model.setElevatorEditingLayer(0);
    else if (action === 'elevator-lower') model.setElevatorEditingLayer(1);
    else if (action === 'center-elevator') model.centerActiveElevatorLayer();
    else if (action === 'locate') {
      const vehicle = model.document.vehicles.find((item) => item.id === Number(locateInput.value));
      if (vehicle) { camera.x = vehicle.x; camera.z = vehicle.z; model.select(`vehicle:${vehicle.id}`); setStatus(`已定位车辆 ${vehicle.id}`, 'success'); }
      else setStatus(`未找到车辆 ${locateInput.value}`, 'error');
    }
    render();
  }

  overlay.addEventListener('click', async (event) => {
    const add = event.target.closest('[data-add]')?.dataset.add;
    if (add) {
      const specialVehicle = {
        'vehicle-firetruck': { colorIndex: 12, mechanism: { type: 'firetruck' } },
        'vehicle-ambulance': { colorIndex: 13, mechanism: { type: 'ambulance' } },
        'vehicle-police': { colorIndex: 11, mechanism: { type: 'police' } }
      }[add];
      if (add === 'vehicle' || specialVehicle) {
        model.addVehicle({
          ...(model.activeContainerId === 0 ? { x: camera.x, z: camera.z } : {}),
          ...(specialVehicle ?? {})
        });
      }
      else {
        const container = model.addContainer({ garage: 2, conveyor: 3, gate: 4, elevator: 5 }[add], { x: camera.x, z: camera.z });
        model.enterContainer(container.id);
      }
      render(); return;
    }
    const action = event.target.closest('[data-action]')?.dataset.action;
    if (!action) return;
    if (action === 'new-level') { showNewLevelDialog(); return; }
    if (action === 'cancel-new-level') { hideNewLevelDialog(); return; }
    if (action === 'save') { await save(); return; }
    if (action === 'preview') { writeLevelEditorPreviewDocument(model.document, 'draft', revision); onPreview(model.snapshot()); return; }
    if (action === 'import-json') { jsonInput.click(); return; }
    if (action === 'import-reference-image') { referenceInput.click(); return; }
    if (action === 'clear-reference-image') { clearReferenceImage(); return; }
    if (action === 'recognize-image') { openRecognition(); return; }
    if (action === 'fit-reference-image') {
      const before = snapshotReferenceLayer(referenceLayer);
      fitReferenceLayerToView(referenceLayer, camera, canvas.getBoundingClientRect());
      if (referencePersistTimer) clearTimeout(referencePersistTimer);
      referencePersistTimer = null;
      recordReferenceHistory(before);
      writeReferenceLayerStorage();
      setStatus('垫图已适配当前画布', 'success');
      render();
      return;
    }
    if (action === 'export-json') { download(`${model.document.key}.json`, `${JSON.stringify(model.document, null, 2)}\n`, 'application/json'); return; }
    if (action === 'export-unity') { download(`${model.document.key}.asset`, exportUnityLevelAsset(model.document), 'text/plain;charset=utf-8'); return; }
    if (action === 'export-csv') { download(`${model.document.key}.csv`, `\ufeff${exportLevelCsv(model.document)}`, 'text/csv;charset=utf-8'); return; }
    if (action === 'export-excel') { download(`${model.document.key}.xls`, exportLevelExcelXml(model.document), 'application/vnd.ms-excel'); return; }
    if (action === 'open-passenger-queue') {
      passengerQueueState.open = true;
      passengerQueueState.activeQueueId = Math.min(passengerQueueState.activeQueueId, model.document.passengerQueues.length - 1);
      passengerQueueState.selected.clear();
      renderPassengerQueueEditor();
      return;
    }
    if (action === 'close') {
      if (persistentDocumentSource(model.document) !== savedDocumentSource && !window.confirm('有未保存的关卡修改，仍要关闭吗？')) return;
      stopPassengerFlow();
      recognitionState.open = false;
      recognitionState.result = null;
      if (referencePersistTimer) clearTimeout(referencePersistTimer);
      referencePersistTimer = null;
      writeReferenceLayerStorage();
      releaseReferenceImage();
      resizeObserver.disconnect();
      garageTexture.removeEventListener('load', redrawCanvas);
      conveyorTexture.removeEventListener('load', redrawCanvas);
      window.removeEventListener('keydown', handleShortcut, true);
      window.removeEventListener('keyup', handleShortcutKeyUp, true);
      window.removeEventListener('blur', resetAnchorRotation);
      window.removeEventListener('pointermove', updatePassengerBoxSelection, true);
      window.removeEventListener('pointerup', finishPassengerBoxSelection, true);
      window.removeEventListener('pointercancel', finishPassengerBoxSelection, true);
      overlay.remove(); onClose(); return;
    }
    await runAction(action);
  });

  passengerEditor.addEventListener('click', async (event) => {
    if (Date.now() < suppressPassengerClickUntil) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    const passenger = event.target.closest('[data-passenger-index]');
    if (passenger) {
      updatePassengerSelection(Number(passenger.dataset.passengerQueueId), Number(passenger.dataset.passengerIndex), event.shiftKey || event.ctrlKey || event.metaKey);
      return;
    }
    const mode = event.target.closest('[data-passenger-mode]')?.dataset.passengerMode;
    if (mode) { passengerQueueState.mode = mode; renderPassengerQueueEditor(); return; }
    const selectColor = event.target.closest('[data-passenger-select-color]')?.dataset.passengerSelectColor;
    if (selectColor != null) {
      passengerQueueState.selected.clear();
      model.document.passengerQueues.forEach((queue, queueId) => queue.forEach((color, index) => {
        if (color === Number(selectColor)) passengerQueueState.selected.add(passengerKey(queueId, index));
      }));
      renderPassengerQueueEditor(); return;
    }
    const queueRow = event.target.closest('[data-passenger-queue]');
    if (queueRow) { passengerQueueState.activeQueueId = Number(queueRow.dataset.passengerQueue); renderPassengerQueueEditor(); return; }
    const action = event.target.closest('[data-passenger-action]')?.dataset.passengerAction;
    if (!action) return;
    if (action === 'close') { stopPassengerFlow(); cancelPassengerBoxSelection(); passengerQueueState.open = false; passengerEditor.hidden = true; return; }
    if (action === 'save') { await save(); renderPassengerQueueEditor(); return; }
    if (action === 'add') { insertPassengers(Array(passengerQueueState.addCount).fill(passengerQueueState.colorIndex)); return; }
    if (action === 'replace') {
      const selected = selectedPassengerEntries();
      model.transact((doc) => selected.forEach(({ queueId, index }) => { doc.passengerQueues[queueId][index] = passengerQueueState.colorIndex; }));
      render(); return;
    }
    if (action === 'copy') { passengerQueueState.clipboard = selectedPassengerEntries().map((entry) => entry.color); renderPassengerQueueEditor(); return; }
    if (action === 'paste') { insertPassengers(passengerQueueState.clipboard); return; }
    if (action === 'delete') { deleteSelectedPassengers(); return; }
    if (action === 'sort-by-depth') {
      model.sortPassengerQueuesByDepth(DEFAULT_INITIAL_PASSENGER_COUNT);
      passengerQueueState.selected.clear();
      passengerQueueState.flowStart = 0;
      render();
      return;
    }
    if (action === 'repair') { repairPassengerQueues(); return; }
    if (action === 'toggle-flow') {
      if (passengerQueueState.flowTimer) stopPassengerFlow();
      else {
        passengerQueueState.flowStart = 0;
        passengerQueueState.flowTimer = setInterval(() => {
          const max = Math.max(0, ...model.document.passengerQueues.map((queue) => queue.length - 1));
          if (passengerQueueState.flowStart >= max) stopPassengerFlow();
          else passengerQueueState.flowStart += 1;
          renderPassengerQueueEditor();
        }, 180);
      }
      renderPassengerQueueEditor();
    }
  });

  passengerEditor.addEventListener('change', (event) => {
    const field = event.target.dataset.passengerField;
    if (!field) return;
    if (field === 'colorIndex') {
      const colorIndex = Number(event.target.value);
      if (VEHICLE_PAINT_COLOR_OPTIONS.some((color) => color.id === colorIndex)) passengerQueueState.colorIndex = colorIndex;
    }
    else if (field === 'addCount') passengerQueueState.addCount = Math.max(1, Math.round(Number(event.target.value) || 1));
    else if (field === 'flowStart') { stopPassengerFlow(); passengerQueueState.flowStart = Math.max(0, Math.round(Number(event.target.value) || 0)); }
    else if (field === 'flowVisibleCount') passengerQueueState.flowVisibleCount = Math.max(1, Math.round(Number(event.target.value) || 1));
    renderPassengerQueueEditor();
  });

  passengerEditor.addEventListener('pointerdown', (event) => {
    if (event.button !== 0 || !event.target.closest('.passenger-queue-list')) return;
    if (event.target.closest('.passenger-queue-drop-end')) return;
    const passenger = event.target.closest('[data-passenger-index]');
    const additive = event.shiftKey || event.ctrlKey || event.metaKey;
    const moveSelection = passenger && passengerQueueState.selected.has(passengerKey(Number(passenger.dataset.passengerQueueId), Number(passenger.dataset.passengerIndex))) && !additive;
    const queueRow = event.target.closest('[data-passenger-queue]');
    passengerSelectionGesture = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      queueId: Number(queueRow?.dataset.passengerQueue ?? passengerQueueState.activeQueueId),
      additive,
      mode: moveSelection ? 'move' : 'select',
      active: false,
      selection: new Set(additive ? passengerQueueState.selected : []),
      targetQueueId: -1,
      targetIndex: -1
    };
  });
  window.addEventListener('pointermove', updatePassengerBoxSelection, true);
  window.addEventListener('pointerup', finishPassengerBoxSelection, true);
  window.addEventListener('pointercancel', finishPassengerBoxSelection, true);

  jsonInput.addEventListener('change', async () => {
    const [file] = jsonInput.files ?? [];
    if (!file) return;
    try {
      const source = JSON.parse(await file.text());
      if (!source || typeof source !== 'object' || Array.isArray(source)
        || source.format !== 'bus-loop-web-level-v1') {
        throw new Error('只能导入关卡编辑器导出的 JSON 文件');
      }
      const normalized = retargetLevelDocument(source, {
        key: model.document.key,
        displayName: model.document.displayName,
        unityId: model.document.unityId
      });
      const validation = validateLevelDocument(normalized);
      if (!validation.valid) {
        throw new Error(`关卡数据无效：${validation.errors.slice(0, 3).join('；')}`);
      }
      model = attachModelHistoryTracker(new LevelEditorModel(normalized));
      clearEditorHistory();
      setStatus(`已导入 ${file.name}，内容已应用到 ${model.document.key}；点击保存后生效`, 'success');
      render();
    } catch (error) {
      setStatus(`导入失败：${error.message}`, 'error');
    } finally {
      jsonInput.value = '';
    }
  });

  referenceInput.addEventListener('change', async () => {
    const [file] = referenceInput.files ?? [];
    if (!file) return;
    try {
      await importReferenceImage(file);
    } catch (error) {
      setStatus(`垫图导入失败：${error.message}`, 'error');
    } finally {
      referenceInput.value = '';
    }
  });

  recognitionForm.addEventListener('submit', (event) => {
    event.preventDefault();
    applyRecognition();
  });

  recognitionForm.addEventListener('click', (event) => {
    const action = event.target.closest('[data-image-action]')?.dataset.imageAction;
    if (action === 'close') closeRecognition();
    else if (action === 'rescan') void runRecognition();
  });

  recognitionForm.addEventListener('input', (event) => {
    const input = event.target;
    if (input.type !== 'range') return;
    const output = input.parentElement.querySelector('output');
    if (output) output.textContent = input.value;
  });

  recognitionForm.addEventListener('change', async (event) => {
    const input = event.target;
    if (input.dataset.imageAction === 'pick-file') {
      const [file] = input.files ?? [];
      input.value = '';
      if (!file) return;
      try {
        await importReferenceImage(file);
        syncRecognitionInputs();
        await runRecognition();
      } catch (error) {
        setRecognitionMessage(`参考图导入失败：${error.message}`, 'error');
        renderRecognitionDialog();
      }
      return;
    }
    const field = input.dataset.imageField;
    if (!field) return;
    if (input.type === 'checkbox') recognitionState.options[field] = input.checked;
    else if (field === 'minArea') recognitionState.options[field] = input.value === '' ? null : Math.max(2, Math.round(Number(input.value)));
    else if (field === 'seats' || field === 'mode') recognitionState.options[field] = input.value;
    else recognitionState.options[field] = Number(input.value);
    persistRecognitionOptions(recognitionState.options);
    await runRecognition();
  });

  inspector.addEventListener('input', (event) => {
    const field = event.target.dataset.referenceField;
    if (!field) return;
    const value = event.target.type === 'checkbox' ? event.target.checked : event.target.value;
    updateReferenceField(field, value);
    if (field === 'opacity') {
      const output = event.target.closest('.level-layout-reference-opacity')?.querySelector('output');
      if (output) output.textContent = `${Math.round(referenceLayer.opacity * 100)}%`;
    }
    overlay.classList.toggle('is-reference-unlocked', referenceLayerReady(referenceLayer) && referenceLayer.visible && !referenceLayer.locked);
    redrawCanvas();
  });

  inspector.addEventListener('change', (event) => {
    const passengerRegion = event.target.dataset.passengerColorRegion;
    if (passengerRegion) {
      const color = event.target.value;
      if (model.selected().filter((item) => item.seats).length > 1) {
        model.setSelectedPassengerColorField(passengerRegion, color);
      } else {
        model.setPassengerColorOverride(Number(event.target.dataset.passengerColorIndex), passengerRegion, color);
      }
      render();
      return;
    }
    const queue = event.target.dataset.queue;
    if (queue != null) {
      const colors = event.target.value.split(/[\s,，]+/).filter(Boolean).map(Number).filter(Number.isFinite);
      model.setQueue(Number(queue), colors); render(); return;
    }
    const field = event.target.dataset.field;
    if (!field) return;
    let value = event.target.type === 'checkbox' ? event.target.checked : event.target.value;
    if (event.target.type === 'number' || ['colorIndex','seats','containerId','elevatorLayer','gateQueuePathShape','conveyorWidth','mechanism.pairVehicleId','mechanism.distance','mechanism.wrenchColor','mechanism.secondColorIndex','mechanism.stepLimit','mechanism.timeLimit'].includes(field)) value = Number(value);
    if (field.startsWith('document.')) {
      const path = field.slice('document.'.length).split('.'); const key = path.pop();
      model.transact((doc) => { const parent = path.reduce((target, part) => target[part], doc); parent[key] = value; });
    } else {
      if (field === 'containerId') {
        const container = model.document.containers.find((item) => item.id === value);
        model.setSelectedField('containerType', container?.type ?? 1);
      }
      model.setSelectedField(field, value);
      if (field === 'mechanism.type') model.setSelectedField('isHidden', value === 'hidden');
    }
    render();
  });

  canvas.addEventListener('contextmenu', (event) => event.preventDefault());
  canvas.addEventListener('pointerdown', (event) => {
    canvas.setPointerCapture(event.pointerId);
    const rect = canvas.getBoundingClientRect();
    const screen = { x: event.clientX - rect.left, y: event.clientY - rect.top };
    const world = screenToWorld(camera, rect, screen.x, screen.y);
    if (event.button === 1 || event.button === 2 || event.altKey) {
      gesture = { type: 'pan', startScreen: screen, camera: { ...camera } }; return;
    }
    if (hitReferenceLayer(referenceLayer, world)) {
      gesture = { type: 'reference-drag', startWorld: world, delta: { x: 0, z: 0 }, before: snapshotReferenceLayer(referenceLayer) };
      overlay.classList.add('is-reference-dragging');
      return;
    }
    const tangentHandle = hitGateTangentHandle(model.document, model.activeContainerId, model.selected(), world);
    if (tangentHandle) {
      gesture = { type: 'gate-tangent', gateId: tangentHandle.gate.id, vehicleId: tangentHandle.vehicle.id, side: tangentHandle.side, currentWorld: world };
      return;
    }
    const resizeHandle = hitElevatorResizeHandle(model.document, model.activeContainerId, world);
    if (resizeHandle) {
      gesture = { type: 'elevator-resize', elevatorId: resizeHandle.elevator.id, handleIndex: resizeHandle.index, currentWorld: world };
      return;
    }
    const hit = hitItem(model.document, world, model.activeContainerId);
    if (hit) {
      const key = itemKey(hit);
      if (!model.selection.has(key)) model.select(key, { add: event.shiftKey, toggle: event.shiftKey });
      gesture = { type: 'drag', startWorld: world, delta: { x: 0, z: 0 } };
    } else {
      if (!event.shiftKey) model.clearSelection();
      gesture = { type: 'box', startScreen: screen, currentScreen: screen, startWorld: world, currentWorld: world, add: event.shiftKey };
    }
    render();
  });
  canvas.addEventListener('pointermove', (event) => {
    if (!gesture) return;
    const rect = canvas.getBoundingClientRect();
    const screen = { x: event.clientX - rect.left, y: event.clientY - rect.top };
    const world = screenToWorld(camera, rect, screen.x, screen.y);
    if (gesture.type === 'pan') {
      const scale = WORLD_SCALE * camera.zoom;
      camera.x = gesture.camera.x - (screen.x - gesture.startScreen.x) / scale;
      camera.z = gesture.camera.z + (screen.y - gesture.startScreen.y) / scale;
    } else if (gesture.type === 'drag' || gesture.type === 'reference-drag') gesture.delta = { x: world.x - gesture.startWorld.x, z: world.z - gesture.startWorld.z };
    else if (gesture.type === 'gate-tangent' || gesture.type === 'elevator-resize') gesture.currentWorld = world;
    else { gesture.currentScreen = screen; gesture.currentWorld = world; }
    drawCanvas(canvas, model, camera, gesture, garageTexture, conveyorTexture, referenceLayer, recognitionPreview());
  });
  function finishCanvasGesture(event) {
    if (!gesture) return;
    const cancelled = event?.type === 'pointercancel';
    if (!cancelled && gesture.type === 'drag' && (Math.abs(gesture.delta.x) > 0.001 || Math.abs(gesture.delta.z) > 0.001)) model.moveSelected(gesture.delta.x, gesture.delta.z);
    if (!cancelled && gesture.type === 'reference-drag' && (Math.abs(gesture.delta.x) > 0.001 || Math.abs(gesture.delta.z) > 0.001)) {
      referenceLayer.x += gesture.delta.x;
      referenceLayer.z += gesture.delta.z;
      if (referencePersistTimer) clearTimeout(referencePersistTimer);
      referencePersistTimer = null;
      recordReferenceHistory(gesture.before);
      writeReferenceLayerStorage();
    }
    if (!cancelled && gesture.type === 'gate-tangent') model.setGateQueueTangentHandle(gesture.gateId, gesture.vehicleId, gesture.side, gesture.currentWorld);
    if (!cancelled && gesture.type === 'elevator-resize') model.resizeElevatorByHandle(gesture.elevatorId, gesture.handleIndex, gesture.currentWorld);
    if (!cancelled && gesture.type === 'box') {
      const minX = Math.min(gesture.startWorld.x, gesture.currentWorld.x); const maxX = Math.max(gesture.startWorld.x, gesture.currentWorld.x);
      const minZ = Math.min(gesture.startWorld.z, gesture.currentWorld.z); const maxZ = Math.max(gesture.startWorld.z, gesture.currentWorld.z);
      const keys = [...(gesture.add ? model.selection : [])];
      for (const item of [...visibleVehicles(model.document, model.activeContainerId), ...model.document.containers.filter((entry) => entry.type !== 1)]) if (item.x >= minX && item.x <= maxX && item.z >= minZ && item.z <= maxZ) keys.push(itemKey(item));
      model.selectMany(keys);
    }
    gesture = null;
    overlay.classList.remove('is-reference-dragging');
    render();
  }
  canvas.addEventListener('pointerup', finishCanvasGesture);
  canvas.addEventListener('pointercancel', finishCanvasGesture);
  canvas.addEventListener('dblclick', (event) => {
    const rect = canvas.getBoundingClientRect(); const point = screenToWorld(camera, rect, event.clientX - rect.left, event.clientY - rect.top);
    if (hitReferenceLayer(referenceLayer, point)) return;
    const hit = hitItem(model.document, point, model.activeContainerId);
    if (hit && !hit.seats) {
      if (model.activeContainerId === hit.id) model.exitActiveContainer();
      else model.enterContainer(hit.id);
      render();
    }
  });
  canvas.addEventListener('wheel', (event) => {
    event.preventDefault(); camera.zoom = Math.max(0.25, Math.min(5, camera.zoom * Math.exp(-event.deltaY * 0.001))); drawCanvas(canvas, model, camera, gesture, garageTexture, conveyorTexture, referenceLayer, recognitionPreview());
  }, { passive: false });

  async function handleShortcut(event) {
    if (!overlay.isConnected) return;
    if (!recognitionBackdrop.hidden) {
      if (event.key === 'Escape') {
        event.preventDefault(); event.stopPropagation(); closeRecognition();
      }
      return;
    }
    if (!newLevelBackdrop.hidden) {
      if (event.key === 'Escape') {
        event.preventDefault(); event.stopPropagation(); hideNewLevelDialog();
      }
      return;
    }
    if (passengerQueueState.open) {
      const command = event.ctrlKey || event.metaKey;
      if (event.key === 'Escape') {
        event.preventDefault(); event.stopPropagation(); stopPassengerFlow(); cancelPassengerBoxSelection(); passengerQueueState.open = false; passengerEditor.hidden = true; return;
      }
      if (event.target?.closest?.('input, textarea, select')) return;
      if (command && event.key.toLowerCase() === 's') { event.preventDefault(); event.stopPropagation(); await save(); renderPassengerQueueEditor(); }
      else if (command && event.key.toLowerCase() === 'a') {
        event.preventDefault(); event.stopPropagation(); passengerQueueState.selected.clear();
        model.document.passengerQueues.forEach((queue, queueId) => queue.forEach((_, index) => passengerQueueState.selected.add(passengerKey(queueId, index))));
        renderPassengerQueueEditor();
      }
      else if (command && event.key.toLowerCase() === 'c') { event.preventDefault(); event.stopPropagation(); passengerQueueState.clipboard = selectedPassengerEntries().map((entry) => entry.color); renderPassengerQueueEditor(); }
      else if (command && event.key.toLowerCase() === 'v') { event.preventDefault(); event.stopPropagation(); insertPassengers(passengerQueueState.clipboard); }
      else if (command && event.key.toLowerCase() === 'z') { event.preventDefault(); event.stopPropagation(); await runAction(event.shiftKey ? 'redo' : 'undo'); passengerQueueState.selected.clear(); render(); }
      else if (command && event.key.toLowerCase() === 'y') { event.preventDefault(); event.stopPropagation(); await runAction('redo'); passengerQueueState.selected.clear(); render(); }
      else if (event.key === 'Delete' || event.key === 'Backspace') { event.preventDefault(); event.stopPropagation(); deleteSelectedPassengers(); }
      return;
    }
    if (event.key === 'Escape' && model.activeContainerId !== 0) {
      event.preventDefault(); event.stopPropagation(); model.exitActiveContainer(); render(); return;
    }
    if (event.target?.closest?.('input, textarea, select')) return;
    if (event.code === 'AltLeft' || event.code === 'AltRight') {
      event.preventDefault();
      event.stopPropagation();
      if (!altPressed) anchorRotationCenter = model.selectionCenter();
      altPressed = true;
      return;
    }
    const command = event.ctrlKey || event.metaKey;
    if (command && event.key.toLowerCase() === 's') { event.preventDefault(); await save(); }
    else if (command && event.key.toLowerCase() === 'z') { event.preventDefault(); await runAction(event.shiftKey ? 'redo' : 'undo'); }
    else if (command && event.key.toLowerCase() === 'y') { event.preventDefault(); await runAction('redo'); }
    else if (command && event.key.toLowerCase() === 'c') model.copy();
    else if (command && event.key.toLowerCase() === 'x') { model.cut(); render(); }
    else if (command && event.key.toLowerCase() === 'v') { model.paste(); render(); }
    else if (command && event.key.toLowerCase() === 'd') { event.preventDefault(); model.duplicate(); render(); }
    else if (command && event.key.toLowerCase() === 'm') { event.preventDefault(); model.mirror(event.shiftKey ? 'z' : 'x'); render(); }
    else if (event.key === 'Delete' || event.key === 'Backspace') { event.preventDefault(); model.removeSelected(); render(); }
    else if (event.key === ' ') { event.preventDefault(); Object.assign(camera, { x: 0, z: 0, zoom: 1 }); render(); }
    else if (event.code === 'KeyQ' || event.code === 'KeyE') {
      event.preventDefault();
      event.stopPropagation();
      const angle = event.code === 'KeyQ' ? -15 : 15;
      const rotateAroundAnchor = event.altKey || altPressed;
      if (rotateAroundAnchor && !anchorRotationCenter) anchorRotationCenter = model.selectionCenter();
      rotateAroundAnchor
        ? model.rotateSelectedAroundCenter(angle, anchorRotationCenter)
        : model.rotateSelected(angle);
      render();
    }
    else if (event.key.toLowerCase() === 'g') { model.transact((doc) => { doc.editor.gridSnap = !doc.editor.gridSnap; }); render(); }
    else if (event.key.toLowerCase() === 's') { model.transact((doc) => { doc.editor.vehicleSnap = !doc.editor.vehicleSnap; }); render(); }
    else if (event.key.toLowerCase() === 'a') { model.transact((doc) => { doc.editor.alignmentGuides = !doc.editor.alignmentGuides; }); render(); }
  }

  function handleShortcutKeyUp(event) {
    if (event.code !== 'AltLeft' && event.code !== 'AltRight') return;
    event.preventDefault();
    event.stopPropagation();
    resetAnchorRotation();
  }

  function resetAnchorRotation() {
    altPressed = false;
    anchorRotationCenter = null;
  }

  window.addEventListener('keydown', handleShortcut, true);
  window.addEventListener('keyup', handleShortcutKeyUp, true);
  window.addEventListener('blur', resetAnchorRotation);

  overlay.tabIndex = -1;
  overlay.focus();
  render();
  void restoreReferenceImage();
  return { element: overlay, model, save, close: () => overlay.querySelector('[data-action="close"]').click() };
}
