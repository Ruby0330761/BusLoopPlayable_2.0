import test from 'node:test';
import assert from 'node:assert/strict';

import {
  OVERLAY_ROOT_SELECTORS,
  OVERLAY_TEXT_SELECTORS,
  PAINTED_ROOT_SELECTORS,
  STAMINA_FRAME_SLICE,
  containRect,
  drawStageOverlays,
  isDrawableImage,
  isElementShown,
  isOverlayVisible,
  nineSliceRects,
  parseInsetRing,
  parseLinearGradient,
  parsePolygonClip,
  parseRadius
} from '../src/screenshot-overlay.js';

// Minimal stand-ins for the parts of the DOM the compositor touches. The point
// of these fakes is to prove *where* each overlay is painted, not to emulate a
// browser.
function fakeStyle(overrides = {}) {
  return {
    display: 'block',
    visibility: 'visible',
    opacity: '1',
    transform: 'none',
    objectFit: 'fill',
    fontSize: '20px',
    fontFamily: 'Arial',
    fontStyle: 'normal',
    fontWeight: '700',
    color: 'rgb(255, 255, 255)',
    textShadow: 'none',
    webkitTextStrokeWidth: '0',
    webkitTextStrokeColor: 'rgb(0, 0, 0)',
    ...overrides
  };
}

function fakeElement({
  rect = { left: 0, top: 0, width: 100, height: 100 },
  style = {},
  id = '',
  tagName = 'DIV',
  textContent = '',
  children = [],
  custom = {}
} = {}) {
  const attrs = new Map();
  const element = {
    id,
    tagName,
    textContent,
    offsetWidth: rect.width,
    offsetHeight: rect.height,
    naturalWidth: rect.width,
    naturalHeight: rect.height,
    getBoundingClientRect: () => rect,
    getAttribute: (key) => attrs.get(key),
    setAttribute: (key, value) => attrs.set(key, value),
    removeAttribute: (key) => attrs.delete(key),
    querySelectorAll: (selector) => children.filter((child) => child.matches?.(selector)),
    _style: fakeStyle(style),
    get style() {
      return {
        getPropertyValue: (name) => this._customProps?.[name] ?? ''
      };
    },
    _customProps: { ...custom },
    matches: () => false,
    ...custom.element
  };
  return element;
}

function fakeContext() {
  const calls = [];
  const context = {
    calls,
    save() {}, restore() {},
    drawImage: (...args) => calls.push({ type: 'drawImage', args }),
    fillText: (...args) => calls.push({ type: 'fillText', args }),
    strokeText: (...args) => calls.push({ type: 'strokeText', args }),
    // Styles are recorded on the call: the pill painter sets a colour and fills
    // immediately, so the colour is what the assertion is about.
    fill: () => calls.push({ type: 'fill', args: [context._fillStyle] }),
    stroke: () => calls.push({ type: 'stroke', args: [context._strokeStyle, context._lineWidth] }),
    translate() {}, rotate() {}, beginPath() {}, rect() {}, clip() {}, roundRect() {},
    set textAlign(value) { this._textAlign = value; },
    set textBaseline(value) { this._textBaseline = value; },
    set font(value) { this._font = value; },
    set fillStyle(value) { this._fillStyle = value; },
    set strokeStyle(value) { this._strokeStyle = value; },
    set lineWidth(value) { this._lineWidth = value; },
    set globalAlpha(value) { this._alpha = value; }
  };
  return context;
}

function fakeStage({ width = 360, height = 640, overlays = [] } = {}) {
  const rect = { left: 20, top: 40, width, height };
  return {
    clientWidth: width,
    clientHeight: height,
    clientLeft: 0,
    clientTop: 0,
    getBoundingClientRect: () => rect,
    // The real call site passes one comma-joined selector; each fake overlay
    // declares which selector it answers to.
    querySelectorAll: (selector) => {
      const selectors = String(selector).split(',');
      return overlays.filter((overlay) => selectors.some((entry) => overlay.selectors.includes(entry.trim())));
    },
    ownerDocument: { defaultView: { getComputedStyle: (element) => element._style } }
  };
}

