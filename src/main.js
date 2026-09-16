import './styles.css';
import { BusLoopGame } from './game-model.js';
import { PLAYABLE_LEVEL_SEQUENCE } from './generated-active-level.js';
import { ACTIVE_SPATIAL_CONVEYOR_PACKAGE } from './generated-active-spatial-conveyor.js';
import { LEVEL_1, setActiveLevel } from './level-data.js';
import { createLevelSession } from './level-session.js';
import { SceneView } from './scene-view.js';
import {
  clampCenteredRectX,
  projectCenteredDesignPoint,
  unprojectCenteredDesignPoint
} from './scene-layout.js';
import { SCENE_TUNING } from './scene-tuning.js';
import { createGameAudioController } from './audio-controller.js';
import {
  MECHANISM_ASSETS,
  MECHANISM_TYPES,
  getMechanismTypesForLevels
} from './mechanism-resources.js';
import { RandomPlayableAudioScheduler } from './random-playable-audio.js';
import {
  getSpatialConveyorId,
  isSpatialConveyorSelection,
  registerSpatialConveyorPackage,
  refreshSpatialConveyorPackages
} from './spatial-conveyor-runtime.js';

const DEFAULT_SCENE_TUNING = structuredClone(SCENE_TUNING);

if (ACTIVE_SPATIAL_CONVEYOR_PACKAGE) {
  registerSpatialConveyorPackage(ACTIVE_SPATIAL_CONVEYOR_PACKAGE);
}

