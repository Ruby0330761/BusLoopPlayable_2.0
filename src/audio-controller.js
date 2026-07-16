const AUDIO_EVENT_NAMES = Object.freeze({
  'vehicle-collision-contact': 'bus_hit',
  'vehicle-full': 'bus_full'
});

function chooseClip(clips) {
  if (!clips?.length) return null;
  return clips.length === 1 ? clips[0] : clips[Math.floor(Math.random() * clips.length)];
}

function getEventKey(event, time = '') {
  if (!event?.type) return '';
  const timeKey = Number.isFinite(time) ? time.toFixed(3) : time;
  if (event.type === 'vehicle-collision-contact') {
    return `${event.type}:${event.vehicleId}:${event.targetId}:${timeKey}`;
  }
  if (event.type === 'vehicle-full') return `${event.type}:${event.vehicleId}:${timeKey}`;
  return '';
}

export class GameAudioController {
  constructor(audioConfig = {}) {
    this.audioConfig = audioConfig;
    this.context = null;
    this.buffers = new Map();
    this.lastGameEventKey = '';
  }

  getContext() {
    if (this.context) return this.context;
    const AudioContextClass = globalThis.AudioContext ?? globalThis.webkitAudioContext;
    if (!AudioContextClass) return null;
    this.context = new AudioContextClass();
    return this.context;
  }

  unlock() {
    const context = this.getContext();
    if (!context) return;
    if (context.state === 'suspended') void context.resume();
    this.preload();
  }

  preload() {
    for (const data of Object.values(this.audioConfig)) {
      for (const clip of data.clips ?? []) void this.loadClip(clip);
    }
  }

  loadClip(url) {
    if (this.buffers.has(url)) return this.buffers.get(url);
    const context = this.getContext();
    if (!context) return Promise.resolve(null);
    const bufferPromise = fetch(url)
      .then((response) => {
        if (!response.ok) throw new Error(`Audio request failed: ${response.status}`);
        return response.arrayBuffer();
      })
      .then((data) => context.decodeAudioData(data));
    this.buffers.set(url, bufferPromise);
    return bufferPromise;
  }

  play(name) {
    const data = this.audioConfig[name];
    const clip = chooseClip(data?.clips);
    const context = this.getContext();
    if (!clip || !context) return;
    if (context.state === 'suspended') void context.resume();
    void this.loadClip(clip)
      .then((buffer) => {
        if (!buffer || context.state !== 'running') return;
        const source = context.createBufferSource();
        const gain = context.createGain();
        source.buffer = buffer;
        gain.gain.value = data.volume ?? 1;
        source.connect(gain).connect(context.destination);
        source.start();
      })
      .catch((error) => console.warn(`Unable to play audio "${name}".`, error));
  }

  handleGameEvent(event, time = '') {
    const name = AUDIO_EVENT_NAMES[event?.type];
    if (!name) return;
    const key = getEventKey(event, time);
    if (key && key === this.lastGameEventKey) return;
    this.lastGameEventKey = key;
    this.play(name);
  }

  playPassengerUp() {
    this.play('passenger_up');
  }
}

export function createGameAudioController(audioConfig) {
  return new GameAudioController(audioConfig);
}
