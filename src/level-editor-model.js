const VEHICLE_SIZES = Object.freeze({
  4: { width: 0.27, length: 0.47157902 },
  6: { width: 0.27, length: 0.486 },
  10: { width: 0.27, length: 0.6785897 }
});

export const CONTAINER_TYPES = Object.freeze({
  PARKING: 1,
  GARAGE: 2,
  CONVEYOR: 3,
  GATE_QUEUE: 4,
  ELEVATOR: 5
});

export const VEHICLE_COLORS = Object.freeze([
  '#ef4444', '#f59e0b', '#eab308', '#22c55e', '#14b8a6', '#3b82f6',
  '#6366f1', '#a855f7', '#ec4899', '#8b5cf6', '#64748b', '#f97316',
  '#06b6d4', '#f8fafc'
]);

const clone = (value) => structuredClone(value);
const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const positiveInt = (value, fallback = 1) => Math.max(1, Math.round(finite(value, fallback)));
const normalizeAngle = (value) => ((finite(value) % 360) + 360) % 360;

function normalizeVehicle(vehicle, fallbackId) {
  return {
    id: positiveInt(vehicle?.id, fallbackId),
    seats: [4, 6, 10].includes(Number(vehicle?.seats)) ? Number(vehicle.seats) : 4,
    colorIndex: Math.max(0, Math.round(finite(vehicle?.colorIndex))),
    x: finite(vehicle?.x ?? vehicle?.position?.x),
    z: finite(vehicle?.z ?? vehicle?.position?.z),
    yaw: normalizeAngle(vehicle?.yaw ?? vehicle?.rotationY),
    isHidden: Boolean(vehicle?.isHidden),
    isTurnVehicle: Boolean(vehicle?.isTurnVehicle),
    containerType: positiveInt(vehicle?.containerType, CONTAINER_TYPES.PARKING),
    containerId: Math.max(0, Math.round(finite(vehicle?.containerId))),
    elevatorLayer: Math.max(0, Math.min(1, Math.round(finite(vehicle?.elevatorLayer)))),
    mechanism: {
      type: vehicle?.mechanism?.type ?? (Number.isInteger(vehicle?.ambulanceStepLimit) ? 'ambulance' : 'normal'),
      pairVehicleId: vehicle?.mechanism?.pairVehicleId == null ? null : positiveInt(vehicle.mechanism.pairVehicleId),
      distance: Math.max(0.15, finite(vehicle?.mechanism?.distance, 0.25)),
      wrenchColor: Math.max(0, Math.round(finite(vehicle?.mechanism?.wrenchColor))),
      secondColorIndex: Math.max(0, Math.round(finite(vehicle?.mechanism?.secondColorIndex))),
      stepLimit: positiveInt(vehicle?.mechanism?.stepLimit ?? vehicle?.ambulanceStepLimit, 35),
      timeLimit: positiveInt(vehicle?.mechanism?.timeLimit ?? vehicle?.firetruckTimeLimit, 30)
    }
  };
}

function normalizeContainer(container, fallbackId) {
  const pathShape = container?.gateQueuePathShape;
  return {
    id: Math.max(0, Math.round(finite(container?.id, fallbackId))),
    type: positiveInt(container?.type, CONTAINER_TYPES.PARKING),
    x: finite(container?.x ?? container?.position?.x),
    z: finite(container?.z ?? container?.position?.z),
    yaw: normalizeAngle(container?.yaw ?? container?.rotationY),
    width: Math.max(0.1, finite(container?.width ?? container?.size?.x, 1.1)),
    length: Math.max(0.1, finite(container?.length ?? container?.size?.y, 0.8)),
    gateQueuePathShape: pathShape === 1 || pathShape === '1' || pathShape === 'Curve' || pathShape === 'Bezier' ? 1 : 0,
    gateQueueLocked: container?.gateQueueLocked !== false,
    gateQueueGap: Math.max(0.01, finite(container?.gateQueueGap, 0.08)),
    gateQueuePathPoints: Array.isArray(container?.gateQueuePathPoints)
      ? container.gateQueuePathPoints.map((point) => ({ x: finite(point?.x), z: finite(point?.z) }))
      : [],
    elevatorEditingLayer: Math.max(0, Math.min(1, Math.round(finite(container?.elevatorEditingLayer))))
  };
}

