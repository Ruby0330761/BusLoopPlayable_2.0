// Builds the nine supplied BusJam colour variants (Unity indices 17-25).
//
// Inputs
//   artifacts/color-supplement-sources/<name>.png
//     Copied verbatim from the supplied `车辆及小人颜色补充.zip`. Each is a
//     512x512 atlas with the SAME layout as the shipped `color_0..10` set, but
//     the flat body region is left pure white because Unity tints it through the
//     material's m_BaseColor / m_EmissionColor (see `passenger_<name>.prefab`).
//     `darkred` ships no texture; its prefab references the same texture as
//     `gray`/`white`, so it reuses that shared neutral source.
//   public/assets/unity/textures/color_0..10_*.png
//     The shipped atlases. They carry the body's highlight and shadow entries as
//     separate palette indices, which is the shading the vehicle model samples.
//
// Output
//   public/assets/unity/textures/color_17..25_*.png
//   public/assets/applovin/textures/color_17..25_*_q85.webp
//
// Rule: every non-body pixel (face, skin, eyes, shoes, detail) comes from the
// supplied texture untouched, so the artist's art is what ships. Body pixels
// take their shading from a shipped atlas whose palette is re-hued to the
// variant colour, because the supplied body region is a flat tint placeholder
// and a vehicle samples the body's highlight/shadow entries too.
//
// `black` already bakes its own body colour, so it ships exactly as supplied.
//
// Usage: node scripts/generate-color-variant-textures.mjs [--check]
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { deflateSync, inflateSync, crc32 } from 'node:zlib';

const ROOT = process.cwd();
const SOURCE_ROOT = path.join(ROOT, 'artifacts', 'color-supplement-sources');
const PNG_ROOT = path.join(ROOT, 'public', 'assets', 'unity', 'textures');
const WEBP_ROOT = path.join(ROOT, 'public', 'assets', 'applovin', 'textures');
const MASK_ATLAS = path.join(PNG_ROOT, 'color_0_blue.png');
const CHECK_ONLY = process.argv.includes('--check');
const NEAR_WHITE = 240;

const SOURCE_COLORS = Object.freeze([
  [0, 'blue'], [1, 'green'], [2, 'pink'], [3, 'purple'], [4, 'red'], [5, 'yellow'],
  [6, 'orange'], [7, 'lightblue'], [8, 'brown'], [9, 'darkgreen'], [10, 'darkblue']
]);

// Body paint per variant, matched against the supplied reference screenshots
const VARIANTS = Object.freeze([
  { id: 17, name: 'black', source: 'black', paint: [45, 45, 48] },
  { id: 18, name: 'white', source: 'white', paint: [235, 235, 232] },
  { id: 19, name: 'darkred', source: 'gray', paint: [140, 16, 16] },
  { id: 20, name: 'darkyellow', source: 'darkyellow', paint: [200, 152, 8] },
  { id: 21, name: 'cream', source: 'cream', paint: [238, 222, 190] },
  { id: 22, name: 'mintgreen', source: 'mintgreen', paint: [105, 200, 170] },
  { id: 23, name: 'matchagreen', source: 'matchagreen', paint: [150, 200, 130] },
  { id: 24, name: 'lightpink', source: 'lightpink', paint: [246, 152, 196] },
  { id: 25, name: 'gray', source: 'gray', paint: [150, 152, 155] }
]);

function chunk(type, data) {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, 'ascii');
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const tail = Buffer.alloc(4);
  tail.writeUInt32BE(crc32(body) >>> 0, 0);
  return Buffer.concat([head, data, tail]);
}

function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a); const pb = Math.abs(p - b); const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

function readChunks(buffer) {
  let offset = 8;
  let header = null;
  const idat = [];
  let plte = null;
  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString('ascii', offset + 4, offset + 8);
    const data = buffer.subarray(offset + 8, offset + 8 + length);
    if (type === 'IHDR') header = { width: data.readUInt32BE(0), height: data.readUInt32BE(4), bitDepth: data[8], colorType: data[9], interlace: data[12] };
    else if (type === 'PLTE') plte = Buffer.from(data);
    else if (type === 'IDAT') idat.push(Buffer.from(data));
    else if (type === 'IEND') break;
    offset += length + 12;
  }
  if (!header) throw new Error('PNG has no IHDR.');
  if (header.bitDepth !== 8 || header.interlace !== 0) throw new Error('Only 8-bit non-interlaced PNGs are supported.');
  return { ...header, idat: Buffer.concat(idat), plte };
}

