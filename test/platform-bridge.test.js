import test from 'node:test';
import assert from 'node:assert/strict';

test('AppLovin bridge waits for viewability, tracks both visibility directions, and opens MRAID', async (t) => {
  const listeners = {};
  const events = [];
  const opened = [];
  const visibility = [];
  let viewable = false;
  global.window = {
    mraid: {
      getState: () => 'loading',
      isViewable: () => viewable,
      addEventListener: (name, listener) => { listeners[name] = listener; },
      open: (url) => opened.push(url)
    },
    ALPlayableAnalytics: { trackEvent: (name) => events.push(name) }
  };
  t.after(() => { delete global.window; });
  const { createPlatformBridge } = await import(`../src/platform-bridge.js?test=${Date.now()}`);
  let starts = 0;
  const bridge = createPlatformBridge({
    onStart: () => { starts += 1; },
    onVisibilityChange: (value) => visibility.push(value)
  });
  bridge.initialize();
  assert.equal(starts, 0);
  listeners.ready();
  assert.equal(starts, 0);
  viewable = true;
  listeners.viewableChange(true);
  assert.equal(starts, 1);
  viewable = false;
  listeners.viewableChange(false);
  viewable = true;
  listeners.viewableChange(true);
  assert.equal(starts, 1);
  bridge.ready();
  bridge.challenge();
  bridge.end();
  bridge.openStore({ android: 'https://play.google.com/example' });
  assert.deepEqual(events, ['LOADING', 'LOADED', 'DISPLAYED', 'CHALLENGE_STARTED', 'ENDCARD_SHOWN', 'CTA_CLICKED']);
  assert.deepEqual(opened, ['https://play.google.com/example']);
  assert.deepEqual(visibility, [false, true, false, true]);
});

test('AppLovin bridge rejects unsupported non-browser previews without MRAID', async (t) => {
  global.window = { location: { protocol: 'about:' } };
  t.after(() => { delete global.window; });
  const { createPlatformBridge } = await import(`../src/platform-bridge.js?test=production-${Date.now()}`);
  const bridge = createPlatformBridge({ onStart: () => {} });

  assert.throws(
    () => bridge.openStore({ android: 'https://play.google.com/example' }),
    /MRAID CTA is unavailable/
  );
});

test('AppLovin bridge follows the store link from an explicit CTA in a local file preview', async (t) => {
  let link;
  global.window = { location: { protocol: 'file:' } };
  global.document = {
    createElement: (tagName) => {
      assert.equal(tagName, 'a');
      link = { clicked: false, click() { this.clicked = true; } };
      return link;
    }
  };
  t.after(() => {
    delete global.window;
    delete global.document;
  });
  const { createPlatformBridge } = await import(`../src/platform-bridge.js?test=file-${Date.now()}`);
  const bridge = createPlatformBridge({ onStart: () => {} });

  assert.equal(bridge.openStore({ android: 'https://play.google.com/example' }), true);
  assert.equal(link.href, 'https://play.google.com/example');
  assert.equal(link.rel, 'noopener noreferrer');
  assert.equal(link.clicked, true);
});

test('AppLovin bridge follows the store link from an explicit CTA in a hosted browser preview', async (t) => {
  let link;
  global.window = { location: { protocol: 'http:' } };
  global.document = {
    createElement: (tagName) => {
      assert.equal(tagName, 'a');
      link = { clicked: false, click() { this.clicked = true; } };
      return link;
    }
  };
  t.after(() => {
    delete global.window;
    delete global.document;
  });
  const { createPlatformBridge } = await import(`../src/platform-bridge.js?test=hosted-${Date.now()}`);
  const bridge = createPlatformBridge({ onStart: () => {} });

  assert.equal(bridge.openStore({ android: 'https://play.google.com/example' }), true);
  assert.equal(link.href, 'https://play.google.com/example');
  assert.equal(link.rel, 'noopener noreferrer');
  assert.equal(link.clicked, true);
});

test('Unity Ads bridge waits for viewability and forwards visibility, size, and CTA events', async (t) => {
  const listeners = {};
  const visibility = [];
  const sizes = [];
  const opened = [];
  let viewable = false;
  global.window = {
    mraid: {
      getState: () => 'loading',
      isViewable: () => viewable,
      addEventListener: (name, listener) => { listeners[name] = listener; },
      open: (url) => opened.push(url)
    }
  };
  t.after(() => { delete global.window; });
  const { createPlatformBridge } = await import(`../src/platform-bridges/unityads.js?test=${Date.now()}`);
  let starts = 0;
  const bridge = createPlatformBridge({
    onStart: () => { starts += 1; },
    onVisibilityChange: (value) => visibility.push(value),
    onSizeChange: (...args) => sizes.push(args)
  });
  bridge.initialize();
  listeners.ready();
  assert.equal(starts, 0);
  viewable = true;
  listeners.viewableChange(true);
  assert.equal(starts, 1);
  viewable = false;
  listeners.viewableChange(false);
  viewable = true;
  listeners.viewableChange(true);
  listeners.sizeChange(320, 480);
  assert.equal(starts, 1);
  assert.deepEqual(visibility, [false, true, false, true]);
  assert.deepEqual(sizes, [[320, 480]]);
  assert.equal(bridge.openStore({ android: 'https://play.google.com/example' }), true);
  assert.deepEqual(opened, ['https://play.google.com/example']);
});

