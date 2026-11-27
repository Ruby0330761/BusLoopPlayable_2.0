import { copyFile, mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { resetSavedSmokeTrail } from '../src/tuning-migrations.js';

const backupDirectory = 'web-level-backups/all-levels-smoke-20261123';
const serialize = document => JSON.stringify(document, null, 2) + '\n';
const revision = source => createHash('sha256').update(source).digest('hex');

// A draft based on the exact backup can follow the reset only while the server
// still holds the exact migration output. Real concurrent edits remain conflicts.
export async function matchesSmokeMigration(root, key, draftRevision, currentRevision) {
  if (!/^level[1-9]\d*$/.test(key) || !/^[0-9a-f]{64}$/.test(draftRevision)) return false;
  let source;
  try {
    source = await readFile(path.join(root, backupDirectory, key + '.json'), 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
  if (revision(source) !== draftRevision) return false;
  const document = JSON.parse(source);
  return resetSavedSmokeTrail(document.tuning) && revision(serialize(document)) === currentRevision;
}

// Run before the editor accepts writes. The completion marker lets later edits survive restarts.
export async function migrateAllLevelsSmoke(artifactsRoot) {
  const backup = path.join(artifactsRoot, backupDirectory);
  const marker = path.join(backup, 'complete.json');
  try {
    await readFile(marker);
    return;
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  const levels = path.join(artifactsRoot, 'web-levels');
  await mkdir(backup, { recursive: true });
  for (const entry of await readdir(levels, { withFileTypes: true })) {
    if (!entry.isFile() || !/^level[1-9]\d*\.json$/.test(entry.name)) continue;
    const target = path.join(levels, entry.name);
    const document = JSON.parse(await readFile(target, 'utf8'));
    if (!resetSavedSmokeTrail(document.tuning)) continue;
    // Keep the first original even if the process stopped after making the backup.
    try {
      await copyFile(target, path.join(backup, entry.name), constants.COPYFILE_EXCL);
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
    }
    const pending = path.join(levels, '.' + entry.name + '.smoke.tmp');
    await writeFile(pending, serialize(document));
    await rename(pending, target);
  }
  await writeFile(marker, JSON.stringify({ completedAt: new Date().toISOString() }) + '\n');
}
