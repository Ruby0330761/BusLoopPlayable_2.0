import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  PLAYABLE_MAX_ARTIFACT_BYTES,
  assertPlayableWithinSizeBudget,
  readZipUncompressedBytes
} from '../scripts/export-playable-package.mjs';

// Build a ZIP-shaped buffer by hand: only the central directory is read, so the
// file bodies can be placeholders. `entries` is [{ name, uncompressedBytes }].
function buildZip(entries) {
  const localParts = [];
  const directoryParts = [];
  let localOffset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name, 'utf8');
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt32LE(entry.uncompressedBytes, 22);
    localParts.push(local, name);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt32LE(entry.uncompressedBytes, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(localOffset, 42);
    directoryParts.push(central, name);

    localOffset += local.length + name.length;
  }
  const directory = Buffer.concat(directoryParts);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(directory.length, 12);
  eocd.writeUInt32LE(localOffset, 16);
  return Buffer.concat([...localParts, directory, eocd]);
}

async function withArtifact(bytes, run) {
  const root = await mkdtemp(path.join(tmpdir(), 'playable-size-gate-'));
  try {
    const filePath = path.join(root, 'artifact');
    await writeFile(filePath, bytes);
    return await run(filePath);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test('the platform budget is exactly 5 MiB', () => {
  assert.equal(PLAYABLE_MAX_ARTIFACT_BYTES, 5 * 1024 * 1024);
});

test('an artifact inside the budget passes the size gate', async () => {
  await withArtifact(Buffer.alloc(1024), async (filePath) => {
    const size = await assertPlayableWithinSizeBudget({
      platform: 'applovin',
      artifactPath: filePath,
      payloadAssets: [],
      label: 'AppLovin '
    });
    assert.equal(size, 1024);
  });
});

test('an oversized single HTML is refused and names the heaviest assets', async () => {
  // The operator needs to know which upload to fix, not just that the package is
  // too big: this is the message they read before retrying.
  await withArtifact(Buffer.alloc(PLAYABLE_MAX_ARTIFACT_BYTES + 1), async (filePath) => {
    await assert.rejects(
      () => assertPlayableWithinSizeBudget({
        platform: 'applovin',
        artifactPath: filePath,
        payloadAssets: [
          { url: '/assets/applovin/progress/bus.png', bytes: 999_000 },
          { url: '/assets/unity/audio/bus_hit_V5.mp3', bytes: 41_000 }
        ],
        label: 'AppLovin '
      }),
      (error) => {
        assert.equal(error.code, 'PLAYABLE_ARTIFACT_TOO_LARGE');
        assert.equal(error.statusCode, 413);
        assert.equal(error.artifactBytes, PLAYABLE_MAX_ARTIFACT_BYTES + 1);
        assert.match(error.message, /超过平台 5 MB 上限/);
        assert.match(error.message, /bus\.png 0\.95 MB/);
        assert.match(error.message, /bus_hit_V5\.mp3 0\.04 MB/);
        // Biggest first, so the reason is the first thing read.
        assert.ok(error.message.indexOf('bus.png') < error.message.indexOf('bus_hit_V5.mp3'));
        return true;
      }
    );
  });
});

test('a ZIP is measured by its extracted payload, not its archive size', async () => {
  // A 1 KB archive that unpacks to 6 MB is a Meta/Google Ads blocker even though
  // the ZIP itself looks small.
  const zip = buildZip([
    { name: 'index.html', uncompressedBytes: 1_000 },
    { name: 'index.js', uncompressedBytes: PLAYABLE_MAX_ARTIFACT_BYTES }
  ]);
  assert.equal(readZipUncompressedBytes(zip), 1_000 + PLAYABLE_MAX_ARTIFACT_BYTES);
  assert.ok(zip.length < PLAYABLE_MAX_ARTIFACT_BYTES);
  await withArtifact(zip, async (filePath) => {
    await assert.rejects(
      () => assertPlayableWithinSizeBudget({
        platform: 'meta',
        artifactPath: filePath,
        payloadAssets: [],
        label: 'Meta '
      }),
      (error) => {
        assert.equal(error.code, 'PLAYABLE_ARTIFACT_TOO_LARGE');
        assert.match(error.message, /解包后 5\.00 MB/);
        return true;
      }
    );
  });
});

test('a readable ZIP that fits is accepted', async () => {
  const zip = buildZip([{ name: 'index.html', uncompressedBytes: 2_000_000 }]);
  await withArtifact(zip, async (filePath) => {
    const bytes = await assertPlayableWithinSizeBudget({
      platform: 'tiktok',
      artifactPath: filePath,
      payloadAssets: [],
      label: 'TikTok '
    });
    assert.equal(bytes, 2_000_000);
  });
});

test('a corrupt ZIP fails loudly instead of passing the gate', async () => {
  await withArtifact(Buffer.from('not a zip at all'), async (filePath) => {
    await assert.rejects(
      () => assertPlayableWithinSizeBudget({
        platform: 'google-ads',
        artifactPath: filePath,
        payloadAssets: [],
        label: 'Google Ads '
      }),
      /不是可读取的 ZIP/
    );
  });
});
