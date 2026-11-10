// Direct browser preview (no ad host present: a plain mobile browser opening the
// HTML file, or an upload preview page).
//
// The store opens in a NEW tab, so the playable stays loaded behind it and the
// player can come back. Verified in a real (non-headless) Chrome window: this
// `hidden` anchor + `target="_blank"` does create the tab. An earlier attempt to
// make the anchor "visible" (1x1, opacity 0) actually stopped the jump, and
// switching to `_self` would have replaced the playable itself — do not
// reintroduce either.
export function openBrowserStorePreview(url) {
  const protocol = window.location?.protocol;
  if (
    !url
    || !['file:', 'http:', 'https:'].includes(protocol)
    || typeof document === 'undefined'
    || typeof document.createElement !== 'function'
  ) return false;
  const link = document.createElement('a');
  link.href = url;
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  link.hidden = true;
  document.body?.append(link);
  link.click();
  setTimeout(() => link.remove?.(), 0);
  return true;
}

export function createBasicBridge(platform, openStore) {
  return ({ onStart, onVisibilityChange = () => {} } = {}) => {
    if (typeof onStart !== 'function') throw new TypeError('createPlatformBridge requires onStart.');
    let started = false;
    let ended = false;
    return Object.freeze({
      platform,
      initialize() {
        if (started) return;
        started = true;
        onVisibilityChange(true);
        onStart();
      },
      ready() {},
      challenge() {},
      challengeProgress() {},
      challengeSolved() {},
      challengeFailed() {},
      end() { ended = true; },
      retry() { ended = false; },
      openStore(options = {}) {
        return openStore(options);
      }
    });
  };
}
