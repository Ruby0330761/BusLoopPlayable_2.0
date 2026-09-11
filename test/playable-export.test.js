import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import {
  buildPlayableArtifactName,
  EXPORT_RESOURCE_MODE,
  PLAYABLE_NAMING_PATTERN,
  SUPPORTED_PLATFORMS,
  prepareMolocoHtml,
  splitSingleHtml,
  validateExportNamingPart,
  validateTuning
} from '../scripts/export-playable-package.mjs';
import { BASE_RUNTIME_ASSET_PATHS } from '../src/mechanism-resources.js';
import { isValidStoreLink, resolveStoreLink } from '../src/store-links.js';

const STORE_LINKS = Object.freeze({
  android: 'https://play.google.com/store/apps/details?id=gridplus.busjam.carpuzzle',
  ios: 'https://apps.apple.com/us/app/bus-fever-party/id6746743297'
});

const EXPORT_NAMING = Object.freeze({
  requirementCode: 'AC-2607141',
  materialCode: 'Q1V1',
  iterationCode: 'N',
  language: 'EN',
  format: 'PL',
  designer: 'NLY',
  requester: 'ZZN',
  channels: Object.freeze({
    applovin: 'AL',
    'google-ads': 'GG',
    meta: 'FB',
    mintegral: 'MT',
    moloco: 'MO',
    tiktok: 'TT',
    unityads: 'UN'
  }),
  steps: '5moves',
  stamina: '5hp'
});

test('export is package-only and does not opt into resource optimization', () => {
  assert.equal(EXPORT_RESOURCE_MODE, 'package-only');
});

test('exporter exposes every supported delivery platform', () => {
  assert.deepEqual(SUPPORTED_PLATFORMS, [
    'applovin',
    'google-ads',
    'meta',
    'unityads',
    'mintegral',
    'moloco',
    'tiktok'
  ]);
});

test('artifact names follow the playable request naming rule for every platform', () => {
  assert.equal(
    PLAYABLE_NAMING_PATTERN,
    'requirement-material-iteration-language-format-designer-requester-channel-steps-stamina'
  );
  const extensions = {
    applovin: 'html',
    'google-ads': 'zip',
    meta: 'zip',
    unityads: 'html',
    mintegral: 'zip',
    moloco: 'html',
    tiktok: 'zip'
  };
  for (const platform of SUPPORTED_PLATFORMS) {
    const businessBaseName = `AC-2607141-Q1V1-N-EN-PL-NLY-ZZN-${EXPORT_NAMING.channels[platform]}-5moves-5hp`;
    const baseName = platform === 'mintegral' ? businessBaseName.replaceAll('-', '_') : businessBaseName;
    assert.equal(
      buildPlayableArtifactName({ exportNaming: EXPORT_NAMING }, platform),
      `${baseName}.${extensions[platform]}`
    );
  }
});

test('artifact naming rejects unsafe paths and Google Ads names over 50 characters', () => {
  assert.equal(validateExportNamingPart('  Q1V1  '), 'Q1V1');
  for (const value of ['', '../Q1', 'Q1/V1', 'Q1\\V1', 'Q1..V1', 'Q1 V1', '\u4e2d\u6587']) {
    assert.throws(() => validateExportNamingPart(value), TypeError, value);
  }
  assert.throws(
    () => buildPlayableArtifactName({
      exportNaming: { ...EXPORT_NAMING, requirementCode: 'A'.repeat(20) }
    }, 'google-ads'),
    /must not exceed 50 characters/
  );
});

test('tuning validation accepts known finite values without mutating input', () => {
  const template = { preview: { width: 1080, enabled: true }, title: 'Bus', colors: [1, 2] };
  const input = { preview: { width: 720, enabled: false }, title: 'Loop', colors: [3, 4] };
  const output = validateTuning(input, template);
  assert.deepEqual(output, input);
  assert.notEqual(output, input);
  assert.notEqual(output.preview, input.preview);
});

test('tuning validation blocks unknown and prototype keys', () => {
  const template = { preview: { width: 1080 } };
  assert.throws(() => validateTuning({ unexpected: 1 }, template), /not supported/);
  const polluted = JSON.parse('{"__proto__":{"admin":true}}');
  assert.throws(() => validateTuning(polluted, template), /not supported/);
  assert.equal({}.admin, undefined);
});

