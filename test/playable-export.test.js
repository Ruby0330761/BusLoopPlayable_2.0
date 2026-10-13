import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { runInNewContext } from 'node:vm';

const execFileAsync = promisify(execFile);
import {
  buildPlayableArtifactName,
  createBrandingVariantTuning,
  EXPORT_RESOURCE_MODE,
  PLAYABLE_BRANDING_VARIANTS,
  PLAYABLE_NAMING_PATTERN,
  SUPPORTED_PLATFORMS,
  prepareMolocoHtml,
  retargetBrandingVariantHtml,
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
  assert.equal(validateExportNamingPart('   '), '');
  for (const value of ['../Q1', 'Q1/V1', 'Q1\\V1', 'Q1..V1', 'Q1 V1', '\u4e2d\u6587']) {
    assert.throws(() => validateExportNamingPart(value), TypeError, value);
  }
  assert.throws(
    () => buildPlayableArtifactName({
      exportNaming: { ...EXPORT_NAMING, requirementCode: 'A'.repeat(20) }
    }, 'google-ads'),
    /must not exceed 50 characters/
  );
});

test('artifact naming omits blank fields and keeps platform names distinct', () => {
  const tuning = {
    exportNaming: {
      materialCode: 'Q4V1',
      channels: Object.fromEntries(SUPPORTED_PLATFORMS.map((platform) => [platform, '']))
    }
  };
  assert.equal(buildPlayableArtifactName(tuning, 'applovin'), 'Q4V1-applovin.html');
  assert.equal(buildPlayableArtifactName(tuning, 'google-ads'), 'Q4V1-google-ads.zip');
  assert.equal(buildPlayableArtifactName(tuning, 'mintegral'), 'Q4V1_mintegral.zip');
});

