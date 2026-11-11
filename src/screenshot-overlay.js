// DOM overlays that live above the WebGL canvas.
//
// The editor screenshot is a Canvas re-draw, not a DOM capture: `captureFrame`
// reads the WebGL render target, so everything the runtime paints as DOM -- the
// stamina capsule, the countdown clock, the speed switch, free-placed artwork
// and the weather field -- never reached the PNG. It used to draw only branding
// and the CTA, which is why a build with stamina enabled produced screenshots
// with no hearts at all.
//
// Rebuilding those HUDs from tuning constants would drift from the live layout,
// so this module reads the *rendered* DOM instead: every visible overlay image
// is drawn at its own bounding rect, the stamina capsule is reproduced with the
// same nine-slice geometry its CSS border-image uses, and the HUD text nodes
// are re-set with their computed font.

import { STAMINA_ASSETS } from './stamina.js';

// Roots painted above the canvas. Transient screens (stamina intro, pre-roll,
// stage picker, game over, end panel) are deliberately absent: a promo shot of
// a dim opening card is not the gameplay frame the operator asked for.
export const OVERLAY_ROOT_SELECTORS = Object.freeze([
  '#stamina',
  '#countdown',
  '#progress-hud',
  '#speed-toggle',
  '.free-asset-overlay',
  '.weather-effect-canvas'
]);

// Roots built from many CSS boxes instead of a single image. They are replayed
// by the generic style painter below, which is what keeps the progress bar's
// gradient band, white rim SVG and stacked pills in the screenshot.
export const PAINTED_ROOT_SELECTORS = Object.freeze(['#progress-hud']);

// Overlay nodes whose text is part of the HUD. They are drawn with their
// computed font/colour/stroke instead of being skipped as empty boxes.
export const OVERLAY_TEXT_SELECTORS = Object.freeze([
  '#countdown-value',
  '#speed-toggle-label'
]);

// The stamina capsule's blue frame is a `::before` border-image, so no <img> in
// the DOM carries it. These source slices mirror `.stamina::before` in
// styles.css; `borderTopPercent` is the `border-image-width` vertical value.
export const STAMINA_FRAME_SLICE = Object.freeze({
  top: 90,
  right: 140,
  bottom: 90,
  left: 140,
  borderTopPercent: 32.1429
});

function styleOf(element, view) {
  return view?.getComputedStyle?.(element) ?? null;
}

// Style-level visibility only: no size test. Positioned wrappers such as
// `.phud__tick` are 0x0 and paint entirely through absolutely-positioned
// children, so a size check here would prune a whole row of pills.
export function isElementShown(element, view) {
  if (!element?.getBoundingClientRect) return false;
  const style = styleOf(element, view);
  if (!style) return false;
  if (style.display === 'none' || style.visibility === 'hidden') return false;
  return Number(style.opacity) > 0.01;
}

export function isOverlayVisible(element, view) {
  if (!isElementShown(element, view)) return false;
  const rect = element.getBoundingClientRect();
  return rect.width > 0.5 && rect.height > 0.5;
}

// `object-fit: contain` leaves letterboxing inside the element box; the
// screenshot has to paint the same box or hearts and icons change shape.
export function containRect(rect, naturalWidth, naturalHeight) {
  if (!naturalWidth || !naturalHeight) return null;
  const scale = Math.min(rect.width / naturalWidth, rect.height / naturalHeight);
  const width = naturalWidth * scale;
  const height = naturalHeight * scale;
  return {
    x: rect.x + (rect.width - width) / 2,
    y: rect.y + (rect.height - height) / 2,
    width,
    height
  };
}

