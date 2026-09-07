import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const [idlePath, movePath, outputPath] = args;
if (!idlePath || !movePath || !outputPath) {
  throw new Error(
    'Usage: node scripts/extract-unity-passenger-animation.mjs '
    + '<Passenger_Idle.anim> <Passenger_Move.anim> <output.json>'
  );
}

function parseNumber(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) throw new Error(`Invalid animation number: ${value}`);
  return number;
}

function parseQuaternion(value) {
  const match = value.match(/\{x:\s*([^,]+),\s*y:\s*([^,]+),\s*z:\s*([^,]+),\s*w:\s*([^}]+)\}/u);
  if (!match) throw new Error(`Invalid quaternion value: ${value}`);
  return match.slice(1).map(parseNumber);
}

function parseClip(filePath) {
  const source = fs.readFileSync(filePath, 'utf8');
  const rotationsStart = source.indexOf('  m_RotationCurves:');
  const positionsStart = source.indexOf('  m_PositionCurves:', rotationsStart);
  const stopTime = parseNumber(source.match(/\n    m_StopTime:\s*([^\r\n]+)/u)?.[1] ?? '0');
  if (rotationsStart < 0 || positionsStart < 0 || stopTime <= 0) {
    throw new Error(`Unsupported Unity passenger animation: ${filePath}`);
  }

  const section = source.slice(rotationsStart, positionsStart);
  const curves = {};
  for (const block of section.split(/\r?\n  - curve:\r?\n/u).slice(1)) {
    const pathStart = block.indexOf('\n    path:');
    const pathEnd = block.indexOf('\n  m_Compressed', pathStart);
    const unityPath = pathStart < 0
      ? null
      : block.slice(pathStart, pathEnd >= 0 ? pathEnd : block.length)
        .split(/\r?\n/u).map((line) => line.trim()).filter(Boolean).join(' ')
        .replace(/^path:\s*/u, '');
    if (!unityPath) continue;
    const boneName = unityPath.split('/').at(-1).replaceAll(' ', '_');
    const keys = [...block.matchAll(
      /time:\s*([^\r\n]+)\r?\n\s+value:\s*(\{x:[^\r\n]+\})/gu
    )].map((match) => [parseNumber(match[1]), ...parseQuaternion(match[2])]);
    if (keys.length) curves[boneName] = keys;
  }
  if (Object.keys(curves).length !== 22) {
    throw new Error(`Expected 22 passenger bone curves in ${filePath}.`);
  }
  return { duration: stopTime, curves };
}

const payload = {
  version: 1,
  sampleRate: 30,
  clips: {
    idle: parseClip(idlePath),
    move: parseClip(movePath)
  }
};
fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, JSON.stringify(payload));
console.log(JSON.stringify({
  outputPath,
  clips: Object.fromEntries(Object.entries(payload.clips).map(([name, clip]) => [
    name,
    { duration: clip.duration, bones: Object.keys(clip.curves).length }
  ]))
}));
