export const IQ_BADGE = '/assets/applovin/iq/iq-badge.webp';
const TWEEN_SECONDS = 0.5;

export function normalizeIq(input) {
  const number = (key, fallback, min, max) => {
    const value = input?.[key];
    if (value == null || value === '' || !Number.isFinite(Number(value))) return fallback;
    return Math.max(min, Math.min(max, Number(value)));
  };
  return {
    enabled: Number(input?.enabled) === 1 ? 1 : 0,
    initialScore: Math.round(number('initialScore', 110, 0, 9999)),
    offsetX: number('offsetX', 0, -1080, 1080),
    offsetY: number('offsetY', 0, -2160, 2160),
    scale: number('scale', 1, 0.25, 3)
  };
}

// Unity commits the new integer only when its tween ends. An interrupt starts
// from the visible number but applies its delta to the last committed integer.
export class IqScore {
  constructor(initial) {
    this.initial = initial;
    this.committed = initial;
    this.target = initial;
    this.start = initial;
    this.startedAt = -Infinity;
  }

  valueAt(time) {
    const t = Math.max(0, (time - this.startedAt) / TWEEN_SECONDS);
    if (t >= 1) return this.target;
    return this.start + (this.target - this.start) * t * t * (3 - 2 * t);
  }

  change(delta, time) {
    this.start = this.valueAt(time);
    if (time - this.startedAt >= TWEEN_SECONDS) this.committed = this.target;
    this.target = Math.max(0, this.committed + delta);
    this.startedAt = time;
  }
}

export function createIqHud(root) {
  const art = root.querySelector('img');
  const label = root.querySelector('span');
  let shownValue = null;
  return {
    paint(score, time) {
      if (!score) {
        if (!root.hidden) root.hidden = true;
        return;
      }
      if (!art.hasAttribute('src')) art.src = IQ_BADGE;
      if (root.hidden) root.hidden = false;
      const value = Math.round(score.valueAt(time));
      if (shownValue !== value) {
        label.textContent = 'IQ = ' + value;
        shownValue = value;
      }
    },
    resize(bounds, input) {
      const { clientWidth, clientHeight } = root.parentElement;
      const left = Math.max(0, bounds?.left ?? 0);
      const right = Math.min(clientWidth, bounds?.right ?? clientWidth);
      const top = Math.max(0, bounds?.top ?? 0);
      const bottom = Math.min(clientHeight, bounds?.bottom ?? clientHeight);
      const width = right - left;
      const height = bottom - top;
      if (width <= 0 || height <= 0) return;
      const config = normalizeIq(input);
      const unit = Math.min(width / 1080, height / 1920);
      const size = Math.min(unit * config.scale, width / 310, height / 183);
      // The prefab anchors the plate at (-385, 639) relative to canvas centre.
      const x = left + width / 2 + (config.offsetX - 385) * unit - 155 * size;
      const y = top + height / 2 + (config.offsetY - 639) * unit - 109 * size;
      root.style.left = Math.max(left, Math.min(right - 310 * size, x)) + 'px';
      root.style.top = Math.max(top, Math.min(bottom - 183 * size, y)) + 'px';
      root.style.width = (310 * size) + 'px';
      root.style.fontSize = (45 * size) + 'px';
    }
  };
}
