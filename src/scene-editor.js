import { LEVEL_OPTIONS } from './level-catalog.js';
import {
  isSpatialConveyorSelection,
  refreshSpatialConveyorPackages
} from './spatial-conveyor-runtime.js';
import { isValidStoreLink } from './store-links.js';

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

const PLAYABLE_EXPORT_PLATFORMS = [
  ['applovin', 'AppLovin', 'HTML'],
  ['google-ads', 'Google Ads', 'ZIP'],
  ['meta', 'Meta', 'ZIP'],
  ['unityads', 'Unity Ads', 'HTML'],
  ['mintegral', 'Mintegral', 'ZIP'],
  ['moloco', 'Moloco', 'HTML'],
  ['tiktok', 'TikTok', 'ZIP']
];

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
  return 'visual';
}

function isValidExportNamingPart(value) {
  const normalized = String(value ?? '').trim();
  return normalized.length > 0
    && normalized.length <= 64
    && !normalized.includes('..')
    && /^[A-Za-z0-9_-]+$/.test(normalized);
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
    title: '\u76f8\u673a',
    fields: [
      ['\u4fef\u89d2', 'camera.elevationDegrees', 25, 80, 1],
      ['\u900f\u89c6 FOV', 'camera.fovDegrees', 1, 40, 0.1],
      ['\u76ee\u6807 X', 'camera.targetX', -10, 10, 0.05],
      ['\u76ee\u6807 Z', 'camera.targetZ', -12, 12, 0.05],
      ['\u753b\u9762\u5bbd\u5ea6', 'camera.fitWidth', 8, 30, 0.1],
      ['\u753b\u9762\u9ad8\u5ea6', 'camera.fitHeight', 8, 36, 0.1]
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
      ['Enabled', 'cta.enabled', 0, 1, 1],
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
      ['Map Scale', 'vehicleArea.positionUnitScale', 0.6, 2.2, 0.01],
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
      ['\u751f\u6548\u5173\u5361', 'firstClickGuide.levelKey', 0, 0, 1, LEVEL_OPTIONS],
      ['\u76ee\u6807\u8f66 ID', 'firstClickGuide.vehicleId', 1, 200, 1],
      ['\u6301\u7eed\u65f6\u95f4', 'firstClickGuide.durationSeconds', 0, 10, 0.1],
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
  clearSavedTuning = () => {},
  openSpatialPointEditor = async () => {},
  openLevelLayoutEditor = async () => {}
}) {
  const defaults = structuredClone(defaultTuning);
  root.innerHTML = `
    <header class="editor-header">
      <div>
        <span class="editor-kicker">SCENE EDITOR</span>
        <h2>\u573a\u666f\u8c03\u8282</h2>
      </div>
      <button class="editor-toggle" type="button" aria-label="\u6536\u8d77\u573a\u666f\u7f16\u8f91\u5668" aria-expanded="true">\u00d7</button>
    </header>
    <div class="editor-body">
      <p class="editor-help">\u56fe\u7247\u4e0e\u884c\u8d70\u66f2\u7ebf\u53ef\u5206\u522b\u8c03\u8282\u3002\u6bcf\u6b21\u8c03\u6574\u4f1a\u81ea\u52a8\u4fdd\u5b58\u3002</p>
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
      <button class="editor-reset" type="button">\u6062\u590d\u9ed8\u8ba4\u53c2\u6570</button>
    </div>
  `;

  const fieldsRoot = root.querySelector('.editor-fields');
  const inputs = new Map();
  const exportSelect = root.querySelector('.editor-export-select');
  const exportButton = root.querySelector('.editor-export-button');
  const exportAllButton = root.querySelector('.editor-export-all-button');
  const exportStatus = root.querySelector('.editor-export-status');
  const categoryTabs = [...root.querySelectorAll('[data-editor-category-tab]')];

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
      ? '\u5168\u90e8 7 \u4e2a\u5e73\u53f0'
      : (PLAYABLE_EXPORT_PLATFORMS.find(([id]) => id === platform)?.[1] ?? platform);
    exportSelect.disabled = true;
    exportButton.disabled = true;
    exportAllButton.disabled = true;
    exportButton.setAttribute('aria-busy', 'true');
    exportAllButton.setAttribute('aria-busy', 'true');
    exportStatus.dataset.state = 'busy';
    exportStatus.textContent = `\u6b63\u5728\u6253\u5305 ${platformLabel} \u5e76\u6267\u884c\u672c\u5730\u68c0\u6d4b...`;
    try {
      const response = await fetch(all ? '/__playable-export-all' : '/__playable-export', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(all ? { tuning: getTuning() } : { platform, tuning: getTuning() })
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload.error || `HTTP ${response.status}`);
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
      exportStatus.textContent = `\u5df2\u4e0b\u8f7d ${filename}${check ? `\uff08\u672c\u5730\u68c0\u6d4b ${check}\uff09` : ''}\uff0c\u5f85\u5e73\u53f0\u9a8c\u6536`;
    } catch (error) {
      exportStatus.dataset.state = 'error';
      exportStatus.textContent = `\u5bfc\u51fa\u5931\u8d25\uff1a${error.message}`;
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

  for (const group of FIELD_GROUPS) {
    const section = document.createElement('details');
    section.className = 'editor-section';
    section.dataset.editorCategory = editorCategoryForGroup(group);
    section.open = Boolean(group.defaultOpen);
    if (group.conveyorLayout) section.dataset.conveyorLayout = group.conveyorLayout;
    if (group.spatialOnly) section.dataset.spatialOnly = 'true';
    if (group.spatialImportAnchor) section.dataset.spatialImportAnchor = 'true';
    section.innerHTML = `<summary class="editor-section-summary"><h3>${group.title}</h3></summary>`;
    for (const [label, path, min, max, step, options, control] of group.fields) {
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
        const commitOption = (value) => {
          const next = structuredClone(getTuning());
          setAtPath(next, path, value);
          setTuning(next, { path });
          select.value = value;
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
          if ((path === 'firstClickGuide.enabled' || path === 'vehicleGuideHand.enabled') && checkbox.checked) {
            const guideKey = path.split('.')[0];
            setAtPath(next, `${guideKey}.levelKey`, getAtPath(next, 'level.selected'));
          }
          setTuning(next, { path });
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
          textInput.setCustomValidity(valid ? '' : '\u4ec5\u652f\u6301 1-64 \u4f4d\u82f1\u6587\u5b57\u6bcd\u3001\u6570\u5b57\u3001\u4e2d\u5212\u7ebf\u548c\u4e0b\u5212\u7ebf\uff0c\u4e0d\u80fd\u5305\u542b ..');
          return valid;
        };
        textInput.addEventListener('input', () => {
          updateValidity();
          const next = structuredClone(getTuning());
          setAtPath(next, path, textInput.value);
          setTuning(next, { path });
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
          setTuning(next, { path });
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
        setTuning(next, { path });
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

  const levelSection = inputs.get('level.selected')?.row.closest('.editor-section');
  const levelActions = document.createElement('div');
  levelActions.className = 'editor-level-tools';
  levelActions.innerHTML = `
    <div class="editor-level-actions">
      <button class="editor-level-edit" type="button">编辑关卡布局</button>
      <button class="editor-level-import" type="button">\u5bfc\u5165\u5173\u5361</button>
      <button class="editor-level-open-folder" type="button">\u6253\u5f00\u5173\u5361\u6587\u4ef6\u5939</button>
    </div>
    <input class="editor-level-file" type="file" accept=".asset" hidden>
    <p class="editor-level-status" aria-live="polite">\u5c31\u7eea</p>
  `;
  levelSection?.append(levelActions);

  const levelImportButton = levelActions.querySelector('.editor-level-import');
  const levelEditButton = levelActions.querySelector('.editor-level-edit');
  const levelOpenFolderButton = levelActions.querySelector('.editor-level-open-folder');
  const levelFileInput = levelActions.querySelector('.editor-level-file');
  const levelStatus = levelActions.querySelector('.editor-level-status');

  function setLevelBusy(busy) {
    levelEditButton.disabled = busy;
    levelImportButton.disabled = busy;
    levelOpenFolderButton.disabled = busy;
  }

  async function refreshWebLevelOptions() {
    const controls = inputs.get('level.selected');
    if (!controls?.select) return [];
    const response = await fetch('/__level-authoring', { cache: 'no-store' });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || `HTTP ${response.status}`);
    for (const option of controls.select.querySelectorAll('[data-web-level]')) option.remove();
    for (const item of payload.items ?? []) {
      if (!item?.key || !item.displayName || controls.select.querySelector(`option[value="${CSS.escape(item.key)}"]`)) continue;
      const option = document.createElement('option');
      option.value = item.key;
      option.textContent = item.displayName;
      option.dataset.webLevel = 'true';
      controls.select.append(option);
    }
    controls.select.value = getTuning().level?.selected ?? '';
    return payload.items ?? [];
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
    if (!/^level[1-9]\d*\.asset$/i.test(file?.name ?? '')) {
      throw new Error('\u6587\u4ef6\u540d\u5fc5\u987b\u4e3a level<number>.asset');
    }
    const response = await fetch('/__unity-levels/import', {
      method: 'POST',
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'X-Level-Filename': encodeURIComponent(file.name)
      },
      body: await file.text()
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || `HTTP ${response.status}`);
    const controls = inputs.get('level.selected');
    if (controls?.select && !controls.select.querySelector(`option[value="${CSS.escape(payload.level.key)}"]`)) {
      const option = document.createElement('option');
      option.value = payload.level.key;
      option.textContent = `${payload.level.key} (${payload.level.filename})`;
      controls.select.append(option);
    }
    const action = payload.replaced ? '\u5df2\u66f4\u65b0' : '\u5df2\u5bfc\u5165';
    levelStatus.textContent = `${action} ${payload.level.key}\uff1a${payload.level.vehicleCount} \u8f86\u8f66\uff0c${payload.level.passengerCount} \u540d\u4e58\u5ba2\u3002\u6b63\u5728\u5207\u6362...`;
    const next = structuredClone(getTuning());
    next.level.selected = payload.level.key;
    setTuning(next, { path: 'level.selected' });
  }

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
      await importUnityLevel(file);
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
    setTuning(structuredClone(getTuning()), { path: 'conveyorLayout.selected' });
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
    const shouldReloadLevel = defaults.level?.selected !== getTuning().level?.selected;
    clearSavedTuning();
    setTuning(structuredClone(defaults), {
      path: shouldReloadLevel ? 'level.selected' : undefined
    });
    sync();
  });

  if (matchMedia('(max-width: 760px)').matches) setCollapsed(true);
  setEditorCategory('level');
  sync();
  refreshSpatialConveyorOptions().catch((error) => {
    spatialStatus.textContent = `\u5217\u8868\u4e0d\u53ef\u7528\uff1a${error.message}`;
  });
  refreshWebLevelOptions().catch((error) => {
    levelStatus.textContent = `\u7f51\u9875\u5173\u5361\u5217\u8868\u4e0d\u53ef\u7528\uff1a${error.message}`;
  });
  return { sync, setCollapsed, refreshSpatialConveyorOptions, refreshWebLevelOptions };
}
