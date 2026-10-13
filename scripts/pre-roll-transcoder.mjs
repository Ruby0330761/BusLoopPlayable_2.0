import { spawn } from 'node:child_process';
import { constants as fsConstants } from 'node:fs';
import { access, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

export const PRE_ROLL_COMPRESSION_VERSION = 1;
export const PRE_ROLL_MAX_COMPRESSED_BYTES = 2 * 1024 * 1024;
export const PRE_ROLL_COMPRESSION_PROFILES = Object.freeze([
  Object.freeze({ id: 'balanced', crf: 28, maxrate: '1400k', bufsize: '2800k', audioBitrate: '64k' }),
  Object.freeze({ id: 'compact', crf: 31, maxrate: '900k', bufsize: '1800k', audioBitrate: '48k' })
]);

const TRANSCODE_TIMEOUT_MS = 120 * 1000;
const MAX_FFMPEG_ERROR_BYTES = 12 * 1024;

export class PreRollCompressionError extends Error {
  constructor(message, { code = 'PRE_ROLL_COMPRESSION_FAILED', statusCode = 422, cause } = {}) {
    super(message, cause ? { cause } : undefined);
    this.name = 'PreRollCompressionError';
    this.code = code;
    this.statusCode = statusCode;
  }
}

function executableCandidates() {
  const configured = String(process.env.FFMPEG_PATH ?? '').trim();
  const candidates = [
    configured,
    ...String(process.env.PATH ?? '')
      .split(path.delimiter)
      .filter(Boolean)
      .map((directory) => path.join(directory, process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg')),
    '/usr/local/bin/ffmpeg',
    '/usr/bin/ffmpeg',
    '/opt/homebrew/bin/ffmpeg',
    path.join(os.homedir(), '.local', 'bin', 'ffmpeg')
  ];
  return [...new Set(candidates.filter(Boolean))];
}

export async function resolveFfmpegBinary() {
  for (const candidate of executableCandidates()) {
    try {
      await access(candidate, fsConstants.X_OK);
      return candidate;
    } catch {
      // Try the next configured or PATH candidate.
    }
  }
  throw new PreRollCompressionError(
    '视频压缩服务不可用，请在服务端安装 FFmpeg。',
    { code: 'FFMPEG_UNAVAILABLE', statusCode: 503 }
  );
}

export function buildPreRollFfmpegArgs(inputPath, outputPath, profile = PRE_ROLL_COMPRESSION_PROFILES[0]) {
  if (!profile?.id || !Number.isInteger(profile.crf)) {
    throw new TypeError('A valid pre-roll compression profile is required.');
  }
  return [
    '-hide_banner',
    '-loglevel', 'error',
    '-nostdin',
    '-y',
    '-i', inputPath,
    '-map', '0:v:0',
    '-map', '0:a?',
    '-vf', "scale=w='min(720,iw)':h='min(1280,ih)':force_original_aspect_ratio=decrease:force_divisible_by=2",
    '-c:v', 'libx264',
    '-preset', 'veryfast',
    '-profile:v', 'main',
    '-crf', String(profile.crf),
    '-maxrate', profile.maxrate,
    '-bufsize', profile.bufsize,
    '-pix_fmt', 'yuv420p',
    '-tag:v', 'avc1',
    '-movflags', '+faststart',
    '-c:a', 'aac',
    '-b:a', profile.audioBitrate,
    '-ac', '2',
    '-ar', '44100',
    '-threads', '1',
    outputPath
  ];
}

function runFfmpeg(binary, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill('SIGKILL');
      reject(new PreRollCompressionError(
        '视频压缩超时，请缩短视频后重试。',
        { code: 'FFMPEG_TIMEOUT', statusCode: 422 }
      ));
    }, TRANSCODE_TIMEOUT_MS);
    child.stderr.on('data', (chunk) => {
      stderr = `${stderr}${chunk}`.slice(-MAX_FFMPEG_ERROR_BYTES);
    });
    child.once('error', (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(new PreRollCompressionError(
        '视频压缩服务启动失败，请检查 FFmpeg 安装。',
        { code: 'FFMPEG_SPAWN_FAILED', statusCode: 503, cause: error }
      ));
    });
    child.once('close', (code, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (code === 0) {
        resolve();
        return;
      }
      const detail = stderr.trim();
      reject(new PreRollCompressionError(
        detail ? `视频压缩失败：${detail}` : `视频压缩失败（退出码 ${code ?? signal ?? 'unknown'}）。`,
        { code: 'FFMPEG_FAILED', statusCode: 422 }
      ));
    });
  });
}

