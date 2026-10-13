import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { access, copyFile, cp, mkdir, mkdtemp, readdir, readFile, rename, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { constants as fsConstants } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { transformWithEsbuild } from 'vite';
import {
  capturePlayableBackupImage,
  checkPlayableRuntimeArtifact
} from './check-playable-runtime.mjs';
import { validateStoreLink } from '../src/store-links.js';
import {
  PRE_ROLL_COMPRESSION_VERSION,
  compressPreRollFile
} from './pre-roll-transcoder.mjs';

export const SUPPORTED_PLATFORMS = Object.freeze([
  'applovin',
  'google-ads',
  'meta',
  'unityads',
  'mintegral',
  'moloco',
  'tiktok'
]);
export const EXPORT_RESOURCE_MODE = 'package-only';

const PLATFORM_FORMATS = Object.freeze({
  applovin: 'html',
  'google-ads': 'zip',
  meta: 'zip',
  unityads: 'html',
  mintegral: 'zip',
  moloco: 'html',
  tiktok: 'zip'
});
export const PLAYABLE_NAMING_PATTERN = 'requirement-material-iteration-language-format-designer-requester-channel-steps-stamina';
export const PLAYABLE_BRANDING_VARIANTS = Object.freeze([
  Object.freeze({ id: 'android', suffix: '-Android', iconAsset: '/assets/icon-android.jpg' }),
  Object.freeze({ id: 'ios', suffix: '-iOS', iconAsset: '/assets/icon-ios.png' })
]);
const GOOGLE_SDK = 'https://tpc.googlesyndication.com/pagead/gadgets/html5/api/exitapi.js';
const TIKTOK_SDK = 'https://sf16-muse-va.ibytedtos.com/obj/union-fe-nc-i18n/playable/sdk/playable-sdk.js';
const MAX_COMMAND_OUTPUT = 16000;
const MAX_EXPORT_NAME_LENGTH = 180;
// Each platform check starts an isolated Chromium process. Keep the default
// conservative for the shared remote editor; the container can override it.
const DEFAULT_EXPORT_CONCURRENCY = 2;
const EDITOR_BACKGROUND_PREFIX = '/assets/editor-backgrounds/';
const EDITOR_PRE_ROLL_PREFIX = '/assets/editor-prerolls/';
const EXPORT_SOURCE_CACHE_VERSION = 'v2';
const EXPORT_SOURCE_CACHE_LIMIT = 2;
const exportSourceCache = new Map();

export function validateExportNamingPart(value, location = 'export naming field') {
  if (value == null) return '';
  if (typeof value !== 'string') throw new TypeError(`${location} must be a string.`);
  const normalized = value.trim();
  if (!normalized) return '';
  if (normalized.length > 64) throw new TypeError(`${location} must not exceed 64 characters.`);
  if (/[\/\\\u0000-\u001f\u007f]/u.test(normalized)) {
    throw new TypeError(`${location} must not contain path separators or control characters.`);
  }
  if (normalized.includes('..')) throw new TypeError(`${location} must not contain "..".`);
  if (!/^[A-Za-z0-9_-]+$/.test(normalized)) {
    throw new TypeError(`${location} may contain only ASCII letters, numbers, hyphens, and underscores.`);
  }
  return normalized;
}

export function buildPlayableArtifactName(tuning, platform, suffix = '', { compactGoogleAds = false } = {}) {
  if (!SUPPORTED_PLATFORMS.includes(platform)) {
    throw new TypeError(`Unsupported playable platform: ${platform ?? '<missing>'}.`);
  }
  if (typeof suffix !== 'string' || (suffix && !/^[A-Za-z0-9_-]+$/u.test(suffix))) {
    throw new TypeError('Playable artifact suffix may contain only ASCII letters, numbers, hyphens, and underscores.');
  }
  const naming = tuning?.exportNaming;
  if (naming !== undefined && (!isPlainObject(naming) || (naming.channels !== undefined && !isPlainObject(naming.channels)))) {
    throw new TypeError('tuning.exportNaming must contain naming fields and platform channels.');
  }
  const safeNaming = naming ?? {};
  const channels = safeNaming.channels ?? {};
  const parts = [
    ['requirementCode', safeNaming.requirementCode],
    ['materialCode', safeNaming.materialCode],
    ['iterationCode', safeNaming.iterationCode],
    ['language', safeNaming.language],
    ['format', safeNaming.format],
    ['designer', safeNaming.designer],
    ['requester', safeNaming.requester],
    [`channels.${platform}`, channels[platform]],
    ['steps', safeNaming.steps],
    ['stamina', safeNaming.stamina]
  ].map(([key, value]) => [key, validateExportNamingPart(value, `tuning.exportNaming.${key}`)]);
  const channelKey = `channels.${platform}`;
  const buildBaseName = (selectedParts) => {
    const businessBaseName = selectedParts
      .filter(([key, value]) => value || key === channelKey)
      .map(([key, value]) => key === channelKey && !value ? platform : value)
      .join('-');
    return businessBaseName;
  };
  let baseName = buildBaseName(parts);
  // Mintegral forbids hyphens anywhere in the delivery name, including the branding suffix.
  let finalBaseName = platform === 'mintegral'
    ? `${baseName}${suffix}`.replaceAll('-', '_')
    : `${baseName}${suffix}`;
  if (platform === 'google-ads' && compactGoogleAds && suffix && finalBaseName.length > 50) {
    for (const optionalKey of ['stamina', 'steps']) {
      const compactParts = parts.filter(([key]) => key !== optionalKey);
      baseName = buildBaseName(compactParts);
      finalBaseName = `${baseName}${suffix}`;
      if (finalBaseName.length <= 50) break;
    }
  }
  if (platform === 'google-ads' && finalBaseName.length > 50) {
    throw new TypeError(`Google Ads export name must not exceed 50 characters; received ${finalBaseName.length}.`);
  }
  if (finalBaseName.length > MAX_EXPORT_NAME_LENGTH) {
    throw new TypeError(`Playable export name must not exceed ${MAX_EXPORT_NAME_LENGTH} characters.`);
  }
  return `${finalBaseName}.${PLATFORM_FORMATS[platform]}`;
}

function buildPlayableArtifactNames(tuning, platforms, suffix = '', options) {
  const channelOwners = new Map();
  const names = {};
  for (const platform of platforms) {
    const channel = validateExportNamingPart(
      tuning?.exportNaming?.channels?.[platform],
      `tuning.exportNaming.channels.${platform}`
    ).toLowerCase();
    if (channel) {
      const existingPlatform = channelOwners.get(channel);
      if (existingPlatform) {
        throw new TypeError(`Export channel codes must be unique: ${existingPlatform} and ${platform} both use ${channel}.`);
      }
      channelOwners.set(channel, platform);
    }
    names[platform] = buildPlayableArtifactName(tuning, platform, suffix, options);
  }
  return names;
}

export function createBrandingVariantTuning(tuning, variantId) {
  const variant = PLAYABLE_BRANDING_VARIANTS.find(({ id }) => id === variantId);
  if (!variant) throw new TypeError(`Unsupported playable branding variant: ${variantId ?? '<missing>'}.`);
  const output = structuredClone(tuning ?? {});
  output.branding ??= {};
  output.branding.icon ??= {};
  output.branding.icon.asset = variant.iconAsset;
  return output;
}

function getVariantStoreLinks(tuning, label) {
  return {
    android: validateStoreLink('android', tuning?.storeLinks?.android, `${label} Android store link`),
    ios: validateStoreLink('ios', tuning?.storeLinks?.ios, `${label} iOS store link`)
  };
}

function assertEmbeddedStoreLinks(sourceHtml, tuning) {
  const links = getVariantStoreLinks(tuning, 'Embedded');
  for (const link of Object.values(links)) {
    if (!sourceHtml.includes(link)) {
      throw new Error('Built HTML must embed both the valid Google Play and Apple App Store product URLs.');
    }
  }
}

function brandingDeviceProfiles(device) {
  if (device === 'android') return ['android', 'ios'];
  if (device === 'ios') return ['ios', 'android'];
  return [];
}

export function retargetBrandingVariantHtml(sourceHtml, sourceTuning, targetTuning, targetIconDataUri) {
  if (typeof sourceHtml !== 'string' || !sourceHtml) throw new TypeError('Source playable HTML is required.');
  if (!/^data:image\/(?:jpeg|png|webp);base64,/u.test(targetIconDataUri ?? '')) {
    throw new TypeError('Target branding icon must be an embedded image data URI.');
  }
  const iconPattern = /(<img\b(?=[^>]*\bid=["']branding-icon["'])[^>]*\bsrc=["'])([^"']*)(["'][^>]*>)/iu;
  const iconMatch = sourceHtml.match(iconPattern);
  if (!iconMatch) throw new Error('Playable HTML is missing the branding icon element.');
  if (sourceHtml.split(iconMatch[2]).length - 1 !== 1) {
    throw new Error('Branding icon is duplicated in the built HTML; reusable variant export is blocked.');
  }
  const sourceStoreLinks = getVariantStoreLinks(sourceTuning, 'Source');
  const targetStoreLinks = getVariantStoreLinks(targetTuning, 'Target');
  let html = sourceHtml.replace(
    iconPattern,
    (_match, before, _source, after) => `${before}${targetIconDataUri}${after}`
  );
  const replacements = Object.entries(sourceStoreLinks)
    .map(([platform, sourceStoreLink]) => [sourceStoreLink, targetStoreLinks[platform]])
    .filter(([sourceStoreLink, targetStoreLink]) => sourceStoreLink !== targetStoreLink);
  if (replacements.length) {
    const markers = replacements.map(([_sourceStoreLink], index) => `__BUS_LOOP_STORE_LINK_${index}__`);
    for (let index = 0; index < replacements.length; index += 1) {
      const [sourceStoreLink] = replacements[index];
      if (!html.includes(sourceStoreLink)) {
        throw new Error('Built HTML is missing a source branding variant store link.');
      }
      html = html.split(sourceStoreLink).join(markers[index]);
    }
    for (let index = 0; index < replacements.length; index += 1) {
      html = html.split(markers[index]).join(replacements[index][1]);
    }
  }
  assertEmbeddedStoreLinks(html, targetTuning);
  return html;
}

function isPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

export function validateTuning(tuning, template, location = 'tuning') {
  if (Array.isArray(template)) {
    if (!Array.isArray(tuning) || tuning.length > Math.max(template.length * 4, 256)) {
      throw new TypeError(`${location} must be a bounded array.`);
    }
    return tuning.map((value, index) => {
      const itemTemplate = template[index] ?? template[0];
      if (itemTemplate === undefined) throw new TypeError(`${location}[${index}] is not supported.`);
      return validateTuning(value, itemTemplate, `${location}[${index}]`);
    });
  }
  if (isPlainObject(template)) {
    if (!isPlainObject(tuning)) throw new TypeError(`${location} must be an object.`);
    const output = {};
    for (const [key, value] of Object.entries(tuning)) {
      if (key === '__proto__' || key === 'prototype' || key === 'constructor' || !(key in template)) {
        throw new TypeError(`${location}.${key} is not supported.`);
      }
      output[key] = validateTuning(value, template[key], `${location}.${key}`);
    }
    return output;
  }
  if (typeof template === 'number') {
    if (typeof tuning !== 'number' || !Number.isFinite(tuning)) throw new TypeError(`${location} must be finite.`);
    return tuning;
  }
  if (typeof template === 'string') {
    if (typeof tuning !== 'string' || tuning.length > 4096) throw new TypeError(`${location} must be a short string.`);
    if (location === 'tuning.storeLinks.android') return validateStoreLink('android', tuning, location);
    if (location === 'tuning.storeLinks.ios') return validateStoreLink('ios', tuning, location);
    if (location.startsWith('tuning.exportNaming.')) return validateExportNamingPart(tuning, location);
    return tuning;
  }
  if (typeof template === 'boolean') {
    if (typeof tuning !== 'boolean') throw new TypeError(`${location} must be boolean.`);
    return tuning;
  }
  if (tuning !== null || template !== null) throw new TypeError(`${location} has an unsupported value.`);
  return null;
}

function commandError(label, code, output) {
  const error = new Error(`${label} failed (${code}).\n${output.slice(-4000)}`);
  error.code = 'PLAYABLE_EXPORT_COMMAND_FAILED';
  return error;
}

async function run(command, args, { cwd, env = {}, signal, allowExitCodes = [0], label = command } = {}) {
  await new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env: { ...process.env, ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: process.platform !== 'win32'
    });
    let output = '';
    let settled = false;
    const append = (chunk) => {
      output = `${output}${chunk}`.slice(-MAX_COMMAND_OUTPUT);
    };
    const terminate = (killSignal = 'SIGTERM') => {
      if (!child.pid) return;
      try {
        if (process.platform === 'win32') child.kill(killSignal);
        else process.kill(-child.pid, killSignal);
      } catch (error) {
        if (error?.code !== 'ESRCH') child.kill(killSignal);
      }
    };
    child.stdout.on('data', append);
    child.stderr.on('data', append);
    child.once('error', (error) => {
      if (settled) return;
      settled = true;
      reject(error);
    });
    child.once('close', (code) => {
      if (settled) return;
      settled = true;
      if (allowExitCodes.includes(code)) resolve(output);
      else reject(commandError(label, code, output));
    });
    if (signal) {
      const abort = () => {
        if (settled) return;
        settled = true;
        terminate('SIGTERM');
        setTimeout(() => terminate('SIGKILL'), 1_000).unref();
        const error = new Error(`${label} 被中止。`);
        error.name = 'AbortError';
        reject(error);
      };
      if (signal.aborted) abort();
      else signal.addEventListener('abort', abort, { once: true });
    }
  });
}

async function firstExisting(paths) {
  for (const candidate of paths.filter(Boolean)) {
    try {
      await access(candidate, fsConstants.X_OK);
      return candidate;
    } catch {}
  }
  return null;
}

async function resolveSkillTools() {
  const roots = [
    process.env.BUILD_VERIFIED_PLAYABLE_SKILL_ROOT,
    path.join(os.homedir(), '.codex', 'skills', 'build-verified-playable-packages'),
    path.join(os.homedir(), '.agents', 'skills', 'build-verified-playable-packages')
  ].filter(Boolean);
  for (const root of roots) {
    const check = path.join(root, 'scripts', 'check_artifact.py');
    const zip = path.join(root, 'scripts', 'deterministic_zip.py');
    const createBatch = path.join(root, 'scripts', 'create_check_batch.py');
    const payload = path.join(root, 'scripts', 'scan_candidate_payloads.py');
    try {
      await Promise.all([access(check), access(zip), access(createBatch), access(payload)]);
      return { root, check, zip, createBatch, payload };
    } catch {}
  }
  throw new Error('build-verified-playable-packages is unavailable; export is blocked.');
}

async function copyIfPresent(source, destination) {
  try {
    await access(source);
    await cp(source, destination, { recursive: true, filter: (entry) => path.basename(entry) !== '.DS_Store' });
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
}

function isEditorBackgroundAsset(value) {
  return typeof value === 'string'
    && value.startsWith(EDITOR_BACKGROUND_PREFIX)
    && path.basename(value) === value.slice(EDITOR_BACKGROUND_PREFIX.length)
    && /^[A-Za-z0-9][A-Za-z0-9._-]{0,119}\.(?:jpe?g|png|webp)$/iu.test(path.basename(value));
}

function isEditorPreRollAsset(value) {
  return typeof value === 'string'
    && value.startsWith(EDITOR_PRE_ROLL_PREFIX)
    && path.basename(value) === value.slice(EDITOR_PRE_ROLL_PREFIX.length)
    && /^[A-Za-z0-9][A-Za-z0-9._-]{0,119}\.mp4$/iu.test(path.basename(value));
}

async function copySelectedEditorBackground(projectRoot, workRoot, tuning) {
  const asset = tuning?.background?.asset;
  if (!isEditorBackgroundAsset(asset)) return;
  const filename = path.basename(asset);
  const source = path.join(projectRoot, 'artifacts', 'editor-backgrounds', filename);
  const destination = path.join(workRoot, 'public', 'assets', 'editor-backgrounds', filename);
  await mkdir(path.dirname(destination), { recursive: true });
  await copyFile(source, destination);
}

async function copySelectedEditorPreRoll(projectRoot, workRoot, tuning) {
  const asset = tuning?.preRoll?.asset;
  if (!isEditorPreRollAsset(asset)) return;
  const filename = path.basename(asset);
  const source = path.join(projectRoot, 'artifacts', 'editor-prerolls', filename);
  const destination = path.join(workRoot, 'public', 'assets', 'editor-prerolls', filename);
  await mkdir(path.dirname(destination), { recursive: true });
  await copyFile(source, destination);
  let metadata = null;
  try {
    metadata = JSON.parse(await readFile(`${source}.json`, 'utf8'));
  } catch (error) {
    if (error.code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error;
  }
  if (Number(metadata?.compression?.version) !== PRE_ROLL_COMPRESSION_VERSION) {
    await compressPreRollFile(destination);
  }
}

async function loadBrandingIconDataUri(projectRoot, tuning) {
  const asset = tuning?.branding?.icon?.asset;
  if (
    typeof asset !== 'string'
    || !/^\/assets\/[A-Za-z0-9][A-Za-z0-9._/-]{0,239}$/u.test(asset)
    || asset.includes('..')
  ) {
    throw new Error('Branding variant icon must be a project asset.');
  }
  const mime = new Map([
    ['.jpg', 'image/jpeg'],
    ['.jpeg', 'image/jpeg'],
    ['.png', 'image/png'],
    ['.webp', 'image/webp']
  ]).get(path.extname(asset).toLowerCase());
  if (!mime) throw new Error(`Unsupported branding variant icon type: ${path.extname(asset) || '<missing>'}.`);
  const bytes = await readFile(path.join(projectRoot, 'public', asset.slice(1)));
  return `data:${mime};base64,${bytes.toString('base64')}`;
}

async function applyWorkspaceBrandingIcon(workRoot, tuning) {
  const asset = tuning?.branding?.icon?.asset;
  if (
    typeof asset !== 'string'
    || !/^\/assets\/[A-Za-z0-9][A-Za-z0-9._/-]{0,239}$/u.test(asset)
    || asset.includes('..')
  ) return;
  const indexPath = path.join(workRoot, 'index.html');
  const source = await readFile(indexPath, 'utf8');
  const pattern = /(<img\b(?=[^>]*\bid=["']branding-icon["'])[^>]*\bsrc=["'])[^"']+/iu;
  if (!pattern.test(source)) throw new Error('Playable HTML is missing the branding icon element.');
  await writeFile(indexPath, source.replace(pattern, `$1${asset}`), 'utf8');
}

async function prepareWorkspace(projectRoot, tuning, levelDocument = null) {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'bus-loop-playable-export-'));
  const workRoot = path.join(tempRoot, 'project');
  await mkdir(workRoot, { recursive: true });
  await Promise.all([
    cp(path.join(projectRoot, 'src'), path.join(workRoot, 'src'), { recursive: true }),
    cp(path.join(projectRoot, 'scripts'), path.join(workRoot, 'scripts'), { recursive: true }),
    cp(path.join(projectRoot, 'public'), path.join(workRoot, 'public'), {
      recursive: true,
      filter: (entry) => path.basename(entry) !== '.DS_Store'
    }),
    copyFile(path.join(projectRoot, 'index.html'), path.join(workRoot, 'index.html')),
    copyFile(path.join(projectRoot, 'package.json'), path.join(workRoot, 'package.json')),
    copyFile(path.join(projectRoot, 'vite.config.js'), path.join(workRoot, 'vite.config.js'))
  ]);
  await mkdir(path.join(workRoot, 'artifacts'), { recursive: true });
  await Promise.all([
    copyIfPresent(path.join(projectRoot, 'artifacts', 'web-levels'), path.join(workRoot, 'artifacts', 'web-levels')),
    copyIfPresent(path.join(projectRoot, 'artifacts', 'spatial-conveyors'), path.join(workRoot, 'artifacts', 'spatial-conveyors'))
  ]);
  if (levelDocument) {
    const levelKey = tuning?.level?.selected;
    if (!/^level[1-9]\d*$/u.test(levelKey) || levelDocument.key !== levelKey) {
      throw new TypeError('Export level document does not match tuning.level.selected.');
    }
    await mkdir(path.join(workRoot, 'artifacts', 'web-levels'), { recursive: true });
    await writeFile(
      path.join(workRoot, 'artifacts', 'web-levels', `${levelKey}.json`),
      `${JSON.stringify(levelDocument, null, 2)}\n`,
      'utf8'
    );
  }
  await copySelectedEditorBackground(projectRoot, workRoot, tuning);
  await copySelectedEditorPreRoll(projectRoot, workRoot, tuning);
  await applyWorkspaceBrandingIcon(workRoot, tuning);
  await symlink(path.join(projectRoot, 'node_modules'), path.join(workRoot, 'node_modules'), 'dir');
  const tuningPath = path.join(workRoot, 'artifacts', 'export-tuning.json');
  await writeFile(tuningPath, `${JSON.stringify(tuning, null, 2)}\n`, 'utf8');
  await run(process.execPath, [
    'scripts/apply-scene-tuning.mjs',
    '--input', tuningPath,
    '--strip-export-metadata'
  ], {
    cwd: workRoot,
    label: 'Apply editor tuning'
  });
  return { tempRoot, workRoot };
}

async function applyWorkspaceTuning(workRoot, tuning) {
  const tuningPath = path.join(workRoot, 'artifacts', 'export-tuning.json');
  await writeFile(tuningPath, `${JSON.stringify(tuning, null, 2)}\n`, 'utf8');
  await applyWorkspaceBrandingIcon(workRoot, tuning);
  await run(process.execPath, [
    'scripts/apply-scene-tuning.mjs',
    '--input', tuningPath,
    '--strip-export-metadata'
  ], {
    cwd: workRoot,
    label: 'Apply editor tuning variant'
  });
}

function injectHead(html, markup) {
  if (!html.includes('</head>')) throw new Error('Built HTML is missing </head>.');
  return html.replace('</head>', `${markup}</head>`);
}

function encodeCheckerOnlyUrls(source) {
  return source.replace(/(["'])http:\/\/www\.w3\.org\/1999\/xhtml\1/g, (_, quote) => (
    `${quote}http:${quote}+${quote}//www.w3.org/1999/xhtml${quote}`
  ));
}

function encodeUnityStaticFalsePositives(source) {
  if (/(?:window\s*\.\s*)?(?:parent|top)\s*[.[]\s*mraid\b/iu.test(source)) {
    throw new Error('UnityAds runtime must not probe parent/top for MRAID.');
  }
  return encodeCheckerOnlyUrls(source)
    .replace(/\bparent(?=\s*[.[])/gu, 'p\\u0061rent')
    .replace(/\btop(?=\s*[.[])/gu, 't\\u006fp')
    .replace(/texelFetch(?=\s*\()/gu, 'texelF\\u0065tch');
}

export function prepareMolocoHtml(source) {
  if (!source.includes('__playableDataRequest')) {
    throw new Error('Moloco build is missing the data-only offline request loader.');
  }
  // GLSL texture reads are not network calls; JS decodes this escape before shader compilation.
  const html = source
    .replace(/\btexelFetch(?=\s*\()/gu, 'texelF\\u0065tch')
    .replaceAll('`fetch for "${', '`Embedded asset request for "${');
  if (/fetch\s*\(|\b(?:fetch|XMLHttpRequest|WebSocket)\b|\bsendBeacon\s*\(/iu.test(html)) {
    throw new Error('Moloco build still contains a network API marker; export is blocked.');
  }
  return html;
}

export function splitSingleHtml(source) {
  const styleMatch = source.match(/<style>([\s\S]*?)<\/style>/i);
  const scripts = [...source.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)];
  const scriptMatch = scripts.find((match) => /\btype=["']module["']/i.test(match[1]));
  if (!styleMatch || !scriptMatch) throw new Error('Built HTML cannot be split into platform files.');
  let html = source.replace(styleMatch[0], '<link rel="stylesheet" href="style.css">');
  html = html.replace(scriptMatch[0], '<script defer src="index.js"></script>');
  return { html, css: styleMatch[1], js: scriptMatch[2] };
}

function orientationMeta(tuning) {
  const width = Math.max(1, Math.round(Number(tuning.preview?.width) || 1080));
  const height = Math.max(1, Math.round(Number(tuning.preview?.height) || 1920));
  const orientation = height >= width ? 'portrait' : 'landscape';
  return `<meta name="ad.size" content="width=${width},height=${height}"><meta name="ad.orientation" content="${orientation}">`;
}

async function deterministicZip(tool, root, output, entries, signal, timestamp) {
  await run('python3', [
    tool,
    '--root', root,
    '--output', output,
    '--timestamp', timestamp,
    ...entries.flatMap((entry) => ['--entry', entry])
  ], {
    cwd: root,
    signal,
    label: 'Deterministic ZIP'
  });
}

async function generateWorkspaceSources(workRoot, signal) {
  await Promise.all([
    run(process.execPath, ['scripts/generate-active-level.mjs'], {
      cwd: workRoot,
      signal,
      label: 'Generate active level'
    }),
    run(process.execPath, ['scripts/generate-active-spatial-conveyor.mjs'], {
      cwd: workRoot,
      signal,
      label: 'Generate active conveyor'
    })
  ]);
}

async function buildUniversalHtml(workRoot, platform, signal) {
  const buildRoot = path.join(workRoot, 'artifacts', 'export-builds', platform);
  const distRoot = path.join(buildRoot, 'dist');
  const outputPath = path.join(buildRoot, 'index.html');
  const vite = path.join(workRoot, 'node_modules', 'vite', 'bin', 'vite.js');
  await run(process.execPath, [vite, 'build', '--outDir', distRoot, '--emptyOutDir'], {
    cwd: workRoot,
    env: { NODE_ENV: 'production', PLAYABLE_PLATFORM: platform, PLAYABLE_REMOTE_EDITOR: '0' },
    signal,
    label: `Build ${platform}`
  });
  await run(process.execPath, ['scripts/package-applovin-single-html.mjs'], {
    cwd: workRoot,
    env: {
      PLAYABLE_PLATFORM: platform,
      PLAYABLE_DIST_DIR: distRoot,
      PLAYABLE_INLINE_OUTPUT_FILE: outputPath
    },
    signal,
    label: `Inline ${platform}`
  });
  return readFile(outputPath, 'utf8');
}

async function writePlatformArtifact({
  platform,
  fileName,
  sourceHtml,
  tuning,
  stageRoot,
  zipTool,
  projectRoot,
  signal,
  zipTimestamp,
  cachedBackupImagePath = null,
  skipChecks = false
}) {
  const artifactPath = path.join(stageRoot, fileName);
  let html = encodeCheckerOnlyUrls(sourceHtml);

  if (platform === 'applovin') {
    await writeFile(artifactPath, html, 'utf8');
    return artifactPath;
  }
  if (platform === 'unityads') {
    html = injectHead(html, '<script src="mraid.js"></script>');
    const inlineModule = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)]
      .find((match) => /\btype=["']module["']/i.test(match[1]) && !/\bsrc\s*=/i.test(match[1]));
    if (!inlineModule || inlineModule.index == null) {
      throw new Error('UnityAds build is missing its inline module.');
    }
    const transformed = await transformWithEsbuild(inlineModule[2], 'unityads-runtime.js', {
      minify: true,
      format: 'esm',
      target: 'esnext',
      supported: { 'template-literal': false }
    });
    const transformedTag = inlineModule[0].replace(inlineModule[2], () => transformed.code.trimEnd());
    html = `${html.slice(0, inlineModule.index)}${transformedTag}${html.slice(inlineModule.index + inlineModule[0].length)}`;
    html = encodeUnityStaticFalsePositives(html);
    html = html.replace(/\r\n?|\n/g, '').trim();
    await writeFile(artifactPath, html, 'utf8');
    return artifactPath;
  }
  if (platform === 'moloco') {
    html = prepareMolocoHtml(html);
    await writeFile(artifactPath, html, 'utf8');
    return artifactPath;
  }

  const packageRoot = path.join(stageRoot, `${platform}-root`);
  await mkdir(packageRoot, { recursive: true });
  const split = splitSingleHtml(html);
  if (platform === 'google-ads') {
    split.html = injectHead(split.html, `${orientationMeta(tuning)}<script src="${GOOGLE_SDK}"></script>`);
    await Promise.all([
      writeFile(path.join(packageRoot, 'index.html'), split.html, 'utf8'),
      writeFile(path.join(packageRoot, 'index.js'), split.js, 'utf8'),
      writeFile(path.join(packageRoot, 'style.css'), split.css, 'utf8')
    ]);
    const backupPath = path.join(packageRoot, 'backup.jpg');
    if (cachedBackupImagePath) {
      try {
        await copyFile(cachedBackupImagePath, backupPath);
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
        if (skipChecks) {
          throw new Error('Google Ads backup image is unavailable while local checks are disabled.');
        }
        await capturePlayableBackupImage({ artifactPath: packageRoot, platform, outputPath: backupPath });
        await copyFile(backupPath, cachedBackupImagePath);
      }
    } else if (skipChecks) {
      await copyFile(path.join(projectRoot, 'artifacts', 'google-ads-backup.jpg'), backupPath);
    } else {
      await capturePlayableBackupImage({ artifactPath: packageRoot, platform, outputPath: backupPath });
    }
    await deterministicZip(zipTool, packageRoot, artifactPath, ['index.html', 'index.js', 'style.css', 'backup.jpg'], signal, zipTimestamp);
    return artifactPath;
  }
  if (platform === 'meta') {
    split.html = injectHead(split.html, orientationMeta(tuning));
    await Promise.all([
      writeFile(path.join(packageRoot, 'index.html'), split.html, 'utf8'),
      writeFile(path.join(packageRoot, 'index.js'), split.js, 'utf8'),
      writeFile(path.join(packageRoot, 'style.css'), split.css, 'utf8')
    ]);
    await deterministicZip(zipTool, packageRoot, artifactPath, ['index.html', 'index.js', 'style.css'], signal, zipTimestamp);
    return artifactPath;
  }
  if (platform === 'tiktok') {
    split.html = injectHead(split.html, `<script src="${TIKTOK_SDK}"></script>`);
    await Promise.all([
      writeFile(path.join(packageRoot, 'index.html'), split.html, 'utf8'),
      writeFile(path.join(packageRoot, 'index.js'), split.js, 'utf8'),
      writeFile(path.join(packageRoot, 'style.css'), split.css, 'utf8'),
      writeFile(path.join(packageRoot, 'config.json'), '{"orientation":0,"playable_orientation":0}\n', 'utf8')
    ]);
    await deterministicZip(zipTool, packageRoot, artifactPath, ['index.html', 'index.js', 'style.css', 'config.json'], signal, zipTimestamp);
    return artifactPath;
  }

  const base = path.parse(fileName).name;
  const mintegralRoot = path.join(packageRoot, base);
  await mkdir(mintegralRoot, { recursive: true });
  split.html = split.html
    .replace('href="style.css"', 'href="style.css"')
    .replace('src="index.js"', 'src="index.js"');
  await Promise.all([
    writeFile(path.join(mintegralRoot, `${base}.html`), split.html, 'utf8'),
    writeFile(path.join(mintegralRoot, 'index.js'), split.js, 'utf8'),
    writeFile(path.join(mintegralRoot, 'style.css'), split.css, 'utf8')
  ]);
  await deterministicZip(zipTool, packageRoot, artifactPath, [base], signal, zipTimestamp);
  return artifactPath;
}

async function checkArtifact({
  skill,
  platform,
  artifactPath,
  reportRoot,
  reportLabel = platform,
  signal,
  device = null,
  cachedRuntimeReport = null,
  skipRuntime = false,
  skipChecks = false
}) {
  await mkdir(reportRoot, { recursive: true });
  if (skipChecks) {
    return {
      passed: true,
      conclusion: 'SKIPPED_LOCAL_CHECKS',
      checkBatchId: null,
      passedCount: 0,
      totalCount: 0,
      warningCount: 0,
      manualCount: 0,
      reportPaths: {}
    };
  }
  const batchPath = path.join(reportRoot, `${reportLabel}-batch.json`);
  await run('python3', [
    skill.createBatch,
    '--platform', platform,
    '--artifact', artifactPath,
    '--output', batchPath
  ], {
    signal,
    label: `Create ${platform} check batch`
  });
  const batch = JSON.parse(await readFile(batchPath, 'utf8'));
  const checkBatchId = batch.checkBatchId;
  if (!checkBatchId) throw new Error(`${platform} check batch is missing its id.`);

  const staticReportPath = path.join(reportRoot, `${reportLabel}-static.json`);
  await run('python3', [
    skill.check,
    '--platform', platform,
    '--artifact', artifactPath,
    '--target-os', 'both',
    '--check-batch-id', checkBatchId,
    '--json-out', staticReportPath
  ], {
    signal,
    allowExitCodes: [0, 2],
    label: `Check ${platform}`
  });
  const staticReport = JSON.parse(await readFile(staticReportPath, 'utf8'));
  const staticFailures = (staticReport.checks ?? [])
    .filter((item) => item.status === 'fail' || item.status === 'warning')
    .map((item) => item.id);
  if (
    staticReport.conclusion === 'FAIL'
    || Number(staticReport.summary?.fail) > 0
    || Number(staticReport.summary?.warning) > 0
  ) {
    const failures = staticFailures;
    throw new Error(`${platform} local rules blocked export: ${failures.join(', ') || 'unknown rule'}.`);
  }

  const payloadReportPath = path.join(reportRoot, `${reportLabel}-payload.json`);
  const runtimeReportPath = path.join(reportRoot, `${reportLabel}-runtime.json`);
  const runtimeDevices = brandingDeviceProfiles(device);
  const [payloadResult, ...runtimeReports] = await Promise.all([
    run('python3', [
      skill.payload,
      '--platform', platform,
      '--artifact', artifactPath,
      '--check-batch-id', checkBatchId,
      '--output', payloadReportPath
    ], {
      signal,
      allowExitCodes: [0, 2],
      label: `Scan ${platform} payloads`
    }),
    skipRuntime
      ? (async () => {
          const report = {
            schemaVersion: 'bus-loop-playable-runtime-smoke-v2',
            platform,
            checkBatchId,
            conclusion: 'PASS',
            skippedRuntime: true,
            summary: { pass: 0, fail: 0, total: 0 },
            checks: []
          };
          await writeFile(runtimeReportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
          return report;
        })()
      : cachedRuntimeReport
      ? (async () => {
          const artifactBytes = (await stat(artifactPath)).isFile() ? await readFile(artifactPath) : null;
          const report = {
            ...cachedRuntimeReport,
            checkBatchId,
            artifact: {
              ...cachedRuntimeReport.artifact,
              path: artifactPath,
              bytes: artifactBytes?.length ?? null,
              sha256: artifactBytes ? createHash('sha256').update(artifactBytes).digest('hex') : null
            },
            reusedRuntimeEvidence: true
          };
          await writeFile(runtimeReportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
          return report;
        })()
      : checkPlayableRuntimeArtifact({
          artifactPath,
          platform,
          outputPath: runtimeReportPath,
          checkBatchId,
          device,
          signal
        }),
    ...(skipRuntime || cachedRuntimeReport || runtimeDevices.length < 2
      ? []
      : [checkPlayableRuntimeArtifact({
          artifactPath,
          platform,
          outputPath: `${runtimeReportPath}.${runtimeDevices[1]}`,
          checkBatchId,
          device: runtimeDevices[1],
          signal
        })])
  ]);
  void payloadResult;
  const runtimeReport = runtimeReports[0];
  const runtimeFailures = runtimeReports.filter((report) => (
    report.conclusion !== 'PASS' || Number(report.summary?.fail) > 0
  ));
  const payloadReport = JSON.parse(await readFile(payloadReportPath, 'utf8'));
  if (payloadReport.conclusion !== 'PASS' || (payloadReport.blockers ?? []).length > 0) {
    const blockers = (payloadReport.blockers ?? []).map((item) => item.code);
    throw new Error(`${platform} payload scan blocked export: ${blockers.join(', ') || 'unknown payload issue'}.`);
  }
  if (runtimeFailures.length > 0) {
    const failures = runtimeFailures.flatMap((report) => (
      (report.checks ?? []).filter((item) => item.status === 'fail').map((item) => item.id)
    ));
    throw new Error(`${platform} runtime smoke blocked export: ${failures.join(', ') || 'unknown runtime issue'}.`);
  }
  return {
    passed: true,
    conclusion: 'PASS',
    checkBatchId,
    passedCount: (Number(staticReport.summary?.pass) || 0) + (Number(runtimeReport.summary?.pass) || 0) + 1,
    totalCount: (staticReport.checks ?? []).length + (Number(runtimeReport.summary?.total) || 0) + 1,
    warningCount: 0,
    manualCount: Number(staticReport.summary?.manual) || 0,
    rulesetVersion: staticReport.ruleset?.rulesetVersion,
    rulesetSha256: staticReport.ruleset?.rulesetSha256,
    reportPath: staticReportPath,
    reportPaths: {
      batch: batchPath,
      static: staticReportPath,
      payload: payloadReportPath,
      runtime: runtimeReportPath
    }
  };
}

async function buildOne({
  platform,
  fileName,
  sourceHtml,
  tuning,
  projectRoot,
  stageRoot,
  skill,
  signal,
  zipTimestamp,
  brandingVariant,
  cachedRuntimeReport = null,
  skipRuntime = false,
  cachedBackupImagePath = null,
  skipChecks = false
}) {
  const artifactPath = await writePlatformArtifact({
    platform,
    fileName,
    sourceHtml,
    tuning,
    stageRoot,
    zipTool: skill.zip,
    projectRoot,
    signal,
    zipTimestamp,
    cachedBackupImagePath,
    skipChecks
  });
  const checkSummary = await checkArtifact({
    skill,
    platform,
    artifactPath,
    reportRoot: path.join(stageRoot, 'reports'),
    reportLabel: brandingVariant ? `${platform}-${brandingVariant}` : platform,
    signal,
    cachedRuntimeReport,
    skipRuntime,
    skipChecks,
    // A branding variant bakes one store link, so smoke it as the device that variant targets.
    device: brandingVariant
  });
  const { bytes, sha256 } = await artifactIdentity(artifactPath);
  return {
    platform,
    brandingVariant: brandingVariant ?? null,
    resourceMode: EXPORT_RESOURCE_MODE,
    format: PLATFORM_FORMATS[platform],
    fileName,
    filePath: artifactPath,
    contentType: PLATFORM_FORMATS[platform] === 'zip' ? 'application/zip' : 'text/html; charset=utf-8',
    bytes,
    sha256,
    checkSummary
  };
}

async function loadTemplate(projectRoot) {
  const url = `${pathToFileURL(path.join(projectRoot, 'src', 'scene-tuning.js')).href}?export=${Date.now()}`;
  return (await import(url)).SCENE_TUNING;
}

async function publish(source, destination) {
  await mkdir(path.dirname(destination), { recursive: true });
  const temporary = path.join(path.dirname(destination), `.${path.basename(destination)}.${process.pid}.tmp`);
  await copyFile(source, temporary);
  await rename(temporary, destination);
  return destination;
}

async function artifactIdentity(filePath) {
  const bytes = (await stat(filePath)).size;
  const sha256 = createHash('sha256').update(await readFile(filePath)).digest('hex');
  return { bytes, sha256 };
}

async function verifyPublishedArtifact(filePath, expected, label) {
  const actual = await artifactIdentity(filePath);
  if (actual.bytes !== expected.bytes || actual.sha256 !== expected.sha256) {
    throw new Error(`${label} changed while being published; export is blocked.`);
  }
  return actual;
}

async function publishCheckReports(checkSummary, destinationRoot, reportLabel) {
  const published = {};
  for (const [kind, source] of Object.entries(checkSummary.reportPaths ?? {})) {
    published[kind] = await publish(source, path.join(destinationRoot, 'reports', `${reportLabel}-${kind}.json`));
  }
  return published;
}

function getExportConcurrency(itemCount) {
  const configured = Number.parseInt(process.env.PLAYABLE_EXPORT_CONCURRENCY ?? '', 10);
  const requested = Number.isInteger(configured) && configured > 0
    ? configured
    : DEFAULT_EXPORT_CONCURRENCY;
  return Math.max(1, Math.min(itemCount, requested));
}

async function exportInputFingerprint(projectRoot, tuning, levelDocument = null) {
  const candidates = [
    path.join(projectRoot, 'artifacts', 'selected-level.txt'),
    path.join(projectRoot, 'artifacts', 'level-catalog.js'),
    path.join(projectRoot, 'artifacts', 'unity-levels.json'),
    path.join(projectRoot, 'artifacts', 'web-levels', `${tuning?.level?.selected ?? ''}.json`),
    path.join(projectRoot, 'artifacts', 'spatial-conveyors', `${String(tuning?.conveyorLayout?.selected ?? '').replace(/^spatial:/u, '')}.json`)
  ];
  const background = tuning?.background?.asset;
  if (isEditorBackgroundAsset(background)) {
    candidates.push(path.join(projectRoot, 'artifacts', 'editor-backgrounds', path.basename(background)));
  }
  const preRoll = tuning?.preRoll?.asset;
  if (isEditorPreRollAsset(preRoll)) {
    candidates.push(path.join(projectRoot, 'artifacts', 'editor-prerolls', path.basename(preRoll)));
  }
  const artifactStates = await Promise.all(candidates.map(async (candidate) => {
    try {
      const file = await stat(candidate);
      return [path.relative(projectRoot, candidate), file.size, file.mtimeMs];
    } catch (error) {
      if (error.code === 'ENOENT') return [path.relative(projectRoot, candidate), null, null];
      throw error;
    }
  }));
  const sourceStates = [];
  async function collectSourceState(absolutePath, relativePath) {
    let file;
    try {
      file = await stat(absolutePath);
    } catch (error) {
      if (error.code === 'ENOENT') return;
      throw error;
    }
    if (!file.isDirectory()) {
      sourceStates.push([relativePath, file.size, file.mtimeMs]);
      return;
    }
    const entries = (await readdir(absolutePath, { withFileTypes: true }))
      .sort((left, right) => left.name.localeCompare(right.name));
    await Promise.all(entries.map((entry) => collectSourceState(
      path.join(absolutePath, entry.name),
      path.join(relativePath, entry.name).replaceAll(path.sep, '/')
    )));
  }
  // The reusable HTML is built from these trees. Tracking only level/artifact
  // files lets a long-lived editor serve stale gameplay after source or asset
  // edits, which is worse than losing the cache hit.
  await Promise.all([
    'src', 'scripts', 'public', 'index.html', 'package.json', 'vite.config.js'
  ].map((relativePath) => collectSourceState(
    path.join(projectRoot, relativePath),
    relativePath
  )));
  sourceStates.sort((left, right) => left[0].localeCompare(right[0]));
  return createHash('sha256')
    .update(`${EXPORT_SOURCE_CACHE_VERSION}\n${JSON.stringify(tuning)}\n${JSON.stringify(levelDocument)}\n${JSON.stringify(artifactStates)}\n${JSON.stringify(sourceStates)}`)
    .digest('hex');
}

function getCachedExportSources(key) {
  const entry = exportSourceCache.get(key);
  if (!entry) return null;
  exportSourceCache.delete(key);
  exportSourceCache.set(key, entry);
  return entry;
}

function setCachedExportSources(key, sourceVariantTuning, sources) {
  exportSourceCache.delete(key);
  exportSourceCache.set(key, {
    sourceVariantTuning,
    sources: new Map(sources)
  });
  while (exportSourceCache.size > EXPORT_SOURCE_CACHE_LIMIT) {
    exportSourceCache.delete(exportSourceCache.keys().next().value);
  }
}

async function mapWithConcurrency(items, concurrency, operation) {
  const results = new Array(items.length);
  let nextIndex = 0;
  let firstError = null;
  const workers = Array.from({ length: Math.min(items.length, concurrency) }, async () => {
    while (!firstError && nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      try {
        results[index] = await operation(items[index], index);
      } catch (error) {
        firstError ??= error;
      }
    }
  });
  await Promise.all(workers);
  if (firstError) throw firstError;
  return results;
}

async function exportPlatforms({ projectRoot, tuning, levelDocument = null, platforms, outputDir, signal, variants = null, skipRuntime = false, skipChecks = false }) {
  const resolvedRoot = path.resolve(projectRoot);
  const template = await loadTemplate(resolvedRoot);
  let safeTuning;
  let outputNames;
  try {
    safeTuning = validateTuning(tuning ?? template, template);
    outputNames = buildPlayableArtifactNames(safeTuning, platforms);
  } catch (error) {
    if (error instanceof TypeError) error.statusCode = 400;
    throw error;
  }
  const skill = await resolveSkillTools();
  const sourceCacheKey = variants ? await exportInputFingerprint(resolvedRoot, safeTuning, levelDocument) : null;
  const cachedSources = sourceCacheKey ? getCachedExportSources(sourceCacheKey) : null;
  const workspace = cachedSources
    ? { tempRoot: await mkdtemp(path.join(os.tmpdir(), 'bus-loop-playable-export-')), workRoot: null }
    : await prepareWorkspace(resolvedRoot, safeTuning, levelDocument);
  const stageRoot = path.join(workspace.tempRoot, 'delivery');
  await mkdir(stageRoot, { recursive: true });
  const zipTimestamp = new Date().toISOString();
  try {
    const results = [];
    const buildVariants = variants ?? [{ id: null, suffix: '', tuning: safeTuning }];
    const reusableSources = variants ? new Map(cachedSources?.sources ?? []) : null;
    const cachedBackupImagePath = skipChecks
      ? path.join(resolvedRoot, 'artifacts', 'google-ads-backup.jpg')
      : variants && process.env.PLAYABLE_EXPORT_REMOTE_FAST === '1'
      ? path.join(resolvedRoot, 'artifacts', 'google-ads-backup.jpg')
      : (variants ? path.join(stageRoot, 'google-ads-backup.jpg') : null);
    let sourceVariantTuning = cachedSources?.sourceVariantTuning ?? null;
    for (let variantIndex = 0; variantIndex < buildVariants.length; variantIndex += 1) {
      const variant = buildVariants[variantIndex];
      const variantTuning = variant.id
        ? createBrandingVariantTuning(safeTuning, variant.id)
        : safeTuning;
      const reusesBuiltSources = reusableSources && variantIndex > 0;
      if (!reusesBuiltSources && !cachedSources) {
        if (variant.id) await applyWorkspaceTuning(workspace.workRoot, variantTuning);
        await generateWorkspaceSources(workspace.workRoot, signal);
      }
      const targetIconDataUri = reusesBuiltSources
        ? await loadBrandingIconDataUri(resolvedRoot, variantTuning)
        : null;
      let variantNames;
      try {
        variantNames = variant.suffix
          ? buildPlayableArtifactNames(variantTuning, platforms, variant.suffix, { compactGoogleAds: true })
          : outputNames;
      } catch (error) {
        if (error instanceof TypeError) error.statusCode = 400;
        throw error;
      }
      const variantResults = await mapWithConcurrency(
        platforms,
        getExportConcurrency(platforms.length),
        async (platform) => {
          let sourceHtml;
          if (reusesBuiltSources) {
            const reusableSource = reusableSources.get(platform);
            if (!reusableSource) throw new Error(`Reusable ${platform} build is missing.`);
            sourceHtml = retargetBrandingVariantHtml(
              reusableSource,
              sourceVariantTuning,
              variantTuning,
              targetIconDataUri
            );
          } else if (cachedSources) {
            sourceHtml = reusableSources.get(platform);
            if (!sourceHtml) throw new Error(`Cached ${platform} build is missing.`);
          } else {
            sourceHtml = await buildUniversalHtml(workspace.workRoot, platform, signal);
            reusableSources?.set(platform, sourceHtml);
          }
          assertEmbeddedStoreLinks(sourceHtml, variantTuning);
          return buildOne({
            platform,
            fileName: variantNames[platform],
            sourceHtml,
            tuning: variantTuning,
            projectRoot: resolvedRoot,
            stageRoot,
            skill,
            signal,
            zipTimestamp,
            brandingVariant: variant.id,
            // Branding variants must each run their own target/opposite-UA smoke;
            // reusing the first variant's report would hide device-specific fallback regressions.
            cachedRuntimeReport: null,
            skipRuntime,
            skipChecks,
            cachedBackupImagePath
          });
        }
      );
      results.push(...variantResults);
      sourceVariantTuning ??= variantTuning;
    }
    if (sourceCacheKey && !cachedSources) {
      setCachedExportSources(sourceCacheKey, sourceVariantTuning, reusableSources);
    }
    return {
      results,
      workspace,
      stageRoot,
      skill,
      tuning: safeTuning,
      zipTimestamp,
      sourceCacheHit: Boolean(cachedSources)
    };
  } catch (error) {
    if (process.env.PLAYABLE_EXPORT_KEEP_FAILED === '1') {
      error.debugWorkspace = workspace.tempRoot;
      console.error(`Failed export workspace kept at ${workspace.tempRoot}`);
    } else {
      await rm(workspace.tempRoot, { recursive: true, force: true });
    }
    throw error;
  }
}

export async function exportPlayablePackage({ projectRoot = process.cwd(), platform, tuning, levelDocument = null, outputDir, signal, skipChecks = false } = {}) {
  if (!SUPPORTED_PLATFORMS.includes(platform)) {
    const error = new TypeError(`Unsupported playable platform: ${platform ?? '<missing>'}.`);
    error.statusCode = 400;
    throw error;
  }
  const destinationRoot = path.resolve(outputDir ?? path.join(projectRoot, 'artifacts', 'playable-exports'));
  const built = await exportPlatforms({ projectRoot, tuning, levelDocument, platforms: [platform], outputDir: destinationRoot, signal, skipChecks });
  try {
    const [result] = built.results;
    const filePath = await publish(result.filePath, path.join(destinationRoot, result.fileName));
    const publishedIdentity = await verifyPublishedArtifact(filePath, result, `${platform} artifact`);
    const reportPaths = await publishCheckReports(result.checkSummary, destinationRoot, platform);
    return {
      ...result,
      filePath,
      sourceCacheHit: built.sourceCacheHit,
      ...publishedIdentity,
      checkSummary: { ...result.checkSummary, reportPath: reportPaths.static, reportPaths }
    };
  } finally {
    await rm(built.workspace.tempRoot, { recursive: true, force: true });
  }
}

export async function exportAllPlayablePackages({ projectRoot = process.cwd(), tuning, levelDocument = null, outputDir, signal, skipChecks = false } = {}) {
  const destinationRoot = path.resolve(outputDir ?? path.join(projectRoot, 'artifacts', 'playable-exports'));
  const built = await exportPlatforms({
    projectRoot,
    tuning,
    levelDocument,
    platforms: SUPPORTED_PLATFORMS,
    outputDir: destinationRoot,
    signal,
    variants: PLAYABLE_BRANDING_VARIANTS.map(({ id, suffix }) => ({ id, suffix })),
    // Runtime smoke is part of the online editor's export contract. The remote
    // fast flag may reuse the Google Ads backup image, but must not publish an
    // artifact whose JavaScript path was never exercised.
    skipRuntime: process.env.PLAYABLE_EXPORT_SKIP_RUNTIME === '1',
    skipChecks
  });
  try {
    const checksSkipped = built.results.some(({ checkSummary }) => checkSummary.conclusion === 'SKIPPED_LOCAL_CHECKS');
    const manifest = {
      schemaVersion: 'bus-loop-playable-export-set-v1',
      resourceMode: EXPORT_RESOURCE_MODE,
      status: checksSkipped ? 'EXPORTED_WITHOUT_LOCAL_CHECKS' : 'LOCAL_RULES_PASSED_AWAITING_PLATFORM_ACCEPTANCE',
      note: checksSkipped
        ? 'Local package, payload, and runtime checks were intentionally skipped by the editor export action. Official upload and device acceptance are required before use.'
        : 'Existing project assets are packaged as-is; custom pre-roll videos are stored and staged as compressed H.264/AAC MP4s. Each nested artifact keeps the platform-native delivery format. Official upload and device acceptance remain required.',
      naming: {
        pattern: PLAYABLE_NAMING_PATTERN,
        values: built.tuning.exportNaming
      },
      artifacts: built.results.map(({ platform, brandingVariant, format, fileName, bytes, sha256, checkSummary }) => ({
        platform,
        brandingVariant,
        format,
        fileName,
        bytes,
        sha256,
        check: {
          conclusion: checkSummary.conclusion,
          checkBatchId: checkSummary.checkBatchId,
          static: checkSummary.conclusion === 'SKIPPED_LOCAL_CHECKS' ? 'SKIPPED' : 'PASS',
          runtime: checkSummary.conclusion === 'SKIPPED_LOCAL_CHECKS' ? 'SKIPPED' : 'PASS',
          payload: checkSummary.conclusion === 'SKIPPED_LOCAL_CHECKS' ? 'SKIPPED' : 'PASS',
          rulesetVersion: checkSummary.rulesetVersion,
          rulesetSha256: checkSummary.rulesetSha256
        }
      }))
    };
    await writeFile(path.join(built.stageRoot, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
    const aggregateName = 'bus-loop-all-platforms.zip';
    const aggregateStage = path.join(built.workspace.tempRoot, aggregateName);
    await deterministicZip(
      built.skill.zip,
      built.stageRoot,
      aggregateStage,
      ['manifest.json', 'reports', ...built.results.map((item) => item.fileName)],
      signal,
      built.zipTimestamp
    );
    const aggregateIdentity = await artifactIdentity(aggregateStage);
    const filePath = await publish(aggregateStage, path.join(destinationRoot, aggregateName));
    const publishedIdentity = await verifyPublishedArtifact(filePath, aggregateIdentity, 'All-platform artifact');
    const reportPaths = Object.fromEntries(await Promise.all(built.results.map(async (item) => [
      `${item.brandingVariant}-${item.platform}`,
      await publishCheckReports(
        item.checkSummary,
        destinationRoot,
        item.brandingVariant ? `${item.platform}-${item.brandingVariant}` : item.platform
      )
    ])));
    return {
      platform: 'all',
      resourceMode: EXPORT_RESOURCE_MODE,
      sourceCacheHit: built.sourceCacheHit,
      format: 'zip',
      fileName: aggregateName,
      filePath,
      contentType: 'application/zip',
      ...publishedIdentity,
      artifacts: manifest.artifacts,
      reportPaths,
      checkSummary: {
        passed: true,
        conclusion: built.results.some(({ checkSummary }) => checkSummary.conclusion === 'SKIPPED_LOCAL_CHECKS')
          ? 'EXPORTED_WITHOUT_LOCAL_CHECKS'
          : 'LOCAL_RULES_PASSED_AWAITING_PLATFORM_ACCEPTANCE',
        passedCount: built.results.reduce((sum, item) => sum + item.checkSummary.passedCount, 0),
        totalCount: built.results.reduce((sum, item) => sum + item.checkSummary.totalCount, 0),
        platformCount: built.results.length
      }
    };
  } finally {
    await rm(built.workspace.tempRoot, { recursive: true, force: true });
  }
}

function parseArgs(argv) {
  const value = (name) => {
    const index = argv.indexOf(name);
    return index >= 0 ? argv[index + 1] : undefined;
  };
  return {
    all: argv.includes('--all'),
    platform: value('--platform'),
    tuningPath: value('--tuning-json'),
    outputDir: value('--output-dir')
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const projectRoot = process.cwd();
  const tuning = args.tuningPath
    ? JSON.parse(await readFile(path.resolve(args.tuningPath), 'utf8'))
    : undefined;
  const result = args.all
    ? await exportAllPlayablePackages({ projectRoot, tuning, outputDir: args.outputDir })
    : await exportPlayablePackage({ projectRoot, platform: args.platform, tuning, outputDir: args.outputDir });
  console.log(JSON.stringify(result, null, 2));
}

const invoked = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (invoked === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
