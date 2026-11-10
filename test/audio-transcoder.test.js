import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import {
  AUDIO_COMPRESSION_PROFILES,
  AUDIO_COMPRESSION_VERSION,
  AUDIO_MAX_COMPRESSED_BYTES,
  buildAudioFfmpegArgs,
  compressAudioBuffer,
  resolveFfmpegBinary
} from '../scripts/audio-transcoder.mjs';

test('audio transcoder encodes MP3 with a bounded bitrate', () => {
  const args = buildAudioFfmpegArgs('/tmp/in.wav', '/tmp/out.mp3');
  assert.deepEqual(args.slice(0, 8), [
    '-hide_banner', '-loglevel', 'error', '-nostdin', '-y',
    '-i', '/tmp/in.wav', '-vn'
  ]);
  assert.ok(args.includes('libmp3lame'));
  assert.ok(args.includes('96k'));
  // Mono/stereo and sample rate come from the profile so the last rung can drop
  // to mono instead of failing the upload.
  assert.ok(args.includes('-ac') && args.includes('-ar'));
  // Source metadata must not survive into the ad payload.
  assert.ok(args.includes('-map_metadata'));
});

test('the quality ladder ends at a mono, low-bitrate rung', () => {
  assert.ok(AUDIO_COMPRESSION_PROFILES.length >= 3);
  const last = AUDIO_COMPRESSION_PROFILES.at(-1);
  assert.equal(last.channels, 1);
  assert.ok(parseInt(last.bitrate, 10) <= 48);
  // Strictly decreasing bitrate: a ladder that repeats a rung only costs time.
  const bitrates = AUDIO_COMPRESSION_PROFILES.map((profile) => parseInt(profile.bitrate, 10));
  for (let index = 1; index < bitrates.length; index += 1) {
    assert.ok(bitrates[index] < bitrates[index - 1], `rung ${index} must be smaller than its predecessor`);
  }
  assert.equal(new Set(AUDIO_COMPRESSION_PROFILES.map((profile) => profile.id)).size, AUDIO_COMPRESSION_PROFILES.length);
});

test('the compressed audio budget stays a fraction of the package cap', () => {
  // A single track must never be able to consume the whole 5 MB playable budget.
  assert.ok(AUDIO_MAX_COMPRESSED_BYTES <= 5 * 1024 * 1024 / 4);
  assert.equal(AUDIO_COMPRESSION_VERSION, 1);
});

test('an empty upload is rejected before ffmpeg is spawned', async () => {
  await assert.rejects(
    () => compressAudioBuffer(Buffer.alloc(0)),
    (error) => {
      assert.equal(error.code, 'EMPTY_AUDIO');
      assert.equal(error.statusCode, 400);
      return true;
    }
  );
});

test('a WAV upload becomes a much smaller MP3 inside the budget', async (t) => {
  try {
    await resolveFfmpegBinary();
  } catch (error) {
    if (error.code === 'FFMPEG_UNAVAILABLE') {
      t.skip('FFmpeg is not installed in this environment.');
      return;
    }
    throw error;
  }
  // The ambulance siren is a real shipping asset: 1 s, 22.05 kHz mono WAV.
  const wav = await readFile('public/assets/unity/mechanisms/ambulance/audio/ambulance_countdown_V2.wav');
  const result = await compressAudioBuffer(wav, { sourceExtension: '.wav' });
  assert.equal(result.extension, '.mp3');
  assert.equal(result.mime, 'audio/mpeg');
  assert.ok(result.bytes.length > 1_000);
  assert.ok(result.bytes.length <= AUDIO_MAX_COMPRESSED_BYTES);
  assert.ok(result.bytes.length < wav.length, `${result.bytes.length} < ${wav.length}`);
  assert.equal(result.compression.version, AUDIO_COMPRESSION_VERSION);
  assert.equal(result.compression.codec, 'mp3');
  // MP3 frames after an optional ID3 tag; assert the sync word is present.
  const head = result.bytes.subarray(0, Math.min(64, result.bytes.length));
  assert.ok(head.includes(Buffer.from([0xff, 0xfb])) || head.includes(Buffer.from([0xff, 0xf3]))
    || head.includes(Buffer.from([0xff, 0xfa])), 'encoded output must carry an MP3 frame header');
});

test('an already-small MP3 is passed through instead of growing', async (t) => {
  try {
    await resolveFfmpegBinary();
  } catch (error) {
    if (error.code === 'FFMPEG_UNAVAILABLE') {
      t.skip('FFmpeg is not installed in this environment.');
      return;
    }
    throw error;
  }
  // Re-encoding a 40 KB MP3 to a smaller bitrate can still produce a bigger file
  // (fixed frame overhead), so the transcoder has to keep the original.
  const source = await readFile('public/assets/unity/audio/vehicle_tap.mp3');
  const result = await compressAudioBuffer(source, { sourceExtension: '.mp3' });
  assert.ok(result.bytes.length <= Math.max(source.length, AUDIO_MAX_COMPRESSED_BYTES));
  if (!result.compressed) assert.equal(result.bytes.length, source.length);
});
