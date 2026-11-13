import { LEVEL_OPTIONS } from './level-catalog.js';
import {
  isSpatialConveyorSelection,
  refreshSpatialConveyorPackages
} from './spatial-conveyor-runtime.js';
import {
  retargetLevelDocument,
  validateLevelDocument
} from './level-editor-model.js';
import { LEVEL_1 } from './level-data.js';
import { isValidStoreLink } from './store-links.js';
import { detectPlayfieldHorizon, resolveBackgroundHorizon } from './background-alignment.js';
import { BUILD_VERSION } from './build-version.js';
import { BUILD_CHANGELOG, changelogVersions } from './build-changelog.js';
import { COUNTDOWN_SIREN_ASSET, COUNTDOWN_TIMER_ASSET, normalizeCountdownConfig } from './countdown.js';
import { BRANDING_LOCALE_OPTIONS } from './branding-localization.js';
import { getStaminaAssetPaths, normalizeStaminaConfig } from './stamina.js';
import { getExportVariantPlan, isInstallGateEnabled, parseExportVariantValues, syncExportVariantTuning } from './export-variants.js';
import {
  BASE_RUNTIME_ASSET_PATHS,
  PROGRESS_HUD_ASSET_PATHS,
  getMechanismResourcePaths,
  getMechanismTypesForLevels
} from './mechanism-resources.js';
import { LEVEL_AUDIO_CONFIG } from './level-audio-config.js';
import { collectPlayableInlineAssetUrls } from './playable-inline-assets.js';
import {
  ACTIVE_PLAYABLE_SESSION,
  PLAYABLE_ALL_LEVELS,
  PLAYABLE_STAGES,
  PLAYABLE_STAGE_CHOICES
} from './generated-active-level.js';
import {
  isForeignLevelOwner,
  levelOwnerHeaders,
  normalizeLevelOwner,
  readStoredLevelOwner,
  storeLevelOwner
} from './level-owner.js';

// Operator preference for the level dropdown order; kept out of scene tuning
// so it never leaks into exported playable packages.
const LEVEL_SORT_STORAGE_KEY = 'bus-loop-level-sort-v1';
const LEVEL_SORT_MODES = Object.freeze(['number', 'name', 'created']);

const CONVEYOR_LAYOUT_OPTIONS = [
  ['dualQueue2', 'GameSceneDualQueue2'],
  ['dualQueue3', 'GameSceneDualQueue3'],
  ['dualQueue5', 'GameSceneDualQueue5'],
  ['dualQueue10', 'GameSceneDualQueue10'],
  ['starLoop', '星形跑道 StarLoop'],
  ['heartLoop', '爱心跑道 HeartLoop'],
  ['catLoop', '猫咪跑道 CatLoop'],
  ['moonLoop', '月亮跑道 MoonLoop'],
  ['dualLoop5', '双线跑道 DualLoop5'],
  ['hexLoop', '六边跑道 HexLoop'],
  ['crossLoop', '十字跑道 CrossLoop'],
  ['footage8', '立体轨道 Footage8（双入口）'],
  ['footage9', '立体轨道 Footage9（双入口）'],
  ['footage10', '立体轨道 Footage10（双入口）'],
  ['footage11', 'Q37 平面轨道 Footage11（单入口）'],
];

// Tracks imported from shipped playables are tuned through a flat per-track
// block rather than the art/curve/queueCurves shape the Unity prefab loops use,
// so they get their own field groups instead of makeConveyorLayoutGroups.
const PLAYABLE_TRACK_DEFINITIONS = [
  ['footage8', '立体轨道 Footage8', { roadJoin: true }],
  ['footage9', '立体轨道 Footage9', { roadJoin: true }],
  ['footage10', '立体轨道 Footage10', { roadJoin: false }],
  ['footage11', 'Q37 平面轨道 Footage11', { roadJoin: false, leftQueue: true }]
];

function makePlayableTrackGroups(layoutId, label, { roadJoin, leftQueue }) {
  const root = `playableTracks.${layoutId}`;
  const groups = [
    { title: `${label} - 摆放`, fields: [
      ['X 位移', `${root}.positionX`, -8, 8, 0.05],
      ['Y 位移', `${root}.positionY`, -2, 3, 0.005],
      ['Z 位移', `${root}.positionZ`, -12, 8, 0.05],
      ['缩放', `${root}.scale`, 0.25, 5, 0.05],
      ['Y 旋转', `${root}.rotationYDegrees`, -180, 180, 1]
    ] },
    { title: `${label} - 载客节奏`, fields: [
      ['行距', `${root}.rowSpacing`, 0.12, 0.8, 0.01],
      ['运行速度', `${root}.speed`, 0.1, 3, 0.05],
      ['初始填充倍速', `${root}.initialFillSpeedMultiplier`, 1, 8, 0.5],
      ['上车位置 %', `${root}.boardingPositionPercent`, 0, 100, 0.25],
      ['上车宽度 %', `${root}.boardingWidthPercent`, 1, 40, 0.5],
      ['贴地间隙', `${root}.footClearance`, 0, 0.1, 0.002]
    ] },
    { title: `${label} - 显示`, fields: [
      ['显示上车区', `${root}.showBoardingZone`, 0, 1, 1, null, 'toggle']
    ] }
  ];
  if (leftQueue) {
    groups.at(-1).fields.push(['显示左队列', `${root}.showLeftQueue`, 0, 1, 1, null, 'toggle']);
  }
  if (roadJoin) {
    groups.push({ title: `${label} - 道路接驳`, fields: [
      ['启用接驳', `${root}.roadJoinEnabled`, 0, 1, 1, null, 'toggle'],
      ['接驳长度', `${root}.roadJoinExtension`, -1, 1, 0.01],
      ['接驳落点', `${root}.roadJoinLanding`, 0, 1, 0.01],
      ['接驳段数', `${root}.roadJoinSteps`, 1, 8, 1],
      ['乘客尺寸倍率', `${root}.passengerSizeMultiplier`, 0.5, 2, 0.05]
    ] });
  }
  return groups.map((group) => ({ ...group, conveyorLayout: layoutId }));
}

const PLAYABLE_TRACK_FIELD_GROUPS = PLAYABLE_TRACK_DEFINITIONS.flatMap(
  ([layoutId, label, flags]) => makePlayableTrackGroups(layoutId, label, flags)
);

const BACKGROUND_OPTIONS = [
  ['/assets/applovin/textures/BG01_split01_q60.jpg', 'BG01 \u51ac\u5b63'],
  ['/assets/applovin/textures/BG02_split01_winter_q60.jpg', 'BG02 \u51ac\u5b63'],
  ['/assets/applovin/textures/BG02_split01_summer_q60.jpg', 'BG02 \u590f\u5b63'],
  ['/assets/applovin/textures/BG01_split01_Sakura_q60.jpg', 'BG01 \u6a31\u82b1'],
  ['/assets/applovin/textures/BG01_split01_Grassland_q60.jpg', 'BG01 \u8349\u5730']
];

// BL ships both store icons inside one package; the device UA picks one at
// runtime. These options only choose which art the editor preview shows, so
// "BL 安卓" and "BL iOS" are two previews of the same BL export.
const BRANDING_ICON_OPTIONS = [
  ['/assets/icon-android.jpg', 'BL \u5b89\u5353'],
  ['/assets/icon-ios.png', 'BL iOS'],
  ['/assets/icon-crowd.jpg', 'BFT']
];

const BRANDING_LOGO_OPTIONS = [
  ['/assets/main-loading-icon-small.png', 'BL'],
  ['/assets/main-loading-icon-crowd.webp', 'BFT']
];

const PLAYABLE_EXPORT_BRANDING_SETS = [
  ['bus', 'BL\uff1a\u5b89\u5353 / iOS \u5408\u5e76\u4e00\u5957'],
  ['crowd', 'BFT\uff1a\u5b89\u5353 / iOS \u5408\u5e76\u4e00\u5957']
];

const PRE_ROLL_OPTIONS = [
  ['/assets/preroll/TP1327.mp4', 'TP1327 (3.0s)'],
  ['/assets/preroll/TP1333.mp4', 'TP1333 (4.8s)'],
  ['/assets/preroll/TP1334.mp4', 'TP1334 (5.0s)']
];

// Built-in background-music choices. The editor appends every uploaded track
// from the BGM library, so this list only seeds the picker before the first
// fetch resolves.
const BGM_OPTIONS = [
  ['/assets/unity/audio/christmas_bgm.mp3', '\u5723\u8bde BGM']
];

const WEATHER_MODE_OPTIONS = [
  ['rain', '\u96e8'],
  ['snow', '\u96ea'],
  ['wind', '\u98ce'],
  ['leaf', '\u843d\u53f6']
];

const PLAYABLE_EXPORT_PLATFORMS = [
  ['applovin', 'AppLovin', 'HTML'],
  ['google-ads', 'Google Ads', 'ZIP'],
  ['meta', 'Meta', 'ZIP'],
  ['unityads', 'Unity Ads', 'HTML'],
  ['mintegral', 'Mintegral', 'ZIP'],
  ['moloco', 'Moloco', 'HTML'],
  ['tiktok', 'TikTok', 'ZIP']
];

const SCREENSHOT_SIZE_OPTIONS = [
  ['720x1280', '720 x 1280'],
  ['1080x1920', '1080 x 1920']
];

const CUSTOM_BACKGROUND_ENDPOINT = '/__background-assets';
const CUSTOM_BACKGROUND_MAX_SOURCE_BYTES = 20 * 1024 * 1024;
const CUSTOM_BACKGROUND_MAX_OUTPUT_BYTES = 360 * 1024;
const CUSTOM_BACKGROUND_OUTPUT_WIDTH = 2100;
const CUSTOM_BACKGROUND_OUTPUT_HEIGHT = 3382;
const CUSTOM_BACKGROUND_QUALITIES = [0.72, 0.66, 0.6, 0.54, 0.48, 0.42, 0.36];
const CUSTOM_PRE_ROLL_ENDPOINT = '/__pre-roll-assets';
const CUSTOM_PRE_ROLL_ASSET_PREFIX = '/assets/editor-prerolls/';
const CUSTOM_PRE_ROLL_MAX_SOURCE_BYTES = 50 * 1024 * 1024;

// Every image the editor stores is inlined into a single-file ad, so what an
// operator uploads is not what ships: a 4 MB PNG would cost ~5.4 MB of base64 on
// its own and blow the platform budget before any game art is added. Uploads are
// therefore re-encoded to WebP here, in the browser, at the smallest quality that
// keeps the file inside the per-asset cap.
const IMAGE_UPLOAD_MAX_OUTPUT_BYTES = 320 * 1024;
const IMAGE_UPLOAD_QUALITIES = [0.86, 0.8, 0.74, 0.68, 0.6, 0.52, 0.44, 0.36];
// WebP quality alone cannot help a 4000px-wide sprite that is drawn at 300
// design units, so the ladder also steps the longest edge down.
const IMAGE_UPLOAD_MAX_EDGES = [1600, 1280, 1024, 800, 640];

function formatKilobytes(bytes) {
  const value = Number(bytes) || 0;
  return value >= 1024 * 1024
    ? `${(value / 1024 / 1024).toFixed(2)} MB`
    : `${Math.max(1, Math.round(value / 1024))} KB`;
}

const EDITOR_CATEGORIES = [
  ['level', '\u5173\u5361'],
  ['visual', '\u753b\u9762'],
  ['conveyor', '\u4f20\u9001\u5e26'],
  ['vehicle', '\u8f66\u8f86'],
  ['guide', '\u5f15\u5bfc'],
  ['export', '\u5bfc\u51fa']
];

function editorCategoryForGroup(group) {
  // A group may declare its tab explicitly; sections whose rows are built by a
  // custom panel (free-asset layers) have no tuning path to infer from.
  if (group.category) return group.category;
  const path = group.fields?.[0]?.[1] ?? '';
  if (path.startsWith('exportNaming.')) return 'export';
  if (path.startsWith('level.')) return 'level';
  if (/^(?:conveyorLayout|conveyorLayouts|playableTracks|spatialConveyor|queueCurves|passengerShadows)\./.test(path)) {
    return 'conveyor';
  }
  if (/^(?:parkingSpots|vehiclePath|vehicleDeparturePath|vehicleArea)\./.test(path)) return 'vehicle';
  // Sound belongs with the guide stage: the BGM library, its delay/volume
  // controls and the effect groups are all part of setting up an opening beat.
  if (/^(?:cta|speedToggle|countdown|stamina|installGate|gameOver|vehicleGuideHand|firstClickGuide|entryBanner|weatherEffect|freeAssets|audio)\./.test(path)) return 'guide';
  if (path.startsWith('preRoll.')) return 'guide';
  return 'visual';
}

export function getVehicleIdOptions(vehicles = []) {
  return [...new Set(vehicles
    .map((vehicle) => Number(vehicle?.id))
    .filter((id) => Number.isInteger(id) && id > 0))]
    .sort((left, right) => left - right)
    .map((id) => [String(id), String(id)]);
}

export function normalizeVehicleIdSelection(value) {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}

function saveTextFile(filename, text, type) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

// The server only ever sees the layout file, because scene tuning lives in this
// browser's per-level profile. Attach the tuning on the way out so "export
// level" actually carries parking spots, the vehicle layer, and the
// camera/background values. The level identity is dropped: importing retargets
// the tuning to the key the new level gets.
export function attachTuningToExportedLevel(raw, levelKey, tuning) {
  let document;
  try {
    document = JSON.parse(raw);
  } catch {
    // A Unity .asset export is YAML and has no place for scene tuning.
    return null;
  }
  if (document?.format !== 'bus-loop-web-level-v1' || document?.key !== levelKey) return null;
  const sceneTuning = tuning && typeof tuning === 'object' && !Array.isArray(tuning)
    ? structuredClone(tuning)
    : null;
  if (!sceneTuning) return null;
  if (sceneTuning.level) delete sceneTuning.level.selected;
  return `${JSON.stringify({ ...document, tuning: sceneTuning }, null, 2)}\n`;
}

function isValidExportNamingPart(value) {
  const normalized = String(value ?? '').trim();
  return normalized.length === 0
    || (normalized.length <= 64
      && !normalized.includes('..')
      && /^[A-Za-z0-9_-]+$/.test(normalized));
}

function isCustomBackgroundAsset(value) {
  return typeof value === 'string' && value.startsWith('/assets/editor-backgrounds/');
}

function isCustomPreRollAsset(value) {
  return typeof value === 'string'
    && value.startsWith(CUSTOM_PRE_ROLL_ASSET_PREFIX)
    && pathBasename(value) === value.slice(CUSTOM_PRE_ROLL_ASSET_PREFIX.length)
    && /^[A-Za-z0-9][A-Za-z0-9._-]{0,119}\.mp4$/iu.test(pathBasename(value));
}

function pathBasename(value) {
  return String(value ?? '').split('/').pop() ?? '';
}

function isSupportedPreRollFile(file) {
  return file
    && file.size > 0
    && file.size <= CUSTOM_PRE_ROLL_MAX_SOURCE_BYTES
    && /\.mp4$/iu.test(file.name ?? '');
}

function formatAssetBytes(bytes) {
  const value = Number(bytes);
  if (!Number.isFinite(value) || value < 0) return '未知大小';
  if (value < 1024 * 1024) return `${Math.max(1, Math.round(value / 1024))} KB`;
  return `${(value / (1024 * 1024)).toFixed(2)} MB`;
}

function sanitizeBackgroundDownloadName(value, fallback = 'background') {
  const normalized = String(value ?? '')
    .trim()
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-')
    .replace(/\s+/g, ' ')
    .replace(/[. ]+$/g, '');
  return normalized || fallback;
}

function getBackgroundDownloadFilename(asset, label) {
  let pathname = '';
  try {
    pathname = new URL(asset, window.location.href).pathname;
  } catch {
    pathname = String(asset ?? '');
  }
  const extension = pathname.match(/\.[a-z0-9]+$/i)?.[0]?.toLowerCase() || '.jpg';
  const baseLabel = String(label ?? '').replace(/\.[a-z0-9]+$/i, '');
  return `${sanitizeBackgroundDownloadName(baseLabel)}${extension}`;
}

function getPreRollDownloadFilename(asset, label) {
  let pathname = '';
  try {
    pathname = new URL(asset, window.location.href).pathname;
  } catch {
    pathname = String(asset ?? '');
  }
  const fallback = pathBasename(pathname).replace(/\.mp4$/iu, '') || 'pre-roll';
  const baseLabel = String(label ?? '')
    .replace(/^\s*自定义\s*/u, '')
    .replace(/\.mp4$/iu, '');
  return `${sanitizeBackgroundDownloadName(baseLabel, fallback)}.mp4`;
}

function isSupportedBackgroundFile(file) {
  return file
    && file.size > 0
    && file.size <= CUSTOM_BACKGROUND_MAX_SOURCE_BYTES
    && /\.(?:png|jpe?g|webp)$/i.test(file.name ?? '')
    && /^image\/(?:png|jpe?g|webp)$/i.test(file.type || 'image/jpeg');
}

function loadImageFromFile(file) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    const objectUrl = URL.createObjectURL(file);
    const cleanup = () => URL.revokeObjectURL(objectUrl);
    image.onload = () => {
      cleanup();
      resolve(image);
    };
    image.onerror = () => {
      cleanup();
      reject(new Error('\u80cc\u666f\u56fe\u65e0\u6cd5\u8bfb\u53d6'));
    };
    image.decoding = 'async';
    image.src = objectUrl;
  });
}

function canvasToJpegBlob(canvas, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error('\u80cc\u666f\u56fe\u538b\u7f29\u5931\u8d25'));
    }, 'image/jpeg', quality);
  });
}

function canvasToWebpBlob(canvas, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error('\u56fe\u7247\u538b\u7f29\u5931\u8d25'));
        return;
      }
      // Browsers without a WebP encoder silently hand back a PNG. Accepting it
      // would ship the exact oversized file this path exists to remove.
      if (blob.type && blob.type !== 'image/webp') {
        reject(new Error('\u5f53\u524d\u6d4f\u89c8\u5668\u4e0d\u652f\u6301 WebP \u538b\u7f29'));
        return;
      }
      resolve(blob);
    }, 'image/webp', quality);
  });
}

function drawScaledToCanvas(image, maxEdge) {
  const sourceWidth = image.naturalWidth || image.width;
  const sourceHeight = image.naturalHeight || image.height;
  const scale = Math.min(1, maxEdge / Math.max(sourceWidth, sourceHeight));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(sourceWidth * scale));
  canvas.height = Math.max(1, Math.round(sourceHeight * scale));
  const context = canvas.getContext('2d');
  if (!context) throw new Error('\u6d4f\u89c8\u5668\u65e0\u6cd5\u5904\u7406\u56fe\u7247');
  context.imageSmoothingQuality = 'high';
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  return canvas;
}

/**
 * Re-encode an uploaded image to WebP under `IMAGE_UPLOAD_MAX_OUTPUT_BYTES`.
 *
 * Walks quality first, then the longest edge, and stops at the first
 * combination inside the cap. A WebP that is already inside the cap is passed
 * through untouched: re-encoding it can only lose quality.
 */
async function compressUploadedImage(file, { maxBytes = IMAGE_UPLOAD_MAX_OUTPUT_BYTES } = {}) {
  const alreadyWebp = /\.webp$/i.test(file.name ?? '') && /^image\/webp$/i.test(file.type || '');
  if (alreadyWebp && file.size <= maxBytes) {
    return { blob: file, filename: file.name, compressed: false, sourceBytes: file.size };
  }
  const image = await loadImageFromFile(file);
  for (const maxEdge of IMAGE_UPLOAD_MAX_EDGES) {
    const canvas = drawScaledToCanvas(image, maxEdge);
    for (const quality of IMAGE_UPLOAD_QUALITIES) {
      const blob = await canvasToWebpBlob(canvas, quality);
      if (blob.size <= maxBytes) {
        return {
          blob,
          filename: `${file.name.replace(/\.[^.]+$/u, '')}.webp`,
          compressed: true,
          sourceBytes: file.size,
          width: canvas.width,
          height: canvas.height
        };
      }
    }
  }
  throw new Error(`图片压缩后仍超过 ${Math.round(maxBytes / 1024)} KB，请缩小尺寸后再上传`);
}

async function prepareBackgroundUpload(file) {
  if (!isSupportedBackgroundFile(file)) {
    throw new Error('\u4ec5\u652f\u6301 20 MB \u4ee5\u5185\u7684 PNG\u3001JPG \u6216 WebP \u56fe\u7247');
  }
  const image = await loadImageFromFile(file);
  const sourceWidth = image.naturalWidth || image.width;
  const sourceHeight = image.naturalHeight || image.height;
  if (!sourceWidth || !sourceHeight) throw new Error('\u80cc\u666f\u56fe\u5c3a\u5bf8\u65e0\u6548');
  const width = CUSTOM_BACKGROUND_OUTPUT_WIDTH;
  const height = CUSTOM_BACKGROUND_OUTPUT_HEIGHT;
  const scale = Math.max(width / sourceWidth, height / sourceHeight);
  const drawWidth = sourceWidth * scale;
  const drawHeight = sourceHeight * scale;
  const drawX = (width - drawWidth) / 2;
  const drawY = (height - drawHeight) / 2;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('\u6d4f\u89c8\u5668\u65e0\u6cd5\u5904\u7406\u80cc\u666f\u56fe');
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, width, height);
  context.drawImage(image, drawX, drawY, drawWidth, drawHeight);
  let output = null;
  for (const quality of CUSTOM_BACKGROUND_QUALITIES) {
    output = await canvasToJpegBlob(canvas, quality);
    if (output.size <= CUSTOM_BACKGROUND_MAX_OUTPUT_BYTES) break;
  }
  // Measure the artwork's own ground line before upload, while the pixels are
  // already here. Without it a background drawn with its road→ground edge higher
  // than the reference set would render with the cars standing on the road.
  let horizon = null;
  try {
    const pixels = context.getImageData(0, 0, width, height);
    horizon = detectPlayfieldHorizon(pixels.data, { width, height });
  } catch {
    // A tainted canvas cannot be read; the background still imports and simply
    // keeps the default plane position.
  }
  return { blob: output, width, height, horizon };
}

// A saved guide id can point at a car the current level does not contain, either
// because the tuning was carried over from another level or the level was
// re-authored. Without an option for it the select silently shows the first
// vehicle, which reads as "the panel picked a car for me". Keep the stale value
// visible and labelled instead, so the mismatch is obvious.
function ensureVehicleSelectValue(select, value) {
  if (!select) return;
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) return;
  if ([...select.options].some((entry) => entry.value === String(id))) return;
  const option = document.createElement('option');
  option.value = String(id);
  option.dataset.missingVehicle = 'true';
  option.textContent = `${id} (\u672c\u5173\u65e0\u6b64\u8f66)`;
  select.append(option);
}

function ensureBackgroundSelectValue(select, value, label) {
  if (!select || !isCustomBackgroundAsset(value)) return;
  let option = [...select.options].find((entry) => entry.value === value);
  if (!option) {
    option = document.createElement('option');
    option.value = value;
    option.dataset.customBackground = 'true';
    option.textContent = label || '\u81ea\u5b9a\u4e49\u80cc\u666f';
    select.append(option);
  }
  if (label) option.textContent = label;
}

function ensurePreRollSelectValue(select, value, label) {
  if (!select || !isCustomPreRollAsset(value)) return;
  let option = [...select.options].find((entry) => entry.value === value);
  if (!option) {
    option = document.createElement('option');
    option.value = value;
    option.dataset.customPreRoll = 'true';
    option.textContent = label || '\u81ea\u5b9a\u4e49\u524d\u8d34';
    select.append(option);
  }
  if (label) option.textContent = label;
}

function applySelectedBackgroundDimensions(tuning, option) {
  const width = Number(option?.dataset?.sourceWidth);
  const height = Number(option?.dataset?.sourceHeight);
  if (Number.isFinite(width) && width > 0) tuning.background.sourceWidth = Math.round(width);
  if (Number.isFinite(height) && height > 0) tuning.background.sourceHeight = Math.round(height);
  // Carry the artwork's own playfield boundary with the artwork. The renderer
  // slides the plane by the difference against the reference set, so a
  // background drawn with its ground higher in the frame still lands its ground
  // in the same place instead of pushing the cars onto the road.
  const horizon = Number(option?.dataset?.horizon);
  if (Number.isFinite(horizon) && horizon > 0 && horizon < 1) tuning.background.horizon = horizon;
  else delete tuning.background.horizon;
  // The trim is a per-artwork correction; carrying it onto different artwork
  // would turn a small nudge into a leftover offset nobody remembers setting.
  tuning.background.horizonTrim = 0;
}

function makeConveyorLayoutGroups(layoutId, label) {
  const root = `conveyorLayouts.${layoutId}`;
  return [
    {
      title: `${label} - \u56fe\u7247`,
      conveyorLayout: layoutId,
      fields: [
        ['X \u5750\u6807', `${root}.art.x`, -10, 10, 0.05],
        ['Z \u5750\u6807', `${root}.art.z`, -10, 10, 0.05],
        ['X \u5c3a\u5bf8', `${root}.art.width`, 2, 24, 0.05],
        ['Z \u5c3a\u5bf8', `${root}.art.depth`, 2, 18, 0.05]
      ]
    },
    {
      title: `${label} - \u4e58\u5ba2\u8f68\u8ff9`,
      conveyorLayout: layoutId,
      fields: [
        ['\u95ed\u73af X', `${root}.curve.offsetX`, -6, 6, 0.05],
        ['\u95ed\u73af Z', `${root}.curve.offsetZ`, -6, 6, 0.05],
        ['\u95ed\u73af X \u5c3a\u5bf8', `${root}.curve.scaleX`, 0.25, 3, 0.05],
        ['\u95ed\u73af Z \u5c3a\u5bf8', `${root}.curve.scaleZ`, 0.25, 3, 0.05],
        ['\u5165\u53e3 1 X', `${root}.queueCurves.0.offsetX`, -6, 6, 0.05],
        ['\u5165\u53e3 1 Z', `${root}.queueCurves.0.offsetZ`, -6, 6, 0.05],
        ['\u5165\u53e3 2 X', `${root}.queueCurves.1.offsetX`, -6, 6, 0.05],
        ['\u5165\u53e3 2 Z', `${root}.queueCurves.1.offsetZ`, -6, 6, 0.05]
      ]
    }
  ];
}

const CONVEYOR_LAYOUT_FIELD_GROUPS = CONVEYOR_LAYOUT_OPTIONS.flatMap(([layoutId, label]) => (
  makeConveyorLayoutGroups(layoutId, label)
));

function makeEntryBannerComponentFields(label, component) {
  const root = `entryBanner.components.${component}`;
  return [
    [`${label} X 位移`, `${root}.position.x`, -600, 600, 1],
    [`${label} Y 位移`, `${root}.position.y`, -600, 600, 1],
    [`${label} Z 位移`, `${root}.position.z`, -600, 600, 1],
    [`${label} X 缩放`, `${root}.scale.x`, 0.1, 3, 0.01],
    [`${label} Y 缩放`, `${root}.scale.y`, 0.1, 3, 0.01],
    [`${label} Z 缩放`, `${root}.scale.z`, 0.1, 3, 0.01],
    [`${label} X 旋转`, `${root}.rotation.x`, -180, 180, 1],
    [`${label} Y 旋转`, `${root}.rotation.y`, -180, 180, 1],
    [`${label} Z 旋转`, `${root}.rotation.z`, -180, 180, 1]
  ];
}

