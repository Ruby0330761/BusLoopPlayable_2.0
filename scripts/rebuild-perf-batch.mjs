#!/usr/bin/env node
// Rebuilds a set of historical playable deliveries from their saved tuning
// snapshots so a before/after performance comparison is like-for-like.
//
// Why this exists: the production exporter copies `artifacts/playable-session.json`
// into its workspace, and `generate-active-level.mjs` prefers that session over
// `tuning.level.selected`. The checked-in session pins `level15` (the current
// BL42 delivery), so every rebuild of an older requirement silently produced a
// level15 board — the comparison would then measure the wrong level.
// Clearing `active` makes `resolvePlayableSession` return null, which is the
// documented legacy path: the build follows `tuning.level.selected` exactly as
// it did on the original delivery date.
//
// The real session file is restored on every exit path, including failures.
//
//   node scripts/rebuild-perf-batch.mjs <plan.json> <outputDir>
//
// plan.json:
//   [{ "name":"Q165", "tuning":"artifacts/q165-timed-tuning.json",
//      "variant": { "bgm": false, "material": "Q165V1" } }]

import { execFile } from 'node:child_process';
import { cp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);

const [planPath, outputRoot] = process.argv.slice(2);
if (!planPath || !outputRoot) {
  console.error('Usage: node scripts/rebuild-perf-batch.mjs <plan.json> <outputDir>');
  process.exit(2);
}

const projectRoot = process.cwd();
const sessionPath = path.join(projectRoot, 'artifacts', 'playable-session.json');
const sessionBackupPath = path.join(projectRoot, 'artifacts', '.playable-session.perf-backup.json');

const plan = JSON.parse(await readFile(path.resolve(planPath), 'utf8'));
if (!Array.isArray(plan) || !plan.length) {
  throw new Error('Plan must be a non-empty array.');
}

async function restoreSession() {
  if (!existsSync(sessionBackupPath)) return;
  await cp(sessionBackupPath, sessionPath);
  await rm(sessionBackupPath, { force: true });
  console.log('Restored artifacts/playable-session.json.');
}

// Restore on Ctrl-C / kill as well, or the repo is left pointing at no session.
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  process.on(signal, () => {
    restoreSession().finally(() => process.exit(130));
  });
}

async function findHtml(dir) {
  const found = [];
  const walk = async (current) => {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) await walk(full);
      else if (entry.name.endsWith('.html')) found.push(full);
    }
  };
  await walk(dir);
  return found;
}

const results = [];
try {
  if (!existsSync(sessionBackupPath)) await cp(sessionPath, sessionBackupPath);
  const session = JSON.parse(await readFile(sessionPath, 'utf8'));
  // Legacy path: no active session, so the build follows tuning.level.selected.
  await writeFile(sessionPath, `${JSON.stringify({ ...session, active: '' }, null, 2)}\n`, 'utf8');

  for (const entry of plan) {
    const name = String(entry.name ?? '').trim();
    const tuningPath = path.resolve(entry.tuning);
    if (!name) throw new Error('Every plan entry needs a name.');
    if (!existsSync(tuningPath)) throw new Error(`Missing tuning snapshot: ${entry.tuning}`);

    const staging = path.join(outputRoot, '.staging', name);
    await rm(staging, { recursive: true, force: true });
    await mkdir(staging, { recursive: true });

    const args = [
      'scripts/export-playable-package.mjs',
      '--platform', 'applovin',
      '--tuning-json', tuningPath,
      '--output-dir', staging,
      '--skip-checks'
    ];
    const variant = entry.variant ?? {};
    if (variant.bgm === true) args.push('--bgm');
    if (variant.bgm === false) args.push('--no-bgm');
    if (variant.material) args.push('--material', String(variant.material));

    console.log(`\n=== Building ${name} (${path.basename(tuningPath)}) ===`);
    const { stdout } = await run(process.execPath, args, {
      cwd: projectRoot,
      maxBuffer: 32 * 1024 * 1024,
      env: { ...process.env, PLAYABLE_SESSION_KEY: '' }
    });
    const built = JSON.parse(stdout.slice(stdout.indexOf('{')));

    const [htmlPath] = await findHtml(staging);
    if (!htmlPath) throw new Error(`${name}: export produced no HTML.`);
    const destination = path.join(outputRoot, 'A-optimized', `${name}.html`);
    await mkdir(path.dirname(destination), { recursive: true });
    await cp(htmlPath, destination);
    await rm(staging, { recursive: true, force: true });

    results.push({
      name,
      tuning: path.relative(projectRoot, tuningPath),
      fileName: built.fileName,
      bytes: built.bytes,
      output: destination
    });
    console.log(`  -> ${destination} (${built.bytes} bytes)`);
  }
} finally {
  await restoreSession();
}

await writeFile(
  path.join(outputRoot, 'build-manifest.json'),
  `${JSON.stringify({ builtAt: new Date().toISOString(), results }, null, 2)}\n`,
  'utf8'
);
console.log(`\nBuilt ${results.length} package(s).`);
