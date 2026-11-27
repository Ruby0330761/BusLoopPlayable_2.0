export const COUNTDOWN_TIMER_ASSET = '/assets/applovin/countdown/timer-frame.png';
export const COUNTDOWN_ALARM_ASSET = '/assets/applovin/countdown/alarm-clock.svg';
// Synthesised two-tone ambulance siren loop. It is only packaged when the
// countdown siren toggle is on, so an unrelated countdown stays the same size.
export const COUNTDOWN_SIREN_ASSET = '/assets/applovin/countdown/ambulance-siren.mp3';
export const DEFAULT_COUNTDOWN_CONFIG = Object.freeze({
  enabled: 0,
  durationSeconds: 30,
  warningEnabled: 1,
  warningSeconds: 10,
  // Loop the ambulance siren while the clock is running. Off by default: a
  // countdown on a level without an ambulance must stay silent.
  sirenEnabled: 0,
  sirenVolume: 0.35,
  // Jump straight to the store when the clock reaches zero instead of showing
  // the Game Over card. Off by default so old profiles keep the failure flow.
  timeoutStore: 0,
  iconEnabled: 0,
  iconScale: 1,
  iconOffsetX: 0,
  iconOffsetY: 0,
  offsetX: 0,
  offsetY: 0,
  scale: 1
});

const integerInRange = (value, min, max) => Number.isInteger(value) && value >= min && value <= max;
const displayNumber = (value, min, max, fallback) => Number.isFinite(Number(value))
  ? Math.min(max, Math.max(min, Number(value))) : fallback;

export function normalizeCountdownConfig(value = {}) {
  const source = value && typeof value === 'object' ? value : {};
  const duration = Number(source.durationSeconds);
  const durationSeconds = Number.isInteger(duration) && duration >= 0 ? Math.min(duration, 120) : 30;
  const warning = Number(source.warningSeconds);
  return {
    enabled: Number(source.enabled) === 1 ? 1 : 0,
    durationSeconds,
    warningEnabled: Number(source.warningEnabled ?? 1) === 1 ? 1 : 0,
    warningSeconds: Number.isInteger(warning) && warning >= 0
      ? Math.min(warning, durationSeconds)
      : Math.min(10, durationSeconds),
    sirenEnabled: Number(source.sirenEnabled ?? 0) === 1 ? 1 : 0,
    sirenVolume: displayNumber(source.sirenVolume ?? 0.35, 0, 1, 0.35),
    timeoutStore: Number(source.timeoutStore ?? 0) === 1 ? 1 : 0,
    iconEnabled: Number(source.iconEnabled ?? 0) === 1 ? 1 : 0,
    iconScale: displayNumber(source.iconScale ?? 1, 0.5, 2, 1),
    iconOffsetX: displayNumber(source.iconOffsetX ?? 0, -100, 100, 0),
    iconOffsetY: displayNumber(source.iconOffsetY ?? 0, -100, 100, 0),
    offsetX: displayNumber(source.offsetX ?? 0, -1080, 1080, 0),
    offsetY: displayNumber(source.offsetY ?? 0, -2160, 2160, 0),
    scale: displayNumber(source.scale ?? 1, 0.25, 3, 1)
  };
}

export function validateCountdownConfig(value = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('倒计时配置必须是对象');
  }
  const source = { ...DEFAULT_COUNTDOWN_CONFIG, ...value };
  if (![0, 1].includes(source.enabled)) throw new TypeError('启用倒计时必须为 0 或 1');
  // Disabled settings must not prevent an old or inactive profile from exporting.
  if (!source.enabled) return normalizeCountdownConfig(source);
  if (!integerInRange(source.durationSeconds, 0, 120)) {
    throw new TypeError('倒计时时长须为 0–120 的整数');
  }
  if (![0, 1].includes(source.warningEnabled)) throw new TypeError('临近结束红光必须为 0 或 1');
  if (![0, 1].includes(source.sirenEnabled)) throw new TypeError('救护车警笛开关必须为 0 或 1');
  if (!Number.isFinite(Number(source.sirenVolume)) || Number(source.sirenVolume) < 0 || Number(source.sirenVolume) > 1) {
    throw new TypeError('警笛音量须为 0–1 的数值');
  }
  if (![0, 1].includes(source.timeoutStore)) throw new TypeError('归零跳转开关必须为 0 或 1');
  if (source.warningEnabled && source.durationSeconds > 0
    && !integerInRange(source.warningSeconds, 0, source.durationSeconds)) {
    throw new TypeError('红光提前时间须为 0 到倒计时时长之间的整数');
  }
  return normalizeCountdownConfig(source);
}

export function formatCountdownTime(remaining) {
  const seconds = Math.max(0, Math.ceil(Number(remaining) || 0));
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}

// A private wall-clock state machine. Its caller owns gameplay, visibility and
// terminal-state priority; no simulation delta, DOM or delayed callback lives here.
export function createCountdown(config, { now = () => performance.now(), onTimeout = () => {} } = {}) {
  let settings = normalizeCountdownConfig(config);
  let elapsed = 0;
  let started = false;
  let paused = false;
  let outcome = null;
  let lastTime = null;

  function snapshot() {
    const remaining = Math.max(0, settings.durationSeconds - elapsed);
    return {
      ...settings,
      started,
      paused,
      outcome,
      remaining,
      state: !settings.enabled ? 'disabled' : outcome ?? (started ? (paused ? 'paused' : 'running') : 'idle'),
      urgent: Boolean(settings.enabled && settings.warningEnabled && started && !outcome
        && remaining > 0 && remaining <= settings.warningSeconds)
    };
  }

  function reset() {
    elapsed = 0;
    started = false;
    paused = false;
    outcome = null;
    lastTime = null;
    return snapshot();
  }

  function configure(next) {
    const previous = settings;
    settings = normalizeCountdownConfig(next);
    if (settings.enabled !== previous.enabled || settings.durationSeconds !== previous.durationSeconds) reset();
    return snapshot();
  }

  function start({ paused: initialPause = false } = {}) {
    if (!settings.enabled || started || outcome) return snapshot();
    started = true;
    paused = Boolean(initialPause);
    lastTime = now();
    return snapshot();
  }

  function setPaused(next, time = now()) {
    if (settings.enabled && started && !outcome && !paused && lastTime !== null) {
      elapsed = Math.min(settings.durationSeconds, elapsed + Math.max(0, time - lastTime) / 1000);
    }
    paused = Boolean(next);
    lastTime = started && !outcome ? time : null;
    return snapshot();
  }

  function finish(result = 'finished') {
    if (!outcome) outcome = result;
    lastTime = null;
    return snapshot();
  }

  function tick({ paused: nextPause = paused, status = 'playing', ended = false, time = now() } = {}) {
    if (!settings.enabled || outcome) return snapshot();
    // The game's result is resolved first even if this frame also reaches zero.
    if (status !== 'playing' || ended) return finish(ended ? 'finished' : status);
    setPaused(nextPause, time);
    if (started && elapsed >= settings.durationSeconds) {
      finish('timeout');
      onTimeout();
    }
    return snapshot();
  }

  return { snapshot, reset, configure, start, setPaused, finish, tick };
}
