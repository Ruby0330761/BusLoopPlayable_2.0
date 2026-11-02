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
const sessionConfigUrl = `${pathToFileURL(path.join(root, 'src', 'playable-session-config.js')).href}?t=${Date.now()}`;
const colorAtlasesUrl = `${pathToFileURL(path.join(root, 'src', 'color-atlases.js')).href}?t=${Date.now()}`;
const levelAudioUrl = `${pathToFileURL(path.join(root, 'src', 'level-audio-config.js')).href}?t=${Date.now()}`;
const [
  { SCENE_TUNING },
  { LEVEL_CATALOG },
  { levelDocumentToRuntime },
  { deriveLevelMechanics },
  { resolvePlayableSession },
  { COLOR_ATLAS_PATHS, resolveColorAtlasPaths, isColorAtlasTableComplete },
  { resolveLevelAudioConfig, isLevelAudioConfigComplete }
] = await Promise.all([
  import(tuningUrl),
  import(catalogUrl),
  import(editorModelUrl),
  import(mechanismResourcesUrl),
  import(sessionConfigUrl),
  import(colorAtlasesUrl),
  import(levelAudioUrl)
]);
const EDITOR_BACKGROUND_PREFIX = '/assets/editor-backgrounds/';

const selectionPath = path.join(root, 'artifacts', 'selected-level.txt');
const selected = existsSync(selectionPath)
  ? (await readFile(selectionPath, 'utf8')).trim()
  : (SCENE_TUNING.level?.selected ?? 'level5');

const sessionPath = path.join(root, 'artifacts', 'playable-session.json');
const playableSession = existsSync(sessionPath)
  ? resolvePlayableSession(
      JSON.parse(await readFile(sessionPath, 'utf8')),
      process.env.PLAYABLE_SESSION_KEY ?? null
    )
  : null;

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
    return completeLevelAssets({
      ...runtimeLevel,
      sourceFile: path.relative(root, webLevelPath).replaceAll(path.sep, '/'),
      mechanics: deriveLevelMechanics(runtimeLevel)
    });
  }
  if (LEVEL_CATALOG[levelKey]) return completeLevelAssets(LEVEL_CATALOG[levelKey]);
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

// A level imported or authored before the colour supplement existed still uses
// the supplement indices (black 17, white 18, …) but its assets only carry the
// eleven original atlases. Leaving those slots empty makes the runtime fall back
// to index 0, which is why black and white cars shipped blue from a stale
// catalog. Complete the table from the canonical list before anything reads it.
function completeColorAtlases(level) {
  if (!level?.assets || isColorAtlasTableComplete(level.assets.colorTextures)) return level;
  return {
    ...level,
    assets: {
      ...level.assets,
      colorTextures: resolveColorAtlasPaths(level.assets.colorTextures)
    }
  };
}

// Level asset tables have two catalog-independent parts: the colour atlases and
// the sound list. Both are completed here so a data volume holding an old
// catalog cannot ship a level whose events reference sounds it does not carry.
function completeLevelAudio(level) {
  if (!level?.assets || isLevelAudioConfigComplete(level.assets.audio)) return level;
  return {
    ...level,
    assets: {
      ...level.assets,
      audio: resolveLevelAudioConfig(level.assets.audio)
    }
  };
}

