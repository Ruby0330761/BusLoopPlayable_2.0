import { PNG } from '/tmp/q9work/node_modules/pngjs/lib/png.js';
import { readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { createLevelDocument, validateLevelDocument, LevelEditorModel } from '../src/level-editor-model.js';

const IMG = '/tmp/q9work/images';

const LEVELS = [
  { file: '1.png', key: 'level52', name: 'Q9V1', unityId: 52 },
  { file: '2.png', key: 'level53', name: 'Q9V2', unityId: 53 },
  { file: '3.png', key: 'level54', name: 'Q9V3', unityId: 54 },
  { file: '4.png', key: 'level55', name: 'Q9V4', unityId: 55 }
];

// Authored yaw: 0 faces +z. Runtime mirrors z (yaw becomes pi - yaw) and the
// editor draws with screen y = -z, so a direction read off the reference image
// lands upright on screen with this mapping.
const YAW = { up: 0, down: 180, left: 90, right: 270 };

function load(file) {
  const png = PNG.sync.read(readFileSync(`${IMG}/${file}`));
  return { w: png.width, h: png.height, px: png.data };
}

function isWhite(px, w, x, y) {
  const o = (y * w + x) * 4;
  const r = px[o], g = px[o + 1], b = px[o + 2];
  return Math.min(r, g, b) > 236 && Math.max(r, g, b) - Math.min(r, g, b) < 26;
}

function detect(img) {
  const { w, h, px } = img;
  const m = new Uint8Array(w * h);
  for (let y = 0; y < h; y += 1) for (let x = 0; x < w; x += 1) if (isWhite(px, w, x, y)) m[y * w + x] = 1;
  const seen = new Uint8Array(w * h);
  const comps = [];
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const i = y * w + x;
      if (!m[i] || seen[i]) continue;
      const st = [i]; seen[i] = 1; const pts = [];
      while (st.length) {
        const k = st.pop(); pts.push([k % w, (k - (k % w)) / w]);
        const cx = k % w; const cy = (k - cx) / w;
        for (let dy = -1; dy <= 1; dy += 1) for (let dx = -1; dx <= 1; dx += 1) {
          const nx = cx + dx; const ny = cy + dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          const j = ny * w + nx;
          if (m[j] && !seen[j]) { seen[j] = 1; st.push(j); }
        }
      }
      if (pts.length < 6 || pts.length > 40) continue;
      const xs = pts.map((p) => p[0]); const ys = pts.map((p) => p[1]);
      if (Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)) > 22) continue;
      comps.push(pts);
    }
  }
  const clusters = [];
  for (const pts of [...comps].sort((a, b) => b.length - a.length)) {
    const cx = pts.reduce((s, p) => s + p[0], 0) / pts.length;
    const cy = pts.reduce((s, p) => s + p[1], 0) / pts.length;
    const hit = clusters.find((cl) => Math.hypot(cx - cl.cx, cy - cl.cy) < 13);
    if (hit) hit.pts.push(...pts); else clusters.push({ cx, cy, pts: [...pts] });
  }
  return clusters.map((cl) => {
    const n = cl.pts.length;
    return {
      x: cl.pts.reduce((s, p) => s + p[0], 0) / n,
      y: cl.pts.reduce((s, p) => s + p[1], 0) / n
    };
  });
}

function sample(img, x, y) {
  const { w, h, px } = img;
  const xi = Math.round(x); const yi = Math.round(y);
  const rs = []; const gs = []; const bs = [];
  for (let dy = -7; dy <= 7; dy += 1) for (let dx = -7; dx <= 7; dx += 1) {
    const xx = xi + dx; const yy = yi + dy;
    if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
    if (dx * dx + dy * dy > 49) continue;
    const o = (yy * w + xx) * 4;
    const r = px[o]; const g = px[o + 1]; const b = px[o + 2];
    const max = Math.max(r, g, b); const min = Math.min(r, g, b);
    if (max - min < 45 || max < 70 || min > 236) continue;
    rs.push(r); gs.push(g); bs.push(b);
  }
  if (!rs.length) return null;
  const mid = (arr) => arr.sort((a, b) => a - b)[Math.floor(arr.length / 2)];
  return [mid(rs), mid(gs), mid(bs)];
}

function hsv(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b); const min = Math.min(r, g, b); const d = max - min;
  let h = 0;
  if (d) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60; if (h < 0) h += 360;
  }
  return [h, max ? d / max : 0, max];
}

// Palette swatches the reference colours land on. Dark brown is a body
// override because no built-in brown is dark enough.
const SWATCH = {
  red: 4, orange: 6, yellow: 5, brown: 8,
  green: 1, darkgreen: 9,
  cyan: 0, purple: 3, lilac: 3, white: 18
};
const BODY = { brown: '#6e3a22' };
// Only the maple trunks use a darker brown than the built-in swatch.
const STEMS = new Set(['1.png', '4.png']);

