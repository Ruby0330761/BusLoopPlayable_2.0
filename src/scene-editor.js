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
import { BUILD_VERSION } from './build-version.js';

// Operator preference for the level dropdown order; kept out of scene tuning
// so it never leaks into exported playable packages.
const LEVEL_SORT_STORAGE_KEY = 'bus-loop-level-sort-v1';
const LEVEL_SORT_MODES = Object.freeze(['number', 'name', 'created']);

const CONVEYOR_LAYOUT_OPTIONS = [
  ['dualQueue2', 'GameSceneDualQueue2'],
  ['dualQueue3', 'GameSceneDualQueue3'],
  ['dualQueue5', 'GameSceneDualQueue5'],
  ['dualQueue10', 'GameSceneDualQueue10']
];

const BACKGROUND_OPTIONS = [
  ['/assets/applovin/textures/BG01_split01_q60.jpg', 'BG01 \u51ac\u5b63'],
  ['/assets/applovin/textures/BG02_split01_winter_q60.jpg', 'BG02 \u51ac\u5b63'],
  ['/assets/applovin/textures/BG02_split01_summer_q60.jpg', 'BG02 \u590f\u5b63'],
  ['/assets/applovin/textures/BG01_split01_Sakura_q60.jpg', 'BG01 \u6a31\u82b1'],
  ['/assets/applovin/textures/BG01_split01_Grassland_q60.jpg', 'BG01 \u8349\u5730']
];

const BRANDING_ICON_OPTIONS = [
  ['/assets/icon-android.jpg', 'Android'],
  ['/assets/icon-ios.png', 'iOS']
];