const FIELD_GROUPS = [
  {
    title: '\u5bfc\u51fa\u547d\u540d',
    defaultOpen: true,
    fields: [
      ['\u9700\u6c42\u7f16\u53f7', 'exportNaming.requirementCode', 0, 0, 1, null, 'filename'],
      ['\u7d20\u6750\u7f16\u53f7', 'exportNaming.materialCode', 0, 0, 1, null, 'filename'],
      ['\u524d\u8d34/\u8bf1\u5bfc\u7f16\u53f7', 'exportNaming.iterationCode', 0, 0, 1, null, 'filename'],
      ['\u8bed\u8a00', 'exportNaming.language', 0, 0, 1, null, 'filename'],
      ['\u683c\u5f0f', 'exportNaming.format', 0, 0, 1, null, 'filename'],
      ['\u8bbe\u8ba1\u5e08', 'exportNaming.designer', 0, 0, 1, null, 'filename'],
      ['\u9700\u6c42\u4eba', 'exportNaming.requester', 0, 0, 1, null, 'filename'],
      ['\u6b65\u6570', 'exportNaming.steps', 0, 0, 1, null, 'variant'],
      // Reuse the existing tail field for one or more stamina variants. The
      // exporter expands it into scalar hp names before validating artifacts.
      ['\u5c3e\u6bb5\u7248\u672c', 'exportNaming.version', 0, 0, 1, null, 'variant'],
      ['AppLovin \u6e20\u9053', 'exportNaming.channels.applovin', 0, 0, 1, null, 'filename'],
      ['Google Ads \u6e20\u9053', 'exportNaming.channels.google-ads', 0, 0, 1, null, 'filename'],
      ['Meta \u6e20\u9053', 'exportNaming.channels.meta', 0, 0, 1, null, 'filename'],
      ['Mintegral \u6e20\u9053', 'exportNaming.channels.mintegral', 0, 0, 1, null, 'filename'],
      ['Moloco \u6e20\u9053', 'exportNaming.channels.moloco', 0, 0, 1, null, 'filename'],
      ['TikTok \u6e20\u9053', 'exportNaming.channels.tiktok', 0, 0, 1, null, 'filename'],
      ['Unity Ads \u6e20\u9053', 'exportNaming.channels.unityads', 0, 0, 1, null, 'filename']
    ]
  },
  {
    title: '\u5173\u5361',
    // Keep the level tools discoverable when the editor first opens. The
    // layout editor is the primary authoring workflow, so hiding its button
    // behind a collapsed disclosure makes it look as if the editor is broken.
    defaultOpen: true,
    fields: [
      ['\u5f53\u524d\u5173\u5361', 'level.selected', 0, 0, 1, LEVEL_OPTIONS]
    ]
  },
  {
    title: 'Icon/Logo\u8c03\u6574',
    fields: [
      ['\u9884\u89c8\u542f\u7528', 'preview.enabled', 0, 1, 1, null, 'toggle'],
      ['\u6a21\u62df\u5bbd\u5ea6', 'preview.width', 320, 2160, 1],
      ['\u6a21\u62df\u9ad8\u5ea6', 'preview.height', 320, 4320, 1],
      ['Icon \u7248\u672c', 'branding.icon.asset', 0, 0, 1, BRANDING_ICON_OPTIONS],
      ['Icon \u663e\u793a', 'branding.icon.enabled', 0, 1, 1, null, 'toggle'],
      ['Icon \u9501\u5b9a', 'branding.icon.locked', 0, 1, 1, null, 'toggle'],
      ['Icon X', 'branding.icon.x', 0, 4320, 1],
      ['Icon Y', 'branding.icon.y', 0, 4320, 1],
      ['Icon \u5bbd\u5ea6', 'branding.icon.width', 16, 2160, 1],
      ['Icon \u9ad8\u5ea6', 'branding.icon.height', 16, 2160, 1],
      ['Icon \u5706\u89d2', 'branding.icon.radius', 0, 120, 1],
      ['Logo \u7248\u672c', 'branding.logo.asset', 0, 0, 1, BRANDING_LOGO_OPTIONS],
      ['Logo \u663e\u793a', 'branding.logo.enabled', 0, 1, 1, null, 'toggle'],
      ['Logo \u9501\u5b9a', 'branding.logo.locked', 0, 1, 1, null, 'toggle'],
      ['Logo X', 'branding.logo.x', 0, 4320, 1],
      ['Logo Y', 'branding.logo.y', 0, 4320, 1],
      ['Logo \u5bbd\u5ea6', 'branding.logo.width', 16, 2160, 1],
      ['Logo \u9ad8\u5ea6', 'branding.logo.height', 16, 2160, 1],
      ['\u6587\u672c\u663e\u793a', 'branding.text.enabled', 0, 1, 1, null, 'toggle'],
      ['\u6587\u672c\u9501\u5b9a', 'branding.text.locked', 0, 1, 1, null, 'toggle'],
      ['\u6587\u672c\u5185\u5bb9', 'branding.text.content', 0, 0, 1, null, 'text'],
      ['\u6587\u672c X', 'branding.text.x', 0, 4320, 1],
      ['\u6587\u672c Y', 'branding.text.y', 0, 4320, 1],
      ['\u6587\u672c\u5bbd\u5ea6', 'branding.text.width', 16, 2160, 1],
      ['\u6587\u672c\u9ad8\u5ea6', 'branding.text.height', 16, 2160, 1],
      ['\u591a\u8bed\u8a00\u9002\u914d', 'branding.localization.enabled', 0, 1, 1, null, 'toggle'],
      ['\u8bed\u8a00\u9884\u89c8', 'branding.localization.previewLocale', 0, 0, 1, BRANDING_LOCALE_OPTIONS]
    ]
  },
  {
    title: '\u663e\u793a\u63a7\u5236',
    defaultOpen: true,
    fields: [
      ['\u6c7d\u8f66\u663e\u793a', 'visibility.vehicles', 0, 1, 1, null, 'toggle'],
      ['\u5c0f\u4eba\u663e\u793a', 'visibility.passengers', 0, 1, 1, null, 'toggle'],
      ['Play Now \u5f39\u7a97\u663e\u793a', 'cta.enabled', 0, 1, 1, null, 'toggle']
    ]
  },
  {
    title: '\u524d\u8d34\u89c6\u9891',
    defaultOpen: true,
    fields: [
      ['\u542f\u7528', 'preRoll.enabled', 0, 1, 1, null, 'toggle'],
      ['\u89c6\u9891', 'preRoll.asset', 0, 0, 1, PRE_ROLL_OPTIONS],
      ['\u64ad\u653e\u58f0\u97f3', 'preRoll.soundEnabled', 0, 1, 1, null, 'toggle'],
      ['\u6de1\u51fa\u65f6\u957f', 'preRoll.fadeDurationSeconds', 0.1, 2, 0.05]
    ]
  },
  {
    title: '\u76f8\u673a',
    fields: [
      ['\u4fef\u89d2', 'camera.elevationDegrees', 25, 80, 1],
      ['\u900f\u89c6 FOV', 'camera.fovDegrees', 1, 40, 0.1],
      ['\u76ee\u6807 X', 'camera.targetX', -10, 10, 0.05],
      ['\u76ee\u6807 Z', 'camera.targetZ', -12, 12, 0.05],
      ['\u753b\u9762\u5bbd\u5ea6', 'camera.fitWidth', 8, 30, 0.1],
      ['\u753b\u9762\u9ad8\u5ea6', 'camera.fitHeight', 8, 36, 0.1],
      ['\u5b89\u5168\u8fb9\u8ddd', 'camera.padding', 0, 3, 0.05]
    ]
  },
  {
    title: '\u65b9\u5411\u5149',
    fields: [
      ['\u542f\u7528', 'lighting.directional.enabled', 0, 1, 1],
      ['\u989c\u8272 Hex', 'lighting.directional.color', 0, 16777215, 1],
      ['\u5f3a\u5ea6', 'lighting.directional.intensity', 0, 5, 0.01],
      ['X \u5750\u6807', 'lighting.directional.position.x', -20, 20, 0.05],
      ['Y \u5750\u6807', 'lighting.directional.position.y', -2, 30, 0.05],
      ['Z \u5750\u6807', 'lighting.directional.position.z', -20, 20, 0.05],
      ['X \u89d2\u5ea6', 'lighting.directional.eulerDegrees.x', -180, 180, 0.5],
      ['Y \u89d2\u5ea6', 'lighting.directional.eulerDegrees.y', -180, 180, 0.5],
      ['Z \u89d2\u5ea6', 'lighting.directional.eulerDegrees.z', -180, 180, 0.5]
    ]
  },
  {
    title: '\u6e90\u56fe\u88c1\u5207',
    fields: [
      ['\u542f\u7528', 'sourceCrop.enabled', 0, 1, 1],
      ['\u7a97\u53e3\u5bbd', 'sourceCrop.width', 320, 2100, 1],
      ['\u7a97\u53e3\u9ad8', 'sourceCrop.height', 640, 3382, 1],
      ['X \u504f\u79fb', 'sourceCrop.offsetX', -1020, 1020, 1],
      ['Y \u504f\u79fb', 'sourceCrop.offsetY', -1222, 1222, 1]
    ]
  },
  {
    title: '\u80cc\u666f',
    fields: [
      ['\u56fe\u7247', 'background.asset', 0, 0, 1, BACKGROUND_OPTIONS],
      ['\u7f29\u653e', 'background.scale', 0.3, 3, 0.01],
      ['X \u5750\u6807', 'background.offsetX', -10, 10, 0.05],
      ['Y \u5750\u6807', 'background.offsetY', -10, 10, 0.05],
      // \u5e73\u9762\u4f1a\u81ea\u52a8\u6ed1\u52a8\uff0c\u8ba9\u6bcf\u5f20\u80cc\u666f\u81ea\u5e26\u7684\u5730\u9762\u7ebf\u843d\u5728\u53c2\u8003\u56fe\u540c\u4e00\u4f4d\u7f6e\uff1b\u8fd9\u91cc\u662f\u5728\u90a3\u4e4b\u4e0a\u7684\u624b\u5de5\u5fae\u8c03\u3002
      ['\u5730\u5e73\u7ebf\u6821\u6b63', 'background.horizonTrim', -6, 6, 0.02],
      ['\u900f\u660e\u5ea6', 'background.opacity', 0, 1, 0.01]
    ]
  },
  {
    title: '\u5c0f\u4eba\u6a21\u578b',
    fields: [
      ['\u7edf\u4e00\u5927\u5c0f', 'passengers.modelScale', 0.2, 2, 0.01],
      ['\u540c\u6392\u95f4\u8ddd', 'passengers.groupSpacing', 0.03, 0.5, 0.01],
      ['\u8fdb\u8f66\u97f3\u6548\u504f\u79fb(\u8d1f=\u63d0\u524d)', 'passengers.aboardSoundOffset', -1, 1, 0.01]
    ]
  },
  {
    title: 'CTA',
    fields: [
      ['按钮文字', 'cta.text', 0, 0, 1, null, 'text'],
      ['\u5c4f\u5e55 X', 'cta.x', 0, 1080, 1],
      ['\u5c4f\u5e55 Y', 'cta.y', 0, 2160, 1],
      ['Height', 'cta.height', 36, 140, 1],
      ['Stretch X', 'cta.stretchX', 1, 5, 0.01],
      ['Font Size', 'cta.fontSize', 12, 64, 1],
      ['Font Height', 'cta.fontHeight', 8, 100, 1],
      ['Stroke Color', 'cta.strokeColor', 0, 16777215, 1],
      ['Stroke Width', 'cta.strokeWidth', 0, 8, 0.1],
      ['Pulse Scale', 'cta.pulseScale', 1, 1.35, 0.01],
      ['Pulse Speed', 'cta.pulseSpeed', 0.1, 3, 0.01],
      ['Appear Speed', 'cta.appearSpeed', 0.1, 5, 0.01]
    ]
  },
  {
    title: '\u500d\u901f\u6309\u94ae',
    defaultOpen: true,
    fields: [
      ['\u542f\u7528', 'speedToggle.enabled', 0, 1, 1, null, 'toggle'],
      ['\u5c4f\u5e55 X', 'speedToggle.x', 0, 1080, 1],
      ['\u5c4f\u5e55 Y', 'speedToggle.y', 0, 2160, 1],
      ['\u5bbd\u5ea6', 'speedToggle.width', 40, 640, 1],
      ['\u9ad8\u5ea6', 'speedToggle.height', 24, 400, 1],
      ['\u500d\u7387', 'speedToggle.multiplier', 1, 6, 0.1]
    ]
  },
  {
    title: '\u8fdb\u5ea6\u6761',
    defaultOpen: true,
    progressHud: true,
    fields: [
      ['\u542f\u7528\u8fdb\u5ea6\u6761', 'progressHud.enabled', 0, 1, 1, null, 'toggle'],
      ['\u9ad8\u5931\u8d25\u7387\u8282\u70b9\uff08%\uff09', 'progressHud.nodePercent', 1, 99, 1],
      ['\u5931\u8d25\u7387\u6587\u6848\uff08%\uff09', 'progressHud.failPercent', 0, 100, 1],
      ['\u663e\u793a\u4e2d\u95f4\u951a\u70b9', 'progressHud.anchors', 0, 1, 1, null, 'toggle'],
      ['\u6c34\u5e73\u504f\u79fb X', 'progressHud.offsetX', -1080, 1080, 1],
      ['\u5782\u76f4\u504f\u79fb Y', 'progressHud.offsetY', -2160, 2160, 1],
      ['\u6574\u4f53\u7f29\u653e', 'progressHud.scale', 0.2, 3, 0.01],
      ['\u663e\u793a\u8f68\u9053', 'progressHud.trackVisible', 0, 1, 1, null, 'toggle'],
      // Track gradient anchors. Colours are stored as 0xRRGGBB numbers so the
      // shared colour picker applies; the percentages between them are fixed.
      ['\u8d77\u70b9\u989c\u8272', 'progressHud.spectrumStart', 0, 16777215, 1],
      ['\u524d\u6bb5\u989c\u8272', 'progressHud.spectrumEarly', 0, 16777215, 1],
      ['\u540e\u6bb5\u989c\u8272', 'progressHud.spectrumLate', 0, 16777215, 1],
      ['\u7ec8\u70b9\u989c\u8272', 'progressHud.spectrumEnd', 0, 16777215, 1]
    ]
  },
  {
    title: '倒计时挑战',
    defaultOpen: true,
    countdown: true,
    fields: [
      ['启用倒计时', 'countdown.enabled', 0, 1, 1, null, 'toggle'],
      ['倒计时时长（秒）', 'countdown.durationSeconds', 0, 120, 1, null, 'countdown-number'],
      ['临近结束红光', 'countdown.warningEnabled', 0, 1, 1, null, 'toggle'],
      ['红光提前时间（秒）', 'countdown.warningSeconds', 0, 120, 1, null, 'countdown-number'],
      // The siren belongs to the clock, not to the ambulance: the timed level
      // may keep a silent ambulance, and the clock may run on a level with none.
      ['救护车警笛循环', 'countdown.sirenEnabled', 0, 1, 1, null, 'toggle'],
      ['警笛音量', 'countdown.sirenVolume', 0, 1, 0.01],
      // The reference playable ends its countdown by opening the store instead
      // of showing Game Over. Off keeps the ordinary failure card.
      ['归零跳转商店', 'countdown.timeoutStore', 0, 1, 1, null, 'toggle'],
      ['水平偏移 X', 'countdown.offsetX', -1080, 1080, 1],
      ['垂直偏移 Y', 'countdown.offsetY', -2160, 2160, 1],
      ['整体缩放', 'countdown.scale', 0.25, 3, 0.01]
    ]
  },
  {
    title: '体力设置',
    defaultOpen: true,
    stamina: true,
    fields: [
      ['启用体力条', 'stamina.enabled', 0, 1, 1, null, 'toggle'],
      ['初始体力', 'stamina.lives', 1, 10, 1, null, 'stamina-number'],
      ['点错扣体力', 'stamina.collisionPenaltyEnabled', 0, 1, 1, null, 'toggle'],
      ['满车位救援', 'stamina.parkingRescueEnabled', 0, 1, 1, null, 'toggle'],
      ['开场体力说明', 'stamina.introEnabled', 0, 1, 1, null, 'toggle'],
      ['水平对齐', 'stamina.horizontalAlign', 0, 0, 1, [['left', '居左'], ['center', '居中'], ['right', '居右']]],
      ['水平偏移 X', 'stamina.offsetX', -1080, 1080, 1],
      ['垂直偏移 Y', 'stamina.offsetY', -2160, 2160, 1],
      ['整体缩放', 'stamina.scale', 0.25, 3, 0.01]
    ]
  },
  {
    title: '\u5546\u5e97\u8df3\u8f6c',
    fields: [
      ['按成功操作次数跳转', 'installGate.enabled', 0, 1, 1, null, 'toggle'],
      ['\u6210\u529f\u64cd\u4f5c\u6b21\u6570', 'installGate.successfulOperationThreshold', 1, 200, 1],
      ['Android \u94fe\u63a5', 'storeLinks.android', 0, 0, 1, null, 'url'],
      ['iOS \u94fe\u63a5', 'storeLinks.ios', 0, 0, 1, null, 'url']
    ]
  },
  {
    title: '\u97f3\u6548\u5ef6\u8fdf(\u6b63\u503c=\u63a8\u540e)',
    fields: [
      ['\u8f66\u8f86\u5f00\u51fa', 'audio.busFullDelay', 0, 2, 0.01],
      ['\u649e\u51fb', 'audio.busHitDelay', 0, 2, 0.01],
      ['\u5c0f\u4eba\u5165\u573a', 'audio.passengerUpDelay', 0, 2, 0.01],
      ['\u70b9\u51fb\u8f66\u8f86', 'audio.vehicleTapDelay', 0, 2, 0.01]
    ]
  },
  {
    title: '\u97f3\u6548\u97f3\u91cf(\u500d\u6570)',
    fields: [
      // A multiplier, not an absolute level: 1 keeps the volume authored on the
      // level asset, so raising it can never drift away from Unity's balance.
      ['\u70b9\u51fb\u8f66\u8f86', 'audio.vehicleTapVolume', 0, 2, 0.01]
    ]
  },
  {
    title: '\u80cc\u666f\u97f3\u4e50(BGM)',
    fields: [
      // The loop only starts on the first successful vehicle tap, so autoplay
      // policy can never reject it. Off by default: only a level that asks for
      // music should make noise.
      ['\u5f00\u542f', 'audio.bgm.enabled', 0, 1, 1, null, 'toggle'],
      // The track list is populated from the editor's BGM library; this field
      // exists so the panel can attach its upload/download/delete controls.
      ['\u66f2\u76ee', 'audio.bgm.asset', 0, 0, 1, BGM_OPTIONS],
      ['\u97f3\u91cf', 'audio.bgm.volume', 0, 1, 0.01],
      ['\u6de1\u5165(\u79d2)', 'audio.bgm.fadeInSeconds', 0, 3, 0.1]
    ]
  },
  {
    title: 'Game Over',
    fields: [
      ['Fail Delay', 'gameOver.failureDelaySeconds', 0, 8, 0.1],
      ['Mask Opacity', 'gameOver.maskOpacity', 0, 1, 0.01],
      ['Title Size', 'gameOver.titleFontSize', 24, 180, 1],
      ['Title Pop Speed', 'gameOver.titlePopSpeed', 0.1, 5, 0.01],
      ['Title Fade Speed', 'gameOver.titleFadeSpeed', 0.1, 5, 0.01],
      ['Logo X', 'gameOver.logoX', 0, 1080, 1],
      ['Logo Y', 'gameOver.logoY', 0, 2160, 1],
      ['Logo Width', 'gameOver.logoWidth', 40, 720, 1],
      ['Logo Height', 'gameOver.logoHeight', 40, 720, 1],
      ['Logo Radius', 'gameOver.logoRadius', 0, 120, 1],
      ['Logo Speed', 'gameOver.logoAppearSpeed', 0.1, 5, 0.01]
    ]
  },
  {
    // Retry gets its own open section. It used to sit at the bottom of the
    // collapsed Game Over group, so the switch that turns the feature on or off
    // was two clicks deep and easy to miss entirely.
    title: '\u5931\u8d25\u91cd\u8bd5',
    defaultOpen: true,
    fields: [
      // Off uses the full failure end card as the store link after its icon appears.
      ['\u542f\u7528\u91cd\u8bd5\u6309\u94ae', 'gameOver.retryEnabled', 0, 1, 1, null, 'toggle'],
      // Per-delivery: either rebuild the round or use the red pill as a second
      // store button.
      ['\u6309\u94ae\u884c\u4e3a', 'gameOver.retryAction', 0, 0, 1, [
        ['restart', '\u91cd\u5f00\u672c\u5c40'],
        ['store', '\u6253\u5f00\u5546\u5e97']
      ]],
      ['\u91cd\u8bd5 X', 'gameOver.retryX', 0, 1080, 1],
      ['\u91cd\u8bd5 Y', 'gameOver.retryY', 0, 2160, 1],
      ['\u91cd\u8bd5\u5bbd\u5ea6', 'gameOver.retryWidth', 120, 900, 1],
      ['\u91cd\u8bd5\u5b57\u53f7', 'gameOver.retryFontSize', 20, 200, 1],
      ['\u91cd\u8bd5\u51fa\u73b0\u901f\u5ea6', 'gameOver.retryAppearSpeed', 0.1, 5, 0.01]
    ]
  },
  {
    title: 'Passenger Material',
    fields: [
      ['Mode', 'passengerMaterial.mode', 0, 0, 1, [
        ['unityTexture', 'Unity Texture'],
        ['solidColor', 'Solid Color']
      ]],
      ['Base Strength', 'passengerMaterial.baseColorStrength', 0, 2, 0.01],
      ['Emission Strength', 'passengerMaterial.emissionStrength', 0, 5, 0.01],
      ['Brightness', 'passengerMaterial.brightness', 0, 3, 0.01],
      ['Roughness', 'passengerMaterial.roughness', 0, 1, 0.01],
      ['Metalness', 'passengerMaterial.metalness', 0, 1, 0.01],
      ['Blue Color', 'passengerMaterial.solidColors.0', 0, 16777215, 1],
      ['Green Color', 'passengerMaterial.solidColors.1', 0, 16777215, 1],
      ['Pink Color', 'passengerMaterial.solidColors.2', 0, 16777215, 1],
      ['Purple Color', 'passengerMaterial.solidColors.3', 0, 16777215, 1],
      ['Red Color', 'passengerMaterial.solidColors.4', 0, 16777215, 1],
      ['Yellow Color', 'passengerMaterial.solidColors.5', 0, 16777215, 1],
      ['Orange Color', 'passengerMaterial.solidColors.6', 0, 16777215, 1],
      ['LightBlue Color', 'passengerMaterial.solidColors.7', 0, 16777215, 1],
      ['Brown Color', 'passengerMaterial.solidColors.8', 0, 16777215, 1],
      ['DarkGreen Color', 'passengerMaterial.solidColors.9', 0, 16777215, 1],
      ['DarkBlue Color', 'passengerMaterial.solidColors.10', 0, 16777215, 1],
      ['Blue Base', 'passengerMaterial.colors.0.baseColor', 0, 16777215, 1],
      ['Blue Emission', 'passengerMaterial.colors.0.emissionColor', 0, 16777215, 1],
      ['Green Base', 'passengerMaterial.colors.1.baseColor', 0, 16777215, 1],
      ['Green Emission', 'passengerMaterial.colors.1.emissionColor', 0, 16777215, 1],
      ['Pink Base', 'passengerMaterial.colors.2.baseColor', 0, 16777215, 1],
      ['Pink Emission', 'passengerMaterial.colors.2.emissionColor', 0, 16777215, 1],
      ['Purple Base', 'passengerMaterial.colors.3.baseColor', 0, 16777215, 1],
      ['Purple Emission', 'passengerMaterial.colors.3.emissionColor', 0, 16777215, 1],
      ['Red Base', 'passengerMaterial.colors.4.baseColor', 0, 16777215, 1],
      ['Red Emission', 'passengerMaterial.colors.4.emissionColor', 0, 16777215, 1],
      ['Yellow Base', 'passengerMaterial.colors.5.baseColor', 0, 16777215, 1],
      ['Yellow Emission', 'passengerMaterial.colors.5.emissionColor', 0, 16777215, 1],
      ['Orange Base', 'passengerMaterial.colors.6.baseColor', 0, 16777215, 1],
      ['Orange Emission', 'passengerMaterial.colors.6.emissionColor', 0, 16777215, 1],
      ['LightBlue Base', 'passengerMaterial.colors.7.baseColor', 0, 16777215, 1],
      ['LightBlue Emission', 'passengerMaterial.colors.7.emissionColor', 0, 16777215, 1],
      ['Brown Base', 'passengerMaterial.colors.8.baseColor', 0, 16777215, 1],
      ['Brown Emission', 'passengerMaterial.colors.8.emissionColor', 0, 16777215, 1],
      ['DarkGreen Base', 'passengerMaterial.colors.9.baseColor', 0, 16777215, 1],
      ['DarkGreen Emission', 'passengerMaterial.colors.9.emissionColor', 0, 16777215, 1],
      ['DarkBlue Base', 'passengerMaterial.colors.10.baseColor', 0, 16777215, 1],
      ['DarkBlue Emission', 'passengerMaterial.colors.10.emissionColor', 0, 16777215, 1]
    ]
  },
  {
    title: '\u4f20\u9001\u5e26\u9009\u62e9',
    spatialImportAnchor: true,
    fields: [
      ['Prefab', 'conveyorLayout.selected', 0, 0, 1, CONVEYOR_LAYOUT_OPTIONS]
    ]
  },
  {
    title: '\u7acb\u4f53\u8f68\u9053\u4f4d\u7f6e\u4e0e\u7f29\u653e',
    spatialOnly: true,
    fields: [
      ['X \u4f4d\u7f6e', 'spatialConveyor.positionX', -6, 6, 0.05],
      ['Y \u4f4d\u7f6e', 'spatialConveyor.positionY', -3, 4, 0.05],
      ['Z \u4f4d\u7f6e', 'spatialConveyor.positionZ', -10, 4, 0.05],
      ['\u51fa\u53e3 X \u4f4d\u7f6e', 'spatialConveyor.exitPositionX', -4, 4, 0.05],
      ['\u51fa\u53e3 Y \u4f4d\u7f6e', 'spatialConveyor.exitPositionY', -4, 4, 0.05],
      ['\u51fa\u53e3 Z \u4f4d\u7f6e', 'spatialConveyor.exitPositionZ', -4, 4, 0.05],
      ['\u7edf\u4e00\u7f29\u653e', 'spatialConveyor.scale', 0.5, 2.5, 0.05],
      ['Y \u8f74\u5782\u76f4\u7f29\u653e', 'spatialConveyor.scaleY', 0.25, 3, 0.05],
      ['X \u8f74\u7f29\u653e', 'spatialConveyor.scaleX', 0.25, 3, 0.05],
      ['Z \u8f74\u7f29\u653e', 'spatialConveyor.scaleZ', 0.25, 3, 0.05],
      ['\u8def\u9762\u5bbd\u5ea6', 'spatialConveyor.roadWidth', 0.25, 3, 0.05],
      ['X \u8f74\u65cb\u8f6c', 'spatialConveyor.rotationXDegrees', 0, 360, 5],
      ['Y \u8f74\u65cb\u8f6c', 'spatialConveyor.rotationYDegrees', 0, 360, 5],
      ['Z \u8f74\u65cb\u8f6c', 'spatialConveyor.rotationZDegrees', 0, 360, 5],
      ['Unity Z \u8f74\u955c\u50cf\u6821\u6b63', 'spatialConveyor.mirrorZ', 0, 1, 1, null, 'toggle']
    ]
  },
  {
    title: '\u7acb\u4f53\u8f68\u9053\u961f\u5217',
    spatialOnly: true,
    fields: [
      ['\u7acb\u4f53\u8f68\u9053\u5bb9\u91cf', 'spatialConveyor.capacity', 1, 600, 1],
      ['\u521d\u59cb\u6ee1\u4eba', 'spatialConveyor.startFilled', 0, 1, 1, null, 'toggle'],
      ['\u5e38\u89c4\u961f\u5217\u901f\u5ea6', 'spatialConveyor.normalSpeedMultiplier', 0.1, 5, 0.1],
      ['\u957f\u6309\u52a0\u901f\u500d\u7387', 'spatialConveyor.longPressMultiplier', 1, 10, 0.1]
    ]
  },
  {
    title: '\u7acb\u4f53\u8f68\u9053\u6027\u80fd\u4f18\u5316',
    spatialOnly: true,
    fields: [
      ['\u542f\u7528\u6027\u80fd\u4f18\u5316', 'spatialConveyor.optimizations.enabled', 0, 1, 1, null, 'toggle'],
      ['\u4e58\u5ba2\u5b9e\u4f8b\u5316', 'spatialConveyor.optimizations.instancedPassengers', 0, 1, 1, null, 'toggle'],
      ['\u9634\u5f71\u5b9e\u4f8b\u5316', 'spatialConveyor.optimizations.instancedShadows', 0, 1, 1, null, 'toggle'],
      ['\u8f68\u9053\u66f2\u7ebf\u67e5\u8868', 'spatialConveyor.optimizations.curveLookup', 0, 1, 1, null, 'toggle'],
      ['\u590d\u7528\u6e32\u67d3\u72b6\u6001', 'spatialConveyor.optimizations.liveRenderState', 0, 1, 1, null, 'toggle'],
      ['\u8df3\u8fc7\u666e\u901a\u961f\u5217\u5bf9\u8c61', 'spatialConveyor.optimizations.skipUnusedQueues', 0, 1, 1, null, 'toggle'],
      ['\u7f13\u5b58\u9759\u6001\u8f66\u8f86', 'spatialConveyor.optimizations.cacheStaticVehicles', 0, 1, 1, null, 'toggle'],
      ['\u7f13\u5b58\u963b\u6321\u5173\u7cfb', 'spatialConveyor.optimizations.cacheBlockers', 0, 1, 1, null, 'toggle'],
      ['\u767b\u8f66\u4e58\u5ba2\u5bf9\u8c61\u6c60', 'spatialConveyor.optimizations.poolBoardingPassengers', 0, 1, 1, null, 'toggle'],
      ['\u5206\u6bb5\u89c6\u9525\u88c1\u526a', 'spatialConveyor.optimizations.frustumCulling', 0, 1, 1, null, 'toggle'],
      ['\u8df3\u8fc7\u5173\u95ed\u7684\u8def\u5f84\u9884\u89c8', 'spatialConveyor.optimizations.skipDisabledPathPreview', 0, 1, 1, null, 'toggle'],
      ['\u5408\u5e76\u91cd\u590d\u767b\u8f66\u66f4\u65b0', 'spatialConveyor.optimizations.deduplicateBoardingUpdates', 0, 1, 1, null, 'toggle'],
      ['\u9ad8\u6027\u80fd GPU \u6a21\u5f0f', 'spatialConveyor.optimizations.highPerformanceRenderer', 0, 1, 1, null, 'toggle']
    ]
  },
  ...CONVEYOR_LAYOUT_FIELD_GROUPS,
  ...PLAYABLE_TRACK_FIELD_GROUPS,
  {
    title: '\u4e2d\u95f4\u5c0f\u4eba\u5f71\u5b50',
    fields: [
      ['X \u5750\u6807', 'passengerShadows.conveyor.offsetX', -1.5, 1.5, 0.01],
      ['Z \u5750\u6807', 'passengerShadows.conveyor.offsetZ', -1.5, 1.5, 0.01],
      ['X \u5c3a\u5bf8', 'passengerShadows.conveyor.scaleX', 0.2, 3, 0.01],
      ['Z \u5c3a\u5bf8', 'passengerShadows.conveyor.scaleZ', 0.2, 3, 0.01]
    ]
  },
  {
    title: '\u5de6\u4fa7\u961f\u5217\u66f2\u7ebf',
    fields: [
      ['X \u5750\u6807', 'queueCurves.0.offsetX', -6, 6, 0.05],
      ['Z \u5750\u6807', 'queueCurves.0.offsetZ', -6, 6, 0.05],
      ['X \u5c3a\u5bf8', 'queueCurves.0.scaleX', 0.25, 3, 0.05],
      ['Z \u5c3a\u5bf8', 'queueCurves.0.scaleZ', 0.25, 3, 0.05]
    ]
  },
  {
    title: '\u5de6\u961f\u5217\u5c0f\u4eba\u5f71\u5b50',
    fields: [
      ['X \u5750\u6807', 'passengerShadows.leftQueue.offsetX', -1.5, 1.5, 0.01],
      ['Z \u5750\u6807', 'passengerShadows.leftQueue.offsetZ', -1.5, 1.5, 0.01],
      ['X \u5c3a\u5bf8', 'passengerShadows.leftQueue.scaleX', 0.2, 3, 0.01],
      ['Z \u5c3a\u5bf8', 'passengerShadows.leftQueue.scaleZ', 0.2, 3, 0.01]
    ]
  },
  {
    title: '\u53f3\u4fa7\u961f\u5217\u66f2\u7ebf',
    fields: [
      ['X \u5750\u6807', 'queueCurves.1.offsetX', -6, 6, 0.05],
      ['Z \u5750\u6807', 'queueCurves.1.offsetZ', -6, 6, 0.05],
      ['X \u5c3a\u5bf8', 'queueCurves.1.scaleX', 0.25, 3, 0.05],
      ['Z \u5c3a\u5bf8', 'queueCurves.1.scaleZ', 0.25, 3, 0.05]
    ]
  },
  {
    title: '\u53f3\u961f\u5217\u5c0f\u4eba\u5f71\u5b50',
    fields: [
      ['X \u5750\u6807', 'passengerShadows.rightQueue.offsetX', -1.5, 1.5, 0.01],
      ['Z \u5750\u6807', 'passengerShadows.rightQueue.offsetZ', -1.5, 1.5, 0.01],
      ['X \u5c3a\u5bf8', 'passengerShadows.rightQueue.scaleX', 0.2, 3, 0.01],
      ['Z \u5c3a\u5bf8', 'passengerShadows.rightQueue.scaleZ', 0.2, 3, 0.01]
    ]
  },
  {
    title: '\u8f66\u4f4d',
    fields: [
      ['\u8f66\u4f4d\u6570', 'parkingSpots.count', 1, 8, 1],
      // With this on, the row is centred on x=0 and 起点 X is derived, so a count
      // change never shoves the row sideways. Turn it off to author the edge by hand.
      ['\u81ea\u52a8\u5c45\u4e2d', 'parkingSpots.autoCenter', 0, 1, 1, null, 'toggle'],
      ['\u8d77\u70b9 X', 'parkingSpots.startX', -8, 2, 0.05],
      ['Z \u5750\u6807', 'parkingSpots.z', -6, 6, 0.05],
      ['\u8f66\u4f4d\u95f4\u8ddd', 'parkingSpots.spacing', 0.25, 2.5, 0.05],
      ['\u8f66\u4f4d\u89d2\u5ea6', 'facing.parkingSpotYawDegrees', -180, 180, 1],
      ['\u8ba1\u6570\u677f X', 'seatCountBoard.x', -2, 2, 0.01],
      ['\u8ba1\u6570\u677f Z', 'seatCountBoard.z', -2, 2, 0.01],
      ['\u8ba1\u6570\u677f\u5bbd', 'seatCountBoard.width', 0.1, 1.5, 0.01],
      ['\u8ba1\u6570\u677f\u9ad8', 'seatCountBoard.depth', 0.1, 1.2, 0.01],
      ['\u6570\u5b57\u5927\u5c0f', 'seatCountBoard.textScale', 0.3, 2.5, 0.01],
      ['X \u5c3a\u5bf8', 'parkingSpots.scaleX', 0.25, 3, 0.05],
      ['Z \u5c3a\u5bf8', 'parkingSpots.scaleZ', 0.25, 3, 0.05]
    ]
  },
  {
    title: '\u8f66\u8f86\u884c\u9a76\u8def\u5f84',
    fields: [
      ['\u663e\u793a\u8def\u5f84', 'vehiclePath.enabled', 0, 1, 1],
      ['\u663e\u793a\u88ab\u6321\u8f66', 'vehiclePath.showBlocked', 0, 1, 1],
      ['\u7ebf\u6761\u9ad8\u5ea6', 'vehiclePath.y', 0.02, 0.5, 0.005],
      ['\u7ebf\u6761\u900f\u660e\u5ea6', 'vehiclePath.opacity', 0.1, 1, 0.01],
      ['\u7ebf\u6761\u7c97\u7ec6', 'vehiclePath.lineWidth', 1, 12, 1],
      ['\u8f6c\u5f2f\u534a\u5f84', 'vehiclePath.turnRadius', 0.05, 1.5, 0.01],
      ['\u5165\u5f2f\u63a7\u5236', 'vehiclePath.turnInController', 0, 1.5, 0.01],
      ['\u51fa\u5f2f\u63a7\u5236', 'vehiclePath.turnOutController', 0, 1.5, 0.01],
      ['\u8fb9\u754c\u5de6 X', 'vehiclePath.parkingBounds.minX', -12, 0, 0.01],
      ['\u8fb9\u754c\u53f3 X', 'vehiclePath.parkingBounds.maxX', 0, 12, 0.01],
      ['\u8fb9\u754c\u4e0b Z', 'vehiclePath.parkingBounds.minZ', -12, 0, 0.01],
      ['\u8fb9\u754c\u4e0a Z', 'vehiclePath.parkingBounds.maxZ', 0, 12, 0.01]
    ]
  },
  {
    title: '\u8f66\u8f86\u5f00\u51fa\u8f66\u4f4d\u8def\u5f84',
    fields: [
      ['\u663e\u793a\u8def\u5f84', 'vehicleDeparturePath.enabled', 0, 1, 1],
      ['\u6ee1\u8f7d\u505c\u987f', 'vehicleDeparturePath.fullLoadDelay', 0, 4, 0.05],
      ['\u79bb\u573a\u9ad8\u5ea6\uff08\u7ebf\u4e0e\u8f66\uff09', 'vehicleDeparturePath.y', -3, 0.5, 0.005],
      ['\u7ebf\u6761\u900f\u660e\u5ea6', 'vehicleDeparturePath.opacity', 0.1, 1, 0.01],
      ['\u7ebf\u6761\u7c97\u7ec6', 'vehicleDeparturePath.lineWidth', 1, 12, 1],
      ['\u5012\u8f66\u8ddd\u79bb', 'vehicleDeparturePath.backDistance', 0, 2, 0.01],
      ['\u6a2a\u5411\u62d0\u70b9 X', 'vehicleDeparturePath.exitTurnOffsetX', -2, 2, 0.01],
      ['\u79bb\u573a\u7ec8\u70b9 X', 'vehicleDeparturePath.exitTargetX', -1, 8, 0.05],
      ['\u79bb\u573a\u7ec8\u70b9 Z \u504f\u79fb', 'vehicleDeparturePath.exitTargetZOffset', -3, 3, 0.05],
      ['\u5012\u8f66\u901f\u5ea6', 'vehicleDeparturePath.backwardSpeed', 0.5, 8, 0.05],
      ['\u79bb\u573a\u901f\u5ea6', 'vehicleDeparturePath.forwardSpeed', 1, 18, 0.05],
      ['\u8f6c\u5f2f\u534a\u5f84', 'vehicleDeparturePath.turnRadius', 0.05, 1.5, 0.01],
      ['\u5165\u5f2f\u63a7\u5236', 'vehicleDeparturePath.turnInController', 0, 1.5, 0.01],
      ['\u51fa\u5f2f\u63a7\u5236', 'vehicleDeparturePath.turnOutController', 0, 1.5, 0.01]
    ]
  },
  {
    title: '\u8f66\u8f86',
    fields: [
      ['\u8f66\u9635\u6574\u4f53\u5de6\u53f3\uff08\u5411\u53f3\u4e3a\u6b63\uff09', 'vehicleArea.offsetX', -3, 3, 0.05],
      ['\u8f66\u9635\u6574\u4f53\u4e0a\u4e0b\uff08\u5411\u4e0b\u4e3a\u6b63\uff09', 'vehicleArea.offsetZ', -3, 3, 0.05],
      ['\u8f66\u8f86\u6574\u4f53\u65cb\u8f6c\uff08\u4ee5\u8f66\u9635\u4e2d\u5fc3\u4e3a\u8f74\uff09', 'vehicleArea.rotationDegrees', -180, 180, 1],
      ['\u6295\u5f71\u989c\u8272', 'vehicleShadows.color', 0, 16777215, 1],
      ['Map Scale', 'vehicleArea.positionUnitScale', 0.1, 2.2, 0.01],
      ['\u6a21\u578b\u5927\u5c0f', 'vehicleArea.modelScale', 0.3, 2.5, 0.05],
      // Multiplies the parked cars only. Once a car starts driving its route it
      // returns to the authored model size, so the route/spot framing never
      // changes with this slider.
      ['\u8f66\u8f86\u5927\u5c0f\u500d\u6570', 'vehicleArea.sizeMultiplier', 0.5, 2.5, 0.01],
      ['\u7bad\u5934 X', 'vehicleArrow.offsetX', -0.8, 0.8, 0.01],
      ['\u7bad\u5934\u9ad8\u5ea6', 'vehicleArrow.offsetY', 0, 0.8, 0.01],
      ['\u7bad\u5934 Z', 'vehicleArrow.offsetZ', -0.8, 0.8, 0.01],
      ['\u7bad\u5934\u63cf\u8fb9\u8272', 'vehicleArrow.outlineColor', 0, 16777215, 1],
      ['\u7bad\u5934\u63cf\u8fb9\u7c97\u7ec6', 'vehicleArrow.outlineScale', 1, 1.8, 0.01],
      ['\u7bad\u5934\u63cf\u8fb9\u6df1\u5ea6\u6d4b\u8bd5', 'vehicleArrow.outlineDepthTest', 0, 1, 1]
    ]
  },
  {
    title: '\u5c0f\u624b\u63d0\u793a',
    defaultOpen: true,
    fields: [
      ['\u63d0\u793a\u5f00\u542f', 'vehicleGuideHand.enabled', 0, 1, 1, null, 'toggle'],
      ['\u5f00\u573a\u7acb\u5373\u663e\u793a', 'vehicleGuideHand.showAtStart', 0, 1, 1, null, 'toggle'],
      ['\u65e0\u64cd\u4f5c\u7b49\u5f85\uff08\u79d2\uff09', 'vehicleGuideHand.idleDelaySeconds', 1, 30, 0.5],
      ['\u5f15\u5bfc\u5173\u5361', 'vehicleGuideHand.levelKey', 0, 0, 1, LEVEL_OPTIONS],
      // A free 1-200 number box let the id drift to values no level contains
      // (every shipped level starts well above 1), and a missing id hides the
      // hand entirely with no visible error. The dropdown is built from the
      // loaded level's own vehicles, so only real ids can be chosen.
      ['\u5f15\u5bfc\u8f66 ID', 'vehicleGuideHand.vehicleId', 1, 200, 1, null, 'vehicle-id-select'],
      ['\u5c0f\u624b X', 'vehicleGuideHand.offsetX', -3, 3, 0.01],
      ['\u5c0f\u624b\u9ad8\u5ea6', 'vehicleGuideHand.offsetY', 0, 3, 0.01],
      ['\u5c0f\u624b Z', 'vehicleGuideHand.offsetZ', -3, 3, 0.01],
      ['\u8d77\u70b9 X \u504f\u79fb\uff08\u6b63=\u53f3\u4fa7\uff09', 'vehicleGuideHand.approachOffsetX', -2, 2, 0.01],
      ['\u8d77\u70b9 Z \u504f\u79fb', 'vehicleGuideHand.approachOffsetZ', -2, 2, 0.01],
      ['\u5c0f\u624b\u6574\u4f53\u5927\u5c0f', 'vehicleGuideHand.size', 0.1, 3, 0.01],
      ['\u5c0f\u624b\u5bbd\u5ea6', 'vehicleGuideHand.width', 0.1, 2, 0.01],
      ['\u5c0f\u624b\u9ad8\u5ea6', 'vehicleGuideHand.height', 0.1, 2, 0.01],
      ['\u9760\u8fd1\u7f29\u653e', 'vehicleGuideHand.nearScale', 0.1, 2, 0.01],
      ['\u8fdc\u79bb\u7f29\u653e', 'vehicleGuideHand.farScale', 0.1, 3, 0.01],
      ['\u5c0f\u624b\u901f\u5ea6', 'vehicleGuideHand.speed', 0.1, 6, 0.01],
      ['\u5c0f\u624b\u900f\u660e\u5ea6', 'vehicleGuideHand.opacity', 0, 1, 0.01]
    ]
  },
  {
    title: '\u5f00\u573a\u5f15\u5bfc\u52a8\u753b',
    defaultOpen: true,
    fields: [
      ['\u52a8\u753b\u5f00\u542f', 'firstClickGuide.enabled', 0, 1, 1, null, 'toggle'],
      ['\u76ee\u6807\u8f66 ID', 'firstClickGuide.vehicleId', 1, 200, 1, null, 'vehicle-id-select'],
      ['\u6301\u7eed\u65f6\u95f4', 'firstClickGuide.durationSeconds', 0, 10, 0.1],
      ['\u9501\u5b9a\u5176\u4ed6\u8f66\u8f86', 'firstClickGuide.lockInput', 0, 1, 1, null, 'toggle'],
      ['\u7f6e\u7070\u5176\u4ed6\u8f66\u8f86', 'firstClickGuide.maskEnabled', 0, 1, 1, null, 'toggle'],
      ['\u906e\u7f69\u900f\u660e\u5ea6', 'firstClickGuide.maskOpacity', 0, 1, 0.01],
      ['\u5149\u6548\u8fb9\u8ddd', 'firstClickGuide.holePadding', 0, 120, 1],
      ['\u5149\u6548\u5706\u89d2', 'firstClickGuide.holeRadius', 0, 120, 1],
      ['\u5149\u6548 X \u504f\u79fb', 'firstClickGuide.holeOffsetX', -240, 240, 1],
      ['\u5149\u6548 Y \u504f\u79fb', 'firstClickGuide.holeOffsetY', -240, 240, 1],
      ['\u5149\u6548\u5bbd\u5ea6', 'firstClickGuide.holeScaleX', 0.2, 3, 0.01],
      ['\u5149\u6548\u9ad8\u5ea6', 'firstClickGuide.holeScaleY', 0.2, 3, 0.01]
    ]
  },
  {
    title: '\u7279\u6548\uff08\u5168\u5c4f\u5929\u6c14\uff09',
    fields: [
      ['\u542f\u7528\u7279\u6548', 'weatherEffect.enabled', 0, 1, 1, null, 'toggle'],
      ['\u7c92\u5b50\u6a21\u5f0f', 'weatherEffect.mode', 0, 0, 1, WEATHER_MODE_OPTIONS],
      ['\u5f3a\u5ea6', 'weatherEffect.intensity', 0, 4, 0.05],
      ['\u901f\u5ea6', 'weatherEffect.speed', 0.1, 5, 0.05],
      ['\u7c92\u5b50\u5927\u5c0f', 'weatherEffect.size', 0.2, 4, 0.05],
      ['\u900f\u660e\u5ea6', 'weatherEffect.opacity', 0, 1, 0.01],
      ['\u6a2a\u5411\u98d8\u79fb', 'weatherEffect.windX', -2, 2, 0.01],
      ['\u7c92\u5b50\u989c\u8272', 'weatherEffect.color', 0, 16777215, 1]
    ]
  },
  {
    title: '\u81ea\u7531\u7d20\u6750',
    defaultOpen: true,
    // Layer rows are owned by the panel appended to this section; an empty field
    // list keeps the section (and its category) without inventing a tuning key.
    category: 'guide',
    fields: []
  }
,
  {
    title: '\u5165\u573a\u6a2a\u5e45 EntryBanner',
    fields: [
      ['\u542f\u7528', 'entryBanner.enabled', 0, 1, 1, null, 'toggle'],
      ['\u96be\u5ea6\u6837\u5f0f', 'entryBanner.style', 0, 0, 1, [
        ['hard', 'Hard'],
        ['superhard', 'SuperHard']
      ]],
      ['X \u4f4d\u7f6e', 'entryBanner.positionX', 0, 2160, 1],
      ['Y \u4f4d\u7f6e', 'entryBanner.positionY', 0, 4320, 1],
      ['\u7f29\u653e', 'entryBanner.scale', 0.3, 2, 0.01],
      ['\u64ad\u653e\u65f6\u95f4', 'entryBanner.durationSeconds', 0.5, 8, 0.05],
      ['\u663e\u793a\u906e\u7f69', 'entryBanner.maskEnabled', 0, 1, 1, null, 'toggle'],
      ['\u906e\u7f69\u900f\u660e\u5ea6', 'entryBanner.maskOpacity', 0, 1, 0.01],
      ...makeEntryBannerComponentFields('\u6a2a\u5e45\u4e3b\u4f53', 'banner'),
      ...makeEntryBannerComponentFields('\u7bad\u5934\u7ec4', 'arrows'),
      ...makeEntryBannerComponentFields('\u6807\u9898', 'label')
    ]
  },
  {
    title: 'Effect_Hit \u7c92\u5b50',
    fields: [
      ['\u6574\u4f53\u5927\u5c0f', 'effects.hit.sizeScale', 0.1, 5, 0.01],
      ['ParticleHit_2 \u5927\u5c0f', 'effects.hit.particleHit2SizeScale', 0.1, 5, 0.01],
      ['ParticleHit_1 \u5927\u5c0f', 'effects.hit.particleHit1SizeScale', 0.1, 5, 0.01],
      ['ParticleHit \u5927\u5c0f', 'effects.hit.particleHitSizeScale', 0.1, 5, 0.01]
      // `collision.maxBumpDistance` retired: any cap below the touch distance
      // left the car short of the blocker it was told to hit. The key stays in
      // the tuning so older profiles still validate, but there is no slider.
    ]
  },
  {
    title: '\u79bb\u573a\u5f69\u5e26\u7c92\u5b50',
    fields: [
      ['\u79fb\u52a8\u8303\u56f4', 'effects.ribbon.moveRange', 0.1, 6, 0.05],
      ['\u901f\u5ea6\u8d77\u70b9', 'effects.ribbon.speedStart', 0, 3, 0.01],
      ['\u66f2\u7ebf\u4e2d\u70b9\u65f6\u95f4', 'effects.ribbon.speedMidTime', 0, 1, 0.01],
      ['\u901f\u5ea6\u4e2d\u70b9', 'effects.ribbon.speedMid', 0, 3, 0.01],
      ['\u901f\u5ea6\u7ec8\u70b9', 'effects.ribbon.speedEnd', 0, 3, 0.01]
    ]
  },
  {
    title: '\u79bb\u573a\u70df\u96fe\u7c92\u5b50',
    fields: [
      ['\u79fb\u52a8\u8303\u56f4', 'effects.ribbonSmoke.moveRange', 0.1, 6, 0.05],
      ['\u901f\u5ea6\u8d77\u70b9', 'effects.ribbonSmoke.speedStart', 0, 3, 0.01],
      ['\u66f2\u7ebf\u4e2d\u70b9\u65f6\u95f4', 'effects.ribbonSmoke.speedMidTime', 0, 1, 0.01],
      ['\u901f\u5ea6\u4e2d\u70b9', 'effects.ribbonSmoke.speedMid', 0, 3, 0.01],
      ['\u901f\u5ea6\u7ec8\u70b9', 'effects.ribbonSmoke.speedEnd', 0, 3, 0.01]
    ]
  },
  {
    title: '\u884c\u9a76\u5c3e\u70df ParticleTrail',
    fields: [
      ['\u6bcf\u79d2\u7c92\u5b50\u6570', 'effects.smokeTrail.rateOverTime', 0, 120, 1],
      ['\u5bff\u547d\u4e0b\u9650', 'effects.smokeTrail.lifetimeMin', 0.05, 2, 0.01],
      ['\u5bff\u547d\u4e0a\u9650', 'effects.smokeTrail.lifetimeMax', 0.05, 2, 0.01],
      ['\u521d\u59cb\u5927\u5c0f\u4e0b\u9650', 'effects.smokeTrail.sizeMin', 0.01, 1, 0.01],
      ['\u521d\u59cb\u5927\u5c0f\u4e0a\u9650', 'effects.smokeTrail.sizeMax', 0.01, 1, 0.01],
      ['\u6f02\u79fb\u901f\u5ea6\u500d\u6570', 'effects.smokeTrail.speedScale', 0, 4, 0.05],
      ['\u5c3e\u90e8 Z \u504f\u79fb', 'effects.smokeTrail.offsetZ', -1.5, 1.5, 0.01],
      ['\u9ad8\u5ea6 Y \u504f\u79fb', 'effects.smokeTrail.offsetY', -0.5, 1, 0.01],
      ['\u6563\u5f00\u500d\u6570', 'effects.smokeTrail.spread', 0, 4, 0.05],
      ['\u91cd\u529b', 'effects.smokeTrail.gravity', -10, 2, 0.05],
      ['\u4e0d\u900f\u660e\u5ea6', 'effects.smokeTrail.opacity', 0, 1, 0.01]
    ]
  }
];

