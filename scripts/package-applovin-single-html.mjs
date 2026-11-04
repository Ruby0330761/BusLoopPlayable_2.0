import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { transformWithEsbuild } from 'vite';

const ROOT = process.cwd();
const DIST_DIR = path.resolve(process.env.PLAYABLE_DIST_DIR || path.join(ROOT, 'dist'));
const OUTPUT_FILE = path.resolve(
  process.env.PLAYABLE_INLINE_OUTPUT_FILE || path.join(ROOT, 'artifacts', 'applovin', 'index.html')
);
const OUTPUT_DIR = path.dirname(OUTPUT_FILE);
const PLAYABLE_PLATFORM = process.env.PLAYABLE_PLATFORM || 'applovin';
const OFFLINE_REQUEST_PLATFORMS = new Set([
  'applovin',
  'google-ads',
  'meta',
  'unityads',
  'mintegral',
  'moloco',
  'tiktok'
]);
const DATA_URL_ONLY_REQUEST_SCRIPT = `;function __playableDataRequest(input) {
  function getRequestUrl(input) {
    if (typeof input === 'string') return input;
    if (input && typeof input.url === 'string') return input.url;
    try {
      return String(input);
    } catch (error) {
      return '';
    }
  }
  function decodeDataUrl(url) {
    var commaIndex = url.indexOf(',');
    if (commaIndex < 0) return null;
    var metadata = url.slice(5, commaIndex);
    var body = url.slice(commaIndex + 1);
    var parts = metadata.split(';');
    var contentType = parts[0] || 'text/plain;charset=US-ASCII';
    var isBase64 = parts.some(function(part) { return part.toLowerCase() === 'base64'; });
    var binary = isBase64 ? atob(body) : decodeURIComponent(body);
    var bytes = new Uint8Array(binary.length);
    for (var index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index) & 255;
    return new Response(bytes, {
      status: 200,
      statusText: 'OK',
      headers: { 'Content-Type': contentType }
    });
  }
  var url = getRequestUrl(input);
  if (url.slice(0, 5).toLowerCase() === 'data:') return Promise.resolve(decodeDataUrl(url));
  return Promise.reject(new TypeError('Only embedded data: assets are available in this playable.'));
}\n`;

const MIME_TYPES = new Map([
  ['.bin', 'application/octet-stream'],
  ['.css', 'text/css'],
  ['.fbx', 'application/octet-stream'],
  ['.html', 'text/html'],
  ['.jpeg', 'image/jpeg'],
  ['.jpg', 'image/jpeg'],
  ['.js', 'text/javascript'],
  ['.mp3', 'audio/mpeg'],
  ['.mp4', 'video/mp4'],
  ['.wav', 'audio/wav'],
  ['.png', 'image/png'],
  ['.rgba16f', 'application/octet-stream'],
  ['.ttf', 'font/ttf'],
  ['.webp', 'image/webp']
]);

async function listFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = await Promise.all(entries.map(async (entry) => {
    const fullPath = path.join(dir, entry.name);
    return entry.isDirectory() ? listFiles(fullPath) : fullPath;
  }));
  return files.flat();
}

function mimeFor(filePath) {
  return MIME_TYPES.get(path.extname(filePath).toLowerCase()) ?? 'application/octet-stream';
}

function toDistUrl(filePath) {
  return `/${path.relative(DIST_DIR, filePath).replaceAll(path.sep, '/')}`;
}

const OMITTED_ASSET_DATA_URI = 'data:application/octet-stream;base64,AA==';

