import { VEHICLE_COLOR_OPTIONS, getVehicleColorOption } from './level-editor-model.js';

/**
 * Reference-image recognition for the full-level authoring editor.
 *
 * The pipeline is deliberately pure: every exported step takes plain pixel data
 * (`{ width, height, data }`, RGBA bytes) plus a coordinate mapping, so it runs in
 * Node tests without a canvas. The editor only supplies the ImageData and the
 * world rectangle of the imported 垫图 layer.
 *
 * 1. classify  - quantized RGB lookup table resolves each pixel to the nearest
 *                vehicle palette colour, rejecting scene background.
 * 2. blobs     - per-colour connected components, filtered by size and shape so
 *                outlines, arrows and passenger dots stay out.
 * 3. grid      - rows and columns are re-spaced from the detected pitch so a
 *                photographed field becomes a clean, evenly spaced layout; a pitch
 *                that is not consistent with the vehicles themselves is ignored.
 * 4. mapping   - normalized image coordinates are mapped through the reference
 *                layer rectangle (position, size, rotation) into world X/Z.
 */

export const RECOGNITION_DEFAULTS = Object.freeze({
  // Colour acceptance
  adaptivePalette: true,
  modeMinShare: 0.006,
  modeValleyRatio: 0.3,
  maxModes: 14,
  colorOverrides: null,
  tolerance: 64,
  backgroundTolerance: 42,
  borderRatio: 0.06,
  backgroundClusterLimit: 8,
  // Black/white/gray are excluded by default: scene outlines, road markings, HUD
  // chrome and seat glyphs are all near-neutral and would dominate the result.
  allowNeutralColors: false,
  // Blob filtering
  minAreaRatio: 0.0008,
  minArea: null,
  maxAreaRatio: 0.035,
  maxEdgeRatio: 0.34,
  fillRatio: 0.3,
  // Off by default: a captured field mixes single cars, long vehicles and merged
  // runs, so splitting is a deliberate choice the operator makes from the preview.
  splitMerged: false,
  // Fragment merging stays at zero: a real field's cars are 3-8px apart, so even a
  // 2px merge radius welds a whole row of vehicles into one oversized blob.
  mergeGap: 0,
  maxCells: 400,
  // Placement
  seats: 'auto',
  snapToGrid: true,
  alignRows: true,
  rowToleranceRatio: 0.55,
  includeColorIds: null,
  excludeColorIds: null
});

const NO_COLOR = 255;

// Older reference sheets used the editor's former bright placeholder swatches.
// Keep those aliases for recognition input compatibility while the editor itself
// shows the colours actually present in the vehicle atlases.
const LEGACY_RECOGNITION_SWATCHES = Object.freeze({
  0: '#0000FF', 1: '#00FF00', 2: '#FF7DCF', 3: '#9400FF', 4: '#FF0000',
  5: '#FFEB04', 6: '#FF8C00', 7: '#00FFFF', 8: '#8DAB8B', 9: '#B9B9B9', 10: '#555598'
});
const BACKGROUND_MIN_SHARE = 0.06;
const LUT_BITS = 5;
const LUT_SHIFT = 8 - LUT_BITS;
const LUT_SIZE = 1 << (LUT_BITS * 3);

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

function finiteNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

export function hexToRgb(hex) {
  const value = Number.parseInt(String(hex ?? '').replace('#', ''), 16);
  if (!Number.isFinite(value)) return { r: 0, g: 0, b: 0 };
  return { r: (value >> 16) & 255, g: (value >> 8) & 255, b: value & 255 };
}

function colorDistanceSquared(a, b) {
  const dr = a.r - b.r;
  const dg = a.g - b.g;
  const db = a.b - b.b;
  return dr * dr + dg * dg + db * db;
}

export function normalizeRecognitionOptions(options = {}, image = null) {
  const merged = { ...RECOGNITION_DEFAULTS, ...options };
  const width = Math.max(1, finiteNumber(image?.width, 1));
  const height = Math.max(1, finiteNumber(image?.height, 1));
  const autoArea = Math.round(width * height * clamp(finiteNumber(merged.minAreaRatio, RECOGNITION_DEFAULTS.minAreaRatio), 0, 0.2));
  const requestedArea = merged.minArea == null || merged.minArea === '' ? null : Number(merged.minArea);
  const seats = merged.seats === 'auto' || merged.seats == null ? 'auto' : Number(merged.seats);
  return {
    ...merged,
    tolerance: clamp(finiteNumber(merged.tolerance, RECOGNITION_DEFAULTS.tolerance), 4, 442),
    backgroundTolerance: clamp(finiteNumber(merged.backgroundTolerance, RECOGNITION_DEFAULTS.backgroundTolerance), 0, 442),
    borderRatio: clamp(finiteNumber(merged.borderRatio, RECOGNITION_DEFAULTS.borderRatio), 0.01, 0.4),
    minArea: Number.isFinite(requestedArea) ? Math.max(2, Math.round(requestedArea)) : Math.max(2, autoArea),
    modeMinShare: clamp(finiteNumber(merged.modeMinShare, RECOGNITION_DEFAULTS.modeMinShare), 0.0002, 0.2),
    modeValleyRatio: clamp(finiteNumber(merged.modeValleyRatio, RECOGNITION_DEFAULTS.modeValleyRatio), 0.02, 0.9),
    maxModes: clamp(Math.round(finiteNumber(merged.maxModes, RECOGNITION_DEFAULTS.maxModes)), 1, 32),
    adaptivePalette: merged.adaptivePalette !== false,
    maxAreaRatio: clamp(finiteNumber(merged.maxAreaRatio, RECOGNITION_DEFAULTS.maxAreaRatio), 0.01, 1),
    maxEdgeRatio: clamp(finiteNumber(merged.maxEdgeRatio, RECOGNITION_DEFAULTS.maxEdgeRatio), 0.05, 1),
    fillRatio: clamp(finiteNumber(merged.fillRatio, RECOGNITION_DEFAULTS.fillRatio), 0, 1),
    mergeGap: clamp(Math.round(finiteNumber(merged.mergeGap, RECOGNITION_DEFAULTS.mergeGap)), 0, 12),
    maxCells: clamp(Math.round(finiteNumber(merged.maxCells, RECOGNITION_DEFAULTS.maxCells)), 1, 2000),
    seats: seats === 'auto' ? 'auto' : ([4, 6, 10].includes(seats) ? seats : 'auto'),
    rowToleranceRatio: clamp(finiteNumber(merged.rowToleranceRatio, RECOGNITION_DEFAULTS.rowToleranceRatio), 0.2, 1.5)
  };
}

export function buildPalette(settings = RECOGNITION_DEFAULTS) {
  const include = Array.isArray(settings.includeColorIds) ? new Set(settings.includeColorIds.map(Number)) : null;
  const exclude = new Set((settings.excludeColorIds ?? []).map(Number));
  return VEHICLE_COLOR_OPTIONS
    .filter((color) => (include ? include.has(color.id) : true))
    .filter((color) => !exclude.has(color.id))
    .map((color) => {
      const rgb = hexToRgb(color.css);
      const max = Math.max(rgb.r, rgb.g, rgb.b);
      const min = Math.min(rgb.r, rgb.g, rgb.b);
      return {
        id: color.id,
        colorIndex: color.id,
        sampleCss: color.css,
        name: color.name,
        label: color.label,
        css: color.css,
        rgb,
        aliasRgb: LEGACY_RECOGNITION_SWATCHES[color.id]
          ? [hexToRgb(LEGACY_RECOGNITION_SWATCHES[color.id])]
          : [],
        saturation: max - min,
        neutral: max - min < 32
      };
    });
}

function rgbToCss(rgb) {
  return `#${[rgb.r, rgb.g, rgb.b].map((value) => Math.round(value).toString(16).padStart(2, '0')).join('')}`;
}

function rgbToHsv(rgb) {
  const r = rgb.r / 255;
  const g = rgb.g / 255;
  const b = rgb.b / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;
  let hue = 0;
  if (delta > 0) {
    if (max === r) hue = 60 * (((g - b) / delta) % 6);
    else if (max === g) hue = 60 * ((b - r) / delta + 2);
    else hue = 60 * ((r - g) / delta + 4);
  }
  if (hue < 0) hue += 360;
  return { h: hue, s: max === 0 ? 0 : (delta / max) * 100, v: max * 100 };
}

function hueDelta(a, b) {
  const delta = Math.abs(a - b) % 360;
  return delta > 180 ? 360 - delta : delta;
}

/**
 * Colour similarity for labelling a detected mode with a shipped colour. Plain RGB
 * distance alone sends a saturated dark green to the palette's teal fire truck and a
 * light green to the grey `碧`, because those happen to be numerically close. Hue is
 * therefore the primary term whenever both sides are saturated, and a saturated
 * sample is never allowed to match a near-neutral shipped colour by distance alone.
 */