function getAtPath(target, path) {
  return path.split('.').reduce((value, key) => value?.[key], target);
}

function setAtPath(target, path, value) {
  const keys = path.split('.');
  const last = keys.pop();
  const parent = keys.reduce((current, key) => current[key], target);
  parent[last] = value;
}

function formatValue(value, step) {
  const decimals = String(step).includes('.') ? String(step).split('.')[1].length : 0;
  return Number(value).toFixed(decimals);
}

function formatColor(value) {
  const hex = Math.max(0, Math.min(0xffffff, Math.round(Number(value) || 0)));
  return `#${hex.toString(16).padStart(6, '0')}`;
}

// Release notes for the 关于 panel. The entry matching the running build is
// marked so an operator can tell at a glance whether these are the notes for
// the editor in front of them.
function escapeChangelogText(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function renderChangelogList(currentVersion) {
  if (!BUILD_CHANGELOG.length) {
    return '<p class="editor-about-empty">还没有版本记录。</p>';
  }
  return BUILD_CHANGELOG.map((entry) => {
    // One entry per day now, so "current" means this build belongs to that day
    // — not that it is the day's last stamp.
    const stamps = changelogVersions(entry);
    const isCurrent = stamps.includes(currentVersion);
    const items = (entry.changes ?? [])
      .map((change) => `<li>${escapeChangelogText(change)}</li>`)
      .join('');
    // The day's other builds stay visible so an operator can still match the
    // stamp on screen to the notes for it.
    const otherStamps = stamps.filter((stamp) => stamp !== currentVersion);
    const stampNote = otherStamps.length > 0
      ? `<span class="editor-about-entry-builds">当天构建：${otherStamps.map((stamp) => escapeChangelogText(stamp)).join(' · ')}</span>`
      : '';
    return `<article class="editor-about-entry${isCurrent ? ' is-current' : ''}">`
      + `<div class="editor-about-entry-head">`
      + `<span class="editor-about-entry-version">v${escapeChangelogText(entry.version)}</span>`
      + (isCurrent ? '<span class="editor-about-entry-badge">当前版本</span>' : '')
      + `<span class="editor-about-entry-date">${escapeChangelogText(entry.date)}</span>`
      + `</div>`
      + `<h4 class="editor-about-entry-title">${escapeChangelogText(entry.title)}</h4>`
      + (items ? `<ul class="editor-about-entry-changes">${items}</ul>` : '')
      + stampNote
      + `</article>`;
  }).join('');
}

function downloadFilename(response, platform) {
  const disposition = response.headers.get('Content-Disposition') ?? '';
  const encoded = disposition.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
  if (encoded) {
    try {
      return decodeURIComponent(encoded);
    } catch {
      // Fall through to the ASCII filename or a deterministic fallback.
    }
  }
  const quoted = disposition.match(/filename="([^"]+)"/i)?.[1];
  if (quoted) return quoted;
  if (platform === 'all') return 'bus-loop-all-platforms.zip';
  const format = PLAYABLE_EXPORT_PLATFORMS.find(([id]) => id === platform)?.[2] ?? 'ZIP';
  return `bus-loop-${platform}.${format.toLowerCase()}`;
}

// ---------------------------------------------------------------------------
// Editor templates
//
// Two shells share one control tree. The classic shell is the shipped 320px
// sidebar: header, screenshot block, category tabs, export block, 66 tuning
// sections, history actions, all in one scroll column. The shell layout is the
// study prototype: a rail of nine panels, a search field, and an inspector
// column, with the 3D stage pulled into the middle of the page.
//
// Only the *markup* differs. Every block below emits the same class hooks the
// wiring in createSceneEditor queries, so the field builders, undo stack,
// autosave, export path and async option refreshers run unchanged in either
// layout. Nothing here forks behaviour.
// ---------------------------------------------------------------------------

function renderEditorHeader({ layoutMode = 'classic' } = {}) {
  // Both headers carry the switch so either shell can reach the other. The
  // label names the destination, not the current state.
  const switchLabel = layoutMode === 'shell' ? '\u7ecf\u5178\u5e03\u5c40' : '\u65b0\u5e03\u5c40';
  const switchTitle = layoutMode === 'shell'
    ? '\u5207\u6362\u5230\u8001\u7248\u4fa7\u680f\u5e03\u5c40'
    : '\u5207\u6362\u5230\u56fe\u6807\u680f + \u68c0\u89c6\u680f\u7684\u65b0\u5e03\u5c40';
  const localeField = `
        <label class="editor-locale" title="切换后预览与截图都按该语言渲染；导出的包仍跟随玩家设备语言">
          <span class="editor-locale-label">\u8bed\u8a00</span>
          <select class="editor-locale-select" aria-label="预览语言">
            ${BRANDING_LOCALE_OPTIONS.map(([value, label]) => (
              `<option value="${value}">${label}</option>`
            )).join('')}
          </select>
        </label>`;
  const aboutButton = `
        <button class="editor-about" type="button" aria-label="\u67e5\u770b\u7248\u672c\u66f4\u65b0\u5185\u5bb9" title="\u7248\u672c\u66f4\u65b0\u5185\u5bb9">\u5173\u4e8e</button>`;
  const switchButton = `
        <button class="editor-layout-switch" type="button" title="${switchTitle}">${switchLabel}</button>`;

  // The shell header is a full-width top bar. It used to live in the left two
  // columns only, which is 384px — the title was clipped by the language picker
  // and the three controls had no room to breathe. A page-wide bar gives the
  // controls a natural right-aligned group and stops fighting the sidebar.
  if (layoutMode === 'shell') {
    return `
    <header class="editor-header">
      <div class="shell-brand">
        <h2>\u573a\u666f\u8c03\u8282</h2>
        <span class="editor-kicker">SCENE EDITOR <span class="editor-version">v${BUILD_VERSION}</span></span>
      </div>
      <div class="editor-header-actions">${localeField}${aboutButton}${switchButton}
      </div>
    </header>`;
  }

  return `
    <header class="editor-header">
      <div>
        <span class="editor-kicker">SCENE EDITOR <span class="editor-version">v${BUILD_VERSION}</span></span>
        <h2>\u573a\u666f\u8c03\u8282</h2>
      </div>
      <div class="editor-header-actions">${localeField}${aboutButton}${switchButton}
        <button class="editor-toggle" type="button" aria-label="\u6536\u8d77\u573a\u666f\u7f16\u8f91\u5668" aria-expanded="true">\u00d7</button>
      </div>
    </header>`;
}

function renderEditorAboutPanel() {
  return `
    <div class="editor-about-panel" role="dialog" aria-modal="true" aria-labelledby="editor-about-title" hidden>
      <div class="editor-about-dialog">
        <header class="editor-about-head">
          <div>
            <span class="editor-kicker">SCENE EDITOR</span>
            <h3 id="editor-about-title">\u7248\u672c\u66f4\u65b0\u5185\u5bb9</h3>
            <p class="editor-about-current">\u5f53\u524d\u7248\u672c v${BUILD_VERSION}</p>
          </div>
          <button class="editor-about-close" type="button" aria-label="\u5173\u95ed\u7248\u672c\u8bf4\u660e">\u00d7</button>
        </header>
        <div class="editor-about-list">${renderChangelogList(BUILD_VERSION)}</div>
      </div>
    </div>`;
}

function renderScreenshotSection() {
  return `
      <details class="editor-section editor-screenshot" open>
        <summary class="editor-section-summary"><h3>\u622a\u56fe\u51fa\u56fe</h3></summary>
        <label class="editor-screenshot-size">
          <span>\u753b\u9762\u5c3a\u5bf8</span>
          <select class="editor-screenshot-select">
            ${SCREENSHOT_SIZE_OPTIONS.map(([value, label]) => (
              `<option value="${value}">${label} PNG</option>`
            )).join('')}
          </select>
        </label>
        <button class="editor-screenshot-button" type="button">\u4e0b\u8f7d\u622a\u56fe</button>
        <p class="editor-screenshot-status" role="status" aria-live="polite" aria-atomic="true">\u4e0d\u5305\u542b\u624b\u673a\u8fb9\u6846</p>
      </details>`;
}

function renderCategoryTabs() {
  return `
      <nav class="editor-category-tabs" role="tablist" aria-label="\u7f16\u8f91\u5668\u529f\u80fd\u5206\u7c7b">
        ${EDITOR_CATEGORIES.map(([id, label], index) => (
          `<button type="button" role="tab" data-editor-category-tab="${id}" aria-selected="${index === 0}" tabindex="${index === 0 ? 0 : -1}">${label}</button>`
        )).join('')}
      </nav>`;
}

