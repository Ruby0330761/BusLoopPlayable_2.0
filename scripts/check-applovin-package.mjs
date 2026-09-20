import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  getForegroundVideoAssetUrl,
  listForegroundVideos
} from './foreground-video-importer.mjs';
import {
  createPlayableBuildConfig,
  createPlayableBuildSignature,
  createPlayablePackageMetadata,
  parsePlayablePackageMetadata
} from './playable-build-config.mjs';

const ROOT = process.cwd();
const inputFlag = process.argv.findIndex((arg) => arg === '--input');
const PACKAGE_FILE = inputFlag >= 0
  ? path.resolve(process.argv[inputFlag + 1])
  : path.join(ROOT, 'artifacts', 'applovin', 'index.html');
const TUNING_FILE = path.join(ROOT, 'src', 'scene-tuning.js');
const SPATIAL_PACKAGE_ROOT = path.join(ROOT, 'artifacts', 'spatial-conveyors');
const MAX_BYTES = 5_000_000;
const BRANDING_ICON_ASSETS = [
  '/assets/icon-android.jpg',
  '/assets/icon-ios.png'
];
const ALLOWED_URLS = new Set([
  'https://play.google.com/store/apps/details?id=gridplus.busjam.carpuzzle',
  'https://apps.apple.com/app/id6746743297'
]);
const ALLOWED_URL_PREFIXES = [
  'http://www.w3.org/'
];

function collectMatches(source, pattern) {
  return [...source.matchAll(pattern)].map((match) => match[0]);
}