// Splits an image into the nine border-image regions. `border-image-repeat:
// stretch` draws every region as a plain stretched rect, which is what this
// returns. CSS also shrinks overlapping borders proportionally, so the same
// clamp is applied here.
export function nineSliceRects({ imageWidth, imageHeight, slice, box, border }) {
  let top = Math.max(0, border.top);
  let right = Math.max(0, border.right);
  let bottom = Math.max(0, border.bottom);
  let left = Math.max(0, border.left);
  if (left + right > box.width && left + right > 0) {
    const scale = box.width / (left + right);
    left *= scale;
    right *= scale;
  }
  if (top + bottom > box.height && top + bottom > 0) {
    const scale = box.height / (top + bottom);
    top *= scale;
    bottom *= scale;
  }
  const columns = [0, slice.left, Math.max(slice.left, imageWidth - slice.right), imageWidth];
  const rows = [0, slice.top, Math.max(slice.top, imageHeight - slice.bottom), imageHeight];
  const xs = [box.x, box.x + left, box.x + box.width - right, box.x + box.width];
  const ys = [box.y, box.y + top, box.y + box.height - bottom, box.y + box.height];
  const rects = [];
  for (let row = 0; row < 3; row += 1) {
    for (let column = 0; column < 3; column += 1) {
      const sx = columns[column];
      const sy = rows[row];
      const sw = columns[column + 1] - sx;
      const sh = rows[row + 1] - sy;
      const dw = xs[column + 1] - xs[column];
      const dh = ys[row + 1] - ys[row];
      if (sw > 0 && sh > 0 && dw > 0 && dh > 0) {
        rects.push({ sx, sy, sw, sh, dx: xs[column], dy: ys[row], dw, dh });
      }
    }
  }
  return rects;
}

function rotationOf(transform) {
  if (!transform || transform === 'none') return 0;
  const match = /^matrix\(([^)]+)\)$/u.exec(transform);
  if (!match) return 0;
  const [a, b] = match[1].split(',').map(Number);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 0;
  if (Math.abs(a - 1) < 1e-6 && Math.abs(b) < 1e-6) return 0;
  return Math.atan2(b, a);
}

// An <img> that failed to decode — or has not finished loading — has no usable
// pixels, and `drawImage` throws `InvalidStateError` on it. One such image (a
// deleted upload, a stale layer reference) used to abort the whole overlay pass
// and silently drop every HUD painted after it, which is how a broken free-asset
// layer made the progress bar disappear from screenshots.
export function isDrawableImage(element) {
  if (!element) return false;
  if (element.complete === false) return false;
  return (element.naturalWidth || 0) > 0 && (element.naturalHeight || 0) > 0;
}

// Paints one overlay image where it renders. The bounding rect is already
// transformed, so a rotated layer is rebuilt from its untransformed layout size
// plus the rotation angle; otherwise the AABB would squash the artwork.
function drawOverlayImage(context, element, { view, origin, scale }) {
  if (!isDrawableImage(element)) return;
  const rect = element.getBoundingClientRect();
  const style = styleOf(element, view);
  const width = (element.offsetWidth || rect.width) * scale.x;
  const height = (element.offsetHeight || rect.height) * scale.y;
  if (!(width > 0) || !(height > 0)) return;
  const centerX = (rect.left - origin.left + rect.width / 2) * scale.x;
  const centerY = (rect.top - origin.top + rect.height / 2) * scale.y;
  const naturalWidth = element.naturalWidth || element.width || width;
  const naturalHeight = element.naturalHeight || element.height || height;
  // `contain` letterboxes inside the box; the default `fill` stretches to it.
  let drawWidth = width;
  let drawHeight = height;
  if (style?.objectFit === 'contain') {
    const fitted = containRect({ x: 0, y: 0, width, height }, naturalWidth, naturalHeight);
    if (!fitted) return;
    drawWidth = fitted.width;
    drawHeight = fitted.height;
  }
  const angle = rotationOf(style?.transform);
  context.save();
  context.globalAlpha = Math.max(0, Math.min(1, Number(style?.opacity ?? 1) || 1));
  if (angle) {
    context.translate(centerX, centerY);
    context.rotate(angle);
    context.drawImage(element, -drawWidth / 2, -drawHeight / 2, drawWidth, drawHeight);
  } else {
    context.drawImage(element, centerX - drawWidth / 2, centerY - drawHeight / 2, drawWidth, drawHeight);
  }
  context.restore();
}

function parseTextShadow(value) {
  if (!value || value === 'none') return null;
  const lengths = [...value.matchAll(/(-?[\d.]+)px/gu)].map((match) => Number(match[1]));
  if (lengths.length < 2) return null;
  const color = /(rgba?\([^)]*\))/u.exec(value)?.[1] ?? null;
  return { offsetX: lengths[0], offsetY: lengths[1], blur: lengths[2] ?? 0, color };
}

