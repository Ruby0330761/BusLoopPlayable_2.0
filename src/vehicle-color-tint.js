// Vehicle recolouring: repaint an atlas body region while keeping its shading.
//
// Why this is not a hue replacement
// --------------------------------
// A colour atlas stores the paint value *and* the shading baked into it: the
// blue atlas is a #0061E8 body with lighter #4190FF/#71ADFF panel edges and
// darker shadow bands. The runtime draws that texture through a lit
// MeshStandardMaterial, so the body reaches the screen already brightened.
//
// The old implementation replaced the body region with a flat HSV colour taken
// from the override, which threw away the baked shading and, more importantly,
// wrote the override *into the texture* at face value. The texture is lit again
// afterwards, so an override of #4EA4FF (which is what the editor displays for
// the blue slot) came out as ~#2078F8 on screen while the same effort through
// the built-in atlas produced #48A0F8. Two paths, two different colours.
//
// The rule this module enforces: an override is a *paint* value, in the same
// space as the atlas's own base colour, and the re-edit must be exactly
// appearance-preserving.
//
//   * Identity — repainting an atlas with its own base colour returns the atlas
//     unchanged, pixel for pixel. That is what makes an override of #0061E8
//     render identically to leaving colorIndex 0 alone.
//   * Recolour — the modal body pixel becomes exactly the requested paint. The
//     surrounding highlight/shadow pixels keep their relationship to that body
//     value, so a recoloured car still reads as a lit car rather than a flat
//     sticker.
//
// Shading is propagated as a per-channel affine map anchored on the atlas's own
// body colour:
//
//     out = anchor + (pixel - reference) * (anchor / reference)
//
// The scale factor keeps contrast (a highlight stays lighter by the same ratio),
// and the anchor term makes the body land exactly on the new paint. The factor
// is clamped: a near-black atlas such as the black slot (#101010 body) would
// otherwise multiply any bright artwork pixel by 30+ and blow the texture out.

const BODY_REGION_KEYS = ['body', 'highlight', 'shadow', 'window', 'detail'];

// A near-black reference channel cannot produce a usable ratio, so the scale is
// bounded instead of trusted. 4 keeps real shading contrast (atlas highlights
// sit at 2-3.6x the body) while refusing the blow-out values a #101010 body
// would otherwise generate.
const MAX_SHADING_SCALE = 4;

// A pixel counts as "body" when it is saturated enough to carry the paint hue
// and its hue is near the atlas's own hue. The neutral branch exists because a
// black/white/grey atlas has no usable hue to compare against.
const NEUTRAL_SATURATION = 0.18;
const BODY_MIN_SATURATION = 0.12;
const BODY_HUE_TOLERANCE = 58;
const DARK_GLASS_LUMA = 0.32;

const lumaOf = ([r, g, b]) => (r * 0.2126 + g * 0.7152 + b * 0.0722) / 255;
const clampChannel = (value) => Math.max(0, Math.min(255, Math.round(value)));

export function hexToRgb(value) {
  const hex = String(value ?? '').replace('#', '');
  if (!/^[0-9a-f]{6}$/i.test(hex)) return null;
  return [
    Number.parseInt(hex.slice(0, 2), 16),
    Number.parseInt(hex.slice(2, 4), 16),
    Number.parseInt(hex.slice(4, 6), 16)
  ];
}

export function rgbToHex([r, g, b]) {
  return `#${[r, g, b].map((channel) => clampChannel(channel).toString(16).padStart(2, '0')).join('')}`;
}

export function rgbToHsv([r, g, b]) {
  const max = Math.max(r, g, b) / 255;
  const min = Math.min(r, g, b) / 255;
  const delta = max - min;
  if (delta < 0.0001) return { hue: 0, saturation: 0, value: max };
  let hue = max === r / 255
    ? (((g - b) / 255) / delta) % 6
    : max === g / 255
      ? (b - r) / 255 / delta + 2
      : (r - g) / 255 / delta + 4;
  hue *= 60;
  if (hue < 0) hue += 360;
  return { hue, saturation: delta / Math.max(max, 0.0001), value: max };
}

function hueDistance(left, right) {
  const distance = Math.abs(left - right) % 360;
  return distance > 180 ? 360 - distance : distance;
}

/**
 * Normalizes an override object down to the region keys this module repaints.
 * Values that are not 6-digit hex are dropped, matching what the editor stores.
 */
