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
    keys.push({ name: 'vehicle_tap', key: `${event.type}:${event.vehicleId}:${event.dispatchedAt ?? timeKey}` });
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
      keys.push({ name: 'garage_out', key: `garage-out:${vehicleId}`, releasedId: vehicleId });
    }
  }
  if (event.garageClearedIds?.length) {
    for (const garageId of event.garageClearedIds) {
      keys.push({ name: 'garage_clear', key: `garage-clear:${garageId}`, garageId });
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
    // Device volume reported by the ad host (0..1). Ad checkers mute the device
    // and expect the Web Audio graph to go silent; a suspended context is not
    // enough there because the host may restore it, so every route goes through
    // one master gain that this value drives.
    this.deviceVolume = 1;
    this.master = null;
    this.buffers = new Map();
    this.playedGameEventKeys = new Set();
    this.queuedPlays = [];
    this.activeSources = new Set();
    this.garageCues = new Map();
    // Named looping beds (countdown siren) keyed by purpose. The looping music
    // source stays separate in `bgm` because retry/stage changes must not touch it.
    this.loops = new Map();
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

  play(name, clipOverride = null, signal = null) {
    const data = this.audioConfig[name];
    const clip = clipOverride ?? chooseClip(data?.clips);
    if (!clip || !data) return;
    if (!this.unlocked || !this.visible) {
      if (signal) return;
      this.queuedPlays.push({ name, clip });
      return;
    }
    const context = this.getContext();
    if (!context || context.state !== 'running') {
      if (signal) return;
      this.queuedPlays.push({ name, clip });
      if (context?.state === 'suspended') void context.resume().then(() => this.flushQueuedPlays());
      return;
    }
    const delay = Math.max(0, Number(this.getDelay?.(name)) || 0);
    this.startPlayback(name, clip, data, context, delay, signal);
  }

  // Every source in this controller connects here instead of straight to the
  // destination. One node is what makes "silent" a hard guarantee: a checker
  // that mutes the device (or an audit that hides the ad) can be answered by
  // zeroing this gain even before the context finishes suspending, and no
  // individually scheduled clip can route around it.
  getMasterGain(context) {
    if (this.master) return this.master;
    const master = context.createGain();
    // Built after the ad was already hidden, the bus must start silent; a
    // context created later never sees the earlier setVisible(false).
    master.gain.value = this.visible ? this.deviceVolume : 0;
    master.connect(context.destination);
    this.master = master;
    return master;
  }

  /**
   * The ad host's device volume, 0..1.
   *
   * AppLovin (MRAID) reports 0-100 through `audioVolumeChange` and
   * `getAudioVolume()`; the bridge converts that to a ratio before calling here.
   * Anything non-numeric keeps the previous level rather than muting the ad,
   * because a malformed host event must not look like a deliberate mute.
   */
  setDeviceVolume(level) {
    const parsed = Number(level);
    this.deviceVolume = Number.isFinite(parsed)
      ? Math.max(0, Math.min(1, parsed))
      : 1;
    if (this.visible) this.applyMasterVolume(this.deviceVolume, { immediate: this.deviceVolume === 0 });
  }

  // One writer for the master gain, so the device volume and the visibility
  // mute cannot fight each other (a restore to 1 while hidden must stay silent).
  //
  // Muting is a hard cut, not a ramp: an audit samples the output while it
  // claims to be silent, and `setTargetAtTime` only approaches zero
  // asymptotically (it still reports a non-zero peak several samples later).
  // Un-muting ramps back so the player does not hear a click.
  applyMasterVolume(level, { immediate = false } = {}) {
    const master = this.master;
    if (!master) return;
    const target = Math.max(0, Math.min(1, Number(level) || 0));
    const now = master.context?.currentTime ?? 0;
    try {
      master.gain.cancelScheduledValues(now);
      if (immediate || target === 0) {
        master.gain.setValueAtTime(target, now);
      } else {
        master.gain.setValueAtTime(Number(master.gain.value) || 0, now);
        master.gain.linearRampToValueAtTime(target, now + 0.03);
      }
    } catch {
      master.gain.value = target;
    }
  }

  setVisible(visible) {
    this.visible = Boolean(visible);
    const context = this.context;
    if (!context) return;
    if (!this.visible) {
      // Suspend alone is not a hard guarantee: a host can resume the context
      // itself, and the audit samples an analyser rather than the context state.
      // Zeroing the master gain first makes the graph silent in the same tick,
      // and suspend then stops the clock so nothing is consumed while hidden.
      this.applyMasterVolume(0, { immediate: true });
      if (context.state === 'running') void context.suspend?.();
      return;
    }
    this.applyMasterVolume(this.deviceVolume);
    if (this.unlocked && context.state === 'suspended') {
      void context.resume().then(() => this.flushQueuedPlays());
    }
  }

  flushQueuedPlays() {
    if (!this.queuedPlays.length) return;
    const pending = this.queuedPlays.splice(0);
    for (const { name, clip } of pending) this.play(name, clip);
  }

  startPlayback(name, clip, data, context, delaySeconds = 0, signal = null) {
    void this.loadClip(clip)
      .then((buffer) => {
        if (!buffer || context.state !== 'running' || signal?.aborted) return;
        const source = context.createBufferSource();
        const gain = context.createGain();
        source.buffer = buffer;
        // A missing or non-numeric scale keeps the authored volume: Number()
        // turns undefined into NaN, which would otherwise silence the clip.
        const scale = Number(this.getVolumeScale?.(name));
        const baseVolume = Number(data.volume ?? 1);
        gain.gain.value = Math.max(0, baseVolume * (Number.isFinite(scale) ? scale : 1));
        source.connect(gain).connect(this.getMasterGain(context));
        this.activeSources.add(source);
        const stop = () => source.stop();
        signal?.addEventListener('abort', stop, { once: true });
        source.onended = () => {
          signal?.removeEventListener('abort', stop);
          this.activeSources.delete(source);
        };
        // A positive delay schedules the start slightly ahead on the audio
        // clock so a sound can be lined up with its animation.
        source.start(delaySeconds > 0 ? context.currentTime + delaySeconds : 0);
      })
      .catch((error) => console.warn(`Unable to play audio "${name}".`, error));
  }

  handleGameEvent(event, time = '', vehicles = []) {
    const keys = getEventKeys(event, time);
    for (const { name, key, releasedId, garageId } of keys) {
      const eventKey = `${name}:${key}`;
      if (this.playedGameEventKeys.has(eventKey)) continue;
      this.playedGameEventKeys.add(eventKey);
      if (name === 'vehicle_tap') {
        const fromGarage = vehicles.find(vehicle => vehicle.id === event.vehicleId)?.garageId;
        this.garageCues.get(fromGarage)?.abort();
        this.garageCues.delete(fromGarage);
      }
      const garage = releasedId != null ? vehicles.find(vehicle => vehicle.id === releasedId)?.garageId : garageId;
      if (garage != null) {
        // Door animation and replenishment can overlap the previous car's trip.
        if (vehicles.some(vehicle => vehicle.garageId === garage && vehicle.state === 'moving-to-spot')) continue;
        if (!this.garageCues.has(garage)) this.garageCues.set(garage, new AbortController());
        this.play(name, null, this.garageCues.get(garage).signal);
        continue;
      }
      this.play(name);
    }
  }

  resetEventHistory() {
    for (const cue of this.garageCues.values()) cue.abort();
    this.garageCues.clear();
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
   * Starts (or keeps) a named loop, such as the countdown siren.
   *
   * Loops live outside `audioConfig` for the same reason as BGM: that table is
   * preloaded on unlock, while a loop is only needed while its owner is active.
   * Each name owns one gain/source pair, so distinct loops can play together
   * without either one stopping the other.
   *
   * Called every frame by the countdown owner, so it must be idempotent and
   * silent when audio is still locked; the next call retries.
   */
  playLoop(name, { asset, volume = 0.4, fadeInSeconds = 0.25 } = {}) {
    if (!name || !asset) return false;
    const existing = this.loops.get(name);
    if (existing?.asset === asset) return true;
    if (!this.unlocked || !this.visible) return false;
    const context = this.getContext();
    if (!context || context.state !== 'running') return false;
    this.stopLoop(name);
    const gain = context.createGain();
    const target = Math.max(0, Math.min(1, Number(volume) || 0));
    const fade = Math.max(0, Number(fadeInSeconds) || 0);
    gain.gain.value = fade > 0 ? 0 : target;
    gain.connect(this.getMasterGain(context));
    const source = context.createBufferSource();
    source.loop = true;
    const entry = { asset, source, gain, volume: target };
    // Registered before the buffer resolves so stopLoop can cancel a loop that
    // is still decoding instead of letting it start afterwards.
    this.loops.set(name, entry);
    void this.loadClip(asset)
      .then((buffer) => {
        if (!buffer || this.loops.get(name) !== entry) return;
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
        console.warn(`Unable to start looping audio "${name}".`, error);
        if (this.loops.get(name) === entry) this.loops.delete(name);
      });
    return true;
  }

  stopLoop(name) {
    const entry = this.loops?.get(name);
    if (!entry) return;
    this.loops.delete(name);
    try { entry.source.stop(); } catch {}
    try {
      entry.source.disconnect();
      entry.gain.disconnect();
    } catch {}
  }

  stopAllLoops() {
    for (const name of [...(this.loops?.keys() ?? [])]) this.stopLoop(name);
  }

  isLoopPlaying(name) {
    return Boolean(this.loops?.has(name));
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
    gain.connect(this.getMasterGain(context));
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
