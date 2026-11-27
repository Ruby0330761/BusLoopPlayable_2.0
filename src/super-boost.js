// A one-tap challenge. Its simulation multiplier never scales the real clock.
export const DEFAULT_SUPER_BOOST_CONFIG = Object.freeze({
  enabled: 0, multiplier: 4, guideEnabled: 1, guideText: 'TAP TO BOOST!',
  guideScale: 1, guideSpeed: 1, flameEnabled: 1, flameIntensity: 0.8, flameHeight: 0.28,
  replayEndCard: 1, promptFontSize: 64, promptWidth: 850, promptGap: 24, promptButtonGap: 24
});
const bounded = (value, low, high, fallback) => Number.isFinite(Number(value))
  ? Math.max(low, Math.min(high, Number(value))) : fallback;
export function normalizeSuperBoostConfig(value = {}) {
  const source = { ...DEFAULT_SUPER_BOOST_CONFIG, ...value };
  return {
    enabled: Number(source.enabled) === 1 ? 1 : 0,
    multiplier: bounded(source.multiplier, 1, 6, 4),
    guideEnabled: Number(source.guideEnabled) === 1 ? 1 : 0,
    guideText: String(source.guideText ?? '').slice(0, 100),
    guideScale: bounded(source.guideScale, 0.5, 2, 1),
    guideSpeed: bounded(source.guideSpeed, 0.1, 5, 1),
    flameEnabled: Number(source.flameEnabled) === 1 ? 1 : 0,
    flameIntensity: bounded(source.flameIntensity, 0, 1, 0.8),
    flameHeight: bounded(source.flameHeight, 0.1, 0.6, 0.28),
    replayEndCard: Number(source.replayEndCard) === 1 ? 1 : 0,
    promptFontSize: bounded(source.promptFontSize, 20, 120, 64),
    promptWidth: bounded(source.promptWidth, 200, 1000, 850),
    promptGap: bounded(source.promptGap, 0, 200, 24),
    promptButtonGap: bounded(source.promptButtonGap, 0, 200, 24)
  };
}
export function createSuperBoost(config) {
  let settings = normalizeSuperBoostConfig(config);
  let active = false;
  const snapshot = () => ({ ...settings, active,
    waiting: Boolean(settings.enabled && !active),
    timeScale: settings.enabled && active ? settings.multiplier : 1 });
  return {
    snapshot,
    configure(next) {
      const previous = settings;
      settings = normalizeSuperBoostConfig(next);
      if (previous.enabled !== settings.enabled) active = false;
      return snapshot();
    },
    activate() {
      if (!settings.enabled || active) return false;
      active = true;
      return true;
    },
    reset() { active = false; return snapshot(); }
  };
}

