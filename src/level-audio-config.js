// Canonical level sound table.
//
// The sounds a level plays used to live only inside the generated level catalog,
// and that made them depend on whichever catalog happened to be on disk. The
// remote editor points PLAYABLE_LEVEL_CATALOG_PATH at a data volume that is
// seeded once and never reseeded, so exports there read a catalog written before
// `vehicle_tap` was added: the code still emitted the `vehicle-dispatched` event
// but the level handed the controller no clip for it, and every packaged build
// silently shipped without the tap sound. The audio event wiring and the sound
// list have to change together, so the list belongs in code next to the other
// catalog-independent tables (see `color-atlases.js`).
//
// A level that already supplies a sound keeps its own clips and volume; only
// names the level is missing are filled in. That keeps Unity-authored balance
// authoritative while making a stale catalog harmless.
//
// Clip paths are written out in full rather than built from a shared root
// constant: the single-HTML packager inlines assets by exact URL match, and a
// template literal survives minification as `${root}/name.mp3`, which no
// replacement can rewrite. The same trap made mechanism art a special case in
// `package-applovin-single-html.mjs`; a plain literal needs no such handling.
export const LEVEL_AUDIO_CONFIG = Object.freeze({
  bus_hit: Object.freeze({
    clips: Object.freeze(['/assets/unity/audio/bus_hit_V5.mp3']),
    volume: 0.503268
  }),
  passenger_up: Object.freeze({
    clips: Object.freeze([
      '/assets/unity/audio/passenger_up_01.mp3',
      '/assets/unity/audio/passenger_up_02.mp3',
      '/assets/unity/audio/passenger_up_03.mp3'
    ]),
    volume: 0.825528
  }),
  bus_full: Object.freeze({
    clips: Object.freeze(['/assets/unity/audio/bus_full.mp3']),
    volume: 0.50023913
  }),
  // Played on `vehicle-dispatched`, i.e. every time a car is sent to a spot.
  vehicle_tap: Object.freeze({
    clips: Object.freeze(['/assets/unity/audio/vehicle_tap.mp3']),
    volume: 0.7
  })
});

function hasPlayableClips(entry) {
  return Array.isArray(entry?.clips)
    && entry.clips.length > 0
    && entry.clips.every((clip) => typeof clip === 'string' && clip);
}

/**
 * Fills sound names the level's catalog data did not provide.
 *
 * Sounds the level authored itself are kept as they are, including any extra
 * name the canonical table does not know about. An entry that exists but has no
 * usable clip list counts as missing: a name without a clip would otherwise make
 * the controller drop the sound silently, which is the failure this exists to
 * prevent.
 */
export function resolveLevelAudioConfig(audio) {
  const supplied = audio && typeof audio === 'object' ? audio : {};
  const resolved = {};
  for (const [name, fallback] of Object.entries(LEVEL_AUDIO_CONFIG)) {
    resolved[name] = hasPlayableClips(supplied[name]) ? supplied[name] : fallback;
  }
  for (const [name, entry] of Object.entries(supplied)) {
    if (name in resolved) continue;
    if (hasPlayableClips(entry)) resolved[name] = entry;
  }
  return resolved;
}

/** Returns true when the level already names every sound the events can play. */
export function isLevelAudioConfigComplete(audio) {
  if (!audio || typeof audio !== 'object') return false;
  return Object.keys(LEVEL_AUDIO_CONFIG).every((name) => hasPlayableClips(audio[name]));
}
