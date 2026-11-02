import fs from 'node:fs';
import path from 'node:path';
import { deflateSync } from 'node:zlib';
import { DataUtils } from 'three';

// Unity ships the Christmas passenger as a pre-baked vertex-animation pair:
// `Idle_boy_Santa_mesh.asset` holds the bind-pose mesh, and
// `Idle_boy_Santa_positions.ssvat` holds one RGBA-half position per frame per
// vertex (the w channel is a constant 1 and is ignored). The web runtime wants
// two different containers, so this turns both into them:
//
//   * `VATM` v2 — positions/normals/uv/indices plus an explicit per-vertex
//     animation column, which is what `loadVatGeometry` reads.
//   * `VATQ` — the per-frame positions re-quantised to RGB8 over the whole
//     clip range and zlib-compressed, which is what `loadPackedVatTexture`
//     reads.
//
// Usage:
//   node scripts/extract-unity-santa-vat.mjs <mesh.asset> <positions.ssvat> <outDir>

const args = process.argv.slice(2);
const [meshPath, positionsPath, outputDir] = args;
if (!meshPath || !positionsPath || !outputDir) {
  throw new Error(
    'Usage: node scripts/extract-unity-santa-vat.mjs <mesh.asset> <positions.ssvat> <outDir>'
  );
}

// Unity's vertex data layout for this asset: stream 0 interleaves position,
// normal and tangent (format 0 = float32, 3 components each) and stream 1 holds
// the UV pair. `m_DataSize` is the total byte length, so the stride follows from
// the channel offsets rather than being hard-coded.
function parseMesh(source) {
  const vertexCount = Number(source.match(/m_VertexCount:\s*(\d+)/)?.[1]);
  const dataSize = Number(source.match(/m_DataSize:\s*(\d+)/)?.[1]);
  const hex = source.match(/_typelessdata:\s*([0-9a-f]+)/i)?.[1];
  const vertexSection = source.match(/m_VertexData:\r?\n([\s\S]*?)\r?\n  m_CompressedMesh:/)?.[1];
  if (!vertexCount || !dataSize || !hex || !vertexSection) {
    throw new Error('Expected an inline Unity Mesh with vertex data.');
  }

  const channels = [];
  const channelBlock = vertexSection.match(/m_Channels:\r?\n([\s\S]*)$/)?.[1] ?? '';
  for (const line of channelBlock.split(/\r?\n/)) {
    const match = line.match(/^\s*-\s*stream:\s*(\d+)\s*$/);
    if (match) {
      channels.push({ stream: Number(match[1]), offset: 0, format: 0, dimension: 0 });
      continue;
    }
    const field = line.match(/^\s+(offset|format|dimension):\s*(\d+)\s*$/);
    if (field && channels.length) channels[channels.length - 1][field[1]] = Number(field[2]);
  }

  const data = Buffer.from(hex, 'hex');
  if (data.length < dataSize) throw new Error('Mesh vertex data is truncated.');

  // Only float32 stream-0/stream-1 layouts are accepted. Anything else means
  // the asset was re-exported with a compression setting this script does not
  // understand, and silently reading garbage would be worse than failing.
  const floatChannels = channels.filter((channel) => channel.dimension > 0);
  if (floatChannels.some((channel) => channel.format !== 0)) {
    throw new Error('Only float32 mesh channels are supported.');
  }
  const stream0 = floatChannels.filter((channel) => channel.stream === 0);
  const stream1 = floatChannels.filter((channel) => channel.stream === 1);
  const stride = Math.max(...stream0.map((channel) => channel.offset + channel.dimension * 4));
  const stride1 = stream1.length
    ? Math.max(...stream1.map((channel) => channel.offset + channel.dimension * 4))
    : 0;
  // Unity stores each vertex stream as its own contiguous block, so stream 1
  // starts after every stream-0 vertex. The declared size can carry a little
  // tail padding (16-byte alignment), hence the `>=` check.
  if (data.length < vertexCount * (stride + stride1)) {
    throw new Error(`Unexpected vertex data: ${data.length} bytes for ${vertexCount} vertices.`);
  }
  const stream1Base = vertexCount * stride;

  const read = (vertex, channel, component, base, channelStride) => data.readFloatLE(
    vertex * channelStride + base + channel.offset + component * 4
  );
  const positionChannel = stream0.find((channel) => channel.offset === 0 && channel.dimension === 3);
  const normalChannel = stream0.find((channel) => channel.offset === 12 && channel.dimension === 3);
  const uvChannel = stream1.find((channel) => channel.dimension === 2);
  if (!positionChannel || !normalChannel || !uvChannel) {
    throw new Error('Mesh is missing position, normal, or UV channels.');
  }

  const position = new Float32Array(vertexCount * 3);
  const normal = new Float32Array(vertexCount * 3);
  const uv = new Float32Array(vertexCount * 2);
  for (let vertex = 0; vertex < vertexCount; vertex += 1) {
    for (let component = 0; component < 3; component += 1) {
      position[vertex * 3 + component] = read(vertex, positionChannel, component, 0, stride);
      normal[vertex * 3 + component] = read(vertex, normalChannel, component, 0, stride);
    }
    for (let component = 0; component < 2; component += 1) {
      uv[vertex * 2 + component] = read(vertex, uvChannel, component, stream1Base, stride1);
    }
  }

  // Unity stores the index buffer as raw little-endian bytes; the asset uses
  // 16-bit indices (m_IndexFormat: 0), but 32-bit is accepted defensively.
  const indexFormat = Number(source.match(/m_IndexFormat:\s*(\d+)/)?.[1] ?? 0);
  const indexHex = source.match(/m_IndexBuffer:\s*([0-9a-f]+)/i)?.[1];
  if (!indexHex) throw new Error('Mesh is missing its index buffer.');
  const indexBytes = Buffer.from(indexHex, 'hex');
  const indexCount = indexBytes.length / (indexFormat === 1 ? 4 : 2);
  const index = new Uint32Array(indexCount);
  for (let i = 0; i < indexCount; i += 1) {
    index[i] = indexFormat === 1 ? indexBytes.readUInt32LE(i * 4) : indexBytes.readUInt16LE(i * 2);
  }

  return { vertexCount, position, normal, uv, index };
}

