import { mkdir, readdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

export const DEFAULT_FOREGROUND_VIDEO_ROOT = path.resolve(
  'public',
  'assets',
  'playable',
  'foreground-videos'
);
export const MAX_FOREGROUND_VIDEO_BYTES = 20 * 1024 * 1024;
export const FOREGROUND_VIDEO_ASSET_ROOT = '/assets/playable/foreground-videos';
const SUPPORTED_EXTENSIONS = new Set(['.mp4', '.webm']);

export function validateForegroundVideoFilename(filename) {
  if (
    typeof filename !== 'string'
    || !filename
    || path.basename(filename) !== filename
    || /[<>:"/\\|?*\x00-\x1f]/u.test(filename)
    || !SUPPORTED_EXTENSIONS.has(path.extname(filename).toLowerCase())
  ) {
    throw new Error('Only one local .mp4 or .webm file can be imported.');
  }
  return filename;
}

export function getForegroundVideoAssetUrl(filename) {
  return `${FOREGROUND_VIDEO_ASSET_ROOT}/${validateForegroundVideoFilename(filename)}`;
}

export async function listForegroundVideos({ outputRoot = DEFAULT_FOREGROUND_VIDEO_ROOT } = {}) {
  let entries;
  try {
    entries = await readdir(outputRoot, { withFileTypes: true });
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }

  const items = await Promise.all(entries
    .filter((entry) => entry.isFile() && SUPPORTED_EXTENSIONS.has(path.extname(entry.name).toLowerCase()))
    .map(async (entry) => {
      const filename = validateForegroundVideoFilename(entry.name);
      const fileStat = await stat(path.join(outputRoot, filename));
      return {
        filename,
        label: path.basename(filename, path.extname(filename)),
        assetUrl: getForegroundVideoAssetUrl(filename),
        size: fileStat.size
      };
    }));

  return items.sort((left, right) => left.filename.localeCompare(right.filename, 'zh-CN'));
}

export async function importForegroundVideo(
  { filename, bytes },
  { outputRoot = DEFAULT_FOREGROUND_VIDEO_ROOT } = {}
) {
  const safeFilename = validateForegroundVideoFilename(filename);
  if (!(bytes instanceof Uint8Array)) throw new Error('Foreground video payload is invalid.');
  if (bytes.byteLength === 0) throw new Error('Foreground video is empty.');
  if (bytes.byteLength > MAX_FOREGROUND_VIDEO_BYTES) {
    const error = new Error('Foreground video exceeds the 20 MB import limit.');
    error.statusCode = 413;
    throw error;
  }

  await mkdir(outputRoot, { recursive: true });
  const outputPath = path.join(outputRoot, safeFilename);
  let replaced = false;
  try {
    await stat(outputPath);
    replaced = true;
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  await writeFile(outputPath, bytes);

  return {
    item: {
      filename: safeFilename,
      label: path.basename(safeFilename, path.extname(safeFilename)),
      assetUrl: getForegroundVideoAssetUrl(safeFilename),
      size: bytes.byteLength
    },
    outputPath,
    replaced
  };
}