function decodeRows({ width, height, colorType, idat }) {
  const bpp = colorType === 3 ? 1 : colorType === 2 ? 3 : colorType === 6 ? 4 : colorType === 4 ? 2 : 1;
  const raw = inflateSync(idat);
  const rows = [];
  let prev = Buffer.alloc(width * bpp);
  let cursor = 0;
  for (let y = 0; y < height; y += 1) {
    const filter = raw[cursor]; cursor += 1;
    const row = Buffer.from(raw.subarray(cursor, cursor + width * bpp)); cursor += width * bpp;
    for (let x = 0; x < row.length; x += 1) {
      const left = x >= bpp ? row[x - bpp] : 0;
      const up = prev[x];
      const upLeft = x >= bpp ? prev[x - bpp] : 0;
      let value = row[x];
      if (filter === 1) value += left;
      else if (filter === 2) value += up;
      else if (filter === 3) value += (left + up) >> 1;
      else if (filter === 4) value += paeth(left, up, upLeft);
      row[x] = value & 0xff;
    }
    rows.push(row);
    prev = row;
  }
  return { rows, bpp };
}

function decodeIndexed(file) {
  const info = readChunks(readFileSync(file));
  if (info.colorType !== 3) throw new Error(`${file} must be an indexed PNG.`);
  const { rows } = decodeRows(info);
  const palette = Array.from(
    { length: info.plte.length / 3 },
    (_, i) => [info.plte[i * 3], info.plte[i * 3 + 1], info.plte[i * 3 + 2]]
  );
  const usage = new Array(palette.length).fill(0);
  for (const row of rows) for (const index of row) usage[index] += 1;
  return { width: info.width, height: info.height, rows, palette, usage };
}

function decodeRgb(file) {
  const info = readChunks(readFileSync(file));
  if (info.colorType !== 2 && info.colorType !== 6) throw new Error(`${file} must be RGB or RGBA.`);
  const { rows, bpp } = decodeRows(info);
  const rgb = Buffer.alloc(info.width * info.height * 3);
  for (let y = 0; y < info.height; y += 1) {
    for (let x = 0; x < info.width; x += 1) {
      const from = x * bpp;
      const to = (y * info.width + x) * 3;
      rgb[to] = rows[y][from];
      rgb[to + 1] = rows[y][from + 1];
      rgb[to + 2] = rows[y][from + 2];
    }
  }
  return { width: info.width, height: info.height, rgb };
}

function encodeRgbPng(width, height, rgb) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 2;
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (width * 3 + 1)] = 0;
    rgb.copy(raw, y * (width * 3 + 1) + 1, y * width * 3, (y + 1) * width * 3);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

function toHsv([r, g, b]) {
  const max = Math.max(r, g, b); const min = Math.min(r, g, b);
  const value = max / 255;
  const saturation = max === 0 ? 0 : (max - min) / max;
  let hue = 0;
  if (max !== min) {
    const delta = max - min;
    if (max === r) hue = ((g - b) / delta) % 6;
    else if (max === g) hue = (b - r) / delta + 2;
    else hue = (r - g) / delta + 4;
    hue *= 60;
    if (hue < 0) hue += 360;
  }
  return [hue, saturation, value];
}

function fromHsv(hue, saturation, value) {
  const h = ((hue % 360) + 360) % 360;
  const c = value * saturation;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = value - c;
  const seg = Math.floor(h / 60) % 6;
  const table = [[c, x, 0], [x, c, 0], [0, c, x], [0, x, c], [x, 0, c], [c, 0, x]][seg];
  return table.map((channel) => Math.max(0, Math.min(255, Math.round((channel + m) * 255))));
}

const hueGap = (a, b) => {
  const gap = Math.abs(a - b) % 360;
  return gap > 180 ? 360 - gap : gap;
};

const distance = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

function bodyIndexOf(atlas) {
  let best = 0;
  for (let i = 1; i < atlas.usage.length; i += 1) if (atlas.usage[i] > atlas.usage[best]) best = i;
  return best;
}

// The painted body is not one palette entry: highlight and shadow live in their
// own indices. A vehicle samples all of them, so collect the whole family.
function bodyFamily(atlas) {
  const body = bodyIndexOf(atlas);
  const [bodyHue] = toHsv(atlas.palette[body]);
  const family = new Set([body]);
  atlas.palette.forEach((color, index) => {
    if (atlas.usage[index] === 0) return;
    const [hue, saturation] = toHsv(color);
    if (saturation < 0.12) return;
    if (hueGap(hue, bodyHue) > 45) return;
    family.add(index);
  });
  return family;
}

// Shared UV layout, so a blue index maps to one donor index.
function correspondence(base, target, step = 4) {
  const votes = new Map();
  for (let y = 0; y < base.height; y += step) {
    for (let x = 0; x < base.width; x += step) {
      const from = base.rows[y][x];
      const to = target.rows[y][x];
      if (!votes.has(from)) votes.set(from, new Map());
      const bucket = votes.get(from);
      bucket.set(to, (bucket.get(to) ?? 0) + 1);
    }
  }
  const resolved = new Map();
  for (const [from, bucket] of votes) {
    let best = null;
    for (const [to, count] of bucket) if (!best || count > best[1]) best = [to, count];
    resolved.set(from, best[0]);
  }
  return resolved;
}