export function createLevelDocument(level = {}) {
  const vehicles = (level.vehicles ?? []).map((vehicle, index) => normalizeVehicle(vehicle, index + 1));
  const containers = (level.containers?.length ? level.containers : [{ id: 0, type: 1 }])
    .map((container, index) => normalizeContainer(container, index));
  const passengerQueues = Array.isArray(level.passengerQueues)
    ? level.passengerQueues.map((queue) => queue.map((value) => Math.max(0, Math.round(finite(value)))))
    : [[], []];
  return {
    format: 'bus-loop-web-level-v1',
    key: level.key ?? `level${positiveInt(level.unityId ?? level.id, 1)}`,
    displayName: level.displayName ?? level.key ?? 'New Level',
    unityId: positiveInt(level.unityId ?? level.id, 1),
    mapScale: Math.max(0.1, finite(level.mapScale, 1)),
    difficulty: level.difficulty ?? 'Normal',
    conveyorBeltName: level.conveyorBeltName ?? level.sceneName ?? 'GameSceneDualQueue2',
    background: level.background ?? null,
    passengerMethod: level.passengerMethod ?? 'FixedSequence',
    vehicles,
    containers,
    passengerQueues,
    vehicleDepthes: clone(level.vehicleDepthes ?? {}),
    editor: {
      gridGap: Math.max(0.05, finite(level.editor?.gridGap, 0.27)),
      gridRotation: normalizeAngle(level.editor?.gridRotation),
      gridSnap: level.editor?.gridSnap !== false,
      vehicleSnap: level.editor?.vehicleSnap !== false,
      alignmentGuides: level.editor?.alignmentGuides !== false
    }
  };
}

function selectedItems(document, selection) {
  const keys = new Set(selection);
  return [
    ...document.vehicles.filter((item) => keys.has(`vehicle:${item.id}`)),
    ...document.containers.filter((item) => keys.has(`container:${item.id}`))
  ];
}

function nextId(items) {
  return items.reduce((max, item) => Math.max(max, finite(item.id)), 0) + 1;
}

function worldBounds(items) {
  if (!items.length) return null;
  return items.reduce((bounds, item) => ({
    minX: Math.min(bounds.minX, item.x), maxX: Math.max(bounds.maxX, item.x),
    minZ: Math.min(bounds.minZ, item.z), maxZ: Math.max(bounds.maxZ, item.z)
  }), { minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity });
}

function vehicleSize(vehicle) {
  return VEHICLE_SIZES[vehicle.seats] ?? VEHICLE_SIZES[4];
}

function overlapsAhead(source, target) {
  const a = vehicleSize(source);
  const b = target.seats ? vehicleSize(target) : { width: target.width, length: target.length };
  const rad = source.yaw * Math.PI / 180;
  const forward = { x: Math.sin(rad), z: Math.cos(rad) };
  const side = { x: Math.cos(rad), z: -Math.sin(rad) };
  const dx = target.x - source.x;
  const dz = target.z - source.z;
  const ahead = dx * forward.x + dz * forward.z;
  const lateral = Math.abs(dx * side.x + dz * side.z);
  return ahead > 0.001 && lateral <= (a.width + b.width) * 0.5 && ahead <= 500;
}

