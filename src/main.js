import './styles.css';
import { BusLoopGame } from './game-model.js';
import { PLAYABLE_LEVEL_SEQUENCE } from './generated-active-level.js';
import { LEVEL_1, setActiveLevel } from './level-data.js';
import { createLevelSession } from './level-session.js';
import { SceneView } from './scene-view.js';
import { SCENE_TUNING } from './scene-tuning.js';
import { createGameAudioController } from './audio-controller.js';

const TUNING_STORAGE_KEY = 'bus-loop-scene-tuning-v3';
const LEGACY_TUNING_STORAGE_KEY = 'bus-loop-scene-tuning-v2';
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
const gameOverOverlay = $('#game-over-overlay');
const gameOverTitle = $('#game-over-title');
const ctaButton = $('#cta-button');
const sceneEditorRoot = EDITOR_ENABLED ? $('#scene-editor') : null;
const PASSENGER_MATERIAL_TUNING_PREFIX = 'passengerMaterial.';
const PASSENGER_MATERIAL_COLOR_INDEX_PATTERN = /^passengerMaterial\.(?:solidColors|colors)\.(\d+)(?:\.|$)/;
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
      const level16PackageMigrated = migrateLevel16PackageTuning(savedTuning);
      const level10PackageMigrated = migrateLevel10PackageTuning(savedTuning);
      const level12PackageMigrated = migrateLevel12PackageTuning(savedTuning);
      deepMerge(SCENE_TUNING, savedTuning);
      migrateLegacyConveyorTuning(savedTuning);
      if (guideHandMotionMigrated || level16PackageMigrated || level10PackageMigrated || level12PackageMigrated) {
        localStorage.setItem(TUNING_STORAGE_KEY, JSON.stringify(savedTuning));
      }
      return;
    }
    const legacySaved = localStorage.getItem(LEGACY_TUNING_STORAGE_KEY);
    if (!legacySaved) return;
    const legacy = JSON.parse(legacySaved);
    migrateGuideHandMotionTuning(legacy);
    migrateLevel16PackageTuning(legacy);
    migrateLevel10PackageTuning(legacy);
    migrateLevel12PackageTuning(legacy);
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