test('overlay roots cover the HUD the canvas capture cannot see', () => {
  assert.ok(OVERLAY_ROOT_SELECTORS.includes('#stamina'));
  assert.ok(OVERLAY_ROOT_SELECTORS.includes('#countdown'));
  assert.ok(OVERLAY_ROOT_SELECTORS.includes('#speed-toggle'));
  assert.ok(OVERLAY_ROOT_SELECTORS.includes('.free-asset-overlay'));
  assert.ok(OVERLAY_ROOT_SELECTORS.includes('.weather-effect-canvas'));
  // Transient cards must not leak into a gameplay promo shot.
  for (const excluded of ['#stamina-intro', '#pre-roll-overlay', '#game-over-overlay', '#stage-choice-overlay']) {
    assert.equal(OVERLAY_ROOT_SELECTORS.includes(excluded), false, `${excluded} must stay out`);
  }
  assert.deepEqual(OVERLAY_TEXT_SELECTORS, ['#countdown-value', '#speed-toggle-label']);
});

test('the stamina frame slice mirrors the CSS border-image geometry', () => {
  // styles.css: border-image-slice 90 140 fill; border-image-width 32.1429% <side>.
  assert.deepEqual(
    { top: STAMINA_FRAME_SLICE.top, right: STAMINA_FRAME_SLICE.right,
      bottom: STAMINA_FRAME_SLICE.bottom, left: STAMINA_FRAME_SLICE.left },
    { top: 90, right: 140, bottom: 90, left: 140 }
  );
  assert.ok(Math.abs(STAMINA_FRAME_SLICE.borderTopPercent - 32.1429) < 1e-6);
});

test('containRect reproduces object-fit contain letterboxing', () => {
  // A square image in a wide box: height-bound, centred horizontally.
  assert.deepEqual(containRect({ x: 0, y: 0, width: 100, height: 50 }, 100, 100),
    { x: 25, y: 0, width: 50, height: 50 });
  // A wide image in a square box: width-bound, centred vertically.
  assert.deepEqual(containRect({ x: 10, y: 10, width: 100, height: 100 }, 200, 100),
    { x: 10, y: 35, width: 100, height: 50 });
  assert.equal(containRect({ x: 0, y: 0, width: 10, height: 10 }, 0, 10), null);
});

test('nine-slice geometry keeps the frame corners square and scales the middle', () => {
  const regions = nineSliceRects({
    imageWidth: 840,
    imageHeight: 280,
    slice: { top: 90, right: 140, bottom: 90, left: 140 },
    box: { x: 0, y: 0, width: 210, height: 70 },
    border: { top: 22.5, right: 61.25, bottom: 22.5, left: 61.25 }
  });
  // Every region of a 3x3 slice is present and inside the destination box.
  assert.equal(regions.length, 9);
  for (const region of regions) {
    assert.ok(region.dx >= 0 && region.dx + region.dw <= 210.0001);
    assert.ok(region.dy >= 0 && region.dy + region.dh <= 70.0001);
  }
  // Source regions tile the artwork without gaps: 3 columns of 140/560/140.
  assert.deepEqual([...new Set(regions.map((region) => region.sw))].sort((a, b) => a - b), [140, 560]);
});

test('nine-slice shrinks crossing borders instead of inverting them', () => {
  const regions = nineSliceRects({
    imageWidth: 840,
    imageHeight: 280,
    slice: { top: 90, right: 140, bottom: 90, left: 140 },
    box: { x: 0, y: 0, width: 20, height: 10 },
    border: { top: 40, right: 60, bottom: 40, left: 60 }
  });
  for (const region of regions) {
    assert.ok(region.dw >= 0 && region.dh >= 0);
    assert.ok(region.dx + region.dw <= 20.0001);
    assert.ok(region.dy + region.dh <= 10.0001);
  }
});