test('all-platform branding variants select distinct icons and suffix every artifact', () => {
  assert.deepEqual(PLAYABLE_BRANDING_VARIANTS.map(({ id }) => id), ['android', 'ios']);
  const android = createBrandingVariantTuning({ branding: { icon: { asset: '/assets/old.png' } } }, 'android');
  const ios = createBrandingVariantTuning({ branding: { icon: { asset: '/assets/old.png' } } }, 'ios');
  assert.equal(android.branding.icon.asset, '/assets/icon-android.jpg');
  assert.equal(ios.branding.icon.asset, '/assets/icon-ios.png');
  assert.equal(android.branding.icon.asset === ios.branding.icon.asset, false);
  // Both slots stay valid because a platform preview can run with the other device UA.
  const storeTuning = { storeLinks: { ...STORE_LINKS } };
  const androidStores = createBrandingVariantTuning(storeTuning, 'android').storeLinks;
  const iosStores = createBrandingVariantTuning(storeTuning, 'ios').storeLinks;
  assert.equal(androidStores.android, STORE_LINKS.android);
  assert.equal(androidStores.ios, STORE_LINKS.ios);
  assert.equal(iosStores.android, STORE_LINKS.android);
  assert.equal(iosStores.ios, STORE_LINKS.ios);
  assert.deepEqual(storeTuning.storeLinks, STORE_LINKS);
  // The baked fallback is captured once at load, so it must track the live tuning.
  // The refresh has to be reachable from a call site that survives production builds:
  // loadSavedTuning is only called inside the editor branch, which exported builds drop.
  const runtime = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
  assert.match(runtime, /function refreshDefaultStoreLinks\(\) \{[\s\S]*?DEFAULT_STORE_LINKS\[platform\] = SCENE_TUNING\.storeLinks\?\.\[platform\]/);
  assert.match(runtime, /async function startRuntime\(\) \{[^}]*?refreshDefaultStoreLinks\(\);/);
  assert.equal(buildPlayableArtifactName({ exportNaming: EXPORT_NAMING }, 'applovin', '-Android'), 'AC-2607141-Q1V1-N-EN-PL-NLY-ZZN-AL-5moves-5hp-Android.html');
  assert.equal(buildPlayableArtifactName({ exportNaming: EXPORT_NAMING }, 'applovin', '-iOS'), 'AC-2607141-Q1V1-N-EN-PL-NLY-ZZN-AL-5moves-5hp-iOS.html');
  // Mintegral delivery names may contain only letters, digits, and underscores, so the
  // branding suffix has to follow the same hyphen replacement as the business base name.
  assert.equal(buildPlayableArtifactName({ exportNaming: EXPORT_NAMING }, 'mintegral', '-Android'), 'AC_2607141_Q1V1_N_EN_PL_NLY_ZZN_MT_5moves_5hp_Android.zip');
  assert.equal(buildPlayableArtifactName({ exportNaming: EXPORT_NAMING }, 'mintegral', '-iOS'), 'AC_2607141_Q1V1_N_EN_PL_NLY_ZZN_MT_5moves_5hp_iOS.zip');
  assert.match(buildPlayableArtifactName({ exportNaming: EXPORT_NAMING }, 'mintegral', '-Android'), /^[A-Za-z0-9_]+\.zip$/u);
  assert.throws(
    () => buildPlayableArtifactName({ exportNaming: EXPORT_NAMING }, 'google-ads', '-Android'),
    /must not exceed 50 characters/
  );
});

test('branding variants reuse platform builds by retargeting only the embedded icon', () => {
  const android = createBrandingVariantTuning({ storeLinks: STORE_LINKS }, 'android');
  const ios = createBrandingVariantTuning({ storeLinks: STORE_LINKS }, 'ios');
  const androidIcon = 'data:image/jpeg;base64,YW5kcm9pZA==';
  const iosIcon = 'data:image/png;base64,aW9z';
  const source = `<html><img id="branding-icon" src="${androidIcon}"><script>`
    + `const links={android:${JSON.stringify(STORE_LINKS.android)},ios:${JSON.stringify(STORE_LINKS.ios)}};`
    + '</script></html>';
  const result = retargetBrandingVariantHtml(source, android, ios, iosIcon);
  assert.doesNotMatch(result, /YW5kcm9pZA/);
  assert.equal(result.split(iosIcon).length - 1, 1);
  assert.equal(result.split(STORE_LINKS.android).length - 1, 1);
  assert.equal(result.split(STORE_LINKS.ios).length - 1, 1);
});

test('all-platform export builds both branding variants and records them in the manifest', async () => {
  const exporter = await readFile(new URL('../scripts/export-playable-package.mjs', import.meta.url), 'utf8');
  assert.match(exporter, /variants:\s*PLAYABLE_BRANDING_VARIANTS\.map/);
  assert.match(exporter, /createBrandingVariantTuning\(safeTuning, variant\.id\)/);
  assert.match(exporter, /assertEmbeddedStoreLinks\(sourceHtml, variantTuning\)/);
  assert.match(exporter, /brandingDeviceProfiles\(device\)/);
  assert.match(exporter, /device: runtimeDevices\[1\]/);
  assert.match(exporter, /applyWorkspaceBrandingIcon\(workRoot, tuning\)/);
  assert.match(exporter, /brandingVariant:\s*brandingVariant \?\? null/);
  assert.match(exporter, /skipRuntime: process\.env\.PLAYABLE_EXPORT_SKIP_RUNTIME === '1'/);
  assert.doesNotMatch(exporter, /skipRuntime: process\.env\.PLAYABLE_EXPORT_REMOTE_FAST === '1'/);
  assert.match(exporter, /brandingVariant,\s*format,\s*fileName/);
  assert.match(exporter, /results\.length/);
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
  assert.match(exporter, /copyFile\(path\.join\(projectRoot, 'artifacts', 'google-ads-backup\.jpg'\), backupPath\)/);
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

test('Mintegral packages inline their stylesheet and ship only html and js files', async () => {
  const exporter = await readFile(new URL('../scripts/export-playable-package.mjs', import.meta.url), 'utf8');
  // Mindworks' review checker flags separately loaded non-js files (style.css)
  // as an external-chain resource, so the Mintegral branch must inline CSS.
  assert.match(exporter, /const stylesheetTag = '<link rel="stylesheet" href="style\.css">'/);
  assert.match(exporter, /split\.html = split\.html\.replace\(stylesheetTag, `<style>\$\{split\.css\}<\/style>`\)/);
  assert.match(exporter, /writeFile\(path\.join\(mintegralRoot, `\$\{base\}\.html`\), split\.html, 'utf8'\)/);
  assert.doesNotMatch(exporter, /writeFile\(path\.join\(mintegralRoot, 'style\.css'\)/);
  const rules = JSON.parse(await readFile(new URL(
    '../deploy-tools/build-verified-playable-packages/rules/mintegral.json',
    import.meta.url
  ), 'utf8'));
  const rule = rules.rules.find((entry) => entry.id === 'MINTEGRAL-STA-006');
  assert.ok(rule, 'MINTEGRAL-STA-006 must guard against separately loaded non-js assets');
  const pattern = new RegExp(rule.check.pattern, 'i');
  assert.ok(pattern.test('<link rel="stylesheet" href="style.css">'));
  assert.ok(!pattern.test('<img src="data:image/png;base64,AAAA"><script defer src="index.js"></script>'));
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

test('packaging embeds only the selected configured pre-roll MP4', async () => {
  const [inliner, checker, resources] = await Promise.all([
    readFile(new URL('../scripts/package-applovin-single-html.mjs', import.meta.url), 'utf8'),
    readFile(new URL('../scripts/check-applovin-package.mjs', import.meta.url), 'utf8'),
    readFile(new URL('../src/mechanism-resources.js', import.meta.url), 'utf8')
  ]);
  assert.match(inliner, /\['\.mp4', 'video\/mp4'\]/);
  assert.match(inliner, /PRE_ROLL_ASSET_PATHS\.includes\(SCENE_TUNING\.preRoll\?\.asset\)/);
  assert.match(inliner, /isPreRollAssetPath\(SCENE_TUNING\.preRoll\?\.asset\)/);
  assert.match(checker, /configured pre-roll video inlined/);
  for (const name of ['TP1327.mp4', 'TP1333.mp4', 'TP1334.mp4']) {
    assert.match(resources, new RegExp(name.replace('.', '\\.')));
  }
  assert.match(readFileSync(new URL('../scripts/export-playable-package.mjs', import.meta.url), 'utf8'), /EDITOR_PRE_ROLL_PREFIX = '\/assets\/editor-prerolls\/'/);
  assert.match(readFileSync(new URL('../scripts/export-playable-package.mjs', import.meta.url), 'utf8'), /artifacts', 'editor-prerolls'/);
  assert.match(readFileSync(new URL('../scripts/export-playable-package.mjs', import.meta.url), 'utf8'), /compressPreRollFile/);
  assert.match(readFileSync(new URL('../scripts/export-playable-package.mjs', import.meta.url), 'utf8'), /PRE_ROLL_COMPRESSION_VERSION/);
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
  const [editor, mainSource, vite, exporter, inliner, checker, remoteStarter, dockerfile] = await Promise.all([
    readFile(new URL('../src/scene-editor.js', import.meta.url), 'utf8'),
    readFile(new URL('../src/main.js', import.meta.url), 'utf8'),
    readFile(new URL('../vite.config.js', import.meta.url), 'utf8'),
    readFile(new URL('../scripts/export-playable-package.mjs', import.meta.url), 'utf8'),
    readFile(new URL('../scripts/package-applovin-single-html.mjs', import.meta.url), 'utf8'),
    readFile(new URL('../scripts/check-playable-runtime.mjs', import.meta.url), 'utf8'),
    readFile(new URL('../scripts/start-remote-editor.mjs', import.meta.url), 'utf8'),
    readFile(new URL('../Dockerfile', import.meta.url), 'utf8')
  ]);
  assert.match(editor, /editor-export-all-button/);
  assert.match(editor, /\/__playable-export-all/);
  assert.match(editor, /\\u6b63\\u5728\\u6253\\u5305/);
  assert.match(editor, /getPlayableExportPayload\(\)[\s\S]*?JSON\.stringify\(all \? exportPayload : \{ \.\.\.exportPayload, platform \}/);
  assert.match(mainSource, /function getPlayableExportPayload\(\)[\s\S]*?levelDocumentBaseRevision/);
  assert.match(mainSource, /getPlayableExportPayload,/);
  assert.match(editor, /payload\.detail/);
  assert.match(editor, /payload\.durationMs/);
  assert.match(editor, /detailAlreadyShown[\s\S]*试玩包生成或本地检测失败/);
  assert.match(editor, /detail && !detailAlreadyShown/);
  assert.match(editor, /checkMessage = check\?\.startsWith\('skipped;'/);
  assert.match(editor, /\\u672a\\u6267\\u884c\\u672c\\u5730\\u68c0\\u6d4b/);
  assert.match(editor, /\\u65e0\\u6cd5\\u8fde\\u63a5\\u5bfc\\u51fa\\u670d\\u52a1/);
  assert.match(vite, /pathname === '\/__playable-export-all'/);
  assert.match(vite, /exportAllPlayablePackages/);
  assert.match(vite, /X-Playable-Resource-Mode/);
  assert.match(vite, /X-Playable-Source-Cache/);
  assert.match(vite, /statusCode === 500 \? \{ detail \} : \{\}/);
  assert.match(vite, /compactDetail/);
  assert.match(vite, /试玩包生成或本地检测失败：\$\{compactDetail\}/);
  assert.match(vite, /MAX_PLAYABLE_EXPORT_BYTES = 3 \* 1024 \* 1024/);
  assert.match(vite, /validateWebLevelDocument\(payload\.levelDocument, selectedLevelKey\)/);
  assert.match(vite, /levelDocumentBaseRevision/);
  assert.match(vite, /levelDocument,/);
  assert.match(vite, /signal: exportAbortController\.signal[\s\S]*skipChecks: true/);
  assert.match(vite, /SKIPPED_LOCAL_CHECKS/);
  assert.match(vite, /X-Playable-Check[\s\S]*local checks disabled/);
  assert.match(vite, /optimizeDeps:\s*\{\s*noDiscovery:\s*true,\s*include:\s*\[\]/);
  assert.match(vite, /PLAYABLE_REMOTE_EDITOR === '1'[\s\S]*mkdtemp\(path\.join\(os\.tmpdir\(\), 'bus-loop-remote-export-'\)\)/);
  assert.match(vite, /transientExportRoot[\s\S]*outputDir: transientExportRoot/);
  assert.match(vite, /new AbortController\(\)[\s\S]*request\.once\('aborted'[\s\S]*signal: exportAbortController\.signal/);
  assert.match(vite, /PLAYABLE_EXPORT_TIMEOUT_MS = 10 \* 60 \* 1000/);
  assert.match(vite, /setTimeout\(\(\) => exportAbortController\.abort\(\), PLAYABLE_EXPORT_TIMEOUT_MS\)/);
  assert.match(vite, /clearTimeout\(exportTimeout\)/);
  assert.match(vite, /X-Playable-Export-Duration-Ms/);
  assert.match(vite, /pathname === '\/' \|\| pathname\.endsWith\('\.html'\)/);
  assert.match(vite, /Cache-Control', 'no-store'/);
  assert.match(vite, /\[playable-export\] finished route=/);
  assert.match(vite, /rm\(transientExportRoot, \{ recursive: true, force: true \}\)/);
  assert.match(exporter, /checkPlayableRuntimeArtifact\(\{[\s\S]*?signal/);
  assert.match(exporter, /conclusion: 'SKIPPED_LOCAL_CHECKS'/);
  assert.match(exporter, /skipChecks/);
  assert.match(checker, /signalBrowserTree\('SIGTERM'\)[\s\S]*signal\?\.aborted/);
  assert.match(exporter, /NODE_ENV: 'production'/);
  assert.match(exporter, /PLAYABLE_REMOTE_EDITOR: '0'/);
  assert.match(exporter, /DEFAULT_EXPORT_CONCURRENCY = 2/);
  assert.match(await readFile(new URL('../Dockerfile', import.meta.url), 'utf8'), /PLAYABLE_EXPORT_CONCURRENCY=1/);
  assert.match(exporter, /detached: process\.platform !== 'win32'/);
  assert.match(exporter, /process\.kill\(-child\.pid, killSignal\)/);
  assert.match(exporter, /mapWithConcurrency\([\s\S]*?platforms[\s\S]*?getExportConcurrency\(platforms\.length\)/);
  assert.match(exporter, /generateWorkspaceSources\(workspace\.workRoot, signal\)/);
  assert.match(exporter, /prepareWorkspace\(resolvedRoot, safeTuning, levelDocument\)/);
  assert.match(exporter, /JSON\.stringify\(levelDocument\)/);
  assert.match(exporter, /PLAYABLE_DIST_DIR: distRoot/);
  assert.match(exporter, /PLAYABLE_INLINE_OUTPUT_FILE: outputPath/);
  assert.match(inliner, /process\.env\.PLAYABLE_DIST_DIR/);
  assert.match(inliner, /process\.env\.PLAYABLE_INLINE_OUTPUT_FILE/);
  assert.match(remoteStarter, /preview/);
  assert.match(remoteStarter, /preview:\s*\{[\s\S]*host:\s*'0\.0\.0\.0'/);
  assert.match(vite, /configurePreviewServer/);
  assert.match(vite, /__REMOTE_EDITOR__/);
  assert.match(dockerfile, /PLAYABLE_REMOTE_EDITOR=1 npm run build/);
  assert.match(dockerfile, /CMD \["node", "scripts\/start-remote-editor\.mjs"\]/);
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

test('homepage editor captures borderless 9:16 screenshots', async () => {
  const [editor, main, view, styles] = await Promise.all([
    readFile(new URL('../src/scene-editor.js', import.meta.url), 'utf8'),
    readFile(new URL('../src/main.js', import.meta.url), 'utf8'),
    readFile(new URL('../src/scene-view.js', import.meta.url), 'utf8'),
    readFile(new URL('../src/styles.css', import.meta.url), 'utf8')
  ]);
  assert.match(editor, /SCREENSHOT_SIZE_OPTIONS/);
  assert.match(editor, /720x1280/);
  assert.match(editor, /1080x1920/);
  assert.match(editor, /editor-screenshot-button/);
  assert.match(editor, /captureScreenshot\(\{ width, height \}\)/);
  assert.match(main, /capturePlayableScreenshot/);
  assert.match(main, /composeScreenshotBlob/);
  assert.match(main, /drawScreenshotBranding/);
  assert.match(main, /drawScreenshotCta/);
  assert.match(main, /downloadBlob\(filename, imageBlob\)/);
  assert.match(view, /async captureFrame\(\{ width, height \}\)/);
  assert.match(view, /new THREE\.WebGLRenderTarget\(captureWidth, captureHeight/);
  assert.match(view, /readRenderTargetPixels/);
  assert.match(view, /applyViewportLayout\(captureWidth, captureHeight/);
  assert.match(styles, /\.editor-screenshot/);
  assert.match(styles, /\.editor-screenshot-status\[data-state="success"\]/);
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

test('applying export tuning rewrites only tuning data and leaves runtime helpers importable', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'bus-loop-apply-tuning-'));
  try {
    await mkdir(path.join(root, 'src'), { recursive: true });
    await mkdir(path.join(root, 'scripts'), { recursive: true });
    await mkdir(path.join(root, 'artifacts'), { recursive: true });
    const [tuningSource, applyScript, gameModel, sceneView] = await Promise.all([
      readFile(new URL('../src/scene-tuning.js', import.meta.url), 'utf8'),
      readFile(new URL('../scripts/apply-scene-tuning.mjs', import.meta.url), 'utf8'),
      readFile(new URL('../src/game-model.js', import.meta.url), 'utf8'),
      readFile(new URL('../src/scene-view.js', import.meta.url), 'utf8')
    ]);
    await writeFile(path.join(root, 'src', 'scene-tuning.js'), tuningSource, 'utf8');
    await writeFile(path.join(root, 'scripts', 'apply-scene-tuning.mjs'), applyScript, 'utf8');
    await writeFile(path.join(root, 'artifacts', 'scene-tuning.json'), '{ "level": { "selected": "level9" } }\n', 'utf8');

    await execFileAsync(process.execPath, [
      'scripts/apply-scene-tuning.mjs',
      '--strip-export-metadata'
    ], { cwd: root });

    // The rewrite emits tuning data only, so runtime code must not import helpers from it.
    const rewritten = await readFile(path.join(root, 'src', 'scene-tuning.js'), 'utf8');
    assert.match(rewritten, /^export const SCENE_TUNING = \{/);
    assert.doesNotMatch(rewritten, /export function /);
    for (const source of [gameModel, sceneView]) {
      assert.match(source, /import \{ getVehicleAreaPivot(?:, mapVehicleAreaBasePoint)? \} from '\.\/vehicle-area\.js'/);
      assert.doesNotMatch(source, /import \{[^}]*getVehicleAreaPivot[^}]*\} from '\.\/scene-tuning\.js'/);
    }
    const rewrittenModule = await import(`${pathToFileURL(path.join(root, 'src', 'scene-tuning.js')).href}?applied=1`);
    const { getVehicleAreaPivot } = await import('../src/vehicle-area.js');
    const pivot = getVehicleAreaPivot(rewrittenModule.SCENE_TUNING.vehicleArea);
    assert.equal(rewrittenModule.SCENE_TUNING.level.selected, 'level9');
    assert.equal(typeof pivot.x, 'number');
    assert.equal(typeof pivot.z, 'number');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
