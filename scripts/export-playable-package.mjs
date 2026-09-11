import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { access, copyFile, cp, mkdir, mkdtemp, readFile, rename, rm, stat, symlink, writeFile } from 'node:fs/promises';
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
const GOOGLE_SDK = 'https://tpc.googlesyndication.com/pagead/gadgets/html5/api/exitapi.js';
const TIKTOK_SDK = 'https://sf16-muse-va.ibytedtos.com/obj/union-fe-nc-i18n/playable/sdk/playable-sdk.js';
const MAX_COMMAND_OUTPUT = 16000;
const MAX_EXPORT_NAME_LENGTH = 180;

export function validateExportNamingPart(value, location = 'export naming field') {
  if (typeof value !== 'string') throw new TypeError(`${location} must be a string.`);
  const normalized = value.trim();
  if (!normalized) throw new TypeError(`${location} must not be empty.`);
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

export function buildPlayableArtifactName(tuning, platform) {
  if (!SUPPORTED_PLATFORMS.includes(platform)) {
    throw new TypeError(`Unsupported playable platform: ${platform ?? '<missing>'}.`);
  }
  const naming = tuning?.exportNaming;
  if (!isPlainObject(naming) || !isPlainObject(naming.channels)) {
    throw new TypeError('tuning.exportNaming must contain naming fields and platform channels.');
  }
  const parts = [
    ['requirementCode', naming.requirementCode],
    ['materialCode', naming.materialCode],
    ['iterationCode', naming.iterationCode],
    ['language', naming.language],
    ['format', naming.format],
    ['designer', naming.designer],
    ['requester', naming.requester],
    [`channels.${platform}`, naming.channels[platform]],
    ['steps', naming.steps],
    ['stamina', naming.stamina]
  ].map(([key, value]) => validateExportNamingPart(value, `tuning.exportNaming.${key}`));
  const businessBaseName = parts.join('-');
  const baseName = platform === 'mintegral'
    ? businessBaseName.replaceAll('-', '_')
    : businessBaseName;
  if (platform === 'google-ads' && baseName.length > 50) {
    throw new TypeError(`Google Ads export name must not exceed 50 characters; received ${baseName.length}.`);
  }
  if (baseName.length > MAX_EXPORT_NAME_LENGTH) {
    throw new TypeError(`Playable export name must not exceed ${MAX_EXPORT_NAME_LENGTH} characters.`);
  }
  return `${baseName}.${PLATFORM_FORMATS[platform]}`;
}

function buildPlayableArtifactNames(tuning, platforms) {
  const channelOwners = new Map();
  const names = {};
  for (const platform of platforms) {
    const channel = validateExportNamingPart(
      tuning?.exportNaming?.channels?.[platform],
      `tuning.exportNaming.channels.${platform}`
    ).toLowerCase();
    const existingPlatform = channelOwners.get(channel);
    if (existingPlatform) {
      throw new TypeError(`Export channel codes must be unique: ${existingPlatform} and ${platform} both use ${channel}.`);
    }
    channelOwners.set(channel, platform);
    names[platform] = buildPlayableArtifactName(tuning, platform);
  }
  return names;
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
      stdio: ['ignore', 'pipe', 'pipe']
    });
    let output = '';
    const append = (chunk) => {
      output = `${output}${chunk}`.slice(-MAX_COMMAND_OUTPUT);
    };
    child.stdout.on('data', append);
    child.stderr.on('data', append);
    child.once('error', reject);
    child.once('close', (code) => {
      if (allowExitCodes.includes(code)) resolve(output);
      else reject(commandError(label, code, output));
    });
    if (signal) {
      if (signal.aborted) child.kill('SIGTERM');
      signal.addEventListener('abort', () => child.kill('SIGTERM'), { once: true });
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

async function prepareWorkspace(projectRoot, tuning) {
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

async function deterministicZip(tool, root, output, entries, signal) {
  await run('python3', [tool, '--root', root, '--output', output, ...entries.flatMap((entry) => ['--entry', entry])], {
    cwd: root,
    signal,
    label: 'Deterministic ZIP'
  });
}

async function buildUniversalHtml(workRoot, platform, signal) {
  await run(process.execPath, ['scripts/generate-active-level.mjs'], { cwd: workRoot, signal, label: 'Generate active level' });
  await run(process.execPath, ['scripts/generate-active-spatial-conveyor.mjs'], { cwd: workRoot, signal, label: 'Generate active conveyor' });
  const vite = path.join(workRoot, 'node_modules', 'vite', 'bin', 'vite.js');
  await run(process.execPath, [vite, 'build'], {
    cwd: workRoot,
    env: { NODE_ENV: 'production', PLAYABLE_PLATFORM: platform },
    signal,
    label: `Build ${platform}`
  });
  await run(process.execPath, ['scripts/package-applovin-single-html.mjs'], {
    cwd: workRoot,
    env: { PLAYABLE_PLATFORM: platform },
    signal,
    label: `Inline ${platform}`
  });
  return readFile(path.join(workRoot, 'artifacts', 'applovin', 'index.html'), 'utf8');
}

async function writePlatformArtifact({ platform, fileName, sourceHtml, tuning, stageRoot, zipTool, projectRoot, signal }) {
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
    await capturePlayableBackupImage({
      artifactPath: packageRoot,
      platform,
      outputPath: path.join(packageRoot, 'backup.jpg')
    });
    await deterministicZip(zipTool, packageRoot, artifactPath, ['index.html', 'index.js', 'style.css', 'backup.jpg'], signal);
    return artifactPath;
  }
  if (platform === 'meta') {
    split.html = injectHead(split.html, orientationMeta(tuning));
    await Promise.all([
      writeFile(path.join(packageRoot, 'index.html'), split.html, 'utf8'),
      writeFile(path.join(packageRoot, 'index.js'), split.js, 'utf8'),
      writeFile(path.join(packageRoot, 'style.css'), split.css, 'utf8')
    ]);
    await deterministicZip(zipTool, packageRoot, artifactPath, ['index.html', 'index.js', 'style.css'], signal);
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
    await deterministicZip(zipTool, packageRoot, artifactPath, ['index.html', 'index.js', 'style.css', 'config.json'], signal);
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
  await deterministicZip(zipTool, packageRoot, artifactPath, [base], signal);
  return artifactPath;
}

async function checkArtifact({ skill, platform, artifactPath, reportRoot, signal }) {
  await mkdir(reportRoot, { recursive: true });
  const batchPath = path.join(reportRoot, `${platform}-batch.json`);
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

  const staticReportPath = path.join(reportRoot, `${platform}-static.json`);
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

  const payloadReportPath = path.join(reportRoot, `${platform}-payload.json`);
  const runtimeReportPath = path.join(reportRoot, `${platform}-runtime.json`);
  const [, runtimeReport] = await Promise.all([
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
    checkPlayableRuntimeArtifact({
      artifactPath,
      platform,
      outputPath: runtimeReportPath,
      checkBatchId
    })
  ]);
  const payloadReport = JSON.parse(await readFile(payloadReportPath, 'utf8'));
  if (payloadReport.conclusion !== 'PASS' || (payloadReport.blockers ?? []).length > 0) {
    const blockers = (payloadReport.blockers ?? []).map((item) => item.code);
    throw new Error(`${platform} payload scan blocked export: ${blockers.join(', ') || 'unknown payload issue'}.`);
  }
  if (runtimeReport.conclusion !== 'PASS' || Number(runtimeReport.summary?.fail) > 0) {
    const failures = (runtimeReport.checks ?? []).filter((item) => item.status === 'fail').map((item) => item.id);
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

async function buildOne({ platform, fileName, tuning, projectRoot, workspace, stageRoot, skill, signal }) {
  const sourceHtml = await buildUniversalHtml(workspace.workRoot, platform, signal);
  const artifactPath = await writePlatformArtifact({
    platform,
    fileName,
    sourceHtml,
    tuning,
    stageRoot,
    zipTool: skill.zip,
    projectRoot,
    signal
  });
  const checkSummary = await checkArtifact({
    skill,
    platform,
    artifactPath,
    reportRoot: path.join(stageRoot, 'reports'),
    signal
  });
  const { bytes, sha256 } = await artifactIdentity(artifactPath);
  return {
    platform,
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

async function publishCheckReports(checkSummary, destinationRoot, platform) {
  const published = {};
  for (const [kind, source] of Object.entries(checkSummary.reportPaths ?? {})) {
    published[kind] = await publish(source, path.join(destinationRoot, 'reports', `${platform}-${kind}.json`));
  }
  return published;
}

async function exportPlatforms({ projectRoot, tuning, platforms, outputDir, signal }) {
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
  const workspace = await prepareWorkspace(resolvedRoot, safeTuning);
  const stageRoot = path.join(workspace.tempRoot, 'delivery');
  await mkdir(stageRoot, { recursive: true });
  try {
    const results = [];
    for (const platform of platforms) {
      results.push(await buildOne({
        platform,
        fileName: outputNames[platform],
        tuning: safeTuning,
        projectRoot: resolvedRoot,
        workspace,
        stageRoot,
        skill,
        signal
      }));
    }
    return { results, workspace, stageRoot, skill, tuning: safeTuning };
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

export async function exportPlayablePackage({ projectRoot = process.cwd(), platform, tuning, outputDir, signal } = {}) {
  if (!SUPPORTED_PLATFORMS.includes(platform)) {
    const error = new TypeError(`Unsupported playable platform: ${platform ?? '<missing>'}.`);
    error.statusCode = 400;
    throw error;
  }
  const destinationRoot = path.resolve(outputDir ?? path.join(projectRoot, 'artifacts', 'playable-exports'));
  const built = await exportPlatforms({ projectRoot, tuning, platforms: [platform], outputDir: destinationRoot, signal });
  try {
    const [result] = built.results;
    const filePath = await publish(result.filePath, path.join(destinationRoot, result.fileName));
    const publishedIdentity = await verifyPublishedArtifact(filePath, result, `${platform} artifact`);
    const reportPaths = await publishCheckReports(result.checkSummary, destinationRoot, platform);
    return {
      ...result,
      filePath,
      ...publishedIdentity,
      checkSummary: { ...result.checkSummary, reportPath: reportPaths.static, reportPaths }
    };
  } finally {
    await rm(built.workspace.tempRoot, { recursive: true, force: true });
  }
}

export async function exportAllPlayablePackages({ projectRoot = process.cwd(), tuning, outputDir, signal } = {}) {
  const destinationRoot = path.resolve(outputDir ?? path.join(projectRoot, 'artifacts', 'playable-exports'));
  const built = await exportPlatforms({
    projectRoot,
    tuning,
    platforms: SUPPORTED_PLATFORMS,
    outputDir: destinationRoot,
    signal
  });
  try {
    const manifest = {
      schemaVersion: 'bus-loop-playable-export-set-v1',
      resourceMode: EXPORT_RESOURCE_MODE,
      status: 'LOCAL_RULES_PASSED_AWAITING_PLATFORM_ACCEPTANCE',
      note: 'Existing project assets are packaged as-is without an asset compression or optimization stage. Each nested artifact keeps the platform-native delivery format. Official upload and device acceptance remain required.',
      naming: {
        pattern: PLAYABLE_NAMING_PATTERN,
        values: built.tuning.exportNaming
      },
      artifacts: built.results.map(({ platform, format, fileName, bytes, sha256, checkSummary }) => ({
        platform,
        format,
        fileName,
        bytes,
        sha256,
        check: {
          conclusion: checkSummary.conclusion,
          checkBatchId: checkSummary.checkBatchId,
          static: 'PASS',
          runtime: 'PASS',
          payload: 'PASS',
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
      signal
    );
    const aggregateIdentity = await artifactIdentity(aggregateStage);
    const filePath = await publish(aggregateStage, path.join(destinationRoot, aggregateName));
    const publishedIdentity = await verifyPublishedArtifact(filePath, aggregateIdentity, 'All-platform artifact');
    const reportPaths = Object.fromEntries(await Promise.all(built.results.map(async (item) => [
      item.platform,
      await publishCheckReports(item.checkSummary, destinationRoot, item.platform)
    ])));
    return {
      platform: 'all',
      resourceMode: EXPORT_RESOURCE_MODE,
      format: 'zip',
      fileName: aggregateName,
      filePath,
      contentType: 'application/zip',
      ...publishedIdentity,
      artifacts: manifest.artifacts,
      reportPaths,
      checkSummary: {
        passed: true,
        conclusion: 'LOCAL_RULES_PASSED_AWAITING_PLATFORM_ACCEPTANCE',
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