test('hidden, transparent and zero-sized overlays are skipped', () => {
  const view = { getComputedStyle: (element) => element._style };
  const make = (style, rect) => ({
    _style: fakeStyle(style),
    getBoundingClientRect: () => rect
  });
  const visibleRect = { left: 0, top: 0, width: 10, height: 10 };
  assert.equal(isOverlayVisible(make({}, visibleRect), view), true);
  assert.equal(isOverlayVisible(make({ display: 'none' }, visibleRect), view), false);
  assert.equal(isOverlayVisible(make({ visibility: 'hidden' }, visibleRect), view), false);
  assert.equal(isOverlayVisible(make({ opacity: '0' }, visibleRect), view), false);
  assert.equal(isOverlayVisible(make({}, { left: 0, top: 0, width: 0, height: 0 }), view), false);
});

test('a stamina capsule is painted at its live stage position with its hearts', async () => {
  const entries = {
    frame: { naturalWidth: 840, naturalHeight: 280 },
    heart: { naturalWidth: 140, naturalHeight: 140 },
    empty: { naturalWidth: 140, naturalHeight: 140 }
  };
  const heartElements = [
    fakeElement({ rect: { left: 40, top: 50, width: 20, height: 20 }, style: { objectFit: 'contain' } }),
    fakeElement({ rect: { left: 64, top: 50, width: 20, height: 20 }, style: { objectFit: 'contain' } }),
    fakeElement({ rect: { left: 88, top: 50, width: 20, height: 20 }, style: { objectFit: 'contain' } })
  ];
  const stamina = fakeElement({
    id: 'stamina',
    rect: { left: 30, top: 44, width: 110, height: 32 },
    tagName: 'DIV',
    custom: {
      element: {
        querySelectorAll: () => heartElements,
        style: { getPropertyValue: (name) => (name === '--stamina-frame-side' ? '29.1667%' : '') }
      }
    }
  });
  stamina.selectors = ['#stamina'];
  const stage = fakeStage({ overlays: [stamina] });
  const context = fakeContext();
  const requested = [];
  await drawStageOverlays(context, {
    stage,
    width: 720,
    height: 1280,
    loadImage: async (source) => { requested.push(source); return { naturalWidth: 840, naturalHeight: 280 }; }
  });
  // The frame artwork is requested from the live custom property, then the nine
  // regions plus the three heart images are painted.
  assert.equal(requested.length, 1);
  assert.match(requested[0], /stamina\/frame\.png$/);
  const imageCalls = context.calls.filter((call) => call.type === 'drawImage');
  assert.equal(imageCalls.length, 9 + heartElements.length);
  // Hearts are scaled from stage space into capture space (2x here).
  for (const call of imageCalls.slice(9)) {
    assert.ok(call.args[4] >= 38 && call.args[4] <= 42, `heart width ${call.args[4]}`);
  }
});

test('countdown digits and speed label are re-set with their computed font', async () => {
  const clockValue = fakeElement({
    id: 'countdown-value',
    rect: { left: 100, top: 20, width: 60, height: 30 },
    textContent: '00:27',
    style: { fontSize: '24px', fontWeight: '900', color: 'rgb(255, 255, 255)',
      textShadow: 'rgba(0, 0, 0, 0.5) 0px 3px 4px',
      webkitTextStrokeWidth: '1px', webkitTextStrokeColor: 'rgb(7, 73, 238)' }
  });
  const speedLabel = fakeElement({
    id: 'speed-toggle-label',
    rect: { left: 220, top: 30, width: 30, height: 20 },
    textContent: 'x2',
    style: { fontSize: '16px', fontWeight: '900' }
  });
  const countdown = fakeElement({
    id: 'countdown',
    rect: { left: 90, top: 10, width: 120, height: 60 },
    custom: { element: { querySelectorAll: (selector) => (selector === '#countdown-value' ? [clockValue] : []) } }
  });
  countdown.selectors = ['#countdown'];
  const speed = fakeElement({
    id: 'speed-toggle',
    rect: { left: 210, top: 20, width: 60, height: 40 },
    custom: { element: { querySelectorAll: (selector) => (selector === '#speed-toggle-label' ? [speedLabel] : []) } }
  });
  speed.selectors = ['#speed-toggle'];
  const context = fakeContext();
  await drawStageOverlays(context, { stage: fakeStage({ overlays: [countdown, speed] }), width: 720, height: 1280 });
  const texts = context.calls.filter((call) => call.type === 'fillText').map((call) => call.args[0]);
  assert.deepEqual(texts, ['00:27', 'x2']);
  // Stroke is drawn for the clock only: the speed label has no stroke.
  assert.equal(context.calls.filter((call) => call.type === 'strokeText').length, 1);
});

