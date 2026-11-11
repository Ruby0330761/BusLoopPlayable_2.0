// Full-screen weather overlay: rain, snow, wind or falling leaves drawn on a
// transparent canvas above the game stage.
//
// Kept as a plain canvas painter rather than a THREE particle system because
// the effect is a 2D screen-space overlay: it must sit above the 3D scene, obey
// simple design-unit tuning, and cost nothing when disabled.

export const WEATHER_MODES = Object.freeze([
  ['rain', '雨'],
  ['snow', '雪'],
  ['wind', '风（横吹粒子）'],
  ['leaf', '落叶']
]);

export const DEFAULT_WEATHER_CONFIG = Object.freeze({
  enabled: 0,
  mode: 'rain',
  sprite: '',
  intensity: 1,
  speed: 1,
  size: 1,
  opacity: 0.85,
  windX: 0.18,
  color: 0xffffff
});

const MODE_DEFINITIONS = {
  // Count is per million square design units, so a bigger stage gets denser
  // weather instead of the same handful of drops spread thinner.
  rain: { count: 220, length: 34, width: 2.2, drift: 0.06, stretch: 1 },
  snow: { count: 130, length: 7, width: 7, drift: 0.5, stretch: 1 },
  wind: { count: 150, length: 26, width: 2, drift: 1.4, stretch: 1 },
  leaf: { count: 90, length: 14, width: 10, drift: 0.85, stretch: 0.6 }
};

const clampNumber = (value, min, max, fallback) => {
  const n = Number(value);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
};

export function normalizeWeatherConfig(value = {}) {
  const source = value && typeof value === 'object' ? value : {};
  const mode = MODE_DEFINITIONS[source.mode] ? source.mode : DEFAULT_WEATHER_CONFIG.mode;
  return {
    enabled: Number(source.enabled) === 1 ? 1 : 0,
    mode,
    sprite: typeof source.sprite === 'string' ? source.sprite : '',
    intensity: clampNumber(source.intensity ?? 1, 0, 4, 1),
    speed: clampNumber(source.speed ?? 1, 0.1, 5, 1),
    size: clampNumber(source.size ?? 1, 0.2, 4, 1),
    opacity: clampNumber(source.opacity ?? 0.85, 0, 1, 0.85),
    windX: clampNumber(source.windX ?? 0.18, -2, 2, 0.18),
    color: Math.round(clampNumber(source.color ?? 0xffffff, 0, 0xffffff, 0xffffff))
  };
}

/** Particles for a stage of `width` x `height` CSS pixels. */
function createParticles(config, width, height) {
  const definition = MODE_DEFINITIONS[config.mode] ?? MODE_DEFINITIONS.rain;
  const area = Math.max(1, width * height);
  const areaFactor = clampNumber(area / (1080 * 2160), 0.25, 3, 1);
  const count = Math.max(8, Math.round(definition.count * config.intensity * areaFactor));
  const particles = [];
  for (let i = 0; i < count; i += 1) {
    particles.push({
      x: Math.random() * width,
      y: Math.random() * height,
      // Per-particle jitter keeps the fall from looking like a moving grid.
      speedJitter: 0.65 + Math.random() * 0.7,
      driftJitter: 0.6 + Math.random() * 0.8,
      phase: Math.random() * Math.PI * 2,
      scaleJitter: 0.7 + Math.random() * 0.6
    });
  }
  return { definition, particles };
}

/**
 * Mount a weather overlay into `host`. Returns a handle with `resize`,
 * `setConfig`, `render(deltaSeconds)`, `setVisible` and `destroy`.
 *
 * `sprite` (an uploaded PNG/WebP) replaces the vector drop/flake shape with the
 * authored artwork; that is what lets a level use a leaf or petal texture
 * without shipping a new renderer branch.
 */
