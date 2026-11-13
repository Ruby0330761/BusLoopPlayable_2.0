// Imports the 3D conveyor tracks that only exist inside shipped playables.
//
// The shipped Bus Loop playables carry their selected track as a gzip'd
// three.js BufferGeometry JSON bundle inlined as a base64 data URI. Re-used
// verbatim that costs 227-269 KB of base64 per track and needs a JSON parser at
// runtime. This tool re-packs the same geometry into the project's own CTK1
// container (gzip'd typed arrays), which is 88.6/52.7/67.2 KB on disk and
// 118/70/90 KB once base64'd, and writes one .ctk per track under
// public/assets/unity/conveyors/tracks/.
//
// Usage: node scripts/import-playable-footage-tracks.mjs <playable.html> [...]
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUTPUT_DIR = path.join(ROOT, 'public/assets/unity/conveyors/tracks');
const MODULE_PATH = path.join(ROOT, 'src/playable-track-layouts.js');
const TRACK_IDS = Object.freeze(['footage8', 'footage9', 'footage10', 'footage11']);
const TRACK_ASSET_ROOT = '/assets/unity/conveyors/tracks';

// Per-track editor defaults, taken from the playable that actually selects that
// track. This distinction matters: a playable also carries preset blocks for
// tracks it does not show, and those presets are stale/different values. Reading
// footage10 out of Q37 (which selects footage11) gave rowSpacing 0.32 and
// boarding 70.75%, while Q25V3 -- the file that really runs footage10 -- authors
// 0.23 and 85%. The wrong numbers put passengers at ~1/3 the density the
// reference shows.
const TRACK_DEFAULTS = Object.freeze({
  // Q1V1, the only playable that runs footage8. This is the track with a road join.
  footage8: {
    positionX: 0, positionY: 0.025, positionZ: -2.2, scale: 2, rotationYDegrees: 0,
    rowSpacing: 0.2, speed: 0.8, initialFillSpeedMultiplier: 4,
    passengerSizeMultiplier: 1.2, roadJoinLanding: 0.14, roadJoinSteps: 3,
    footClearance: 0.008, roadJoinEnabled: 1, roadJoinExtension: -0.18,
    boardingPositionPercent: 30, boardingWidthPercent: 6, showBoardingZone: 0
  },
  // Q25V2.
  footage9: {
    positionX: 0, positionY: 0.1, positionZ: -2.2, scale: 1.75, rotationYDegrees: 0,
    rowSpacing: 0.25, speed: 0.8, initialFillSpeedMultiplier: 4,
    footClearance: 0.008, boardingPositionPercent: 65.4, boardingWidthPercent: 10,
    showBoardingZone: 1
  },
  // Q25V3. Only the right queue is shown.
  footage10: {
    positionX: -0.35, positionY: 0.15, positionZ: -2.35, scale: 1.8, rotationYDegrees: 0,
    rowSpacing: 0.23, speed: 0.8, initialFillSpeedMultiplier: 4,
    footClearance: 0.008, boardingPositionPercent: 85, boardingWidthPercent: 7.8,
    showBoardingZone: 0, showLeftQueue: 0
  },
  // Q37V1. A sprite track with its own tail-queue model rather than the belt
  // fill: passengers advance along the matte from the tail at passengerSpeed,
  // and the warning beacons light from warningStartPercent.
  footage11: {
    positionX: 0.1, positionY: 1.05, positionZ: -2.15, scale: 1.55, rotationYDegrees: 0,
    rowSpacing: 0.2, speed: 0.8, initialFillSpeedMultiplier: 4,
    footClearance: 0.008, boardingPositionPercent: 35.2, boardingWidthPercent: 40,
    showBoardingZone: 1,
    queueEnabled: 1, passengerSpeed: 0.25, retreatSpeed: 0.9,
    initialHeadPercent: 42, disableAcceleration: 1, warningStartPercent: 52.2
  }
});

// Display labels for the editor dropdown. The playable's own labels carry a
// Chinese suffix describing the entrance shape, which is what an operator needs.
const TRACK_LABELS = Object.freeze({
  footage8: 'Footage8（立体双入口）',
  footage9: 'Footage9（立体双入口）',
  footage10: 'Footage10（立体双入口）',
  footage11: 'Footage11（Q37 平面轨道·单入口）'
});

