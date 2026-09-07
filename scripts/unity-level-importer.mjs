import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { deriveLevelMechanics } from '../src/mechanism-resources.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const EXTRACT_SCRIPT = path.join(ROOT, 'scripts', 'extract-unity-levels.mjs');
const CATALOG_PATH = path.join(ROOT, 'src', 'level-catalog.js');
const LEVEL_ARTIFACT_PATH = path.join(ROOT, 'artifacts', 'unity-levels.json');

export const MAX_UNITY_LEVEL_BYTES = 8 * 1024 * 1024;
export const DEFAULT_UNITY_LEVEL_SOURCE_ROOT = path.join(ROOT, 'artifacts', 'unity-level-sources');

const SUPPORTED_SEAT_COUNTS = new Set([4, 6, 10]);
const UNSUPPORTED_MECHANISM_SECTIONS = [
  'vehicleExt',
  'vehicleLinkages',
  'vehicleWrenches',
  'vehicleCombinations',
  'vehicleAnchors',
  'vehiclePassengerLocations',
  'vehicleFiretrucks'
];
const STANDARD_COLOR_INDEX_MAX = 10;
const AMBULANCE_COLOR_INDEX = 13;
const LUXURY_COLOR_INDEX = 15;
const PARKING_AREA_CONTAINER_TYPE = 1;
const GARAGE_CONTAINER_TYPE = 2;
const CONVEYOR_BELT_CONTAINER_TYPE = 3;
const SUPPORTED_CONTAINER_TYPES = new Set([
  PARKING_AREA_CONTAINER_TYPE,
  GARAGE_CONTAINER_TYPE,
  CONVEYOR_BELT_CONTAINER_TYPE
]);
const NUMBER_PATTERN = '[-+]?(?:\\d+(?:\\.\\d*)?|\\.\\d+)(?:e[-+]?\\d+)?';

function invalid(message) {
  const error = new Error(message);
  error.statusCode = 400;
  return error;
}

function validateFilename(filename) {
  if (typeof filename !== 'string' || path.basename(filename) !== filename) {
    throw invalid('Only one local Unity level file can be imported.');
  }
  const match = filename.match(/^level([1-9]\d*)\.asset$/i);
  if (!match) throw invalid('The filename must use the level<number>.asset format.');
  const number = Number(match[1]);
  if (!Number.isSafeInteger(number)) throw invalid('The level number is too large.');
  return { key: `level${number}`, filename: `level${number}.asset` };
}

function topLevelValue(source, name) {
  const match = source.match(new RegExp(`^  ${name}:[ \\t]*(.*)$`, 'm'));
  return match?.[1]?.trim() ?? null;
}

function section(source, name) {
  const header = new RegExp(`^  ${name}:[ \\t]*(.*)$`, 'm').exec(source);
  if (!header) return null;
  const bodyStart = header.index + header[0].length;
  const next = /^  [A-Za-z][A-Za-z0-9]*:[ \t]*.*$/gm;
  next.lastIndex = bodyStart;
  const nextHeader = next.exec(source);
  return {
    inlineValue: header[1].trim(),
    body: source.slice(bodyStart, nextHeader?.index ?? source.length)
  };
}

function parseInlineVector(rawValue) {
  if (typeof rawValue !== 'string' || !rawValue.trim().startsWith('{')) return null;
  const values = {};
  const pattern = new RegExp(`([xyzw]):\\s*(${NUMBER_PATTERN})`, 'gi');
  for (const match of rawValue.matchAll(pattern)) values[match[1]] = Number(match[2]);
  return values;
}

function parseRecords(source, sectionName, idName = 'id') {
  const sourceSection = section(source, sectionName);
  if (!sourceSection) throw invalid(`Missing required ${sectionName} field.`);
  if (sourceSection.inlineValue === '[]') return [];
  const records = [];
  let current = null;
  for (const line of sourceSection.body.split(/\r?\n/)) {
    const start = line.match(new RegExp(`^  - ${idName}:\\s*(-?\\d+)\\s*$`));
    if (start) {
      current = { [idName]: Number(start[1]) };
      records.push(current);
      continue;
    }
    if (!current) continue;
    const property = line.match(/^    ([A-Za-z][A-Za-z0-9]*):\s*(.*)$/);
    if (!property) continue;
    const [, key, rawValue] = property;
    current[key] = rawValue.startsWith('{') ? parseInlineVector(rawValue) : rawValue.trim();
  }
  return records;
}