export function validateLevelDocument(document) {
  const errors = [];
  const warnings = [];
  const vehicleIds = new Set();
  const containerIds = new Set();
  for (const container of document.containers) {
    if (containerIds.has(container.id)) errors.push(`容器 ID ${container.id} 重复`);
    containerIds.add(container.id);
  }
  for (const vehicle of document.vehicles) {
    if (vehicleIds.has(vehicle.id)) errors.push(`车辆 ID ${vehicle.id} 重复`);
    vehicleIds.add(vehicle.id);
    if (![4, 6, 10].includes(vehicle.seats)) errors.push(`车辆 ${vehicle.id} 的座位数无效`);
    if (!containerIds.has(vehicle.containerId)) errors.push(`车辆 ${vehicle.id} 引用了不存在的容器 ${vehicle.containerId}`);
    if (vehicle.mechanism.type !== 'normal' && ['linkHead', 'linkTail', 'wrench', 'gear'].includes(vehicle.mechanism.type)) {
      if (!vehicleIds.has(vehicle.mechanism.pairVehicleId) && !document.vehicles.some((v) => v.id === vehicle.mechanism.pairVehicleId)) {
        errors.push(`车辆 ${vehicle.id} 的关联车辆不存在`);
      }
    }
  }
  const seatCounts = new Map();
  const passengerCounts = new Map();
  for (const vehicle of document.vehicles) seatCounts.set(vehicle.colorIndex, (seatCounts.get(vehicle.colorIndex) ?? 0) + vehicle.seats);
  for (const queue of document.passengerQueues) for (const color of queue) passengerCounts.set(color, (passengerCounts.get(color) ?? 0) + 1);
  for (const color of new Set([...seatCounts.keys(), ...passengerCounts.keys()])) {
    const seats = seatCounts.get(color) ?? 0;
    const passengers = passengerCounts.get(color) ?? 0;
    if (seats !== passengers) errors.push(`颜色 ${color}：${seats} 个座位，${passengers} 名乘客`);
  }
  if (!document.vehicles.length) warnings.push('关卡中没有车辆');
  if (document.containers.filter((item) => item.type === CONTAINER_TYPES.PARKING).length !== 1) {
    warnings.push('建议仅保留一个停车区容器');
  }
  return { valid: errors.length === 0, errors, warnings };
}

export class LevelEditorModel {
  constructor(document, { historyLimit = 100 } = {}) {
    this.document = createLevelDocument(document);
    this.selection = new Set();
    this.activeContainerId = 0;
    this.historyLimit = historyLimit;
    this.undoStack = [];
    this.redoStack = [];
    this.clipboard = [];
    this.changeVersion = 0;
  }

  snapshot() { return clone(this.document); }
  selected() { return selectedItems(this.document, this.selection); }

  transact(mutator) {
    const before = this.snapshot();
    const beforeSelection = [...this.selection];
    mutator(this.document);
    this.undoStack.push({ document: before, selection: beforeSelection });
    if (this.undoStack.length > this.historyLimit) this.undoStack.shift();
    this.redoStack.length = 0;
    this.changeVersion += 1;
    return this.document;
  }

  restore(entry, destination) {
    if (!entry) return false;
    destination.push({ document: this.snapshot(), selection: [...this.selection] });
    this.document = clone(entry.document);
    this.selection = new Set(entry.selection);
    this.changeVersion += 1;
    return true;
  }

  undo() { return this.restore(this.undoStack.pop(), this.redoStack); }
  redo() { return this.restore(this.redoStack.pop(), this.undoStack); }

  select(key, { add = false, toggle = false } = {}) {
    if (!add && !toggle) this.selection.clear();
    if (toggle && this.selection.has(key)) this.selection.delete(key);
    else this.selection.add(key);
  }

  selectMany(keys) { this.selection = new Set(keys); }
  clearSelection() { this.selection.clear(); }

  addVehicle(values = {}) {
    let vehicle;
    this.transact((document) => {
      vehicle = normalizeVehicle({ containerId: this.activeContainerId, ...values }, nextId(document.vehicles));
      vehicle.id = nextId(document.vehicles);
      document.vehicles.push(vehicle);
      this.selection = new Set([`vehicle:${vehicle.id}`]);
    });
    return vehicle;
  }

  addContainer(type, values = {}) {
    let container;
    this.transact((document) => {
      container = normalizeContainer({ type, ...values }, nextId(document.containers));
      container.id = nextId(document.containers);
      document.containers.push(container);
      this.selection = new Set([`container:${container.id}`]);
    });
    return container;
  }

  removeSelected() {
    const keys = new Set(this.selection);
    if (!keys.size) return;
    this.transact((document) => {
      const removedContainers = new Set(document.containers.filter((item) => keys.has(`container:${item.id}`)).map((item) => item.id));
      document.vehicles = document.vehicles.filter((item) => !keys.has(`vehicle:${item.id}`) && !removedContainers.has(item.containerId));
      document.containers = document.containers.filter((item) => !keys.has(`container:${item.id}`) || item.type === CONTAINER_TYPES.PARKING);
      this.selection.clear();
    });
  }

