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
  bridge.challengeProgress(25);
  bridge.challengeProgress(25);
  bridge.challengeProgress(50);
  bridge.challengeProgress(100);
  bridge.challengeSolved();
  bridge.end();
  bridge.challengeFailed();
  bridge.retry();
  bridge.openStore({ android: 'https://play.google.com/example' });
  assert.deepEqual(events, [
    'LOADING',
    'LOADED',
    'DISPLAYED',
    'CHALLENGE_STARTED',
    'CHALLENGE_PASS_25',
    'CHALLENGE_PASS_50',
    'CHALLENGE_PASS_75',
    'CHALLENGE_SOLVED',
    'ENDCARD_SHOWN',
    'CTA_CLICKED'
  ]);
  assert.deepEqual(opened, ['https://play.google.com/example']);
  assert.deepEqual(visibility, [false, true, false, true]);
});

test('AppLovin bridge backfills CHALLENGE_STARTED and keeps the retry funnel stuck to one attempt', async (t) => {
  const events = [];
  global.window = { ALPlayableAnalytics: { trackEvent: (name) => events.push(name) } };
  t.after(() => { delete global.window; });
  const { createPlatformBridge } = await import(`../src/platform-bridge.js?test=funnel-${Date.now()}`);
  const bridge = createPlatformBridge({ onStart: () => {} });

  bridge.challengeProgress(30);
  bridge.challengeFailed();
  bridge.retry();
  bridge.challengeProgress(25);
  assert.deepEqual(events, [
    'CHALLENGE_STARTED',
    'CHALLENGE_PASS_25',
    'CHALLENGE_FAILED',
    'CHALLENGE_RETRY'
  ]);
});

test('AppLovin CTA clicked before any gameplay backfills CHALLENGE_STARTED ahead of CTA_CLICKED', async (t) => {
  const events = [];
  const opened = [];
  global.window = {
    mraid: { open: (url) => opened.push(url) },
    ALPlayableAnalytics: { trackEvent: (name) => events.push(name) }
  };
  t.after(() => { delete global.window; });
  const { createPlatformBridge } = await import(`../src/platform-bridge.js?test=cta-${Date.now()}`);
  const bridge = createPlatformBridge({ onStart: () => {} });

  bridge.openStore({ android: 'https://play.google.com/example' });
  assert.deepEqual(events, ['CHALLENGE_STARTED']);
  await new Promise((resolve) => setTimeout(resolve, 260));
  assert.deepEqual(events, ['CHALLENGE_STARTED', 'CTA_CLICKED']);
  assert.deepEqual(opened, ['https://play.google.com/example']);
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
    // A real TikTok container injects the JSBridge transport; the bundled SDK
    // alone is not proof of a host, so the fixture has to include it.
    JSBridge: { on: () => {} },
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
    JSBridge: { on: () => {} },
    playableSDK: {},
    openAppStore: () => calls.push('global')
  };
  t.after(() => { delete global.window; });
  const { createPlatformBridge } = await import(`../src/platform-bridges/tiktok.js?test=fallback-${Date.now()}`);
  const bridge = createPlatformBridge({ onStart: () => {} });
  assert.equal(bridge.openStore(), true);
  assert.deepEqual(calls, ['global']);
});

test('TikTok CTA still calls the platform API and opens the store in a browser', async (t) => {
  // The SDK script is inlined in every TikTok build, so `openAppStore` exists
  // even with no host listening. The call is made (the ad container is the real
  // target), and because this is not an in-app webview the store link opens too.
  const calls = [];
  global.window = {
    location: { protocol: 'https:' },
    playableSDK: { openAppStore: () => calls.push('sdk') }
  };
  global.document = {
    createElement: () => ({ click() { calls.push('anchor'); }, remove() {} }),
    body: { append() {} }
  };
  t.after(() => { delete global.window; delete global.document; });
  const { createPlatformBridge } = await import(`../src/platform-bridges/tiktok.js?test=browser-${Date.now()}`);
  const bridge = createPlatformBridge({ onStart: () => {} });
  assert.equal(
    bridge.openStore({ android: 'https://play.google.com/store/apps/details?id=example' }),
    true
  );
  assert.deepEqual(calls, ['sdk', 'anchor']);
});

test('TikTok CTA ignores the SDK-installed JSBridge when deciding on the fallback', async (t) => {
  // The SDK creates window.JSBridge and its iframes itself, so that object can
  // never prove a host is listening; the UA has to decide.
  const calls = [];
  global.window = {
    location: { protocol: 'https:' },
    JSBridge: { on: () => {} },
    playableSDK: { openAppStore: () => calls.push('sdk') }
  };
  global.document = {
    createElement: () => ({ click() { calls.push('anchor'); }, remove() {} }),
    body: { append() {} }
  };
  t.after(() => { delete global.window; delete global.document; });
  const { createPlatformBridge } = await import(`../src/platform-bridges/tiktok.js?test=sdkbridge-${Date.now()}`);
  const bridge = createPlatformBridge({ onStart: () => {} });
  assert.equal(bridge.openStore({ android: 'https://play.google.com/example' }), true);
  assert.deepEqual(calls, ['sdk', 'anchor']);
});

test('TikTok CTA opens the store only once inside the in-app webview', async (t) => {
  const calls = [];
  const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: { userAgent: 'Mozilla/5.0 (Linux; Android 13) Mobile TikTok 30.1.0' }
  });
  global.window = {
    location: { protocol: 'https:' },
    playableSDK: { openAppStore: () => calls.push('sdk') }
  };
  global.document = {
    createElement: () => ({ click() { calls.push('anchor'); }, remove() {} }),
    body: { append() {} }
  };
  t.after(() => {
    delete global.window;
    delete global.document;
    if (originalNavigator) Object.defineProperty(globalThis, 'navigator', originalNavigator);
    else delete globalThis.navigator;
  });
  const { createPlatformBridge } = await import(`../src/platform-bridges/tiktok.js?test=inapp-${Date.now()}`);
  const bridge = createPlatformBridge({ onStart: () => {} });
  assert.equal(bridge.openStore({ android: 'https://play.google.com/example' }), true);
  assert.deepEqual(calls, ['sdk']);
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
      JSBridge: { on: () => {} },
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