function drawOverlayText(context, element, box, view) {
  const style = styleOf(element, view);
  const text = String(element.textContent ?? '').trim();
  if (!style || !text) return;
  const fontSize = Number.parseFloat(style.fontSize) || 0;
  if (fontSize <= 0) return;
  const shadow = parseTextShadow(style.textShadow);
  const strokeWidth = Number.parseFloat(style.webkitTextStrokeWidth) || 0;
  const strokeColor = style.webkitTextStrokeColor;
  context.save();
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.font = `${style.fontStyle} ${style.fontWeight} ${fontSize}px ${style.fontFamily}`.trim();
  context.fillStyle = style.color;
  if (shadow?.color) {
    context.shadowColor = shadow.color;
    context.shadowOffsetX = shadow.offsetX;
    context.shadowOffsetY = shadow.offsetY;
    context.shadowBlur = shadow.blur;
  }
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  if (strokeWidth > 0 && strokeColor) {
    context.lineJoin = 'round';
    context.lineWidth = strokeWidth * 2;
    context.strokeStyle = strokeColor;
    context.strokeText(text, x, y);
  }
  context.fillText(text, x, y);
  context.restore();
}

function toLocalRect(rect, origin, scale) {
  return {
    x: (rect.left - origin.left) * scale.x,
    y: (rect.top - origin.top) * scale.y,
    width: rect.width * scale.x,
    height: rect.height * scale.y
  };
}

/* --- generic style painter ------------------------------------------------- */

