import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const root = process.cwd();
const tuningUrl = `${pathToFileURL(path.join(root, 'src', 'scene-tuning.js')).href}?t=${Date.now()}`;
const catalogPath = process.env.PLAYABLE_LEVEL_CATALOG_PATH
  ? path.resolve(process.env.PLAYABLE_LEVEL_CATALOG_PATH)
  : path.join(root, 'src', 'level-catalog.js');
const catalogUrl = `${pathToFileURL(catalogPath).href}?t=${Date.now()}`;
const editorModelUrl = `${pathToFileURL(path.join(root, 'src', 'level-editor-model.js')).href}?t=${Date.now()}`;
const mechanismResourcesUrl = `${pathToFileURL(path.join(root, 'src', 'mechanism-resources.js')).href}?t=${Date.now()}`;
const [{ SCENE_TUNING }, { LEVEL_CATALOG }, { levelDocumentToRuntime }, { deriveLevelMechanics }] = await Promise.all([
  import(tuningUrl),
  import(catalogUrl),
  import(editorModelUrl),
  import(mechanismResourcesUrl)
]);
const EDITOR_BACKGROUND_PREFIX = '/assets/editor-backgrounds/';

const selectionPath = path.join(root, 'artifacts', 'selected-level.txt');
const selected = existsSync(selectionPath)
  ? (await readFile(selectionPath, 'utf8')).trim()
  : (SCENE_TUNING.level?.selected ?? 'level5');

async function resolveProductionLevel(levelKey) {
  if (!/^level[1-9]\d*$/u.test(levelKey)) {
    throw new Error(`Unknown SCENE_TUNING.level.selected value: ${levelKey}`);
  }
  const webLevelPath = path.join(root, 'artifacts', 'web-levels', `${levelKey}.json`);
  // The editor resolves a saved web-level before the generated Unity catalog.
  // Keep production builds on the same source, including when an authored file
  // intentionally overrides a catalog level with the same numeric key.
  if (existsSync(webLevelPath)) {
    const document = JSON.parse(await readFile(webLevelPath, 'utf8'));
    if (document?.format !== 'bus-loop-web-level-v1' || document?.key !== levelKey) {
      throw new Error(`Invalid saved web level document: ${levelKey}`);
    }
    const runtimeLevel = levelDocumentToRuntime(document, LEVEL_CATALOG.level5);
    return {
      ...runtimeLevel,
      sourceFile: path.relative(root, webLevelPath).replaceAll(path.sep, '/'),
      mechanics: deriveLevelMechanics(runtimeLevel)
    };
  }
  if (LEVEL_CATALOG[levelKey]) return LEVEL_CATALOG[levelKey];
  throw new Error(`Unknown SCENE_TUNING.level.selected value: ${levelKey}`);
}

const level = await resolveProductionLevel(selected);

const selectedBackground = SCENE_TUNING.background?.asset;
if (typeof selectedBackground !== 'string' || !selectedBackground.startsWith('/assets/')) {
  throw new Error(`Invalid SCENE_TUNING.background.asset value: ${selectedBackground}`);
}

function isSafeEditorBackgroundAsset(asset) {
  return asset.startsWith(EDITOR_BACKGROUND_PREFIX)
    && path.basename(asset) === asset.slice(EDITOR_BACKGROUND_PREFIX.length)
    && /^[A-Za-z0-9][A-Za-z0-9._-]{0,119}\.(?:jpe?g|png|webp)$/iu.test(path.basename(asset));
}

async function ensureSelectedBackgroundAvailable(asset) {
  const publicRoot = path.resolve(root, 'public');
  const publicPath = path.resolve(publicRoot, asset.replace(/^\/+/, ''));
  if (!publicPath.startsWith(`${publicRoot}${path.sep}`)) {
    throw new Error(`Invalid SCENE_TUNING.background.asset value: ${asset}`);
  }
  if (existsSync(publicPath)) return;
  if (!isSafeEditorBackgroundAsset(asset)) {
    throw new Error(`Selected background asset does not exist: ${asset}`);
  }
  const filename = path.basename(asset);
  const artifactPath = path.resolve(root, 'artifacts', 'editor-backgrounds', filename);
  if (!existsSync(artifactPath)) {
    throw new Error(`Selected background asset does not exist: ${asset}`);
  }
  await mkdir(path.dirname(publicPath), { recursive: true });
  await copyFile(artifactPath, publicPath);
}

await ensureSelectedBackgroundAvailable(selectedBackground);
if (!existsSync(path.resolve(root, 'public', selectedBackground.replace(/^\/+/, '')))) {
  throw new Error(`Selected background asset does not exist: ${selectedBackground}`);
}

function withSelectedBackground(sessionLevel) {
  return {
    ...sessionLevel,
    assets: {
      ...sessionLevel.assets,
      background: selectedBackground
    }
  };
}

const sessionLevelKeys = selected === 'level9' ? ['level9', 'level7'] : [selected];
const sessionLevels = sessionLevelKeys.map((key) => {
  const sessionLevel = key === selected ? level : LEVEL_CATALOG[key];
  if (!sessionLevel) throw new Error(`Unknown session level value: ${key}`);
  return withSelectedBackground(sessionLevel);
});
const [primaryLevel, ...followupLevels] = sessionLevels;
const primaryName = 'PRIMARY_LEVEL';
const declarations = [
  `const ${primaryName} = Object.freeze(${JSON.stringify(primaryLevel, null, 2)});`
];
const levelNames = [primaryName];

followupLevels.forEach((followupLevel, index) => {
  const levelName = `FOLLOWUP_LEVEL_${index + 1}`;
  levelNames.push(levelName);

  if (JSON.stringify(followupLevel.assets) === JSON.stringify(primaryLevel.assets)) {
    const { assets: _sharedAssets, ...levelWithoutAssets } = followupLevel;
    declarations.push(
      `const ${levelName} = Object.freeze(Object.assign(${JSON.stringify(levelWithoutAssets, null, 2)}, { assets: ${primaryName}.assets }));`
    );
    return;
  }

  declarations.push(`const ${levelName} = Object.freeze(${JSON.stringify(followupLevel, null, 2)});`);
});

const source = `// Generated by scripts/generate-active-level.mjs. Do not edit by hand.\n${declarations.join('\n\n')}\n\nexport const PLAYABLE_LEVEL_SEQUENCE = Object.freeze([${levelNames.join(', ')}]);\n\nexport const ACTIVE_LEVEL = PLAYABLE_LEVEL_SEQUENCE[0];\n`;
await writeFile(path.join(root, 'src', 'generated-active-level.js'), source, 'utf8');
console.log(`Generated production session ${sessionLevelKeys.join(' -> ')}: ${sessionLevels.map((sessionLevel) => `${sessionLevel.vehicles.length} vehicles (${sessionLevel.passengerQueues.map((queue) => queue.length).join('+')})`).join(', ')}.`);