// SSVT v1: magic, version, vertexCount, frameCount, then frameCount *
// vertexCount * 4 half floats (x, y, z, w) in row-major frame order.
function parsePositions(source, vertexCount) {
  const buffer = fs.readFileSync(source);
  const magic = buffer.subarray(0, 4).toString('ascii');
  const version = buffer.readUInt32LE(4);
  const storedVertices = buffer.readUInt32LE(8);
  const frameCount = buffer.readUInt32LE(12);
  if (magic !== 'SSVT' || version !== 1) throw new Error('Unsupported SSVT vertex animation file.');
  if (storedVertices !== vertexCount) {
    throw new Error(`SSVT vertex count ${storedVertices} does not match mesh ${vertexCount}.`);
  }
  const expected = 16 + vertexCount * frameCount * 4 * 2;
  if (buffer.length !== expected) {
    throw new Error(`SSVT payload is ${buffer.length} bytes, expected ${expected}.`);
  }
  return { buffer, frameCount };
}

/**
 * Writes the runtime VATM v2 mesh. Vertices are deduplicated by position+normal
 * +uv so the VAT column index reproduces Unity's per-vertex animation rows;
 * the mesh asset's own index buffer already targets those rows, so the mapping
 * is the identity here.
 */
function writeVatMesh(mesh, outputPath) {
  const { vertexCount, position, normal, uv, index } = mesh;
  const headerSize = 16;
  // vatIndex is an integer column index, not a float: `loadVatGeometry` reads
  // this trailing block with `DataView.getUint32`. Writing it as Float32Array
  // stores 1.0 as 0x3F800000, which the loader then reinterprets as the integer
  // 1065353216 — the shader computes an absurd UV from it and every vertex
  // collapses, leaving an invisible passenger with only its shadow on screen.
  const vatIndex = new Uint32Array(vertexCount);
  for (let i = 0; i < vertexCount; i += 1) vatIndex[i] = i;
  const buffer = Buffer.alloc(
    headerSize + position.byteLength + normal.byteLength + uv.byteLength
    + index.byteLength + vatIndex.byteLength
  );
  buffer.write('VATM', 0, 'ascii');
  buffer.writeUInt32LE(2, 4);
  buffer.writeUInt32LE(vertexCount, 8);
  buffer.writeUInt32LE(index.length, 12);
  let offset = headerSize;
  for (const array of [position, normal, uv]) {
    Buffer.from(array.buffer, array.byteOffset, array.byteLength).copy(buffer, offset);
    offset += array.byteLength;
  }
  Buffer.from(index.buffer, index.byteOffset, index.byteLength).copy(buffer, offset);
  offset += index.byteLength;
  Buffer.from(vatIndex.buffer, vatIndex.byteOffset, vatIndex.byteLength).copy(buffer, offset);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, buffer);
  return buffer.length;
}

