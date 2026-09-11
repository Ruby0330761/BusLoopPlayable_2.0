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
      openStore
    });
  };
}