  copy() { this.clipboard = clone(this.selected().map((item) => ({ ...item, kind: item.seats ? 'vehicle' : 'container' }))); }
  cut() { this.copy(); this.removeSelected(); }
  duplicate() { this.copy(); return this.paste(); }

  paste() {
    if (!this.clipboard.length) return [];
    const pastedKeys = [];
    this.transact((document) => {
      const idMap = new Map();
      let vehicleId = nextId(document.vehicles);
      let containerId = nextId(document.containers);
      for (const source of this.clipboard) idMap.set(`${source.kind}:${source.id}`, source.kind === 'vehicle' ? vehicleId++ : containerId++);
      for (const source of this.clipboard) {
        const item = clone(source);
        delete item.kind;
        item.id = idMap.get(`${source.kind}:${source.id}`);
        item.x += 0.27;
        item.z += 0.27;
        if (source.kind === 'vehicle') {
          item.containerId = idMap.get(`container:${source.containerId}`) ?? source.containerId;
          if (item.mechanism?.pairVehicleId != null) item.mechanism.pairVehicleId = idMap.get(`vehicle:${item.mechanism.pairVehicleId}`) ?? null;
          document.vehicles.push(item);
        } else document.containers.push(item);
        pastedKeys.push(`${source.kind}:${item.id}`);
      }
      this.selection = new Set(pastedKeys);
    });
    return pastedKeys;
  }

  moveSelected(dx, dz, { snap = this.document.editor.gridSnap } = {}) {
    const items = this.selected();
    if (!items.length) return;
    const gap = this.document.editor.gridGap;
    this.transact(() => {
      for (const item of items) {
        item.x += finite(dx);
        item.z += finite(dz);
        if (snap) {
          const radians = -this.document.editor.gridRotation * Math.PI / 180;
          const localX = item.x * Math.cos(radians) - item.z * Math.sin(radians);
          const localZ = item.x * Math.sin(radians) + item.z * Math.cos(radians);
          const snappedX = Math.round(localX / gap) * gap;
          const snappedZ = Math.round(localZ / gap) * gap;
          item.x = snappedX * Math.cos(-radians) - snappedZ * Math.sin(-radians);
          item.z = snappedX * Math.sin(-radians) + snappedZ * Math.cos(-radians);
        }
      }
      if (this.document.editor.vehicleSnap) {
        const selectedSet = new Set(items);
        const others = this.document.vehicles.filter((item) => !selectedSet.has(item));
        const anchor = items[0];
        const threshold = Math.max(0.04, gap * 0.35);
        const xTarget = others.map((item) => item.x).find((value) => Math.abs(value - anchor.x) <= threshold);
        const zTarget = others.map((item) => item.z).find((value) => Math.abs(value - anchor.z) <= threshold);
        if (xTarget != null) { const correction = xTarget - anchor.x; for (const item of items) item.x += correction; }
        if (zTarget != null) { const correction = zTarget - anchor.z; for (const item of items) item.z += correction; }
      }
    });
  }

  rotateSelected(angle, { absolute = false } = {}) {
    const items = this.selected();
    if (!items.length) return;
    this.transact(() => { for (const item of items) item.yaw = normalizeAngle(absolute ? angle : item.yaw + angle); });
  }

  selectionCenter() {
    const items = this.selected();
    const bounds = worldBounds(items);
    return bounds ? { x: (bounds.minX + bounds.maxX) / 2, z: (bounds.minZ + bounds.maxZ) / 2 } : null;
  }

  rotateSelectedAroundCenter(angle, center = this.selectionCenter()) {
    const items = this.selected();
    if (!items.length || !center) return;
    const radians = -angle * Math.PI / 180;
    const cosine = Math.cos(radians);
    const sine = Math.sin(radians);
    this.transact(() => {
      for (const item of items) {
        const x = item.x - center.x;
        const z = item.z - center.z;
        item.x = center.x + x * cosine - z * sine;
        item.z = center.z + x * sine + z * cosine;
        item.yaw = normalizeAngle(item.yaw + angle);
      }
    });
  }