export function colorMatchScore(sampleRgb, candidateRgb) {
  const sample = rgbToHsv(sampleRgb);
  const candidate = rgbToHsv(candidateRgb);
  let score = Math.sqrt(colorDistanceSquared(sampleRgb, candidateRgb));
  if (sample.s > 18 && candidate.s > 12) score += hueDelta(sample.h, candidate.h) * 3;
  else if (sample.s > 18 && candidate.s <= 12) score += 120;
  else if (sample.s <= 18 && candidate.s > 30) score += 40;
  return score;
}

/** Nearest entry in the shipped vehicle palette. Only used to label a detected colour. */
export function nearestPaletteColor(rgb) {
  let best = VEHICLE_COLOR_OPTIONS[0];
  let bestScore = Number.POSITIVE_INFINITY;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const color of VEHICLE_COLOR_OPTIONS) {
    const candidate = hexToRgb(color.css);
    const aliases = LEGACY_RECOGNITION_SWATCHES[color.id]
      ? [hexToRgb(LEGACY_RECOGNITION_SWATCHES[color.id])]
      : [];
    const score = Math.min(colorMatchScore(rgb, candidate), ...aliases.map((alias) => colorMatchScore(rgb, alias)));
    if (score < bestScore) {
      bestScore = score;
      bestDistance = Math.min(
        Math.sqrt(colorDistanceSquared(candidate, rgb)),
        ...aliases.map((alias) => Math.sqrt(colorDistanceSquared(alias, rgb)))
      );
      best = color;
    }
  }
  return { ...best, score: Math.round(bestScore), distance: Math.round(bestDistance) };
}

/**
 * Dominant colours are read from the image itself, not from the shipped palette.
 * A supplied reference is often concept art whose greens and browns sit far from the
 * game's own hues; matching against the fixed palette then maps a whole group to the
 * wrong colour or to nothing at all.
 *
 * Each vehicle in such art is not one flat colour either: it has a lit top, shaded
 * sides and an anti-aliased outline, so a naive dominant-colour split cuts one car
 * into several fragments and every fragment then falls under the minimum area. The
 * histogram is therefore merged by *valley depth*: two colour modes are the same
 * material when the ridge between them is still well populated, and different
 * materials only when a real valley separates them. Every foreground pixel is then
 * assigned to its nearest surviving mode, so segmentation no longer depends on a
 * fixed tolerance.
 */
export function detectColorModes(image, background, settings = RECOGNITION_DEFAULTS) {
  const bits = 4;
  const shift = 8 - bits;
  const side = 1 << bits;
  const bins = side * side * side;
  const counts = new Float64Array(bins);
  const sums = new Float64Array(bins * 3);
  const backgroundToleranceSquared = settings.backgroundTolerance ** 2;
  const { width, height, data } = image;
  let foreground = 0;
  for (let index = 0; index < width * height; index += 1) {
    const offset = index * 4;
    if (data[offset + 3] < 8) continue;
    const sample = { r: data[offset], g: data[offset + 1], b: data[offset + 2] };
    if (background.some((cluster) => colorDistanceSquared(cluster, sample) <= backgroundToleranceSquared)) continue;
    const key = ((sample.r >> shift) << (bits * 2)) | ((sample.g >> shift) << bits) | (sample.b >> shift);
    counts[key] += 1;
    sums[key * 3] += sample.r;
    sums[key * 3 + 1] += sample.g;
    sums[key * 3 + 2] += sample.b;
    foreground += 1;
  }
  if (!foreground) return [];

  const minCount = Math.max(24, foreground * clamp(finiteNumber(settings.modeMinShare, RECOGNITION_DEFAULTS.modeMinShare), 0.0002, 0.2));
  const maxModes = clamp(Math.round(finiteNumber(settings.maxModes, RECOGNITION_DEFAULTS.maxModes)), 1, 32);
  const valleyRatio = clamp(finiteNumber(settings.modeValleyRatio, RECOGNITION_DEFAULTS.modeValleyRatio), 0.02, 0.9);
  const axis = (key) => [key >> (bits * 2), (key >> bits) & (side - 1), key & (side - 1)];

  // Waterfall: walk bins from the most populated down, unioning with already-visited
  // neighbours. Every union that joins two basins records the saddle that connects
  // them, which is exactly the depth of the valley between two colour modes.
  const visited = new Uint8Array(bins);
  const parent = new Int32Array(bins).fill(-1);
  const peakOf = new Float64Array(bins);
  const totalOf = new Float64Array(bins);
  const sumR = new Float64Array(bins);
  const sumG = new Float64Array(bins);
  const sumB = new Float64Array(bins);
  const alive = new Uint8Array(bins);
  const find = (key) => {
    let root = key;
    while (parent[root] !== root) root = parent[root];
    let walk = key;
    while (parent[walk] !== root) { const next = parent[walk]; parent[walk] = root; walk = next; }
    return root;
  };
  const seeds = [];
  const merges = [];
  const order = [];
  for (let key = 0; key < bins; key += 1) if (counts[key] > 0) order.push(key);
  order.sort((a, b) => counts[b] - counts[a]);
  for (const key of order) {
    visited[key] = 1;
    parent[key] = key;
    peakOf[key] = counts[key];
    totalOf[key] = counts[key];
    sumR[key] = sums[key * 3];
    sumG[key] = sums[key * 3 + 1];
    sumB[key] = sums[key * 3 + 2];
    alive[key] = counts[key] >= minCount ? 1 : 0;
    if (alive[key]) seeds.push(key);
    const [r, g, b] = axis(key);
    let root = key;
    for (let dr = -1; dr <= 1; dr += 1) {
      for (let dg = -1; dg <= 1; dg += 1) {
        for (let db = -1; db <= 1; db += 1) {
          if (!dr && !dg && !db) continue;
          const nr = r + dr; const ng = g + dg; const nb = b + db;
          if (nr < 0 || ng < 0 || nb < 0 || nr >= side || ng >= side || nb >= side) continue;
          const neighbour = (nr << (bits * 2)) | (ng << bits) | nb;
          if (!visited[neighbour]) continue;
          const other = find(neighbour);
          if (other === root) continue;
          if (counts[key] < peakOf[other]) merges.push({ level: counts[key], a: root, b: other });
          // Union by peak so the taller basin keeps its identity.
          const [keep, drop] = peakOf[root] >= peakOf[other] ? [root, other] : [other, root];
          parent[drop] = keep;
          peakOf[keep] = Math.max(peakOf[keep], peakOf[drop]);
          totalOf[keep] += totalOf[drop];
          sumR[keep] += sumR[drop];
          sumG[keep] += sumG[drop];
          sumB[keep] += sumB[drop];
          root = keep;
        }
      }
    }
  }

  // Replay the saddles from the shallowest valley down: a shallow valley does not
  // separate two colours, a deep one does.
  merges.sort((a, b) => b.level - a.level);
  for (const merge of merges) {
    const a = find(merge.a);
    const b = find(merge.b);
    if (a === b || !alive[a] || !alive[b]) continue;
    if (merge.level < valleyRatio * Math.min(peakOf[a], peakOf[b])) continue;
    const [keep, drop] = peakOf[a] >= peakOf[b] ? [a, b] : [b, a];
    parent[drop] = keep;
    totalOf[keep] += totalOf[drop];
    sumR[keep] += sumR[drop];
    sumG[keep] += sumG[drop];
    sumB[keep] += sumB[drop];
    alive[drop] = 0;
    alive[keep] = 1;
  }

  const modes = [];
  for (const seed of seeds) {
    const root = find(seed);
    if (!alive[root] || root !== seed) continue;
    const count = totalOf[root];
    if (count < minCount) continue;
    const rgb = { r: sumR[root] / count, g: sumG[root] / count, b: sumB[root] / count };
    const max = Math.max(rgb.r, rgb.g, rgb.b);
    const min = Math.min(rgb.r, rgb.g, rgb.b);
    modes.push({
      rgb,
      css: rgbToCss(rgb),
      count: Math.round(count),
      share: count / foreground,
      saturation: max - min,
      neutral: max - min < 32
    });
  }
  return modes.sort((a, b) => b.count - a.count).slice(0, maxModes);
}

/**
 * One palette entry per detected mode. `id` is the internal classification label and
 * `colorIndex` is the shipped colour the mode is written as, which the operator can
 * override per mode from the dialog.
 */
