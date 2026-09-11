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
  }
  if (event.type === 'hidden-vehicle-revealed') {
    keys.push({ name: 'hidden_vehicle_reveal', key: `${event.type}:${event.vehicleId}` });
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
    this.unlocked = false;
    this.visible = true;
    this.buffers = new Map();
    this.playedGameEventKeys = new Set();
    this.queuedPlays = [];
    this.activeSources = new Set();
  }

  getContext() {
    if (this.context) return this.context;
    if (!this.unlocked) return null;
    const AudioContextClass = globalThis.AudioContext ?? globalThis.webkitAudioContext;
    if (!AudioContextClass) return null;
    this.context = new AudioContextClass();
    return this.context;
  }

  unlock() {
    this.unlocked = true;
    const context = this.getContext();
    if (!context) return;
    if (!this.visible) return;
    if (context.state === 'suspended') {
      void context.resume().then(() => this.flushQueuedPlays());
    } else {
      this.flushQueuedPlays();
    }
    this.preload();
  }

  preload() {
    const pending = [];
    for (const [name, data] of Object.entries(this.audioConfig)) {
      for (const clip of data.clips ?? []) {
        pending.push(this.loadClip(clip).catch((error) => {
          console.warn(`Unable to preload audio "${name}".`, error);
          return null;
        }));
      }
    }
    return Promise.all(pending);
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
    void bufferPromise.catch(() => {
      if (this.buffers.get(url) === bufferPromise) this.buffers.delete(url);
    });
    return bufferPromise;
  }

  play(name, clipOverride = null) {
    const data = this.audioConfig[name];
    const clip = clipOverride ?? chooseClip(data?.clips);
    if (!clip || !data) return;
    if (!this.unlocked || !this.visible) {
      this.queuedPlays.push({ name, clip });
      return;
    }
    const context = this.getContext();
    if (!context || context.state !== 'running') {
      this.queuedPlays.push({ name, clip });
      if (context?.state === 'suspended') void context.resume().then(() => this.flushQueuedPlays());
      return;
    }
    this.startPlayback(name, clip, data, context);
  }

  setVisible(visible) {
    this.visible = Boolean(visible);
    const context = this.context;
    if (!context) return;
    if (!this.visible) {
      if (context.state === 'running') void context.suspend?.();
      return;
    }
    if (this.unlocked && context.state === 'suspended') {
      void context.resume().then(() => this.flushQueuedPlays());
    }
  }

  flushQueuedPlays() {
    if (!this.queuedPlays.length) return;
    const pending = this.queuedPlays.splice(0);
    for (const { name, clip } of pending) this.play(name, clip);
  }

  startPlayback(name, clip, data, context) {
    void this.loadClip(clip)
      .then((buffer) => {
        if (!buffer || context.state !== 'running') return;
        const source = context.createBufferSource();
        const gain = context.createGain();
        source.buffer = buffer;
        gain.gain.value = data.volume ?? 1;
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