test('the speed switch pill is painted, not just its icon and numeral', async () => {
  // The default skin's pill is a CSS background image, so the generic image pass
  // never saw it; the editor screenshot used to show a floating icon and number.
  const label = fakeElement({
    id: 'speed-toggle-label',
    rect: { left: 230, top: 30, width: 26, height: 20 },
    textContent: '2x',
    style: { fontSize: '16px', fontWeight: '900', color: 'rgb(92, 101, 139)' }
  });
  const defaultSkin = fakeElement({
    id: 'speed-toggle',
    rect: { left: 200, top: 20, width: 70, height: 46 },
    style: { backgroundImage: 'url("/assets/applovin/speed-toggle-bg_q90.webp")' },
    custom: { element: { querySelectorAll: (selector) => (selector === '#speed-toggle-label' ? [label] : []) } }
  });
  defaultSkin.selectors = ['#speed-toggle'];
  const pillArt = { naturalWidth: 512, naturalHeight: 340 };
  const requested = [];
  const context = fakeContext();
  await drawStageOverlays(context, {
    stage: fakeStage({ overlays: [defaultSkin] }),
    width: 720,
    height: 1280,
    loadImage: async (source) => { requested.push(source); return pillArt; }
  });
  // The encoded URL is decoded and drawn at the button's own box.
  assert.deepEqual(requested, ['/assets/applovin/speed-toggle-bg_q90.webp']);
  const artCall = context.calls.find((call) => call.type === 'drawImage' && call.args[0] === pillArt);
  assert.ok(artCall, 'the pill artwork must reach the capture');
  assert.equal(artCall.args[3], 140);
  assert.equal(artCall.args[4], 92);
  assert.deepEqual(context.calls.filter((call) => call.type === 'fillText').map((call) => call.args[0]), ['2x']);

  // The light skin has no artwork: a flat fill plus its lavender rim have to be
  // reproduced from computed style, or that skin captures as an empty box.
  const lightSkin = fakeElement({
    id: 'speed-toggle',
    rect: { left: 200, top: 20, width: 70, height: 46 },
    style: {
      backgroundImage: 'none',
      backgroundColor: 'rgb(249, 252, 255)',
      borderTopWidth: '2px',
      borderTopColor: 'rgb(185, 194, 227)',
      borderRadius: '23px'
    }
  });
  lightSkin.selectors = ['#speed-toggle'];
  const lightContext = fakeContext();
  await drawStageOverlays(lightContext, {
    stage: fakeStage({ overlays: [lightSkin] }),
    width: 720,
    height: 1280
  });
  const fill = lightContext.calls.find((call) => call.type === 'fill');
  const stroke = lightContext.calls.find((call) => call.type === 'stroke');
  assert.deepEqual(fill?.args, ['rgb(249, 252, 255)']);
  assert.deepEqual(stroke?.args.slice(0, 1), ['rgb(185, 194, 227)']);
});

test('free-placed layers are painted with their rotation and opacity', async () => {
  const layer = fakeElement({
    rect: { left: 100, top: 200, width: 80, height: 80 },
    style: { transform: 'matrix(0.939693, 0.342020, -0.342020, 0.939693, 0, 0)', opacity: '0.6' }
  });
  const overlay = fakeElement({
    rect: { left: 0, top: 0, width: 360, height: 640 },
    custom: { element: { querySelectorAll: () => [layer] } }
  });
  overlay.selectors = ['.free-asset-overlay'];
  const context = fakeContext();
  await drawStageOverlays(context, { stage: fakeStage({ overlays: [overlay] }), width: 720, height: 1280 });
  const imageCalls = context.calls.filter((call) => call.type === 'drawImage');
  assert.equal(imageCalls.length, 1);
  // A rotated layer is drawn centred on itself at its untransformed size, so a
  // 20deg rotation does not squash the artwork into its AABB.
  assert.equal(imageCalls[0].args[0], layer);
  assert.ok(Math.abs(imageCalls[0].args[3] - 160) < 1e-6);
  assert.equal(context._alpha, 0.6);
});

