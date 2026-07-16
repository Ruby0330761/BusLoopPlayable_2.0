import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

const ROOT = process.cwd();
const DIST_DIR = path.join(ROOT, 'dist');
const OUTPUT_DIR = path.join(ROOT, 'artifacts', 'applovin');
const OUTPUT_FILE = path.join(OUTPUT_DIR, 'index.html');
const DATA_URL_FETCH_COMPAT_SCRIPT = `;(function installDataUrlFetchCompat(){
  if (typeof globalThis.fetch !== 'function' || typeof globalThis.Response !== 'function') return;
  var originalFetch = globalThis.fetch.bind(globalThis);
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
  globalThis.fetch = function dataUrlFetchCompat(input, init) {
    var url = getRequestUrl(input);
    if (url.slice(0, 5).toLowerCase() === 'data:') {
      var response = decodeDataUrl(url);
      if (response) return Promise.resolve(response);
    }
    return originalFetch(input, init);
  };
}());\n`;

const MIME_TYPES = new Map([
  ['.bin', 'application/octet-stream'],
  ['.css', 'text/css'],
  ['.fbx', 'application/octet-stream'],
  ['.html', 'text/html'],
  ['.jpeg', 'image/jpeg'],
  ['.jpg', 'image/jpeg'],
  ['.js', 'text/javascript'],
  ['.mp3', 'audio/mpeg'],
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

async function createAssetMap(excludedUrls = new Set()) {
  const files = await listFiles(path.join(DIST_DIR, 'assets'));
  const entries = await Promise.all(files.map(async (filePath) => {
    const url = toDistUrl(filePath);
    if (excludedUrls.has(url)) return null;
    const bytes = await readFile(filePath);
    return [
      url,
      `data:${mimeFor(filePath)};base64,${bytes.toString('base64')}`
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

function stripEditorCss(css) {
  const start = css.indexOf('.scene-editor{');
  const end = start >= 0 ? css.indexOf('#app.is-phone-preview', start) : -1;
  const withoutEditorBlock = start >= 0 && end > start
    ? `${css.slice(0, start)}${css.slice(end)}`
    : css;
  return withoutEditorBlock.replace(/#app\.is-phone-preview \.scene-editor\{[^}]*\}/gu, '');
}

function inlineCss(html, css, cssPath) {
  const escapedPath = cssPath.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
  const pattern = new RegExp(`\\s*<link\\b(?=[^>]*href="${escapedPath}")[^>]*>\\s*`, 'u');
  if (!pattern.test(html)) throw new Error(`Unable to inline stylesheet ${cssPath}.`);
  return html.replace(pattern, () => `\n    <style>\n${css}\n    </style>\n`);
}

function inlineModule(html, js, jsPath) {
  const safeJs = `${DATA_URL_FETCH_COMPAT_SCRIPT}${js}`.replaceAll('</script', '<\\/script');
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
  const htmlPath = path.join(DIST_DIR, 'index.html');
  const html = stripEditorMount(await readFile(htmlPath, 'utf8'));
  const jsPath = html.match(/src="(\/assets\/[^"]+\.js)"/u)?.[1];
  const cssPath = html.match(/href="(\/assets\/[^"]+\.css)"/u)?.[1];

  if (!jsPath) throw new Error('Unable to find built module script in dist/index.html.');
  if (!cssPath) throw new Error('Unable to find built stylesheet in dist/index.html.');

  const assetMap = await createAssetMap(new Set([jsPath, cssPath]));
  const js = replaceAssetUrls(await readFile(path.join(DIST_DIR, jsPath), 'utf8'), assetMap);
  const css = stripEditorCss(replaceAssetUrls(await readFile(path.join(DIST_DIR, cssPath), 'utf8'), assetMap));

  let output = inlineCss(html, css, cssPath);
  output = inlineModule(output, js, jsPath);
  output = replaceAssetUrls(output, assetMap);

  await mkdir(OUTPUT_DIR, { recursive: true });
  await writeFile(OUTPUT_FILE, output, 'utf8');

  const { size } = await stat(OUTPUT_FILE);
  const sizeMiB = size / (1024 * 1024);
  console.log(`Wrote ${path.relative(ROOT, OUTPUT_FILE)} (${size} bytes, ${sizeMiB.toFixed(3)} MiB).`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
