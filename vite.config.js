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
  'level5', 'level8', 'level9', 'level10', 'level12', 'level13', 'level15', 'level16',
  'level17', 'level18'
]);
const LEVEL_ARTIFACT_PATH = path.resolve('artifacts', 'unity-levels.json');
const WEB_LEVEL_ROOT = path.resolve('artifacts', 'web-levels');
const WEB_LEVEL_BACKUP_ROOT = path.resolve('artifacts', 'web-level-backups');
const MAX_WEB_LEVEL_BYTES = 2 * 1024 * 1024;

const MAX_PREFAB_BYTES = 12 * 1024 * 1024;
const MAX_SPATIAL_PACKAGE_BYTES = 4 * 1024 * 1024;
const SPATIAL_BACKUP_ROOT = path.resolve('artifacts', 'spatial-conveyor-backups');

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

async function saveWebLevelDocument(levelId, { document, baseRevision }) {
  validateWebLevelId(levelId);
  validateWebLevelDocument(document, levelId);
  await mkdir(WEB_LEVEL_ROOT, { recursive: true });
  const targetPath = path.join(WEB_LEVEL_ROOT, `${levelId}.json`);
  let currentSource = null;
  try { currentSource = await readFile(targetPath, 'utf8'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
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
  return { document, revision: spatialRevision(source), targetPath };
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

export default defineConfig({
  plugins: [{
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
        const pathname = new URL(request.url, 'http://localhost').pathname;
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
            sendJson(response, 200, {
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