// `getComputedStyle().backgroundImage` is the resolved gradient source. Anything
// other than a simple linear-gradient (radial, url) is reported as unsupported
// so the caller can fall back to the flat background colour instead of painting
// the wrong thing.
export function parseLinearGradient(value) {
  const text = String(value ?? '').trim();
  const start = text.indexOf('linear-gradient(');
  if (start < 0) return null;
  const body = text.slice(start + 'linear-gradient('.length, text.lastIndexOf(')'));
  // Split on top-level commas only: colours are rgb()/rgba() and contain none.
  const parts = [];
  let depth = 0;
  let current = '';
  for (const character of body) {
    if (character === '(') depth += 1;
    if (character === ')') depth -= 1;
    if (character === ',' && depth === 0) {
      parts.push(current.trim());
      current = '';
      continue;
    }
    current += character;
  }
  if (current.trim()) parts.push(current.trim());
  if (parts.length < 2) return null;
  // A leading angle/direction is not a colour stop.
  let angle = 180;
  if (!/(?:rgb|#|hsl)/iu.test(parts[0])) {
    const angleMatch = /^(-?[\d.]+)deg$/u.exec(parts[0]);
    if (angleMatch) angle = Number(angleMatch[1]);
    else if (/^to\s+bottom$/u.test(parts[0])) angle = 180;
    else if (/^to\s+top$/u.test(parts[0])) angle = 0;
    else return null;
    parts.shift();
  }
  const stops = [];
  for (const part of parts) {
    // `rgb(1, 2, 3) 40%` — the colour may itself contain spaces.
    const match = /^(.*?)(?:\s+(-?[\d.]+)%)?$/u.exec(part);
    if (!match) return null;
    stops.push({ color: match[1].trim(), offset: match[2] === undefined ? null : Number(match[2]) / 100 });
  }
  // Missing offsets interpolate evenly between the explicit ones.
  stops[0].offset ??= 0;
  stops.at(-1).offset ??= 1;
  for (let index = 1; index < stops.length - 1; index += 1) {
    if (stops[index].offset !== null) continue;
    const before = stops.slice(0, index).reverse().find((stop) => stop.offset !== null);
    const afterIndex = stops.findIndex((stop, position) => position > index && stop.offset !== null);
    const after = stops[afterIndex];
    stops[index].offset = before.offset + (after.offset - before.offset) * (index - stops.indexOf(before)) /
      (afterIndex - stops.indexOf(before));
  }
  return { angle, stops };
}

function gradientPaint(context, box, gradient) {
  // Only vertical and horizontal ramps are authored in this project; anything
  // diagonal would need a rotated canvas, which the HUD never uses.
  const vertical = Math.abs(Math.abs(gradient.angle) - 180) < 1 || gradient.angle === 0
    || Math.abs(gradient.angle) === 180;
  const x0 = box.x;
  const y0 = box.y;
  const x1 = vertical ? box.x : box.x + box.width;
  const y1 = vertical ? box.y + box.height : box.y;
  const paint = context.createLinearGradient?.(x0, y0, x1, y1);
  if (!paint) return null;
  for (const stop of gradient.stops) {
    paint.addColorStop(Math.max(0, Math.min(1, stop.offset ?? 0)), stop.color);
  }
  return paint;
}

// `border-radius` may be a single radius or a slash-separated ellipse. The HUD
// only uses uniform corners, so the first value is enough.
export function parseRadius(value) {
  const first = String(value ?? '0px').split('/')[0].trim().split(/\s+/u)[0];
  const radius = Number.parseFloat(first);
  return Number.isFinite(radius) ? Math.max(0, radius) : 0;
}

// Reads an inset ring off a pseudo-element's box-shadow, e.g.
// `inset 0 0 0 3px #dcf800` (the live pill's rim). Returns the spread and colour
// so the screenshot keeps the ring instead of painting a flat pill.
export function parseInsetRing(style) {
  const shadow = String(style?.boxShadow ?? '');
  if (!shadow || shadow === 'none') return null;
  for (const layer of shadow.split(/,(?![^(]*\))/u)) {
    const text = layer.trim();
    if (!/\binset\b/iu.test(text)) continue;
    // Chrome reports computed lengths as `0px`, but authored CSS uses bare `0`;
    // accept both so the same parser works on live styles and test fixtures.
    const lengths = [...text.replace(/\binset\b/iu, '').matchAll(/(-?[\d.]+)(?:px)?(?![\w.])/gu)]
      .map((match) => Number(match[1]));
    if (lengths.length < 4) continue;
    // inset X Y blur spread — a ring has zero offset and zero blur.
    const [, , blur, spread] = lengths;
    if (spread <= 0 || blur > 0) continue;
    const color = /(rgba?\([^)]*\)|#[0-9a-f]{3,8})/iu.exec(text)?.[1];
    if (!color) continue;
    return { width: spread, color };
  }
  return null;
}

export function parsePolygonClip(value) {
  const text = String(value ?? '');
  const match = /polygon\(([^)]*)\)/u.exec(text);
  if (!match) return null;
  const points = match[1].split(',').map((pair) => {
    const [x, y] = pair.trim().split(/\s+/u);
    const toFraction = (token) => {
      const number = Number.parseFloat(token);
      if (!Number.isFinite(number)) return null;
      return token.includes('%') ? number / 100 : number;
    };
    const fx = toFraction(x);
    const fy = toFraction(y);
    return fx === null || fy === null ? null : { x: fx, y: fy };
  });
  return points.every(Boolean) && points.length >= 3 ? points : null;
}

function drawRoundedBox(context, box, style) {
  const radius = Math.min(parseRadius(style?.borderRadius), Math.min(box.width, box.height) / 2);
  const gradient = parseLinearGradient(style?.backgroundImage);
  const flat = style?.backgroundColor;
  const hasFlat = flat && flat !== 'rgba(0, 0, 0, 0)' && flat !== 'transparent';
  if (!gradient && !hasFlat) return false;
  context.save();
  context.beginPath();
  if (radius > 0 && typeof context.roundRect === 'function') {
    context.roundRect(box.x, box.y, box.width, box.height, radius);
  } else {
    context.rect(box.x, box.y, box.width, box.height);
  }
  const paint = gradient ? gradientPaint(context, box, gradient) : null;
  if (paint) {
    context.fillStyle = paint;
  } else if (hasFlat) {
    context.fillStyle = flat;
  } else {
    context.restore();
    return false;
  }
  context.fill();
  context.restore();
  return true;
}

