import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = process.cwd();
const DEFAULT_INPUT = path.join(ROOT, 'artifacts', 'scene-tuning.json');
const TUNING_FILE = path.join(ROOT, 'src', 'scene-tuning.js');
const LEVEL_SELECTION_FILE = path.join(ROOT, 'artifacts', 'selected-level.txt');

function formatValue(value, indent = 0) {
  const pad = ' '.repeat(indent);
  const nextPad = ' '.repeat(indent + 2);
  if (Array.isArray(value)) {
    if (value.length === 0) return '[]';
    if (value.every((item) => item === null || typeof item !== 'object')) {
      return `[${value.map((item) => formatValue(item, 0)).join(', ')}]`;
    }
    return `[\n${value.map((item) => `${nextPad}${formatValue(item, indent + 2)}`).join(',\n')}\n${pad}]`;
  }
  if (value && typeof value === 'object') {
    const entries = Object.entries(value);
    if (entries.length === 0) return '{}';
    return `{\n${entries.map(([key, item]) => `${nextPad}${JSON.stringify(key)}: ${formatValue(item, indent + 2)}`).join(',\n')}\n${pad}}`;
  }
  return JSON.stringify(value);
}

function toModuleSource(tuning) {
  return `export const SCENE_TUNING = ${formatValue(tuning)};\n`;
}

function parseArgs() {
  const inputFlag = process.argv.findIndex((arg) => arg === '--input');
  return {
    input: inputFlag >= 0 ? path.resolve(process.argv[inputFlag + 1]) : DEFAULT_INPUT
  };
}

async function importCurrentTuning() {
  const moduleUrl = `${pathToFileURL(TUNING_FILE).href}?t=${Date.now()}`;
  const module = await import(moduleUrl);
  return module.SCENE_TUNING;
}

function deepMerge(target, source) {
  for (const [key, value] of Object.entries(source ?? {})) {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      target[key] ??= {};
      deepMerge(target[key], value);
    } else {
      target[key] = value;
    }
  }
  return target;
}

function migrateLegacyConveyorTuning(target, patch) {
  if (patch?.conveyorLayouts) return;
  const layout = target.conveyorLayouts?.dualQueue2;
  if (!layout) return;
  if (patch?.conveyorArt) deepMerge(layout.art, patch.conveyorArt);
  if (patch?.conveyorCurve) deepMerge(layout.curve, patch.conveyorCurve);
  if (patch?.queueCurves) layout.queueCurves = structuredClone(patch.queueCurves);
}

async function main() {
  const { input } = parseArgs();
  const current = structuredClone(await importCurrentTuning());
  const patch = JSON.parse(await readFile(input, 'utf8'));
  const next = deepMerge(current, patch);
  migrateLegacyConveyorTuning(next, patch);
  await writeFile(TUNING_FILE, toModuleSource(next), 'utf8');
  if (typeof next.level?.selected === 'string') {
    await writeFile(LEVEL_SELECTION_FILE, `${next.level.selected}\n`, 'utf8');
  }
  console.log(`Applied scene tuning from ${path.relative(ROOT, input)} to ${path.relative(ROOT, TUNING_FILE)}.`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
