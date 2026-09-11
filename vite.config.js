import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFile, mkdir, readdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { defineConfig } from 'vite';
import {
  DEFAULT_OUTPUT_ROOT,
  importSpatialConveyorPrefab
} from './scripts/spatial-conveyor-importer.mjs';
import {
  DEFAULT_UNITY_LEVEL_SOURCE_ROOT,
  MAX_UNITY_LEVEL_BYTES,
  importUnityLevelAsset
} from './scripts/unity-level-importer.mjs';

const BUILTIN_LEVEL_IDS = new Set([
  'level5', 'level7', 'level8', 'level9', 'level10', 'level12', 'level13', 'level15',
  'level16', 'level17', 'level18', 'level22', 'level26', 'level28', 'level29', 'level33',
  'level39'
]);
const LEVEL_ARTIFACT_PATH = path.resolve('artifacts', 'unity-levels.json');
const WEB_LEVEL_ROOT = path.resolve('artifacts', 'web-levels');
const WEB_LEVEL_BACKUP_ROOT = path.resolve('artifacts', 'web-level-backups');
const MAX_WEB_LEVEL_BYTES = 2 * 1024 * 1024;

const MAX_PREFAB_BYTES = 12 * 1024 * 1024;
const MAX_SPATIAL_PACKAGE_BYTES = 4 * 1024 * 1024;
const SPATIAL_BACKUP_ROOT = path.resolve('artifacts', 'spatial-conveyor-backups');
const PLAYABLE_BUILD_PLATFORM = process.env.PLAYABLE_PLATFORM || 'applovin';
const LEVEL_CATALOG_ALIAS = process.env.PLAYABLE_LEVEL_CATALOG_PATH
  ? [{
      find: './level-catalog.js',
      replacement: path.resolve(process.env.PLAYABLE_LEVEL_CATALOG_PATH)
    }]
  : [];
const MAX_PLAYABLE_EXPORT_BYTES = 1024 * 1024;
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

function normalizeLevelDisplayName(value) {
  return String(value ?? '').normalize('NFKC').trim().toLocaleLowerCase();
}

async function readImportedLevelIdentities() {
  let levels = [];
  try {
    const artifact = JSON.parse(await readFile(LEVEL_ARTIFACT_PATH, 'utf8'));
    levels = Array.isArray(artifact.levels) ? artifact.levels : [];
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  const identities = new Map(levels.map((level) => [level.key, {
    key: level.key,
    displayName: String(level.displayName ?? level.key ?? '').trim(),
    source: 'catalog'
  }]));
  for (const key of BUILTIN_LEVEL_IDS) {
    if (!identities.has(key)) identities.set(key, { key, displayName: `${key} (${key}.asset)`, source: 'catalog' });
  }
  return [...identities.values()];
}

async function readWebLevelIdentities() {
  let entries;
  try { entries = await readdir(WEB_LEVEL_ROOT, { withFileTypes: true }); }
  catch (error) { if (error.code === 'ENOENT') return []; throw error; }
  return (await Promise.all(entries
    .filter((entry) => entry.isFile() && /^level[1-9]\d*\.json$/.test(entry.name))
    .map(async (entry) => {
      const key = entry.name.slice(0, -5);
      try {
        const document = JSON.parse(await readFile(path.join(WEB_LEVEL_ROOT, entry.name), 'utf8'));
        return { key, displayName: String(document.displayName ?? '').trim(), source: 'web' };
      } catch {
        return { key, displayName: '', source: 'web' };
      }
    }))).filter(Boolean);
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

function sendJson(response, statusCode, payload) {
  response.statusCode = statusCode;
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.setHeader('Cache-Control', 'no-store');
  response.end(JSON.stringify(payload));
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
  if (BUILTIN_LEVEL_IDS.has(levelId)) return true;
  try {
    const artifact = JSON.parse(await readFile(LEVEL_ARTIFACT_PATH, 'utf8'));
    return artifact.levels?.some((level) => level?.key === levelId) ?? false;
  } catch {
    return false;
  }
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

export default defineConfig({
  esbuild: PLAYABLE_BUILD_PLATFORM === 'mintegral'
    ? { pure: ['console.error'] }
    : undefined,
  build: {
    modulePreload: { polyfill: PLAYABLE_BUILD_PLATFORM !== 'mintegral' }
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
    __PLAYABLE_PLATFORM__: JSON.stringify(PLAYABLE_BUILD_PLATFORM)
  },
  plugins: [mintegralRuntimeCompatibility(), {
    name: 'playable-editor-services',
    configureServer(server) {
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

          playableExportInFlight = true;
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

            const { exportAllPlayablePackages, exportPlayablePackage } = await import('./scripts/export-playable-package.mjs');
            const result = await (exportAll ? exportAllPlayablePackages : exportPlayablePackage)({
              projectRoot: process.cwd(),
              ...(exportAll ? {} : { platform: payload.platform }),
              tuning: payload.tuning
            });
            if (
              !result?.filePath
              || result.resourceMode !== 'package-only'
              || !['html', 'zip'].includes(result.format)
              || result.checkSummary?.passed !== true
            ) {
              throw new Error('Playable export did not produce a verified artifact.');
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
            response.setHeader('X-Playable-Check', `passed; ${passedCount}/${totalCount}`);
            response.end(file);
          } catch (error) {
            const statusCode = Number.isInteger(error.statusCode) && error.statusCode >= 400 && error.statusCode < 500
              ? error.statusCode
              : 500;
            if (statusCode === 500) console.error('[playable-export] Export failed:', error);
            sendJson(response, statusCode, {
              error: statusCode === 500
                ? '试玩包生成或本地检测失败，未生成下载文件。请查看开发服务器日志。'
                : error.message
            });
          } finally {
            playableExportInFlight = false;
          }
          return;
        }
        if (pathname === '/__level-authoring' && request.method === 'GET') {
          try {
            const items = (await readWebLevelIdentities())
              .filter((level) => level.displayName)
              .sort((first, second) => Number(first.key.slice(5)) - Number(second.key.slice(5)));
            sendJson(response, 200, { items });
          } catch (error) {
            sendJson(response, 500, { error: error.message });
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
            const result = await importUnityLevelAsset({ filename, source });
            sendJson(response, 201, {
              level: result.level,
              replaced: result.replaced,
              savedPath: path.relative(process.cwd(), result.outputPath).replaceAll('\\', '/')
            });
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
    }
  }]
});