const PRE_ROLL_OPTIONS = [
  ['/assets/preroll/TP1327.mp4', 'TP1327 (3.0s)'],
  ['/assets/preroll/TP1333.mp4', 'TP1333 (4.8s)'],
  ['/assets/preroll/TP1334.mp4', 'TP1334 (5.0s)']
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

const EDITOR_CATEGORIES = [
  ['level', '\u5173\u5361'],
  ['visual', '\u753b\u9762'],
  ['conveyor', '\u4f20\u9001\u5e26'],
  ['vehicle', '\u8f66\u8f86'],
  ['guide', '\u5f15\u5bfc'],
  ['export', '\u5bfc\u51fa']
];

function editorCategoryForGroup(group) {
  const path = group.fields?.[0]?.[1] ?? '';
  if (path.startsWith('exportNaming.')) return 'export';
  if (path.startsWith('level.')) return 'level';
  if (/^(?:conveyorLayout|conveyorLayouts|spatialConveyor|queueCurves|passengerShadows)\./.test(path)) {
    return 'conveyor';
  }
  if (/^(?:parkingSpots|vehiclePath|vehicleDeparturePath|vehicleArea)\./.test(path)) return 'vehicle';
  if (/^(?:cta|installGate|gameOver|vehicleGuideHand|firstClickGuide|entryBanner)\./.test(path)) return 'guide';
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
  return { blob: output, width, height };
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
      ['AppLovin \u6e20\u9053', 'exportNaming.channels.applovin', 0, 0, 1, null, 'filename'],
      ['Google Ads \u6e20\u9053', 'exportNaming.channels.google-ads', 0, 0, 1, null, 'filename'],
      ['Meta \u6e20\u9053', 'exportNaming.channels.meta', 0, 0, 1, null, 'filename'],
      ['Mintegral \u6e20\u9053', 'exportNaming.channels.mintegral', 0, 0, 1, null, 'filename'],
      ['Moloco \u6e20\u9053', 'exportNaming.channels.moloco', 0, 0, 1, null, 'filename'],
      ['TikTok \u6e20\u9053', 'exportNaming.channels.tiktok', 0, 0, 1, null, 'filename'],
      ['Unity Ads \u6e20\u9053', 'exportNaming.channels.unityads', 0, 0, 1, null, 'filename'],
      ['\u6b65\u6570', 'exportNaming.steps', 0, 0, 1, null, 'filename'],
      ['\u4f53\u529b', 'exportNaming.stamina', 0, 0, 1, null, 'filename']
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
      ['\u6587\u672c\u9ad8\u5ea6', 'branding.text.height', 16, 2160, 1]
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
      ['\u900f\u660e\u5ea6', 'background.opacity', 0, 1, 0.01]
    ]
  },
  {
    title: '\u5c0f\u4eba\u6a21\u578b',
    fields: [
      ['\u7edf\u4e00\u5927\u5c0f', 'passengers.modelScale', 0.2, 2, 0.01],
      ['\u540c\u6392\u95f4\u8ddd', 'passengers.groupSpacing', 0.03, 0.5, 0.01]
    ]
  },
  {
    title: 'CTA',
    fields: [
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
    title: '\u5546\u5e97\u8df3\u8f6c',
    fields: [
      ['\u6210\u529f\u64cd\u4f5c\u6b21\u6570', 'installGate.successfulOperationThreshold', 1, 200, 1],
      ['Android \u94fe\u63a5', 'storeLinks.android', 0, 0, 1, null, 'url'],
      ['iOS \u94fe\u63a5', 'storeLinks.ios', 0, 0, 1, null, 'url']
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
      ['\u8fb9\u754c\u5de6 X', 'vehiclePath.parkingBounds.minX', -6, 0, 0.01],
      ['\u8fb9\u754c\u53f3 X', 'vehiclePath.parkingBounds.maxX', 0, 6, 0.01],
      ['\u8fb9\u754c\u4e0b Z', 'vehiclePath.parkingBounds.minZ', -6, 0, 0.01],
      ['\u8fb9\u754c\u4e0a Z', 'vehiclePath.parkingBounds.maxZ', 0, 6, 0.01]
    ]
  },
  {
    title: '\u8f66\u8f86\u5f00\u51fa\u8f66\u4f4d\u8def\u5f84',
    fields: [
      ['\u663e\u793a\u8def\u5f84', 'vehicleDeparturePath.enabled', 0, 1, 1],
      ['\u6ee1\u8f7d\u505c\u987f', 'vehicleDeparturePath.fullLoadDelay', 0, 4, 0.05],
      ['\u7ebf\u6761\u9ad8\u5ea6', 'vehicleDeparturePath.y', -3, 0.5, 0.005],
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
      ['\u4e0a\u8f66\u653e\u5927\u500d\u6570', 'vehicleBoardingPulse.scale', 1, 2, 0.01],
      ['\u4e0a\u8f66\u7f29\u653e\u901f\u5ea6', 'vehicleBoardingPulse.speed', 0, 20, 0.1],
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
      ['\u5f15\u5bfc\u8f66 ID', 'vehicleGuideHand.vehicleId', 1, 200, 1],
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
      ['\u7f6e\u7070\u5176\u4ed6\u8f66\u8f86', 'firstClickGuide.maskEnabled', 0, 1, 1, null, 'toggle'],
      ['\u906e\u7f69\u900f\u660e\u5ea6', 'firstClickGuide.maskOpacity', 0, 1, 0.01],
      ['\u5149\u6548\u8fb9\u8ddd', 'firstClickGuide.holePadding', 0, 120, 1],
      ['\u5149\u6548\u5706\u89d2', 'firstClickGuide.holeRadius', 0, 120, 1],
      ['\u5149\u6548 X \u504f\u79fb', 'firstClickGuide.holeOffsetX', -240, 240, 1],
      ['\u5149\u6548 Y \u504f\u79fb', 'firstClickGuide.holeOffsetY', -240, 240, 1],
      ['\u5149\u6548\u5bbd\u5ea6', 'firstClickGuide.holeScaleX', 0.2, 3, 0.01],
      ['\u5149\u6548\u9ad8\u5ea6', 'firstClickGuide.holeScaleY', 0.2, 3, 0.01]
    ]
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

export function createSceneEditor(root, {
  getTuning,
  defaultTuning = getTuning(),
  setTuning,
  getPlayableExportPayload = () => ({ tuning: getTuning() }),
  clearSavedTuning = () => {},
  captureScreenshot = async () => { throw new Error('\u622a\u56fe\u529f\u80fd\u4e0d\u53ef\u7528'); },
  previewPreRoll = async () => {},
  openSpatialPointEditor = async () => {},
  openLevelLayoutEditor = async () => {},
  getCameraPreset = () => null
}) {
  const defaults = structuredClone(defaultTuning);
  root.innerHTML = `
    <header class="editor-header">
      <div>
        <span class="editor-kicker">SCENE EDITOR <span class="editor-version">v${BUILD_VERSION}</span></span>
        <h2>\u573a\u666f\u8c03\u8282</h2>
      </div>
      <button class="editor-toggle" type="button" aria-label="\u6536\u8d77\u573a\u666f\u7f16\u8f91\u5668" aria-expanded="true">\u00d7</button>
    </header>
    <div class="editor-body">
      <p class="editor-help">\u56fe\u7247\u4e0e\u884c\u8d70\u66f2\u7ebf\u53ef\u5206\u522b\u8c03\u8282\u3002\u53c2\u6570\u6309\u5f53\u524d\u5173\u5361\u5355\u72ec\u4fdd\u5b58\uff0c\u6bcf\u6b21\u8c03\u6574\u4f1a\u81ea\u52a8\u4fdd\u5b58\u3002</p>
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
      </details>
      <nav class="editor-category-tabs" role="tablist" aria-label="\u7f16\u8f91\u5668\u529f\u80fd\u5206\u7c7b">
        ${EDITOR_CATEGORIES.map(([id, label], index) => (
          `<button type="button" role="tab" data-editor-category-tab="${id}" aria-selected="${index === 0}" tabindex="${index === 0 ? 0 : -1}">${label}</button>`
        )).join('')}
      </nav>
      <details class="editor-section editor-playable-export" data-editor-category="export" open>
        <summary class="editor-section-summary"><h3>\u5bfc\u51fa\u8bd5\u73a9</h3></summary>
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
        <p class="editor-export-status" role="status" aria-live="polite" aria-atomic="true">\u5c31\u7eea</p>
      </details>
      <div class="editor-fields"></div>
      <div class="editor-history-actions">
        <button class="editor-history-button editor-undo" type="button" aria-label="\u64a4\u56de\u4e0a\u4e00\u6b65" title="\u64a4\u56de\u4e0a\u4e00\u6b65">&#8630;</button>
        <button class="editor-history-button editor-redo" type="button" aria-label="\u91cd\u505a\u4e0a\u4e00\u6b65" title="\u91cd\u505a\u4e0a\u4e00\u6b65">&#8631;</button>
        <button class="editor-reset" type="button">\u6062\u590d\u9ed8\u8ba4\u53c2\u6570</button>
      </div>
    </div>
  `;

  const fieldsRoot = root.querySelector('.editor-fields');
  const inputs = new Map();
  const exportSelect = root.querySelector('.editor-export-select');
  const exportButton = root.querySelector('.editor-export-button');
  const exportAllButton = root.querySelector('.editor-export-all-button');
  const exportStatus = root.querySelector('.editor-export-status');
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

  const sameTuning = (left, right) => JSON.stringify(left) === JSON.stringify(right);
  function updateHistoryButtons() {
    undoButton.disabled = tuningUndoStack.length === 0;
    redoButton.disabled = tuningRedoStack.length === 0;
  }
  function commitTuning(next, { path, merge = false } = {}) {
    const before = structuredClone(getTuning());
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
      sync();
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

  async function exportPlayable({ all = false } = {}) {
    const invalidNamingControl = [...inputs.values()]
      .find((controls) => controls.isFilename && !controls.updateValidity());
    if (invalidNamingControl) {
      invalidNamingControl.textInput.reportValidity();
      exportStatus.dataset.state = 'error';
      exportStatus.textContent = '\u5bfc\u51fa\u5931\u8d25\uff1a\u8bf7\u5148\u4fee\u6b63\u5bfc\u51fa\u547d\u540d\u5b57\u6bb5';
      return;
    }
    const platform = all ? null : exportSelect.value;
    const platformLabel = all
      ? '\u5168\u90e8 7 \u4e2a\u5e73\u53f0 \u00d7 Android/iOS'
      : (PLAYABLE_EXPORT_PLATFORMS.find(([id]) => id === platform)?.[1] ?? platform);
    exportSelect.disabled = true;
    exportButton.disabled = true;
    exportAllButton.disabled = true;
    exportButton.setAttribute('aria-busy', 'true');
    exportAllButton.setAttribute('aria-busy', 'true');
    exportStatus.dataset.state = 'busy';
    exportStatus.textContent = `\u6b63\u5728\u6253\u5305 ${platformLabel}...`;
    try {
      const exportPayload = getPlayableExportPayload() ?? { tuning: getTuning() };
      const response = await fetch(all ? '/__playable-export-all' : '/__playable-export', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(all ? exportPayload : { ...exportPayload, platform })
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
      const filename = all
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
      exportStatus.dataset.state = 'success';
      const checkMessage = check?.startsWith('skipped;')
        ? '\uff08\u672a\u6267\u884c\u672c\u5730\u68c0\u6d4b\uff09'
        : check ? `\uff08\u672c\u5730\u68c0\u6d4b ${check}\uff09` : '';
      exportStatus.textContent = `\u5df2\u4e0b\u8f7d ${filename}${checkMessage}\uff0c\u5f85\u5e73\u53f0\u9a8c\u6536`;
    } catch (error) {
      exportStatus.dataset.state = 'error';
      const message = error instanceof TypeError && /fetch|network|failed to fetch/i.test(error.message)
        ? '\u65e0\u6cd5\u8fde\u63a5\u5bfc\u51fa\u670d\u52a1\uff0c\u8bf7\u786e\u8ba4\u5f53\u524d\u7535\u8111\u53ef\u8bbf\u95ee\u7f16\u8f91\u5668\u5730\u5740'
        : error.message;
      exportStatus.textContent = `\u5bfc\u51fa\u5931\u8d25\uff1a${message}`;
    } finally {
      exportSelect.disabled = false;
      exportButton.disabled = false;
      exportAllButton.disabled = false;
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
    section.open = Boolean(group.defaultOpen);
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
      const isFilename = control === 'filename';
      const isText = control === 'text' || isFilename;
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
      const urlInput = row.querySelector('.editor-url');
      if (options) {
        const commitOption = (rawValue) => {
          const value = control === 'vehicle-id-select'
            ? normalizeVehicleIdSelection(rawValue)
            : rawValue;
          if (value === null) return;
          const next = structuredClone(getTuning());
          setAtPath(next, path, value);
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
          if (path === 'firstClickGuide.enabled') sync();
        });
        inputs.set(path, { row, checkbox, step });
        section.append(row);
        continue;
      }
      if (isText) {
        const updateValidity = () => {
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
        });
        textInput.addEventListener('blur', updateValidity);
        inputs.set(path, { row, textInput, isFilename, updateValidity });
        section.append(row);
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
      };
      range?.addEventListener('input', () => commit(range.value));
      number.addEventListener(isColor ? 'change' : 'input', () => commit(number.value));
      color?.addEventListener('change', () => commit(parseInt(color.value.slice(1), 16)));
      inputs.set(path, { row, range, number, color, step });
      section.append(row);
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
        'X-Background-Height': String(prepared.height)
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
    ensureBackgroundSelectValue(backgroundControls?.select, payload.item.value, payload.item.label);
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

  const levelSection = inputs.get('level.selected')?.row.closest('.editor-section');
  const levelActions = document.createElement('div');
  levelActions.className = 'editor-level-tools';
  levelActions.dataset.editorCategory = 'level';
  levelActions.innerHTML = `
    <div class="editor-level-actions">
      <button class="editor-level-edit" type="button">编辑关卡布局</button>
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
  const levelOpenFolderButton = levelActions.querySelector('.editor-level-open-folder');
  const levelFileInput = levelActions.querySelector('.editor-level-file');
  const levelStatus = levelActions.querySelector('.editor-level-status');
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
        option.textContent = item.displayName;
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
    const response = await fetch('/__level-authoring', { cache: 'no-store' });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || `HTTP ${response.status}`);
    levelOptionItems = (payload.items ?? []).filter((item) => item?.key && item.displayName);
    return applyLevelOptionSort();
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

  async function importUnityLevel(file) {
    if (!/\.asset$/i.test(file?.name ?? '')) {
      throw new Error('\u6587\u4ef6\u540d\u53ea\u9700\u4ee5 .asset \u7ed3\u5c3e');
    }
    const response = await fetch('/__unity-levels/import', {
      method: 'POST',
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'X-Level-Filename': encodeURIComponent(file.name),
        'X-Level-Target-Key': nextImportedLevelKey()
      },
      body: await file.text()
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || `HTTP ${response.status}`);
    const controls = inputs.get('level.selected');
    if (controls?.select && !controls.select.querySelector(`option[value="${CSS.escape(payload.level.key)}"]`)) {
      const option = document.createElement('option');
      option.value = payload.level.key;
      option.textContent = payload.level.displayName || `${payload.level.key} (${payload.level.filename})`;
      controls.select.append(option);
    }
    const action = payload.replaced ? '\u5df2\u66f4\u65b0' : '\u5df2\u5bfc\u5165';
    levelStatus.textContent = `${action} ${payload.level.key}\uff1a${payload.level.vehicleCount} \u8f86\u8f66\uff0c${payload.level.passengerCount} \u540d\u4e58\u5ba2\u3002\u6b63\u5728\u5207\u6362...`;
    const next = structuredClone(getTuning());
    next.level.selected = payload.level.key;
    commitTuning(next, { path: 'level.selected' });
    refreshWebLevelOptions().catch(() => {});
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
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify({ document, filename: file.name })
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || `HTTP ${response.status}`);
    await refreshWebLevelOptions();
    if (controls?.select) controls.select.value = payload.level.key;
    levelStatus.textContent = `已导入新关卡 ${payload.level.displayName}：${payload.level.vehicleCount} 辆车，${payload.level.passengerCount} 名乘客。正在应用...`;
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
    if (!window.confirm(`确定删除关卡 ${key}？`)) return;
    setLevelBusy(true);
    try {
      let response = await fetch(`/__level-authoring/${encodeURIComponent(key)}`, { method: 'DELETE' });
      if (response.status === 404) response = await fetch(`/__unity-levels/${encodeURIComponent(key)}`, { method: 'DELETE' });
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
      const blob = await response.blob();
      const disposition = response.headers.get('Content-Disposition') || '';
      const encoded = disposition.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
      const filename = encoded ? decodeURIComponent(encoded) : `level-${key}.json`;
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = filename;
      anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 0);
      levelStatus.textContent = `已导出 ${filename}`;
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

  function sync() {
    const tuning = getTuning();
    for (const [path, controls] of inputs) {
      const value = getAtPath(tuning, path);
      if (controls.select) {
        if (path === 'background.asset') ensureBackgroundSelectValue(controls.select, value);
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
    setPreRollBusy(preRollBusy);
    setBackgroundBusy(false);
  }

  const toggle = root.querySelector('.editor-toggle');
  const setCollapsed = (collapsed) => {
    root.classList.toggle('is-collapsed', collapsed);
    toggle.textContent = collapsed ? '\u8c03\u8282' : '\u00d7';
    toggle.setAttribute('aria-expanded', String(!collapsed));
    toggle.setAttribute('aria-label', collapsed ? '\u5c55\u5f00\u573a\u666f\u7f16\u8f91\u5668' : '\u6536\u8d77\u573a\u666f\u7f16\u8f91\u5668');
  };
  toggle.addEventListener('click', () => setCollapsed(!root.classList.contains('is-collapsed')));
  root.querySelector('.editor-reset').addEventListener('click', () => {
    const selectedLevel = getTuning().level?.selected;
    clearSavedTuning();
    const resetTuning = structuredClone(defaults);
    resetTuning.level ??= {};
    resetTuning.level.selected = selectedLevel;
    commitTuning(resetTuning);
    sync();
  });

  if (matchMedia('(max-width: 760px)').matches) setCollapsed(true);
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
