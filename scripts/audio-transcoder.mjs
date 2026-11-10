// FFmpeg-backed audio compressor for editor uploads.
//
// A playable is a single HTML file with every sound inlined as base64, so an
// uncompressed WAV upload is the most expensive thing an operator can add: a
// three-second stereo 44.1 kHz effect is ~500 KB on disk and ~670 KB after
// base64. The editor therefore re-encodes every uploaded track to MP3 before it
// is stored, exactly like the pre-roll upload path transcodes video.
//
// Profiles go from good to acceptable instead of failing on the first try: a
// long music loop needs a lower bitrate to stay inside the package budget than
// a two-second effect does.

import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { resolveFfmpegBinary } from './pre-roll-transcoder.mjs';

export { resolveFfmpegBinary };

export const AUDIO_COMPRESSION_VERSION = 1;
export const AUDIO_MAX_COMPRESSED_BYTES = 1 * 1024 * 1024;

// Ordered from highest quality to smallest. `channels: 1` is deliberate on the
// last rung: a mono effect that still plays is better than a rejected upload.
export const AUDIO_COMPRESSION_PROFILES = Object.freeze([
  Object.freeze({ id: 'standard', bitrate: '96k', channels: 2, sampleRate: 44100 }),
  Object.freeze({ id: 'compact', bitrate: '64k', channels: 2, sampleRate: 44100 }),
  Object.freeze({ id: 'minimal', bitrate: '48k', channels: 1, sampleRate: 32000 }),
  Object.freeze({ id: 'economy', bitrate: '32k', channels: 1, sampleRate: 32000 })
]);

// Containers that are already compressed keep their bytes when the transcode
// would only make them bigger. WAV and OGG always go through FFmpeg: a raw
// WAV in a single-file ad is exactly the payload this module exists to remove.
const ALREADY_COMPRESSED_EXTENSIONS = new Set(['.mp3', '.m4a']);

const TRANSCODE_TIMEOUT_MS = 60 * 1000;
const MAX_FFMPEG_ERROR_BYTES = 12 * 1024;

export class AudioCompressionError extends Error {
  constructor(message, { code = 'AUDIO_COMPRESSION_FAILED', statusCode = 422, cause } = {}) {
    super(message, cause ? { cause } : undefined);
    this.name = 'AudioCompressionError';
    this.code = code;
    this.statusCode = statusCode;
  }
}

export function buildAudioFfmpegArgs(inputPath, outputPath, profile = AUDIO_COMPRESSION_PROFILES[0]) {
  if (!profile?.id || !profile.bitrate) {
    throw new TypeError('A valid audio compression profile is required.');
  }
  return [
    '-hide_banner',
    '-loglevel', 'error',
    '-nostdin',
    '-y',
    '-i', inputPath,
    '-vn',
    '-map', '0:a:0',
    '-c:a', 'libmp3lame',
    '-b:a', profile.bitrate,
    '-ac', String(profile.channels),
    '-ar', String(profile.sampleRate),
    '-map_metadata', '-1',
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
      reject(new AudioCompressionError(
        '音频压缩超时，请缩短音频后重试。',
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
      reject(new AudioCompressionError(
        '音频压缩服务启动失败，请检查 FFmpeg 安装。',
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
      reject(new AudioCompressionError(
        detail ? `音频压缩失败：${detail}` : `音频压缩失败（退出码 ${code ?? signal ?? 'unknown'}）。`,
        { code: 'FFMPEG_FAILED', statusCode: 422 }
      ));
    });
  });
}

function compressedResult(inputBytes, profile, outputBytes) {
  return {
    bytes: outputBytes,
    extension: '.mp3',
    sourceBytes: inputBytes.byteLength,
    outputBytes: outputBytes.byteLength,
    compressed: true,
    mime: 'audio/mpeg',
    compression: {
      version: AUDIO_COMPRESSION_VERSION,
      profile: profile.id,
      codec: 'mp3',
      bitrate: profile.bitrate,
      channels: profile.channels,
      sampleRate: profile.sampleRate
    }
  };
}

function retainedSourceResult(inputBytes, extension, reason) {
  return {
    bytes: inputBytes,
    extension,
    sourceBytes: inputBytes.byteLength,
    outputBytes: inputBytes.byteLength,
    compressed: false,
    mime: extension === '.m4a' ? 'audio/mp4' : 'audio/mpeg',
    compression: {
      version: AUDIO_COMPRESSION_VERSION,
      profile: 'retained-source',
      codec: 'source',
      reason
    }
  };
}

/**
 * Re-encode `inputBytes` to MP3, stepping down the quality ladder until the
 * result fits `maxOutputBytes`.
 *
 * An already-compressed upload that the transcode would only grow is kept
 * as-is when it is inside the budget: re-encoding a 40 KB MP3 to a 60 KB MP3
 * makes the package worse, not better.
 */
export async function compressAudioBuffer(
  inputBytes,
  { maxOutputBytes = AUDIO_MAX_COMPRESSED_BYTES, sourceExtension = '.wav' } = {}
) {
  if (!Buffer.isBuffer(inputBytes) || inputBytes.byteLength === 0) {
    throw new AudioCompressionError('音频文件为空。', { code: 'EMPTY_AUDIO', statusCode: 400 });
  }
  const binary = await resolveFfmpegBinary();
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'bus-loop-audio-'));
  const inputPath = path.join(tempRoot, 'input');
  const outputPath = path.join(tempRoot, 'output.mp3');
  const extension = String(sourceExtension || '').toLowerCase();
  try {
    await writeFile(inputPath, inputBytes);
    let lastResult = null;
    for (const profile of AUDIO_COMPRESSION_PROFILES) {
      await runFfmpeg(binary, buildAudioFfmpegArgs(inputPath, outputPath, profile));
      const outputBytes = await readFile(outputPath);
      if (outputBytes.byteLength === 0) {
        throw new AudioCompressionError('音频压缩没有生成有效文件。', { code: 'FFMPEG_EMPTY_OUTPUT' });
      }
      lastResult = compressedResult(inputBytes, profile, outputBytes);
      if (outputBytes.byteLength <= maxOutputBytes) {
        const keepSource = ALREADY_COMPRESSED_EXTENSIONS.has(extension)
          && inputBytes.byteLength <= maxOutputBytes
          && inputBytes.byteLength < outputBytes.byteLength;
        return keepSource
          ? retainedSourceResult(inputBytes, extension, 'source-smaller')
          : lastResult;
      }
      if (ALREADY_COMPRESSED_EXTENSIONS.has(extension) && inputBytes.byteLength <= maxOutputBytes) {
        return retainedSourceResult(inputBytes, extension, 'source-within-budget');
      }
    }
    throw new AudioCompressionError(
      `音频压缩后仍超过 ${Math.round(maxOutputBytes / 1024 / 1024 * 10) / 10} MB，请缩短音频。`,
      { code: 'AUDIO_COMPRESSED_TOO_LARGE', statusCode: 413, cause: lastResult }
    );
  } finally {
    await rm(tempRoot, { recursive: true, force: true }).catch(() => {});
  }
}
