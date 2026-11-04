import './styles.css';
import { BusLoopGame } from './game-model.js';
import { PLAYABLE_LEVEL_SEQUENCE, PLAYABLE_STAGES, PLAYABLE_STAGE_CHOICES, ACTIVE_PLAYABLE_SESSION } from './generated-active-level.js';
import { ACTIVE_SPATIAL_CONVEYOR_PACKAGE } from './generated-active-spatial-conveyor.js';
import { LEVEL_1, setActiveLevel } from './level-data.js';
import { createLevelSession } from './level-session.js';
import { SceneView } from './scene-view.js';
import { setActiveStageScene } from './stage-scene.js';
import { calculateAutoCameraFit, clampCenteredRectX } from './scene-layout.js';
import { SCENE_TUNING } from './scene-tuning.js';
import { pruneUnknownTuning } from './tuning-migrations.js';
import { isValidStoreLink, resolveStoreLink } from './store-links.js';
import { formatSpeedLabel, normalizeSpeedMultiplier, resolveTimeScale } from './speed-toggle.js';
import { createGameAudioController } from './audio-controller.js';
import { resolveLevelAudioConfig } from './level-audio-config.js';
import { createPreRollController } from './pre-roll.js';
import {
  getMechanismAudioConfig,
  getMechanismTypesForLevels
} from './mechanism-resources.js';
import { createPlatformBridge } from './platform-bridge.js';
import {
  getSpatialConveyorId,
  isSpatialConveyorSelection,
  registerSpatialConveyorPackage,
  refreshSpatialConveyorPackages
} from './spatial-conveyor-runtime.js';
import { detectPlayfieldHorizon, resolveBackgroundHorizon } from './background-alignment.js';

const EDITOR_ENABLED = import.meta.env.DEV || __REMOTE_EDITOR__;
const DEFAULT_SCENE_TUNING = EDITOR_ENABLED ? structuredClone(SCENE_TUNING) : null;

if (ACTIVE_SPATIAL_CONVEYOR_PACKAGE) {
  registerSpatialConveyorPackage(ACTIVE_SPATIAL_CONVEYOR_PACKAGE);
}

const TUNING_STORAGE_KEY = 'bus-loop-scene-tuning-v3';
const LEGACY_TUNING_STORAGE_KEY = 'bus-loop-scene-tuning-v2';
const LEVEL_TUNING_STORAGE_KEY = 'bus-loop-level-tuning-v1';
const LEVEL_EDITOR_PREVIEW_STORAGE_KEY = 'bus-loop-level-editor-preview-v3';
const LEGACY_LEVEL_EDITOR_PREVIEW_STORAGE_KEYS = Object.freeze([
  'bus-loop-level-editor-preview-v1',
  'bus-loop-level-editor-preview-v2'
]);
const LEVEL_EDITOR_PREVIEW_FORMAT = 'bus-loop-level-editor-preview-v3';
const INSTALL_THRESHOLD_CUSTOM_STORAGE_KEY = 'bus-loop-install-threshold-custom-v1';
const LEVEL36_VEHICLE_SCALE_MIGRATION_KEY = 'bus-loop-level36-vehicle-scale-v1';
const LEVEL36_VEHICLE_COMPACTION_MIGRATION_KEY = 'bus-loop-level36-vehicle-compaction-v1';
const LEVEL36_TIMED_GUIDE_MIGRATION_KEY = 'bus-loop-level36-timed-guide-v1';
const SPEED_TOGGLE_HIDDEN_MIGRATION_KEY = 'bus-loop-speed-toggle-hidden-v1';
const CUSTOM_BACKGROUND_ASSET_PREFIX = '/assets/editor-backgrounds/';
// Horizons measured in the browser for backgrounds that shipped without the
// sidecar metadata. Keyed by asset URL, so a re-imported or renamed artwork can
// never inherit another file's value.
const BACKGROUND_HORIZON_CACHE_KEY = 'bus-loop-background-horizons-v1';
const DEFAULT_BACKGROUND_SOURCE_WIDTH = 2100;
const DEFAULT_BACKGROUND_SOURCE_HEIGHT = 3382;
const DEFAULT_STORE_LINKS = { ...SCENE_TUNING.storeLinks };
const STORE_OPEN_COOLDOWN_MS = 800;
// Time given to the final departure animation of a stage before the level swap.
const STAGE_ADVANCE_DELAY_MS = 900;
let platformVisible = true;
// Module scoped because applyCtaTuning (which hides the store button) runs from
// resize handlers outside startRuntime's closure.
let stageChoiceActive = false;
let platformBridge;
const $ = (selector) => document.querySelector(selector);
const app = $('#app');
const stage = $('#stage');
const canvas = $('#game-canvas');
const loadingScreen = $('#loading-screen');
const loadingIcon = $('#loading-icon');
const loadingTitle = $('#loading-title');
const loadingProgress = loadingScreen?.querySelector('.loading-progress');
const loadingProgressBar = $('#loading-progress-bar');
const loadingProgressValue = $('#loading-progress-value');
const preRollOverlay = $('#pre-roll-overlay');
const preRollVideo = $('#pre-roll-video');
const gameOverOverlay = $('#game-over-overlay');const gameOverTitle = $('#game-over-title');
const gameOverLogo = $('#game-over-logo');
const gameOverRetryButton = $('#game-over-retry');
const stageChoiceOverlay = $('#stage-choice-overlay');
const stageChoiceTitle = $('#stage-choice-title');
const stageChoiceGrid = $('#stage-choice-grid');
const stageChoiceHand = $('#stage-choice-hand');
const ctaButton = $('#cta-button');
const speedToggleButton = $('#speed-toggle');
const speedToggleIcon = $('#speed-toggle-icon');
const speedToggleLabel = $('#speed-toggle-label');
const brandingItems = {
  icon: $('#branding-icon'),
  logo: $('#branding-logo'),
  text: $('#branding-text')
};
if (gameOverLogo && brandingItems.logo?.src) gameOverLogo.src = brandingItems.logo.src;
const sceneEditorRoot = $('#scene-editor');
const PASSENGER_MATERIAL_TUNING_PREFIX = 'passengerMaterial.';
const PASSENGER_MATERIAL_COLOR_INDEX_PATTERN = /^passengerMaterial\.(?:solidColors|colors)\.(\d+)(?:\.|$)/;
const isPassengerMaterialTuningPath = (path) => path?.startsWith(PASSENGER_MATERIAL_TUNING_PREFIX);
const getPassengerMaterialColorIndex = (path) => {
  const match = path?.match(PASSENGER_MATERIAL_COLOR_INDEX_PATTERN);
  if (!match) return null;
  const colorIndex = Number(match[1]);
  return Number.isInteger(colorIndex) ? colorIndex : null;
};

function createEditorFallbackView(level, initializationError = null) {
  const queueCount = Math.max(1, Number(level?.queueCount) || 2);
  const queueCapacity = Math.max(0, Number(level?.queueCapacity) || 0);
  const queueSpacing = Math.max(0.01, Number(level?.passengerQueue?.spacing) || 0.4);
  const queueCapacities = Array(queueCount).fill(queueCapacity);
  const context = canvas?.getContext?.('2d');
  const fallbackNotice = document.createElement('div');
  fallbackNotice.className = 'editor-fallback-notice';
  const hasInitializationError = Boolean(initializationError);
  const noticeTitle = document.createElement('strong');
  noticeTitle.textContent = hasInitializationError ? '3D 预览初始化失败' : '3D 预览不可用';
  const noticeText = document.createElement('span');
  noticeText.textContent = hasInitializationError
    ? '场景资源或配置初始化异常，二维关卡编辑器仍可使用；请查看悬停提示中的错误信息'
    : '当前浏览器未启用 WebGL，请使用支持硬件加速的 Chrome；关卡编辑器仍可使用';
  fallbackNotice.append(noticeTitle, noticeText);
  if (initializationError?.message) fallbackNotice.title = `初始化信息：${initializationError.message}`;
  stage?.append(fallbackNotice);
  let lastSize = { width: 0, height: 0, ratio: 1 };
  const drawFallbackState = () => {
    if (!context) return;
    const { width, height } = lastSize;
    context.clearRect(0, 0, width, height);
    context.fillStyle = '#0d1c2b';
    context.fillRect(0, 0, width, height);
  };
  return {
    ready: Promise.resolve(),
    resize() {
      if (!context || !canvas) return;
      const rect = canvas.getBoundingClientRect();
      const width = Math.max(1, Math.round(rect.width || innerWidth));
      const height = Math.max(1, Math.round(rect.height || innerHeight));
      const ratio = Math.min(globalThis.devicePixelRatio || 1, 2);
      if (canvas.width !== Math.round(width * ratio) || canvas.height !== Math.round(height * ratio)) {
        canvas.width = Math.round(width * ratio);
        canvas.height = Math.round(height * ratio);
        context.setTransform(ratio, 0, 0, ratio, 0, 0);
        lastSize = { width, height, ratio };
      }
      drawFallbackState();
    },
    render() {},
    update() { drawFallbackState(); },
    setInputEnabled() {},
    setTuning(patch) {
      deepMerge(SCENE_TUNING, patch);
      return SCENE_TUNING;
    },
    replaceActiveLevel() {},
    refreshSpatialConveyorDraft() {},
    resetGuideHandActivity() {},
    showEntryBanner() {},
    getBackgroundCanvasBounds() {
      const rect = canvas?.getBoundingClientRect?.();
      return { left: 0, top: 0, width: rect?.width || 1, height: rect?.height || 1 };
    },
    getCameraContentBounds() {
      return { minX: -4, maxX: 4, minZ: -4, maxZ: 4 };
    },
    getQueueSpacing() { return queueSpacing; },
    getQueueLengths() { return queueCapacities.map((capacity) => Math.max(0, capacity - 1) * queueSpacing); },
    getQueueCapacities() { return [...queueCapacities]; },
    getConveyorPathLength() { return Math.max(0.0001, Number(level?.conveyorPathLength) || 1); },
    getConveyorConfig() {
      return {
        layoutId: 'editor-fallback',
        capacity: Math.max(1, Number(level?.conveyorCapacity) || 1),
        queueCapacities: [...queueCapacities],
        entryPercents: [...(level?.entryPercents ?? [])],
        exitStart: Number(level?.exitStart) || 0,
        exitEnd: Number(level?.exitEnd) || 1,
        directEntrance: false,
        initiallyFull: false
      };
    },
    async captureFrame() {
      throw new Error('当前浏览器无法创建 WebGL 画布，暂时不能截图。');
    }
  };
}

function deepMerge(target, source) {
  for (const [key, value] of Object.entries(source ?? {})) {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      target[key] ??= {};
      deepMerge(target[key], value);
    } else {
      target[key] = value;
    }
  }
  return target;
}

// Saved tuning and per-level profiles snapshot the whole tuning object, so a
// field that was later removed from source keeps coming back through deepMerge.
// The exporter validates the payload against the current defaults and rejects
// the entire package for one unknown key, which surfaced as an unexplainable
// "export failed". Drop anything this build no longer defines and report it so
// the caller can rewrite the cache instead of pruning again on every load.
function migrateLegacyConveyorTuning(source) {
  if (source?.conveyorLayouts) return;
  const layout = SCENE_TUNING.conveyorLayouts?.dualQueue2;
  if (!layout) return;
  if (source?.conveyorArt) deepMerge(layout.art, source.conveyorArt);
  if (source?.conveyorCurve) deepMerge(layout.curve, source.conveyorCurve);
  if (source?.queueCurves) layout.queueCurves = structuredClone(source.queueCurves);
}

function migrateGuideHandMotionTuning(source) {
  const guideHand = source?.vehicleGuideHand;
  if (!guideHand) return false;
  let changed = false;
  if (guideHand.levelKey === 'level33' && Number(guideHand.vehicleId) === 1) {
    guideHand.vehicleId = 89;
    changed = true;
  }
  if (Number(guideHand.offsetX) === -0.38) {
    guideHand.offsetX = 0.38;
    changed = true;
  }
  if (Number(guideHand.approachOffsetX) === -0.62) {
    guideHand.approachOffsetX = 0.62;
    changed = true;
  }
  return changed;
}

function migrateLevel33EnhancementTuning(source) {
  let changed = false;
  const guideHand = source?.vehicleGuideHand;
  if (guideHand?.levelKey === 'level33' && Number(guideHand.size) === 1.63) {
    guideHand.size = 2.2;
    changed = true;
  }

  const firstClickGuide = source?.firstClickGuide;
  if (
    firstClickGuide?.levelKey === 'level33'
    && Number(firstClickGuide.vehicleId) === 89
    && Number(firstClickGuide.holePadding) === 15
  ) {
    firstClickGuide.holePadding = 30;
    changed = true;
  }

  const bounds = source?.vehiclePath?.parkingBounds;
  const hasLegacyBounds = source?.level?.selected === 'level33'
    && Number(bounds?.minX) === -2.1
    && Number(bounds?.maxX) === 2.2
    && Number(bounds?.minZ) === -3.02
    && Number(bounds?.maxZ) === 2.12;
  if (hasLegacyBounds) {
    Object.assign(bounds, {
      minX: -3,
      maxX: 2.95,
      minZ: -3.22,
      maxZ: 2.82
    });
    changed = true;
  }
  return changed;
}

function migrateLevel36VehicleScaleTuning(source) {
  if (
    source?.level?.selected !== 'level36'
    || localStorage.getItem(LEVEL36_VEHICLE_SCALE_MIGRATION_KEY) === '1'
  ) return false;
  localStorage.setItem(LEVEL36_VEHICLE_SCALE_MIGRATION_KEY, '1');
  if (Number(source?.vehicleArea?.modelScale) !== 0.75) return false;
  source.vehicleArea.modelScale = 0.7;
  return true;
}

function migrateLevel36VehicleCompactionTuning(source) {
  if (
    source?.level?.selected !== 'level36'
    || localStorage.getItem(LEVEL36_VEHICLE_COMPACTION_MIGRATION_KEY) === '1'
  ) return false;
  localStorage.setItem(LEVEL36_VEHICLE_COMPACTION_MIGRATION_KEY, '1');
  let changed = false;
  if (Number(source?.vehicleArea?.positionUnitScale) === 0.84) {
    source.vehicleArea.positionUnitScale = 0.8;
    changed = true;
  }
  const offsetZ = Number(source?.vehicleArea?.offsetZ);
  if ([0, -0.5, -0.25].includes(offsetZ)) {
    source.vehicleArea.offsetZ = -0.1;
    changed = true;
  }
  return changed;
}

function migrateLevel36TimedGuideTuning(source) {
  if (
    source?.level?.selected !== 'level36'
    || localStorage.getItem(LEVEL36_TIMED_GUIDE_MIGRATION_KEY) === '1'
  ) return false;
  localStorage.setItem(LEVEL36_TIMED_GUIDE_MIGRATION_KEY, '1');
  let changed = false;
  const assignChanged = (target, values) => {
    for (const [key, value] of Object.entries(values)) {
      if (target[key] === value) continue;
      target[key] = value;
      changed = true;
    }
  };
  source.vehicleGuideHand ??= {};
  source.firstClickGuide ??= {};
  assignChanged(source.vehicleGuideHand, {
    enabled: 1,
    levelKey: 'level36',
    vehicleId: 1,
    showAtStart: 1,
    idleDelaySeconds: 5
  });
  assignChanged(source.firstClickGuide, {
    enabled: 0,
    vehicleId: 1,
    maskOpacity: 0
  });
  return changed;
}