test('store links accept only platform product URLs and export validation normalizes them', () => {
  assert.equal(isValidStoreLink('android', STORE_LINKS.android), true);
  assert.equal(isValidStoreLink('ios', STORE_LINKS.ios), true);
  assert.equal(isValidStoreLink('android', 'https://example.com/store/apps/details?id=fake'), false);
  assert.equal(isValidStoreLink('android', 'https://play.google.com:444/store/apps/details?id=fake'), false);
  assert.equal(isValidStoreLink('ios', 'http://apps.apple.com/us/app/demo/id123'), false);
  assert.equal(resolveStoreLink('ios', 'invalid', STORE_LINKS.ios), STORE_LINKS.ios);

  const template = { storeLinks: STORE_LINKS };
  assert.deepEqual(validateTuning({
    storeLinks: {
      android: `  ${STORE_LINKS.android}  `,
      ios: STORE_LINKS.ios
    }
  }, template), { storeLinks: STORE_LINKS });
  assert.throws(
    () => validateTuning({ storeLinks: { ...STORE_LINKS, android: 'https://example.com/app' } }, template),
    /valid HTTPS Google Play product URL/
  );
});

test('single HTML can be split into a classic packaged entry', () => {
  const result = splitSingleHtml('<html><head><style>body{color:red}</style><script type="module">start()</script></head><body></body></html>');
  assert.match(result.html, /href="style\.css"/);
  assert.match(result.html, /<script defer src="index\.js"><\/script>/);
  assert.equal(result.css, 'body{color:red}');
  assert.equal(result.js, 'start()');
  assert.doesNotMatch(result.html, /type="module"/);
});

