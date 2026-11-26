// Canonical vehicle/passenger colour atlas table.
//
// The atlas list used to live only inside the generated level catalog. That made
// the supplement colours (Unity indices 17-25: black, white, dark red, …) depend
// on whichever catalog happened to be on disk. The remote editor mounts a data
// volume at /app/artifacts and points PLAYABLE_LEVEL_CATALOG_PATH at it, and that
// volume is seeded once and never reseeded, so exports there still saw the
// pre-supplement eleven-atlas catalog. Index 17/18 resolved to undefined and the
// runtime's `?? colorTextures[0]` fallback painted every black and white car
// blue. Keeping the table in code makes a level's colour slots independent of
// catalog age; packaging still whitelists whatever the level ends up referencing.
// Indices 11-16 are special mechanism vehicles (police, firetruck, ambulance,
// VIP, luxury) that carry authored textures instead of a paint atlas, so those
// slots stay empty. Complete asset paths let the single-file packager rewrite
// the fallback table alongside the paths emitted by the level generator.
export const COLOR_ATLAS_PATHS = Object.freeze([
  '/assets/applovin/textures/color_0_blue_q85.webp',
  '/assets/applovin/textures/color_1_green_q85.webp',
  '/assets/applovin/textures/color_2_pink_q85.webp',
  '/assets/applovin/textures/color_3_purple_q85.webp',
  '/assets/applovin/textures/color_4_red_q85.webp',
  '/assets/applovin/textures/color_5_yellow_q85.webp',
  '/assets/applovin/textures/color_6_orange_q85.webp',
  '/assets/applovin/textures/color_7_lightblue_q85.webp',
  '/assets/applovin/textures/color_8_brown_q85.webp',
  '/assets/applovin/textures/color_9_darkgreen_q85.webp',
  '/assets/applovin/textures/color_10_darkblue_q85.webp',
  null, null, null, null, null, null,
  '/assets/applovin/textures/color_17_black_q85.webp',
  '/assets/applovin/textures/color_18_white_q85.webp',
  '/assets/applovin/textures/color_19_darkred_q85.webp',
  '/assets/applovin/textures/color_20_darkyellow_q85.webp',
  '/assets/applovin/textures/color_21_cream_q85.webp',
  '/assets/applovin/textures/color_22_mintgreen_q85.webp',
  '/assets/applovin/textures/color_23_matchagreen_q85.webp',
  '/assets/applovin/textures/color_24_lightpink_q85.webp',
  '/assets/applovin/textures/color_25_gray_q85.webp',
]);

/**
 * Fills colour slots the level's catalog data did not provide.
 *
 * A level built against an older catalog only carries the atlases that existed
 * then; the vehicles themselves still use the supplement indices, so the empty
 * slots have to be completed before the runtime or the packager sees them. An
 * explicit path supplied by the level always wins.
 */
export function resolveColorAtlasPaths(colorTextures) {
  const supplied = Array.isArray(colorTextures) ? colorTextures : [];
  return COLOR_ATLAS_PATHS.map((fallback, index) => {
    const value = supplied[index];
    if (typeof value === 'string' && value) return value;
    return fallback;
  });
}

/** Returns true when the array already covers every slot the canonical table has. */
export function isColorAtlasTableComplete(colorTextures) {
  if (!Array.isArray(colorTextures) || colorTextures.length < COLOR_ATLAS_PATHS.length) return false;
  return COLOR_ATLAS_PATHS.every((fallback, index) => (
    fallback == null || (typeof colorTextures[index] === 'string' && colorTextures[index])
  ));
}

// Keep complete asset URLs here so single-file exports inline the same model
// identity in this lookup and in the level's vehicleBySeats table.
const PAINTED_MODELS = Object.freeze({
  4: '/assets/unity/models/Car_001.fbx',
  6: '/assets/unity/models/Van_001.fbx',
  10: '/assets/unity/models/Bus_001.fbx'
});

export function usesShippedVehicleMesh(path, seats) {
  return typeof path === 'string' && path === PAINTED_MODELS[seats];
}

export function getSessionColorIndices(levels) {
  const indices = new Set([0]);
  for (const level of levels) {
    for (const queue of level.passengerQueues ?? [level.passengerSequence ?? []]) {
      for (const color of queue) indices.add(color);
    }
  }
  return indices;
}
