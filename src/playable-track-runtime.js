// Runtime support for the 3D and sprite tracks recovered from shipped
// playables (footage8/9/10/11).
//
// The playables carried each track as a gzip'd three.js JSON geometry bundle
// plus an inline artwork. Re-shipping that would cost 227-269 KB of base64 per
// track, so the geometry lives in this project's own CTK1 container instead:
// gzip'd typed arrays that decode straight into BufferGeometry attributes with
// no JSON parsing. Everything here is pure maths and buffer work; the renderer
// (scene-view.js) owns the THREE objects.

// The transform the playables apply to an authored track: translate, rotate
// about Y, mirror Z, scale, then move the pivot to the origin. Authored points
// are y-up Unity space, so the mirrored Z axis is what puts the track's front
// edge toward the camera exactly as the reference does.
export function createPlayableTrackMatrix(THREE, tuning = {}, layout = {}) {
  const defaults = layout.defaults ?? {};
  const value = (key) => {
    const candidate = tuning?.[key];
    return Number.isFinite(Number(candidate)) ? Number(candidate) : Number(defaults[key]) || 0;
  };
  const scale = Math.max(0.1, value('scale') || 1);
  const pivot = Array.isArray(layout.pivot) ? layout.pivot : [0, 0, 0];
  return new THREE.Matrix4()
    .makeTranslation(value('positionX'), value('positionY'), value('positionZ'))
    .multiply(new THREE.Matrix4().makeRotationY(THREE.MathUtils.degToRad(value('rotationYDegrees'))))
    .multiply(new THREE.Matrix4().makeScale(scale, scale, -scale))
    .multiply(new THREE.Matrix4().makeTranslation(-pivot[0], -pivot[1], -pivot[2]));
}

// Maps a track's authored 3D points through the display matrix. The playable
// feeds points3D (not splinePoints) to the spline, because a 3D track's
// authored curve really does climb and fall.
export function mapPlayableTrackPoints(THREE, points, matrix) {
  return (points ?? []).map((point) => {
    const mapped = new THREE.Vector3(point[0], point[1], point[2]).applyMatrix4(matrix);
    return mapped;
  });
}

export const PLAYABLE_TRACK_CONTAINER_MAGIC = 'CTK1';
export const PLAYABLE_TRACK_CONTAINER_VERSION = 1;

// Decodes a CTK1 buffer into plain arrays the renderer turns into attributes.
// Layout per mesh: u16 nameLength, name, u8 shadow, u32 vertexCount,
// u32 indexCount, f32 position[3n], f32 normal[3n], f32 uv[2n], u32 index[m].
export function decodePlayableTrackContainer(input) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const magic = String.fromCharCode(...bytes.subarray(0, 4));
  if (magic !== PLAYABLE_TRACK_CONTAINER_MAGIC) {
    throw new Error(`track container magic "${magic}" is not ${PLAYABLE_TRACK_CONTAINER_MAGIC}`);
  }
  const version = bytes[4];
  if (version !== PLAYABLE_TRACK_CONTAINER_VERSION) {
    throw new Error(`track container version ${version} is not ${PLAYABLE_TRACK_CONTAINER_VERSION}`);
  }
  const meshCount = bytes[5];
  const meshes = [];
  let offset = 6;
  const need = (count) => {
    if (offset + count > bytes.byteLength) {
      throw new Error('track container is truncated');
    }
  };
  for (let meshIndex = 0; meshIndex < meshCount; meshIndex += 1) {
    need(2);
    const nameLength = view.getUint16(offset, true);
    offset += 2;
    need(nameLength + 1 + 8);
    const name = new TextDecoder().decode(bytes.subarray(offset, offset + nameLength));
    offset += nameLength;
    const shadow = bytes[offset] === 1;
    offset += 1;
    const vertexCount = view.getUint32(offset, true);
    offset += 4;
    const indexCount = view.getUint32(offset, true);
    offset += 4;
    // The variable-length name leaves the cursor unaligned, and a typed-array
    // view over the whole buffer would throw. Copying the block keeps the
    // decoder correct for any name length at the cost of one allocation.
    const readFloatBlock = (count) => {
      const byteLength = count * 4;
      need(byteLength);
      const copy = new Uint8Array(byteLength);
      copy.set(bytes.subarray(offset, offset + byteLength));
      offset += byteLength;
      return new Float32Array(copy.buffer);
    };
    const readIndexBlock = (count) => {
      const byteLength = count * 4;
      need(byteLength);
      const copy = new Uint8Array(byteLength);
      copy.set(bytes.subarray(offset, offset + byteLength));
      offset += byteLength;
      return new Uint32Array(copy.buffer);
    };
    const position = readFloatBlock(vertexCount * 3);
    const normal = readFloatBlock(vertexCount * 3);
    const uv = readFloatBlock(vertexCount * 2);
    const index = readIndexBlock(indexCount);
    meshes.push({ name, shadow, position, normal, uv, index });
  }
  return meshes;
}

