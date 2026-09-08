import {
  CONTAINER_TYPES,
  GARAGE_PARK_POS,
  GARAGE_SIZE,
  GATE_TANGENT_HANDLE_RADIUS,
  LevelEditorModel,
  VEHICLE_COLOR_OPTIONS,
  VEHICLE_COLORS,
  createLevelDocument,
  exportLevelCsv,
  exportLevelExcelXml,
  exportUnityLevelAsset,
  getElevatorStats,
  getGateQueueBounds,
  getGateQueuePath,
  getGateQueueTangentHandles,
  validateLevelDocument
} from './level-editor-model.js';
import './level-layout-editor.css';

const TYPE_NAMES = Object.freeze({
  1: '停车区', 2: '车库', 3: '运输带', 4: '闸门队列', 5: '升降舱'
});
const MECHANISM_NAMES = Object.freeze({
  normal: '普通车辆', hidden: '隐藏车辆', combination: '双色组合',
  linkHead: '联动车头', linkTail: '联动车尾', wrench: '扳手车', gear: '齿轮车',
  ambulance: '救护车', firetruck: '消防车'
});
const WORLD_SCALE = 78;
const GARAGE_TEXTURE_URL = '/assets/unity/mechanisms/garage/textures/garage-2d.png';
const CONVEYOR_TEXTURE_URL = '/assets/unity/level-editor/conveyor-belt-2d.png';
const PASSENGER_QUEUE_COLORS = Object.freeze([
  '#4073F2', '#2EA640', '#F259A6', '#8C47D9', '#F0291F', '#FAAB1F',
  '#F2701A', '#40BFF2', '#754729', '#0D6B38', '#142E80', '#26262E',
  '#F22E14', '#F2F2F2', '#FADB2E', '#D1A861'
]);
const DEFAULT_INITIAL_PASSENGER_COUNT = 8;

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

function vehicleColorField(label, path, value, options = VEHICLE_COLOR_OPTIONS) {
  const current = options.find((color) => color.id === Number(value)) ?? options[0];
  return `<label class="level-layout-field"><span>${label}</span><span class="level-layout-color-select"><span class="level-layout-color-swatch" style="--swatch-color:${current.css}" aria-hidden="true"></span><select data-field="${path}">${options.map((color) => `<option value="${color.id}" ${color.id === Number(value) ? 'selected' : ''}>${color.id}: ${color.name} / ${color.label}</option>`).join('')}</select></span></label>`;
}

function invertHexColor(color) {
  const value = Number.parseInt(color.slice(1), 16);
  return `#${(0xFFFFFF ^ value).toString(16).padStart(6, '0')}`;
}

function passengerColor(colorIndex) {
  return PASSENGER_QUEUE_COLORS[colorIndex] ?? '#64748b';
}

function passengerColorName(colorIndex) {
  const color = VEHICLE_COLOR_OPTIONS[colorIndex];
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
  context.font = '700 9px "Poppins Branding"';
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

function drawCanvas(canvas, model, camera, gesture, garageTexture, conveyorTexture) {
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
      context.font = '700 10px "Poppins Branding"'; context.textAlign = 'center'; context.textBaseline = 'middle';
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
      context.fillStyle = '#263b48'; context.font = '600 11px "Poppins Branding"'; context.textAlign = 'center'; context.textBaseline = 'middle';
      context.fillText(`${TYPE_NAMES[container.type]} #${container.id}`, 0, 0);
    }
    context.restore();
  }

  for (const vehicle of visibleVehicles(model.document, model.activeContainerId)) {
    const selected = model.selection.has(`vehicle:${vehicle.id}`);
    const moving = selected ? offset : { x: 0, z: 0 };
    const screen = worldToScreen(camera, rect, vehicle.x + moving.x, vehicle.z + moving.z);
    const size = vehicleDimensions(vehicle);
    context.save();
    context.translate(screen.x, screen.y); context.rotate(vehicle.yaw * Math.PI / 180);
    const vehicleColor = VEHICLE_COLORS[vehicle.colorIndex] ?? '#64748b';
    const inverseColor = vehicle.isHidden ? '#ffffff' : invertHexColor(vehicleColor);
    context.fillStyle = vehicleColor;
    context.globalAlpha = vehicle.isHidden ? 0.42 : 1;
    context.strokeStyle = selected ? '#071a25' : 'rgba(7, 26, 37, .55)'; context.lineWidth = selected ? 3 : 1;
    context.fillRect(-size.width * scale / 2, -size.length * scale / 2, size.width * scale, size.length * scale);
    context.strokeRect(-size.width * scale / 2, -size.length * scale / 2, size.width * scale, size.length * scale);
    context.globalAlpha = 1; context.fillStyle = inverseColor; drawArrow(context, size.length * scale);
    context.fillStyle = inverseColor; context.font = '700 10px "Poppins Branding"'; context.textAlign = 'center'; context.textBaseline = 'middle';
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
}