function drawBorder(context, box, style) {
  const width = Number.parseFloat(style?.borderTopWidth) || 0;
  const color = style?.borderTopColor;
  if (width <= 0 || !color || color === 'rgba(0, 0, 0, 0)') return;
  const radius = Math.min(parseRadius(style?.borderRadius), Math.min(box.width, box.height) / 2);
  context.save();
  context.beginPath();
  if (radius > 0 && typeof context.roundRect === 'function') {
    context.roundRect(box.x + width / 2, box.y + width / 2,
      Math.max(0, box.width - width), Math.max(0, box.height - width), Math.max(0, radius - width / 2));
  } else {
    context.rect(box.x + width / 2, box.y + width / 2,
      Math.max(0, box.width - width), Math.max(0, box.height - width));
  }
  context.lineWidth = width;
  context.strokeStyle = color;
  context.stroke();
  context.restore();
}

function drawPseudoRing(context, element, box, view) {
  const style = view?.getComputedStyle?.(element, '::before');
  const ring = parseInsetRing(style);
  if (!ring) return;
  const radius = Math.min(parseRadius(style.borderRadius), Math.min(box.width, box.height) / 2);
  context.save();
  context.beginPath();
  if (radius > 0 && typeof context.roundRect === 'function') {
    context.roundRect(box.x + ring.width / 2, box.y + ring.width / 2,
      Math.max(0, box.width - ring.width), Math.max(0, box.height - ring.width),
      Math.max(0, radius - ring.width / 2));
  } else {
    context.rect(box.x + ring.width / 2, box.y + ring.width / 2,
      Math.max(0, box.width - ring.width), Math.max(0, box.height - ring.width));
  }
  context.lineWidth = ring.width;
  context.strokeStyle = ring.color;
  context.stroke();
  context.restore();
}

function drawPseudoTail(context, element, box, view) {
  const style = view?.getComputedStyle?.(element, '::after');
  const points = parsePolygonClip(style?.clipPath);
  if (!points) return;
  const gradient = parseLinearGradient(style.backgroundImage);
  const flat = style.backgroundColor;
  context.save();
  context.beginPath();
  points.forEach((point, index) => {
    const x = box.x + point.x * box.width;
    const y = box.y + point.y * box.height;
    if (index === 0) context.moveTo(x, y);
    else context.lineTo(x, y);
  });
  context.closePath();
  const paint = gradient ? gradientPaint(context, box, gradient) : null;
  if (paint) {
    context.fillStyle = paint;
  } else if (flat && flat !== 'rgba(0, 0, 0, 0)') {
    context.fillStyle = flat;
  } else {
    context.restore();
    return;
  }
  context.fill();
  context.restore();
}

// Sibling paint order for positioned boxes. The progress HUD relies on it:
// the track (4) sits under the shell (5), the pills (2) under the node (8) and
// the bus (10) on top — an all-DOM-order walk would paint the pill ring over
// the bus.
function paintOrderedChildren(element) {
  const children = [...(element.children ?? [])];
  if (children.length < 2) return children;
  const order = new Map(children.map((child, index) => [child, index]));
  return children.sort((first, second) => {
    const firstZ = Number.parseInt(first.style?.zIndex ?? '', 10);
    const secondZ = Number.parseInt(second.style?.zIndex ?? '', 10);
    const firstOrder = Number.isFinite(firstZ) ? firstZ : 0;
    const secondOrder = Number.isFinite(secondZ) ? secondZ : 0;
    if (firstOrder !== secondOrder) return firstOrder - secondOrder;
    return order.get(first) - order.get(second);
  });
}

// The progress HUD is a fixed, known structure (track / shell / ticks / node /
// bubble / bus). Walking it generically with per-element computed styles and
// pseudo-element queries was both slow enough to trip the timeout guard and
// blind to zero-size wrappers. Painting the known pieces directly keeps the
// screenshot fast and predictable, and every value still comes from the live DOM
// so tuning changes apply without touching this file.
const HUD_PAINT_ORDER = Object.freeze([
  '.phud__track',
  '.phud__shell',
  '.phud__tick',
  '.phud__node',
  '.phud__bubble',
  '.phud__bus'
]);

function hudBox(element, origin, scale) {
  return toLocalRect(element.getBoundingClientRect(), origin, scale);
}