function resultForSource(inputBytes, profile, outputBytes) {
  return {
    bytes: outputBytes,
    sourceBytes: inputBytes.byteLength,
    outputBytes: outputBytes.byteLength,
    compressed: outputBytes !== inputBytes,
    compression: {
      version: PRE_ROLL_COMPRESSION_VERSION,
      profile: profile.id,
      codec: 'h264',
      audioCodec: 'aac',
      maxWidth: 720,
      maxHeight: 1280,
      crf: profile.crf,
      maxrate: profile.maxrate,
      audioBitrate: profile.audioBitrate
    }
  };
}

function retainedSourceResult(inputBytes) {
  return {
    bytes: inputBytes,
    sourceBytes: inputBytes.byteLength,
    outputBytes: inputBytes.byteLength,
    compressed: false,
    compression: {
      version: PRE_ROLL_COMPRESSION_VERSION,
      profile: 'retained-source',
      codec: 'source',
      audioCodec: 'source',
      maxWidth: 720,
      maxHeight: 1280,
      retainedSource: true
    }
  };
}

export async function compressPreRollBuffer(inputBytes, { maxOutputBytes = PRE_ROLL_MAX_COMPRESSED_BYTES } = {}) {
  if (!Buffer.isBuffer(inputBytes) || inputBytes.byteLength === 0) {
    throw new PreRollCompressionError('前贴视频为空。', { code: 'EMPTY_PRE_ROLL', statusCode: 400 });
  }
  const binary = await resolveFfmpegBinary();
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'bus-loop-pre-roll-'));
  const inputPath = path.join(tempRoot, 'input.mp4');
  const outputPath = path.join(tempRoot, 'output.mp4');
  try {
    await writeFile(inputPath, inputBytes);
    let lastResult = null;
    for (const profile of PRE_ROLL_COMPRESSION_PROFILES) {
      await runFfmpeg(binary, buildPreRollFfmpegArgs(inputPath, outputPath, profile));
      const outputBytes = await readFile(outputPath);
      if (outputBytes.byteLength === 0) {
        throw new PreRollCompressionError('视频压缩没有生成有效文件。', { code: 'FFMPEG_EMPTY_OUTPUT' });
      }
      lastResult = resultForSource(inputBytes, profile, outputBytes);
      if (outputBytes.byteLength <= maxOutputBytes) {
        // A source that is already smaller should not grow just because it was
        // uploaded through the editor.
        return outputBytes.byteLength < inputBytes.byteLength
          ? lastResult
          : retainedSourceResult(inputBytes);
      }
      if (inputBytes.byteLength <= maxOutputBytes) {
        return retainedSourceResult(inputBytes);
      }
    }
    throw new PreRollCompressionError(
      `视频压缩后仍超过 ${Math.round(maxOutputBytes / 1024 / 1024)} MB，请缩短视频。`,
      { code: 'PRE_ROLL_COMPRESSED_TOO_LARGE', statusCode: 413, cause: lastResult }
    );
  } finally {
    await rm(tempRoot, { recursive: true, force: true }).catch(() => {});
  }
}

export async function compressPreRollFile(sourcePath, destinationPath = sourcePath, options) {
  const inputBytes = await readFile(sourcePath);
  const result = await compressPreRollBuffer(inputBytes, options);
  const temporaryPath = `${destinationPath}.${process.pid}.tmp`;
  try {
    await writeFile(temporaryPath, result.bytes);
    await rename(temporaryPath, destinationPath);
  } catch (error) {
    await rm(temporaryPath, { force: true }).catch(() => {});
    throw error;
  }
  return result;
}
