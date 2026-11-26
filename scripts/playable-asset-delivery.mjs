import { execFile } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { access, mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { stripMp3ProductionTags } from './playable-mp3-tags.mjs';
import { stripUnreferencedFbxDisplayLayers } from './playable-fbx-display-layers.mjs';

export const ASSET_DELIVERY_RULE_VERSION = 'lossless-media-v3';
const MAX_PNG_BYTES = 8 * 1024 * 1024;
const codecScript = fileURLToPath(new URL('./playable-lossless-webp.py', import.meta.url));
const exec = promisify(execFile);
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const binaryMime = 'application/octet-stream';

const mimeTypes = new Map([
  ['.css', 'text/css'], ['.html', 'text/html'], ['.js', 'text/javascript'],
  ['.jpg', 'image/jpeg'], ['.jpeg', 'image/jpeg'], ['.png', 'image/png'], ['.webp', 'image/webp'],
  ['.mp3', 'audio/mpeg'], ['.wav', 'audio/wav'], ['.mp4', 'video/mp4'], ['.ttf', 'font/ttf']
]);

export const mimeForPlayableAsset = url => mimeTypes.get(path.extname(url).toLowerCase()) ?? binaryMime;
export const embeddedByteCount = (mime, bytes) => ('data:' + mime + ';base64,').length + Math.ceil(bytes / 3) * 4;
export const playableAssetDataUri = ({ bytes, mime }) => `data:${mime};base64,${bytes.toString('base64')}`;

function assetUse(url, mime) {
  if (mime === binaryMime && /\.fbx(?:\.bin)?$/iu.test(url)) return 'fbx';
  if (mime === 'audio/mpeg') return 'mp3';
  if (mime !== 'image/png') return 'unchanged-format';
  if (/(?:^|[/_.-])(?:vat(?:mesh)?|anim[_-]?map|heightmap|metal(?:lic)?|roughness|normalmap|occlusion|depthmap|placeholder)(?=[/_.-]|$)/iu.test(url)) {
    return 'numeric-or-fixed-texture';
  }
  return 'static-png';
}

async function runCodec(python, args, bytes) {
  const processResult = exec(python, [codecScript, ...args], {
    encoding: 'buffer', timeout: 35000, maxBuffer: MAX_PNG_BYTES + 1024
  });
  // A failed launch can close stdin before the source is written.
  const input = processResult.child.stdin;
  input.on('error', () => {});
  input.end(bytes);
  return (await processResult).stdout;
}

async function resolvePython(root) {
  if (process.env.PLAYABLE_ASSET_PYTHON) return process.env.PLAYABLE_ASSET_PYTHON;
  const local = path.join(root, 'artifacts', '.playable-codecs', 'bin', 'python3');
  try {
    await access(local);
    return local;
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    return 'python3';
  }
}

const codecProbes = new Map();
function probeCodec(python) {
  if (!codecProbes.has(python)) {
    codecProbes.set(python, runCodec(python, ['--probe']).then(output => {
      const identity = JSON.parse(output.toString());
      return identity.exact === true ? identity : { unavailable: identity.reason };
    }).catch(() => ({ unavailable: 'webp-codec-unavailable' })));
  }
  return codecProbes.get(python);
}

export async function createAssetDelivery(root = process.cwd(), {
  cacheDir = process.env.PLAYABLE_ASSET_CACHE_DIR ?? path.join(root, 'artifacts', '.playable-asset-cache')
} = {}) {
  const python = await resolvePython(root);
  const codec = await probeCodec(python);
  const identity = { rules: ASSET_DELIVERY_RULE_VERSION, codec, fbxGzip: process.versions.zlib };
  const childEnv = { PLAYABLE_ASSET_PYTHON: python, PLAYABLE_ASSET_CACHE_DIR: cacheDir };
  let imageQueue = Promise.resolve();

  function sourceInfo(url, bytes, mime) {
    const sourceSha256 = sha256(bytes);
    const use = assetUse(url, mime);
    const key = sha256(JSON.stringify([identity, use, mime, sourceSha256]));
    return { sourceSha256, use, cacheFile: path.join(cacheDir, key) };
  }

  async function readCache(cacheFile, sourceBytes) {
    try {
      const entry = await readFile(cacheFile);
      const newline = entry.indexOf(10);
      if (newline < 0) return null;
      const record = JSON.parse(entry.toString('utf8', 0, newline));
      const bytes = record.optimized ? entry.subarray(newline + 1) : sourceBytes;
      if (record.deliverySha256 !== sha256(bytes)) return null;
      return { ...record, bytes, cacheHit: true };
    } catch (error) {
      if (error.code !== 'ENOENT' && !(error instanceof SyntaxError)) {
        console.warn(`Playable asset cache read: ${error.code ?? error.message}`);
      }
      return null;
    }
  }

  async function writeCache(cacheFile, result) {
    const temporary = `${cacheFile}.${randomUUID()}.tmp`;
    const { bytes, cacheHit, ...record } = result;
    try {
      await mkdir(cacheDir, { recursive: true });
      const header = Buffer.from(`${JSON.stringify(record)}\n`);
      await writeFile(temporary, result.optimized ? Buffer.concat([header, bytes]) : header);
      await rename(temporary, cacheFile);
    } catch (error) {
      console.warn(`Playable asset cache write: ${error.code ?? error.message}`);
      await unlink(temporary).catch(() => {});
    }
  }

  async function encodePng(bytes) {
    if (!codec.exact) return { bytes, reason: codec.unavailable };
    if (bytes.length > MAX_PNG_BYTES) return { bytes, reason: 'png-byte-budget' };
    try {
      const output = await runCodec(python, [], bytes);
      const newline = output.indexOf(10);
      if (newline < 0) throw new Error('Missing codec status');
      const { reason } = JSON.parse(output.toString('utf8', 0, newline));
      if (reason !== 'lossless-webp') return { bytes, reason };
      return { bytes: output.subarray(newline + 1), mime: 'image/webp', reason };
    } catch {
      return { bytes, reason: 'webp-codec-failed' };
    }
  }

  async function select(url, bytes, sourceMime = mimeForPlayableAsset(url)) {
    const { sourceSha256, use, cacheFile } = sourceInfo(url, bytes, sourceMime);
    const eligible = use === 'mp3' || use === 'static-png' || use === 'fbx';
    const cached = eligible ? await readCache(cacheFile, bytes) : null;
    if (cached) return cached;

    let candidate = { bytes, reason: use };
    if (use === 'mp3') candidate = stripMp3ProductionTags(bytes);
    if (use === 'fbx') candidate = stripUnreferencedFbxDisplayLayers(bytes);
    if (use === 'static-png') {
      // Each packager submits one encode at a time, even if callers load
      // assets concurrently.
      const work = imageQueue.then(() => encodePng(bytes));
      imageQueue = work.then(() => {});
      candidate = await work;
    }
    let mime = candidate.mime ?? sourceMime;
    let reason = candidate.reason;
    // Successful FBX cleanup is required even when gzip savings round to zero.
    const optimized = candidate.bytes !== bytes && (candidate.removedLayers > 0
      || embeddedByteCount(mime, candidate.bytes.length) < embeddedByteCount(sourceMime, bytes.length));
    if (!optimized) {
      if (candidate.bytes !== bytes) reason = 'embedded-candidate-not-smaller';
      mime = sourceMime;
    }
    const selected = optimized ? candidate.bytes : bytes;
    const result = {
      bytes: selected, mime, sourceMime, sourceSha256, deliverySha256: optimized ? sha256(selected) : sourceSha256,
      sourceBytes: bytes.length, deliveryBytes: selected.length, optimized, reason, cacheHit: false
    };
    if (candidate.removedLayers) result.removedLayers = candidate.removedLayers;
    if (eligible && reason !== 'webp-codec-failed') await writeCache(cacheFile, result);
    return result;
  }

  async function estimate(url, filePath, size) {
    const mime = mimeForPlayableAsset(url);
    const use = assetUse(url, mime);
    const mayBeCached = use === 'mp3' || use === 'fbx' || (use === 'static-png' && size <= MAX_PNG_BYTES);
    if (mayBeCached) return estimateBytes(url, await readFile(filePath), mime);
    return { bytes: size, sourceBytes: size, embeddedBytes: embeddedByteCount(mime, size), cached: false };
  }

  async function estimateBytes(url, source, mime) {
    const selected = await readCache(sourceInfo(url, source, mime).cacheFile, source);
    const bytes = selected?.deliveryBytes ?? source.length;
    return { bytes, sourceBytes: source.length, embeddedBytes: embeddedByteCount(selected?.mime ?? mime, bytes), cached: Boolean(selected) };
  }

  return { select, estimate, estimateBytes, identity, childEnv };
}

export function decodeSpatialTexture(dataUri) {
  const match = /^data:(image\/(?:png|jpeg|webp));base64,([a-z0-9+/]+={0,2})$/iu.exec(dataUri);
  if (!match) return null;
  return { bytes: Buffer.from(match[2], 'base64'), mime: match[1].toLowerCase() };
}

export async function selectSpatialTexture(delivery, url, dataUri) {
  const texture = decodeSpatialTexture(dataUri);
  return texture && delivery.select(url, texture.bytes, texture.mime);
}

export function assetDeliveryReport(url, result) {
  const { bytes, ...record } = result;
  return { url, ...record, bytes: embeddedByteCount(result.mime, bytes.length) };
}