// CTK1 layout: magic, version, mesh count, then per mesh a name, a shadow flag,
// vertex count, index count, and the raw position/normal/uv/index blocks.
const MAGIC = 'CTK1';
const VERSION = 1;

function walkBalanced(source, openIndex, open = '{', close = '}') {
  let depth = 0;
  let quote = null;
  let escaped = false;
  for (let index = openIndex; index < source.length; index += 1) {
    const char = source[index];
    if (quote) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === quote) quote = null;
      continue;
    }
    if (char === '"' || char === "'" || char === '`') {
      quote = char;
      continue;
    }
    if (char === open) depth += 1;
    else if (char === close) {
      depth -= 1;
      if (depth === 0) return source.slice(openIndex, index + 1);
    }
  }
  return null;
}

// Lays out one mesh as: u16 nameLength, name, u8 shadow, u32 vertexCount,
// u32 indexCount, f32 position[3n], f32 normal[3n], f32 uv[2n], u32 index[m].
function encodeMesh(mesh, warnings) {
  const data = mesh?.geometry?.data ?? {};
  const attributes = data.attributes ?? {};
  const position = attributes.position?.array;
  const index = data.index?.array;
  if (!Array.isArray(position) || !Array.isArray(index)) {
    throw new Error(`mesh ${mesh?.name ?? '<unnamed>'} has no position/index arrays`);
  }
  const normal = attributes.normal?.array ?? [];
  const uv = attributes.uv?.array ?? [];
  const vertexCount = Math.floor(position.length / 3);
  if (normal.length !== vertexCount * 3) {
    warnings.push(`${mesh.name}: normals missing or mismatched, filled with +Y`);
  }
  if (uv.length !== vertexCount * 2) {
    warnings.push(`${mesh.name}: uv missing or mismatched, filled with 0`);
  }

  const name = Buffer.from(String(mesh.name ?? 'mesh'), 'utf8');
  const header = Buffer.alloc(2 + name.length + 1 + 4 + 4);
  let offset = 0;
  header.writeUInt16LE(name.length, offset); offset += 2;
  name.copy(header, offset); offset += name.length;
  header.writeUInt8(mesh.shadow ? 1 : 0, offset); offset += 1;
  header.writeUInt32LE(vertexCount, offset); offset += 4;
  header.writeUInt32LE(index.length, offset);

  const positions = new Float32Array(position);
  const normals = normal.length === vertexCount * 3
    ? new Float32Array(normal)
    : Float32Array.from({ length: vertexCount * 3 }, (_, i) => (i % 3 === 1 ? 1 : 0));
  const uvs = uv.length === vertexCount * 2
    ? new Float32Array(uv)
    : new Float32Array(vertexCount * 2);
  const indices = new Uint32Array(index);

  return Buffer.concat([
    header,
    Buffer.from(positions.buffer, positions.byteOffset, positions.byteLength),
    Buffer.from(normals.buffer, normals.byteOffset, normals.byteLength),
    Buffer.from(uvs.buffer, uvs.byteOffset, uvs.byteLength),
    Buffer.from(indices.buffer, indices.byteOffset, indices.byteLength)
  ]);
}

function encodeTrack(meshes, warnings) {
  const parts = [];
  const magic = Buffer.from(MAGIC, 'ascii');
  const head = Buffer.alloc(magic.length + 1 + 1);
  magic.copy(head, 0);
  head.writeUInt8(VERSION, magic.length);
  head.writeUInt8(meshes.length, magic.length + 1);
  parts.push(head);
  for (const mesh of meshes) parts.push(encodeMesh(mesh, warnings));
  return Buffer.concat(parts);
}

// Finds the selected track object in a playable and returns its parsed literal.
function readTrackLayout(html, trackId) {
  const anchor = html.indexOf(`id:"${trackId}"`);
  if (anchor < 0) return null;
  const braceIndex = html.lastIndexOf('{', anchor);
  const literal = walkBalanced(html, braceIndex);
  if (!literal) throw new Error(`${trackId}: could not read the layout object`);
  // The bundle is minified object-literal syntax, so it is evaluated rather
  // than parsed. Only the literal's own text is handed to the evaluator.
  const evaluate = new Function(`return ({${literal.slice(1, -1)}});`);
  return evaluate();
}

