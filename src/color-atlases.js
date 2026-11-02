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
const ATLAS_ROOT = '/assets/applovin/textures';
const ATLAS_SLOT_COUNT = 26;
const STANDARD_COLOR_NAMES = Object.freeze([
  'blue', 'green', 'pink', 'purple', 'red', 'yellow',
  'orange', 'lightblue', 'brown', 'darkgreen', 'darkblue'
]);
// Indices 11-16 are special mechanism vehicles (police, firetruck, ambulance,
// VIP, luxury) that carry authored textures instead of a paint atlas, so those
// slots stay empty on purpose.
const SUPPLEMENT_COLOR_NAMES = Object.freeze({
  17: 'black',
  18: 'white',
  19: 'darkred',
  20: 'darkyellow',
  21: 'cream',
  22: 'mintgreen',
  23: 'matchagreen',
  24: 'lightpink',
  25: 'gray'
});

export const COLOR_ATLAS_PATHS = Object.freeze(Array.from(
  { length: ATLAS_SLOT_COUNT },
  (_unused, index) => {
    const name = STANDARD_COLOR_NAMES[index] ?? SUPPLEMENT_COLOR_NAMES[index];
    return name ? `${ATLAS_ROOT}/color_${index}_${name}_q85.webp` : null;
  }
));

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