async function drawProgressHud(context, root, { view, origin, scale }) {
  const style = styleOf(root, view);
  if (style?.visibility === 'hidden') return;

  for (const selector of HUD_PAINT_ORDER) {
    for (const element of root.querySelectorAll?.(selector) ?? []) {
      // `.phud__tick` is a zero-size anchor; its peg and pill paint the row.
      if (selector === '.phud__tick') {
        if (!isElementShown(element, view)) continue;
        for (const part of paintOrderedChildren(element)) {
          if (!isElementShown(part, view)) continue;
          const box = hudBox(part, origin, scale);
          const partStyle = styleOf(part, view);
          drawRoundedBox(context, box, partStyle);
          drawBorder(context, box, partStyle);
          drawPseudoRing(context, part, box, view);
          drawOverlayText(context, part, box, view);
        }
        continue;
      }
      if (selector === '.phud__track') {
        // The coloured band: a rounded rect filled with the authored spectrum
        // gradient. It carries no <img> and no border, so without this branch
        // the screenshot showed the bar's white rim with the game scene showing
        // through the bar itself.
        if (!isElementShown(element, view)) continue;
        drawRoundedBox(context, hudBox(element, origin, scale), styleOf(element, view));
        continue;
      }
      if (selector === '.phud__shell') {
        // The delivered rim is an inline SVG stadium. Rasterising its markup
        // needs an async image decode, which stalled the whole overlay pass;
        // a stroked stadium at the same box is indistinguishable at screenshot
        // scale and keeps this painter synchronous.
        if (!isElementShown(element, view)) continue;
        const box = hudBox(element, origin, scale);
        const rim = Math.max(1, box.height * 0.06);
        context.save();
        context.beginPath();
        if (typeof context.roundRect === 'function') {
          context.roundRect(box.x + rim / 2, box.y + rim / 2,
            Math.max(0, box.width - rim), Math.max(0, box.height - rim), Math.max(0, box.height / 2 - rim / 2));
        } else {
          context.rect(box.x, box.y, box.width, box.height);
        }
        context.lineWidth = rim;
        context.strokeStyle = '#ffffff';
        context.stroke();
        context.restore();
        continue;
      }
      if (selector === '.phud__bubble') {
        if (!isElementShown(element, view)) continue;
        const box = hudBox(element, origin, scale);
        drawRoundedBox(context, box, styleOf(element, view));
        drawPseudoTail(context, element, box, view);
        // The percent is a child span with its own colour, so paint each text
        // node separately rather than flattening the bubble to one string.
        for (const span of element.children ?? []) {
          if (!isElementShown(span, view)) continue;
          drawOverlayText(context, span, hudBox(span, origin, scale), view);
        }
        continue;
      }
      // `.phud__node` and `.phud__bus` are wrappers around a single <img>; the
      // artwork lives on the child, not on the positioned box itself.
      if (!isElementShown(element, view)) continue;
      for (const image of element.querySelectorAll?.('img') ?? []) {
        if (!isDrawableImage(image)) continue;
        const box = hudBox(image, origin, scale);
        const imageStyle = styleOf(image, view);
        const fit = containRect(box, image.naturalWidth, image.naturalHeight) ?? box;
        context.save();
        context.globalAlpha = Math.max(0, Math.min(1, Number(imageStyle?.opacity ?? 1) || 1));
        context.drawImage(image, fit.x, fit.y, fit.width, fit.height);
        context.restore();
      }
    }
  }
}

function drawElementImages(context, root, { view, origin, scale }) {
  for (const image of root.querySelectorAll?.('img') ?? []) {
    if (!isOverlayVisible(image, view)) continue;
    drawOverlayImage(context, image, { view, origin, scale });
  }
}

// Reads the capsule artwork from the same custom property the CSS uses. In the
// editor that is a project URL; in a packaged ad it is already a data URI, and
// re-reading it here keeps the screenshot working in both without hard-coding
// which environment is running.
function staminaFrameSource(root) {
  const value = root.style?.getPropertyValue?.('--stamina-frame') ?? '';
  const match = /url\((?:"|')?([^"')]+)(?:"|')?\)/u.exec(value);
  if (match?.[1]) return match[1];
  return STAMINA_ASSETS.frame;
}

