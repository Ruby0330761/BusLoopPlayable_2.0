// The playable's sticky speed switch scales the whole simulation clock. Scaling
// the frame delta (rather than the belt multiplier) means vehicle routes,
// boarding, collisions, and the conveyor all keep their relative pace, which is
// what a player reads as "2x".

// Two skins ship: the original dark-blue arrow button, and a light capsule (white
// pill, navy numeral, blue round badge) an operator can choose instead. The pill
// itself is CSS; only the round badge is artwork, and it is square so the runtime
// can size it from the button box without measuring anything.
export const SPEED_TOGGLE_STYLES = Object.freeze([
  { value: 'light', label: '浅色胶囊（默认）' },
  { value: 'default', label: '深蓝按钮' }
]);

export const DEFAULT_SPEED_TOGGLE_BOUNDS = Object.freeze({ x: 968, y: 244, width: 204, height: 106 });

// The seed `src` for the switch badge. A delivery whose tuning leaves the switch
// off ships no badge art at all, so the element starts from a transparent pixel
// (same value #countdown-image uses) and only asks for a real icon once the
// switch is enabled. A root-relative seed in index.html would make the packager
// inline art the ad can never show.
export const SPEED_TOGGLE_SEED_SRC = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';

export const SPEED_TOGGLE_ICON_PATHS = Object.freeze({
  default: Object.freeze({
    normal: '/assets/applovin/speed-toggle-icon-normal.png',
    boost: '/assets/applovin/speed-toggle-icon-boost.png'
  }),
  light: Object.freeze({
    normal: '/assets/applovin/speed-toggle-icon-light-normal.png',
    boost: '/assets/applovin/speed-toggle-icon-light-boost.png'
  })
});

export function normalizeSpeedMultiplier(value, fallback = 1) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.max(0.1, number) : fallback;
}

export function resolveTimeScale({ multiplier = 2, boosted = false } = {}) {
  return boosted ? normalizeSpeedMultiplier(multiplier, 2) : 1;
}

export function normalizeSpeedToggleStyle(value, fallback = 'default') {
  const key = String(value ?? '').trim().toLowerCase();
  return SPEED_TOGGLE_STYLES.some((style) => style.value === key) ? key : fallback;
}

export function formatSpeedLabel(multiplier, style = 'default') {
  const rounded = Math.round(normalizeSpeedMultiplier(multiplier, 1) * 100) / 100;
  // The light capsule prints the numeral first ("2x"), matching the artwork an
  // operator picked; the original skin keeps the "x2" earlier deliveries shipped.
  return normalizeSpeedToggleStyle(style) === 'light' ? `${rounded}x` : `x${rounded}`;
}

export function resolveSpeedToggleIcon(style, boosted) {
  const icons = SPEED_TOGGLE_ICON_PATHS[normalizeSpeedToggleStyle(style)];
  return boosted ? icons.boost : icons.normal;
}

export function getSpeedToggleAssetPaths(config = {}) {
  if (!config.enabled) return [];
  const style = normalizeSpeedToggleStyle(config.style);
  const badges = Object.values(SPEED_TOGGLE_ICON_PATHS[style]);
  return style === 'light' ? badges : ['/assets/applovin/speed-toggle-bg_q90.webp', ...badges];
}
