import { createBasicBridge, openBrowserStorePreview } from './basic.js';

export const PLAYABLE_PLATFORM = 'tiktok';
export const createPlatformBridge = createBasicBridge(
  PLAYABLE_PLATFORM,
  ({ ios, android } = {}) => {
    if (typeof window.playableSDK?.openAppStore === 'function') {
      window.playableSDK.openAppStore();
      return true;
    }
    if (typeof window.openAppStore === 'function') {
      window.openAppStore();
      return true;
    }
    return openBrowserStorePreview(ios || android);
  }
);