function getGameOverTitleFontFamily(value) {
  const fonts = {
    rounded: '"Arial Rounded MT Bold", "Arial Black", "Trebuchet MS", system-ui, sans-serif',
    impact: 'Impact, "Arial Narrow", sans-serif',
    system: 'Inter, system-ui, sans-serif'
  };
  return fonts[value] ?? fonts.rounded;
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
  gameOverOverlay.style.setProperty('--game-over-title-font-family', getGameOverTitleFontFamily(gameOver.titleFont));
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

async function startRuntime() {
  loadSavedTuning();
  let sessionLevels = PLAYABLE_LEVEL_SEQUENCE;
  if (EDITOR_ENABLED) {
    const { getLevelDefinition } = await import('./level-catalog.js');
    const selectedLevel = getLevelDefinition(SCENE_TUNING.level?.selected);
    sessionLevels = selectedLevel.key === 'level9'
      ? [selectedLevel, getLevelDefinition('level7')]
      : [selectedLevel];
  }
  const levelSession = createLevelSession(sessionLevels);
  setActiveLevel(levelSession.currentLevel());
  applyPreviewFrame();

  let game = new BusLoopGame(levelSession.currentLevel());
  audio = createGameAudioController(LEVEL_1.assets.audio);
  const endPanel = $('#end-panel');
  let pressTimer = 0;
  let pressed = false;
  let gameOverActive = false;
  let unsubscribeGame = () => {};
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
    return levelSession.recordSuccessfulVehicle(vehicleId, getSuccessfulOperationThreshold());
  };

  const handleVehicleClick = (vehicleId) => {
    const result = game.clickVehicle(vehicleId);
    if (result?.ok && markInstallVehicle(vehicleId)) InstallFullGame();
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
    applyGameOverTuning();
    applyCtaTuning(view);
  };
  updateCtaPosition();
  if ('ResizeObserver' in window && stage) {
    new ResizeObserver(updateCtaPosition).observe(stage);
  } else {
    window.addEventListener('resize', updateCtaPosition);
  }
  view.ready?.finally(() => {
    updateLoadingProgress(1);
    loadingScreen?.classList.add('is-hidden');
    window.setTimeout(() => loadingScreen?.remove(), 360);
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
  initializeGameQueues();
  let editor = { sync: () => {} };

  function applyTuningPatch(next, { path, syncEditor = false } = {}) {
    if (path === 'level.selected') {
      saveTuning(next, { immediate: true });
      fetch('/__playable-level', {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain' },
        body: next.level.selected
      }).catch((error) => {
        console.warn('Could not persist the selected playable level.', error);
      }).finally(() => window.location.reload());
      return next;
    }
    const materialOnly = isPassengerMaterialTuningPath(path);
    const colorIndex = getPassengerMaterialColorIndex(path);
    const tuning = view.setTuning(next, { mode: materialOnly ? 'passengerMaterial' : 'full', colorIndex });
    if (!materialOnly) {
      const layoutChanged = path === 'conveyorLayout.selected';
      if (layoutChanged) game.reset();
      initializeGameQueues({ resetSlots: layoutChanged });
      applyPreviewFrame();
      updateCtaPosition();
    }
    saveTuning(tuning);
    if (syncEditor) editor.sync();
    return tuning;
  }

  if (EDITOR_ENABLED && sceneEditorRoot) {
    import('./scene-editor.js').then(({ createSceneEditor }) => {
      editor = createSceneEditor(sceneEditorRoot, {
        getTuning: () => SCENE_TUNING,
        setTuning: applyTuningPatch,
        clearSavedTuning
      });
    }).catch((error) => {
      console.warn('Scene editor could not be loaded.', error);
    });
  } else {
    sceneEditorRoot?.remove();
  }

  function syncHud(state) {
    audio.handleGameEvent(state.lastEvent, state.time);
    updateInstallGate(state);
    if (state.status === 'lost') {
      endPanel.hidden = true;
      showResultOverlay('Game Over');
      return;
    }
    if (state.status === 'won') {
      endPanel.hidden = true;
      const nextLevel = levelSession.advanceAfterWin();
      if (nextLevel) {
        unsubscribeGame();
        setActiveLevel(nextLevel);
        game = new BusLoopGame(nextLevel);
        view.replaceActiveLevel({ animate: true });
        initializeGameQueues({ resetSlots: true });
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
    view.replaceActiveLevel();
    initializeGameQueues({ resetSlots: true });
    unsubscribeGame = game.subscribe(syncHud);
  }
  $('#reset-button')?.addEventListener('click', reset);
  $('#end-reset-button').addEventListener('click', reset);
  ctaButton?.addEventListener('click', (event) => {
    event.stopPropagation();
    InstallFullGame();
  });
  canvas.addEventListener('pointerdown', (event) => {
    if (levelSession.shouldOpenStore()) {
      event.stopImmediatePropagation();
      InstallFullGame();
      return;
    }
  }, { capture: true });
  canvas.addEventListener('pointerdown', () => {
    audio.unlock();
    pressed = true;
    clearTimeout(pressTimer);
    pressTimer = setTimeout(() => {
      if (pressed) game.setSpeedMultiplier(LEVEL_1.longPressMultiplier);
    }, LEVEL_1.longPressThreshold * 1000);
  });
  const release = () => {
    pressed = false;
    clearTimeout(pressTimer);
    game.setSpeedMultiplier(1);
  };
  window.addEventListener('pointerup', release);
  window.addEventListener('pointercancel', release);
  window.addEventListener('blur', release);
  window.addEventListener('beforeunload', flushTuningSave);

  let previous = performance.now();
  function frame(now) {
    const delta = (now - previous) / 1000;
    previous = now;
    game.update(delta);
    view.update(game.snapshot(), game);
    view.render();
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



