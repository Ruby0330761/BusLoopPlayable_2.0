const MIN_INTERVAL_SECONDS = 5;
const MAX_INTERVAL_SECONDS = 30;

function clampInterval(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number)
    ? Math.max(MIN_INTERVAL_SECONDS, Math.min(MAX_INTERVAL_SECONDS, number))
    : fallback;
}

function clampVolume(value, fallback = 1) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.min(1, number)) : fallback;
}

function getInterval(config) {
  const min = clampInterval(config?.minIntervalSeconds, MIN_INTERVAL_SECONDS);
  const max = Math.max(min, clampInterval(config?.maxIntervalSeconds, MAX_INTERVAL_SECONDS));
  return min + Math.random() * (max - min);
}

export const RANDOM_PLAYABLE_AUDIO_CLIPS = Object.freeze([
  Object.freeze({ key: 'policeRing', audioName: 'random_playable_audio_police_ring' }),
  Object.freeze({ key: 'move', audioName: 'random_playable_audio_move' }),
  Object.freeze({ key: 'heyMoveIt', audioName: 'random_playable_audio_hey_move_it' })
]);

export class RandomPlayableAudioScheduler {
  constructor({ getConfig, play, now = () => performance.now() } = {}) {
    this.getConfig = getConfig ?? (() => ({}));
    this.play = play ?? (() => {});
    this.now = now;
    this.active = false;
    this.stopped = false;
    this.nextPlayAt = null;
    this.previousClipIndex = -1;
  }

  reset() {
    this.active = false;
    this.stopped = false;
    this.nextPlayAt = null;
    this.previousClipIndex = -1;
  }

  activate(now = this.now()) {
    if (this.stopped || this.active || !this.getConfig()?.enabled) return false;
    this.active = true;
    this.nextPlayAt = now + getInterval(this.getConfig()) * 1000;
    return true;
  }

  stop() {
    this.stopped = true;
    this.active = false;
    this.nextPlayAt = null;
  }

  chooseClipIndex() {
    const clipCount = RANDOM_PLAYABLE_AUDIO_CLIPS.length;
    if (clipCount < 2) return 0;
    const index = Math.floor(Math.random() * clipCount);
    if (index !== this.previousClipIndex || this.previousClipIndex < 0) return index;
    return (index + 1) % clipCount;
  }

  update(now = this.now()) {
    const config = this.getConfig() ?? {};
    if (!config.enabled || this.stopped || !this.active || this.nextPlayAt == null || now < this.nextPlayAt) {
      return false;
    }
    const index = this.chooseClipIndex();
    const clip = RANDOM_PLAYABLE_AUDIO_CLIPS[index];
    const masterVolume = clampVolume(config.masterVolume, 1);
    const clipVolume = clampVolume(config[`${clip.key}Volume`], 1);
    this.play(clip, masterVolume * clipVolume);
    this.previousClipIndex = index;
    this.nextPlayAt = now + getInterval(config) * 1000;
    return true;
  }
}
