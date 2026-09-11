export const PLAYABLE_PLATFORM = 'applovin';

const EVENTS = Object.freeze({
  loading: 'LOADING',
  loaded: 'LOADED',
  displayed: 'DISPLAYED',
  challenge: 'CHALLENGE_STARTED',
  end: 'ENDCARD_SHOWN',
  cta: 'CTA_CLICKED'
});

function safely(operation, warning) {
  try {
    operation();
    return true;
  } catch (error) {
    console.warn(warning, error);
    return false;
  }
}

function track(eventName) {
  if (typeof window.ALPlayableAnalytics?.trackEvent !== 'function') return;
  safely(() => window.ALPlayableAnalytics.trackEvent(eventName), `AppLovin event ${eventName} failed.`);
}

function openBrowserPreview(url) {
  const protocol = window.location?.protocol;
  if (
    !['file:', 'http:', 'https:'].includes(protocol)
    || typeof document === 'undefined'
    || typeof document.createElement !== 'function'
  ) return false;
  const link = document.createElement('a');
  link.href = url;
  link.rel = 'noopener noreferrer';
  link.click();
  return true;
}

export function createPlatformBridge({ onStart, onVisibilityChange = () => {} } = {}) {
  if (typeof onStart !== 'function') throw new TypeError('createPlatformBridge requires onStart.');
  let started = false;
  let ready = false;
  let viewable = false;
  let loaded = false;
  let challenged = false;
  let ended = false;
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
      track(EVENTS.loading);
      if (!window.mraid || typeof window.mraid.getState !== 'function' || typeof window.mraid.addEventListener !== 'function') {
        ready = true;
        viewable = true;
        onVisibilityChange(true);
        start();
        return;
      }
      window.mraid.addEventListener('viewableChange', handleViewableChange);
      if (window.mraid.getState() === 'loading') window.mraid.addEventListener('ready', handleReady);
      else handleReady();
    },
    ready() {
      if (loaded) return;
      loaded = true;
      track(EVENTS.loaded);
      track(EVENTS.displayed);
    },
    challenge() {
      if (challenged) return;
      challenged = true;
      track(EVENTS.challenge);
    },
    end() {
      if (ended) return;
      ended = true;
      track(EVENTS.end);
    },
    retry() { ended = false; },
    openStore({ ios, android } = {}) {
      track(EVENTS.cta);
      const url = ios || android;
      if (typeof window.mraid?.open === 'function') {
        window.mraid.open(url);
        return true;
      }
      if (openBrowserPreview(url)) return true;
      if (import.meta.env?.DEV === true) {
        window.location.assign(url);
        return true;
      }
      throw new Error('AppLovin MRAID CTA is unavailable outside the development preview.');
    }
  });
}
