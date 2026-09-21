import { gunzipSync } from 'three/addons/libs/fflate.module.js';

function decodeOptionalGzip(buffer) {
  const bytes = buffer instanceof Uint8Array
    ? buffer
    : new Uint8Array(buffer);
  if (bytes[0] !== 0x1f || bytes[1] !== 0x8b) return bytes;
  return gunzipSync(bytes);
}

function chooseClip(clips) {
  if (!clips?.length) return null;
  return clips.length === 1 ? clips[0] : clips[Math.floor(Math.random() * clips.length)];
}

function getEventKeys(event, time = '') {
  if (!event?.type && !event?.turnVehicleIds?.length) return [];
  const timeKey = Number.isFinite(time) ? time.toFixed(3) : time;
  const keys = [];
  if (event.type === 'vehicle-collision-contact') {
    keys.push({ name: 'bus_hit', key: `${event.type}:${event.vehicleId}:${event.targetId}:${timeKey}` });
  }
  if (event.type === 'vehicle-full') {
    // lastEvent remains visible while the vehicle is driving away. The event
    // identity must therefore be independent of the frame time.
    keys.push({ name: 'bus_full', key: `${event.type}:${event.vehicleId}` });
    if (event.policeVehicle) {
      keys.push({ name: 'police_siren', key: `${event.type}:${event.vehicleId}` });
    }
  }
  if (event.type === 'hidden-vehicle-reveal-started' || event.type === 'hidden-vehicle-revealed') {
    keys.push({ name: 'hidden_vehicle_reveal', key: 'hidden-vehicle-reveal:' + event.vehicleId });
  }
  if (event.type === 'firetruck-countdown-started') {
    keys.push({ name: 'firetruck_start', key: event.type });
  }
  if (event.type === 'lose' && event.reason === 'firetruck-timeout') {
    keys.push({ name: 'firetruck_fail', key: event.type });
  }
  if (event.ambulanceUpdates?.some((entry) => entry.remainingSteps <= 5)) {
    for (const entry of event.ambulanceUpdates) {
      if (entry.remainingSteps <= 5) {
        keys.push({
          name: 'ambulance_countdown',
          key: `ambulance:${entry.vehicleId}:${entry.remainingSteps}`
        });
      }
    }
  }
  if (event.turnVehicleIds?.length) {
    if (Number.isInteger(event.turnVehicleEventId)) {
      keys.push({ name: 'turn_vehicle_complete', key: `turn:${event.turnVehicleEventId}` });
    } else {
      for (const vehicleId of event.turnVehicleIds) {
        keys.push({ name: 'turn_vehicle_complete', key: `turn:${vehicleId}` });
      }
    }
  }
  if (event.garageReleasedVehicleIds?.length) {
    for (const vehicleId of event.garageReleasedVehicleIds) {
      keys.push({ name: 'garage_out', key: `garage-out:${vehicleId}` });
    }
  }
  if (event.garageClearedIds?.length) {
    for (const garageId of event.garageClearedIds) {
      keys.push({ name: 'garage_clear', key: `garage-clear:${garageId}` });
    }
  }
  return keys;
}

export class GameAudioController {
  constructor(audioConfig = {}) {
    this.audioConfig = audioConfig;
    this.context = null;
    this.buffers = new Map();
    this.playedGameEventKeys = new Set();
    this.queuedPlays = [];
    this.activeSources = new Set();
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
    if (context.state === 'suspended') {
      void context.resume().then(() => this.flushQueuedPlays());
    } else {
      this.flushQueuedPlays();
    }
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
      .then((data) => {
        const bytes = decodeOptionalGzip(data);
        return context.decodeAudioData(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
      });
    this.buffers.set(url, bufferPromise);
    return bufferPromise;
  }

  play(name, clipOverride = null, volumeOverride = null) {
    const data = this.audioConfig[name];
    const clip = clipOverride ?? chooseClip(data?.clips);
    const context = this.getContext();
    if (!clip || !data) return;
    if (!context || context.state !== 'running') {
      this.queuedPlays.push({ name, clip, volumeOverride });
      if (context?.state === 'suspended') void context.resume().then(() => this.flushQueuedPlays());
      return;
    }
    this.startPlayback(name, clip, data, context, volumeOverride);
  }

  flushQueuedPlays() {
    if (!this.queuedPlays.length) return;
    const pending = this.queuedPlays.splice(0);
    for (const { name, clip, volumeOverride } of pending) this.play(name, clip, volumeOverride);
  }

  startPlayback(name, clip, data, context, volumeOverride = null) {
    void this.loadClip(clip)
      .then((buffer) => {
        if (!buffer || context.state !== 'running') return;
        const source = context.createBufferSource();
        const gain = context.createGain();
        source.buffer = buffer;
        gain.gain.value = volumeOverride ?? data.volume ?? 1;
        source.connect(gain).connect(context.destination);
        this.activeSources.add(source);
        source.onended = () => this.activeSources.delete(source);
        source.start();
      })
      .catch((error) => console.warn(`Unable to play audio "${name}".`, error));
  }

  handleGameEvent(event, time = '') {
    const keys = getEventKeys(event, time);
    for (const { name, key } of keys) {
      const eventKey = `${name}:${key}`;
      if (this.playedGameEventKeys.has(eventKey)) continue;
      this.playedGameEventKeys.add(eventKey);
      this.play(name);
    }
  }

  resetEventHistory() {
    this.playedGameEventKeys.clear();
    this.queuedPlays.length = 0;
    for (const source of this.activeSources) {
      try { source.stop(); } catch {}
      this.activeSources.delete(source);
    }
  }

  playPassengerUp() {
    this.play('passenger_up');
  }
}

export function createGameAudioController(audioConfig) {
  return new GameAudioController(audioConfig);
}