test('Google Ads packaging captures a real playable backup instead of duplicating a source asset', async () => {
  const exporter = await readFile(new URL('../scripts/export-playable-package.mjs', import.meta.url), 'utf8');
  assert.match(exporter, /platform === 'google-ads'[\s\S]*capturePlayableBackupImage\(\{/);
  assert.doesNotMatch(exporter, /copyFile\([^\n]*backup\.jpg/);
});

test('UnityAds single-line packaging preserves GLSL line breaks before flattening HTML', async () => {
  const exporter = await readFile(new URL('../scripts/export-playable-package.mjs', import.meta.url), 'utf8');
  assert.match(exporter, /transformWithEsbuild/);
  assert.match(exporter, /supported\s*:\s*\{\s*['"]template-literal['"]\s*:\s*false\s*\}/);
  assert.match(exporter, /platform === 'unityads'[\s\S]*transformWithEsbuild[\s\S]*replace\(\/\\r\\n\?\|\\n\/g/);
  assert.match(exporter, /replace\(inlineModule\[2\], \(\) => transformed\.code\.trimEnd\(\)\)/);
  assert.match(exporter, /encodeUnityStaticFalsePositives[\s\S]*texelF\\\\u0065tch/);
});

test('Moloco packaging replaces runtime requests with a data-only loader', async () => {
  const [exporter, inliner] = await Promise.all([
    readFile(new URL('../scripts/export-playable-package.mjs', import.meta.url), 'utf8'),
    readFile(new URL('../scripts/package-applovin-single-html.mjs', import.meta.url), 'utf8')
  ]);
  assert.match(inliner, /__playableDataRequest/);
  assert.match(inliner, /PLAYABLE_PLATFORM[\s\S]*moloco/);
  assert.match(inliner, /url\.slice\(0, 5\)\.toLowerCase\(\) === 'data:'/);
  assert.match(exporter, /platform === 'moloco'[\s\S]*prepareMolocoHtml\(html\)/);
  assert.doesNotMatch(exporter, /platform === 'moloco'[\s\S]*f\\u0065tch/);
});

test('Moloco checker compatibility preserves decoded GLSL and removes only known non-network markers', () => {
  const source = 'function __playableDataRequest() {}\n'
    + 'const shader = `vec4 color = texelFetch( texture, ivec2( 0 ), 0 );`;\n'
    + 'const response = { url: "data:test", status: 400, statusText: "Bad Request" };\n'
    + 'const diagnostic = `fetch for "${response.url}" responded with ${response.status}: ${response.statusText}`;\n'
    + '({ shader, diagnostic });';
  const html = `<html><script type="module">${source}</script></html>`;
  const output = prepareMolocoHtml(html);
  const decoded = runInNewContext(output.match(/<script[^>]*>([\s\S]*?)<\/script>/u)[1]);
  assert.equal(decoded.shader, runInNewContext(source).shader);
  assert.match(decoded.diagnostic, /data:test.*400: Bad Request/);
  assert.doesNotMatch(output, /fetch\s*\(/iu);
  assert.doesNotMatch(output, /\bfetch\b/iu);
  assert.equal(prepareMolocoHtml(output), output);
});

test('Moloco checker compatibility never hides actual network APIs', () => {
  for (const request of [
    'fetch(url)', 'window.fetch(url)', 'globalThis["fetch"](url)',
    'new XMLHttpRequest()', 'new WebSocket(url)', 'navigator.sendBeacon(url, data)'
  ]) {
    assert.throws(
      () => prepareMolocoHtml(`<script>function __playableDataRequest() {} ${request}</script>`),
      /network API marker/,
      request
    );
  }
  assert.throws(() => prepareMolocoHtml('<html></html>'), /missing the data-only offline request loader/);
});

test('Mintegral compatibility is enforced during source build without artifact string hiding', async () => {
  const [exporter, vite] = await Promise.all([
    readFile(new URL('../scripts/export-playable-package.mjs', import.meta.url), 'utf8'),
    readFile(new URL('../vite.config.js', import.meta.url), 'utf8')
  ]);
  assert.doesNotMatch(exporter, /hardenMintegralSource|structured\\u0043lone|local\\u0053torage|err"\+"or/);
  assert.match(exporter, /writeFile\(path\.join\(mintegralRoot, 'index\.js'\), split\.js, 'utf8'\)/);
  assert.match(vite, /name: 'mintegral-runtime-compatibility'/);
  assert.match(vite, /pure: \['console\.error'\]/);
  assert.match(vite, /FBX_DATA_IMAGE_BRANCH[\s\S]*'data:' \+ type \+ ';base64,' \+ btoa/);
  assert.match(vite, /node\.type === 'NewExpression'[\s\S]*node\.callee\.name === 'Error'/);
  assert.match(vite, /FILE_LOADER_BLOB_RESPONSE[\s\S]*matches !== 1[\s\S]*FILE_LOADER_UNSUPPORTED_RESPONSE/);
});

test('published artifacts are checked against the exact staged bytes', async () => {
  const exporter = await readFile(new URL('../scripts/export-playable-package.mjs', import.meta.url), 'utf8');
  assert.match(exporter, /verifyPublishedArtifact\(filePath, result, `\$\{platform\} artifact`\)/);
  assert.match(exporter, /verifyPublishedArtifact\(filePath, aggregateIdentity, 'All-platform artifact'\)/);
  assert.match(exporter, /actual\.bytes !== expected\.bytes \|\| actual\.sha256 !== expected\.sha256/);
});

test('inliner reuses the initial branding image instead of embedding it again in JavaScript', async () => {
  const inliner = await readFile(new URL('../scripts/package-applovin-single-html.mjs', import.meta.url), 'utf8');
  assert.match(inliner, /function reuseDocumentImageAsset\(html, js, assetMap, elementId\)/);
  assert.match(inliner, /document\.getElementById\(\$\{JSON\.stringify\(elementId\)\}\)\.src/);
  assert.match(inliner, /reuseDocumentImageAsset\(html, jsWithAssets, assetMap, 'branding-icon'\)/);
});

test('packaging and checks include EntryBanner resources only when the tuning enables it', async () => {
  const [inliner, checker, sceneView] = await Promise.all([
    readFile(new URL('../scripts/package-applovin-single-html.mjs', import.meta.url), 'utf8'),
    readFile(new URL('../scripts/check-applovin-package.mjs', import.meta.url), 'utf8'),
    readFile(new URL('../src/scene-view.js', import.meta.url), 'utf8')
  ]);
  const selection = /entryBannerEnabled:\s*Boolean\(SCENE_TUNING\.entryBanner\?\.enabled\)/;
  assert.match(inliner, selection);
  assert.match(checker, selection);
  assert.match(sceneView, /this\.entryBanner = SCENE_TUNING\.entryBanner\?\.enabled \? this\.createEntryBanner\(\) : null/);
});

test('platform packaging strips the development font resource and preserves system fallbacks', async () => {
  const [styles, inliner, checker] = await Promise.all([
    readFile(new URL('../src/styles.css', import.meta.url), 'utf8'),
    readFile(new URL('../scripts/package-applovin-single-html.mjs', import.meta.url), 'utf8'),
    readFile(new URL('../scripts/check-applovin-package.mjs', import.meta.url), 'utf8')
  ]);
  assert.match(styles, /@font-face[\s\S]*?Poppins-Bold\.ttf/);
  assert.match(styles, /'Poppins Branding', Arial, sans-serif/);
  assert.match(inliner, /function stripBundledFontFaces\(css\)/);
  assert.match(inliner, /const packagedCssSource = stripBundledFontFaces\(cssSource\)/);
  assert.match(inliner, /collectAssetUrls\(packagedCssSource, realAssetUrls\)/);
  assert.equal(BASE_RUNTIME_ASSET_PATHS.some((asset) => /\.(?:eot|otf|ttf|woff2?)$/i.test(asset)), false);
  assert.match(checker, /no (?:bundled|external) font/i);
});

test('editor and server expose production-only single-platform and all-platform export routes', async () => {
  const [editor, vite, exporter] = await Promise.all([
    readFile(new URL('../src/scene-editor.js', import.meta.url), 'utf8'),
    readFile(new URL('../vite.config.js', import.meta.url), 'utf8'),
    readFile(new URL('../scripts/export-playable-package.mjs', import.meta.url), 'utf8')
  ]);
  assert.match(editor, /editor-export-all-button/);
  assert.match(editor, /\/__playable-export-all/);
  assert.match(editor, /\\u6b63\\u5728\\u6253\\u5305/);
  assert.match(editor, /JSON\.stringify\(all \? \{ tuning: getTuning\(\) \}/);
  assert.match(vite, /pathname === '\/__playable-export-all'/);
  assert.match(vite, /exportAllPlayablePackages/);
  assert.match(vite, /X-Playable-Resource-Mode/);
  assert.match(vite, /MAX_PLAYABLE_EXPORT_BYTES = 1024 \* 1024/);
  assert.match(exporter, /NODE_ENV: 'production'/);
});

test('editor exposes every request naming component and platform channel code', async () => {
  const editor = await readFile(new URL('../src/scene-editor.js', import.meta.url), 'utf8');
  for (const path of [
    'requirementCode', 'materialCode', 'iterationCode', 'language', 'format',
    'designer', 'requester', 'steps', 'stamina'
  ]) {
    assert.match(editor, new RegExp(`exportNaming\\.${path}`));
  }
  for (const platform of SUPPORTED_PLATFORMS) {
    assert.match(editor, new RegExp(`exportNaming\\.channels\\.${platform}`));
  }
  assert.match(editor, /control === 'filename'/);
  assert.match(editor, /isValidExportNamingPart/);
});

test('scene editor separates controls into keyboard-accessible category tabs', async () => {
  const [editor, styles] = await Promise.all([
    readFile(new URL('../src/scene-editor.js', import.meta.url), 'utf8'),
    readFile(new URL('../src/styles.css', import.meta.url), 'utf8')
  ]);
  for (const id of ['level', 'visual', 'conveyor', 'vehicle', 'guide', 'export']) {
    assert.match(editor, new RegExp(`\\['${id}',`));
  }
  assert.match(editor, /role="tablist"/);
  assert.match(editor, /role="tab"/);
  assert.match(editor, /data-editor-category="export"/);
  assert.match(editor, /section\.dataset\.editorCategory = editorCategoryForGroup\(group\)/);
  assert.match(editor, /event\.key === 'ArrowRight'/);
  assert.match(editor, /setEditorCategory\('level'\)/);
  assert.match(styles, /\.editor-category-tabs/);
  assert.match(styles, /\.editor-section\.is-category-hidden/);
});

test('packaging strips editor-only naming metadata from platform runtime code', async () => {
  const [exporter, applyTuning] = await Promise.all([
    readFile(new URL('../scripts/export-playable-package.mjs', import.meta.url), 'utf8'),
    readFile(new URL('../scripts/apply-scene-tuning.mjs', import.meta.url), 'utf8')
  ]);
  assert.match(exporter, /--strip-export-metadata/);
  assert.match(applyTuning, /stripExportMetadata/);
  assert.match(applyTuning, /delete next\.exportNaming/);
});