function getInlineModuleScripts(html) {
  return [...html.matchAll(/<script\b(?=[^>]*\btype=["']module["'])[^>]*>([\s\S]*?)<\/script>/giu)]
    .map((match) => match[1] ?? '');
}

function inlineModulesAreSyntaxValid(html) {
  try {
    for (const script of getInlineModuleScripts(html)) {
      // The Vite production bundle is self-contained; this catches corrupted
      // inline JS before upload, such as broken string literals after packaging.
      new Function(script);
    }
    return true;
  } catch {
    return false;
  }
}

function mimeForAsset(asset) {
  const extension = path.extname(asset).toLowerCase();
  return new Map([
    ['.jpg', 'image/jpeg'],
    ['.jpeg', 'image/jpeg'],
    ['.png', 'image/png'],
    ['.mp3', 'audio/mpeg'],
    ['.mp4', 'video/mp4'],
    ['.wav', 'audio/wav'],
    ['.webm', 'video/webm'],
    ['.webp', 'image/webp'],
    ['.ttf', 'font/ttf']
  ]).get(extension) ?? 'application/octet-stream';
}

async function assetDataUri(asset) {
  const filePath = path.join(ROOT, 'public', asset.replace(/^\//u, ''));
  const bytes = await readFile(filePath);
  return `data:${mimeForAsset(asset)};base64,${bytes.toString('base64')}`;
}

async function main() {
  const [{ PLAYABLE_LEVEL_SEQUENCE }, {
    MECHANISM_RESOURCE_MANIFEST,
    getOrdinaryConveyorResourcePath,
    getMechanismResourcePaths,
    getMechanismTypesForLevels
  }, {
    PLAYABLE_BUILD_CONFIG,
    PLAYABLE_BUILD_SIGNATURE
  }] = await Promise.all([
    import('../src/generated-active-level.js'),
    import('../src/mechanism-resources.js'),
    import('../src/generated-playable-build-config.js')
  ]);
  const tuningUrl = `${pathToFileURL(TUNING_FILE).href}?t=${Date.now()}`;
  const { SCENE_TUNING } = await import(tuningUrl);
  const expectedBuildConfig = createPlayableBuildConfig(SCENE_TUNING);
  const expectedBuildSignature = createPlayableBuildSignature(expectedBuildConfig);
  const expectedPackageMetadata = createPlayablePackageMetadata(
    expectedBuildConfig,
    expectedBuildSignature
  );
  const selectedIconAsset = SCENE_TUNING.branding?.icon?.asset;
  if (!BRANDING_ICON_ASSETS.includes(selectedIconAsset)) {
    throw new Error(`Unsupported branding Icon asset: ${selectedIconAsset}`);
  }
  const unselectedIconAsset = BRANDING_ICON_ASSETS.find((asset) => asset !== selectedIconAsset);
  const selectedConveyor = SCENE_TUNING.conveyorLayout?.selected;
  const selectedSpatialId = typeof selectedConveyor === 'string' && selectedConveyor.startsWith('spatial:')
    ? selectedConveyor.slice('spatial:'.length)
    : null;
  const selectedSpatialPackage = selectedSpatialId
    ? JSON.parse(await readFile(path.join(SPATIAL_PACKAGE_ROOT, `${selectedSpatialId}.json`), 'utf8'))
    : null;
  const mechanismTypes = getMechanismTypesForLevels(PLAYABLE_LEVEL_SEQUENCE, {
    spatialSelection: selectedConveyor,
    entryBannerEnabled: Boolean(SCENE_TUNING.entryBanner?.enabled),
    passengerEmojiEnabled: Boolean(SCENE_TUNING.passengerEmoji?.enabled),
    randomPlayableAudioEnabled: Boolean(SCENE_TUNING.randomPlayableAudio?.enabled)
  });
  const selectedMechanismUrls = getMechanismResourcePaths(mechanismTypes, {
    conveyorSelection: selectedConveyor
  });
  const allMechanismUrls = getMechanismResourcePaths(Object.keys(MECHANISM_RESOURCE_MANIFEST));
  const selectedMechanismDataUris = await Promise.all(
    selectedMechanismUrls.map((asset) => assetDataUri(asset))
  );
  const omittedMechanismUrls = allMechanismUrls.filter((asset) => !selectedMechanismUrls.includes(asset));
  const omittedMechanismDataUris = await Promise.all(
    omittedMechanismUrls.map((asset) => assetDataUri(asset))
  );
  const foregroundVideoAsset = SCENE_TUNING.foregroundVideo?.enabled
    && SCENE_TUNING.foregroundVideo?.selected
    ? getForegroundVideoAssetUrl(SCENE_TUNING.foregroundVideo.selected)
    : null;
  const foregroundTransitionAsset = foregroundVideoAsset
    && SCENE_TUNING.foregroundVideo?.transitionEnabled !== 0
    && SCENE_TUNING.foregroundVideo?.transitionSelected
    ? getForegroundVideoAssetUrl(SCENE_TUNING.foregroundVideo.transitionSelected)
    : null;
  const importedForegroundVideos = await listForegroundVideos();
  const importedForegroundVideoDataUris = await Promise.all(
    importedForegroundVideos.map((item) => assetDataUri(item.assetUrl))
  );
  const selectedForegroundVideoDataUri = foregroundVideoAsset
    ? await assetDataUri(foregroundVideoAsset)
    : null;
  const selectedForegroundTransitionDataUri = foregroundTransitionAsset
    ? await assetDataUri(foregroundTransitionAsset)
    : null;
  const selectedForegroundAssetUrls = new Set([
    foregroundVideoAsset,
    foregroundTransitionAsset
  ].filter(Boolean));
  const selectedOrdinaryConveyorAsset = getOrdinaryConveyorResourcePath(selectedConveyor);
  const selectedOrdinaryConveyorDataUri = selectedOrdinaryConveyorAsset
    ? await assetDataUri(selectedOrdinaryConveyorAsset)
    : null;
  const configuredLevelKey = String(SCENE_TUNING.level?.selected ?? '');
  const generatedLevelKey = String(PLAYABLE_LEVEL_SEQUENCE[0]?.key ?? '');

  function containsMechanismReference(asset) {
    if (html.includes(asset)) return true;
    if (!asset.startsWith('/assets/unity/mechanisms/')) return false;
    const tail = asset.slice('/assets/unity/mechanisms'.length)
      .replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
    return new RegExp(`\\$\\{[A-Za-z_$][\\w$]*\\}${tail}`, 'u').test(html);
  }
  const [{ size }, html, selectedIconDataUri, unselectedIconDataUri, smallLogoDataUri, legacyLogoDataUri] = await Promise.all([
    stat(PACKAGE_FILE),
    readFile(PACKAGE_FILE, 'utf8'),
    assetDataUri(selectedIconAsset),
    assetDataUri(unselectedIconAsset),
    assetDataUri('/assets/main-loading-icon-small.png'),
    assetDataUri('/assets/main-loading-icon.png')
  ]);
  let packageMetadata = null;
  let packageMetadataError = '';
  try {
    packageMetadata = parsePlayablePackageMetadata(html);
  } catch (error) {
    packageMetadataError = error instanceof Error ? error.message : String(error);
  }
  const generatedBuildConfigMatches = (
    JSON.stringify(PLAYABLE_BUILD_CONFIG) === JSON.stringify(expectedBuildConfig)
    && PLAYABLE_BUILD_SIGNATURE === expectedBuildSignature
  );
  const packageMetadataMatches = (
    JSON.stringify(packageMetadata) === JSON.stringify(expectedPackageMetadata)
  );
  const runtimeSignatureMatches = getInlineModuleScripts(html)
    .some((script) => script.includes(expectedBuildSignature));

  const checks = [
    {
      name: 'generated level matches scene tuning',
      pass: !configuredLevelKey || generatedLevelKey === configuredLevelKey,
      detail: `${generatedLevelKey || 'none'} / ${configuredLevelKey || 'unset'}`
    },
    {
      name: 'generated redirect/retry snapshot matches scene tuning',
      pass: generatedBuildConfigMatches,
      detail: expectedBuildSignature
    },
    {
      name: 'package metadata exactly matches redirect/retry settings',
      pass: packageMetadataMatches,
      detail: packageMetadataError || JSON.stringify(packageMetadata?.installGate ?? 'missing')
    },
    {
      name: 'runtime bundle signature matches package metadata',
      pass: runtimeSignatureMatches,
      detail: expectedBuildSignature
    },
    {
      name: 'single HTML size <= 5,000,000 bytes',
      pass: size <= MAX_BYTES,
      detail: `${size} bytes`
    },
    {
      name: 'no external script src',
      pass: [...html.matchAll(/<script\b([^>]*)>[\s\S]*?<\/script>/giu)]
        .every((match) => !/\bsrc\s*=/iu.test(match[1] ?? ''))
    },
    {
      name: 'inline module syntax valid',
      pass: inlineModulesAreSyntaxValid(html)
    },
    {
      name: 'no external stylesheet link',
      pass: !collectMatches(html, /<link\b[^>]*>/giu)
        .some((tag) => /\bhref\s*=/iu.test(tag))
    },
    {
      name: 'no root-relative asset URLs',
      pass: !/(?:src|href)=["']\/|url\(["']?\/|\/assets\//iu.test(html)
    },
    {
      name: 'no WAV references',
      pass: !/\.wav\b/iu.test(html)
    },
    {
      name: 'MRAID CTA bridge present',
      pass: /mraid\.open/iu.test(html)
    },
    {
      name: 'no browser window.open fallback',
      pass: !/window\.open/iu.test(html)
    },
    {
      name: 'data URL fetch compatibility layer present',
      pass: /installDataUrlFetchCompat/iu.test(html) &&
        /dataUrlFetchCompat/iu.test(html) &&
        /new Response\(bytes/iu.test(html)
    },
    {
      name: 'inline binary data assets present',
      pass: /data:application\/octet-stream;base64/iu.test(html)
    },
    {
      name: 'selected mechanism resources inlined',
      pass: selectedMechanismDataUris.every((dataUri) => html.includes(dataUri)),
      detail: mechanismTypes.join(', ')
    },
    {
      name: 'selected ordinary conveyor layout inlined',
      pass: !selectedOrdinaryConveyorDataUri || (
        html.includes(selectedOrdinaryConveyorDataUri)
        && html.includes(selectedConveyor)
      ),
      detail: selectedOrdinaryConveyorAsset ?? 'spatial or unset'
    },
    {
      name: 'unselected mechanism resources omitted',
      pass: omittedMechanismUrls.every((asset) => !containsMechanismReference(asset))
        && omittedMechanismDataUris.every((dataUri) => !html.includes(dataUri)),
      detail: `${omittedMechanismUrls.length} resources omitted`
    },
    {
      name: 'foreground video follows display selection',
      pass: selectedForegroundVideoDataUri
        ? html.includes(
            `globalThis.__BUS_LOOP_FOREGROUND_VIDEO_ASSET__=${JSON.stringify(selectedForegroundVideoDataUri)}`
          )
        : importedForegroundVideoDataUris.every((dataUri) => !html.includes(dataUri)),
      detail: selectedForegroundVideoDataUri ? SCENE_TUNING.foregroundVideo.selected : 'disabled'
    },
    {
      name: 'foreground transition follows display selection',
      pass: selectedForegroundTransitionDataUri
        ? html.includes(
            `globalThis.__BUS_LOOP_FOREGROUND_TRANSITION_ASSET__=${JSON.stringify(selectedForegroundTransitionDataUri)}`
          )
        : !/globalThis\.__BUS_LOOP_FOREGROUND_TRANSITION_ASSET__\s*=/u.test(html),
      detail: selectedForegroundTransitionDataUri
        ? SCENE_TUNING.foregroundVideo.transitionSelected
        : 'disabled or unselected'
    },
    {
      name: 'unselected foreground videos omitted',
      pass: importedForegroundVideos.every((item, index) => (
        selectedForegroundAssetUrls.has(item.assetUrl)
        || !html.includes(importedForegroundVideoDataUris[index])
      )),
      detail: `${Math.max(0, importedForegroundVideos.length - selectedForegroundAssetUrls.size)} videos omitted`
    },
    {
      name: 'iOS App Store direct scheme present',
      pass: /itms-apps:\/\/itunes\.apple\.com\/app\/id6746743297/iu.test(html)
    },
    {
      name: 'MRAID ready/default wait present',
      pass: /\.getState\(\)/u.test(html) &&
        /\.addEventListener\(["']ready["']/u.test(html) &&
        /["']loading["']/u.test(html) &&
        /["']default["']/u.test(html)
    },
    {
      name: 'inline image assets present',
      pass: /data:image\//iu.test(html)
    },
    {
      name: 'selected spatial conveyor package inlined',
      pass: !selectedSpatialPackage || (
        selectedSpatialPackage.id === selectedSpatialId &&
        html.includes(selectedConveyor) &&
        html.includes(selectedSpatialPackage.visual?.material?.loopTextureDataUrl) &&
        html.includes(selectedSpatialPackage.visual?.material?.exitTextureDataUrl)
      ),
      detail: selectedSpatialPackage ? selectedConveyor : 'ordinary conveyor selected'
    },
    {
      name: 'branding overlay markup present',
      pass: /id=["']branding-overlay["']/iu.test(html) &&
        /id=["']branding-text["']/iu.test(html)
    },
    {
      name: 'retry controls and transition included',
      pass: /id=["']retry-button["']/iu.test(html)
        && /id=["']game-over-retry-button["']/iu.test(html)
        && /id=["']retry-transition["']/iu.test(html)
        && /\.retry-button\{/u.test(html)
        && /\.game-over-retry-button\{/u.test(html)
        && /\.retry-transition\{/u.test(html)
    },
    {
      name: 'retry and install-gate runtime included',
      pass: [
        'restartCurrentLevel',
        'successfulOperationThreshold',
        'continueAfterStoreOpen',
        'vehicleExitGateEnabled',
        'vehicleExitLevelKey',
        'vehicleExitIds',
        'recordVehicleExit',
        'isVehicleExitGateReady',
        'retryEnabled'
      ].every((token) => html.includes(token))
    },
    {
      name: 'selected branding Icon and small Logo images inlined',
      pass: html.includes(selectedIconDataUri) &&
        html.includes(smallLogoDataUri) &&
        /<img\b(?=[^>]*\bid=["']branding-logo["'])(?=[^>]*\bsrc=["']data:image\/png;base64,)[^>]*>/iu.test(html)
    },
    {
      name: 'unselected branding Icon omitted',
      pass: !html.includes(unselectedIconDataUri)
    },
    {
      name: 'legacy large branding Logo omitted',
      pass: !html.includes(legacyLogoDataUri)
    },
    {
      name: 'branding Poppins font inlined',
      pass: /font-family:["']?Poppins Branding["']?/iu.test(html) &&
        /src:url\(["']?data:font\/ttf;base64,/iu.test(html)
    },
    {
      name: 'inline audio assets present',
      pass: /data:audio\/mpeg/iu.test(html)
    },
    {
      name: 'no disallowed remote URLs',
      pass: collectMatches(html, /https?:\/\/[^"'`\s<>)]+/giu)
        .every((url) => (
          ALLOWED_URLS.has(url) ||
          ALLOWED_URL_PREFIXES.some((prefix) => url.startsWith(prefix))
        )),
      detail: collectMatches(html, /https?:\/\/[^"'`\s<>)]+/giu)
        .filter((url) => (
          !ALLOWED_URLS.has(url) &&
          !ALLOWED_URL_PREFIXES.some((prefix) => url.startsWith(prefix))
        ))
        .join(', ')
    }
  ];

  for (const check of checks) {
    const detail = check.detail ? ` (${check.detail})` : '';
    console.log(`${check.pass ? 'PASS' : 'FAIL'} ${check.name}${detail}`);
  }

  if (checks.some((check) => !check.pass)) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