function requireInteger(value, label, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  if (value == null || (typeof value === 'string' && value.trim() === '')) {
    throw invalid(`${label} is required.`);
  }
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < min || number > max) {
    throw invalid(`${label} must be an integer between ${min} and ${max}.`);
  }
  return number;
}

function requireFinite(value, label, { min = -Infinity, max = Infinity } = {}) {
  if (value == null || (typeof value === 'string' && value.trim() === '')) {
    throw invalid(`${label} is required.`);
  }
  const number = Number(value);
  if (!Number.isFinite(number) || number < min || number > max) {
    throw invalid(`${label} must be a finite number between ${min} and ${max}.`);
  }
  return number;
}

function requireVector(value, axes, label) {
  if (!value || typeof value !== 'object') throw invalid(`${label} is missing or malformed.`);
  const result = {};
  for (const axis of axes) result[axis] = requireFinite(value[axis], `${label}.${axis}`);
  return result;
}

function validateNoUnsupportedMechanisms(source) {
  for (const name of UNSUPPORTED_MECHANISM_SECTIONS) {
    const sourceSection = section(source, name);
    if (!sourceSection) continue;
    const hasEntries = sourceSection.inlineValue !== '[]'
      || sourceSection.body.split(/\r?\n/).some((line) => /^  - /.test(line));
    if (hasEntries) {
      throw invalid(`${name} contains a mechanism that the playable editor does not support yet.`);
    }
  }
}

function validateVehicles(source) {
  const records = parseRecords(source, 'vehicles');
  if (records.length === 0) throw invalid('The level must contain at least one vehicle.');
  const ids = new Set();
  const vehicles = records.map((record, index) => {
    const label = `vehicles[${index}]`;
    const id = requireInteger(record.id, `${label}.id`);
    if (ids.has(id)) throw invalid(`Vehicle id ${id} is duplicated.`);
    ids.add(id);
    const seats = requireInteger(record.seats, `${label}.seats`, { min: 1, max: 100 });
    if (!SUPPORTED_SEAT_COUNTS.has(seats)) {
      throw invalid(`Vehicle ${id} uses unsupported seat count ${seats}; supported values are 4, 6, and 10.`);
    }
    const colorIndex = requireInteger(record.colorIndex, `${label}.colorIndex`, { min: 0, max: LUXURY_COLOR_INDEX });
    if (colorIndex > STANDARD_COLOR_INDEX_MAX && colorIndex !== AMBULANCE_COLOR_INDEX && colorIndex !== LUXURY_COLOR_INDEX) {
      throw invalid(`Vehicle ${id} uses unsupported color index ${colorIndex}.`);
    }
    if (colorIndex === LUXURY_COLOR_INDEX && seats !== 6) {
      throw invalid(`Luxury vehicle ${id} must use 6 seats.`);
    }
    const isHidden = requireInteger(record.isHidden, `${label}.isHidden`, { min: 0, max: 1 });
    const isTurnVehicle = record.isTurnVehicle == null
      ? false
      : requireInteger(record.isTurnVehicle, `${label}.isTurnVehicle`, { min: 0, max: 1 });
    const containerType = requireInteger(record.containerType, `${label}.containerType`, { min: 0, max: 1000 });
    const containerId = requireInteger(record.containerId, `${label}.containerId`, { min: 0 });
    if (!SUPPORTED_CONTAINER_TYPES.has(containerType)) {
      throw invalid(`Vehicle ${id} uses unsupported container type ${containerType}.`);
    }
    const position = requireVector(record.position, ['x', 'y', 'z'], `${label}.position`);
    const rotation = requireVector(record.rotation, ['x', 'y', 'z', 'w'], `${label}.rotation`);
    const rotationMagnitude = Math.hypot(rotation.x, rotation.y, rotation.z, rotation.w);
    if (rotationMagnitude < 0.000001) throw invalid(`Vehicle ${id} has an invalid zero rotation.`);
    return {
      id,
      seats,
      colorIndex,
      isHidden,
      isTurnVehicle: Boolean(isTurnVehicle),
      containerType,
      containerId,
      position,
      rotation
    };
  });
  return { vehicles, vehicleIds: ids };
}

