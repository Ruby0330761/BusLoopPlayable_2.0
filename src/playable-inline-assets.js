import { DEPARTURE_STAR_TEXTURE, DEPARTURE_TRAIL_TEXTURE, withVehicleEffectAssets } from './vehicle-effect-assets.js';
import {
  GUIDE_HAND_ART, CTA_BUTTON_ART, RETRY_BUTTON_ASSET_PATH, SPEED_TOGGLE_ASSET_PATHS,
  PRE_ROLL_ASSET_PATHS,
  PROGRESS_HUD_ASSET_PATHS,
  getMechanismResourcePaths,
  getMechanismTypesForLevels
} from './mechanism-resources.js';
import { mergeStageTuning } from './playable-session-config.js';
import { getSpeedToggleAssetPaths } from './speed-toggle.js';
import { getComboAssets } from './combo-hud.js';
import { COUNTDOWN_SIREN_ASSET, COUNTDOWN_TIMER_ASSET } from './countdown.js';
import { getStaminaAssetPaths } from './stamina.js';
import { resolveLevelAudioConfig } from './level-audio-config.js';
import { isPreRollAssetPath, resolvePreRollAsset } from './pre-roll.js';

const ASSET_URL_PATTERN = /\/assets\/[^\s"'`<>)]*/gu;

// Asset URLs reach the packager from three directions: level documents, the
// tuning literal, and the built HTML/CSS. All three are plain nested values, so
// one recursive walk over a JSON-ish shape is enough to find every reference.
export function collectAssetUrls(value, output = new Set()) {
  if (typeof value === 'string') {
    for (const match of value.matchAll(ASSET_URL_PATTERN)) {
      output.add(match[0].replace(/[),.;]+$/u, ''));
    }
    return output;
  }
  if (Array.isArray(value)) {
    value.forEach((entry) => collectAssetUrls(entry, output));
    return output;
  }
  if (value && typeof value === 'object') {
    Object.values(value).forEach((entry) => collectAssetUrls(entry, output));
  }
  return output;
}

// Unity level documents carry `assets.loopScene` from the catalog extraction, but
// nothing reads it any more: the renderer draws the belt from
// `conveyorLayout.assets.loopScene` (see `getSelectedConveyorLayout`). Walking it
// inlined a second belt image in every package — and for a level authored on one
// layout but exported on another, a belt the ad can never draw. The selected
// layout's art is added from `CONVEYOR_LAYOUT_ART_PATHS` instead.
function withoutDeadLevelArt(level) {
  if (!level?.assets) return level;
  const { loopScene, background, colorTextures, ...liveAssets } = level.assets;
  return { ...level, assets: liveAssets };
}

export function getReachableStageArt(tuning, stages = [], choices = []) {
  const options = choices.flatMap(choice => choice?.options ?? []);
  const reachable = [...(stages.length ? stages : [{}]), ...options];
  return {
    openingHandEnabled: reachable.some(stage => {
      const guide = mergeStageTuning(tuning.firstClickGuide, stage.opening?.firstClickGuide);
      return Number(guide.enabled) === 1 && Number(guide.durationSeconds) > 0;
    }) || choices.some(choice => choice?.options?.[choice.handIndex]),
    entryBanners: reachable.map(stage => mergeStageTuning(tuning.entryBanner, stage.opening?.entryBanner))
      .filter(banner => Number(banner.enabled)),
    conveyorLayouts: [...new Set(reachable.map(stage => stage.scene?.conveyorLayout || tuning.conveyorLayout?.selected).filter(Boolean))],
    backgrounds: [...new Set(reachable.map(stage => stage.scene?.background || tuning.background?.asset || stage.level?.assets?.background).filter(Boolean))],
    choiceOptionImages: options.map(option => option.image).filter(Boolean)
  };
}

