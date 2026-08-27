import { spawn } from 'node:child_process';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { defineConfig } from 'vite';
import {
  DEFAULT_OUTPUT_ROOT,
  importSpatialConveyorPrefab
} from './scripts/spatial-conveyor-importer.mjs';

const LEVEL_IDS = new Set([
  'level5', 'level8', 'level9', 'level10', 'level12', 'level13', 'level15', 'level16',
  'level17', 'level18'
]);

const MAX_PREFAB_BYTES = 12 * 1024 * 1024;

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
  if (!packageId || /[<>:"/\\|?*\x00-\x1f]/.test(packageId) || path.basename(packageId) !== packageId) {
    throw new Error('Spatial conveyor package id is invalid.');
  }
  const packageData = JSON.parse(await readFile(path.join(DEFAULT_OUTPUT_ROOT, `${packageId}.json`), 'utf8'));
  if (packageData?.kind !== 'spatial' || packageData.id !== packageId) {
    throw new Error('Spatial conveyor package data is invalid.');
  }
  return packageData;
}

async function openSpatialConveyorFolder() {
  const folderPath = path.resolve(DEFAULT_OUTPUT_ROOT);
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

function readRequestBody(request, maxBytes) {
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
        const error = new Error(`Prefab exceeds the ${Math.round(maxBytes / 1024 / 1024)} MB import limit.`);
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
      server.middlewares.use('/__playable-level', (request, response, next) => {
        if (request.method !== 'POST') return next();
        let body = '';
        request.setEncoding('utf8');
        request.on('data', (chunk) => {
          body += chunk;
          if (body.length > 64) request.destroy();
        });
        request.on('end', async () => {
          const levelId = body.trim();
          if (!LEVEL_IDS.has(levelId)) {
            response.statusCode = 400;
            response.end('Unknown level');
            return;
          }
          await writeFile(path.resolve('artifacts', 'selected-level.txt'), `${levelId}\n`, 'utf8');
          response.statusCode = 204;
          response.end();
        });
      });

      server.middlewares.use(async (request, response, next) => {
        const pathname = new URL(request.url, 'http://localhost').pathname;
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
            const folderPath = await openSpatialConveyorFolder();
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
            sendJson(response, 200, { packageData: await readSpatialConveyorPackage(packageId) });
          } catch (error) {
            sendJson(response, error.code === 'ENOENT' ? 404 : 400, { error: error.message });
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