function classify(rgb, file) {
  const [h, s, v] = hsv(...rgb);
  if (file === '2.png' && h > 70 && h < 170 && s > 0.25) return v < 0.62 ? 'darkgreen' : 'green';
  if (file === '3.png') {
    if (h >= 185 && h <= 215 && s > 0.35 && v > 0.6) return 'cyan';
    if (s < 0.30 && v > 0.62) return 'white';
    if (h > 250 && h < 330) return v < 0.55 ? 'purple' : 'lilac';
    return 'lilac';
  }
  if (h < 20 || h > 345) return v < 0.58 ? 'brown' : 'red';
  if (h < 45) return v < 0.58 ? 'brown' : 'orange';
  return 'yellow';
}

// Direction read from the reference, keyed by the detected cluster nearest to
// the hand-measured image point. Image y grows downward.
const ORIENT = {
  '1.png': [
    // Numbered top to bottom, left to right, read off the enlarged reference.
    [170, 64, 'up', 'red'], [183, 77, 'down', 'yellow'], [155, 77, 'down', 'yellow'], [170, 89, 'up', 'yellow'],
    [148, 94, 'down', 'red'], [193, 94, 'down', 'red'], [129, 98, 'left', 'red'],
    [170, 110, 'up', 'red'], [127, 119, 'down', 'orange'], [213, 119, 'down', 'orange'],
    [73, 125, 'right', 'red'], [267, 126, 'left', 'red'],
    [170, 131, 'up', 'orange'], [240, 135, 'left', 'yellow'], [102, 135, 'right', 'yellow'], [156, 141, 'left', 'red'],
    [123, 141, 'left', 'red'], [217, 142, 'right', 'red'], [185, 143, 'down', 'red'],
    [75, 145, 'down', 'orange'], [266, 146, 'down', 'orange'],
    [170, 157, 'up', 'yellow'], [135, 162, 'down', 'yellow'], [207, 163, 'down', 'yellow'],
    [68, 169, 'right', 'red'], [271, 169, 'left', 'red'], [194, 177, 'left', 'red'], [147, 178, 'right', 'red'],
    [170, 182, 'up', 'red'], [81, 184, 'right', 'yellow'], [259, 185, 'left', 'yellow'],
    [101, 194, 'right', 'red'], [239, 194, 'left', 'red'],
    [170, 206, 'up', 'yellow'], [109, 212, 'down', 'orange'], [232, 212, 'down', 'orange'], [154, 218, 'down', 'orange'],
    [211, 219, 'down', 'orange'], [128, 219, 'down', 'yellow'], [185, 219, 'down', 'orange'],
    [95, 228, 'left', 'red'], [246, 229, 'right', 'red'],
    [170, 235, 'down', 'brown'], [170, 261, 'down', 'brown']
  ],
  '2.png': [
    // Numbered top to bottom, left to right. Colours and headings read off the
    // enlarged reference: stem, then the outer ring, then the inner ring.
    // One entry per detected arrow, in the same top-to-bottom numbering as the
    // reference overlay, so every entry lands on exactly one vehicle.
    [182, 73, 'left', 'green'], [233, 80, 'left', 'green'], [211, 80, 'right', 'green'], [170, 96, 'down', 'green'],
    [145, 104, 'right', 'yellow'], [193, 105, 'left', 'yellow'], [119, 109, 'right', 'red'], [223, 109, 'left', 'red'],
    [170, 122, 'down', 'orange'], [253, 126, 'left', 'yellow'], [88, 127, 'up', 'orange'], [147, 129, 'up', 'red'],
    [193, 129, 'down', 'orange'], [105, 133, 'down', 'orange'], [236, 133, 'down', 'orange'],
    [132, 147, 'up', 'brown'], [208, 147, 'up', 'brown'], [171, 150, 'down', 'yellow'], [272, 152, 'down', 'orange'],
    [69, 153, 'up', 'red'], [146, 161, 'down', 'yellow'], [251, 162, 'down', 'red'], [196, 162, 'up', 'brown'],
    [90, 162, 'up', 'red'], [120, 164, 'down', 'yellow'], [221, 165, 'down', 'brown'],
    [132, 179, 'left', 'brown'], [207, 179, 'down', 'brown'], [171, 180, 'down', 'orange'], [278, 184, 'down', 'yellow'],
    [64, 184, 'up', 'yellow'], [89, 197, 'up', 'red'], [253, 197, 'left', 'red'], [229, 201, 'down', 'yellow'],
    [114, 201, 'left', 'brown'], [209, 212, 'right', 'brown'], [134, 212, 'left', 'brown'], [183, 217, 'left', 'brown'],
    [159, 217, 'right', 'brown'], [74, 218, 'up', 'orange'], [268, 218, 'down', 'orange'], [100, 219, 'right', 'yellow'],
    [242, 219, 'right', 'brown'], [145, 236, 'down', 'orange'], [198, 236, 'down', 'orange'], [96, 243, 'right', 'yellow'],
    [247, 243, 'left', 'yellow'], [123, 243, 'right', 'yellow'], [221, 243, 'left', 'yellow'], [198, 254, 'up', 'red'],
    [145, 254, 'down', 'red'], [172, 254, 'left', 'orange']
  ],
  '4.png': [
    // One entry per detected arrow, numbered top to bottom as in the overlay.
    // Leaf reads red at the tips, orange inside that, yellow at the core;
    // the trunk is dark brown (the body override comes from STEMS).
    [169, 65, 'up', 'red'], [154, 80, 'up', 'yellow'], [183, 80, 'up', 'yellow'], [169, 90, 'up', 'orange'],
    [136, 97, 'up', 'red'], [203, 98, 'down', 'red'], [186, 103, 'up', 'red'], [153, 103, 'up', 'yellow'],
    [85, 113, 'down', 'red'], [252, 115, 'down', 'orange'], [169, 121, 'right', 'red'], [198, 121, 'up', 'yellow'],
    [140, 122, 'up', 'orange'], [106, 126, 'up', 'yellow'], [232, 127, 'up', 'yellow'], [261, 131, 'up', 'red'],
    [77, 131, 'down', 'red'], [93, 139, 'up', 'yellow'], [245, 140, 'up', 'orange'], [189, 141, 'right', 'orange'],
    [148, 141, 'left', 'yellow'], [113, 144, 'right', 'red'], [225, 145, 'left', 'red'], [170, 147, 'up', 'red'],
    [54, 148, 'left', 'yellow'], [286, 151, 'right', 'yellow'], [74, 153, 'up', 'red'], [265, 155, 'up', 'red'],
    [118, 158, 'right', 'orange'], [221, 159, 'right', 'yellow'], [184, 161, 'up', 'red'], [155, 162, 'down', 'yellow'],
    [140, 162, 'down', 'red'], [198, 164, 'down', 'red'], [95, 170, 'down', 'red'], [242, 171, 'up', 'red'],
    [124, 178, 'left', 'red'], [215, 178, 'right', 'red'], [72, 180, 'right', 'yellow'], [266, 180, 'right', 'orange'],
    [169, 184, 'up', 'orange'], [186, 186, 'up', 'yellow'], [152, 187, 'up', 'red'], [249, 191, 'left', 'red'],
    [89, 191, 'down', 'red'], [229, 197, 'left', 'yellow'], [110, 197, 'left', 'yellow'], [129, 201, 'up', 'orange'],
    [210, 202, 'up', 'orange'], [192, 211, 'down', 'red'], [147, 211, 'up', 'yellow'], [169, 219, 'down', 'brown'],
    [111, 221, 'up', 'red'], [228, 222, 'up', 'red'], [133, 227, 'left', 'red'], [205, 227, 'right', 'yellow'],
    [108, 239, 'right', 'yellow'], [231, 240, 'left', 'yellow'], [169, 246, 'down', 'brown'], [169, 271, 'down', 'brown']
  ],
  '3.png': [
    // One entry per detected arrow, numbered top to bottom as in the overlay.
    // The curl reads cyan on the outside, white inside it, purple at the core.
    [213, 63, 'right', 'cyan'], [247, 76, 'down', 'white'], [204, 79, 'down', 'white'], [186, 83, 'up', 'cyan'],
    [236, 86, 'left', 'purple'], [250, 100, 'right', 'cyan'], [173, 103, 'up', 'white'], [154, 109, 'up', 'cyan'],
    [215, 110, 'down', 'purple'], [270, 111, 'down', 'cyan'], [201, 113, 'up', 'purple'], [242, 118, 'left', 'purple'],
    [258, 121, 'up', 'white'], [247, 130, 'right', 'cyan'], [106, 132, 'right', 'purple'], [131, 134, 'right', 'cyan'],
    [233, 145, 'right', 'purple'], [177, 145, 'up', 'cyan'], [107, 147, 'down', 'cyan'], [157, 153, 'up', 'white'],
    [260, 158, 'up', 'cyan'], [138, 159, 'left', 'purple'], [270, 173, 'down', 'cyan'], [250, 179, 'up', 'white'],
    [202, 179, 'up', 'purple'], [117, 182, 'right', 'cyan'], [230, 184, 'up', 'cyan'], [172, 184, 'up', 'white'],
    [270, 192, 'right', 'cyan'], [195, 196, 'left', 'white'], [119, 200, 'left', 'purple'], [63, 207, 'down', 'cyan'],
    [139, 210, 'right', 'cyan'], [193, 216, 'up', 'white'], [162, 217, 'right', 'cyan'], [122, 219, 'right', 'white'],
    [65, 225, 'left', 'white'], [99, 232, 'up', 'purple'], [169, 233, 'right', 'cyan'], [190, 240, 'right', 'cyan'],
    [85, 242, 'down', 'purple'], [134, 256, 'up', 'cyan']
  ]
};

