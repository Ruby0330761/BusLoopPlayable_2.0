import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build as bundleWithEsbuild } from 'esbuild';
import { transformWithEsbuild } from 'vite';
import { SPEED_TOGGLE_SEED_SRC } from '../src/speed-toggle.js';
import { BASE_RUNTIME_ASSET_PATHS, GUIDE_HAND_ART } from '../src/mechanism-resources.js';
import {
  assetDeliveryReport, createAssetDelivery, playableAssetDataUri, selectSpatialTexture
} from './playable-asset-delivery.mjs';

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

async function listFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = await Promise.all(entries.map(async (entry) => {
    const fullPath = path.join(dir, entry.name);
    return entry.isDirectory() ? listFiles(fullPath) : fullPath;
  }));
  return files.flat();
}

function toDistUrl(filePath) {
  return `/${path.relative(DIST_DIR, filePath).replaceAll(path.sep, '/')}`;
}

const OMITTED_ASSET_DATA_URI = 'data:application/octet-stream;base64,AA==';
const FBX_TEXTURE_PIXEL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

export function auditEmbeddedAssets(html, approvedDataUris) {
  const allowed = new Set([OMITTED_ASSET_DATA_URI, FBX_TEXTURE_PIXEL, SPEED_TOGGLE_SEED_SRC, ...approvedDataUris]);
  const embedded = new Set();
  for (const [uri] of html.matchAll(/data:[\w.+/-]+;base64,[A-Za-z0-9+/]+=*/gu)) {
    if (!allowed.has(uri)) throw new Error(`导出包含清单外的内联素材（${uri.slice(5, uri.indexOf(';'))}）。`);
    if (embedded.has(uri) && uri.length - uri.indexOf(',') - 1 >= 4 * Math.ceil(4096 / 3)) {
      throw new Error('导出包含重复内联的大素材，请检查素材复用。');
    }
    embedded.add(uri);
  }
  return embedded;
}

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

async function createAssetMap(realAssetUrls, excludedUrls, delivery) {
  const files = await listFiles(path.join(DIST_DIR, 'assets'));
  const entries = [];
  const optimizations = new Map();
  for (const filePath of files) {
    const url = toDistUrl(filePath);
    if (excludedUrls.has(url)) continue;
    let uri = url === GUIDE_HAND_ART ? SPEED_TOGGLE_SEED_SRC : OMITTED_ASSET_DATA_URI;
    if (realAssetUrls.has(url)) {
      const selected = await delivery.select(url, await readFile(filePath));
      uri = playableAssetDataUri(selected);
      optimizations.set(url, assetDeliveryReport(url, selected));
    }
    entries.push([url, uri]);
  }
  return { assetMap: new Map(entries.sort((a, b) => b[0].length - a[0].length)), optimizations };
}

