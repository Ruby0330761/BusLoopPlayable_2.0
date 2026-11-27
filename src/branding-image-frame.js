import { clampCenteredRectX } from './scene-layout.js';

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const coordinate = (value, fallback) => Number.isFinite(value) ? value : fallback;

// Bottom obstruction in CSS pixels, in portrait and landscape respectively.
const bottomInsets = {
  applovin: [40, 54], unityads: [82, 60], moloco: [76, 58],
  mintegral: [86, 62], 'google-ads': [64, 54]
};

export function brandingBottomInset(platform, landscape) {
  return (bottomInsets[platform] ?? bottomInsets.applovin)[landscape ? 1 : 0];
}

export function safeBrandingCenterY(authoredY, frame, width, height, platform) {
  const shadow = frame.shadow ? Math.max(0, frame.shadow.y + frame.shadow.blur * 1.5) : 0;
  const bottom = height - brandingBottomInset(platform, width > height) - 4;
  return Math.min(authoredY, bottom - frame.height / 2 - shadow);
}

function rgba(color, opacity) {
  const rgb = Math.round(clamp(color, 0, 0xffffff));
  return `rgba(${rgb >> 16}, ${(rgb >> 8) & 255}, ${rgb & 255}, ${clamp(opacity, 0, 1)})`;
}

export function migrateBrandingIconRadius(icon) {
  if (!icon || !Object.hasOwn(icon, 'radius')) return false;
  const side = Math.min(icon.width ?? 180, icon.height ?? 123);
  icon.cornerRadius ??= side > 0 ? clamp(100 * icon.radius / side, 0, 50) : 0;
  delete icon.radius;
  return true;
}

export function resolveBrandingImageFrame(config, image, scale) {
  const boxWidth = Math.max(1, Number(config.width) || 180);
  const boxHeight = Math.max(1, Number(config.height) || boxWidth);
  const naturalWidth = image.naturalWidth || boxWidth;
  const naturalHeight = image.naturalHeight || boxHeight;
  const fit = Math.min(boxWidth / naturalWidth, boxHeight / naturalHeight) * scale;
  const width = naturalWidth * fit, height = naturalHeight * fit;
  const side = Math.min(width, height);
  const { stroke = {}, shadow = {} } = config;
  return {
    width, height, radius: side * clamp(config.cornerRadius ?? 0, 0, 50) / 100,
    strokeWidth: stroke.enabled ? Math.min(side / 2, clamp(stroke.width ?? 4, 0, 40) * scale) : 0,
    strokeColor: rgba(stroke.color ?? 0xffffff, stroke.opacity ?? 1),
    shadow: shadow.enabled ? {
      x: clamp(shadow.offsetX ?? 0, -100, 100) * scale, y: clamp(shadow.offsetY ?? 6, -100, 100) * scale,
      blur: clamp(shadow.blur ?? 12, 0, 100) * scale, color: rgba(shadow.color ?? 0, shadow.opacity ?? 0.35)
    } : null
  };
}

export function resolveCtaSize(cta) {
  const height = Math.max(1, Number(cta.height) || 68);
  return { height, width: Math.max(1, height * (Number(cta.stretchX) || 2.75)) };
}

export function brandingRowY(branding, cta) {
  return coordinate(branding?.logo?.y, cta?.y);
}

export function resolveBrandingRowLayout(branding, cta, images, metrics, platform, bounds) {
  const { designWidth, designHeight, stageWidth, stageHeight, positionScaleX, positionScaleY, uiScale } = metrics;
  const { icon = {}, logo = {}, text = {} } = branding ?? {};
  const { height: buttonHeight, width: buttonWidth } = resolveCtaSize(cta);
  const ctaX = coordinate(cta.x, designWidth / 2);
  const ctaY = coordinate(cta.y, designHeight - buttonHeight / 2);
  const logoY = coordinate(brandingRowY(branding, cta), ctaY) * positionScaleY;
  const buttonCenterX = clampCenteredRectX({
    centerX: ctaX * positionScaleX, width: buttonWidth * uiScale, left: 0, right: stageWidth
  });
  const imagePositions = {};
  let minY = (cta.enabled ?? 1) ? buttonHeight * uiScale / 2 : 0;
  let maxY = stageHeight - minY;
  for (const [key, config] of [['icon', icon], ['logo', logo]]) {
    const frame = resolveBrandingImageFrame(config, images[key] ?? {}, uiScale);
    const centerX = clampCenteredRectX({
      centerX: coordinate(config.x, designWidth / 2) * positionScaleX,
      width: Math.max(1, Number(config.width) || 180) * uiScale,
      left: bounds?.left, right: bounds?.right
    });
    imagePositions[key] = { centerX, frame };
    if (Boolean(config.enabled ?? 1)) {
      minY = Math.max(minY, frame.height / 2);
      maxY = safeBrandingCenterY(maxY, frame, stageWidth, stageHeight, platform);
    }
  }
  const rowY = minY <= maxY ? clamp(logoY, minY, maxY) : clamp(maxY, 0, stageHeight);
  return {
    ...imagePositions,
    rowY,
    buttonCenterX,
    textCenterX: buttonCenterX + (coordinate(text.x, ctaX) - ctaX) * positionScaleX,
    textCenterY: rowY + (coordinate(text.y, ctaY) - ctaY) * positionScaleY
  };
}

export function syncBrandingRowTuning(tuning, previousCta, path) {
  const { cta, branding, preview } = tuning;
  if (path === 'cta.x' && Number.isFinite(cta.x)) {
    const oldX = coordinate(previousCta.x, preview.width / 2);
    branding.text.x = coordinate(branding.text.x, oldX) + cta.x - oldX;
    return;
  }
  const source = {
    'cta.y': cta, 'branding.logo.y': branding.logo, 'branding.logo.position': branding.logo,
    'branding.icon.y': branding.icon, 'branding.icon.position': branding.icon
  }[path];
  if (!Number.isFinite(source?.y)) return;
  const newY = source.y;
  const oldY = coordinate(previousCta.y, newY);
  branding.text.y = coordinate(branding.text.y, oldY) + newY - oldY;
  cta.y = newY;
  branding.logo.y = newY;
  branding.icon.y = newY;
}

export function drawFramedBrandingImage(ctx, image, centerX, centerY, frame) {
  const { width, height, radius, strokeWidth, strokeColor, shadow } = frame;
  const left = centerX - width / 2, top = centerY - height / 2;
  const shape = new Path2D();
  if (radius && shape.roundRect) shape.roundRect(left, top, width, height, radius);
  else shape.rect(left, top, width, height);
  if (shadow) {
    // A CSS outer shadow leaves transparent pixels inside the logo untouched.
    const outside = new Path2D(shape);
    outside.rect(0, 0, ctx.canvas.width, ctx.canvas.height);
    ctx.save();
    ctx.clip(outside, 'evenodd');
    ctx.shadowColor = shadow.color;
    ctx.shadowBlur = shadow.blur;
    ctx.shadowOffsetX = shadow.x;
    ctx.shadowOffsetY = shadow.y;
    ctx.fillStyle = '#000';
    ctx.fill(shape);
    ctx.restore();
  }
  ctx.save();
  ctx.clip(shape);
  ctx.drawImage(image, left, top, width, height);
  if (strokeWidth > 0) {
    ctx.lineWidth = 2 * strokeWidth;
    ctx.strokeStyle = strokeColor;
    ctx.stroke(shape);
  }
  ctx.restore();
}