function decodeModelBundle(uri) {
  const marker = 'base64,';
  const offset = uri.indexOf(marker);
  if (offset < 0) throw new Error('track model asset is not a base64 data URI');
  const bytes = Buffer.from(uri.slice(offset + marker.length), 'base64');
  if (bytes.length < 100) throw new Error('track model asset is an omitted placeholder');
  const json = bytes[0] === 0x1f && bytes[1] === 0x8b ? zlib.gunzipSync(bytes) : bytes;
  return JSON.parse(json.toString('utf8'));
}

// Reads which track a playable actually selects. A playable also carries preset
// tuning blocks for tracks it never shows, and those presets hold different
// numbers, so only the active source may contribute defaults.
function readSelectedTrackId(html) {
  const match = html.match(/conveyorLayout:\s*\{\s*selected:\s*"([A-Za-z0-9]+)"/);
  return match ? match[1] : null;
}

// Reads the `<track>Conveyor:{...}` tuning block a playable authored.
function readTrackTuning(html, trackId) {
  const anchor = html.indexOf(`${trackId}Conveyor:{`);
  if (anchor < 0) return null;
  const braceIndex = html.indexOf('{', anchor);
  const literal = walkBalanced(html, braceIndex);
  if (!literal) return null;
  return new Function(`return ({${literal.slice(1, -1)}});`)();
}

function importFromPlayable(html, label) {
  const results = [];
  const selectedTrackId = readSelectedTrackId(html);
  for (const trackId of TRACK_IDS) {
    const layout = readTrackLayout(html, trackId);
    if (!layout) continue;
    // Only the selected track's tuning is trustworthy; anything else in the
    // file is an inactive preset that may not even run in that build.
    const tuning = selectedTrackId === trackId ? readTrackTuning(html, trackId) : null;
    const kind = layout.kind === 'sprite' ? 'sprite' : 'model';
    if (kind === 'model') {
      const modelUri = layout.assets?.model;
      if (typeof modelUri !== 'string' || modelUri.length < 200) continue;
      const warnings = [];
      const bundle = decodeModelBundle(modelUri);
      const meshes = bundle.meshes ?? [];
      if (!meshes.length) throw new Error(`${trackId}: model bundle has no meshes`);
      const container = encodeTrack(meshes, warnings);
      const gzipped = zlib.gzipSync(container, { level: 9 });
      const fileName = `${trackId}.ctk`;
      fs.writeFileSync(path.join(OUTPUT_DIR, fileName), gzipped);
      results.push({
        trackId,
        kind,
        layout,
        fileName,
        source: label,
        meshes: meshes.length,
        vertices: meshes.reduce((sum, mesh) => sum + Math.floor((mesh.geometry?.data?.attributes?.position?.array?.length ?? 0) / 3), 0),
        bytes: gzipped.length,
        tuning,
        selected: selectedTrackId === trackId,
        warnings
      });
      continue;
    }
    // Sprite tracks ship as a flat artwork plane plus a small sprite matrix and
    // a gameplay detail map (Q37's centre pit). Only the artwork is an asset.
    const loopUri = layout.assets?.loopScene;
    if (typeof loopUri !== 'string' || loopUri.length < 200) continue;
    results.push({
      trackId,
      kind,
      layout,
      fileName: `${trackId}_loop.png`,
      source: label,
      meshes: 0,
      vertices: 0,
      bytes: 0,
      tuning,
      selected: selectedTrackId === trackId,
      warnings: []
    });
  }
  return results;
}

// Builds the catalog entries. A model track keeps its authored 3D points and
// pivot so the renderer can rebuild the exact Unity transform, and a sprite
// track keeps its 2.5D sprite matrix so the flat artwork lands where the
// playable draws it.
// `measuredTuning` is the block the selecting playable actually authored. It is
// preferred over TRACK_DEFAULTS, which is only a fallback for a track whose
// own playable was not part of the import set.
function buildLayoutEntry(trackId, layout, measuredTuning = null) {
  const kind = layout.kind === 'sprite' ? 'sprite' : 'model';
  const entry = {
    id: trackId,
    label: TRACK_LABELS[trackId] ?? trackId,
    kind,
    sourcePrefab: layout.sourcePrefab,
    conveyorCapacity: layout.conveyorCapacity,
    queueCapacities: [...layout.queueCapacities],
    exitStart: layout.exitStart,
    exitEnd: layout.exitEnd,
    splineType: layout.splineType,
    closed: kind === 'model',
    splinePoints: layout.splinePoints,
    queuePaths: layout.queuePaths,
    points3D: layout.points3D,
    queuePoints3D: layout.queuePoints3D,
    pivot: layout.pivot,
    defaults: { ...(TRACK_DEFAULTS[trackId] ?? {}), ...(measuredTuning ?? {}) },
    assets: kind === 'model'
      ? {
        model: `${TRACK_ASSET_ROOT}/${trackId}.ctk`,
        surface: `${TRACK_ASSET_ROOT}/footage_track_surface.png`,
        shadow: `${TRACK_ASSET_ROOT}/${trackId}_shadow.png`
      }
      : {
        loopScene: `${TRACK_ASSET_ROOT}/${trackId}_loop.png`,
        pit: `${TRACK_ASSET_ROOT}/${trackId}_pit.webp`,
        sprite: layout.sprite
      }
  };
  if (kind === 'sprite') delete entry.closed;
  return entry;
}

function writeModule(entries) {
  const sorted = [...entries].sort((a, b) => TRACK_IDS.indexOf(a.id) - TRACK_IDS.indexOf(b.id));
  const source = `// Generated by scripts/import-playable-footage-tracks.mjs.\n`
    + `// 3D (\\u7ACB\\u4F53) and sprite tracks recovered from shipped Bus Loop playables.\n`
    + `// The geometry itself lives in public/assets/unity/conveyors/tracks/ as CTK1.\n\n`
    + `export const PLAYABLE_TRACK_LAYOUTS = Object.freeze(${JSON.stringify(sorted, null, 2)});\n\n`
    + `export const PLAYABLE_TRACK_LAYOUT_IDS = Object.freeze(Object.keys(PLAYABLE_TRACK_LAYOUTS));\n`;
  fs.writeFileSync(MODULE_PATH, source);
}

function main() {
  const files = process.argv.slice(2);
  if (!files.length) {
    console.error('Usage: node scripts/import-playable-footage-tracks.mjs <playable.html> [...]');
    process.exitCode = 1;
    return;
  }
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  const imported = [];
  for (const file of files) {
    const source = fs.readFileSync(file, 'utf8');
    imported.push(...importFromPlayable(source, path.basename(file)));
  }
  const byTrack = new Map();
  for (const entry of imported) {
    byTrack.set(entry.trackId, [...(byTrack.get(entry.trackId) ?? []), entry]);
  }
  const layouts = [];
  for (const trackId of TRACK_IDS) {
    const entries = byTrack.get(trackId) ?? [];
    if (!entries.length) {
      console.warn(`${trackId}: no playable in the supplied set ships this track`);
      continue;
    }
    const chosen = entries[0];
    const active = entries.find((entry) => entry.selected) ?? entries[0];
    layouts.push(buildLayoutEntry(trackId, active.layout, active.tuning));
    const detail = chosen.kind === 'model'
      ? `${chosen.vertices} verts / ${chosen.meshes} meshes -> ${chosen.fileName} ${(chosen.bytes / 1024).toFixed(1)} KB`
      : `sprite artwork -> ${chosen.fileName}`;
    console.log(`${trackId}: ${detail} (${entries.length} source${entries.length > 1 ? 's' : ''})`);
    for (const warning of chosen.warnings) console.warn(`  ! ${warning}`);
    for (const other of entries.slice(1)) {
      if (other.vertices !== chosen.vertices) {
        console.warn(`  ! ${other.source} ships ${other.vertices} verts, differs from ${chosen.source}`);
      }
    }
  }
  writeModule(layouts);
  console.log(`wrote ${path.relative(ROOT, MODULE_PATH)} with ${layouts.length} tracks`);
}

main();
