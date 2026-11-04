import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { runInNewContext } from 'node:vm';

const execFileAsync = promisify(execFile);
import {
  buildPlayableArtifactName,
  CROWD_STORE_LINKS,
  createBrandingVariantTuning,
  DEFAULT_PLAYABLE_BRANDING_SET,
  EXPORT_RESOURCE_MODE,
  PLAYABLE_BRANDING_SETS,
  PLAYABLE_BRANDING_VARIANTS,
  PLAYABLE_NAMING_PATTERN,
  resolveBrandingSetVariants,
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
    'requirement-material-iteration-N-language-format-designer-requester-channel-steps-stamina'
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
    const businessBaseName = `AC-2607141-Q1V1-N-N-EN-PL-NLY-ZZN-${EXPORT_NAMING.channels[platform]}-N-N`;
    const baseName = platform === 'mintegral' ? businessBaseName.replaceAll('-', '_') : businessBaseName;
    assert.equal(
      buildPlayableArtifactName({ exportNaming: EXPORT_NAMING }, platform),
      `${baseName}.${extensions[platform]}`
    );
  }
});

test('artifact naming rejects unsafe paths and Google Ads names over 128 characters', () => {
  assert.equal(validateExportNamingPart('  Q1V1  '), 'Q1V1');
  assert.equal(validateExportNamingPart('   '), '');
  for (const value of ['../Q1', 'Q1/V1', 'Q1\\V1', 'Q1..V1', 'Q1 V1', '\u4e2d\u6587']) {
    assert.throws(() => validateExportNamingPart(value), TypeError, value);
  }
  assert.throws(
    () => buildPlayableArtifactName({
      exportNaming: { ...EXPORT_NAMING, materialCode: 'Q1V1'.repeat(16), designer: 'N'.repeat(64) }
    }, 'google-ads'),
    /must not exceed 128 characters/
  );
});

test('artifact naming omits blank fields and keeps platform names distinct', () => {
  const tuning = {
    exportNaming: {
      materialCode: 'Q4V1',
      channels: Object.fromEntries(SUPPORTED_PLATFORMS.map((platform) => [platform, '']))
    }
  };
  // Blank fields drop out, but the two fixed segments survive: the `N` after the
  // pre-roll slot and the steps/stamina tail both always print.
  assert.equal(buildPlayableArtifactName(tuning, 'applovin'), 'Q4V1-N-applovin-N-N.html');
  assert.equal(buildPlayableArtifactName(tuning, 'google-ads'), 'Q4V1-N-google-ads-N-N.zip');
  assert.equal(buildPlayableArtifactName(tuning, 'mintegral'), 'Q4V1_N_mintegral_N_N.zip');
});