export function buildAdaptivePalette(modes, settings = RECOGNITION_DEFAULTS) {
  const overrides = settings.colorOverrides ?? {};
  return modes.map((mode, index) => {
    const override = overrides[index];
    const target = override == null || override === ''
      ? nearestPaletteColor(mode.rgb)
      : { ...getVehicleColorOption(Number(override)), distance: null };
    return {
      id: index,
      colorIndex: target.id,
      sampleCss: mode.css,
      name: target.name,
      label: target.label,
      css: target.css,
      rgb: mode.rgb,
      saturation: mode.saturation,
      neutral: mode.neutral,
      modeCount: mode.count,
      modeShare: mode.share,
      distance: target.distance,
      overridden: override != null && override !== ''
    };
  });
}

/**
 * Scene background is sampled from the image border, which is where road, sky and
 * HUD chrome live in every supplied reference. Palette colours that are too close
 * to one of those clusters are treated as undetectable and reported as skipped.
 */
export function collectBackgroundColors(image, options = RECOGNITION_DEFAULTS) {
  const { width, height, data } = image;
  const clusters = [];
  const limit = clamp(Math.round(finiteNumber(options.backgroundClusterLimit, 8)), 1, 24);
  const toleranceSquared = clamp(finiteNumber(options.backgroundTolerance, 42), 0, 442) ** 2;
  const margin = Math.max(1, Math.round(Math.min(width, height) * options.borderRatio));
  const step = Math.max(1, Math.round(Math.min(width, height) / 180));
  let samples = 0;
  const visit = (x, y) => {
    if (x < 0 || y < 0 || x >= width || y >= height) return;
    const index = (y * width + x) * 4;
    const sample = { r: data[index], g: data[index + 1], b: data[index + 2] };
    samples += 1;
    for (const cluster of clusters) {
      if (colorDistanceSquared(cluster, sample) > toleranceSquared) continue;
      cluster.count += 1;
      cluster.r += (sample.r - cluster.r) / cluster.count;
      cluster.g += (sample.g - cluster.g) / cluster.count;
      cluster.b += (sample.b - cluster.b) / cluster.count;
      return;
    }
    if (clusters.length < limit) clusters.push({ ...sample, count: 1 });
  };
  for (let x = 0; x < width; x += step) {
    for (let offset = 0; offset <= margin; offset += step) {
      visit(x, offset);
      visit(x, height - 1 - offset);
    }
  }
  for (let y = 0; y < height; y += step) {
    for (let offset = 0; offset <= margin; offset += step) {
      visit(offset, y);
      visit(width - 1 - offset, y);
    }
  }
  // A vehicle clipped by the image edge contributes a few border samples; the real
  // scene background runs along the whole border. Only frequent clusters count, so
  // an edge-touching red car cannot make red undetectable.
  const minimumCount = Math.max(8, samples * BACKGROUND_MIN_SHARE);
  return clusters
    .filter((cluster) => cluster.count >= minimumCount)
    .map((cluster) => ({ r: cluster.r, g: cluster.g, b: cluster.b, count: cluster.count }));
}

/**
 * Quantized RGB -> palette index lookup. 32k entries replace per-pixel palette
 * scans, so a full 1600x1600 reference resolves in a few milliseconds.
 */
export function buildClassificationLut(palette, background, settings) {
  const lut = new Uint8Array(LUT_SIZE).fill(NO_COLOR);
  const toleranceSquared = settings.tolerance ** 2;
  const backgroundSquared = settings.backgroundTolerance ** 2;
  const usable = palette.filter((color) => (
    settings.allowNeutralColors !== false || !color.neutral
  ));
  for (let r = 0; r < 32; r += 1) {
    for (let g = 0; g < 32; g += 1) {
      for (let b = 0; b < 32; b += 1) {
        const sample = { r: (r << LUT_SHIFT) + (1 << (LUT_SHIFT - 1)), g: (g << LUT_SHIFT) + (1 << (LUT_SHIFT - 1)), b: (b << LUT_SHIFT) + (1 << (LUT_SHIFT - 1)) };
        if (background.some((cluster) => colorDistanceSquared(cluster, sample) <= backgroundSquared)) continue;
        let best = NO_COLOR;
        let bestDistance = toleranceSquared;
        for (const color of usable) {
          const distance = Math.min(
            colorDistanceSquared(color.rgb, sample),
            ...(color.aliasRgb ?? []).map((alias) => colorDistanceSquared(alias, sample))
          );
          if (distance <= bestDistance) {
            bestDistance = distance;
            best = color.id;
          }
        }
        if (best !== NO_COLOR) lut[(r << (LUT_BITS * 2)) | (g << LUT_BITS) | b] = best;
      }
    }
  }
  return lut;
}

function classifyPixelIndex(lut, r, g, b) {
  return lut[((r >> LUT_SHIFT) << (LUT_BITS * 2)) | ((g >> LUT_SHIFT) << LUT_BITS) | (b >> LUT_SHIFT)];
}

export function classifyPixels(image, lut) {
  const { width, height, data } = image;
  const labels = new Uint8Array(width * height);
  const paletteIndex = new Map();
  for (let index = 0; index < width * height; index += 1) {
    const offset = index * 4;
    const id = classifyPixelIndex(lut, data[offset], data[offset + 1], data[offset + 2]);
    labels[index] = id;
    if (id !== NO_COLOR) paletteIndex.set(id, (paletteIndex.get(id) ?? 0) + 1);
  }
  return { labels, pixelCounts: paletteIndex };
}

function findComponents(labels, width, height) {
  const components = [];
  const visited = new Uint8Array(labels.length);
  const stack = new Int32Array(labels.length);
  for (let start = 0; start < labels.length; start += 1) {
    const colorIndex = labels[start];
    if (colorIndex === NO_COLOR || visited[start]) continue;
    let top = 0;
    stack[top] = start;
    visited[start] = 1;
    let area = 0;
    let sumX = 0;
    let sumY = 0;
    let minX = width;
    let minY = height;
    let maxX = -1;
    let maxY = -1;
    while (top >= 0) {
      const index = stack[top];
      top -= 1;
      const x = index % width;
      const y = (index - x) / width;
      area += 1;
      sumX += x;
      sumY += y;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
      for (let dy = -1; dy <= 1; dy += 1) {
        const ny = y + dy;
        if (ny < 0 || ny >= height) continue;
        for (let dx = -1; dx <= 1; dx += 1) {
          if (dx === 0 && dy === 0) continue;
          const nx = x + dx;
          if (nx < 0 || nx >= width) continue;
          const next = ny * width + nx;
          if (visited[next] || labels[next] !== colorIndex) continue;
          visited[next] = 1;
          top += 1;
          stack[top] = next;
        }
      }
    }
    components.push({
      colorIndex,
      area,
      x: sumX / area,
      y: sumY / area,
      minX,
      minY,
      maxX,
      maxY
    });
  }
  return components;
}

function markerScale(image) {
  return clamp(Math.min(image.width, image.height) / 730, 0.35, 2);
}

/**
 * Heading of one arrow glyph, read from its own shape rather than its bounding box.
 * A photographed arrow is only a handful of anti-aliased pixels, so the bounding box
 * is nearly square and the mass-projection test flips it; the glyph's tip is the end
 * that tapers, which is where the pixels sit furthest from the centroid.
 */
function arrowHeading(pixels, width, centroidX, centroidY) {
  // The tip is the narrow end of the glyph. A photographed arrow is a shaft two pixels
  // wide that flares into a head, so the end whose cross-section is wider is the tail
  // and the thinner end points forward. Below roughly ten pixels the anti-aliasing
  // decides the tip on its own, so a short glyph only supplies a position and its
  // heading stays unconfirmed for the operator.
  let sxx = 0;
  let syy = 0;
  let sxy = 0;
  for (const index of pixels) {
    const x = (index % width) - centroidX;
    const y = ((index - (index % width)) / width) - centroidY;
    sxx += x * x;
    syy += y * y;
    sxy += x * y;
  }
  const angle = 0.5 * Math.atan2(2 * sxy, sxx - syy);
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const projected = pixels.map((index) => {
    const x = (index % width) - centroidX;
    const y = ((index - (index % width)) / width) - centroidY;
    return { along: x * cos + y * sin, across: -x * sin + y * cos };
  });
  let minAlong = Infinity;
  let maxAlong = -Infinity;
  for (const point of projected) {
    if (point.along < minAlong) minAlong = point.along;
    if (point.along > maxAlong) maxAlong = point.along;
  }
  const widthNear = (along) => new Set(
    projected.filter((point) => Math.abs(point.along - along) < 1.2).map((point) => Math.round(point.across))
  ).size;
  // The supplied vehicle glyphs taper toward the arrow tip. Use the narrow end and
  // keep the mapping compatible with the existing authored yaw convention.
  const tipSign = widthNear(maxAlong - 0.6) > widthNear(minAlong + 0.6) ? -1 : 1;
  const tipX = tipSign * cos;
  const tipY = tipSign * sin;
  if (maxAlong - minAlong < 1) return null;
  // Keep the full arrow vector. The old detector collapsed every diagonal vehicle to
  // the dominant axis, which turned a radial toy-bus formation into an orthogonal
  // grid in the editor. Authored yaw 0 faces +z and the editor draws +z upward, so
  // screen vector (x, y) maps to yaw atan2(-x, -y).
  const rawYaw = (Math.atan2(-tipX, -tipY) * 180 / Math.PI + 360) % 360;
  // Photo arrows are anti-aliased and often only a few pixels wide. Quantising to 15°
  // keeps that noise from producing impossible fractional headings while preserving
  // the 45° and 30° diagonals used by the supplied formations.
  const yaw = (Math.round(rawYaw / 15) * 15) % 360;
  const confirmed = pixels.length >= 40;
  const direction = Math.abs(tipY) >= Math.abs(tipX)
    ? (tipY < 0 ? 'up' : 'down')
    : (tipX > 0 ? 'right' : 'left');
  return {
    direction,
    yaw,
    vectorX: tipX,
    vectorY: tipY,
    confirmed
  };
}