function migrateFirstClickGuideScope(source) {
  if (!source?.firstClickGuide || !Object.hasOwn(source.firstClickGuide, 'levelKey')) return false;
  delete source.firstClickGuide.levelKey;
  return true;
}

function migrateFirstClickGuideMaskTuning(source) {
  const guide = source?.firstClickGuide;
  if (!guide || Object.hasOwn(guide, 'maskEnabled')) return false;
  guide.maskEnabled = 1;
  if (Number(guide.maskOpacity) <= 0) guide.maskOpacity = 0.68;
  return true;
}

function migrateLevel16PackageTuning(source) {
  let changed = false;
  const replaceNumber = (target, key, previousValue, nextValue) => {
    if (Number(target?.[key]) !== previousValue) return;
    target[key] = nextValue;
    changed = true;
  };
  if (source?.level?.selected === 'level15') {
    source.level.selected = 'level16';
    changed = true;
  }
  replaceNumber(source?.installGate, 'successfulOperationThreshold', 40, 30);
  replaceNumber(source?.vehiclePath?.parkingBounds, 'minX', -2.53, -2.2);
  replaceNumber(source?.vehiclePath?.parkingBounds, 'maxX', 2.53, 2.2);
  replaceNumber(source?.vehicleArea, 'positionUnitScale', 0.73, 0.8);
  replaceNumber(source?.vehicleArea, 'modelScale', 0.63, 0.7);
  for (const guide of [source?.vehicleGuideHand, source?.firstClickGuide]) {
    if (guide?.levelKey !== 'level15' || Number(guide.vehicleId) !== 157) continue;
    guide.levelKey = 'level16';
    guide.vehicleId = 45;
    changed = true;
  }
  return changed;
}

function migrateLevel10PackageTuning(source) {
  let changed = false;
  const replaceNumber = (target, key, previousValue, nextValue) => {
    if (Number(target?.[key]) !== previousValue) return;
    target[key] = nextValue;
    changed = true;
  };
  if (source?.level?.selected === 'level16') {
    source.level.selected = 'level10';
    changed = true;
  }
  replaceNumber(source?.installGate, 'successfulOperationThreshold', 30, 10);
  replaceNumber(source?.cta, 'enabled', 0, 1);
  if (source?.background?.asset === '/assets/applovin/textures/BG02_split01_summer_q60.jpg') {
    source.background.asset = '/assets/applovin/textures/BG01_split01_Sakura_q60.jpg';
    changed = true;
  }
  if (source?.background?.asset === '/assets/applovin/textures/BG01_split01_Sakura_q60.jpg') {
    source.background.asset = '/assets/applovin/textures/BG01_split01_q60.jpg';
    changed = true;
  }
  for (const guide of [source?.vehicleGuideHand, source?.firstClickGuide]) {
    if (guide?.levelKey !== 'level16' || Number(guide.vehicleId) !== 45) continue;
    guide.levelKey = 'level10';
    guide.vehicleId = 39;
    changed = true;
  }
  return changed;
}

function migrateLevel12PackageTuning(source) {
  let changed = false;
  if (source?.level?.selected === 'level10') {
    source.level.selected = 'level12';
    changed = true;
  }
  if (source?.background?.asset === '/assets/applovin/textures/BG01_split01_q60.jpg') {
    source.background.asset = '/assets/applovin/textures/BG01_split01_Sakura_q60.jpg';
    changed = true;
  }
  for (const guide of [source?.vehicleGuideHand, source?.firstClickGuide]) {
    if (guide?.levelKey !== 'level10' || Number(guide.vehicleId) !== 39) continue;
    guide.levelKey = 'level12';
    guide.vehicleId = 34;
    changed = true;
  }
  return changed;
}

function migrateLegacyPackageTuning(source) {
  migrateLevel16PackageTuning(source);
  migrateLevel10PackageTuning(source);
  migrateLevel12PackageTuning(source);
}

function migrateSpatialSpeedTuning(source) {
  const spatial = source?.spatialConveyor;
  if (!spatial) return false;
  let changed = false;
  if (!Number.isFinite(Number(spatial.normalSpeedMultiplier))) {
    spatial.normalSpeedMultiplier = 1;
    changed = true;
  }
  if (Number(spatial.longPressMultiplier) === 5.2) {
    spatial.longPressMultiplier = 3;
    changed = true;
  }
  return changed;
}

// The speed switch used to be on by default, so every save wrote enabled: 1
// whether the operator touched it or not. It is now off by default; leaving the
// cached 1 in place would keep showing the button on every level that already
// has a profile. One marker guards the whole pass so an operator who enables a
// level afterwards is not flipped back off on the next reload.
function applySpeedToggleHiddenMigration(source) {
  const toggle = source?.speedToggle;
  if (!toggle || Number(toggle.enabled) !== 1) return false;
  toggle.enabled = 0;
  return true;
}

function migrateSpeedToggleHiddenTuning(source) {
  if (localStorage.getItem(SPEED_TOGGLE_HIDDEN_MIGRATION_KEY) === '1') return false;
  // Set the marker only after every cache has been handled below, otherwise the
  // first profile would consume it and the rest would keep the stale value.
  return applySpeedToggleHiddenMigration(source);
}

function migrateSpeedToggleHiddenProfiles() {
  if (localStorage.getItem(SPEED_TOGGLE_HIDDEN_MIGRATION_KEY) === '1') return false;
  const profiles = readLevelTuningProfiles();
  let changed = false;
  for (const profile of Object.values(profiles)) {
    if (!isLevelTuningProfile(profile)) continue;
    if (applySpeedToggleHiddenMigration(profile.tuning)) changed = true;
  }
  if (changed) writeLevelTuningProfiles(profiles);
  return changed;
}

function migrateCtaScreenPositionTuning(source) {
  const cta = source?.cta;
  if (!cta) return false;
  let changed = false;
  for (const key of ['worldX', 'worldY', 'worldZ', 'bottom']) {
    if (!(key in cta)) continue;
    delete cta[key];
    changed = true;
  }
  if (Number(cta.y) === 1868) {
    cta.y = 2018;
    changed = true;
  }
  if (Number(cta.height) === 137) {
    cta.height = 110;
    changed = true;
  }
  return changed;
}

// The first Retry build parked the pill at y=1790, which sits on the CTA strip.
// A saved profile would keep that value forever, so the one shipped default is
// rewritten to the new under-the-logo position. A value an operator chose is
// left alone: only that exact legacy default is migrated.
const LEGACY_RETRY_Y = 1790;
const MIGRATED_RETRY_Y = 1360;
function migrateGameOverRetryPositionTuning(source) {
  const gameOver = source?.gameOver;
  if (!gameOver) return false;
  if (Number(gameOver.retryY) !== LEGACY_RETRY_Y) return false;
  gameOver.retryY = MIGRATED_RETRY_Y;
  return true;
}

function migrateCustomBackgroundSourceSize(source) {
  const background = source?.background;
  if (!background?.asset?.startsWith(CUSTOM_BACKGROUND_ASSET_PREFIX)) return false;
  let changed = false;
  if (Number(background.sourceWidth) !== DEFAULT_BACKGROUND_SOURCE_WIDTH) {
    background.sourceWidth = DEFAULT_BACKGROUND_SOURCE_WIDTH;
    changed = true;
  }
  if (Number(background.sourceHeight) !== DEFAULT_BACKGROUND_SOURCE_HEIGHT) {
    background.sourceHeight = DEFAULT_BACKGROUND_SOURCE_HEIGHT;
    changed = true;
  }
  return changed;
}

function migrateExportNamingTuning(savedTuning) {
  // Browsers that already saved the old delivery defaults keep overriding the
  // new ones, so realign the fields this project unified (BL / WXJ / TJW,
  // steps and stamina cleared). Values an operator typed themselves stay.
  // Each entry lists the shipped defaults this project used before the current
  // one, so caches written between shipments are migrated too.
  const naming = savedTuning?.exportNaming;
  if (!naming || typeof naming !== 'object') return false;
  const replacements = [
    ['requirementCode', ['AC-2607141', 'BUS'], 'BL'],
    ['designer', ['NLY'], 'WXJ'],
    ['requester', ['ZZN'], 'TJW'],
    ['steps', ['5moves'], '0'],
    ['stamina', ['5hp'], '0']
  ];
  let changed = false;
  for (const [key, previousValues, next] of replacements) {
    if (previousValues.includes(naming[key])) {
      naming[key] = next;
      changed = true;
    }
  }
  return changed;
}

function migrateAboardSoundOffsetTuning(source) {
  // Browsers that already saved tuning keep the previous default (0 = no
  // offset at all) and would override the new shipped default, so realign it.
  // A value an operator typed themselves is left alone.
  const passengers = source?.passengers;
  if (!passengers || typeof passengers !== 'object') return false;
  if (Number(passengers.aboardSoundOffset) !== 0) return false;
  passengers.aboardSoundOffset = -0.25;
  return true;
}

function migrateAboardSoundOffsetProfiles() {
  // Per-level profiles snapshot the whole tuning object and are merged back
  // over SCENE_TUNING after the global migration, so they need the same pass
  // or the old default reappears for every level that already has a profile.
  const profiles = readLevelTuningProfiles();
  let changed = false;
  for (const profile of Object.values(profiles)) {
    if (!isLevelTuningProfile(profile)) continue;
    if (migrateAboardSoundOffsetTuning(profile.tuning)) changed = true;
  }
  if (changed) writeLevelTuningProfiles(profiles);
  return changed;
}

function migrateDepartureRouteHeightProfiles() {
  // Per-level profiles snapshot the whole tuning object and are merged back
  // over the global cache, so a profile written by the raised-route build would
  // otherwise keep the car off the line for that level.
  const profiles = readLevelTuningProfiles();
  let changed = false;
  for (const profile of Object.values(profiles)) {
    if (!isLevelTuningProfile(profile)) continue;
    if (migrateDepartureRouteHeightTuning(profile.tuning)) changed = true;
  }
  if (changed) writeLevelTuningProfiles(profiles);
  return changed;
}

function migrateDepartureRouteHeightTuning(source) {
  // A previous build of this same day drove departing cars at vehicleArea.y
  // instead of the authored departure height, and saved that value into the
  // caches. The authored height is what places the route on the road lane, so
  // anything still equal to the vehicle layer is put back. Values an operator
  // set themselves are left alone.
  const departure = source?.vehicleDeparturePath;
  if (!departure || typeof departure !== 'object') return false;
  const vehicleY = Number(source?.vehicleArea?.y);
  if (!Number.isFinite(vehicleY) || Math.abs(Number(departure.y) - vehicleY) > 1e-9) return false;
  departure.y = SCENE_TUNING.vehicleDeparturePath.y;
  return true;
}

function migrateSeatCountBoardTextScaleTuning(source) {
  // The digits used to be a billboard scaled 1.47x over a 0.42 x 0.26 sprite.
  // They now lie in the card's plane and textScale multiplies the card box, so
  // keeping 1.47 would draw them half again larger than the card. Only the old
  // default is rewritten; an operator's own value is left alone.
  const board = source?.seatCountBoard;
  if (!board || Number(board.textScale) !== 1.47) return false;
  board.textScale = SCENE_TUNING.seatCountBoard.textScale;
  return true;
}

function migrateSeatCountBoardTextScaleProfiles() {
  const profiles = readLevelTuningProfiles();
  let changed = false;
  for (const profile of Object.values(profiles)) {
    if (!isLevelTuningProfile(profile)) continue;
    if (migrateSeatCountBoardTextScaleTuning(profile.tuning)) changed = true;
  }
  if (changed) writeLevelTuningProfiles(profiles);
  return changed;
}

function migrateFootageConveyorArtTuning(source) {
  const layouts = source?.conveyorLayouts;
  if (!layouts || typeof layouts !== 'object') return false;
  let changed = false;
  for (const layoutId of ['heartLoop', 'catLoop']) {
    const art = layouts[layoutId]?.art;
    if (!art || typeof art !== 'object') continue;
    if (
      Number(art.z) === -4.15
      && Number(art.width) === 13.55
      && Number(art.depth) === 7.95
    ) {
      art.z = -5.3394;
      art.width = 16.685;
      art.depth = 10.3288;
      changed = true;
    }
  }
  return changed;
}

function migrateFootageConveyorArtProfiles() {
  const profiles = readLevelTuningProfiles();
  let changed = false;
  for (const profile of Object.values(profiles)) {
    if (!isLevelTuningProfile(profile)) continue;
    if (migrateFootageConveyorArtTuning(profile.tuning)) changed = true;
  }
  if (changed) writeLevelTuningProfiles(profiles);
  return changed;
}

function migrateExportNamingProfiles() {
  // Per-level profiles snapshot the whole tuning object and are merged back over
  // SCENE_TUNING after the global migration, so they need the same treatment or
  // the old delivery defaults reappear.
  const profiles = readLevelTuningProfiles();
  let changed = false;
  for (const profile of Object.values(profiles)) {
    if (!isLevelTuningProfile(profile)) continue;
    if (migrateExportNamingTuning(profile.tuning)) changed = true;
  }
  if (changed) writeLevelTuningProfiles(profiles);
  return changed;
}

function applyPreviewFrame() {
  const preview = SCENE_TUNING.preview;
  app?.classList.toggle('is-phone-preview', EDITOR_ENABLED && Boolean(preview?.enabled));
  if (app) {
    app.style.setProperty('--preview-width', String(preview?.width ?? 1080));
    app.style.setProperty('--preview-height', String(preview?.height ?? 2160));
  }
}

function refreshDefaultStoreLinks() {
  // Keep the fallback snapshot aligned with the links embedded in the exported tuning.
  for (const platform of ['android', 'ios']) {
    DEFAULT_STORE_LINKS[platform] = SCENE_TUNING.storeLinks?.[platform];
  }
}

