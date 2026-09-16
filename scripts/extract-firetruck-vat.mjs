import fs from 'node:fs';
import path from 'node:path';
import { deflateSync } from 'node:zlib';
import { DataUtils } from 'three';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';

const [sourceMapPath, sourceFbxPath, outputMeshPath, outputTexturePath] = process.argv.slice(2);
if (!sourceMapPath || !sourceFbxPath || !outputMeshPath || !outputTexturePath) {
  throw new Error(
    'Usage: node scripts/extract-firetruck-vat.mjs '
    + '<Unity anim_map.asset> <passenger.FBX> <vatmesh.bin> <anim_map.vatq>'
  );
}

const mapSource = fs.readFileSync(sourceMapPath, 'utf8');
const width = Number(mapSource.match(/m_Width:\s*(\d+)/u)?.[1]);
const height = Number(mapSource.match(/m_Height:\s*(\d+)/u)?.[1]);
const format = Number(mapSource.match(/m_TextureFormat:\s*(\d+)/u)?.[1]);
const hex = mapSource.match(/_typelessdata:\s*([0-9a-f]+)/iu)?.[1];
if (width !== 1024 || height !== 128 || format !== 17 || !hex) {
  throw new Error('Expected the inline 1024x128 Unity RGBAHalf passenger VAT.');
}

const raw = Buffer.from(hex, 'hex');
const sourceFrameStart = 1;
const frameCount = 79;
const readPosition = (frame, vertex) => {
  const result = [];
  for (let component = 0; component < 3; component += 1) {
    const offset = ((frame * width + vertex) * 4 + component) * 2;
    result.push(DataUtils.fromHalfFloat(raw.readUInt16LE(offset)));
  }
  return result;
};
const sourcePoints = Array.from({ length: width }, (_, vertex) => readPosition(sourceFrameStart, vertex));
const validIndices = sourcePoints
  .map((point, index) => point.every((component) => component > -10) ? index : -1)
  .filter((index) => index >= 0);
if (!validIndices.length) throw new Error('The passenger VAT contains no valid vertices.');

const fbxBytes = fs.readFileSync(sourceFbxPath);
const fbx = new FBXLoader().parse(
  fbxBytes.buffer.slice(fbxBytes.byteOffset, fbxBytes.byteOffset + fbxBytes.byteLength),
  path.dirname(sourceFbxPath) + path.sep
);
let sourceMesh = null;
fbx.traverse((object) => {
  if (!sourceMesh && object.isMesh && object.name === 'Idle_boy_firefighter') sourceMesh = object;
});
if (!sourceMesh) throw new Error('Could not find Idle_boy_firefighter in the FBX.');

const sourceGeometry = sourceMesh.geometry;
const sourcePosition = sourceGeometry.attributes.position;
const sourceNormal = sourceGeometry.attributes.normal;
const sourceUv = sourceGeometry.attributes.uv;
const sourceIndices = sourceGeometry.index?.array
  ?? Uint32Array.from({ length: sourcePosition.count }, (_, index) => index);
// Unity's firefighter VAT was authored in the opposite X handedness from the
// FBX mesh. Match in runtime space, then mirror positions in the shader.
const vatPointInSourceSpace = ([x, y, z]) => [-x, y, z];
const nearest = (x, y, z) => {
  let bestIndex = validIndices[0];
  let bestDistance = Infinity;
  for (const index of validIndices) {
    const point = vatPointInSourceSpace(sourcePoints[index]);
    const distance = (point[0] - x) ** 2 + (point[1] - y) ** 2 + (point[2] - z) ** 2;
    if (distance < bestDistance) {
      bestDistance = distance;
      bestIndex = index;
    }
  }
  return bestIndex;
};

const vatIndexBySourceIndex = new Map(validIndices.map((index, compactIndex) => [index, compactIndex]));
const vatIndexForSourceVertex = new Uint32Array(sourcePosition.count);
for (let sourceVertexIndex = 0; sourceVertexIndex < sourcePosition.count; sourceVertexIndex += 1) {
  const vatSourceIndex = nearest(
    sourcePosition.getX(sourceVertexIndex),
    sourcePosition.getY(sourceVertexIndex),
    sourcePosition.getZ(sourceVertexIndex)
  );
  vatIndexForSourceVertex[sourceVertexIndex] = vatIndexBySourceIndex.get(vatSourceIndex);
}
const vertexCount = sourcePosition.count;
const vatVertexCount = validIndices.length;
if (vatVertexCount > width) throw new Error('Generated VAT texture exceeds its source width.');