/**
 * A photographed arrow glyph is a thin sliver; a highlight reflecting off the roof or
 * the windshield is a compact blob of about the same area. The bounding box cannot tell
 * them apart once anti-aliasing rounds the glyph off, but the spread of the pixels can:
 * the ratio of the two principal second moments is large for a sliver and near one for
 * a blob.
 */
function arrowShaped(pixels, width, centroidX, centroidY) {
  let sxx = 0;
  let syy = 0;
  let sxy = 0;
  for (const index of pixels) {
    const x = (index % width) - centroidX;
    const y = ((index - (index % width)) / width) - centroidY;
    sxx += x * x;
    syy += y * y;
    sxy += x * y;
  }
  const trace = sxx + syy;
  const determinant = sxx * syy - sxy * sxy;
  const discriminant = Math.sqrt(Math.max(0, trace * trace / 4 - determinant));
  const major = Math.sqrt(Math.max(0, (trace / 2 + discriminant) / pixels.length));
  const minor = Math.sqrt(Math.max(0, (trace / 2 - discriminant) / pixels.length));
  const elongation = major / Math.max(0.3, minor);
  // The smallest glyphs, the ones a photo compresses to a handful of pixels, are only
  // mildly elongated, so they need the stricter cut; a longer glyph is unambiguous.
  return elongation >= 2.4 || (pixels.length >= 8 && elongation >= 2);
}

// Editor screenshots contain many clean rectangular labels and grid fragments whose
// aspect ratio looks arrow-like. A real arrow has a shaft and a flared head, so its
// cross-section changes materially along the principal axis; a rectangle's slices
// stay almost constant. This extra profile gate is only used for large components,
// where those screenshot artefacts dominate the white-pixel mask.
function arrowProfiled(pixels, width, centroidX, centroidY) {
  let sxx = 0;
  let syy = 0;
  let sxy = 0;
  for (const index of pixels) {
    const x = (index % width) - centroidX;
    const y = ((index - (index % width)) / width) - centroidY;
    sxx += x * x;
    syy += y * y;
    sxy += x * y;
  }
  const angle = 0.5 * Math.atan2(2 * sxy, sxx - syy);
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const projected = pixels.map((index) => {
    const x = (index % width) - centroidX;
    const y = ((index - (index % width)) / width) - centroidY;
    return { along: x * cos + y * sin, across: -x * sin + y * cos };
  });
  const minAlong = Math.min(...projected.map((point) => point.along));
  const maxAlong = Math.max(...projected.map((point) => point.along));
  const span = Math.max(1, maxAlong - minAlong);
  const slices = Array.from({ length: 8 }, () => []);
  for (const point of projected) {
    const index = Math.max(0, Math.min(7, Math.floor(((point.along - minAlong) / span) * 8)));
    slices[index].push(Math.round(point.across));
  }
  const widths = slices.filter((slice) => slice.length).map((slice) => {
    const min = Math.min(...slice);
    const max = Math.max(...slice);
    return max - min + 1;
  });
  if (widths.length < 5) return false;
  const narrow = Math.min(...widths);
  const wide = Math.max(...widths);
  return wide >= Math.max(4, narrow * 1.45) && wide - narrow >= 2;
}

function pixelLooksLikeArrow(data, offset) {
  const r = data[offset];
  const g = data[offset + 1];
  const b = data[offset + 2];
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  // The arrow glyph is the brightest thing on a vehicle, but a photographed one is only
  // a few anti-aliased pixels: a cut tight enough to be pure white splits it into
  // specks, while the pale backdrop and the card frame stay separable from this band
  // because dropWhiteBorders removes anything that spans the sheet.
  return min > 220 && max - min < 40;
}

/**
 * A photographed sheet carries white borders: the outer margin and, on scans with a
 * card frame, a second thin frame inside it. Either one touches the arrow glyphs on
 * the diagonal and welds every arrow into a single component. A border is a white
 * component that runs most of the way across the image while staying thin, so this
 * drops those and keeps the compact arrow glyphs.
 */
function dropWhiteBorders(labels, width, height) {
  const visited = new Uint8Array(labels.length);
  const stack = new Int32Array(labels.length);
  for (let start = 0; start < labels.length; start += 1) {
    if (labels[start] === NO_COLOR || visited[start]) continue;
    let top = 0;
    stack[top] = start;
    visited[start] = 1;
    const pixels = [];
    let minX = width;
    let minY = height;
    let maxX = -1;
    let maxY = -1;
    while (top >= 0) {
      const index = stack[top];
      top -= 1;
      pixels.push(index);
      const x = index % width;
      const y = (index - x) / width;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
      // Four-connected, so a frame that only brushes the arrow tips on the diagonal
      // stays its own component and can be dropped on its own.
      for (const [nx, ny] of [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]]) {
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
        const next = ny * width + nx;
        if (visited[next] || labels[next] === NO_COLOR) continue;
        visited[next] = 1;
        top += 1;
        stack[top] = next;
      }
    }
    const span = Math.max(maxX - minX + 1, maxY - minY + 1);
    const boxArea = (maxX - minX + 1) * (maxY - minY + 1);
    // A frame outlines a large region, so its pixels cover only a sliver of the box
    // they span; an arrow glyph is compact and fills most of its own box.
    if (span < Math.max(width, height) * 0.6 || pixels.length / boxArea > 0.35) continue;
    for (const index of pixels) labels[index] = NO_COLOR;
  }
}

function findArrowMarkerComponents(image) {
  const { width, height, data } = image;
  const labels = new Uint8Array(width * height).fill(NO_COLOR);
  for (let index = 0; index < labels.length; index += 1) {
    if (pixelLooksLikeArrow(data, index * 4)) labels[index] = 0;
  }
  dropWhiteBorders(labels, width, height);
  const visited = new Uint8Array(labels.length);
  const stack = new Int32Array(labels.length);
  const scale = markerScale(image);
  // Photographed formations shrink an arrow to a few anti-aliased pixels, while a
  // clean reference sheet draws one tens of pixels long. Both have to qualify.
  const minArea = 4;
  const maxArea = 520 * scale * scale;
  const minShort = 2;
  const maxShort = Math.max(minShort + 2, 20 * scale);
  const minLong = 3;
  const maxLong = Math.max(minLong + 4, 54 * scale);
  const components = [];

  for (let start = 0; start < labels.length; start += 1) {
    if (labels[start] === NO_COLOR || visited[start]) continue;
    let top = 0;
    stack[top] = start;
    visited[start] = 1;
    const pixels = [];
    let area = 0;
    let sumX = 0;
    let sumY = 0;
    let minX = width;
    let minY = height;
    let maxX = -1;
    let maxY = -1;
    while (top >= 0) {
      const index = stack[top];
      top -= 1;
      const x = index % width;
      const y = (index - x) / width;
      area += 1;
      if (pixels.length < 20000) pixels.push(index);
      sumX += x;
      sumY += y;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
      // Four-connected: a photographed backdrop is pale enough that arrows touch it
      // on the diagonal, and eight-connectivity welds the whole formation into one.
      for (const [nx, ny] of [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]]) {
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
        const next = ny * width + nx;
        if (visited[next] || labels[next] === NO_COLOR) continue;
        visited[next] = 1;
        top += 1;
        stack[top] = next;
      }
    }
    const bboxWidth = maxX - minX + 1;
    const bboxHeight = maxY - minY + 1;
    const short = Math.min(bboxWidth, bboxHeight);
    const long = Math.max(bboxWidth, bboxHeight);
    if (
      area < minArea || area > maxArea
      || short < minShort || short > maxShort
      || long < minLong || long > maxLong
      || (long >= 12 && long / Math.max(1, short) < 1.9)
      || pixels.length !== area
    ) continue;

    // A photographed arrow is a sliver even when anti-aliasing rounds its bounding box
    // off, while a specular highlight on the roof or windshield is a compact blob. The
    // second-moment ratio separates them where the bounding box cannot. Large editor
    // screenshot fragments need the stronger shaft/head profile check as well.
    if (!arrowShaped(pixels, width, sumX / area, sumY / area)) continue;
    if (area >= 80 && !arrowProfiled(pixels, width, sumX / area, sumY / area)) continue;

    const heading = arrowHeading(pixels, width, sumX / area, sumY / area);
    if (!heading) continue;
    const { direction } = heading;
    components.push({
      marker: true,
      x: sumX / area,
      y: sumY / area,
      rawX: sumX / area,
      rawY: sumY / area,
      area,
      minX,
      minY,
      maxX,
      maxY,
      bboxWidth,
      bboxHeight,
      aspect: long / Math.max(1, short),
      fill: area / (bboxWidth * bboxHeight),
      yaw: heading.yaw,
      direction,
      vectorX: heading.vectorX,
      vectorY: heading.vectorY,
      headingConfirmed: heading.confirmed,
      confidence: Math.min(1, long / Math.max(1, short) / 3)
    });
  }
  // A photographed vehicle carries a second white sliver besides the arrow: the
  // highlight on the windshield, a few pixels ahead of the glyph. Two real vehicles
  // never sit that close, so a pair whose centroids nearly touch is one vehicle, and
  // the arrow is the larger of the two.
  return dedupeTouchingMarkers(components, image);
}