  mirror(axis = 'x') {
    const items = this.selected();
    const bounds = worldBounds(items);
    if (!bounds) return;
    const cx = (bounds.minX + bounds.maxX) / 2;
    const cz = (bounds.minZ + bounds.maxZ) / 2;
    this.transact(() => {
      for (const item of items) {
        if (axis === 'x') { item.x = cx - (item.x - cx); item.yaw = normalizeAngle(-item.yaw); }
        else { item.z = cz - (item.z - cz); item.yaw = normalizeAngle(180 - item.yaw); }
      }
    });
  }

  align(mode) {
    const items = this.selected();
    if (items.length < 2) return;
    this.transact(() => {
      if (mode === 'horizontal') {
        const z = items.reduce((sum, item) => sum + item.z, 0) / items.length;
        for (const item of items) item.z = z;
      } else if (mode === 'vertical') {
        const x = items.reduce((sum, item) => sum + item.x, 0) / items.length;
        for (const item of items) item.x = x;
      } else {
        const sorted = [...items].sort((a, b) => a.x - b.x || a.z - b.z);
        const first = sorted[0]; const last = sorted.at(-1);
        sorted.forEach((item, index) => {
          const t = index / Math.max(1, sorted.length - 1);
          item.x = first.x + (last.x - first.x) * t;
          item.z = first.z + (last.z - first.z) * t;
        });
      }
    });
  }

  centerAll() {
    const items = [...this.document.vehicles, ...this.document.containers.filter((item) => item.type !== CONTAINER_TYPES.PARKING)];
    const bounds = worldBounds(items);
    if (!bounds) return;
    const dx = -(bounds.minX + bounds.maxX) / 2;
    const dz = -(bounds.minZ + bounds.maxZ) / 2;
    this.transact(() => { for (const item of items) { item.x += dx; item.z += dz; } });
  }

  setSelectedField(field, value) {
    const items = this.selected();
    if (!items.length) return;
    this.transact(() => {
      for (const item of items) {
        const path = field.split('.');
        const key = path.pop();
        const parent = path.reduce((target, part) => target[part], item);
        parent[key] = value;
      }
    });
  }

  convertSelectedToGateQueue() {
    const vehicles = this.selected().filter((item) => item.seats);
    if (!vehicles.length) return null;
    let gate;
    this.transact((document) => {
      const bounds = worldBounds(vehicles);
      gate = normalizeContainer({
        id: nextId(document.containers), type: CONTAINER_TYPES.GATE_QUEUE,
        x: (bounds.minX + bounds.maxX) / 2, z: (bounds.minZ + bounds.maxZ) / 2,
        gateQueuePathPoints: vehicles.map((vehicle) => ({ x: vehicle.x, z: vehicle.z }))
      }, nextId(document.containers));
      document.containers.push(gate);
      vehicles.forEach((vehicle) => { vehicle.containerType = CONTAINER_TYPES.GATE_QUEUE; vehicle.containerId = gate.id; });
      this.selection = new Set([`container:${gate.id}`]);
    });
    return gate;
  }

  rebuildDepthGraph() {
    this.transact((document) => {
      const blockers = {};
      const targets = [...document.vehicles, ...document.containers.filter((item) => item.type !== CONTAINER_TYPES.PARKING)];
      for (const vehicle of document.vehicles.filter((item) => item.containerType === CONTAINER_TYPES.PARKING)) {
        blockers[vehicle.id] = targets.filter((target) => target !== vehicle && overlapsAhead(vehicle, target)).map((target) => target.id);
      }
      document.vehicleDepthes = blockers;
    });
    return this.document.vehicleDepthes;
  }

  setQueue(queueIndex, colors) {
    this.transact((document) => {
      while (document.passengerQueues.length <= queueIndex) document.passengerQueues.push([]);
      document.passengerQueues[queueIndex] = colors.map((value) => Math.max(0, Math.round(finite(value))));
    });
  }
}