// Grid-bucketed triangle surface sampler. The playables use the same idea to
// drop passengers onto a sloped track: bucket the road triangles into square
// cells, then at render time find the triangle under a point and read its
// height. Road triangles are selected by UV, not by geometry, because the
// track mesh also contains the raised side walls.
export function createPlayableTrackSurface(geometryData, { cellSize = 0.15, roadOnly = true, roadMaxU = 0.25 } = {}) {
  const cells = new Map();
  const { position, index, uv } = geometryData;
  const triangleCount = Math.floor((index?.length ?? position.length / 3) / 3);
  const readVertex = (absolute) => {
    const vertexIndex = index ? index[absolute] : absolute;
    return {
      x: position[vertexIndex * 3],
      y: position[vertexIndex * 3 + 1],
      z: position[vertexIndex * 3 + 2],
      u: uv ? uv[vertexIndex * 2] : 0
    };
  };
  let roadTriangles = 0;
  for (let triangle = 0; triangle < triangleCount; triangle += 1) {
    const a = readVertex(triangle * 3);
    const b = readVertex(triangle * 3 + 1);
    const c = readVertex(triangle * 3 + 2);
    if (roadOnly && !(a.u <= roadMaxU && b.u <= roadMaxU && c.u <= roadMaxU)) continue;
    const denominator = (b.z - c.z) * (a.x - c.x) + (c.x - b.x) * (a.z - c.z);
    if (Math.abs(denominator) < 1e-9) continue;
    roadTriangles += 1;
    const triangleRecord = { a, b, c, denominator };
    const minX = Math.floor(Math.min(a.x, b.x, c.x) / cellSize);
    const maxX = Math.floor(Math.max(a.x, b.x, c.x) / cellSize);
    const minZ = Math.floor(Math.min(a.z, b.z, c.z) / cellSize);
    const maxZ = Math.floor(Math.max(a.z, b.z, c.z) / cellSize);
    for (let cellX = minX; cellX <= maxX; cellX += 1) {
      for (let cellZ = minZ; cellZ <= maxZ; cellZ += 1) {
        const key = `${cellX},${cellZ}`;
        if (!cells.has(key)) cells.set(key, []);
        cells.get(key).push(triangleRecord);
      }
    }
  }
  return {
    cellSize,
    roadTriangles,
    // Returns the surface height under (x, z), or null when the point is off
    // the road. `referenceY` is the height the caller expects (the curve's own
    // Y): a stacked track -- the spiral's three turns -- has several triangles
    // over the same XZ cell, and picking the one nearest the reference height is
    // what keeps a passenger on its own layer. Without it the sampler resolves
    // to whichever layer sits closest to y=0 and the inner turns clip through
    // the outer ones. `highest` overrides that to take the top face instead.
    heightAt(x, z, { highest = false, referenceY = 0 } = {}) {
      const records = cells.get(`${Math.floor(x / cellSize)},${Math.floor(z / cellSize)}`);
      if (!records) return null;
      let best = null;
      let bestScore = Infinity;
      for (const { a, b, c, denominator } of records) {
        const u = ((b.z - c.z) * (x - c.x) + (c.x - b.x) * (z - c.z)) / denominator;
        const v = ((c.z - a.z) * (x - c.x) + (a.x - c.x) * (z - c.z)) / denominator;
        if (u < -1e-7 || v < -1e-7 || u + v > 1 + 1e-7) continue;
        const height = u * a.y + v * b.y + (1 - u - v) * c.y;
        const score = highest ? -height : Math.abs(height - referenceY);
        if (score < bestScore) {
          bestScore = score;
          best = height;
        }
      }
      return best;
    }
  };
}