function dedupeTouchingMarkers(components, image = null) {
  // The white arrow and the windshield highlight are separate components in a
  // rendered vehicle. Their distance scales with the source image, so a fixed
  // 12px radius only works for the small supplement sheets and leaves every
  // highlight as a second vehicle on large screenshots.
  const scale = image ? markerScale(image) : 1;
  const mergeDistance = clamp(22 * scale, 8, 48);
  const mergeDistanceSquared = mergeDistance * mergeDistance;
  // Group around the strongest marker instead of unioning every touching pair.
  // A highlight can bridge two nearby small arrows; transitive union would then
  // erase both vehicles even though neither arrow is actually that close to the
  // other. Processing large components first keeps the real arrow as the group
  // representative and makes the merge relation non-transitive.
  const remaining = [...components].sort((a, b) => b.area - a.area);
  const kept = [];
  for (const component of remaining) {
    const duplicate = kept.find((candidate) => {
      const dx = candidate.x - component.x;
      const dy = candidate.y - component.y;
      return dx * dx + dy * dy <= mergeDistanceSquared;
    });
    if (!duplicate) kept.push(component);
  }
  return kept;
}

export function detectArrowMarkerComponents(image) {
  return findArrowMarkerComponents(image);
}

/**
 * A recognition result screenshot is not a valid reference image: its red safety
 * frame, grid and numbered cards become stronger white/red markers than the buses
 * underneath. Detect the distinctive full-span red frame and fail closed instead of
 * silently authoring garbage vehicles from that editor output.
 */
export function detectEditorOverlayEvidence(image) {
  const { width, height, data } = image;
  const rowCounts = new Uint32Array(height);
  const columnCounts = new Uint32Array(width);
  let longestRowRun = 0;
  let longestColumnRun = 0;
  for (let y = 0; y < height; y += 1) {
    let rowRun = 0;
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4;
      const r = data[offset];
      const g = data[offset + 1];
      const b = data[offset + 2];
      if (r < 150 || r < g * 1.45 || r < b * 1.35) {
        rowRun = 0;
        continue;
      }
      rowCounts[y] += 1;
      columnCounts[x] += 1;
      rowRun += 1;
      longestRowRun = Math.max(longestRowRun, rowRun);
    }
  }
  for (let x = 0; x < width; x += 1) {
    let columnRun = 0;
    for (let y = 0; y < height; y += 1) {
      const offset = (y * width + x) * 4;
      const r = data[offset];
      const g = data[offset + 1];
      const b = data[offset + 2];
      if (r < 150 || r < g * 1.45 || r < b * 1.35) {
        columnRun = 0;
        continue;
      }
      columnRun += 1;
      longestColumnRun = Math.max(longestColumnRun, columnRun);
    }
  }
  const rowShare = Math.max(...rowCounts, 0) / Math.max(1, width);
  const columnShare = Math.max(...columnCounts, 0) / Math.max(1, height);
  const frameRun = Math.max(longestRowRun / Math.max(1, width), longestColumnRun / Math.max(1, height));
  return {
    detected: rowShare >= 0.32 && columnShare >= 0.32 && frameRun >= 0.42,
    rowShare,
    columnShare,
    frameRun
  };
}

function medianValue(values) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function sampleMarkerColor(image, marker) {
  const { width, height, data } = image;
  // The glyph's tip points at the front of the vehicle, so the body lies behind it.
  // Sampling ahead of the tip reads the backdrop or the next vehicle in line.
  const length = Math.hypot(marker.vectorX ?? 0, marker.vectorY ?? 0);
  // Tiny anti-aliased arrows do not carry a stable principal-axis sign. Keep the
  // tested cardinal fallback for them; use the full vector only for larger clean
  // glyphs where it improves diagonal body sampling.
  const useVector = length > 0.01 && (marker.area ?? 0) >= 80;
  const headingX = useVector
    ? -(marker.vectorX / length)
    : (marker.direction === 'left' ? 1 : marker.direction === 'right' ? -1 : 0);
  const headingY = useVector
    ? -(marker.vectorY / length)
    : (marker.direction === 'up' ? 1 : marker.direction === 'down' ? -1 : 0);
  const markerLength = Math.max(marker.bboxWidth ?? 0, marker.bboxHeight ?? 0);
  const sampleScale = markerLength >= 16 ? clamp(markerLength / 16, 1, 3.5) : 1;
  // Walk out from the arrow along its heading onto the body. Sampling beside the
  // arrow reads the neighbouring vehicle in a dense formation, and sampling at the
  // arrow itself reads the white glyph. The nearest window sometimes lands on the
  // arrow's own anti-aliased root or on the body's shaded edge, which reads as a
  // dull red; keep walking until the window clears that fringe.
  const candidates = [];
  for (const distance of [4, 6, 9, 13].map((value) => value * sampleScale)) {
    const sample = medianWindow(
      image,
      Math.round(marker.x + headingX * distance),
      Math.round(marker.y + headingY * distance),
      Math.max(2, Math.round(sampleScale * 2))
    );
    if (sample) candidates.push(sample);
  }
  const first = candidates[0];
  if (first && sampleSitsOnArrowFringe(first)) {
    const clearer = candidates.find((sample) => !sampleSitsOnArrowFringe(sample));
    if (clearer) return clearer;
  }
  return first ?? { r: 128, g: 128, b: 128 };
}

function medianWindow(image, centerX, centerY, radius = 2) {
  const { width, height, data } = image;
  const channels = [[], [], []];
  for (let dy = -radius; dy <= radius; dy += 1) {
    for (let dx = -radius; dx <= radius; dx += 1) {
      const x = centerX + dx;
      const y = centerY + dy;
      if (x < 0 || y < 0 || x >= width || y >= height) continue;
      const offset = (y * width + x) * 4;
      const r = data[offset];
      const g = data[offset + 1];
      const b = data[offset + 2];
      const max = Math.max(r, g, b);
      const min = Math.min(r, g, b);
      // Near-white pixels belong to the arrow glyph. The cut stays inside the gap
      // between that glyph and the palest body paint, whose channels still differ.
      if (max < 32 || max - min < 16 || (max > 246 && max - min < 60)) continue;
      channels[0].push(r);
      channels[1].push(g);
      channels[2].push(b);
    }
  }
  if (channels[0].length < 6) return null;
  return {
    r: Math.round(medianValue(channels[0])),
    g: Math.round(medianValue(channels[1])),
    b: Math.round(medianValue(channels[2]))
  };
}

// A window centred on the arrow fringe comes back dark and red-biased, far duller than
// the body around it. A genuinely pale paint stays bright, so only a dark reading counts
// as the fringe.
function sampleSitsOnArrowFringe(rgb) {
  const hsv = rgbToHsv(rgb);
  return hsv.v < 60 && hsv.s < 70 && (hsv.h < 8 || hsv.h > 345 || (hsv.h >= 8 && hsv.h < 38));
}