export function levelDocumentToRuntime(document, baseLevel = {}) {
  const doc = createLevelDocument(document);
  const vehicles = doc.vehicles.map((vehicle) => ({
    ...vehicle,
    mechanism: clone(vehicle.mechanism),
    collisionSize: clone(VEHICLE_SIZES[vehicle.seats] ?? VEHICLE_SIZES[4]),
    ...(vehicle.mechanism.type === 'ambulance' ? { ambulanceStepLimit: vehicle.mechanism.stepLimit } : {}),
    ...(vehicle.mechanism.type === 'firetruck' ? { firetruckTimeLimit: vehicle.mechanism.timeLimit } : {})
  }));
  return {
    ...clone(baseLevel),
    key: doc.key,
    displayName: doc.displayName,
    id: doc.unityId,
    unityId: doc.unityId,
    mapScale: doc.mapScale,
    sceneName: doc.conveyorBeltName,
    vehicles,
    containers: clone(doc.containers),
    vehicleDepthes: clone(doc.vehicleDepthes),
    passengerQueues: clone(doc.passengerQueues),
    passengerSequence: doc.passengerQueues.flat(),
    queueCount: doc.passengerQueues.length
  };
}

export function exportLevelCsv(document) {
  const rows = [['type', 'id', 'x', 'z', 'yaw', 'seats', 'color', 'containerType', 'containerId', 'mechanism']];
  for (const vehicle of document.vehicles) rows.push([
    'vehicle', vehicle.id, vehicle.x, vehicle.z, vehicle.yaw, vehicle.seats, vehicle.colorIndex,
    vehicle.containerType, vehicle.containerId, vehicle.mechanism.type
  ]);
  for (const container of document.containers) rows.push([
    'container', container.id, container.x, container.z, container.yaw, '', '', container.type, '', ''
  ]);
  return rows.map((row) => row.map((value) => `"${String(value).replaceAll('"', '""')}"`).join(',')).join('\r\n');
}

export function exportLevelExcelXml(document) {
  const xml = (value) => String(value).replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;'
  })[char]);
  const rows = exportLevelCsv(document).split('\r\n').map((line) => (
    line.match(/("(?:[^"]|"")*"|[^,]*)(?:,|$)/g).slice(0, -1).map((cell) => cell.replace(/^"|"$/g, '').replaceAll('""', '"'))
  ));
  const body = rows.map((row, rowIndex) => `<Row>${row.map((value) => `<Cell${rowIndex === 0 ? ' ss:StyleID="Header"' : ''}><Data ss:Type="String">${xml(value)}</Data></Cell>`).join('')}</Row>`).join('');
  return `<?xml version="1.0"?><?mso-application progid="Excel.Sheet"?><Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"><Styles><Style ss:ID="Header"><Font ss:Bold="1"/><Interior ss:Color="#87CEEB" ss:Pattern="Solid"/></Style></Styles><Worksheet ss:Name="Level"><Table>${body}</Table><WorksheetOptions xmlns="urn:schemas-microsoft-com:office:excel"><FreezePanes/><FrozenNoSplit/><SplitHorizontal>1</SplitHorizontal><TopRowBottomPane>1</TopRowBottomPane></WorksheetOptions></Worksheet></Workbook>`;
}