export function createWeatherEffect(host, options = {}) {
  if (!host || typeof document === 'undefined') {
    return {
      setConfig() {},
      resize() {},
      render() {},
      setVisible() {},
      destroy() {}
    };
  }
  const canvas = document.createElement('canvas');
  canvas.className = 'weather-effect-canvas';
  canvas.setAttribute('aria-hidden', 'true');
  Object.assign(canvas.style, {
    position: 'absolute',
    inset: '0',
    width: '100%',
    height: '100%',
    pointerEvents: 'none'
  });
  host.append(canvas);
  const context = canvas.getContext('2d');

  let config = normalizeWeatherConfig(options.config ?? {});
  let particleState = { definition: MODE_DEFINITIONS[config.mode], particles: [] };
  let sprite = null;
  let spriteSource = '';
  let width = Math.max(1, host.clientWidth || 1);
  let height = Math.max(1, host.clientHeight || 1);
  let ratio = Math.min(globalThis.devicePixelRatio || 1, 2);
  let visible = true;

  function loadSprite(source) {
    if (!source || source === spriteSource) return;
    spriteSource = source;
    sprite = null;
    const image = new Image();
    image.onload = () => {
      if (spriteSource === source) sprite = image;
    };
    image.src = source;
  }

  function measure() {
    const rect = host.getBoundingClientRect?.();
    width = Math.max(1, Math.round(rect?.width || host.clientWidth || width));
    height = Math.max(1, Math.round(rect?.height || host.clientHeight || height));
    ratio = Math.min(globalThis.devicePixelRatio || 1, 2);
    if (canvas.width !== Math.round(width * ratio) || canvas.height !== Math.round(height * ratio)) {
      canvas.width = Math.round(width * ratio);
      canvas.height = Math.round(height * ratio);
    }
    context?.setTransform(ratio, 0, 0, ratio, 0, 0);
  }

  function rebuild() {
    measure();
    particleState = createParticles(config, width, height);
  }

  function drawParticle(particle, definition) {
    const x = particle.x;
    const y = particle.y;
    const sizeScale = config.size * particle.scaleJitter;
    if (sprite) {
      const side = Math.max(2, definition.length * sizeScale * 1.6);
      context.drawImage(sprite, x - side / 2, y - side / 2, side, side);
      return;
    }
    if (config.mode === 'rain' || config.mode === 'wind') {
      const length = definition.length * sizeScale;
      const slant = definition.drift + config.windX;
      context.lineWidth = Math.max(0.6, definition.width * sizeScale);
      context.beginPath();
      context.moveTo(x, y);
      context.lineTo(x - slant * length, y - length);
      context.stroke();
      return;
    }
    // Snow / leaf: a soft disc. Leaf artwork comes through `sprite`; the vector
    // fallback stays round so the mode still reads as drifting debris.
    const radius = Math.max(1, (definition.length * sizeScale) / 2);
    context.beginPath();
    context.ellipse(x, y, radius, radius * (config.mode === 'leaf' ? definition.stretch : 1), 0, 0, Math.PI * 2);
    context.fill();
  }

  function render(deltaSeconds = 0.016) {
    if (!context) return;
    context.clearRect(0, 0, width, height);
    if (!Number(config.enabled) || !visible) return;
    const definition = particleState.definition ?? MODE_DEFINITIONS[config.mode];
    const step = Math.max(0, Math.min(0.1, Number(deltaSeconds) || 0.016));
    const fallSpeed = (config.mode === 'rain' ? 900 : config.mode === 'wind' ? 320 : 110) * config.speed;
    const horizontal = (config.windX + definition.drift) * fallSpeed * 0.5;
    context.globalAlpha = config.opacity;
    context.strokeStyle = `#${config.color.toString(16).padStart(6, '0')}`;
    context.fillStyle = context.strokeStyle;
    context.lineCap = 'round';

    for (const particle of particleState.particles) {
      particle.x += horizontal * step * particle.driftJitter;
      particle.y += fallSpeed * step * particle.speedJitter;
      // Wrap around instead of respawning so the field keeps a steady density.
      if (particle.y > height + 40) {
        particle.y = -40;
        particle.x = Math.random() * width;
      }
      if (particle.x > width + 40) particle.x = -40;
      else if (particle.x < -40) particle.x = width + 40;
      drawParticle(particle, definition);
    }
    context.globalAlpha = 1;
  }

  rebuild();

  return {
    setConfig(next) {
      const previousMode = config.mode;
      const previousIntensity = config.intensity;
      config = normalizeWeatherConfig(next);
      // A disabled effect must not request its sprite: the packager only inlines
      // the artwork of an enabled effect, so loading it anyway turned every
      // turned-off overlay into a failed request inside the single-file ad.
      if (Number(config.enabled) && config.sprite !== spriteSource) loadSprite(config.sprite);
      // A mode or density change needs fresh particles; a colour/opacity tweak
      // must not restart the whole field.
      if (config.mode !== previousMode || config.intensity !== previousIntensity) rebuild();
    },
    resize: rebuild,
    render,
    setVisible(next) {
      visible = Boolean(next);
      if (!visible) context?.clearRect(0, 0, width, height);
    },
    destroy() {
      canvas.remove();
    }
  };
}
