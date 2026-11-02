// Background horizon alignment.
//
// Every background is drawn on one fixed image plane, so what the player sees
// depends on where the artwork puts its own playfield boundary. The shipped
// BG01/BG02 set places the road→ground boundary at a consistent height and the
// scene tuning was dialled in against it. Artwork drawn with that boundary
// higher in the frame (the Halloween set) therefore renders its playfield too
// high: the cars end up sitting on the road instead of the ground.
//
// The fix keeps the composition constant instead of the raw pixel offset. Each
// background carries a measured `horizon` (the fraction of image height above
// its playfield boundary); the plane is slid by the difference against the
// reference artwork, so the boundary lands on the same screen row for all of
// them. The slide is derived at render time, which means saved tuning keeps
// working and the user's own Y nudge is still additive on top.
//
// Pure functions over plain arrays so the same code runs in the editor, in the
// renderer, and in Node tests without a DOM or an image decoder.

/**
 * Playfield boundary of the reference artwork, as a fraction of image height.
 *
 * Measured with `detectPlayfieldHorizon` on the shipped BG01/BG02 set, which all
 * agree to within 0.004. Absolute values carry a small bias (the detector finds
 * the last strong step rather than the exact first row of the ground); only
 * differences between entries are used, so that bias cancels out and the
 * reference artwork stays exactly where the existing tuning puts it.
 */
export const REFERENCE_BACKGROUND_HORIZON = 0.5165;

const PROFILE_SAMPLE_WIDTH = 150;

function median(values) {
  if (!values.length) return 0;
  const sorted = [...values].sort((first, second) => first - second);
  return sorted[Math.floor(sorted.length / 2)];
}

/**
 * Median brightness of the middle of the frame, one value per image row.
 *
 * The middle 60% is used because the left and right edges hold props, walls and
 * vignetting that are not part of the boundary. The artifact is scaled down
 * first: the boundary is a wide horizontal feature, so a ~150px wide profile
 * carries all the signal while keeping the scan cheap for a 2100x3382 source.
 */
export function buildBrightnessProfile(rgba, { width, height, sampleWidth = PROFILE_SAMPLE_WIDTH } = {}) {
  const w = Math.round(Number(width) || 0);
  const h = Math.round(Number(height) || 0);
  if (!rgba || w <= 0 || h <= 0 || rgba.length < w * h * 4) return [];

  const columns = Math.max(8, Math.min(w, Math.round(sampleWidth)));
  const rows = Math.max(8, Math.round(columns * h / w));
  const firstX = Math.floor(columns * 0.20);
  const lastX = Math.ceil(columns * 0.80);
  const columnWidth = w / columns;
  const rowHeight = h / rows;

  const profile = new Array(rows).fill(0);
  for (let row = 0; row < rows; row += 1) {
    const y = Math.min(h - 1, Math.floor((row + 0.5) * rowHeight));
    const rowOffset = y * w * 4;
    const values = [];
    for (let column = firstX; column < lastX; column += 1) {
      const x = Math.min(w - 1, Math.floor((column + 0.5) * columnWidth));
      const offset = rowOffset + x * 4;
      values.push((rgba[offset] + rgba[offset + 1] + rgba[offset + 2]) / 3);
    }
    profile[row] = median(values);
  }
  return profile;
}

/**
 * Find the playfield boundary from a brightness profile.
 *
 * The boundary is the lowest row where brightness changes sharply: below it lies
 * the large, smooth ground area, above it the road strip and the scene behind
 * it. Walking from the bottom and keeping the LAST strong step skips the other
 * horizontal features in the art (a lit window, a snowy roof) that a
 * first-from-the-top search would stop on.
 *
 * Returns a height fraction, or null when the artwork has no such boundary —
 * a flat wall, a full-bleed photo, or a near-uniform gradient. Callers must then
 * leave the background where the tuning puts it rather than guessing.
 */
export function detectHorizonFromProfile(profile, { minFraction = 0.25, maxFraction = 0.74 } = {}) {
  const rows = Array.isArray(profile) ? profile.length : 0;
  if (rows < 24) return null;

  const firstRow = Math.max(1, Math.floor(rows * minFraction));
  const lastRow = Math.min(rows - 1, Math.ceil(rows * maxFraction));
  if (lastRow <= firstRow + 8) return null;

  const stepAt = (row) => {
    const below = (profile[row] + profile[row + 1] + profile[row + 2]
      + profile[row + 3] + profile[row + 4] + profile[row + 5]) / 6;
    const above = (profile[row - 2] + profile[row - 3] + profile[row - 4]
      + profile[row - 5] + profile[row - 6] + profile[row - 7]) / 6;
    return below - above;
  };

  const steps = new Map();
  let strongest = 0;
  for (let row = firstRow; row <= lastRow; row += 1) {
    const step = stepAt(row);
    steps.set(row, step);
    strongest = Math.max(strongest, Math.abs(step));
  }
  // A uniform image has no boundary to find; refusing beats inventing one.
  if (strongest < 25) return null;

  const threshold = strongest * 0.55;
  // Group the qualifying rows and report where the LAST group starts: the step
  // stays above threshold for the width of the averaging window, so taking the
  // group's first row reports the edge instead of half a window below it.
  let boundary = null;
  let inGroup = false;
  for (const [row, step] of [...steps.entries()].sort((first, second) => first[0] - second[0])) {
    if (Math.abs(step) >= threshold) {
      if (!inGroup) boundary = row;
      inGroup = true;
    } else {
      inGroup = false;
    }
  }
  if (boundary == null) return null;

  return clampUnit((boundary + 1) / rows);
}

