export const PLAYABLE_PLATFORM = 'applovin';

const EVENTS = Object.freeze({
  loading: 'LOADING',
  loaded: 'LOADED',
  displayed: 'DISPLAYED',
  challenge: 'CHALLENGE_STARTED',
  pass25: 'CHALLENGE_PASS_25',
  pass50: 'CHALLENGE_PASS_50',
  pass75: 'CHALLENGE_PASS_75',
  solved: 'CHALLENGE_SOLVED',
  failed: 'CHALLENGE_FAILED',
  retry: 'CHALLENGE_RETRY',
  end: 'ENDCARD_SHOWN',
  cta: 'CTA_CLICKED'
});

// Axon already treats CHALLENGE_SOLVED as terminal: once the challenge is
// solved, later start/fail/retry/progress events would corrupt the solve rate.
const SOLVED_SUPPRESSED = new Set([
  EVENTS.challenge, EVENTS.pass25, EVENTS.pass50, EVENTS.pass75, EVENTS.failed, EVENTS.retry
]);
const PROGRESS_MILESTONES = Object.freeze([
  Object.freeze({ percent: 25, event: EVENTS.pass25 }),
  Object.freeze({ percent: 50, event: EVENTS.pass50 }),
  Object.freeze({ percent: 75, event: EVENTS.pass75 })
]);
// Keep the pre-fired CHALLENGE_STARTED ahead of CTA_CLICKED in the host event
// stream so a no-play CTA click still lands inside the challenge funnel.
const CTA_PRE_START_DELAY_MS = 200;

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
  if (typeof window === 'undefined') return;
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
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  link.hidden = true;
  document.body?.append(link);
  link.click();
  setTimeout(() => link.remove?.(), 0);
  return true;
}

export function createPlatformBridge({ onStart, onVisibilityChange = () => {} } = {}) {
  if (typeof onStart !== 'function') throw new TypeError('createPlatformBridge requires onStart.');
  let started = false;
  let ready = false;
  let viewable = false;
  let loaded = false;
  let challenged = false;
  let solved = false;
  let ended = false;
  const passedMilestones = new Set();
  const sendEvent = (eventName) => {
    if (solved && SOLVED_SUPPRESSED.has(eventName)) return;
    if (eventName === EVENTS.solved) {
      if (solved) return;
      solved = true;
    }
    if (eventName === EVENTS.challenge) challenged = true;
    if (eventName === EVENTS.cta && !challenged) {
      sendEvent(EVENTS.challenge);
      setTimeout(() => sendEvent(EVENTS.cta), CTA_PRE_START_DELAY_MS);
      return;
    }
    track(eventName);
  };
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
      sendEvent(EVENTS.challenge);
    },
    challengeProgress(percent) {
      const value = Number(percent);
      if (!Number.isFinite(value)) return;
      const reached = PROGRESS_MILESTONES.filter(({ percent: milestone }) => value >= milestone);
      if (reached.length === 0) return;
      if (!challenged) sendEvent(EVENTS.challenge);
      for (const { event } of reached) {
        if (passedMilestones.has(event)) continue;
        passedMilestones.add(event);
        sendEvent(event);
      }
    },
    challengeSolved() {
      sendEvent(EVENTS.solved);
    },
    challengeFailed() {
      sendEvent(EVENTS.failed);
    },
    end() {
      if (ended) return;
      ended = true;
      track(EVENTS.end);
    },
    retry() {
      ended = false;
      sendEvent(EVENTS.retry);
    },
    openStore({ ios, android } = {}) {
      sendEvent(EVENTS.cta);
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
