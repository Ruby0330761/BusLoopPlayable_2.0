import {
  CONTAINER_TYPES,
  LevelEditorModel,
  VEHICLE_COLORS,
  createLevelDocument,
  exportLevelCsv,
  exportLevelExcelXml,
  exportUnityLevelAsset,
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

function hitItem(document, point) {
  const items = [...document.containers.filter((item) => item.type !== 1), ...document.vehicles];
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

function drawArrow(context, length) {
  context.beginPath();
  context.moveTo(0, -length * 0.42);
  context.lineTo(-0.055, -length * 0.24);
  context.lineTo(0.055, -length * 0.24);
  context.closePath();
  context.fill();
}

function drawCanvas(canvas, model, camera, gesture) {
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
    context.save();
    context.translate(screen.x, screen.y); context.rotate(container.yaw * Math.PI / 180);
    context.fillStyle = selected ? 'rgba(8, 145, 178, .24)' : 'rgba(70, 90, 105, .13)';
    context.strokeStyle = selected ? '#0891b2' : '#637786'; context.lineWidth = selected ? 2 : 1;
    context.fillRect(-container.width * scale / 2, -container.length * scale / 2, container.width * scale, container.length * scale);
    context.strokeRect(-container.width * scale / 2, -container.length * scale / 2, container.width * scale, container.length * scale);
    context.fillStyle = '#263b48'; context.font = '600 11px Inter, sans-serif'; context.textAlign = 'center'; context.textBaseline = 'middle';
    context.fillText(`${TYPE_NAMES[container.type]} #${container.id}`, 0, 0);
    context.restore();
  }

  for (const vehicle of model.document.vehicles) {
    if (model.activeContainerId !== 0 && vehicle.containerId !== model.activeContainerId) continue;
    const selected = model.selection.has(`vehicle:${vehicle.id}`);
    const moving = selected ? offset : { x: 0, z: 0 };
    const screen = worldToScreen(camera, rect, vehicle.x + moving.x, vehicle.z + moving.z);
    const size = vehicleDimensions(vehicle);
    context.save();
    context.translate(screen.x, screen.y); context.rotate(vehicle.yaw * Math.PI / 180);
    context.fillStyle = VEHICLE_COLORS[vehicle.colorIndex % VEHICLE_COLORS.length];
    context.globalAlpha = vehicle.isHidden ? 0.42 : 1;
    context.strokeStyle = selected ? '#071a25' : 'rgba(7, 26, 37, .55)'; context.lineWidth = selected ? 3 : 1;
    context.fillRect(-size.width * scale / 2, -size.length * scale / 2, size.width * scale, size.length * scale);
    context.strokeRect(-size.width * scale / 2, -size.length * scale / 2, size.width * scale, size.length * scale);
    context.globalAlpha = 1; context.fillStyle = vehicle.colorIndex === 13 ? '#10212c' : '#fff'; drawArrow(context, size.length * scale);
    context.fillStyle = vehicle.colorIndex === 13 ? '#10212c' : '#fff'; context.font = '700 10px Inter, sans-serif'; context.textAlign = 'center'; context.textBaseline = 'middle';
    context.fillText(String(vehicle.id), 0, 2);
    if (vehicle.isTurnVehicle) { context.fillStyle = '#0f172a'; context.fillText('T', size.width * scale * 0.3, size.length * scale * 0.35); }
    context.restore();
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
  const selected = model.selected();
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
      ${model.document.passengerQueues.map((queue, index) => `<label class="level-layout-field is-wide"><span>队列 ${index + 1}</span><textarea data-queue="${index}" rows="4">${queue.join(',')}</textarea></label>`).join('')}
      <button type="button" data-action="add-queue">添加队列</button>`;
    return;
  }
  const item = selected[0];
  if (item.seats) {
    root.innerHTML = `<h3>车辆 #${item.id}</h3>
      ${numberField('X', 'x', item.x)}${numberField('Z', 'z', item.z)}${numberField('旋转', 'yaw', item.yaw, { min: 0, max: 360, step: 1 })}
      ${selectField('颜色', 'colorIndex', item.colorIndex, VEHICLE_COLORS.map((color, index) => [index, `颜色 ${index}`]))}
      ${selectField('座位', 'seats', item.seats, [[4, '4 座'], [6, '6 座'], [10, '10 座']])}
      ${selectField('机制', 'mechanism.type', item.mechanism.type, Object.entries(MECHANISM_NAMES))}
      ${toggleField('隐藏', 'isHidden', item.isHidden)}${toggleField('转向车', 'isTurnVehicle', item.isTurnVehicle)}
      ${selectField('容器', 'containerId', item.containerId, model.document.containers.map((container) => [container.id, `${TYPE_NAMES[container.type]} #${container.id}`]))}
      ${item.containerType === CONTAINER_TYPES.ELEVATOR ? selectField('升降层', 'elevatorLayer', item.elevatorLayer, [[0, '上层'], [1, '下层']]) : ''}
      ${['linkHead', 'linkTail', 'wrench', 'gear'].includes(item.mechanism.type) ? numberField('关联车辆', 'mechanism.pairVehicleId', item.mechanism.pairVehicleId ?? 0, { min: 1, step: 1 }) : ''}
      ${['linkHead', 'linkTail'].includes(item.mechanism.type) ? numberField('连接距离', 'mechanism.distance', item.mechanism.distance, { min: 0.15, max: 0.5, step: 0.01 }) : ''}
      ${['wrench', 'gear'].includes(item.mechanism.type) ? selectField('扳手颜色', 'mechanism.wrenchColor', item.mechanism.wrenchColor, [[0,'粉'],[1,'蓝'],[2,'紫'],[3,'绿'],[4,'黄']]) : ''}
      ${item.mechanism.type === 'combination' ? selectField('组合颜色', 'mechanism.secondColorIndex', item.mechanism.secondColorIndex, VEHICLE_COLORS.map((color, index) => [index, `颜色 ${index}`])) : ''}
      ${item.mechanism.type === 'ambulance' ? numberField('步数限制', 'mechanism.stepLimit', item.mechanism.stepLimit, { min: 1, step: 1 }) : ''}
      ${item.mechanism.type === 'firetruck' ? numberField('倒计时', 'mechanism.timeLimit', item.mechanism.timeLimit, { min: 1, step: 1 }) : ''}
      <div class="level-layout-inspector-actions"><button type="button" data-action="rotate-left" title="Q：左转 15°；Alt+Q：绕选区中心左转">左转 15°</button><button type="button" data-action="rotate-right" title="E：右转 15°；Alt+E：绕选区中心右转">右转 15°</button></div>
      <button class="is-danger" type="button" data-action="delete">删除选中对象</button>`;
    return;
  }
  root.innerHTML = `<h3>${TYPE_NAMES[item.type]} #${item.id}</h3>
    ${numberField('X', 'x', item.x)}${numberField('Z', 'z', item.z)}${numberField('旋转', 'yaw', item.yaw, { min: 0, max: 360, step: 1 })}
    ${numberField('宽度', 'width', item.width, { min: 0.1 })}${numberField('长度', 'length', item.length, { min: 0.1 })}
    ${item.type === CONTAINER_TYPES.CONVEYOR ? numberField('出口宽度', 'width', item.width, { min: 0.1 }) : ''}
    ${item.type === CONTAINER_TYPES.GATE_QUEUE ? `${selectField('路径形状', 'gateQueuePathShape', item.gateQueuePathShape, [[0,'直线'],[1,'曲线']])}${toggleField('锁定', 'gateQueueLocked', item.gateQueueLocked)}${numberField('车辆间距', 'gateQueueGap', item.gateQueueGap, { min: 0.01 })}<label class="level-layout-field is-wide"><span>路径点</span><textarea data-gate-points rows="4">${item.gateQueuePathPoints.map((point) => `${point.x},${point.z}`).join('; ')}</textarea></label><button type="button" data-action="refresh-gate">刷新队列</button>` : ''}
    ${item.type === CONTAINER_TYPES.ELEVATOR ? selectField('编辑层', 'elevatorEditingLayer', item.elevatorEditingLayer, [[0,'上层'],[1,'下层']]) : ''}
    <button type="button" data-action="enter-container">编辑容器内车辆</button>
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
  let savedDocumentSource = JSON.stringify(model.document);
  const camera = { x: 0, z: 0, zoom: 1 };
  let gesture = null;
  let altPressed = false;
  let anchorRotationCenter = null;

  const overlay = document.createElement('div');
  overlay.className = 'level-layout-editor';
  overlay.innerHTML = `<header class="level-layout-toolbar">
    <strong>${escapeHtml(model.document.key)} 关卡编辑器</strong>
    <div class="level-layout-toolbar-group">
      <button type="button" data-action="undo" title="撤销" aria-label="撤销">↶</button><button type="button" data-action="redo" title="重做" aria-label="重做">↷</button>
      <button type="button" data-action="rebuild">重算深度</button><button type="button" data-action="validate">验证</button><button type="button" data-action="save">保存</button><button type="button" data-action="preview">试玩</button>
      <button type="button" data-action="import-json">导入 JSON</button><button type="button" data-action="export-json">JSON</button><button type="button" data-action="export-unity">Unity</button><button type="button" data-action="export-csv">CSV</button><button type="button" data-action="export-excel">Excel</button>
    </div>
    <div class="level-layout-toolbar-group"><button type="button" data-action="close" aria-label="关闭">×</button></div>
  </header>
  <div class="level-layout-body">
    <aside class="level-layout-palette"><h3>添加元素</h3><button data-add="vehicle">添加车辆</button><h3>地图机制</h3><button data-add="garage">添加车库</button><button data-add="conveyor">添加运输带</button><button data-add="gate">添加闸门</button><button data-add="elevator">添加升降舱</button><h3>排列</h3><button data-action="align-horizontal">水平等距</button><button data-action="align-vertical">垂直等距</button><button data-action="align-line">连线等距</button><button data-action="center">全部居中</button><button data-action="to-gate">转为闸门队列</button><h3>定位</h3><label class="level-layout-locate"><input type="number" min="1" placeholder="车辆 ID"><button data-action="locate">定位</button></label></aside>
    <main class="level-layout-canvas-wrap"><canvas class="level-layout-canvas"></canvas><div class="level-layout-breadcrumb">停车区</div><div class="level-layout-status" aria-live="polite">就绪</div></main>
    <aside class="level-layout-inspector"></aside>
  </div><input class="level-layout-json-input" type="file" accept=".json,application/json" hidden>`;
  document.body.append(overlay);
  const canvas = overlay.querySelector('canvas');
  const inspector = overlay.querySelector('.level-layout-inspector');
  const status = overlay.querySelector('.level-layout-status');
  const breadcrumb = overlay.querySelector('.level-layout-breadcrumb');
  const jsonInput = overlay.querySelector('.level-layout-json-input');
  const locateInput = overlay.querySelector('.level-layout-locate input');
  const resizeObserver = new ResizeObserver(() => render());
  resizeObserver.observe(canvas);

  function render() {
    drawCanvas(canvas, model, camera, gesture);
    renderInspector(inspector, model);
    breadcrumb.textContent = model.activeContainerId === 0 ? '停车区' : `${TYPE_NAMES[model.document.containers.find((item) => item.id === model.activeContainerId)?.type]} #${model.activeContainerId}`;
    overlay.classList.toggle('is-dirty', JSON.stringify(model.document) !== savedDocumentSource);
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
      body: JSON.stringify({ document: model.document, baseRevision: revision })
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) { setStatus(payload.error || `保存失败 HTTP ${response.status}`, 'error'); return false; }
    revision = payload.revision; savedDocumentSource = JSON.stringify(model.document);
    setStatus(`已保存 ${payload.savedPath}`, 'success'); render(); return true;
  }

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
    } else if (action === 'enter-container' && selected && !selected.seats) { model.activeContainerId = selected.id; model.clearSelection(); }
    else if (action === 'refresh-gate' && selected?.type === CONTAINER_TYPES.GATE_QUEUE) {
      const vehicles = model.document.vehicles.filter((vehicle) => vehicle.containerId === selected.id);
      if (selected.gateQueuePathPoints.length >= 2 && vehicles.length) {
        const start = selected.gateQueuePathPoints[0]; const end = selected.gateQueuePathPoints.at(-1);
        model.transact(() => vehicles.forEach((vehicle, index) => { const t = index / Math.max(1, vehicles.length - 1); vehicle.x = start.x + (end.x - start.x) * t; vehicle.z = start.z + (end.z - start.z) * t; }));
      }
    } else if (action === 'locate') {
      const vehicle = model.document.vehicles.find((item) => item.id === Number(locateInput.value));
      if (vehicle) { camera.x = vehicle.x; camera.z = vehicle.z; model.select(`vehicle:${vehicle.id}`); setStatus(`已定位车辆 ${vehicle.id}`, 'success'); }
      else setStatus(`未找到车辆 ${locateInput.value}`, 'error');
    }
    render();
  }

  overlay.addEventListener('click', async (event) => {
    const add = event.target.closest('[data-add]')?.dataset.add;
    if (add) {
      if (add === 'vehicle') model.addVehicle({ x: camera.x, z: camera.z });
      else model.addContainer({ garage: 2, conveyor: 3, gate: 4, elevator: 5 }[add], { x: camera.x, z: camera.z });
      render(); return;
    }
    const action = event.target.closest('[data-action]')?.dataset.action;
    if (!action) return;
    if (action === 'save') { await save(); return; }
    if (action === 'preview') { localStorage.setItem('bus-loop-level-editor-preview-v1', JSON.stringify(model.document)); onPreview(model.snapshot()); return; }
    if (action === 'import-json') { jsonInput.click(); return; }
    if (action === 'export-json') { download(`${model.document.key}.json`, `${JSON.stringify(model.document, null, 2)}\n`, 'application/json'); return; }
    if (action === 'export-unity') { download(`${model.document.key}.asset`, exportUnityLevelAsset(model.document), 'text/plain;charset=utf-8'); return; }
    if (action === 'export-csv') { download(`${model.document.key}.csv`, `\ufeff${exportLevelCsv(model.document)}`, 'text/csv;charset=utf-8'); return; }
    if (action === 'export-excel') { download(`${model.document.key}.xls`, exportLevelExcelXml(model.document), 'application/vnd.ms-excel'); return; }
    if (action === 'add-queue') { model.transact((doc) => doc.passengerQueues.push([])); render(); return; }
    if (action === 'close') {
      if (JSON.stringify(model.document) !== savedDocumentSource && !window.confirm('有未保存的关卡修改，仍要关闭吗？')) return;
      resizeObserver.disconnect();
      window.removeEventListener('keydown', handleShortcut, true);
      window.removeEventListener('keyup', handleShortcutKeyUp, true);
      window.removeEventListener('blur', resetAnchorRotation);
      overlay.remove(); onClose(); return;
    }
    runAction(action);
  });

  jsonInput.addEventListener('change', async () => {
    const [file] = jsonInput.files ?? [];
    if (!file) return;
    try {
      const normalized = createLevelDocument(JSON.parse(await file.text()));
      if (normalized.key !== baseLevel.key) throw new Error(`只能导入 ${baseLevel.key} 的编辑文档`);
      model = new LevelEditorModel(normalized);
      revision = null;
      savedDocumentSource = null;
      setStatus(`已导入 ${file.name}`, 'success');
      render();
    } catch (error) {
      setStatus(`导入失败：${error.message}`, 'error');
    } finally {
      jsonInput.value = '';
    }
  });

  inspector.addEventListener('change', (event) => {
    if (event.target.matches('[data-gate-points]')) {
      const points = event.target.value.split(';').map((entry) => entry.trim()).filter(Boolean).map((entry) => {
        const [x, z] = entry.split(/[\s,，]+/).map(Number); return { x, z };
      }).filter((point) => Number.isFinite(point.x) && Number.isFinite(point.z));
      model.setSelectedField('gateQueuePathPoints', points); render(); return;
    }
    const queue = event.target.dataset.queue;
    if (queue != null) {
      const colors = event.target.value.split(/[\s,，]+/).filter(Boolean).map(Number).filter(Number.isFinite);
      model.setQueue(Number(queue), colors); render(); return;
    }
    const field = event.target.dataset.field;
    if (!field) return;
    let value = event.target.type === 'checkbox' ? event.target.checked : event.target.value;
    if (event.target.type === 'number' || ['colorIndex','seats','containerId','elevatorLayer','gateQueuePathShape','mechanism.pairVehicleId','mechanism.distance','mechanism.wrenchColor','mechanism.secondColorIndex','mechanism.stepLimit','mechanism.timeLimit'].includes(field)) value = Number(value);
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
    const hit = hitItem(model.document, world);
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
    else { gesture.currentScreen = screen; gesture.currentWorld = world; }
    drawCanvas(canvas, model, camera, gesture);
  });
  canvas.addEventListener('pointerup', () => {
    if (!gesture) return;
    if (gesture.type === 'drag' && (Math.abs(gesture.delta.x) > 0.001 || Math.abs(gesture.delta.z) > 0.001)) model.moveSelected(gesture.delta.x, gesture.delta.z);
    if (gesture.type === 'box') {
      const minX = Math.min(gesture.startWorld.x, gesture.currentWorld.x); const maxX = Math.max(gesture.startWorld.x, gesture.currentWorld.x);
      const minZ = Math.min(gesture.startWorld.z, gesture.currentWorld.z); const maxZ = Math.max(gesture.startWorld.z, gesture.currentWorld.z);
      const keys = [...(gesture.add ? model.selection : [])];
      for (const item of [...model.document.vehicles, ...model.document.containers.filter((entry) => entry.type !== 1)]) if (item.x >= minX && item.x <= maxX && item.z >= minZ && item.z <= maxZ) keys.push(itemKey(item));
      model.selectMany(keys);
    }
    gesture = null; render();
  });
  canvas.addEventListener('dblclick', (event) => {
    const rect = canvas.getBoundingClientRect(); const point = screenToWorld(camera, rect, event.clientX - rect.left, event.clientY - rect.top);
    const hit = hitItem(model.document, point);
    if (hit && !hit.seats) { model.activeContainerId = hit.id; model.clearSelection(); render(); }
  });
  canvas.addEventListener('wheel', (event) => {
    event.preventDefault(); camera.zoom = Math.max(0.25, Math.min(5, camera.zoom * Math.exp(-event.deltaY * 0.001))); drawCanvas(canvas, model, camera, gesture);
  }, { passive: false });

  async function handleShortcut(event) {
    if (!overlay.isConnected || event.target?.closest?.('input, textarea, select')) return;
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
    else if (event.key === 'Escape' && model.activeContainerId !== 0) { model.activeContainerId = 0; model.clearSelection(); render(); }
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
