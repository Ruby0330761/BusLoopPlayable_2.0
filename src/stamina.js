export const STAMINA_LIFE_OPTIONS = Object.freeze(Array.from({ length: 10 }, (_, index) => index + 1));
export const STAMINA_ASSETS = Object.freeze({
  heart: '/assets/applovin/stamina/heart.png',
  empty: '/assets/applovin/stamina/heart-empty.png',
  frame: '/assets/applovin/stamina/frame.png'
});
export const STAMINA_INTRO_ASSETS = Object.freeze({
  1: '/assets/applovin/stamina/intro-1.webp',
  2: '/assets/applovin/stamina/intro-2.webp',
  3: '/assets/applovin/stamina/intro-3.webp',
  4: '/assets/applovin/stamina/intro-4.webp',
  5: '/assets/applovin/stamina/intro-5.webp',
  6: '/assets/applovin/stamina/intro-6.webp',
  7: '/assets/applovin/stamina/intro-7.webp',
  8: '/assets/applovin/stamina/intro-8.webp',
  9: '/assets/applovin/stamina/intro-9.webp',
  10: '/assets/applovin/stamina/intro-10.webp'
});

export function getStaminaAssetPaths(config) {
  const settings = normalizeStaminaConfig(config);
  if (!settings.enabled) return [];
  return [...Object.values(STAMINA_ASSETS), ...(settings.introEnabled ? [STAMINA_INTRO_ASSETS[settings.lives]] : [])];
}

const DISPLAY_LIMITS = { offsetX: [-1080, 1080, 0], offsetY: [-2160, 2160, 0], scale: [0.25, 3, 1] };
const HORIZONTAL_ALIGNMENTS = ['left', 'center', 'right'];

export function normalizeStaminaConfig(source = {}) {
  source = source && typeof source === 'object' ? source : {};
  const lives = source.lives === null || source.lives === '' ? NaN : Number(source.lives);
  const result = {
    enabled: Number(source.enabled) === 1 ? 1 : 0,
    lives: Number.isFinite(lives) ? Math.min(10, Math.max(1, Math.round(lives))) : 3,
    collisionPenaltyEnabled: source.collisionPenaltyEnabled === undefined || Number(source.collisionPenaltyEnabled) === 1 ? 1 : 0,
    parkingRescueEnabled: source.parkingRescueEnabled === undefined || Number(source.parkingRescueEnabled) === 1 ? 1 : 0,
    introEnabled: source.introEnabled === undefined || Number(source.introEnabled) === 1 ? 1 : 0
  };
  result.horizontalAlign = HORIZONTAL_ALIGNMENTS.includes(source.horizontalAlign) ? source.horizontalAlign : 'center';
  for (const [key, [min, max, fallback]] of Object.entries(DISPLAY_LIMITS)) {
    const value = Number(source[key]);
    result[key] = Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;
  }
  return result;
}

export function validateStaminaConfig(source) {
  if (!source || typeof source !== 'object' || Array.isArray(source)) throw new TypeError('tuning.stamina must be an object.');
  for (const key of Object.keys(source)) {
    const value = source[key];
    if (['enabled', 'collisionPenaltyEnabled', 'parkingRescueEnabled', 'introEnabled'].includes(key)) {
      if (value !== 0 && value !== 1) throw new TypeError(`tuning.stamina.${key} must be 0 or 1.`);
    } else if (key === 'lives') {
      if (!STAMINA_LIFE_OPTIONS.includes(value)) throw new TypeError('tuning.stamina.lives must be an integer between 1 and 10.');
    } else if (key === 'horizontalAlign') {
      if (!HORIZONTAL_ALIGNMENTS.includes(value)) throw new TypeError('tuning.stamina.horizontalAlign must be left, center or right.');
    } else if (DISPLAY_LIMITS[key]) {
      const [min, max] = DISPLAY_LIMITS[key];
      if (!Number.isFinite(value) || value < min || value > max) throw new TypeError(`tuning.stamina.${key} must be between ${min} and ${max}.`);
    } else throw new TypeError(`tuning.stamina.${key} is not supported.`);
  }
  return normalizeStaminaConfig(source);
}
