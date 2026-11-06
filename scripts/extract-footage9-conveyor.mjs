import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, copyFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateFootageConveyor } from './extract-footage8-conveyor.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
export async function importFootageConveyor(footage, archive) {
  if (![9, 10].includes(footage)) throw new Error('Expected Footage9 or Footage10.');
  const source = path.join(root, `artifacts/footage${footage}-source`);
  await mkdir(source, { recursive: true });
  if (archive) {
    const entries = execFileSync('tar', ['-tf', archive], { encoding: 'utf8' }).trim().split(/\r?\n/);
    const assets = [];
    const names = new Set();
    for (const entry of entries.filter((name) => /^[a-f0-9]{32}\/pathname$/.test(name))) {
      const guid = entry.split('/')[0];
      const unityPath = execFileSync('tar', ['-xOf', archive, entry], { encoding: 'utf8' }).trim();
      const name = path.posix.basename(unityPath);
      if (!name || name === '.' || name === '..' || /[\\:]/.test(name) || names.has(name)) {
        throw new Error(`Duplicate or invalid asset name: ${name}`);
      }
      names.add(name);
      const data = execFileSync('tar', ['-xOf', archive, `${guid}/asset`], { maxBuffer: 64 * 1024 * 1024 });
      const meta = execFileSync('tar', ['-xOf', archive, `${guid}/asset.meta`]);
      if (!meta.toString().includes(`guid: ${guid}`)) throw new Error(`GUID mismatch: ${name}`);
      await writeFile(path.join(source, name), data);
      await writeFile(path.join(source, `${name}.meta`), meta);
      assets.push({ guid, unityPath, file: name, bytes: data.length, sha256: createHash('sha256').update(data).digest('hex') });
    }
    await writeFile(path.join(source, 'source-manifest.json'), JSON.stringify({
      archive: path.basename(archive), archiveSha256: createHash('sha256').update(await readFile(archive)).digest('hex'), assets
    }, null, 2) + '\n');
  }
  // Both supplied prefabs reference the verified Footage8 base Paths GUID.
  await mkdir(path.join(source, 'dependencies'), { recursive: true });
  for (const name of ['Paths.prefab', 'Paths.prefab.meta']) {
    await copyFile(path.join(root, 'artifacts/footage8-source/dependencies', name), path.join(source, 'dependencies', name));
  }
  const modelSpecs = await Promise.all([
    { file: `Loop_footage${footage}.FBX`, texture: 'Loop_footage.png', shadow: false },
    { file: 'Loop_footage_shadow.FBX', texture: `Loop_footage${footage}_shadow.png`, shadow: true }
  ].map(async (spec) => {
    const meta = await readFile(path.join(source, `${spec.file}.meta`), 'utf8');
    const guid = meta.match(/^guid: ([a-f0-9]{32})\r?$/m)?.[1];
    if (!guid) throw new Error(`Missing model GUID: ${spec.file}`);
    return { ...spec, guid };
  }));
  await generateFootageConveyor({ footage, modelSpecs });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await importFootageConveyor(9, process.argv[2]);
}