function loadSavedTuning() {
  if (!EDITOR_ENABLED) return;
  try {
    const saved = localStorage.getItem(TUNING_STORAGE_KEY);
    if (saved) {
      const savedTuning = JSON.parse(saved);
      const guideHandMotionMigrated = migrateGuideHandMotionTuning(savedTuning);
      const level33EnhancementMigrated = migrateLevel33EnhancementTuning(savedTuning);
      const level36VehicleScaleMigrated = migrateLevel36VehicleScaleTuning(savedTuning);
      const level36VehicleCompactionMigrated = migrateLevel36VehicleCompactionTuning(savedTuning);
      const level36TimedGuideMigrated = migrateLevel36TimedGuideTuning(savedTuning);
      const firstClickGuideScopeMigrated = migrateFirstClickGuideScope(savedTuning);
      const firstClickGuideMaskMigrated = migrateFirstClickGuideMaskTuning(savedTuning);
      const spatialSpeedMigrated = migrateSpatialSpeedTuning(savedTuning);
      const speedToggleHiddenMigrated = migrateSpeedToggleHiddenTuning(savedTuning);
      const ctaScreenPositionMigrated = migrateCtaScreenPositionTuning(savedTuning);
      const gameOverRetryPositionMigrated = migrateGameOverRetryPositionTuning(savedTuning);
      const customBackgroundSourceMigrated = migrateCustomBackgroundSourceSize(savedTuning);
      const exportNamingMigrated = migrateExportNamingTuning(savedTuning);
      const aboardSoundOffsetMigrated = migrateAboardSoundOffsetTuning(savedTuning);
      const departureRouteHeightMigrated = migrateDepartureRouteHeightTuning(savedTuning);
      const seatCountBoardTextScaleMigrated = migrateSeatCountBoardTextScaleTuning(savedTuning);
      const footageConveyorArtMigrated = migrateFootageConveyorArtTuning(savedTuning);
      const luxuryPassengerRotationRemoved = delete savedTuning.luxuryPassengerRotation;
      const luxuryPassengerOffsetRemoved = delete savedTuning.luxuryPassengerOffset;
      const luxuryMaterialDebugRemoved = delete savedTuning.luxuryMaterialDebug;
      const conveyorVisualRemoved = delete savedTuning.conveyorVisual;
      const savedLuxuryMaterial = savedTuning.luxuryMaterial;
      const luxuryMaterialNeedsReset = !savedLuxuryMaterial
        || savedLuxuryMaterial.vehicleBrightness !== SCENE_TUNING.luxuryMaterial.vehicleBrightness
        || savedLuxuryMaterial.passengerBrightness !== SCENE_TUNING.luxuryMaterial.passengerBrightness
        || savedLuxuryMaterial.boardBrightness !== SCENE_TUNING.luxuryMaterial.boardBrightness;
      delete savedTuning.luxuryMaterial;
      deepMerge(SCENE_TUNING, savedTuning);
      const staleTuningPruned = pruneUnknownTuning(SCENE_TUNING, DEFAULT_SCENE_TUNING);
      migrateLegacyConveyorTuning(savedTuning);
      if (
        guideHandMotionMigrated
        || level33EnhancementMigrated
        || level36VehicleScaleMigrated
        || level36VehicleCompactionMigrated
        || level36TimedGuideMigrated
        || firstClickGuideScopeMigrated
        || firstClickGuideMaskMigrated
        || spatialSpeedMigrated
        || speedToggleHiddenMigrated
        || ctaScreenPositionMigrated
        || gameOverRetryPositionMigrated
        || customBackgroundSourceMigrated
        || exportNamingMigrated
        || aboardSoundOffsetMigrated
        || departureRouteHeightMigrated
        || seatCountBoardTextScaleMigrated
        || footageConveyorArtMigrated
        || luxuryPassengerRotationRemoved
        || luxuryPassengerOffsetRemoved
        || luxuryMaterialDebugRemoved
        || conveyorVisualRemoved
        || luxuryMaterialNeedsReset
        || staleTuningPruned
      ) {
        savedTuning.luxuryMaterial = structuredClone(SCENE_TUNING.luxuryMaterial);
        localStorage.setItem(TUNING_STORAGE_KEY, JSON.stringify(savedTuning));
      }
      restoreSelectedLevelTuning();
      return;
    }
    const legacySaved = localStorage.getItem(LEGACY_TUNING_STORAGE_KEY);
    if (!legacySaved) {
      restoreSelectedLevelTuning();
      return;
    }
    const legacy = JSON.parse(legacySaved);
    migrateGuideHandMotionTuning(legacy);
    migrateLevel33EnhancementTuning(legacy);
    migrateLevel36VehicleScaleTuning(legacy);
    migrateLevel36VehicleCompactionTuning(legacy);
    migrateLevel36TimedGuideTuning(legacy);
    migrateFirstClickGuideScope(legacy);
    migrateFirstClickGuideMaskTuning(legacy);
    migrateSpatialSpeedTuning(legacy);
    migrateSpeedToggleHiddenTuning(legacy);
    migrateCtaScreenPositionTuning(legacy);
    migrateGameOverRetryPositionTuning(legacy);
    migrateCustomBackgroundSourceSize(legacy);
    migrateExportNamingTuning(legacy);
    migrateAboardSoundOffsetTuning(legacy);
    migrateDepartureRouteHeightTuning(legacy);
    migrateSeatCountBoardTextScaleTuning(legacy);
    migrateLegacyPackageTuning(legacy);
    delete legacy.luxuryMaterialDebug;
    delete legacy.luxuryMaterial;
    delete legacy.conveyorVisual;
    const legacyModelScale = legacy.vehicleArea?.modelScale;
    delete legacy.vehicleArea;
    deepMerge(SCENE_TUNING, legacy);
    pruneUnknownTuning(SCENE_TUNING, DEFAULT_SCENE_TUNING);
    migrateLegacyConveyorTuning(legacy);
    if (Number.isFinite(legacyModelScale)) {
      SCENE_TUNING.vehicleArea.modelScale = legacyModelScale;
    }
  } catch (error) {
    console.warn('Saved scene tuning could not be loaded.', error);
  }
  restoreSelectedLevelTuning();
  // Saved editor tuning merges over the snapshot taken at load, so refresh afterwards.
  refreshDefaultStoreLinks();
}

function readLevelTuningProfiles() {
  if (!EDITOR_ENABLED) return {};
  try {
    const source = localStorage.getItem(LEVEL_TUNING_STORAGE_KEY);
    const parsed = source ? JSON.parse(source) : {};
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const profiles = parsed.profiles ?? parsed;
    if (!profiles || typeof profiles !== 'object' || Array.isArray(profiles)) return {};
    return profiles;
  } catch (error) {
    console.warn('Per-level scene tuning could not be loaded.', error);
    return {};
  }
}

function writeLevelTuningProfiles(profiles) {
  if (!EDITOR_ENABLED) return;
  try {
    localStorage.setItem(LEVEL_TUNING_STORAGE_KEY, JSON.stringify({ version: 1, profiles }));
  } catch (error) {
    console.warn('Per-level scene tuning could not be saved.', error);
  }
}

function isLevelTuningProfile(value) {
  return Boolean(value?.tuning)
    && typeof value.tuning === 'object'
    && !Array.isArray(value.tuning);
}

function saveLevelTuningProfile(value) {
  if (!EDITOR_ENABLED) return;
  const levelKey = String(value?.level?.selected ?? '').trim();
  if (!levelKey) return;
  const profiles = readLevelTuningProfiles();
  const previous = profiles[levelKey];
  profiles[levelKey] = {
    tuning: structuredClone(value),
    installThresholdCustom: isLevelTuningProfile(previous)
      ? Boolean(previous.installThresholdCustom)
      : localStorage.getItem(INSTALL_THRESHOLD_CUSTOM_STORAGE_KEY) === '1'
  };
  writeLevelTuningProfiles(profiles);
}

// Importing a level JSON allocates a brand new level key, so the tuning shipped
// inside that file has nowhere to land unless it is written for the new key
// explicitly. Base the profile on the current defaults so a file exported by an
// older build still gets sane values for whatever it omits.
function saveImportedLevelTuning(levelKey, tuning) {
  const key = String(levelKey ?? '').trim();
  if (!EDITOR_ENABLED || !/^level[1-9]\d*$/.test(key)) return false;
  if (!tuning || typeof tuning !== 'object' || Array.isArray(tuning)) return false;
  const merged = structuredClone(DEFAULT_SCENE_TUNING);
  deepMerge(merged, structuredClone(tuning));
  pruneUnknownTuning(merged, DEFAULT_SCENE_TUNING);
  merged.level ??= {};
  merged.level.selected = key;
  const profiles = readLevelTuningProfiles();
  profiles[key] = {
    tuning: merged,
    installThresholdCustom: Boolean(profiles[key]?.installThresholdCustom)
  };
  writeLevelTuningProfiles(profiles);
  return true;
}

function restoreSelectedLevelTuning() {
  if (!EDITOR_ENABLED) return;
  migrateExportNamingProfiles();
  migrateAboardSoundOffsetProfiles();
  migrateDepartureRouteHeightProfiles();
  migrateSeatCountBoardTextScaleProfiles();
  migrateFootageConveyorArtProfiles();
  // Run the profile pass before the marker is written: both paths above skip
  // everything once the marker exists, so the marker has to be the last step.
  migrateSpeedToggleHiddenProfiles();
  localStorage.setItem(SPEED_TOGGLE_HIDDEN_MIGRATION_KEY, '1');
  // Clean every stored profile, not only the selected one: switching levels
  // later would otherwise reload the same stale keys and break the export then.
  const storedProfiles = readLevelTuningProfiles();
  let profilesPruned = false;
  for (const [key, entry] of Object.entries(storedProfiles)) {
    if (!isLevelTuningProfile(entry)) continue;
    if (pruneUnknownTuning(entry.tuning, DEFAULT_SCENE_TUNING)) {
      storedProfiles[key] = entry;
      profilesPruned = true;
    }
  }
  if (profilesPruned) writeLevelTuningProfiles(storedProfiles);
  const levelKey = String(SCENE_TUNING.level?.selected ?? '').trim();
  if (!levelKey) return;
  const profiles = profilesPruned ? readLevelTuningProfiles() : storedProfiles;
  const profile = profiles[levelKey];
  if (isLevelTuningProfile(profile)) {
    deepMerge(SCENE_TUNING, structuredClone(profile.tuning));
    pruneUnknownTuning(SCENE_TUNING, DEFAULT_SCENE_TUNING);
    SCENE_TUNING.level.selected = levelKey;
    if (profile.installThresholdCustom) {
      localStorage.setItem(INSTALL_THRESHOLD_CUSTOM_STORAGE_KEY, '1');
    } else {
      localStorage.removeItem(INSTALL_THRESHOLD_CUSTOM_STORAGE_KEY);
    }
    return;
  }
  saveLevelTuningProfile(SCENE_TUNING);
}

function setLevelInstallThresholdCustom(levelKey, custom) {
  if (!EDITOR_ENABLED) return;
  const profiles = readLevelTuningProfiles();
  const profile = profiles[levelKey];
  if (!isLevelTuningProfile(profile)) return;
  profile.installThresholdCustom = Boolean(custom);
  profiles[levelKey] = profile;
  writeLevelTuningProfiles(profiles);
  if (custom) localStorage.setItem(INSTALL_THRESHOLD_CUSTOM_STORAGE_KEY, '1');
  else localStorage.removeItem(INSTALL_THRESHOLD_CUSTOM_STORAGE_KEY);
}

function getLevelTuningForSelection(levelKey) {
  const profiles = readLevelTuningProfiles();
  const profile = profiles[String(levelKey ?? '').trim()];
  if (isLevelTuningProfile(profile)) {
    const tuning = structuredClone(profile.tuning);
    pruneUnknownTuning(tuning, DEFAULT_SCENE_TUNING);
    tuning.level ??= {};
    tuning.level.selected = levelKey;
    return tuning;
  }
  const tuning = structuredClone(DEFAULT_SCENE_TUNING);
  tuning.level ??= {};
  tuning.level.selected = levelKey;
  return tuning;
}

function activateLevelTuning(levelKey) {
  flushTuningSave();
  writeTuning(SCENE_TUNING);
  const profiles = readLevelTuningProfiles();
  const profile = profiles[String(levelKey ?? '').trim()];
  const tuning = getLevelTuningForSelection(levelKey);
  if (profile?.installThresholdCustom) {
    localStorage.setItem(INSTALL_THRESHOLD_CUSTOM_STORAGE_KEY, '1');
  } else {
    localStorage.removeItem(INSTALL_THRESHOLD_CUSTOM_STORAGE_KEY);
  }
  writeTuning(tuning);
  return tuning;
}

let pendingTuningSave = null;
let tuningSaveTimer = 0;

function writeTuning(value) {
  if (!EDITOR_ENABLED) return;
  try {
    localStorage.setItem(TUNING_STORAGE_KEY, JSON.stringify(value));
    saveLevelTuningProfile(value);
  } catch (error) {
    console.warn('Scene tuning could not be saved.', error);
  }
}

function formatHexColor(value, fallback = 0xffffff) {
  const hex = Math.max(0, Math.min(0xffffff, Math.round(Number.isFinite(value) ? value : fallback)));
  return `#${hex.toString(16).padStart(6, '0')}`;
}

function getStageUiScale(stageWidth, designWidth) {
  return Math.max(0.01, Math.min(1, stageWidth / designWidth));
}

function scaledPx(value, scale) {
  return `${Math.max(0, value * scale)}px`;
}

function getBrandingStageMetrics() {
  const designWidth = Math.max(1, Number(SCENE_TUNING.preview?.width) || 1080);
  const designHeight = Math.max(1, Number(SCENE_TUNING.preview?.height) || 2160);
  const rect = stage?.getBoundingClientRect();
  const stageWidth = stage?.clientWidth || rect?.width || designWidth;
  const stageHeight = stage?.clientHeight || rect?.height || designHeight;
  const positionScaleX = stageWidth / designWidth;
  const positionScaleY = stageHeight / designHeight;
  return {
    designWidth,
    designHeight,
    stageWidth,
    stageHeight,
    positionScaleX,
    positionScaleY,
    uiScale: Math.max(0.01, Math.min(1, positionScaleX, positionScaleY)),
    screenLeft: (rect?.left || 0) + (stage?.clientLeft || 0),
    screenTop: (rect?.top || 0) + (stage?.clientTop || 0)
  };
}

function fitBrandingText(element, boxHeight) {
  const maxFontSize = Math.max(1, boxHeight * 0.62);
  element.style.fontSize = `${maxFontSize}px`;
  const availableWidth = element.clientWidth;
  const textRange = document.createRange();
  textRange.selectNodeContents(element);
  const contentWidth = textRange.getBoundingClientRect().width;
  if (availableWidth > 0 && contentWidth > availableWidth) {
    element.style.fontSize = `${Math.max(1, maxFontSize * availableWidth / contentWidth * 0.98)}px`;
  }
}

// One Bus build is uploaded to both stores. `branding.icon.deviceAssets` carries
// the icon for each store and the device UA decides which one a player sees; the
// store link already works this way, so the icon has to follow it or an iOS
// player gets the Play Store badge (or nothing, if only one asset shipped).
//
// The editor keeps its Icon 版本 picker authoritative: an operator choosing an
// icon there is explicitly overriding the device default for the preview.
function resolveBrandingIconAsset(config = {}) {
  if (!EDITOR_ENABLED) {
    const deviceAssets = config.deviceAssets;
    if (deviceAssets && typeof deviceAssets === 'object') {
      const device = isIOSDevice() ? 'ios' : 'android';
      const deviceAsset = deviceAssets[device];
      if (typeof deviceAsset === 'string' && deviceAsset) return deviceAsset;
    }
  }
  return typeof config.asset === 'string' ? config.asset : '';
}

function applyBrandingTuning(backgroundBounds = null) {
  const metrics = getBrandingStageMetrics();
  for (const [key, element] of Object.entries(brandingItems)) {
    if (!element) continue;
    const config = SCENE_TUNING.branding?.[key] ?? {};
    const enabled = Boolean(config.enabled ?? 1);
    const locked = Boolean(config.locked ?? 0);
    const x = Number.isFinite(Number(config.x)) ? Number(config.x) : metrics.designWidth / 2;
    const y = Number.isFinite(Number(config.y)) ? Number(config.y) : metrics.designHeight / 2;
    const width = Math.max(1, Number(config.width) || 180);
    const height = Math.max(1, Number(config.height) || width);
    const renderedWidth = width * metrics.uiScale;
    const renderedHeight = height * metrics.uiScale;
    const authoredCenterX = x * metrics.positionScaleX;
    const renderedCenterX = key === 'text'
      ? authoredCenterX
      : clampCenteredRectX({
        centerX: authoredCenterX,
        width: renderedWidth,
        left: backgroundBounds?.left,
        right: backgroundBounds?.right
      });
    const draggable = EDITOR_ENABLED && enabled && !locked;
    if (key === 'icon' || key === 'logo') {
      const asset = key === 'icon'
        ? resolveBrandingIconAsset(config)
        : (typeof config.asset === 'string' ? config.asset : '');
      if (asset && element.getAttribute('src') !== asset) element.setAttribute('src', asset);
      // The game-over panel reuses the branding logo, so it has to follow a
      // runtime logo switch instead of the document default captured at load.
      if (key === 'logo' && gameOverLogo) gameOverLogo.src = element.src;
    }
    if (key === 'text') {
      const content = String(config.content ?? 'Bus Fever Party!');
      element.textContent = content;
      element.setAttribute('aria-label', content);
    }
    element.hidden = !enabled;
    element.classList.toggle('is-draggable', draggable);
    element.classList.toggle('is-locked', locked);
    if (!draggable) element.classList.remove('is-dragging');
    element.style.left = `${renderedCenterX}px`;
    element.style.top = `${y * metrics.positionScaleY}px`;
    element.style.width = `${renderedWidth}px`;
    element.style.height = `${renderedHeight}px`;
    if (key === 'text') fitBrandingText(element, renderedHeight);
  }
  applyLoadingBranding();
}

