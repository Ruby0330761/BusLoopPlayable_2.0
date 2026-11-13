import { normalizeStaminaConfig, STAMINA_ASSETS, STAMINA_INTRO_ASSETS } from './stamina.js';

// Reference pixels from the confirmed 1–10 preview; all positions scale together.
function heartLayout(total) {
  const columns = total <= 5 ? total : Math.ceil(total / 2);
  const size = total <= 5 ? 29 : 19;
  const gap = total <= 5 ? 3 : 5;
  const height = total <= 5 ? 72 : 96;
  const width = columns * size + (columns - 1) * gap + (total <= 5 ? 54 : 56);
  return { columns, size, gap, width, height, rows: total <= 5 ? [total] : [columns, total - columns] };
}

// DOM presentation only; the model owns hearts, rescue and the loss result.
export function createStaminaView({ root, frame, hearts, intro, introFrame, stage }) {
  let settings = normalizeStaminaConfig();
  let introRemaining = 0;
  let lastIntroTime = null;

  function reset(config, { playIntro = true } = {}) {
    settings = normalizeStaminaConfig(config);
    introRemaining = settings.enabled && settings.introEnabled && playIntro ? 2 : 0;
    lastIntroTime = null;
  }

  function tickIntro({ time, paused = false, ended = false } = {}) {
    if (ended || !settings.enabled || !settings.introEnabled) introRemaining = 0;
    if (paused || introRemaining <= 0) {
      lastIntroTime = null;
      return;
    }
    if (lastIntroTime !== null) introRemaining = Math.max(0, introRemaining - Math.max(0, time - lastIntroTime) / 1000);
    lastIntroTime = time;
  }

  function paintHearts(container, total, remaining) {
    if (!container) return;
    if (container.children.length !== total) {
      container.replaceChildren(...Array.from({ length: total }, () => {
        const image = container.ownerDocument.createElement('img');
        image.alt = '';
        image.draggable = false;
        return image;
      }));
    }
    container.dataset.count = String(total);
    const layout = heartLayout(total);
    const groupHeight = layout.rows.length * layout.size + (layout.rows.length - 1) * 4;
    Array.from(container.children).forEach((image, index) => {
      const asset = index < remaining ? STAMINA_ASSETS.heart : STAMINA_ASSETS.empty;
      if (image.getAttribute('src') !== asset) image.src = asset;
      const row = index < layout.columns ? 0 : 1;
      const column = index - row * layout.columns;
      const rowWidth = layout.rows[row] * layout.size + (layout.rows[row] - 1) * layout.gap;
      Object.assign(image.style, {
        width: `${layout.size / layout.width * 100}%`, height: `${layout.size / layout.height * 100}%`,
        left: `${((layout.width - rowWidth) / 2 + column * (layout.size + layout.gap)) / layout.width * 100}%`,
        top: `${((layout.height - groupHeight) / 2 + row * (layout.size + 4)) / layout.height * 100}%`
      });
    });
  }

  function render(state, { config = settings, visible = true, ended = false } = {}) {
    settings = normalizeStaminaConfig(config);
    if (!settings.enabled || !settings.introEnabled || ended) introRemaining = 0;
    root.hidden = !settings.enabled || !visible;
    intro.hidden = root.hidden || introRemaining <= 0 || ended;
    const remaining = Math.max(0, Math.min(settings.lives, Number(state?.remaining) || 0));
    root.dataset.remaining = String(remaining);
    root.dataset.total = String(settings.lives);
    root.dataset.busy = String(Boolean(state?.busy));
    root.setAttribute('aria-label', `${remaining} of ${settings.lives} rescues remaining`);
    intro.setAttribute('aria-label', `${settings.lives} rescues available`);
    if (settings.enabled) {
      if (!frame.getAttribute('src')) frame.src = STAMINA_ASSETS.frame;
      root.style.setProperty('--stamina-frame', `url("${STAMINA_ASSETS.frame}")`);
      const layout = heartLayout(settings.lives);
      root.style.setProperty('--stamina-frame-side', `${layout.height / 2 / layout.width * 100}%`);
      paintHearts(hearts, settings.lives, remaining);
      if (settings.introEnabled) {
        const asset = STAMINA_INTRO_ASSETS[settings.lives];
        if (introFrame.getAttribute('src') !== asset) introFrame.src = asset;
        introFrame.alt = `${settings.lives} ${settings.lives === 1 ? 'REVIVE' : 'REVIVES'}!`;
      } else introFrame.removeAttribute('src');
    } else {
      for (const image of [frame, introFrame]) image.removeAttribute('src');
      hearts.replaceChildren();
    }
  }

  function resize(bounds = null, config = settings, uiScale = null) {
    const rect = stage.getBoundingClientRect();
    const stageWidth = stage.clientWidth || rect.width;
    const stageHeight = stage.clientHeight || rect.height;
    const left = Math.max(0, Number(bounds?.left) || 0);
    const top = Math.max(0, Number(bounds?.top) || 0);
    const right = Math.min(stageWidth, Number(bounds?.right) || left + (Number(bounds?.width) || stageWidth));
    const bottom = Math.min(stageHeight, Number(bounds?.bottom) || top + (Number(bounds?.height) || stageHeight));
    const contentWidth = Math.max(1, right - left);
    const contentHeight = Math.max(1, bottom - top);
    const inset = Math.min(8, contentWidth * 0.02, contentHeight * 0.02);
    const configValue = normalizeStaminaConfig(config);
    const scale = uiScale ?? Math.min(1, stageWidth / 1080, stageHeight / 2160);
    const layout = heartLayout(configValue.lives);
    const ratio = layout.width / layout.height;
    const baseWidth = Math.max(1, layout.width * Math.min(1, contentWidth * 0.55 / 211));
    const width = Math.max(1, Math.min(baseWidth * configValue.scale, contentWidth - inset * 2, (contentHeight - inset * 2) * ratio));
    const height = width / ratio;
    // Anchor to the visible game content and the actual scaled HUD edges.
    // Horizontal nudges use content width so their relative position survives rotation.
    const baseCenter = configValue.horizontalAlign === 'left' ? left + inset + width / 2
      : configValue.horizontalAlign === 'right' ? right - inset - width / 2
      : left + contentWidth / 2;
    const center = Math.max(left + inset + width / 2,
      Math.min(baseCenter + configValue.offsetX * contentWidth / 1080, right - inset - width / 2));
    const centerY = top + inset + baseWidth / ratio / 2 + configValue.offsetY * scale;
    const y = Math.max(top + inset, Math.min(centerY - height / 2, bottom - height - inset));
    Object.assign(root.style, { left: `${center}px`, top: `${y}px`, width: `${width}px`, height: `${height}px` });
    Object.assign(intro.style, { left: `${left}px`, top: `${top}px`, width: `${contentWidth}px`, height: `${contentHeight}px` });
    const introWidth = Math.min(620, contentWidth * 0.84);
    intro.style.setProperty('--stamina-intro-width', `${introWidth}px`);
    introFrame.style.maxHeight = `${contentHeight * 0.8}px`;
  }

  return { reset, tickIntro, render, resize, isIntroActive: () => Boolean(settings.enabled && settings.introEnabled && introRemaining > 0),
    introState: () => ({ remaining: introRemaining, active: Boolean(settings.enabled && settings.introEnabled && introRemaining > 0) }) };
}