export function normalizeTintOverrides(overrides) {
  const entries = Object.entries(overrides ?? {})
    .filter(([key, value]) => BODY_REGION_KEYS.includes(key) && /^#[0-9a-f]{6}$/i.test(value));
  return Object.fromEntries(entries);
}

/**
 * The colour the atlas actually stores as its body, i.e. the reference the
 * shading map is anchored on.
 *
 * The level catalog's `COLORS[slot]` value is *not* reliable here: the black
 * slot ships a #101010 body while the catalog records #2d2d30. Anchoring on the
 * catalog value left the real body pixels classified as "not the body", so they
 * fell through to the window/detail branches instead of being repainted. The
 * caller therefore passes the modal opaque colour it measured from the atlas.
 */
export function resolveTintReference(atlasBaseRgb, measuredBodyRgb = null) {
  const measured = Array.isArray(measuredBodyRgb) && measuredBodyRgb.length === 3 ? measuredBodyRgb : null;
  if (measured) return measured;
  return Array.isArray(atlasBaseRgb) && atlasBaseRgb.length === 3 ? atlasBaseRgb : [0, 0, 0];
}

/** Maps one atlas pixel onto the new paint, preserving its shading offset. */
export function shadePixelToPaint(pixel, reference, anchor, maxScale = MAX_SHADING_SCALE) {
  return [0, 1, 2].map((channel) => {
    const ratio = reference[channel] > 2 ? anchor[channel] / reference[channel] : 1;
    const scale = Math.max(1 / maxScale, Math.min(maxScale, ratio));
    return clampChannel(anchor[channel] + (pixel[channel] - reference[channel]) * scale);
  });
}

/**
 * Repaints one atlas buffer in place.
 *
 * @param {Uint8ClampedArray|Uint8Array} data RGBA pixels, mutated in place.
 * @param {object} options
 * @param {number[]} options.reference  Atlas body colour the shading is anchored on.
 * @param {object} options.overrides    Region overrides (body/highlight/shadow/window/detail).
 */
export function tintAtlasPixels(data, { reference, overrides }) {
  const regions = normalizeTintOverrides(overrides);
  const body = hexToRgb(regions.body);
  if (!body) return data;
  const highlight = hexToRgb(regions.highlight);
  const shadow = hexToRgb(regions.shadow);
  const window = hexToRgb(regions.window);
  const detail = hexToRgb(regions.detail);
  const referenceHsv = rgbToHsv(reference);
  const referenceLuma = lumaOf(reference);
  const neutralAtlas = referenceHsv.saturation < NEUTRAL_SATURATION;

  for (let offset = 0; offset < data.length; offset += 4) {
    if (data[offset + 3] < 8) continue;
    const current = [data[offset], data[offset + 1], data[offset + 2]];
    const pixelHsv = rgbToHsv(current);
    const luma = lumaOf(current);
    // Neutral atlases (black, white, cream, grey) have no hue to compare, so the
    // body is everything at or near the stored body luma and the glass is what
    // sits clearly below it.
    const bodyPixel = neutralAtlas
      ? pixelHsv.saturation < 0.25 && luma > referenceLuma * 0.55
      : pixelHsv.saturation > BODY_MIN_SATURATION
        && hueDistance(pixelHsv.hue, referenceHsv.hue) < BODY_HUE_TOLERANCE;
    const windowPixel = !neutralAtlas && pixelHsv.saturation < 0.2 && luma < DARK_GLASS_LUMA;

    let replacement = null;
    if (bodyPixel) {
      const ratio = luma / Math.max(referenceLuma, 0.08);
      const anchor = ratio > 1.12 && highlight
        ? highlight
        : ratio < 0.7 && shadow
          ? shadow
          : body;
      replacement = shadePixelToPaint(current, reference, anchor);
    } else if (windowPixel && window) {
      replacement = window;
    } else if (!bodyPixel && !windowPixel && detail && pixelHsv.saturation > 0.1) {
      replacement = detail;
    }
    if (!replacement) continue;
    data[offset] = replacement[0];
    data[offset + 1] = replacement[1];
    data[offset + 2] = replacement[2];
  }
  return data;
}

/**
 * Measures the modal opaque colour of an RGBA buffer. This is the reference the
 * shading map anchors on, so it must come from the atlas rather than the level
 * catalog.
 */
export function dominantOpaqueColor(data, alphaThreshold = 250) {
  const counts = new Map();
  let best = null;
  for (let offset = 0; offset < data.length; offset += 4) {
    if (data[offset + 3] < alphaThreshold) continue;
    const key = `${data[offset]},${data[offset + 1]},${data[offset + 2]}`;
    const count = (counts.get(key) ?? 0) + 1;
    counts.set(key, count);
    if (!best || count > best.count) best = { key, count };
  }
  if (!best) return null;
  return best.key.split(',').map(Number);
}
