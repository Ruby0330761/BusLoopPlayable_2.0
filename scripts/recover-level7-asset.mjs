import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const inputPath = join(root, 'artifacts', 'unity-levels.json');
const outputPath = process.argv[2]
  ? resolve(process.argv[2])
  : join(root, 'artifacts', 'recovered-level7.asset');

const data = JSON.parse(readFileSync(inputPath, 'utf8'));
const level = data.levels.find((entry) => entry.key === 'level7');

if (!level) {
  throw new Error('level7 was not found in artifacts/unity-levels.json');
}

function number(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return String(value);
  if (Object.is(numeric, -0) || Math.abs(numeric) < 1e-9) return '0';
  if (Number.isInteger(numeric)) return String(numeric);
  const rounded = Math.round(numeric * 100000000) / 100000000;
  const formatted = rounded.toFixed(8).replace(/\.?0+$/, '');
  return formatted === '-0' ? '0' : formatted;
}

function yawToQuaternion(yawDegrees) {
  const roundedYaw = Math.round(yawDegrees);
  if (roundedYaw === 0) return { x: 0, y: 0, z: 0, w: 1 };
  if (roundedYaw === 90) return { x: 0, y: 0.70710677, z: 0, w: 0.70710677 };
  if (roundedYaw === -90) return { x: 0, y: -0.70710677, z: 0, w: 0.70710677 };
  if (roundedYaw === 180) return { x: 0, y: 1, z: 0, w: 0 };
  if (roundedYaw === -180) return { x: 0, y: -1, z: 0, w: 0.00000004 };
  const radians = yawDegrees * Math.PI / 180;
  const half = radians / 2;
  return {
    x: 0,
    y: Math.sin(half),
    z: 0,
    w: Math.cos(half)
  };
}

function vector3(x, y, z) {
  return `{x: ${number(x)}, y: ${number(y)}, z: ${number(z)}}`;
}

function quaternion(rotation) {
  return `{x: ${number(rotation.x)}, y: ${number(rotation.y)}, z: ${number(rotation.z)}, w: ${number(rotation.w)}}`;
}

function encodeDepth(values) {
  const buffer = Buffer.alloc(values.length * 4);
  values.forEach((value, index) => buffer.writeInt32LE(value, index * 4));
  return buffer.toString('hex');
}

function pushVehicle(lines, vehicle) {
  lines.push(`  - id: ${vehicle.id}`);
  lines.push(`    seats: ${vehicle.seats}`);
  lines.push(`    isHidden: ${vehicle.isHidden ? 1 : 0}`);
  lines.push(`    colorIndex: ${vehicle.colorIndex}`);
  lines.push('    priority: 0');
  lines.push(`    position: ${vector3(vehicle.x, 0, vehicle.z)}`);
  lines.push(`    rotation: ${quaternion(yawToQuaternion(vehicle.yaw ?? 0))}`);
  lines.push(`    containerType: ${vehicle.containerType ?? 1}`);
  lines.push(`    containerId: ${vehicle.containerId ?? 0}`);
}

function pushContainer(lines, container) {
  lines.push(`  - id: ${container.id}`);
  lines.push(`    type: ${container.type}`);
  lines.push(`    position: ${vector3(container.x, 0, container.z)}`);
  lines.push(`    rotation: ${quaternion(yawToQuaternion(container.yaw ?? 0))}`);
}

const lines = [
  '%YAML 1.1',
  '%TAG !u! tag:unity3d.com,2011:',
  '--- !u!114 &11400000',
  'MonoBehaviour:',
  '  m_ObjectHideFlags: 0',
  '  m_CorrespondingSourceObject: {fileID: 0}',
  '  m_PrefabInstance: {fileID: 0}',
  '  m_PrefabAsset: {fileID: 0}',
  '  m_GameObject: {fileID: 0}',
  '  m_Enabled: 1',
  '  m_EditorHideFlags: 0',
  '  m_Script: {fileID: 11500000, guid: e40b6c9a941244a49037a51f0dac6d7f, type: 3}',
  '  m_Name: level7',
  '  m_EditorClassIdentifier: ',
  '  id: 7',
  '  mapScale: 1',
  '  difficulty: 0',
  '  conveyorBeltName: ConveyorBelt5',
  '  bgMaterial: {fileID: 2100000, guid: adc0b94e7d110574a9eaf0c51faf8b30, type: 2}',
  '  passengerMethod: 4',
  '  vehicles:'
];

for (const vehicle of level.vehicles) pushVehicle(lines, vehicle);

lines.push('  containers:');
for (const container of level.containers ?? [{ id: 0, type: 1, x: 0, z: 0, yaw: 0 }]) {
  pushContainer(lines, container);
}

lines.push('  vehicleExt: []');
lines.push('  vehicleLinkages: []');
lines.push('  vehicleWrenches: []');
lines.push('  vehicleCombinations: []');
lines.push('  vehicleAnchors: []');
lines.push('  vehiclePassengerLocations: []');
lines.push('  vehicleDepthes:');

const depthEntries = Object.entries(level.vehicleDepthes ?? {})
  .map(([vid, depth]) => [Number(vid), depth])
  .sort((a, b) => a[0] - b[0]);
for (const [vid, depth] of depthEntries) {
  lines.push(`  - vid: ${vid}`);
  lines.push(`    depth: ${encodeDepth(depth)}`);
}

lines.push('  fixedPassengerSequence:');
for (const [queueId, queue] of (level.passengerQueues ?? []).entries()) {
  for (const colorIndex of queue) {
    lines.push(`  - queueId: ${queueId}`);
    lines.push(`    colorIndex: ${colorIndex}`);
  }
}

writeFileSync(outputPath, `${lines.join('\r\n')}\r\n`, 'utf8');
console.log(`Recovered ${outputPath}`);
console.log(`vehicles=${level.vehicles.length}`);
console.log(`containers=${level.containers?.length ?? 0}`);
console.log(`depths=${depthEntries.length}`);
console.log(`queues=${(level.passengerQueues ?? []).map((queue) => queue.length).join('+')}`);
