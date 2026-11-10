// Free-placed overlay layers for the guide stage.
//
// A layer is an image the operator drops anywhere on the phone preview and can
// pin in place. Coordinates are authored in the same 1080x2160 design space as
// the rest of the editor tuning, so a layer lands identically in the editor
// preview, the exported playable and the screenshot composer.

export const FREE_ASSET_LAYER_LIMIT = 24;

const clampNumber = (value, min, max, fallback) => {
  const n = Number(value);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
};

export function normalizeFreeAssetLayer(value = {}, index = 0) {
  const source = value && typeof value === 'object' ? value : {};
  return {
    id: typeof source.id === 'string' && source.id.trim() ? source.id.trim().slice(0, 64) : `layer-${index + 1}`,
    asset: typeof source.asset === 'string' ? source.asset : '',
    label: typeof source.label === 'string' ? source.label.slice(0, 80) : '',
    // Design-space centre and size, matching branding/cta tuning units.
    x: clampNumber(source.x ?? 540, -4000, 5000, 540),
    y: clampNumber(source.y ?? 1080, -4000, 5000, 1080),
    width: clampNumber(source.width ?? 300, 8, 4320, 300),
    height: clampNumber(source.height ?? 300, 8, 4320, 300),
    opacity: clampNumber(source.opacity ?? 1, 0, 1, 1),
    rotation: clampNumber(source.rotation ?? 0, -180, 180, 0),
    // A locked layer is still drawn, it just cannot be dragged in the editor.
    locked: Number(source.locked) === 1 ? 1 : 0,
    visible: Number(source.visible ?? 1) === 1 ? 1 : 0
  };
}

export function normalizeFreeAssetConfig(value = {}) {
  const source = value && typeof value === 'object' ? value : {};
  const layers = Array.isArray(source.layers) ? source.layers : [];
  return {
    layers: layers.slice(0, FREE_ASSET_LAYER_LIMIT).map((layer, index) => normalizeFreeAssetLayer(layer, index))
  };
}

/**
 * Apply authored layers to `host`, creating one absolutely-positioned <img> per
 * layer. Returns a handle used by the editor (dragging, selection) and by the
 * runtime (resize only).
 */
export function mountFreeAssetLayers(host, { config = {}, onLayerDrag = null, interactive = false } = {}) {
  if (!host || typeof document === 'undefined') {
    return { setConfig() {}, setDesignScale() {}, destroy() {} };
  }
  const root = document.createElement('div');
  root.className = 'free-asset-overlay';
  Object.assign(root.style, {
    position: 'absolute',
    inset: '0',
    overflow: 'hidden',
    pointerEvents: 'none',
    zIndex: '7'
  });
  host.append(root);

  let designScale = { x: 1, y: 1 };
  let activePointerId = null;
  let activeLayerId = null;
  let current = normalizeFreeAssetConfig(config);
  const elements = new Map();

  function applyBox(element, layer) {
    element.style.left = `${layer.x * designScale.x}px`;
    element.style.top = `${layer.y * designScale.y}px`;
    element.style.width = `${layer.width * designScale.x}px`;
    element.style.height = `${layer.height * designScale.y}px`;
    element.style.opacity = String(layer.opacity);
    element.style.transform = `translate(-50%, -50%) rotate(${layer.rotation}deg)`;
    element.hidden = !layer.visible;
    element.classList.toggle('is-locked', Boolean(layer.locked));
  }

  function sync() {
    const seen = new Set();
    for (const layer of current.layers) {
      seen.add(layer.id);
      let element = elements.get(layer.id);
      if (!element) {
        element = document.createElement('img');
        element.className = 'free-asset-layer';
        element.draggable = false;
        element.alt = layer.label;
        Object.assign(element.style, {
          position: 'absolute',
          transformOrigin: 'center',
          userSelect: 'none',
          WebkitUserDrag: 'none',
          maxWidth: 'none'
        });
        element.dataset.layerId = layer.id;
        root.append(element);
        elements.set(layer.id, element);
      }
      if (layer.asset && element.getAttribute('src') !== layer.asset) element.setAttribute('src', layer.asset);
      element.alt = layer.label;
      applyBox(element, layer);
      wire(element, layer);
    }
    for (const [id, element] of [...elements]) {
      if (seen.has(id)) continue;
      element.remove();
      elements.delete(id);
    }
  }

  function wire(element, layer) {
    if (!interactive || !onLayerDrag) {
      element.style.pointerEvents = 'none';
      return;
    }
    element.style.pointerEvents = layer.locked ? 'none' : 'auto';
    element.style.cursor = layer.locked ? 'default' : 'grab';
    element.style.touchAction = 'none';
    element.onpointerdown = (event) => {
      if (layer.locked) return;
      event.preventDefault();
      event.stopPropagation();
      activePointerId = event.pointerId;
      activeLayerId = layer.id;
      element.setPointerCapture?.(event.pointerId);
      element.style.cursor = 'grabbing';
    };
    element.onpointermove = (event) => {
      if (activePointerId == null || activeLayerId !== layer.id) return;
      const rect = host.getBoundingClientRect?.();
      if (!rect) return;
      onLayerDrag(layer.id, {
        x: (event.clientX - (rect.left || 0)) / (designScale.x || 1),
        y: (event.clientY - (rect.top || 0)) / (designScale.y || 1)
      });
    };
    const finish = () => {
      if (activePointerId == null) return;
      if (element.hasPointerCapture?.(activePointerId)) element.releasePointerCapture(activePointerId);
      activePointerId = null;
      activeLayerId = null;
      element.style.cursor = layer.locked ? 'default' : 'grab';
    };
    element.onpointerup = finish;
    element.onpointercancel = finish;
    element.onlostpointercapture = finish;
  }

  sync();

  return {
    setConfig(next) {
      current = normalizeFreeAssetConfig(next);
      sync();
    },
    /** Stage pixels per design unit; the editor recomputes this on resize. */
    setDesignScale({ x = 1, y = 1 } = {}) {
      designScale = { x: x || 1, y: y || 1 };
      for (const layer of current.layers) {
        const element = elements.get(layer.id);
        if (element) applyBox(element, layer);
      }
    },
    destroy() {
      root.remove();
      elements.clear();
    }
  };
}