/** Convenience wrapper: detect the horizon straight from decoded RGBA pixels. */
export function detectPlayfieldHorizon(rgba, options = {}) {
  const profile = buildBrightnessProfile(rgba, options);
  if (!profile.length) return null;
  return detectHorizonFromProfile(profile, options);
}

/**
 * Measured playfield boundary per background, keyed by content hash.
 *
 * Custom backgrounds are stored as `bg-<sha256:10>-<dimensions>-<label>.jpg`, and
 * the label is whatever the operator called the file. Keying on the hash instead
 * of the whole name means the same artwork matches even after a rename, and the
 * same artwork imported on a different machine (different label, same bytes)
 * still aligns. The shipped BG01/BG02 set is keyed by file name.
 *
 * Generated by the same detector this module exports, so the table and the
 * runtime agree by construction rather than by hand-copying.
 */
export const BACKGROUND_HORIZONS = Object.freeze({
  'BG01_split01_q60.jpg': 0.5165,
  'BG01_split01_Sakura_q60.jpg': 0.5165,
  'BG01_split01_Grassland_q60.jpg': 0.5165,
  'BG02_split01_summer_q60.jpg': 0.5165,
  'BG02_split01_winter_q60.jpg': 0.5165,
  '01996d7ec4': 0.5207,
  '0a9c40592c': 0.5744,
  '1771af5bef': 0.5331,
  '2b803e4fd2': 0.5165,
  '3439ff07c1': 0.4256,
  '34635c0bde': 0.4256,
  '4945ebecc5': 0.4835,
  '7e7ba6c121': 0.5165,
  '93f23dce52': 0.5165,
  'a2a99fe6aa': 0.4091,
  'a495f7accb': 0.4256,
  'ba7f7c5c41': 0.5165,
  'c8d1f5344f': 0.4256,
  'f17695bdf0': 0.5124
});

/** Content hash embedded in an imported background filename, or null. */
export function backgroundContentHash(assetUrl) {
  const fileName = String(assetUrl ?? '').split('/').pop()?.split('?')[0] ?? '';
  return /^bg-([a-f0-9]{10})-/i.exec(fileName)?.[1]?.toLowerCase() ?? null;
}


/**
 * Horizon for an asset URL, or null when it has not been measured.
 *
 * A custom background carries its own value in the tuning document; the shipped
 * set is looked up by file name here. Unknown and unmeasured artwork returns
 * null, which leaves the plane untouched instead of guessing.
 */
export function resolveBackgroundHorizon(assetUrl, explicitHorizon = null) {
  const explicit = Number(explicitHorizon);
  if (Number.isFinite(explicit) && explicit > 0 && explicit < 1) return explicit;
  const source = String(assetUrl ?? '');
  if (!source) return null;
  const fileName = source.split('/').pop()?.split('?')[0] ?? '';
  if (fileName in BACKGROUND_HORIZONS) return BACKGROUND_HORIZONS[fileName];
  const hash = backgroundContentHash(source);
  return hash ? BACKGROUND_HORIZONS[hash] ?? null : null;
}

/**
 * The Y offset the renderer should actually use.
 *
 * This is the tuning offset plus the alignment slide, plus the operator's manual
 * trim. Saved tuning stays portable: switching artwork re-derives the slide while
 * the trim is reset by the editor, so a leftover nudge cannot follow the operator
 * onto different art.
 */
export function resolveBackgroundOffsetY({ background = {} } = {}) {
  const planeHeight = Math.max(0.01, Number(background.height) || 0.01)
    * Math.max(0.01, Number(background.scale) || 1);
  const horizon = resolveBackgroundHorizon(background.asset, background.horizon);
  const aligned = alignBackgroundOffsetY({
    offsetY: background.offsetY,
    horizon,
    referenceHorizon: REFERENCE_BACKGROUND_HORIZON,
    planeHeight
  });
  const trim = Number(background.horizonTrim);
  // Same unit as `offsetY` (world units), so the two sliders feel comparable.
  return aligned + (Number.isFinite(trim) ? trim : 0);
}

function clampUnit(value) {
  if (!Number.isFinite(value)) return null;
  return Math.min(1, Math.max(0, value));
}

/**
 * Slide the background plane so `horizon` sits where the reference horizon does.
 *
 * The plane's world height spans one full image height, so a horizon difference
 * expressed in image fractions converts 1:1 through that height. Positive means
 * the artwork's boundary is higher in the frame than the reference and the plane
 * has to move down.
 */
export function alignBackgroundOffsetY({
  offsetY = 0,
  horizon,
  referenceHorizon = REFERENCE_BACKGROUND_HORIZON,
  planeHeight
} = {}) {
  const safeOffset = Number.isFinite(Number(offsetY)) ? Number(offsetY) : 0;
  // `Number(null)` is 0, so an unmeasured artwork would silently read as
  // "horizon at the very top" and throw the plane off the screen.
  if (horizon == null || horizon === '') return safeOffset;
  const detected = Number(horizon);
  const reference = Number(referenceHorizon);
  const height = Number(planeHeight);
  if (!Number.isFinite(detected) || !Number.isFinite(reference) || !(height > 0)) return safeOffset;
  return safeOffset + (detected - reference) * height;
}

/**
 * How far the plane may move before an edge of the artwork enters the frame.
 *
 * The visible band is narrower than the full plane, so modest corrections are
 * free; a large one would show a hard cut at the top or bottom of the screen.
 */
export function maxBackgroundOffsetShift({ planeHeight, visibleHeight } = {}) {
  const plane = Number(planeHeight);
  const visible = Number(visibleHeight);
  if (!(plane > 0) || !(visible > 0) || visible >= plane) return 0;
  return (plane - visible) / 2;
}