// The loading screen is not an editable overlay, but a Crowd export must not
// flash the Bus Fever name while it waits. An empty icon follows the overlaid
// branding icon instead of embedding the same bytes a second time.
function applyLoadingBranding() {
  const config = SCENE_TUNING.branding?.loading ?? {};
  const icon = typeof config.icon === 'string' ? config.icon : '';
  const iconSource = icon || brandingItems.icon?.getAttribute('src') || '';
  if (loadingIcon && iconSource && loadingIcon.getAttribute('src') !== iconSource) {
    loadingIcon.setAttribute('src', iconSource);
  }
  if (loadingTitle && typeof config.title === 'string' && config.title && loadingTitle.textContent !== config.title) {
    loadingTitle.textContent = config.title;
    loadingIcon?.setAttribute('alt', `${config.title} icon`);
  }
}

applyLoadingBranding();

function bindBrandingDrag(element, key, onPositionChange) {
  if (!element || !EDITOR_ENABLED) return;
  let activePointerId = null;
  const finish = (event) => {
    if (activePointerId == null) return;
    const pointerId = activePointerId;
    activePointerId = null;
    element.classList.remove('is-dragging');
    if (element.hasPointerCapture?.(pointerId)) element.releasePointerCapture(pointerId);
  };
  element.addEventListener('pointerdown', (event) => {
    const config = SCENE_TUNING.branding?.[key];
    if (!config || !config.enabled || config.locked) return;
    event.preventDefault();
    event.stopPropagation();
    activePointerId = event.pointerId;
    element.setPointerCapture?.(event.pointerId);
    element.classList.add('is-dragging');
  });
  element.addEventListener('pointermove', (event) => {
    if (activePointerId == null) return;
    const config = SCENE_TUNING.branding?.[key];
    if (!config?.enabled || config.locked) {
      activePointerId = null;
      element.classList.remove('is-dragging');
      return;
    }
    const metrics = getBrandingStageMetrics();
    const localX = event.clientX - metrics.screenLeft;
    const localY = event.clientY - metrics.screenTop;
    const x = localX / metrics.positionScaleX;
    const y = localY / metrics.positionScaleY;
    onPositionChange(
      Math.max(0, Math.min(metrics.designWidth, x)),
      Math.max(0, Math.min(metrics.designHeight, y))
    );
  });
  element.addEventListener('pointerup', finish);
  element.addEventListener('pointercancel', finish);
  element.addEventListener('lostpointercapture', () => {
    activePointerId = null;
    element.classList.remove('is-dragging');
  });
}

function clampConfigNumber(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(max, number));
}

function durationFromSpeed(value, fallbackSpeed) {
  const speed = Math.max(0.01, Number(value) || fallbackSpeed);
  return 1 / speed;
}

function durationCss(value, fallbackSpeed) {
  return `${durationFromSpeed(value, fallbackSpeed)}s`;
}

let audio = null;
let preRollController = null;
let lastStoreOpenAt = 0;
let storeOpenAttempts = 0;
let ctaFitFontsReadyHooked = false;

// The button label must stay on one line (the tuned line height is much
// shorter than the font size, so wrapped lines would overlap). When engine or
// fallback metrics push the label past the button width, it shrinks instead.
function fitCtaLabel({ fontSize, fontHeight, uiScale, availableWidth }) {
  if (!ctaButton || ctaButton.hidden || !(availableWidth > 0)) return { fontSize, fontHeight };
  const textRange = document.createRange();
  textRange.selectNodeContents(ctaButton);
  const contentWidth = textRange.getBoundingClientRect().width;
  if (!(contentWidth > availableWidth)) return { fontSize, fontHeight };
  const ratio = availableWidth / contentWidth * 0.98;
  return { fontSize: fontSize * ratio, fontHeight: fontHeight * ratio };
}

function applyCtaTuning() {
  if (!ctaButton) return;
  const cta = SCENE_TUNING.cta ?? {};
  const metrics = getBrandingStageMetrics();
  const height = Math.max(1, Number(cta.height) || 68);
  const width = Math.max(1, height * (Number(cta.stretchX) || 2.75));
  const fontSize = Math.max(1, Number(cta.fontSize) || 28);
  const fontHeight = Math.max(1, Number(cta.fontHeight) || fontSize);
  const paddingX = 24;
  const centerX = Number.isFinite(Number(cta.x)) ? Number(cta.x) : metrics.designWidth / 2;
  const centerY = Number.isFinite(Number(cta.y))
    ? Number(cta.y)
    : metrics.designHeight - height / 2;
  const pulseSpeed = Math.max(0.01, Number(cta.pulseSpeed) || 0.55);
  const uiScale = metrics.uiScale;
  const renderedWidth = width * uiScale;
  const renderedHeight = height * uiScale;
  const left = clampConfigNumber(
    centerX * metrics.positionScaleX,
    renderedWidth / 2,
    metrics.stageWidth - renderedWidth / 2,
    metrics.stageWidth / 2
  );
  const top = clampConfigNumber(
    centerY * metrics.positionScaleY,
    renderedHeight / 2,
    metrics.stageHeight - renderedHeight / 2,
    metrics.stageHeight - renderedHeight / 2
  );
  // The picker owns the screen while it is open; the store button belongs to
  // the end of the ad and must not leak onto it.
  ctaButton.hidden = !Boolean(cta.enabled ?? 1) || stageChoiceActive;
  ctaButton.style.setProperty('--cta-width', scaledPx(width, uiScale));
  ctaButton.style.setProperty('--cta-height', scaledPx(height, uiScale));
  ctaButton.style.setProperty('--cta-padding-x', scaledPx(paddingX, uiScale));
  ctaButton.style.setProperty('--cta-font-size', scaledPx(fontSize, uiScale));
  ctaButton.style.setProperty('--cta-font-height', scaledPx(fontHeight, uiScale));
  const fitted = fitCtaLabel({
    fontSize,
    fontHeight,
    uiScale,
    availableWidth: renderedWidth - paddingX * uiScale * 2
  });
  if (fitted.fontSize !== fontSize) {
    ctaButton.style.setProperty('--cta-font-size', scaledPx(fitted.fontSize, uiScale));
    ctaButton.style.setProperty('--cta-font-height', scaledPx(fitted.fontHeight, uiScale));
  }
  ctaButton.style.setProperty('--cta-stroke-color', formatHexColor(cta.strokeColor, 0x196b07));
  ctaButton.style.setProperty('--cta-stroke-width', scaledPx(Math.max(0, Number(cta.strokeWidth) || 0), uiScale));
  ctaButton.style.setProperty('--cta-pulse-scale', String(Math.max(1, Number(cta.pulseScale) || 1.08)));
  ctaButton.style.setProperty('--cta-pulse-duration', `${1 / pulseSpeed}s`);
  ctaButton.style.setProperty('--game-over-cta-appear-duration', durationCss(cta.appearSpeed, 1.45));
  ctaButton.style.left = `${left}px`;
  ctaButton.style.top = `${top}px`;
  // An early fit may have measured a wider fallback face; re-fit once the
  // bundled font finishes loading so the label uses its final metrics.
  if (!ctaFitFontsReadyHooked && document.fonts?.ready) {
    ctaFitFontsReadyHooked = true;
    document.fonts.ready.then(() => applyCtaTuning()).catch(() => {});
  }
}

const screenshotImageCache = new Map();

async function loadScreenshotImage(source) {
  const url = new URL(source, window.location.href).href;
  const cached = screenshotImageCache.get(url);
  if (cached?.complete && cached.naturalWidth > 0) return cached;
  const image = new Image();
  image.decoding = 'async';
  image.src = url;
  screenshotImageCache.set(url, image);
  if (!image.complete) {
    await image.decode().catch((error) => {
      if (image.complete && image.naturalWidth > 0) return;
      throw error;
    });
  }
  return image;
}

function captureMetrics(width, height) {
  const designWidth = Math.max(1, Number(SCENE_TUNING.preview?.width) || 1080);
  const designHeight = Math.max(1, Number(SCENE_TUNING.preview?.height) || 2160);
  const positionScaleX = width / designWidth;
  const positionScaleY = height / designHeight;
  return {
    designWidth,
    designHeight,
    positionScaleX,
    positionScaleY,
    uiScale: Math.max(0.01, Math.min(1, positionScaleX, positionScaleY))
  };
}

function drawContainImage(context, image, centerX, centerY, width, height) {
  const sourceWidth = image.naturalWidth || image.videoWidth || image.width;
  const sourceHeight = image.naturalHeight || image.videoHeight || image.height;
  if (!sourceWidth || !sourceHeight || width <= 0 || height <= 0) return;
  const scale = Math.min(width / sourceWidth, height / sourceHeight);
  const drawWidth = sourceWidth * scale;
  const drawHeight = sourceHeight * scale;
  context.drawImage(image, centerX - drawWidth / 2, centerY - drawHeight / 2, drawWidth, drawHeight);
}

async function drawScreenshotBranding(context, metrics, width) {
  for (const key of ['icon', 'logo']) {
    const config = SCENE_TUNING.branding?.[key] ?? {};
    if (!Boolean(config.enabled ?? 1)) continue;
    const source = key === 'icon' ? config.asset : brandingItems.logo?.getAttribute('src');
    if (!source) continue;
    const image = await loadScreenshotImage(source).catch(() => null);
    if (!image) continue;
    const renderedWidth = Math.max(1, Number(config.width) || 180) * metrics.uiScale;
    const renderedHeight = Math.max(1, Number(config.height) || renderedWidth) * metrics.uiScale;
    const centerX = clampConfigNumber(
      (Number.isFinite(Number(config.x)) ? Number(config.x) : metrics.designWidth / 2) * metrics.positionScaleX,
      renderedWidth / 2,
      width - renderedWidth / 2,
      width / 2
    );
    const centerY = (Number.isFinite(Number(config.y)) ? Number(config.y) : metrics.designHeight / 2)
      * metrics.positionScaleY;
    drawContainImage(context, image, centerX, centerY, renderedWidth, renderedHeight);
  }

  const textConfig = SCENE_TUNING.branding?.text ?? {};
  if (!Boolean(textConfig.enabled ?? 1)) return;
  const content = String(textConfig.content ?? 'Bus Fever Party!');
  const boxWidth = Math.max(1, Number(textConfig.width) || 800) * metrics.uiScale;
  const boxHeight = Math.max(1, Number(textConfig.height) || 100) * metrics.uiScale;
  const centerX = (Number.isFinite(Number(textConfig.x)) ? Number(textConfig.x) : metrics.designWidth / 2)
    * metrics.positionScaleX;
  const centerY = (Number.isFinite(Number(textConfig.y)) ? Number(textConfig.y) : metrics.designHeight / 2)
    * metrics.positionScaleY;
  let fontSize = Math.max(1, boxHeight * 0.62);
  context.save();
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.font = `700 ${fontSize}px 'Poppins Branding', Arial, sans-serif`;
  const measuredWidth = context.measureText(content).width;
  if (measuredWidth > boxWidth) {
    fontSize = Math.max(1, fontSize * boxWidth / measuredWidth * 0.98);
    context.font = `700 ${fontSize}px 'Poppins Branding', Arial, sans-serif`;
  }
  context.fillStyle = '#fff';
  context.shadowColor = 'rgba(14, 33, 51, .72)';
  context.shadowBlur = 5 * metrics.uiScale;
  context.shadowOffsetY = 3 * metrics.uiScale;
  context.fillText(content, centerX, centerY);
  context.shadowColor = 'rgba(14, 33, 51, .95)';
  context.shadowBlur = 1 * metrics.uiScale;
  context.shadowOffsetY = 1 * metrics.uiScale;
  context.fillText(content, centerX, centerY);
  context.restore();
}

async function drawScreenshotCta(context, metrics, width, height) {
  const cta = SCENE_TUNING.cta ?? {};
  if (!Boolean(cta.enabled ?? 1)) return;
  const buttonHeight = Math.max(1, Number(cta.height) || 68);
  const buttonWidth = Math.max(1, buttonHeight * (Number(cta.stretchX) || 2.75));
  const renderedWidth = buttonWidth * metrics.uiScale;
  const renderedHeight = buttonHeight * metrics.uiScale;
  const centerX = clampConfigNumber(
    (Number.isFinite(Number(cta.x)) ? Number(cta.x) : metrics.designWidth / 2) * metrics.positionScaleX,
    renderedWidth / 2,
    width - renderedWidth / 2,
    width / 2
  );
  const centerY = clampConfigNumber(
    (Number.isFinite(Number(cta.y)) ? Number(cta.y) : metrics.designHeight - buttonHeight / 2)
      * metrics.positionScaleY,
    renderedHeight / 2,
    height - renderedHeight / 2,
    height - renderedHeight / 2
  );
  const button = await loadScreenshotImage('/assets/unity/ui/Main_Prop_GreenBtn.png').catch(() => null);
  if (button) drawContainImage(context, button, centerX, centerY, renderedWidth, renderedHeight);

  const fontSize = Math.max(1, Number(cta.fontSize) || 28) * metrics.uiScale;
  const strokeWidth = Math.max(0, Number(cta.strokeWidth) || 0) * metrics.uiScale;
  context.save();
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.font = `900 ${fontSize}px 'Poppins Branding', Arial, sans-serif`;
  context.lineJoin = 'round';
  context.lineWidth = Math.max(1, strokeWidth * 2);
  context.strokeStyle = formatHexColor(cta.strokeColor, 0x196b07);
  context.fillStyle = '#fff';
  context.shadowColor = 'rgba(20, 86, 4, .35)';
  context.shadowBlur = 4 * metrics.uiScale;
  context.shadowOffsetY = 3 * metrics.uiScale;
  context.strokeText('Play Now', centerX, centerY);
  context.fillText('Play Now', centerX, centerY);
  context.restore();
}

async function composeScreenshotBlob(baseBlob, { width, height }) {
  const output = document.createElement('canvas');
  output.width = width;
  output.height = height;
  const context = output.getContext('2d');
  const baseImage = await createImageBitmap(baseBlob);
  context.drawImage(baseImage, 0, 0, width, height);
  baseImage.close?.();
  const metrics = captureMetrics(width, height);
  if (document.fonts?.ready) await document.fonts.ready.catch(() => {});
  await drawScreenshotBranding(context, metrics, width);
  await drawScreenshotCta(context, metrics, width, height);
  return new Promise((resolve, reject) => {
    output.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error('截图生成失败'));
    }, 'image/png');
  });
}