export function exportUnityLevelAsset(document) {
  const doc = createLevelDocument(document);
  const renderList = (items, render) => items.length ? items.map(render).join('\n') : '  []';
  const vehicles = renderList(doc.vehicles, (vehicle) => {
    const radians = vehicle.yaw * Math.PI / 360;
    return `  - id: ${vehicle.id}\n    seats: ${vehicle.seats}\n    isHidden: ${vehicle.isHidden ? 1 : 0}\n    isTurnVehicle: ${vehicle.isTurnVehicle ? 1 : 0}\n    colorIndex: ${vehicle.colorIndex}\n    position: {x: ${vehicle.x}, y: 0, z: ${vehicle.z}}\n    rotation: {x: 0, y: ${Math.sin(radians)}, z: 0, w: ${Math.cos(radians)}}\n    containerType: ${vehicle.containerType}\n    containerId: ${vehicle.containerId}\n    elevatorLayer: ${vehicle.elevatorLayer}`;
  });
  const containers = renderList(doc.containers, (container) => {
    const radians = container.yaw * Math.PI / 360;
    const points = container.gateQueuePathPoints.map((point) => `      - {x: ${point.x}, y: 0, z: ${point.z}}`).join('\n');
    return `  - id: ${container.id}\n    type: ${container.type}\n    position: {x: ${container.x}, y: 0, z: ${container.z}}\n    rotation: {x: 0, y: ${Math.sin(radians)}, z: 0, w: ${Math.cos(radians)}}\n    gateQueuePathShape: ${container.gateQueuePathShape}\n    gateQueueLocked: ${container.gateQueueLocked ? 1 : 0}\n    gateQueueGap: ${container.gateQueueGap}\n    gateQueuePathPoints:\n${points || '      []'}\n    elevatorSize: {x: ${container.width}, y: ${container.length}}`;
  });
  const mechanisms = (types) => doc.vehicles.filter((vehicle) => types.includes(vehicle.mechanism.type));
  const linkages = renderList(mechanisms(['linkHead']), (vehicle) => `  - vidHead: ${vehicle.id}\n    vidTail: ${vehicle.mechanism.pairVehicleId}\n    distance: ${vehicle.mechanism.distance}`);
  const wrenches = renderList(mechanisms(['wrench']), (vehicle) => `  - vidWrench: ${vehicle.id}\n    vidGear: ${vehicle.mechanism.pairVehicleId}\n    color: ${vehicle.mechanism.wrenchColor}`);
  const combinations = renderList(mechanisms(['combination']), (vehicle) => `  - vid: ${vehicle.id}\n    secondColorIndex: ${vehicle.mechanism.secondColorIndex}`);
  const ambulances = renderList(mechanisms(['ambulance']), (vehicle) => `  - vid: ${vehicle.id}\n    stepLimit: ${vehicle.mechanism.stepLimit}`);
  const firetrucks = renderList(mechanisms(['firetruck']), (vehicle) => `  - vid: ${vehicle.id}\n    timeLimit: ${vehicle.mechanism.timeLimit}`);
  const conveyorBelts = renderList(doc.containers.filter((item) => item.type === CONTAINER_TYPES.CONVEYOR), (container) => `  - vcId: ${container.id}\n    width: ${container.width}`);
  const depths = renderList(Object.entries(doc.vehicleDepthes), ([id, ids]) => `  - vid: ${id}\n    depths: [${ids.join(', ')}]`);
  const passengers = renderList(doc.passengerQueues.flatMap((queue, queueId) => queue.map((colorIndex) => ({ queueId, colorIndex }))), (passenger) => `  - queueId: ${passenger.queueId}\n    colorIndex: ${passenger.colorIndex}`);
  const difficultyMap = { Normal: 0, Hard: 1, SupperHard: 2 };
  const difficulty = difficultyMap[doc.difficulty] ?? (Number.isFinite(Number(doc.difficulty)) ? Number(doc.difficulty) : 0);
  const passengerMethod = doc.passengerMethod === 'FixedSequence' ? 0 : Number(doc.passengerMethod) || 0;
  return `%YAML 1.1\n%TAG !u! tag:unity3d.com,2011:\n--- !u!114 &11400000\nMonoBehaviour:\n  m_ObjectHideFlags: 0\n  m_Name: ${doc.key}\n  id: ${doc.unityId}\n  mapScale: ${doc.mapScale}\n  difficulty: ${difficulty}\n  conveyorBeltName: ${doc.conveyorBeltName}\n  passengerMethod: ${passengerMethod}\n  vehicles:\n${vehicles}\n  containers:\n${containers}\n  vehicleLinkages:\n${linkages}\n  vehicleWrenches:\n${wrenches}\n  vehicleCombinations:\n${combinations}\n  vehicleAmbulances:\n${ambulances}\n  vehicleFiretrucks:\n${firetrucks}\n  conveyorBelts:\n${conveyorBelts}\n  vehicleDepthes:\n${depths}\n  fixedPassengerSequence:\n${passengers}\n`;
}
