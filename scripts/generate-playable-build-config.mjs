import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  createGeneratedBuildConfigSource,
  createPlayableBuildConfig,
  createPlayableBuildSignature
} from './playable-build-config.mjs';

const ROOT = process.cwd();
const TUNING_FILE = path.join(ROOT, 'src', 'scene-tuning.js');
const OUTPUT_FILE = path.join(ROOT, 'src', 'generated-playable-build-config.js');

async function main() {
  await readFile(TUNING_FILE, 'utf8');
  const tuningUrl = `${pathToFileURL(TUNING_FILE).href}?t=${Date.now()}`;
  const { SCENE_TUNING } = await import(tuningUrl);
  const config = createPlayableBuildConfig(SCENE_TUNING);
  const signature = createPlayableBuildSignature(config);
  await writeFile(OUTPUT_FILE, createGeneratedBuildConfigSource(config, signature), 'utf8');
  console.log(`Generated ${path.relative(ROOT, OUTPUT_FILE)} (${signature}).`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