function completeLevelAssets(level) {
  return completeLevelAudio(completeColorAtlases(level));
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

// Stage sources: an explicit playable session wins. Without one, keep the
// legacy single-level selection and the level9 -> level7 handoff rule.
let stageDefinitions;
if (playableSession) {
  stageDefinitions = playableSession.stages.map((stage) => ({ ...stage }));
} else {
  const sessionLevelKeys = selected === 'level9' ? ['level9', 'level7'] : [selected];
  stageDefinitions = sessionLevelKeys.map((key) => ({
    id: key,
    levelKey: key,
    scene: {},
    opening: {},
    labels: []
  }));
}

const stageLevels = [];
for (const stage of stageDefinitions) {
  const stageLevel = stage.levelKey === selected ? level : await resolveProductionLevel(stage.levelKey);
  if (!stageLevel) throw new Error(`Unknown session level value: ${stage.levelKey}`);
  if (stageLevel.key !== stage.levelKey) {
    throw new Error(`Session level ${stage.levelKey} resolved to ${stageLevel.key}.`);
  }
  stageLevels.push(withSelectedBackground(stageLevel));
}

// Choice options are full stages that only start if the player picks them. They
// are baked now because a packaged build cannot read the level service, and
// their assets have to be inlined even though they are not in the fixed order.
const choiceLevelsByStage = new Map();
for (const [index, stage] of stageDefinitions.entries()) {
  if (!stage.choice) continue;
  const optionLevels = [];
  for (const option of stage.choice.options) {
    const optionLevel = option.levelKey === selected ? level : await resolveProductionLevel(option.levelKey);
    if (!optionLevel) throw new Error(`Unknown choice level value: ${option.levelKey}`);
    if (optionLevel.key !== option.levelKey) {
      throw new Error(`Choice level ${option.levelKey} resolved to ${optionLevel.key}.`);
    }
    optionLevels.push(withSelectedBackground(optionLevel));
  }
  choiceLevelsByStage.set(index, optionLevels);
}

const declarations = [];
function declareLevel(levelKey, name, stageLevel) {
  const primaryAssets = stageLevels[0].assets;
  if (levelKey !== stageLevels[0].key && JSON.stringify(stageLevel.assets) === JSON.stringify(primaryAssets)) {
    const { assets: _sharedAssets, ...levelWithoutAssets } = stageLevel;
    declarations.push(
      `const ${name} = Object.freeze(Object.assign(${JSON.stringify(levelWithoutAssets, null, 2)}, { assets: STAGE_1_LEVEL.assets }));`
    );
    return name;
  }
  declarations.push(`const ${name} = Object.freeze(${JSON.stringify(stageLevel, null, 2)});`);
  return name;
}

// Stage 1 keeps its own full copy; every later level reuses its assets when
// they are byte-identical, which is the common case for one game skin.
const levelNames = stageLevels.map((stageLevel, index) => (
  index === 0
    ? declareLevel(stageLevel.key, 'STAGE_1_LEVEL', stageLevel)
    : declareLevel(stageLevel.key, `STAGE_${index + 1}_LEVEL`, stageLevel)
));

const stageNames = stageDefinitions.map((stage, index) => {
  const stageName = `STAGE_${index + 1}`;
  const descriptor = JSON.stringify({
    id: stage.id,
    scene: stage.scene ?? {},
    opening: stage.opening,
    labels: stage.labels
  }, null, 2);
  declarations.push(`const ${stageName} = Object.freeze(Object.assign(${descriptor}, { level: ${levelNames[index]} }));`);
  return stageName;
});

const choiceNames = stageDefinitions.map((stage, index) => {
  if (!stage.choice) return 'null';
  const optionLevels = choiceLevelsByStage.get(index) ?? [];
  const optionNames = stage.choice.options.map((option, optionIndex) => (
    declareLevel(option.levelKey, `STAGE_${index + 1}_CHOICE_${optionIndex + 1}_LEVEL`, optionLevels[optionIndex])
  ));
  const descriptor = {
    title: stage.choice.title,
    handIndex: stage.choice.handIndex,
    options: stage.choice.options.map((option, optionIndex) => ({
      id: option.id,
      levelKey: option.levelKey,
      label: option.label,
      image: option.image,
      scene: option.scene ?? {},
      opening: option.opening,
      labels: option.labels,
      // A sentinel is replaced with the declared binding after stringify, so
      // the level payload is never duplicated as an inline literal here.
      level: `__LEVEL_BINDING_${optionIndex}__`
    }))
  };
  const serialized = JSON.stringify(descriptor, null, 2).replace(
    /"__LEVEL_BINDING_(\d+)__"/gu,
    (_match, optionIndex) => optionNames[Number(optionIndex)]
  );
  const name = `STAGE_${index + 1}_CHOICE`;
  declarations.push(`const ${name} = Object.freeze(${serialized});`);
  return name;
});

// Every level a session can ever run, fixed order first. The packager inlines
// this list rather than PLAYABLE_LEVEL_SEQUENCE so choice maps are playable.
const allLevelNames = [...new Set([
  ...levelNames,
  ...[...choiceLevelsByStage.entries()].flatMap(([index, optionLevels]) => (
    optionLevels.map((_optionLevel, optionIndex) => `STAGE_${index + 1}_CHOICE_${optionIndex + 1}_LEVEL`)
  ))
])];

const sessionExport = playableSession
  ? `\nexport const ACTIVE_PLAYABLE_SESSION = Object.freeze({ key: ${JSON.stringify(playableSession.key)}, stageCount: ${stageNames.length}, preRollEnabled: ${playableSession.preRollEnabled === null ? 'null' : playableSession.preRollEnabled} });\n`
  : '\nexport const ACTIVE_PLAYABLE_SESSION = null;\n';

const source = `// Generated by scripts/generate-active-level.mjs. Do not edit by hand.\n${declarations.join('\n\n')}\n\nexport const PLAYABLE_STAGES = Object.freeze([${stageNames.join(', ')}]);\n\nexport const PLAYABLE_LEVEL_SEQUENCE = Object.freeze([${levelNames.join(', ')}]);\n\n// One entry per stage: null when the stage hands off to a fixed next stage,\n// otherwise the post-win map picker for that stage.\nexport const PLAYABLE_STAGE_CHOICES = Object.freeze([${choiceNames.join(', ')}]);\n\nexport const PLAYABLE_ALL_LEVELS = Object.freeze([${allLevelNames.join(', ')}]);\n\nexport const ACTIVE_LEVEL = PLAYABLE_LEVEL_SEQUENCE[0];\n${sessionExport}`;
await writeFile(path.join(root, 'src', 'generated-active-level.js'), source, 'utf8');
console.log(`Generated production session ${(playableSession?.key ?? selected)}: ${stageDefinitions.map((stage, index) => `${stage.levelKey} (${stageLevels[index].vehicles.length} vehicles, ${stageLevels[index].passengerQueues.map((queue) => queue.length).join('+')})`).join(' -> ')}.`);
for (const [index, optionLevels] of choiceLevelsByStage) {
  console.log(`  stage ${index + 1} choice: ${optionLevels.map((optionLevel) => `${optionLevel.key} (${optionLevel.vehicles.length} vehicles)`).join(', ')}`);
}