function collectAssetUrls(value, output = new Set()) {
  if (typeof value === 'string') {
    for (const match of value.matchAll(/\/assets\/[^\s"'`<>)]*/gu)) {
      output.add(match[0].replace(/[),.;]+$/u, ''));
    }
    return output;
  }
  if (Array.isArray(value)) {
    value.forEach((entry) => collectAssetUrls(entry, output));
    return output;
  }
  if (value && typeof value === 'object') {
    Object.values(value).forEach((entry) => collectAssetUrls(entry, output));
  }
  return output;
}

async function createAssetMap(realAssetUrls, excludedUrls = new Set()) {
  const files = await listFiles(path.join(DIST_DIR, 'assets'));
  const entries = await Promise.all(files.map(async (filePath) => {
    const url = toDistUrl(filePath);
    if (excludedUrls.has(url)) return null;
    const bytes = realAssetUrls.has(url) ? await readFile(filePath) : null;
    return [
      url,
      bytes
        ? `data:${mimeFor(filePath)};base64,${bytes.toString('base64')}`
        : OMITTED_ASSET_DATA_URI
    ];
  }));
  return new Map(entries.filter(Boolean).sort((a, b) => b[0].length - a[0].length));
}

function replaceAssetUrls(content, assetMap) {
  let next = content;
  for (const [url, dataUri] of assetMap) {
    next = next.split(url).join(dataUri);
  }
  return next;
}

// Mechanism art is addressed through a root constant plus a template literal
// (`${ROOT}/models/Sled_001.fbx`), so the literal full path never appears in the
// bundle and the plain URL replacement above cannot see it. Rewrite those
// template-literal tails instead. Every mechanism root the resource manifest can
// emit has to be listed here: the Christmas set lives under
// /assets/unity/christmas rather than /assets/unity/mechanisms, and leaving its
// root out shipped a sled whose passenger atlas still pointed at a
// root-relative URL that does not exist inside a single-file ad.
const DYNAMIC_MECHANISM_ROOTS = Object.freeze([
  '/assets/unity/mechanisms',
  '/assets/unity/christmas'
]);

function replaceBundledDynamicAssetUrls(content, assetMap) {
  let next = content;
  const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
  for (const root of DYNAMIC_MECHANISM_ROOTS) {
    for (const [url, dataUri] of assetMap) {
      if (!url.startsWith(`${root}/`)) continue;
      const tail = url.slice(root.length);
      const pattern = new RegExp(`\\$\\{[A-Za-z_$][\\w$]*\\}${escapeRegex(tail)}`, 'gu');
      next = next.replace(pattern, () => dataUri);
    }
  }
  for (const root of DYNAMIC_MECHANISM_ROOTS) next = next.replaceAll(`"${root}"`, '""');
  return next;
}

function reuseDocumentImageAsset(html, js, assetMap, elementId) {
  const escapedId = elementId.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
  const imageTag = html.match(new RegExp(`<img\\b(?=[^>]*\\bid=["']${escapedId}["'])[^>]*>`, 'iu'))?.[0];
  const sourceUrl = imageTag?.match(/\bsrc=["']([^"']+)["']/iu)?.[1];
  const dataUri = sourceUrl ? assetMap.get(sourceUrl) : null;
  if (!dataUri) return js;

  const expression = `document.getElementById(${JSON.stringify(elementId)}).src`;
  const literals = [JSON.stringify(dataUri), `'${dataUri}'`];
  let output = js;
  for (const literal of literals) output = output.split(literal).join(expression);
  return output;
}

function normalizeLineEndings(content) {
  return content.replace(/\r\n?/gu, '\n');
}

function dedupeEmbeddedAssetLiterals(source, assetMap) {
  let next = source;
  const declarations = [];
  const dataUris = [...new Set(assetMap.values())].filter((value) => value.length >= 4096);
  for (const dataUri of dataUris) {
    const literal = JSON.stringify(dataUri);
    const occurrences = next.split(literal).length - 1;
    if (occurrences < 2) continue;
    const name = `__playableEmbeddedAsset${declarations.length}`;
    next = next.split(literal).join(name);
    declarations.push(`var ${name}=${literal};`);
  }
  return `${declarations.join('')}\n${next}`;
}

function stripEditorCss(css) {
  const start = css.indexOf('.scene-editor{');
  const end = start >= 0 ? css.indexOf('#app.is-phone-preview', start) : -1;
  const withoutEditorBlock = start >= 0 && end > start
    ? `${css.slice(0, start)}${css.slice(end)}`
    : css;
  return withoutEditorBlock.replace(/#app\.is-phone-preview \.scene-editor\{[^}]*\}/gu, '');
}

function stripBundledFontFaces(css) {
  return css.replace(/@font-face\s*\{[^{}]*\}/giu, (rule) => (
    /(?:Poppins Branding|Poppins-Bold\.ttf)/iu.test(rule) ? '' : rule
  ));
}

function inlineCss(html, css, cssPath) {
  const escapedPath = cssPath.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
  const pattern = new RegExp(`\\s*<link\\b(?=[^>]*href="${escapedPath}")[^>]*>\\s*`, 'u');
  if (!pattern.test(html)) throw new Error(`Unable to inline stylesheet ${cssPath}.`);
  return html.replace(pattern, () => `\n    <style>\n${css}\n    </style>\n`);
}

async function inlineModule(html, js, jsPath, assetMap) {
  if (!OFFLINE_REQUEST_PLATFORMS.has(PLAYABLE_PLATFORM)) {
    throw new Error(`Unsupported offline playable platform: ${PLAYABLE_PLATFORM}`);
  }
  const transformed = await transformWithEsbuild(js, 'playable-runtime.js', {
    define: { fetch: '__playableDataRequest' },
    format: 'esm',
    minify: true,
    target: 'es2020'
  });
  const dedupedJs = dedupeEmbeddedAssetLiterals(transformed.code, assetMap);
  const safeJs = `${DATA_URL_ONLY_REQUEST_SCRIPT}${dedupedJs}`.replaceAll('</script', '<\\/script');
  const escapedPath = jsPath.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
  const pattern = new RegExp(`\\s*<script\\b(?=[^>]*src="${escapedPath}")[^>]*><\\/script>\\s*`, 'u');
  if (!pattern.test(html)) throw new Error(`Unable to inline module ${jsPath}.`);
  const withoutEntryScript = html.replace(pattern, '\n');
  return withoutEntryScript.replace('</head>', () => `    <script type="module">\n${safeJs}\n    </script>\n  </head>`);
}

function stripEditorMount(html) {
  return html.replace(/\s*<aside\b(?=[^>]*\bid="scene-editor")[^>]*><\/aside>\s*/u, '\n');
}

async function main() {
  const [{ PLAYABLE_STAGES, PLAYABLE_STAGE_CHOICES, PLAYABLE_ALL_LEVELS, ACTIVE_PLAYABLE_SESSION }, { SCENE_TUNING }, {
    BASE_RUNTIME_ASSET_PATHS,
    PRE_ROLL_ASSET_PATHS,
    getMechanismResourcePaths,
    getMechanismTypesForLevels
  }, { isPreRollAssetPath, resolvePreRollAsset }, { LEVEL_AUDIO_CONFIG }] = await Promise.all([
    import('../src/generated-active-level.js'),
    import('../src/scene-tuning.js'),
    import('../src/mechanism-resources.js'),
    import('../src/pre-roll.js'),
    import('../src/level-audio-config.js')
  ]);
  const htmlPath = path.join(DIST_DIR, 'index.html');
  const html = stripEditorMount(await readFile(htmlPath, 'utf8'));
  const jsPath = html.match(/src="(\/assets\/[^"]+\.js)"/u)?.[1];
  const cssPath = html.match(/href="(\/assets\/[^"]+\.css)"/u)?.[1];

  if (!jsPath) throw new Error('Unable to find built module script in dist/index.html.');
  if (!cssPath) throw new Error('Unable to find built stylesheet in dist/index.html.');

  const [jsSource, cssSource] = await Promise.all([
    readFile(path.join(DIST_DIR, jsPath), 'utf8'),
    readFile(path.join(DIST_DIR, cssPath), 'utf8')
  ]);
  const packagedCssSource = stripBundledFontFaces(cssSource);
  const spatialSelection = SCENE_TUNING.conveyorLayout?.selected;
  const choiceOptions = PLAYABLE_STAGE_CHOICES.flatMap((choice) => choice?.options ?? []);
  // Mechanism art follows the whole reachable level set, not just the fixed
  // order: a picked map can be the only stage that uses a special vehicle.
  //
  // The banner is requested by a *stage*, not by the global toggle, and the two
  // session shapes carry their stages in different arrays: a fixed sequence
  // (Q22's simple -> hard pair) in PLAYABLE_STAGES, and a map picker (Q23) in
  // PLAYABLE_STAGE_CHOICES. Missing either one ships the six banner sprites as
  // 1-byte octet-stream placeholders, and the banner degrades to a line of text.
  const stageBannerEnabled = PLAYABLE_STAGES.some((stage) => stage?.opening?.entryBanner?.enabled);
  const choiceBannerEnabled = PLAYABLE_STAGE_CHOICES.some((choice) => (
    choice?.options?.some((option) => option.opening?.entryBanner?.enabled)
  ));
  const mechanismTypes = getMechanismTypesForLevels(PLAYABLE_ALL_LEVELS, {
    spatialSelection,
    entryBannerEnabled: Boolean(
      SCENE_TUNING.entryBanner?.enabled || stageBannerEnabled || choiceBannerEnabled
    )
  });
  const realAssetUrls = new Set(BASE_RUNTIME_ASSET_PATHS);
  // A session can disable the pre-roll, and the runtime applies that by zeroing
  // the tuning flag. Reading the raw `SCENE_TUNING.preRoll.enabled` here inlined
  // a 519 KB MP4 the runtime never played, so the session has to be consulted
  // in the same place the runtime consults it.
  const selectedPreRollAsset = resolvePreRollAsset(SCENE_TUNING.preRoll, ACTIVE_PLAYABLE_SESSION);
  if (selectedPreRollAsset && (
    PRE_ROLL_ASSET_PATHS.includes(selectedPreRollAsset)
    || isPreRollAssetPath(selectedPreRollAsset)
  )) {
    realAssetUrls.add(selectedPreRollAsset);
  }
  for (const level of PLAYABLE_ALL_LEVELS) collectAssetUrls(level, realAssetUrls);
  // The BGM is addressed from tuning, not from a level document, so the plain
  // URL collection above never sees it. Missing it ships a silently dead loop:
  // the runtime requests a root-relative path that does not exist in the
  // single-file ad and only logs a warning.
  if (Number(SCENE_TUNING.audio?.bgm?.enabled) && SCENE_TUNING.audio?.bgm?.asset) {
    realAssetUrls.add(SCENE_TUNING.audio.bgm.asset);
  }
  // The picker art is not part of a level document, so it needs its own pass.
  for (const option of choiceOptions) realAssetUrls.add(option.image);
  collectAssetUrls(html, realAssetUrls);
  collectAssetUrls(packagedCssSource, realAssetUrls);
  collectAssetUrls({
    background: SCENE_TUNING.background?.asset,
    icon: SCENE_TUNING.branding?.icon?.asset,
    // One Bus build serves both stores and swaps its icon from the device UA, so
    // every per-device icon has to be inlined. Taking only `icon.asset` shipped
    // the iOS half with a root-relative image URL that resolves to nothing
    // inside a single-file ad.
    iconDeviceAssets: Object.values(SCENE_TUNING.branding?.icon?.deviceAssets ?? {}),
    logo: SCENE_TUNING.branding?.logo?.asset
  }, realAssetUrls);
  for (const assetUrl of getMechanismResourcePaths(mechanismTypes)) realAssetUrls.add(assetUrl);
  // The runtime completes a level's sound list from the canonical table, so a
  // clip a level document does not name can still be requested at playback.
  // Inlining only what the documents list would leave that fallback pointing at
  // a root-relative URL that does not exist inside a single-file ad.
  for (const entry of Object.values(LEVEL_AUDIO_CONFIG)) {
    for (const clip of entry.clips) realAssetUrls.add(clip);
  }
  realAssetUrls.delete(jsPath);
  realAssetUrls.delete(cssPath);

  const assetMap = await createAssetMap(realAssetUrls, new Set([jsPath, cssPath]));
  const availableUrls = new Set(assetMap.keys());
  for (const assetUrl of realAssetUrls) {
    if (!availableUrls.has(assetUrl)) throw new Error(`Required production asset is missing: ${assetUrl}`);
  }
  const jsWithAssets = replaceAssetUrls(replaceBundledDynamicAssetUrls(jsSource, assetMap), assetMap);
  // These images are already inlined in the document; re-embedding the same
  // base64 blob in the tuning literal doubles the package size. The loading
  // icon is compared against the element's own src at runtime, so reading it
  // back from the document keeps that comparison equal.
  // `stage-choice-hand` is the same sprite as the 3D guide hand's texture, so its
  // data URI would otherwise appear twice (once in the document, once in the
  // runtime constant) and the payload scan rejects the package.
  const js = ['branding-icon', 'branding-logo', 'loading-icon', 'stage-choice-hand']
    .reduce((source, elementId) => reuseDocumentImageAsset(html, source, assetMap, elementId), jsWithAssets);
  const css = stripEditorCss(replaceAssetUrls(packagedCssSource, assetMap));

  let output = inlineCss(html, css, cssPath);
  output = await inlineModule(output, js, jsPath, assetMap);
  output = replaceAssetUrls(output, assetMap);

  await mkdir(OUTPUT_DIR, { recursive: true });
  await writeFile(OUTPUT_FILE, normalizeLineEndings(output), 'utf8');

  const { size } = await stat(OUTPUT_FILE);
  const sizeMiB = size / (1024 * 1024);
  console.log(`Mechanism whitelist: ${mechanismTypes.join(', ')}.`);
  console.log(`Inlined assets: ${realAssetUrls.size}; omitted assets replaced: ${availableUrls.size - realAssetUrls.size}.`);
  console.log(`Wrote ${path.relative(ROOT, OUTPUT_FILE)} (${size} bytes, ${sizeMiB.toFixed(3)} MiB).`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
