import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const artifactPath = join(root, 'artifacts', 'unity-levels.json');
const catalogPath = join(root, 'src', 'level-catalog.js');
const activePath = join(root, 'src', 'generated-active-level.js');
const defaultSources = [
  'D:/备份/改文件名临时文件夹/level5.asset',
  'D:/备份/改文件名临时文件夹/level7.asset',
  ...[8, 9, 10].map((id) => `D:/备份/改文件名临时文件夹/level${id}.asset`),
  'D:/备份/busloop素材关卡/level12.asset',
  'D:/备份/改文件名临时文件夹/level13.asset',
  'D:/备份/busloop素材关卡/level15.asset',
  'D:/备份/busloop素材关卡/level16.asset',
  ...[17, 18].map((id) => join(root, 'artifacts', 'unity-level-sources', `level${id}.asset`))
];
const sourcePaths = process.argv.slice(2).filter((value) => !value.startsWith('--'));
const selectedArg = process.argv.find((value) => value.startsWith('--selected='))?.slice('--selected='.length);
const removeKeys = new Set(
  (process.argv.find((value) => value.startsWith('--remove='))?.slice('--remove='.length) ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)
);
const mergeExisting = process.argv.includes('--merge-existing');
const unityVehicleCollisionSizes = {
  4: { width: 0.27, length: 0.47157902 },
  6: { width: 0.27, length: 0.486 },
  10: { width: 0.27, length: 0.6785897 }
};
const passengerQueueOverrides = {
  level7: [
    expandPassengerQueue([
      [4, 10], [6, 10], [1, 10], [7, 10], [0, 6], [3, 10], [4, 10], [6, 10],
      [1, 4], [7, 10], [0, 10], [3, 4], [6, 10], [1, 4], [7, 10], [0, 4],
      [3, 10], [5, 10], [1, 10], [7, 4], [3, 10], [4, 10], [6, 10], [1, 10],
      [7, 6], [0, 4], [3, 10], [4, 4], [6, 6], [1, 10], [7, 4], [0, 10],
      [4, 10], [1, 10], [7, 6], [0, 10], [4, 6], [5, 10], [1, 4], [7, 10],
      [5, 10], [1, 10], [6, 6], [5, 6], [1, 10]
    ]),
    expandPassengerQueue([
      [2, 10], [7, 10], [0, 10], [6, 6], [5, 6], [1, 4], [7, 4], [1, 10],
      [7, 4], [6, 10], [5, 10], [6, 6], [5, 10], [1, 10], [5, 4], [7, 10],
      [0, 6], [5, 10], [1, 10], [5, 10], [1, 4], [5, 10], [1, 6], [7, 6],
      [5, 6], [7, 12], [0, 6], [7, 6], [0, 6], [7, 4], [0, 10], [7, 10],
      [0, 10], [7, 4], [0, 18]
    ])
  ],
  // Bus Fever - Car Jam Escape Playable_applovin.html, embedded Level12 passengerQueues.
  level12: [
    expandPassengerQueue([
      [5, 2], [3, 2], [0, 3], [5, 2], [1, 9], [8, 6], [7, 6], [4, 4],
      [2, 4], [5, 6], [1, 6], [7, 8], [6, 10], [0, 4], [5, 4], [6, 6],
      [0, 10], [5, 10], [3, 10], [6, 4], [0, 6], [5, 8], [2, 10], [1, 10],
      [8, 4], [3, 4], [5, 4], [1, 4], [8, 4], [5, 4], [7, 10], [0, 4],
      [2, 4], [5, 4], [4, 4], [5, 4], [1, 4], [4, 4], [5, 7]
    ]),
    expandPassengerQueue([
      [5, 2], [3, 2], [0, 3], [5, 2], [1, 1], [5, 9], [3, 4], [7, 8],
      [5, 8], [7, 4], [5, 14], [7, 8], [5, 16], [7, 4], [5, 4], [7, 4],
      [5, 12], [0, 4], [5, 24], [0, 6], [5, 4], [0, 8], [5, 12], [0, 20],
      [5, 36]
    ])
  ],
  level15: [
    expandPassengerQueue([
      [1, 6], [4, 4], [7, 6], [0, 6], [4, 10], [3, 6], [5, 6], [6, 6],
      [1, 6], [7, 10], [4, 6], [0, 4], [6, 10], [5, 6], [2, 6], [7, 6],
      [1, 4], [2, 4], [0, 6], [4, 6], [3, 6], [5, 6], [0, 10], [4, 6],
      [6, 6], [0, 6], [4, 6], [5, 10], [4, 10], [0, 6], [1, 6], [2, 10],
      [7, 10], [5, 4], [3, 6], [6, 4], [4, 6], [0, 10], [7, 4], [3, 4],
      [2, 4], [1, 4], [6, 6], [3, 6], [5, 6], [6, 4], [7, 6]
    ]),
    expandPassengerQueue([
      [7, 4], [6, 10], [3, 4], [6, 6], [2, 6], [0, 10], [6, 10], [1, 4],
      [5, 10], [3, 4], [0, 6], [1, 6], [2, 10], [4, 6], [2, 6], [0, 6],
      [1, 4], [3, 6], [4, 6], [2, 6], [3, 6], [1, 6], [3, 6], [0, 6],
      [4, 6], [7, 6], [0, 4], [2, 6], [7, 4], [1, 6], [0, 6], [2, 6],
      [1, 6], [2, 6], [4, 4]
    ])
  ]
};
const vehicleOverrides = {
  level7: {
    89: { colorIndex: 2 }
  },
  level13: {
    130: { z: 1.3369986 }
  }
};

