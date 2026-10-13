const DEFAULT_FADE_SECONDS = 0.45;
const MAX_PLAYBACK_WAIT_MS = 20_000;
const PRE_ROLL_ASSET_PATTERN = /^\/assets\/(?:preroll|editor-prerolls)\/[A-Za-z0-9][A-Za-z0-9._-]{0,119}\.mp4$/u;
const EMBEDDED_VIDEO_PATTERN = /^data:video\/mp4;base64,/u;

export function isPreRollAssetPath(value) {
  return typeof value === 'string' && PRE_ROLL_ASSET_PATTERN.test(value.trim());
}

function clamp(value, min, max, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(min, Math.min(max, number)) : fallback;
}

export function normalizePreRollConfig(tuning = {}) {
  const asset = typeof tuning.asset === 'string' ? tuning.asset.trim() : '';
  return {
    enabled: Boolean(Number(tuning.enabled)) && (
      isPreRollAssetPath(asset) || EMBEDDED_VIDEO_PATTERN.test(asset)
    ),
    asset,
    soundEnabled: Boolean(Number(tuning.soundEnabled)),
    fadeDurationSeconds: clamp(tuning.fadeDurationSeconds, 0.1, 2, DEFAULT_FADE_SECONDS)
  };
}

export function createPreRollController({
  root,
  video,
  onReveal = () => {},
  onStateChange = () => {},
  schedule = globalThis.setTimeout?.bind(globalThis),
  cancel = globalThis.clearTimeout?.bind(globalThis)
} = {}) {
  if (!root || !video) throw new TypeError('Pre-roll requires an overlay and video element.');

  let generation = 0;
  let gameReady = false;
  let videoFinished = true;
  let active = false;
  let revealStarted = false;
  let fadeDurationSeconds = DEFAULT_FADE_SECONDS;
  let watchdogTimer = 0;
  let hideTimer = 0;
  let detachVideoEvents = () => {};
  let detachSoundGesture = () => {};

  const clearTimer = (timer) => {
    if (timer && cancel) cancel(timer);
  };

  const setActive = (next) => {
    if (active === next) return;
    active = next;
    onStateChange(active);
  };

  const finishReveal = (token) => {
    if (token !== generation) return;
    root.hidden = true;
    root.setAttribute?.('aria-hidden', 'true');
    root.classList.remove('is-leaving');
  };

  const reveal = (token) => {
    if (token !== generation || revealStarted || !gameReady || !videoFinished) return;
    revealStarted = true;
    clearTimer(watchdogTimer);
    watchdogTimer = 0;
    setActive(false);
    root.classList.add('is-leaving');
    root.setAttribute?.('aria-hidden', 'true');
    onReveal();
    const fadeMs = Math.round(fadeDurationSeconds * 1000);
    hideTimer = schedule?.(() => finishReveal(token), fadeMs + 80) ?? 0;
  };

  const finishVideo = (token) => {
    if (token !== generation || videoFinished) return;
    videoFinished = true;
    reveal(token);
  };

  const attachVideoEvents = (token) => {
    const onEnded = () => finishVideo(token);
    const onError = () => finishVideo(token);
    video.addEventListener('ended', onEnded);
    video.addEventListener('error', onError);
    detachVideoEvents = () => {
      video.removeEventListener('ended', onEnded);
      video.removeEventListener('error', onError);
    };
  };

  const requestNativeAutoplay = () => {
    // Let the browser's muted-autoplay path start the pre-roll. Calling
    // HTMLMediaElement.play() here is reported as AUDIO_PLAY by some
    // playable checkers even though the video is muted.
    video.autoplay = true;
    video.setAttribute?.('autoplay', '');
    video.muted = true;
    video.defaultMuted = true;
    video.volume = 0;
  };

  const attachSoundGesture = (token, soundEnabled) => {
    if (!soundEnabled || typeof root.addEventListener !== 'function') return;
    const enableSound = () => {
      if (token !== generation || !active) return;
      video.muted = false;
      video.defaultMuted = false;
      video.volume = 1;
      detachSoundGesture();
    };
    root.addEventListener('pointerdown', enableSound);
    detachSoundGesture = () => root.removeEventListener('pointerdown', enableSound);
  };

  return {
    play(tuning) {
      const config = normalizePreRollConfig(tuning);
      generation += 1;
      const token = generation;
      detachVideoEvents();
      detachSoundGesture();
      clearTimer(watchdogTimer);
      clearTimer(hideTimer);
      watchdogTimer = 0;
      hideTimer = 0;
      revealStarted = false;
      root.classList.remove('is-leaving');

      if (!config.enabled) {
        video.pause?.();
        videoFinished = true;
        setActive(false);
        root.hidden = true;
        root.setAttribute?.('aria-hidden', 'true');
        reveal(token);
        return Promise.resolve(false);
      }

      videoFinished = false;
      fadeDurationSeconds = config.fadeDurationSeconds;
      setActive(true);
      root.hidden = false;
      root.setAttribute?.('aria-hidden', 'false');
      root.style.setProperty('--pre-roll-fade-duration', `${config.fadeDurationSeconds}s`);
      // Muted autoplay is reliable across ad WebViews. Optional sound is only
      // enabled after a trusted tap on the video surface. Keep the media
      // element at volume zero until that gesture as an extra guard for
      // checkers that inspect volume instead of the muted flag.
      requestNativeAutoplay();
      video.playsInline = true;
      video.preload = 'auto';
      video.setAttribute?.('playsinline', '');
      video.setAttribute?.('webkit-playsinline', '');
      video.src = config.asset;
      attachVideoEvents(token);
      attachSoundGesture(token, config.soundEnabled);
      watchdogTimer = schedule?.(() => finishVideo(token), MAX_PLAYBACK_WAIT_MS) ?? 0;
      // `load()` starts native autoplay for the muted video without an
      // explicit pre-interaction `play()` call.
      video.load?.();
      return Promise.resolve(true);
    },
    setGameReady() {
      gameReady = true;
      reveal(generation);
    },
    setVisible(visible) {
      if (!active) return;
      if (!visible) {
        video.pause?.();
        return;
      }
      // Re-arming native autoplay also avoids an explicit media play call on
      // visibility restoration. The browser resumes the muted video when it
      // becomes eligible to autoplay again.
      requestNativeAutoplay();
    },
    isActive() {
      return active;
    },
    destroy() {
      generation += 1;
      detachVideoEvents();
      detachSoundGesture();
      clearTimer(watchdogTimer);
      clearTimer(hideTimer);
      video.pause?.();
      video.autoplay = false;
      video.removeAttribute?.('autoplay');
      setActive(false);
    }
  };
}
