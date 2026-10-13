import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  PRE_ROLL_COMPRESSION_VERSION,
  PRE_ROLL_MAX_COMPRESSED_BYTES,
  buildPreRollFfmpegArgs,
  compressPreRollBuffer,
  resolveFfmpegBinary
} from '../scripts/pre-roll-transcoder.mjs';

test('pre-roll transcoder uses browser-compatible H.264/AAC settings', () => {
  const args = buildPreRollFfmpegArgs('/tmp/input.mp4', '/tmp/output.mp4');
  assert.deepEqual(args.slice(0, 11), [
    '-hide_banner', '-loglevel', 'error', '-nostdin', '-y',
    '-i', '/tmp/input.mp4', '-map', '0:v:0', '-map', '0:a?'
  ]);
  assert.ok(args.includes('libx264'));
  assert.ok(args.includes('aac'));
  assert.ok(args.includes('+faststart'));
  assert.ok(args.includes('yuv420p'));
  assert.ok(args.includes('avc1'));
});

test('pre-roll transcoder reduces the bundled video without exceeding the export budget', async (t) => {
  try {
    await resolveFfmpegBinary();
  } catch (error) {
    if (error.code === 'FFMPEG_UNAVAILABLE') {
      t.skip('FFmpeg is not installed in this environment.');
      return;
    }
    throw error;
  }
  const source = await readFile('public/assets/preroll/TP1333.mp4');
  const result = await compressPreRollBuffer(source);
  assert.ok(result.bytes.length > 12);
  assert.ok(result.bytes.length <= PRE_ROLL_MAX_COMPRESSED_BYTES);
  assert.ok(result.bytes.length < source.length);
  assert.equal(result.compression.version, PRE_ROLL_COMPRESSION_VERSION);
  assert.equal(result.compression.codec, 'h264');
  assert.equal(result.compression.audioCodec, 'aac');
  assert.equal(result.bytes.toString('ascii', 4, 8), 'ftyp');
});