// Which assets a single-file playable actually inlines. The export packager
// needs this to build the asset map; the editor's preflight needs the same list
// so the size it reports is the size the exporter will produce. Keeping one
// implementation is what stops the two from drifting apart — an editor check
// that quietly measures a different set is worse than no check at all.
//
// Callers pass the whole reachable level set (`levels`) and the whole reachable
// track selection, because a stitched session ships art for every stage it can
// show, not only the one on screen.
export function collectPlayableInlineAssetUrls({
  tuning = {},
  levels = [],
  activeSession = null,
  spatialSelection = null,
  entryBanners = Number(tuning.entryBanner?.enabled) ? [tuning.entryBanner] : [],
  backgrounds = [tuning.background?.asset ?? levels[0]?.assets?.background],
  conveyorLayouts = [],
  choiceOptionImages = [],
  openingHandEnabled = Number(tuning.firstClickGuide?.enabled) === 1 && Number(tuning.firstClickGuide?.durationSeconds) > 0,
  extraUrls = []
} = {}) {
  const urls = new Set();
  const hand = tuning.vehicleGuideHand;
  if (openingHandEnabled || (Number(hand?.enabled) === 1 && (!hand.levelKey || levels.some(level => level.key === hand.levelKey)))) {
    urls.add(GUIDE_HAND_ART);
  }
  if (Number(tuning.cta?.enabled ?? 1)) urls.add(CTA_BUTTON_ART);
  // The progress HUD's three marker bitmaps (~193 KB) are only inlined for a
  // build that actually turns the HUD on. Inlining them unconditionally bloated
  // every delivery and, worse, made the runtime gate report missing assets for a
  // package whose tuning had the HUD disabled.
  if (Number(tuning.progressHud?.enabled) === 1) {
    for (const asset of PROGRESS_HUD_ASSET_PATHS) urls.add(asset);
  }
  if (Number(tuning.countdown?.enabled) === 1) urls.add(COUNTDOWN_TIMER_ASSET);
  // The siren is a separate ~12 KB clip and only belongs in a build whose clock
  // was explicitly asked to loop it.
  if (Number(tuning.countdown?.enabled) === 1
    && Number(tuning.countdown?.sirenEnabled) === 1) {
    urls.add(COUNTDOWN_SIREN_ASSET);
  }
  for (const asset of getStaminaAssetPaths(tuning.stamina)) urls.add(asset);
  for (const asset of getComboAssets(tuning.combo)) urls.add(asset);
  // A session can disable the pre-roll, and the runtime applies that by zeroing
  // the tuning flag. Reading the raw `tuning.preRoll.enabled` here inlined a
  // 519 KB MP4 the runtime never played, so the session has to be consulted in
  // the same place the runtime consults it.
  const selectedPreRollAsset = resolvePreRollAsset(tuning.preRoll, activeSession);
  if (selectedPreRollAsset && (
    PRE_ROLL_ASSET_PATHS.includes(selectedPreRollAsset)
    || isPreRollAssetPath(selectedPreRollAsset)
  )) {
    urls.add(selectedPreRollAsset);
  }
  for (const level of levels) collectAssetUrls(withoutDeadLevelArt(withVehicleEffectAssets(level)), urls);
  // The BGM is addressed from tuning, not from a level document, so the plain
  // URL collection above never sees it. Missing it ships a silently dead loop:
  // the runtime requests a root-relative path that does not exist in the
  // single-file ad and only logs a warning.
  if (Number(tuning.audio?.bgm?.enabled) && tuning.audio?.bgm?.asset) {
    urls.add(tuning.audio.bgm.asset);
  }
  // Guide-stage media is addressed from tuning too: the weather sprite and one
  // image per free-placed layer. Neither appears in a level document, so the
  // plain URL collection above never sees them and every one of them used to
  // ship as the 1-byte octet-stream placeholder — the overlays silently drew
  // nothing while the static and runtime gates still passed.
  if (Number(tuning.weatherEffect?.enabled) && tuning.weatherEffect?.sprite) {
    urls.add(tuning.weatherEffect.sprite);
  }
  for (const layer of tuning.freeAssets?.layers ?? []) {
    if (layer?.asset && Number(layer.visible ?? 1) === 1) urls.add(layer.asset);
  }
  // Picker art is not part of a level document, so it needs its own pass.
  for (const image of choiceOptionImages) {
    if (typeof image === 'string' && image) urls.add(image);
  }
  collectAssetUrls({
    backgrounds,
    icon: tuning.branding?.icon?.asset,
    // One Bus build serves both stores and swaps its icon from the device UA, so
    // every per-device icon has to be inlined. Taking only `icon.asset` shipped
    // the iOS half with a root-relative image URL that resolves to nothing
    // inside a single-file ad.
    iconDeviceAssets: Object.values(tuning.branding?.icon?.deviceAssets ?? {}),
    logo: tuning.branding?.logo?.asset
  }, urls);
  const mechanismTypes = getMechanismTypesForLevels(levels, {
    spatialSelection,
    entryBannerEnabled: entryBanners.length > 0
  });
  for (const assetUrl of getMechanismResourcePaths(mechanismTypes, { conveyorLayouts, entryBanners })) {
    urls.add(assetUrl);
  }
  // The runtime completes a level's sound list from the canonical table, so a
  // clip a level document does not name can still be requested at playback.
  // Inlining only what the documents list would leave that fallback pointing at
  // a root-relative URL that does not exist inside a single-file ad.
  for (const level of levels) collectAssetUrls(resolveLevelAudioConfig(level.assets?.audio), urls);
  for (const url of extraUrls) {
    if (typeof url === 'string' && url) urls.add(url);
  }
  // Level and shell references must not reintroduce art for an inactive control.
  if (tuning.gameOver?.retryEnabled) urls.add(RETRY_BUTTON_ASSET_PATH);
  else urls.delete(RETRY_BUTTON_ASSET_PATH);
  for (const asset of SPEED_TOGGLE_ASSET_PATHS) urls.delete(asset);
  for (const asset of getSpeedToggleAssetPaths(tuning.speedToggle)) urls.add(asset);
  if (!Number(tuning.effects?.departureStars?.enabled)) {
    urls.delete(DEPARTURE_STAR_TEXTURE);
    urls.delete(DEPARTURE_TRAIL_TEXTURE);
  }
  return urls;
}