function downloadBlob(filename, blob) {
  const objectUrl = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = objectUrl;
  link.download = filename;
  link.hidden = true;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(objectUrl), 0);
}

function applyGameOverTuning() {
  if (!gameOverOverlay) return;
  const gameOver = SCENE_TUNING.gameOver ?? {};
  const designWidth = Math.max(1, Number(SCENE_TUNING.preview?.width) || 1080);
  const designHeight = Math.max(1, Number(SCENE_TUNING.preview?.height) || 2160);
  const stageRect = stage?.getBoundingClientRect();
  const stageWidth = stageRect?.width || designWidth;
  const stageHeight = stageRect?.height || designHeight;
  const uiScale = getStageUiScale(stageWidth, designWidth);
  const logoX = Number.isFinite(Number(gameOver.logoX)) ? Number(gameOver.logoX) : designWidth / 2;
  const logoY = Number.isFinite(Number(gameOver.logoY)) ? Number(gameOver.logoY) : designHeight * 0.4;
  const logoWidth = Math.max(1, Number(gameOver.logoWidth) || 240);
  const logoHeight = Math.max(1, Number(gameOver.logoHeight) || logoWidth);
  const logoLeft = stageWidth / 2 + (logoX - designWidth / 2) * uiScale;
  const logoTop = stageHeight / 2 + (logoY - designHeight / 2) * uiScale;

  gameOverOverlay.style.setProperty('--game-over-mask-opacity', String(clampConfigNumber(gameOver.maskOpacity, 0, 1, 0.6)));
  gameOverOverlay.style.setProperty('--game-over-title-font-size', scaledPx(Math.max(1, Number(gameOver.titleFontSize) || 96), uiScale));
  gameOverOverlay.style.setProperty('--game-over-title-pop-duration', durationCss(gameOver.titlePopSpeed, 1.35));
  gameOverOverlay.style.setProperty('--game-over-title-fade-duration', durationCss(gameOver.titleFadeSpeed, 1.45));
  gameOverOverlay.style.setProperty('--game-over-logo-left', `${logoLeft}px`);
  gameOverOverlay.style.setProperty('--game-over-logo-top', `${logoTop}px`);
  gameOverOverlay.style.setProperty('--game-over-logo-width', scaledPx(logoWidth, uiScale));
  gameOverOverlay.style.setProperty('--game-over-logo-height', scaledPx(logoHeight, uiScale));
  gameOverOverlay.style.setProperty('--game-over-logo-radius', scaledPx(Math.max(0, Number(gameOver.logoRadius) || 0), uiScale));
  gameOverOverlay.style.setProperty('--game-over-logo-appear-duration', durationCss(gameOver.logoAppearSpeed, 1.45));

  // The Retry pill is authored at 1400x383, so its height follows the tuned
  // width instead of being an independent number that could distort the art.
  if (gameOverRetryButton) {
    const retryWidth = Math.max(40, Number(gameOver.retryWidth) || 420);
    const retryHeight = retryWidth * (383 / 1400);
    const retryX = Number.isFinite(Number(gameOver.retryX)) ? Number(gameOver.retryX) : designWidth / 2;
    // Default sits just under the logo: the logo is centred at gameOver.logoY
    // with gameOver.logoHeight, so its bottom edge is the anchor. Anchoring to a
    // percentage of the screen instead put the button near the CTA strip.
    const logoBottom = (Number.isFinite(Number(gameOver.logoY)) ? Number(gameOver.logoY) : designHeight * 0.4)
      + (Number.isFinite(Number(gameOver.logoHeight)) ? Number(gameOver.logoHeight) : 587) / 2;
    const retryDefaultY = logoBottom + 30 + retryHeight / 2;
    const retryY = Number.isFinite(Number(gameOver.retryY)) ? Number(gameOver.retryY) : retryDefaultY;
    const renderedWidth = retryWidth * uiScale;
    const renderedHeight = retryHeight * uiScale;
    const left = clampConfigNumber(
      retryX * (stageWidth / designWidth),
      renderedWidth / 2,
      stageWidth - renderedWidth / 2,
      stageWidth / 2
    );
    const top = clampConfigNumber(
      retryY * (stageHeight / designHeight),
      renderedHeight / 2,
      stageHeight - renderedHeight / 2,
      stageHeight * 0.84
    );
    gameOverRetryButton.style.setProperty('--game-over-retry-left', `${left}px`);
    gameOverRetryButton.style.setProperty('--game-over-retry-top', `${top}px`);
    gameOverRetryButton.style.setProperty('--game-over-retry-width', `${renderedWidth}px`);
    gameOverRetryButton.style.setProperty('--game-over-retry-height', `${renderedHeight}px`);
    gameOverRetryButton.style.setProperty('--game-over-retry-appear-duration', durationCss(gameOver.retryAppearSpeed, 1.45));
  }
}

function isIOSDevice() {
  const userAgent = navigator.userAgent || '';
  return /iPhone|iPad|iPod/i.test(userAgent) ||
    ((navigator.platform === 'MacIntel' || /Macintosh/i.test(userAgent)) && navigator.maxTouchPoints > 1);
}

function getStoreTarget() {
  const platform = isIOSDevice() ? 'ios' : 'android';
  const web = resolveStoreLink(platform, SCENE_TUNING.storeLinks?.[platform], DEFAULT_STORE_LINKS[platform]);
  return { web, mraid: [web] };
}

function getMraidStoreUrl(target) {
  const urls = target.mraid ?? [target.web];
  return urls[Math.min(storeOpenAttempts, urls.length - 1)] ?? target.web;
}

function openStore() {
  const now = Date.now();
  if (now - lastStoreOpenAt < STORE_OPEN_COOLDOWN_MS) return;
  lastStoreOpenAt = now;
  const target = getStoreTarget();
  const url = getMraidStoreUrl(target);
  storeOpenAttempts += 1;
  if (platformBridge?.openStore({ ios: url, android: url })) return;
  lastStoreOpenAt = 0;
}

function InstallFullGame() {
  audio?.unlock();
  platformBridge?.end();
  openStore();
}

function getSuccessfulOperationThreshold() {
  const configuredThreshold = Number(SCENE_TUNING.installGate?.successfulOperationThreshold);
  const hasCustomThreshold = !EDITOR_ENABLED
    || localStorage.getItem(INSTALL_THRESHOLD_CUSTOM_STORAGE_KEY) === '1';
  if (!hasCustomThreshold) return Math.max(1, LEVEL_1.vehicles?.length ?? 40);
  if (Number.isFinite(configuredThreshold) && configuredThreshold > 0) {
    return Math.max(1, Math.floor(configuredThreshold));
  }
  return Math.max(1, LEVEL_1.vehicles?.length ?? 40);
}

function flushTuningSave() {
  if (tuningSaveTimer) {
    clearTimeout(tuningSaveTimer);
    tuningSaveTimer = 0;
  }
  if (!pendingTuningSave) return;
  writeTuning(pendingTuningSave);
  pendingTuningSave = null;
}

function saveTuning(value, { immediate = false } = {}) {
  pendingTuningSave = value;
  if (immediate) {
    flushTuningSave();
    return;
  }
  clearTimeout(tuningSaveTimer);
  tuningSaveTimer = setTimeout(flushTuningSave, 150);
}

function clearSavedTuning() {
  if (!EDITOR_ENABLED) return;
  pendingTuningSave = null;
  clearTimeout(tuningSaveTimer);
  tuningSaveTimer = 0;
  const levelKey = String(SCENE_TUNING.level?.selected ?? '').trim();
  const profiles = readLevelTuningProfiles();
  if (levelKey && profiles[levelKey]) {
    delete profiles[levelKey];
    writeLevelTuningProfiles(profiles);
  }
  localStorage.removeItem(TUNING_STORAGE_KEY);
  localStorage.removeItem(INSTALL_THRESHOLD_CUSTOM_STORAGE_KEY);
}

function readLevelEditorPreviewDocument() {
  try {
    const source = localStorage.getItem(LEVEL_EDITOR_PREVIEW_STORAGE_KEY);
    const entry = source ? JSON.parse(source) : null;
    const document = entry?.format === LEVEL_EDITOR_PREVIEW_FORMAT ? entry.document : null;
    if (document?.format !== 'bus-loop-web-level-v1' || !/^level[1-9]\d*$/.test(document.key)) return null;
    return {
      document,
      mode: entry.mode === 'draft' ? 'draft' : 'saved',
      baseRevision: typeof entry.baseRevision === 'string' ? entry.baseRevision : null
    };
  } catch (error) {
    console.warn('Authored level preview could not be restored.', error);
    return null;
  }
}

function readBackgroundHorizonCache() {
  try {
    const parsed = JSON.parse(localStorage.getItem(BACKGROUND_HORIZON_CACHE_KEY) ?? '{}');
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function writeBackgroundHorizonCache(cache) {
  try {
    localStorage.setItem(BACKGROUND_HORIZON_CACHE_KEY, JSON.stringify(cache));
  } catch {
    // A blocked or full store only costs a re-measure next time.
  }
}

/**
 * Measure the selected background's ground line when no horizon is known for it.
 *
 * Backgrounds imported before horizon tracking shipped have no sidecar metadata,
 * and the built-in table only covers artwork that was measured at build time. So
 * the first time one of them is shown, decode it in the browser, measure it with
 * the same detector the importer uses, and store the result on the background
 * profile. Without this, every pre-existing custom background would keep the
 * unaligned plane and the "cars on the road" composition.
 */
async function ensureBackgroundHorizon({ onMeasured } = {}) {
  if (!EDITOR_ENABLED) return;
  const background = SCENE_TUNING.background;
  if (!background?.asset) return;
  if (resolveBackgroundHorizon(background.asset, background.horizon) != null) return;

  // `view` belongs to startRuntime(), so the caller supplies the re-layout. A
  // module-scope reference here would throw and be swallowed below, leaving the
  // stale composition in place — the exact bug this function exists to fix.
  const cache = readBackgroundHorizonCache();
  const cached = Number(cache[background.asset]);
  if (Number.isFinite(cached) && cached > 0 && cached < 1) {
    background.horizon = cached;
    onMeasured?.();
    return;
  }

  try {
    const response = await fetch(background.asset, { cache: 'force-cache' });
    if (!response.ok) return;
    const bitmap = await createImageBitmap(await response.blob());
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const context = canvas.getContext('2d');
    context.drawImage(bitmap, 0, 0);
    const pixels = context.getImageData(0, 0, bitmap.width, bitmap.height);
    const horizon = detectPlayfieldHorizon(pixels.data, { width: bitmap.width, height: bitmap.height });
    bitmap.close?.();
    if (horizon == null) return;
    // Cache even when the selection moved on: the measurement is per artwork.
    cache[background.asset] = horizon;
    writeBackgroundHorizonCache(cache);
    if (SCENE_TUNING.background.asset !== background.asset) return;
    SCENE_TUNING.background.horizon = horizon;
    saveTuning(SCENE_TUNING, { immediate: true });
    onMeasured?.();
  } catch {
    // An unreadable artwork keeps the plane where the tuning puts it.
  }
}

function getPlayableExportPayload() {
  const selectedKey = String(SCENE_TUNING.level?.selected ?? '');
  const previewEntry = readLevelEditorPreviewDocument();
  return {
    tuning: SCENE_TUNING,
    ...(previewEntry?.mode === 'draft' && previewEntry.document.key === selectedKey
      ? {
          levelDocument: previewEntry.document,
          levelDocumentBaseRevision: previewEntry.baseRevision
        }
      : {})
  };
}

function writeLevelEditorPreviewDocument(document, mode = 'saved', baseRevision = null) {
  localStorage.setItem(LEVEL_EDITOR_PREVIEW_STORAGE_KEY, JSON.stringify({
    format: LEVEL_EDITOR_PREVIEW_FORMAT,
    mode: mode === 'draft' ? 'draft' : 'saved',
    baseRevision: typeof baseRevision === 'string' ? baseRevision : null,
    document
  }));
}

async function readSavedWebLevelEntry(levelKey) {
  const response = await fetch(`/__level-authoring/${encodeURIComponent(levelKey)}`, { cache: 'no-store' });
  if (response.status === 404) return null;
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || `HTTP ${response.status}`);
  return {
    document: payload.document ?? null,
    revision: typeof payload.revision === 'string' ? payload.revision : null
  };
}

// Imported Unity levels are stored in the shared data volume. A prebuilt
// editor bundle cannot contain them in its catalog, so fetch the runtime
// definition from the level service when the bundled catalog has no match.
async function readImportedUnityLevelDefinition(levelKey) {
  const response = await fetch(`/__unity-levels/${encodeURIComponent(levelKey)}`, { cache: 'no-store' });
  if (response.status === 404) return null;
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || `HTTP ${response.status}`);
  return payload.level ?? null;
}

async function resolveSelectedLevel(levelKey, getLevelDefinition) {
  const catalogLevel = getLevelDefinition(levelKey);
  const savedEntry = await readSavedWebLevelEntry(levelKey);
  if (!savedEntry?.document) {
    if (catalogLevel?.key !== levelKey) {
      const importedLevel = await readImportedUnityLevelDefinition(levelKey).catch(() => null);
      if (importedLevel) return { level: importedLevel, savedEntry: null, exact: true };
    }
    return {
      level: catalogLevel,
      savedEntry: null,
      exact: catalogLevel?.key === levelKey
    };
  }
  const { levelDocumentToRuntime } = await import('./level-editor-model.js');
  return {
    level: levelDocumentToRuntime(savedEntry.document, catalogLevel),
    savedEntry,
    exact: true
  };
}

async function readLevelEditorBase(levelKey, getLevelDefinition) {
  const resolved = await resolveSelectedLevel(levelKey, getLevelDefinition);
  if (resolved.exact) return resolved;
  throw new Error(`未找到当前关卡 ${levelKey} 的可编辑文件，请重新选择关卡。`);
}