function estimateMarkerBodyLength(image, marker, bodySample) {
  const vectorLength = Math.hypot(marker.vectorX ?? 0, marker.vectorY ?? 0);
  if (vectorLength < 0.01 || !bodySample) return 0;
  const axisX = marker.vectorX / vectorLength;
  const axisY = marker.vectorY / vectorLength;
  const base = rgbToHsv(bodySample);
  if (base.s < 25) return 0;
  const markerLength = Math.max(marker.bboxWidth ?? 0, marker.bboxHeight ?? 0);
  const sampleScale = markerLength >= 16 ? clamp(markerLength / 16, 1, 3.5) : 1;
  const samples = [];
  for (let distance = -46 * sampleScale; distance <= 46 * sampleScale; distance += 2 * sampleScale) {
    const sample = medianWindow(
      image,
      Math.round(marker.x + axisX * distance),
      Math.round(marker.y + axisY * distance),
      Math.max(2, Math.round(sampleScale * 2))
    );
    if (!sample) continue;
    const hsv = rgbToHsv(sample);
    if (hsv.s >= 22 && hueDelta(base.h, hsv.h) <= 28 && Math.abs(base.v - hsv.v) <= 54) {
      samples.push(distance);
    }
  }
  return samples.length >= 3 ? Math.max(...samples) - Math.min(...samples) : 0;
}

function nearestImageVehicleColor(rgb) {
  const hsv = rgbToHsv(rgb);
  // The supplied supplement has closer light-green and cream swatches than the
  // legacy palette. Keep the mapping stable for photographed pastel bodies.
  if (hsv.h >= 72 && hsv.h <= 145) {
    if (hsv.s > 70 || (hsv.v < 62 && hsv.s > 45)) return getVehicleColorOption(1);
    return getVehicleColorOption(23);
  }
  // Photographed bodies are lit from above, so distance-to-swatch matching drifts:
  // a bright yellow lands nearer the dark-yellow swatch than the yellow one, and the
  // orange and brown bodies share a hue. Hue picks the family and brightness picks
  // the shade, but only for the pale or dull readings a photograph actually produces.
  // A saturated swatch keeps its own palette match, so authored colours are unchanged.
  if (hsv.s < 45 && hsv.v > 88 && (hsv.h < 15 || hsv.h > 330)) return getVehicleColorOption(4);
  if (hsv.h >= 38 && hsv.h <= 65 && hsv.v > 80 && hsv.s > 30) return getVehicleColorOption(5);
  if (hsv.h >= 8 && hsv.h < 38 && hsv.v < 75 && hsv.s < 85) return getVehicleColorOption(8);
  return nearestPaletteColor(rgb);
}

const OPPOSITE_DIRECTION = { up: 'down', down: 'up', left: 'right', right: 'left' };

function detectArrowVehicles(image, settings) {
  const markers = findArrowMarkerComponents(image);
  if (markers.length < 4) return null;
  const enriched = markers.map((marker) => {
    // A short photographed arrow is occasionally read backwards, which walks the sample
    // off the body and onto the pale backdrop. When that happens the opposite direction
    // still crosses the body, so take it instead.
    let sample = sampleMarkerColor(image, marker);
    // Only a near-grey reading means the walk left the body entirely. A mildly
    // desaturated one is still paint, and replacing it would read the neighbour.
    if (rgbToHsv(sample).s < 25) {
      const opposite = sampleMarkerColor(image, {
        ...marker,
        direction: OPPOSITE_DIRECTION[marker.direction],
        vectorX: -(marker.vectorX ?? 0),
        vectorY: -(marker.vectorY ?? 0)
      });
      if (rgbToHsv(opposite).s >= 40) sample = opposite;
    }
    const color = nearestImageVehicleColor(sample);
    return {
      ...marker,
      bodyLength: estimateMarkerBodyLength(image, marker, sample),
      colorIndex: color.id,
      sampleCss: `#${[sample.r, sample.g, sample.b].map((value) => value.toString(16).padStart(2, '0')).join('')}`,
      colorName: color.name,
      colorLabel: color.label,
      css: color.css,
      // Arrow-sheet photos use one consistent toy-bus footprint. Inferring 4/10
      // seats from the white glyph length mistakes perspective and highlights for
      // a different vehicle type; leave that decision to an explicit override.
      seats: settings.seats === 'auto' ? 6 : settings.seats
    };
  });
  // Do not classify arrow-sheet markers by apparent length. The same image can
  // contain perspective-scaled cars, and the white arrow often samples a nearby
  // same-colour body. The authored Q9 sheets are six-seat vehicles throughout;
  // callers can still force 4 or 10 seats from the dialog.
  const grid = refineGrid(enriched, { ...settings, snapToGrid: false, alignRows: false });
  const byColor = new Map();
  for (const blob of grid.blobs) byColor.set(blob.colorIndex, (byColor.get(blob.colorIndex) ?? 0) + 1);
  const colorMap = [...byColor.entries()].map(([colorIndex, count]) => {
    const color = getVehicleColorOption(colorIndex);
    return {
      modeIndex: colorIndex,
      sampleCss: color.css,
      colorIndex,
      name: color.name,
      label: color.label,
      css: color.css,
      count,
      share: count / Math.max(1, grid.blobs.length),
      distance: null,
      overridden: false,
      neutral: false,
      usable: true
    };
  });
  return {
    palette: colorMap.map((entry) => ({ ...entry, id: entry.modeIndex, rgb: hexToRgb(entry.css) })),
    colorMap,
    blobs: grid.blobs,
    grid,
    rejected: { area: 0, edge: 0, fill: 0, limit: 0, overlap: markers.length - grid.blobs.length },
    skippedColorIds: [],
    pixelCounts: new Map(byColor),
    method: 'arrow-markers'
  };
}

function boxesNear(a, b, gap) {
  return a.minX - gap <= b.maxX && b.minX - gap <= a.maxX && a.minY - gap <= b.maxY && b.minY - gap <= a.maxY;
}

function mergeNearbyComponents(components, gap) {
  const merged = components.map((component) => ({ ...component }));
  let changed = true;
  while (changed) {
    changed = false;
    for (let i = 0; i < merged.length; i += 1) {
      const a = merged[i];
      if (!a) continue;
      for (let j = i + 1; j < merged.length; j += 1) {
        const b = merged[j];
        if (!b || a.colorIndex !== b.colorIndex || !boxesNear(a, b, gap)) continue;
        const area = a.area + b.area;
        a.x = (a.x * a.area + b.x * b.area) / area;
        a.y = (a.y * a.area + b.y * b.area) / area;
        a.minX = Math.min(a.minX, b.minX);
        a.minY = Math.min(a.minY, b.minY);
        a.maxX = Math.max(a.maxX, b.maxX);
        a.maxY = Math.max(a.maxY, b.maxY);
        a.area = area;
        merged[j] = null;
        changed = true;
      }
    }
  }
  return merged.filter(Boolean);
}

function round(value) {
  return Math.round(value * 1000) / 1000;
}

function normalizeHeading(value) {
  return ((Number(value) % 360) + 360) % 360;
}

function toBlob(component, paletteByLabel) {
  const bboxWidth = component.maxX - component.minX + 1;
  const bboxHeight = component.maxY - component.minY + 1;
  const entry = paletteByLabel.get(component.colorIndex);
  const colorIndex = entry?.colorIndex ?? component.colorIndex;
  const color = getVehicleColorOption(colorIndex);
  return {
    colorIndex,
    modeIndex: entry?.id ?? null,
    sampleCss: entry?.sampleCss ?? color.css,
    colorName: color.name,
    colorLabel: color.label,
    css: color.css,
    x: component.x,
    y: component.y,
    rawX: component.x,
    rawY: component.y,
    area: component.area,
    minX: component.minX,
    minY: component.minY,
    maxX: component.maxX,
    maxY: component.maxY,
    bboxWidth,
    bboxHeight,
    aspect: Math.max(bboxWidth, bboxHeight) / Math.max(1, Math.min(bboxWidth, bboxHeight)),
    fill: component.area / (bboxWidth * bboxHeight)
  };
}

function median(sortedValues) {
  if (!sortedValues.length) return 0;
  const middle = Math.floor(sortedValues.length / 2);
  return sortedValues.length % 2 ? sortedValues[middle] : (sortedValues[middle - 1] + sortedValues[middle]) / 2;
}

/**
 * Axis pitch from a histogram of same-line pairwise distances, weighted by the
 * smaller blob area. Only pairs whose other axis is within `crossTolerance` are
 * counted, so two lanes of a dense field cannot fabricate a tiny pitch.
 */
