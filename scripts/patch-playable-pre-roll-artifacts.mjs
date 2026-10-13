#!/usr/bin/env node

import { cp, mkdtemp, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const execFileAsync = promisify(execFile);
const ROOT = path.resolve(process.argv[2] ?? '/Users/von/Downloads/bus-loop-all-platforms (10)');
const OUTPUT = path.join(ROOT, '修正版');

function patchPreRoll(source, label, { requireMatch = true } = {}) {
  let output = source;
  let replacements = 0;
  output = output.replace(
    /([A-Za-z_$][\w$]*)=async ([A-Za-z_$][\w$]*)=>\{try\{await ([A-Za-z_$][\w$]*)\.play\(\)\}catch\{if\(\2!==([A-Za-z_$][\w$]*)\)return;([A-Za-z_$][\w$]*)\(\2\)\}\}/g,
    (_, receiver, argument) => {
      replacements += 1;
      return `${receiver}=${argument}=>Promise.resolve()`;
    }
  );
  output = output.replace(
    /([A-Za-z_$][\w$]*)\.load\?\.\(\),P\(/g,
    (_, receiver) => {
      replacements += 1;
      return `${receiver}.autoplay=!0,${receiver}.setAttribute?.("autoplay",""),${receiver}.load?.(),P(`;
    }
  );
  output = output.replace(
    /([A-Za-z_$][\w$]*)\.src=([^,}]+),\1\.load\?\.\(\),/g,
    (_, receiver, asset) => {
      replacements += 1;
      return `${receiver}.src=${asset},${receiver}.autoplay=!0,${receiver}.setAttribute?.("autoplay",""),${receiver}.load?.(),`;
    }
  );
  output = output.replace(
    /([A-Za-z_$][\w$]*)\.play\(\)\.catch\(\(\)=>\{\}\)/g,
    (_, receiver) => {
      replacements += 1;
      return `${receiver}.autoplay=!0,${receiver}.setAttribute?.("autoplay","")`;
    }
  );
  if (requireMatch && replacements < 3) {
    throw new Error(`${label}: pre-roll patch matched only ${replacements} sections.`);
  }
  return output;
}

async function patchTextFile(sourcePath, destinationPath) {
  const source = await readFile(sourcePath, 'utf8');
  const patched = patchPreRoll(source, sourcePath, { requireMatch: false });
  await writeFile(destinationPath, patched, 'utf8');
  return patched !== source;
}

async function patchZip(sourcePath, destinationPath) {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'bus-loop-pre-roll-patch-'));
  const unpacked = path.join(tempRoot, 'unpacked');
  const archive = path.join(tempRoot, 'patched.zip');
  try {
    await mkdir(unpacked, { recursive: true });
    await execFileAsync('unzip', ['-q', sourcePath, '-d', unpacked]);
    const files = await walk(unpacked);
    let matched = false;
    for (const file of files) {
      if (/\.(?:html?|js)$/i.test(file)) matched = (await patchTextFile(file, file)) || matched;
    }
    if (!matched) throw new Error(`${sourcePath}: no pre-roll runtime found.`);
    await execFileAsync('zip', ['-q', '-X', '-r', archive, '.'], { cwd: unpacked });
    await cp(archive, destinationPath);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
}

async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await walk(target));
    else if (entry.isFile()) files.push(target);
  }
  return files;
}

async function main() {
  const entries = (await readdir(ROOT, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && /\.(?:html?|zip)$/i.test(entry.name))
    .map((entry) => entry.name)
    .sort();
  await mkdir(OUTPUT, { recursive: true });
  for (const name of entries) {
    const sourcePath = path.join(ROOT, name);
    const destinationPath = path.join(OUTPUT, name);
    if (/\.zip$/i.test(name)) await patchZip(sourcePath, destinationPath);
    else if (!(await patchTextFile(sourcePath, destinationPath))) throw new Error(`${sourcePath}: no pre-roll runtime found.`);
  }
  console.log(`Patched ${entries.length} artifacts into ${OUTPUT}`);
}

if (path.resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
