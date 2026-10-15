import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFile, mkdir, mkdtemp, readdir, readFile, rename, rm, stat, unlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { defineConfig } from 'vite';
import {
  DEFAULT_OUTPUT_ROOT,
  importSpatialConveyorPrefab
} from './scripts/spatial-conveyor-importer.mjs';
import {
  DEFAULT_UNITY_LEVEL_SOURCE_ROOT,
  MAX_UNITY_LEVEL_BYTES,
  deleteUnityLevel,
  importUnityLevelAsset
} from './scripts/unity-level-importer.mjs';
import {
  PRE_ROLL_COMPRESSION_VERSION,
  PRE_ROLL_MAX_COMPRESSED_BYTES,
  compressPreRollBuffer
} from './scripts/pre-roll-transcoder.mjs';
import {
  findLevelNameConflict,
  normalizeLevelDisplayName
} from './scripts/level-name-registry.mjs';

const BUILTIN_LEVEL_IDS = new Set([
  'level5', 'level7', 'level8', 'level9', 'level10', 'level12', 'level13', 'level15',
  'level16', 'level17', 'level18', 'level22', 'level26', 'level28', 'level29', 'level33',
  'level39'
]);
const LEVEL_ARTIFACT_PATH = path.resolve('artifacts', 'unity-levels.json');
const WEB_LEVEL_ROOT = path.resolve('artifacts', 'web-levels');
const WEB_LEVEL_BACKUP_ROOT = path.resolve('artifacts', 'web-level-backups');
const MAX_WEB_LEVEL_BYTES = 2 * 1024 * 1024;
const BACKGROUND_ASSET_ROOT = path.resolve('artifacts', 'editor-backgrounds');
const MAX_BACKGROUND_ASSET_BYTES = 512 * 1024;
const BACKGROUND_CANVAS_WIDTH = 2100;
const BACKGROUND_CANVAS_HEIGHT = 3382;
const PRE_ROLL_ASSET_ROOT = path.resolve('artifacts', 'editor-prerolls');
const MAX_PRE_ROLL_ASSET_BYTES = 50 * 1024 * 1024;
const MAX_PRE_ROLL_COMPRESSED_BYTES = PRE_ROLL_MAX_COMPRESSED_BYTES;
let preRollCompressionInFlight = null;

const MAX_PREFAB_BYTES = 12 * 1024 * 1024;
const MAX_SPATIAL_PACKAGE_BYTES = 4 * 1024 * 1024;
const SPATIAL_BACKUP_ROOT = path.resolve('artifacts', 'spatial-conveyor-backups');
const PLAYABLE_BUILD_PLATFORM = process.env.PLAYABLE_PLATFORM || 'applovin';
const PLAYABLE_REMOTE_EDITOR = process.env.PLAYABLE_REMOTE_EDITOR === '1';
const LEVEL_CATALOG_ALIAS = process.env.PLAYABLE_LEVEL_CATALOG_PATH
  ? [{
      find: './level-catalog.js',
      replacement: path.resolve(process.env.PLAYABLE_LEVEL_CATALOG_PATH)
    }]
  : [];
const MAX_PLAYABLE_EXPORT_BYTES = 3 * 1024 * 1024;
// A wedged headless-Chromium check used to leave playableExportInFlight set
// forever, so every later export answered 409. This ceiling aborts the run and
// the finally block releases the lock. Comfortably above one full all-platform
// export, which locally finishes in well under a minute.
const PLAYABLE_EXPORT_TIMEOUT_MS = 10 * 60 * 1000;
const PLAYABLE_EXPORT_PLATFORMS = new Set([
  'applovin',
  'google-ads',
  'meta',
  'unityads',
  'mintegral',
  'moloco',
  'tiktok'
]);
let playableExportInFlight = false;

const FBX_BINARY_IMAGE_BRANCH = `\t\t} else { // Binary Format

\t\t\tconst array = new Uint8Array( content );
\t\t\treturn window.URL.createObjectURL( new Blob( [ array ], { type: type } ) );

\t\t}`;
const FBX_DATA_IMAGE_BRANCH = `\t\t} else { // Binary Format

\t\t\tconst array = new Uint8Array( content );
\t\t\tlet binary = '';
\t\t\tfor ( let i = 0; i < array.length; i ++ ) binary += String.fromCharCode( array[ i ] );
\t\t\treturn 'data:' + type + ';base64,' + btoa( binary );

\t\t}`;
const FILE_LOADER_BLOB_RESPONSE = 'return response.blob();';
const FILE_LOADER_UNSUPPORTED_RESPONSE = "return Promise.reject( new TypeError( 'Binary object responses are unavailable in this playable.' ) );";
function rewriteMintegralSyntax(plugin, source) {
  const replacements = [];
  const visit = (node) => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      node.forEach(visit);
      return;
    }
    if (node.type === 'NewExpression' && node.callee?.type === 'Identifier' && node.callee.name === 'Error') {
      replacements.push({ start: node.start, end: node.callee.end, value: 'Error' });
    }
    for (const [key, value] of Object.entries(node)) {
      if (!['start', 'end', 'loc'].includes(key)) visit(value);
    }
  };
  visit(plugin.parse(source));
  if (replacements.length === 0) return source;
  let output = source;
  for (const { start, end, value } of replacements.sort((a, b) => b.start - a.start)) {
    output = `${output.slice(0, start)}${value}${output.slice(end)}`;
  }
  return output;
}

function mintegralRuntimeCompatibility() {
  return {
    name: 'mintegral-runtime-compatibility',
    apply: 'build',
    enforce: 'pre',
    transform(source, id) {
      if (PLAYABLE_BUILD_PLATFORM !== 'mintegral' || !/\.[cm]?js(?:\?|$)/u.test(id)) return null;
      let output = source;
      if (/[\\/]three[\\/]examples[\\/]jsm[\\/]loaders[\\/]FBXLoader\.js(?:\?|$)/u.test(id)) {
        if (!output.includes(FBX_BINARY_IMAGE_BRANCH)) {
          this.error('The Mintegral FBX image compatibility branch no longer matches the installed Three.js source.');
        }
        output = output.replace(FBX_BINARY_IMAGE_BRANCH, FBX_DATA_IMAGE_BRANCH);
      }
      if (/[\\/]three[\\/](?:src[\\/]loaders[\\/]FileLoader|build[\\/]three\.core)\.js(?:\?|$)/u.test(id)) {
        const matches = output.split(FILE_LOADER_BLOB_RESPONSE).length - 1;
        if (matches !== 1) {
          this.error('The Mintegral FileLoader response compatibility branch no longer matches the installed Three.js source.');
        }
        output = output.replace(FILE_LOADER_BLOB_RESPONSE, FILE_LOADER_UNSUPPORTED_RESPONSE);
      }
      output = rewriteMintegralSyntax(this, output);
      return output === source ? null : { code: output, map: null };
    }
  };
}

