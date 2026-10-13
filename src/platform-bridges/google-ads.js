import { createBasicBridge, openBrowserStorePreview } from './basic.js';

export const PLAYABLE_PLATFORM = 'google-ads';
export const createPlatformBridge = createBasicBridge(
  PLAYABLE_PLATFORM,
  ({ ios, android } = {}) => {
    if (typeof window.ExitApi?.exit === 'function') {
      window.ExitApi.exit();
      return true;
    }
    return openBrowserStorePreview(ios || android);
  }
);