export function createSuperBoostView({ stage, button, guide, copy, hand, canvas }) {
  const context = canvas?.getContext('2d');
  let phase = 0;
  let bounds = null;
  function resize(contentBounds) {
    bounds = contentBounds;
    if (!canvas || !stage) return;
    const width = Math.max(1, bounds?.width ?? stage.clientWidth);
    const height = Math.max(1, bounds?.height ?? stage.clientHeight);
    Object.assign(canvas.style, { left: `${bounds?.left ?? 0}px`, top: `${bounds?.top ?? 0}px`,
      width: `${width}px`, height: `${height}px` });
    canvas.width = Math.round(width * Math.min(globalThis.devicePixelRatio || 1, 1.5));
    canvas.height = Math.round(height * Math.min(globalThis.devicePixelRatio || 1, 1.5));
  }
  function render(state, { visible = true, playing = true, paused = false, delta = 0 } = {}) {
    const waiting = visible && playing && state.waiting && state.guideEnabled;
    const flaming = visible && playing && state.active && state.flameEnabled;
    if (guide) guide.hidden = !waiting;
    button?.classList.toggle('is-boost-guided', Boolean(waiting));
    button?.classList.toggle('is-super-boosted', Boolean(flaming));
    if (copy && copy.textContent !== state.guideText) copy.textContent = state.guideText;
    if (copy) copy.dir = state.guideDirection ?? 'ltr';
    if (waiting && guide && button && stage) {
      if (hand && !hand.dataset.loaded) {
        hand.src = '/assets/applovin/main-guide-hand_q80.webp';
        hand.dataset.loaded = '1';
      }
      const phone = stage.getBoundingClientRect(), target = button.getBoundingClientRect();
      const left = bounds?.left ?? 0, right = bounds?.right ?? stage.clientWidth;
      const top = bounds?.top ?? 0, bottom = bounds?.bottom ?? stage.clientHeight;
      const unit = Math.min((right - left) / 390, (bottom - top) / 780) * state.guideScale;
      const width = Math.min(240 * unit, right - left - 16);
      const center = Math.max(left + width / 2 + 8,
        Math.min(target.left + target.width / 2 - phone.left - (stage.clientLeft || 0), right - width / 2 - 8));
      guide.style.setProperty('--boost-guide-unit', `${unit}px`);
      guide.style.setProperty('--boost-hand-duration', `${0.8 / bounded(state.guideSpeed, 0.1, 5, 1)}s`);
      guide.style.setProperty('--boost-guide-x', `${center}px`);
      guide.style.setProperty('--boost-guide-y', `${Math.max(top + 8, Math.min(
        target.bottom - phone.top - (stage.clientTop || 0) + 64 * unit, bottom - 70 * unit))}px`);
      guide.style.setProperty('--boost-guide-width', `${width}px`);
      if (hand) {
        hand.style.left = `${Math.max(left, Math.min(right - 72 * unit,
          target.left + target.width * 0.5 - 64 * unit * 0.16 - phone.left - (stage.clientLeft || 0)))}px`;
        hand.style.top = `${Math.max(top, Math.min(bottom - 90 * unit,
          target.top + target.height * 0.82 - 64 * unit * 0.08 - phone.top - (stage.clientTop || 0)))}px`;
      }
    }
    if (!canvas) return;
    canvas.hidden = !flaming;
    if (!flaming || !context) return;
    if (!paused) phase += Math.max(0, delta);
    const w = canvas.width, h = canvas.height;
    context.clearRect(0, 0, w, h);
    context.globalAlpha = state.flameIntensity;
    const glow = context.createLinearGradient(0, h, 0, h * (1 - state.flameHeight));
    glow.addColorStop(0, '#ff6a0080'); glow.addColorStop(1, '#ff6a0000');
    context.fillStyle = glow;
    context.fillRect(0, h * (1 - state.flameHeight), w, h * state.flameHeight);
    for (let i = 0; i < 23; i += 1) {
      const x = w * i / 22, edge = 0.25 + 0.75 * Math.abs(i / 11 - 1);
      const height = h * state.flameHeight * edge * (0.65 + 0.22 * Math.sin(phase * 9 + i * 2.4));
      const radius = w * 0.065;
      const fire = context.createLinearGradient(0, h, 0, h - height);
      fire.addColorStop(0, '#fff5a8'); fire.addColorStop(0.24, '#ffc42b');
      fire.addColorStop(0.65, '#ff5b16c0'); fire.addColorStop(1, '#ff300000');
      context.fillStyle = fire;
      context.beginPath(); context.moveTo(x - radius, h);
      context.bezierCurveTo(x - radius, h - height * 0.65, x + radius * 0.7, h - height * 0.5,
        x + Math.sin(phase * 6 + i) * radius, h - height);
      context.bezierCurveTo(x + radius * 0.5, h - height * 0.65, x + radius, h - height * 0.2, x + radius, h);
      context.fill();
      const life = (phase * 0.6 + i * 0.137) % 1;
      context.fillStyle = `rgba(255,220,90,${1 - life})`;
      context.fillRect(x + Math.sin(i + phase * 2) * radius, h - life * height * 1.5, 2, 4);
    }
    context.globalAlpha = 1;
  }
  return { resize, render };
}
