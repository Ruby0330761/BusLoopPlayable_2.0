import fs from 'node:fs';
import path from 'node:path';
import { deflateSync } from 'node:zlib';
import { DataUtils } from 'three';

const args = process.argv.slice(2);
const [sourcePath, outputPath] = args;
if (!sourcePath || !outputPath) {
  throw new Error(
    'Usage: node scripts/extract-unity-vat.mjs <Unity Texture2D.asset> <output.bin> '
    + '[--pack-rgb8-zlib --vertex-count=<count> --frames=<start-end,...>]'
  );
}

const readOption = (name) => args.find((value) => value.startsWith(`${name}=`))?.slice(name.length + 1);
const packRgb8Zlib = args.includes('--pack-rgb8-zlib');
const vertexCount = Number(readOption('--vertex-count'));
const frameRanges = readOption('--frames');

const source = fs.readFileSync(sourcePath, 'utf8');
const width = Number(source.match(/m_Width:\s*(\d+)/)?.[1]);
const height = Number(source.match(/m_Height:\s*(\d+)/)?.[1]);
const format = Number(source.match(/m_TextureFormat:\s*(\d+)/)?.[1]);
const hex = source.match(/_typelessdata:\s*([0-9a-f]+)/i)?.[1];
if (!width || !height || format !== 17 || !hex) {
  throw new Error('Expected an inline Unity RGBAHalf Texture2D.');
}

const raw = Buffer.from(hex, 'hex');
const topMipBytes = width * height * 4 * 2;
if (raw.length < topMipBytes) throw new Error('VAT texture data is truncated.');
fs.mkdirSync(path.dirname(outputPath), { recursive: true });

if (!packRgb8Zlib) {
  fs.writeFileSync(outputPath, raw.subarray(0, topMipBytes));
  console.log(JSON.stringify({ width, height, format: 'RGBAHalf', bytes: topMipBytes }));
  process.exit(0);
}

if (!Number.isInteger(vertexCount) || vertexCount <= 0 || vertexCount > width) {
  throw new Error(`--vertex-count must be between 1 and ${width}.`);
}
const frames = (frameRanges ?? '').split(',').flatMap((range) => {
  const match = range.match(/^(\d+)-(\d+)$/);
  if (!match) throw new Error('--frames must contain comma-separated inclusive ranges such as 1-60,61-79.');
  const start = Number(match[1]);
  const end = Number(match[2]);
  if (start < 0 || end < start || end >= height) throw new Error(`Frame range ${range} is outside 0-${height - 1}.`);
  return Array.from({ length: end - start + 1 }, (_, index) => start + index);
});
if (frames.length === 0) throw new Error('--frames must select at least one row.');

const mins = [Infinity, Infinity, Infinity];
const maxes = [-Infinity, -Infinity, -Infinity];
const readComponent = (frame, vertex, component) => DataUtils.fromHalfFloat(
  raw.readUInt16LE(((frame * width + vertex) * 4 + component) * 2)
);
for (const frame of frames) {
  for (let vertex = 0; vertex < vertexCount; vertex += 1) {
    for (let component = 0; component < 3; component += 1) {
      const value = readComponent(frame, vertex, component);
      mins[component] = Math.min(mins[component], value);
      maxes[component] = Math.max(maxes[component], value);
    }
  }
}

const packed = Buffer.alloc(vertexCount * frames.length * 3);
let packedOffset = 0;
for (const frame of frames) {
  for (let vertex = 0; vertex < vertexCount; vertex += 1) {
    for (let component = 0; component < 3; component += 1) {
      const value = readComponent(frame, vertex, component);
      const range = maxes[component] - mins[component];
      packed[packedOffset] = Math.round((value - mins[component]) / Math.max(range, Number.EPSILON) * 255);
      packedOffset += 1;
    }
  }
}

const compressed = deflateSync(packed, { level: 9 });
const header = Buffer.alloc(40);
header.write('VATQ', 0, 'ascii');
header.writeUInt32LE(1, 4);
header.writeUInt32LE(vertexCount, 8);
header.writeUInt32LE(frames.length, 12);
for (let component = 0; component < 3; component += 1) {
  header.writeFloatLE(mins[component], 16 + component * 4);
  header.writeFloatLE(maxes[component], 28 + component * 4);
}
fs.writeFileSync(outputPath, Buffer.concat([header, compressed]));
console.log(JSON.stringify({
  width: vertexCount,
  height: frames.length,
  format: 'VATQ-RGB8-zlib',
  positionMin: mins,
  positionMax: maxes,
  rawBytes: packed.length,
  compressedBytes: header.length + compressed.length
}));