function expandPassengerQueue(runs) {
  return runs.flatMap(([colorIndex, count]) => Array(count).fill(colorIndex));
}

function section(source, name, nextName) {
  const start = source.indexOf(`  ${name}:`);
  if (start < 0) return '';
  const end = nextName ? source.indexOf(`  ${nextName}:`, start + name.length + 3) : source.length;
  return source.slice(start, end < 0 ? source.length : end);
}

function scalar(source, name, fallback = null) {
  const match = source.match(new RegExp(`^  ${name}:\\s*(.*)$`, 'm'));
  if (!match) return fallback;
  const value = match[1].trim();
  const number = Number(value);
  return value !== '' && Number.isFinite(number) ? number : value;
}

function inlineVector(line) {
  const values = {};
  for (const match of line.matchAll(/([xyzw]):\s*(-?\d+(?:\.\d+)?(?:e[-+]?\d+)?)/gi)) {
    values[match[1]] = Number(match[2]);
  }
  return values;
}

function yawFromQuaternion(rotation) {
  const x = rotation.x ?? 0;
  const y = rotation.y ?? 0;
  const z = rotation.z ?? 0;
  const w = rotation.w ?? 1;
  return Math.atan2(2 * (w * y + x * z), 1 - 2 * (y * y + z * z)) * 180 / Math.PI;
}

function records(block, idName = 'id') {
  const lines = block.split(/\r?\n/);
  const output = [];
  let current = null;
  for (const line of lines) {
    const start = line.match(new RegExp(`^  - ${idName}:\\s*(-?\\d+)`));
    if (start) {
      current = { [idName]: Number(start[1]) };
      output.push(current);
      continue;
    }
    if (!current) continue;
    const property = line.match(/^    ([A-Za-z][A-Za-z0-9]*):\s*(.*)$/);
    if (!property) continue;
    const [, key, rawValue] = property;
    if (key === 'depth') current[key] = rawValue;
    else if (rawValue.startsWith('{')) current[key] = inlineVector(rawValue);
    else {
      const number = Number(rawValue);
      current[key] = rawValue !== '' && Number.isFinite(number) ? number : rawValue;
    }
  }
  return output;
}

function decodeUnityInt32Hex(hex) {
  const values = [];
  for (let offset = 0; offset + 8 <= hex.length; offset += 8) {
    const bytes = Buffer.from(hex.slice(offset, offset + 8), 'hex');
    values.push(bytes.readInt32LE(0));
  }
  return values;
}

function parseDepths(source) {
  const block = section(source, 'vehicleDepthes', 'fixedPassengerSequence');
  const entries = records(block, 'vid');
  return Object.fromEntries(entries.map((entry) => [entry.vid, decodeUnityInt32Hex(String(entry.depth ?? ''))]));
}