function validateAmbulances(source, vehicles) {
  const records = section(source, 'vehicleAmbulances')
    ? parseRecords(source, 'vehicleAmbulances', 'vid')
    : [];
  const vehiclesById = new Map(vehicles.map((vehicle) => [vehicle.id, vehicle]));
  const configuredIds = new Set();
  const ambulances = records.map((record, index) => {
    const label = `vehicleAmbulances[${index}]`;
    const vid = requireInteger(record.vid, `${label}.vid`);
    if (configuredIds.has(vid)) throw invalid(`Ambulance vehicle ${vid} is configured more than once.`);
    configuredIds.add(vid);
    const vehicle = vehiclesById.get(vid);
    if (!vehicle) throw invalid(`Ambulance vehicle ${vid} does not exist.`);
    if (vehicle.seats !== 6) throw invalid(`Ambulance vehicle ${vid} must use 6 seats.`);
    if (vehicle.colorIndex !== AMBULANCE_COLOR_INDEX) {
      throw invalid(`Ambulance vehicle ${vid} must use color index ${AMBULANCE_COLOR_INDEX}.`);
    }
    const stepLimit = requireInteger(record.stepLimit, `${label}.stepLimit`, { min: 1, max: 1000000 });
    return { vid, stepLimit };
  });
  for (const vehicle of vehicles) {
    if (vehicle.colorIndex === AMBULANCE_COLOR_INDEX && !configuredIds.has(vehicle.id)) {
      throw invalid(`Vehicle ${vehicle.id} uses ambulance color index ${AMBULANCE_COLOR_INDEX} but has no vehicleAmbulances configuration.`);
    }
  }
  return ambulances;
}

function validateContainers(source, vehicles) {
  const records = parseRecords(source, 'containers');
  if (records.length === 0) throw invalid('The level must contain at least one container.');
  const ids = new Set();
  const containers = records.map((record, index) => {
    const label = `containers[${index}]`;
    const id = requireInteger(record.id, `${label}.id`);
    if (ids.has(id)) throw invalid(`Container id ${id} is duplicated.`);
    ids.add(id);
    const type = requireInteger(record.type, `${label}.type`, { min: 0, max: 1000 });
    if (!SUPPORTED_CONTAINER_TYPES.has(type)) {
      throw invalid(`Container ${id} uses unsupported type ${type}.`);
    }
    const position = requireVector(record.position, ['x', 'y', 'z'], `${label}.position`);
    const rotation = requireVector(record.rotation, ['x', 'y', 'z', 'w'], `${label}.rotation`);
    return { id, type, position, rotation };
  });
  const containersById = new Map(containers.map((container) => [container.id, container]));
  for (const vehicle of vehicles) {
    const container = containersById.get(vehicle.containerId);
    if (!container) {
      throw invalid(`Vehicle ${vehicle.id} references missing container ${vehicle.containerId}.`);
    }
    if (container.type !== vehicle.containerType) {
      throw invalid(
        `Vehicle ${vehicle.id} container type ${vehicle.containerType} does not match container ${container.id} type ${container.type}.`
      );
    }
  }
  return containers;
}