test('platform-specific bridges call their native CTA APIs', async (t) => {
  const calls = [];
  global.window = {
    ExitApi: { exit: (...args) => calls.push(['google', ...args]) },
    FbPlayableAd: { onCTAClick: () => calls.push(['meta']) },
    playableSDK: { openAppStore: () => calls.push(['tiktok']) }
  };
  t.after(() => { delete global.window; });
  for (const [name, expected] of [['google-ads', 'google'], ['meta', 'meta'], ['moloco', 'meta'], ['tiktok', 'tiktok']]) {
    const { createPlatformBridge } = await import(`../src/platform-bridges/${name}.js?test=${Date.now()}-${name}`);
    let started = false;
    const bridge = createPlatformBridge({ onStart: () => { started = true; } });
    bridge.initialize();
    assert.equal(started, true);
    assert.equal(bridge.openStore({}), true);
    assert.equal(calls.at(-1)[0], expected);
    if (name === 'google-ads') assert.deepEqual(calls.at(-1), ['google']);
  }
});

test('TikTok bridge falls back to the global openAppStore API', async (t) => {
  const calls = [];
  global.window = {
    playableSDK: {},
    openAppStore: () => calls.push('global')
  };
  t.after(() => { delete global.window; });
  const { createPlatformBridge } = await import(`../src/platform-bridges/tiktok.js?test=fallback-${Date.now()}`);
  const bridge = createPlatformBridge({ onStart: () => {} });
  assert.equal(bridge.openStore(), true);
  assert.deepEqual(calls, ['global']);
});

test('Mintegral bridge exposes one-shot lifecycle and handles close and retry', async (t) => {
  const calls = [];
  const visibility = [];
  let retries = 0;
  global.window = Object.fromEntries(
    ['install', 'gameReady', 'gameStart', 'gameEnd', 'gameClose', 'gameRetry']
      .map((name) => [name, () => calls.push(name)])
  );
  t.after(() => { delete global.window; });
  const { createPlatformBridge } = await import(`../src/platform-bridges/mintegral.js?test=${Date.now()}`);
  const bridge = createPlatformBridge({
    onStart: () => calls.push('runtimeStart'),
    onVisibilityChange: (value) => visibility.push(value),
    onRetry: () => { retries += 1; }
  });
  bridge.initialize();
  bridge.ready();
  bridge.ready();
  bridge.end();
  bridge.end();
  bridge.openStore();
  window.gameClose();
  window.gameRetry();
  bridge.end();
  assert.deepEqual(calls, [
    'runtimeStart', 'gameReady', 'gameStart', 'gameEnd', 'install', 'gameClose', 'gameRetry', 'gameEnd'
  ]);
  assert.deepEqual(visibility, [true, false, true]);
  assert.equal(retries, 1);
  for (const name of ['install', 'gameReady', 'gameStart', 'gameEnd', 'gameClose', 'gameRetry']) {
    assert.equal(typeof window[name], 'function');
  }
});

test('native CTA failures propagate instead of being converted into success or warnings', async (t) => {
  const failure = new Error('native bridge failed');
  const cases = [
    ['applovin', '../src/platform-bridge.js', () => ({ mraid: { open: () => { throw failure; } } })],
    ['google', '../src/platform-bridges/google-ads.js', () => ({ ExitApi: { exit: () => { throw failure; } } })],
    ['meta', '../src/platform-bridges/meta.js', () => ({ FbPlayableAd: { onCTAClick: () => { throw failure; } } })],
    ['moloco', '../src/platform-bridges/moloco.js', () => ({ FbPlayableAd: { onCTAClick: () => { throw failure; } } })],
    ['unity', '../src/platform-bridges/unityads.js', () => ({ mraid: { open: () => { throw failure; } } })],
    ['mintegral', '../src/platform-bridges/mintegral.js', () => ({ install: () => { throw failure; } })],
    ['tiktok', '../src/platform-bridges/tiktok.js', () => ({
      playableSDK: { openAppStore: () => { throw failure; } },
      openAppStore: () => assert.fail('SDK failures must not trigger a second store open')
    })]
  ];
  t.after(() => { delete global.window; });
  for (const [name, path, makeWindow] of cases) {
    global.window = makeWindow();
    const { createPlatformBridge } = await import(`${path}?test=error-${Date.now()}-${name}`);
    const bridge = createPlatformBridge({ onStart: () => {} });
    assert.throws(
      () => bridge.openStore({ android: 'https://play.google.com/example' }),
      (error) => error === failure,
      `${name} should surface the native CTA failure`
    );
  }
});
