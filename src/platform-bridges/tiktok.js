import { createBasicBridge, openBrowserStorePreview } from './basic.js';

export const PLAYABLE_PLATFORM = 'tiktok';

// TikTok and Pangle inject the playable SDK, so `openAppStore` exists in every
// build -- even in a plain browser, where the call is forwarded to a native
// bridge that is not there and silently does nothing. That made the CTA look
// dead during desktop review.
//
// The SDK installs its own `JSBridge` object and bridge iframes on load, so the
// presence of a transport says nothing about whether a host is listening: it is
// always true. Only the user agent identifies the container. The platform API
// is still called either way -- inside the app it is the only correct action --
// and outside it the store link is opened as well, so a browser review sees the
// CTA work.
const IN_APP_CONTAINER_PATTERN = /(?:TikTok|musical_ly|trill_|BytedanceWebview|Pangle|pangolin)/iu;

function isInAppContainer() {
  if (typeof navigator === 'undefined') return false;
  return IN_APP_CONTAINER_PATTERN.test(String(navigator.userAgent ?? ''));
}

export const createPlatformBridge = createBasicBridge(
  PLAYABLE_PLATFORM,
  ({ ios, android } = {}) => {
    const url = ios || android;
    let nativeCallIssued = false;
    if (typeof window.playableSDK?.openAppStore === 'function') {
      window.playableSDK.openAppStore();
      nativeCallIssued = true;
    } else if (typeof window.openAppStore === 'function') {
      window.openAppStore();
      nativeCallIssued = true;
    }
    if (nativeCallIssued && isInAppContainer()) return true;
    // No native API at all, or a browser that would swallow the SDK call.
    if (openBrowserStorePreview(url)) return true;
    return nativeCallIssued;
  }
);
