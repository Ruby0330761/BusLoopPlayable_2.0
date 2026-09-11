export const PLAYABLE_PLATFORM = 'unityads';

export function createPlatformBridge({ onStart, onVisibilityChange = () => {}, onSizeChange = () => {} } = {}) {
  if (typeof onStart !== 'function') throw new TypeError('createPlatformBridge requires onStart.');
  let started = false;
  let ready = false;
  let viewable = false;
  const start = () => {
    if (started || !ready || !viewable) return;
    started = true;
    onStart();
  };
  const handleViewableChange = (value) => {
    viewable = Boolean(value);
    onVisibilityChange(viewable);
    start();
  };
  const handleReady = () => {
    ready = true;
    viewable = Boolean(window.mraid.isViewable());
    onVisibilityChange(viewable);
    start();
  };
  return Object.freeze({
    platform: PLAYABLE_PLATFORM,
    initialize() {
      if (!window.mraid || typeof window.mraid.getState !== 'function' || typeof window.mraid.addEventListener !== 'function') {
        ready = true;
        viewable = true;
        onVisibilityChange(true);
        start();
        return;
      }
      window.mraid.addEventListener('viewableChange', handleViewableChange);
      window.mraid.addEventListener('sizeChange', onSizeChange);
      if (window.mraid.getState() === 'loading') window.mraid.addEventListener('ready', handleReady);
      else handleReady();
    },
    ready() {},
    challenge() {},
    end() {},
    retry() {},
    openStore({ ios, android } = {}) {
      window.mraid.open(ios || android);
      return true;
    }
  });
}
