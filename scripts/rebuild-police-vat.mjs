import fs from 'node:fs';
import path from 'node:path';
import { gunzipSync, gzipSync } from 'node:zlib';
import { DataUtils } from 'three';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';

const [fbxPath, vatMeshPath, animMapPath, outputPath = vatMeshPath] = process.argv.slice(2);
if (!fbxPath || !vatMeshPath || !animMapPath) {
  throw new Error('Usage: node scripts/rebuild-police-vat.mjs <police.fbx> <vatmesh.bin> <anim_map.asset> [output.bin]');
}

function readOptionalGzip(filePath) {
  const bytes = fs.readFileSync(filePath);
  return bytes[0] === 0x1f && bytes[1] === 0x8b ? gunzipSync(bytes) : bytes;
}

function readVatMesh(filePath) {
  const bytes = readOptionalGzip(filePath);
  if (bytes.toString('ascii', 0, 4) !== 'VATM' || bytes.readUInt32LE(4) !== 1) {
    throw new Error(`Unsupported VAT mesh: ${filePath}`);
  }
  const vertexCount = bytes.readUInt32LE(8);
  const indexCount = bytes.readUInt32LE(12);
  let offset = 16;
  const readFloats = (length) => {
    const values = new Float32Array(length);
    for (let index = 0; index < length; index += 1, offset += 4) values[index] = bytes.readFloatLE(offset);
    return values;
  };
  const positions = readFloats(vertexCount * 3);
  const normals = readFloats(vertexCount * 3);
  const uv = readFloats(vertexCount * 2);
  const indices = new Uint32Array(indexCount);
  for (let index = 0; index < indexCount; index += 1, offset += 4) indices[index] = bytes.readUInt32LE(offset);
  return { vertexCount, indexCount, positions, normals, uv, indices };
}

function readUnityFirstFrame(filePath, vertexCount) {
  const source = fs.readFileSync(filePath, 'utf8');
  const width = Number(source.match(/m_Width:\s*(\d+)/u)?.[1]);
  const hex = source.match(/_typelessdata:\s*([0-9a-f]+)/iu)?.[1];
  if (!width || !hex) throw new Error(`Invalid Unity animation map: ${filePath}`);
  const bytes = Buffer.from(hex, 'hex');
  if (!vertexCount || vertexCount > width) throw new Error('Animation map is smaller than the VAT mesh.');
  const positions = new Float32Array(vertexCount * 3);
  for (let vertex = 0; vertex < vertexCount; vertex += 1) {
    for (let component = 0; component < 3; component += 1) {
      positions[vertex * 3 + component] = DataUtils.fromHalfFloat(
        bytes.readUInt16LE((vertex * 4 + component) * 2)
      );
    }
  }
  return positions;
}

function distanceSquared(source, sourceOffset, animation, animationOffset) {
  const dx = -source[sourceOffset] - animation[animationOffset];
  const dy = source[sourceOffset + 1] - animation[animationOffset + 1];
  const dz = source[sourceOffset + 2] - animation[animationOffset + 2];
  return dx * dx + dy * dy + dz * dz;
}

function matchVertices(sourcePositions, animationPositions) {
  if (sourcePositions.length !== animationPositions.length) {
    throw new Error('Police VAT mesh and animation map vertex counts differ.');
  }
  const count = animationPositions.length / 3;
  const candidates = Array.from({ length: count }, (_, animationIndex) => {
    const entries = [];
    for (let sourceIndex = 0; sourceIndex < count; sourceIndex += 1) {
      entries.push({
        sourceIndex,
        distance: distanceSquared(sourcePositions, sourceIndex * 3, animationPositions, animationIndex * 3)
      });
    }
    entries.sort((a, b) => a.distance - b.distance);
    return entries;
  });
  const order = candidates
    .map((entries, animationIndex) => ({ animationIndex, nearest: entries[0].distance }))
    .sort((a, b) => a.nearest - b.nearest);
  const used = new Set();
  const animationToSource = new Uint32Array(count);
  let maxDistance = 0;
  for (const { animationIndex } of order) {
    const match = candidates[animationIndex].find((entry) => !used.has(entry.sourceIndex));
    if (!match) throw new Error(`Could not match police VAT vertex ${animationIndex}.`);
    used.add(match.sourceIndex);
    animationToSource[animationIndex] = match.sourceIndex;
    maxDistance = Math.max(maxDistance, Math.sqrt(match.distance));
  }
  if (maxDistance > 0.01) throw new Error(`Police VAT vertex matching drifted by ${maxDistance.toFixed(5)}.`);
  return animationToSource;
}

function writeVatMesh(filePath, mesh, animationToSource) {
  const sourceToAnimation = new Uint32Array(mesh.vertexCount);
  const positions = new Float32Array(mesh.vertexCount * 3);
  const normals = new Float32Array(mesh.vertexCount * 3);
  const uv = new Float32Array(mesh.vertexCount * 2);
  for (let animationIndex = 0; animationIndex < mesh.vertexCount; animationIndex += 1) {
    const sourceIndex = animationToSource[animationIndex];
    sourceToAnimation[sourceIndex] = animationIndex;
    positions.set(mesh.positions.subarray(sourceIndex * 3, sourceIndex * 3 + 3), animationIndex * 3);
    normals.set(mesh.normals.subarray(sourceIndex * 3, sourceIndex * 3 + 3), animationIndex * 3);
    uv.set(mesh.uv.subarray(sourceIndex * 2, sourceIndex * 2 + 2), animationIndex * 2);
  }
  const indices = Uint32Array.from(mesh.indices, (sourceIndex) => sourceToAnimation[sourceIndex]);
  const header = Buffer.alloc(16);
  header.write('VATM', 0, 'ascii');
  header.writeUInt32LE(1, 4);
  header.writeUInt32LE(mesh.vertexCount, 8);
  header.writeUInt32LE(mesh.indexCount, 12);
  const payload = Buffer.concat([
    header,
    Buffer.from(positions.buffer),
    Buffer.from(normals.buffer),
    Buffer.from(uv.buffer),
    Buffer.from(indices.buffer)
  ]);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, gzipSync(payload, { level: 9 }));
}

const fbxBytes = readOptionalGzip(fbxPath);
const root = new FBXLoader().parse(
  fbxBytes.buffer.slice(fbxBytes.byteOffset, fbxBytes.byteOffset + fbxBytes.byteLength),
  ''
);
let sourceGeometry = null;
root.traverse((object) => {
  if (!sourceGeometry && object.isMesh) sourceGeometry = object.geometry;
});
if (!sourceGeometry?.attributes.position) throw new Error('Police FBX contains no mesh.');

const mesh = readVatMesh(vatMeshPath);
const animationToSource = matchVertices(mesh.positions, readUnityFirstFrame(animMapPath, mesh.vertexCount));
writeVatMesh(outputPath, mesh, animationToSource);
console.log(JSON.stringify({ outputPath, vertices: mesh.vertexCount, indices: mesh.indexCount }));
