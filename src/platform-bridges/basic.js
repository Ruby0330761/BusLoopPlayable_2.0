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
      end() { ended = true; },
      retry() { ended = false; },
      openStore(options = {}) {
        return openStore(options);
      }
    });
  };
}