/**
 * Quantises every frame's positions to RGB8 over the clip-wide min/max and
 * zlib-compresses them into the VATQ container the runtime already understands.
 */
function writeVatTexture(mesh, positions, outputPath) {
  const { vertexCount } = mesh;
  const { buffer, frameCount } = positions;
  const readComponent = (frame, vertex, component) => DataUtils.fromHalfFloat(
    buffer.readUInt16LE(16 + ((frame * vertexCount + vertex) * 4 + component) * 2)
  );

  const mins = [Infinity, Infinity, Infinity];
  const maxes = [-Infinity, -Infinity, -Infinity];
  for (let frame = 0; frame < frameCount; frame += 1) {
    for (let vertex = 0; vertex < vertexCount; vertex += 1) {
      for (let component = 0; component < 3; component += 1) {
        const value = readComponent(frame, vertex, component);
        mins[component] = Math.min(mins[component], value);
        maxes[component] = Math.max(maxes[component], value);
      }
    }
  }

  const packed = Buffer.alloc(vertexCount * frameCount * 3);
  let packedOffset = 0;
  for (let frame = 0; frame < frameCount; frame += 1) {
    for (let vertex = 0; vertex < vertexCount; vertex += 1) {
      for (let component = 0; component < 3; component += 1) {
        const value = readComponent(frame, vertex, component);
        const range = maxes[component] - mins[component];
        packed[packedOffset] = Math.round(
          (value - mins[component]) / Math.max(range, Number.EPSILON) * 255
        );
        packedOffset += 1;
      }
    }
  }

  const compressed = deflateSync(packed, { level: 9 });
  const header = Buffer.alloc(40);
  header.write('VATQ', 0, 'ascii');
  header.writeUInt32LE(1, 4);
  header.writeUInt32LE(vertexCount, 8);
  header.writeUInt32LE(frameCount, 12);
  for (let component = 0; component < 3; component += 1) {
    header.writeFloatLE(mins[component], 16 + component * 4);
    header.writeFloatLE(maxes[component], 28 + component * 4);
  }
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, Buffer.concat([header, compressed]));
  return {
    frameCount,
    positionMin: mins,
    positionMax: maxes,
    bytes: header.length + compressed.length
  };
}

const mesh = parseMesh(fs.readFileSync(meshPath, 'utf8'));
const positions = parsePositions(positionsPath, mesh.vertexCount);
const meshOut = path.join(outputDir, 'Idle_boy_Santa_vatmesh.bin');
const textureOut = path.join(outputDir, 'Idle_boy_Santa_anim_map.vatq');
const meshBytes = writeVatMesh(mesh, meshOut);
const textureInfo = writeVatTexture(mesh, positions, textureOut);
console.log(JSON.stringify({
  mesh: meshOut,
  meshBytes,
  texture: textureOut,
  ...textureInfo,
  vertexCount: mesh.vertexCount,
  indexCount: mesh.index.length
}));
