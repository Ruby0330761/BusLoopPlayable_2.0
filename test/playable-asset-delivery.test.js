import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { PNG } from 'pngjs';
import { createAssetDelivery, playableAssetDataUri, selectSpatialTexture } from '../scripts/playable-asset-delivery.mjs';
import { stripMp3ProductionTags } from '../scripts/playable-mp3-tags.mjs';

function taggedMp3(audio, id, body, { version = 3, flags = 0, frameFlags = 0 } = {}) {
  const frame = Buffer.alloc(10);
  frame.write(id);
  frame.writeUInt32BE(body.length, 4);
  frame.writeUInt16BE(frameFlags, 8);
  const header = Buffer.from([73, 68, 51, version, 0, flags, 0, 0, 0, frame.length + body.length]);
  return Buffer.concat([header, frame, body, audio]);
}

async function temporaryRoot(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'playable-asset-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

test('ID3 parser retains unknown tags, playback metadata and suspicious boundaries', async () => {
  const raw = await readFile('public/assets/unity/audio/vehicle_tap.mp3');
  const { bytes: audio, reason } = stripMp3ProductionTags(raw);
  assert.equal(reason, 'removed-id3v2-and-id3v1');
  assert.equal(audio.length, raw.length - 6749);
  const size = tag => tag.subarray(6, 10).reduce((value, byte) => value * 128 + byte, 0);
  assert.deepEqual(audio, raw.subarray(10 + size(raw), raw.length - 128));

  const tag = Buffer.from('Lavf61.7.100');
  const standard = Buffer.concat([Buffer.from([3]), tag, Buffer.alloc(1)]);
  for (const sample of [
    taggedMp3(audio, 'TXXX', Buffer.from('\0ReplayGain\0-3 dB')),
    taggedMp3(audio, 'PRIV', Buffer.from('iTunSMPB\0gapless')),
    taggedMp3(audio, 'TSSE', standard, { version: 2 }),
    taggedMp3(audio, 'TSSE', standard, { flags: 128 }),
    taggedMp3(audio, 'TSSE', standard, { frameFlags: 1 }),
    taggedMp3(audio.subarray(0, -1), 'TSSE', standard),
    Buffer.concat([taggedMp3(audio, 'TSSE', standard), Buffer.from('APETAGEX')])
  ]) {
    const result = stripMp3ProductionTags(sample);
    assert.equal(result.bytes, sample);
    assert.notEqual(result.reason, 'no-supported-production-tags');
  }
  const corrupt = taggedMp3(audio, 'TSSE', standard);
  corrupt[9] = 128;
  assert.equal(stripMp3ProductionTags(corrupt).reason, 'invalid-id3v2-length');

  const tail = Buffer.alloc(128);
  tail.write('TAG');
  assert.deepEqual(stripMp3ProductionTags(Buffer.concat([audio, tail])).bytes, audio);
  const interrupted = Buffer.concat([audio.subarray(0, -1), tail]);
  assert.equal(stripMp3ProductionTags(interrupted).bytes, interrupted);
});

test('all safely cleaned repository MP3s decode to the same PCM and stream parameters', async t => {
  if (['ffmpeg', 'ffprobe'].some(tool => spawnSync(tool, ['-version']).error)) {
    return t.skip('FFmpeg and FFprobe are required for PCM comparison');
  }
  const paths = async dir => (await Promise.all((await readdir(dir, { withFileTypes: true })).map(entry => {
    const filename = path.join(dir, entry.name);
    return entry.isDirectory() ? paths(filename) : (/\.mp3$/iu.test(filename) ? [filename] : []);
  }))).flat();
  let samples = 0;
  for (const filename of await paths('public/assets')) {
    const source = await readFile(filename);
    const result = stripMp3ProductionTags(source);
    if (result.bytes === source) continue;
    const decode = bytes => {
      const compare = (command, args) => {
        const process = spawnSync(command, args, { input: bytes, maxBuffer: 32 * 1024 * 1024 });
        assert.equal(process.status, 0, process.stderr?.toString());
        return process.stdout;
      };
      const stream = JSON.parse(compare('ffprobe', [
        '-v', 'error', '-select_streams', 'a:0', '-show_entries', 'stream=sample_rate,channels',
        '-of', 'json', '-f', 'mp3', '-i', 'pipe:0'
      ])).streams[0];
      const pcm = compare('ffmpeg', ['-v', 'error', '-f', 'mp3', '-i', 'pipe:0', '-map', '0:a:0', '-f', 'f32le', 'pipe:1']);
      return { ...stream, sampleCount: pcm.length / (4 * stream.channels), pcm };
    };
    assert.deepEqual(decode(result.bytes), decode(source), filename);
    samples += 1;
  }
  assert.ok(samples >= 10, `Only compared ${samples} MP3 files`);
});

test('preflight uses a content-keyed delivery cache for uploaded MP3s', async t => {
  const root = await temporaryRoot(t);
  const delivery = await createAssetDelivery(process.cwd(), { cacheDir: root });
  const source = await readFile('public/assets/unity/audio/vehicle_tap.mp3');
  const url = '/assets/editor-bgm/upload.mp3';
  const file = path.join(root, 'upload.mp3');
  await writeFile(file, source);
  assert.equal((await delivery.estimate(url, file, source.length)).bytes, source.length);
  const first = await delivery.select(url, source);
  assert.equal(first.cacheHit, false);
  assert.ok(first.optimized);
  assert.equal((await delivery.select('/assets/unity/audio/same.mp3', source)).cacheHit, true);
  const estimated = await delivery.estimate(url, file, source.length);
  assert.equal(estimated.sourceBytes, source.length);
  assert.equal(estimated.bytes, first.deliveryBytes);
  assert.equal(estimated.embeddedBytes, playableAssetDataUri(first).length);

  const modified = Buffer.concat([source]);
  modified[5] |= 128;
  await writeFile(file, modified);
  assert.equal((await delivery.estimate(url, file, modified.length)).cached, false);
  const fallback = await delivery.select(url, modified);
  assert.equal(fallback.reason, 'unsupported-id3v2-header');
  assert.equal(fallback.optimized, false);
});

test('FBX cleanup feeds cached estimates and reports removal for packed model URLs', async t => {
  const root = await temporaryRoot(t);
  const file = 'public/assets/unity/mechanisms/hidden-vehicle/models/questionmark.fbx.bin';
  const url = file.slice('public'.length);
  const source = await readFile(file);
  const delivery = await createAssetDelivery(process.cwd(), { cacheDir: root });
  const untouched = await delivery.select('/assets/model.bin', source);
  assert.equal(untouched.bytes, source);
  const result = await delivery.select(url, source);
  assert.equal(result.removedLayers, 712);
  assert.equal(result.optimized, true);
  assert.equal(result.mime, 'application/octet-stream');
  const estimate = await delivery.estimate(url, file, source.length);
  assert.equal(estimate.bytes, result.deliveryBytes);
  assert.equal(estimate.embeddedBytes, playableAssetDataUri(result).length);
  assert.equal(estimate.cached, true);
  assert.equal((await delivery.select(url, source)).removedLayers, 712);
  assert.deepEqual(await readFile(file), source);
});

test('WebP selection preserves transparent RGB, verifies size and separates numeric usage', async t => {
  const root = await temporaryRoot(t);
  const png = new PNG({ width: 73, height: 63 });
  for (let i = 0; i < png.data.length; i += 4) png.data.set([155, 88, 37, i % 12 ? 0 : 255], i);
  const bytes = PNG.sync.write(png);
  const delivery = await createAssetDelivery(process.cwd(), { cacheDir: root });
  if (!delivery.identity.codec.exact) {
    assert.equal((await delivery.select('/assets/test.png', bytes)).optimized, false);
    return t.skip('pinned Pillow/libwebp is required for WebP conversion');
  }
  const result = await delivery.select('/assets/test.png', bytes);
  assert.equal(result.mime, 'image/webp');
  assert.equal(result.reason, 'lossless-webp');
  assert.ok(result.optimized);
  const check = spawnSync(delivery.childEnv.PLAYABLE_ASSET_PYTHON, [
    '-c', 'from PIL import Image; import sys; sys.stdout.buffer.write(Image.open(sys.stdin.buffer).convert("RGBA").tobytes())'
  ], { input: result.bytes });
  assert.equal(check.status, 0, check.stderr?.toString());
  assert.deepEqual(check.stdout, png.data);

  const spatial = await selectSpatialTexture(delivery, 'spatial:test/loopTextureDataUrl',
    'data:image/png;base64,' + bytes.toString('base64'));
  assert.equal(spatial.cacheHit, true);
  assert.equal(spatial.deliverySha256, result.deliverySha256);
  const numeric = await delivery.select('/assets/unit_anim_map.png', bytes);
  assert.equal(numeric.reason, 'numeric-or-fixed-texture');
  assert.equal(numeric.bytes, bytes);
  const pixel = PNG.sync.write(new PNG({ width: 1, height: 1 }));
  assert.equal((await delivery.select('/assets/pixel.png', pixel)).reason, 'fixed-pixel');
  const existingWebp = await delivery.select('/assets/image.webp', result.bytes);
  assert.equal(existingWebp.bytes, result.bytes);

  const corrupt = Buffer.from(bytes);
  corrupt[28] ^= 1;
  assert.equal((await delivery.select('/assets/corrupt.png', corrupt)).reason, 'invalid-png-chunk');
  const fixture = snippet => {
    const result = spawnSync(delivery.childEnv.PLAYABLE_ASSET_PYTHON, [
      '-c', 'from PIL import Image, PngImagePlugin\nimport sys\n' + snippet
    ]);
    assert.equal(result.status, 0, result.stderr?.toString());
    return result.stdout;
  };
  for (const [source, reason] of [
    [fixture('Image.new("RGBA", (8, 8)).save(sys.stdout.buffer, "PNG", save_all=True, append_images=[Image.new("RGBA", (8, 8), "red")])'), 'animated-png'],
    [fixture('Image.new("I;16", (8, 8)).save(sys.stdout.buffer, "PNG")'), 'png-depth-outside-8-bit'],
    [fixture('info = PngImagePlugin.PngInfo()\ninfo.add(b"gAMA", (100000).to_bytes(4, "big"))\nImage.new("RGB", (8, 8)).save(sys.stdout.buffer, "PNG", pnginfo=info)'), 'unverified-png-color']
  ]) {
    const selected = await delivery.select('/assets/edge-case.png', source);
    assert.equal(selected.reason, reason);
    assert.equal(selected.bytes, source);
  }
});