function parseConveyorBelts(source) {
  const sourceSection = section(source, 'conveyorBelts');
  if (!sourceSection || sourceSection.inlineValue === '[]') return [];
  const belts = [];
  let current = null;
  for (const line of sourceSection.body.split(/\r?\n/)) {
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
  return belts;
}

function validateConveyorBelts(source, containers, vehicles) {
  const belts = parseConveyorBelts(source);
  const conveyorContainers = containers.filter((container) => container.type === CONVEYOR_BELT_CONTAINER_TYPE);
  const vehicleIdsByContainer = new Map();
  for (const vehicle of vehicles) {
    if (vehicle.containerType !== CONVEYOR_BELT_CONTAINER_TYPE) continue;
    const list = vehicleIdsByContainer.get(vehicle.containerId) ?? [];
    list.push(vehicle.id);
    vehicleIdsByContainer.set(vehicle.containerId, list);
  }
  const seen = new Set();
  for (const [index, belt] of belts.entries()) {
    if (!Number.isSafeInteger(belt.vcId) || belt.vcId < 0) {
      throw invalid(`conveyorBelts[${index}].vcId must be a non-negative integer.`);
    }
    if (seen.has(belt.vcId)) throw invalid(`conveyorBelts entry ${belt.vcId} is duplicated.`);
    seen.add(belt.vcId);
    belt.width = requireFinite(belt.width, `conveyorBelts[${index}].width`, { min: 0.1, max: 100 });
    for (const colorIndex of belt.colorIndices) {
      if (colorIndex < 0 || colorIndex > LUXURY_COLOR_INDEX) {
        throw invalid(`conveyorBelts[${index}] uses unsupported color index ${colorIndex}.`);
      }
    }
    const container = containers.find((candidate) => Number(candidate.id) === belt.vcId);
    if (!container) {
      throw invalid(`conveyorBelts entry ${belt.vcId} references a missing container.`);
    }
    if (container.type !== CONVEYOR_BELT_CONTAINER_TYPE) {
      throw invalid(`conveyorBelts entry ${belt.vcId} must reference a type 3 conveyor container.`);
    }
  }
  for (const container of conveyorContainers) {
    if (!vehicleIdsByContainer.has(container.id)) {
      throw invalid(`Conveyor container ${container.id} must contain at least one vehicle.`);
    }
    if (!seen.has(container.id)) {
      throw invalid(`Conveyor container ${container.id} is missing conveyorBelts configuration.`);
    }
  }
  return belts;
}

function validatePassengerQueues(source, vehicles) {
  const sourceSection = section(source, 'fixedPassengerSequence');
  if (!sourceSection) throw invalid('Missing required fixedPassengerSequence field.');
  const queues = new Map();
  let queueId = null;
  let awaitingColor = false;
  for (const line of sourceSection.body.split(/\r?\n/)) {
    const queueMatch = line.match(/^  - queueId:\s*(-?\d+)\s*$/);
    if (queueMatch) {
      if (awaitingColor) throw invalid(`Passenger entry for queue ${queueId} is missing colorIndex.`);
      queueId = requireInteger(queueMatch[1], 'fixedPassengerSequence.queueId', { min: 0, max: 31 });
      awaitingColor = true;
      continue;
    }
    const colorMatch = line.match(/^    colorIndex:\s*(-?\d+)\s*$/);
    if (colorMatch && queueId != null) {
      const colorIndex = requireInteger(colorMatch[1], 'fixedPassengerSequence.colorIndex', { min: 0, max: LUXURY_COLOR_INDEX });
      if (colorIndex > STANDARD_COLOR_INDEX_MAX && colorIndex !== AMBULANCE_COLOR_INDEX && colorIndex !== LUXURY_COLOR_INDEX) {
        throw invalid(`Passenger uses unsupported color index ${colorIndex}.`);
      }
      if (!queues.has(queueId)) queues.set(queueId, []);
      queues.get(queueId).push(colorIndex);
      awaitingColor = false;
    }
  }
  if (awaitingColor) throw invalid(`Passenger entry for queue ${queueId} is missing colorIndex.`);
  if (queues.size === 0) throw invalid('fixedPassengerSequence must contain passengers.');
  const queueIds = [...queues.keys()].sort((a, b) => a - b);
  for (let index = 0; index < queueIds.length; index += 1) {
    if (queueIds[index] !== index) throw invalid('Passenger queue ids must be continuous and start at 0.');
  }

  const seatCounts = new Map();
  for (const vehicle of vehicles) {
    seatCounts.set(vehicle.colorIndex, (seatCounts.get(vehicle.colorIndex) ?? 0) + vehicle.seats);
  }
  const passengerCounts = new Map();
  for (const colorIndex of [...queues.values()].flat()) {
    passengerCounts.set(colorIndex, (passengerCounts.get(colorIndex) ?? 0) + 1);
  }
  const colors = new Set([...seatCounts.keys(), ...passengerCounts.keys()]);
  for (const colorIndex of colors) {
    const seats = seatCounts.get(colorIndex) ?? 0;
    const passengers = passengerCounts.get(colorIndex) ?? 0;
    if (seats !== passengers) {
      throw invalid(`Color ${colorIndex} has ${seats} seats but ${passengers} passengers.`);
    }
  }
  return queueIds.map((id) => queues.get(id));
}

function validateDepthReferences(source, vehicleIds) {
  if (!section(source, 'vehicleDepthes')) return;
  const records = parseRecords(source, 'vehicleDepthes', 'vid');
  const owners = new Set();
  for (const record of records) {
    const ownerId = requireInteger(record.vid, 'vehicleDepthes.vid');
    if (!vehicleIds.has(ownerId)) throw invalid(`vehicleDepthes owner ${ownerId} does not exist.`);
    if (owners.has(ownerId)) throw invalid(`vehicleDepthes owner ${ownerId} is duplicated.`);
    owners.add(ownerId);
    const hex = String(record.depth ?? '').trim();
    if (!/^[0-9a-f]*$/i.test(hex) || hex.length % 8 !== 0) {
      throw invalid(`vehicleDepthes for vehicle ${ownerId} is not valid Unity int32 hex data.`);
    }
    for (let offset = 0; offset < hex.length; offset += 8) {
      const referencedId = Buffer.from(hex.slice(offset, offset + 8), 'hex').readInt32LE(0);
      if (!vehicleIds.has(referencedId)) {
        throw invalid(`Vehicle ${ownerId} depth data references missing vehicle ${referencedId}.`);
      }
    }
  }
}

export function validateUnityLevelSource({ filename, source }) {
  const identity = validateFilename(filename);
  if (typeof source !== 'string' || source.length === 0) throw invalid('The Unity level file is empty.');
  if (Buffer.byteLength(source, 'utf8') > MAX_UNITY_LEVEL_BYTES) {
    const error = invalid('The Unity level file exceeds the 8 MB import limit.');
    error.statusCode = 413;
    throw error;
  }
  if (source.includes('\0')) throw invalid('The Unity level file contains binary data.');
  if (!source.startsWith('%YAML 1.1') || !source.includes('%TAG !u! tag:unity3d.com,2011:')) {
    throw invalid('The file is not a Unity text YAML asset.');
  }
  if (!/^--- !u!114 &-?\d+\s*$/m.test(source) || !/^MonoBehaviour:\s*$/m.test(source)) {
    throw invalid('The file does not contain a Unity MonoBehaviour level asset.');
  }
  if (!/^  m_Script: \{fileID: -?\d+, guid: [0-9a-f]+, type: \d+\}\s*$/im.test(source)) {
    throw invalid('The Unity level script reference is missing or malformed.');
  }
  const assetName = topLevelValue(source, 'm_Name');
  if (!/^level[1-9]\d*$/i.test(assetName ?? '')) throw invalid('Unity m_Name must use the level<number> format.');
  const unityId = requireInteger(topLevelValue(source, 'id'), 'id');
  const mapScale = requireFinite(topLevelValue(source, 'mapScale'), 'mapScale', { min: 0.01, max: 10 });
  validateNoUnsupportedMechanisms(source);
  const { vehicles, vehicleIds } = validateVehicles(source);
  const ambulances = validateAmbulances(source, vehicles);
  const containers = validateContainers(source, vehicles);
  const conveyorBelts = validateConveyorBelts(source, containers, vehicles);
  const passengerQueues = validatePassengerQueues(source, vehicles);
  validateDepthReferences(source, vehicleIds);
  const mechanics = deriveLevelMechanics({
    vehicles,
    vehicleAmbulances: ambulances,
    containers,
    conveyorBelts
  });
  return {
    ...identity,
    sourceName: assetName,
    unityId,
    mapScale,
    vehicleCount: vehicles.length,
    turnVehicleCount: vehicles.filter((vehicle) => vehicle.isTurnVehicle).length,
    ambulanceCount: ambulances.length,
    luxuryCount: vehicles.filter((vehicle) => vehicle.colorIndex === LUXURY_COLOR_INDEX).length,
    containerCount: containers.length,
    garageCount: containers.filter((container) => container.type === GARAGE_CONTAINER_TYPE).length,
    garageVehicleCount: vehicles.filter((vehicle) => vehicle.containerType === GARAGE_CONTAINER_TYPE).length,
    mechanics,
    ...(conveyorBelts.length > 0 || containers.some((container) => container.type === CONVEYOR_BELT_CONTAINER_TYPE)
      ? {
        conveyorBeltCount: conveyorBelts.length,
        conveyorVehicleCount: vehicles.filter((vehicle) => vehicle.containerType === CONVEYOR_BELT_CONTAINER_TYPE).length
      }
      : {}),
    queueCounts: passengerQueues.map((queue) => queue.length),
    passengerCount: passengerQueues.reduce((sum, queue) => sum + queue.length, 0)
  };
}

async function readOptional(filePath) {
  try {
    return await readFile(filePath);
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

async function writeAtomically(filePath, data) {
  await mkdir(path.dirname(filePath), { recursive: true });
  const token = `${process.pid}-${randomUUID()}`;
  const temporaryPath = path.join(path.dirname(filePath), `.${path.basename(filePath)}.${token}.tmp`);
  const backupPath = path.join(path.dirname(filePath), `.${path.basename(filePath)}.${token}.bak`);
  let movedExisting = false;
  try {
    await writeFile(temporaryPath, data);
    const existing = await readOptional(filePath);
    if (existing != null) {
      await rename(filePath, backupPath);
      movedExisting = true;
    }
    await rename(temporaryPath, filePath);
    if (movedExisting) await unlink(backupPath);
  } catch (error) {
    await unlink(temporaryPath).catch(() => {});
    if (movedExisting) {
      await unlink(filePath).catch(() => {});
      await rename(backupPath, filePath).catch(() => {});
    }
    throw error;
  }
}

async function restoreFile(filePath, previous) {
  if (previous == null) {
    await unlink(filePath).catch((error) => {
      if (error.code !== 'ENOENT') throw error;
    });
    return;
  }
  await writeAtomically(filePath, previous);
}

export async function updateUnityLevelCatalog(sourcePath) {
  await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [EXTRACT_SCRIPT, sourcePath, '--merge-existing'], {
      cwd: ROOT,
      stdio: ['ignore', 'pipe', 'pipe']
    });
    let stdout = '';
    let stderr = '';
    const append = (current, chunk) => `${current}${chunk}`.slice(-32000);
    child.stdout.on('data', (chunk) => { stdout = append(stdout, chunk); });
    child.stderr.on('data', (chunk) => { stderr = append(stderr, chunk); });
    child.once('error', reject);
    child.once('close', (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(invalid((stderr || stdout || `Unity level catalog update exited with code ${code}.`).trim()));
    });
  });
}

