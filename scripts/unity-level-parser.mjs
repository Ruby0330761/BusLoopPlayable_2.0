// Pure Unity level-asset parsing.
//
// The extraction CLI used to own this code, but the official in-game level
// browser also has to turn an .asset into a layout without writing files or
// rebuilding the catalog. Both callers share this module so a level cannot be
// summarised one way in the picker and imported another way.
//
// No filesystem access happens here: the caller passes the YAML text, and a
// base level for the fields an asset does not carry (collision sizes, garage
// configuration, audio, and so on).

import { deriveLevelMechanics } from '../src/mechanism-resources.js';

export const UNITY_VEHICLE_COLLISION_SIZES = Object.freeze({
  4: { width: 0.27, length: 0.47157902 },
  6: { width: 0.27, length: 0.486 },
  10: { width: 0.27, length: 0.6785897 }
});

export const UNITY_GARAGE_CONFIG = Object.freeze({
  size: { width: 0.50425464, length: 0.668775 },
  parkOffset: 0.7,
  outDelay: 0.3,
  outDuration: 0.6
});

const LUXURY_COLOR_INDEX = 15;

// Reference-playable corrections for levels whose Unity asset did not carry the
// queue that shipped in the game. Keyed by the plain `level<number>` identity;
// official levels imported under a chapter-namespaced key deliberately do not
// match these, because their attached asset is the source of truth.
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
      [5, 8], [7, 4], [5, 14], [7, 8], [5, 16], [7, 8], [5, 4], [7, 4],
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

// A container's nested `gateQueuePathPoints` list is written as an indented
// block of `- {x: .., y: 0, z: ..}` entries, so `records()` (which only reads
// single-line properties) cannot see it. Read it from the container's own
// chunk instead.
function parseGatePathPoints(block) {
  const points = [];
  const lines = block.split(/\r?\n/);
  let inList = false;
  for (const line of lines) {
    if (/^    gateQueuePathPoints:/.test(line)) {
      inList = true;
      continue;
    }
    if (!inList) continue;
    const entry = line.match(/^\s+- \{x:\s*(-?\d+(?:\.\d+)?(?:e[-+]?\d+)?),\s*y:\s*(-?\d+(?:\.\d+)?(?:e[-+]?\d+)?),\s*z:\s*(-?\d+(?:\.\d+)?(?:e[-+]?\d+)?)\}/i);
    if (entry) {
      points.push({ x: Number(entry[1]), z: Number(entry[3]) });
      continue;
    }
    // Anything that is not a list item ends the nested list.
    if (line.trim() !== '') inList = false;
  }
  return points;
}

// Split a section into one chunk per `  - id:` record so nested lists stay
// attached to the container that owns them.
function recordBlocks(block) {
  const blocks = [];
  let current = null;
  for (const line of block.split(/\r?\n/)) {
    if (/^  - id:/.test(line)) {
      current = [];
      blocks.push(current);
    }
    if (current) current.push(line);
  }
  return blocks.map((lines) => lines.join('\n'));
}

function recordId(block) {
  return Number(block.match(/^  - id:\s*(-?\d+)/)?.[1]);
}