// One image pixel maps to this many authored units, which lands the formations
// in the same world span as the existing levels.
const PIXEL_SCALE = 0.016;
// Denser reference photos need a larger scale so neighbouring vehicles clear
// the 0.27 body width.
const PIXEL_SCALE_BY_FILE = { '3.png': 0.022, '4.png': 0.0205 };
const SEATS = 6;

for (const level of LEVELS) {
  const img = load(level.file);
  const clusters = detect(img);
  const used = new Set();
  const placed = [];
  for (const [px, py, dir, color] of ORIENT[level.file]) {
    let best = null;
    clusters.forEach((cl, index) => {
      if (used.has(index)) return;
      const dist = Math.hypot(cl.x - px, cl.y - py);
      if (!best || dist < best.dist) best = { index, dist };
    });
    if (!best || best.dist > 20) {
      throw new Error(`${level.name}: orientation point ${px},${py} matches nothing`);
    }
    used.add(best.index);
    const cl = clusters[best.index];
    // Hand-labelled colours win. The sampler only fills entries that were not
    // labelled, and it has to look past the white arrow onto the body.
    let resolved = color;
    if (!resolved) {
      const step = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] }[dir];
      let rgb = null;
      for (const dist of [10, 16, 22, 28, 34]) {
        rgb = sample(img, cl.x + step[0] * dist, cl.y + step[1] * dist);
        if (rgb) break;
      }
      if (!rgb) throw new Error(`${level.name}: no body colour at ${Math.round(cl.x)},${Math.round(cl.y)}`);
      resolved = classify(rgb, level.file);
    }
    placed.push({ cl, dir, color: resolved });
  }
  if (used.size !== clusters.length) {
    throw new Error(`${level.name}: ${clusters.length - used.size} detected vehicles have no orientation`);
  }

  const cx = placed.reduce((sum, v) => sum + v.cl.x, 0) / placed.length;
  const cy = placed.reduce((sum, v) => sum + v.cl.y, 0) / placed.length;
  const vehicles = placed.map((v, index) => {
    const color = v.color;
    return {
      id: index + 1,
      seats: SEATS,
      colorIndex: SWATCH[color],
      colorOverrides: BODY[color] && STEMS.has(level.file) ? { body: BODY[color] } : {},
      // Image y grows downward and the runtime mirrors z, so image-down maps to
      // authored +z. That keeps the picture upright on screen.
      x: (v.cl.x - cx) * (PIXEL_SCALE_BY_FILE[level.file] ?? PIXEL_SCALE),
      z: (v.cl.y - cy) * (PIXEL_SCALE_BY_FILE[level.file] ?? PIXEL_SCALE),
      yaw: YAW[v.dir]
    };
  });

  const document = createLevelDocument({
    key: level.key,
    displayName: level.name,
    unityId: level.unityId,
    mapScale: 1,
    vehicles
  });
  const model = new LevelEditorModel(document);
  // Adding and removing one vehicle runs the model's own capacity sync, which
  // fills both queues to match the seats before the depth sort orders them.
  const probe = model.addVehicle();
  model.select(`vehicle:${probe.id}`);
  model.removeSelected();
  model.rebuildDepthGraph();
  model.sortPassengerQueuesByDepth();
  const result = validateLevelDocument(model.document);
  if (!result.valid) throw new Error(`${level.name}: ${result.errors.join('; ')}`);

  const seats = vehicles.reduce((sum, v) => sum + v.seats, 0);
  const passengers = model.document.passengerQueues.reduce((sum, q) => sum + q.length, 0);
  const spanX = Math.max(...vehicles.map((v) => v.x)) - Math.min(...vehicles.map((v) => v.x));
  const spanZ = Math.max(...vehicles.map((v) => v.z)) - Math.min(...vehicles.map((v) => v.z));
  console.log(`${level.name}: ${vehicles.length} vehicles, ${seats} seats, queues ${model.document.passengerQueues.map((q) => q.length).join('/')} (total ${passengers}), span ${spanX.toFixed(2)} x ${spanZ.toFixed(2)}, warnings ${result.warnings.length}`);

  await mkdir(new URL('../artifacts/web-levels/', import.meta.url), { recursive: true });
  await writeFile(new URL(`../artifacts/web-levels/${level.key}.json`, import.meta.url), `${JSON.stringify(model.document, null, 2)}\n`);
}
