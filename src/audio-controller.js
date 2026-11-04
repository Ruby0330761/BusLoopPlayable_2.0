function chooseClip(clips) {
  if (!clips?.length) return null;
  return clips.length === 1 ? clips[0] : clips[Math.floor(Math.random() * clips.length)];
}

function getEventKeys(event, time = '') {
  if (!event?.type && !event?.turnVehicleIds?.length) return [];
  const timeKey = Number.isFinite(time) ? time.toFixed(3) : time;
  const keys = [];
  if (event.type === 'vehicle-collision-contact') {
    // `lastEvent` keeps pointing at the contact while the bump animates, and the
    // level clock advances every frame, so a time-based key re-fires the hit for
    // the whole animation (measured: two plays 10 ms apart for one collision).
    // The model stamps a monotonic id per contact; fall back to the vehicle pair
    // only for a source that predates that field.
    const identity = event.collisionEventId ?? `${event.vehicleId}:${event.targetId}`;
    keys.push({ name: 'bus_hit', key: `${event.type}:${identity}` });
  }
  if (event.type === 'vehicle-dispatched') {
    keys.push({ name: 'vehicle_tap', key: `${event.type}:${event.vehicleId}:${timeKey}` });
  }
  if (event.type === 'vehicle-full') {
    // lastEvent remains visible while the vehicle is driving away. The event
    // identity must therefore be independent of the frame time.
    keys.push({ name: 'bus_full', key: `${event.type}:${event.vehicleId}` });
  }
  if (event.type === 'hidden-vehicle-reveal-started') {
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
  constructor(audioConfig = {}, { getDelay = null, getVolumeScale = null } = {}) {
    this.audioConfig = audioConfig;
    this.getDelay = typeof getDelay === 'function' ? getDelay : null;
    // Per-sound volume control from the editor. It scales the level baked into
    // the level's audio config instead of replacing it, so the Unity-authored
    // balance still applies when the editor slider sits at 1.
    this.getVolumeScale = typeof getVolumeScale === 'function' ? getVolumeScale : null;
    this.context = null;
    this.unlocked = false;
    this.visible = true;
    this.buffers = new Map();
    this.playedGameEventKeys = new Set();
    this.queuedPlays = [];
    this.activeSources = new Set();
    // The looping music source is tracked separately from the effect pool.
    this.bgm = null;
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
    const delay = Math.max(0, Number(this.getDelay?.(name)) || 0);
    this.startPlayback(name, clip, data, context, delay);
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

  startPlayback(name, clip, data, context, delaySeconds = 0) {
    void this.loadClip(clip)
      .then((buffer) => {
        if (!buffer || context.state !== 'running') return;
        const source = context.createBufferSource();
        const gain = context.createGain();
        source.buffer = buffer;
        // A missing or non-numeric scale keeps the authored volume: Number()
        // turns undefined into NaN, which would otherwise silence the clip.
        const scale = Number(this.getVolumeScale?.(name));
        const baseVolume = Number(data.volume ?? 1);
        gain.gain.value = Math.max(0, baseVolume * (Number.isFinite(scale) ? scale : 1));
        source.connect(gain).connect(context.destination);
        this.activeSources.add(source);
        source.onended = () => this.activeSources.delete(source);
        // A positive delay schedules the start slightly ahead on the audio
        // clock so a sound can be lined up with its animation.
        source.start(delaySeconds > 0 ? context.currentTime + delaySeconds : 0);
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

  /**
   * Starts the looping background track.
   *
   * The track is kept out of `audioConfig` on purpose: that table is preloaded
   * and decoded on unlock for the one-shot effects, and a ~120 KB music file has
   * no business being decoded before the player has tapped anything. It is also
   * a separate source from the effect pool so `resetEventHistory` (retry, stage
   * advance) does not restart or kill it.
   *
   * Returns false when nothing started (no asset, audio still locked, or the
   * context is not running). Callers should not retry in a loop; the next tap
   * calls it again.
   */
  playBgm({ asset, volume = 0.5, fadeInSeconds = 0.8 } = {}) {
    if (!asset) return false;
    if (this.bgm?.asset === asset) return true;
    if (!this.unlocked || !this.visible) return false;
    const context = this.getContext();
    if (!context || context.state !== 'running') return false;
    this.stopBgm();
    const gain = context.createGain();
    const target = Math.max(0, Math.min(1, Number(volume) || 0));
    const fade = Math.max(0, Number(fadeInSeconds) || 0);
    gain.gain.value = fade > 0 ? 0 : target;
    gain.connect(context.destination);
    const source = context.createBufferSource();
    source.loop = true;
    const entry = { asset, source, gain, volume: target };
    // Registered before the buffer resolves so stopBgm can cancel a track that
    // is still decoding.
    this.bgm = entry;
    void this.loadClip(asset)
      .then((buffer) => {
        if (!buffer || this.bgm !== entry) return;
        source.buffer = buffer;
        source.connect(gain);
        source.start();
        if (fade > 0) {
          const now = context.currentTime;
          gain.gain.setValueAtTime(0, now);
          gain.gain.linearRampToValueAtTime(target, now + fade);
        }
      })
      .catch((error) => {
        console.warn('Unable to start background music.', error);
        if (this.bgm === entry) this.bgm = null;
      });
    return true;
  }

  stopBgm() {
    const entry = this.bgm;
    if (!entry) return;
    this.bgm = null;
    try { entry.source.stop(); } catch {}
    try {
      entry.source.disconnect();
      entry.gain.disconnect();
    } catch {}
  }

  get isBgmPlaying() {
    return Boolean(this.bgm);
  }
}

export function createGameAudioController(audioConfig, options) {
  return new GameAudioController(audioConfig, options);
}