const position = new Float32Array(vertexCount * 3);
const normal = new Float32Array(vertexCount * 3);
const uv = new Float32Array(vertexCount * 2);
const vatIndex = new Uint32Array(vertexCount);
for (let sourceVertexIndex = 0; sourceVertexIndex < vertexCount; sourceVertexIndex += 1) {
  const vatSourceIndex = validIndices[vatIndexForSourceVertex[sourceVertexIndex]];
  const point = sourcePoints[vatSourceIndex];
  position.set(point, sourceVertexIndex * 3);
  normal[sourceVertexIndex * 3] = sourceNormal.getX(sourceVertexIndex);
  normal[sourceVertexIndex * 3 + 1] = sourceNormal.getY(sourceVertexIndex);
  normal[sourceVertexIndex * 3 + 2] = sourceNormal.getZ(sourceVertexIndex);
  uv[sourceVertexIndex * 2] = sourceUv.getX(sourceVertexIndex);
  uv[sourceVertexIndex * 2 + 1] = sourceUv.getY(sourceVertexIndex);
  vatIndex[sourceVertexIndex] = vatIndexForSourceVertex[sourceVertexIndex];
}

const index = new Uint32Array(sourceIndices.length);
for (let triangleIndex = 0; triangleIndex < sourceIndices.length; triangleIndex += 3) {
  const a = sourceIndices[triangleIndex];
  const b = sourceIndices[triangleIndex + 1];
  const c = sourceIndices[triangleIndex + 2];
  // The shader mirror brings these VAT positions back into the FBX space, so
  // keep the FBX winding and normals unchanged.
  index[triangleIndex] = a;
  index[triangleIndex + 1] = b;
  index[triangleIndex + 2] = c;
}
const meshHeader = Buffer.alloc(16);
meshHeader.write('VATM', 0, 'ascii');
meshHeader.writeUInt32LE(2, 4);
meshHeader.writeUInt32LE(vertexCount, 8);
meshHeader.writeUInt32LE(index.length, 12);
const meshPayload = Buffer.concat([
  Buffer.from(position.buffer),
  Buffer.from(normal.buffer),
  Buffer.from(uv.buffer),
  Buffer.from(vatIndex.buffer),
  Buffer.from(index.buffer)
]);
fs.mkdirSync(path.dirname(outputMeshPath), { recursive: true });
fs.writeFileSync(outputMeshPath, Buffer.concat([meshHeader, meshPayload]));

const mins = [Infinity, Infinity, Infinity];
const maxes = [-Infinity, -Infinity, -Infinity];
const frameData = new Uint8Array(vatVertexCount * frameCount * 3);
const readFrameComponent = (frame, vertex, component) => {
  const sourceIndex = validIndices[vertex];
  const offset = (((frame + sourceFrameStart) * width + sourceIndex) * 4 + component) * 2;
  return DataUtils.fromHalfFloat(raw.readUInt16LE(offset));
};
for (let frame = 0; frame < frameCount; frame += 1) {
  for (let vertex = 0; vertex < vatVertexCount; vertex += 1) {
    for (let component = 0; component < 3; component += 1) {
      const value = readFrameComponent(frame, vertex, component);
      mins[component] = Math.min(mins[component], value);
      maxes[component] = Math.max(maxes[component], value);
    }
  }
}
let packedOffset = 0;
for (let frame = 0; frame < frameCount; frame += 1) {
  for (let vertex = 0; vertex < vatVertexCount; vertex += 1) {
    for (let component = 0; component < 3; component += 1) {
      const value = readFrameComponent(frame, vertex, component);
      frameData[packedOffset] = Math.round(
        (value - mins[component]) / Math.max(maxes[component] - mins[component], Number.EPSILON) * 255
      );
      packedOffset += 1;
    }
  }
}
const textureHeader = Buffer.alloc(40);
textureHeader.write('VATQ', 0, 'ascii');
textureHeader.writeUInt32LE(1, 4);
textureHeader.writeUInt32LE(vatVertexCount, 8);
textureHeader.writeUInt32LE(frameCount, 12);
for (let component = 0; component < 3; component += 1) {
  textureHeader.writeFloatLE(mins[component], 16 + component * 4);
  textureHeader.writeFloatLE(maxes[component], 28 + component * 4);
}
fs.mkdirSync(path.dirname(outputTexturePath), { recursive: true });
fs.writeFileSync(outputTexturePath, Buffer.concat([textureHeader, deflateSync(frameData, { level: 9 })]));
console.log(JSON.stringify({ vertexCount, vatVertexCount, indexCount: index.length, frames: frameCount, mins, maxes }));
