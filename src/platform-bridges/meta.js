import { createBasicBridge } from './basic.js';

export const PLAYABLE_PLATFORM = 'meta';
export const createPlatformBridge = createBasicBridge(
  PLAYABLE_PLATFORM,
  () => {
    window.FbPlayableAd.onCTAClick();
    return true;
  }
);
