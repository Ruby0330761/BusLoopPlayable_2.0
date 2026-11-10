// "Progress HUD" configuration: the top progress bar plus its failure node.
//
// Kept next to the widget rather than inside it so the editor, the exporter and
// the runtime all normalise a saved profile the same way. A disabled profile
// must still export, so validation only rejects values that would be visible.

export const DEFAULT_PROGRESS_HUD_CONFIG = Object.freeze({
  enabled: 0,
  // Position of the high-failure node, as a percentage of the run.
  nodePercent: 50,
  // Copy only: how many players are claimed to fail at that node.
  failPercent: 29,
  // Draw the second (green) anchor at the reference's 41%.
  anchors: 1,
  offsetX: 0,
  // -109 design units sits the bar on the reference's ground line, inside the
  // conveyor band. The default used to be 0, which pushed the bar up into the
  // level's top edge once the bubble head-room was reserved.
  offsetY: -109,
  scale: 1,
  // The coloured band itself. The whole HUD is off by default (`enabled: 0`),
  // so when someone does enable it they should get the complete design; this
  // knob exists for the case where only the markers are wanted.
  trackVisible: 1,
  // Track gradient, author-editable. Stored as 0xRRGGBB numbers so the editor's
  // existing colour picker applies unchanged. Four stops are enough to describe
  // the green -> yellow -> orange -> red meter; `spectrum` interpolates between
  // them, so the live readout pill always samples the same colours the track
  // paints.
  spectrumStart: 0x12c52a,
  spectrumEarly: 0xd2e508,
  spectrumLate: 0xff9500,
  spectrumEnd: 0xea1218
});

// Each stop's position along the bar. Fixed: only the colours are tunable, so
// the meter keeps its even, "reads as progress" distribution.
export const PROGRESS_HUD_SPECTRUM_STOPS = Object.freeze([
  ['spectrumStart', 0],
  ['spectrumEarly', 40],
  ['spectrumLate', 58],
  ['spectrumEnd', 100]
]);

const clampNumber = (value, min, max, fallback) => {
  const n = Number(value);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
};

const clampInt = (value, min, max, fallback) => {
  const n = Math.round(Number(value));
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
};

export function normalizeProgressHudConfig(value = {}) {
  const source = value && typeof value === 'object' ? value : {};
  const color = (key) => clampInt(source[key] ?? DEFAULT_PROGRESS_HUD_CONFIG[key], 0, 0xffffff,
    DEFAULT_PROGRESS_HUD_CONFIG[key]);
  return {
    enabled: Number(source.enabled) === 1 ? 1 : 0,
    nodePercent: clampInt(source.nodePercent ?? 50, 1, 99, 50),
    failPercent: clampInt(source.failPercent ?? 29, 0, 100, 29),
    anchors: Number(source.anchors ?? 1) === 1 ? 1 : 0,
    offsetX: clampNumber(source.offsetX ?? 0, -1080, 1080, 0),
    offsetY: clampNumber(source.offsetY ?? DEFAULT_PROGRESS_HUD_CONFIG.offsetY, -2160, 2160,
      DEFAULT_PROGRESS_HUD_CONFIG.offsetY),
    scale: clampNumber(source.scale ?? 1, 0.2, 3, 1),
    trackVisible: Number(source.trackVisible ?? DEFAULT_PROGRESS_HUD_CONFIG.trackVisible) === 1 ? 1 : 0,
    spectrumStart: color('spectrumStart'),
    spectrumEarly: color('spectrumEarly'),
    spectrumLate: color('spectrumLate'),
    spectrumEnd: color('spectrumEnd')
  };
}

export function validateProgressHudConfig(value = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('进度条配置必须是对象');
  }
  const source = { ...DEFAULT_PROGRESS_HUD_CONFIG, ...value };
  // A disabled profile never blocks an export: old levels simply do not use it.
  if (!Number(source.enabled)) return normalizeProgressHudConfig(source);

  const nodePercent = Number(source.nodePercent);
  if (!Number.isInteger(nodePercent) || nodePercent < 1 || nodePercent > 99) {
    throw new TypeError('高失败率节点位置须为 1–99 的整数');
  }
  const failPercent = Number(source.failPercent);
  if (!Number.isInteger(failPercent) || failPercent < 0 || failPercent > 100) {
    throw new TypeError('失败率文案须为 0–100 的整数');
  }
  if (!Number.isFinite(Number(source.scale)) || Number(source.scale) < 0.2 || Number(source.scale) > 3) {
    throw new TypeError('进度条缩放须为 0.2–3 的数值');
  }
  for (const [key] of PROGRESS_HUD_SPECTRUM_STOPS) {
    const value = Number(source[key]);
    if (!Number.isInteger(value) || value < 0 || value > 0xffffff) {
      throw new TypeError(`轨道渐变颜色 ${key} 须为 0–16777215 的整数`);
    }
  }
  return normalizeProgressHudConfig(source);
}

/**
 * What the bar should read, in 0..1.
 *
 * The bar follows *cleared passengers* rather than the CTA counter: the ad runs
 * to the end of the level ("玩到通关"), so 100% has to mean "everyone is out",
 * not "the install gate fired". `total` is the passenger count the level
 * started with.
 */
export function resolveProgressHudRatio(remaining, total) {
  const max = Number(total);
  const left = Number(remaining);
  if (!Number.isFinite(max) || max <= 0) return 0;
  if (!Number.isFinite(left)) return 0;
  return Math.max(0, Math.min(1, (max - left) / max));
}
