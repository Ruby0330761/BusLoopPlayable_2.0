import { createBasicBridge } from './basic.js';

export const PLAYABLE_PLATFORM = 'tiktok';
export const createPlatformBridge = createBasicBridge(
  PLAYABLE_PLATFORM,
  () => {
    if (typeof window.playableSDK?.openAppStore === 'function') window.playableSDK.openAppStore();
    else window.openAppStore();
    return true;
  }
);