function renderExportSection() {
  return `
      <details class="editor-section editor-playable-export" data-editor-category="export" open>
        <summary class="editor-section-summary"><h3>\u5bfc\u51fa\u8bd5\u73a9</h3></summary>
        <label class="editor-export-set">
          <span>\u5bfc\u51fa\u5957\u7cfb</span>
          <select class="editor-export-set-select">
            ${PLAYABLE_EXPORT_BRANDING_SETS.map(([id, label]) => (
              `<option value="${id}">${label}</option>`
            )).join('')}
          </select>
        </label>
        <p class="editor-export-set-note" role="note">BL \u53ea\u51fa\u4e00\u5957\u5305\uff08\u5b89\u5353/iOS \u5408\u5e76\uff09\uff1a\u540c\u4e00\u4efd HTML \u6309\u673a\u578b\u81ea\u52a8\u5207\u5bf9\u5e94 Icon \u4e0e\u5546\u5e97\u94fe\u63a5\uff0cLogo \u8ddf\u968f Logo \u7248\u672c\u3002</p>
        <label class="editor-export-platform">
          <span>\u6295\u653e\u5e73\u53f0</span>
          <select class="editor-export-select">
            ${PLAYABLE_EXPORT_PLATFORMS.map(([id, label, format]) => (
              `<option value="${id}">${label} (${format})</option>`
            )).join('')}
          </select>
        </label>
        <div class="editor-export-actions">
          <button class="editor-export-button" type="button">\u5bfc\u51fa\u5f53\u524d\u5e73\u53f0</button>
          <button class="editor-export-all-button" type="button">\u4e00\u952e\u5bfc\u51fa\u5168\u90e8</button>
        </div>
        <p class="editor-export-limit editor-export-variants" role="status" aria-live="polite"></p>
        <p class="editor-export-limit" role="note">\u6240\u6709\u6e20\u9053\u4e0a\u9650 5 MB\uff1a\u8d85\u8fc7\u7684\u5305\u4e0d\u4f1a\u4e0b\u8f7d\uff0c\u5bfc\u51fa\u4f1a\u76f4\u63a5\u62a5\u9519\u5e76\u5217\u51fa\u5360\u7528\u6700\u5927\u7684\u7d20\u6750\u3002</p>
        <p class="editor-export-status" role="status" aria-live="polite" aria-atomic="true">\u5c31\u7eea</p>
        <p class="editor-export-events" role="status" aria-live="polite" aria-atomic="true">\u5bfc\u51fa\u5305\u81ea\u5e26 AppLovin 12 \u4e2a\u6807\u51c6\u4e8b\u4ef6</p>
      </details>`;
}

function renderHistoryActions() {
  return `
      <div class="editor-history-actions">
        <button class="editor-history-button editor-undo" type="button" aria-label="\u64a4\u56de\u4e0a\u4e00\u6b65" title="\u64a4\u56de\u4e0a\u4e00\u6b65">&#8630;</button>
        <button class="editor-history-button editor-redo" type="button" aria-label="\u91cd\u505a\u4e0a\u4e00\u6b65" title="\u91cd\u505a\u4e0a\u4e00\u6b65">&#8631;</button>
        <button class="editor-reset" type="button">\u6062\u590d\u9ed8\u8ba4\u53c2\u6570</button>
      </div>`;
}

function renderClassicEditorTemplate() {
  return `${renderEditorHeader({ layoutMode: 'classic' })}
    ${renderEditorAboutPanel()}
    <div class="editor-body">
      <p class="editor-help">\u56fe\u7247\u4e0e\u884c\u8d70\u66f2\u7ebf\u53ef\u5206\u522b\u8c03\u8282\u3002\u53c2\u6570\u6309\u5f53\u524d\u5173\u5361\u5355\u72ec\u4fdd\u5b58\uff0c\u6bcf\u6b21\u8c03\u6574\u4f1a\u81ea\u52a8\u4fdd\u5b58\u3002</p>
      ${renderScreenshotSection()}
      ${renderCategoryTabs()}
      ${renderExportSection()}
      <div class="editor-fields"></div>
      ${renderHistoryActions()}
    </div>
  `;
}

// Rail panels. `id` matches the CSS hook; `match` decides a section's panel by
// majority vote over its own field paths (row 1 is not representative: the
// Icon/Logo section opens with the phone-preview size rows but is branding).
const SHELL_PANELS = [
  { id: 'level', label: '\u5173\u5361', icon: 'M5 21V4M5 5h9l-1.2 2.6L14 10H5M5 14h7l-1 2.2L12 18H5', match: /^level\./ },
  { id: 'scene', label: '\u573a\u666f', icon: 'M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6 7 7M17 17l1.4 1.4M18.4 5.6 17 7M7 17l-1.4 1.4', match: /^(?:camera|lighting|sourceCrop|background|visibility|preview)\./ },
  { id: 'track', label: '\u8f68\u9053', icon: 'M4 6h16v12H4zM8 6v12M16 6v12', match: /^(?:conveyorLayout|conveyorLayouts|spatialConveyor|queueCurves|passengerShadows|effects)\./ },
  { id: 'cars', label: '\u8f66\u8f86', icon: 'M4 15v-2.5l1.8-3.2A2 2 0 0 1 7.5 8h9a2 2 0 0 1 1.7 1.3L20 12.5V15M4 15h16v2.5H4z', match: /^(?:parkingSpots|vehiclePath|vehicleDeparturePath|vehicleArea|passengerMaterial|passengers)\./ },
  { id: 'guide', label: '\u5f15\u5bfc', icon: 'M9 11V5.5a1.5 1.5 0 0 1 3 0V10M12 10V7.5a1.5 1.5 0 0 1 3 0V12M15 12v-1a1.5 1.5 0 0 1 3 0v4.5A5.5 5.5 0 0 1 12.5 21h-1A5.5 5.5 0 0 1 6 15.5V13a1.5 1.5 0 0 1 3 0v1', match: /^(?:vehicleGuideHand|firstClickGuide|entryBanner|countdown|weatherEffect|freeAssets|preRoll|gameOver|installGate|stamina)\./ },
  { id: 'ui', label: '\u754c\u9762', icon: 'M4 5h16v14H4zM4 9h16M9 9v10', match: /^(?:branding|cta|speedToggle|progressHud)\./ },
  { id: 'audio', label: '\u58f0\u97f3', icon: 'M5 9.5h3L12.5 6v12L8 14.5H5zM16 9a4.2 4.2 0 0 1 0 6', match: /^audio\./ },
  { id: 'export', label: '\u5bfc\u51fa', icon: 'M12 16V4M7.5 8.5 12 4l4.5 4.5M4 16v3h16v-3', match: /^exportNaming\./ },
];

// Sections are grouped by job inside a panel; the guide panel alone covers
// "catch the eye", "deadline and failure" and "atmosphere".
const SHELL_SUBGROUPS = {
  track: [
    ['\u8dd1\u9053', /^conveyorLayout(?:s)?\./],
    ['\u7acb\u4f53\u8f68\u9053', /^spatialConveyor\./],
    ['\u961f\u5217\u4e0e\u5f71\u5b50', /^(?:queueCurves|passengerShadows)\./],
    ['\u7c92\u5b50', /^effects\./],
  ],
  cars: [
    ['\u8f66\u8f86\u4e0e\u8f66\u4f4d', /^(?:parkingSpots|vehiclePath|vehicleDeparturePath|vehicleArea)\./],
    ['\u5c0f\u4eba', /^(?:passengers|passengerMaterial)\./],
  ],
  guide: [
    ['\u5f00\u573a\u5f15\u5bfc', /^(?:vehicleGuideHand|firstClickGuide|entryBanner)\./],
    ['\u8282\u594f\u4e0e\u5931\u8d25', /^(?:countdown|gameOver|installGate|preRoll|stamina)\./],
    ['\u6c1b\u56f4\u56fe\u5c42', /^(?:weatherEffect|freeAssets)\./],
  ],
  scene: [
    ['\u76f8\u673a\u4e0e\u706f\u5149', /^(?:camera|lighting|visibility)\./],
    ['\u753b\u9762', /^(?:background|sourceCrop|preview)\./],
  ],
  ui: [
    ['\u54c1\u724c', /^branding\./],
    ['\u63a7\u4ef6', /^(?:cta|speedToggle|progressHud)\./],
  ],
  export: [['\u547d\u540d', /^exportNaming\./]],
};

const SHELL_PANEL_TITLES = {
  level: ['\u5173\u5361', '\u9009\u5173\u3001\u5173\u5361\u5e93\u3001\u5e03\u5c40\u7f16\u8f91\u5668\u5165\u53e3'],
  scene: ['\u573a\u666f', '\u76f8\u673a\u3001\u706f\u5149\u3001\u80cc\u666f\u3001\u6e90\u56fe\u88c1\u5207\u3001\u663e\u793a\u63a7\u5236'],
  track: ['\u8f68\u9053', '\u8dd1\u9053\u9009\u62e9\u3001\u7acb\u4f53\u8f68\u9053\u3001\u961f\u5217\u66f2\u7ebf\u3001\u5f71\u5b50\u3001\u7c92\u5b50'],
  cars: ['\u8f66\u8f86\u4e0e\u89d2\u8272', '\u8f66\u4f4d\u3001\u8f66\u8f86\u3001\u884c\u9a76\u8def\u5f84\u3001\u5c0f\u4eba\u6a21\u578b\u4e0e\u6750\u8d28'],
  guide: ['\u5f15\u5bfc\u4e0e\u6d41\u7a0b', '\u624b\u6307\u63d0\u793a\u3001\u5f00\u573a\u5f15\u5bfc\u3001\u6a2a\u5e45\u3001\u5012\u8ba1\u65f6\u3001\u5929\u6c14\u3001\u524d\u8d34\u3001\u7ed3\u7b97'],
  ui: ['\u754c\u9762\u4e0e\u54c1\u724c', 'Icon/Logo/\u6587\u672c\u3001CTA\u3001\u500d\u901f\u6309\u94ae\u3001\u8fdb\u5ea6\u6761'],
  audio: ['\u58f0\u97f3', '\u97f3\u6548\u5ef6\u8fdf\u3001\u97f3\u91cf\u3001BGM \u5e93'],
  export: ['\u5bfc\u51fa', '\u547d\u540d\u3001\u622a\u56fe\u3001\u5957\u7cfb\u3001\u4e03\u5e73\u53f0\u4ea4\u4ed8'],
};

function renderShellEditorTemplate() {
  return `${renderEditorHeader({ layoutMode: 'shell' })}
    ${renderEditorAboutPanel()}
    <nav class="shell-rail" aria-label="\u7f16\u8f91\u5668\u9762\u677f">
      ${SHELL_PANELS.map((panel) => (
        `<button type="button" data-shell-panel="${panel.id}" title="${panel.label}">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${panel.icon}"/></svg>
          <span>${panel.label}</span>
          <em></em>
        </button>`
      )).join('')}
    </nav>
    <section class="shell-panel">
      <div class="shell-panel-head">
        <h2 class="shell-panel-title">\u8f68\u9053</h2>
        <p class="shell-panel-note"></p>
        <div class="shell-panel-tally"></div>
      </div>
      <div class="shell-search" role="search">
        <input class="editor-search-input" type="search" placeholder="\u641c\u7d22\u5b57\u6bb5\uff08\u8df3\u8fc7\u9762\u677f\u5206\u7c7b\uff09" aria-label="\u641c\u7d22\u5b57\u6bb5" autocomplete="off" spellcheck="false" />
        <button class="editor-search-clear" type="button" aria-label="\u6e05\u9664\u641c\u7d22" hidden>\u00d7</button>
      </div>
      <div class="editor-body">
        <div class="editor-fields"></div>
        ${renderScreenshotSection()}
        ${renderExportSection()}
        ${renderHistoryActions()}
      </div>
    </section>
    <aside class="shell-inspector" aria-label="\u68c0\u89c6\u5668">
      <div class="shell-inspector-tabs" role="tablist">
        <button type="button" data-shell-tab="facts" aria-selected="true">\u6982\u89c8</button>
        <button type="button" data-shell-tab="checks" aria-selected="false">\u6821\u9a8c</button>
        <button type="button" data-shell-tab="deal" aria-selected="false">\u4ea4\u4ed8</button>
      </div>
      <div class="shell-inspector-body"></div>
    </aside>
  `;
}