test('one Bus package serves both stores and carries both icons', () => {
  // Android and iOS used to be two downloads that differed by one image. They are
  // now one artifact: both icons ship inside it and the runtime picks by UA, the
  // same way it already picked the store link.
  assert.deepEqual(PLAYABLE_BRANDING_VARIANTS.map(({ id }) => id), ['bus']);
  const bus = createBrandingVariantTuning({ branding: { icon: { asset: '/assets/old.png' } } }, 'bus');
  assert.equal(bus.branding.icon.asset, '/assets/icon-android.jpg');
  assert.deepEqual(bus.branding.icon.deviceAssets, {
    android: '/assets/icon-android.jpg',
    ios: '/assets/icon-ios.png'
  });
  // The BL logo travels with the BL set. Leaving it to the editor preview meant a
  // BL export could ship with the BFT wordmark under the CTA.
  assert.equal(bus.branding.logo.asset, '/assets/main-loading-icon-small.png');
  // Crowd uses one icon for both stores, but it must still WRITE the per-device
  // map: the workspace applies tuning by deep merge, which cannot delete a key,
  // so leaving it out kept Bus's icons and the runtime picked them by UA (a Crowd
  // build shipped with the Bus icon). Both slots now point at the Crowd art.
  const crowd = createBrandingVariantTuning({ branding: { icon: { deviceAssets: { android: '/a.jpg', ios: '/b.png' } } } }, 'crowd');
  assert.equal(crowd.branding.icon.asset, '/assets/icon-crowd.jpg');
  assert.deepEqual(crowd.branding.icon.deviceAssets, {
    android: '/assets/icon-crowd.jpg',
    ios: '/assets/icon-crowd.jpg'
  });
  // Both slots stay valid because a platform preview can run with the other device UA.
  const storeTuning = { storeLinks: { ...STORE_LINKS } };
  const busStores = createBrandingVariantTuning(storeTuning, 'bus').storeLinks;
  assert.equal(busStores.android, STORE_LINKS.android);
  assert.equal(busStores.ios, STORE_LINKS.ios);
  assert.deepEqual(storeTuning.storeLinks, STORE_LINKS);
  // The baked fallback is captured once at load, so it must track the live tuning.
  // The refresh has to be reachable from a call site that survives production builds:
  // loadSavedTuning is only called inside the editor branch, which exported builds drop.
  const runtime = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
  assert.match(runtime, /function refreshDefaultStoreLinks\(\) \{[\s\S]*?DEFAULT_STORE_LINKS\[platform\] = SCENE_TUNING\.storeLinks\?\.\[platform\]/);
  assert.match(runtime, /async function startRuntime\(\) \{[^}]*?refreshDefaultStoreLinks\(\);/);
  assert.equal(buildPlayableArtifactName({ exportNaming: EXPORT_NAMING }, 'applovin', '-Crowd'), 'AC-2607141-Q1V1-N-N-EN-PL-NLY-ZZN-AL-N-N-Crowd.html');
  // Mintegral delivery names may contain only letters, digits, and underscores, so the
  // branding suffix has to follow the same hyphen replacement as the business base name.
  assert.equal(buildPlayableArtifactName({ exportNaming: EXPORT_NAMING }, 'mintegral', '-Crowd'), 'AC_2607141_Q1V1_N_N_EN_PL_NLY_ZZN_MT_N_N_Crowd.zip');
  // Both tail segments are always present: an empty steps/stamina field falls back to N
  // so a delivery name never silently loses the last two segments.
  assert.equal(buildPlayableArtifactName({ exportNaming: { ...EXPORT_NAMING, steps: '', stamina: '' } }, 'applovin'), 'AC-2607141-Q1V1-N-N-EN-PL-NLY-ZZN-AL-N-N.html');
  assert.match(buildPlayableArtifactName({ exportNaming: EXPORT_NAMING }, 'mintegral', '-Android'), /^[A-Za-z0-9_]+\.zip$/u);
  // Google Ads caps the delivery name at 128 chars; the naming rule still has to
  // reject a name that overruns it now that steps/stamina are not emitted.
  assert.throws(
    () => buildPlayableArtifactName({
      exportNaming: { ...EXPORT_NAMING, materialCode: 'Q1V1'.repeat(16), designer: 'N'.repeat(64) }
    }, 'google-ads', '-Android'),
    /must not exceed 128 characters/
  );
});

test('branding variants reuse platform builds by retargeting only the embedded icon', () => {
  const android = createBrandingVariantTuning({ storeLinks: STORE_LINKS }, 'bus');
  const ios = createBrandingVariantTuning({ storeLinks: STORE_LINKS }, 'crowd');
  const androidIcon = 'data:image/jpeg;base64,YW5kcm9pZA==';
  const iosIcon = 'data:image/png;base64,aW9z';
  const source = `<html><img id="branding-icon" src="${androidIcon}"><script>`
    + `const links={android:${JSON.stringify(STORE_LINKS.android)},ios:${JSON.stringify(STORE_LINKS.ios)}};`
    + '</script></html>';
  const result = retargetBrandingVariantHtml(source, android, ios, iosIcon);
  assert.doesNotMatch(result, /YW5kcm9pZA/);
  assert.equal(result.split(iosIcon).length - 1, 1);
  // Bus and Crowd advertise different stores, so both links are swapped.
  assert.equal(result.split(STORE_LINKS.android).length - 1, 0);
  assert.equal(result.split(STORE_LINKS.ios).length - 1, 0);
  assert.equal(result.split(CROWD_STORE_LINKS.android).length - 1, 1);
  assert.equal(result.split(CROWD_STORE_LINKS.ios).length - 1, 1);
});

test('all-platform export builds both branding variants and records them in the manifest', async () => {
  const exporter = await readFile(new URL('../scripts/export-playable-package.mjs', import.meta.url), 'utf8');
  assert.match(exporter, /variants:\s*brandingVariants\.map/);
  assert.match(exporter, /resolveBrandingSetVariants\(brandingSet\)/);
  assert.match(exporter, /createBrandingVariantTuning\(safeTuning, variant\.id\)/);
  assert.match(exporter, /assertEmbeddedStoreLinks\(sourceHtml, variantTuning\)/);
  assert.match(exporter, /brandingDeviceProfiles\(devices\)/);
  assert.match(exporter, /device: runtimeDevices\[1\]/);
  assert.match(exporter, /applyWorkspaceBrandingIcon\(workRoot, tuning\)/);
  assert.match(exporter, /brandingVariant:\s*brandingVariant \?\? null/);
  assert.match(exporter, /skipRuntime: process\.env\.PLAYABLE_EXPORT_SKIP_RUNTIME === '1'/);
  assert.doesNotMatch(exporter, /skipRuntime: process\.env\.PLAYABLE_EXPORT_REMOTE_FAST === '1'/);
  assert.match(exporter, /brandingVariant,\s*format,\s*fileName/);
  assert.match(exporter, /results\.length/);
});

test('Crowd exports one shared Android/iOS package with its own icon and logo', async () => {
  assert.equal(DEFAULT_PLAYABLE_BRANDING_SET, 'bus');
  assert.deepEqual(
    PLAYABLE_BRANDING_SETS.bus.map(({ id }) => id),
    ['bus']
  );
  assert.deepEqual(
    PLAYABLE_BRANDING_SETS.crowd.map(({ id }) => id),
    ['crowd']
  );
  assert.throws(() => resolveBrandingSetVariants('nope'), /Unsupported playable branding set/);
  assert.equal(resolveBrandingSetVariants().length, 1);

  const crowd = createBrandingVariantTuning(
    { branding: { icon: { asset: '/assets/icon-android.jpg' }, logo: { asset: '/assets/main-loading-icon-small.png' } } },
    'crowd'
  );
  assert.equal(crowd.branding.icon.asset, '/assets/icon-crowd.jpg');
  assert.equal(crowd.branding.logo.asset, '/assets/main-loading-icon-crowd.webp');
  // An untouched Bus default text must not survive into a Crowd package.
  assert.equal(crowd.branding.text.content, 'Bus Crowd');
  assert.equal(crowd.branding.loading.title, 'Bus Crowd');
  assert.equal(crowd.branding.loading.icon, '');
  // The Crowd wordmark must sit centred even when a saved editor session left
  // the draggable x a few pixels off (a 534 shipped once and looked off-centre).
  const dragged = createBrandingVariantTuning(
    { preview: { width: 1080, height: 2160 }, branding: { text: { x: 534, content: 'Bus Crowd' } } },
    'crowd'
  );
  assert.equal(dragged.branding.text.x, 540);
  assert.equal(dragged.branding.text.content, 'Bus Crowd');
  // A different authoring canvas centres on that canvas instead of assuming 1080.
  const wideCanvas = createBrandingVariantTuning(
    { preview: { width: 900, height: 1600 }, branding: { text: { x: 120 } } },
    'crowd'
  );
  assert.equal(wideCanvas.branding.text.x, 450);
  // The Bus variants keep the position the operator set.
  const busText = createBrandingVariantTuning(
    { preview: { width: 1080, height: 2160 }, branding: { text: { x: 700 } } },
    'bus'
  );
  assert.equal(busText.branding.text.x, 700);

  const custom = createBrandingVariantTuning(
    { branding: { text: { content: 'Download now' } } },
    'crowd'
  );
  assert.equal(custom.branding.text.content, 'Download now');
  assert.equal(existsSync('public/assets/icon-crowd.jpg'), true);
  assert.equal(existsSync('public/assets/main-loading-icon-crowd.webp'), true);

  // A Crowd package must not send players to the Bus Fever store listings: the
  // editor tuning still carries those, so the set has to override them.
  const busTunedCrowd = createBrandingVariantTuning({ storeLinks: { ...STORE_LINKS } }, 'crowd');
  assert.equal(busTunedCrowd.storeLinks.android, CROWD_STORE_LINKS.android);
  assert.equal(busTunedCrowd.storeLinks.ios, CROWD_STORE_LINKS.ios);
  assert.notEqual(CROWD_STORE_LINKS.android, STORE_LINKS.android);
  assert.notEqual(CROWD_STORE_LINKS.ios, STORE_LINKS.ios);
  // Bus variants keep whatever the editor saved.
  const busVariant = createBrandingVariantTuning({ storeLinks: { ...STORE_LINKS } }, 'bus');
  assert.equal(busVariant.storeLinks.android, STORE_LINKS.android);
  assert.equal(busVariant.storeLinks.ios, STORE_LINKS.ios);
  assert.match(CROWD_STORE_LINKS.android, /id=busflow\.traffic\.puzzle/u);
  assert.match(CROWD_STORE_LINKS.ios, /id6754059516/u);

  assert.equal(
    buildPlayableArtifactName({ exportNaming: EXPORT_NAMING }, 'applovin', '-Crowd'),
    'AC-2607141-Q1V1-N-N-EN-PL-NLY-ZZN-AL-N-N-Crowd.html'
  );

  const [exporter, vite, editor] = await Promise.all([
    readFile(new URL('../scripts/export-playable-package.mjs', import.meta.url), 'utf8'),
    readFile(new URL('../vite.config.js', import.meta.url), 'utf8'),
    readFile(new URL('../src/scene-editor.js', import.meta.url), 'utf8')
  ]);
  assert.match(exporter, /variants: variants\.map\(\(\{ id, suffix, runtimeDevices \}\) => \(\{/);
  // BL no longer skips the branding-variant pass: one BL file must carry both
  // store icons so the runtime can pick one from the device UA.
  assert.doesNotMatch(exporter, /brandingSet === DEFAULT_PLAYABLE_BRANDING_SET\s*\?\s*null/);
  // The download container and the check reports carry the delivery package
  // label `<requirement>-<YYYYMMDD>-<designer>` (e.g. BL-2610296-20261102-WXJ),
  // while the packaged files keep the 11-segment requirement-sheet naming.
  assert.match(exporter, /BUS_BRANDING_LABEL = 'BL'/);
  assert.match(exporter, /export function buildDeliveryPackageLabel\(/);
  assert.match(exporter, /const packageLabel = buildDeliveryPackageLabel\(/);
  assert.match(exporter, /`\$\{packageLabel\}\.zip`/);
  assert.match(exporter, /const label = packageLabel \|\|/);
  assert.match(exporter, /logoAsset: '\/assets\/main-loading-icon-crowd\.webp'/);
  assert.match(vite, /PLAYABLE_BRANDING_SETS = new Set\(\['bus', 'crowd'\]\)/);
  assert.match(vite, /brandingSet,/);
  assert.match(editor, /editor-export-set-select/);
  assert.match(editor, /brandingSet/);
  // The operator-facing names are the product codes, not the internal set ids:
  // BL ships one merged Android/iOS package, BFT the other game's package. The
  // editor source keeps these labels as ASCII escapes, so match the escapes.
  assert.match(editor, /BL \\u5b89\\u5353/);
  assert.match(editor, /BL iOS/);
  assert.match(editor, /BFT/);
  assert.doesNotMatch(editor, /Bus Fever\\uff1aAndroid/);
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
  // The branding Icon/Logo and the loading icon are all inlined in the document
  // already, so each tuning literal must reuse the element instead of embedding
  // the same bytes twice. The loading icon is compared against its own src at
  // runtime, so its literal has to come from the document as well.
  // `stage-choice-hand` is the same sprite the 3D guide hand loads by URL, so it
  // has to reuse the document copy too or the payload scan sees the blob twice.
  assert.match(inliner, /\['branding-icon', 'branding-logo', 'loading-icon', 'stage-choice-hand'\]/);
  assert.match(inliner, /reuseDocumentImageAsset\(html, source, assetMap, elementId\)/);
});

test('packaging and checks include EntryBanner resources only when the tuning or a stage enables it', async () => {
  const [inliner, checker, sceneView] = await Promise.all([
    readFile(new URL('../scripts/package-applovin-single-html.mjs', import.meta.url), 'utf8'),
    readFile(new URL('../scripts/check-applovin-package.mjs', import.meta.url), 'utf8'),
    readFile(new URL('../src/scene-view.js', import.meta.url), 'utf8')
  ]);
  // A later stage can enable the banner while the global toggle stays off. Both
  // consumers must consider every request source: the fixed stage sequence, the
  // map picker, and the global toggle.
  assert.match(inliner, /const stageBannerEnabled = PLAYABLE_STAGES\.some\(/u);
  assert.match(inliner, /const choiceBannerEnabled = PLAYABLE_STAGE_CHOICES\.some\(/u);
  assert.match(inliner, /SCENE_TUNING\.entryBanner\?\.enabled \|\| stageBannerEnabled \|\| choiceBannerEnabled/u);
  assert.match(checker, /PLAYABLE_STAGE_CHOICES/);
  // Assets follow the reachable set, not just the fixed order, or a picked map
  // would ship with placeholder bytes.
  assert.match(inliner, /PLAYABLE_STAGE_CHOICES, PLAYABLE_ALL_LEVELS/);
  assert.match(checker, /PLAYABLE_STAGE_CHOICES, PLAYABLE_ALL_LEVELS/);
  assert.match(inliner, /for \(const option of choiceOptions\) realAssetUrls\.add\(option\.image\)/);
  assert.match(sceneView, /this\.entryBanner = SCENE_TUNING\.entryBanner\?\.enabled \? this\.createEntryBanner\(\) : null/);
});

test('packaging embeds only the selected configured pre-roll MP4', async () => {
  const [inliner, checker, resources] = await Promise.all([
    readFile(new URL('../scripts/package-applovin-single-html.mjs', import.meta.url), 'utf8'),
    readFile(new URL('../scripts/check-applovin-package.mjs', import.meta.url), 'utf8'),
    readFile(new URL('../src/mechanism-resources.js', import.meta.url), 'utf8')
  ]);
  assert.match(inliner, /\['\.mp4', 'video\/mp4'\]/);
  // The packager and the checker must resolve the pre-roll the same way the
  // runtime does, session opt-out included.
  assert.match(inliner, /const selectedPreRollAsset = resolvePreRollAsset\(\s*SCENE_TUNING\.preRoll,\s*ACTIVE_PLAYABLE_SESSION\s*\)/u);
  assert.match(checker, /const selectedPreRollAsset = resolvePreRollAsset\(SCENE_TUNING\.preRoll, ACTIVE_PLAYABLE_SESSION\)/u);
  assert.match(inliner, /PRE_ROLL_ASSET_PATHS\.includes\(selectedPreRollAsset\)/u);
  assert.match(inliner, /isPreRollAssetPath\(selectedPreRollAsset\)/u);
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
  assert.match(editor, /getPlayableExportPayload\(\)[\s\S]*?JSON\.stringify\(all[\s\S]*?\.\.\.exportPayload, platform, brandingSet/);
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
    'designer', 'requester'
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

test('AppLovin challenge funnel instrumentation stays wired end to end', async () => {
  const [bridge, main, rulesSource] = await Promise.all([
    readFile(new URL('../src/platform-bridge.js', import.meta.url), 'utf8'),
    readFile(new URL('../src/main.js', import.meta.url), 'utf8'),
    readFile(new URL(
      '../deploy-tools/build-verified-playable-packages/rules/applovin.json',
      import.meta.url
    ), 'utf8')
  ]);
  // The gate must require the full Axon funnel so an uninstrumented build fails export.
  const rules = JSON.parse(rulesSource);
  const rule = rules.rules.find((entry) => entry.id === 'APL-STA-004');
  assert.ok(rule, 'APL-STA-004 must guard the AppLovin event chain');
  for (const eventName of [
    'LOADING', 'LOADED', 'DISPLAYED', 'CHALLENGE_STARTED',
    'CHALLENGE_PASS_25', 'CHALLENGE_PASS_50', 'CHALLENGE_PASS_75',
    'CHALLENGE_SOLVED', 'CHALLENGE_FAILED', 'CHALLENGE_RETRY',
    'ENDCARD_SHOWN', 'CTA_CLICKED'
  ]) {
    assert.ok(rule.check.patterns.includes(eventName), `APL-STA-004 must require ${eventName}`);
  }
  // The bridge owns the funnel semantics: progress milestones, solved suppression, CTA backfill.
  assert.match(bridge, /challengeProgress\(percent\)/);
  assert.match(bridge, /challengeSolved\(\)/);
  assert.match(bridge, /challengeFailed\(\)/);
  assert.match(bridge, /SOLVED_SUPPRESSED/);
  // The runtime must feed progress, solve, fail, and retry from real gameplay moments.
  assert.match(main, /platformBridge\?\.challengeProgress\?\.\(\(successfulOperationCount \/ threshold\) \* 100\)/);
  assert.match(main, /platformBridge\?\.challengeSolved\?\.\(\)/);
  assert.match(main, /platformBridge\?\.challengeFailed\?\.\(\)/);
  assert.match(main, /platformBridge\?\.retry\(\)/);
});

test('packages carry no build stamp anywhere on screen', async () => {
  const packager = await readFile(new URL('../scripts/package-applovin-single-html.mjs', import.meta.url), 'utf8');
  const indexHtml = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  const styles = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8');
  const main = await readFile(new URL('../src/main.js', import.meta.url), 'utf8');

  // A timestamp used to sit in the top-left corner of every build. It shipped on
  // screen by mistake and had to be stripped, so pin its absence: no DOM slot,
  // no injected text, no leftover styling, no editor-only class that only
  // existed to hide it.
  assert.doesNotMatch(indexHtml, /build-stamp/u);
  assert.doesNotMatch(packager, /build-stamp|BuildStamp/u);
  assert.doesNotMatch(styles, /build-stamp/u);
  assert.doesNotMatch(main, /build-stamp|buildStamp|is-editor/u);
});

test('UnityAds packages carry no AppLovin marker, even from shared asset paths', async () => {
  const packager = await readFile(new URL('../scripts/export-playable-package.mjs', import.meta.url), 'utf8');
  const encoder = packager.slice(
    packager.indexOf('function encodeUnityStaticFalsePositives'),
    packager.indexOf('export function prepareMolocoHtml')
  );
  // The colour-atlas table hard-codes "/assets/applovin/textures". UNITY-STA-004
  // reads that word as a leftover AppLovin API call and fails the whole package,
  // which is exactly what happened once the atlas table moved into code.
  assert.match(encoder, /applovin\(\?=\\\/textures\)/u, 'the atlas prefix rewrite must stay in the Unity transform');

  const transformed = runInNewContext(
    `${encoder}; encodeUnityStaticFalsePositives('const ROOT = "/assets/applovin/textures";')`,
    { encodeCheckerOnlyUrls: (source) => source }
  );
  assert.doesNotMatch(transformed, /applovin/iu, 'no literal applovin marker may survive');
  // The runtime must still resolve the real directory after JS decodes the escape.
  assert.equal(
    JSON.parse(transformed.slice(transformed.indexOf('"'), transformed.lastIndexOf('"') + 1).replaceAll('\\u0069', 'i')),
    '/assets/applovin/textures'
  );
});

test('Crowd packages use the BFT product code while Bus keeps BL', async () => {
  const { createBrandingVariantTuning } = await import('../scripts/export-playable-package.mjs');
  const { SCENE_TUNING } = await import('../src/scene-tuning.js');
  const bus = createBrandingVariantTuning(SCENE_TUNING, 'bus');
  assert.equal(bus.exportNaming.requirementCode, SCENE_TUNING.exportNaming.requirementCode);
  const crowd = createBrandingVariantTuning(SCENE_TUNING, 'crowd');
  // Crowd is a separate product; its delivery sheets use BFT and ZZN.
  assert.equal(crowd.exportNaming.requirementCode, 'BFT');
  assert.equal(crowd.exportNaming.requester, 'ZZN');
  // The rest of the naming stays whatever the editor holds.
  assert.equal(crowd.exportNaming.materialCode, SCENE_TUNING.exportNaming.materialCode);
  assert.equal(crowd.exportNaming.designer, SCENE_TUNING.exportNaming.designer);
  // Bus must not pick up the Crowd identity.
  assert.equal(bus.exportNaming.requester, SCENE_TUNING.exportNaming.requester);
  assert.notEqual(bus.exportNaming.requester, 'ZZN');
});

test('the bottom caption is centred on the CTA', async () => {
  const { SCENE_TUNING } = await import('../src/scene-tuning.js');
  // The caption sat at x=534 while the CTA was at 540, so the two looked
  // offset by a few pixels on every build. Both must share the design centre.
  const designCentre = SCENE_TUNING.preview.width / 2;
  assert.equal(SCENE_TUNING.cta.x, designCentre);
  assert.equal(SCENE_TUNING.branding.text.x, designCentre);
});


test('a fixed stage sequence that enables the entry banner still ships its art', async () => {
  const packager = await readFile(new URL('../scripts/package-applovin-single-html.mjs', import.meta.url), 'utf8');
  // The banner is requested per stage. A fixed sequence keeps its stages in
  // PLAYABLE_STAGES while a map picker keeps them in PLAYABLE_STAGE_CHOICES;
  // checking only one of them shipped the six banner sprites as 1-byte
  // octet-stream placeholders, so the banner collapsed to a line of text.
  assert.match(packager, /PLAYABLE_STAGES, PLAYABLE_STAGE_CHOICES, PLAYABLE_ALL_LEVELS/u);
  assert.match(packager, /PLAYABLE_STAGES\.some\(\(stage\) => stage\?\.opening\?\.entryBanner\?\.enabled\)/u);
  assert.match(packager, /PLAYABLE_STAGE_CHOICES\.some\(/u);
  assert.match(packager, /SCENE_TUNING\.entryBanner\?\.enabled \|\| stageBannerEnabled \|\| choiceBannerEnabled/u);
});

test('delivery variants are told apart by material code, and pre-roll by the trailing tag', async () => {
  const { applyPlayableDeliveryVariant } = await import('../scripts/export-playable-package.mjs');
  const base = {
    exportNaming: { ...EXPORT_NAMING, steps: 'N', version: 'N' },
    audio: { bgm: { enabled: 0, asset: '/assets/unity/audio/christmas_bgm.mp3' } },
    preRoll: { enabled: 0, asset: '/assets/prerolls/TP1327.mp4' }
  };
  const TP1326 = '/assets/editor-prerolls/preroll-160feafb873e-TP1326.mp4';

  // Plain and BGM variants share the trailing `N`; only the material code moves.
  const plain = applyPlayableDeliveryVariant(base, { bgm: false, materialCode: 'Q158V1' });
  assert.equal(plain.exportNaming.version, 'N');
  assert.equal(plain.exportNaming.materialCode, 'Q158V1');
  assert.equal(plain.audio.bgm.enabled, 0);
  assert.equal(plain.preRoll.enabled, 0);

  const withBgm = applyPlayableDeliveryVariant(base, { bgm: true, materialCode: 'Q158V2' });
  assert.equal(withBgm.exportNaming.version, 'N');
  assert.equal(withBgm.exportNaming.materialCode, 'Q158V2');
  assert.equal(withBgm.audio.bgm.enabled, 1);

  // Pre-roll is the only thing the trailing tag encodes.
  const withPreRoll = applyPlayableDeliveryVariant(base, { bgm: false, preRollAsset: TP1326 });
  assert.equal(withPreRoll.exportNaming.version, 'T');
  assert.equal(withPreRoll.audio.bgm.enabled, 0);
  assert.equal(withPreRoll.preRoll.enabled, 1);
  assert.equal(withPreRoll.preRoll.asset, TP1326);

  const both = applyPlayableDeliveryVariant(base, { bgm: true, preRollAsset: TP1326 });
  assert.equal(both.exportNaming.version, 'T');
  assert.equal(both.audio.bgm.enabled, 1);
  assert.equal(both.preRoll.asset, TP1326);

  assert.deepEqual(
    [
      buildPlayableArtifactName(plain, 'applovin'),
      buildPlayableArtifactName(withBgm, 'applovin'),
      buildPlayableArtifactName(withPreRoll, 'applovin'),
      buildPlayableArtifactName(both, 'applovin')
    ],
    [
      'AC-2607141-Q158V1-N-N-EN-PL-NLY-ZZN-AL-N-N.html',
      'AC-2607141-Q158V2-N-N-EN-PL-NLY-ZZN-AL-N-N.html',
      'AC-2607141-Q1V1-N-N-EN-PL-NLY-ZZN-AL-N-T.html',
      'AC-2607141-Q1V1-N-N-EN-PL-NLY-ZZN-AL-N-T.html'
    ]
  );
  // Building a variant must not mutate the base document.
  assert.equal(base.exportNaming.version, 'N');
  assert.equal(base.audio.bgm.enabled, 0);
});