test('overlays paint in document order so a shared z-index keeps the later DOM last', async () => {
  // #stamina and #countdown both use z-index 6 and stamina comes later, so the
  // capsule must be painted after the clock; a selector-ordered loop had them
  // the other way round and put the clock on top of the capsule.
  const order = [];
  const makeRoot = (id, selector) => {
    const element = fakeElement({ id, rect: { left: 10, top: 10, width: 50, height: 50 } });
    element.selectors = [selector];
    element.compareDocumentPosition = (other) => (order.indexOf(element.id) < order.indexOf(other.id) ? 4 : 2);
    order.push(id);
    return element;
  };
  const countdown = makeRoot('countdown', '#countdown');
  countdown.querySelectorAll = () => [];
  const stamina = makeRoot('stamina', '#stamina');
  stamina.querySelectorAll = () => [];
  stamina._customProps = { '--stamina-frame-side': '' };
  const context = fakeContext();
  // Stage returns them out of order on purpose: the compositor has to sort by
  // document position, not by the selector list it queried with.
  const stage = fakeStage({ overlays: [stamina, countdown] });
  const seen = [];
  const rootRect = { left: 10, top: 10, width: 50, height: 50 };
  for (const element of [stamina, countdown]) {
    element.getBoundingClientRect = () => {
      seen.push(element.id);
      return rootRect;
    };
  }
  await drawStageOverlays(context, { stage, width: 720, height: 1280 });
  assert.deepEqual(seen.filter((id, index) => seen.indexOf(id) === index), ['countdown', 'stamina']);
});

test('a canvas overlay is re-painted as a surface so weather particles survive', async () => {
  const weather = fakeElement({ tagName: 'CANVAS', rect: { left: 20, top: 40, width: 360, height: 640 } });
  weather.selectors = ['.weather-effect-canvas'];
  const context = fakeContext();
  await drawStageOverlays(context, { stage: fakeStage({ overlays: [weather] }), width: 720, height: 1280 });
  const imageCalls = context.calls.filter((call) => call.type === 'drawImage');
  assert.equal(imageCalls.length, 1);
  assert.equal(imageCalls[0].args[0], weather);
  // Stage border offsets are removed, then the box is scaled to the capture.
  assert.equal(imageCalls[0].args[1], 0);
  assert.equal(imageCalls[0].args[2], 0);
  assert.equal(imageCalls[0].args[3], 720);
  assert.equal(imageCalls[0].args[4], 1280);
});

test('the progress HUD is registered as a painted root', () => {
  assert.ok(OVERLAY_ROOT_SELECTORS.includes('#progress-hud'));
  assert.deepEqual(PAINTED_ROOT_SELECTORS, ['#progress-hud']);
});

test('a linear-gradient is parsed into an angle and colour stops', () => {
  // The progress band authors ~22 stops; stopping at the first comma would have
  // painted a flat first colour.
  const gradient = parseLinearGradient(
    'linear-gradient(90deg, rgb(18, 197, 42) 0%, rgb(210, 229, 8) 40%, rgb(255, 0, 0) 100%)'
  );
  assert.equal(gradient.angle, 90);
  assert.deepEqual(gradient.stops, [
    { color: 'rgb(18, 197, 42)', offset: 0 },
    { color: 'rgb(210, 229, 8)', offset: 0.4 },
    { color: 'rgb(255, 0, 0)', offset: 1 }
  ]);
  // A url() background is not a gradient and must report null, not a fake ramp.
  assert.equal(parseLinearGradient('url("a.png")'), null);
  assert.equal(parseLinearGradient('none'), null);
});

test('gradient stops without explicit offsets interpolate between their neighbours', () => {
  const gradient = parseLinearGradient('linear-gradient(180deg, red 0%, blue, green 100%)');
  assert.equal(gradient.stops.length, 3);
  assert.ok(Math.abs(gradient.stops[1].offset - 0.5) < 1e-9);
});