export function createSceneEditor(root, {
  getTuning,
  defaultTuning = getTuning(),
  setTuning,
  getPlayableExportPayload = () => ({ tuning: getTuning() }),
  clearSavedTuning = () => {},
  saveImportedLevelTuning = () => false,
  captureScreenshot = async () => { throw new Error('\u622a\u56fe\u529f\u80fd\u4e0d\u53ef\u7528'); },
  previewPreRoll = async () => {},
  openSpatialPointEditor = async () => {},
  openLevelLayoutEditor = async () => {},
  getCameraPreset = () => null,
  layoutMode = 'classic'
}) {
  const defaults = structuredClone(defaultTuning);
  // `shell` is the split layout study; anything else keeps the shipped sidebar
  // byte for byte so a bad shell build can never take the old editor down.
  const shellLayout = layoutMode === 'shell';
  root.innerHTML = shellLayout ? renderShellEditorTemplate() : renderClassicEditorTemplate();

  const fieldsRoot = root.querySelector('.editor-fields');
  const inputs = new Map();
  const exportSetSelect = root.querySelector('.editor-export-set-select');
  const exportSetNote = root.querySelector('.editor-export-set-note');
  const exportSelect = root.querySelector('.editor-export-select');
  const exportButton = root.querySelector('.editor-export-button');
  const exportAllButton = root.querySelector('.editor-export-all-button');
  const exportStatus = root.querySelector('.editor-export-status');
  const exportVariantsStatus = root.querySelector('.editor-export-variants');
  const exportEventsStatus = root.querySelector('.editor-export-events');
  const localeSelect = root.querySelector('.editor-locale-select');
  const screenshotSelect = root.querySelector('.editor-screenshot-select');
  const screenshotButton = root.querySelector('.editor-screenshot-button');
  const screenshotStatus = root.querySelector('.editor-screenshot-status');
  const categoryTabs = [...root.querySelectorAll('[data-editor-category-tab]')];
  const undoButton = root.querySelector('.editor-undo');
  const redoButton = root.querySelector('.editor-redo');
  const tuningUndoStack = [];
  const tuningRedoStack = [];
  const MAX_TUNING_HISTORY = 50;
  let restoringHistory = false;
  let playableExportBusy = false;

  function updateCountdownControls() {
    const countdown = normalizeCountdownConfig(getTuning().countdown);
    let invalid = false;
    for (const key of ['durationSeconds', 'warningEnabled', 'warningSeconds', 'sirenEnabled', 'sirenVolume', 'timeoutStore', 'offsetX', 'offsetY', 'scale']) {
      const controls = inputs.get(`countdown.${key}`);
      if (!controls) continue;
      const disabled = !countdown.enabled
        || (key === 'warningSeconds' && !countdown.warningEnabled)
        || (key === 'sirenVolume' && !countdown.sirenEnabled);
      controls.row.classList.toggle('is-readonly', disabled);
      (controls.number ?? controls.checkbox).disabled = disabled;
      if (controls.range) controls.range.disabled = disabled;
      if (key === 'warningSeconds') {
        controls.number.max = String(countdown.durationSeconds);
        controls.range.max = String(countdown.durationSeconds);
      }
      if (controls.updateValidity && !controls.updateValidity()) invalid = true;
    }
    exportButton.disabled = playableExportBusy || invalid;
    exportAllButton.disabled = playableExportBusy || invalid;
    const countdownErrorMessage = '请先修正「引导 → 倒计时挑战」中的时间配置';
    if (invalid && !playableExportBusy) {
      exportStatus.dataset.state = 'error';
      exportStatus.textContent = countdownErrorMessage;
    } else if (!playableExportBusy && exportStatus.textContent === countdownErrorMessage) {
      exportStatus.dataset.state = '';
      exportStatus.textContent = '就绪';
    }
    return !invalid;
  }

  function updateStaminaControls() {
    const disabled = !normalizeStaminaConfig(getTuning().stamina).enabled;
    for (const key of ['lives', 'collisionPenaltyEnabled', 'parkingRescueEnabled', 'introEnabled', 'horizontalAlign', 'offsetX', 'offsetY', 'scale']) {
      const controls = inputs.get(`stamina.${key}`);
      if (!controls) continue;
      controls.row.classList.toggle('is-readonly', disabled);
      for (const element of [controls.select, controls.checkbox, controls.range, controls.number]) {
        if (element) element.disabled = disabled;
      }
    }
  }

  function updateExportVariantControls() {
    const tuning = getTuning();
    for (const [path, enabled] of [
      ['exportNaming.version', Number(tuning.stamina?.enabled) === 1],
      ['exportNaming.steps', isInstallGateEnabled(tuning.installGate)]
    ]) {
      const controls = inputs.get(path);
      if (!controls) continue;
      controls.row.classList.toggle('is-readonly', !enabled);
      controls.textInput.disabled = !enabled;
      if (!enabled) controls.textInput.value = 'N';
      controls.updateValidity();
    }
    const gateControls = inputs.get('installGate.successfulOperationThreshold');
    if (gateControls) {
      const disabled = !isInstallGateEnabled(tuning.installGate);
      gateControls.row.classList.toggle('is-readonly', disabled);
      gateControls.range.disabled = disabled;
      gateControls.number.disabled = disabled;
    }
    let valid = true;
    try {
      const plan = getExportVariantPlan(tuning);
      exportVariantsStatus.textContent = `${plan.count}个版本；当前渠道 ${plan.count} 份，全部渠道 ${plan.count * 7} 份。多值用 / 分隔，预览使用第一个值。`;
    } catch (error) {
      valid = false;
      exportVariantsStatus.textContent = error.message;
    }
    exportVariantsStatus.dataset.state = valid ? '' : 'error';
    const invalidCountdown = [...inputs.values()].some(controls => controls.isCountdownNumber && !controls.updateValidity());
    exportButton.disabled = exportAllButton.disabled = playableExportBusy || !valid || invalidCountdown;
    return valid;
  }

  const sameTuning = (left, right) => JSON.stringify(left) === JSON.stringify(right);
  function updateHistoryButtons() {
    undoButton.disabled = tuningUndoStack.length === 0;
    redoButton.disabled = tuningRedoStack.length === 0;
  }
  function commitTuning(next, { path, merge = false } = {}) {
    const before = structuredClone(getTuning());
    syncExportVariantTuning(next, path);
    const result = setTuning(next, { path });
    const after = structuredClone(result ?? getTuning());
    if (!restoringHistory && !sameTuning(before, after)) {
      const previous = tuningUndoStack[tuningUndoStack.length - 1];
      if (merge && previous?.path === path) {
        previous.after = after;
      } else {
        tuningUndoStack.push({ before, after, path });
        if (tuningUndoStack.length > MAX_TUNING_HISTORY) tuningUndoStack.shift();
      }
      tuningRedoStack.length = 0;
    }
    updateHistoryButtons();
    return result;
  }

  function restoreHistoryEntry(entry, direction) {
    if (!entry) return;
    const current = structuredClone(getTuning());
    const target = direction === 'undo' ? entry.before : entry.after;
    restoringHistory = true;
    try {
      setTuning(structuredClone(target), { path: entry.path });
      if (direction === 'undo') {
        tuningRedoStack.push({ before: target, after: current, path: entry.path });
      } else {
        tuningUndoStack.push({ before: current, after: target, path: entry.path });
      }
      sync({ resetCountdownDrafts: true });
    } finally {
      restoringHistory = false;
      updateHistoryButtons();
    }
  }

  undoButton.addEventListener('click', () => restoreHistoryEntry(tuningUndoStack.pop(), 'undo'));
  redoButton.addEventListener('click', () => restoreHistoryEntry(tuningRedoStack.pop(), 'redo'));

  function setEditorCategory(category, { focus = false } = {}) {
    if (!EDITOR_CATEGORIES.some(([id]) => id === category)) return;
    root.dataset.editorCategory = category;
    for (const tab of categoryTabs) {
      const selected = tab.dataset.editorCategoryTab === category;
      tab.setAttribute('aria-selected', String(selected));
      tab.tabIndex = selected ? 0 : -1;
      if (selected && focus) tab.focus();
    }
    for (const panel of root.querySelectorAll('[data-editor-category]')) {
      panel.classList.toggle('is-category-hidden', panel.dataset.editorCategory !== category);
    }
  }

  categoryTabs.forEach((tab, index) => {
    tab.addEventListener('click', () => setEditorCategory(tab.dataset.editorCategoryTab));
    tab.addEventListener('keydown', (event) => {
      let nextIndex = null;
      if (event.key === 'ArrowRight' || event.key === 'ArrowDown') nextIndex = (index + 1) % categoryTabs.length;
      if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') nextIndex = (index - 1 + categoryTabs.length) % categoryTabs.length;
      if (event.key === 'Home') nextIndex = 0;
      if (event.key === 'End') nextIndex = categoryTabs.length - 1;
      if (nextIndex == null) return;
      event.preventDefault();
      setEditorCategory(categoryTabs[nextIndex].dataset.editorCategoryTab, { focus: true });
    });
  });

  exportSetSelect.addEventListener('change', () => {
    const crowd = exportSetSelect.value === 'crowd';
    if (exportSetNote) {
      exportSetNote.textContent = crowd
        ? 'BFT \u53ea\u51fa\u4e00\u5957\u5305\uff08\u5b89\u5353/iOS \u5408\u5e76\uff09\uff1a\u5bfc\u51fa\u65f6\u81ea\u52a8\u6362 BFT Icon\u3001Logo\u3001BFT \u5546\u5e97\u94fe\u63a5\uff0c\u5e95\u90e8\u6587\u6848\u82e5\u4ecd\u4e3a\u9ed8\u8ba4\u5219\u6539\u4e3a Bus Crowd\u3002'
        : 'BL \u53ea\u51fa\u4e00\u5957\u5305\uff08\u5b89\u5353/iOS \u5408\u5e76\uff09\uff1a\u540c\u4e00\u4efd HTML \u6309\u673a\u578b\u81ea\u52a8\u5207\u5bf9\u5e94 Icon \u4e0e\u5546\u5e97\u94fe\u63a5\uff0cLogo \u8ddf\u968f Logo \u7248\u672c\u3002';
    }
  });

  async function exportPlayable({ all = false } = {}) {
    if (!updateExportVariantControls()) {
      [...inputs.values()].find(controls => controls.isVariant && !controls.updateValidity())?.textInput.reportValidity();
      return;
    }
    if (!updateCountdownControls()) {
      const invalidCountdownControl = [...inputs.values()]
        .find((controls) => controls.isCountdownNumber && !controls.number.disabled && !controls.updateValidity());
      invalidCountdownControl?.number.reportValidity();
      exportStatus.dataset.state = 'error';
      exportStatus.textContent = '导出失败：请先修正倒计时配置';
      return;
    }
    const invalidNamingControl = [...inputs.values()]
      .find((controls) => controls.isFilename && !controls.updateValidity());
    if (invalidNamingControl) {
      invalidNamingControl.textInput.reportValidity();
      exportStatus.dataset.state = 'error';
      exportStatus.textContent = '\u5bfc\u51fa\u5931\u8d25\uff1a\u8bf7\u5148\u4fee\u6b63\u5bfc\u51fa\u547d\u540d\u5b57\u6bb5';
      return;
    }
    const platform = all ? null : exportSelect.value;
    const brandingSet = exportSetSelect.value === 'crowd' ? 'crowd' : 'bus';
    const brandingSetLabel = brandingSet === 'crowd'
      ? 'BFT \u5408\u5e76\u4e00\u5957'
      : 'BL \u5b89\u5353/iOS \u5408\u5e76\u4e00\u5957';
    const platformLabel = all
      ? `\u5168\u90e8 7 \u4e2a\u5e73\u53f0 \u00d7 ${brandingSetLabel}`
      : `${PLAYABLE_EXPORT_PLATFORMS.find(([id]) => id === platform)?.[1] ?? platform}\uff08${brandingSetLabel}\uff09`;
    const variantCount = getExportVariantPlan(getTuning()).count;
    const exportLabel = `${platformLabel}，${variantCount}个版本 / ${variantCount * (all ? 7 : 1)}份`;
    playableExportBusy = true;
    exportSetSelect.disabled = true;
    exportSelect.disabled = true;
    exportButton.disabled = true;
    exportAllButton.disabled = true;
    exportButton.setAttribute('aria-busy', 'true');
    exportAllButton.setAttribute('aria-busy', 'true');
    exportStatus.dataset.state = 'busy';
    exportStatus.textContent = `\u6b63\u5728\u6253\u5305 ${exportLabel}...`;
    // The first export of a setup rebuilds every platform (about two minutes
    // on the one-CPU server) while a repeat of the same setup is much faster.
    // A live counter keeps that wait legible instead of looking hung.
    const exportStartedAt = Date.now();
    const exportElapsedTimer = setInterval(() => {
      const seconds = Math.round((Date.now() - exportStartedAt) / 1000);
      exportStatus.textContent = `\u6b63\u5728\u6253\u5305 ${exportLabel}...（已用 ${seconds} 秒）`;
    }, 1000);
    try {
      const exportPayload = getPlayableExportPayload() ?? { tuning: getTuning() };
      const response = await fetch(all ? '/__playable-export-all' : '/__playable-export', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(all
          ? { ...exportPayload, brandingSet }
          : { ...exportPayload, platform, brandingSet })
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        const baseMessage = payload.error || `HTTP ${response.status}`;
        const detail = typeof payload.detail === 'string' && payload.detail.trim()
          ? payload.detail.trim()
          : null;
        const detailAlreadyShown = detail && (
          baseMessage.includes(detail)
          || /^试玩包生成或本地检测失败[:：]/u.test(baseMessage)
        );
        const duration = Number(payload.durationMs);
        const durationMessage = Number.isFinite(duration) && duration > 0
          ? `，服务端耗时 ${Math.round(duration / 1000)} 秒`
          : '';
        throw new Error(`${baseMessage}${detail && !detailAlreadyShown ? `：${detail}` : ''}${durationMessage}`);
      }

      const blob = await response.blob();
      const filename = all || response.headers.get('Content-Type')?.includes('application/zip')
        ? (downloadFilename(response, 'all').replace(/\.html$/i, '.zip'))
        : downloadFilename(response, platform);
      const objectUrl = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = objectUrl;
      link.download = filename;
      link.hidden = true;
      document.body.append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(objectUrl), 0);

      const check = response.headers.get('X-Playable-Check');
      const serverMs = Number(response.headers.get('X-Playable-Export-Duration-Ms'));
      const totalSeconds = Math.max(1, Math.round((Date.now() - exportStartedAt) / 1000));
      const timingMessage = `\uff08\u8017\u65f6 ${Number.isFinite(serverMs) && serverMs > 0 ? Math.round(serverMs / 1000) : totalSeconds} \u79d2\uff09`;
      exportStatus.dataset.state = 'success';
      const checkMessage = check?.startsWith('skipped;')
        ? '\uff08\u672a\u6267\u884c\u672c\u5730\u68c0\u6d4b\uff09'
        : check ? `\uff08\u672c\u5730\u68c0\u6d4b ${check}\uff09` : '';
      // Package size is part of the result: it is the number the platform
      // measures, so showing it here is what lets an operator notice a package
      // creeping toward the cap before it is refused.
      const sizeMessage = blob.size > 0 ? `\uff08${formatKilobytes(blob.size)}\uff09` : '';
      exportStatus.textContent = `\u5df2\u4e0b\u8f7d ${filename}${sizeMessage}${checkMessage}${timingMessage}\uff0c\u5f85\u5e73\u53f0\u9a8c\u6536`;
    } catch (error) {
      exportStatus.dataset.state = 'error';
      const message = error instanceof TypeError && /fetch|network|failed to fetch/i.test(error.message)
        ? '\u65e0\u6cd5\u8fde\u63a5\u5bfc\u51fa\u670d\u52a1\uff0c\u8bf7\u786e\u8ba4\u5f53\u524d\u7535\u8111\u53ef\u8bbf\u95ee\u7f16\u8f91\u5668\u5730\u5740'
        : error.message;
      exportStatus.textContent = `\u5bfc\u51fa\u5931\u8d25\uff1a${message}`;
    } finally {
      clearInterval(exportElapsedTimer);
      exportSetSelect.disabled = false;
      exportSelect.disabled = false;
      playableExportBusy = false;
      updateCountdownControls();
      updateExportVariantControls();
      exportButton.removeAttribute('aria-busy');
      exportAllButton.removeAttribute('aria-busy');
    }
  }

  exportButton.addEventListener('click', () => exportPlayable());
  exportAllButton.addEventListener('click', () => exportPlayable({ all: true }));

  screenshotButton.addEventListener('click', async () => {
    const [width, height] = String(screenshotSelect.value || '720x1280')
      .split('x')
      .map((value) => Number(value));
    screenshotButton.disabled = true;
    screenshotSelect.disabled = true;
    screenshotButton.setAttribute('aria-busy', 'true');
    screenshotStatus.dataset.state = 'busy';
    screenshotStatus.textContent = `\u6b63\u5728\u622a\u53d6 ${width} x ${height}...`;
    try {
      const result = await captureScreenshot({ width, height });
      screenshotStatus.dataset.state = 'success';
      screenshotStatus.textContent = `\u5df2\u4e0b\u8f7d ${result?.filename ?? `${width}x${height}.png`}\uff0c\u4e0d\u5305\u542b\u624b\u673a\u8fb9\u6846`;
    } catch (error) {
      screenshotStatus.dataset.state = 'error';
      screenshotStatus.textContent = `\u622a\u56fe\u5931\u8d25\uff1a${error.message}`;
    } finally {
      screenshotButton.disabled = false;
      screenshotSelect.disabled = false;
      screenshotButton.removeAttribute('aria-busy');
    }
  });

  for (const group of FIELD_GROUPS) {
    const section = document.createElement('details');
    section.className = 'editor-section';
    section.dataset.editorCategory = editorCategoryForGroup(group);
    // The classic sidebar opens a handful of groups by default because it shows
    // one panel at a time. The shell already splits the sections across nine
    // panels, so opening every flagged group as well left the guide panel at
    // four screens of scrolling; it collapses them and opens only the first
    // section of each sub-group after the split is known.
    section.open = shellLayout ? false : Boolean(group.defaultOpen);
    if (group.conveyorLayout) section.dataset.conveyorLayout = group.conveyorLayout;
    if (group.spatialOnly) section.dataset.spatialOnly = 'true';
    if (group.spatialImportAnchor) section.dataset.spatialImportAnchor = 'true';
    section.innerHTML = `<summary class="editor-section-summary"><h3>${group.title}</h3></summary>`;
    for (const [label, path, min, max, step, configuredOptions, control] of group.fields) {
      const options = control === 'vehicle-id-select'
        ? getVehicleIdOptions(LEVEL_1.vehicles)
        : configuredOptions;
      const isColor = /color$/i.test(path) || /^passengerMaterial\.solidColors\.\d+$/.test(path);
      const isToggle = control === 'toggle';
      const isCountdownNumber = control === 'countdown-number';
      const isFilename = control === 'filename';
      const isVariant = control === 'variant';
      const isText = control === 'text' || isFilename || isVariant;
      const isUrl = control === 'url';
      const row = document.createElement('label');
      row.className = 'editor-field';
      row.dataset.path = path;
      if (isColor) row.classList.add('editor-field-color');
      if (options) row.classList.add('editor-field-select');
      if (isToggle) row.classList.add('editor-field-toggle');
      if (isText) row.classList.add('editor-field-text');
      if (isUrl) row.classList.add('editor-field-url');
      const optionsMarkup = options
        ? `<select class="editor-select">${options.map(([value, text]) => `<option value="${value}">${text}</option>`).join('')}</select>`
        : '';
      const rangeMarkup = isColor || isToggle || isText || isUrl
        ? ''
        : `<input class="editor-range" type="range" min="${min}" max="${max}" step="${step}">`;
      row.innerHTML = `
        <span>${label}</span>
        ${optionsMarkup}
        ${options ? '' : rangeMarkup}
        ${isColor && !options ? '<input class="editor-color" type="color">' : ''}
        ${isToggle ? `<input class="editor-checkbox" type="checkbox" role="switch" aria-label="${group.title} ${label}">` : ''}
        ${isText ? `<input class="editor-text" type="text"${isFilename ? ' maxlength="64" pattern="[A-Za-z0-9_-]+" spellcheck="false"' : ''} aria-label="${group.title} ${label}">` : ''}
        ${isUrl ? `<input class="editor-url" type="url" inputmode="url" spellcheck="false" aria-label="${group.title} ${label}">` : ''}
        ${options || isToggle || isText || isUrl ? '' : `<input class="editor-number" type="number" min="${min}" max="${max}" step="${step}" aria-label="${group.title} ${label}">`}
      `;
      const select = row.querySelector('.editor-select');
      const range = row.querySelector('.editor-range');
      const number = row.querySelector('.editor-number');
      const color = row.querySelector('.editor-color');
      const checkbox = row.querySelector('.editor-checkbox');
      const textInput = row.querySelector('.editor-text');
      if (path === 'cta.text') {
        textInput.placeholder = '留空时跟随设备语言';
        textInput.maxLength = 4096;
      }
      const urlInput = row.querySelector('.editor-url');
      if (isVariant) {
        textInput.maxLength = 256;
        textInput.spellcheck = false;
        textInput.placeholder = path.endsWith('.version') ? '如 3/5/10' : '如 10/20';
      }
      if (control === 'stamina-number') {
        range.setAttribute('aria-label', `${group.title} ${label}滑条`);
        let livesDirty = false;
        const commitLives = (rawValue) => {
          const current = normalizeStaminaConfig(getTuning().stamina);
          const lives = rawValue.trim() === '' ? current.lives : normalizeStaminaConfig({ lives: rawValue }).lives;
          if (lives !== current.lives || getTuning().exportNaming?.version !== String(lives)) {
            const next = structuredClone(getTuning());
            next.stamina = { ...current, lives };
            commitTuning(next, { path });
          }
          number.value = String(lives);
          range.value = String(lives);
          sync();
        };
        range.addEventListener('input', () => commitLives(range.value));
        number.addEventListener('input', () => { livesDirty = true; });
        number.addEventListener('blur', () => {
          if (livesDirty) commitLives(number.value);
          livesDirty = false;
        });
        number.addEventListener('keydown', event => {
          if (event.key !== 'Enter') return;
          event.preventDefault();
          if (livesDirty) commitLives(number.value);
          livesDirty = false;
        });
        inputs.set(path, { row, range, number, step });
        section.append(row);
        continue;
      }
      if (options) {
        // The built-in background set has a measured playfield boundary; keeping
        // it on the option is what lets switching artwork re-align the plane
        // without a server round-trip.
        if (path === 'background.asset') {
          for (const option of select.options) {
            const horizon = resolveBackgroundHorizon(option.value);
            if (horizon) option.dataset.horizon = String(horizon);
          }
        }
        const commitOption = (rawValue) => {
          const value = control === 'vehicle-id-select'
            ? normalizeVehicleIdSelection(rawValue)
            : rawValue;
          if (value === null) return;
          const next = structuredClone(getTuning());
          setAtPath(next, path, value);
          if (path === 'stamina.horizontalAlign') next.stamina.offsetX = 0;
          // Picking a guide car is a statement about THIS level. Without this the
          // levelKey keeps pointing at whichever level it was authored on, and the
          // hand silently refuses to appear on the level being edited.
          if (path === 'vehicleGuideHand.vehicleId') {
            setAtPath(next, 'vehicleGuideHand.levelKey', getAtPath(next, 'level.selected'));
          }
          if (path === 'background.asset') applySelectedBackgroundDimensions(next, select.selectedOptions?.[0]);
          commitTuning(next, { path });
          select.value = String(value);
          sync();
        };
        select.addEventListener('change', () => commitOption(select.value));
        inputs.set(path, { row, select, step, options });
        section.append(row);
        continue;
      }
      if (isToggle) {
        checkbox.addEventListener('change', () => {
          const next = structuredClone(getTuning());
          setAtPath(next, path, checkbox.checked ? 1 : 0);
          if (path === 'vehicleGuideHand.enabled' && checkbox.checked) {
            setAtPath(next, 'vehicleGuideHand.levelKey', getAtPath(next, 'level.selected'));
          }
          commitTuning(next, { path });
          if (path === 'firstClickGuide.enabled' || path.startsWith('countdown.') || path.startsWith('stamina.') || path.startsWith('installGate.')) sync();
        });
        inputs.set(path, { row, checkbox, step });
        section.append(row);
        continue;
      }
      if (isText) {
        const updateValidity = () => {
          if (isVariant) {
            const enabled = path.endsWith('.version') ? Number(getTuning().stamina?.enabled) === 1 : isInstallGateEnabled(getTuning().installGate);
            let message = '';
            try { parseExportVariantValues(textInput.value, path.endsWith('.version') ? 'stamina' : 'steps', enabled); }
            catch (error) { message = error.message; }
            textInput.setAttribute('aria-invalid', String(Boolean(message)));
            textInput.setCustomValidity(message);
            return !message;
          }
          if (!isFilename) return true;
          const valid = isValidExportNamingPart(textInput.value);
          textInput.setAttribute('aria-invalid', String(!valid));
          textInput.setCustomValidity(valid ? '' : '\u53ef\u7559\u7a7a\uff0c\u6216\u8f93\u5165 1-64 \u4f4d\u82f1\u6587\u5b57\u6bcd\u3001\u6570\u5b57\u3001\u4e2d\u5212\u7ebf\u548c\u4e0b\u5212\u7ebf\uff0c\u4e0d\u80fd\u5305\u542b ..');
          return valid;
        };
        textInput.addEventListener('input', () => {
          updateValidity();
          const next = structuredClone(getTuning());
          setAtPath(next, path, textInput.value);
          commitTuning(next, { path, merge: true });
          if (isVariant) sync();
        });
        textInput.addEventListener('blur', updateValidity);
        inputs.set(path, { row, textInput, isFilename, isVariant, updateValidity });
        section.append(row);
        continue;
      }
      if (isCountdownNumber) {
        const key = path.slice('countdown.'.length);
        range.setAttribute('aria-label', `${group.title} ${label}滑条`);
        const error = document.createElement('p');
        error.className = 'editor-camera-status';
        error.dataset.state = 'error';
        error.id = `countdown-${key}-error`;
        error.hidden = true;
        error.setAttribute('role', 'status');
        number.setAttribute('aria-describedby', error.id);
        const controls = { row, range, number, step, isCountdownNumber: true, dirty: false, lastValue: undefined };
        const updateValidity = () => {
          const value = Number(number.value);
          const limit = key === 'warningSeconds'
            ? normalizeCountdownConfig(getTuning().countdown).durationSeconds
            : 120;
          const valid = number.disabled || (number.value.trim() !== '' && !number.validity.badInput
            && Number.isInteger(value) && value >= 0 && value <= limit);
          const message = valid ? '' : `请输入 0–${limit} 的整数秒数`;
          number.setAttribute('aria-invalid', String(!valid));
          number.setCustomValidity(message);
          error.textContent = message;
          error.hidden = valid;
          if (valid && number.value.trim() !== '') range.value = number.value;
          return valid;
        };
        const commitCountdownNumber = () => {
          if (number.disabled || !updateValidity()) { updateCountdownControls(); return; }
          const value = Number(number.value);
          const current = normalizeCountdownConfig(getTuning().countdown);
          controls.dirty = false;
          if (current[key] !== value) {
            const next = structuredClone(getTuning());
            next.countdown = { ...current, [key]: value };
            if (key === 'durationSeconds') next.countdown.warningSeconds = Math.min(current.warningSeconds, value);
            commitTuning(next, { path });
          }
          sync();
        };
        controls.updateValidity = updateValidity;
        number.addEventListener('input', () => {
          controls.dirty = true;
          updateCountdownControls();
        });
        range.addEventListener('input', () => {
          number.value = range.value;
          controls.dirty = true;
          updateCountdownControls();
        });
        range.addEventListener('change', commitCountdownNumber);
        number.addEventListener('blur', commitCountdownNumber);
        number.addEventListener('keydown', (event) => {
          if (event.key !== 'Enter') return;
          event.preventDefault();
          commitCountdownNumber();
        });
        inputs.set(path, controls);
        section.append(row, error);
        continue;
      }
      if (isUrl) {
        const platform = path.endsWith('.ios') ? 'ios' : 'android';
        const updateValidity = () => {
          const valid = isValidStoreLink(platform, urlInput.value);
          urlInput.setAttribute('aria-invalid', String(!valid));
          urlInput.setCustomValidity(valid ? '' : `\u8bf7\u8f93\u5165\u6709\u6548\u7684 ${platform === 'ios' ? 'Apple App Store' : 'Google Play'} HTTPS \u5546\u54c1\u94fe\u63a5`);
          return valid;
        };
        urlInput.addEventListener('input', () => {
          if (!updateValidity()) return;
          const next = structuredClone(getTuning());
          const value = urlInput.value.trim();
          setAtPath(next, path, value);
          commitTuning(next, { path, merge: true });
        });
        urlInput.addEventListener('blur', updateValidity);
        inputs.set(path, { row, urlInput, platform, updateValidity });
        section.append(row);
        continue;
      }
      const commit = (rawValue) => {
        const value = Math.min(max, Math.max(min, Number(rawValue)));
        if (!Number.isFinite(value)) return;
        const next = structuredClone(getTuning());
        setAtPath(next, path, value);
        commitTuning(next, { path, merge: true });
        if (range) range.value = String(value);
        number.value = formatValue(value, step);
        if (color) color.value = formatColor(value);
        if (path === 'installGate.successfulOperationThreshold') sync();
      };
      range?.addEventListener('input', () => commit(range.value));
      number.addEventListener(isColor ? 'change' : 'input', () => commit(number.value));
      color?.addEventListener('change', () => commit(parseInt(color.value.slice(1), 16)));
      inputs.set(path, { row, range, number, color, step });
      section.append(row);
    }
    if (group.countdown || group.stamina) {
      const help = document.createElement('p');
      help.className = 'editor-camera-status';
      help.textContent = group.stamina
        ? '点错与满车位救援共用体力。水平偏移0为所选对齐位置，正数向右、负数向左；切换对齐时水平偏移归零。缩放1为默认大小。'
        : '偏移0，缩放1为默认对齐';
      section.append(help);
    }
    if (group.fields.some(([, path]) => path === 'gameOver.retryEnabled')) {
      const help = document.createElement('p');
      help.className = 'editor-camera-status';
      help.textContent = '关闭重试按钮后，icon落版出现即可点击试玩画面任意位置跳转商店。';
      section.append(help);
    }
    fieldsRoot.append(section);
  }

  const cameraControls = inputs.get('camera.fitWidth');
  const cameraSection = cameraControls?.row.closest('.editor-section');
  const cameraTools = document.createElement('div');
  cameraTools.className = 'editor-camera-tools';
  cameraTools.innerHTML = `
    <div class="editor-camera-actions" role="group" aria-label="相机快捷视图">
      <button type="button" data-camera-action="auto">自动取景</button>
      <button type="button" data-camera-action="vehicles">车阵聚焦</button>
      <button type="button" data-camera-action="conveyor">传送带聚焦</button>
      <button type="button" data-camera-action="default">默认视图</button>
    </div>
    <p class="editor-camera-status" role="status" aria-live="polite">就绪</p>
  `;
  cameraSection?.append(cameraTools);
  const cameraStatus = cameraTools.querySelector('.editor-camera-status');
  for (const button of cameraTools.querySelectorAll('[data-camera-action]')) {
    button.addEventListener('click', () => {
      const action = button.dataset.cameraAction;
      try {
        const camera = getCameraPreset(action);
        if (!camera) throw new Error('当前视图不可用');
        const next = structuredClone(getTuning());
        setAtPath(next, 'camera', structuredClone(camera));
        commitTuning(next, { path: 'camera' });
        sync();
        cameraStatus.dataset.state = 'success';
        cameraStatus.textContent = action === 'default'
          ? '已恢复默认视图'
          : '已更新视图，可继续微调';
      } catch (error) {
        cameraStatus.dataset.state = 'error';
        cameraStatus.textContent = `视图调整失败：${error.message}`;
      }
    });
  }

  const preRollControls = inputs.get('preRoll.asset');
  const preRollSection = preRollControls?.row.closest('.editor-section');
  const preRollPreviewButton = document.createElement('button');
  preRollPreviewButton.className = 'editor-pre-roll-preview';
  preRollPreviewButton.type = 'button';
  preRollPreviewButton.textContent = '\u91cd\u65b0\u64ad\u653e\u524d\u8d34';
  preRollPreviewButton.addEventListener('click', () => {
    void Promise.resolve(previewPreRoll()).catch((error) => {
      console.warn('\u524d\u8d34\u89c6\u9891\u9884\u89c8\u5931\u8d25\u3002', error);
    });
  });
  const preRollTools = document.createElement('div');
  preRollTools.className = 'editor-pre-roll-tools';
  preRollTools.innerHTML = `
    <div class="editor-pre-roll-actions">
      <button class="editor-pre-roll-import" type="button">\u4e0a\u4f20\u89c6\u9891</button>
      <button class="editor-pre-roll-rename" type="button">\u4fee\u6539\u540d\u79f0</button>
      <button class="editor-pre-roll-delete" type="button">\u5220\u9664\u89c6\u9891</button>
      <button class="editor-pre-roll-download" type="button">\u4e0b\u8f7d\u89c6\u9891</button>
    </div>
    <input class="editor-pre-roll-file" type="file" accept="video/mp4,.mp4" hidden>
    <p class="editor-pre-roll-status" role="status" aria-live="polite">\u652f\u6301 50 MB \u4ee5\u5185 MP4，\u4e0a\u4f20\u540e\u4f1a\u81ea\u52a8\u538b\u7f29\u81f3 2 MB \u4ee5\u5185</p>
  `;
  preRollSection?.append(preRollPreviewButton, preRollTools);
  const preRollImportButton = preRollTools.querySelector('.editor-pre-roll-import');
  const preRollRenameButton = preRollTools.querySelector('.editor-pre-roll-rename');
  const preRollDeleteButton = preRollTools.querySelector('.editor-pre-roll-delete');
  const preRollDownloadButton = preRollTools.querySelector('.editor-pre-roll-download');
  const preRollFileInput = preRollTools.querySelector('.editor-pre-roll-file');
  const preRollStatus = preRollTools.querySelector('.editor-pre-roll-status');
  let preRollBusy = false;

  function setPreRollBusy(busy) {
    preRollBusy = busy;
    const custom = isCustomPreRollAsset(getTuning().preRoll?.asset);
    preRollImportButton.disabled = busy;
    preRollRenameButton.disabled = busy || !custom;
    preRollDeleteButton.disabled = busy || !custom;
    preRollDownloadButton.disabled = busy || !getTuning().preRoll?.asset;
    preRollPreviewButton.disabled = busy || !Boolean(getTuning().preRoll?.enabled);
  }

  function replaceCustomPreRollOptions(items = []) {
    const select = preRollControls?.select;
    if (!select) return;
    for (const option of [...select.querySelectorAll('[data-custom-pre-roll]')]) option.remove();
    for (const item of items) {
      if (!item?.value || !item?.label || select.querySelector(`option[value="${CSS.escape(item.value)}"]`)) continue;
      const option = document.createElement('option');
      option.value = item.value;
      option.textContent = item.label;
      option.dataset.customPreRoll = 'true';
      select.append(option);
    }
  }

  async function refreshPreRollOptions() {
    const response = await fetch(CUSTOM_PRE_ROLL_ENDPOINT, { cache: 'no-store' });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || `HTTP ${response.status}`);
    replaceCustomPreRollOptions(payload.items ?? []);
    const current = getTuning().preRoll?.asset;
    ensurePreRollSelectValue(preRollControls?.select, current);
    if (preRollControls?.select) preRollControls.select.value = current ?? '';
    return payload.items ?? [];
  }

  async function importPreRollFile(file) {
    if (!isSupportedPreRollFile(file)) {
      throw new Error('\u4ec5\u652f\u6301 50 MB \u4ee5\u5185\u7684 MP4 \u89c6\u9891');
    }
    const response = await fetch(`${CUSTOM_PRE_ROLL_ENDPOINT}/import`, {
      method: 'POST',
      headers: {
        'Content-Type': 'video/mp4',
        'X-Pre-Roll-Filename': encodeURIComponent(file.name)
      },
      body: file
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || `HTTP ${response.status}`);
    if (!payload.item?.value) throw new Error('\u670d\u52a1\u672a\u8fd4\u56de\u524d\u8d34\u89c6\u9891\u5730\u5740');
    await refreshPreRollOptions();
    const next = structuredClone(getTuning());
    next.preRoll.asset = payload.item.value;
    ensurePreRollSelectValue(preRollControls?.select, payload.item.value, payload.item.label);
    commitTuning(next, { path: 'preRoll.asset' });
    sync();
    return payload.item;
  }

  preRollImportButton.addEventListener('click', () => preRollFileInput.click());
  preRollRenameButton.addEventListener('click', async () => {
    const current = getTuning().preRoll?.asset;
    if (!isCustomPreRollAsset(current)) {
      preRollStatus.dataset.state = 'error';
      preRollStatus.textContent = '\u53ea\u80fd\u4fee\u6539\u81ea\u5b9a\u4e49\u524d\u8d34\u540d\u79f0';
      return;
    }
    const currentOption = preRollControls?.select?.selectedOptions?.[0];
    const currentLabel = currentOption?.textContent?.replace(/^\u81ea\u5b9a\u4e49\s*/u, '') || '';
    const label = window.prompt('\u8bf7\u8f93\u5165\u524d\u8d34\u89c6\u9891\u540d\u79f0', currentLabel);
    if (label == null || !label.trim()) return;
    setPreRollBusy(true);
    try {
      const filename = current.slice(CUSTOM_PRE_ROLL_ASSET_PREFIX.length);
      const response = await fetch(`${CUSTOM_PRE_ROLL_ENDPOINT}/rename`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
        body: JSON.stringify({ filename, label: label.trim() })
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || `HTTP ${response.status}`);
      await refreshPreRollOptions();
      ensurePreRollSelectValue(preRollControls?.select, current, payload.item?.label);
      sync();
      preRollStatus.dataset.state = 'success';
      preRollStatus.textContent = `\u5df2\u4fee\u6539\u524d\u8d34\u540d\u79f0\u4e3a ${label.trim()}`;
    } catch (error) {
      preRollStatus.dataset.state = 'error';
      preRollStatus.textContent = `\u4fee\u6539\u5931\u8d25\uff1a${error.message}`;
    } finally {
      setPreRollBusy(false);
    }
  });
  preRollDeleteButton.addEventListener('click', async () => {
    const current = getTuning().preRoll?.asset;
    if (!isCustomPreRollAsset(current)) {
      preRollStatus.dataset.state = 'error';
      preRollStatus.textContent = '\u53ea\u80fd\u5220\u9664\u81ea\u5b9a\u4e49\u524d\u8d34\u89c6\u9891';
      return;
    }
    if (!window.confirm('\u786e\u5b9a\u5220\u9664\u5f53\u524d\u81ea\u5b9a\u4e49\u524d\u8d34\u89c6\u9891\uff1f')) return;
    setPreRollBusy(true);
    try {
      const filename = current.slice(CUSTOM_PRE_ROLL_ASSET_PREFIX.length);
      const response = await fetch(`${CUSTOM_PRE_ROLL_ENDPOINT}?filename=${encodeURIComponent(filename)}`, { method: 'DELETE' });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || `HTTP ${response.status}`);
      const next = structuredClone(getTuning());
      next.preRoll.asset = defaults.preRoll?.asset || PRE_ROLL_OPTIONS[0][0];
      commitTuning(next, { path: 'preRoll.asset' });
      await refreshPreRollOptions();
      sync();
      preRollStatus.dataset.state = 'success';
      preRollStatus.textContent = '\u5df2\u5220\u9664\u524d\u8d34\u89c6\u9891\u5e76\u6062\u590d\u9ed8\u8ba4';
    } catch (error) {
      preRollStatus.dataset.state = 'error';
      preRollStatus.textContent = `\u5220\u9664\u5931\u8d25\uff1a${error.message}`;
    } finally {
      setPreRollBusy(false);
    }
  });
  preRollDownloadButton.addEventListener('click', async () => {
    const current = getTuning().preRoll?.asset;
    if (!current) return;
    const currentLabel = preRollControls?.select?.selectedOptions?.[0]?.textContent || 'pre-roll';
    setPreRollBusy(true);
    preRollStatus.dataset.state = 'busy';
    preRollStatus.textContent = '\u6b63\u5728\u51c6\u5907\u524d\u8d34\u89c6\u9891\u4e0b\u8f7d...';
    let objectUrl = '';
    try {
      const response = await fetch(current, { cache: 'no-store' });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const blob = await response.blob();
      if (!blob.size) throw new Error('\u524d\u8d34\u89c6\u9891\u5185\u5bb9\u4e3a\u7a7a');
      objectUrl = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = objectUrl;
      link.download = getPreRollDownloadFilename(current, currentLabel);
      link.rel = 'noopener';
      const filename = link.download;
      document.body.append(link);
      link.click();
      link.remove();
      preRollStatus.dataset.state = 'success';
      preRollStatus.textContent = `\u5df2\u4e0b\u8f7d ${filename} (${formatAssetBytes(blob.size)})`;
    } catch (error) {
      preRollStatus.dataset.state = 'error';
      preRollStatus.textContent = `\u4e0b\u8f7d\u5931\u8d25\uff1a${error.message}`;
    } finally {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      setPreRollBusy(false);
    }
  });
  preRollFileInput.addEventListener('change', async () => {
    const [file] = preRollFileInput.files ?? [];
    preRollFileInput.value = '';
    if (!file) return;
    setPreRollBusy(true);
    preRollStatus.dataset.state = 'busy';
    preRollStatus.textContent = `\u6b63\u5728\u4e0a\u4f20\u5e76\u538b\u7f29 ${file.name}...`;
    try {
      const item = await importPreRollFile(file);
      preRollStatus.dataset.state = 'success';
      preRollStatus.textContent = `\u5df2\u538b\u7f29\u5e76\u5207\u6362\u5230 ${item.label} (${formatAssetBytes(item.sourceBytes ?? file.size)} -> ${formatAssetBytes(item.bytes)})`;
    } catch (error) {
      preRollStatus.dataset.state = 'error';
      preRollStatus.textContent = `\u4e0a\u4f20\u5931\u8d25\uff1a${error.message}`;
    } finally {
      setPreRollBusy(false);
    }
  });

  const backgroundControls = inputs.get('background.asset');
  const backgroundSection = backgroundControls?.row.closest('.editor-section');
  const backgroundTools = document.createElement('div');
  backgroundTools.className = 'editor-background-tools';
  backgroundTools.innerHTML = `
    <div class="editor-background-actions">
      <button class="editor-background-import" type="button">\u6dfb\u52a0\u80cc\u666f</button>
      <button class="editor-background-rename" type="button">修改名称</button>
      <button class="editor-background-delete" type="button">\u5220\u9664\u80cc\u666f</button>
      <button class="editor-background-reset" type="button">\u91cd\u7f6e\u80cc\u666f</button>
      <button class="editor-background-download" type="button">下载背景图</button>
    </div>
    <input class="editor-background-file" type="file" accept="image/png,image/jpeg,image/webp,.png,.jpg,.jpeg,.webp" hidden>
    <p class="editor-background-status" aria-live="polite">\u652f\u6301 PNG\u3001JPG\u3001WebP\uff0c\u4f1a\u6309\u539f\u80cc\u666f\u5c3a\u5bf8\u5904\u7406\u540e\u52a0\u5165\u5217\u8868</p>
  `;
  backgroundSection?.append(backgroundTools);
  const backgroundImportButton = backgroundTools.querySelector('.editor-background-import');
  const backgroundRenameButton = backgroundTools.querySelector('.editor-background-rename');
  const backgroundDeleteButton = backgroundTools.querySelector('.editor-background-delete');
  const backgroundResetButton = backgroundTools.querySelector('.editor-background-reset');
  const backgroundDownloadButton = backgroundTools.querySelector('.editor-background-download');
  const backgroundFileInput = backgroundTools.querySelector('.editor-background-file');
  const backgroundStatus = backgroundTools.querySelector('.editor-background-status');

  function setBackgroundBusy(busy) {
    backgroundImportButton.disabled = busy;
    backgroundRenameButton.disabled = busy || !isCustomBackgroundAsset(getTuning().background?.asset);
    backgroundDeleteButton.disabled = busy || !isCustomBackgroundAsset(getTuning().background?.asset);
    backgroundResetButton.disabled = busy;
    backgroundDownloadButton.disabled = busy || !getTuning().background?.asset;
  }

  function replaceCustomBackgroundOptions(items = []) {
    const select = backgroundControls?.select;
    if (!select) return;
    for (const option of [...select.querySelectorAll('[data-custom-background]')]) option.remove();
    for (const item of items) {
      if (!item?.value || !item?.label || select.querySelector(`option[value="${CSS.escape(item.value)}"]`)) continue;
      const option = document.createElement('option');
      option.value = item.value;
      option.textContent = item.label;
      option.dataset.customBackground = 'true';
      if (item.width) option.dataset.sourceWidth = String(item.width);
      if (item.height) option.dataset.sourceHeight = String(item.height);
      if (item.horizon) option.dataset.horizon = String(item.horizon);
      select.append(option);
    }
  }

  async function refreshBackgroundOptions() {
    const response = await fetch(CUSTOM_BACKGROUND_ENDPOINT, { cache: 'no-store' });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || `HTTP ${response.status}`);
    replaceCustomBackgroundOptions(payload.items ?? []);
    const current = getTuning().background?.asset;
    ensureBackgroundSelectValue(backgroundControls?.select, current);
    if (backgroundControls?.select) backgroundControls.select.value = current ?? '';
    return payload.items ?? [];
  }

  async function importBackgroundFile(file) {
    const prepared = await prepareBackgroundUpload(file);
    const response = await fetch(`${CUSTOM_BACKGROUND_ENDPOINT}/import`, {
      method: 'POST',
      headers: {
        'Content-Type': 'image/jpeg',
        'X-Background-Filename': encodeURIComponent(file.name),
        'X-Background-Width': String(prepared.width),
        'X-Background-Height': String(prepared.height),
        ...(prepared.horizon ? { 'X-Background-Horizon': String(prepared.horizon) } : {})
      },
      body: prepared.blob
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || `HTTP ${response.status}`);
    if (!payload.item?.value) throw new Error('\u670d\u52a1\u672a\u8fd4\u56de\u80cc\u666f\u5730\u5740');
    await refreshBackgroundOptions();
    const next = structuredClone(getTuning());
    next.background.asset = payload.item.value;
    next.background.sourceWidth = payload.item.width || prepared.width;
    next.background.sourceHeight = payload.item.height || prepared.height;
    // Prefer the measured value: the server echoes what it stored, and the
    // client already measured the exact pixels it uploaded.
    const horizon = Number(payload.item.horizon) || prepared.horizon;
    if (Number.isFinite(horizon) && horizon > 0 && horizon < 1) next.background.horizon = horizon;
    else delete next.background.horizon;
    ensureBackgroundSelectValue(backgroundControls?.select, payload.item.value, payload.item.label);
    if (Number.isFinite(horizon) && horizon > 0 && horizon < 1) {
      const option = [...(backgroundControls?.select?.options ?? [])].find((entry) => entry.value === payload.item.value);
      if (option) option.dataset.horizon = String(horizon);
    }
    commitTuning(next, { path: 'background.asset' });
    sync();
    return payload.item;
  }

  backgroundImportButton.addEventListener('click', () => backgroundFileInput.click());
  backgroundRenameButton.addEventListener('click', async () => {
    const current = getTuning().background?.asset;
    if (!isCustomBackgroundAsset(current)) {
      backgroundStatus.dataset.state = 'error';
      backgroundStatus.textContent = '只能修改自定义背景名称';
      return;
    }
    const currentOption = backgroundControls?.select?.selectedOptions?.[0];
    const currentLabel = currentOption?.textContent?.replace(/^自定义\s*/u, '') || '';
    const label = window.prompt('请输入背景名称', currentLabel);
    if (label == null || !label.trim()) return;
    setBackgroundBusy(true);
    try {
      const filename = current.slice('/assets/editor-backgrounds/'.length);
      const response = await fetch(`${CUSTOM_BACKGROUND_ENDPOINT}/rename`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
        body: JSON.stringify({ filename, label: label.trim() })
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || `HTTP ${response.status}`);
      await refreshBackgroundOptions();
      ensureBackgroundSelectValue(backgroundControls?.select, current, payload.item?.label);
      sync();
      backgroundStatus.dataset.state = 'success';
      backgroundStatus.textContent = `已修改背景名称为 ${label.trim()}`;
    } catch (error) {
      backgroundStatus.dataset.state = 'error';
      backgroundStatus.textContent = `修改失败：${error.message}`;
    } finally {
      setBackgroundBusy(false);
    }
  });
  backgroundDeleteButton.addEventListener('click', async () => {
    const current = getTuning().background?.asset;
    if (!isCustomBackgroundAsset(current)) {
      backgroundStatus.dataset.state = 'error';
      backgroundStatus.textContent = '\u53ea\u80fd\u5220\u9664\u81ea\u5b9a\u4e49\u80cc\u666f';
      return;
    }
    if (!window.confirm('\u786e\u5b9a\u5220\u9664\u5f53\u524d\u81ea\u5b9a\u4e49\u80cc\u666f\uff1f')) return;
    setBackgroundBusy(true);
    try {
      const filename = current.slice('/assets/editor-backgrounds/'.length);
      const response = await fetch(`${CUSTOM_BACKGROUND_ENDPOINT}?filename=${encodeURIComponent(filename)}`, { method: 'DELETE' });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || `HTTP ${response.status}`);
      const next = structuredClone(getTuning());
      next.background = structuredClone(defaults.background);
      commitTuning(next, { path: 'background.asset' });
      await refreshBackgroundOptions();
      sync();
      backgroundStatus.dataset.state = 'success';
      backgroundStatus.textContent = '\u5df2\u5220\u9664\u5e76\u6062\u590d\u9ed8\u8ba4\u80cc\u666f';
    } catch (error) {
      backgroundStatus.dataset.state = 'error';
      backgroundStatus.textContent = `\u5220\u9664\u5931\u8d25\uff1a${error.message}`;
    } finally {
      setBackgroundBusy(false);
    }
  });
  backgroundResetButton.addEventListener('click', () => {
    const next = structuredClone(getTuning());
    next.background = structuredClone(defaults.background);
    commitTuning(next, { path: 'background.asset' });
    sync();
    backgroundStatus.dataset.state = 'success';
    backgroundStatus.textContent = '\u80cc\u666f\u5df2\u91cd\u7f6e\u4e3a\u9ed8\u8ba4\u56fe\u7247\u3001\u4f4d\u7f6e\u3001\u7f29\u653e\u548c\u900f\u660e\u5ea6';
  });
  backgroundDownloadButton.addEventListener('click', async () => {
    const current = getTuning().background?.asset;
    if (!current) return;
    const currentLabel = backgroundControls?.select?.selectedOptions?.[0]?.textContent || 'background';
    setBackgroundBusy(true);
    backgroundStatus.dataset.state = 'busy';
    backgroundStatus.textContent = '\u6b63\u5728\u51c6\u5907\u80cc\u666f\u56fe\u4e0b\u8f7d...';
    let objectUrl = '';
    try {
      const response = await fetch(current, { cache: 'no-store' });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const blob = await response.blob();
      if (!blob.size) throw new Error('\u80cc\u666f\u56fe\u5185\u5bb9\u4e3a\u7a7a');
      objectUrl = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = objectUrl;
      link.download = getBackgroundDownloadFilename(current, currentLabel);
      link.rel = 'noopener';
      document.body.append(link);
      link.click();
      link.remove();
      backgroundStatus.dataset.state = 'success';
      backgroundStatus.textContent = `\u5df2\u4e0b\u8f7d ${link.download}`;
    } catch (error) {
      backgroundStatus.dataset.state = 'error';
      backgroundStatus.textContent = `\u4e0b\u8f7d\u5931\u8d25\uff1a${error.message}`;
    } finally {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      setBackgroundBusy(false);
    }
  });
  backgroundFileInput.addEventListener('change', async () => {
    const [file] = backgroundFileInput.files ?? [];
    backgroundFileInput.value = '';
    if (!file) return;
    setBackgroundBusy(true);
    backgroundStatus.dataset.state = 'busy';
    backgroundStatus.textContent = '\u6b63\u5728\u5904\u7406\u5e76\u6dfb\u52a0\u80cc\u666f...';
    try {
      const item = await importBackgroundFile(file);
      backgroundStatus.dataset.state = 'success';
      backgroundStatus.textContent = `\u5df2\u6dfb\u52a0\u5e76\u5207\u6362\u5230 ${item.label}`;
    } catch (error) {
      backgroundStatus.dataset.state = 'error';
      backgroundStatus.textContent = `\u6dfb\u52a0\u5931\u8d25\uff1a${error.message}`;
    } finally {
      setBackgroundBusy(false);
    }
  });

  /* --- Guide media libraries --------------------------------------------------
   * Background music, weather sprites and free-asset artwork all come from the
   * same kind of library (list / upload / rename / delete) and all offer the
   * same download affordance. One factory keeps the three panels honest instead
   * of three near-copies drifting apart.
   */
  function createGuideAssetPanel({ kind, label, accept, selectPath, section, hint }) {
    const tools = document.createElement('div');
    tools.className = 'editor-pre-roll-tools';
    tools.innerHTML = `
      <div class="editor-pre-roll-actions">
        <button class="editor-guide-asset-import" type="button">\u4e0a\u4f20${label}</button>
        <button class="editor-guide-asset-delete" type="button">\u5220\u9664${label}</button>
        <button class="editor-guide-asset-download" type="button">\u4e0b\u8f7d${label}</button>
      </div>
      <input class="editor-guide-asset-file" type="file" accept="${accept}" hidden>
      <p class="editor-pre-roll-status" role="status" aria-live="polite">${hint}</p>
    `;
    section?.append(tools);
    const importButton = tools.querySelector('.editor-guide-asset-import');
    const deleteButton = tools.querySelector('.editor-guide-asset-delete');
    const downloadButton = tools.querySelector('.editor-guide-asset-download');
    const fileInput = tools.querySelector('.editor-guide-asset-file');
    const status = tools.querySelector('.editor-pre-roll-status');
    const endpoint = `/__guide-assets/${kind}`;
    let busy = false;

    const currentAsset = () => {
      const value = getAtPath(getTuning(), selectPath);
      return typeof value === 'string' ? value : '';
    };
    const assetOptions = () => inputs.get(selectPath)?.select;
    const setBusy = (next) => {
      busy = next;
      importButton.disabled = busy;
      deleteButton.disabled = busy || !currentAsset();
      downloadButton.disabled = busy || !currentAsset();
    };

    function replaceOptions(items) {
      const select = assetOptions();
      if (!select) return;
      for (const option of [...select.querySelectorAll('[data-guide-asset]')]) option.remove();
      for (const item of items) {
        if (!item?.value) continue;
        if (select.querySelector(`option[value="${CSS.escape(item.value)}"]`)) continue;
        const option = document.createElement('option');
        option.value = item.value;
        option.textContent = item.label || item.filename;
        option.dataset.guideAsset = kind;
        select.append(option);
      }
    }

    async function refresh() {
      const response = await fetch(endpoint, { cache: 'no-store' });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || `HTTP ${response.status}`);
      replaceOptions(payload.items ?? []);
      const select = assetOptions();
      const current = currentAsset();
      if (select && current) select.value = current;
    }

    async function commitAssetValue(value, assetLabel = '') {
      const next = structuredClone(getTuning());
      setAtPath(next, selectPath, value);
      commitTuning(next, { path: selectPath });
      const select = assetOptions();
      if (select && value) {
        if (assetLabel && !select.querySelector(`option[value="${CSS.escape(value)}"]`)) {
          const option = document.createElement('option');
          option.value = value;
          option.textContent = assetLabel;
          option.dataset.guideAsset = kind;
          select.append(option);
        }
        select.value = value;
      }
      sync();
      setBusy(false);
    }

    importButton.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', async () => {
      const [file] = fileInput.files ?? [];
      fileInput.value = '';
      if (!file) return;
      setBusy(true);
      status.dataset.state = 'busy';
      status.textContent = `\u6b63\u5728\u4e0a\u4f20${label}...`;
      try {
        // Images are re-encoded before they leave the browser: these files end
        // up base64-inlined in the ad, so the upload size is a package-size
        // problem, not just a storage one. Audio is compressed server-side by
        // FFmpeg because a browser cannot encode MP3.
        const prepared = kind === 'bgm' ? null : await compressUploadedImage(file);
        if (prepared) {
          status.textContent = prepared.compressed
            ? `\u5df2\u538b\u7f29 ${formatKilobytes(prepared.sourceBytes)} \u2192 ${formatKilobytes(prepared.blob.size)}\uff0c\u6b63\u5728\u4e0a\u4f20${label}...`
            : `\u6b63\u5728\u4e0a\u4f20${label}...`;
        } else {
          status.textContent = `\u6b63\u5728\u4e0a\u4f20\u5e76\u538b\u7f29${label}...`;
        }
        const body = prepared?.blob ?? file;
        const filename = prepared?.filename ?? file.name;
        const response = await fetch(`${endpoint}/import`, {
          method: 'POST',
          headers: {
            'Content-Type': body.type || 'application/octet-stream',
            'X-Guide-Asset-Filename': encodeURIComponent(filename)
          },
          body
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(payload.error || `HTTP ${response.status}`);
        await refresh();
        await commitAssetValue(payload.item.value, payload.item.label);
        status.dataset.state = 'success';
        status.textContent = `\u5df2\u4e0a\u4f20\u5e76\u5207\u6362\u5230 ${payload.item.label}`;
      } catch (error) {
        status.dataset.state = 'error';
        status.textContent = `\u4e0a\u4f20\u5931\u8d25\uff1a${error.message}`;
        setBusy(false);
      }
    });

    deleteButton.addEventListener('click', async () => {
      const current = currentAsset();
      if (!current) return;
      if (!window.confirm(`\u786e\u5b9a\u5220\u9664\u5f53\u524d${label}\uff1f`)) return;
      setBusy(true);
      status.dataset.state = 'busy';
      status.textContent = `\u6b63\u5728\u5220\u9664${label}...`;
      try {
        const filename = current.split('/').pop();
        const response = await fetch(`${endpoint}?filename=${encodeURIComponent(filename)}`, { method: 'DELETE' });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(payload.error || `HTTP ${response.status}`);
        await commitAssetValue('', '');
        await refresh();
        status.dataset.state = 'success';
        status.textContent = `\u5df2\u5220\u9664${label}`;
      } catch (error) {
        status.dataset.state = 'error';
        status.textContent = `\u5220\u9664\u5931\u8d25\uff1a${error.message}`;
        setBusy(false);
      }
    });

    downloadButton.addEventListener('click', async () => {
      const current = currentAsset();
      if (!current) return;
      const selectedLabel = assetOptions()?.selectedOptions?.[0]?.textContent || label;
      setBusy(true);
      status.dataset.state = 'busy';
      status.textContent = `\u6b63\u5728\u51c6\u5907\u4e0b\u8f7d${label}...`;
      let objectUrl = '';
      try {
        const response = await fetch(current, { cache: 'no-store' });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const blob = await response.blob();
        if (!blob.size) throw new Error(`${label}\u5185\u5bb9\u4e3a\u7a7a`);
        objectUrl = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = objectUrl;
        const extension = current.split('.').pop() || 'bin';
        link.download = `${selectedLabel}.${extension}`.replace(/[\\/:*?"<>|]+/gu, '_');
        link.rel = 'noopener';
        document.body.append(link);
        link.click();
        link.remove();
        status.dataset.state = 'success';
        status.textContent = `\u5df2\u4e0b\u8f7d ${link.download}`;
      } catch (error) {
        status.dataset.state = 'error';
        status.textContent = `\u4e0b\u8f7d\u5931\u8d25\uff1a${error.message}`;
      } finally {
        if (objectUrl) URL.revokeObjectURL(objectUrl);
        setBusy(false);
      }
    });

    setBusy(false);
    void refresh().catch((error) => {
      status.dataset.state = 'error';
      status.textContent = `\u83b7\u53d6${label}\u5217\u8868\u5931\u8d25\uff1a${error.message}`;
    });
    return { refresh, setBusy };
  }

  const bgmSection = inputs.get('audio.bgm.asset')?.row.closest('.editor-section');
  if (bgmSection) {
    createGuideAssetPanel({
      kind: 'bgm',
      label: '\u80cc\u666f\u97f3\u4e50',
      accept: 'audio/mpeg,audio/mp4,audio/ogg,audio/wav,.mp3,.m4a,.ogg,.wav',
      selectPath: 'audio.bgm.asset',
      section: bgmSection,
      hint: '\u652f\u6301 8 MB \u4ee5\u5185 MP3 / M4A / OGG / WAV\uff0c\u4e0a\u4f20\u540e\u81ea\u52a8\u5207\u6362\u4e3a\u672c\u5173\u80cc\u666f\u97f3\u4e50'
    });
  }

  const weatherSection = inputs.get('weatherEffect.mode')?.row.closest('.editor-section');
  if (weatherSection) {
    createGuideAssetPanel({
      kind: 'weather',
      label: '\u7279\u6548\u8d34\u56fe',
      accept: 'image/png,image/webp,.png,.webp',
      selectPath: 'weatherEffect.sprite',
      section: weatherSection,
      hint: '\u4e0a\u4f20\u7c92\u5b50\u8d34\u56fe\uff08PNG / WebP\uff0c2 MB \u4ee5\u5185\uff09\uff0c\u7559\u7a7a\u5219\u7528\u7a0b\u5e8f\u7ed8\u5236\u7684\u96e8\u96ea\u5f62\u72b6'
    });
  }

  const freeAssetPanel = document.createElement('div');
  freeAssetPanel.className = 'editor-free-asset-panel';
  freeAssetPanel.innerHTML = `
    <div class="editor-pre-roll-actions">
      <button class="editor-free-asset-import" type="button">\u4e0a\u4f20\u7d20\u6750</button>
      <button class="editor-free-asset-delete" type="button">\u5220\u9664\u9009\u4e2d\u56fe\u5c42</button>
      <button class="editor-free-asset-download" type="button">\u4e0b\u8f7d\u9009\u4e2d\u56fe\u5c42</button>
      <button class="editor-free-asset-lock" type="button">\u56fa\u5b9a / \u89e3\u9664</button>
    </div>
    <input class="editor-free-asset-file" type="file" accept="image/png,image/webp,.png,.webp" hidden>
    <p class="editor-pre-roll-status" role="status" aria-live="polite">\u4e0a\u4f20\u540e\u56fe\u5c42\u4f1a\u51fa\u73b0\u5728\u9884\u89c8\u753b\u9762\u4e2d\u95f4\uff0c\u62d6\u52a8\u5373\u53ef\u6446\u653e\uff1b\u300c\u56fa\u5b9a\u300d\u540e\u4e0d\u518d\u53ef\u62d6</p>
  `;
  // The free-asset group has no tuning rows; find its section by title.
  const freeAssetSection = [...document.querySelectorAll('.editor-section')]
    .find((section) => section.querySelector('h3')?.textContent === '\u81ea\u7531\u7d20\u6750');
  freeAssetSection?.append(freeAssetPanel);
  const freeAssetImportButton = freeAssetPanel.querySelector('.editor-free-asset-import');
  const freeAssetDeleteButton = freeAssetPanel.querySelector('.editor-free-asset-delete');
  const freeAssetDownloadButton = freeAssetPanel.querySelector('.editor-free-asset-download');
  const freeAssetLockButton = freeAssetPanel.querySelector('.editor-free-asset-lock');
  const freeAssetFileInput = freeAssetPanel.querySelector('.editor-free-asset-file');
  const freeAssetStatus = freeAssetPanel.querySelector('.editor-pre-roll-status');
  let freeAssetSelection = 0;

  function freeAssetLayers() {
    return getTuning().freeAssets?.layers ?? [];
  }

  async function addFreeAssetLayer(asset, label) {
    const next = structuredClone(getTuning());
    next.freeAssets ??= { layers: [] };
    next.freeAssets.layers ??= [];
    const index = next.freeAssets.layers.length;
    next.freeAssets.layers.push({
      id: `layer-${Date.now().toString(36)}-${index + 1}`,
      asset,
      label: label || `\u81ea\u7531\u7d20\u6750 ${index + 1}`,
      x: Math.round(getTuning().preview?.width / 2 || 540),
      y: Math.round((getTuning().preview?.height || 2160) / 2),
      width: 300,
      height: 300,
      opacity: 1,
      rotation: 0,
      locked: 0,
      visible: 1
    });
    commitTuning(next, { path: 'freeAssets.layers' });
    freeAssetSelection = index;
    sync();
  }

  freeAssetImportButton.addEventListener('click', () => freeAssetFileInput.click());
  freeAssetFileInput.addEventListener('change', async () => {
    const [file] = freeAssetFileInput.files ?? [];
    freeAssetFileInput.value = '';
    if (!file) return;
    freeAssetStatus.dataset.state = 'busy';
    freeAssetStatus.textContent = '\u6b63\u5728\u4e0a\u4f20\u7d20\u6750...';
    try {
      const prepared = await compressUploadedImage(file);
      freeAssetStatus.textContent = prepared.compressed
        ? `\u5df2\u538b\u7f29 ${formatKilobytes(prepared.sourceBytes)} \u2192 ${formatKilobytes(prepared.blob.size)}\uff0c\u6b63\u5728\u4e0a\u4f20\u7d20\u6750...`
        : '\u6b63\u5728\u4e0a\u4f20\u7d20\u6750...';
      const response = await fetch('/__guide-assets/free/import', {
        method: 'POST',
        headers: {
          'Content-Type': prepared.blob.type || 'application/octet-stream',
          'X-Guide-Asset-Filename': encodeURIComponent(prepared.filename)
        },
        body: prepared.blob
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || `HTTP ${response.status}`);
      await addFreeAssetLayer(payload.item.value, payload.item.label);
      freeAssetStatus.dataset.state = 'success';
      freeAssetStatus.textContent = `\u5df2\u6dfb\u52a0 ${payload.item.label}\uff0c\u53ef\u5728\u753b\u9762\u4e2d\u62d6\u52a8`;
    } catch (error) {
      freeAssetStatus.dataset.state = 'error';
      freeAssetStatus.textContent = `\u4e0a\u4f20\u5931\u8d25\uff1a${error.message}`;
    }
  });

  freeAssetDeleteButton.addEventListener('click', async () => {
    const layers = freeAssetLayers();
    const layer = layers[freeAssetSelection];
    if (!layer) {
      freeAssetStatus.dataset.state = 'error';
      freeAssetStatus.textContent = '\u8bf7\u5148\u5728\u753b\u9762\u4e2d\u70b9\u9009\u4e00\u4e2a\u56fe\u5c42';
      return;
    }
    if (!window.confirm(`\u786e\u5b9a\u5220\u9664\u56fe\u5c42\u300c${layer.label || layer.id}\u300d\uff1f`)) return;
    try {
      if (layer.asset) {
        const filename = layer.asset.split('/').pop();
        await fetch(`/__guide-assets/free?filename=${encodeURIComponent(filename)}`, { method: 'DELETE' })
          .catch(() => {});
      }
      const next = structuredClone(getTuning());
      next.freeAssets.layers.splice(freeAssetSelection, 1);
      commitTuning(next, { path: 'freeAssets.layers' });
      freeAssetSelection = Math.max(0, freeAssetSelection - 1);
      sync();
      freeAssetStatus.dataset.state = 'success';
      freeAssetStatus.textContent = '\u5df2\u5220\u9664\u56fe\u5c42';
    } catch (error) {
      freeAssetStatus.dataset.state = 'error';
      freeAssetStatus.textContent = `\u5220\u9664\u5931\u8d25\uff1a${error.message}`;
    }
  });

  freeAssetDownloadButton.addEventListener('click', async () => {
    const layer = freeAssetLayers()[freeAssetSelection];
    if (!layer?.asset) {
      freeAssetStatus.dataset.state = 'error';
      freeAssetStatus.textContent = '\u8bf7\u5148\u70b9\u9009\u4e00\u4e2a\u5e26\u7d20\u6750\u7684\u56fe\u5c42';
      return;
    }
    let objectUrl = '';
    try {
      const response = await fetch(layer.asset, { cache: 'no-store' });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const blob = await response.blob();
      objectUrl = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = objectUrl;
      const extension = layer.asset.split('.').pop() || 'png';
      link.download = `${layer.label || layer.id}.${extension}`.replace(/[\\/:*?"<>|]+/gu, '_');
      link.rel = 'noopener';
      document.body.append(link);
      link.click();
      link.remove();
      freeAssetStatus.dataset.state = 'success';
      freeAssetStatus.textContent = `\u5df2\u4e0b\u8f7d ${link.download}`;
    } catch (error) {
      freeAssetStatus.dataset.state = 'error';
      freeAssetStatus.textContent = `\u4e0b\u8f7d\u5931\u8d25\uff1a${error.message}`;
    } finally {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    }
  });

  freeAssetLockButton.addEventListener('click', () => {
    const layers = freeAssetLayers();
    const layer = layers[freeAssetSelection];
    if (!layer) {
      freeAssetStatus.dataset.state = 'error';
      freeAssetStatus.textContent = '\u8bf7\u5148\u5728\u753b\u9762\u4e2d\u70b9\u9009\u4e00\u4e2a\u56fe\u5c42';
      return;
    }
    const next = structuredClone(getTuning());
    next.freeAssets.layers[freeAssetSelection].locked = Number(layer.locked) === 1 ? 0 : 1;
    commitTuning(next, { path: `freeAssets.layers.${freeAssetSelection}.locked` });
    sync();
    freeAssetStatus.dataset.state = 'success';
    freeAssetStatus.textContent = next.freeAssets.layers[freeAssetSelection].locked
      ? '\u56fe\u5c42\u5df2\u56fa\u5b9a\uff0c\u4e0d\u518d\u53ef\u62d6\u52a8'
      : '\u56fe\u5c42\u5df2\u89e3\u9664\u56fa\u5b9a';
  });

  const levelSection = inputs.get('level.selected')?.row.closest('.editor-section');
  const levelActions = document.createElement('div');
  levelActions.className = 'editor-level-tools';
  levelActions.dataset.editorCategory = 'level';
  levelActions.innerHTML = `
    <label class="editor-level-owner">
      <span>操作用户</span>
      <input class="editor-level-owner-input" type="text" maxlength="40" placeholder="填写你的名字，例如 WXJ" autocomplete="off" spellcheck="false">
    </label>
    <div class="editor-level-actions">
      <button class="editor-level-official" type="button" title="浏览游戏正式版本自带的关卡，选中后导入">游戏内关卡</button>
      <button class="editor-level-overview" type="button" title="用布局缩略图查看并切换关卡">关卡总览</button>
      <button class="editor-level-edit" type="button">编辑关卡布局</button>
      <button class="editor-level-claim" type="button" title="把没有登记归属的关卡登记到自己名下">认领此关卡</button>
      <button class="editor-level-import" type="button">\u5bfc\u5165\u5173\u5361</button>
      <button class="editor-level-delete" type="button">删除关卡</button>
      <button class="editor-level-export" type="button">导出关卡</button>
      <button class="editor-level-open-folder" type="button">\u6253\u5f00\u5173\u5361\u6587\u4ef6\u5939</button>
    </div>
    <label class="editor-level-sort">
      <span>关卡排序</span>
      <select class="editor-level-sort-select">
        <option value="number">\u7f16\u53f7</option>
        <option value="name">\u540d\u79f0</option>
        <option value="created">\u521b\u5efa\u65f6\u95f4</option>
      </select>
    </label>
    <input class="editor-level-file" type="file" accept=".asset,.json,application/json" hidden>
    <p class="editor-level-status" aria-live="polite">\u5c31\u7eea</p>
  `;
  // Keep these actions outside the collapsible fields so the layout editor,
  // import, and folder controls remain available even after the level fields
  // are collapsed.
  if (levelSection?.parentElement) levelSection.parentElement.insertBefore(levelActions, levelSection.nextSibling);

  const levelImportButton = levelActions.querySelector('.editor-level-import');
  const levelDeleteButton = levelActions.querySelector('.editor-level-delete');
  const levelExportButton = levelActions.querySelector('.editor-level-export');
  const levelEditButton = levelActions.querySelector('.editor-level-edit');
  const levelOfficialButton = levelActions.querySelector('.editor-level-official');
  const levelOverviewButton = levelActions.querySelector('.editor-level-overview');
  const levelClaimButton = levelActions.querySelector('.editor-level-claim');
  const levelOpenFolderButton = levelActions.querySelector('.editor-level-open-folder');
  const levelFileInput = levelActions.querySelector('.editor-level-file');
  const levelStatus = levelActions.querySelector('.editor-level-status');
  const levelOwnerInput = levelActions.querySelector('.editor-level-owner-input');
  levelOwnerInput.value = readStoredLevelOwner();
  levelOwnerInput.addEventListener('change', () => {
    const stored = storeLevelOwner(levelOwnerInput.value);
    levelOwnerInput.value = stored;
    levelStatus.dataset.kind = '';
    levelStatus.textContent = stored
      ? `操作用户已设为「${stored}」，只有该用户能保存、导入或删除自己创建的关卡`
      : '未填写操作用户：保存、导入和删除会被服务端拒绝';
    updateLevelOwnershipNotice();
  });
  // Saving, importing, and deleting are refused without a name, so prompt for it
  // before the request instead of letting the server answer with a 403 the
  // operator has to decode.
  function requireLevelOwner() {
    const owner = normalizeLevelOwner(levelOwnerInput.value || readStoredLevelOwner());
    if (owner) {
      if (levelOwnerInput.value !== owner) levelOwnerInput.value = owner;
      return owner;
    }
    levelOwnerInput.focus();
    levelStatus.dataset.kind = 'error';
    levelStatus.textContent = '请先填写“操作用户”，再保存、导入或删除关卡';
    return '';
  }
  const levelSortSelect = levelActions.querySelector('.editor-level-sort-select');
  levelSortSelect.value = readLevelSortMode();
  levelSortSelect.addEventListener('change', () => {
    try {
      localStorage.setItem(LEVEL_SORT_STORAGE_KEY, levelSortSelect.value);
    } catch {
      // Keep the order for this session even when storage is unavailable.
    }
    applyLevelOptionSort();
    const labels = { number: '编号', name: '名称', created: '创建时间' };
    levelStatus.textContent = `关卡列表已按${labels[levelSortSelect.value] ?? '编号'}排序`;
  });

  function setLevelBusy(busy) {
    levelEditButton.disabled = busy;
    levelClaimButton.disabled = busy;
    levelImportButton.disabled = busy;
    levelDeleteButton.disabled = busy;
    levelExportButton.disabled = busy;
    levelOpenFolderButton.disabled = busy;
  }

  function levelOptionRank(key) {
    const match = /^level(\d+)$/.exec(key);
    return match ? Number(match[1]) : Number.MAX_SAFE_INTEGER;
  }

  function readLevelSortMode() {
    try {
      const saved = localStorage.getItem(LEVEL_SORT_STORAGE_KEY);
      if (LEVEL_SORT_MODES.includes(saved)) return saved;
    } catch {
      // Private-mode storage failures fall back to the default order.
    }
    return 'number';
  }

  function compareLevelOptions(first, second, mode) {
    if (mode === 'name') {
      const byName = String(first.displayName ?? '').localeCompare(
        String(second.displayName ?? ''), 'zh-Hans-CN', { numeric: true, sensitivity: 'base' }
      );
      if (byName !== 0) return byName;
    }
    if (mode === 'created') {
      // Levels written most recently come first; entries without a file time
      // (bundled-only levels) sink below every real timestamp.
      const firstTime = Number(first.updatedAt) || 0;
      const secondTime = Number(second.updatedAt) || 0;
      if (firstTime !== secondTime) return secondTime - firstTime;
    }
    return levelOptionRank(first.key) - levelOptionRank(second.key) || first.key.localeCompare(second.key);
  }

  let levelOptionItems = [];
  let overview = null;

  // Level names come from three layers (baked catalog, imported definitions,
  // and the web volume), and only the server knows the merged result. Rebuild
  // the selects from that merged list so a renamed or replaced level can never
  // leave a stale or duplicated label behind, and order them the way the
  // operator chose (level number, name, or most recently written).
  function applyLevelOptionSort() {
    const mode = readLevelSortMode();
    const items = [...levelOptionItems].sort((first, second) => compareLevelOptions(first, second, mode));
    const tuning = getTuning();
    for (const path of ['level.selected', 'vehicleGuideHand.levelKey']) {
      const select = inputs.get(path)?.select;
      if (!select) continue;
      for (const option of [...select.options]) option.remove();
      for (const item of items) {
        const option = document.createElement('option');
        option.value = item.key;
        // Name the owner in the label so a shared editor makes it obvious which
        // levels belong to someone else before an edit is attempted.
        option.textContent = item.owner ? `${item.displayName} · ${item.owner}` : item.displayName;
        if (item.owner) option.title = `属于 ${item.owner}`;
        select.append(option);
      }
      const selectedKey = getAtPath(tuning, path);
      select.value = items.some((item) => item.key === selectedKey) ? selectedKey : '';
    }
    return items;
  }

  async function refreshWebLevelOptions() {
    const controls = inputs.get('level.selected');
    if (!controls?.select) return [];
    const response = await fetch('/__level-authoring', {
      cache: 'no-store',
      headers: levelOwnerHeaders()
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || `HTTP ${response.status}`);
    levelOptionItems = (payload.items ?? []).filter((item) => item?.key && item.displayName);
    const items = applyLevelOptionSort();
    // A stale selection (level deleted, or a key that never had data) would
    // make every export fail, so say so instead of leaving an empty picker.
    const selectedKey = String(getTuning().level?.selected ?? '');
    if (selectedKey && !items.some((item) => item.key === selectedKey)) {
      levelStatus.textContent = `当前关卡 ${selectedKey} 没有关卡数据，请重新选择关卡，否则导出会失败`;
    }
    updateLevelOwnershipNotice();
    // An open overview has to follow the same list: importing a level while it
    // is visible would otherwise leave the new thumbnail out until reopened.
    if (overview) overview.reload().catch(() => {});
    return items;
  }

  // Ownership state of the selected level, shown next to the buttons so the
  // reason a save is about to be refused is visible before pressing it.
  function selectedLevelOwnership() {
    const key = String(getTuning().level?.selected ?? '');
    const item = levelOptionItems.find((entry) => entry.key === key);
    return { key, owner: item?.owner ?? '', unregistered: !item?.owner };
  }

  // Explicit takeover of a level that has no registered owner. Levels created
  // before ownership existed are read-only until this runs, so pressing save on
  // someone else's older level cannot capture it by accident.
  levelClaimButton.addEventListener('click', async () => {
    const { key, owner, unregistered } = selectedLevelOwnership();
    if (!/^level[1-9]\d*$/u.test(key)) return;
    const operator = requireLevelOwner();
    if (!operator) return;
    if (!unregistered) {
      levelStatus.dataset.kind = 'warn';
      levelStatus.textContent = owner
        ? `关卡 ${key} 已属于「${owner}」，不能重复认领`
        : `关卡 ${key} 无法认领`;
      return;
    }
    if (!window.confirm(`确认把关卡 ${key} 认领到「${operator}」名下？认领后只有你能修改和删除它。`)) return;
    setLevelBusy(true);
    try {
      const response = await fetch(`/__level-authoring/${encodeURIComponent(key)}/claim`, {
        method: 'POST',
        headers: levelOwnerHeaders(operator)
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || `HTTP ${response.status}`);
      await refreshWebLevelOptions();
      levelStatus.dataset.kind = 'success';
      levelStatus.textContent = `已认领关卡 ${key}，现在归「${operator}」所有`;
    } catch (error) {
      levelStatus.dataset.kind = 'error';
      levelStatus.textContent = `认领失败：${error.message}`;
    } finally {
      setLevelBusy(false);
    }
  });

  function updateLevelOwnershipNotice() {
    const { key, owner, unregistered } = selectedLevelOwnership();
    if (!key) return;
    if (unregistered) {
      levelStatus.textContent = `关卡 ${key} 还没有登记归属，默认只读。要接手请点“认领此关卡”。`;
      levelStatus.dataset.kind = 'warn';
      return;
    }
    if (isForeignLevelOwner(owner, normalizeLevelOwner(levelOwnerInput.value))) {
      levelStatus.textContent = `关卡 ${key} 属于「${owner}」，你只能查看。`;
      levelStatus.dataset.kind = 'warn';
      return;
    }
    levelStatus.textContent = `关卡 ${key} 归你所有`;
    levelStatus.dataset.kind = '';
  }

  levelEditButton.addEventListener('click', async () => {
    setLevelBusy(true);
    levelStatus.textContent = '正在打开关卡布局编辑器...';
    try {
      await openLevelLayoutEditor();
      levelStatus.textContent = '关卡布局编辑器已打开';
    } catch (error) {
      levelStatus.textContent = `打开失败：${error.message}`;
    } finally {
      setLevelBusy(false);
    }
  });

  // The game's own campaign levels ship as .asset files that were never part of
  // the authoring catalog. This picker browses them as read-only thumbnails and
  // imports exactly one when chosen, so an operator can start from real game
  // content instead of re-importing files by hand.
  levelOfficialButton.addEventListener('click', async () => {
    levelStatus.dataset.kind = '';
    const owner = requireLevelOwner();
    if (!owner) return;
    try {
      const { openOfficialLevelsPicker } = await import('./official-levels-picker.js');
      openOfficialLevelsPicker({
        owner,
        onImported: (level) => {
          // The picker already wrote the file; reuse the same switch path as a
          // manual import so the tuning profile and preview stay in sync.
          void switchToImportedLevel(level);
        }
      });
    } catch (error) {
      levelStatus.dataset.kind = 'error';
      levelStatus.textContent = `游戏内关卡打开失败：${error.message}`;
    }
  });

  // Shared by the manual .asset/file import and the official-level picker: the
  // level is already on disk, so only the option list and the active selection
  // need updating.
  async function switchToImportedLevel(level, { status = '' } = {}) {
    if (!level?.key) return;
    const controls = inputs.get('level.selected');
    if (controls?.select && !controls.select.querySelector(`option[value="${CSS.escape(level.key)}"]`)) {
      const option = document.createElement('option');
      option.value = level.key;
      option.textContent = level.displayName || level.key;
      controls.select.append(option);
    }
    levelStatus.textContent = status
      || `已切换到 ${level.displayName ?? level.key}（${level.vehicleCount ?? 0} 辆车）。`;
    const next = structuredClone(getTuning());
    next.level.selected = level.key;
    commitTuning(next, { path: 'level.selected' });
    // The refreshed list carries the new level's owner label; the reload above
    // usually wins the race, and a failure here must not block the switch.
    refreshWebLevelOptions().catch(() => {});
  }

  // The dropdown is a flat name list, so two similarly named levels cannot be
  // told apart without opening each one. The overview shows the actual layout
  // and switches through the same commit path the dropdown uses, which keeps the
  // saved-tuning profile and the playable preview in sync.
  levelOverviewButton.addEventListener('click', async () => {
    levelStatus.dataset.kind = '';
    try {
      const { openLevelOverview } = await import('./level-overview.js');
      overview = openLevelOverview({
        currentKey: String(getTuning().level?.selected ?? ''),
        onSelect: (levelKey) => {
          const next = structuredClone(getTuning());
          next.level.selected = levelKey;
          commitTuning(next, { path: 'level.selected' });
        }
      });
    } catch (error) {
      levelStatus.dataset.kind = 'error';
      levelStatus.textContent = `关卡总览打开失败：${error.message}`;
    }
  });

  async function importUnityLevel(file) {
    if (!/\.asset$/i.test(file?.name ?? '')) {
      throw new Error('\u6587\u4ef6\u540d\u53ea\u9700\u4ee5 .asset \u7ed3\u5c3e');
    }
    const response = await fetch('/__unity-levels/import', {
      method: 'POST',
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'X-Level-Filename': encodeURIComponent(file.name),
        'X-Level-Target-Key': nextImportedLevelKey(),
        ...levelOwnerHeaders(requireLevelOwner())
      },
      body: await file.text()
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || `HTTP ${response.status}`);
    const action = payload.replaced ? '\u5df2\u66f4\u65b0' : '\u5df2\u5bfc\u5165';
    await switchToImportedLevel(payload.level, {
      status: `${action} ${payload.level.key}\uff1a${payload.level.vehicleCount} \u8f86\u8f66\uff0c${payload.level.passengerCount} \u540d\u4e58\u5ba2\u3002\u6b63\u5728\u5207\u6362...`
    });
  }

  async function importWebLevel(file) {
    let source;
    try {
      source = JSON.parse(await file.text());
    } catch {
      throw new Error('JSON 文件格式无效，无法解析关卡编辑数据。');
    }
    if (!source || typeof source !== 'object' || Array.isArray(source)
      || source.format !== 'bus-loop-web-level-v1') {
      throw new Error('只能导入关卡编辑器导出的 JSON 文件。');
    }
    const selectedKey = nextImportedLevelKey();
    const controls = inputs.get('level.selected');
    const displayName = file.name.replace(/\.json$/i, '').trim() || selectedKey;
    const unityId = Number(selectedKey.slice(5));
    const document = retargetLevelDocument(source, {
      key: selectedKey,
      displayName,
      unityId: Number.isSafeInteger(unityId) ? unityId : undefined
    });
    const validation = validateLevelDocument(document);
    if (!validation.valid) {
      throw new Error(`关卡数据无效：${validation.errors.slice(0, 3).join('；')}`);
    }
    const response = await fetch('/__level-authoring/import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8', ...levelOwnerHeaders(requireLevelOwner()) },
      body: JSON.stringify({ document, filename: file.name })
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || `HTTP ${response.status}`);
    await refreshWebLevelOptions();
    if (controls?.select) controls.select.value = payload.level.key;
    // The file's scene tuning belongs to the key the level just received. It
    // must land before the switch below, because switching reads that profile.
    const tuningRestored = Boolean(source.tuning)
      && saveImportedLevelTuning(payload.level.key, source.tuning);
    levelStatus.textContent = `已导入新关卡 ${payload.level.displayName}：${payload.level.vehicleCount} 辆车，${payload.level.passengerCount} 名乘客。`
      + (tuningRestored ? '已恢复画面/车位/车辆参数。' : '该文件不含画面参数，使用默认值。')
      + '正在应用...';
    const next = structuredClone(getTuning());
    next.level.selected = payload.level.key;
    commitTuning(next, { path: 'level.selected' });
  }

  function nextImportedLevelKey() {
    const keys = [...(inputs.get('level.selected')?.select?.options ?? [])]
      .map((option) => Number(String(option.value).match(/^level(\d+)$/)?.[1]))
      .filter(Number.isSafeInteger);
    return `level${Math.max(0, ...keys) + 1}`;
  }

  levelDeleteButton.addEventListener('click', async () => {
    const key = String(getTuning().level?.selected ?? '');
    if (!/^level[1-9]\d*$/.test(key)) return;
    const owner = requireLevelOwner();
    if (!owner) return;
    // Name the owner in the prompt: deleting someone else's level is exactly the
    // accident this guard exists for, and the server would refuse it anyway.
    const levelOwner = levelOptionItems.find((item) => item.key === key)?.owner ?? '';
    const foreignNote = isForeignLevelOwner(levelOwner, owner) ? `\n注意：该关卡属于「${levelOwner}」。` : '';
    if (!window.confirm(`确定删除关卡 ${key}？${foreignNote}`)) return;
    setLevelBusy(true);
    try {
      const headers = levelOwnerHeaders(owner);
      let response = await fetch(`/__level-authoring/${encodeURIComponent(key)}`, { method: 'DELETE', headers });
      if (response.status === 404) response = await fetch(`/__unity-levels/${encodeURIComponent(key)}`, { method: 'DELETE', headers });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || `HTTP ${response.status}`);
      inputs.get('level.selected')?.select?.querySelector(`option[value="${CSS.escape(key)}"]`)?.remove();
      await refreshWebLevelOptions();
      const fallback = inputs.get('level.selected')?.select?.options?.[0]?.value;
      if (fallback) {
        const next = structuredClone(getTuning());
        next.level.selected = fallback;
        commitTuning(next, { path: 'level.selected' });
      }
      levelStatus.textContent = `已删除 ${key}`;
    } catch (error) {
      levelStatus.textContent = `删除失败：${error.message}`;
    } finally {
      setLevelBusy(false);
    }
  });

  levelExportButton.addEventListener('click', async () => {
    if (!updateCountdownControls()) {
      levelStatus.textContent = '导出失败：请先修正倒计时配置';
      return;
    }
    const key = String(getTuning().level?.selected ?? '');
    if (!/^level[1-9]\d*$/.test(key)) return;
    setLevelBusy(true);
    levelStatus.textContent = `正在导出 ${key}...`;
    try {
      const response = await fetch(`/__level-authoring-export/${encodeURIComponent(key)}`, { cache: 'no-store' });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload.error || `HTTP ${response.status}`);
      }
      const disposition = response.headers.get('Content-Disposition') || '';
      const encoded = disposition.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
      const raw = await response.text();
      const exported = attachTuningToExportedLevel(raw, key, getTuning());
      const serverFilename = encoded ? decodeURIComponent(encoded) : '';
      // A Unity .asset export stays a .asset download; only the authored JSON
      // gains the scene tuning. The server may hand back either extension, so
      // normalize before appending.
      const filename = exported
        ? `${serverFilename.replace(/\.(?:asset|json)$/i, '') || `level-${key}`}.json`
        : serverFilename || `level-${key}.asset`;
      saveTextFile(
        filename,
        exported ?? raw,
        exported ? 'application/json;charset=utf-8' : 'text/plain;charset=utf-8'
      );
      levelStatus.textContent = exported
        ? `已导出 ${filename}（含画面/车位/车辆参数）`
        : `已导出 ${filename}`;
    } catch (error) {
      levelStatus.textContent = `导出失败：${error.message}`;
    } finally {
      setLevelBusy(false);
    }
  });

  levelImportButton.addEventListener('click', () => levelFileInput.click());
  levelOpenFolderButton.addEventListener('click', async () => {
    setLevelBusy(true);
    levelStatus.textContent = '\u6b63\u5728\u6253\u5f00\u5173\u5361\u6587\u4ef6\u5939...';
    try {
      const response = await fetch('/__unity-levels/open-folder', { method: 'POST' });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || `HTTP ${response.status}`);
      levelStatus.textContent = `\u5df2\u6253\u5f00 ${payload.path}`;
    } catch (error) {
      levelStatus.textContent = `\u6253\u5f00\u5931\u8d25\uff1a${error.message}`;
    } finally {
      setLevelBusy(false);
    }
  });
  levelFileInput.addEventListener('change', async () => {
    const [file] = levelFileInput.files ?? [];
    if (!file) return;
    setLevelBusy(true);
    levelStatus.textContent = `\u6b63\u5728\u9a8c\u8bc1 ${file.name}...`;
    try {
      if (/\.json$/i.test(file.name)) await importWebLevel(file);
      else if (/\.asset$/i.test(file.name)) await importUnityLevel(file);
      else throw new Error('请选择 .asset 或关卡编辑器导出的 .json 文件');
    } catch (error) {
      levelStatus.textContent = `\u5bfc\u5165\u5931\u8d25\uff1a${error.message}`;
    } finally {
      levelFileInput.value = '';
      setLevelBusy(false);
    }
  });

  const spatialSection = document.createElement('details');
  spatialSection.className = 'editor-section editor-spatial-conveyor';
  spatialSection.dataset.editorCategory = 'conveyor';
  spatialSection.innerHTML = `
    <summary class="editor-section-summary"><h3>\u7acb\u4f53\u8f68\u9053\u7f16\u8f91</h3></summary>
    <div class="editor-spatial-actions">
      <button class="editor-spatial-import" type="button">\u5bfc\u5165 Prefab</button>
      <button class="editor-spatial-refresh" type="button">\u5237\u65b0\u5217\u8868</button>
      <button class="editor-spatial-edit-points" type="button">\u7f16\u8f91\u8f68\u9053\u70b9\u4f4d</button>
      <button class="editor-spatial-open-folder" type="button">\u6253\u5f00\u5b58\u50a8\u6587\u4ef6\u5939</button>
    </div>
    <input class="editor-spatial-file" type="file" accept=".prefab" hidden>
    <p class="editor-spatial-status" aria-live="polite">\u6b63\u5728\u8bfb\u53d6...</p>
  `;
  const spatialImportAnchor = fieldsRoot.querySelector('[data-spatial-import-anchor]');
  spatialImportAnchor.before(spatialSection);

  const spatialImportButton = spatialSection.querySelector('.editor-spatial-import');
  const spatialRefreshButton = spatialSection.querySelector('.editor-spatial-refresh');
  const spatialEditPointsButton = spatialSection.querySelector('.editor-spatial-edit-points');
  const spatialOpenFolderButton = spatialSection.querySelector('.editor-spatial-open-folder');
  const spatialFileInput = spatialSection.querySelector('.editor-spatial-file');
  const spatialStatus = spatialSection.querySelector('.editor-spatial-status');

  function setSpatialBusy(busy) {
    spatialImportButton.disabled = busy;
    spatialRefreshButton.disabled = busy;
    spatialEditPointsButton.disabled = busy || !isSpatialConveyorSelection(getTuning().conveyorLayout?.selected);
    spatialOpenFolderButton.disabled = busy;
  }

  function reloadSelectedSpatialConveyor() {
    const selected = getTuning().conveyorLayout?.selected;
    if (!isSpatialConveyorSelection(selected)) return;
    commitTuning(structuredClone(getTuning()), { path: 'conveyorLayout.selected' });
  }

  async function refreshSpatialConveyorOptions() {
    const controls = inputs.get('conveyorLayout.selected');
    if (!controls?.select) return [];
    for (const option of controls.select.querySelectorAll('[data-spatial-conveyor]')) option.remove();

    const items = await refreshSpatialConveyorPackages();
    for (const item of items) {
      const option = document.createElement('option');
      option.value = item.value;
      option.textContent = `${item.label} (\u7acb\u4f53)`;
      option.dataset.spatialConveyor = item.id;
      controls.select.append(option);
    }
    const selected = getTuning().conveyorLayout?.selected;
    if (controls.select.querySelector(`option[value="${CSS.escape(selected ?? '')}"]`)) {
      controls.select.value = selected;
    }
    spatialStatus.textContent = `\u5df2\u5bfc\u5165 ${items.length} \u4e2a\u7acb\u4f53\u8f68\u9053`;
    return items;
  }

  async function importSpatialConveyor(file) {
    if (!file?.name.toLowerCase().endsWith('.prefab')) {
      throw new Error('\u8bf7\u9009\u62e9 .prefab \u6587\u4ef6');
    }
    const response = await fetch('/__spatial-conveyors/import', {
      method: 'POST',
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'X-Prefab-Filename': encodeURIComponent(file.name)
      },
      body: await file.text()
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || `HTTP ${response.status}`);
    const items = await refreshSpatialConveyorOptions();
    reloadSelectedSpatialConveyor();
    spatialStatus.textContent = `\u5df2\u5bfc\u5165 ${payload.item.label}\uff0c\u5171 ${items.length} \u4e2a`;
  }

  spatialImportButton.addEventListener('click', () => spatialFileInput.click());
  spatialEditPointsButton.addEventListener('click', async () => {
    setSpatialBusy(true);
    spatialStatus.textContent = '\u6b63\u5728\u6253\u5f00\u70b9\u4f4d\u7f16\u8f91\u5668...';
    try {
      await openSpatialPointEditor();
      spatialStatus.textContent = '\u70b9\u4f4d\u7f16\u8f91\u5668\u5df2\u6253\u5f00';
    } catch (error) {
      spatialStatus.textContent = `\u6253\u5f00\u5931\u8d25\uff1a${error.message}`;
    } finally {
      setSpatialBusy(false);
    }
  });
  spatialOpenFolderButton.addEventListener('click', async () => {
    setSpatialBusy(true);
    spatialStatus.textContent = '\u6b63\u5728\u6253\u5f00\u5b58\u50a8\u6587\u4ef6\u5939...';
    try {
      const response = await fetch('/__spatial-conveyors/open-folder', { method: 'POST' });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || 'HTTP ' + response.status);
      spatialStatus.textContent = '\u5df2\u6253\u5f00 ' + payload.path;
    } catch (error) {
      spatialStatus.textContent = '\u6253\u5f00\u5931\u8d25\uff1a' + error.message;
    } finally {
      setSpatialBusy(false);
    }
  });
  spatialRefreshButton.addEventListener('click', async () => {
    setSpatialBusy(true);
    spatialStatus.textContent = '\u6b63\u5728\u5237\u65b0...';
    try {
      await refreshSpatialConveyorOptions();
      reloadSelectedSpatialConveyor();
    } catch (error) {
      spatialStatus.textContent = `\u5237\u65b0\u5931\u8d25\uff1a${error.message}`;
    } finally {
      setSpatialBusy(false);
    }
  });
  spatialFileInput.addEventListener('change', async () => {
    const [file] = spatialFileInput.files ?? [];
    if (!file) return;
    setSpatialBusy(true);
    spatialStatus.textContent = `\u6b63\u5728\u5bfc\u5165 ${file.name}...`;
    try {
      await importSpatialConveyor(file);
    } catch (error) {
      spatialStatus.textContent = `\u5bfc\u5165\u5931\u8d25\uff1a${error.message}`;
    } finally {
      spatialFileInput.value = '';
      setSpatialBusy(false);
    }
  });

  function updatePassengerMaterialVisibility(tuning) {
    const mode = tuning.passengerMaterial?.mode ?? 'unityTexture';
    for (const [path, controls] of inputs) {
      if (path.startsWith('passengerMaterial.colors.')) {
        controls.row.hidden = mode === 'solidColor';
      } else if (path.startsWith('passengerMaterial.solidColors.')) {
        controls.row.hidden = mode !== 'solidColor';
      } else if (path === 'passengerMaterial.baseColorStrength') {
        controls.row.hidden = mode === 'solidColor';
      }
    }
  }

  function updateConveyorLayoutVisibility(tuning) {
    const selected = tuning.conveyorLayout?.selected ?? 'dualQueue2';
    for (const section of fieldsRoot.querySelectorAll('[data-conveyor-layout]')) {
      section.hidden = section.dataset.conveyorLayout !== selected;
    }
    for (const section of fieldsRoot.querySelectorAll('[data-spatial-only]')) {
      section.hidden = !isSpatialConveyorSelection(selected);
    }
    spatialEditPointsButton.hidden = !isSpatialConveyorSelection(selected);
    spatialEditPointsButton.disabled = !isSpatialConveyorSelection(selected);
  }

  function sync({ resetCountdownDrafts = false } = {}) {
    const tuning = getTuning();
    for (const [path, controls] of inputs) {
      const value = path.startsWith('countdown.')
        ? normalizeCountdownConfig(tuning.countdown)[path.slice('countdown.'.length)]
        : path.startsWith('stamina.') ? normalizeStaminaConfig(tuning.stamina)[path.slice('stamina.'.length)]
          : getAtPath(tuning, path);
      if (controls.isCountdownNumber) {
        if (resetCountdownDrafts || !controls.dirty || controls.lastValue !== value) {
          controls.number.value = String(value);
          controls.range.value = String(value);
          controls.dirty = false;
        }
        controls.lastValue = value;
        continue;
      }
      if (controls.select) {
        if (path === 'background.asset') ensureBackgroundSelectValue(controls.select, value);
        if (path.endsWith('.vehicleId')) ensureVehicleSelectValue(controls.select, value);
        controls.select.value = value;
        continue;
      }
      if (controls.checkbox) {
        controls.checkbox.checked = Boolean(value);
        continue;
      }
      if (controls.textInput) {
        controls.textInput.value = value ?? '';
        controls.updateValidity?.();
        continue;
      }
      if (controls.urlInput) {
        controls.urlInput.value = value ?? '';
        controls.updateValidity();
        continue;
      }
      if (controls.range) controls.range.value = String(value);
      controls.number.value = formatValue(value, controls.step);
      if (controls.color) controls.color.value = formatColor(value);
    }
    updatePassengerMaterialVisibility(tuning);
    updateConveyorLayoutVisibility(tuning);
    updateCountdownControls();
    updateStaminaControls();
    updateExportVariantControls();
    // 起点 X is computed while auto-centring is on, so leave the row in place but
    // mark it read-only -- dragging a slider that cannot win the argument reads
    // as a broken control.
    const autoCenter = Boolean(Number(tuning.parkingSpots?.autoCenter));
    const startXControls = inputs.get('parkingSpots.startX');
    if (startXControls?.row) {
      startXControls.row.classList.toggle('is-readonly', autoCenter);
      if (startXControls.range) startXControls.range.disabled = autoCenter;
      if (startXControls.number) startXControls.number.disabled = autoCenter;
    }
    setPreRollBusy(preRollBusy);
    setBackgroundBusy(false);
    // The header picker mirrors the tuning value, so a locale forced from the
    // field row or restored from a saved profile shows up here too.
    if (localeSelect) {
      const previewLocale = String(tuning.branding?.localization?.previewLocale ?? 'auto');
      if (localeSelect.value !== previewLocale) localeSelect.value = previewLocale;
    }
    shellRefresh?.();
  }

  // -------------------------------------------------------------------------
  // Shell layout
  //
  // The sections above were built exactly as in the classic editor. This block
  // only *re-parents* those finished nodes into rail panels and adds navigation.
  // Nothing is rebuilt, so every listener bound during construction (sliders,
  // selects, uploads, export, level tooling, the async option refreshers) keeps
  // working untouched. The classic layout never reaches this code.
  // -------------------------------------------------------------------------
  let shellRefresh = null;

  function installShellLayout() {
    // The classic editor opens on the 关卡 tab, which leaves every other
    // section carrying `is-category-hidden`. The shell owns visibility instead,
    // so drop that state before laying anything out.
    root.dataset.editorCategory = '';
    for (const hidden of root.querySelectorAll('.editor-section.is-category-hidden')) {
      hidden.classList.remove('is-category-hidden');
    }

    const allSections = [...root.querySelectorAll('.editor-section')];
    const railButtons = [...root.querySelectorAll('[data-shell-panel]')];
    const panelHost = fieldsRoot;
    const panelTitle = root.querySelector('.shell-panel-title');
    const panelNote = root.querySelector('.shell-panel-note');
    const panelTally = root.querySelector('.shell-panel-tally');
    const searchInput = root.querySelector('.editor-search-input');
    const searchClear = root.querySelector('.editor-search-clear');
    const searchResults = document.createElement('div');
    searchResults.className = 'shell-search-results';
    searchResults.hidden = true;
    fieldsRoot.parentElement.insertBefore(searchResults, fieldsRoot);

    const fieldPaths = (section) => [...section.querySelectorAll('[data-path]')]
      .map((node) => node.dataset.path)
      .filter(Boolean);

    // Row 1 is not representative of a section: Icon/Logo opens with the phone
    // preview size rows but is 24 branding rows. Vote with every row instead.
    function panelFor(section) {
      if (section.classList.contains('editor-screenshot')) return 'export';
      if (section.classList.contains('editor-playable-export')) return 'export';
      if (section.dataset.conveyorLayout || section.dataset.spatialOnly) return 'track';
      // The free-asset layers section is built by a custom panel and owns no
      // tuning rows at all, so it cannot vote.
      if (section.querySelector('.editor-free-asset-panel')) return 'guide';
      const votes = new Map();
      for (const path of fieldPaths(section)) {
        for (const panel of SHELL_PANELS) {
          if (panel.match.test(path)) {
            votes.set(panel.id, (votes.get(panel.id) ?? 0) + 1);
            break;
          }
        }
      }
      let best = null;
      let bestVotes = 0;
      for (const panel of SHELL_PANELS) {
        const count = votes.get(panel.id) ?? 0;
        if (count > bestVotes) {
          best = panel.id;
          bestVotes = count;
        }
      }
      return best ?? 'scene';
    }

    function subgroupFor(section, panel) {
      const rules = SHELL_SUBGROUPS[panel] ?? [];
      for (const path of fieldPaths(section)) {
        for (const [name, pattern] of rules) {
          if (pattern.test(path)) return name;
        }
      }
      return rules[0]?.[0] ?? '';
    }

    // A few rows are plain divs, not <details>: the level tool buttons are
    // inserted beside the level section rather than inside it. Without an owner
    // they would sit outside every panel host and stay visible in all nine.
    const ORPHAN_PANELS = new Map([
      ['editor-level-tools', 'level'],
      ['editor-spatial-conveyor', 'track'],
    ]);
    function panelForNode(node) {
      if (node.classList.contains('editor-section')) return panelFor(node);
      for (const [cls, panel] of ORPHAN_PANELS) {
        if (node.classList.contains(cls)) return panel;
      }
      return null;
    }

    // The five asset libraries are tool rows inside their own sections (背景 /
    // 前贴视频 / 特效 / BGM / 自由素材), so there is no section to file under
    // 素材. The panel is therefore a real index into those rows: every entry
    // below resolves to a live control that already exists.

    // Group every section once; the rail only toggles which groups are shown.
    // The screenshot block and the export block are siblings of the field list
    // in the shell template, not children of it. Move them into the list first
    // so a single pass over .editor-fields sees every section; appending here
    // also puts them last inside the 导出 panel, which is the order they run in.
    for (const selector of ['.editor-screenshot', '.editor-playable-export']) {
      const node = root.querySelector(selector);
      if (node && node.parentElement !== fieldsRoot) fieldsRoot.appendChild(node);
    }
    const placements = new Map();
    const ownerOf = new Map();
    // Snapshot: panel hosts are appended to fieldsRoot before this loop, and
    // moving a node into one mutates the live HTMLCollection we would otherwise
    // be iterating.
    for (const node of [...fieldsRoot.children]) {
      const panel = panelForNode(node);
      if (!panel) continue;
      ownerOf.set(node, panel);
      const subgroup = node.classList.contains('editor-section') ? subgroupFor(node, panel) : '';
      if (!placements.has(panel)) placements.set(panel, { order: [], buckets: new Map() });
      const entry = placements.get(panel);
      if (!entry.buckets.has(subgroup)) {
        entry.buckets.set(subgroup, []);
        entry.order.push(subgroup);
      }
      entry.buckets.get(subgroup).push(node);
    }

    // One host per panel. Sections keep their original relative order.
    const panelHosts = new Map();
    for (const panel of SHELL_PANELS) {
      const host = document.createElement('div');
      host.className = 'shell-panel-body';
      host.dataset.shellPanelBody = panel.id;
      host.hidden = true;
      panelHost.appendChild(host);
      panelHosts.set(panel.id, host);
      const entry = placements.get(panel.id);
      if (!entry) continue;
      for (const subgroup of entry.order) {
        const list = entry.buckets.get(subgroup);
        if (entry.order.length > 1 && subgroup) {
          const heading = document.createElement('div');
          heading.className = 'shell-group-head';
          const fieldCount = list.reduce(
            (sum, section) => sum + section.querySelectorAll('[data-path]').length, 0,
          );
          heading.innerHTML = `<span>${subgroup}</span><em>${list.length} 段${fieldCount ? ` · ${fieldCount} 字段` : ''}</em>`;
          host.appendChild(heading);
        }
        for (const [offset, section] of list.entries()) {
          host.appendChild(section);
          // Open the first section of each sub-group so a panel never lands
          // completely collapsed (which reads as "the fields are gone"), but
          // leave the rest shut: the operator opens what they are working on.
          if (offset === 0 && list.length > 1) section.open = true;
        }
      }
    }

    const sectionPanel = new Map();
    for (const [panel, host] of panelHosts) {
      for (const section of host.querySelectorAll('.editor-section')) sectionPanel.set(section, panel);
    }

    // The naming block is 16 short codes, one per row. Wrap its rows in a grid
    // container so the shell CSS can pack them into two columns. The wrapper
    // goes inside the <details>; putting display:grid on the details element
    // itself would break its own collapse behaviour.
    const namingSection = [...allSections].find(
      (section) => section.querySelector('.editor-field[data-path="exportNaming.requirementCode"]'),
    );
    if (namingSection && !namingSection.querySelector('.shell-naming-grid')) {
      const grid = document.createElement('div');
      grid.className = 'shell-naming-grid';
      for (const row of [...namingSection.querySelectorAll('.editor-field')]) grid.appendChild(row);
      namingSection.appendChild(grid);
    }

    let activePanel = 'track';
    let activeTab = 'facts';

    function countPanel(panelId) {
      const host = panelHosts.get(panelId);
      if (!host) return { sections: 0, fields: 0 };
      // `hidden` is owned by the conveyor filter; `display` by the shell. A
      // section only counts when both let it through.
      const sections = [...host.querySelectorAll('.editor-section')]
        .filter((section) => !section.hidden);
      return {
        sections: sections.length,
        fields: sections.reduce((sum, section) => sum + section.querySelectorAll('[data-path]').length, 0),
      };
    }

    function setActivePanel(panelId, { focus = false } = {}) {
      activePanel = panelId;
      for (const button of railButtons) {
        const on = button.dataset.shellPanel === panelId;
        button.classList.toggle('is-active', on);
        button.setAttribute('aria-pressed', String(on));
        if (on && focus) button.focus();
      }
      for (const [id, host] of panelHosts) host.hidden = id !== panelId;
      const [title, note] = SHELL_PANEL_TITLES[panelId] ?? ['', ''];
      panelTitle.textContent = title;
      panelNote.textContent = note;
      const stats = countPanel(panelId);
      const parts = [`${stats.sections} 段`];
      if (stats.fields) parts.push(`${stats.fields} 字段`);
      panelTally.textContent = parts.join(' · ');
    }

    function refreshRail() {
      for (const button of railButtons) {
        const id = button.dataset.shellPanel;
        const stats = countPanel(id);
        const badge = button.querySelector('em');
        if (badge) badge.textContent = stats.sections ? String(stats.sections) : '';
        button.classList.toggle('is-empty', stats.sections === 0);
      }
      if (activePanel) setActivePanel(activePanel);
    }

    for (const button of railButtons) {
      button.addEventListener('click', () => {
        setActivePanel(button.dataset.shellPanel);
        // Picking a panel is a statement that search is over; leaving stale
        // results on screen next to a different panel reads as a bug.
        if (!searchResults.hidden) closeSearch();
      });
    }

    // ---- search ------------------------------------------------------------
    function rowLabel(row) {
      return row.querySelector('span')?.textContent ?? '';
    }

    function closeSearch() {
      searchInput.value = '';
      searchClear.hidden = true;
      searchResults.hidden = true;
      searchResults.replaceChildren();
      for (const host of panelHosts.values()) host.classList.remove('is-search-filtered');
      fieldsRoot.hidden = false;
      refreshRail();
    }

    function runSearch(rawQuery) {
      const query = rawQuery.trim().toLowerCase();
      searchClear.hidden = query.length === 0;
      if (!query) {
        closeSearch();
        return;
      }
      const hits = [];
      for (const section of allSections) {
        const sectionTitle = section.querySelector('h3')?.textContent ?? '';
        for (const row of section.querySelectorAll('.editor-field[data-path]')) {
          const label = rowLabel(row);
          const path = row.dataset.path ?? '';
          if (`${label} ${path} ${sectionTitle}`.toLowerCase().includes(query)) {
            hits.push({ section, row, label, path, sectionTitle });
          }
        }
      }
      searchResults.replaceChildren();
      searchResults.hidden = false;
      fieldsRoot.hidden = true;
      for (const host of panelHosts.values()) host.classList.add('is-search-filtered');
      if (!hits.length) {
        searchResults.innerHTML = '<p class="shell-search-empty">没有匹配的字段</p>';
        return;
      }
      const head = document.createElement('div');
      head.className = 'shell-search-count';
      head.textContent = `${hits.length} 项`;
      searchResults.appendChild(head);
      for (const hit of hits.slice(0, 60)) {
        const item = document.createElement('button');
        item.type = 'button';
        item.className = 'shell-search-hit';
        item.innerHTML = `<strong></strong><small></small><em></em>`;
        item.querySelector('strong').textContent = hit.label;
        item.querySelector('small').textContent = hit.path;
        item.querySelector('em').textContent = hit.sectionTitle;
        item.addEventListener('click', () => {
          const panel = sectionPanel.get(hit.section) ?? 'track';
          searchResults.hidden = true;
          searchClear.hidden = true;
          searchInput.value = '';
          for (const host of panelHosts.values()) host.classList.remove('is-search-filtered');
          fieldsRoot.hidden = false;
          setActivePanel(panel);
          hit.section.open = true;
          hit.section.scrollIntoView({ block: 'center' });
          hit.row.classList.add('is-shell-flash');
          setTimeout(() => hit.row.classList.remove('is-shell-flash'), 1500);
          refreshRail();
        });
        searchResults.appendChild(item);
      }
      if (hits.length > 60) {
        const more = document.createElement('p');
        more.className = 'shell-search-empty';
        more.textContent = `还有 ${hits.length - 60} 项，加个词缩小范围`;
        searchResults.appendChild(more);
      }
    }

    searchInput.addEventListener('input', () => runSearch(searchInput.value));
    searchClear.addEventListener('click', closeSearch);

    // ---- inspector ---------------------------------------------------------
    const inspectorBody = root.querySelector('.shell-inspector-body');
    const inspectorTabs = [...root.querySelectorAll('[data-shell-tab]')];

    function formatName(path) {
      return path.replace(/^exportNaming\./, '').replace(/^channels\./, '渠道 ');
    }

    // The packager caps every delivery at 5 MB, and base64 inflates each inlined
    // asset by a third. The panel used to skip this check because only the
    // server could measure the artifact; it can still estimate the dominant
    // term (inlined assets) with the same URL list the packager uses, which is
    // what catches a 900 KB upload before a two-minute export fails.
    const PLAYABLE_PAYLOAD_BUDGET_BYTES = 5 * 1024 * 1024;
    const PLAYABLE_PAYLOAD_WARN_BYTES = Math.round(PLAYABLE_PAYLOAD_BUDGET_BYTES * 0.8);
    // The single-file shell (runtime JS + CSS + markup) measured ~0.95 MB on the
    // shipped Bus build; it is reported separately so the note never pretends
    // the asset sum is the artifact size.
    const PLAYABLE_SHELL_BYTES = 950 * 1024;
    const perAssetCaps = [
      ['/assets/editor-backgrounds/', CUSTOM_BACKGROUND_MAX_OUTPUT_BYTES, '背景图'],
      [CUSTOM_PRE_ROLL_ASSET_PREFIX, 2 * 1024 * 1024, '前贴视频'],
      ['/assets/editor-bgm/', 1024 * 1024, 'BGM'],
      ['/assets/editor-effects/', 2 * 1024 * 1024, '特效贴图'],
      ['/assets/editor-free-assets/', 4 * 1024 * 1024, '自由素材']
    ];

    let payloadStats = null;
    let payloadStatsKey = '';
    let payloadStatsBusy = false;
    let payloadStatsTimer = 0;

    function inlineAssetUrls() {
      const tuning = getTuning();
      // The editor preview always runs one stage built from the selected level
      // (plus Level7 for the Level9 handoff). The baked catalogue entry is a
      // stale twin of that same stage slot, so shipping it in the estimate
      // counted every art path twice and reported assets the package drops.
      const levels = [LEVEL_1];
      if (LEVEL_1.key === 'level9') {
        const handoff = PLAYABLE_ALL_LEVELS.find((level) => level?.key === 'level7');
        if (handoff) levels.push(handoff);
      }
      const conveyorLayouts = [...new Set([
        tuning.conveyorLayout?.selected,
        ...PLAYABLE_STAGES.map((stage) => stage?.scene?.conveyorLayout),
        ...PLAYABLE_STAGE_CHOICES.flatMap((choice) => (
          (choice?.options ?? []).map((option) => option?.scene?.conveyorLayout)
        ))
      ].filter(Boolean))];
      return collectPlayableInlineAssetUrls({
        tuning,
        levels,
        activeSession: ACTIVE_PLAYABLE_SESSION,
        spatialSelection: tuning.conveyorLayout?.selected,
        entryBannerEnabled: Boolean(Number(tuning.entryBanner?.enabled)),
        conveyorLayouts,
        choiceOptionImages: PLAYABLE_STAGE_CHOICES
          .flatMap((choice) => choice?.options ?? [])
          .map((option) => option?.image)
          .filter(Boolean)
      });
    }

    // One HTTP round trip per distinct asset set. Sliders fire sync() on every
    // input event, so the request is debounced and skipped while the checks tab
    // is not visible.
    function schedulePayloadStats() {
      if (activeTab !== 'checks') return;
      const urls = [...inlineAssetUrls()].sort();
      const key = `${LEVEL_1.key}|${urls.join('\n')}`;
      if (payloadStats?.key === key || payloadStatsKey === key) return;
      payloadStatsKey = key;
      clearTimeout(payloadStatsTimer);
      payloadStatsTimer = setTimeout(async () => {
        payloadStatsBusy = true;
        renderInspector();
        try {
          const response = await fetch('/__playable-asset-sizes', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ urls })
          });
          const payload = await response.json().catch(() => ({}));
          if (!response.ok) throw new Error(payload.error || `HTTP ${response.status}`);
          const items = Array.isArray(payload.items) ? payload.items : [];
          const rawBytes = items.reduce((sum, item) => sum + (Number(item.bytes) || 0), 0);
          // Base64 payload cost per file rounded up to a 4-byte group, which is
          // what the data URI actually adds to the single-file HTML.
          const base64Bytes = items.reduce(
            (sum, item) => sum + (Number(item.bytes) ? Math.ceil(Number(item.bytes) / 3) * 4 : 0),
            0
          );
          payloadStats = {
            key,
            items,
            rawBytes,
            base64Bytes,
            missing: items.filter((item) => !item.exists).map((item) => item.url)
          };
        } catch (error) {
          // Cached under the same key as a success, so a persistent failure
          // cannot spin into a retry loop. Re-opening the 校验 tab clears it,
          // which is the natural "try again" gesture.
          payloadStats = { key, error: error instanceof Error ? error.message : String(error) };
        } finally {
          payloadStatsBusy = false;
          if (payloadStatsKey === key) payloadStatsKey = '';
          if (activeTab === 'checks') renderInspector();
        }
      }, 350);
    }

    function collectChecks() {
      const tuning = getTuning();
      let badNames = 0;
      let firstBadName = '';
      let badUrls = 0;
      let firstBadUrl = '';
      let badCountdown = 0;
      let firstBadCountdown = '';
      for (const [path, controls] of inputs) {
        if (controls.isFilename && controls.updateValidity && !controls.updateValidity()) {
          badNames += 1;
          firstBadName ||= path;
        }
        if (controls.urlInput && controls.urlInput.getAttribute('aria-invalid') === 'true') {
          badUrls += 1;
          firstBadUrl ||= path;
        }
        if (path.startsWith('countdown.') && controls.updateValidity && !controls.updateValidity()) {
          badCountdown += 1;
          firstBadCountdown ||= path;
        }
      }

      // Export refuses duplicate channel codes, because two channels would
      // resolve to the same delivery name. Surfacing it here turns a failed
      // two-minute build into a one-click fix.
      const channelOwners = new Map();
      const duplicateChannels = [];
      for (const [platform] of PLAYABLE_EXPORT_PLATFORMS) {
        const code = String(tuning.exportNaming?.channels?.[platform] ?? '').trim().toLowerCase();
        if (!code) continue;
        if (channelOwners.has(code)) {
          duplicateChannels.push(`exportNaming.channels.${channelOwners.get(code)} 与 ${platform} 都用 ${code}`);
        } else {
          channelOwners.set(code, platform);
        }
      }

      const vehicles = Array.isArray(LEVEL_1?.vehicles) ? LEVEL_1.vehicles : [];
      const vehicleIds = new Set(vehicles.map((vehicle) => Number(vehicle?.id)).filter(Number.isFinite));
      const guideIssues = [];
      let firstGuidePath = '';
      const hand = tuning.vehicleGuideHand ?? {};
      if (Number(hand.enabled) === 1) {
        if (hand.levelKey && hand.levelKey !== LEVEL_1.key) {
          guideIssues.push(`小手提示指向 ${hand.levelKey}，当前关卡是 ${LEVEL_1.key}`);
          firstGuidePath = 'vehicleGuideHand.levelKey';
        }
        if (!vehicleIds.has(Number(hand.vehicleId))) {
          guideIssues.push(`小手目标车 ${hand.vehicleId ?? '未选'} 不在本关`);
          firstGuidePath ||= 'vehicleGuideHand.vehicleId';
        }
      }
      const firstClick = tuning.firstClickGuide ?? {};
      if (Number(firstClick.enabled) === 1 && !vehicleIds.has(Number(firstClick.vehicleId))) {
        guideIssues.push(`开场引导目标车 ${firstClick.vehicleId ?? '未选'} 不在本关`);
        firstGuidePath ||= 'firstClickGuide.vehicleId';
      }

      const levelIssues = [];
      let firstLevelPath = '';
      if (!LEVEL_1?.key) {
        levelIssues.push('当前关卡没有加载到车辆数据');
        firstLevelPath = 'level.selected';
      } else {
        if (!vehicles.length) {
          levelIssues.push('关卡内没有车辆');
          firstLevelPath = 'level.selected';
        }
        if (!Array.isArray(LEVEL_1.passengerQueues) || LEVEL_1.passengerQueues.flat().length === 0) {
          levelIssues.push('关卡内没有乘客队列');
          firstLevelPath ||= 'level.selected';
        }
        const knownLevel = levelOptionItems.some((item) => item.key === LEVEL_1.key);
        if (!knownLevel && levelOptionItems.length > 0) {
          levelIssues.push(`${LEVEL_1.key} 不在关卡列表里，导出会失败`);
          firstLevelPath ||= 'level.selected';
        }
      }

      // The store gate counts cleared vehicles; a custom threshold above the
      // level's fleet can never be reached, so the ad runs out of cars with the
      // CTA still inert.
      const threshold = Number(tuning.installGate?.successfulOperationThreshold);
      const gateUnreachable = Number.isFinite(threshold) && vehicles.length > 0 && threshold > vehicles.length;

      const checks = [
        {
          state: badNames ? 'bad' : 'ok',
          title: '导出命名',
          note: badNames ? `${badNames} 个片段含非法字符` : '所有命名片段合法（可留空）',
          path: firstBadName
        },
        {
          state: duplicateChannels.length ? 'bad' : 'ok',
          title: '渠道代号',
          note: duplicateChannels.length
            ? duplicateChannels.join('；')
            : '七个渠道代号互不重复',
          path: duplicateChannels.length ? 'exportNaming.channels' : ''
        },
        {
          state: badCountdown ? 'warn' : 'ok',
          title: '倒计时配置',
          note: badCountdown ? `${badCountdown} 项时间配置冲突` : '时间配置有效',
          path: firstBadCountdown
        },
        {
          state: badUrls ? 'bad' : 'ok',
          title: '商店链接',
          note: badUrls ? `${badUrls} 个链接格式无效` : '链接格式有效',
          path: firstBadUrl
        },
        {
          state: levelIssues.length ? 'bad' : 'ok',
          title: '关卡数据',
          note: levelIssues.length
            ? levelIssues.join('；')
            : `${vehicles.length} 辆车、${LEVEL_1.passengerQueues.flat().length} 名乘客`,
          path: firstLevelPath
        },
        {
          state: gateUnreachable ? 'bad' : 'ok',
          title: '安装门槛',
          note: gateUnreachable
            ? `门槛 ${threshold} 大于本关 ${vehicles.length} 辆车，永远触发不了`
            : `${Number.isFinite(threshold) ? threshold : '自动'} 次操作后跳商店`,
          path: gateUnreachable ? 'installGate.successfulOperationThreshold' : ''
        },
        {
          state: guideIssues.length ? 'warn' : 'ok',
          title: '引导目标',
          note: guideIssues.length
            ? guideIssues.join('；')
            : '引导车辆都存在于本关',
          path: firstGuidePath
        },
        ...describeSizeChecks()
      ];
      return checks;
    }

    function describeSizeChecks() {
      if (payloadStats?.error) {
        return [{
          state: 'skip',
          title: '素材体积',
          note: `体积统计失败：${payloadStats.error}`
        }, {
          state: 'skip',
          title: '单包体积',
          note: '导出时由服务端 5 MB 门禁判定',
          path: ''
        }];
      }
      if (!payloadStats || payloadStatsBusy) {
        return [{
          state: 'skip',
          title: '素材体积',
          note: payloadStatsBusy ? '正在统计内联素材…' : '切换到这里时统计',
          path: ''
        }, {
          state: 'skip',
          title: '单包体积',
          note: '导出时由服务端 5 MB 门禁判定',
          path: ''
        }];
      }
      const { items, rawBytes, base64Bytes, missing } = payloadStats;
      const oversized = items.filter((item) => {
        const cap = perAssetCaps.find(([prefix]) => item.url.startsWith(prefix));
        return cap && Number(item.bytes) > cap[1];
      });
      const heaviest = items
        .filter((item) => Number(item.bytes) > 0)
        .sort((first, second) => Number(second.bytes) - Number(first.bytes))
        .slice(0, 3)
        .map((item) => `${assetShortName(item.url)} ${formatKilobytes(Number(item.bytes))}`);
      const assetNotes = [];
      if (missing.length) {
        // A count with no names leaves the operator hunting; the export refuses
        // the package over exactly these files, so say which ones.
        assetNotes.push(`缺 ${missing.slice(0, 3).map(assetShortName).join('、')}${missing.length > 3 ? ` 等 ${missing.length} 个` : ''}`);
      }
      if (oversized.length) {
        assetNotes.push(oversized.slice(0, 2).map((item) => {
          const [, cap, label] = perAssetCaps.find(([prefix]) => item.url.startsWith(prefix));
          return `${label} ${assetShortName(item.url)} 超过 ${formatKilobytes(cap)}`;
        }).join('；'));
      }
      if (heaviest.length) assetNotes.push(`最大 ${heaviest.join('、')}`);

      const estimatedBytes = base64Bytes + PLAYABLE_SHELL_BYTES;
      const sizeState = estimatedBytes > PLAYABLE_PAYLOAD_BUDGET_BYTES
        ? 'bad'
        : estimatedBytes > PLAYABLE_PAYLOAD_WARN_BYTES ? 'warn' : 'ok';
      return [{
        state: oversized.length || missing.length ? 'bad' : 'ok',
        title: '素材体积',
        note: `${items.length} 个内联素材 ${formatKilobytes(rawBytes)}${assetNotes.length ? `，${assetNotes.join('，')}` : ''}`,        path: ''
      }, {
        state: sizeState,
        title: '单包体积（估算）',
        note: `素材 base64 ${formatKilobytes(base64Bytes)} + 壳约 ${formatKilobytes(PLAYABLE_SHELL_BYTES)}，上限 5 MB`,
        path: ''
      }];
    }

    function assetShortName(url) {
      return String(url ?? '').split('/').pop() || url;
    }

    // Where a check's "fix" actually lives: the panel that owns the section,
    // and the row to flash. A channel code lives on a specific channel row, but
    // `exportNaming.channels.applovin` is addressed by its full path, while a
    // bare `exportNaming.channels` has to fall back to the naming section.
    function panelForPath(path) {
      for (const panel of SHELL_PANELS) {
        if (panel.match.test(path)) return panel.id;
      }
      return path.startsWith('exportNaming.') ? 'export' : 'scene';
    }

    function jumpToField(path) {
      const controls = inputs.get(path);
      const row = controls?.row
        ?? root.querySelector(`.editor-field[data-path="${CSS.escape(path)}"]`);
      const section = row?.closest('.editor-section')
        ?? [...root.querySelectorAll('.editor-section')].find(
          (candidate) => candidate.querySelector('.editor-field[data-path^="exportNaming."]')
            && path.startsWith('exportNaming.')
        );
      if (section) {
        setActivePanel(sectionPanel.get(section) ?? panelForPath(path));
        section.open = true;
      } else {
        setActivePanel(panelForPath(path));
      }
      if (!row) return;
      row.scrollIntoView({ block: 'center' });
      row.classList.add('is-shell-flash');
      setTimeout(() => row.classList.remove('is-shell-flash'), 1500);
      const focusTarget = controls?.textInput ?? controls?.number ?? controls?.select
        ?? controls?.urlInput ?? row.querySelector('input, select');
      focusTarget?.focus?.({ preventScroll: true });
    }

    function renderInspector() {
      for (const tab of inspectorTabs) {
        const on = tab.dataset.shellTab === activeTab;
        tab.classList.toggle('is-active', on);
        tab.setAttribute('aria-selected', String(on));
      }
      const tuning = getTuning();
      if (activeTab === 'facts') {
        const conveyor = String(tuning.conveyorLayout?.selected ?? '—');
        const spatial = conveyor.startsWith('spatial:');
        inspectorBody.innerHTML = `
          <div class="shell-insp-kv">
            <span>当前关卡</span><b>${String(tuning.level?.selected ?? '—')}</b>
            <span>跑道</span><b>${conveyor.replace(/^spatial:/, '立体 ')}</b>
            <span>跑道类型</span><b>${spatial ? '立体轨道' : '预制跑道'}</b>
            <span>车位</span><b>${Number(tuning.parkingSpots?.count ?? 0)} 个</b>
            <span>车辆显示</span><b>${Number(tuning.visibility?.vehicles) ? '开' : '关'}</b>
            <span>小人显示</span><b>${Number(tuning.visibility?.passengers) ? '开' : '关'}</b>
            <span>预览语言</span><b>${String(tuning.branding?.localization?.previewLocale ?? 'auto')}</b>
            <span>版本</span><b>v${BUILD_VERSION}</b>
          </div>
          <p class="shell-insp-note">这些值随调参实时更新。要改就切到左侧对应面板，这里只读。</p>`;
        return;
      }
      if (activeTab === 'checks') {
        const checks = collectChecks();
        inspectorBody.innerHTML = `<div class="shell-insp-checks">${checks.map((check, index) => (
          `<div class="shell-insp-check ${check.state}${check.path ? ' has-jump' : ''}" data-check-index="${index}"${check.path ? ' role="button" tabindex="0"' : ''}><i></i><div><strong>${check.title}</strong><small>${check.note}</small>${check.path ? '<em class="shell-insp-jump-field">去修改</em>' : ''}</div></div>`
        )).join('')}</div>
          <p class="shell-insp-note">同一结论也会落在出问题的字段旁：命名片段标红，倒计时时间冲突时导出按钮禁用。点「去修改」直接跳到对应字段。</p>`;
        for (const node of inspectorBody.querySelectorAll('.shell-insp-check.has-jump')) {
          const jump = () => {
            const check = checks[Number(node.dataset.checkIndex)];
            if (check?.path) jumpToField(check.path);
          };
          node.addEventListener('click', jump);
          node.addEventListener('keydown', (event) => {
            if (event.key !== 'Enter' && event.key !== ' ') return;
            event.preventDefault();
            jump();
          });
        }
        schedulePayloadStats();
        return;
      }
      const namingRows = [...inputs.entries()]
        .filter(([path]) => path.startsWith('exportNaming.'))
        .map(([path, controls]) => {
          const value = String(controls.textInput?.value ?? '').trim();
          return `<div class="shell-insp-kv-row"><span>${formatName(path)}</span><b class="${value ? '' : 'is-empty'}">${value || '未填'}</b></div>`;
        })
        .join('');
      inspectorBody.innerHTML = `
        <div class="shell-insp-kv-row-head"><span>命名片段</span><b>${namingRows.split('is-empty').length - 1} 项未填</b></div>
        ${namingRows}
        <div class="shell-insp-actions">
          <button type="button" class="shell-insp-jump" data-shell-jump="export">前往导出面板</button>
        </div>`;
      inspectorBody.querySelector('[data-shell-jump]')?.addEventListener('click', () => {
        setActivePanel('export');
        const exportSection = root.querySelector('.editor-playable-export');
        if (exportSection) {
          exportSection.open = true;
          exportSection.scrollIntoView({ block: 'center' });
        }
      });
    }

    for (const tab of inspectorTabs) {
      tab.addEventListener('click', () => {
        activeTab = tab.dataset.shellTab;
        // Re-opening the panel is the retry gesture for a failed asset-size
        // request; the failure is cached so an automatic refresh cannot loop.
        if (activeTab === 'checks' && payloadStats?.error) payloadStats = null;
        renderInspector();
      });
    }

    // ---- shared refresh ---------------------------------------------------
    // sync() runs on every tuning change; the rail badges and the inspector both
    // read tuning-dependent numbers, so they follow it.
    shellRefresh = () => {
      refreshRail();
      renderInspector();
    };

    setActivePanel('track');
    refreshRail();
    renderInspector();
  }


  // Collapse is classic-sidebar chrome. The shell layout hides the button with
  // CSS but still renders it, so this stays a real element in both modes; a
  // missing node here used to crash the whole editor mount.
  const toggle = root.querySelector('.editor-toggle');
  const setCollapsed = (collapsed) => {
    if (!toggle) return;
    root.classList.toggle('is-collapsed', collapsed);
    toggle.textContent = collapsed ? '\u8c03\u8282' : '\u00d7';
    toggle.setAttribute('aria-expanded', String(!collapsed));
    toggle.setAttribute('aria-label', collapsed ? '\u5c55\u5f00\u573a\u666f\u7f16\u8f91\u5668' : '\u6536\u8d77\u573a\u666f\u7f16\u8f91\u5668');
  };
  toggle?.addEventListener('click', () => setCollapsed(!root.classList.contains('is-collapsed')));

  // Header language picker. It writes the same `branding.localization.previewLocale`
  // the 引导 field row edits, so switching here and switching there stay in sync;
  // picking a market also turns localization on, because a picker that appears to
  // do nothing (localization disabled) is worse than one that just works.
  if (localeSelect) {
    localeSelect.addEventListener('change', () => {
      const next = structuredClone(getTuning());
      next.branding ??= {};
      next.branding.localization ??= {};
      next.branding.localization.previewLocale = localeSelect.value;
      if (localeSelect.value !== 'auto') next.branding.localization.enabled = 1;
      commitTuning(next, { path: 'branding.localization.previewLocale' });
      sync();
    });
  }

  // Release notes live in their own overlay so they never compete with the
  // tuning rows. Escape and a backdrop click both close it, and focus returns
  // to the 关于 button so keyboard navigation does not restart from the top.
  const aboutPanel = root.querySelector('.editor-about-panel');
  const aboutButton = root.querySelector('.editor-about');
  const aboutClose = root.querySelector('.editor-about-close');
  const setAboutOpen = (open) => {
    aboutPanel.hidden = !open;
    root.classList.toggle('is-about-open', open);
    if (open) aboutClose.focus?.();
    else aboutButton.focus?.();
  };
  aboutButton.addEventListener('click', () => setAboutOpen(true));
  aboutClose.addEventListener('click', () => setAboutOpen(false));
  aboutPanel.addEventListener('click', (event) => {
    if (event.target === aboutPanel) setAboutOpen(false);
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !aboutPanel.hidden) setAboutOpen(false);
  });

  // The layout switch is shell-only chrome. The choice is remembered, so an
  // operator who prefers either shell does not have to carry a URL around.
  root.querySelector('.editor-layout-switch')?.addEventListener('click', () => {
    const next = shellLayout ? 'classic' : 'shell';
    try { localStorage.setItem('bus-loop-editor-layout-v1', next); } catch { /* private mode */ }
    const url = new URL(location.href);
    url.searchParams.set('layout', next);
    location.href = url.toString();
  });

  root.querySelector('.editor-reset').addEventListener('click', () => {
    const selectedLevel = getTuning().level?.selected;
    clearSavedTuning();
    const resetTuning = structuredClone(defaults);
    resetTuning.level ??= {};
    resetTuning.level.selected = selectedLevel;
    commitTuning(resetTuning);
    sync({ resetCountdownDrafts: true });
  });

  // The classic sidebar collapses to a 76px strip on a narrow window. The shell
  // layout owns the whole page, so collapsing it there would hide the rail.
  if (!shellLayout && matchMedia('(max-width: 760px)').matches) setCollapsed(true);
  const savedOpeningGuideVehicleId = getAtPath(getTuning(), 'firstClickGuide.vehicleId');
  const normalizedOpeningGuideVehicleId = normalizeVehicleIdSelection(savedOpeningGuideVehicleId);
  if (
    normalizedOpeningGuideVehicleId !== null
    && normalizedOpeningGuideVehicleId !== savedOpeningGuideVehicleId
  ) {
    const next = structuredClone(getTuning());
    setAtPath(next, 'firstClickGuide.vehicleId', normalizedOpeningGuideVehicleId);
    setTuning(next, { path: 'firstClickGuide.vehicleId' });
  }
  setEditorCategory('level');
  // Runs after every section and its tool row exists, so the shell can move
  // finished nodes instead of rebuilding them. A failure here must not take the
  // editor down: the sections are still in .editor-fields in their original
  // order, so the worst case is an ungrouped column rather than a blank page.
  if (shellLayout) {
    try {
      installShellLayout();
    } catch (error) {
      console.error('Shell editor layout failed; falling back to a flat column.', error);
      root.dataset.shellError = error instanceof Error ? error.message : String(error);
      root.classList.add('shell-layout-failed');
    }
  }
  sync();
  updateHistoryButtons();
  refreshSpatialConveyorOptions().catch((error) => {
    spatialStatus.textContent = `\u5217\u8868\u4e0d\u53ef\u7528\uff1a${error.message}`;
  });
  refreshWebLevelOptions().catch((error) => {
    levelStatus.textContent = `\u7f51\u9875\u5173\u5361\u5217\u8868\u4e0d\u53ef\u7528\uff1a${error.message}`;
  });
  refreshBackgroundOptions().catch((error) => {
    backgroundStatus.dataset.state = 'error';
    backgroundStatus.textContent = `\u80cc\u666f\u5217\u8868\u4e0d\u53ef\u7528\uff1a${error.message}`;
  });
  refreshPreRollOptions().catch((error) => {
    preRollStatus.dataset.state = 'error';
    preRollStatus.textContent = `\u524d\u8d34\u5217\u8868\u4e0d\u53ef\u7528\uff1a${error.message}`;
  });
  return { sync, setCollapsed, refreshSpatialConveyorOptions, refreshWebLevelOptions, refreshPreRollOptions };
}