async function drawStaminaRoot(context, root, { view, origin, scale, loadImage }) {
  const box = toLocalRect(root.getBoundingClientRect(), origin, scale);
  // The live view writes the horizontal border width as a percentage; reading
  // it back keeps the screenshot aligned with whatever heart count is painted
  // without re-deriving the layout here.
  const sidePercent = Number.parseFloat(
    root.style?.getPropertyValue?.('--stamina-frame-side') ?? ''
  ) || 0;
  const frame = sidePercent > 0 ? await loadImage(staminaFrameSource(root)) : null;
  if (frame) {
    const imageWidth = frame.naturalWidth || frame.width;
    const imageHeight = frame.naturalHeight || frame.height;
    const borderTop = box.height * STAMINA_FRAME_SLICE.borderTopPercent / 100;
    const borderSide = box.width * sidePercent / 100;
    for (const region of nineSliceRects({
      imageWidth,
      imageHeight,
      slice: STAMINA_FRAME_SLICE,
      box,
      border: { top: borderTop, right: borderSide, bottom: borderTop, left: borderSide }
    })) {
      context.drawImage(
        frame,
        region.sx, region.sy, region.sw, region.sh,
        region.dx, region.dy, region.dw, region.dh
      );
    }
  }
  drawElementImages(context, root, { view, origin, scale });
}

// Roots are painted in *document* order. `#stamina` and `#countdown` share
// z-index 6 and stamina comes later in the markup, so a selector-ordered loop
// painted the clock over the capsule — the opposite of what the stage shows.
function paintOrder(roots) {
  const list = [...roots];
  if (typeof list[0]?.compareDocumentPosition !== 'function') return list;
  return list.sort((first, second) => {
    // Node.compareDocumentPosition: 4 = `second` follows `first`.
    if (first === second) return 0;
    return first.compareDocumentPosition(second) & 4 ? -1 : 1;
  });
}

/**
 * Paints every DOM overlay above the canvas at the same place it renders on
 * stage. Coordinates come from the live DOM, so HUD layout never has to be
 * duplicated here.
 */
export async function drawStageOverlays(context, {
  stage,
  width,
  height,
  loadImage = async () => null,
  view = stage?.ownerDocument?.defaultView ?? globalThis
} = {}) {
  if (!stage || !context) return;
  const rect = stage.getBoundingClientRect();
  // Overlay children are positioned inside the stage border, so the origin has
  // to skip it or a phone-framed preview shifts every HUD by the border width.
  const contentWidth = stage.clientWidth || rect.width;
  const contentHeight = stage.clientHeight || rect.height;
  if (!(contentWidth > 0) || !(contentHeight > 0)) return;
  const origin = {
    left: rect.left + (stage.clientLeft || 0),
    top: rect.top + (stage.clientTop || 0)
  };
  const scale = { x: width / contentWidth, y: height / contentHeight };

  const roots = paintOrder(stage.querySelectorAll?.(OVERLAY_ROOT_SELECTORS.join(',')) ?? []);
  for (const root of roots) {
    const painted = PAINTED_ROOT_SELECTORS.some((selector) => root.matches?.(selector));
    // Painted roots own their own visibility rules (their children overflow a
    // zero-size wrapper), so only the style check applies to them.
    if (!(painted ? isElementShown(root, view) : isOverlayVisible(root, view))) continue;
    // One overlay failing must not cost the others: each root is painted behind
    // its own guard, so a stale asset only drops its own layer.
    try {
      if (root.tagName === 'CANVAS') {
        const box = toLocalRect(root.getBoundingClientRect(), origin, scale);
        context.drawImage(root, box.x, box.y, box.width, box.height);
        continue;
      }
      if (root.id === 'stamina') {
        await drawStaminaRoot(context, root, { view, origin, scale, loadImage });
        continue;
      }
      if (painted) {
        await drawProgressHud(context, root, { view, origin, scale });
        continue;
      }
      drawElementImages(context, root, { view, origin, scale });
      for (const textSelector of OVERLAY_TEXT_SELECTORS) {
        for (const node of root.querySelectorAll?.(textSelector) ?? []) {
          if (!isOverlayVisible(node, view)) continue;
          drawOverlayText(context, node, toLocalRect(node.getBoundingClientRect(), origin, scale), view);
        }
      }
    } catch (error) {
      // Name the layer that failed so the next report points at a real element.
      console.warn(`Screenshot overlay ${root.id || root.className || root.tagName} could not be composed.`, error);
    }
  }
}