export async function importUnityLevelAsset({ filename, source }, {
  outputRoot = DEFAULT_UNITY_LEVEL_SOURCE_ROOT,
  updateCatalog = updateUnityLevelCatalog,
  metadataPaths = [LEVEL_ARTIFACT_PATH, CATALOG_PATH]
} = {}) {
  const level = validateUnityLevelSource({ filename, source });
  const outputPath = path.join(path.resolve(outputRoot), level.filename);
  const trackedPaths = [outputPath, ...metadataPaths];
  const previousFiles = new Map(await Promise.all(
    trackedPaths.map(async (filePath) => [filePath, await readOptional(filePath)])
  ));
  try {
    await writeAtomically(outputPath, source);
    await updateCatalog(outputPath, level);
  } catch (error) {
    const rollbackErrors = [];
    for (const filePath of trackedPaths) {
      try {
        await restoreFile(filePath, previousFiles.get(filePath));
      } catch (rollbackError) {
        rollbackErrors.push(`${path.basename(filePath)}: ${rollbackError.message}`);
      }
    }
    if (rollbackErrors.length > 0) {
      error.message += ` Rollback failed for ${rollbackErrors.join('; ')}`;
    }
    throw error;
  }
  return {
    level,
    outputPath,
    replaced: previousFiles.get(outputPath) != null
  };
}
