import { COUNTDOWN_TIMER_ASSET, formatCountdownTime, normalizeCountdownConfig } from './countdown.js';

// Visible blue-frame bounds in the supplied artwork (bottom is exclusive).
// The clock extends beyond its panel; the speed art has transparent margins.
const TIMER_ART = { width: 1001, height: 392, frameTop: 47, frameBottom: 354 };
const SPEED_ART = { height: 340, frameTop: 17, frameBottom: 329 };
// The transparent 1x1 GIF `index.html` uses as a pre-load placeholder.
const TRANSPARENT_PIXEL_SRC = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';

export function createCountdownView({ root, image, value, warning, stage, speedButton }) {
  function render(state, { visible = true } = {}) {
    if (!root) return;
    root.hidden = !state.enabled || !visible;
    if (image) {
      // `index.html` ships a 1x1 transparent GIF as the placeholder src so the
      // element is never "broken" before the countdown starts. Testing for a
      // *missing* src therefore never fired, and the real timer artwork was
      // never loaded — the HUD rendered the digits with no clock around them.
      // Match on the placeholder (or an empty src) instead.
      const currentSrc = image.getAttribute('src') ?? '';
      const needsArtwork = !currentSrc || currentSrc === TRANSPARENT_PIXEL_SRC;
      if (state.enabled && needsArtwork) image.src = COUNTDOWN_TIMER_ASSET;
      // Removing src makes the element report naturalWidth 0, which every
      // runtime gate reads as "broken image". The host is hidden when the
      // countdown is off, so the last loaded frame is harmless.
    }
    const text = formatCountdownTime(state.remaining);
    if (value && value.textContent !== text) value.textContent = text;
    root.dataset.state = state.state;
    root.dataset.remaining = String(Math.ceil(state.remaining));
    root.setAttribute('aria-label', `Time remaining ${text}`);
    if (warning) {
      warning.hidden = !visible || !state.urgent;
      // The vignette pulses on a pseudo-element so its fade-in can run on the
      // host at the same time; an inline animationPlayState would only reach
      // the host animation.
      warning.style.setProperty?.('--countdown-warning-play', state.paused ? 'paused' : 'running');
    }
  }

  function resize(bounds = null, config = {}, uiScale = null) {
    if (!root || !stage) return;
    const rect = stage.getBoundingClientRect();
    // Absolute children and the renderer use the inside of the phone frame;
    // DOM button bounds include its border in their viewport coordinates.
    const originLeft = rect.left + (stage.clientLeft || 0);
    const originTop = rect.top + (stage.clientTop || 0);
    const stageWidth = stage.clientWidth || rect.width;
    const stageHeight = stage.clientHeight || rect.height;
    const left = Math.max(0, Number(bounds?.left) || 0);
    const top = Math.max(0, Number(bounds?.top) || 0);
    const right = Math.min(stageWidth, Number(bounds?.right) || left + (Number(bounds?.width) || stageWidth));
    const bottom = Math.min(stageHeight, Number(bounds?.bottom) || top + (Number(bounds?.height) || stageHeight));
    const contentWidth = Math.max(1, right - left);
    const contentHeight = Math.max(1, bottom - top);
    const inset = Math.min(8, contentWidth * 0.02, contentHeight * 0.02);
    let availableLeft = left + inset;
    let availableRight = right - inset;
    const button = speedButton && !speedButton.hidden ? speedButton.getBoundingClientRect() : null;
    const headerButton = button && button.top - originTop < top + Math.max(80, contentHeight * 0.2);
    if (headerButton) {
      if (button.left + button.width / 2 - originLeft >= (left + right) / 2) {
        availableRight = Math.min(availableRight, button.left - originLeft - inset);
      } else {
        availableLeft = Math.max(availableLeft, button.right - originLeft + inset);
      }
    }
    const speedFrameTop = headerButton
      ? button.top - originTop + button.height * SPEED_ART.frameTop / SPEED_ART.height
      : 0;
    const speedFrameHeight = headerButton
      ? button.height * (SPEED_ART.frameBottom - SPEED_ART.frameTop) / SPEED_ART.height
      : 0;
    const timerFrameHeight = TIMER_ART.frameBottom - TIMER_ART.frameTop;
    const desiredWidth = headerButton
      ? speedFrameHeight * TIMER_ART.width / timerFrameHeight
      : Math.min(310, contentWidth * 0.55);
    const baseWidth = Math.max(1, Math.min(desiredWidth, availableRight - availableLeft));
    const baseScale = baseWidth / TIMER_ART.width;
    const baseHeight = baseScale * TIMER_ART.height;
    const baseCenter = Math.max(availableLeft + baseWidth / 2,
      Math.min((left + right) / 2, availableRight - baseWidth / 2));
    const alignedTop = headerButton
      ? speedFrameTop + (speedFrameHeight - baseScale * timerFrameHeight) / 2 - baseScale * TIMER_ART.frameTop
      : top + inset;
    const baseTop = Math.max(top + inset, Math.min(alignedTop, bottom - baseHeight - inset));
    const settings = normalizeCountdownConfig(config);
    const offsetScale = uiScale ?? Math.min(1, stageWidth / 1080, stageHeight / 2160);
    const width = Math.max(1, Math.min(baseWidth * settings.scale,
      contentWidth - inset * 2, (contentHeight - inset * 2) * TIMER_ART.width / TIMER_ART.height));
    const height = width * TIMER_ART.height / TIMER_ART.width;
    const center = Math.max(left + inset + width / 2,
      Math.min(baseCenter + settings.offsetX * offsetScale, right - inset - width / 2));
    const centerY = baseTop + baseHeight / 2 + settings.offsetY * offsetScale;
    root.style.left = `${center}px`;
    root.style.top = `${Math.max(top + inset, Math.min(centerY - height / 2, bottom - height - inset))}px`;
    root.style.width = `${width}px`;
    root.style.fontSize = `${width * 0.171}px`;
    if (warning) Object.assign(warning.style, {
      left: `${left}px`, top: `${top}px`, width: `${contentWidth}px`, height: `${contentHeight}px`
    });
  }

  return { render, resize };
}