export function replaceAssetUrls(content, assetMap) {
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
  '/assets/unity/christmas',
  // Progress HUD markers are addressed the same way (`${assetBase}bus.png`), so
  // the single-file packager has to rewrite that root too or the packaged ad
  // ships three broken <img> elements.
  '/assets/applovin/progress'
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
  if (!dataUri || dataUri === SPEED_TOGGLE_SEED_SRC || dataUri === OMITTED_ASSET_DATA_URI) return js;

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
  const dataUris = [...new Set(assetMap.values())].filter((value) => value.length >= 256);
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

export async function inlineModule(html, js, jsPath, assetMap, platform = PLAYABLE_PLATFORM) {
  if (!OFFLINE_REQUEST_PLATFORMS.has(platform)) {
    throw new Error(`Unsupported offline playable platform: ${platform}`);
  }
  const options = {
    define: { fetch: '__playableDataRequest', 'import.meta.env.DEV': 'false' },
    format: 'esm',
    minify: true,
    target: 'es2020'
  };
  let code;
  if (process.env.PLAYABLE_EXPORT_SHARED_CORE === '1') {
    const bridgePath = platform === 'applovin'
      ? path.join(ROOT, 'src', 'platform-bridge.js')
      : path.join(ROOT, 'src', 'platform-bridges', `${platform}.js`);
    const result = await bundleWithEsbuild({
      ...options,
      stdin: { contents: js, sourcefile: 'playable-runtime.js', resolveDir: ROOT },
      bundle: true,
      write: false,
      logLevel: 'silent',
      plugins: [{
        name: 'playable-export-platform-bridge',
        setup(build) {
          build.onResolve({ filter: /^__playable_export_platform_bridge__$/ }, () => ({ path: bridgePath }));
        }
      }]
    });
    code = result.outputFiles[0].text;
  } else {
    code = (await transformWithEsbuild(js, 'playable-runtime.js', options)).code;
  }
  const dedupedJs = dedupeEmbeddedAssetLiterals(code, assetMap);
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
    SPEED_TOGGLE_ASSET_PATHS,
    getMechanismTypesForLevels
  }, { collectAssetUrls, collectPlayableInlineAssetUrls, getReachableStageArt }] = await Promise.all([
    import('../src/generated-active-level.js'),
    import('../src/scene-tuning.js'),
    import('../src/mechanism-resources.js'),
    import('../src/playable-inline-assets.js')
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
  // Every layout a reachable stage can select, so a stitched session that
  // switches tracks still ships the art for each one it can show.
  const stageArt = getReachableStageArt(SCENE_TUNING, PLAYABLE_STAGES, PLAYABLE_STAGE_CHOICES);
  const mechanismTypes = getMechanismTypesForLevels(PLAYABLE_ALL_LEVELS, {
    spatialSelection,
    entryBannerEnabled: stageArt.entryBanners.length > 0
  });
  // The inline set is shared with the editor's preflight (src/playable-inline-
  // assets.js) so the size it shows is the size this build produces. Only the
  // HTML/CSS-derived URLs are packager-only: they are read from the built
  // bundle, which the editor cannot see.
  const realAssetUrls = collectPlayableInlineAssetUrls({
    tuning: SCENE_TUNING,
    levels: PLAYABLE_ALL_LEVELS,
    activeSession: ACTIVE_PLAYABLE_SESSION,
    spatialSelection,
    ...stageArt
  });
  const runtimeCss = stripEditorCss(packagedCssSource);
  const shellReferences = collectAssetUrls([html, runtimeCss]);
  const optionalShellArt = new Set([...BASE_RUNTIME_ASSET_PATHS, ...SPEED_TOGGLE_ASSET_PATHS]);
  for (const url of shellReferences) {
    if (url !== jsPath && url !== cssPath && !realAssetUrls.has(url) && !optionalShellArt.has(url)) {
      throw new Error(`导出模板引用了清单外素材：${url}`);
    }
  }

  const delivery = await createAssetDelivery(ROOT, {
    mobileBackgrounds: process.env.PLAYABLE_MOBILE_BACKGROUNDS === '1',
    backgroundUrls: stageArt.backgrounds
  });
  const { assetMap, optimizations } = await createAssetMap(realAssetUrls, new Set([jsPath, cssPath]), delivery);
  const availableUrls = new Set(assetMap.keys());
  for (const assetUrl of realAssetUrls) {
    if (!availableUrls.has(assetUrl)) throw new Error(`Required production asset is missing: ${assetUrl}`);
  }
  const { ACTIVE_SPATIAL_CONVEYOR_PACKAGE } = await import('../src/generated-active-spatial-conveyor.js');
  const material = ACTIVE_SPATIAL_CONVEYOR_PACKAGE?.visual?.material;
  const spatialReplacements = new Map();
  const spatialAssets = new Map();
  for (const slot of ['loopTextureDataUrl', 'exitTextureDataUrl']) {
    const source = material?.[slot];
    if (!source) continue;
    const url = `spatial:${ACTIVE_SPATIAL_CONVEYOR_PACKAGE.id}/${slot}`;
    const selected = await selectSpatialTexture(delivery, url, source);
    const uri = selected?.optimized ? playableAssetDataUri(selected) : source;
    spatialAssets.set(url, uri);
    if (selected) optimizations.set(url, assetDeliveryReport(url, selected));
    if (uri !== source) spatialReplacements.set(source, uri);
  }
  const withSpatialTextures = replaceAssetUrls(jsSource, spatialReplacements);
  const jsWithAssets = replaceAssetUrls(replaceBundledDynamicAssetUrls(withSpatialTextures, assetMap), assetMap);
  // These images are already inlined in the document; re-embedding the same
  // base64 blob in the tuning literal doubles the package size. The loader
  // selects the branding icon at runtime and has no embedded image of its own.
  // `stage-choice-hand` is the same sprite as the 3D guide hand's texture, so its
  // data URI would otherwise appear twice (once in the document, once in the
  // runtime constant) and the payload scan rejects the package.
  const js = ['branding-icon', 'branding-logo', 'stage-choice-hand']
    .reduce((source, elementId) => reuseDocumentImageAsset(html, source, assetMap, elementId), jsWithAssets);
  const css = replaceAssetUrls(runtimeCss, assetMap);

  let output = inlineCss(html, css, cssPath);
  const rects = [...optimizations.values()].filter(asset => asset.backgroundRect)
    .map(asset => [assetMap.get(asset.url), asset.backgroundRect]);
  const backgroundSetup = rects.length ? `globalThis.__playableBackgroundRects=new Map(${JSON.stringify(rects)});\n` : '';
  output = await inlineModule(output, backgroundSetup + js, jsPath, new Map([...assetMap, ...spatialAssets]));
  output = replaceAssetUrls(output, assetMap);

  const embedded = auditEmbeddedAssets(output, [
    ...Array.from(realAssetUrls, url => assetMap.get(url)),
    ...spatialAssets.values()
  ]);

  await mkdir(OUTPUT_DIR, { recursive: true });
  await writeFile(OUTPUT_FILE, normalizeLineEndings(output), 'utf8');

  const { size } = await stat(OUTPUT_FILE);
  const sizeMiB = size / (1024 * 1024);
  // The exporter enforces the platform size budget and, once a package is over
  // it, has to name the upload that caused it. Base64 inflates every payload by
  // a third, so this sidecar records the cost each inlined asset adds to the
  // final file, largest first.
  await writeFile(`${OUTPUT_FILE}.payload.json`, `${JSON.stringify({
    platform: PLAYABLE_PLATFORM,
    bytes: size,
    optimization: delivery.identity,
    assets: [...optimizations.values()]
      .filter(({ url }) => embedded.has(assetMap.get(url) ?? spatialAssets.get(url)))
      .sort((first, second) => second.bytes - first.bytes)
  }, null, 2)}\n`, 'utf8');
  console.log(`Mechanism whitelist: ${mechanismTypes.join(', ')}.`);
  console.log(`Inlined assets: ${realAssetUrls.size}; omitted assets replaced: ${availableUrls.size - realAssetUrls.size}.`);
  console.log(`Wrote ${path.relative(ROOT, OUTPUT_FILE)} (${size} bytes, ${sizeMiB.toFixed(3)} MiB).`);
}

if (path.resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