function renderInspector(root, model) {
  let selected = model.selected();
  const activeContainer = model.activeContainerId === 0
    ? null
    : model.document.containers.find((item) => item.id === model.activeContainerId);
  if (selected.length !== 1 && activeContainer) {
    model.select(`container:${activeContainer.id}`);
    selected = [activeContainer];
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
    root.innerHTML = `<h3>车辆 #${item.id}</h3>
      ${numberField('X', 'x', item.x)}${numberField('Z', 'z', item.z)}${numberField('旋转', 'yaw', item.yaw, { min: 0, max: 360, step: 1 })}
      ${vehicleColorField('颜色', 'colorIndex', item.colorIndex)}
      ${selectField('座位', 'seats', item.seats, [[4, '4 座'], [6, '6 座'], [10, '10 座']])}
      ${selectField('机制', 'mechanism.type', item.mechanism.type, Object.entries(MECHANISM_NAMES))}
      ${toggleField('隐藏', 'isHidden', item.isHidden)}${toggleField('转向车', 'isTurnVehicle', item.isTurnVehicle)}
      ${selectField('容器', 'containerId', item.containerId, model.document.containers.map((container) => [container.id, `${TYPE_NAMES[container.type]} #${container.id}`]))}
      ${item.containerType === CONTAINER_TYPES.ELEVATOR ? selectField('升降层', 'elevatorLayer', item.elevatorLayer, [[0, '上层'], [1, '下层']]) : ''}
      ${['linkHead', 'linkTail', 'wrench', 'gear'].includes(item.mechanism.type) ? numberField('关联车辆', 'mechanism.pairVehicleId', item.mechanism.pairVehicleId ?? 0, { min: 1, step: 1 }) : ''}
      ${['linkHead', 'linkTail'].includes(item.mechanism.type) ? numberField('连接距离', 'mechanism.distance', item.mechanism.distance, { min: 0.15, max: 0.5, step: 0.01 }) : ''}
      ${['wrench', 'gear'].includes(item.mechanism.type) ? selectField('扳手颜色', 'mechanism.wrenchColor', item.mechanism.wrenchColor, [[0,'粉'],[1,'蓝'],[2,'紫'],[3,'绿'],[4,'黄']]) : ''}
      ${item.mechanism.type === 'combination' ? vehicleColorField('组合颜色', 'mechanism.secondColorIndex', item.mechanism.secondColorIndex, VEHICLE_COLOR_OPTIONS.slice(0, 11)) : ''}
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

export async function createLevelLayoutEditor({ baseLevel, onClose = () => {}, onPreview = () => {} }) {
  const loaded = await loadSavedDocument(baseLevel);
  let model = new LevelEditorModel(loaded.document);
  let revision = loaded.revision;
  let savedDocumentSource = persistentDocumentSource(model.document);
  let createOnly = false;
  const camera = { x: 0, z: 0, zoom: 1 };
  let gesture = null;
  let altPressed = false;
  let anchorRotationCenter = null;
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
      <button type="button" data-action="undo" title="撤销" aria-label="撤销">↶</button><button type="button" data-action="redo" title="重做" aria-label="重做">↷</button>
      <button type="button" data-action="new-level">新建关卡</button><button type="button" data-action="rebuild">重算深度</button><button type="button" data-action="validate">验证</button><button type="button" data-action="save">保存</button><button type="button" data-action="preview">试玩</button>
      <button type="button" data-action="import-json">导入 JSON</button><button type="button" data-action="export-json">JSON</button><button type="button" data-action="export-unity">Unity</button><button type="button" data-action="export-csv">CSV</button><button type="button" data-action="export-excel">Excel</button>
    </div>
    <div class="level-layout-toolbar-group"><button type="button" data-action="close" aria-label="关闭">×</button></div>
  </header>
  <div class="level-layout-body">
    <aside class="level-layout-palette"><h3>添加元素</h3><button data-add="vehicle">添加车辆</button><h3>地图机制</h3><button data-add="garage">添加车库</button><button data-add="conveyor">添加运输带</button><button data-add="gate">添加闸门</button><button data-add="elevator">添加升降舱</button><h3>排列</h3><button data-action="align-horizontal">水平等距</button><button data-action="align-vertical">垂直等距</button><button data-action="align-line">连线等距</button><button data-action="center">全部居中</button><button data-action="to-gate">转为闸门队列</button><h3>定位</h3><label class="level-layout-locate"><input type="number" min="1" placeholder="车辆 ID"><button data-action="locate">定位</button></label></aside>
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
  <input class="level-layout-json-input" type="file" accept=".json,application/json" hidden>`;
  document.body.append(overlay);
  const canvas = overlay.querySelector('canvas');
  const toolbarTitle = overlay.querySelector('.level-layout-toolbar > strong');
  const inspector = overlay.querySelector('.level-layout-inspector');
  const status = overlay.querySelector('.level-layout-status');
  const breadcrumb = overlay.querySelector('.level-layout-breadcrumb');
  const jsonInput = overlay.querySelector('.level-layout-json-input');
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
  const redrawCanvas = () => drawCanvas(canvas, model, camera, gesture, garageTexture, conveyorTexture);
  garageTexture.addEventListener('load', redrawCanvas);
  conveyorTexture.addEventListener('load', redrawCanvas);

  function render() {
    toolbarTitle.textContent = `${model.document.key} 关卡编辑器`;
    drawCanvas(canvas, model, camera, gesture, garageTexture, conveyorTexture);
    renderInspector(inspector, model);
    const activeContainer = model.document.containers.find((item) => item.id === model.activeContainerId);
    const isEditingContainer = model.activeContainerId !== 0 && Boolean(activeContainer);
    breadcrumb.hidden = !isEditingContainer;
    breadcrumb.textContent = isEditingContainer ? `← 返回关卡 · ${TYPE_NAMES[activeContainer.type]} #${activeContainer.id}` : '返回关卡';
    overlay.classList.toggle('is-dirty', persistentDocumentSource(model.document) !== savedDocumentSource);
    if (passengerQueueState.open) renderPassengerQueueEditor();
  }

  function passengerKey(queueId, index) { return `${queueId}:${index}`; }

  function selectedPassengerEntries() {
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
    const currentColor = VEHICLE_COLOR_OPTIONS[passengerQueueState.colorIndex] ?? VEHICLE_COLOR_OPTIONS[0];
    passengerEditor.querySelector('.passenger-queue-toolbar strong').textContent = `乘客队列 - ${model.document.key}`;
    const dirty = persistentDocumentSource(model.document) !== savedDocumentSource;
    const saveState = passengerEditor.querySelector('.passenger-queue-save-state');
    saveState.textContent = dirty ? '未保存修改' : '已保存';
    saveState.classList.toggle('is-dirty', dirty);
    passengerOperations.innerHTML = `<h3>乘客操作区</h3>
      <label class="passenger-queue-field"><span>颜色</span><span class="level-layout-color-select"><span class="level-layout-color-swatch" style="--swatch-color:${passengerColor(currentColor.id)}"></span><select data-passenger-field="colorIndex">${VEHICLE_COLOR_OPTIONS.map((color) => `<option value="${color.id}" ${color.id === currentColor.id ? 'selected' : ''}>${color.id}: ${color.label}</option>`).join('')}</select></span></label>
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
    passengerCenter.innerHTML = `<section class="passenger-queue-list"><h3>队列编辑区</h3>${model.document.passengerQueues.map((queue, queueId) => `<article class="passenger-queue-row ${passengerQueueState.activeQueueId === queueId ? 'is-active' : ''}" data-passenger-queue="${queueId}"><header><strong>队列 ${queueId}</strong><span>总数: ${queue.length}　首次: ${Math.min(DEFAULT_INITIAL_PASSENGER_COUNT, queue.length)}</span></header><div class="passenger-queue-items" data-passenger-drop-queue="${queueId}">${queue.map((color, index) => { const isSelected = passengerQueueState.selected.has(passengerKey(queueId, index)); return `<button type="button" class="passenger-queue-item ${index < DEFAULT_INITIAL_PASSENGER_COUNT ? 'is-initial' : ''} ${isSelected ? 'is-selected' : ''}" style="--passenger-color:${passengerColor(color)}" data-passenger-queue-id="${queueId}" data-passenger-index="${index}" title="${passengerColorName(color)}"><small>${String(index + 1).padStart(2, '0')}</small><span>${color}</span></button>`; }).join('')}<button type="button" class="passenger-queue-drop-end" data-passenger-drop-queue="${queueId}" data-passenger-drop-index="${queue.length}" aria-label="添加到队列 ${queueId} 末尾">+</button></div></article>`).join('')}</section>
      <section class="passenger-flow-preview"><h3>Passenger Flow 预览区</h3><div class="passenger-flow-controls"><label>起始位置 <input type="range" min="0" max="${maxFlowStart}" value="${passengerQueueState.flowStart}" data-passenger-field="flowStart"></label><button type="button" data-passenger-action="toggle-flow" aria-label="播放或暂停预览">${passengerQueueState.flowTimer ? 'Ⅱ' : '▶'}</button><label>显示数量 <input type="number" min="1" value="${passengerQueueState.flowVisibleCount}" data-passenger-field="flowVisibleCount"></label></div>${model.document.passengerQueues.map((queue, queueId) => { const start = Math.min(passengerQueueState.flowStart, Math.max(0, queue.length - 1)); const end = Math.min(queue.length, start + passengerQueueState.flowVisibleCount); return `<div class="passenger-flow-row"><span>队列 ${queueId}: Passenger ${queue.length ? start + 1 : 0} - ${end}</span><div>${queue.slice(start, end).map((color) => `<i style="--passenger-color:${passengerColor(color)}" title="${passengerColorName(color)}"></i>`).join('')}</div></div>`; }).join('')}</section>`;

    const renderCounts = (title, counts) => `<section><h4>${title}</h4><strong>总数: ${countTotal(counts)}</strong>${[...counts.keys()].sort((a, b) => a - b).map((id) => `<button type="button" class="passenger-stat-row" data-passenger-select-color="${id}"><i style="--passenger-color:${passengerColor(id)}"></i><span>${passengerColorName(id)}</span><b>${counts.get(id)}</b></button>`).join('')}</section>`;
    const selectedCounts = new Map(); selected.forEach((entry) => incrementCount(selectedCounts, entry.color));
    passengerStats.innerHTML = `<h3>数据统计区</h3>${renderCounts('乘客统计', passengers)}${renderCounts('乘客容量', capacity)}<section><h4>匹配结果</h4><strong>总数: ${countTotal(passengers)} / ${countTotal(capacity)}</strong>${colorIds.map((id) => { const p = passengers.get(id) ?? 0; const c = capacity.get(id) ?? 0; const delta = p - c; return `<button type="button" class="passenger-stat-row ${delta === 0 ? 'is-valid' : delta > 0 ? 'is-extra' : 'is-missing'}" data-passenger-select-color="${id}"><i style="--passenger-color:${passengerColor(id)}"></i><span>${passengerColorName(id)}</span><b>(${p} / ${c}) ${delta === 0 ? '[✓] 正确' : delta > 0 ? `[+${delta}] 超出` : `[${delta}] 缺少`}</b></button>`; }).join('')}</section>${renderCounts('选中统计', selectedCounts)}`;
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
    localStorage.setItem('bus-loop-level-editor-preview-v1', JSON.stringify(model.document));
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
      model = new LevelEditorModel(createLevelDocument({ key, unityId: number, displayName }));
      revision = null;
      savedDocumentSource = null;
      createOnly = true;
      camera.x = 0; camera.z = 0; camera.zoom = 1;
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

  function runAction(action) {
    const selected = model.selected()[0];
    if (action === 'undo') model.undo();
    else if (action === 'redo') model.redo();
    else if (action === 'delete') model.removeSelected();
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
      if (add === 'vehicle') model.addVehicle(model.activeContainerId === 0 ? { x: camera.x, z: camera.z } : {});
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
    if (action === 'preview') { localStorage.setItem('bus-loop-level-editor-preview-v1', JSON.stringify(model.document)); onPreview(model.snapshot()); return; }
    if (action === 'import-json') { jsonInput.click(); return; }
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
      resizeObserver.disconnect();
      window.removeEventListener('keydown', handleShortcut, true);
      window.removeEventListener('keyup', handleShortcutKeyUp, true);
      window.removeEventListener('blur', resetAnchorRotation);
      window.removeEventListener('pointermove', updatePassengerBoxSelection, true);
      window.removeEventListener('pointerup', finishPassengerBoxSelection, true);
      window.removeEventListener('pointercancel', finishPassengerBoxSelection, true);
      overlay.remove(); onClose(); return;
    }
    runAction(action);
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
    if (field === 'colorIndex') passengerQueueState.colorIndex = Math.max(0, Math.min(15, Number(event.target.value)));
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
      const normalized = createLevelDocument(JSON.parse(await file.text()));
      if (normalized.key !== model.document.key) throw new Error(`只能导入 ${model.document.key} 的编辑文档`);
      model = new LevelEditorModel(normalized);
      revision = null;
      savedDocumentSource = null;
      createOnly = false;
      setStatus(`已导入 ${file.name}`, 'success');
      render();
    } catch (error) {
      setStatus(`导入失败：${error.message}`, 'error');
    } finally {
      jsonInput.value = '';
    }
  });

  inspector.addEventListener('change', (event) => {
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
    } else if (gesture.type === 'drag') gesture.delta = { x: world.x - gesture.startWorld.x, z: world.z - gesture.startWorld.z };
    else if (gesture.type === 'gate-tangent' || gesture.type === 'elevator-resize') gesture.currentWorld = world;
    else { gesture.currentScreen = screen; gesture.currentWorld = world; }
    drawCanvas(canvas, model, camera, gesture, garageTexture, conveyorTexture);
  });
  canvas.addEventListener('pointerup', () => {
    if (!gesture) return;
    if (gesture.type === 'drag' && (Math.abs(gesture.delta.x) > 0.001 || Math.abs(gesture.delta.z) > 0.001)) model.moveSelected(gesture.delta.x, gesture.delta.z);
    if (gesture.type === 'gate-tangent') model.setGateQueueTangentHandle(gesture.gateId, gesture.vehicleId, gesture.side, gesture.currentWorld);
    if (gesture.type === 'elevator-resize') model.resizeElevatorByHandle(gesture.elevatorId, gesture.handleIndex, gesture.currentWorld);
    if (gesture.type === 'box') {
      const minX = Math.min(gesture.startWorld.x, gesture.currentWorld.x); const maxX = Math.max(gesture.startWorld.x, gesture.currentWorld.x);
      const minZ = Math.min(gesture.startWorld.z, gesture.currentWorld.z); const maxZ = Math.max(gesture.startWorld.z, gesture.currentWorld.z);
      const keys = [...(gesture.add ? model.selection : [])];
      for (const item of [...visibleVehicles(model.document, model.activeContainerId), ...model.document.containers.filter((entry) => entry.type !== 1)]) if (item.x >= minX && item.x <= maxX && item.z >= minZ && item.z <= maxZ) keys.push(itemKey(item));
      model.selectMany(keys);
    }
    gesture = null; render();
  });
  canvas.addEventListener('dblclick', (event) => {
    const rect = canvas.getBoundingClientRect(); const point = screenToWorld(camera, rect, event.clientX - rect.left, event.clientY - rect.top);
    const hit = hitItem(model.document, point, model.activeContainerId);
    if (hit && !hit.seats) {
      if (model.activeContainerId === hit.id) model.exitActiveContainer();
      else model.enterContainer(hit.id);
      render();
    }
  });
  canvas.addEventListener('wheel', (event) => {
    event.preventDefault(); camera.zoom = Math.max(0.25, Math.min(5, camera.zoom * Math.exp(-event.deltaY * 0.001))); drawCanvas(canvas, model, camera, gesture, garageTexture);
  }, { passive: false });

  async function handleShortcut(event) {
    if (!overlay.isConnected) return;
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
      else if (command && event.key.toLowerCase() === 'z') { event.preventDefault(); event.stopPropagation(); event.shiftKey ? model.redo() : model.undo(); passengerQueueState.selected.clear(); render(); }
      else if (command && event.key.toLowerCase() === 'y') { event.preventDefault(); event.stopPropagation(); model.redo(); passengerQueueState.selected.clear(); render(); }
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
    else if (command && event.key.toLowerCase() === 'z') { event.preventDefault(); event.shiftKey ? model.redo() : model.undo(); render(); }
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
  return { element: overlay, model, save, close: () => overlay.querySelector('[data-action="close"]').click() };
}