function estimateAxisPitch(blobs, axis, crossAxis, crossTolerance) {
  if (blobs.length < 3) return 0;
  const values = blobs.map((blob) => blob[axis]);
  const cross = blobs.map((blob) => blob[crossAxis]);
  const areas = blobs.map((blob) => Math.max(1, blob.area));
  const span = Math.max(...values) - Math.min(...values);
  const limit = Math.max(24, Math.round(span));
  const bins = new Float64Array(limit + 2);
  for (let i = 0; i < values.length; i += 1) {
    for (let j = i + 1; j < values.length; j += 1) {
      if (Math.abs(cross[i] - cross[j]) > crossTolerance) continue;
      const distance = Math.abs(values[i] - values[j]);
      if (distance < 2 || distance > limit) continue;
      bins[Math.round(distance)] += Math.min(areas[i], areas[j]);
    }
  }
  if (!bins.some((value) => value > 0)) return 0;
  // Light smoothing keeps one-pixel jitter from splitting a peak.
  const smoothed = bins.map((value, index) => (bins[index - 1] ?? 0) * 0.5 + value + (bins[index + 1] ?? 0) * 0.5);
  const peak = Math.max(...smoothed);
  for (let index = 2; index < smoothed.length; index += 1) {
    if (smoothed[index] < peak * 0.5) continue;
    if (smoothed[index] < smoothed[index - 1] || smoothed[index] < (smoothed[index + 1] ?? 0)) continue;
    return index;
  }
  return 0;
}

function clusterRows(blobs, tolerance) {
  const sorted = [...blobs].sort((a, b) => a.y - b.y || a.x - b.x);
  const rows = [];
  for (const blob of sorted) {
    const row = rows[rows.length - 1];
    if (row && Math.abs(blob.y - row.center) <= tolerance) {
      row.items.push(blob);
      row.center = row.items.reduce((sum, item) => sum + item.y, 0) / row.items.length;
      continue;
    }
    rows.push({ center: blob.y, items: [blob] });
  }
  return rows;
}

/**
 * Rows and columns are re-spaced to the detected pitch. A photographed reference
 * has small perspective jitter; even spacing is what makes the result playable.
 *
 * Real captures also contain highlight splits and half-vehicle fragments, so the
 * pitch is measured on the larger half of the detections only, and a pitch smaller
 * than the vehicles themselves is discarded instead of squeezing a whole row.
 */
export function refineGrid(blobs, settings = RECOGNITION_DEFAULTS) {
  if (!blobs.length) return { blobs: [], pitchX: 0, pitchY: 0, rows: 0, columns: 0 };
  const working = blobs.map((blob) => ({ ...blob }));
  const extentX = median(working.map((blob) => blob.bboxWidth).sort((a, b) => a - b));
  const extentY = median(working.map((blob) => blob.bboxHeight).sort((a, b) => a - b));
  const medianArea = median(working.map((blob) => blob.area).sort((a, b) => a - b));
  const core = working.filter((blob) => blob.area >= medianArea);
  const sample = core.length >= 3 ? core : working;

  const candidateY = estimateAxisPitch(sample, 'y', 'x', Math.max(2, extentX * 0.6));
  const pitchY = candidateY >= Math.max(3, extentY * 0.6) ? candidateY : 0;
  const rowTolerance = pitchY
    ? Math.max(2, pitchY * settings.rowToleranceRatio)
    : Math.max(2, extentY * 0.6);
  const rows = clusterRows(working, rowTolerance);

  const candidateX = estimateAxisPitch(sample, 'x', 'y', rowTolerance);
  let pitchX = candidateX >= Math.max(3, extentX * 0.6) ? candidateX : 0;
  if (!pitchX) {
    // Fall back to the gaps between neighbours inside a row.
    const diffs = [];
    for (const row of rows) {
      const sorted = [...row.items].sort((a, b) => a.x - b.x);
      for (let index = 1; index < sorted.length; index += 1) diffs.push(sorted[index].x - sorted[index - 1].x);
    }
    const medianDiff = median(diffs.filter((value) => value > 1).sort((a, b) => a - b));
    pitchX = medianDiff >= Math.max(3, extentX * 0.6) ? medianDiff : 0;
  }

  // Rows are snapped to a lattice anchored on the first row, so one far-away
  // cluster (a second field or an inset panel) cannot drag the whole layout.
  const anchorY = rows[0]?.center ?? 0;
  const maxRowLength = rows.reduce((max, row) => Math.max(max, row.items.length), 0);
  rows.forEach((row, rowIndex) => {
    const targetY = settings.alignRows && pitchY
      ? anchorY + Math.round((row.center - anchorY) / pitchY) * pitchY
      : row.center;
    const sorted = [...row.items].sort((a, b) => a.x - b.x);
    const centerX = sorted.reduce((sum, item) => sum + item.x, 0) / sorted.length;
    sorted.forEach((item, columnIndex) => {
      item.row = rowIndex;
      item.column = columnIndex;
      if (settings.snapToGrid && pitchX) item.x = centerX + (columnIndex - (sorted.length - 1) / 2) * pitchX;
      else item.x = item.rawX;
      item.y = settings.alignRows && pitchY ? targetY : item.rawY;
    });
  });

  const placedRows = rows.flatMap((row) => row.items);
  const placed = splitMergedVehicles(placedRows, settings);
  return {
    blobs: placed,
    pitchX: round(pitchX),
    pitchY: round(pitchY),
    rows: rows.length,
    columns: maxRowLength
  };
}

function quantile(sortedValues, fraction) {
  if (!sortedValues.length) return 0;
  return sortedValues[Math.min(sortedValues.length - 1, Math.floor(sortedValues.length * fraction))];
}

/**
 * In a photographed field neighbouring vehicles touch, so one colour component can
 * cover two or three cars in a row. Splitting such a component on the detected cell
 * size recovers the real car count instead of turning a merged pair into one long
 * "bus". A genuine long vehicle stays whole: it grows on one axis only, by less than
 * the split threshold, while a merged run grows by whole cell widths.
 */
function splitMergedVehicles(blobs, settings) {
  const widths = blobs.map((blob) => blob.bboxWidth).sort((a, b) => a - b);
  const heights = blobs.map((blob) => blob.bboxHeight).sort((a, b) => a - b);
  // The lower three quarters give the single-vehicle size even when merged runs
  // already dominate the field.
  const unitX = Math.max(quantile(widths, 0.375), 1);
  const unitY = Math.max(quantile(heights, 0.375), 1);
  const medianHeight = quantile(heights, 0.5);
  const result = [];
  for (const blob of blobs) {
    if (blob.marker) {
      result.push({ ...blob, split: false, seats: settings.seats === 'auto' ? (blob.seats ?? 4) : settings.seats, yaw: blob.yaw ?? 0 });
      continue;
    }
    const countX = Math.max(1, Math.round(blob.bboxWidth / unitX));
    const countY = Math.max(1, Math.round(blob.bboxHeight / unitY));
    const splitX = settings.splitMerged && countX >= 2 && blob.bboxWidth >= unitX * 1.7 ? countX : 1;
    const splitY = settings.splitMerged && countY >= 2 && blob.bboxHeight >= unitY * 1.7 ? countY : 1;
    const pieces = splitX * splitY;
    for (let indexY = 0; indexY < splitY; indexY += 1) {
      for (let indexX = 0; indexX < splitX; indexX += 1) {
        const piece = { ...blob, split: pieces > 1 };
        if (splitX > 1) piece.x = blob.x + (indexX - (splitX - 1) / 2) * (blob.bboxWidth / splitX);
        if (splitY > 1) piece.y = blob.y + (indexY - (splitY - 1) / 2) * (blob.bboxHeight / splitY);
        if (settings.seats === 'auto') {
          // A wide component is a merged run of cars, never one long vehicle, so it
          // must not inherit the long-vehicle aspect rule.
          const mergedRun = piece.bboxWidth >= unitX * 1.5;
          // A long vehicle is ~1.45x a car's length; two stacked rows already reach
          // ~2x. Only the narrow band between them is a real 10-seat body, and a
          // merged run is never one. Horizontal long bodies stay 4 seats: at capture
          // scale they are indistinguishable from merged runs of ordinary cars.
          const heightRatio = piece.bboxHeight / Math.max(1, medianHeight);
          const longBody = heightRatio >= 1.25 && heightRatio <= 1.65;
          piece.seats = !piece.split && !mergedRun && longBody ? 10 : 4;
        } else piece.seats = settings.seats;
        piece.yaw = piece.bboxWidth >= piece.bboxHeight ? 0 : 90;
        result.push(piece);
      }
    }
  }
  return result;
}

