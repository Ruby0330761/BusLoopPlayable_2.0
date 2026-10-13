import { openBrowserStorePreview } from './basic.js';

export const PLAYABLE_PLATFORM = 'mintegral';

export function createPlatformBridge({ onStart, onVisibilityChange = () => {}, onRetry = () => {} } = {}) {
  if (typeof onStart !== 'function') throw new TypeError('createPlatformBridge requires onStart.');
  const host = Object.create(null);
  for (const name of ['install', 'gameReady', 'gameStart', 'gameEnd', 'gameClose', 'gameRetry']) {
    if (typeof window[name] === 'function') host[name] = window[name].bind(window);
  }
  const callHost = (name) => {
    const callback = host[name];
    return callback ? callback() : undefined;
  };
  let started = false;
  let ready = false;
  let ended = false;

  // Chained on purpose: installFallback must reference the function we created
  // even when a platform checker wraps window.install behind a getter, and the
  // direct assignment keeps window.install visible to static packagers.
  const installFallback = window.install = function install() { return callHost('install'); };
  window.gameReady = function gameReady() { return callHost('gameReady'); };
  window.gameStart = function gameStart() { return callHost('gameStart'); };
  window.gameEnd = function gameEnd() { return callHost('gameEnd'); };
  window.gameClose = function gameClose() {
    try {
      return callHost('gameClose');
    } finally {
      onVisibilityChange(false);
    }
  };
  window.gameRetry = function gameRetry() {
    try {
      return callHost('gameRetry');
    } finally {
      ended = false;
      onVisibilityChange(true);
      onRetry();
    }
  };

  return Object.freeze({
    platform: PLAYABLE_PLATFORM,
    initialize() {
      if (started) return;
      started = true;
      onVisibilityChange(true);
      onStart();
    },
    ready() {
      if (ready) return;
      ready = true;
      window.gameReady();
      window.gameStart();
    },
    challenge() {},
    end() {
      if (ended) return;
      ended = true;
      window.gameEnd();
    },
    retry() { ended = false; },
    openStore({ ios, android } = {}) {
      // Mintegral requires the CTA to call window.install() and never open the
      // store itself. A host function captured at startup, or any other layer
      // owning window.install (platform checker wrapping it), counts as a live
      // install bridge. Only our own untouched fallback means a plain browser
      // preview, where the store link is opened directly instead.
      if (typeof host.install === 'function' || window.install !== installFallback) {
        window.install();
        return true;
      }
      return openBrowserStorePreview(ios || android);
    }
  });
}