test('border radius parses a single value and an ellipse pair', () => {
  assert.equal(parseRadius('31px'), 31);
  assert.equal(parseRadius('16px / 8px'), 16);
  assert.equal(parseRadius('0px'), 0);
  assert.equal(parseRadius(''), 0);
});

test('an inset ring is read from box-shadow but a blurred shadow is not one', () => {
  // The live pill's yellow rim is `box-shadow: inset 0 0 0 3px #dcf800` on ::before.
  assert.deepEqual(parseInsetRing({ boxShadow: 'inset 0 0 0 3px #dcf800' }), { width: 3, color: '#dcf800' });
  // Chrome's computed form uses 0px instead of bare 0.
  assert.deepEqual(parseInsetRing({ boxShadow: 'inset 0px 0px 0px 4px rgb(220, 248, 0)' }),
    { width: 4, color: 'rgb(220, 248, 0)' });
  // A soft drop shadow is not a ring.
  assert.equal(parseInsetRing({ boxShadow: 'inset 0px 4px 4px rgba(255,255,255,.42)' }), null);
  // Outer (non-inset) shadows are never rings.
  assert.equal(parseInsetRing({ boxShadow: '0px 7px 13px rgba(16,30,72,.22)' }), null);
});

test('the bubble tail polygon is parsed into fractional points', () => {
  assert.deepEqual(parsePolygonClip('polygon(0 0, 100% 0, 50% 100%)'), [
    { x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0.5, y: 1 }
  ]);
  assert.equal(parsePolygonClip('none'), null);
});

test('a failed image is never handed to drawImage', async () => {
  // `drawImage` throws InvalidStateError on a broken <img>, and that exception
  // used to abort the whole overlay pass — one stale upload removed the progress
  // bar from every screenshot.
  assert.equal(isDrawableImage({ complete: true, naturalWidth: 0, naturalHeight: 0 }), false);
  assert.equal(isDrawableImage({ complete: false, naturalWidth: 10, naturalHeight: 10 }), false);
  assert.equal(isDrawableImage({ complete: true, naturalWidth: 10, naturalHeight: 10 }), true);
  assert.equal(isDrawableImage(null), false);
});

test('a zero-size positioned wrapper is still walked', () => {
  // `.phud__tick` measures 0x0 and paints through its abs-positioned children;
  // a size gate at this level silently dropped the whole pill row.
  const view = { getComputedStyle: (element) => element._style };
  const wrapper = {
    _style: { display: 'block', visibility: 'visible', opacity: '1' },
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 0, height: 0 })
  };
  assert.equal(isElementShown(wrapper, view), true);
  assert.equal(isOverlayVisible(wrapper, view), false);
});

test('one broken layer does not stop the remaining overlays', async () => {
  const broken = fakeElement({ id: 'broken', rect: { left: 0, top: 0, width: 10, height: 10 } });
  broken.complete = true;
  broken.naturalWidth = 0;
  broken.naturalHeight = 0;
  const brokenLayer = fakeElement({
    rect: { left: 0, top: 0, width: 360, height: 640 },
    custom: { element: { querySelectorAll: () => [broken] } }
  });
  brokenLayer.selectors = ['.free-asset-overlay'];
  // A canvas overlay after it must still be painted.
  const weather = fakeElement({ tagName: 'CANVAS', rect: { left: 20, top: 40, width: 360, height: 640 } });
  weather.selectors = ['.weather-effect-canvas'];
  const context = fakeContext();
  const warns = [];
  const originalWarn = console.warn;
  console.warn = (...args) => warns.push(args.map(String).join(' '));
  try {
    await drawStageOverlays(context, {
      stage: fakeStage({ overlays: [brokenLayer, weather] }),
      width: 720,
      height: 1280
    });
  } finally {
    console.warn = originalWarn;
  }
  const imageCalls = context.calls.filter((call) => call.type === 'drawImage');
  assert.equal(imageCalls.length, 1, 'the weather surface must survive a broken layer');
  assert.equal(imageCalls[0].args[0], weather);
});