// The boarding window a 3D track exposes: a centre percent and a half width,
// both authored in the playable's own tuning.
//
// Capacity is deliberately NOT derived from curve length / rowSpacing. That is
// the formula the reference uses for a continuously refilled track, but a Bus
// Loop level carries a fixed passenger list: a 16-unit track at 0.2 spacing
// would claim 84 slots while the level only has ~36 passengers to place, and
// every empty slot past the last passenger reads as a permanently unfilled
// belt. Capacity is therefore capped by how many passengers the level can
// actually supply, which is what makes the first fill able to finish.
export function resolvePlayableTrackBoarding(curveLength, tuning = {}, layout = {}, { passengerTotal = Infinity } = {}) {
  const defaults = layout.defaults ?? {};
  const value = (key) => {
    const candidate = tuning?.[key];
    return Number.isFinite(Number(candidate)) ? Number(candidate) : Number(defaults[key]) || 0;
  };
  const rowSpacing = Math.max(0.12, value('rowSpacing') || 0.2);
  const geometricCapacity = Math.min(200, Math.max(2, Math.round(curveLength / rowSpacing)));
  // Never ask for more slots than the level has passengers to put in them, and
  // keep at least one so a tiny track still works.
  const supply = Number.isFinite(passengerTotal) ? Math.max(1, Math.floor(passengerTotal)) : geometricCapacity;
  const capacity = Math.max(1, Math.min(geometricCapacity, supply));
  const centre = Math.min(1, Math.max(0, value('boardingPositionPercent') / 100));
  const halfWidth = Math.min(0.4, Math.max(0.005, value('boardingWidthPercent') / 200));
  const wrap = (percent) => ((percent % 1) + 1) % 1;
  return {
    capacity,
    geometricCapacity,
    continuousSpeed: Math.min(3, Math.max(0.1, value('speed') || 0.8)),
    initialFillSpeedMultiplier: Math.min(8, Math.max(1, value('initialFillSpeedMultiplier') || 4)),
    exitStart: wrap(centre - halfWidth),
    exitEnd: wrap(centre + halfWidth)
  };
}

// A sprite track's artwork is a supplied 2.5D matte: one flat quad carrying the
// already-shaded track, split into four bands so the long straight run keeps
// clean UVs. Unity's sprite rect is bottom-up, the quad is built in authored
// space, then the captured sprite matrix places it.
export function buildSpriteTrackQuad(THREE, sprite) {
  const {
    x = 0, y = 0, width = 1, height = 1,
    imageWidth = 1, imageHeight = 1, pixelsPerUnit = 100, matrix
  } = sprite ?? {};
  // Band breaks measured on the shipped matte: the straight run at the top,
  // then the three loop bands below it.
  const bandSplit = [1180, 840, 1100];
  const positions = [];
  const uvs = [];
  const indices = [];
  const top = imageHeight - y - height;
  const bottom = top + height;
  const pushQuad = (left, topY, right, bottomY, uvLeft = left, uvRight = right) => {
    const base = positions.length / 3;
    for (const [px, py, u] of [
      [left, topY, uvLeft], [right, topY, uvRight],
      [left, bottomY, uvLeft], [right, bottomY, uvRight]
    ]) {
      positions.push(
        (px - x - width / 2) / pixelsPerUnit,
        (height / 2 - py + top) / pixelsPerUnit,
        0
      );
      uvs.push(u / imageWidth, 1 - py / imageHeight);
    }
    indices.push(base, base + 2, base + 1, base + 1, base + 2, base + 3);
  };
  const [splitA, splitB, splitC] = bandSplit;
  pushQuad(x, top, x + width, splitA);
  pushQuad(x, splitA, splitB, bottom);
  pushQuad(splitB, splitA, splitC, bottom, 750, 820);
  pushQuad(splitC, splitA, x + width, bottom);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  if (Array.isArray(matrix) && matrix.length === 16) {
    geometry.applyMatrix4(new THREE.Matrix4().fromArray(matrix));
  }
  return geometry;
}

export function isPlayableTrackLayout(layout) {
  return layout?.kind === 'model' || layout?.kind === 'sprite';
}

export function isThreeDimensionalTrackLayout(layout) {
  return layout?.kind === 'model';
}

// Both imported track families author their points in the prefab's own local
// space and apply the same display matrix, so the curve builder is shared. Only
// the artwork differs: a model track draws its mesh, a sprite track draws a flat
// artwork plane through the captured sprite matrix.
export function usesAuthoredTrackTransform(layout) {
  return isPlayableTrackLayout(layout) && Array.isArray(layout?.points3D);
}
