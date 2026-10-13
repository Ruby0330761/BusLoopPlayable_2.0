import { createBasicBridge, openBrowserStorePreview } from './basic.js';

export const PLAYABLE_PLATFORM = 'moloco';
export const createPlatformBridge = createBasicBridge(
  PLAYABLE_PLATFORM,
  ({ ios, android } = {}) => {
    if (typeof window.FbPlayableAd?.onCTAClick === 'function') {
      window.FbPlayableAd.onCTAClick();
      return true;
    }
    return openBrowserStorePreview(ios || android);
  }
);