// Re-hue a donor colour to the target paint, keeping the donor's own
// saturation/value ratios so the highlight/shadow relationships survive.
function reHue(color, donorBody, paint) {
  const [hue, saturation, value] = toHsv(color);
  const [, bodySaturation, bodyValue] = toHsv(donorBody);
  const [paintHue, paintSaturation, paintValue] = toHsv(paint);
  const nextSaturation = Math.max(0, Math.min(1, paintSaturation * (bodySaturation ? saturation / bodySaturation : saturation)));
  const nextValue = Math.max(0, Math.min(1, paintValue * (bodyValue ? value / bodyValue : value)));
  return fromHsv(paintHue, nextSaturation, nextValue);
}

function main() {
  const blue = decodeIndexed(MASK_ATLAS);
  const family = bodyFamily(blue);
  const donors = new Map();
  for (const [id, name] of SOURCE_COLORS) {
    donors.set(id, decodeIndexed(path.join(PNG_ROOT, `color_${id}_${name}.png`)));
  }

  mkdirSync(WEBP_ROOT, { recursive: true });
  const report = [];
  for (const variant of VARIANTS) {
    const sourceFile = path.join(SOURCE_ROOT, `${variant.source}.png`);
    if (!existsSync(sourceFile)) throw new Error(`Missing supplied source: ${sourceFile}`);
    const source = decodeRgb(sourceFile);
    if (source.width !== blue.width || source.height !== blue.height) {
      throw new Error(`${variant.name}: source is ${source.width}x${source.height}, expected ${blue.width}x${blue.height}.`);
    }

    // A body that is already painted (only `black`) is the artist's own colour
    // and ships untouched; a white body is the material-tint placeholder that
    // the web runtime cannot honour, so it is painted here.
    const counts = new Map();
    let dominant = [0, 0, 0];
    let dominantCount = -1;
    for (let y = 0; y < blue.height; y += 1) {
      for (let x = 0; x < blue.width; x += 1) {
        if (!family.has(blue.rows[y][x])) continue;
        const to = (y * source.width + x) * 3;
        const key = (source.rgb[to] << 16) | (source.rgb[to + 1] << 8) | source.rgb[to + 2];
        const next = (counts.get(key) ?? 0) + 1;
        counts.set(key, next);
        if (next > dominantCount) {
          dominantCount = next;
          dominant = [source.rgb[to], source.rgb[to + 1], source.rgb[to + 2]];
        }
      }
    }
    const isPlaceholder = dominant[0] >= NEAR_WHITE && dominant[1] >= NEAR_WHITE && dominant[2] >= NEAR_WHITE;

    const pngFile = path.join(PNG_ROOT, `color_${variant.id}_${variant.name}.png`);
    const webpFile = path.join(WEBP_ROOT, `color_${variant.id}_${variant.name}_q85.webp`);
    let detail = `source=${variant.source} family=${family.size} dominant=${dominant.join(',')} placeholder=${isPlaceholder}`;

    if (isPlaceholder) {
      let donorId = null;
      let donorScore = Infinity;
      for (const [id] of SOURCE_COLORS) {
        const score = distance(donors.get(id).palette[bodyIndexOf(donors.get(id))], variant.paint);
        if (score < donorScore) { donorScore = score; donorId = id; }
      }
      const donor = donors.get(donorId);
      const donorBody = donor.palette[bodyIndexOf(donor)];
      const map = correspondence(blue, donor);
      const painted = new Map();
      for (const index of family) {
        const donorIndex = map.get(index);
        const donorColor = donorIndex == null ? donorBody : donor.palette[donorIndex] ?? donorBody;
        painted.set(index, reHue(donorColor, donorBody, variant.paint));
      }
      const rgb = Buffer.from(source.rgb);
      for (let y = 0; y < blue.height; y += 1) {
        for (let x = 0; x < blue.width; x += 1) {
          const color = painted.get(blue.rows[y][x]);
          if (!color) continue;
          const to = (y * source.width + x) * 3;
          rgb[to] = color[0]; rgb[to + 1] = color[1]; rgb[to + 2] = color[2];
        }
      }
      detail += ` donor=${donorId} painted=${family.size}`;
      if (CHECK_ONLY) {
        report.push(`${variant.id} ${variant.name}: ${detail} (check only)`);
        continue;
      }
      writeFileSync(pngFile, encodeRgbPng(source.width, source.height, rgb));
    } else {
      if (CHECK_ONLY) {
        report.push(`${variant.id} ${variant.name}: ${detail} (check only, supplied kept)`);
        continue;
      }
      writeFileSync(pngFile, encodeRgbPng(source.width, source.height, Buffer.from(source.rgb)));
    }
    execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', pngFile, '-c:v', 'libwebp', '-quality', '85', webpFile]);
    report.push(`${variant.id} ${variant.name}: ${detail} png=${readFileSync(pngFile).length}B`);
  }
  console.log(report.join('\n'));
}

main();