// The containers section is followed by other top-level sections, so stop at
// the next `  name:` line instead of reading to the end of the file.
function sectionBlock(source, name) {
  const lines = source.split(/\r?\n/);
  const start = lines.findIndex((line) => line.startsWith(`  ${name}:`));
  if (start < 0) return '';
  let end = lines.length;
  for (let index = start + 1; index < lines.length; index += 1) {
    if (/^  [A-Za-z][A-Za-z0-9_]*:/.test(lines[index])) {
      end = index;
      break;
    }
  }
  return lines.slice(start, end).join('\n');
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

function parseAmbulances(source) {
  return records(section(source, 'vehicleAmbulances', 'vehicleFiretrucks'), 'vid').map((entry) => ({
    vid: Number(entry.vid),
    stepLimit: Number(entry.stepLimit)
  }));
}

function parseConveyorBelts(source) {
  const block = section(source, 'conveyorBelts');
  if (!block || block.trim().endsWith('[]')) return [];
  const belts = [];
  let current = null;
  for (const line of block.split(/\r?\n/)) {
    const start = line.match(/^  - vcId:\s*(-?\d+)\s*$/);
    if (start) {
      current = { vcId: Number(start[1]), colorIndices: [] };
      belts.push(current);
      continue;
    }
    if (!current) continue;
    const width = line.match(/^    width:\s*(.*)$/);
    if (width) current.width = Number(width[1]);
    const color = line.match(/^    colorIndex:\s*(-?\d+)\s*$/);
    if (color) current.colorIndices.push(Number(color[1]));
  }
  return belts.filter((belt) => Number.isFinite(belt.vcId));
}

function colorCounts(values) {
  const counts = {};
  for (const value of values) counts[value] = (counts[value] ?? 0) + 1;
  return counts;
}

function validateParsedLevel(level) {
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
  const ambulanceIds = new Set();
  for (const ambulance of level.vehicleAmbulances ?? []) {
    const vehicle = level.vehicles.find((candidate) => candidate.id === ambulance.vid);
    if (!vehicle) throw new Error(`${level.key}: ambulance vehicle ${ambulance.vid} does not exist`);
    if (ambulanceIds.has(ambulance.vid)) throw new Error(`${level.key}: ambulance vehicle ${ambulance.vid} is duplicated`);
    ambulanceIds.add(ambulance.vid);
    if (vehicle.seats !== 6 || vehicle.colorIndex !== 13) {
      throw new Error(`${level.key}: ambulance vehicle ${ambulance.vid} must use 6 seats and color index 13`);
    }
    if (!Number.isInteger(ambulance.stepLimit) || ambulance.stepLimit < 1) {
      throw new Error(`${level.key}: ambulance vehicle ${ambulance.vid} has an invalid step limit`);
    }
  }
  for (const vehicle of level.vehicles) {
    if (vehicle.colorIndex === 13 && !ambulanceIds.has(vehicle.id)) {
      throw new Error(`${level.key}: vehicle ${vehicle.id} is missing ambulance configuration`);
    }
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

/**
 * Parse one Unity level YAML asset into a runtime level definition.
 *
 * @param {string} source    Unity text YAML
 * @param {object} options
 * @param {string} options.fileName       file name the key and default label derive from
 * @param {object} options.baseLevel      level definition supplying fields the asset omits
 * @param {string} [options.key]          explicit key (the official picker namespaces it)
 * @param {string} [options.displayName]  explicit label
 * @param {string} [options.sourceFileName] label for the original file
 * @param {boolean} [options.validate]    enforce seat/passenger parity (default true)
 * @returns {object} level definition
 */
export function parseUnityLevelSource(source, {
  fileName,
  baseLevel = {},
  key = null,
  displayName = null,
  sourceFileName = null,
  validate = true
} = {}) {
  if (typeof source !== 'string' || source.length === 0) {
    throw new Error('The Unity level file is empty.');
  }
  if (typeof fileName !== 'string' || fileName.length === 0) {
    throw new Error('The Unity level file name is required.');
  }
  const resolvedKey = key ?? fileName.replace(/\.asset$/i, '');
  const resolvedSourceFileName = sourceFileName ?? fileName;
  const ambulanceEntries = parseAmbulances(source);
  const conveyorBelts = parseConveyorBelts(source);
  const ambulanceStepLimits = new Map(ambulanceEntries.map((entry) => [entry.vid, entry.stepLimit]));
  const vehicles = records(section(source, 'vehicles', 'containers')).map((vehicle) => ({
    id: vehicle.id,
    seats: vehicle.seats,
    colorIndex: vehicle.colorIndex,
    x: vehicle.position?.x ?? 0,
    z: vehicle.position?.z ?? 0,
    yaw: yawFromQuaternion(vehicle.rotation ?? {}),
    isHidden: Boolean(vehicle.isHidden),
    isTurnVehicle: Boolean(vehicle.isTurnVehicle),
    isLuxury: vehicle.colorIndex === LUXURY_COLOR_INDEX,
    containerType: vehicle.containerType,
    containerId: vehicle.containerId,
    // Elevators stack two floors of vehicles at the same world coordinates.
    // Floor 0 is the upper deck and the default for every ordinary car, so
    // only a lower-deck car carries the field; that keeps existing generated
    // catalogs byte-identical.
    ...(Number(vehicle.elevatorLayer) > 0 ? { elevatorLayer: Number(vehicle.elevatorLayer) } : {}),
    ...(ambulanceStepLimits.has(vehicle.id)
      ? { ambulanceStepLimit: ambulanceStepLimits.get(vehicle.id) }
      : {})
  }));
  const containerSection = sectionBlock(source, 'containers');
  const containerRecords = recordBlocks(containerSection);
  const containers = records(containerSection).map((container) => {
    const block = containerRecords.find((chunk) => recordId(chunk) === Number(container.id)) ?? '';
    const type = Number(container.type);
    // Gate/elevator fields are authored on every container by Unity but only
    // mean something on types 4 and 5. Reading them unconditionally would put
    // `gateQueueGap: 0` on every parking area and change generated catalogs
    // byte for byte.
    const gateQueuePathPoints = type === 4 ? parseGatePathPoints(block) : [];
    return {
      id: container.id,
      type,
      x: container.position?.x ?? 0,
      z: container.position?.z ?? 0,
      yaw: yawFromQuaternion(container.rotation ?? {}),
      ...(gateQueuePathPoints.length >= 2 ? { gateQueuePathPoints } : {}),
      ...(type === 4 && Number.isFinite(Number(container.gateQueuePathShape))
        ? { gateQueuePathShape: Number(container.gateQueuePathShape) }
        : {}),
      ...(type === 4 && Number.isFinite(Number(container.gateQueueGap))
        ? { gateQueueGap: Number(container.gateQueueGap) }
        : {}),
      ...(type === 5 && container.elevatorSize && (container.elevatorSize.x || container.elevatorSize.y)
        ? { elevatorSize: { ...container.elevatorSize } }
        : {})
    };
  });
  const passengerQueues = structuredClone(
    passengerQueueOverrides[resolvedKey] ?? parsePassengerQueues(source)
  );
  const mapScale = Number(scalar(source, 'mapScale', 1));
  const level = structuredClone(baseLevel);
  Object.assign(level, {
    key: resolvedKey,
    displayName: displayName || `${resolvedKey} (${fileName})`,
    sourceFile: resolvedSourceFileName,
    unityId: Number(scalar(source, 'id', 0)),
    id: Number(scalar(source, 'id', 0)),
    mapScale,
    sceneName: String(scalar(source, 'sceneName', baseLevel.sceneName)),
    conveyorBeltName: String(scalar(source, 'conveyorBeltName', baseLevel.conveyorBeltName ?? '')),
    vehicles,
    turnVehicleCount: vehicles.filter((vehicle) => vehicle.isTurnVehicle).length,
    luxuryCount: vehicles.filter((vehicle) => vehicle.isLuxury).length,
    vehicleAmbulances: ambulanceEntries,
    containers,
    mechanics: deriveLevelMechanics({
      vehicles,
      vehicleAmbulances: ambulanceEntries,
      containers,
      conveyorBelts
    }),
    ...(conveyorBelts.length > 0 ? { conveyorBelts } : {}),
    vehicleDepthes: parseDepths(source),
    passengerQueues,
    passengerSequence: passengerQueues.flat(),
    vehicleSize: { width: 0.27 * mapScale, length: 0.6785897 * mapScale },
    garage: structuredClone(UNITY_GARAGE_CONFIG),
    collision: {
      vehicleSizes: structuredClone(UNITY_VEHICLE_COLLISION_SIZES),
      maxVehicleSize: { width: 0.27, length: 0.6785897 },
      garageSize: structuredClone(UNITY_GARAGE_CONFIG.size),
      ...(conveyorBelts.length > 0 ? {
        conveyor: {
          size: { width: 1.4, length: 1 },
          exitWidth: Math.max(...conveyorBelts.map((belt) => belt.width ?? 3.8)),
          wallThickness: 0.02
        }
      } : {})
    }
  });
  applyVehicleOverrides(level);
  if (validate) validateParsedLevel(level);
  return level;
}