async function startRuntime() {
  // Exported builds drop the editor branch entirely, so the fallback refresh has to run
  // outside it or the baked branding variant never reaches the store link fallback.
  refreshDefaultStoreLinks();
  if (EDITOR_ENABLED) {
    loadSavedTuning();
    for (const key of LEGACY_LEVEL_EDITOR_PREVIEW_STORAGE_KEYS) localStorage.removeItem(key);
  }
  let revealPlayable = () => {};
  // A session can opt out of the pre-roll. A progressive flow already has an
  // opening banner and a guide, and the video only delays the first tap.
  if (ACTIVE_PLAYABLE_SESSION?.preRollEnabled === false) {
    SCENE_TUNING.preRoll.enabled = 0;
  }
  if (preRollOverlay && preRollVideo) {
    preRollController?.destroy();
    preRollController = createPreRollController({
      root: preRollOverlay,
      video: preRollVideo,
      onReveal: () => revealPlayable()
    });
    void preRollController.play(SCENE_TUNING.preRoll);
  }
  let sessionLevels = PLAYABLE_LEVEL_SEQUENCE;
  // Stage descriptors stay index-aligned with sessionLevels so the runner can
  // read the current stage's opening presentation without a second cursor.
  let sessionStages = PLAYABLE_STAGES.map((stage) => ({
    id: stage.id,
    levelKey: stage.level.key,
    scene: stage.scene ?? {},
    opening: stage.opening,
    labels: stage.labels
  }));
  if (EDITOR_ENABLED) {
    const { getLevelDefinition } = await import('./level-catalog.js');
    await refreshSpatialConveyorPackages().catch((error) => {
      console.warn('Spatial conveyor packages could not be loaded.', error);
    });
    const selectedKey = SCENE_TUNING.level?.selected;
    const resolvedLevel = await resolveSelectedLevel(selectedKey, getLevelDefinition);
    let selectedLevel = resolvedLevel.level;
    const previewEntry = readLevelEditorPreviewDocument();
    const savedEntry = resolvedLevel.savedEntry;
    const savedRevision = savedEntry?.revision ?? null;
    const useDraft = previewEntry?.mode === 'draft'
      && previewEntry.document.key === selectedKey
      && previewEntry.baseRevision === savedRevision;
    const previewDocument = useDraft ? previewEntry.document : savedEntry?.document;
    if (!useDraft) localStorage.removeItem(LEVEL_EDITOR_PREVIEW_STORAGE_KEY);
    if (useDraft && previewDocument) {
      const { levelDocumentToRuntime } = await import('./level-editor-model.js');
      selectedLevel = levelDocumentToRuntime(previewDocument, selectedLevel);
    }
    if (localStorage.getItem(INSTALL_THRESHOLD_CUSTOM_STORAGE_KEY) !== '1') {
      const vehicleCount = Math.max(1, selectedLevel.vehicles?.length ?? 0);
      SCENE_TUNING.installGate.successfulOperationThreshold = vehicleCount;
      DEFAULT_SCENE_TUNING.installGate.successfulOperationThreshold = vehicleCount;
      saveTuning(SCENE_TUNING, { immediate: true });
    }
    if (previewDocument && SCENE_TUNING.level?.selected !== previewDocument.key) {
      SCENE_TUNING.level.selected = previewDocument.key;
      saveTuning(SCENE_TUNING, { immediate: true });
    }
    sessionLevels = selectedLevel.key === 'level9'
      ? [selectedLevel, getLevelDefinition('level7')]
      : [selectedLevel];
    // Editor preview always runs one stage with no baked session presentation.
    sessionStages = sessionLevels.map((level) => ({
      id: level.key,
      levelKey: level.key,
      scene: {},
      opening: {},
      labels: []
    }));
  }
  // A stage may hand off to a fixed next stage or to a map picker. The picker
  // options are full stages, so they are carried alongside sessionStages and
  // only join the play order once the player actually picks one. The editor
  // preview never runs a baked picker: it always shows the selected level.
  const sessionChoices = EDITOR_ENABLED
    ? sessionStages.map(() => null)
    : PLAYABLE_STAGE_CHOICES.map((choice) => choice ?? null);
  const choiceOptionLevels = sessionChoices.flatMap((choice) => (
    (choice?.options ?? []).map((option) => option.level)
  ));
  // Mechanism art and audio have to be ready before the first frame, and a
  // choice map can be picked mid-ad, so they are collected up front.
  const allSessionLevels = [...sessionLevels, ...choiceOptionLevels];
  const levelSession = createLevelSession(sessionLevels, {
    choices: sessionChoices.map((choice) => choice?.options ?? null)
  });
  // Captured before any pick appends a map, so a retry can drop the picked one
  // even in the editor preview, where the baked order is not the active one.
  const initialSessionLevels = sessionLevels.slice();
  const initialSessionStages = sessionStages.slice();
  // A multi-stage session counts every vehicle of every stage against one
  // shared gate. The baked value targets a single level, so a 2-stage flow
  // would open the store half way through the second stage and swallow clicks.
  // A choice session is counted after the pick, because only four of the five
  // authored maps are ever played and the fifth would inflate the gate.
  if (!EDITOR_ENABLED && sessionLevels.length > 1 && !sessionChoices.some(Boolean)) {
    const sessionVehicleCount = sessionLevels.reduce(
      (total, level) => total + Math.max(0, level.vehicles?.length ?? 0),
      0
    );
    if (sessionVehicleCount > 0) {
      SCENE_TUNING.installGate.successfulOperationThreshold = sessionVehicleCount;
    }
  }
  const initialInstallThreshold = SCENE_TUNING.installGate.successfulOperationThreshold;
  const currentStage = () => sessionStages[levelSession.state().levelIndex] ?? null;
  // The scene's belt and background are module-level read points, so the stage
  // must be applied before the first SceneView is constructed.
  setActiveStageScene(currentStage()?.scene ?? null);
  setActiveLevel(levelSession.currentLevel());
  applyPreviewFrame();

  let game = new BusLoopGame(levelSession.currentLevel());
  const mechanismTypes = getMechanismTypesForLevels(allSessionLevels);
  audio = createGameAudioController({
    // Merged from every level the session can reach, then completed from the
    // canonical sound table: the audio events are wired in code, so a packaged
    // build must never depend on the catalog on disk having listed a sound.
    // A level that does carry the sound keeps its own clips and balance.
    ...resolveLevelAudioConfig(
      Object.assign({}, ...allSessionLevels.map((level) => level.assets?.audio ?? {}))
    ),
    ...getMechanismAudioConfig(mechanismTypes)
  }, {
    // Per-sound delay so a hit or departure sound can be lined up with its
    // animation; the values live in the editor's sound-delay fields.
    getDelay: (name) => {
      const tuning = SCENE_TUNING.audio ?? {};
      if (name === 'bus_hit') return tuning.busHitDelay ?? 0;
      if (name === 'bus_full') return tuning.busFullDelay ?? 0;
      if (name === 'passenger_up') return tuning.passengerUpDelay ?? 0;
      if (name === 'vehicle_tap') return tuning.vehicleTapDelay ?? 0;
      return 0;
    },
    // Volume multipliers from the editor. 1 keeps the level's authored volume,
    // so these sliders only ever scale relative loudness.
    getVolumeScale: (name) => {
      const tuning = SCENE_TUNING.audio ?? {};
      if (name === 'vehicle_tap') {
        const scale = Number(tuning.vehicleTapVolume);
        return Number.isFinite(scale) ? Math.max(0, scale) : 1;
      }
      return 1;
    }
  });
  audio.resetEventHistory();
  const endPanel = $('#end-panel');
  let pressTimer = 0;
  let pressed = false;
  let gameOverActive = false;
  let spatialEditorActive = false;
  let spatialPointEditor = null;
  let levelLayoutEditor = null;
  let unsubscribeGame = () => {};
  // A stage win waits out the last departure animation, then swaps levels. The
  // flag stops the still-running game loop from scheduling a second swap.
  let stageAdvancePending = false;
  let stageChoiceVisible = false;
  const gameOverTimers = new Set();
  const INSTALL_GATE_VEHICLE_STATES = new Set(['at-spot', 'boarding-final', 'departing', 'done']);

  function updateLoadingProgress(progress) {
    const percent = Math.max(0, Math.min(100, Math.round((Number(progress) || 0) * 100)));
    if (loadingProgressBar) loadingProgressBar.style.width = `${percent}%`;
    if (loadingProgressValue) loadingProgressValue.textContent = `${percent}%`;
    loadingProgress?.setAttribute('aria-valuenow', String(percent));
  }

  updateLoadingProgress(0);
  const markInstallVehicle = (vehicleId) => {
    const threshold = Math.max(1, getSuccessfulOperationThreshold());
    const ready = levelSession.recordSuccessfulVehicle(vehicleId, threshold);
    const { successfulOperationCount } = levelSession.state();
    platformBridge?.challengeProgress?.((successfulOperationCount / threshold) * 100);
    if (ready) platformBridge?.challengeSolved?.();
    return ready;
  };

  let view;
  // Background music starts on the first successful vehicle tap, not on load:
  // autoplay before a gesture is blocked by every ad platform's browser, and a
  // silent ad is safer than a rejected one. Once started it keeps looping across
  // retries and stage handoffs, so this only ever fires the first time.
  function startBackgroundMusic() {
    const bgm = SCENE_TUNING.audio?.bgm;
    if (!Number(bgm?.enabled)) return;
    if (!audio?.playBgm) return;
    if (audio.isBgmPlaying) return;
    audio.unlock();
    audio.playBgm({
      asset: bgm.asset,
      volume: bgm.volume,
      fadeInSeconds: bgm.fadeInSeconds
    });
  }

  const handleVehicleClick = (vehicleId) => {
    // During the opening guide only the spotlighted car is playable. Locking
    // every car made the highlighted one look broken: the hint said "tap this",
    // and the tap was refused.
    if (view?.isVehicleInputLocked?.() && !view.isFirstClickGuideTarget?.(vehicleId)) {
      return { ok: false, reason: 'opening-guide' };
    }
    view?.recordGuideInteraction();
    const result = game.clickVehicle(vehicleId);
    if (result?.ok) {
      startBackgroundMusic();
      if (markInstallVehicle(vehicleId)) InstallFullGame();
    }
    return result;
  };

  try {
    view = new SceneView(
      canvas,
      handleVehicleClick,
      {
        onPassengerAboard: () => audio.playPassengerUp(),
        onLoadingProgress: updateLoadingProgress
      }
    );
  } catch (error) {
    if (!EDITOR_ENABLED) throw error;
    console.warn('WebGL 场景初始化失败，已切换到仅编辑器模式。', error);
    view = createEditorFallbackView(levelSession.currentLevel(), error);
  }
  view.setStageOpening?.(currentStage()?.opening ?? null, currentStage()?.labels ?? []);
  // A background imported before horizon tracking has no measured ground line,
  // which would render with the cars sitting on the road. Measure it once, in the
  // background, and re-lay-out when it lands.
  void ensureBackgroundHorizon({ onMeasured: () => view?.resize?.() });
  // The speed button scales the simulation clock, so every system (vehicle
  // routes, boarding, collisions, conveyor) keeps its relative pace. The
  // long-press boost stays a separate belt-only multiplier, exactly as before.
  let speedToggleBoosted = false;
  const updateCtaPosition = () => {
    view.resize();
    applyGameOverTuning();
    applyCtaTuning();
    applySpeedToggleTuning();
    applyBrandingTuning(view.getBackgroundCanvasBounds());
    if (stageChoiceVisible) positionStageChoiceHand();
  };
  const getCameraPreset = (action) => {
    if (action === 'default') return structuredClone(DEFAULT_SCENE_TUNING.camera);
    const scope = action === 'vehicles' || action === 'conveyor' ? action : 'all';
    const bounds = view.getCameraContentBounds?.({ scope });
    if (!bounds) return null;
    return {
      ...SCENE_TUNING.camera,
      ...calculateAutoCameraFit({
        bounds,
        camera: SCENE_TUNING.camera,
        margin: scope === 'vehicles' ? 0.85 : 0.7
      })
    };
  };
  updateCtaPosition();
  if (__PLAYABLE_PLATFORM__ !== 'mintegral' && 'ResizeObserver' in window && stage) {
    new ResizeObserver(updateCtaPosition).observe(stage);
  } else {
    window.addEventListener('resize', updateCtaPosition);
  }
  view.ready?.finally(() => {
    updateLoadingProgress(1);
    loadingScreen?.classList.add('is-hidden');
    window.setTimeout(() => loadingScreen?.remove(), 360);
    revealPlayable = () => view.showEntryBanner?.();
    if (preRollController) preRollController.setGameReady();
    else revealPlayable();
    platformBridge?.ready();
  });
  function initializeGameQueues({ resetSlots = false } = {}) {
    game.initializeQueues(
      view.getQueueCapacities(),
      view.getQueueSpacing(),
      view.getQueueLengths(),
      view.getConveyorPathLength(),
      { ...view.getConveyorConfig(), resetSlots }
    );
  }
  // The speed button scales the simulation clock, so every system (vehicle
  // routes, boarding, collisions, conveyor) keeps its relative pace.
  function getSpeedToggleMultiplier() {
    const configured = Number(SCENE_TUNING.speedToggle?.multiplier);
    return normalizeSpeedMultiplier(configured, 2);
  }
  function applySpeedToggleTuning() {
    if (!speedToggleButton) return;
    const config = SCENE_TUNING.speedToggle ?? {};
    const metrics = getBrandingStageMetrics();
    const uiScale = metrics.uiScale;
    const enabled = Boolean(config.enabled ?? 0);
    const width = Math.max(1, Number(config.width) || 105);
    const height = Math.max(1, Number(config.height) || 69);
    const renderedWidth = width * uiScale;
    const renderedHeight = height * uiScale;
    const centerX = Number.isFinite(Number(config.x)) ? Number(config.x) : metrics.designWidth * 0.84;
    const centerY = Number.isFinite(Number(config.y)) ? Number(config.y) : metrics.designHeight * 0.14;
    speedToggleButton.hidden = !enabled;
    speedToggleButton.style.setProperty('--speed-toggle-width', scaledPx(width, uiScale));
    speedToggleButton.style.setProperty('--speed-toggle-height', scaledPx(height, uiScale));
    speedToggleButton.style.setProperty('--speed-toggle-gap', scaledPx(Math.max(2, width * 0.05), uiScale));
    speedToggleButton.style.setProperty('--speed-toggle-icon-width', scaledPx(Math.max(6, height * 0.38), uiScale));
    speedToggleButton.style.setProperty('--speed-toggle-icon-height', scaledPx(Math.max(6, height * 0.52), uiScale));
    speedToggleButton.style.setProperty(
      '--speed-toggle-font-size',
      scaledPx(Math.max(6, height * 0.42), uiScale)
    );
    speedToggleButton.style.left = `${clampConfigNumber(
      centerX * metrics.positionScaleX,
      renderedWidth / 2,
      metrics.stageWidth - renderedWidth / 2,
      metrics.stageWidth * 0.84
    )}px`;
    speedToggleButton.style.top = `${clampConfigNumber(
      centerY * metrics.positionScaleY,
      renderedHeight / 2,
      metrics.stageHeight - renderedHeight / 2,
      metrics.stageHeight * 0.14
    )}px`;
    if (!enabled) speedToggleBoosted = false;
    syncSpeedToggleUi();
  }
  function syncSpeedToggleUi() {
    if (!speedToggleButton) return;
    const multiplier = speedToggleBoosted ? getSpeedToggleMultiplier() : 1;
    speedToggleButton.setAttribute('aria-pressed', String(speedToggleBoosted));
    speedToggleButton.setAttribute('aria-label', `Playback speed ${formatSpeedLabel(multiplier)}`);
    if (speedToggleLabel) speedToggleLabel.textContent = formatSpeedLabel(multiplier);
    if (speedToggleIcon) {
      speedToggleIcon.src = speedToggleBoosted
        ? '/assets/applovin/speed-toggle-icon-boost.png'
        : '/assets/applovin/speed-toggle-icon-normal.png';
    }
  }
  function setSpeedToggleBoosted(boosted) {
    const enabled = Boolean(SCENE_TUNING.speedToggle?.enabled ?? 1);
    speedToggleBoosted = enabled && Boolean(boosted);
    syncSpeedToggleUi();
  }
  function getTimeScale() {
    return resolveTimeScale({ multiplier: getSpeedToggleMultiplier(), boosted: speedToggleBoosted });
  }
  function getIdleSpeedMultiplier() {
    if (!isSpatialConveyorSelection(SCENE_TUNING.conveyorLayout?.selected)) return 1;
    const configuredMultiplier = Number(SCENE_TUNING.spatialConveyor?.normalSpeedMultiplier);
    return Number.isFinite(configuredMultiplier) ? Math.max(0.1, configuredMultiplier) : 1;
  }
  function isSpatialOptimizationEnabled(key) {
    const optimizations = SCENE_TUNING.spatialConveyor?.optimizations;
    return Boolean(
      isSpatialConveyorSelection(SCENE_TUNING.conveyorLayout?.selected)
      && optimizations?.enabled
      && optimizations?.[key]
    );
  }
  function applyIdleSpeedMultiplier() {
    game.setSpeedMultiplier(getIdleSpeedMultiplier());
  }
  initializeGameQueues();
  applyIdleSpeedMultiplier();
  let editor = { sync: () => {} };

  async function openSpatialPointEditor() {
    if (spatialEditorActive) return;
    const selected = SCENE_TUNING.conveyorLayout?.selected;
    if (!isSpatialConveyorSelection(selected)) {
      throw new Error('\u53ea\u6709\u7acb\u4f53\u8f68\u9053\u53ef\u4ee5\u7f16\u8f91\u70b9\u4f4d');
    }
    const packageId = getSpatialConveyorId(selected);
    const response = await fetch(`/__spatial-conveyors/package/${encodeURIComponent(packageId)}`, {
      cache: 'no-store'
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || `HTTP ${response.status}`);
    registerSpatialConveyorPackage(payload.packageData);
    view.refreshSpatialConveyorDraft();
    spatialEditorActive = true;
    pressed = false;
    clearTimeout(pressTimer);
    sceneEditorRoot?.classList.add('is-spatial-point-editing');
    view.resize();
    try {
      const { createSpatialConveyorEditor } = await import('./spatial-conveyor-editor.js');
      spatialPointEditor = createSpatialConveyorEditor({
        view,
        packageData: payload.packageData,
        displayTuning: SCENE_TUNING.spatialConveyor,
        baseRevision: payload.revision,
        onSaved: async ({ packageData, isClone }) => {
          await editor.refreshSpatialConveyorOptions?.();
          if (isClone) {
            const next = structuredClone(SCENE_TUNING);
            next.conveyorLayout.selected = `spatial:${packageData.id}`;
            applyTuningPatch(next, { path: 'conveyorLayout.selected', syncEditor: true });
          }
        },
        onClose: () => {
          spatialPointEditor = null;
          spatialEditorActive = false;
          sceneEditorRoot?.classList.remove('is-spatial-point-editing');
          view.resize();
          game.reset();
          initializeGameQueues({ resetSlots: true });
          applyIdleSpeedMultiplier();
          view.setInputEnabled(true);
        }
      });
    } catch (error) {
      spatialEditorActive = false;
      sceneEditorRoot?.classList.remove('is-spatial-point-editing');
      view.resize();
      view.setInputEnabled(true);
      throw error;
    }
  }

  async function openLevelLayoutEditor() {
    if (levelLayoutEditor) return;
    pressed = false;
    clearTimeout(pressTimer);
    view.setInputEnabled(false);
    sceneEditorRoot?.classList.add('is-level-layout-editing');
    try {
      const [{ createLevelLayoutEditor }, { getLevelDefinition }] = await Promise.all([
        import('./level-layout-editor.js'),
        import('./level-catalog.js')
      ]);
      const selectedKey = SCENE_TUNING.level?.selected;
      const resolvedLevel = await readLevelEditorBase(selectedKey, getLevelDefinition);
      let baseLevel = resolvedLevel.level;
      const previewEntry = readLevelEditorPreviewDocument();
      const savedRevision = resolvedLevel.savedEntry?.revision ?? null;
      const previewDocument = previewEntry?.mode === 'draft'
        && previewEntry.document.key === selectedKey
        && previewEntry.baseRevision === savedRevision
        ? previewEntry.document
        : null;
      if (previewDocument) {
        const { levelDocumentToRuntime } = await import('./level-editor-model.js');
        baseLevel = levelDocumentToRuntime(previewDocument, baseLevel);
      }
      levelLayoutEditor = await createLevelLayoutEditor({
        baseLevel,
        initialDocument: previewDocument,
        initialRevision: previewDocument ? previewEntry.baseRevision : null,
        onPreview: () => window.location.reload(),
        // Vehicle ids are rewritten whenever a delete compacts the numbering.
        // The opening guides name a car by number, and that number lives in the
        // live scene tuning rather than in the level document, so move the guide
        // target with the car and persist it for the current profile.
        onVehiclesRenumbered: ({ idMap, document }) => {
          const levelKey = String(document?.key ?? '');
          let changed = false;
          for (const guide of [SCENE_TUNING.vehicleGuideHand, SCENE_TUNING.firstClickGuide]) {
            if (!guide) continue;
            if (guide.levelKey && levelKey && guide.levelKey !== levelKey) continue;
            const mapped = idMap.get(Number(guide.vehicleId));
            if (mapped == null || mapped === Number(guide.vehicleId)) continue;
            guide.vehicleId = mapped;
            changed = true;
          }
          if (changed) saveTuning(SCENE_TUNING, { immediate: true });
        },
        onClose: () => {
          levelLayoutEditor = null;
          sceneEditorRoot?.classList.remove('is-level-layout-editing');
          view.setInputEnabled(true);
          view.resize();
        }
      });
    } catch (error) {
      sceneEditorRoot?.classList.remove('is-level-layout-editing');
      view.setInputEnabled(true);
      throw error;
    }
  }

  function applyTuningPatch(next, { path, syncEditor = false } = {}) {
    if (path === 'level.selected') {
      void (async () => {
        try {
          const selectedLevelKey = next.level.selected;
          const webEntry = await readSavedWebLevelEntry(selectedLevelKey);
          if (webEntry?.document) {
            writeLevelEditorPreviewDocument(webEntry.document, 'saved', webEntry.revision);
          } else {
            const response = await fetch('/__playable-level', {
              method: 'POST',
              headers: { 'Content-Type': 'text/plain' },
              body: selectedLevelKey
            });
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            localStorage.removeItem(LEVEL_EDITOR_PREVIEW_STORAGE_KEY);
          }
          activateLevelTuning(selectedLevelKey);
          window.location.reload();
        } catch (error) {
          console.warn('Could not load the selected playable level.', error);
          editor.sync();
        }
      })();
      return next;
    }
    if (path?.startsWith('storeLinks.')) {
      const platform = path.slice('storeLinks.'.length);
      if (!isValidStoreLink(platform, next.storeLinks?.[platform])) {
        if (syncEditor) editor.sync();
        return SCENE_TUNING;
      }
      deepMerge(SCENE_TUNING.storeLinks, next.storeLinks);
      saveTuning(SCENE_TUNING);
      if (syncEditor) editor.sync();
      return SCENE_TUNING;
    }
    if (path === 'installGate.successfulOperationThreshold') {
      setLevelInstallThresholdCustom(SCENE_TUNING.level?.selected, true);
    }
    if (path?.startsWith('branding.')) {
      deepMerge(SCENE_TUNING, next);
      applyBrandingTuning(view.getBackgroundCanvasBounds());
      saveTuning(SCENE_TUNING);
      if (syncEditor) editor.sync();
      return SCENE_TUNING;
    }
    if (path?.startsWith('speedToggle.')) {
      deepMerge(SCENE_TUNING, next);
      applySpeedToggleTuning();
      // A multiplier change has to reach the running game even while the button
      // is off, because the next toggle-on has to use the new value.
      applyIdleSpeedMultiplier();
      saveTuning(SCENE_TUNING);
      if (syncEditor) editor.sync();
      return SCENE_TUNING;
    }
    const materialOnly = isPassengerMaterialTuningPath(path);
    const restartOpeningGuide = path?.startsWith('firstClickGuide.')
      && Boolean(Number(next.firstClickGuide?.enabled));
    const restartEntryBanner = path?.startsWith('entryBanner.')
      && Boolean(Number(next.entryBanner?.enabled));
    const restartPreRoll = path?.startsWith('preRoll.');
    const restartVehicleGuide = path?.startsWith('vehicleGuideHand.');
    const conveyorStructureChanged = !materialOnly && (
      path === 'conveyorLayout.selected'
      || path === 'spatialConveyor.capacity'
      || path === 'spatialConveyor.startFilled'
    );
    const colorIndex = getPassengerMaterialColorIndex(path);
    const tuning = view.setTuning(next, { mode: materialOnly ? 'passengerMaterial' : 'full', colorIndex });
    if (!materialOnly) {
      if (conveyorStructureChanged) game.reset();
      initializeGameQueues({ resetSlots: conveyorStructureChanged });
      if (!pressed && (
        conveyorStructureChanged
        || path === 'spatialConveyor.normalSpeedMultiplier'
      )) applyIdleSpeedMultiplier();
      applyPreviewFrame();
      updateCtaPosition();
    }
    saveTuning(tuning, { immediate: conveyorStructureChanged });
    // Selecting artwork that has never been measured leaves the plane where the
    // tuning puts it, which is what made a new background look misplaced. Measure
    // it now; the layout is re-applied as soon as the result lands.
    if (path === 'background.asset') void ensureBackgroundHorizon({ onMeasured: () => view?.resize?.() });
    if (restartOpeningGuide) reset();
    if (restartEntryBanner) view.showEntryBanner?.();
    if (restartPreRoll) void preRollController?.play(tuning.preRoll);
    if (restartVehicleGuide) view.resetGuideHandActivity();
    if (syncEditor) editor.sync();
    return tuning;
  }

  if (EDITOR_ENABLED) {
    for (const [key, element] of Object.entries(brandingItems)) {
      bindBrandingDrag(element, key, (x, y) => {
        const next = structuredClone(SCENE_TUNING);
        next.branding[key].x = Math.round(x);
        next.branding[key].y = Math.round(y);
        applyTuningPatch(next, { path: `branding.${key}.position`, syncEditor: true });
      });
    }
  }

  async function capturePlayableScreenshot({ width = 720, height = 1280 } = {}) {
    const captureWidth = Math.max(1, Math.round(Number(width) || 720));
    const captureHeight = Math.max(1, Math.round(Number(height) || 1280));
    await view.ready;
    const baseBlob = await view.captureFrame({ width: captureWidth, height: captureHeight });
    const imageBlob = await composeScreenshotBlob(baseBlob, {
      width: captureWidth,
      height: captureHeight
    });
    const selectedLevel = String(SCENE_TUNING.level?.selected ?? 'level');
    const filename = `bus-loop-${selectedLevel}-${captureWidth}x${captureHeight}.png`;
    downloadBlob(filename, imageBlob);
    return { filename, width: captureWidth, height: captureHeight };
  }

  if (EDITOR_ENABLED && sceneEditorRoot) {
    // The build stamp belongs to exported packages only, where it identifies a
    // file that gets handed around. The editor is a live page with its own
    // version label in the header, so the corner stays empty there.
    import('./scene-editor.js').then(({ createSceneEditor }) => {
      editor = createSceneEditor(sceneEditorRoot, {
        getTuning: () => SCENE_TUNING,
        defaultTuning: DEFAULT_SCENE_TUNING,
        setTuning: applyTuningPatch,
        getPlayableExportPayload,
        clearSavedTuning,
        saveImportedLevelTuning,
        captureScreenshot: capturePlayableScreenshot,
        previewPreRoll: () => preRollController?.play(SCENE_TUNING.preRoll),
        openSpatialPointEditor,
        openLevelLayoutEditor,
        getCameraPreset
      });
    }).catch((error) => {
      console.warn('Scene editor could not be loaded.', error);
    });
  } else {
    sceneEditorRoot?.remove();
  }

  // The picker is authored data: the session names four maps, and this only
  // lays them out and reports which one was tapped. The preview art comes from
  // the exported asset bundle so the same page renders offline.
  function buildStageChoice(choice) {
    if (!stageChoiceOverlay || !stageChoiceGrid) return;
    stageChoiceGrid.replaceChildren();
    for (const [index, option] of choice.options.entries()) {
      const card = document.createElement('button');
      card.type = 'button';
      card.className = 'stage-choice-card';
      card.dataset.levelKey = option.levelKey;
      card.setAttribute('aria-label', option.label);
      const thumb = document.createElement('img');
      thumb.className = 'stage-choice-thumb';
      thumb.src = option.image;
      thumb.alt = option.label;
      thumb.draggable = false;
      card.append(thumb);
      card.addEventListener('click', (event) => {
        event.stopPropagation();
        chooseStage(index);
      });
      stageChoiceGrid.append(card);
    }
    if (stageChoiceTitle) stageChoiceTitle.textContent = choice.title;
    stageChoiceOverlay.dataset.handIndex = String(choice.handIndex ?? -1);
  }

  function positionStageChoiceHand() {
    if (!stageChoiceHand || !stageChoiceGrid || !stageChoiceOverlay) return;
    const handIndex = Number(stageChoiceOverlay.dataset.handIndex ?? -1);
    const card = stageChoiceGrid.children[handIndex];
    if (!Number.isInteger(handIndex) || handIndex < 0 || !card) {
      stageChoiceHand.hidden = true;
      return;
    }
    // The hand is absolutely positioned inside the overlay, so every offset has
    // to be measured against the overlay rather than against the grid.
    const overlayRect = stageChoiceOverlay.getBoundingClientRect();
    const cardRect = card.getBoundingClientRect();
    if (cardRect.width <= 0) {
      stageChoiceHand.hidden = true;
      return;
    }
    // Aim the fingertip (about 72%/18% into the sprite) at the middle of the
    // card's vehicle field, the part the player is being asked to recognise.
    const width = cardRect.width * 0.46;
    const height = width * (194 / 188);
    const tipX = cardRect.left - overlayRect.left + cardRect.width * 0.2;
    const tipY = cardRect.top - overlayRect.top + cardRect.height * 0.56;
    stageChoiceHand.style.width = `${Math.round(width)}px`;
    stageChoiceHand.style.left = `${Math.round(tipX - width * 0.72)}px`;
    stageChoiceHand.style.top = `${Math.round(tipY - height * 0.18)}px`;
    stageChoiceHand.hidden = false;
  }

  function showStageChoice(choice) {
    if (!stageChoiceOverlay || !choice) return;
    stageChoiceVisible = true;
    stageChoiceActive = true;
    endPanel.hidden = true;
    buildStageChoice(choice);
    stageChoiceOverlay.hidden = false;
    stageChoiceOverlay.classList.remove('is-active');
    void stageChoiceOverlay.offsetWidth;
    stageChoiceOverlay.classList.add('is-active');
    applyCtaTuning();
    positionStageChoiceHand();
    window.requestAnimationFrame(positionStageChoiceHand);
  }

  function hideStageChoice() {
    stageChoiceVisible = false;
    stageChoiceActive = false;
    stageChoiceOverlay?.classList.remove('is-active');
    if (stageChoiceOverlay) stageChoiceOverlay.hidden = true;
    if (stageChoiceHand) stageChoiceHand.hidden = true;
    applyCtaTuning();
  }

  function chooseStage(optionIndex) {
    const choice = sessionChoices[levelSession.state().levelIndex];
    const option = choice?.options?.[optionIndex];
    if (!option) return;
    // The session appends the picked map, so it has to succeed before the stage
    // lists are extended; otherwise a refused pick leaves a phantom stage.
    const nextLevel = levelSession.choose(option.id);
    if (!nextLevel) return;
    hideStageChoice();
    sessionStages.push({
      id: option.id,
      levelKey: option.levelKey,
      scene: option.scene ?? {},
      opening: option.opening,
      labels: option.labels
    });
    sessionLevels = [...sessionLevels, option.level];
    const vehicles = sessionLevels.reduce(
      (total, level) => total + Math.max(0, level.vehicles?.length ?? 0),
      0
    );
    if (vehicles > 0) SCENE_TUNING.installGate.successfulOperationThreshold = vehicles;
    const stage = currentStage();
    setActiveStageScene(stage?.scene ?? null);
    view.setStageOpening?.(stage?.opening ?? null, stage?.labels ?? []);
    advanceToLevel(nextLevel);
    if (stage?.opening?.entryBanner?.enabled) view.showEntryBanner?.();
  }

  // A step-limited centre-rescue ad spends its moves as the ad's ending: the
  // heart counts down from 35, and the 35th successful dispatch is also the
  // install-gate threshold, so that same tap opens the store. Without this the
  // model would also draw a failure card underneath the jump.
  //
  // Only a step-limited non-ambulance vehicle (the Christmas sled) ends this
  // way, and only when the budget is what the store gate counts. An authentic
  // ambulance level keeps its failure card: there the limit punishes wrong
  // taps, it is not the ad's scripted ending.
  function stepLimitedSledJumpOwnsEnding(state) {
    if (state.lastEvent?.reason !== 'ambulance-exceed-step') return false;
    const stepLimit = (state.vehicles ?? []).reduce((highest, vehicle) => (
      Number.isInteger(vehicle.ambulanceStepLimit)
      && vehicle.mechanism?.type
      && vehicle.mechanism.type !== 'ambulance'
        ? Math.max(highest, vehicle.ambulanceStepLimit)
        : highest
    ), 0);
    return stepLimit > 0 && getSuccessfulOperationThreshold() === stepLimit;
  }

  function syncHud(state) {
    // Play every sound-relevant event of the frame, not just the last one: a
    // frame can both depart a vehicle and board a group, and lastEvent would
    // have dropped the earlier sound. The final lastEvent is played as well so
    // merge-attached fields (garage release, turn, ambulance) still sound; the
    // controller de-duplicates keys shared with the frame list.
    for (const event of state.frameAudioEvents ?? []) audio.handleGameEvent(event, state.time);
    audio.handleGameEvent(state.lastEvent, state.time);
    updateInstallGate(state);
    if (state.status === 'lost') {
      endPanel.hidden = true;
      // The click that consumed the last move already fired the install gate;
      // drawing a failure card on top of the store jump would contradict it.
      if (stepLimitedSledJumpOwnsEnding(state)) return;
      showResultOverlay(state.lastEvent.reason === 'ambulance-exceed-step' ? 'Ambulance Failed' : 'Game Over');
      return;
    }
    if (state.status === 'won') {
      endPanel.hidden = true;
      // The won game keeps emitting state while the picker is open, so the
      // picker itself has to short-circuit the schedule or it would reopen.
      if (stageAdvancePending || stageChoiceVisible) return;
      const hasNextStage = levelSession.state().levelIndex + 1 < levelSession.levelCount();
      if (hasNextStage) {
        stageAdvancePending = true;
        // Let the last departure animation finish before the stage swap; the
        // next stage's opening banner then covers the rebuild.
        queueGameOverTimer(advanceToNextStage, STAGE_ADVANCE_DELAY_MS);
        return;
      }
      const choice = sessionChoices[levelSession.state().levelIndex];
      if (choice) {
        // A picker replaces the win screen: the ad continues with whichever
        // map the player taps, so the challenge must not be reported solved yet.
        // advanceAfterWin() is what parks the session on the pending choice.
        stageAdvancePending = true;
        queueGameOverTimer(() => {
          stageAdvancePending = false;
          levelSession.advanceAfterWin();
          showStageChoice(choice);
        }, STAGE_ADVANCE_DELAY_MS);
        return;
      }
      platformBridge?.challengeSolved?.();
      showResultOverlay('You Win!', { failed: false });
    }
  }

  function advanceToLevel(nextLevel) {
    unsubscribeGame();
    setActiveLevel(nextLevel);
    game = new BusLoopGame(nextLevel);
    audio.resetEventHistory();
    view.replaceActiveLevel({ animate: true });
    initializeGameQueues({ resetSlots: true });
    applyIdleSpeedMultiplier();
    unsubscribeGame = game.subscribe(syncHud);
  }

  function advanceToNextStage() {
    // A reset or a second win callback can leave a queued timer behind; only
    // the pending swap is allowed to run.
    if (!stageAdvancePending) return;
    const nextLevel = levelSession.advanceAfterWin();
    stageAdvancePending = false;
    if (!nextLevel) return;
    const stage = currentStage();
    // Apply the stage presentation before replaceActiveLevel: that call runs
    // applyTuning, which re-reads the stage override for the belt, background,
    // guide, and banner.
    setActiveStageScene(stage?.scene ?? null);
    view.setStageOpening?.(stage?.opening ?? null, stage?.labels ?? []);
    advanceToLevel(nextLevel);
    if (stage?.opening?.entryBanner?.enabled) view.showEntryBanner?.();
  }

  function updateInstallGate(state) {
    for (const vehicle of state.vehicles ?? []) {
      if (
        vehicle.spotIndex == null ||
        !INSTALL_GATE_VEHICLE_STATES.has(vehicle.state) ||
        levelSession.hasCountedVehicle(vehicle.id)
      ) {
        continue;
      }
      markInstallVehicle(vehicle.id);
    }
  }

  function queueGameOverTimer(callback, delay) {
    const timer = window.setTimeout(() => {
      gameOverTimers.delete(timer);
      callback();
    }, delay);
    gameOverTimers.add(timer);
  }

  function clearGameOverTimers() {
    for (const timer of gameOverTimers) window.clearTimeout(timer);
    gameOverTimers.clear();
  }

  function showResultOverlay(title = 'Game Over', { failed = true } = {}) {
    if (!gameOverOverlay || gameOverActive) return;
    gameOverActive = true;
    platformBridge?.end();
    if (failed) platformBridge?.challengeFailed?.();
    clearGameOverTimers();
    applyGameOverTuning();
    if (gameOverTitle) gameOverTitle.textContent = title;
    applyCtaTuning();
    gameOverOverlay.hidden = false;
    gameOverOverlay.classList.remove('is-active', 'is-title-fading', 'is-cta-ready');
    void gameOverOverlay.offsetWidth;
    gameOverOverlay.classList.add('is-active');
    // Retry only makes sense on a loss: a won run's next step is the store
    // button or the stage picker, and offering "play again" there would race
    // the end-of-ad flow.
    if (gameOverRetryButton) {
      gameOverRetryButton.hidden = !failed || !Boolean(SCENE_TUNING.gameOver?.retryEnabled ?? 1);
    }

    const gameOver = SCENE_TUNING.gameOver ?? {};
    const titlePopMs = durationFromSpeed(gameOver.titlePopSpeed, 1.35) * 1000;
    const titleFadeMs = durationFromSpeed(gameOver.titleFadeSpeed, 1.45) * 1000;
    queueGameOverTimer(() => gameOverOverlay.classList.add('is-title-fading'), titlePopMs);
    queueGameOverTimer(() => gameOverOverlay.classList.add('is-cta-ready'), titlePopMs + titleFadeMs);
  }

  function hideGameOver() {
    gameOverActive = false;
    clearGameOverTimers();
    gameOverOverlay?.classList.remove('is-active', 'is-title-fading', 'is-cta-ready');
    if (gameOverOverlay) gameOverOverlay.hidden = true;
    if (gameOverRetryButton) gameOverRetryButton.hidden = true;
    applyCtaTuning();
  }

  unsubscribeGame = game.subscribe(syncHud);
  function reset() {
    endPanel.hidden = true;
    platformBridge?.retry();
    hideGameOver();
    hideStageChoice();
    stageAdvancePending = false;
    unsubscribeGame();
    // A picked map is appended to the play order, so a retry has to drop it
    // again or the next run would start with a stale final stage.
    sessionLevels = initialSessionLevels.slice();
    sessionStages = initialSessionStages.slice();
    SCENE_TUNING.installGate.successfulOperationThreshold = initialInstallThreshold;
    const initialLevel = levelSession.reset();
    // Reset returns to the first stage, so its belt, guide, and labels come back with it.
    setActiveStageScene(currentStage()?.scene ?? null);
    view.setStageOpening?.(currentStage()?.opening ?? null, currentStage()?.labels ?? []);
    setActiveLevel(initialLevel);
    game = new BusLoopGame(initialLevel);
    audio.resetEventHistory();
    view.replaceActiveLevel();
    initializeGameQueues({ resetSlots: true });
    // A retry starts from the authored pace again; the button is a session
    // preference, not a permanent override of the tuned belt speed.
    setSpeedToggleBoosted(false);
    applyIdleSpeedMultiplier();
    unsubscribeGame = game.subscribe(syncHud);
  }
  $('#reset-button')?.addEventListener('click', reset);
  $('#end-reset-button').addEventListener('click', reset);
  // Retry restarts the run the player just lost. reset() already rebuilds the
  // level, the session and the queues, and tells the platform bridge, so a
  // retry is reported as CHALLENGE_RETRY rather than a fresh challenge start.
  gameOverRetryButton?.addEventListener('click', (event) => {
    event.stopPropagation();
    audio.unlock();
    reset();
  });
  ctaButton?.addEventListener('click', (event) => {
    event.stopPropagation();
    InstallFullGame();
  });
  speedToggleButton?.addEventListener('click', (event) => {
    // The stage click handlers start the long-press boost and log the platform
    // challenge; a speed tap is neither, it only flips the sticky multiplier.
    event.stopPropagation();
    audio.unlock();
    setSpeedToggleBoosted(!speedToggleBoosted);
  });
  canvas.addEventListener('pointerdown', (event) => {
    if (spatialEditorActive) return;
    if (levelSession.shouldOpenStore()) {
      event.stopImmediatePropagation();
      InstallFullGame();
      return;
    }
  }, { capture: true });
  canvas.addEventListener('pointerdown', () => {
    if (spatialEditorActive) return;
    platformBridge?.challenge();
    audio.unlock();
    pressed = true;
    clearTimeout(pressTimer);
    pressTimer = setTimeout(() => {
      if (!pressed) return;
      const configuredSpatialMultiplier = Number(SCENE_TUNING.spatialConveyor?.longPressMultiplier);
      const multiplier = isSpatialConveyorSelection(SCENE_TUNING.conveyorLayout?.selected)
        ? (Number.isFinite(configuredSpatialMultiplier)
            ? Math.max(1, configuredSpatialMultiplier)
            : LEVEL_1.longPressMultiplier)
        : LEVEL_1.longPressMultiplier;
      game.setSpeedMultiplier(multiplier);
    }, LEVEL_1.longPressThreshold * 1000);
  });
  const release = () => {
    pressed = false;
    clearTimeout(pressTimer);
    applyIdleSpeedMultiplier();
  };
  window.addEventListener('pointerup', release);
  window.addEventListener('pointercancel', release);
  window.addEventListener('blur', release);
  if (EDITOR_ENABLED) window.addEventListener('beforeunload', flushTuningSave);

  let previous = performance.now();
  function frame(now) {
    // Clamp the wall delta first: after a platform hiccup or a throttled tab the
    // raw gap can be seconds long, and scaling that would fast-forward the whole
    // level in one frame.
    const delta = Math.min(0.1, (now - previous) / 1000);
    previous = now;
    if (platformVisible && !spatialEditorActive && !preRollController?.isActive()) {
      // game.update clamps one call to 0.1s of simulated time, so the scaled
      // time is fed in substeps; otherwise a low-framerate x2 is truncated.
      let remaining = delta * getTimeScale();
      while (remaining > 0) {
        const step = Math.min(remaining, 0.05);
        game.update(step);
        remaining -= step;
      }
    }
    const renderState = isSpatialOptimizationEnabled('liveRenderState')
      ? game.renderState()
      : game.snapshot();
    view.update(renderState, game);
    view.render();
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  window.__busLoop = {
    get game() { return game; },
    get view() { return view; },
    snapshot: () => game.snapshot(),
    clickVehicle: (id) => handleVehicleClick(Number(id)),
    InstallFullGame,
    openStore,
    installState: () => ({
      numberCountBus: levelSession.state().successfulOperationCount,
      maxNumberCountBus: getSuccessfulOperationThreshold(),
      isFinish: levelSession.state().installReady,
      levelKey: levelSession.state().levelKey
    }),
    step: (seconds, increment = .05) => {
      for (let time = 0; time < seconds; time += increment) game.update(increment);
      return game.snapshot();
    },
    // QA hook for the failure card: a headless check cannot always drive a real
    // loss (it depends on the board and the random queue), and the Retry button
    // only exists on that card. This runs the same show path a lost run uses.
    forceGameOver: (reason = 'game-over') => {
      showResultOverlay(reason === 'ambulance-exceed-step' ? 'Ambulance Failed' : 'Game Over');
      return { overlayHidden: gameOverOverlay?.hidden ?? null };
    },
    // Companion hook for the win card, so a check can prove Retry is absent
    // there without playing a whole board out.
    forceWinOverlay: () => {
      hideGameOver();
      showResultOverlay('You Win!', { failed: false });
      return { overlayHidden: gameOverOverlay?.hidden ?? null };
    },
    // QA hooks for the post-stage picker: a headless run has to be able to
    // reach the choice page and take a specific map without playing it out.
    stageChoice: {
      visible: () => stageChoiceVisible,
      options: () => (sessionChoices[levelSession.state().levelIndex]?.options ?? []).map((option) => ({
        id: option.id,
        label: option.label,
        levelKey: option.levelKey
      })),
      choose: (optionId) => {
        const choice = sessionChoices[levelSession.state().levelIndex];
        if (!choice) return false;
        const index = choice.options.findIndex((option) => (
          option.id === optionId || option.levelKey === optionId
        ));
        if (index < 0) return false;
        chooseStage(index);
        return true;
      }
    },
    // QA hooks for the speed switch: the frame loop owns the time scale, so a
    // headless check needs a way to read and flip it without real frames.
    speedToggle: (boosted) => {
      if (boosted === undefined) return speedToggleBoosted;
      setSpeedToggleBoosted(boosted);
      return speedToggleBoosted;
    },
    timeScale: () => getTimeScale(),
    // QA hook for the background music: a headless run has to prove the track
    // only starts after a real tap and keeps playing across retries.
    bgm: () => ({
      enabled: Number(SCENE_TUNING.audio?.bgm?.enabled) === 1,
      playing: Boolean(audio?.isBgmPlaying),
      asset: SCENE_TUNING.audio?.bgm?.asset ?? null
    }),
    reset,
    ...(EDITOR_ENABLED ? {
      tuning: SCENE_TUNING,
      setTuning: (patch, { path } = {}) => applyTuningPatch(patch, { path, syncEditor: true }),
      exportTuning: () => JSON.stringify(SCENE_TUNING, null, 2),
      saveTuning: () => saveTuning(SCENE_TUNING, { immediate: true }),
      captureScreenshot: capturePlayableScreenshot,
      playPreRoll: () => preRollController?.play(SCENE_TUNING.preRoll),
      clearSavedTuning
    } : {})
  };
}

platformBridge = createPlatformBridge({
  onStart: startRuntime,
  onVisibilityChange: (visible) => {
    platformVisible = visible;
    audio?.setVisible(visible);
    preRollController?.setVisible(visible);
  },
  onSizeChange: () => window.dispatchEvent(new Event('resize')),
  onRetry: () => window.__busLoop?.reset?.()
});
platformBridge.initialize();