function parsePassengerQueues(source) {
  const block = section(source, 'fixedPassengerSequence');
  const queues = [];
  let queueId = null;
  for (const line of block.split(/\r?\n/)) {
    const queueMatch = line.match(/^  - queueId:\s*(\d+)/);
    if (queueMatch) {
      queueId = Number(queueMatch[1]);
      if (!queues[queueId]) queues[queueId] = [];
      continue;
    }
    const colorMatch = line.match(/^    colorIndex:\s*(-?\d+)/);
    if (colorMatch && queueId != null) queues[queueId].push(Number(colorMatch[1]));
  }
  return queues.map((queue) => queue ?? []);
}

function colorCounts(values) {
  const counts = {};
  for (const value of values) counts[value] = (counts[value] ?? 0) + 1;
  return counts;
}

function validateLevel(level) {
  const seatCounts = {};
  for (const vehicle of level.vehicles) {
    seatCounts[vehicle.colorIndex] = (seatCounts[vehicle.colorIndex] ?? 0) + vehicle.seats;
  }
  const passengerCounts = colorCounts(level.passengerQueues.flat());
  const colors = new Set([...Object.keys(seatCounts), ...Object.keys(passengerCounts)]);
  const mismatches = [...colors].filter((color) => seatCounts[color] !== passengerCounts[color]);
  if (mismatches.length > 0) {
    throw new Error(`${level.key}: passenger/seat color totals differ for ${mismatches.join(', ')}`);
  }
}

function applyVehicleOverrides(level) {
  const overrides = vehicleOverrides[level.key];
  if (!overrides) return;
  for (const vehicle of level.vehicles) {
    const override = overrides[vehicle.id];
    if (override) Object.assign(vehicle, override);
  }
}

function parseUnityLevel(path, baseLevel) {
  const source = readFileSync(path, 'utf8');
  const fileName = basename(path);
  const key = fileName.replace(/\.asset$/i, '');
  const vehicles = records(section(source, 'vehicles', 'containers')).map((vehicle) => ({
    id: vehicle.id,
    seats: vehicle.seats,
    colorIndex: vehicle.colorIndex,
    x: vehicle.position?.x ?? 0,
    z: vehicle.position?.z ?? 0,
    yaw: yawFromQuaternion(vehicle.rotation ?? {}),
    isHidden: Boolean(vehicle.isHidden),
    containerType: vehicle.containerType,
    containerId: vehicle.containerId
  }));
  const containers = records(section(source, 'containers', 'vehicleExt')).map((container) => ({
    id: container.id,
    type: container.type,
    x: container.position?.x ?? 0,
    z: container.position?.z ?? 0,
    yaw: yawFromQuaternion(container.rotation ?? {})
  }));
  const passengerQueues = structuredClone(
    passengerQueueOverrides[key] ?? parsePassengerQueues(source)
  );
  const mapScale = Number(scalar(source, 'mapScale', 1));
  const level = structuredClone(baseLevel);
  Object.assign(level, {
    key,
    displayName: `${key} (${fileName})`,
    sourceFile: fileName,
    unityId: Number(scalar(source, 'id', 0)),
    id: Number(scalar(source, 'id', 0)),
    mapScale,
    sceneName: String(scalar(source, 'sceneName', baseLevel.sceneName)),
    vehicles,
    containers,
    vehicleDepthes: parseDepths(source),
    passengerQueues,
    passengerSequence: passengerQueues.flat(),
    vehicleSize: { width: 0.27 * mapScale, length: 0.6785897 * mapScale },
    collision: {
      vehicleSizes: structuredClone(unityVehicleCollisionSizes),
      maxVehicleSize: { width: 0.27, length: 0.6785897 },
      garageSize: { width: 0.95 / 1.5, length: 1.2 / 1.5 }
    }
  });
  applyVehicleOverrides(level);
  validateLevel(level);
  return level;
}