const TUNING_STORAGE_KEY = 'bus-loop-scene-tuning-v3';
const LEGACY_TUNING_STORAGE_KEY = 'bus-loop-scene-tuning-v2';
const LEVEL_EDITOR_PREVIEW_STORAGE_KEY = 'bus-loop-level-editor-preview-v1';
const STORE_URL = {
  android: {
    web: 'https://play.google.com/store/apps/details?id=gridplus.busjam.carpuzzle',
    mraid: ['https://play.google.com/store/apps/details?id=gridplus.busjam.carpuzzle']
  },
  ios: {
    web: 'https://apps.apple.com/app/id6746743297',
    mraid: [
      'itms-apps://itunes.apple.com/app/id6746743297',
      'https://apps.apple.com/app/id6746743297'
    ]
  }
};
const STORE_OPEN_COOLDOWN_MS = 800;
const EDITOR_ENABLED = import.meta.env.DEV;
const $ = (selector) => document.querySelector(selector);
const app = $('#app');
const stage = $('#stage');
const canvas = $('#game-canvas');
const loadingScreen = $('#loading-screen');
const loadingProgress = loadingScreen?.querySelector('.loading-progress');
const loadingProgressBar = $('#loading-progress-bar');
const loadingProgressValue = $('#loading-progress-value');
const foregroundVideoOverlay = $('#foreground-video-overlay');
const foregroundVideoBackdrop = $('#foreground-video-backdrop');
const foregroundVideo = $('#foreground-video');
const foregroundTransitionVideo = $('#foreground-transition-video');
const fireTruckHud = $('#firetruck-hud');
const fireTruckCountdown = $('#firetruck-countdown');
const fireTruckHudImages = {
  warningPrimary: fireTruckHud?.querySelector('.firetruck-screen-effect__warning--primary'),
  warningStrong: fireTruckHud?.querySelector('.firetruck-screen-effect__warning--strong'),
  timerFrame: fireTruckHud?.querySelector('.firetruck-timer__frame'),
  timerVehicle: fireTruckHud?.querySelector('.firetruck-timer__vehicle'),
  timerReadout: fireTruckHud?.querySelector('.firetruck-timer__readout-bg'),
  timerClock: fireTruckHud?.querySelector('.firetruck-timer__clock')
};
const gameOverOverlay = $('#game-over-overlay');
const gameOverLogo = $('#game-over-logo');
const gameOverTitle = $('#game-over-title');
const ctaButton = $('#cta-button');
const brandingItems = {
  icon: $('#branding-icon'),
  logo: $('#branding-logo'),
  text: $('#branding-text')
};
if (gameOverLogo && brandingItems.logo?.src) gameOverLogo.src = brandingItems.logo.src;
const passengerEmoji = $('#passenger-emoji');
const sceneEditorRoot = EDITOR_ENABLED ? $('#scene-editor') : null;
const PASSENGER_EMOJI_COLUMNS = 8;
const PASSENGER_EMOJI_ROWS = 8;
const PASSENGER_EMOJI_FRAME_COUNT = PASSENGER_EMOJI_COLUMNS * PASSENGER_EMOJI_ROWS;
const PASSENGER_EMOJI_DEFAULT_DURATION_SECONDS = 2.067;
const PASSENGER_EMOJI_HIDE_STATES = new Set(['at-spot', 'boarding-final', 'departing', 'done']);
let passengerEmojiHiddenByVehicle = false;
let passengerEmojiAnimationStartedAt = null;
let randomPlayableAudioScheduler = null;
const PASSENGER_MATERIAL_TUNING_PREFIX = 'passengerMaterial.';
const PASSENGER_MATERIAL_COLOR_INDEX_PATTERN = /^passengerMaterial\.(?:solidColors|colors)\.(\d+)(?:\.|$)/;
const AMBULANCE_AUDIO_CONFIG = Object.freeze({
  clips: [MECHANISM_ASSETS.ambulance.audio],
  volume: 0.72
});
const POLICE_CAR_AUDIO_CONFIG = Object.freeze({
  clips: [MECHANISM_ASSETS.policeCar.audio],
  volume: 0.73829204
});
const TURN_VEHICLE_AUDIO_CONFIG = Object.freeze({
  clips: [MECHANISM_ASSETS.turnVehicle.audio],
  volume: 0.7
});
const HIDDEN_VEHICLE_AUDIO_CONFIG = Object.freeze({
  clips: [MECHANISM_ASSETS.hiddenVehicle.audio],
  volume: 0.7933884
});
const FIRE_TRUCK_START_AUDIO_CONFIG = Object.freeze({
  clips: [MECHANISM_ASSETS.fireTruck.startAudio],
  volume: 0.82
});
const FIRE_TRUCK_FAIL_AUDIO_CONFIG = Object.freeze({
  clips: [MECHANISM_ASSETS.fireTruck.failAudio],
  volume: 0.8
});
const GARAGE_OUT_AUDIO_CONFIG = Object.freeze({
  clips: [MECHANISM_ASSETS.garage.outAudio],
  volume: 0.7979798
});
const GARAGE_CLEAR_AUDIO_CONFIG = Object.freeze({
  clips: [MECHANISM_ASSETS.garage.clearAudio],
  volume: 1
});
const RANDOM_PLAYABLE_AUDIO_CONFIGS = Object.freeze({
  random_playable_audio_police_ring: Object.freeze({
    clips: [MECHANISM_ASSETS.randomPlayableAudio.policeRing],
    volume: 1
  }),
  random_playable_audio_move: Object.freeze({
    clips: [MECHANISM_ASSETS.randomPlayableAudio.move],
    volume: 1
  }),
  random_playable_audio_hey_move_it: Object.freeze({
    clips: [MECHANISM_ASSETS.randomPlayableAudio.heyMoveIt],
    volume: 1
  })
});
const isPassengerMaterialTuningPath = (path) => path?.startsWith(PASSENGER_MATERIAL_TUNING_PREFIX);
const getPassengerMaterialColorIndex = (path) => {
  const match = path?.match(PASSENGER_MATERIAL_COLOR_INDEX_PATTERN);
  if (!match) return null;
  const colorIndex = Number(match[1]);
  return Number.isInteger(colorIndex) ? colorIndex : null;
};

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
  if (Number(guideHand.vehicleId) === 1) {
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

function migratePassengerEmojiTuning(source) {
  const emoji = source?.passengerEmoji;
  if (!emoji) return false;
  let changed = false;
  if (Number(emoji.animationDurationSeconds) === 1.333) {
    emoji.animationDurationSeconds = PASSENGER_EMOJI_DEFAULT_DURATION_SECONDS;
    changed = true;
  }
  if (emoji.autoHideOnVehicleLevelKey === 'level42') {
    emoji.autoHideOnVehicleLevelKey = 'level29';
    changed = true;
  }
  return changed;
}

function migrateRandomPlayableAudioTuning(source) {
  const audioTuning = source?.randomPlayableAudio;
  if (!audioTuning) return false;
  let changed = false;
  const clamp = (key, fallback) => {
    const value = Number(audioTuning[key]);
    const next = Number.isFinite(value) ? Math.max(5, Math.min(30, value)) : fallback;
    if (audioTuning[key] === next) return;
    audioTuning[key] = next;
    changed = true;
  };
  clamp('minIntervalSeconds', 5);
  clamp('maxIntervalSeconds', 30);
  if (Number(audioTuning.maxIntervalSeconds) < Number(audioTuning.minIntervalSeconds)) {
    audioTuning.maxIntervalSeconds = audioTuning.minIntervalSeconds;
    changed = true;
  }
  return changed;
}

function waitForMraidReady(onReady) {
  const mraid = window.mraid;
  if (!mraid?.getState || !mraid?.addEventListener) {
    onReady();
    return;
  }

  let started = false;
  const startOnce = () => {
    if (started) return;
    started = true;
    mraid.removeEventListener?.('ready', startOnce);
    onReady();
  };

  let state = 'default';
  try {
    state = mraid.getState();
  } catch (error) {
    console.warn('MRAID state could not be read; starting playable.', error);
    startOnce();
    return;
  }

  if (state === 'loading') {
    mraid.addEventListener('ready', startOnce);
    return;
  }

  if (state === 'default') {
    startOnce();
    return;
  }

  startOnce();
}

function applyPreviewFrame() {
  const preview = SCENE_TUNING.preview;
  app?.classList.toggle('is-phone-preview', EDITOR_ENABLED && Boolean(preview?.enabled));
  if (app) {
    app.style.setProperty('--preview-width', String(preview?.width ?? 1080));
    app.style.setProperty('--preview-height', String(preview?.height ?? 2160));
  }
}

function loadSavedTuning() {
  if (!EDITOR_ENABLED) return;
  try {
    const saved = localStorage.getItem(TUNING_STORAGE_KEY);
    if (saved) {
      const savedTuning = JSON.parse(saved);
      const guideHandMotionMigrated = migrateGuideHandMotionTuning(savedTuning);
      const spatialSpeedMigrated = migrateSpatialSpeedTuning(savedTuning);
      const passengerEmojiMigrated = migratePassengerEmojiTuning(savedTuning);
      const randomPlayableAudioMigrated = migrateRandomPlayableAudioTuning(savedTuning);
      const luxuryPassengerRotationRemoved = delete savedTuning.luxuryPassengerRotation;
      const luxuryPassengerOffsetRemoved = delete savedTuning.luxuryPassengerOffset;
      const luxuryMaterialDebugRemoved = delete savedTuning.luxuryMaterialDebug;
      const policePassengerDebugRemoved = delete savedTuning.policePassengerDebug;
      const conveyorVisualRemoved = delete savedTuning.conveyorVisual;
      const savedLuxuryMaterial = savedTuning.luxuryMaterial;
      const luxuryMaterialNeedsReset = !savedLuxuryMaterial
        || savedLuxuryMaterial.vehicleBrightness !== SCENE_TUNING.luxuryMaterial.vehicleBrightness
        || savedLuxuryMaterial.passengerBrightness !== SCENE_TUNING.luxuryMaterial.passengerBrightness
        || savedLuxuryMaterial.boardBrightness !== SCENE_TUNING.luxuryMaterial.boardBrightness;
      delete savedTuning.luxuryMaterial;
      deepMerge(SCENE_TUNING, savedTuning);
      migrateLegacyConveyorTuning(savedTuning);
      if (
        guideHandMotionMigrated
        || spatialSpeedMigrated
        || passengerEmojiMigrated
        || randomPlayableAudioMigrated
        || luxuryPassengerRotationRemoved
        || luxuryPassengerOffsetRemoved
        || luxuryMaterialDebugRemoved
        || policePassengerDebugRemoved
        || conveyorVisualRemoved
        || luxuryMaterialNeedsReset
      ) {
        savedTuning.luxuryMaterial = structuredClone(SCENE_TUNING.luxuryMaterial);
        localStorage.setItem(TUNING_STORAGE_KEY, JSON.stringify(savedTuning));
      }
      return;
    }
    const legacySaved = localStorage.getItem(LEGACY_TUNING_STORAGE_KEY);
    if (!legacySaved) return;
    const legacy = JSON.parse(legacySaved);
    migrateGuideHandMotionTuning(legacy);
    migrateSpatialSpeedTuning(legacy);
    migratePassengerEmojiTuning(legacy);
    migrateRandomPlayableAudioTuning(legacy);
    migrateLegacyPackageTuning(legacy);
    delete legacy.luxuryMaterialDebug;
    delete legacy.luxuryMaterial;
    delete legacy.conveyorVisual;
    const legacyModelScale = legacy.vehicleArea?.modelScale;
    delete legacy.vehicleArea;
    deepMerge(SCENE_TUNING, legacy);
    migrateLegacyConveyorTuning(legacy);
    if (Number.isFinite(legacyModelScale)) {
      SCENE_TUNING.vehicleArea.modelScale = legacyModelScale;
    }
  } catch (error) {
    console.warn('Saved scene tuning could not be loaded.', error);
  }
}

let pendingTuningSave = null;
let tuningSaveTimer = 0;

function writeTuning(value) {
  if (!EDITOR_ENABLED) return;
  try {
    localStorage.setItem(TUNING_STORAGE_KEY, JSON.stringify(value));
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
    if (key === 'icon') {
      const asset = typeof config.asset === 'string' ? config.asset : '';
      if (asset && element.getAttribute('src') !== asset) element.setAttribute('src', asset);
    }
    if (key === 'text') {
      const content = String(config.content ?? 'Bus Fever-Car Jam Escape');
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
}

function bindBrandingDrag(element, key, onPositionChange) {
  if (!element || !EDITOR_ENABLED) return;
  const getConfig = () => key === 'passengerEmoji'
    ? SCENE_TUNING.passengerEmoji
    : SCENE_TUNING.branding?.[key];
  let activePointerId = null;
  const finish = (event) => {
    if (activePointerId == null) return;
    const pointerId = activePointerId;
    activePointerId = null;
    element.classList.remove('is-dragging');
    if (element.hasPointerCapture?.(pointerId)) element.releasePointerCapture(pointerId);
  };
  element.addEventListener('pointerdown', (event) => {
    const config = getConfig();
    if (!config || !config.enabled || config.locked) return;
    event.preventDefault();
    event.stopPropagation();
    activePointerId = event.pointerId;
    element.setPointerCapture?.(event.pointerId);
    element.classList.add('is-dragging');
  });
  element.addEventListener('pointermove', (event) => {
    if (activePointerId == null) return;
    const config = getConfig();
    if (!config?.enabled || config.locked) {
      activePointerId = null;
      element.classList.remove('is-dragging');
      return;
    }
    const metrics = getBrandingStageMetrics();
    const localX = event.clientX - metrics.screenLeft;
    const localY = event.clientY - metrics.screenTop;
    const designPoint = key === 'passengerEmoji'
      ? unprojectCenteredDesignPoint({
        x: localX,
        y: localY,
        designWidth: metrics.designWidth,
        designHeight: metrics.designHeight,
        stageWidth: metrics.stageWidth,
        stageHeight: metrics.stageHeight,
        scale: metrics.uiScale
      })
      : {
        x: localX / metrics.positionScaleX,
        y: localY / metrics.positionScaleY
      };
    onPositionChange(
      Math.max(0, Math.min(metrics.designWidth, designPoint.x)),
      Math.max(0, Math.min(metrics.designHeight, designPoint.y))
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

function applyPassengerEmojiTuning() {
  if (!passengerEmoji) return;
  const metrics = getBrandingStageMetrics();
  const config = SCENE_TUNING.passengerEmoji ?? {};
  const enabled = Boolean(config.enabled ?? 0);
  const locked = Boolean(config.locked ?? 0);
  const autoHidden = Boolean(config.autoHideOnVehicleEnabled) && passengerEmojiHiddenByVehicle;
  const width = Math.max(1, Number(config.width) || 180);
  const height = Math.max(1, Number(config.height) || width);
  const x = Number.isFinite(Number(config.x)) ? Number(config.x) : metrics.designWidth / 2;
  const y = Number.isFinite(Number(config.y)) ? Number(config.y) : metrics.designHeight / 2;
  const position = projectCenteredDesignPoint({
    x,
    y,
    designWidth: metrics.designWidth,
    designHeight: metrics.designHeight,
    stageWidth: metrics.stageWidth,
    stageHeight: metrics.stageHeight,
    scale: metrics.uiScale
  });
  passengerEmoji.hidden = !enabled || autoHidden;
  passengerEmoji.classList.toggle('is-draggable', EDITOR_ENABLED && enabled && !locked);
  passengerEmoji.classList.toggle('is-locked', locked);
  passengerEmoji.style.left = `${position.x}px`;
  passengerEmoji.style.top = `${position.y}px`;
  passengerEmoji.style.width = `${width * metrics.uiScale}px`;
  passengerEmoji.style.height = `${height * metrics.uiScale}px`;
  passengerEmoji.style.setProperty('--passenger-emoji-opacity', String(Math.max(0, Math.min(1, Number(config.opacity) || 0))));
  passengerEmoji.style.setProperty('--passenger-emoji-duration', `${Math.max(0.2, Number(config.animationDurationSeconds) || PASSENGER_EMOJI_DEFAULT_DURATION_SECONDS)}s`);
  passengerEmoji.style.backgroundImage = `url("${MECHANISM_ASSETS.passengerEmoji.angrySheet}")`;
}

function updatePassengerEmojiAutoHide(snapshot, activeLevelKey) {
  const config = SCENE_TUNING.passengerEmoji ?? {};
  const configuredLevelKey = String(config.autoHideOnVehicleLevelKey ?? '').trim();
  const levelMatches = !configuredLevelKey || configuredLevelKey === activeLevelKey;
  const targetId = Math.round(Number(config.autoHideOnVehicleId) || 0);
  const target = snapshot?.vehicles?.find((vehicle) => Number(vehicle.id) === targetId);
  const targetReached = Boolean(
    config.autoHideOnVehicleEnabled
    && levelMatches
    && target
    && PASSENGER_EMOJI_HIDE_STATES.has(target.state)
  );
  if (targetReached) {
    passengerEmojiHiddenByVehicle = true;
  } else if (
    !config.autoHideOnVehicleEnabled
    || !levelMatches
    || !target
    || !PASSENGER_EMOJI_HIDE_STATES.has(target.state)
  ) {
    passengerEmojiHiddenByVehicle = false;
  }
  applyPassengerEmojiTuning();
}

function updatePassengerEmojiFrame(now) {
  if (!passengerEmoji || passengerEmoji.hidden) return;
  if (passengerEmojiAnimationStartedAt == null) {
    passengerEmoji.style.backgroundPosition = '0% 0%';
    return;
  }
  const delay = Math.max(
    0,
    Number(SCENE_TUNING.passengerEmoji?.animationDelaySeconds) || 0
  );
  const elapsed = (now - passengerEmojiAnimationStartedAt) / 1000 - delay;
  if (elapsed < 0) {
    passengerEmoji.style.backgroundPosition = '0% 0%';
    return;
  }
  const duration = Math.max(
    0.2,
    Number(SCENE_TUNING.passengerEmoji?.animationDurationSeconds) || PASSENGER_EMOJI_DEFAULT_DURATION_SECONDS
  );
  const frame = Math.floor(elapsed / duration * PASSENGER_EMOJI_FRAME_COUNT) % PASSENGER_EMOJI_FRAME_COUNT;
  const column = frame % PASSENGER_EMOJI_COLUMNS;
  const row = Math.floor(frame / PASSENGER_EMOJI_COLUMNS);
  passengerEmoji.style.backgroundPosition = `${column * 100 / (PASSENGER_EMOJI_COLUMNS - 1)}% ${row * 100 / (PASSENGER_EMOJI_ROWS - 1)}%`;
}

function startPassengerEmojiAnimation(now = performance.now()) {
  passengerEmojiAnimationStartedAt = now;
  updatePassengerEmojiFrame(now);
}

function syncFireTruckHudBounds(view = null) {
  if (!fireTruckHud || !stage || !canvas) return;
  const stageRect = stage.getBoundingClientRect();
  const canvasRect = canvas.getBoundingClientRect();
  const playable = view?.getBackgroundCanvasBounds?.() ?? {
    left: 0,
    top: 0,
    width: canvasRect.width,
    height: canvasRect.height
  };
  const left = canvasRect.left - stageRect.left + playable.left;
  const top = canvasRect.top - stageRect.top + playable.top;
  fireTruckHud.style.left = `${Math.max(0, left)}px`;
  fireTruckHud.style.top = `${Math.max(0, top)}px`;
  fireTruckHud.style.width = `${Math.max(0, playable.width)}px`;
  fireTruckHud.style.height = `${Math.max(0, playable.height)}px`;
}

function updateFireTruckHud(state, view = null) {
  if (!fireTruckHud || !fireTruckCountdown) return;
  syncFireTruckHudBounds(view);
  const visible = Boolean(state?.enabled && state.started && !state.completed);
  fireTruckHud.hidden = !visible;
  if (!visible) return;
  const assets = MECHANISM_ASSETS.fireTruck;
  fireTruckHudImages.warningPrimary.src = assets.warningTexture;
  fireTruckHudImages.warningStrong.src = assets.warningTextureStrong;
  fireTruckHudImages.timerFrame.src = assets.timerFrameTexture;
  fireTruckHudImages.timerVehicle.src = assets.timerVehicleTexture;
  fireTruckHudImages.timerReadout.src = assets.timerReadoutTexture;
  fireTruckHudImages.timerClock.src = assets.timerClockTexture;
  fireTruckHud.style.setProperty('--firetruck-fire-texture', `url("${assets.fireTexture}")`);
  const remaining = Math.max(0, Number(state.remainingSeconds) || 0);
  fireTruckCountdown.textContent = `${Math.ceil(remaining)}s`;
  fireTruckCountdown.setAttribute('aria-label', `${Math.ceil(remaining)} seconds remaining`);
  fireTruckHud.dataset.stage = String(state.warningStage ?? 0);
  fireTruckHud.dataset.paused = state.paused ? '1' : '0';
}

let audio = null;
let lastStoreOpenAt = 0;
let storeOpenAttempts = 0;

function applyCtaTuning(view = null) {
  if (!ctaButton) return;
  const cta = SCENE_TUNING.cta ?? {};
  const designWidth = Math.max(1, Number(SCENE_TUNING.preview?.width) || 1080);
  const designHeight = Math.max(1, Number(SCENE_TUNING.preview?.height) || 2160);
  const stageRect = stage?.getBoundingClientRect();
  const stageWidth = stageRect?.width || designWidth;
  const stageHeight = stageRect?.height || designHeight;
  const height = Math.max(1, Number(cta.height) || 68);
  const width = Math.max(1, height * (Number(cta.stretchX) || 2.75));
  const fontSize = Math.max(1, Number(cta.fontSize) || 28);
  const fontHeight = Math.max(1, Number(cta.fontHeight) || fontSize);
  const centerX = Number.isFinite(Number(cta.x)) ? Number(cta.x) : designWidth / 2;
  const centerY = Number.isFinite(Number(cta.y))
    ? Number(cta.y)
    : designHeight - Math.max(0, Number(cta.bottom) || 0) - height / 2;
  const pulseSpeed = Math.max(0.01, Number(cta.pulseSpeed) || 0.55);
  const isGameOverVisible = ctaButton.dataset.gameOverVisible === '1';
  const uiScale = getStageUiScale(stageWidth, designWidth);
  const worldX = Number(cta.worldX);
  const worldY = Number(cta.worldY);
  const worldZ = Number(cta.worldZ);
  const worldPosition = view && Number.isFinite(worldX) && Number.isFinite(worldZ)
    ? view.projectWorldToCanvas?.({
      x: worldX,
      y: Number.isFinite(worldY) ? worldY : 0,
      z: worldZ
    })
    : null;
  ctaButton.hidden = !(isGameOverVisible && Boolean(cta.enabled ?? 1));
  ctaButton.style.setProperty('--cta-width', scaledPx(width, uiScale));
  ctaButton.style.setProperty('--cta-height', scaledPx(height, uiScale));
  ctaButton.style.setProperty('--cta-padding-x', scaledPx(24, uiScale));
  ctaButton.style.setProperty('--cta-font-size', scaledPx(fontSize, uiScale));
  ctaButton.style.setProperty('--cta-font-height', scaledPx(fontHeight, uiScale));
  ctaButton.style.setProperty('--cta-stroke-color', formatHexColor(cta.strokeColor, 0x196b07));
  ctaButton.style.setProperty('--cta-stroke-width', scaledPx(Math.max(0, Number(cta.strokeWidth) || 0), uiScale));
  ctaButton.style.setProperty('--cta-pulse-scale', String(Math.max(1, Number(cta.pulseScale) || 1.08)));
  ctaButton.style.setProperty('--cta-pulse-duration', `${1 / pulseSpeed}s`);
  ctaButton.style.setProperty('--game-over-cta-appear-duration', durationCss(cta.appearSpeed, 1.45));
  ctaButton.style.left = `${worldPosition?.x ?? stageWidth / 2 + (centerX - designWidth / 2) * uiScale}px`;
  ctaButton.style.top = `${worldPosition?.y ?? stageHeight / 2 + (centerY - designHeight / 2) * uiScale}px`;
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
}

function isIOSDevice() {
  const userAgent = navigator.userAgent || '';
  return /iPhone|iPad|iPod/i.test(userAgent) ||
    ((navigator.platform === 'MacIntel' || /Macintosh/i.test(userAgent)) && navigator.maxTouchPoints > 1);
}

function getStoreTarget() {
  return isIOSDevice() ? STORE_URL.ios : STORE_URL.android;
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
  if (window.mraid?.open) {
    const url = getMraidStoreUrl(target);
    storeOpenAttempts += 1;
    try {
      window.mraid.open(url);
      return;
    } catch (error) {
      lastStoreOpenAt = 0;
      console.warn('MRAID store open failed.', error);
    }
  }
}

function InstallFullGame() {
  randomPlayableAudioScheduler?.stop();
  audio?.unlock();
  openStore();
}

function getSuccessfulOperationThreshold() {
  const configuredThreshold = Number(SCENE_TUNING.installGate?.successfulOperationThreshold);
  return Number.isFinite(configuredThreshold) ? Math.max(1, Math.floor(configuredThreshold)) : 40;
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
  localStorage.removeItem(TUNING_STORAGE_KEY);
}

function readLevelEditorPreviewDocument() {
  try {
    const source = localStorage.getItem(LEVEL_EDITOR_PREVIEW_STORAGE_KEY);
    const document = source ? JSON.parse(source) : null;
    return document?.format === 'bus-loop-web-level-v1' && /^level[1-9]\d*$/.test(document.key) ? document : null;
  } catch (error) {
    console.warn('Authored level preview could not be restored.', error);
    return null;
  }
}

async function readSavedWebLevelDocument(levelKey) {
  const response = await fetch(`/__level-authoring/${encodeURIComponent(levelKey)}`, { cache: 'no-store' });
  if (response.status === 404) return null;
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || `HTTP ${response.status}`);
  return payload.document ?? null;
}

async function startRuntime() {
  loadSavedTuning();
  let sessionLevels = PLAYABLE_LEVEL_SEQUENCE;
  if (EDITOR_ENABLED) {
    const { getLevelDefinition } = await import('./level-catalog.js');
    await refreshSpatialConveyorPackages().catch((error) => {
      console.warn('Spatial conveyor packages could not be loaded.', error);
    });
    const selectedKey = SCENE_TUNING.level?.selected;
    let selectedLevel = getLevelDefinition(selectedKey);
    let previewDocument = readLevelEditorPreviewDocument();
    if (!previewDocument && selectedLevel.key !== selectedKey) {
      previewDocument = await readSavedWebLevelDocument(selectedKey);
      if (previewDocument) {
        localStorage.setItem(LEVEL_EDITOR_PREVIEW_STORAGE_KEY, JSON.stringify(previewDocument));
      }
    }
    if (previewDocument) {
      const { levelDocumentToRuntime } = await import('./level-editor-model.js');
      selectedLevel = levelDocumentToRuntime(previewDocument, selectedLevel);
      if (SCENE_TUNING.level?.selected !== previewDocument.key) {
        SCENE_TUNING.level.selected = previewDocument.key;
        saveTuning(SCENE_TUNING, { immediate: true });
      }
    }
    sessionLevels = selectedLevel.key === 'level9'
      ? [selectedLevel, getLevelDefinition('level7')]
      : [selectedLevel];
  }
  const levelSession = createLevelSession(sessionLevels);
  setActiveLevel(levelSession.currentLevel());
  applyPreviewFrame();

  let game = new BusLoopGame(levelSession.currentLevel());
  const sessionMechanismTypes = new Set(getMechanismTypesForLevels(sessionLevels, {
    entryBannerEnabled: Boolean(SCENE_TUNING.entryBanner?.enabled),
    passengerEmojiEnabled: Boolean(SCENE_TUNING.passengerEmoji?.enabled),
    randomPlayableAudioEnabled: Boolean(SCENE_TUNING.randomPlayableAudio?.enabled)
  }));
  audio = createGameAudioController({
    ...LEVEL_1.assets.audio,
    ...(sessionMechanismTypes.has(MECHANISM_TYPES.ambulance)
      ? { ambulance_countdown: AMBULANCE_AUDIO_CONFIG }
      : {}),
    ...(sessionMechanismTypes.has(MECHANISM_TYPES.policeCar)
      ? { police_siren: POLICE_CAR_AUDIO_CONFIG }
      : {}),
    ...(sessionMechanismTypes.has(MECHANISM_TYPES.turnVehicle)
      ? { turn_vehicle_complete: TURN_VEHICLE_AUDIO_CONFIG }
      : {}),
    ...(sessionMechanismTypes.has(MECHANISM_TYPES.hiddenVehicle)
      ? { hidden_vehicle_reveal: HIDDEN_VEHICLE_AUDIO_CONFIG }
      : {}),
    ...(sessionMechanismTypes.has(MECHANISM_TYPES.fireTruck)
      ? {
        firetruck_start: FIRE_TRUCK_START_AUDIO_CONFIG,
        firetruck_fail: FIRE_TRUCK_FAIL_AUDIO_CONFIG
      }
      : {}),
    ...(sessionMechanismTypes.has(MECHANISM_TYPES.garage)
      ? {
        garage_out: GARAGE_OUT_AUDIO_CONFIG,
        garage_clear: GARAGE_CLEAR_AUDIO_CONFIG
      }
      : {}),
    ...(sessionMechanismTypes.has(MECHANISM_TYPES.randomPlayableAudio)
      ? RANDOM_PLAYABLE_AUDIO_CONFIGS
      : {})
  });
  audio.resetEventHistory();
  randomPlayableAudioScheduler = new RandomPlayableAudioScheduler({
    getConfig: () => SCENE_TUNING.randomPlayableAudio ?? {},
    play: (clip, volume) => audio.play(clip.audioName, null, volume)
  });
  const endPanel = $('#end-panel');
  let pressTimer = 0;
  let pressed = false;
  let gameOverActive = false;
  let spatialEditorActive = false;
  let spatialPointEditor = null;
  let levelLayoutEditor = null;
  let unsubscribeGame = () => {};
  const gameOverTimers = new Set();
  const INSTALL_GATE_VEHICLE_STATES = new Set(['at-spot', 'boarding-final', 'departing', 'done']);
  const configuredForegroundVideo = SCENE_TUNING.foregroundVideo ?? {};
  const packagedForegroundVideoSource = globalThis.__BUS_LOOP_FOREGROUND_VIDEO_ASSET__;
  const foregroundVideoSource = configuredForegroundVideo.enabled && configuredForegroundVideo.selected
    ? (typeof packagedForegroundVideoSource === 'string' && packagedForegroundVideoSource
        ? packagedForegroundVideoSource
        : (import.meta.env.DEV
            ? `/assets/playable/foreground-videos/${encodeURIComponent(configuredForegroundVideo.selected)}`
            : ''))
    : '';
  const packagedForegroundTransitionSource = globalThis.__BUS_LOOP_FOREGROUND_TRANSITION_ASSET__;
  const foregroundTransitionSource = foregroundVideoSource
    && configuredForegroundVideo.transitionEnabled !== 0
    && configuredForegroundVideo.transitionSelected
    ? (typeof packagedForegroundTransitionSource === 'string' && packagedForegroundTransitionSource
        ? packagedForegroundTransitionSource
        : (import.meta.env.DEV
            ? `/assets/playable/foreground-videos/${encodeURIComponent(configuredForegroundVideo.transitionSelected)}`
            : ''))
    : '';
  let foregroundVideoBlocking = Boolean(foregroundVideoSource);

  function updateLoadingProgress(progress) {
    const percent = Math.max(0, Math.min(100, Math.round((Number(progress) || 0) * 100)));
    if (loadingProgressBar) loadingProgressBar.style.width = `${percent}%`;
    if (loadingProgressValue) loadingProgressValue.textContent = `${percent}%`;
    loadingProgress?.setAttribute('aria-valuenow', String(percent));
  }

  updateLoadingProgress(0);
  const markInstallVehicle = (vehicleId) => {
    return levelSession.recordSuccessfulVehicle(vehicleId, getSuccessfulOperationThreshold());
  };

  const handleVehicleClick = (vehicleId) => {
    if (foregroundVideoBlocking) return { ok: false, reason: 'foreground-video-playing' };
    const result = game.clickVehicle(vehicleId);
    if (result?.ok) {
      randomPlayableAudioScheduler?.activate();
      if (markInstallVehicle(vehicleId)) InstallFullGame();
    }
    return result;
  };

  const view = new SceneView(
    canvas,
    handleVehicleClick,
    {
      onPassengerAboard: () => audio.playPassengerUp(),
      onLoadingProgress: updateLoadingProgress
    }
  );
  const updateCtaPosition = () => {
    view.resize();
    drawForegroundVideoBackdrop();
    syncFireTruckHudBounds(view);
    applyGameOverTuning();
    applyCtaTuning(view);
    applyBrandingTuning(view.getBackgroundCanvasBounds());
    applyPassengerEmojiTuning();
  };
  updateCtaPosition();
  document.fonts?.load?.('700 16px "Poppins Branding"')
    .then(() => {
      applyBrandingTuning(view.getBackgroundCanvasBounds());
      applyPassengerEmojiTuning();
    })
    .catch(() => {});
  if ('ResizeObserver' in window && stage) {
    new ResizeObserver(updateCtaPosition).observe(stage);
  } else {
    window.addEventListener('resize', updateCtaPosition);
  }
  let loadingScreenDismissed = false;
  function dismissLoadingScreen() {
    if (loadingScreenDismissed) return;
    loadingScreenDismissed = true;
    loadingScreen?.classList.add('is-hidden');
    window.setTimeout(() => loadingScreen?.remove(), 360);
  }

  function resetForegroundVideoElement() {
    if (!foregroundVideo) return;
    foregroundVideo.pause();
    foregroundVideo.removeAttribute('src');
    foregroundVideo.load();
    if (foregroundVideoBackdrop) {
      const context = foregroundVideoBackdrop.getContext('2d');
      context?.clearRect(0, 0, foregroundVideoBackdrop.width, foregroundVideoBackdrop.height);
      foregroundVideoBackdrop.width = 1;
      foregroundVideoBackdrop.height = 1;
    }
    if (foregroundVideoOverlay) {
      foregroundVideoOverlay.hidden = true;
      foregroundVideoOverlay.classList.remove('is-ending');
    }
  }

  function resetForegroundTransitionElement() {
    if (!foregroundTransitionVideo) return;
    foregroundTransitionVideo.pause();
    foregroundTransitionVideo.removeAttribute('src');
    foregroundTransitionVideo.load();
    foregroundTransitionVideo.hidden = true;
  }

  function drawForegroundVideoBackdrop() {
    if (
      !foregroundVideo
      || !foregroundVideoBackdrop
      || foregroundVideo.readyState < HTMLMediaElement.HAVE_CURRENT_DATA
      || !foregroundVideo.videoWidth
      || !foregroundVideo.videoHeight
    ) {
      return;
    }
    const bounds = foregroundVideoOverlay?.getBoundingClientRect();
    const cssWidth = Math.max(1, bounds?.width ?? foregroundVideo.clientWidth);
    const cssHeight = Math.max(1, bounds?.height ?? foregroundVideo.clientHeight);
    const resolutionScale = Math.min(
      window.devicePixelRatio || 1,
      1280 / Math.max(cssWidth, cssHeight)
    );
    const width = Math.max(1, Math.round(cssWidth * resolutionScale));
    const height = Math.max(1, Math.round(cssHeight * resolutionScale));
    if (foregroundVideoBackdrop.width !== width) foregroundVideoBackdrop.width = width;
    if (foregroundVideoBackdrop.height !== height) foregroundVideoBackdrop.height = height;

    const sourceWidth = foregroundVideo.videoWidth;
    const sourceHeight = foregroundVideo.videoHeight;
    const targetAspect = width / height;
    const sourceAspect = sourceWidth / sourceHeight;
    let cropX = 0;
    let cropY = 0;
    let cropWidth = sourceWidth;
    let cropHeight = sourceHeight;
    if (sourceAspect > targetAspect) {
      cropWidth = sourceHeight * targetAspect;
      cropX = (sourceWidth - cropWidth) / 2;
    } else {
      cropHeight = sourceWidth / targetAspect;
      cropY = (sourceHeight - cropHeight) / 2;
    }
    const context = foregroundVideoBackdrop.getContext('2d', { alpha: false });
    if (!context) return;
    context.drawImage(
      foregroundVideo,
      cropX,
      cropY,
      cropWidth,
      cropHeight,
      0,
      0,
      width,
      height
    );
  }

  function waitForForegroundVideoReady(source) {
    return new Promise((resolve) => {
      if (!foregroundVideo || !foregroundVideoOverlay || !source) {
        resolve(false);
        return;
      }
      let settled = false;
      const finish = (ready) => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timeout);
        foregroundVideo.removeEventListener('loadeddata', handleReady);
        foregroundVideo.removeEventListener('error', handleError);
        resolve(ready);
      };
      const handleReady = () => finish(true);
      const handleError = () => finish(false);
      const timeout = window.setTimeout(() => finish(false), 8000);
      foregroundVideo.defaultMuted = true;
      foregroundVideo.muted = true;
      foregroundVideo.volume = 0;
      foregroundVideo.playsInline = true;
      foregroundVideo.addEventListener('loadeddata', handleReady, { once: true });
      foregroundVideo.addEventListener('error', handleError, { once: true });
      foregroundVideo.src = source;
      foregroundVideo.load();
    });
  }

  function waitForForegroundTransitionReady(source) {
    return new Promise((resolve) => {
      if (!foregroundTransitionVideo || !source) {
        resolve(false);
        return;
      }
      let settled = false;
      const finish = (ready) => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timeout);
        foregroundTransitionVideo.removeEventListener('loadeddata', handleReady);
        foregroundTransitionVideo.removeEventListener('error', handleError);
        resolve(ready);
      };
      const handleReady = () => finish(true);
      const handleError = () => finish(false);
      const timeout = window.setTimeout(() => finish(false), 5000);
      foregroundTransitionVideo.defaultMuted = true;
      foregroundTransitionVideo.muted = true;
      foregroundTransitionVideo.volume = 0;
      foregroundTransitionVideo.playsInline = true;
      foregroundTransitionVideo.addEventListener('loadeddata', handleReady, { once: true });
      foregroundTransitionVideo.addEventListener('error', handleError, { once: true });
      foregroundTransitionVideo.src = source;
      foregroundTransitionVideo.load();
    });
  }

  async function playForegroundTransition(readyPromise) {
    const ready = await readyPromise;
    if (!ready || !foregroundTransitionVideo) {
      resetForegroundTransitionElement();
      return false;
    }

    foregroundTransitionVideo.hidden = false;
    foregroundTransitionVideo.currentTime = 0;
    let finishPlayback;
    const playbackFinished = new Promise((resolve) => { finishPlayback = resolve; });
    const handleFinished = () => finishPlayback();
    foregroundTransitionVideo.addEventListener('ended', handleFinished, { once: true });
    foregroundTransitionVideo.addEventListener('error', handleFinished, { once: true });
    try {
      foregroundTransitionVideo.defaultMuted = true;
      foregroundTransitionVideo.muted = true;
      foregroundTransitionVideo.volume = 0;
      await foregroundTransitionVideo.play();
      const durationMs = Number.isFinite(foregroundTransitionVideo.duration)
        ? Math.min(15000, Math.max(3000, (foregroundTransitionVideo.duration + 1) * 1000))
        : 15000;
      await Promise.race([
        playbackFinished,
        new Promise((resolve) => window.setTimeout(resolve, durationMs))
      ]);
    } catch (error) {
      console.warn('Muted foreground transition could not autoplay; continuing to gameplay.', error);
    } finally {
      foregroundTransitionVideo.removeEventListener('ended', handleFinished);
      foregroundTransitionVideo.removeEventListener('error', handleFinished);
      resetForegroundTransitionElement();
    }
    return true;
  }

  async function playForegroundVideoIntro(source, transitionSource, sceneReady) {
    const transitionReady = waitForForegroundTransitionReady(transitionSource);
    const ready = await waitForForegroundVideoReady(source);
    if (!ready || !foregroundVideo || !foregroundVideoOverlay) {
      resetForegroundVideoElement();
      resetForegroundTransitionElement();
      await sceneReady;
      dismissLoadingScreen();
      return false;
    }

    foregroundVideoOverlay.hidden = false;
    foregroundVideoOverlay.classList.remove('is-ending');
    const fadeOutSeconds = Math.min(
      3,
      Math.max(0, Number(SCENE_TUNING.foregroundVideo?.fadeOutSeconds) || 0)
    );
    foregroundVideoOverlay.style.setProperty('--foreground-video-fade-duration', `${fadeOutSeconds}s`);
    drawForegroundVideoBackdrop();
    dismissLoadingScreen();
    await new Promise((resolve) => window.setTimeout(resolve, 340));

    let finishPlayback;
    const playbackFinished = new Promise((resolve) => { finishPlayback = resolve; });
    const handleFinished = () => finishPlayback();
    foregroundVideo.addEventListener('ended', handleFinished, { once: true });
    foregroundVideo.addEventListener('error', handleFinished, { once: true });
    try {
      foregroundVideo.defaultMuted = true;
      foregroundVideo.muted = true;
      foregroundVideo.volume = 0;
      await foregroundVideo.play();
      const durationMs = Number.isFinite(foregroundVideo.duration)
        ? Math.min(65000, Math.max(5000, (foregroundVideo.duration + 2) * 1000))
        : 65000;
      await Promise.race([
        playbackFinished,
        new Promise((resolve) => window.setTimeout(resolve, durationMs))
      ]);
    } catch (error) {
      console.warn('Muted foreground video could not autoplay; continuing to gameplay.', error);
    } finally {
      foregroundVideo.removeEventListener('ended', handleFinished);
      foregroundVideo.removeEventListener('error', handleFinished);
    }

    // Keep the last video frame covering the stage if scene assets take longer
    // than the intro, so the fully initialized level is revealed in one step.
    await sceneReady;
    foregroundVideoOverlay.classList.add('is-ending');
    const transitionDelaySeconds = Math.min(
      3,
      Math.max(0, Number(SCENE_TUNING.foregroundVideo?.transitionDelaySeconds) || 0)
    );
    const transitionPlayback = transitionSource
      ? (async () => {
          await new Promise((resolve) => window.setTimeout(resolve, transitionDelaySeconds * 1000));
          return playForegroundTransition(transitionReady);
        })()
      : Promise.resolve(false);
    await new Promise((resolve) => window.setTimeout(resolve, fadeOutSeconds * 1000));
    resetForegroundVideoElement();
    await transitionPlayback;
    return true;
  }

  const sceneReady = (view.ready ?? Promise.resolve()).catch(() => {});
  void sceneReady.then(() => updateLoadingProgress(1));
  void (async () => {
    if (foregroundVideoSource) {
      await playForegroundVideoIntro(foregroundVideoSource, foregroundTransitionSource, sceneReady);
    } else {
      await sceneReady;
      dismissLoadingScreen();
    }
    foregroundVideoBlocking = false;
    startPassengerEmojiAnimation();
    view.showEntryBanner?.();
  })();
  function initializeGameQueues({ resetSlots = false } = {}) {
    game.initializeQueues(
      view.getQueueCapacities(),
      view.getQueueSpacing(),
      view.getQueueLengths(),
      view.getConveyorPathLength(),
      { ...view.getConveyorConfig(), resetSlots }
    );
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
      let baseLevel = getLevelDefinition(SCENE_TUNING.level?.selected);
      const previewDocument = readLevelEditorPreviewDocument();
      if (previewDocument) {
        const { levelDocumentToRuntime } = await import('./level-editor-model.js');
        baseLevel = levelDocumentToRuntime(previewDocument, baseLevel);
      }
      levelLayoutEditor = await createLevelLayoutEditor({
        baseLevel,
        onPreview: () => window.location.reload(),
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
          const webDocument = await readSavedWebLevelDocument(next.level.selected);
          if (webDocument) {
            localStorage.setItem(LEVEL_EDITOR_PREVIEW_STORAGE_KEY, JSON.stringify(webDocument));
          } else {
            const response = await fetch('/__playable-level', {
              method: 'POST',
              headers: { 'Content-Type': 'text/plain' },
              body: next.level.selected
            });
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            localStorage.removeItem(LEVEL_EDITOR_PREVIEW_STORAGE_KEY);
          }
          saveTuning(next, { immediate: true });
          window.location.reload();
        } catch (error) {
          console.warn('Could not load the selected playable level.', error);
          editor.sync();
        }
      })();
      return next;
    }
    if (path?.startsWith('branding.')) {
      deepMerge(SCENE_TUNING, next);
      applyBrandingTuning(view.getBackgroundCanvasBounds());
      saveTuning(SCENE_TUNING);
      if (syncEditor) editor.sync();
      return SCENE_TUNING;
    }
    if (path?.startsWith('passengerEmoji.')) {
      deepMerge(SCENE_TUNING, next);
      updatePassengerEmojiAutoHide(view.lastSnapshot, levelSession.state().levelKey);
      applyPassengerEmojiTuning();
      saveTuning(SCENE_TUNING);
      if (syncEditor) editor.sync();
      return SCENE_TUNING;
    }
    if (path?.startsWith('foregroundVideo.')) {
      const wasForegroundVideoActive = Boolean(
        SCENE_TUNING.foregroundVideo?.enabled && SCENE_TUNING.foregroundVideo?.selected
      );
      deepMerge(SCENE_TUNING, next);
      const isForegroundVideoActive = Boolean(
        SCENE_TUNING.foregroundVideo?.enabled && SCENE_TUNING.foregroundVideo?.selected
      );
      if (wasForegroundVideoActive !== isForegroundVideoActive || path === 'foregroundVideo.selection') {
        game.reset();
        initializeGameQueues({ resetSlots: true });
        applyIdleSpeedMultiplier();
      }
      saveTuning(SCENE_TUNING);
      if (syncEditor) editor.sync();
      return SCENE_TUNING;
    }
    const materialOnly = isPassengerMaterialTuningPath(path);
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
    if (syncEditor) editor.sync();
    return tuning;
  }

  for (const [key, element] of Object.entries(brandingItems)) {
    bindBrandingDrag(element, key, (x, y) => {
      const next = structuredClone(SCENE_TUNING);
      next.branding[key].x = Math.round(x);
      next.branding[key].y = Math.round(y);
      applyTuningPatch(next, { path: `branding.${key}.position`, syncEditor: true });
    });
  }
  bindBrandingDrag(passengerEmoji, 'passengerEmoji', (x, y) => {
    const next = structuredClone(SCENE_TUNING);
    next.passengerEmoji.x = Math.round(x);
    next.passengerEmoji.y = Math.round(y);
    applyTuningPatch(next, { path: 'passengerEmoji.position', syncEditor: true });
  });

  if (EDITOR_ENABLED && sceneEditorRoot) {
    import('./scene-editor.js').then(({ createSceneEditor }) => {
      editor = createSceneEditor(sceneEditorRoot, {
        getTuning: () => SCENE_TUNING,
        defaultTuning: DEFAULT_SCENE_TUNING,
        setTuning: applyTuningPatch,
        clearSavedTuning,
        openSpatialPointEditor,
        openLevelLayoutEditor
      });
    }).catch((error) => {
      console.warn('Scene editor could not be loaded.', error);
    });
  } else {
    sceneEditorRoot?.remove();
  }

  function syncHud(state) {
    audio.handleGameEvent(state.lastEvent, state.time);
    updatePassengerEmojiAutoHide(state, levelSession.state().levelKey);
    updateFireTruckHud(state.mechanicState?.fireTruck, view);
    updateInstallGate(state);
    if (state.status === 'lost') {
      endPanel.hidden = true;
        showResultOverlay(
          state.lastEvent.reason === 'ambulance-exceed-step' || state.lastEvent.reason === 'firetruck-timeout'
            ? 'Vehicle Failed'
            : 'Game Over'
        );
      return;
    }
    if (state.status === 'won') {
      endPanel.hidden = true;
      const nextLevel = levelSession.advanceAfterWin();
      if (nextLevel) {
        unsubscribeGame();
        setActiveLevel(nextLevel);
        game = new BusLoopGame(nextLevel);
        startPassengerEmojiAnimation();
        randomPlayableAudioScheduler?.reset();
        audio.resetEventHistory();
        view.replaceActiveLevel({ animate: true });
        initializeGameQueues({ resetSlots: true });
        applyIdleSpeedMultiplier();
        unsubscribeGame = game.subscribe(syncHud);
        return;
      }
      showResultOverlay('You Win!');
    }
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

  function showResultOverlay(title = 'Game Over') {
    if (!gameOverOverlay || gameOverActive) return;
    gameOverActive = true;
    clearGameOverTimers();
    applyGameOverTuning();
    if (gameOverTitle) gameOverTitle.textContent = title;
    if (ctaButton) ctaButton.dataset.gameOverVisible = '1';
    applyCtaTuning(view);
    gameOverOverlay.hidden = false;
    gameOverOverlay.classList.remove('is-active', 'is-title-fading', 'is-cta-ready');
    void gameOverOverlay.offsetWidth;
    gameOverOverlay.classList.add('is-active');

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
    if (ctaButton) {
      ctaButton.dataset.gameOverVisible = '0';
      applyCtaTuning(view);
    }
  }

  unsubscribeGame = game.subscribe(syncHud);
  function reset() {
    endPanel.hidden = true;
    hideGameOver();
    unsubscribeGame();
    const initialLevel = levelSession.reset();
    setActiveLevel(initialLevel);
    game = new BusLoopGame(initialLevel);
    startPassengerEmojiAnimation();
    randomPlayableAudioScheduler?.reset();
    audio.resetEventHistory();
    view.replaceActiveLevel();
    initializeGameQueues({ resetSlots: true });
    applyIdleSpeedMultiplier();
    unsubscribeGame = game.subscribe(syncHud);
  }
  $('#reset-button')?.addEventListener('click', reset);
  $('#end-reset-button').addEventListener('click', reset);
  ctaButton?.addEventListener('click', (event) => {
    event.stopPropagation();
    InstallFullGame();
  });
  canvas.addEventListener('pointerdown', (event) => {
    if (foregroundVideoBlocking) {
      event.stopImmediatePropagation();
      return;
    }
    if (spatialEditorActive) return;
    if (levelSession.shouldOpenStore()) {
      event.stopImmediatePropagation();
      InstallFullGame();
      return;
    }
  }, { capture: true });
  canvas.addEventListener('pointerdown', () => {
    if (spatialEditorActive || foregroundVideoBlocking) return;
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
    window.addEventListener('blur', () => {
      release();
      game.setApplicationFocus(false);
    });
    window.addEventListener('focus', () => game.setApplicationFocus(true));
    document.addEventListener('visibilitychange', () => {
      game.setApplicationFocus(document.visibilityState === 'visible');
    });
  window.addEventListener('beforeunload', flushTuningSave);

  let previous = performance.now();
  function frame(now) {
    const delta = (now - previous) / 1000;
    previous = now;
    if (!spatialEditorActive && !foregroundVideoBlocking) game.update(delta);
    const renderState = isSpatialOptimizationEnabled('liveRenderState')
      ? game.renderState()
      : game.snapshot();
    view.update(renderState, game);
    view.render();
    updatePassengerEmojiFrame(now);
    randomPlayableAudioScheduler?.update(now);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  window.__busLoop = {
    get game() { return game; },
    get view() { return view; },
    tuning: SCENE_TUNING,
    setTuning: (patch, { path } = {}) => {
      return applyTuningPatch(patch, { path, syncEditor: true });
    },
    exportTuning: () => JSON.stringify(SCENE_TUNING, null, 2),
    saveTuning: () => saveTuning(SCENE_TUNING, { immediate: true }),
    clearSavedTuning,
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
    reset
  };
}

waitForMraidReady(startRuntime);



