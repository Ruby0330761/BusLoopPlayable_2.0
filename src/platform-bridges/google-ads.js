import { createBasicBridge } from './basic.js';

export const PLAYABLE_PLATFORM = 'google-ads';
export const createPlatformBridge = createBasicBridge(
  PLAYABLE_PLATFORM,
  () => {
    window.ExitApi.exit();
    return true;
  }
);