function validateSpatialPackageId(packageId) {
  if (!packageId || /[<>:"/\\|?*\x00-\x1f]/.test(packageId) || path.basename(packageId) !== packageId) {
    throw new Error('Spatial conveyor package id is invalid.');
  }
  return packageId;
}

function spatialRevision(source) {
  return createHash('sha256').update(source).digest('hex');
}

function validateWebLevelId(levelId) {
  if (!/^level[1-9]\d*$/.test(levelId)) throw new Error('Web level id must use level<number>.');
  return levelId;
}

function validateWebLevelDocument(document, levelId) {
  if (document?.format !== 'bus-loop-web-level-v1' || document?.key !== levelId) {
    throw new Error('Web level document identity is invalid.');
  }
  if (typeof document.displayName !== 'string' || !document.displayName.trim() || document.displayName.length > 80) {
    throw new Error('Web level display name is invalid.');
  }
  if (!Array.isArray(document.vehicles) || document.vehicles.length > 2000) {
    throw new Error('Web level vehicles are invalid.');
  }
  if (!Array.isArray(document.containers) || document.containers.length > 200) {
    throw new Error('Web level containers are invalid.');
  }
  if (!Array.isArray(document.passengerQueues) || document.passengerQueues.length > 20) {
    throw new Error('Web level passenger queues are invalid.');
  }
  const ids = new Set();
  for (const vehicle of document.vehicles) {
    if (!Number.isInteger(vehicle?.id) || vehicle.id < 1 || ids.has(vehicle.id)) throw new Error('Vehicle ids must be unique positive integers.');
    if (![4, 6, 10].includes(vehicle.seats)) throw new Error(`Vehicle ${vehicle.id} has an invalid seat count.`);
    if (![vehicle.x, vehicle.z, vehicle.yaw].every(Number.isFinite)) throw new Error(`Vehicle ${vehicle.id} has an invalid transform.`);
    ids.add(vehicle.id);
  }
}

async function readWebLevelDocument(levelId) {
  validateWebLevelId(levelId);
  const source = await readFile(path.join(WEB_LEVEL_ROOT, `${levelId}.json`), 'utf8');
  const document = JSON.parse(source);
  validateWebLevelDocument(document, levelId);
  return { document, revision: spatialRevision(source) };
}

// Only levels with a real definition belong in the picker. Listing a key that
// merely appears in BUILTIN_LEVEL_IDS is how phantom levels (level22/29/39,
// which exist nowhere) got selectable and made every export fail afterwards.
async function readImportedLevelIdentities() {
  let levels = [];
  try {
    const artifact = JSON.parse(await readFile(LEVEL_ARTIFACT_PATH, 'utf8'));
    levels = Array.isArray(artifact.levels) ? artifact.levels : [];
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  const identities = new Map();
  for (const level of levels) {
    identities.set(level.key, {
      key: level.key,
      displayName: String(level.displayName ?? level.key ?? '').trim(),
      source: 'catalog',
      updatedAt: await readLevelSourceMtime(path.join(DEFAULT_UNITY_LEVEL_SOURCE_ROOT, `${level.key}.asset`))
    });
  }
  return [...identities.values()];
}

// Levels carry no stored creation timestamp; the editor sorts by file time
// instead, which is when the level was last written (saved or imported).
async function readLevelSourceMtime(filePath) {
  try {
    return (await stat(filePath)).mtimeMs;
  } catch {
    return null;
  }
}

async function readWebLevelIdentities() {
  let entries;
  try { entries = await readdir(WEB_LEVEL_ROOT, { withFileTypes: true }); }
  catch (error) { if (error.code === 'ENOENT') return []; throw error; }
  return (await Promise.all(entries
    .filter((entry) => entry.isFile() && /^level[1-9]\d*\.json$/.test(entry.name))
    .map(async (entry) => {
      const key = entry.name.slice(0, -5);
      const updatedAt = await readLevelSourceMtime(path.join(WEB_LEVEL_ROOT, entry.name));
      try {
        const document = JSON.parse(await readFile(path.join(WEB_LEVEL_ROOT, entry.name), 'utf8'));
        return { key, displayName: String(document.displayName ?? '').trim(), source: 'web', updatedAt };
      } catch {
        return { key, displayName: '', source: 'web', updatedAt };
      }
    }))).filter(Boolean);
}

async function readImportedUnityLevelDefinition(levelKey) {
  try {
    const artifact = JSON.parse(await readFile(LEVEL_ARTIFACT_PATH, 'utf8'));
    return artifact.levels?.find((level) => level?.key === levelKey) ?? null;
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

async function readImportedArtifactKeys() {
  try {
    const artifact = JSON.parse(await readFile(LEVEL_ARTIFACT_PATH, 'utf8'));
    return new Set((Array.isArray(artifact.levels) ? artifact.levels : []).map((level) => level?.key));
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    return new Set();
  }
}

// The baked catalog is a build-time snapshot (the container points this at the
// copied artifacts/level-catalog.js). It answers "can the runtime load this
// key", which is broader than what the picker offers.
const LEVEL_CATALOG_PATH = process.env.PLAYABLE_LEVEL_CATALOG_PATH
  ? path.resolve(process.env.PLAYABLE_LEVEL_CATALOG_PATH)
  : path.resolve('src', 'level-catalog.js');
let bakedLevelKeysPromise = null;
function readBakedLevelKeys() {
  bakedLevelKeysPromise ??= import(`${pathToFileURL(LEVEL_CATALOG_PATH).href}?levels=${Date.now()}`)
    .then((module) => new Set(Object.keys(module.LEVEL_CATALOG ?? {})))
    .catch(() => new Set());
  return bakedLevelKeysPromise;
}

// The remote editor is served from a prebuilt bundle, so its catalog cannot
// contain levels imported after the build. List the data-volume artifact too;
// web documents keep precedence on key conflicts, matching runtime resolution.
async function readEditableLevelIdentities() {
  const merged = new Map();
  for (const level of [...(await readWebLevelIdentities()), ...(await readImportedLevelIdentities())]) {
    if (!merged.has(level.key)) merged.set(level.key, level);
  }
  return [...merged.values()];
}

async function getWebLevelAvailability(levelId, displayName) {
  validateWebLevelId(levelId);
  const normalizedName = normalizeLevelDisplayName(displayName);
  if (!normalizedName) throw new Error('Web level display name is required.');
  const [webLevels, importedLevels] = await Promise.all([
    readWebLevelIdentities(),
    readImportedLevelIdentities()
  ]);
  const webIdConflict = webLevels.find((level) => level.key === levelId);
  if (webIdConflict) return { available: false, reason: 'web', conflict: webIdConflict };
  const catalogIdConflict = importedLevels.find((level) => level.key === levelId);
  if (catalogIdConflict) return { available: false, reason: 'catalog', conflict: catalogIdConflict };
  const nameConflict = [...webLevels, ...importedLevels]
    .find((level) => normalizeLevelDisplayName(level.displayName) === normalizedName);
  return nameConflict
    ? { available: false, reason: 'name', conflict: nameConflict }
    : { available: true, reason: null, conflict: null };
}

async function saveWebLevelDocument(levelId, { document, baseRevision, createOnly = false }) {
  validateWebLevelId(levelId);
  validateWebLevelDocument(document, levelId);
  if (createOnly) {
    const availability = await getWebLevelAvailability(levelId, document.displayName);
    if (!availability.available) {
      const field = availability.reason === 'name' ? 'name' : 'id';
      const error = new Error(`A level with this ${field} already exists. Choose another ${field}.`);
      error.statusCode = 409;
      throw error;
    }
  } else {
    // Renames must not collide with another level either; the merged list is
    // the editor's single source of truth for names.
    const conflict = findLevelNameConflict(
      [...(await readWebLevelIdentities()), ...(await readImportedLevelIdentities())],
      { levelId, displayName: document.displayName }
    );
    if (conflict) {
      const error = new Error(`关卡名称「${document.displayName}」已被 ${conflict.key} 使用，请改用其他名称。`);
      error.statusCode = 409;
      throw error;
    }
  }
  await mkdir(WEB_LEVEL_ROOT, { recursive: true });
  const targetPath = path.join(WEB_LEVEL_ROOT, `${levelId}.json`);
  let currentSource = null;
  try { currentSource = await readFile(targetPath, 'utf8'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (createOnly && currentSource) {
    const error = new Error('A level with this id already exists. Choose another id.');
    error.statusCode = 409;
    throw error;
  }
  if (currentSource && baseRevision !== spatialRevision(currentSource)) {
    const error = new Error('The level changed outside this editor. Reopen it before saving.');
    error.statusCode = 409;
    throw error;
  }
  if (!currentSource && baseRevision) {
    const error = new Error('The saved level was removed outside this editor.');
    error.statusCode = 409;
    throw error;
  }
  const source = `${JSON.stringify(document, null, 2)}\n`;
  if (Buffer.byteLength(source) > MAX_WEB_LEVEL_BYTES) {
    const error = new Error('Web level document exceeds the 2 MB save limit.');
    error.statusCode = 413;
    throw error;
  }
  if (currentSource) {
    await mkdir(WEB_LEVEL_BACKUP_ROOT, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    await copyFile(targetPath, path.join(WEB_LEVEL_BACKUP_ROOT, `${levelId}-${stamp}.json`));
  }
  const temporaryPath = path.join(WEB_LEVEL_ROOT, `.${levelId}.${process.pid}.tmp`);
  try {
    await writeFile(temporaryPath, source, 'utf8');
    await rename(temporaryPath, targetPath);
  } catch (error) {
    await unlink(temporaryPath).catch(() => {});
    throw error;
  }
  return { document, revision: spatialRevision(source), targetPath, created: !currentSource };
}

function importedFileDisplayName(filename, fallback = 'Imported Level') {
  const raw = String(filename ?? '').trim();
  const base = raw ? path.basename(raw, path.extname(raw)) : '';
  return (base.replace(/[\x00-\x1f]/gu, '').trim() || fallback).slice(0, 80);
}

async function nextAvailableLevelId() {
  const identities = [
    ...(await readImportedLevelIdentities()),
    ...(await readWebLevelIdentities())
  ];
  const used = new Set(identities.map((item) => item.key));
  let number = 1;
  // Reserved builtin ids stay off the allocation list so an import can never
  // land on a key the delete guard refuses to remove.
  while (used.has(`level${number}`) || BUILTIN_LEVEL_IDS.has(`level${number}`)) number += 1;
  return `level${number}`;
}

async function importWebLevelDocument(document, targetLevelId = null, displayName = null) {
  const isCreate = targetLevelId == null;
  const resolvedLevelId = isCreate ? await nextAvailableLevelId() : targetLevelId;
  validateWebLevelId(resolvedLevelId);
  // normalizedDocument = { ...document, key: targetLevelId } (identity retargeting)
  const normalizedDocument = {
    ...document,
    key: resolvedLevelId,
    ...(displayName ? { displayName: importedFileDisplayName(displayName, document?.displayName) } : {})
  };
  validateWebLevelDocument(normalizedDocument, resolvedLevelId);
  let currentSource = null;
  try {
    currentSource = await readFile(path.join(WEB_LEVEL_ROOT, `${resolvedLevelId}.json`), 'utf8');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  const result = await saveWebLevelDocument(resolvedLevelId, {
    document: normalizedDocument,
    baseRevision: currentSource ? spatialRevision(currentSource) : null,
    createOnly: isCreate
  });
  return { ...result, replaced: Boolean(currentSource) };
}

async function deleteWebLevelDocument(levelId) {
  validateWebLevelId(levelId);
  if (BUILTIN_LEVEL_IDS.has(levelId)) {
    const error = new Error('内置 Unity 关卡不能删除。');
    error.statusCode = 400;
    throw error;
  }
  const targetPath = path.join(WEB_LEVEL_ROOT, `${levelId}.json`);
  const source = await readFile(targetPath, 'utf8').catch((error) => {
    if (error.code === 'ENOENT') return null;
    throw error;
  });
  if (!source) {
    const error = new Error('网页关卡文件不存在。');
    error.statusCode = 404;
    throw error;
  }
  await unlink(targetPath);
  return { key: levelId, deletedPath: targetPath };
}

function sendJson(response, statusCode, payload) {
  response.statusCode = statusCode;
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.setHeader('Cache-Control', 'no-store');
  response.end(JSON.stringify(payload));
}

const BACKGROUND_MIME_TYPES = new Map([
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.png', 'image/png'],
  ['.webp', 'image/webp']
]);

function editorPreRollAssetUrl(filename) {
  return `/assets/editor-prerolls/${filename}`;
}

function isEditorPreRollFilename(filename) {
  return /^[A-Za-z0-9][A-Za-z0-9._-]{0,119}\.mp4$/iu.test(filename)
    && path.basename(filename) === filename;
}

function decodePreRollFilename(request) {
  const rawFilename = request.headers['x-pre-roll-filename'];
  if (typeof rawFilename !== 'string') throw new Error('Missing pre-roll filename.');
  let filename;
  try {
    filename = decodeURIComponent(rawFilename);
  } catch {
    throw new Error('Pre-roll filename encoding is invalid.');
  }
  if (!/\.mp4$/iu.test(filename) || path.basename(filename) !== filename) {
    throw new Error('Only one local MP4 video can be imported.');
  }
  return filename;
}

function normalizePreRollLabel(filename) {
  return path.basename(filename, path.extname(filename))
    .normalize('NFKC')
    .replace(/[\x00-\x1f]/gu, '')
    .trim()
    .slice(0, 80) || 'video';
}

function sanitizePreRollFilenamePart(label) {
  return label
    .replace(/[^A-Za-z0-9_-]+/gu, '-')
    .replace(/^-+|-+$/gu, '')
    .slice(0, 48) || 'video';
}

function isLikelyMp4(bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.byteLength < 12) return false;
  const scanEnd = Math.min(bytes.byteLength - 4, 64);
  for (let offset = 4; offset <= scanEnd; offset += 1) {
    if (bytes.toString('ascii', offset, offset + 4) === 'ftyp') return true;
  }
  return false;
}

async function readPreRollMetadata(filePath) {
  try {
    const metadata = JSON.parse(await readFile(`${filePath}.json`, 'utf8'));
    return metadata && typeof metadata === 'object' && !Array.isArray(metadata) ? metadata : {};
  } catch (error) {
    if (error.code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error;
    return {};
  }
}

function hasCurrentPreRollCompression(metadata) {
  return Number(metadata?.compression?.version) === PRE_ROLL_COMPRESSION_VERSION;
}

async function writePreRollFileAtomically(targetPath, bytes) {
  const temporaryPath = path.join(
    path.dirname(targetPath),
    `.${path.basename(targetPath)}.${process.pid}.tmp`
  );
  try {
    await writeFile(temporaryPath, bytes);
    await rename(temporaryPath, targetPath);
  } catch (error) {
    await unlink(temporaryPath).catch(() => {});
    throw error;
  }
}

async function compressStoredPreRollAsset(filePath, metadata = {}) {
  const sourceBytes = await readFile(filePath);
  const result = await compressPreRollBuffer(sourceBytes, {
    maxOutputBytes: MAX_PRE_ROLL_COMPRESSED_BYTES
  });
  if (result.bytes !== sourceBytes) await writePreRollFileAtomically(filePath, result.bytes);
  const nextMetadata = {
    ...metadata,
    compression: {
      ...result.compression,
      sourceBytes: result.sourceBytes,
      outputBytes: result.outputBytes,
      retainedSource: !result.compressed
    }
  };
  await writeFile(`${filePath}.json`, `${JSON.stringify(nextMetadata, null, 2)}\n`, 'utf8');
  return { ...result, metadata: nextMetadata };
}

async function migrateEditorPreRollAssets() {
  if (preRollCompressionInFlight) return preRollCompressionInFlight;
  preRollCompressionInFlight = (async () => {
    let entries;
    try {
      entries = await readdir(PRE_ROLL_ASSET_ROOT, { withFileTypes: true });
    } catch (error) {
      if (error.code === 'ENOENT') return;
      throw error;
    }
    await Promise.all(entries
      .filter((entry) => entry.isFile() && isEditorPreRollFilename(entry.name))
      .map(async (entry) => {
        const filePath = path.join(PRE_ROLL_ASSET_ROOT, entry.name);
        const metadata = await readPreRollMetadata(filePath);
        if (hasCurrentPreRollCompression(metadata)) return;
        try {
          await compressStoredPreRollAsset(filePath, metadata);
        } catch (error) {
          // Keep a legacy item visible when a host has not installed FFmpeg.
          console.warn(`[pre-roll] Could not compress ${entry.name}: ${error.message}`);
        }
      }));
  })();
  try {
    await preRollCompressionInFlight;
  } finally {
    preRollCompressionInFlight = null;
  }
}

async function listEditorPreRollAssets() {
  let entries;
  try {
    await migrateEditorPreRollAssets();
    entries = await readdir(PRE_ROLL_ASSET_ROOT, { withFileTypes: true });
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
  const items = await Promise.all(entries
    .filter((entry) => entry.isFile() && isEditorPreRollFilename(entry.name))
    .map(async (entry) => {
      const filePath = path.join(PRE_ROLL_ASSET_ROOT, entry.name);
      const fileStat = await stat(filePath);
      let label = `自定义 ${path.basename(entry.name, path.extname(entry.name)).replace(/^preroll-[a-f0-9]{12}-/iu, '')}`;
      const metadata = await readPreRollMetadata(filePath);
      if (typeof metadata.label === 'string' && metadata.label.trim()) label = `自定义 ${metadata.label.trim()}`;
      return {
        filename: entry.name,
        label,
        value: editorPreRollAssetUrl(entry.name),
        bytes: fileStat.size,
        sourceBytes: Number.isFinite(Number(metadata.compression?.sourceBytes))
          ? Number(metadata.compression.sourceBytes)
          : fileStat.size,
        compression: metadata.compression ?? null,
        mtimeMs: fileStat.mtimeMs
      };
    }));
  return items.sort((first, second) => second.mtimeMs - first.mtimeMs)
    .map(({ mtimeMs: _mtimeMs, ...item }) => item);
}

async function saveEditorPreRollAsset({ filename, bytes }) {
  if (!Buffer.isBuffer(bytes) || bytes.byteLength === 0) throw new Error('Pre-roll video is empty.');
  if (bytes.byteLength > MAX_PRE_ROLL_ASSET_BYTES) {
    const error = new Error(`Pre-roll video exceeds the ${Math.round(MAX_PRE_ROLL_ASSET_BYTES / 1024 / 1024)} MB import limit.`);
    error.statusCode = 413;
    throw error;
  }
  if (!isLikelyMp4(bytes)) {
    const error = new Error('Only valid MP4 videos can be imported.');
    error.statusCode = 415;
    throw error;
  }
  const compressed = await compressPreRollBuffer(bytes, {
    maxOutputBytes: MAX_PRE_ROLL_COMPRESSED_BYTES
  });
  const storedBytes = compressed.bytes;
  // Keep the identity tied to the uploaded source so re-uploading a video
  // updates the migrated legacy file instead of creating a second asset.
  const hash = createHash('sha256').update(bytes).digest('hex').slice(0, 12);
  const label = normalizePreRollLabel(filename);
  const outputName = `preroll-${hash}-${sanitizePreRollFilenamePart(label)}.mp4`;
  await mkdir(PRE_ROLL_ASSET_ROOT, { recursive: true });
  const targetPath = path.join(PRE_ROLL_ASSET_ROOT, outputName);
  await writePreRollFileAtomically(targetPath, storedBytes);
  await writeFile(`${targetPath}.json`, `${JSON.stringify({
    label,
    compression: {
      ...compressed.compression,
      sourceBytes: compressed.sourceBytes,
      outputBytes: compressed.outputBytes,
      retainedSource: !compressed.compressed
    }
  }, null, 2)}\n`, 'utf8');
  return {
    filename: outputName,
    label: `自定义 ${label}`,
    value: editorPreRollAssetUrl(outputName),
    bytes: storedBytes.byteLength,
    sourceBytes: bytes.byteLength,
    compression: compressed.compression
  };
}

async function renameEditorPreRollAsset(filename, label) {
  if (!isEditorPreRollFilename(filename)) throw new Error('Invalid pre-roll filename.');
  const normalizedLabel = String(label ?? '').normalize('NFKC').trim();
  if (!normalizedLabel || normalizedLabel.length > 80 || /[\x00-\x1f]/u.test(normalizedLabel)) {
    throw new Error('Pre-roll name must be between 1 and 80 characters.');
  }
  const targetPath = path.join(PRE_ROLL_ASSET_ROOT, filename);
  await stat(targetPath).catch((error) => {
    if (error.code === 'ENOENT') {
      const missing = new Error('Pre-roll video does not exist.');
      missing.statusCode = 404;
      throw missing;
    }
    throw error;
  });
  const metadata = await readPreRollMetadata(targetPath);
  await writeFile(`${targetPath}.json`, `${JSON.stringify({ ...metadata, label: normalizedLabel }, null, 2)}\n`, 'utf8');
  return { filename, label: `自定义 ${normalizedLabel}`, value: editorPreRollAssetUrl(filename) };
}

async function deleteEditorPreRollAsset(filename) {
  if (!isEditorPreRollFilename(filename)) throw new Error('Invalid pre-roll filename.');
  const targetPath = path.join(PRE_ROLL_ASSET_ROOT, filename);
  await unlink(targetPath).catch((error) => {
    if (error.code === 'ENOENT') {
      const missing = new Error('Pre-roll video does not exist.');
      missing.statusCode = 404;
      throw missing;
    }
    throw error;
  });
  await unlink(`${targetPath}.json`).catch((error) => {
    if (error.code !== 'ENOENT') throw error;
  });
  return { filename };
}

function editorBackgroundAssetUrl(filename) {
  return `/assets/editor-backgrounds/${filename}`;
}

function isEditorBackgroundFilename(filename) {
  return /^[A-Za-z0-9][A-Za-z0-9._-]{0,119}\.(?:jpe?g|png|webp)$/iu.test(filename)
    && path.basename(filename) === filename;
}

function decodeBackgroundFilename(request) {
  const rawFilename = request.headers['x-background-filename'];
  if (typeof rawFilename !== 'string') throw new Error('Missing background filename.');
  let filename;
  try {
    filename = decodeURIComponent(rawFilename);
  } catch {
    throw new Error('Background filename encoding is invalid.');
  }
  if (!/\.(?:png|jpe?g|webp)$/iu.test(filename) || path.basename(filename) !== filename) {
    throw new Error('Only one local PNG, JPG, or WebP background can be imported.');
  }
  return filename;
}

function normalizeBackgroundLabel(filename) {
  return path.basename(filename, path.extname(filename))
    .normalize('NFKC')
    .replace(/[^A-Za-z0-9_-]+/gu, '-')
    .replace(/^-+|-+$/gu, '')
    .slice(0, 48) || 'background';
}

function parsePositiveHeaderNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.round(number) : null;
}

function backgroundMimeFor(filename) {
  return BACKGROUND_MIME_TYPES.get(path.extname(filename).toLowerCase()) ?? 'application/octet-stream';
}

async function listEditorBackgroundAssets() {
  let entries;
  try {
    entries = await readdir(BACKGROUND_ASSET_ROOT, { withFileTypes: true });
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
  const items = await Promise.all(entries
    .filter((entry) => entry.isFile() && isEditorBackgroundFilename(entry.name))
    .map(async (entry) => {
      const filePath = path.join(BACKGROUND_ASSET_ROOT, entry.name);
      const fileStat = await stat(filePath);
      let label = `自定义 ${path.basename(entry.name, path.extname(entry.name)).replace(/^bg-[a-f0-9]{10}-(?:\d+x\d+-)?/iu, '')}`;
      try {
        const metadata = JSON.parse(await readFile(`${filePath}.json`, 'utf8'));
        if (typeof metadata.label === 'string' && metadata.label.trim()) label = `自定义 ${metadata.label.trim()}`;
      } catch {
        // Older imported backgrounds have no metadata sidecar.
      }
      return {
        filename: entry.name,
        label,
        value: editorBackgroundAssetUrl(entry.name),
        bytes: fileStat.size,
        width: BACKGROUND_CANVAS_WIDTH,
        height: BACKGROUND_CANVAS_HEIGHT,
        mtimeMs: fileStat.mtimeMs
      };
    }));
  return items.sort((first, second) => second.mtimeMs - first.mtimeMs)
    .map(({ mtimeMs: _mtimeMs, ...item }) => item);
}

async function saveEditorBackgroundAsset({ filename, bytes, width, height }) {
  if (!Buffer.isBuffer(bytes) || bytes.byteLength === 0) throw new Error('Background image is empty.');
  if (bytes.byteLength > MAX_BACKGROUND_ASSET_BYTES) {
    const error = new Error('Background image is still too large after compression.');
    error.statusCode = 413;
    throw error;
  }
  const hash = createHash('sha256').update(bytes).digest('hex').slice(0, 10);
  const label = normalizeBackgroundLabel(filename);
  const dimensions = `${width || BACKGROUND_CANVAS_WIDTH}x${height || BACKGROUND_CANVAS_HEIGHT}`;
  const outputName = `bg-${hash}-${dimensions}-${label}.jpg`;
  await mkdir(BACKGROUND_ASSET_ROOT, { recursive: true });
  const targetPath = path.join(BACKGROUND_ASSET_ROOT, outputName);
  const temporaryPath = path.join(BACKGROUND_ASSET_ROOT, `.${outputName}.${process.pid}.tmp`);
  try {
    await writeFile(temporaryPath, bytes);
    await rename(temporaryPath, targetPath);
  } catch (error) {
    await unlink(temporaryPath).catch(() => {});
    throw error;
  }
  return {
    filename: outputName,
    label: `\u81ea\u5b9a\u4e49 ${label}`,
    value: editorBackgroundAssetUrl(outputName),
    bytes: bytes.byteLength,
    width,
    height
  };
}

async function renameEditorBackgroundAsset(filename, label) {
  if (!isEditorBackgroundFilename(filename)) throw new Error('Invalid background filename.');
  const normalizedLabel = String(label ?? '').normalize('NFKC').trim();
  if (!normalizedLabel || normalizedLabel.length > 80 || /[\x00-\x1f]/u.test(normalizedLabel)) {
    throw new Error('Background name must be between 1 and 80 characters.');
  }
  const targetPath = path.join(BACKGROUND_ASSET_ROOT, filename);
  await stat(targetPath).catch((error) => {
    if (error.code === 'ENOENT') {
      const missing = new Error('Background image does not exist.');
      missing.statusCode = 404;
      throw missing;
    }
    throw error;
  });
  await writeFile(`${targetPath}.json`, `${JSON.stringify({ label: normalizedLabel }, null, 2)}\n`, 'utf8');
  return { filename, label: `自定义 ${normalizedLabel}`, value: editorBackgroundAssetUrl(filename) };
}

async function deleteEditorBackgroundAsset(filename) {
  if (!isEditorBackgroundFilename(filename)) throw new Error('Invalid background filename.');
  const targetPath = path.join(BACKGROUND_ASSET_ROOT, filename);
  await unlink(targetPath).catch((error) => {
    if (error.code === 'ENOENT') {
      const missing = new Error('Background image does not exist.');
      missing.statusCode = 404;
      throw missing;
    }
    throw error;
  });
  await unlink(`${targetPath}.json`).catch((error) => {
    if (error.code !== 'ENOENT') throw error;
  });
  return { filename };
}

async function listSpatialConveyors() {
  let entries;
  try {
    entries = await readdir(DEFAULT_OUTPUT_ROOT, { withFileTypes: true });
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }

  const items = await Promise.all(entries
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.json'))
    .map(async (entry) => {
      try {
        const packageData = JSON.parse(await readFile(path.join(DEFAULT_OUTPUT_ROOT, entry.name), 'utf8'));
        if (packageData?.kind !== 'spatial' || typeof packageData.id !== 'string') return null;
        return {
          id: packageData.id,
          label: packageData.label || packageData.id,
          value: `spatial:${packageData.id}`,
          filename: entry.name,
          sourceFilename: packageData.source?.filename ?? null,
          pointCount: packageData.path?.points?.length ?? 0
        };
      } catch {
        return null;
      }
    }));

  return items.filter(Boolean).sort((a, b) => a.label.localeCompare(b.label, 'zh-CN'));
}

async function readSpatialConveyorPackage(packageId) {
  validateSpatialPackageId(packageId);
  const source = await readFile(path.join(DEFAULT_OUTPUT_ROOT, `${packageId}.json`), 'utf8');
  const packageData = JSON.parse(source);
  if (packageData?.kind !== 'spatial' || packageData.id !== packageId) {
    throw new Error('Spatial conveyor package data is invalid.');
  }
  return { packageData, revision: spatialRevision(source) };
}

function validateSpatialPackageData(packageData, packageId) {
  if (packageData?.kind !== 'spatial' || packageData.id !== packageId) {
    throw new Error('Spatial conveyor package identity is invalid.');
  }
  const points = packageData.path?.points;
  if (!Array.isArray(points) || points.length < 3 || points.length > 2000) {
    throw new Error('Spatial conveyor must contain between 3 and 2000 points.');
  }
  const ids = new Set();
  for (const point of points) {
    if (typeof point?.id !== 'string' || !point.id || ids.has(point.id)) {
      throw new Error('Spatial conveyor point ids must be unique.');
    }
    ids.add(point.id);
    for (const axis of ['x', 'y', 'z']) {
      if (!Number.isFinite(Number(point.position?.[axis]))) {
        throw new Error(`Spatial conveyor point ${point.id} has an invalid ${axis} coordinate.`);
      }
    }
    if (!Number.isFinite(Number(point.size)) || Number(point.size) <= 0) {
      throw new Error(`Spatial conveyor point ${point.id} has an invalid size.`);
    }
  }
}

async function saveSpatialConveyorPackage({ packageData, baseRevision }) {
  const packageId = validateSpatialPackageId(packageData?.id);
  validateSpatialPackageData(packageData, packageId);
  await mkdir(DEFAULT_OUTPUT_ROOT, { recursive: true });
  const targetPath = path.join(DEFAULT_OUTPUT_ROOT, `${packageId}.json`);
  let currentSource = null;
  try {
    currentSource = await readFile(targetPath, 'utf8');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  if (currentSource && baseRevision !== spatialRevision(currentSource)) {
    const error = new Error('The spatial conveyor file changed outside the editor. Refresh before saving.');
    error.statusCode = 409;
    throw error;
  }
  if (!currentSource && baseRevision) {
    const error = new Error('The spatial conveyor file was removed outside the editor.');
    error.statusCode = 409;
    throw error;
  }
  const source = `${JSON.stringify(packageData, null, 2)}\n`;
  if (Buffer.byteLength(source) > MAX_SPATIAL_PACKAGE_BYTES) {
    const error = new Error('Spatial conveyor package exceeds the editor save limit.');
    error.statusCode = 413;
    throw error;
  }
  if (currentSource) {
    await mkdir(SPATIAL_BACKUP_ROOT, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    await copyFile(targetPath, path.join(SPATIAL_BACKUP_ROOT, `${packageId}-${stamp}.json`));
  }
  const temporaryPath = path.join(DEFAULT_OUTPUT_ROOT, `.${packageId}.${process.pid}.tmp`);
  try {
    await writeFile(temporaryPath, source, 'utf8');
    await rename(temporaryPath, targetPath);
  } catch (error) {
    await unlink(temporaryPath).catch(() => {});
    throw error;
  }
  return { packageData, revision: spatialRevision(source), targetPath };
}

async function openFolder(folderRoot) {
  const folderPath = path.resolve(folderRoot);
  await mkdir(folderPath, { recursive: true });
  if (process.env.PLAYABLE_REMOTE_EDITOR === '1') return folderPath;
  const command = process.platform === 'win32'
    ? 'explorer.exe'
    : process.platform === 'darwin' ? 'open' : 'xdg-open';
  await new Promise((resolve, reject) => {
    const child = spawn(command, [folderPath], { detached: true, stdio: 'ignore' });
    child.once('error', reject);
    child.once('spawn', () => {
      child.unref();
      resolve();
    });
  });
  return folderPath;
}

async function isKnownPlayableLevel(levelId) {
  if (!/^level[1-9]\d*$/.test(levelId)) return false;
  // The runtime resolves a selection through the same three layers, so any key
  // with data in one of them is loadable even when the build-time catalog is
  // the only place that has it.
  try {
    await stat(path.join(WEB_LEVEL_ROOT, `${levelId}.json`));
    return true;
  } catch {
    // Fall through to the data volume and baked catalog.
  }
  if ((await readImportedArtifactKeys()).has(levelId)) return true;
  return (await readBakedLevelKeys()).has(levelId);
}

function decodePrefabFilename(request) {
  const rawFilename = request.headers['x-prefab-filename'];
  if (typeof rawFilename !== 'string') throw new Error('Missing Prefab filename.');
  let filename;
  try {
    filename = decodeURIComponent(rawFilename);
  } catch {
    throw new Error('Prefab filename encoding is invalid.');
  }
  if (path.extname(filename).toLowerCase() !== '.prefab' || path.basename(filename) !== filename) {
    throw new Error('Only one local .prefab file can be imported.');
  }
  return filename;
}

function decodeLevelFilename(request) {
  const rawFilename = request.headers['x-level-filename'];
  if (typeof rawFilename !== 'string') throw new Error('Missing Unity level filename.');
  let filename;
  try {
    filename = decodeURIComponent(rawFilename);
  } catch {
    throw new Error('Unity level filename encoding is invalid.');
  }
  if (path.extname(filename).toLowerCase() !== '.asset' || path.basename(filename) !== filename) {
    throw new Error('Only one local .asset file can be imported.');
  }
  return filename;
}

function readRequestBody(request, maxBytes, label = 'Prefab') {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let byteLength = 0;
    let tooLarge = false;
    request.on('data', (chunk) => {
      byteLength += chunk.length;
      if (byteLength > maxBytes) {
        tooLarge = true;
        return;
      }
      chunks.push(chunk);
    });
    request.on('end', () => {
      if (tooLarge) {
        const error = new Error(`${label} exceeds the ${Math.round(maxBytes / 1024 / 1024)} MB import limit.`);
        error.statusCode = 413;
        reject(error);
        return;
      }
      resolve(Buffer.concat(chunks).toString('utf8'));
    });
    request.on('error', reject);
  });
}

function readRequestBuffer(request, maxBytes, label = 'Upload') {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let byteLength = 0;
    let tooLarge = false;
    request.on('data', (chunk) => {
      byteLength += chunk.length;
      if (byteLength > maxBytes) {
        tooLarge = true;
        return;
      }
      chunks.push(chunk);
    });
    request.on('end', () => {
      if (tooLarge) {
        const error = new Error(`${label} exceeds the ${Math.round(maxBytes / 1024)} KB import limit.`);
        error.statusCode = 413;
        reject(error);
        return;
      }
      resolve(Buffer.concat(chunks));
    });
    request.on('error', reject);
  });
}

function playableExportFilename(fileName, format) {
  const expectedExtension = format === 'zip' ? '.zip' : '.html';
  const baseName = path.basename(String(fileName ?? '').replaceAll('\\', '/'));
  if (!baseName || !baseName.toLowerCase().endsWith(expectedExtension)) {
    return `bus-loop-playable${expectedExtension}`;
  }
  return baseName;
}

function playableExportDisposition(fileName) {
  const asciiName = fileName.replace(/[^A-Za-z0-9._-]/g, '_') || 'bus-loop-playable';
  return `attachment; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}

function levelExportDisposition(fileName) {
  const asciiName = fileName.replace(/[^A-Za-z0-9._-]/g, '_') || 'level-export';
  return `attachment; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}

export default defineConfig({
  optimizeDeps: {
    noDiscovery: true,
    include: []
  },
  esbuild: PLAYABLE_BUILD_PLATFORM === 'mintegral'
    ? { pure: ['console.error'] }
    : undefined,
  build: {
    modulePreload: { polyfill: PLAYABLE_BUILD_PLATFORM !== 'mintegral' },
    outDir: PLAYABLE_REMOTE_EDITOR ? 'server-dist' : 'dist'
  },
  resolve: {
    alias: [
      ...LEVEL_CATALOG_ALIAS,
      ...(PLAYABLE_BUILD_PLATFORM === 'applovin' ? [] : [{
          find: './platform-bridge.js',
          replacement: path.resolve('src', 'platform-bridges', `${PLAYABLE_BUILD_PLATFORM}.js`)
        }])
    ]
  },
  define: {
    __PLAYABLE_PLATFORM__: JSON.stringify(PLAYABLE_BUILD_PLATFORM),
    __REMOTE_EDITOR__: JSON.stringify(PLAYABLE_REMOTE_EDITOR)
  },
  plugins: [mintegralRuntimeCompatibility(), (() => {
    const configure = (server) => {
      server.middlewares.use('/__playable-level', async (request, response, next) => {
        if (request.method !== 'POST') return next();
        try {
          const levelId = (await readRequestBody(request, 64, 'Level selection')).trim();
          if (!await isKnownPlayableLevel(levelId)) throw new Error('Unknown level.');
          await writeFile(path.resolve('artifacts', 'selected-level.txt'), `${levelId}\n`, 'utf8');
          response.statusCode = 204;
          response.end();
        } catch (error) {
          sendJson(response, error.statusCode ?? 400, { error: error.message });
        }
      });

      server.middlewares.use(async (request, response, next) => {
        const requestUrl = new URL(request.url, 'http://localhost');
        const pathname = requestUrl.pathname;
        // The remote editor is updated in place on a shared LAN URL. Prevent a
        // browser from keeping an old index.html that points at the previous
        // hashed editor bundle after a deployment.
        if (request.method === 'GET' && (pathname === '/' || pathname.endsWith('.html'))) {
          response.setHeader('Cache-Control', 'no-store');
        }
        const preRollAssetMatch = pathname.match(/^\/assets\/editor-prerolls\/([^/]+)$/u);
        if (preRollAssetMatch && (request.method === 'GET' || request.method === 'HEAD')) {
          try {
            const filename = decodeURIComponent(preRollAssetMatch[1]);
            if (!isEditorPreRollFilename(filename)) throw new Error('Invalid pre-roll filename.');
            const file = await readFile(path.join(PRE_ROLL_ASSET_ROOT, filename));
            const range = request.headers.range;
            let start = 0;
            let end = file.byteLength - 1;
            let statusCode = 200;
            if (range) {
              const match = /^bytes=(\d*)-(\d*)$/u.exec(range);
              if (!match) {
                response.statusCode = 416;
                response.setHeader('Content-Range', `bytes */${file.byteLength}`);
                response.end();
                return;
              }
              if (match[1]) start = Number(match[1]);
              if (match[2]) end = Number(match[2]);
              if (!match[1] && match[2]) {
                const suffixLength = Number(match[2]);
                start = Math.max(0, file.byteLength - suffixLength);
                end = file.byteLength - 1;
              }
              if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || start >= file.byteLength || start > end) {
                response.statusCode = 416;
                response.setHeader('Content-Range', `bytes */${file.byteLength}`);
                response.end();
                return;
              }
              end = Math.min(end, file.byteLength - 1);
              statusCode = 206;
            }
            const body = request.method === 'HEAD' ? null : file.subarray(start, end + 1);
            response.statusCode = statusCode;
            response.setHeader('Content-Type', 'video/mp4');
            response.setHeader('Accept-Ranges', 'bytes');
            response.setHeader('Content-Length', end - start + 1);
            if (statusCode === 206) response.setHeader('Content-Range', `bytes ${start}-${end}/${file.byteLength}`);
            response.setHeader('Cache-Control', 'no-cache');
            response.setHeader('X-Content-Type-Options', 'nosniff');
            response.end(body);
          } catch (error) {
            sendJson(response, error.code === 'ENOENT' ? 404 : 400, { error: error.message });
          }
          return;
        }
        if (pathname === '/__pre-roll-assets' && request.method === 'GET') {
          try {
            sendJson(response, 200, { items: await listEditorPreRollAssets() });
          } catch (error) {
            sendJson(response, 500, { error: error.message });
          }
          return;
        }
        if (pathname === '/__pre-roll-assets/import' && request.method === 'POST') {
          try {
            const item = await saveEditorPreRollAsset({
              filename: decodePreRollFilename(request),
              bytes: await readRequestBuffer(request, MAX_PRE_ROLL_ASSET_BYTES, 'Pre-roll video')
            });
            sendJson(response, 201, { item });
          } catch (error) {
            sendJson(response, error.statusCode ?? 400, { error: error.message });
          }
          return;
        }
        if (pathname === '/__pre-roll-assets' && request.method === 'DELETE') {
          try {
            const filename = requestUrl.searchParams.get('filename');
            const result = await deleteEditorPreRollAsset(filename);
            sendJson(response, 200, result);
          } catch (error) {
            sendJson(response, error.statusCode ?? 400, { error: error.message });
          }
          return;
        }
        if (pathname === '/__pre-roll-assets/rename' && request.method === 'POST') {
          try {
            const body = JSON.parse(await readRequestBody(request, 16 * 1024, 'Pre-roll name'));
            const result = await renameEditorPreRollAsset(body?.filename, body?.label);
            sendJson(response, 200, { item: result });
          } catch (error) {
            sendJson(response, error.statusCode ?? 400, { error: error.message });
          }
          return;
        }
        const backgroundAssetMatch = pathname.match(/^\/assets\/editor-backgrounds\/([^/]+)$/u);
        if (backgroundAssetMatch && request.method === 'GET') {
          try {
            const filename = decodeURIComponent(backgroundAssetMatch[1]);
            if (!isEditorBackgroundFilename(filename)) throw new Error('Invalid background filename.');
            const file = await readFile(path.join(BACKGROUND_ASSET_ROOT, filename));
            response.statusCode = 200;
            response.setHeader('Content-Type', backgroundMimeFor(filename));
            response.setHeader('Content-Length', file.byteLength);
            response.setHeader('Cache-Control', 'no-cache');
            response.setHeader('X-Content-Type-Options', 'nosniff');
            response.end(file);
          } catch (error) {
            sendJson(response, error.code === 'ENOENT' ? 404 : 400, { error: error.message });
          }
          return;
        }
        if (pathname === '/__background-assets' && request.method === 'GET') {
          try {
            sendJson(response, 200, { items: await listEditorBackgroundAssets() });
          } catch (error) {
            sendJson(response, 500, { error: error.message });
          }
          return;
        }
        if (pathname === '/__background-assets/import' && request.method === 'POST') {
          try {
            const item = await saveEditorBackgroundAsset({
              filename: decodeBackgroundFilename(request),
              bytes: await readRequestBuffer(request, MAX_BACKGROUND_ASSET_BYTES, 'Background image'),
              width: parsePositiveHeaderNumber(request.headers['x-background-width']),
              height: parsePositiveHeaderNumber(request.headers['x-background-height'])
            });
            sendJson(response, 201, { item });
          } catch (error) {
            sendJson(response, error.statusCode ?? 400, { error: error.message });
          }
          return;
        }
        if (pathname === '/__background-assets' && request.method === 'DELETE') {
          try {
            const filename = requestUrl.searchParams.get('filename');
            const result = await deleteEditorBackgroundAsset(filename);
            sendJson(response, 200, result);
          } catch (error) {
            sendJson(response, error.statusCode ?? 400, { error: error.message });
          }
          return;
        }
        if (pathname === '/__background-assets/rename' && request.method === 'POST') {
          try {
            const body = JSON.parse(await readRequestBody(request, 16 * 1024, 'Background name'));
            const result = await renameEditorBackgroundAsset(body?.filename, body?.label);
            sendJson(response, 200, { item: result });
          } catch (error) {
            sendJson(response, error.statusCode ?? 400, { error: error.message });
          }
          return;
        }
        if (pathname === '/__playable-export' || pathname === '/__playable-export-all') {
          if (request.method !== 'POST') {
            response.setHeader('Allow', 'POST');
            sendJson(response, 405, { error: '仅支持 POST 导出请求。' });
            return;
          }
          if (playableExportInFlight) {
            sendJson(response, 409, { error: '已有试玩包正在导出，请稍后重试。' });
            return;
          }

          const exportAbortController = new AbortController();
          const abortDisconnectedExport = () => {
            if (!response.writableEnded) exportAbortController.abort();
          };
          request.once('aborted', abortDisconnectedExport);
          response.once('close', abortDisconnectedExport);
          const exportTimeout = setTimeout(() => exportAbortController.abort(), PLAYABLE_EXPORT_TIMEOUT_MS);
          playableExportInFlight = true;
          const exportStartedAt = Date.now();
          console.info(`[playable-export] started route=${pathname}`);
          let transientExportRoot = null;
          try {
            let payload;
            try {
              payload = JSON.parse(await readRequestBody(
                request,
                MAX_PLAYABLE_EXPORT_BYTES,
                'Playable export request'
              ));
            } catch (error) {
              if (error.statusCode === 413) throw error;
              const invalidPayloadError = new Error('导出请求不是有效的 JSON。');
              invalidPayloadError.statusCode = 400;
              throw invalidPayloadError;
            }
            if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
              const error = new Error('导出请求格式无效。');
              error.statusCode = 400;
              throw error;
            }
            const exportAll = pathname === '/__playable-export-all';
            if (!exportAll && !PLAYABLE_EXPORT_PLATFORMS.has(payload.platform)) {
              const error = new Error('不支持该导出平台。');
              error.statusCode = 400;
              throw error;
            }
            if (!payload.tuning || typeof payload.tuning !== 'object' || Array.isArray(payload.tuning)) {
              const error = new Error('导出请求缺少有效的场景参数。');
              error.statusCode = 400;
              throw error;
            }
            let levelDocument = null;
            if (payload.levelDocument !== undefined) {
              const selectedLevelKey = payload.tuning.level?.selected;
              validateWebLevelDocument(payload.levelDocument, selectedLevelKey);
              if (payload.levelDocumentBaseRevision !== null && payload.levelDocumentBaseRevision !== undefined) {
                if (typeof payload.levelDocumentBaseRevision !== 'string' || !/^[a-f0-9]{64}$/iu.test(payload.levelDocumentBaseRevision)) {
                  const error = new Error('导出关卡草稿的版本标识无效，请重新打开关卡编辑器。');
                  error.statusCode = 409;
                  throw error;
                }
                const savedEntry = await readWebLevelDocument(selectedLevelKey).catch((error) => {
                  if (error.code === 'ENOENT') return null;
                  throw error;
                });
                if (!savedEntry || savedEntry.revision !== payload.levelDocumentBaseRevision) {
                  const error = new Error('关卡文件已在其他位置发生变化，请重新打开关卡编辑器后再导出。');
                  error.statusCode = 409;
                  throw error;
                }
              }
              levelDocument = payload.levelDocument;
            }

            if (process.env.PLAYABLE_REMOTE_EDITOR === '1') {
              transientExportRoot = await mkdtemp(path.join(os.tmpdir(), 'bus-loop-remote-export-'));
            }
            const { exportAllPlayablePackages, exportPlayablePackage } = await import('./scripts/export-playable-package.mjs');
            const result = await (exportAll ? exportAllPlayablePackages : exportPlayablePackage)({
              projectRoot: process.cwd(),
              ...(exportAll ? {} : { platform: payload.platform }),
              tuning: payload.tuning,
              levelDocument,
              signal: exportAbortController.signal,
              // The editor's export action is a packaging/download operation.
              // Platform checks remain available through the CLI, but must not
              // block a user who explicitly asks for the playable artifact.
              skipChecks: true,
              ...(transientExportRoot ? { outputDir: transientExportRoot } : {})
            });
            if (
              !result?.filePath
              || result.resourceMode !== 'package-only'
              || !['html', 'zip'].includes(result.format)
              || result.checkSummary?.passed !== true
            ) {
              throw new Error('Playable export did not produce an artifact.');
            }

            const fileName = playableExportFilename(result.fileName, result.format);
            const file = await readFile(result.filePath);
            const passedCount = Number(result.checkSummary.passedCount) || 0;
            const totalCount = Number(result.checkSummary.totalCount) || passedCount;
            response.statusCode = 200;
            response.setHeader('Content-Type', result.format === 'zip' ? 'application/zip' : 'text/html; charset=utf-8');
            response.setHeader('Content-Length', file.byteLength);
            response.setHeader('Content-Disposition', playableExportDisposition(fileName));
            response.setHeader('Cache-Control', 'no-store');
            response.setHeader('X-Content-Type-Options', 'nosniff');
            response.setHeader('X-Playable-Resource-Mode', result.resourceMode);
            const checksSkipped = result.checkSummary.conclusion === 'SKIPPED_LOCAL_CHECKS'
              || result.checkSummary.conclusion === 'EXPORTED_WITHOUT_LOCAL_CHECKS';
            response.setHeader('X-Playable-Check', checksSkipped
              ? 'skipped; local checks disabled'
              : `passed; ${passedCount}/${totalCount}`);
            response.setHeader('X-Playable-Source-Cache', result.sourceCacheHit ? 'hit' : 'miss');
            response.setHeader('X-Playable-Export-Duration-Ms', String(Date.now() - exportStartedAt));
            response.end(file);
          } catch (error) {
            const statusCode = Number.isInteger(error.statusCode) && error.statusCode >= 400 && error.statusCode < 500
              ? error.statusCode
              : 500;
            const detail = String(error?.message || error || 'unknown export error').slice(-2_000);
            const compactDetail = detail.replace(/\s+/gu, ' ').slice(-800);
            if (statusCode === 500) console.info(`[playable-export] failed route=${pathname} durationMs=${Date.now() - exportStartedAt} error=${detail}`);
            sendJson(response, statusCode, {
              error: statusCode === 500
                ? `试玩包生成或本地检测失败：${compactDetail}`
                : error.message,
              durationMs: Date.now() - exportStartedAt,
              ...(statusCode === 500 ? { detail } : {})
            });
          } finally {
            clearTimeout(exportTimeout);
            request.off('aborted', abortDisconnectedExport);
            response.off('close', abortDisconnectedExport);
            if (transientExportRoot) {
              await rm(transientExportRoot, { recursive: true, force: true }).catch((error) => {
                console.warn('[playable-export] Failed to clean temporary export files:', error);
              });
            }
            playableExportInFlight = false;
            console.info(`[playable-export] finished route=${pathname} durationMs=${Date.now() - exportStartedAt}`);
          }
          return;
        }
        if (pathname === '/__level-authoring' && request.method === 'GET') {
          try {
            const items = (await readEditableLevelIdentities())
              .filter((level) => level.displayName)
              .sort((first, second) => Number(first.key.slice(5)) - Number(second.key.slice(5)));
            sendJson(response, 200, { items });
          } catch (error) {
            sendJson(response, 500, { error: error.message });
          }
          return;
        }
        if (pathname === '/__level-authoring/import' && request.method === 'POST') {
          try {
            const body = JSON.parse(await readRequestBody(request, MAX_WEB_LEVEL_BYTES, 'Web level JSON'));
            const document = body?.document ?? body;
            const targetLevelId = body?.targetLevelKey ?? null;
            const result = await importWebLevelDocument(document, targetLevelId, body?.filename);
            sendJson(response, result.created ? 201 : 200, {
              level: {
                key: result.document.key,
                displayName: result.document.displayName,
                filename: `${result.document.key}.json`,
                vehicleCount: result.document.vehicles.length,
                passengerCount: result.document.passengerQueues.flat().length
              },
              replaced: result.replaced,
              revision: result.revision,
              savedPath: path.relative(process.cwd(), result.targetPath).replaceAll('\\', '/')
            });
          } catch (error) {
            sendJson(response, error.statusCode ?? 400, { error: error.message });
          }
          return;
        }
        const levelExportMatch = pathname.match(/^\/__level-authoring-export\/(level[1-9]\d*)$/);
        if (levelExportMatch && request.method === 'GET') {
          try {
            const key = levelExportMatch[1];
            let source;
            let filename;
            let contentType;
            try {
              source = await readFile(path.join(WEB_LEVEL_ROOT, `${key}.json`), 'utf8');
              const document = JSON.parse(source);
              validateWebLevelDocument(document, key);
              filename = `${document.displayName || key}.json`;
              contentType = 'application/json; charset=utf-8';
            } catch (error) {
              if (error.code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error;
              source = await readFile(path.join(DEFAULT_UNITY_LEVEL_SOURCE_ROOT, `${key}.asset`), 'utf8');
              filename = `${key}.asset`;
              contentType = 'text/plain; charset=utf-8';
            }
            response.statusCode = 200;
            response.setHeader('Content-Type', contentType);
            response.setHeader('Content-Disposition', levelExportDisposition(filename));
            response.setHeader('Cache-Control', 'no-store');
            response.end(source);
          } catch (error) {
            sendJson(response, error.code === 'ENOENT' ? 404 : error.statusCode ?? 400, { error: error.message });
          }
          return;
        }
        const webLevelStatusMatch = pathname.match(/^\/__level-authoring-status\/(level[1-9]\d*)$/);
        if (webLevelStatusMatch && request.method === 'GET') {
          try { sendJson(response, 200, await getWebLevelAvailability(webLevelStatusMatch[1], requestUrl.searchParams.get('name'))); }
          catch (error) { sendJson(response, error.statusCode ?? 400, { error: error.message }); }
          return;
        }
        const webLevelMatch = pathname.match(/^\/__level-authoring\/(level[1-9]\d*)$/);
        if (webLevelMatch && request.method === 'GET') {
          try { sendJson(response, 200, await readWebLevelDocument(webLevelMatch[1])); }
          catch (error) { sendJson(response, error.code === 'ENOENT' ? 404 : 400, { error: error.message }); }
          return;
        }
        if (webLevelMatch && request.method === 'PUT') {
          try {
            const body = JSON.parse(await readRequestBody(request, MAX_WEB_LEVEL_BYTES, 'Web level'));
            const result = await saveWebLevelDocument(webLevelMatch[1], body);
            sendJson(response, result.created ? 201 : 200, {
              document: result.document,
              revision: result.revision,
              savedPath: path.relative(process.cwd(), result.targetPath).replaceAll('\\', '/')
            });
          } catch (error) {
            sendJson(response, error.statusCode ?? 400, { error: error.message });
          }
          return;
        }
        if (webLevelMatch && request.method === 'DELETE') {
          try {
            const result = await deleteWebLevelDocument(webLevelMatch[1]);
            sendJson(response, 200, { key: result.key });
          } catch (error) {
            sendJson(response, error.statusCode ?? 400, { error: error.message });
          }
          return;
        }
        if (pathname === '/__unity-levels/open-folder' && request.method === 'POST') {
          try {
            const folderPath = await openFolder(DEFAULT_UNITY_LEVEL_SOURCE_ROOT);
            sendJson(response, 200, {
              path: path.relative(process.cwd(), folderPath).replaceAll('\\', '/')
            });
          } catch (error) {
            sendJson(response, 500, { error: error.message });
          }
          return;
        }
        if (pathname === '/__unity-levels/import' && request.method === 'POST') {
          try {
            const filename = decodeLevelFilename(request);
            const source = await readRequestBody(request, MAX_UNITY_LEVEL_BYTES, 'Unity level');
            const displayName = path.basename(filename, path.extname(filename));
            const [webLevels, importedLevels] = await Promise.all([
              readWebLevelIdentities(),
              readImportedLevelIdentities()
            ]);
            const webConflict = findLevelNameConflict(webLevels, { levelId: null, displayName });
            if (webConflict) {
              const error = new Error(`关卡名称「${displayName}」已被网页关卡 ${webConflict.key} 使用。请先删除或重命名该关卡，再导入。`);
              error.statusCode = 409;
              throw error;
            }
            const importedConflict = findLevelNameConflict(importedLevels, { levelId: null, displayName });
            if (importedConflict && BUILTIN_LEVEL_IDS.has(importedConflict.key)) {
              // A bundled level with no imported source of its own cannot be
              // refreshed in place; importing a same-named asset would silently
              // shadow the bundle, so ask for a renamed file instead.
              const artifactKeys = await readImportedArtifactKeys();
              if (!artifactKeys.has(importedConflict.key)) {
                const error = new Error(`内置关卡 ${importedConflict.key} 已使用名称「${displayName}」，请重命名 .asset 文件后再导入。`);
                error.statusCode = 409;
                throw error;
              }
            }
            // Re-importing a file that matches an existing imported level's
            // name refreshes that level in place instead of stacking another
            // copy beside it (the level20/level35 pile-up).
            const targetKey = importedConflict?.key ?? await nextAvailableLevelId();
            const result = await importUnityLevelAsset({
              filename,
              source,
              targetKey,
              displayName
            });
            sendJson(response, 201, {
              level: { ...result.level, displayName: result.level.displayName || filename.replace(/\.asset$/i, '') },
              replaced: result.replaced,
              savedPath: path.relative(process.cwd(), result.outputPath).replaceAll('\\', '/')
            });
          } catch (error) {
            sendJson(response, error.statusCode ?? 400, { error: error.message });
          }
          return;
        }
        const unityDeleteMatch = pathname.match(/^\/__unity-levels\/(level[1-9]\d*)$/);
        if (unityDeleteMatch && request.method === 'GET') {
          try {
            const level = await readImportedUnityLevelDefinition(unityDeleteMatch[1]);
            if (!level) {
              sendJson(response, 404, { error: '导入关卡不存在，请重新导入。' });
              return;
            }
            sendJson(response, 200, { level });
          } catch (error) {
            sendJson(response, 500, { error: error.message });
          }
          return;
        }
        if (unityDeleteMatch && request.method === 'DELETE') {
          try {
            if (BUILTIN_LEVEL_IDS.has(unityDeleteMatch[1])) {
              const error = new Error('内置 Unity 关卡不能删除。');
              error.statusCode = 400;
              throw error;
            }
            const result = await deleteUnityLevel(unityDeleteMatch[1]);
            sendJson(response, 200, { key: result.key });
          } catch (error) {
            sendJson(response, error.statusCode ?? 400, { error: error.message });
          }
          return;
        }
        if (pathname === '/__spatial-conveyors' && request.method === 'GET') {
          try {
            sendJson(response, 200, { items: await listSpatialConveyors() });
          } catch (error) {
            sendJson(response, 500, { error: error.message });
          }
          return;
        }
        if (pathname === '/__spatial-conveyors/open-folder' && request.method === 'POST') {
          try {
            const folderPath = await openFolder(DEFAULT_OUTPUT_ROOT);
            sendJson(response, 200, {
              path: path.relative(process.cwd(), folderPath).replaceAll('\\', '/')
            });
          } catch (error) {
            sendJson(response, 500, { error: error.message });
          }
          return;
        }
        const packageMatch = pathname.match(/^\/__spatial-conveyors\/package\/([^/]+)$/);
        if (packageMatch && request.method === 'GET') {
          try {
            const packageId = decodeURIComponent(packageMatch[1]);
            sendJson(response, 200, await readSpatialConveyorPackage(packageId));
          } catch (error) {
            sendJson(response, error.code === 'ENOENT' ? 404 : 400, { error: error.message });
          }
          return;
        }
        if (packageMatch && request.method === 'PUT') {
          try {
            const packageId = decodeURIComponent(packageMatch[1]);
            const body = JSON.parse(await readRequestBody(request, MAX_SPATIAL_PACKAGE_BYTES));
            if (body.packageData?.id !== packageId) throw new Error('Package URL and payload id do not match.');
            const result = await saveSpatialConveyorPackage(body);
            sendJson(response, 200, {
              packageData: result.packageData,
              revision: result.revision,
              savedPath: path.relative(process.cwd(), result.targetPath).replaceAll('\\', '/')
            });
          } catch (error) {
            sendJson(response, error.statusCode ?? 400, { error: error.message });
          }
          return;
        }
        if (pathname !== '/__spatial-conveyors/import' || request.method !== 'POST') return next();

        try {
          const filename = decodePrefabFilename(request);
          const source = await readRequestBody(request, MAX_PREFAB_BYTES);
          const result = await importSpatialConveyorPrefab({ filename, source });
          sendJson(response, 201, {
            item: {
              id: result.conveyorPackage.id,
              label: result.conveyorPackage.label,
              value: `spatial:${result.conveyorPackage.id}`,
              filename: path.basename(result.outputPath),
              sourceFilename: result.conveyorPackage.source.filename,
              pointCount: result.conveyorPackage.path.points.length
            },
            savedPath: path.relative(process.cwd(), result.outputPath).replaceAll('\\', '/')
          });
        } catch (error) {
          sendJson(response, error.statusCode ?? 400, { error: error.message });
        }
      });
    };
    return {
      name: 'playable-editor-services',
      configureServer: configure,
      configurePreviewServer: configure
    };
  })()]
});
