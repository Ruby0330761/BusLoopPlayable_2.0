// Thirty transparent frames from the supplied 烟雾.mov, ordered left-to-right,
// top-to-bottom. Each particle plays the full sequence over its own lifetime.
export const SMOKE_TRAIL_ANIMATION = Object.freeze({
  texture: '/assets/unity/effects/DrivingSmoke_6x5.png',
  atlas: Object.freeze({ columns: 6, rows: 5, frames: 30 })
});
export const SMOKE_TRAIL_DEFAULTS = Object.freeze({
  rateOverTime: 70,
  lifetimeMin: 0.15, lifetimeMax: 0.30,
  sizeMin: 0.36, sizeMax: 0.72, sizeRandomness: 100,
  speedScale: 1, offsetZ: -0.46, offsetY: 0.08, spread: 2.25,
  rotationSpeed: 130, rotationRandomness: 56,
  gravity: -0.50, opacity: 1
});

export const DEPARTURE_STAR_TEXTURE = '/assets/unity/effects/DepartureStar.png';
export const FULL_CONFETTI_TEXTURE = '/assets/unity/effects/Ribbon_01.png';
export const FULL_COMPLETION_SMOKE_TEXTURE = '/assets/applovin/effects/Smoke_08_q80.webp';
export const DEPARTURE_TRAIL_TEXTURE = '/assets/unity/effects/DepartureTrail.png';
export const DEPARTURE_STAR_DEFAULTS = Object.freeze({
  color: 0xffffff,
  rateScale: 1, lifetimeScale: 1, sizeScale: 1, speedScale: 1, spreadScale: 1,
  opacity: 1, offsetX: 0, offsetY: 0, offsetZ: 0
});
export const DEPARTURE_TRAIL_DEFAULTS = Object.freeze({
  color: 0xffffff, opacity: 1, widthScale: 1, lifetimeScale: 1, offsetX: 0, offsetY: 0, offsetZ: 0
});

// Old catalogs and saved web levels still name Round_01 for the driving trail.
// Complete shared effect slots for old catalogs, saved levels and new levels.
export function withVehicleEffectAssets(level) {
  if (!level?.assets || (level.assets.textures?.effects?.smokeTrail === SMOKE_TRAIL_ANIMATION.texture
    && level.assets.textures?.effects?.departureStar === DEPARTURE_STAR_TEXTURE
    && level.assets.textures?.effects?.ribbon === FULL_CONFETTI_TEXTURE
    && level.assets.textures?.effects?.ribbonSmoke === FULL_COMPLETION_SMOKE_TEXTURE
    && level.assets.textures?.effects?.departureTrail === DEPARTURE_TRAIL_TEXTURE)) return level;
  return {
    ...level,
    assets: {
      ...level.assets,
      textures: {
        ...level.assets.textures,
        effects: { ...level.assets.textures?.effects, smokeTrail: SMOKE_TRAIL_ANIMATION.texture,
          ribbon: FULL_CONFETTI_TEXTURE,
          ribbonSmoke: FULL_COMPLETION_SMOKE_TEXTURE,
          departureStar: DEPARTURE_STAR_TEXTURE, departureTrail: DEPARTURE_TRAIL_TEXTURE }
      }
    }
  };
}