export function filterBlobs(blobs, settings, image) {
  const imageArea = Math.max(1, image.width * image.height);
  const maxArea = imageArea * settings.maxAreaRatio;
  const maxEdge = Math.max(image.width, image.height) * settings.maxEdgeRatio;
  const rejected = { area: 0, edge: 0, fill: 0, limit: 0, overlap: 0 };
  const accepted = [];
  for (const blob of blobs) {
    if (blob.area < settings.minArea) { rejected.area += 1; continue; }
    if (blob.area > maxArea) { rejected.area += 1; continue; }
    if (blob.bboxWidth > maxEdge || blob.bboxHeight > maxEdge) { rejected.edge += 1; continue; }
    if (blob.fill < settings.fillRatio) { rejected.fill += 1; continue; }
    accepted.push(blob);
  }
  accepted.sort((a, b) => b.area - a.area);
  const limited = accepted.slice(0, settings.maxCells);
  rejected.limit = Math.max(0, accepted.length - limited.length);
  // Two detections sharing the same cell would place two vehicles on one another.
  const unique = [];
  for (const blob of limited.sort((a, b) => a.y - b.y || a.x - b.x)) {
    const duplicate = unique.find((other) => (
      other.colorIndex === blob.colorIndex
      && Math.abs(other.x - blob.x) <= Math.max(2, settings.mergeGap)
      && Math.abs(other.y - blob.y) <= Math.max(2, settings.mergeGap)
    ));
    if (duplicate) { rejected.overlap += 1; continue; }
    unique.push(blob);
  }
  return { blobs: unique, rejected };
}

export function detectVehicleBlobs(image, options = {}) {
  const settings = normalizeRecognitionOptions(options, image);
  const overlay = detectEditorOverlayEvidence(image);
  if (overlay.detected) {
    return {
      settings,
      palette: [],
      colorMap: [],
      background: [],
      blobs: [],
      grid: { blobs: [], pitchX: 0, pitchY: 0, rows: 0, columns: 0 },
      pixelCounts: new Map(),
      rejected: { area: 0, edge: 0, fill: 0, limit: 0, overlap: 0 },
      skippedColorIds: [],
      method: 'editor-overlay',
      warning: '检测到编辑器结果图的红色安全框。请上传没有红框、网格和编号牌的原始车辆图片。'
    };
  }
  const markerResult = detectArrowVehicles(image, settings);
  if (markerResult) return { settings, ...markerResult };
  const background = collectBackgroundColors(image, settings);
  const modes = settings.adaptivePalette ? detectColorModes(image, background, settings) : null;
  const palette = modes?.length ? buildAdaptivePalette(modes, settings) : buildPalette(settings);
  const shippedPalette = buildPalette(settings);
  const paletteByLabel = new Map(palette.map((entry) => [entry.id, entry]));
  const lut = buildClassificationLut(palette, background, settings);
  const { labels, pixelCounts } = classifyPixels(image, lut);
  const components = mergeNearbyComponents(findComponents(labels, image.width, image.height), settings.mergeGap);
  const detected = components.map((component) => toBlob(component, paletteByLabel));
  const { blobs, rejected } = filterBlobs(detected, settings, image);
  const grid = refineGrid(blobs, settings);
  const colorMap = palette.map((entry) => ({
    modeIndex: entry.id,
    sampleCss: entry.sampleCss,
    colorIndex: entry.colorIndex,
    name: entry.name,
    label: entry.label,
    css: entry.css,
    count: entry.modeCount ?? null,
    share: entry.modeShare ?? null,
    distance: entry.distance,
    overridden: Boolean(entry.overridden),
    neutral: entry.neutral,
    usable: settings.allowNeutralColors !== false || !entry.neutral
  }));
  return {
    settings,
    palette,
    colorMap,
    background,
    blobs: grid.blobs,
    grid,
    pixelCounts,
    rejected,
    /** Detected/shipped colours that were dropped before classification. */
    skippedColorIds: [...new Set([
      ...colorMap.filter((entry) => !entry.usable).map((entry) => entry.colorIndex),
      ...shippedPalette
        .filter((color) => background.some((cluster) => colorDistanceSquared(color.rgb, cluster) <= settings.backgroundTolerance ** 2))
        .map((color) => color.id)
    ])]
  };
}

export function createImageWorldMapping({ imageWidth, imageHeight, x = 0, z = 0, width = null, height = null, rotation = 0 }) {
  const aspect = imageWidth / Math.max(1, imageHeight);
  const worldWidth = Number(width) > 0 ? Number(width) : 8;
  return {
    x: finiteNumber(x, 0),
    z: finiteNumber(z, 0),
    width: worldWidth,
    height: Number(height) > 0 ? Number(height) : worldWidth / Math.max(0.0001, aspect),
    rotation: finiteNumber(rotation, 0),
    imageWidth: Math.max(1, imageWidth),
    imageHeight: Math.max(1, imageHeight)
  };
}

/** Normalized image UV -> world X/Z, matching the editor's underlay transform. */
export function imageUvToWorld(mapping, u, v) {
  const localX = (u - 0.5) * mapping.width;
  const localY = (v - 0.5) * mapping.height;
  const radians = mapping.rotation * Math.PI / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  return {
    x: mapping.x + localX * cos - localY * sin,
    z: mapping.z - (localX * sin + localY * cos)
  };
}

export function imagePixelToWorld(mapping, pixelX, pixelY) {
  return imageUvToWorld(mapping, (pixelX + 0.5) / mapping.imageWidth, (pixelY + 0.5) / mapping.imageHeight);
}

export function blobsToWorldVehicles(blobs, mapping) {
  return blobs.map((blob, index) => {
    const point = imagePixelToWorld(mapping, blob.x, blob.y);
    const bboxWidth = Math.max(1, Number(blob.bboxWidth) || 1);
    const bboxHeight = Math.max(1, Number(blob.bboxHeight) || 1);
    const imageLongAxis = Math.max(bboxWidth, bboxHeight);
    // Arrow pixels are much smaller than the vehicle body. bodyLength is useful
    // when available, but it can run into a neighbouring same-colour vehicle, so
    // keep the visual footprint bounded by the marker's own box.
    const longPixels = clamp(
      Math.max(imageLongAxis * 1.5, Number(blob.bodyLength) * 0.32 || 0),
      imageLongAxis * 1.4,
      imageLongAxis * 2.4
    );
    const shortPixels = longPixels / 1.9;
    const horizontal = Math.abs(Math.sin((blob.yaw ?? 0) * Math.PI / 180)) > 0.5;
    const recognitionWidth = (horizontal ? longPixels : shortPixels) * mapping.width / mapping.imageWidth;
    const recognitionLength = (horizontal ? shortPixels : longPixels) * mapping.height / mapping.imageHeight;
    return {
      order: index,
      colorIndex: blob.colorIndex,
      seats: blob.seats ?? 4,
      // The underlay can be rotated in the editor. Positions already use that
      // transform; apply the same rotation to the vehicle heading or the cars point
      // one way while their reference image points another.
      yaw: normalizeHeading((blob.yaw ?? 0) + mapping.rotation),
      x: round(point.x),
      z: round(point.z),
      pixelX: round(blob.x),
      pixelY: round(blob.y),
      area: blob.area,
      // Editor-only preview dimensions. The authoring model intentionally keeps
      // its canonical 4/6/10-seat sizes when this vehicle is applied.
      recognitionWidth: round(recognitionWidth),
      recognitionLength: round(recognitionLength),
      row: blob.row ?? 0,
      column: blob.column ?? 0
    };
  });
}

export function summarizeRecognition(result) {
  const byColor = new Map();
  for (const blob of result.blobs) byColor.set(blob.colorIndex, (byColor.get(blob.colorIndex) ?? 0) + 1);
  const colorMap = result.colorMap ?? [];
  const seats = result.vehicles.reduce((counts, vehicle) => {
    counts[vehicle.seats] = (counts[vehicle.seats] ?? 0) + 1;
    return counts;
  }, {});
  return {
    total: result.vehicles.length,
    colorMap,
    byColor: [...byColor.entries()].map(([id, count]) => ({ id, count, ...getVehicleColorOption(id) })).sort((a, b) => b.count - a.count || a.id - b.id),
    seats,
    pitch: { x: result.grid.pitchX, y: result.grid.pitchY },
    rows: result.grid.rows,
    columns: result.grid.columns,
    rejected: result.rejected,
    skippedColorIds: result.skippedColorIds
  };
}

/**
 * Full recognition pass: pixels in, world-space vehicles out.
 * `mapping` is normally the editor's 垫图 rectangle.
 */
export function recognizeLevelFromImage(image, mapping, options = {}) {
  if (!image || !image.data || !image.width || !image.height) throw new Error('图片数据不可用');
  const detection = detectVehicleBlobs(image, options);
  const worldMapping = mapping ?? createImageWorldMapping({
    imageWidth: image.width,
    imageHeight: image.height,
    width: 8
  });
  const vehicles = blobsToWorldVehicles(detection.blobs, worldMapping);
  const result = {
    vehicles,
    blobs: detection.blobs,
    colorMap: detection.colorMap,
    grid: detection.grid,
    rejected: detection.rejected,
    skippedColorIds: detection.skippedColorIds,
    pixelCounts: detection.pixelCounts,
    settings: detection.settings,
    method: detection.method ?? 'palette-components',
    warning: detection.warning ?? '',
    mapping: worldMapping,
    image: { width: image.width, height: image.height }
  };
  result.summary = summarizeRecognition(result);
  return result;
}
