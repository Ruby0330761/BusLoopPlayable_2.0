import { openBrowserStorePreview } from './basic.js';

export const PLAYABLE_PLATFORM = 'unityads';

export function createPlatformBridge({
  onStart,
  onVisibilityChange = () => {},
  onSizeChange = () => {},
  onAudioVolumeChange = () => {}
} = {}) {
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
    // Same as AppLovin: a hidden host can miss device-volume changes, so the
    // level is re-read when the ad becomes visible again.
    if (viewable) readAudioVolume();
    start();
  };
  // Same MRAID audio contract as the AppLovin bridge: the volume arrives as
  // 0-100, and a muted device must mute this creative too.
  const handleAudioVolumeChange = (value) => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return;
    onAudioVolumeChange(Math.max(0, Math.min(1, parsed / 100)));
  };
  const readAudioVolume = () => {
    if (typeof window.mraid?.getAudioVolume !== 'function') return;
    try {
      handleAudioVolumeChange(window.mraid.getAudioVolume());
    } catch {
      // Later changes still arrive through the listener above.
    }
  };
  const handleReady = () => {
    ready = true;
    viewable = Boolean(window.mraid.isViewable());
    onVisibilityChange(viewable);
    readAudioVolume();
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
      window.mraid.addEventListener('audioVolumeChange', handleAudioVolumeChange);
      window.mraid.addEventListener('sizeChange', onSizeChange);
      if (window.mraid.getState() === 'loading') window.mraid.addEventListener('ready', handleReady);
      else handleReady();
    },
    ready() {},
    challenge() {},
    challengeProgress() {},
    challengeSolved() {},
    challengeFailed() {},
    end() {},
    retry() {},
    openStore({ ios, android } = {}) {
      if (typeof window.mraid?.open === 'function') {
        window.mraid.open(ios || android);
        return true;
      }
      return openBrowserStorePreview(ios || android);
    }
  });
}