async function loadBaseLevel() {
  if (existsSync(artifactPath)) {
    const existing = JSON.parse(readFileSync(artifactPath, 'utf8'));
    const current = existing.levels?.find((level) => level.key === 'currentLevel12');
    if (current) return current;
  }
  const moduleUrl = `${pathToFileURL(join(root, 'src', 'level-data.js')).href}?extract=${Date.now()}`;
  const { LEVEL_1 } = await import(moduleUrl);
  return {
    ...structuredClone(LEVEL_1),
    key: 'currentLevel12',
    displayName: 'Current Level 12',
    sourceFile: 'current level-data.js',
    unityId: LEVEL_1.id
  };
}

function moduleSource(name, value, extra = '') {
  return `// Generated by scripts/extract-unity-levels.mjs. Do not edit by hand.\nexport const ${name} = Object.freeze(${JSON.stringify(value, null, 2)});\n${extra}`;
}

const baseLevel = await loadBaseLevel();
baseLevel.collision = {
  ...baseLevel.collision,
  vehicleSizes: structuredClone(unityVehicleCollisionSizes),
  maxVehicleSize: { width: 0.27, length: 0.6785897 },
  garageSize: baseLevel.collision?.garageSize
    ?? { width: 0.95 / 1.5, length: 1.2 / 1.5 }
};
if (removeKeys.size > 0 && !mergeExisting) {
  throw new Error('--remove requires --merge-existing');
}
const requestedSources = sourcePaths.length > 0
  ? sourcePaths
  : removeKeys.size > 0 ? [] : defaultSources;
for (const path of requestedSources) {
  if (!existsSync(path)) throw new Error(`Unity level asset not found: ${path}`);
}
const importedLevels = requestedSources.map((path) => parseUnityLevel(path, baseLevel));
let levels = [baseLevel, ...importedLevels];
let selected = selectedArg ?? baseLevel.key;

if (mergeExisting) {
  if (!existsSync(artifactPath)) {
    throw new Error('Cannot merge Unity levels without artifacts/unity-levels.json');
  }
  const existing = JSON.parse(readFileSync(artifactPath, 'utf8'));
  const replacements = new Map(importedLevels.map((level) => [level.key, level]));
  levels = (existing.levels ?? []).map((level) => replacements.get(level.key) ?? level);
  for (const importedLevel of importedLevels) {
    if (!levels.some((level) => level.key === importedLevel.key)) levels.push(importedLevel);
  }
  levels = levels.filter((level) => !removeKeys.has(level.key));
  levels.sort((first, second) => {
    if (first.key === 'currentLevel12') return -1;
    if (second.key === 'currentLevel12') return 1;
    const firstId = Number(first.key.match(/^level(\d+)$/)?.[1] ?? Number.MAX_SAFE_INTEGER);
    const secondId = Number(second.key.match(/^level(\d+)$/)?.[1] ?? Number.MAX_SAFE_INTEGER);
    return firstId - secondId || first.key.localeCompare(second.key);
  });
  selected = selectedArg ?? existing.selected ?? baseLevel.key;
}
const activeLevel = levels.find((level) => level.key === selected);
if (!activeLevel) throw new Error(`Unknown selected level: ${selected}`);

writeFileSync(artifactPath, `${JSON.stringify({ selected, levels }, null, 2)}\n`);
writeFileSync(catalogPath, moduleSource(
  'LEVEL_CATALOG',
  Object.fromEntries(levels.map((level) => [level.key, level])),
  `\nexport const LEVEL_OPTIONS = Object.freeze(Object.values(LEVEL_CATALOG).filter((level) => level.key !== 'currentLevel12').map((level) => [level.key, level.displayName]));\n\nexport function getLevelDefinition(key) {\n  return LEVEL_CATALOG[key] ?? LEVEL_CATALOG.level5;\n}\n`
));
if (!mergeExisting) {
  writeFileSync(activePath, moduleSource('ACTIVE_LEVEL', activeLevel));
}

for (const level of levels) {
  console.log(`${level.key}: ${level.vehicles.length} vehicles, queues ${level.passengerQueues.map((queue) => queue.length).join('+')}`);
}
console.log(mergeExisting
  ? `Preserved production active module; catalog selection remains ${selected}`
  : `Generated active level: ${activeLevel.key}`);
