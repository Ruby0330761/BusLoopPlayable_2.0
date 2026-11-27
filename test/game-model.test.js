import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import * as THREE from 'three';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { BusLoopGame } from '../src/game-model.js';
import { ACTIVE_LEVEL } from '../src/generated-active-level.js';
import { COLORS, LEVEL_1, setActiveLevel } from '../src/level-data.js';
import { LEVEL_CATALOG } from '../src/level-catalog.js';
import {
  CONVEYOR_LAYOUT_IDS,
  CONVEYOR_LAYOUTS,
  MAX_CONVEYOR_CAPACITY,
  MAX_QUEUE_CAPACITY
} from '../src/conveyor-layouts.js';
import { SCENE_TUNING } from '../src/scene-tuning.js';
import { createRoofArrowOutline, roofArrowStrokeRatio, updateRoofArrowOutline } from '../src/roof-arrow-outline.js';
import { getVehicleAreaPivot } from '../src/vehicle-area.js';
import { GameAudioController } from '../src/audio-controller.js';
import {
  DreamteckClosedBSplineCurve3,
  fitCountBoardFontSize,
  makeClosedConveyorCurve,
  shouldHideVehicleArrow,
  SceneView
} from '../src/scene-view.js';
import {
  buildOutStationPoints,
  buildRoundedPath,
  buildToStationPoints,
  chooseHitClip,
  getHitDirection,
  evaluatePath,
  evaluateUnityCurve,
  sampleHitClip
} from '../src/vehicle-motion.js';

const sceneViewSource = readFileSync(join('src', 'scene-view.js'), 'utf8');
const gameModelSource = readFileSync(join('src', 'game-model.js'), 'utf8');

test('vehicle arrows use the main-branch per-vehicle outline path, including visible edges', () => {
  const previous = { ...SCENE_TUNING.vehicleArrow };
  try {
    // A saved draft from the experimental branch must not hide the master's
    // individual shells or edges after migration.
    Object.assign(SCENE_TUNING.vehicleArrow, { instancedShells: 1, outlineEdgesEnabled: 0 });
    const arrow = new THREE.Group();
    const shell = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial());
    shell.userData.isArrowOutline = true;
    shell.userData.outlineBaseScale = new THREE.Vector3(1, 1, 1);
    const edge = new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineBasicMaterial());
    edge.userData.isArrowOutline = true;
    edge.userData.outlineBaseScale = new THREE.Vector3(1, 1, 1);
    for (const outline of [shell, edge]) {
      outline.userData.outlineBasePosition = outline.position.clone();
      outline.userData.outlineCenterOffset = new THREE.Vector3();
    }
    arrow.add(shell, edge);
    SceneView.prototype.applyVehicleArrowTuning.call({}, arrow, new THREE.Vector3(0.5, 0.5, 1));
    assert.equal(shell.visible, true);
    assert.equal(edge.visible, true);
    assert.equal(arrow.position.y, 0.5 + SCENE_TUNING.vehicleArrow.offsetY);
    assert.equal(shell.material.color.getHex(), SCENE_TUNING.vehicleArrow.outlineColor);
    assert.equal(shell.scale.x, SCENE_TUNING.vehicleArrow.outlineScale);
    assert.equal(SceneView.prototype.syncArrowShellBatch, undefined);
  } finally {
    delete SCENE_TUNING.vehicleArrow.instancedShells;
    delete SCENE_TUNING.vehicleArrow.outlineEdgesEnabled;
    Object.assign(SCENE_TUNING.vehicleArrow, previous);
  }
});

test('ordinary roof surfaces keep their original triangles and bounds', () => {
  const originalLoad = THREE.TextureLoader.prototype.load;
  THREE.TextureLoader.prototype.load = () => new THREE.Texture();
  try {
    for (const [seats, name] of [[4, 'Car'], [6, 'Van'], [10, 'Bus']]) {
      const packed = readFileSync(`public/assets/unity/models/${name}_001.fbx`);
      const bytes = packed[0] === 31 ? gunzipSync(packed) : packed;
      const source = new FBXLoader().parse(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '');
      const original = SceneView.prototype.prepareVehicleTemplate(source, seats);
      const changed = SceneView.prototype.prepareVehicleTemplate(source, seats, { passengerRoof: true, proceduralPaint: true });
      const roofs = changed.children.filter((mesh) => mesh.userData.isPassengerRoof);
      assert.ok(roofs.length, `${name} must have a roof`);
      assert.ok(original.userData.fittedSize.distanceTo(changed.userData.fittedSize) < 1e-8);
      const count = (root) => root.children.reduce((sum, mesh) => sum + (mesh.geometry.index?.count ?? mesh.geometry.attributes.position.count), 0);
      assert.equal(count(changed), count(original), `${name} must keep every triangle exactly once`);
      for (const mesh of original.children) {
        const body = changed.children.find((candidate) => candidate.name === mesh.name);
        assert.deepEqual(body.geometry.attributes.uv.array, mesh.geometry.attributes.uv.array);
        const swatch = body.geometry.getAttribute('vehicleSwatch');
        assert.equal(swatch.count, mesh.geometry.attributes.uv.count);
        const usedVertices = body.geometry.index?.count ?? swatch.count;
        for (let i = 0; i < usedVertices; i += 3) {
          const indices = [i, i + 1, i + 2].map(j => body.geometry.index?.getX(j) ?? j);
          const ids = indices.map(j => swatch.getX(j));
          assert.ok(ids.every(id => id === ids[0] && id < 16), `${body.name} triangle spans paint swatches`);
        }
        if (/wheel/i.test(mesh.name)) assert.equal(body.geometry.index?.count ?? body.geometry.attributes.position.count, mesh.geometry.attributes.position.count);
      }
      for (const mesh of roofs) {
        const { uv, normal, position } = mesh.geometry.attributes;
        const originalMesh = original.children.find((candidate) => `${candidate.name} Passenger Roof` === mesh.name);
        const bounds = originalMesh.geometry.boundingBox;
        const roofY = bounds.min.y + (bounds.max.y - bounds.min.y) * 0.72;
        assert.deepEqual(uv.array, originalMesh.geometry.attributes.uv.array);
        for (const index of mesh.geometry.index.array) {
          assert.ok(position.getY(index) >= roofY);
        }
        assert.deepEqual(normal.array, originalMesh.geometry.attributes.normal.array);
      }
    }
  } finally {
    THREE.TextureLoader.prototype.load = originalLoad;
  }
});

test('passenger material changes leave the vehicle roof at its authored colour', () => {
  const roof = new THREE.MeshBasicMaterial({ color: '#868d98', toneMapped: false });
  const view = {
    vehicleViews: new Map([[1, { userData: { roofMaterial: roof } }]]),
    passengerMaterials: [], passengerViews: [], queuePassengerViews: [], boardingViews: []
  };
  SceneView.prototype.updatePassengerMaterialTuning.call(view, { colorIndex: 0 });
  assert.equal(roof.color.getHexString(), '868d98');
  assert.equal(roof.map, null);
});

const advance = (game, seconds, step = .05) => {
  for (let time = 0; time < seconds; time += step) game.update(step);
};

const makeAmbulanceLevel = (vehicles) => {
  const level = structuredClone(LEVEL_CATALOG.level16);
  level.vehicles = vehicles;
  level.containers = [];
  level.vehicleDepthes = {};
  level.vehicleAmbulances = vehicles
    .filter((vehicle) => Number.isInteger(vehicle.ambulanceStepLimit))
    .map((vehicle) => ({ vid: vehicle.id, stepLimit: vehicle.ambulanceStepLimit }));
  level.passengerQueues = [[]];
  level.passengerSequence = [];
  level.queueCapacity = 0;
  level.conveyorCapacity = 1;
  level.spotCount = 6;
  return level;
};

const makeHiddenVehicleLevel = (overrides = {}) => ({
  id: 502,
  key: 'hiddenVehicleTest',
  mapScale: 1,
  groupSize: 4,
  spotCount: 6,
  conveyorCapacity: 1,
  conveyorSpeed: 0.5,
  conveyorPathLength: 1,
  queueCount: 1,
  queueCapacity: 0,
  entryPercents: [0],
  longPressThreshold: 0.2,
  longPressMultiplier: 3,
  exitStart: 0.6,
  exitEnd: 0.8,
  boardingDepartureDelay: 0.1,
  passengerQueue: { spacing: 0.4 },
  passengerEntryMotion: { passengerSpeed: 1 },
  vehicleSize: { width: 0.4, length: 0.8 },
  collision: {
    vehicleSizes: {
      4: { width: 0.4, length: 0.4 },
      6: { width: 0.4, length: 0.6 },
      10: { width: 0.4, length: 0.8 }
    },
    maxVehicleSize: { width: 0.4, length: 0.8 }
  },
  vehicleMotion: {
    spotStartX: -2,
    spotSpacing: 1,
    spotZ: 4,
    spotYaw: 0,
    spotApproachOffsetZ: 0,
    spotApproachDirection: 'screen-down'
  },
  containers: [{ id: 0, type: 1, x: 0, z: 0, yaw: 0 }],
  vehicles: [
    { id: 1, seats: 4, colorIndex: 0, x: 0, z: 0, yaw: 0, isHidden: true },
    { id: 2, seats: 4, colorIndex: 1, x: 0, z: 2, yaw: 0, isHidden: false }
  ],
  vehicleDepthes: { 1: [] },
  passengerSequence: [],
  passengerQueues: [[]],
  assets: { audio: {} },
  ...overrides
});

const makeConveyorVehicleLevel = (overrides = {}) => ({
  ...structuredClone(LEVEL_CATALOG.level5),
  id: 503,
  key: 'conveyorVehicleTest',
  spotCount: 3,
  conveyorCapacity: 1,
  queueCapacity: 0,
  conveyorSpeed: 0.4,
  conveyorPathLength: 1,
  entryPercents: [0],
  passengerQueues: [[]],
  passengerSequence: [],
  containers: [{ id: 4, type: 3, x: 0, z: 0, yaw: 0 }],
  vehicles: [
    { id: 1, seats: 4, colorIndex: 2, x: -1, z: 0, yaw: 0, containerType: 3, containerId: 4 },
    { id: 2, seats: 4, colorIndex: 2, x: 0, z: 0, yaw: 0, containerType: 3, containerId: 4 },
    { id: 3, seats: 4, colorIndex: 2, x: 1, z: 0, yaw: 0, containerType: 3, containerId: 4 }
  ],
  collision: {
    vehicleSizes: { 4: { width: 0.27, length: 0.47157902 } },
    maxVehicleSize: { width: 0.27, length: 0.47157902 },
    conveyor: { size: { width: 1.4, length: 1 }, exitWidth: 3.8, wallThickness: 0.02 }
  },
  ...overrides
});

const publicAssetExists = (url) => existsSync(join('public', url.replace(/^\//, '')));
const decodeOptionalGzipAsset = (bytes) => (
  bytes[0] === 0x1f && bytes[1] === 0x8b ? gunzipSync(bytes) : bytes
);

test('FBX and raw VAT resources are losslessly gzip-compressed', () => {
  const assets = [
    'public/assets/unity/models/Arrow_01.fbx',
    'public/assets/unity/models/Car_001.fbx',
    'public/assets/unity/models/Van_001.fbx',
    'public/assets/unity/models/Bus_001.fbx',
    'public/assets/unity/models/Idle_boy01.fbx',
    'public/assets/unity/models/Idle_boy01_vatmesh.bin',
    'public/assets/unity/models/Idle_boy01_anim_map.rgba16f',
    'public/assets/unity/mechanisms/ambulance/models/Ambulance_001.fbx',
    'public/assets/unity/mechanisms/ambulance/models/Idle_girl_rescuer.fbx',
    'public/assets/unity/mechanisms/ambulance/models/Idle_girl_rescuer_vatmesh.bin',
    'public/assets/unity/mechanisms/garage/models/Garage_Truck_01.fbx',
    'public/assets/unity/mechanisms/garage/models/Garage_Truck_01_FakeShadow.fbx',
    'public/assets/unity/mechanisms/luxury-vehicle/models/Idle_wealthy_vatmesh.bin',
    'public/assets/unity/mechanisms/vehicle-transport-belt/models/plane_conveyor.fbx',
    'public/assets/unity/mechanisms/vehicle-transport-belt/models/plane_conveyor_arrow.fbx'
  ];
  for (const asset of assets) {
    const bytes = readFileSync(asset);
    assert.deepEqual([...bytes.subarray(0, 2)], [0x1f, 0x8b], asset);
    assert.ok(decodeOptionalGzipAsset(bytes).byteLength > 0, asset);
  }
  assert.match(readFileSync('src/scene-view.js', 'utf8'), /decodeOptionalGzip/);
});

test('hidden vehicle resources are packed in compressed, editor-owned formats', () => {
  for (const asset of [
    'public/assets/unity/mechanisms/hidden-vehicle/models/car_01_c.fbx.bin',
    'public/assets/unity/mechanisms/hidden-vehicle/models/van_01_c.fbx.bin',
    'public/assets/unity/mechanisms/hidden-vehicle/models/bus_01_c.fbx.bin',
    'public/assets/unity/mechanisms/hidden-vehicle/models/questionmark.fbx.bin',
    'public/assets/unity/mechanisms/hidden-vehicle/textures/question_mark.png',
    'public/assets/unity/mechanisms/hidden-vehicle/audio/hidden_reveal.bin'
  ]) {
    assert.ok(existsSync(asset), asset);
  }
  for (const asset of [
    'public/assets/unity/mechanisms/hidden-vehicle/models/car_01_c.fbx.bin',
    'public/assets/unity/mechanisms/hidden-vehicle/models/van_01_c.fbx.bin',
    'public/assets/unity/mechanisms/hidden-vehicle/models/bus_01_c.fbx.bin',
    'public/assets/unity/mechanisms/hidden-vehicle/models/questionmark.fbx.bin'
  ]) {
    assert.deepEqual([...readFileSync(asset).subarray(0, 2)], [0x1f, 0x8b], asset);
  }
  const revealWav = readFileSync('public/assets/unity/mechanisms/hidden-vehicle/audio/hidden_reveal.bin');
  assert.equal(revealWav.toString('ascii', 0, 4), 'RIFF');
  assert.equal(revealWav.readUInt16LE(22), 1);
  assert.equal(revealWav.readUInt32LE(24), 16000);
  assert.equal(revealWav.readUInt16LE(34), 16);
});

test('hidden vehicle source wiring keeps the question marker out of picking', () => {
  const sceneSource = readFileSync(join('src', 'scene-view.js'), 'utf8');
  assert.match(sceneSource, /MECHANISM_ASSETS\.hiddenVehicle/);
  assert.match(sceneSource, /Unity's bus_hidden material is intentionally untextured black/);
  assert.match(sceneSource, /HIDDEN_VEHICLE_BODY_COLOR = 0x606060/);
  assert.match(sceneSource, /setMaterial\(hiddenCollisionModel, new THREE\.MeshStandardMaterial/);
  assert.match(sceneSource, /hiddenCollisionModel\.scale\.multiply\(new THREE\.Vector3\(/);
  assert.match(sceneSource, /createWhiteAlphaTexture/);
  assert.match(sceneSource, /map: this\.questionMarkTexture/);
  assert.match(sceneSource, /passengerVatGeometry,\s*passengerVatTexture,\s*vehicleTexture/);
  assert.match(sceneSource, /view\.userData\.pickMeshes = vehicle\.isHidden \? hiddenBodyMeshes : bodyMeshes/);
  assert.match(sceneSource, /view\.userData\.pickMeshes = vehicle\.hiddenRevealed \? view\.userData\.bodyMeshes : view\.userData\.hiddenBodyMeshes/);
  assert.match(sceneSource, /HIDDEN_QUESTION_MARK_FORWARD_FACTOR = 0\.45/);
  assert.match(sceneSource, /isHiddenQuestionMark: true/);
  assert.match(sceneSource, /hiddenQuestionOffset/);
  assert.match(sceneSource, /HIDDEN_REVEAL_MARKER_FADE_END/);
  assert.match(sceneSource, /HIDDEN_REVEAL_DURATION = 1/);
  assert.match(sceneSource, /HIDDEN_REVEAL_MARKER_FADE_START = 0\.5/);
  assert.match(sceneSource, /HIDDEN_REVEAL_MARKER_FADE_END = 1/);
  assert.match(sceneSource, /HIDDEN_REVEAL_ROOT_CURVES/);
  assert.match(sceneSource, /getHiddenRevealTuning/);
  assert.match(sceneSource, /SCENE_TUNING\.hiddenVehicleReveal/);
  assert.match(sceneSource, /revealTuning\.rootCurves\.position/);
  assert.match(sceneSource, /sampleRevealTrack\(position\.y, progress\) \* size\.y/);
  assert.match(sceneSource, /hiddenRevealRoot\.rotation\.set/);
  assert.match(sceneSource, /hiddenArrow\.position\.copy\(basePosition\)/);
  assert.doesNotMatch(sceneSource, /hiddenArrow\.position\.x -= size\.x/);
  assert.match(sceneSource, /normalRoot\.visible = normalBodyAlpha > 0\.001 \|\| normalArrowAlpha > 0\.001/);
  assert.match(sceneSource, /normalRoot\.position\.set\(0, 0, 0\)/);
  assert.match(sceneSource, /normalRoot\.scale\.set\(1, 1, 1\)/);
  assert.match(sceneSource, /toneMapped: false/);
  assert.match(sceneSource, /child\.userData\.isArrowOutline\s*\? \(child\.isLineSegments \? 31 : 29\)\s*:\s*30/);
  assert.match(sceneSource, /view\.userData\.hiddenRevealRoot = hiddenRevealRoot/);
  assert.match(sceneSource, /setObjectOpacity\(view\.userData\.hiddenRoot, hiddenArrowAlpha\)/);
  assert.match(sceneSource, /setObjectOpacity\(view\.userData\.hiddenModelRoot, hiddenModelAlpha\)/);
  assert.doesNotMatch(sceneSource, /modelRoot\.scale\.setScalar/);
});

test('hidden vehicle reveal audio is deduplicated per vehicle', () => {
  const played = [];
  const audio = new GameAudioController({
    hidden_vehicle_reveal: { clips: ['hidden-reveal'] }
  });
  audio.play = (name) => played.push(name);
  audio.handleGameEvent({ type: 'hidden-vehicle-reveal-started', vehicleId: 67 }, 1.25);
  audio.handleGameEvent({ type: 'hidden-vehicle-revealed', vehicleId: 67 }, 1.25);
  audio.handleGameEvent({ type: 'vehicle-full', vehicleId: 2 }, 1.26);
  audio.handleGameEvent({ type: 'hidden-vehicle-revealed', vehicleId: 67 }, 1.27);
  audio.handleGameEvent({ type: 'hidden-vehicle-reveal-started', vehicleId: 68 }, 1.25);
  assert.deepEqual(played, ['hidden_vehicle_reveal', 'bus_full', 'hidden_vehicle_reveal']);
});

test('vehicle tap audio fires once per dispatched vehicle', () => {
  const played = [];
  const audio = new GameAudioController({ vehicle_tap: { clips: ['tap'] } });
  audio.play = (name) => played.push(name);
  // The event key carries the frame time, so one tap plays once even if the
  // snapshot is handled again, while a later dispatch of the same vehicle taps
  // again -- every click should be audible.
  audio.handleGameEvent({ type: 'vehicle-dispatched', vehicleId: 12 }, 1.25);
  audio.handleGameEvent({ type: 'vehicle-dispatched', vehicleId: 12 }, 1.25);
  audio.handleGameEvent({ type: 'vehicle-dispatched', vehicleId: 12 }, 1.5);
  audio.handleGameEvent({ type: 'vehicle-dispatched', vehicleId: 13 }, 1.5);
  assert.deepEqual(played, ['vehicle_tap', 'vehicle_tap', 'vehicle_tap']);
});

test('vehicle tap volume scales the authored level instead of replacing it', async () => {
  const clipGains = [];
  const makeAudio = (scale) => new GameAudioController(
    { vehicle_tap: { clips: ['tap'], volume: 0.4 } },
    { getVolumeScale: (name) => (name === 'vehicle_tap' ? scale : 1) }
  );
  for (const scale of [1, 0.5, 2]) {
    const audio = makeAudio(scale);
    audio.unlocked = true;
    const destination = {};
    audio.context = {
      state: 'running',
      destination,
      createGain: () => {
        // Mimic WebAudio: the node exposes settings on a nested `gain` param.
        // The gain wired straight to the destination is the master bus; every
        // other one carries a single clip, which is what this test measures.
        const node = {
          gain: { value: 0 },
          connect(target) {
            if (target === destination) this.isMaster = true;
            else clipGains.push(this.gain);
            return target;
          }
        };
        return node;
      },
      createBufferSource: () => {
        // WebAudio's connect() returns the destination, which is how the
        // source -> clip gain -> master chain reads in the controller.
        const source = { connect: (target) => target, start: () => {}, stop: () => {} };
        return source;
      }
    };
    audio.loadClip = () => Promise.resolve({});
    audio.play('vehicle_tap');
    // startPlayback resolves loadClip and then assigns gain, so the value is
    // only visible after the microtask chain drains.
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  assert.deepEqual(clipGains.map((gain) => Number(gain.value.toFixed(3))), [0.4, 0.2, 0.8]);
});

test('bus full audio plays each distinct event once without dropping pending events', async () => {
  const sources = [];
  const pending = [];
  const audio = new GameAudioController({ bus_full: { clips: ['full'] } });
  audio.unlocked = true;
  audio.context = {
    state: 'running',
    destination: {},
    createGain: () => ({ gain: { value: 0 }, connect: () => ({}) }),
    createBufferSource: () => {
      const source = {
        stopped: false,
        connect: () => source,
        start: () => sources.push(source),
        stop: () => { source.stopped = true; }
      };
      return source;
    }
  };
  audio.loadClip = () => new Promise((resolve) => pending.push(resolve));
  audio.handleGameEvent({ type: 'vehicle-full', vehicleId: 1 }, 1);
  audio.handleGameEvent({ type: 'vehicle-full', vehicleId: 1 }, 1.5);
  audio.handleGameEvent({ type: 'vehicle-full', vehicleId: 2 }, 1.6);
  pending[0]({});
  await Promise.resolve();
  assert.equal(sources.length, 1);
  pending[1]({});
  await Promise.resolve();
  assert.equal(sources.length, 2);
  assert.equal(sources.every((source) => source.stopped === false), true);
});

test('audio remains dormant until a user gesture unlocks playback', async () => {
  let resumeCalls = 0;
  const audio = new GameAudioController({ bus_full: { clips: ['full'] } });
  audio.context = {
    state: 'suspended',
    resume() {
      resumeCalls += 1;
      this.state = 'running';
      return Promise.resolve();
    }
  };
  audio.loadClip = () => Promise.resolve(null);

  audio.play('bus_full');
  assert.equal(resumeCalls, 0);
  assert.equal(audio.queuedPlays.length, 1);

  audio.unlock();
  await Promise.resolve();
  assert.equal(resumeCalls, 1);
  assert.equal(audio.queuedPlays.length, 0);
});

test('countdown siren loop is idempotent, reconnectable and stoppable', async () => {
  const created = [];
  const audio = new GameAudioController({});
  audio.unlocked = true;
  audio.context = {
    state: 'running',
    currentTime: 0,
    destination: {},
    createGain: () => ({ gain: { value: 0, setValueAtTime() {}, linearRampToValueAtTime() {} }, connect: () => ({}) }),
    createBufferSource: () => {
      const source = {
        loop: false,
        stopped: false,
        connect: () => source,
        start() { this.started = true; },
        stop() { this.stopped = true; },
        disconnect() {}
      };
      created.push(source);
      return source;
    }
  };
  audio.loadClip = () => Promise.resolve({});
  assert.equal(audio.playLoop('countdown_siren', { asset: 'siren.mp3', volume: 0.4 }), true);
  // A second per-frame call must reuse the running loop instead of stacking one.
  assert.equal(audio.playLoop('countdown_siren', { asset: 'siren.mp3', volume: 0.4 }), true);
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(created.length, 1);
  assert.equal(created[0].loop, true);
  assert.equal(created[0].started, true);
  assert.equal(audio.isLoopPlaying('countdown_siren'), true);
  audio.stopLoop('countdown_siren');
  assert.equal(created[0].stopped, true);
  assert.equal(audio.isLoopPlaying('countdown_siren'), false);
  // After a stop the next start builds a fresh source rather than replaying a
  // stopped one, which WebAudio refuses.
  audio.playLoop('countdown_siren', { asset: 'siren.mp3' });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(created.length, 2);
  audio.stopAllLoops();
  assert.equal(audio.loops.size, 0);
});

test('audio unlocking and source reuse stay disabled before a gesture', () => {
  const audio = new GameAudioController({});
  assert.equal(audio.playLoop('countdown_siren', { asset: 'siren.mp3' }), false);
  assert.equal(audio.isLoopPlaying('countdown_siren'), false);
});

test('every audible route passes one master gain that the device volume drives', async () => {
  // AppLovin audits mute the device (audioVolumeChange 0) and require the
  // creative to produce no Web Audio output. Sources routed straight to the
  // destination can only be silenced by suspending the context, which the host
  // can undo, so everything must pass through one master bus.
  const master = { value: 1, written: [], connect: (target) => target };
  master.gain = {
    set value(next) { this._value = next; },
    get value() { return this._value ?? 1; },
    cancelScheduledValues() {},
    setValueAtTime: (value) => { master.value = value; master.written.push(value); },
    linearRampToValueAtTime: (value) => { master.value = value; master.written.push(value); }
  };
  const destination = {};
  const audio = new GameAudioController({ vehicle_tap: { clips: ['tap'], volume: 0.5 } });
  audio.unlocked = true;
  audio.context = {
    state: 'running',
    currentTime: 1,
    destination,
    createGain: () => master,
    createBufferSource: () => ({ connect: (target) => target, start() {}, stop() {}, disconnect() {} })
  };
  audio.loadClip = () => Promise.resolve({});
  audio.play('vehicle_tap');
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(audio.master, master, 'the clip must connect through the master bus');
  assert.equal(master.value, 1);

  // Device muted: the bus is written to zero in the same call, not ramped.
  audio.setDeviceVolume(0);
  assert.equal(master.value, 0);
  // Restoring the device volume brings the ad back at full level.
  audio.setDeviceVolume(1);
  assert.equal(master.value, 1);
  // A malformed host value must not be read as "mute".
  audio.setDeviceVolume(Number.NaN);
  assert.equal(master.value, 1);
});

test('hiding the ad writes silence even before the context suspends', async () => {
  let suspended = 0;
  const master = { value: 1, connect: (target) => target };
  master.gain = {
    set value(next) { this._value = next; },
    get value() { return this._value ?? 1; },
    cancelScheduledValues() {},
    setValueAtTime: (value) => { master.value = value; },
    linearRampToValueAtTime: (value) => { master.value = value; }
  };
  const audio = new GameAudioController({});
  audio.unlocked = true;
  audio.context = {
    state: 'running',
    currentTime: 0,
    destination: {},
    suspend() { suspended += 1; return Promise.resolve(); },
    createGain: () => master,
    createBufferSource: () => ({ connect: (target) => target, start() {}, stop() {} })
  };
  // Force the master bus to exist, as it would after the first clip.
  audio.getMasterGain(audio.context);
  audio.setDeviceVolume(0.8);
  assert.equal(master.value, 0.8);

  audio.setVisible(false);
  assert.equal(master.value, 0, 'the gain must drop immediately, not asymptotically');
  assert.equal(suspended, 1);

  // A resume from the host while still hidden must not make noise: the bus is
  // restored only when the ad is visible again.
  audio.setDeviceVolume(1);
  assert.equal(master.value, 0);
  audio.setVisible(true);
  assert.equal(master.value, 1);
});

test('audio preload contains individual decode failures without rejecting', async () => {
  const audio = new GameAudioController({
    bus_hit: { clips: ['valid'] },
    unused_mechanism: { clips: ['invalid'] }
  });
  audio.loadClip = (clip) => (
    clip === 'invalid' ? Promise.reject(new DOMException('Unable to decode', 'EncodingError')) : Promise.resolve({})
  );

  const originalWarn = console.warn;
  const warnings = [];
  console.warn = (...args) => warnings.push(args);
  try {
    await assert.doesNotReject(() => audio.preload());
  } finally {
    console.warn = originalWarn;
  }
  assert.equal(warnings.length, 1);
  assert.match(String(warnings[0][0]), /unused_mechanism/);
});

test('turn vehicle audio is deduplicated per completion event, not per vehicle', () => {
  const played = [];
  const audio = new GameAudioController({
    turn_vehicle_complete: { clips: ['turn'] }
  });
  audio.play = (name) => played.push(name);
  audio.handleGameEvent({ turnVehicleIds: [1, 2], turnVehicleEventId: 1 }, 1.25);
  audio.handleGameEvent({ turnVehicleIds: [1, 2], turnVehicleEventId: 1 }, 1.30);
  audio.handleGameEvent({ turnVehicleIds: [2], turnVehicleEventId: 2 }, 2.25);
  assert.deepEqual(played, ['turn_vehicle_complete', 'turn_vehicle_complete']);
});

test('hidden vehicle remains an obstacle until unblocked, then reveals before dispatch', () => {
  const game = new BusLoopGame(makeHiddenVehicleLevel());
  const hidden = game.getVehicle(1);
  assert.equal(hidden.hiddenRevealed, false);
  assert.equal(game.collisionContext.canVehicleDriveOut(game, hidden.id), false);
  assert.deepEqual(game.collisionContext.getCollisionCandidates(game, hidden.id).map((candidate) => candidate.id), [2]);
  assert.deepEqual(game.clickVehicle(hidden.id), { ok: false, reason: 'blocked', blockers: [2] });
  assert.equal(hidden.state, 'colliding');

  advance(game, 0.9);
  assert.equal(game.clickVehicle(2).ok, true);
  game.update(0.01);
  assert.ok(hidden.hiddenReveal);
  assert.equal(hidden.hiddenReveal.duration, SCENE_TUNING.hiddenVehicleReveal.durationSeconds);
  assert.deepEqual(game.clickVehicle(hidden.id), { ok: false, reason: 'unavailable' });

  const events = [];
  const unsubscribe = game.subscribe(state => events.push(state.lastEvent));
  advance(game, 1.1);
  unsubscribe();
  assert.equal(hidden.hiddenReveal, null);
  assert.equal(hidden.hiddenRevealed, true);
  assert.ok(events.some(event => event.type === 'hidden-vehicle-revealed' && event.vehicleId === hidden.id));
  assert.equal(game.clickVehicle(hidden.id).ok, true);
});

test('unrevealed hidden vehicle can be clicked to reveal, then dispatched normally', () => {
  const game = new BusLoopGame(makeHiddenVehicleLevel({
    vehicles: [
      { id: 1, seats: 4, colorIndex: 0, x: 0, z: 0, yaw: 0, isHidden: true }
    ],
    vehicleDepthes: { 1: [] }
  }));
  const hidden = game.getVehicle(1);

  assert.deepEqual(game.clickVehicle(hidden.id), { ok: true, reason: 'hidden-reveal' });
  assert.equal(hidden.state, 'parked');
  assert.equal(hidden.hiddenReveal.duration, SCENE_TUNING.hiddenVehicleReveal.durationSeconds);
  assert.equal(game.spots[0].vehicleId, null);
  assert.deepEqual(game.clickVehicle(hidden.id), { ok: false, reason: 'unavailable' });

  advance(game, 1.1);
  assert.equal(hidden.hiddenRevealed, true);
  assert.equal(hidden.hiddenReveal, null);
  assert.equal(game.clickVehicle(hidden.id).ok, true);
});

test('revealed hidden vehicle can board passengers normally', () => {
  const game = new BusLoopGame(makeHiddenVehicleLevel({
    conveyorCapacity: 1,
    queueCapacity: 0,
    passengerQueues: [[]]
  }));
  const hidden = game.getVehicle(1);
  hidden.hiddenRevealed = true;
  hidden.state = 'at-spot';
  hidden.spotIndex = 0;
  game.spots[0].vehicleId = hidden.id;
  game.slots[0].colorIndex = hidden.colorIndex;
  game.slots[0].progress = 0.7;
  game.update(0);
  assert.equal(hidden.boardedGroups, 1);
  assert.equal(game.lastEvent.type, 'group-boarded');
});

const readImageDimensions = (buffer) => {
  const pngSignature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (buffer.subarray(0, pngSignature.length).equals(pngSignature)) {
    return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
  }

  if (buffer[0] === 0xff && buffer[1] === 0xd8) {
    const startOfFrameMarkers = new Set([
      0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7,
      0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf
    ]);
    let offset = 2;
    while (offset < buffer.length) {
      while (buffer[offset] === 0xff) offset += 1;
      const marker = buffer[offset];
      offset += 1;
      if (marker === 0xd8 || marker === 0xd9) continue;
      if (marker === 0xda || offset + 2 > buffer.length) break;
      const segmentLength = buffer.readUInt16BE(offset);
      if (startOfFrameMarkers.has(marker)) {
        return {
          width: buffer.readUInt16BE(offset + 5),
          height: buffer.readUInt16BE(offset + 3)
        };
      }
      if (segmentLength < 2) break;
      offset += segmentLength;
    }
  }

  throw new Error('Unsupported background image format.');
};

const LEVEL12_TOTAL_PASSENGERS = 438;
const LEVEL12_PASSENGER_COLOR_TOTALS = { 0: 68, 1: 34, 2: 18, 3: 22, 4: 12, 5: 198, 6: 20, 7: 52, 8: 14 };
const LEVEL12_VEHICLE_SEAT_COLOR_TOTALS = { 0: 68, 1: 34, 2: 18, 3: 22, 4: 12, 5: 198, 6: 20, 7: 52, 8: 14 };
setActiveLevel(LEVEL_CATALOG.currentLevel12);

const LEVEL12_INITIAL_MOVABLE_IDS = [1, 4, 34, 51];
const LEVEL12_DISPATCH_ID = 4;
const LEVEL12_BLOCKED_ID = 3;

const countSeatsByColor = () => {
  const counts = {};
  for (const vehicle of LEVEL_1.vehicles) {
    counts[vehicle.colorIndex] = (counts[vehicle.colorIndex] ?? 0) + vehicle.seats;
  }
  return counts;
};

const mapVehicleAreaPoint = (point) => {
  const area = SCENE_TUNING.vehicleArea;
  const unitScale = area.positionUnitScale ?? LEVEL_1.mapScale;
  const scaledX = (point.x - area.positionPivotX) * unitScale + area.positionPivotX;
  const scaledZ = (point.z - area.positionPivotZ) * unitScale + area.positionPivotZ;
  const rotation = (area.rotationDegrees || 0) * Math.PI / 180;
  const x = (area.sourceRootX + scaledX) * area.unityToWorldScale + area.offsetX;
  const z = (
    (area.sourceRootZ + scaledZ)
    * area.unityToWorldScale
    * (area.mirrorZ ? -1 : 1)
  ) + area.offsetZ;
  const dx = x - area.pivotX;
  const dz = z - area.pivotZ;
  return {
    x: area.pivotX + dx * Math.cos(rotation) - dz * Math.sin(rotation),
    z: area.pivotZ + dx * Math.sin(rotation) + dz * Math.cos(rotation)
  };
};

test('level12 initializes Unity-authored layout and counts', () => {
  const state = new BusLoopGame().snapshot();
  assert.equal(LEVEL_1.id, 0);
  assert.equal(LEVEL_1.sceneName, 'GameSceneDualQueue2');
  assert.equal(LEVEL_1.mapScale, 1.0012542);
  assert.equal(state.vehicles.length, 94);
  assert.equal(state.spots.length, 4);
  assert.equal(state.slots.length, 32);
  assert.equal(LEVEL_1.passengerQueues.length, 2);
  assert.deepEqual(LEVEL_1.passengerQueues.map((queue) => queue.length), [257, 181]);
  assert.equal(LEVEL_1.passengerSequence.length, LEVEL12_TOTAL_PASSENGERS);
  assert.deepEqual(countSeatsByColor(), LEVEL12_VEHICLE_SEAT_COLOR_TOTALS);
  assert.equal(state.sourceRemaining, LEVEL12_TOTAL_PASSENGERS - LEVEL_1.queueCapacity * 2);
  assert.deepEqual(state.queueRemaining, [24, 24]);
  assert.equal(state.remainingGroups, LEVEL12_TOTAL_PASSENGERS);
  assert.deepEqual(state.remainingByColor, LEVEL12_PASSENGER_COLOR_TOTALS);
  assert.deepEqual(LEVEL_1.vehicles[0], { id: 1, seats: 4, colorIndex: 5, x: 1.8599999, z: 1.6299994, yaw: 90 });
  assert.deepEqual(LEVEL_1.vehicles.at(-1), { id: 118, seats: 10, colorIndex: 3, x: 1.4415802, z: 0.41113225, yaw: 0 });
  assert.deepEqual(LEVEL_1.passengerQueues[0].slice(0, 24), [
    0, 5, 5, 5, 5, 1, 1, 1, 1, 2, 2, 2, 2, 7, 7, 7, 7, 7, 7, 1, 1, 1, 1, 1
  ]);
  assert.deepEqual(LEVEL_1.passengerQueues[1].slice(0, 24), [
    5, 5, 5, 5, 3, 3, 3, 3, 0, 0, 0, 0, 0, 6, 5, 5, 8, 5, 5, 1, 5, 5, 0, 5
  ]);
});

test('Unity conveyor layout catalog includes all requested prefab shapes and assets', () => {
  // This pins the Unity-prefab-derived catalog. The imported playable tracks
  // (footage8/9/10/11) join the same registry from
  // src/playable-track-layouts.js, so compare the prefab subset explicitly
  // rather than the whole key list.
  const prefabLayoutIds = CONVEYOR_LAYOUT_IDS.filter((id) => !id.startsWith('footage'));
  assert.deepEqual(
    prefabLayoutIds,
    ['dualQueue2', 'dualQueue3', 'dualQueue5', 'dualQueue10', 'starLoop', 'heartLoop', 'catLoop', 'moonLoop',
      'dualLoop5', 'hexLoop', 'crossLoop']
  );
  assert.equal(MAX_CONVEYOR_CAPACITY, 60);
  assert.equal(MAX_QUEUE_CAPACITY, 60);
  assert.deepEqual(
    Object.fromEntries(prefabLayoutIds.map((id) => [id, {
      conveyor: CONVEYOR_LAYOUTS[id].conveyorCapacity,
      queues: CONVEYOR_LAYOUTS[id].queueCapacities
    }])),
    {
      dualQueue2: { conveyor: 32, queues: [24, 24] },
      dualQueue3: { conveyor: 36, queues: [22, 22] },
      dualQueue5: { conveyor: 31, queues: [26, 26] },
      dualQueue10: { conveyor: 38, queues: [26, 26] },
      starLoop: { conveyor: 52, queues: [52, 52] },
      heartLoop: { conveyor: 45, queues: [45, 45] },
      catLoop: { conveyor: 60, queues: [60, 60] },
      moonLoop: { conveyor: 60, queues: [60, 60] },
      // The three 2026-11-06 imports follow the same Footage convention: the
      // prefab's queue component still says 18, but the family sizes each queue
      // to the belt so the first fill can never deadlock.
      dualLoop5: { conveyor: 42, queues: [42, 42] },
      hexLoop: { conveyor: 38, queues: [38, 38] },
      crossLoop: { conveyor: 60, queues: [60, 60] }
    }
  );
  // StarLoop and the Footage2/3/4 heart/cat/moon belts come from other Unity
  // prefab variants, so their array sizes differ from the DualQueue family:
  // only the engine minimums are asserted for them.
  //
  // The imported playable tracks are deliberately skipped here: they are not
  // Unity prefab loops, they carry a 3D authored curve plus a mesh (or a sprite
  // matte) instead of a loopScene texture, and their own suite
  // (test/playable-track-import.test.js) asserts their geometry and assets.
  for (const [id, layout] of Object.entries(CONVEYOR_LAYOUTS)) {
    if (id.startsWith('footage')) continue;
    assert.equal(layout.splineType, 'bSpline');
    if (id === 'starLoop') {
      assert.equal(layout.splinePoints.length, 20);
      assert.deepEqual(layout.queuePaths.map((path) => path.length), [10, 10]);
    } else if (id === 'heartLoop') {
      assert.equal(layout.splinePoints.length, 20);
      assert.deepEqual(layout.queuePaths.map((path) => path.length), [15, 15]);
    } else if (id === 'catLoop' || id === 'moonLoop') {
      assert.equal(layout.splinePoints.length, 27);
      assert.deepEqual(layout.queuePaths.map((path) => path.length), [15, 15]);
    } else if (id === 'dualLoop5') {
      assert.equal(layout.splinePoints.length, 19);
      assert.deepEqual(layout.queuePaths.map((path) => path.length), [8, 8]);
    } else if (id === 'hexLoop') {
      assert.equal(layout.splinePoints.length, 18);
      // Footage6/7 author a straight two-point queue each; the renderer trims
      // the tail to the screen edge, so a short authored queue is expected.
      assert.deepEqual(layout.queuePaths.map((path) => path.length), [2, 2]);
    } else if (id === 'crossLoop') {
      assert.equal(layout.splinePoints.length, 16);
      assert.deepEqual(layout.queuePaths.map((path) => path.length), [2, 2]);
    } else {
      assert.equal(layout.splinePoints.length, 19);
      assert.deepEqual(layout.queuePaths.map((path) => path.length), [20, 20]);
    }
    assert.ok(publicAssetExists(layout.assets.loopScene), layout.assets.loopScene);
  }
  // The initial fill only ends once every belt slot has been filled, so a
  // layout whose queue capacities cannot cover its own belt deadlocks on the
  // first frame and never lets a passenger reach the exit.
  //
  // This is a per-layout authored invariant, so it applies to the Unity prefab
  // loops only. The imported tracks compute both numbers at runtime:
  // resolvePlayableTrackBoarding caps the belt at the level's passenger supply
  // and the model also ends the fill when the source queues run dry, so their
  // static prefab queue sizes are not the operative numbers.
  for (const [id, layout] of Object.entries(CONVEYOR_LAYOUTS)) {
    if (id.startsWith('footage')) continue;
    const queueTotal = layout.queueCapacities.reduce((sum, capacity) => sum + capacity, 0);
    assert.ok(
      queueTotal >= layout.conveyorCapacity,
      `${id} queue capacities ${JSON.stringify(layout.queueCapacities)} cannot fill its ${layout.conveyorCapacity} belt slots`
    );
  }
  assert.deepEqual(CONVEYOR_LAYOUTS.dualQueue2.splinePoints, LEVEL_1.splinePoints);
  assert.deepEqual(CONVEYOR_LAYOUTS.dualQueue2.queuePaths, LEVEL_1.queuePaths);
});

test('game model accepts layout-specific conveyor capacity, entries, and exit range', () => {
  const game = new BusLoopGame();
  const layout = CONVEYOR_LAYOUTS.dualQueue3;
  game.initializeQueues([22, 22], 0.25, [5.25, 5.25], 6.4, {
    capacity: layout.conveyorCapacity,
    queueCapacities: layout.queueCapacities,
    entryPercents: [0.125, 0.625],
    exitStart: layout.exitStart,
    exitEnd: layout.exitEnd,
    resetSlots: true
  });
  const state = game.snapshot();
  assert.equal(state.slots.length, 36);
  assert.deepEqual(state.queueRemaining, [22, 22]);
  assert.deepEqual(game.entryPercents, [0.125, 0.625]);
  assert.equal(game.exitStart, layout.exitStart);
  assert.equal(game.exitEnd, layout.exitEnd);
  assert.equal(game.conveyorPathLength, 6.4);
});

test('scene view creates the closed conveyor curve from the authored spline type', () => {
  const points = [0, 6, 12, 18].map((x) => new THREE.Vector3(x, x / 2, -x));
  const bSpline = makeClosedConveyorCurve(points, 'bSpline');
  const fallback = makeClosedConveyorCurve(points, 'catmullRom');
  assert.ok(bSpline instanceof DreamteckClosedBSplineCurve3);
  assert.deepEqual(bSpline.getPoint(0).toArray(), [4, 2, -4]);
  assert.deepEqual(bSpline.getPoint(1).toArray(), [4, 2, -4]);
  assert.equal(fallback.constructor.name, 'CatmullRomCurve3');
});

test('multi-conveyor editor, renderer, and main-thread handoff stay wired', () => {
  const editorSource = readFileSync(join('src', 'scene-editor.js'), 'utf8');
  assert.match(editorSource, /conveyorLayout\.selected/);
  assert.match(editorSource, /dualQueue2/);
  assert.match(editorSource, /dualQueue3/);
  assert.match(editorSource, /dualQueue5/);
  assert.match(editorSource, /dualQueue10/);
  assert.match(editorSource, /conveyorLayouts\.\$\{layoutId\}/);
  assert.match(editorSource, /updateConveyorLayoutVisibility/);

  const viewSource = readFileSync(join('src', 'scene-view.js'), 'utf8');
  assert.match(viewSource, /getSelectedConveyorLayout/);
  assert.match(viewSource, /MAX_CONVEYOR_CAPACITY/);
  assert.match(viewSource, /MAX_QUEUE_CAPACITY/);
  assert.match(viewSource, /layout\.splinePoints/);
  assert.match(viewSource, /layout\.splineType/);
  assert.match(viewSource, /layout\.queuePaths/);
  assert.match(viewSource, /splineType === 'bSpline'/);
  assert.match(viewSource, /new DreamteckClosedBSplineCurve3\(points\)/);
  assert.match(viewSource, /setArtworkPlaneTexture/);
  assert.match(viewSource, /calculateConveyorEntryPercents/);
  assert.match(viewSource, /getConveyorConfig/);

  const mainSource = readFileSync(join('src', 'main.js'), 'utf8');
  assert.match(mainSource, /function initializeGameQueues/);
  assert.match(mainSource, /view\.getConveyorConfig\(\)/);
  assert.match(mainSource, /path === 'conveyorLayout\.selected'/);
  assert.match(mainSource, /path === 'spatialConveyor\.capacity'/);
  assert.match(mainSource, /initializeGameQueues\(\{ resetSlots: conveyorStructureChanged \}\)/);
});

test('queue initialization can use adapted Unity visible capacities without losing passengers', () => {
  const game = new BusLoopGame();
  game.initializeQueues([17, 18], 0.25, [4, 4.25]);
  const state = game.snapshot();
  assert.deepEqual(state.queueRemaining, [17, 18]);
  assert.equal(state.sourceRemaining, LEVEL12_TOTAL_PASSENGERS - 17 - 18);
  assert.equal(state.remainingGroups, LEVEL12_TOTAL_PASSENGERS);
  assert.equal(state.queueItems[0][0].distanceFromHead, 0);
  assert.equal(state.queueItems[0][1].distanceFromHead, 0.25);
  assert.equal(state.queueItems[1][17].distanceFromHead, 4.25);
});

test('editor queue reinitialization preserves passengers already on the conveyor', () => {
  const level = structuredClone(LEVEL_CATALOG.level16);
  const layout = CONVEYOR_LAYOUTS.dualQueue3;
  const game = new BusLoopGame(level);
  const config = {
    capacity: layout.conveyorCapacity,
    queueCapacities: layout.queueCapacities,
    entryPercents: [0, 0.5],
    exitStart: layout.exitStart,
    exitEnd: layout.exitEnd,
    resetSlots: true
  };
  game.initializeQueues([22, 22], level.passengerQueue.spacing, [8, 8], 30, config);
  advance(game, 2, 1 / 60);

  const before = game.getRemainingByColor();
  assert.ok(game.snapshot().slots.some((slot) => slot.colorIndex !== null));
  game.initializeQueues(
    [22, 22],
    level.passengerQueue.spacing,
    [8.5, 8.5],
    31,
    { ...config, resetSlots: false }
  );

  assert.equal(game.getRemainingGroups(), level.passengerQueues.flat().length);
  assert.deepEqual(game.getRemainingByColor(), before);
  for (const vehicle of level.vehicles) {
    const expected = level.vehicles
      .filter((candidate) => candidate.colorIndex === vehicle.colorIndex)
      .reduce((sum, candidate) => sum + candidate.seats, 0);
    assert.equal(game.getRemainingByColor()[vehicle.colorIndex], expected);
  }
});

test('queue passengers keep Unity-style logic distance and advance after dequeue', () => {
  const game = new BusLoopGame();
  game.initializeQueues([4, 4], 0.5, [3, 3]);
  assert.deepEqual(
    game.snapshot().queueItems[0].map((item) => item.distanceFromHead),
    [0, 0.5, 1, 1.5]
  );
  assert.equal(game.dequeuePassenger(0), 0);
  assert.deepEqual(
    game.snapshot().queueItems[0].map((item) => item.distanceFromHead),
    [0.5, 1, 1.5, 2]
  );
  game.update(0.1);
  assert.deepEqual(
    game.snapshot().queueItems[0].map((item) => Number(item.distanceFromHead.toFixed(3))),
    [0.3, 0.8, 1.3, 1.8]
  );
  assert.equal(game.dequeuePassenger(0), null);
  game.updateQueues(0.2);
  assert.equal(game.dequeuePassenger(0), 5);
});

test('both DualQueue2 entrances feed the shared conveyor', () => {
  const game = new BusLoopGame();
  advance(game, 1);
  const entryIndices = new Set(
    game.snapshot().slots
      .filter((slot) => slot.colorIndex !== null)
      .map((slot) => slot.entryIndex)
  );
  assert.deepEqual([...entryIndices].sort(), [0, 1]);
});

test('side queue passengers keep Unity entering-belt motion metadata', () => {
  assert.deepEqual(LEVEL_1.passengerEntryMotion, {
    passengerSpeed: 2,
    conveyorSpeed: 0.5,
    initialFillCatchUpDuration: 0.2,
    catchUpExtraSpeed: 1,
    snapDistance: 0.02
  });

  const game = new BusLoopGame();
  assert.equal(game.snapshot().initialFillActive, true);
  advance(game, 1);
  assert.ok(game.initialFilledSlotIndices.size >= 6);
  const enteringSlots = game.snapshot().slots.filter((slot) => slot.entryMotion);
  assert.ok(enteringSlots.length >= 2);
  const entryIndices = new Set(enteringSlots.map((slot) => slot.entryMotion.entryIndex));
  assert.deepEqual([...entryIndices].sort(), [0, 1]);

  for (const slot of enteringSlots) {
    assert.equal(slot.entryMotion.entryIndex, slot.entryIndex);
    assert.equal(slot.entryMotion.fromQueueProgress, 0);
    assert.equal(slot.entryMotion.startedAt <= game.time, true);
    assert.equal(slot.entryMotion.initialFill, true);
  }
});

test('post-initial-fill passengers still carry entrance motion metadata', () => {
  const game = new BusLoopGame();
  advance(game, 8);
  assert.equal(game.snapshot().initialFillActive, false);

  const slot = game.slots[0];
  slot.colorIndex = null;
  slot.entryIndex = null;
  slot.entryMotion = null;
  slot.progress = 0.999;
  slot.previousProgress = 0.999;

  game.update(0.1);
  const updated = game.snapshot().slots[0];
  assert.notEqual(updated.colorIndex, null);
  assert.equal(updated.entryIndex, 0);
  assert.equal(updated.entryMotion.entryIndex, 0);
  assert.equal(updated.entryMotion.passengerId, 19);
  assert.equal(updated.entryMotion.fromQueueDistance, 0);
  assert.equal(updated.entryMotion.fromQueueProgress, 0);
  assert.equal(updated.entryMotion.startedAt, game.time);
  assert.equal(updated.entryMotion.initialFill, false);
});

test('Unity visual assets and tunable camera configuration are complete', () => {
  assert.equal(SCENE_TUNING.camera.elevationDegrees, 61);
  assert.equal(SCENE_TUNING.lighting.directional.enabled, 1);
  assert.equal(SCENE_TUNING.lighting.directional.color, 0xffffff);
  assert.equal(SCENE_TUNING.lighting.directional.intensity, 1.9);
  assert.deepEqual(SCENE_TUNING.lighting.directional.position, { x: -3.75, y: 11.7, z: -16.4 });
  assert.deepEqual(SCENE_TUNING.lighting.directional.eulerDegrees, { x: 101.5, y: -9.5, z: -99 });
  assert.equal(SCENE_TUNING.lighting.directional.shadowType, 2);
  assert.equal(SCENE_TUNING.lighting.directional.shadowStrength, 0.46);
  assert.equal(SCENE_TUNING.lighting.realtimeShadows.enabled, 0);
  assert.equal(SCENE_TUNING.facing.passengerYawDegrees, 180);
  assert.equal(SCENE_TUNING.facing.passengerModelYawDegrees, -90);
  assert.equal('luxuryPassengerOffset' in SCENE_TUNING, false);
  assert.equal('luxuryPassengerRotation' in SCENE_TUNING, false);
  assert.equal(SCENE_TUNING.vehicleArea.rotationDegrees, 0);
  assert.equal(SCENE_TUNING.vehicleArea.mirrorZ, true);
  // The 4-spot layout has to fit 50-car boards (lv154 is 7.1 world units wide)
  // inside a 390x844 phone: at positionUnitScale 0.8 the formation ran edge to
  // edge with 0px of margin, so the field is pulled in to 0.7 and the camera
  // opens up to fitHeight 16.4.
  assert.equal(SCENE_TUNING.vehicleArea.positionUnitScale, 0.7);
  assert.equal(SCENE_TUNING.vehicleArea.modelScale, 0.64);
  assert.equal(SCENE_TUNING.camera.fitHeight, 16.4);
  assert.equal(SCENE_TUNING.facing.arrowYawDegrees, 180);
  assert.equal(ACTIVE_LEVEL.assets.background, '/assets/applovin/textures/BG01_split01_q60.jpg');
  assert.match(LEVEL_1.assets.textures.parkingSpot, /Car_P2\.png$/);
  assert.equal(LEVEL_1.assets.colorTextures.length, 26);
  // Slots 11-16 have no standard atlas and stay null on purpose.
  assert.deepEqual(LEVEL_1.assets.colorTextures.slice(11, 17), Array(6).fill(null));
  assert.match(LEVEL_1.assets.colorTextures[23], /color_23_matchagreen_q85\.webp$/);
  assert.deepEqual(Object.keys(LEVEL_1.assets.models.vehicleBySeats).map(Number), [4, 6, 10]);
  assert.match(LEVEL_1.assets.models.vehicleShadowBySeats[10], /Bus_FakeShadow\.fbx$/);
  assert.match(LEVEL_1.assets.textures.vehicleShadowBySeats[10], /Bus_FakeShadow\.png$/);
  const urls = [
    ACTIVE_LEVEL.assets.background,
    LEVEL_1.assets.loopScene,
    LEVEL_1.assets.models.passengerVatMesh,
    LEVEL_1.assets.models.passengerVatTexture,
    LEVEL_1.assets.models.shadow,
    LEVEL_1.assets.models.arrow,
    LEVEL_1.assets.models.parkingSpot,
    ...Object.values(LEVEL_1.assets.audio).flatMap((data) => data.clips),
    ...Object.values(LEVEL_1.assets.models.vehicleBySeats),
    ...Object.values(LEVEL_1.assets.models.vehicleShadowBySeats),
    ...LEVEL_1.assets.colorTextures.filter(Boolean),
    LEVEL_1.assets.textures.shadow,
    LEVEL_1.assets.textures.parkingSpot,
    ...Object.values(LEVEL_1.assets.textures.effects),
    ...Object.values(LEVEL_1.assets.textures.vehicleShadowBySeats)
  ];
  assert.ok(urls.every(publicAssetExists));
  for (const url of [
    '/assets/unity/mechanisms/ambulance/models/Ambulance_001.fbx',
    '/assets/unity/mechanisms/ambulance/models/Idle_girl_rescuer.fbx',
    '/assets/unity/mechanisms/ambulance/models/Idle_girl_rescuer_vatmesh.bin',
    '/assets/unity/mechanisms/ambulance/models/Idle_girl_rescuer_anim_map.vatq',
    '/assets/unity/mechanisms/ambulance/textures/Ambulance.png',
    '/assets/unity/mechanisms/ambulance/textures/Idle_girl_rescuer.png',
    '/assets/unity/mechanisms/ambulance/textures/Main_Gamepanel_BubbleLove.png',
    '/assets/unity/mechanisms/ambulance/audio/ambulance_countdown_V2.wav'
  ]) {
    assert.ok(publicAssetExists(url), url);
  }
  for (const url of [
    '/assets/unity/mechanisms/luxury-vehicle/models/Luxury_001.fbx.bin',
    '/assets/unity/mechanisms/luxury-vehicle/models/Idle_wealthy.fbx.bin',
    '/assets/unity/mechanisms/luxury-vehicle/models/Idle_wealthy_vatmesh.bin',
    '/assets/unity/mechanisms/luxury-vehicle/models/Idle_wealthy_anim_map.vatq',
    '/assets/unity/mechanisms/luxury-vehicle/textures/Luxury.png',
    '/assets/unity/mechanisms/luxury-vehicle/textures/Luxury_metal.png',
    '/assets/unity/mechanisms/luxury-vehicle/textures/Idle_wealthy.png',
    '/assets/unity/mechanisms/luxury-vehicle/textures/Idle_wealthy_cloth.png',
    '/assets/unity/mechanisms/luxury-vehicle/textures/count_limousine.png',
    '/assets/unity/mechanisms/luxury-vehicle/animations/wealthy-passenger.json'
  ]) {
    assert.ok(publicAssetExists(url), url);
  }
  assert.deepEqual(LEVEL_1.assets.audio.bus_hit, {
    clips: ['/assets/unity/audio/bus_hit_V5.mp3'],
    volume: 0.503268
  });
  assert.deepEqual(LEVEL_1.assets.audio.passenger_up, {
    clips: [
      '/assets/unity/audio/passenger_up_01.mp3',
      '/assets/unity/audio/passenger_up_02.mp3',
      '/assets/unity/audio/passenger_up_03.mp3'
    ],
    volume: 0.825528
  });
  assert.deepEqual(LEVEL_1.assets.audio.bus_full, {
    clips: ['/assets/unity/audio/bus_full.mp3'],
    volume: 0.50023913
  });
  assert.deepEqual(LEVEL_1.assets.audio.vehicle_tap, {
    clips: ['/assets/unity/audio/vehicle_tap.mp3'],
    volume: 0.7
  });
  assert.equal(LEVEL_1.assets.passengerAnimations.move.duration, 0.60000014);
});

test('conveyor vehicles initialize across the authored visible width and keep spacing while moving', () => {
  const game = new BusLoopGame(makeConveyorVehicleLevel());
  const conveyor = game.snapshot().mechanicState.conveyors[0];
  assert.deepEqual(conveyor.vehicleIds, [1, 2, 3]);
  const before = game.vehicles.map((vehicle) => vehicle.x);
  assert.ok(before[0] < before[1] && before[1] < before[2]);
  assert.ok(Math.abs((before[1] - before[0]) - (before[2] - before[1])) < 1e-6);
  assert.ok(before[2] - before[0] > 3);

  game.update(0.5);
  const after = game.vehicles.map((vehicle) => vehicle.x);
  assert.notDeepEqual(after, before);
  assert.ok(Math.abs((after[1] - after[0]) - (after[2] - after[1])) < 1e-6);
  assert.equal(game.vehicles.every((vehicle) => vehicle.conveyorVisible), true);
});

test('a conveyor vehicle can leave only from the exit range and is removed from the belt', () => {
  const game = new BusLoopGame(makeConveyorVehicleLevel());
  const conveyor = game.mechanicState.conveyors[0];
  assert.equal(game.collisionContext.canVehicleDriveOut(game, 2), true);
  const result = game.clickVehicle(2);
  assert.equal(result.ok, true);
  assert.equal(game.getVehicle(2).conveyorId, null);
  assert.deepEqual(conveyor.vehicleIds, [1, 3]);
  assert.equal(game.getVehicle(2).state, 'moving-to-spot');
});

test('a conveyor departure leaves its authored slot empty instead of compacting the belt', () => {
  const game = new BusLoopGame(makeConveyorVehicleLevel());
  const before = game.vehicles.map((vehicle) => ({ id: vehicle.id, x: vehicle.x }));
  assert.equal(game.clickVehicle(2).ok, true);
  const remaining = game.vehicles.filter((vehicle) => vehicle.conveyorId !== null);
  assert.equal(remaining.length, 2);
  assert.ok(Math.abs(remaining[0].x - before[0].x) < 1e-6);
  assert.ok(Math.abs(remaining[1].x - before[2].x) < 1e-6);
  assert.ok(Math.abs(remaining[1].x - remaining[0].x) > Math.abs(before[2].x - before[1].x));
  assert.equal(game.snapshot().mechanicState.conveyors[0].slotCount, 3);
});

test('conveyor collision picks the nearest forward vehicle instead of skipping to a farther overlap', () => {
  const game = new BusLoopGame(makeConveyorVehicleLevel({
    vehicles: [
      { id: 1, seats: 4, colorIndex: 2, x: -1, z: 0, yaw: 0, containerType: 3, containerId: 4 },
      { id: 3, seats: 4, colorIndex: 2, x: 1, z: 0, yaw: 0, containerType: 3, containerId: 4 },
      { id: 2, seats: 4, colorIndex: 2, x: 0, z: 0, yaw: 0, containerType: 3, containerId: 4 }
    ]
  }));
  const [first, farther, direct] = game.vehicles;
  first.x = -0.08;
  direct.x = 0.04;
  farther.x = 0.18;
  assert.equal(game.collisionContext.canVehicleDriveOut(game, first.id), false);
  assert.deepEqual(game.collisionContext.getCollisionCandidates(game, first.id).map((candidate) => candidate.id), [direct.id]);
  assert.deepEqual(game.getBlockers(first.id), [direct.id]);
});

test('ordinary vehicle collision sees the nearest conveyor vehicle in its forward sweep', () => {
  const game = new BusLoopGame(makeConveyorVehicleLevel({
    spotCount: 2,
    vehicles: [
      { id: 9, seats: 4, colorIndex: 1, x: -1.55, z: 0, yaw: 90, containerType: 1, containerId: 0 },
      { id: 1, seats: 4, colorIndex: 2, x: -1.25, z: 0, yaw: 0, containerType: 3, containerId: 4 },
      { id: 2, seats: 4, colorIndex: 2, x: 1.25, z: 0, yaw: 0, containerType: 3, containerId: 4 }
    ]
  }));
  const candidates = game.collisionContext.getCollisionCandidates(game, 9);
  assert.deepEqual(candidates.map((candidate) => candidate.id), [1, 2]);
  assert.equal(game.clickVehicle(9).reason, 'blocked');
  assert.equal(game.getVehicle(9).collision.targetId, 1);
});

test('rotated conveyor slots follow the belt axis instead of world X ordering', () => {
  const game = new BusLoopGame(makeConveyorVehicleLevel({
    containers: [{ id: 4, type: 3, x: 0, z: 0, yaw: 90 }],
    vehicles: [
      { id: 1, seats: 4, colorIndex: 2, x: 0, z: 1, yaw: 90, containerType: 3, containerId: 4 },
      { id: 2, seats: 4, colorIndex: 2, x: 0, z: 0, yaw: 90, containerType: 3, containerId: 4 },
      { id: 3, seats: 4, colorIndex: 2, x: 0, z: -1, yaw: 90, containerType: 3, containerId: 4 }
    ]
  }));
  assert.deepEqual(game.vehicles.map((vehicle) => vehicle.conveyorIndex), [0, 1, 2]);
});

test('an emptied conveyor becomes hidden after its last vehicle leaves', () => {
  const game = new BusLoopGame(makeConveyorVehicleLevel());
  for (const id of [1, 2, 3]) {
    assert.equal(game.clickVehicle(id).ok, true);
  }
  game.update(0.01);
  assert.equal(game.mechanicState.conveyors[0].hidden, true);
  assert.equal(game.snapshot().mechanicState.conveyors[0].vehicleIds.length, 0);
});

test('ambulance departure removes itself before decrementing other ambulances', () => {
  const game = new BusLoopGame(makeAmbulanceLevel([
    { id: 1, seats: 6, colorIndex: 13, ambulanceStepLimit: 2, x: 0, z: 0, yaw: 0, containerType: 1, containerId: 0 },
    { id: 2, seats: 6, colorIndex: 13, ambulanceStepLimit: 2, x: 2, z: 0, yaw: 0, containerType: 1, containerId: 0 },
    { id: 3, seats: 4, colorIndex: 0, x: 4, z: 0, yaw: 0, containerType: 1, containerId: 0 }
  ]));
  const result = game.clickVehicle(1);
  const state = game.snapshot();
  assert.equal(result.ok, true);
  assert.equal(state.status, 'playing');
  assert.equal(state.vehicles.find((vehicle) => vehicle.id === 1).ambulanceActive, false);
  assert.equal(state.vehicles.find((vehicle) => vehicle.id === 1).ambulanceRemainingSteps, 2);
  assert.equal(state.vehicles.find((vehicle) => vehicle.id === 2).ambulanceRemainingSteps, 1);
  assert.deepEqual(state.lastEvent.ambulanceUpdates, [{ vehicleId: 2, remainingSteps: 1 }]);
});

test('ambulance countdown audio stays below the delivery size budget', () => {
  const audio = readFileSync(join('public', 'assets', 'unity', 'mechanisms', 'ambulance', 'audio', 'ambulance_countdown_V2.wav'));
  assert.ok(audio.length < 50_000);
  assert.equal(audio.toString('ascii', 0, 4), 'RIFF');
  assert.equal(audio.readUInt16LE(22), 1);
  assert.equal(audio.readUInt32LE(24), 22050);
  assert.equal(audio.readUInt16LE(34), 16);
});

test('blocked vehicle clicks do not consume ambulance moves', () => {
  const game = new BusLoopGame(makeAmbulanceLevel([
    { id: 1, seats: 6, colorIndex: 13, ambulanceStepLimit: 2, x: 0, z: 0, yaw: 0, containerType: 1, containerId: 0 },
    { id: 2, seats: 4, colorIndex: 0, x: 2, z: 0, yaw: 0, containerType: 1, containerId: 0 },
    { id: 3, seats: 4, colorIndex: 0, x: 2, z: 1, yaw: 0, containerType: 1, containerId: 0 }
  ]));
  const result = game.clickVehicle(2);
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'blocked');
  assert.equal(game.getVehicle(1).ambulanceRemainingSteps, 2);
  assert.equal(game.status, 'playing');
});

test('an active ambulance reaching zero moves fails immediately', () => {
  const game = new BusLoopGame(makeAmbulanceLevel([
    { id: 1, seats: 6, colorIndex: 13, ambulanceStepLimit: 1, x: 0, z: 0, yaw: 0, containerType: 1, containerId: 0 },
    { id: 2, seats: 4, colorIndex: 0, x: 2, z: 0, yaw: 0, containerType: 1, containerId: 0 }
  ]));
  const result = game.clickVehicle(2);
  const state = game.snapshot();
  assert.equal(result.ok, true);
  assert.equal(state.status, 'lost');
  assert.equal(state.lastEvent.reason, 'ambulance-exceed-step');
  assert.equal(state.vehicles.find((vehicle) => vehicle.id === 1).ambulanceRemainingSteps, 0);
});

test('ambulance passenger uses its own VAT clips and forward-facing correction', () => {
  const viewSource = readFileSync(join('src', 'scene-view.js'), 'utf8');
  const mesh = decodeOptionalGzipAsset(readFileSync(join('public', 'assets', 'unity', 'mechanisms', 'ambulance', 'models', 'Idle_girl_rescuer_vatmesh.bin')));
  const texture = readFileSync(join('public', 'assets', 'unity', 'mechanisms', 'ambulance', 'models', 'Idle_girl_rescuer_anim_map.vatq'));
  assert.equal(mesh.subarray(0, 4).toString('ascii'), 'VATM');
  assert.equal(mesh.readUInt32LE(8), 859);
  assert.equal(mesh.readUInt32LE(12), 3513);
  assert.equal(texture.subarray(0, 4).toString('ascii'), 'VATQ');
  assert.equal(texture.readUInt32LE(8), 859);
  assert.equal(texture.readUInt32LE(12), 79);
  assert.ok(texture.length < 110_000);
  assert.match(viewSource, /AMBULANCE_PASSENGER_YAW_OFFSET_DEGREES = 0/);
  assert.match(viewSource, /loadPackedVatTexture\(AMBULANCE_ASSETS\.passengerVatTexture/);
  assert.match(viewSource, /THREE\.RGBAFormat/);
  assert.match(viewSource, /textureWidth: 859/);
  assert.match(viewSource, /textureHeight: 79/);
  assert.match(viewSource, /animation: AMBULANCE_PASSENGER_ANIMATIONS/);
  assert.match(viewSource, /state\?\.animation\?\.\[clipName\]/);
  assert.match(viewSource, /root\.userData\.vatMaterial = material/);
});

test('ambulance step board is enlarged, lowered, and excluded from vehicle picking', () => {
  const viewSource = readFileSync(join('src', 'scene-view.js'), 'utf8');
  assert.match(viewSource, /AMBULANCE_STEP_BOARD_BASE_SCALE = 0\.56 \* 1\.2 \* 1\.2/);
  assert.match(viewSource, /AMBULANCE_STEP_BOARD_OFFSET_Y = 0\.42 \* 0\.9/);
  assert.match(viewSource, /AMBULANCE_STEP_BOARD_FONT_SIZE = 76 \* 1\.1/);
  assert.match(viewSource, /900 \$\{AMBULANCE_STEP_BOARD_FONT_SIZE\}px "Poppins Branding", Arial, sans-serif/);
  assert.match(viewSource, /size\.y \+ AMBULANCE_STEP_BOARD_OFFSET_Y/);
  assert.match(viewSource, /sprite\.raycast = \(\) => \{\}/);
});

test('turn vehicles rotate together after a successful dispatch and stay unavailable while rotating', () => {
  const level = makeAmbulanceLevel([
    { id: 1, seats: 4, colorIndex: 0, isTurnVehicle: true, x: 0, z: 0, yaw: 0, containerType: 1, containerId: 0 },
    { id: 2, seats: 4, colorIndex: 0, isTurnVehicle: true, x: 2, z: 0, yaw: 0, containerType: 1, containerId: 0 },
    { id: 3, seats: 4, colorIndex: 0, isTurnVehicle: false, x: 4, z: 0, yaw: 0, containerType: 1, containerId: 0 }
  ]);
  const game = new BusLoopGame(level);
  const events = [];
  game.subscribe((state) => events.push(state.lastEvent));

  assert.equal(game.clickVehicle(3).ok, true);
  assert.equal(game.clickVehicle(2).reason, 'unavailable');
  assert.equal(game.getVehicle(1).turnRotation.active, true);
  assert.equal(game.getVehicle(1).yaw, 0);

  game.update(0.1);
  assert.ok(game.getVehicle(1).yaw > 0 && game.getVehicle(1).yaw < 180);
  game.update(0.1);
  game.update(0.05);
  assert.equal(game.getVehicle(1).yaw, 180);
  assert.equal(game.getVehicle(1).turnRotation.active, false);
  assert.deepEqual(events.at(-1).turnVehicleIds, [1, 2]);
  assert.equal(typeof events.at(-1).turnVehicleEventId, 'number');
  assert.equal(game.clickVehicle(2).ok, true);
});

test('turn vehicle completion audio is bundled in a compact playable-safe format', () => {
  const audioPath = join('public', 'assets', 'unity', 'mechanisms', 'turn-vehicle', 'audio', 'guidemove.bin');
  const audio = readFileSync(audioPath);
  const audioSource = readFileSync(join('src', 'audio-controller.js'), 'utf8');
  const mechanismSource = readFileSync(join('src', 'mechanism-resources.js'), 'utf8');

  assert.equal(audio.subarray(0, 4).toString('ascii'), 'RIFF');
  assert.equal(audio.subarray(8, 12).toString('ascii'), 'WAVE');
  assert.equal(audio.readUInt16LE(20), 1);
  assert.equal(audio.readUInt16LE(22), 1);
  assert.equal(audio.readUInt32LE(24), 16_000);
  assert.equal(audio.readUInt16LE(34), 16);
  assert.ok(audio.length < 100_000);
  assert.match(audioSource, /turn_vehicle_complete/);
  assert.match(audioSource, /event\?\.turnVehicleIds\?\.length/);
  assert.match(audioSource, /turnVehicleEventId/);
  assert.match(audioSource, /this\.playedGameEventKeys/);
  assert.match(audioSource, /this\.play\(name\)/);
  assert.match(mechanismSource, /turn_vehicle_complete:[\s\S]*MECHANISM_ASSETS\.turnVehicle\.audio/);
  assert.match(mechanismSource, /export function getMechanismAudioConfig/);
});

test('garage Unity model and audio resources are wired into the playable runtime', () => {
  const modelPaths = [
    join('public', 'assets', 'unity', 'mechanisms', 'garage', 'models', 'Garage_Truck_01.fbx'),
    join('public', 'assets', 'unity', 'mechanisms', 'garage', 'models', 'Garage_Truck_01_FakeShadow.fbx')
  ];
  const texturePaths = [
    join('public', 'assets', 'unity', 'mechanisms', 'garage', 'textures', 'Garage_Truck_01.png'),
    join('public', 'assets', 'unity', 'mechanisms', 'garage', 'textures', 'Garage_Truck_01_FakeShadow.png')
  ];
  const audioPaths = [
    join('public', 'assets', 'unity', 'mechanisms', 'garage', 'audio', 'garage_out.wav'),
    join('public', 'assets', 'unity', 'mechanisms', 'garage', 'audio', 'garage_clear.wav')
  ];
  for (const assetPath of [...modelPaths, ...texturePaths]) {
    assert.equal(existsSync(assetPath), true, assetPath);
    assert.ok(statSync(assetPath).size > 1_000, assetPath);
  }
  for (const assetPath of audioPaths) {
    const audio = readFileSync(assetPath);
    assert.equal(audio.toString('ascii', 0, 4), 'RIFF');
    assert.equal(audio.toString('ascii', 8, 12), 'WAVE');
  }

  const audioSource = readFileSync(join('src', 'audio-controller.js'), 'utf8');
  const mechanismSource = readFileSync(join('src', 'mechanism-resources.js'), 'utf8');
  assert.match(sceneViewSource, /MECHANISM_ASSETS\.garage/);
  assert.match(sceneViewSource, /cloneSkeleton\(this\.garageTemplate\)/);
  assert.match(sceneViewSource, /updateGarageViews\(snapshot\)/);
  assert.match(sceneViewSource, /model\.rotation\.y = GARAGE_MODEL_YAW_OFFSET/);
  assert.match(sceneViewSource, /shadow\.rotation\.y = GARAGE_MODEL_YAW_OFFSET/);
  assert.match(sceneViewSource, /GARAGE_SHADOW_FORWARD_OFFSET = 0\.1/);
  assert.match(sceneViewSource, /shadow\.position\.set\(0, SCENE_TUNING\.vehicleShadows\.y, GARAGE_SHADOW_FORWARD_OFFSET\)/);
  assert.match(sceneViewSource, /vehicleArea\.modelScale \* GARAGE_SIZE_MULTIPLIER/);
  assert.match(sceneViewSource, /removeImportedLights\(garageFbx\)/);
  assert.match(sceneViewSource, /if \(child\.isLight\) importedLights\.push\(child\)/);
  assert.match(sceneViewSource, /door\.rotateZ\(/);
  assert.match(sceneViewSource, /GARAGE_SIZE_MULTIPLIER/);
  assert.match(audioSource, /garageReleasedVehicleIds/);
  assert.match(audioSource, /garageClearedIds/);
  assert.match(mechanismSource, /garage_out:[\s\S]*MECHANISM_ASSETS\.garage\.outAudio/);
  assert.match(mechanismSource, /garage_clear:[\s\S]*MECHANISM_ASSETS\.garage\.clearAudio/);
});

test('conveyor vehicle resources and visibility state are wired into the scene renderer', () => {
  const editorSource = readFileSync(join('src', 'scene-editor.js'), 'utf8');
  for (const asset of [
    'public/assets/unity/mechanisms/vehicle-transport-belt/models/plane_conveyor.fbx',
    'public/assets/unity/mechanisms/vehicle-transport-belt/models/plane_conveyor_arrow.fbx',
    'public/assets/unity/mechanisms/vehicle-transport-belt/textures/plane_conveyor_belt.png',
    'public/assets/unity/mechanisms/vehicle-transport-belt/textures/plane_conveyor_arrow.png',
    'public/assets/unity/mechanisms/vehicle-transport-belt/textures/plane_conveyor_build_DoorLeft.png',
    'public/assets/unity/mechanisms/vehicle-transport-belt/textures/plane_conveyor_build_DoorRight.png',
    'public/assets/unity/mechanisms/vehicle-transport-belt/textures/plane_conveyor_build_Leftside.png',
    'public/assets/unity/mechanisms/vehicle-transport-belt/textures/plane_conveyor_build_Rightside.png'
  ]) {
    assert.ok(existsSync(asset), asset);
  }
  assert.match(sceneViewSource, /CONVEYOR_VEHICLE_ASSETS/);
  assert.match(sceneViewSource, /applyConveyorVisualTuning/);
  assert.match(sceneViewSource, /makeConveyorComponent\('Belt'/);
  assert.match(sceneViewSource, /makeConveyorComponent\('Arrow'/);
  assert.match(sceneViewSource, /makeConveyorComponent\('Door Left'/);
  assert.match(sceneViewSource, /makeConveyorComponent\('Door Right'/);
  assert.match(sceneViewSource, /makeConveyorComponent\('Side Left'/);
  assert.match(sceneViewSource, /makeConveyorComponent\('Side Right'/);
  assert.match(sceneViewSource, /view\.userData\.components/);
  assert.doesNotMatch(sceneViewSource, /CONVEYOR_VISUAL_SCALE|CONVEYOR_SIDE_RAIL|sideRails|sidePanels/);
  assert.doesNotMatch(sceneViewSource, /tuning\.(lengthScale|bodyLengthScale|widthScale|sideSpacing)/);
  assert.match(sceneViewSource, /config\.positionX/);
  assert.match(sceneViewSource, /config\.scaleX/);
  assert.match(sceneViewSource, /config\.rotationXDegrees/);
  assert.match(sceneViewSource, /view\.visible = state \? !state\.hidden : true/);
  assert.match(sceneViewSource, /loadConveyorVehicleAssets/);
  assert.match(sceneViewSource, /buildConveyorViews/);
  assert.match(sceneViewSource, /updateConveyorViews/);
  assert.match(sceneViewSource, /MECHANISM_ASSETS\.vehicleTransportBelt/);
  assert.match(sceneViewSource, /configuredExitWidth = Number\(LEVEL_1\.collision\?\.conveyor\?\.exitWidth\)/);
  assert.match(sceneViewSource, /CONVEYOR_LEFT_DOOR_OUTWARD_SCALE = 1\.17/);
  assert.match(sceneViewSource, /CONVEYOR_RIGHT_DOOR_OUTWARD_SCALE = 1\.2/);
  assert.match(sceneViewSource, /doorCenterOffset = openingHalfWidth \+ capWidth \* 0\.5/);
  assert.match(sceneViewSource, /view\.userData\.buildParts/);
  assert.equal(editorSource.includes("title: '\\u4f20\\u9001\\u5e26\\u89c6\\u89c9"), false);
  assert.doesNotMatch(editorSource, /CONVEYOR_COMPONENT_OPTIONS|makeConveyorComponentFields/);
  assert.match(sceneViewSource, /vehicle\.conveyorVisible !== false/);
  assert.match(gameModelSource, /CONVEYOR_RIGHT_VISIBILITY_SCALE = 0\.93/);
  assert.match(gameModelSource, /rightViewHalfWidth = viewHalfWidth \* CONVEYOR_RIGHT_VISIBILITY_SCALE/);
  assert.match(sceneViewSource, /map\.offset\.x = \(snapshot\.time \* \(state\.speed/);
});

test('turn vehicles use the dedicated Unity arrow and normal parking orientation', () => {
  const viewSource = readFileSync(join('src', 'scene-view.js'), 'utf8');
  const turnArrow = readFileSync(join('public', 'assets', 'unity', 'mechanisms', 'turn-vehicle', 'models', 'Arrow_02.fbx.bin'));
  assert.equal(turnArrow[0], 0x1f);
  assert.equal(turnArrow[1], 0x8b);
  assert.ok(turnArrow.length < 30_000);
  assert.match(viewSource, /MECHANISM_ASSETS\.turnVehicle\.arrow/);
  assert.match(viewSource, /const TURN_ARROW_SCALE = 0\.8/);
  assert.match(viewSource, /const TURN_ARROW_FORWARD_OFFSET = 0\.18/);
  assert.match(viewSource, /loadPackedFbx\(TURN_ARROW_ASSET_URL/);
  assert.match(viewSource, /const arrowTemplate = vehicle\.isTurnVehicle && this\.turnArrowTemplate/);
  assert.match(viewSource, /function makeCenteredArrow\(template\)/);
  assert.match(viewSource, /const arrow = makeCenteredArrow\(arrowTemplate\)/);
  assert.match(viewSource, /arrow\.scale\.multiplyScalar\(TURN_ARROW_SCALE\)/);
  assert.match(viewSource, /arrow\.rotation\.y = deg\(vehicle\.isTurnVehicle \? 0 : SCENE_TUNING\.facing\.arrowYawDegrees\)/);
  assert.match(viewSource, /view\.rotation\.y = deg\(SCENE_TUNING\.facing\.parkingSpotYawDegrees \+ 180\) \+ vehicleYawOffset/);
  assert.doesNotMatch(viewSource, /view\.rotation\.y = vehicle\.isTurnVehicle\s*\?/);
});

test('a roof arrow stroke grows equally along its sides and ends', () => {
  const source = new THREE.PlaneGeometry(0.2, 0.6).rotateX(-Math.PI / 2).toNonIndexed();
  const shell = createRoofArrowOutline(source);
  for (const scale of [1.05, 1.62, 1]) {
    updateRoofArrowOutline(shell, scale);
    const delta = shell.boundingBox.getSize(new THREE.Vector3()).sub(source.boundingBox.getSize(new THREE.Vector3()));
    assert.ok(Math.abs(delta.x - delta.z) < 1e-6);
    assert.ok(Math.abs(delta.x - 1.2 * roofArrowStrokeRatio(scale)) < 1e-6);
  }
});

test('roof offsets keep the complete outlined marker on each vehicle size', () => {
  const tuning = SCENE_TUNING.vehicleArrow;
  const saved = { ...tuning };
  const arrow = new THREE.Group();
  arrow.userData.fittedSize = new THREE.Vector3(0.24, 0.001, 0.56);
  try {
    for (const [width, depth] of [[0.57, 1.05], [0.86, 1.23], [0.69, 1.48]]) {
      const size = new THREE.Vector3(width, 0.64, depth);
      for (const options of [{}, { isTurnVehicle: true }, { isHiddenQuestionMark: true }]) {
        const scale = options.isTurnVehicle ? 0.8 : 1;
        for (const [x, z] of [[0, 0], [0.54, -0.27], [-0.8, -0.8], [0.8, 0.8]]) {
          Object.assign(tuning, { offsetX: x, offsetY: 0, offsetZ: z, outlineScale: 1.62 });
          SceneView.prototype.applyVehicleArrowTuning(arrow, size, options);
          const stroke = 0.56 * roofArrowStrokeRatio(1.62);
          const halfX = options.isHiddenQuestionMark ? 0.12 * 1.62 : 0.12 + stroke;
          const halfZ = options.isHiddenQuestionMark ? 0.28 * 1.62 : 0.28 + stroke;
          assert.ok(Math.abs(arrow.position.x) + halfX * scale <= width / 2);
          assert.ok(Math.abs(arrow.position.z) + halfZ * scale <= depth / 2);
          assert.ok(arrow.position.y > size.y);
          assert.equal(Math.sign(arrow.position.x), Math.sign(x));
          if (!options.isTurnVehicle && !options.isHiddenQuestionMark) assert.equal(Math.sign(arrow.position.z), Math.sign(z));
        }
      }
    }
  } finally { Object.assign(tuning, saved); }
});

test('vehicle arrows hide after entering a parking spot', () => {
  for (const state of ['parked', 'colliding', 'moving-to-spot']) {
    assert.equal(shouldHideVehicleArrow(state), false, state);
  }
  for (const state of ['at-spot', 'boarding-final', 'departing', 'done']) {
    assert.equal(shouldHideVehicleArrow(state), true, state);
  }
  assert.match(sceneViewSource, /view\.userData\.arrowRoot\.visible = !hideArrowAtSpot/);
});

test('background asset selection remains editor-switchable with optimized variants', () => {
  const editorSource = readFileSync(join('src', 'scene-editor.js'), 'utf8');
  const viewSource = readFileSync(join('src', 'scene-view.js'), 'utf8');
  const mainSource = readFileSync(join('src', 'main.js'), 'utf8');
  const viteSource = readFileSync(join('vite.config.js'), 'utf8');
  const exporterSource = readFileSync(join('scripts', 'export-playable-package.mjs'), 'utf8');
  const generatorSource = readFileSync(join('scripts', 'generate-active-level.mjs'), 'utf8');
  const backgroundPath = join('public', SCENE_TUNING.background.asset.replace(/^\//, ''));
  const sakuraPath = join('public', 'assets', 'applovin', 'textures', 'BG01_split01_Sakura_q60.jpg');
  const grasslandPath = join('public', 'assets', 'applovin', 'textures', 'BG01_split01_Grassland_q60.jpg');

  assert.equal(SCENE_TUNING.background.asset, ACTIVE_LEVEL.assets.background);
  assert.ok(statSync(backgroundPath).size < 350_000);
  assert.deepEqual(readImageDimensions(readFileSync(backgroundPath)), { width: 2100, height: 3382 });
  assert.equal(SCENE_TUNING.background.scale, 1);
  assert.ok(statSync(sakuraPath).size < 350_000);
  assert.ok(statSync(grasslandPath).size < 350_000);
  assert.deepEqual(readImageDimensions(readFileSync(grasslandPath)), { width: 2100, height: 3382 });
  assert.match(editorSource, /BACKGROUND_OPTIONS/);
  assert.match(editorSource, /BG01_split01_q60\.jpg/);
  assert.match(editorSource, /BG02_split01_winter_q60\.jpg/);
  assert.match(editorSource, /BG02_split01_summer_q60\.jpg/);
  assert.match(editorSource, /BG01_split01_Sakura_q60\.jpg/);
  assert.match(editorSource, /BG01_split01_Grassland_q60\.jpg/);
  assert.match(editorSource, /'background\.scale', 0\.3, 3, 0\.01/);
  assert.match(editorSource, /CUSTOM_BACKGROUND_ENDPOINT = '\/__background-assets'/);
  assert.match(editorSource, /CUSTOM_BACKGROUND_OUTPUT_WIDTH = 2100/);
  assert.match(editorSource, /CUSTOM_BACKGROUND_OUTPUT_HEIGHT = 3382/);
  assert.match(editorSource, /prepareBackgroundUpload/);
  assert.match(editorSource, /editor-background-import/);
  assert.match(editorSource, /editor-background-delete/);
  assert.match(editorSource, /editor-background-rename/);
  assert.match(editorSource, /CUSTOM_BACKGROUND_ENDPOINT\}\/rename/);
  assert.match(editorSource, /if \(label\) option\.textContent = label/);
  assert.match(editorSource, /editor-background-reset/);
  assert.match(editorSource, /editor-background-download/);
  assert.match(editorSource, /fetch\(current, \{ cache: 'no-store' \}\)/);
  assert.match(editorSource, /URL\.createObjectURL\(blob\)/);
  assert.match(editorSource, /link\.download = getBackgroundDownloadFilename/);
  assert.match(editorSource, /CUSTOM_PRE_ROLL_ENDPOINT = '\/__pre-roll-assets'/);
  assert.match(editorSource, /editor-pre-roll-import/);
  assert.match(editorSource, /editor-pre-roll-rename/);
  assert.match(editorSource, /editor-pre-roll-delete/);
  assert.match(editorSource, /editor-pre-roll-download/);
  assert.match(editorSource, /getPreRollDownloadFilename/);
  assert.match(editorSource, /fetch\(current, \{ cache: 'no-store' \}\)/);
  assert.match(editorSource, /link\.download = getPreRollDownloadFilename/);
  assert.match(editorSource, /accept="video\/mp4,\.mp4"/);
  assert.match(viteSource, /BACKGROUND_ASSET_ROOT = path\.resolve\('artifacts', 'editor-backgrounds'\)/);
  assert.match(viteSource, /BACKGROUND_CANVAS_WIDTH = 2100/);
  assert.match(viteSource, /BACKGROUND_CANVAS_HEIGHT = 3382/);
  assert.match(viteSource, /pathname === '\/__background-assets\/import'/);
  assert.match(viteSource, /pathname === '\/__background-assets\/rename'/);
  assert.match(viteSource, /deleteEditorBackgroundAsset/);
  assert.match(viteSource, /\/assets\/editor-backgrounds\//);
  assert.match(viteSource, /PRE_ROLL_ASSET_ROOT = path\.resolve\('artifacts', 'editor-prerolls'\)/);
  assert.match(viteSource, /pathname === '\/__pre-roll-assets\/import'/);
  assert.match(viteSource, /pathname === '\/__pre-roll-assets\/rename'/);
  assert.match(viteSource, /deleteEditorPreRollAsset/);
  assert.match(viteSource, /\/assets\/editor-prerolls\//);
  assert.match(viteSource, /compressPreRollBuffer/);
  assert.match(viteSource, /PRE_ROLL_COMPRESSION_VERSION/);
  assert.match(viteSource, /MAX_PRE_ROLL_COMPRESSED_BYTES = PRE_ROLL_MAX_COMPRESSED_BYTES/);
  assert.match(viteSource, /migrateEditorPreRollAssets/);
  assert.match(readFileSync(join('scripts', 'pre-roll-transcoder.mjs'), 'utf8'), /libx264/);
  assert.match(readFileSync(join('scripts', 'pre-roll-transcoder.mjs'), 'utf8'), /PRE_ROLL_MAX_COMPRESSED_BYTES = 2 \* 1024 \* 1024/);
  assert.match(mainSource, /migrateCustomBackgroundSourceSize/);
  assert.match(mainSource, /CUSTOM_BACKGROUND_ASSET_PREFIX = '\/assets\/editor-backgrounds\/'/);
  assert.match(generatorSource, /EDITOR_BACKGROUND_PREFIX = '\/assets\/editor-backgrounds\/'/);
  assert.match(exporterSource, /copySelectedEditorBackground/);
  assert.match(exporterSource, /copySelectedEditorPreRoll/);
  assert.match(viewSource, /backgroundScale = Math\.max\(0\.01, Number\(background\?\.scale\) \|\| 1\)/);
  assert.match(viewSource, /width: Math\.max\(0\.01, Number\(background\?\.width\) \|\| 0\.01\) \* backgroundScale/);
  assert.match(viewSource, /this\.setArtworkPlaneTexture\(this\.backgroundPlane, getSelectedBackgroundUrl\(\)\)/);
});

test('vehicle generation region matches GameSceneDualQueue2 VehicleRoot Cube', () => {
  const area = SCENE_TUNING.vehicleArea;
  assert.deepEqual(area.sourceCube, {
    centerX: 0,
    centerZ: -0.5,
    width: 4,
    depth: 4.36
  });
  assert.equal(area.sourceRootZ, -2.92);
  assert.equal(area.unityToWorldScale, 2);
  assert.deepEqual({
    centerX: (area.sourceRootX + area.sourceCube.centerX) * area.unityToWorldScale,
    centerZ: (
      (area.sourceRootZ + area.sourceCube.centerZ)
      * area.unityToWorldScale
      * (area.mirrorZ ? -1 : 1)
    ),
    width: area.sourceCube.width * area.unityToWorldScale,
    depth: area.sourceCube.depth * area.unityToWorldScale
  }, {
    centerX: 0,
    centerZ: 6.84,
    width: 8,
    depth: 8.72
  });
  const halfWidth = area.sourceCube.width * area.unityToWorldScale * 0.5;
  const halfDepth = area.sourceCube.depth * area.unityToWorldScale * 0.5;
  for (const vehicle of LEVEL_1.vehicles) {
    const point = mapVehicleAreaPoint(vehicle);
    assert.ok(point.x >= -halfWidth && point.x <= halfWidth);
    assert.ok(point.z >= 6.84 - halfDepth && point.z <= 6.84 + halfDepth);
  }
});

test('vehicle area rotation uses the transformed vehicle-region center', () => {
  const area = SCENE_TUNING.vehicleArea;
  const pivot = getVehicleAreaPivot(area);
  const unitScale = area.positionUnitScale ?? LEVEL_1.mapScale;
  const worldScale = area.unityToWorldScale * (area.mirrorZ ? -1 : 1);
  const bounds = LEVEL_1.vehicles.reduce((box, vehicle) => {
    const x = ((vehicle.x - area.positionPivotX) * unitScale + area.positionPivotX + area.sourceRootX)
      * area.unityToWorldScale + area.offsetX;
    const z = ((vehicle.z - area.positionPivotZ) * unitScale + area.positionPivotZ + area.sourceRootZ)
      * worldScale + area.offsetZ;
    return {
      minX: Math.min(box.minX, x),
      maxX: Math.max(box.maxX, x),
      minZ: Math.min(box.minZ, z),
      maxZ: Math.max(box.maxZ, z)
    };
  }, { minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity });
  assert.ok(Math.abs(pivot.x - (bounds.minX + bounds.maxX) / 2) < 1e-9);
  assert.ok(Math.abs(pivot.z - (bounds.minZ + bounds.maxZ) / 2) < 1e-9);
  assert.match(sceneViewSource, /getVehicleAreaPivot\(area\)/);
  assert.match(gameModelSource, /resolveVehiclePathConfig\(this\.level, SCENE_TUNING, spots\)/);
  assert.match(sceneViewSource, /function mapVehicleAreaYaw\(yawDegrees\) \{[\s\S]*?return mirroredYaw - deg\(SCENE_TUNING\.vehicleArea\.rotationDegrees\);\r?\n\}/);
  // Full inverse-heading and cluster-pivot behaviour is covered numerically
  // across rotations/mirrors in vehicle-path-config.test.js.
  assert.match(gameModelSource, /createVehicleRouteTransform/);
});

test('editor sizing, source background ratio, and passenger shadow anchor stay wired', () => {
  const indexSource = readFileSync(join('index.html'), 'utf8');
  const stylesSource = readFileSync(join('src', 'styles.css'), 'utf8');
  const background = readFileSync(join('public', ACTIVE_LEVEL.assets.background.replace(/^\//, '')));
  const { width: sourceWidth, height: sourceHeight } = readImageDimensions(background);
  assert.equal(sourceWidth, 2100);
  assert.equal(sourceHeight, 3382);
  assert.equal(SCENE_TUNING.background.sourceWidth, sourceWidth);
  assert.equal(SCENE_TUNING.background.sourceHeight, sourceHeight);
  assert.equal(SCENE_TUNING.background.asset, ACTIVE_LEVEL.assets.background);
  assert.deepEqual(SCENE_TUNING.preview, { enabled: 1, width: 1080, height: 2160 });
  assert.deepEqual(SCENE_TUNING.sourceCrop, { enabled: 1, width: 1080, height: 2160, offsetX: 0, offsetY: 211 });
  assert.equal(SCENE_TUNING.parkingSpots.count, 4);
  // Auto-centring is on by default, so the row's left edge is derived from
  // count and spacing; startX only matters when the toggle is off.
  assert.equal(SCENE_TUNING.parkingSpots.autoCenter, 1);
  assert.equal(SCENE_TUNING.parkingSpots.startX, -1.5);
  assert.equal(SCENE_TUNING.parkingSpots.z, 0.55);
  assert.equal(SCENE_TUNING.parkingSpots.scaleX, 0.7);
  assert.equal(SCENE_TUNING.parkingSpots.scaleZ, 0.65);
  assert.equal(SCENE_TUNING.seatCountBoard.z, 1.37);
  assert.equal(SCENE_TUNING.seatCountBoard.width, 0.52);
  assert.equal(SCENE_TUNING.seatCountBoard.depth, 0.59);
  assert.equal(SCENE_TUNING.seatCountBoard.textScale, 1);
  assert.equal(SCENE_TUNING.vehicleArrow.offsetY, 0.04);
  assert.equal(SCENE_TUNING.vehicleArrow.outlineColor, 0x373a45);
  assert.equal(SCENE_TUNING.vehicleArrow.outlineScale, 1.05);
  assert.equal(SCENE_TUNING.vehicleArrow.outlineDepthTest, 0);
  assert.equal(SCENE_TUNING.vehicleShadows.depthBySeats[10], 2.05);
  assert.equal(SCENE_TUNING.vehicleShadows.color, 0xffffff);
  assert.deepEqual(SCENE_TUNING.vehicleShadows.scaleBySeats[10], { x: 0.8, z: 0.8 });
  assert.equal(SCENE_TUNING.camera.fovDegrees, 2.2);
  assert.equal(SCENE_TUNING.background.distanceOffset, 7);
  assert.equal(SCENE_TUNING.background.width, 14.1);
  assert.equal(SCENE_TUNING.background.height, 22.708);
  assert.equal(SCENE_TUNING.facing.passengerShadowYawDegrees, 90);
  assert.equal(SCENE_TUNING.passengers.modelScale, 1.25);
  assert.equal(SCENE_TUNING.passengers.groupSpacing, 0.16);
  assert.equal(SCENE_TUNING.passengerMaterial, undefined);
  assert.deepEqual(SCENE_TUNING.luxuryMaterial, {
    vehicleBrightness: 2.55,
    passengerBrightness: 1.9,
    boardBrightness: 1.15
  });
  assert.deepEqual(SCENE_TUNING.cta, {
    enabled: 1,
    text: '',
    x: 540,
    y: 2018,
    height: 110,
    stretchX: 3.18,
    fontSize: 63,
    fontHeight: 16,
    strokeColor: 0x196b07,
    strokeWidth: 4.4,
    pulseScale: 1.05,
    pulseSpeed: 0.21,
    appearSpeed: 1.45
  });
  assert.deepEqual(SCENE_TUNING.installGate, {
    enabled: 0,
    customThresholdEnabled: 0,
    successfulOperationThreshold: 64
  });
  assert.deepEqual(SCENE_TUNING.gameOver, {
    failureDelaySeconds: 2,
    maskOpacity: 0.6,
    titleFontSize: 96,
    titlePopSpeed: 1.12,
    titleFadeSpeed: 1.45,
    logoX: 533,
    logoY: 974,
    logoWidth: 645,
    logoHeight: 587,
    logoRadius: 30,
    logoAppearSpeed: 1.45,
    retryEnabled: 0,
    // What the red pill does: restart the round (default) or open the store.
    // Only a delivery that opts in changes it.
    retryAction: 'restart',
    retryX: 540,
    retryY: 1360,
    retryWidth: 420,
    retryFontSize: 53,
    retryAppearSpeed: 1.45
  });
  assert.deepEqual(LEVEL_1.passengerQueue, { spacing: 0.4, screenEdgeOffsetSpacing: 4 });
  assert.equal(LEVEL_1.conveyorPathLength, 4.591284809513923);
  assert.deepEqual(SCENE_TUNING.vehicleBoardingPulse, { scale: 1.09, speed: 11.7 });
  assert.equal(SCENE_TUNING.vehicleArea.sizeMultiplier, 1);
  assert.equal(SCENE_TUNING.vehicleGuideHand.enabled, 0);
  assert.equal(SCENE_TUNING.vehicleGuideHand.levelKey, 'level36');
  assert.equal(SCENE_TUNING.vehicleGuideHand.vehicleId, 1);
  assert.equal(SCENE_TUNING.vehicleGuideHand.size, 2.2);
  assert.equal(SCENE_TUNING.vehicleGuideHand.speed, 0.55);
  assert.equal(SCENE_TUNING.vehicleGuideHand.nearScale, 1);
  assert.equal(SCENE_TUNING.vehicleGuideHand.farScale, 1.14);
  assert.equal('conveyorScale' in SCENE_TUNING.passengers, false);
  assert.equal('queueScale' in SCENE_TUNING.passengers, false);
  // `instanced` is the draw-call switch for the shadow batch, not a shadow
  // anchor; the three kind anchors keep their keys so the editor fields and
  // `updatePassengerShadowObject` keep resolving.
  assert.deepEqual(Object.keys(SCENE_TUNING.passengerShadows), ['instanced', 'conveyor', 'leftQueue', 'rightQueue']);
  assert.equal(SCENE_TUNING.passengerShadows.instanced, 1);
  assert.ok(publicAssetExists('/assets/icon-android.jpg'));
  assert.ok(publicAssetExists('/assets/icon-ios.png'));
  assert.ok(publicAssetExists('/assets/icon-crowd.jpg'));
  assert.ok(publicAssetExists('/assets/main-loading-icon-crowd.webp'));
  assert.ok(publicAssetExists('/assets/main-guide-hand.png'));
  assert.ok(publicAssetExists('/assets/unity/ui/Main_Prop_GreenBtn.png'));
  assert.ok(publicAssetExists('/assets/unity/ui/Main_Prop_RedBtn_blank_q90.webp'));
  assert.match(indexSource, /id="loading-screen"/);
  assert.match(indexSource, /id="game-over-overlay"/);
  assert.match(indexSource, /Game Over/);
  assert.match(indexSource, /id="game-over-logo"/);
  assert.match(indexSource, /id="game-over-retry"/);
  assert.match(indexSource, /id="cta-button"/);
  assert.match(indexSource, /<div id="game-over-overlay"[\s\S]*?<\/div>\s*<button id="cta-button"/);
  assert.match(indexSource, /Play Now/);
  assert.match(indexSource, /Bus Fever Party!/);
  assert.match(indexSource, /\/assets\/main-loading-icon-small\.png/);
  assert.match(indexSource, /role="progressbar"/);
  assert.match(indexSource, /id="loading-progress-bar"/);
  assert.match(indexSource, /id="loading-progress-value"/);
  assert.match(stylesSource, /\.loading-screen/);
  assert.match(stylesSource, /\.loading-screen\.is-hidden/);
  assert.match(stylesSource, /\.loading-progress/);
  assert.match(stylesSource, /\.loading-progress-bar/);
  assert.match(stylesSource, /Main_Prop_GreenBtn\.png/);
  assert.match(stylesSource, /\.game-over-overlay/);
  assert.match(stylesSource, /--game-over-mask-opacity/);
  assert.match(stylesSource, /\.game-over-title \{[\s\S]*?'Poppins Branding'/);
  assert.match(stylesSource, /object-fit: contain/);
  assert.match(stylesSource, /\.game-over-logo \{[\s\S]*?box-shadow: none;/);
  assert.match(stylesSource, /@keyframes game-over-title-pop/);
  assert.match(stylesSource, /\.game-over-overlay\.is-cta-ready \.game-over-logo/);
  assert.match(stylesSource, /\.cta-button \{[\s\S]*?opacity: 1;/);
  assert.match(stylesSource, /@keyframes cta-pulse/);
  assert.match(stylesSource, /--cta-stroke-color/);
  assert.match(stylesSource, /\.cta-button:hover \{/);
  // The tuned CTA line height is far shorter than its font size, so a wrapped
  // label would overlap its own lines. The button must forbid wrapping.
  assert.match(stylesSource, /\.cta-button \{[\s\S]*?white-space: nowrap;/);
  assert.match(stylesSource, /background: transparent url\('\/assets\/unity\/ui\/Main_Prop_GreenBtn\.png'\) center \/ 100% 100% no-repeat/);

  const editorSource = readFileSync(join('src', 'scene-editor.js'), 'utf8');
  assert.match(editorSource, /preview\.width/);
  assert.match(editorSource, /preview\.height/);
  assert.match(editorSource, /lighting\.directional\.enabled/);
  assert.match(editorSource, /cta\.x/);
  assert.match(editorSource, /cta\.y/);
  assert.doesNotMatch(editorSource, /cta\.world[XYZ]/);
  assert.match(editorSource, /cta\.stretchX/);
  assert.match(editorSource, /cta\.fontSize/);
  assert.match(editorSource, /cta\.fontHeight/);
  assert.match(editorSource, /cta\.strokeColor/);
  assert.match(editorSource, /cta\.pulseScale/);
  assert.match(editorSource, /cta\.appearSpeed/);
  assert.match(editorSource, /installGate\.successfulOperationThreshold/);
  assert.match(editorSource, /gameOver\.maskOpacity/);
  assert.match(editorSource, /gameOver\.failureDelaySeconds/);
  assert.doesNotMatch(editorSource, /gameOver\.titleFontFamily/);
  assert.match(editorSource, /gameOver\.titleFontSize/);
  assert.match(editorSource, /gameOver\.logoX/);
  assert.match(editorSource, /gameOver\.logoAppearSpeed/);
  // Retry owns a dedicated, open-by-default section so the on/off switch is not
  // buried at the bottom of the collapsed Game Over group.
  assert.match(editorSource, /title: '\\u5931\\u8d25\\u91cd\\u8bd5',\s*\n\s*defaultOpen: true/);
  assert.match(editorSource, /gameOver\.retryEnabled/);
  assert.match(editorSource, /gameOver\.retryX/);
  assert.match(editorSource, /gameOver\.retryWidth/);
  assert.match(editorSource, /gameOver\.retryAppearSpeed/);
  assert.match(editorSource, /lighting\.directional\.color/);
  assert.match(editorSource, /lighting\.directional\.intensity/);
  assert.match(editorSource, /lighting\.directional\.position\.x/);
  assert.match(editorSource, /lighting\.directional\.eulerDegrees\.x/);
  assert.doesNotMatch(editorSource, /lighting\.directional\.shadowType/);
  assert.doesNotMatch(editorSource, /lighting\.directional\.shadowStrength/);
  assert.doesNotMatch(editorSource, /lighting\.realtimeShadows/);
  assert.match(editorSource, /effects\.hit\.sizeScale/);
  assert.match(editorSource, /effects\.hit\.particleHit2SizeScale/);
  assert.match(editorSource, /sourceCrop\.offsetX/);
  assert.match(editorSource, /sourceCrop\.offsetY/);
  assert.match(editorSource, /passengers\.modelScale/);
  assert.match(editorSource, /passengers\.groupSpacing/);
  assert.doesNotMatch(editorSource, /passengerMaterial\.|Passenger Material/);
  assert.doesNotMatch(editorSource, /luxuryMaterialDebug|富豪材质调试/);
  assert.match(editorSource, /editor-select/);
  assert.match(editorSource, /rangeMarkup = isColor/);
  assert.match(editorSource, /setTuning\(next, \{ path \}\)/);
  assert.match(editorSource, /color\?\.addEventListener\('change'/);
  assert.match(editorSource, /conveyorLayout\.selected/);
  assert.match(editorSource, /dualQueue2/);
  assert.match(editorSource, /dualQueue3/);
  assert.match(editorSource, /dualQueue5/);
  assert.match(editorSource, /dualQueue10/);
  assert.match(editorSource, /conveyorLayouts\.\$\{layoutId\}/);
  assert.match(editorSource, /updateConveyorLayoutVisibility/);
  assert.match(editorSource, /passengerShadows\.conveyor\.scaleX/);
  assert.match(editorSource, /passengerShadows\.leftQueue\.offsetX/);
  assert.match(editorSource, /passengerShadows\.rightQueue\.offsetZ/);
  assert.match(editorSource, /parkingSpots\.scaleX/);
  assert.match(editorSource, /parkingSpots\.scaleZ/);
  assert.match(editorSource, /seatCountBoard\.z/);
  assert.match(editorSource, /seatCountBoard\.width/);
  assert.match(editorSource, /seatCountBoard\.depth/);
  assert.match(editorSource, /seatCountBoard\.textScale/);
  assert.match(editorSource, /vehicleArrow\.offsetY/);
  assert.match(editorSource, /vehicleArrow\.outlineColor/);
  assert.match(editorSource, /vehicleShadows\.color/);
  assert.match(editorSource, /vehicleArrow\.outlineScale/);
  assert.match(editorSource, /vehicleArrow\.outlineDepthTest/);
  assert.match(editorSource, /vehicleArea\.offsetX/);
  assert.match(editorSource, /vehicleArea\.offsetZ/);
  // Editor labels are written as \uXXXX escapes in the generated panel source.
  assert.match(editorSource, /\\u8f66\\u9635\\u6574\\u4f53\\u5de6\\u53f3/);
  assert.match(editorSource, /\\u8f66\\u9635\\u6574\\u4f53\\u4e0a\\u4e0b/);
  assert.match(editorSource, /vehicleArea\.rotationDegrees/);
  assert.match(editorSource, /\\u8f66\\u8f86\\u6574\\u4f53\\u65cb\\u8f6c/);
  assert.match(editorSource, /vehicleArea\.positionUnitScale/);
  assert.match(editorSource, /Map Scale/);
  assert.match(editorSource, /vehicleArea\.sizeMultiplier/);
  assert.match(editorSource, /vehiclePath\.parkingBounds\.minX', -12, 0/);
  assert.match(editorSource, /vehicleGuideHand\.enabled/);
  assert.match(editorSource, /vehicleGuideHand\.vehicleId/);
  assert.match(editorSource, /vehicleGuideHand\.offsetX/);
  assert.match(editorSource, /vehicleGuideHand\.approachOffsetX/);
  assert.match(editorSource, /vehicleGuideHand\.size/);
  assert.match(editorSource, /vehicleGuideHand\.nearScale/);
  assert.match(editorSource, /vehicleGuideHand\.farScale/);
  assert.match(editorSource, /vehicleGuideHand\.speed/);

  const viewSource = readFileSync(join('src', 'scene-view.js'), 'utf8');
  assert.match(viewSource, /new THREE\.PerspectiveCamera/);
  assert.doesNotMatch(viewSource, /new THREE\.OrthographicCamera/);
  assert.match(viewSource, /directionalLightDirection/);
  assert.match(viewSource, /SCENE_TUNING\.lighting\?\.directional/);
  assert.match(viewSource, /directionalLight\.visible = Boolean\(directional\.enabled/);
  assert.doesNotMatch(viewSource, /renderer\.shadowMap/);
  assert.doesNotMatch(viewSource, /new THREE\.ShadowMaterial/);
  assert.doesNotMatch(viewSource, /Realtime Shadow/);
  assert.doesNotMatch(viewSource, /shadowFocus/);
  assert.doesNotMatch(viewSource, /shadowLightDistance/);
  assert.doesNotMatch(viewSource, /realtimeShadowMaterial/);
  assert.doesNotMatch(viewSource, /receiverDebugEnabled/);
  assert.doesNotMatch(viewSource, /applyRealtimeShadowFlags/);
  assert.doesNotMatch(viewSource, /configureVehicleRealtimeShadow/);
  assert.doesNotMatch(viewSource, /configurePassengerRealtimeShadow/);
  assert.doesNotMatch(viewSource, /unityShadowStrength/);
  assert.doesNotMatch(viewSource, /new THREE\.DirectionalLight\(0xfff7ea, 2\.7\)/);
  assert.doesNotMatch(viewSource, /sun\.position\.set\(-5, 12, 7\)/);
  assert.match(viewSource, /this\.camera\.add\(this\.backgroundPlane\)/);
  assert.match(viewSource, /getSelectedConveyorLayout/);
  assert.match(viewSource, /MAX_CONVEYOR_CAPACITY/);
  assert.match(viewSource, /MAX_QUEUE_CAPACITY/);
  assert.match(viewSource, /layout\.splinePoints/);
  assert.match(viewSource, /layout\.queuePaths/);
  assert.match(viewSource, /setArtworkPlaneTexture/);
  assert.match(viewSource, /calculateConveyorEntryPercents/);
  assert.match(viewSource, /getConveyorConfig/);
  assert.match(viewSource, /backgroundDistance = distance \+ background\.distanceOffset/);
  assert.doesNotMatch(viewSource, /coverScale/);
  assert.match(viewSource, /backgroundWidth = layoutBackground\.width/);
  assert.match(viewSource, /resolveResponsiveCropFit/);
  assert.match(viewSource, /resolveCameraFit/);
  // Crop-enabled fit uses the design-cover half height (no padding); the
  // non-crop fit keeps the tuned camera padding.
  assert.match(viewSource, /const halfHeight = cropEnabled\s+\? calculateDesignCoverHalfHeight/);
  assert.match(viewSource, /: calculateOrthographicHalfHeight\(\{[\s\S]*?padding: camera\.padding/);
  assert.match(viewSource, /responsiveCrop\.cropOffsetX/);
  assert.match(viewSource, /responsiveCrop\.cropOffsetY/);
  assert.match(viewSource, /parkingSpotYawDegrees \+ 180/);
  assert.match(viewSource, /makeVehicleShadow\(isLuxury \? 10 : vehicle\.seats\)/);
  assert.match(viewSource, /prepareVehicleShadowTemplate\(vanShadowFbx, 6\)/);
  assert.match(viewSource, /prepareVehicleShadowTemplate\(busShadowFbx, 10\)/);
  assert.match(viewSource, /SCENE_TUNING\.vehicleShadows\.depthBySeats\?\.\[seats\]/);
  assert.match(viewSource, /SCENE_TUNING\.vehicleShadows\.scaleBySeats\?\.\[seats\]/);
  assert.match(viewSource, /SCENE_TUNING\.vehicleShadows\.color/);
  assert.match(viewSource, /material\.color\.setHex\(SCENE_TUNING\.vehicleShadows\.color/);
  assert.match(viewSource, /seats === '10' \? 0\.8/);
  assert.doesNotMatch(viewSource, /passengerColorTextures|assets\.colorTextures|tintVehicleTexture/);
  assert.match(viewSource, /createVehiclePaintMaterial\(paint\.surfaces\)/);
  assert.match(viewSource, /applyArrowOutlineTuning/);
  assert.match(viewSource, /outlineBaseScale/);
  assert.match(viewSource, /new THREE\.EdgesGeometry/);
  assert.match(viewSource, /addArrowOutline\(this\.arrowTemplate, \{/);
  assert.match(viewSource, /const hitRoot = new THREE\.Group\(\)/);
  assert.match(viewSource, /view\.userData\.hitMeshes = \[hitRoot\]/);
  assert.match(viewSource, /view\.userData\.pickMeshes = vehicle\.isHidden \? hiddenBodyMeshes : bodyMeshes/);
  assert.match(viewSource, /hitRoot\.add\(normalRoot, hiddenRevealRoot\)/);
  assert.match(viewSource, /intersectObjects\(pickMeshes, true\)/);
  // The parked-to-route resize must go through the shared helper, so the live
  // scene and the authoring views agree on which cars carry the multiplier.
  assert.match(viewSource, /parkedVehicleSizeMultiplier\(vehicle, SCENE_TUNING\.vehicleArea\)/);
  assert.match(viewSource, /getVehicleSizeMultiplier\(vehicle\)/);
  assert.match(viewSource, /GUIDE_HAND_TEXTURE_URL/);
  assert.match(viewSource, /new THREE\.SpriteMaterial/);
  assert.match(viewSource, /buildGuideHand/);
  assert.match(viewSource, /updateGuideHandTuning/);
  assert.match(viewSource, /updateGuideHand\(snapshot\.time, snapshot\)/);
  assert.match(viewSource, /const isMovable = vehicle\.state === 'parked'/);
  assert.match(viewSource, /\(tuning\.size \?\? 1\) \* THREE\.MathUtils\.lerp/);
  assert.match(viewSource, /initialEntryPathStates/);
  assert.match(viewSource, /getInitialEntryPathVisual/);
  assert.match(viewSource, /fullQueueCurves/);
  assert.match(viewSource, /updateQueueCurvesForCamera/);
  assert.match(viewSource, /makeVisibleQueueCurve/);
  assert.match(viewSource, /getQueueProgressAtDistance/);
  assert.match(viewSource, /getQueueCapacities/);
  assert.match(viewSource, /getConveyorSlotSpacing/);
  assert.match(viewSource, /getQueueLengths/);
  assert.match(viewSource, /this\.ready = this\.loadUnityAssets\(\)/);
  assert.match(viewSource, /new THREE\.LoadingManager\(\)/);
  assert.match(viewSource, /onLoadingProgress/);
  assert.match(viewSource, /loadVatGeometry\(modelPaths\.passengerVatMesh, this\.loadingManager\)/);
  assert.match(viewSource, /getConveyorPathLength/);
  assert.match(viewSource, /item\.distanceFromHead/);
  assert.doesNotMatch(viewSource, /getQueueProgressAtDistance\(curve, i \* this\.getQueueSpacing\(\)/);
  assert.doesNotMatch(viewSource, /getVisibleQueueCapacity/);
  assert.doesNotMatch(viewSource, /visibleCapacity/);
  assert.match(viewSource, /this\.camera\.updateMatrixWorld\(true\)/);
  // The queue-to-belt walk is a fixed-duration blend that samples the belt curve,
  // so the passenger hugs the track instead of cutting across it. It used to
  // advance a private `distance` toward a moving target, which only converged
  // while the belt was slower than a walking passenger; at the 4x initial fill
  // the target outran the walk and every entering passenger shivered in place.
  assert.match(viewSource, /queueProgress = THREE\.MathUtils\.clamp\(/);
  assert.match(viewSource, /walkedPercent = \(entryPercent \+ span \* blend \+ 1\) % 1/);
  assert.match(viewSource, /elapsed \/ walkSeconds/);
  assert.doesNotMatch(viewSource, /state\.distance \+ stepDistance/);
  assert.doesNotMatch(viewSource, /slot\.entryMotion\.initialFill\) \{/);
  assert.doesNotMatch(viewSource, /view\.visible = !snapshot\.initialFillActive/);
  assert.doesNotMatch(viewSource, /view\.visible = .*hasActiveInitialEntryVisual/);
  assert.match(viewSource, /colorIndex !== undefined/);
  assert.match(viewSource, /hooks = \{\}/);
  assert.match(viewSource, /onPassengerAboard/);
  assert.match(viewSource, /passengers\.modelScale/);
  assert.match(viewSource, /for \(let index = snapshot\.slots\.length; index < this\.passengerViews\.length; index \+= 1\)/);
  assert.match(viewSource, /passengers\.groupSpacing/);
  assert.match(viewSource, /slot\.position\.x = \(index - 1\.5\) \* spacing/);
  assert.doesNotMatch(viewSource, /conveyorScale/);
  assert.doesNotMatch(viewSource, /queueScale/);
  assert.match(viewSource, /passengerShadowYawDegrees/);
  assert.match(viewSource, /personPivot\.add\(personClone\)/);
  assert.match(viewSource, /root\.add\(shadow, personPivot\)/);
  assert.match(viewSource, /slot\.add\(visual\)/);
  assert.doesNotMatch(viewSource, /person\.position\.y = SCENE_TUNING\.shadows\.y/);
});

test('passenger aboard sound offset shifts only the audio trigger, not the visual arrival', () => {
  const viewSource = readFileSync(join('src', 'scene-view.js'), 'utf8');
  const editorSource = readFileSync(join('src', 'scene-editor.js'), 'utf8');
  const mainSource = readFileSync(join('src', 'main.js'), 'utf8');
  assert.equal(SCENE_TUNING.passengers.aboardSoundOffset, -0.25);
  assert.match(viewSource, /passengers\.aboardSoundOffset/);
  assert.match(viewSource, /const soundAt = entry\.startedAt \+ entry\.delay \+ entry\.duration \+ soundOffset/);
  assert.match(viewSource, /if \(!entry\.soundPlayed && time >= soundAt\)/);
  assert.match(viewSource, /this\.pendingBoardingSounds\.push\(\{ vehicleId: entry\.vehicleId, triggerAt: soundAt \}\)/);
  assert.match(viewSource, /this\.pendingBoardingSounds\.length = 0/);
  assert.match(editorSource, /passengers\.aboardSoundOffset/);
  // Saved tuning and the per-level profile snapshots still hold the previous
  // default (0), so both caches must realign to the new one on load.
  assert.match(mainSource, /migrateAboardSoundOffsetTuning/);
  assert.match(mainSource, /passengers\.aboardSoundOffset = -0\.25/);
  assert.match(mainSource, /migrateAboardSoundOffsetProfiles\(\)/);
});

test('fallback colors remain available before Unity color textures finish loading', () => {
  assert.equal(COLORS[0].hex, 0x0061e8);
  assert.equal(COLORS[1].hex, 0x118024);
  assert.equal(COLORS[2].hex, 0xf338af);
  assert.equal(COLORS[3].hex, 0x9725cd);
  assert.equal(COLORS[4].hex, 0xb10f11);
  assert.equal(COLORS[5].hex, 0xc68000);
  assert.equal(COLORS[6].hex, 0xc24300);
  assert.equal(COLORS[7].hex, 0x014853);
  assert.equal(COLORS[8].hex, 0x542c16);
  assert.equal(COLORS[9].hex, 0x206d53);
  assert.equal(COLORS[10].hex, 0x15209e);
  assert.equal(COLORS[11].hex, 0x1b2638);
  assert.equal(COLORS[12].hex, 0xb10f11);
  assert.equal(COLORS[14].hex, 0xffd8c8);
  assert.equal(COLORS[15].hex, 0xd7b477);
  assert.match(sceneViewSource, /color: resolveVehiclePaint\(vehicle\)\.body/);
});

test('scene view keeps luxury vehicles and passengers on their dedicated visual path', () => {
  assert.match(sceneViewSource, /LUXURY_COLOR_INDEX = 15/);
  assert.match(sceneViewSource, /loadLuxuryAssets\(\)/);
  assert.match(sceneViewSource, /MECHANISM_ASSETS\.luxuryVehicle/);
  assert.match(sceneViewSource, /MeshMatcapMaterial/);
  assert.match(sceneViewSource, /MECHANISM_ASSETS\.luxuryVehicle/);
  assert.match(sceneViewSource, /cloneSkeleton\(person\)/);
  assert.match(sceneViewSource, /passengerFbx\.rotation\.x = -Math\.PI \/ 2/);
  assert.doesNotMatch(sceneViewSource, /LUXURY_ASSETS\.passengerVat/);
  assert.match(sceneViewSource, /luxuryPassengerMaterial/);
  assert.match(sceneViewSource, /isLuxuryPassenger/);
  assert.match(sceneViewSource, /LUXURY_PASSENGER_YAW_OFFSET_DEGREES = 90/);
  assert.match(sceneViewSource, /LUXURY_PASSENGER_MODEL_ROTATION_DEGREES = Object\.freeze\(\{[\s\S]*x: 90,[\s\S]*y: 0,[\s\S]*z: -90/);
  assert.match(sceneViewSource, /LUXURY_PASSENGER_VISUAL_OFFSET = Object\.freeze\(\{[\s\S]*x: -0\.12,[\s\S]*y: 0,[\s\S]*z: 0/);
  assert.match(sceneViewSource, /visualOffsetRoot\.position\.set\(\s*LUXURY_PASSENGER_VISUAL_OFFSET\.x/);
  assert.match(sceneViewSource, /const modelYaw = useLuxuryPassenger\s*\?\s*LUXURY_PASSENGER_YAW_OFFSET_DEGREES/);
  assert.doesNotMatch(sceneViewSource, /luxuryPassengerRotation/);
  assert.match(sceneViewSource, /object\.userData\.modelPivot\.rotation\.set/);
  assert.match(sceneViewSource, /sampleUnityQuaternionCurve/);
  assert.doesNotMatch(sceneViewSource, /LUXURY_PASSENGER_MODEL_ROTATION_X/);
  assert.match(sceneViewSource, /map: passengerTexture,[\s\S]*matcap: vehicleTexture/);
  assert.match(sceneViewSource, /map: passengerTexture,[\s\S]*matcap: vehicleMetalTexture/);
  assert.match(sceneViewSource, /LUXURY_VEHICLE_DIFFUSE_STRENGTH = 0\.65/);
  assert.match(sceneViewSource, /LUXURY_VEHICLE_BASE_EMISSION = Object\.freeze/);
  assert.match(sceneViewSource, /LUXURY_VEHICLE_METAL_EMISSION = Object\.freeze/);
  assert.match(sceneViewSource, /LUXURY_VEHICLE_MATCAP_BRIGHTNESS = 4\.1/);
  assert.match(sceneViewSource, /emissiveMap: passengerTexture/);
  assert.match(sceneViewSource, /LUXURY_PASSENGER_CLOTH_EMISSION/);
  assert.match(sceneViewSource, /boardTexture \? 0xffffff : config\.background/);
  assert.match(sceneViewSource, /luxuryMaterial/);
  assert.match(sceneViewSource, /updateLuxuryMaterialTuning/);
  assert.match(sceneViewSource, /busloopUnityMatcapBrightness/);
  assert.match(sceneViewSource, /luxuryPassengerBody/);
  assert.match(sceneViewSource, /filter\(\(visual\) => visual\?\.userData\.isLuxuryPassenger\)/);
  assert.match(sceneViewSource, /applyLuxuryPassengerBrightness\(visual\.userData\.material/);
});

test('luxury passenger animation payload preserves both Unity clips', () => {
  const animations = JSON.parse(readFileSync(join(
    'public', 'assets', 'unity', 'mechanisms', 'luxury-vehicle', 'animations', 'wealthy-passenger.json'
  ), 'utf8'));
  assert.equal(animations.sampleRate, 30);
  assert.equal(animations.clips.idle.duration, 2);
  assert.equal(animations.clips.move.duration, 0.60000014);
  assert.equal(Object.keys(animations.clips.idle.curves).length, 22);
  assert.equal(Object.keys(animations.clips.move.curves).length, 22);
  assert.ok(Object.values(animations.clips.move.curves).some((keys) => keys.length > 2));
});

test('Unity VAT mesh matches the authored animation texture layout', () => {
  const mesh = decodeOptionalGzipAsset(readFileSync(join('public', LEVEL_1.assets.models.passengerVatMesh.replace(/^\//, ''))));
  assert.equal(mesh.subarray(0, 4).toString('ascii'), 'VATM');
  assert.equal(mesh.readUInt32LE(8), 471);
  assert.equal(mesh.readUInt32LE(12), 2007);
  const texture = decodeOptionalGzipAsset(readFileSync(join('public', LEVEL_1.assets.models.passengerVatTexture.replace(/^\//, ''))));
  assert.equal(texture.length, 512 * 128 * 4 * 2);
});

test('luxury passenger model is a packed FBX with the authored VAT resources retained', () => {
  const passengerModel = readFileSync(join('public', 'assets', 'unity', 'mechanisms', 'luxury-vehicle', 'models', 'Idle_wealthy.fbx.bin'));
  assert.equal(passengerModel[0], 0x1f);
  assert.equal(passengerModel[1], 0x8b);
  const mesh = decodeOptionalGzipAsset(readFileSync(join('public', 'assets', 'unity', 'mechanisms', 'luxury-vehicle', 'models', 'Idle_wealthy_vatmesh.bin')));
  assert.equal(mesh.subarray(0, 4).toString('ascii'), 'VATM');
  assert.equal(mesh.readUInt32LE(8), 824);
  assert.equal(mesh.readUInt32LE(12), 3606);
  const texture = readFileSync(join('public', 'assets', 'unity', 'mechanisms', 'luxury-vehicle', 'models', 'Idle_wealthy_anim_map.vatq'));
  assert.equal(texture.subarray(0, 4).toString('ascii'), 'VATQ');
  assert.equal(texture.readUInt32LE(8), 824);
  assert.equal(texture.readUInt32LE(12), 77);
});

test('initial blocker graph uses current geometry while retaining Unity vehicleDepthes as provenance', () => {
  const game = new BusLoopGame();
  const movable = LEVEL_1.vehicles
    .filter((vehicle) => game.getBlockers(vehicle.id).length === 0)
    .map((vehicle) => vehicle.id);
  assert.deepEqual(movable, LEVEL12_INITIAL_MOVABLE_IDS);
  assert.equal(Object.keys(LEVEL_1.vehicleDepthes).length, 90);
  assert.deepEqual(LEVEL_1.vehicleDepthes[2], [1, 3]);
  assert.deepEqual(game.getBlockers(1), []);
  assert.deepEqual(game.getBlockers(2), [1, 3]);
  assert.deepEqual(game.getBlockers(3), [1]);
  assert.deepEqual(game.getBlockers(5), [1, 2, 3]);
});

test('runtime geometry unlocks a blocked car as its direct blocker leaves', () => {
  const game = new BusLoopGame();
  assert.deepEqual(game.getBlockers(LEVEL12_BLOCKED_ID), [1]);
  game.getVehicle(1).state = 'moving-to-spot';
  assert.deepEqual(game.getBlockers(LEVEL12_BLOCKED_ID), []);
  assert.deepEqual(game.clickVehicle(LEVEL12_BLOCKED_ID), { ok: true, spotIndex: 0 });
});

test('dispatch reserves the first spot and unlocks cars behind it', () => {
  const game = new BusLoopGame();
  assert.equal(game.clickVehicle(LEVEL12_BLOCKED_ID).reason, 'blocked');
  assert.deepEqual(game.clickVehicle(LEVEL12_DISPATCH_ID), { ok: true, spotIndex: 0 });
  assert.equal(game.snapshot().spots[0].vehicleId, LEVEL12_DISPATCH_ID);
  assert.deepEqual(game.getBlockers(LEVEL12_BLOCKED_ID), []);
});

test('blocked click uses Unity collision advance, contact hit, and return phases', () => {
  const game = new BusLoopGame();
  assert.equal(game.clickVehicle(LEVEL12_BLOCKED_ID).reason, 'blocked');
  const attacker = game.getVehicle(LEVEL12_BLOCKED_ID);
  assert.equal(attacker.state, 'colliding');
  assert.equal(attacker.collision.targetId, 1);
  // The bump travel is the collision gap PLUS both cars' model-vs-collision
  // overhang. Measured in the running scene the rendered body is 1.141x its
  // collision length, so the raw gap (0.00842) is widened by two cars' worth of
  // that sliver. Deriving it from `modelDepthBySeats x modelScale` instead
  // overstates it 22% and drives the bumper into the blocker.
  assert.equal(Number(attacker.collision.distance.toFixed(5)), 0.07491);
  assert.ok(attacker.collision.forwardDuration >= 0.01,
    `bump must stay visible, got ${attacker.collision.forwardDuration}s`);
  // The real geometric gap still travels with the animation for diagnostics.
  assert.equal(Number(attacker.collision.actualDistance.toFixed(5)), 0.00842);
  const forwardDuration = attacker.collision.forwardDuration;
  advance(game, forwardDuration + .01, .005);
  assert.ok(game.getVehicle(1).hit);
  assert.equal(chooseHitClip(game.getVehicle(1).hit), 'back');
  advance(game, .5);
  assert.equal(attacker.state, 'parked');
  assert.equal(attacker.collision, null);
});

test('side impacts flash on the struck panel in the bumper lane, including off-centre hits', () => {
  const scene = Object.create(SceneView.prototype);
  scene.staticVehicleTransforms = new Map();
  scene.vehicleViews = new Map();
  const field = new THREE.Group();
  field.position.z = 0.7;
  function place(id, x, z, yaw) {
    const pose = scene.getStaticVehicleTransform({ id, x, z, yaw });
    const view = new THREE.Group();
    view.position.copy(pose.position);
    view.rotation.y = pose.yaw;
    field.add(view);
    scene.vehicleViews.set(id, view);
    return view;
  }
  const target = place(1, 0, 0, 0);
  target.userData.templateSize = new THREE.Vector3(0.6, 0.5, 1.8);
  target.scale.setScalar(1.2);
  for (const [id, sign] of [[2, 1], [3, -1]]) {
    const z = sign * 0.23;
    const attacker = place(id, -sign, z, sign * 90);
    const flash = scene.resolveHitContact(id, { targetId: 1, contactPosition: { x: -sign * 0.18, z } });
    const forward = attacker.getWorldDirection(new THREE.Vector3());
    const toFlash = flash.clone().sub(attacker.getWorldPosition(new THREE.Vector3()));
    assert.ok(toFlash.clone().cross(forward).length() < 1e-8, 'burst stays in this bumper lane');
    const fromCenter = flash.clone().sub(target.getWorldPosition(new THREE.Vector3()));
    assert.ok(Math.abs(fromCenter.dot(forward) + 0.36) < 1e-8, 'burst lands on the incoming side');
  }
});

test('a struck body leans and slides with the impact, rebounds, then settles', () => {
  const { vehicleArea, facing } = SCENE_TUNING;
  const original = [vehicleArea.mirrorZ, vehicleArea.rotationDegrees, facing.vehicleYawOffsetDegrees];
  try {
    for (const mirror of [true, false]) {
      for (const offset of [0, 90]) {
        [vehicleArea.mirrorZ, vehicleArea.rotationDegrees, facing.vehicleYawOffsetDegrees] = [mirror, 32, offset];
        for (const [sourceYaw, targetYaw] of [[90, 0], [-90, 180], [0, 90], [180, -90], [45, 45], [45, 225]]) {
          const scene = Object.create(SceneView.prototype);
          scene.staticVehicleTransforms = new Map();
          const yaw = scene.getStaticVehicleTransform({ id: 1, x: 0, z: 0, yaw: targetYaw }).yaw;
          const travelYaw = THREE.MathUtils.degToRad((mirror ? 180 - sourceYaw : sourceYaw) - 32);
          const travel = new THREE.Vector3(Math.sin(travelYaw), 0, Math.cos(travelYaw));
          const body = new THREE.Group();
          const view = new THREE.Group();
          view.rotation.y = yaw;
          view.add(body);
          view.userData.hitMeshes = [body];
          body.userData.hitBasePosition = body.position.clone();
          body.userData.hitBaseRotation = body.rotation.clone();
          const hit = { startedAt: 0, ...getHitDirection({ yaw: sourceYaw }, { yaw: targetYaw }) };
          for (const [time, sign] of [[0.05, 1], [0.18, -1]]) {
            scene.applyVehicleHit(view, { hit }, time);
            const up = new THREE.Vector3(0, 1, 0).applyQuaternion(body.getWorldQuaternion(new THREE.Quaternion()));
            assert.ok(up.dot(travel) * sign > 0.01, 'roof tilts in the expected direction');
            assert.ok(body.getWorldPosition(new THREE.Vector3()).dot(travel) * sign > 0, 'body shifts with the roof');
          }
          scene.applyVehicleHit(view, { hit }, 0.5);
          assert.equal(body.position.length(), 0);
          assert.equal(body.rotation.x, 0);
          assert.equal(body.rotation.z, 0);
        }
      }
    }
  } finally {
    [vehicleArea.mirrorZ, vehicleArea.rotationDegrees, facing.vehicleYawOffsetDegrees] = original;
  }
});

test('every blocked tap animates a visible bump, even when the gap is zero', () => {
  // Diagonal neighbours can sit flush against the nose, so the geometric gap is
  // 0. Without a floor the bump collapsed to `getCollisionMotion`'s 1 ms minimum
  // and the car appeared frozen. Walk every parked car of the shipped levels and
  // assert the scheduled forward phase is long enough to be seen.
  let blocked = 0;
  for (const [key, level] of Object.entries(LEVEL_CATALOG)) {
    if (!level?.vehicles?.length) continue;
    let game;
    try { game = new BusLoopGame(level); } catch { continue; }
    for (const id of game.vehicles.filter((v) => v.state === 'parked').map((v) => v.id)) {
      const vehicle = game.getVehicle(id);
      if (!vehicle || vehicle.state !== 'parked') continue;
      const result = game.clickVehicle(id);
      if (result.ok || result.reason !== 'blocked') continue;
      blocked += 1;
      assert.ok(
        Number(vehicle.collision?.forwardDuration) >= 0.01,
        `${key} vehicle ${id} bump was ${vehicle.collision?.forwardDuration}s`
      );
    }
  }
  // Guard against the loop silently finding nothing to assert.
  assert.ok(blocked > 100, `expected many blocked taps, measured ${blocked}`);
});

test('blocked click targets the directly overlapping visual blocker', () => {
  const game = new BusLoopGame();
  const result = game.clickVehicle(49);
  assert.equal(result.reason, 'blocked');
  assert.equal(game.getVehicle(49).collision.targetId, 50);
  assert.equal(game.snapshot().lastEvent.targetId, 50);
});

test('station drive uses the Unity rounded path and authored weighted curve', () => {
  const game = new BusLoopGame();
  game.clickVehicle(LEVEL12_DISPATCH_ID);
  const data = game.getVehicle(LEVEL12_DISPATCH_ID).motionData;
  assert.ok(data.path.segments.some((segment) => segment.type === 'cubic'));
  assert.ok(data.duration > 0 && data.duration < 1);
  const middleDistance = data.path.length * evaluateUnityCurve(data.curve, .5);
  const middle = evaluatePath(data.path, middleDistance);
  assert.ok(Number.isFinite(middle.position.x));
  assert.ok(Math.hypot(middle.tangent.x, middle.tangent.z) > .99);
});

test('station approach follows the Unity parking-area rectangle before entering the spot', () => {
  const originalYaw = SCENE_TUNING.facing.parkingSpotYawDegrees;
  SCENE_TUNING.facing.parkingSpotYawDegrees = 35;
  try {
    const game = new BusLoopGame();
    game.clickVehicle(LEVEL12_DISPATCH_ID);
    const target = game.getSpotPosition(0);
    const data = game.getVehicle(LEVEL12_DISPATCH_ID).motionData;
    const finalSegment = data.path.segments.at(-1);
    const rawPoints = buildToStationPoints(game.getVehicle(LEVEL12_DISPATCH_ID), target, SCENE_TUNING.vehiclePath);
    assert.equal(target.visualYaw, 35);
    assert.notEqual(target.yaw, target.visualYaw);
    const mappedCenter = mapVehicleAreaPoint(target);
    assert.ok(Math.abs(mappedCenter.x - target.visualX) < 1e-6);
    assert.ok(Math.abs(mappedCenter.z - target.visualZ) < 1e-6);
    assert.ok(Number.isFinite(target.approachX));
    assert.ok(Number.isFinite(target.approachZ));
    assert.equal(target.visualApproachX, target.visualX);
    assert.ok(target.visualApproachZ > target.visualZ);
    assert.notDeepEqual(rawPoints.at(-2), { x: target.approachX, z: target.approachZ });
    assert.equal(rawPoints[0].x, game.getVehicle(LEVEL12_DISPATCH_ID).x);
    assert.equal(rawPoints[0].z, game.getVehicle(LEVEL12_DISPATCH_ID).z);
    assert.ok(rawPoints.some((point) => Math.abs(point.z - SCENE_TUNING.vehiclePath.parkingBounds.maxZ) < 1e-6));
    assert.ok(Math.abs(finalSegment.p1.x - target.x) < 1e-6);
    assert.ok(Math.abs(finalSegment.p1.z - target.z) < 1e-6);
  } finally {
    SCENE_TUNING.facing.parkingSpotYawDegrees = originalYaw;
  }
});

test('vehicle path preview and shape controls are wired to scene tuning', () => {
  assert.equal(SCENE_TUNING.vehiclePath.enabled, 0);
  assert.equal(SCENE_TUNING.vehiclePath.autoBounds, 1);
  assert.deepEqual(SCENE_TUNING.vehiclePath.parkingBounds, { minX: -2.6, maxX: 2.6, minZ: -3.22, maxZ: 3.28 });
  const game = new BusLoopGame();
  const target = game.getSpotPosition(0);
  const vehicle = game.getVehicle(LEVEL12_DISPATCH_ID);
  const originalPoints = buildToStationPoints(vehicle, target, SCENE_TUNING.vehiclePath);
  const tunedMotion = {
    ...SCENE_TUNING.vehiclePath,
    parkingBounds: {
      ...SCENE_TUNING.vehiclePath.parkingBounds,
      maxZ: SCENE_TUNING.vehiclePath.parkingBounds.maxZ + 0.5
    },
    turnRadius: SCENE_TUNING.vehiclePath.turnRadius + 0.2
  };
  const tunedPoints = buildToStationPoints(vehicle, target, tunedMotion);
  const originalPath = buildRoundedPath(originalPoints, SCENE_TUNING.vehiclePath);
  const tunedPath = buildRoundedPath(tunedPoints, tunedMotion);
  assert.notEqual(tunedPoints.find((point) => point.z > SCENE_TUNING.vehiclePath.parkingBounds.maxZ)?.z, undefined);
  assert.notEqual(Math.round(originalPath.length * 1000), Math.round(tunedPath.length * 1000));

  const editorSource = readFileSync(join('src', 'scene-editor.js'), 'utf8');
  assert.match(editorSource, /vehiclePath\.enabled/);
  assert.match(editorSource, /vehiclePath\.parkingBounds\.maxZ/);
  assert.match(editorSource, /vehicleDeparturePath\.enabled/);
  assert.match(editorSource, /vehicleDeparturePath\.fullLoadDelay/);
  assert.match(editorSource, /vehicleDeparturePath\.exitDistance/);
  assert.match(editorSource, /vehicleDeparturePath\.backwardSpeed/);
  assert.match(editorSource, /vehicleDeparturePath\.forwardSpeed/);
  const viewSource = readFileSync(join('src', 'scene-view.js'), 'utf8');
  assert.match(viewSource, /updateVehiclePathPreview/);
  assert.match(viewSource, /updateVehicleDeparturePathPreview/);
  assert.match(viewSource, /buildToStationPoints\(vehicle, target, tuning\)/);
  assert.match(viewSource, /buildOutStationPoints\(target, tuning\)/);
  assert.match(viewSource, /mapMotionPoint\(sample\.position, departureY, data\.routeConfig\)/);
});

test('departing cars and both route previews share the road height', () => {
  const config = new BusLoopGame().getVehiclePathConfig();
  assert.equal(config.departure.y, config.vehicleArea.y);
  assert.equal(config.station.y, config.departure.y);
});

test('Unity bus hit clips retain their authored directional keys', () => {
  const right = sampleHitClip('right', .1);
  const front = sampleHitClip('front', .1);
  assert.ok(Math.abs(right.rotationDegrees - 8.855473) < .001);
  assert.ok(Math.abs(front.rotationDegrees - -8.572966) < .001);
  assert.equal(right.rotationAxis, 'z');
  assert.equal(front.rotationAxis, 'x');
});

test('seat count board displays remaining passengers, not remaining groups', () => {
  const viewSource = readFileSync(join('src', 'scene-view.js'), 'utf8');
  assert.match(viewSource, /baseRemaining = Math\.max\(0, vehicle\.seats - vehicle\.boardedGroups\) \* LEVEL_1\.groupSize/);
  assert.match(viewSource, /boardingRemaining \+= 1/);
  assert.match(viewSource, /context\.font = `700 \$\{fontSize\}px "Poppins Branding", Arial, sans-serif`/);
  assert.match(viewSource, /function resolveCountBoardColors\(vehicle\)/);
  assert.match(viewSource, /vehicle\?\.colorOverrides\?\.body/);
  assert.match(viewSource, /const config = resolveCountBoardColors\(vehicle\)/);
  assert.match(viewSource, /board\.userData\.bodyColor === bodyColor/);
});

test('seat count digits fit the card for one and two digit counts', () => {
  // The old fixed 112px font with an 18px outline overflowed the card once a
  // count reached 30+, so the label is measured and scaled to an ink budget.
  const budget = {
    maxFontSize: Number(sceneViewSource.match(/COUNT_BOARD_MAX_FONT_SIZE = (\d+)/)?.[1]),
    inkWidth: Number(sceneViewSource.match(/COUNT_BOARD_MAX_INK_WIDTH = ([^;]+);/)?.[1]
      ?.replace(/COUNT_BOARD_PLATE_BOX\.width \* /, '')
      ?.replace(/COUNT_BOARD_INK_FRACTION/, '')),
    inkFraction: Number(sceneViewSource.match(/COUNT_BOARD_INK_FRACTION = ([\d.]+)/)?.[1]),
    plateHeight: Number(sceneViewSource.match(/COUNT_BOARD_PLATE_BOX[\s\S]*?height: (\d+)/)?.[1]),
    strokeRatio: Number(sceneViewSource.match(/COUNT_BOARD_STROKE_RATIO = ([\d.]+)/)?.[1])
  };
  assert.ok(budget.maxFontSize > 0);
  assert.ok(budget.inkFraction > 0 && budget.inkFraction <= 1);
  assert.ok(budget.plateHeight > 0);
  assert.ok(budget.strokeRatio > 0 && budget.strokeRatio < .2);
  const maxInkWidth = 256 * budget.inkFraction;
  const maxInkHeight = budget.plateHeight * budget.inkFraction;
  const cases = [
    { label: '8', inkWidth: 61, inkHeight: 85 },
    { label: '30', inkWidth: 140, inkHeight: 84 },
    { label: '40', inkWidth: 147, inkHeight: 81 },
    { label: '100', inkWidth: 183, inkHeight: 81 }
  ];
  for (const { label, inkWidth, inkHeight } of cases) {
    const fontSize = fitCountBoardFontSize(inkWidth, inkHeight, 112);
    const stroke = fontSize * budget.strokeRatio;
    const drawnWidth = inkWidth / 112 * fontSize + stroke;
    const drawnHeight = inkHeight / 112 * fontSize + stroke;
    assert.ok(fontSize <= budget.maxFontSize, `${label} must not exceed the cap`);
    assert.ok(drawnWidth <= maxInkWidth + .001, `${label} ink width ${drawnWidth}`);
    assert.ok(drawnHeight <= maxInkHeight + .001, `${label} ink height ${drawnHeight}`);
  }
  // A two-digit count is width-limited and shrinks; a single digit is not.
  assert.ok(fitCountBoardFontSize(61, 85, 112) >= fitCountBoardFontSize(147, 81, 112));
});

test('seat count card uses a geometry rounded rect so corners stay smooth', () => {
  const viewSource = readFileSync(join('src', 'scene-view.js'), 'utf8');
  // The card is minified to ~40x27 screen pixels. An alpha-cut texture snapped
  // its arc to whole pixels and read as a staircase, so the card is a real
  // rounded-rectangle mesh resolved by the renderer's MSAA instead.
  assert.match(viewSource, /function createCountBoardPlateGeometry\(/);
  assert.match(viewSource, /new THREE\.ShapeGeometry\(shape, 16\)/);
  assert.match(viewSource, /createCountBoardPlateGeometry\(COUNT_BOARD_PLATE_BOX\)/);
  // Radius is a fraction of the card height, so the corners stay circular
  // despite the non-uniform width/depth scale the tuning applies.
  assert.match(viewSource, /const r = Math\.min\(radius \/ height, half\)/);
  // The card keeps the game's wide profile; using the full atlas height made it
  // nearly square.
  assert.match(viewSource, /COUNT_BOARD_PLATE_BOX\.height \/ 256/);
  // The generic card is untextured, so it is tinted by the vehicle colour;
  // only the luxury badge keeps Unity's authored atlas.
  assert.match(viewSource, /cropCountBoardTextureToCard/);
  assert.match(viewSource, /boardTexture \? 0xffffff : config\.background/);
  const clearTexels = viewSource.slice(
    viewSource.indexOf('function clearCountBoardTexels'),
    viewSource.indexOf('function decodeOptionalGzip')
  );
  assert.match(clearTexels, /data\[i\] = 255/);
  assert.match(clearTexels, /data\[i \+ 3\] = 1/);
});

test('all UI and canvas font references prefer bundled Poppins with a package-safe fallback', () => {
  const fontSources = [
    'styles.css',
    'main.js',
    'scene-view.js',
    'level-layout-editor.js',
    'level-layout-editor.css',
    'spatial-conveyor-editor.css'
  ].map((file) => readFileSync(join('src', file), 'utf8')).join('\n');
  const legacyFontNames = /\b(?:Inter|Impact|Trebuchet MS|Microsoft YaHei|system-ui)\b/i;

  assert.equal(existsSync(join('public', 'assets', 'unity', 'fonts', 'Poppins-Bold.ttf')), true);
  assert.match(fontSources, /src: url\('\/assets\/unity\/fonts\/Poppins-Bold\.ttf'\)/);
  assert.match(fontSources, /["']Poppins Branding["'], Arial, sans-serif/);
  assert.doesNotMatch(fontSources, legacyFontNames);
});

test('matching groups board only an arrived same-color vehicle', () => {
  const game = new BusLoopGame();
  game.clickVehicle(LEVEL12_DISPATCH_ID);
  advance(game, .8);
  const vehicle = game.getVehicle(LEVEL12_DISPATCH_ID);
  assert.equal(vehicle.state, 'at-spot');
  const before = vehicle.boardedGroups;
  for (let i = 0; i < 300 && vehicle.boardedGroups === before; i += 1) game.update(0.05);
  assert.ok(vehicle.boardedGroups > before);
  assert.equal(game.snapshot().boardingEvents.at(-1).vehicleId, LEVEL12_DISPATCH_ID);
  assert.equal(game.getVehicle(7).boardedGroups, 0);
});

test('a full vehicle frees its spot and departs', () => {
  const game = new BusLoopGame();
  game.clickVehicle(LEVEL12_DISPATCH_ID);
  advance(game, .8);
  const vehicle = game.getVehicle(LEVEL12_DISPATCH_ID);
  vehicle.boardedGroups = vehicle.seats - 1;
  const slot = game.slots[0];
  slot.colorIndex = vehicle.colorIndex;
  slot.progress = LEVEL_1.exitStart;
  game.update(0.01);
  assert.equal(vehicle.state, 'boarding-final');
  advance(game, SCENE_TUNING.vehicleDeparturePath.fullLoadDelay + 0.1);
  assert.equal(vehicle.state, 'departing');
  assert.equal(game.spots[0].vehicleId, null);
});

test('full vehicle backs out below the parking spot before leaving', () => {
  const originalYaw = SCENE_TUNING.facing.parkingSpotYawDegrees;
  SCENE_TUNING.facing.parkingSpotYawDegrees = -30;
  try {
    const game = new BusLoopGame();
    game.clickVehicle(LEVEL12_DISPATCH_ID);
    advance(game, .8);
    const vehicle = game.getVehicle(LEVEL12_DISPATCH_ID);
    const target = game.getSpotPosition(0);
    vehicle.boardedGroups = vehicle.seats - 1;
    const slot = game.slots[0];
    slot.colorIndex = vehicle.colorIndex;
    slot.progress = LEVEL_1.exitStart;
    game.update(0.01);
    advance(game, SCENE_TUNING.vehicleDeparturePath.fullLoadDelay + 0.1);
    const data = vehicle.motionData;
    const firstSegment = data.backwardPath.segments[0];
    const forwardSegment = data.forwardPath.segments.at(-1);
    const rawPoints = buildOutStationPoints(target);
    assert.equal(target.visualApproachX, target.visualX);
    assert.ok(target.visualApproachZ > target.visualZ);
    assert.deepEqual(rawPoints[0], { x: target.x, z: target.z });
    assert.deepEqual(rawPoints[1], { x: target.approachX, z: target.approachZ });
    assert.ok(Math.abs(firstSegment.p0.x - target.x) < 1e-6);
    assert.ok(Math.abs(firstSegment.p0.z - target.z) < 1e-6);
    assert.ok(Math.abs(forwardSegment.p0.z - forwardSegment.p1.z) < 1e-6);
    assert.ok(forwardSegment.p1.x > forwardSegment.p0.x);
  } finally {
    SCENE_TUNING.facing.parkingSpotYawDegrees = originalYaw;
  }
});


test('vehicle departure path and full-load delay are scene-tunable', () => {
  const original = { ...SCENE_TUNING.vehicleDeparturePath };
  SCENE_TUNING.vehicleDeparturePath.fullLoadDelay = 0.25;
  SCENE_TUNING.vehicleDeparturePath.exitDistance = 5.5;
  SCENE_TUNING.vehicleDeparturePath.exitTurnOffsetX = -0.9;
  try {
    const game = new BusLoopGame();
    game.clickVehicle(LEVEL12_DISPATCH_ID);
    advance(game, .8);
    const vehicle = game.getVehicle(LEVEL12_DISPATCH_ID);
    vehicle.boardedGroups = vehicle.seats - 1;
    const slot = game.slots[0];
    slot.colorIndex = vehicle.colorIndex;
    slot.progress = LEVEL_1.exitStart;
    game.update(0.01);
    assert.equal(vehicle.state, 'boarding-final');
    advance(game, 0.3);
    assert.equal(vehicle.state, 'departing');
    const forwardSegment = vehicle.motionData.forwardPath.segments.at(-1);
    assert.ok(Math.abs(forwardSegment.p1.x - forwardSegment.p0.x - 5.5) < 1e-6);
    assert.equal(forwardSegment.p1.z, vehicle.motionData.routeConfig.station.parkingBounds.maxZ);
  } finally {
    Object.assign(SCENE_TUNING.vehicleDeparturePath, original);
  }
});

test('Unity conveyor failure waits for settled full spots and a configurable full-belt delay', () => {
  const originalDelay = SCENE_TUNING.gameOver.failureDelaySeconds;
  SCENE_TUNING.gameOver.failureDelaySeconds = 0.5;
  try {
    const game = new BusLoopGame();
    assert.equal(game.spots.length, 4);
    for (let i = 0; i < game.spots.length; i += 1) {
      const vehicle = game.vehicles[i];
      vehicle.state = i === game.spots.length - 1 ? 'moving-to-spot' : 'at-spot';
      vehicle.spotIndex = i;
      vehicle.motion = 0;
      vehicle.motionData = vehicle.state === 'moving-to-spot' ? { duration: 999 } : null;
      vehicle.colorIndex = 9;
      game.spots[i].vehicleId = vehicle.id;
    }
    for (const slot of game.slots) slot.colorIndex = 0;

    advance(game, 1);
    assert.equal(game.status, 'playing');
    assert.equal(game.failureConditionStartedAt, null);

    game.vehicles[game.spots.length - 1].state = 'at-spot';
    game.vehicles[game.spots.length - 1].motionData = null;
    game.update(0.01);
    assert.equal(game.status, 'playing');
    assert.notEqual(game.failureConditionStartedAt, null);

    advance(game, 0.4);
    assert.equal(game.status, 'playing');
    advance(game, 0.2);
    assert.equal(game.status, 'lost');
  } finally {
    SCENE_TUNING.gameOver.failureDelaySeconds = originalDelay;
  }
});

test('Unity conveyor failure timer cancels when the belt opens before the delay', () => {
  const originalDelay = SCENE_TUNING.gameOver.failureDelaySeconds;
  SCENE_TUNING.gameOver.failureDelaySeconds = 0.5;
  try {
    const game = new BusLoopGame();
    for (let i = 0; i < game.spots.length; i += 1) {
      const vehicle = game.vehicles[i];
      vehicle.state = 'at-spot';
      vehicle.spotIndex = i;
      vehicle.colorIndex = 9;
      game.spots[i].vehicleId = vehicle.id;
    }
    for (const slot of game.slots) slot.colorIndex = 0;

    game.update(0.01);
    assert.notEqual(game.failureConditionStartedAt, null);
    game.slots[0].colorIndex = null;
    game.update(0.1);
    assert.equal(game.status, 'playing');
    assert.equal(game.failureConditionStartedAt, null);
  } finally {
    SCENE_TUNING.gameOver.failureDelaySeconds = originalDelay;
  }
});

test('win requires all vehicles done and no remaining passengers', () => {
  const game = new BusLoopGame();
  for (const vehicle of game.vehicles) vehicle.state = 'done';

  game.update(0.01);
  assert.equal(game.status, 'playing');
  assert.notEqual(game.getRemainingGroups(), 0);

  for (const queue of game.queues) queue.length = 0;
  for (const queue of game.sourceQueues) queue.length = 0;
  for (const slot of game.slots) {
    slot.colorIndex = null;
    slot.entryMotion = null;
  }
  game.update(0.01);
  assert.equal(game.status, 'won');
});

test('level12 initial movable cars reserve the first parking spots', () => {
  const game = new BusLoopGame();
  for (const id of LEVEL12_INITIAL_MOVABLE_IDS) {
    assert.equal(game.clickVehicle(id).ok, true, `vehicle ${id} should be movable`);
  }
  assert.equal(game.spots.length, 4);
  assert.deepEqual(game.snapshot().spots.slice(0, LEVEL12_INITIAL_MOVABLE_IDS.length).map((spot) => spot.vehicleId), LEVEL12_INITIAL_MOVABLE_IDS);
  // Dispatching the initial batch unlocks the next wave of parked cars.
  assert.deepEqual(
    game.snapshot().vehicles
      .filter((vehicle) => game.getBlockers(vehicle.id).length === 0 && vehicle.state === 'parked')
      .map((vehicle) => vehicle.id),
    [3, 6, 33, 35, 38]
  );
});



test('parking spot visual scale changes do not move the authored vehicle path center', () => {
  const original = {
    scaleX: SCENE_TUNING.parkingSpots.scaleX,
    scaleZ: SCENE_TUNING.parkingSpots.scaleZ,
    yaw: SCENE_TUNING.facing.parkingSpotYawDegrees
  };
  SCENE_TUNING.parkingSpots.scaleX = 1.6;
  SCENE_TUNING.parkingSpots.scaleZ = 0.7;
  SCENE_TUNING.facing.parkingSpotYawDegrees = 25;
  try {
    const game = new BusLoopGame();
    const target = game.getSpotPosition(2);
    const mappedCenter = mapVehicleAreaPoint(target);
    assert.ok(Math.abs(mappedCenter.x - target.visualX) < 1e-6);
    assert.ok(Math.abs(mappedCenter.z - target.visualZ) < 1e-6);
  } finally {
    SCENE_TUNING.parkingSpots.scaleX = original.scaleX;
    SCENE_TUNING.parkingSpots.scaleZ = original.scaleZ;
    SCENE_TUNING.facing.parkingSpotYawDegrees = original.yaw;
  }
});

test('parking outlines sit below the vehicle layer so cars drive over them', () => {
  const viewSource = readFileSync(join('src', 'scene-view.js'), 'utf8');
  // The outline art is a raised slab; left at full thickness its top face is
  // higher than the vehicle underside and the line paints across the body.
  assert.match(viewSource, /SPOT_OUTLINE_FLATTEN_Y_SCALE/);
  assert.match(viewSource, /SPOT_OUTLINE_CLEARANCE_Y/);
  assert.match(viewSource, /outline\.scale\.y \*= SPOT_OUTLINE_FLATTEN_Y_SCALE/);
  assert.match(viewSource, /outline\.position\.y \+= targetLocalTopY - outlineBox\.max\.y/);
  assert.match(viewSource, /const targetLocalTopY = \(SCENE_TUNING\.vehicleArea\.y \?\? stageSpots\.y\)/);
  // Outlines stay visible at all times; occupancy must not hide them.
  assert.doesNotMatch(viewSource, /hideOutlineWhenOccupied/);
  assert.doesNotMatch(viewSource, /updateSpotOutlineVisibility/);
  assert.equal(SCENE_TUNING.parkingSpots.hideOutlineWhenOccupied, undefined);
});

test('parking outline size is fixed at the authored size and never follows the car', () => {
  // Bays are authored fixed-size ground art. They used to stretch to whatever
  // car stood on them, which made every empty bay shrink to the raw FBX size
  // and made occupancy visibly change the paint. The outline now keeps its
  // authored footprint; only its draw order is managed.
  const viewSource = readFileSync(join('src', 'scene-view.js'), 'utf8');
  assert.doesNotMatch(viewSource, /updateSpotOutlineSize/);
  assert.doesNotMatch(viewSource, /measureVehicleModelSize/);
  assert.doesNotMatch(viewSource, /measureSpotOutlineBase/);
  assert.match(viewSource, /object\.renderOrder = SPOT_OUTLINE_RENDER_ORDER/);
});

test('parking outlines stay under every car, including cars on the departure lane', () => {
  const viewSource = readFileSync(join('src', 'scene-view.js'), 'utf8');
  // Bay paint must render under a car crossing the parking row.
  assert.match(viewSource, /material\.depthTest = false/);
  assert.match(viewSource, /material\.depthWrite = false/);
  // Opaque cutout, not a transparent decal: transparent meshes are drawn after
  // every car, which is what painted the outline across the bodies.
  const parkingStart = viewSource.indexOf('this.parkingMaterial = new THREE.MeshStandardMaterial');
  const parkingMaterial = viewSource.slice(parkingStart, parkingStart + 800);
  assert.match(parkingMaterial, /alphaTest: 0\.02/);
  assert.doesNotMatch(parkingMaterial, /transparent: true/);
});

test('seat count badges render under the cars like the bay paint', () => {
  const viewSource = readFileSync(join('src', 'scene-view.js'), 'utf8');
  const boardSource = viewSource.slice(
    viewSource.indexOf('  createSeatCountBoard() {'),
    viewSource.indexOf('async loadUnityAssets()')
  );
  // Same failure mode as the bay outline: a blended material is always drawn
  // after every car, so the badge covered the car parked on it.
  assert.doesNotMatch(boardSource, /transparent: true/);
  // SpriteMaterial is transparent by default; leaving it unset keeps the digits
  // in the blended pass even when the plane below is opaque.
  assert.match(boardSource, /transparent: false/);
  assert.match(boardSource, /alphaTest: 0\.02/);
  assert.match(boardSource, /renderOrder = SEAT_COUNT_BOARD_RENDER_ORDER/);
  // Ground UI must never be occluded by the vehicle layer either.
  assert.match(boardSource, /depthTest: false/);
  const outlineOrder = Number(viewSource.match(/SPOT_OUTLINE_RENDER_ORDER = (-?\d+)/)?.[1]);
  const boardOrder = Number(viewSource.match(/SEAT_COUNT_BOARD_RENDER_ORDER = (-?\d+)/)?.[1]);
  assert.ok(boardOrder > outlineOrder, 'badge should paint above the bay outline');
  assert.ok(boardOrder < 0, 'badge should still paint before the vehicle layer');
});

test('boarding passengers are cleared once their car has left the bay', () => {
  const viewSource = readFileSync(join('src', 'scene-view.js'), 'utf8');
  // A car that already departed cannot still receive passengers; otherwise the
  // last group keeps walking to the empty spot and stands there.
  assert.match(viewSource, /\['departing', 'revive-departing', 'done'\]\.includes\(vehicle\.state\)/);
  assert.match(viewSource, /if \(vehicleGone && entry\.contactStartedAt === undefined\) \{/);
});

test('main thread saves and restores scene tuning from localStorage', () => {
  const mainSource = readFileSync(join('src', 'main.js'), 'utf8');
  const sceneEditorSource = readFileSync(join('src', 'scene-editor.js'), 'utf8');
  assert.match(mainSource, /bus-loop-scene-tuning-v3/);
  assert.match(mainSource, /bus-loop-scene-tuning-v2/);
  assert.match(mainSource, /LEGACY_TUNING_STORAGE_KEY/);
  assert.match(mainSource, /function deepMerge/);
  assert.match(mainSource, /function migrateLegacyConveyorTuning/);
  assert.match(mainSource, /function migrateLevel16PackageTuning/);
  assert.match(mainSource, /function migrateLevel10PackageTuning/);
  assert.match(mainSource, /function migrateLegacyPackageTuning/);
  assert.match(mainSource, /function migrateSpatialSpeedTuning/);
  assert.match(mainSource, /function migrateLevel36VehicleScaleTuning/);
  assert.match(mainSource, /LEVEL36_VEHICLE_SCALE_MIGRATION_KEY/);
  assert.match(mainSource, /source\.vehicleArea\.modelScale = 0\.7/);
  assert.match(mainSource, /function migrateLevel36VehicleCompactionTuning/);
  assert.match(mainSource, /LEVEL36_VEHICLE_COMPACTION_MIGRATION_KEY/);
  assert.match(mainSource, /source\.vehicleArea\.positionUnitScale = 0\.8/);
  assert.match(mainSource, /\[0, -0\.5, -0\.25\]\.includes\(offsetZ\)/);
  assert.match(mainSource, /source\.vehicleArea\.offsetZ = -0\.1/);
  assert.match(mainSource, /function migrateLevel36TimedGuideTuning/);
  assert.match(mainSource, /LEVEL36_TIMED_GUIDE_MIGRATION_KEY/);
  assert.match(mainSource, /idleDelaySeconds: 5/);
  assert.match(mainSource, /spatial\.normalSpeedMultiplier = 1/);
  assert.match(mainSource, /Number\(spatial\.longPressMultiplier\) === 5\.2/);
  assert.match(mainSource, /spatial\.longPressMultiplier = 3/);
  assert.match(mainSource, /source\.level\.selected = 'level16'/);
  assert.match(mainSource, /'successfulOperationThreshold', 40, 30/);
  assert.match(mainSource, /'minX', -2\.53, -2\.2/);
  assert.match(mainSource, /'maxX', 2\.53, 2\.2/);
  assert.match(mainSource, /'positionUnitScale', 0\.73, 0\.8/);
  assert.match(mainSource, /'modelScale', 0\.63, 0\.7/);
  assert.match(mainSource, /source\.level\.selected = 'level10'/);
  assert.match(mainSource, /'successfulOperationThreshold', 30, 10/);
  assert.match(mainSource, /'enabled', 0, 1/);
  assert.match(mainSource, /BG02_split01_summer_q60\.jpg/);
  assert.match(mainSource, /BG01_split01_Sakura_q60\.jpg/);
  assert.match(mainSource, /BG01_split01_q60\.jpg/);
  assert.match(mainSource, /guide\.levelKey = 'level12'/);
  assert.match(mainSource, /guide\.vehicleId = 34/);
  assert.match(mainSource, /SCENE_TUNING\.conveyorLayouts\?\.dualQueue2/);
  assert.match(mainSource, /classList\.toggle\('is-phone-preview', EDITOR_ENABLED && Boolean\(preview\?\.enabled\)\)/);
  assert.match(mainSource, /function loadSavedTuning\(\) \{\s+if \(!EDITOR_ENABLED\) return;/);
  assert.match(mainSource, /deepMerge\(SCENE_TUNING, savedTuning\)/);
  assert.match(mainSource, /migrateLegacyConveyorTuning\(savedTuning\)/);
  assert.match(mainSource, /migrateSpatialSpeedTuning\(savedTuning\)/);
  const currentStorageBranch = mainSource.slice(
    mainSource.indexOf('if (saved) {'),
    mainSource.indexOf('const legacySaved =')
  );
  assert.doesNotMatch(currentStorageBranch, /migrateLevel(?:16|10|12)PackageTuning/);
  assert.match(mainSource, /migrateLegacyPackageTuning\(legacy\)/);
  assert.match(mainSource, /delete legacy\.vehicleArea/);
  assert.match(mainSource, /localStorage\.setItem/);
  assert.match(mainSource, /localStorage\.getItem/);
  assert.match(mainSource, /function writeTuning\(value\) \{\s+if \(!EDITOR_ENABLED\) return;/);
  assert.match(mainSource, /function clearSavedTuning\(\) \{\s+if \(!EDITOR_ENABLED\) return;/);
  assert.match(mainSource, /clearSavedTuning/);
  assert.match(mainSource, /const DEFAULT_SCENE_TUNING = EDITOR_ENABLED \? structuredClone\(SCENE_TUNING\) : null;/);
  assert.match(mainSource, /const sceneEditorRoot = \$\('#scene-editor'\)/);
  assert.match(mainSource, /defaultTuning: DEFAULT_SCENE_TUNING/);
  assert.ok(
    mainSource.indexOf('const DEFAULT_SCENE_TUNING = EDITOR_ENABLED ? structuredClone(SCENE_TUNING) : null;')
      < mainSource.search(/if \(EDITOR_ENABLED\) \{\s+loadSavedTuning\(\);/)
  );
  assert.match(sceneEditorSource, /defaultTuning = getTuning\(\)/);
  assert.match(sceneEditorSource, /const defaults = structuredClone\(defaultTuning\);/);
  assert.match(sceneEditorSource, /resetTuning\.level\.selected = selectedLevel/);
  assert.match(mainSource, /LEVEL_TUNING_STORAGE_KEY = 'bus-loop-level-tuning-v1'/);
  assert.match(mainSource, /function saveLevelTuningProfile\(value\)/);
  assert.match(mainSource, /function activateLevelTuning\(levelKey, savedTuning\)/);
  assert.match(mainSource, /activateLevelTuning\(selectedLevelKey, webEntry\?\.document\?\.tuning\)/);
  assert.match(mainSource, /profile\?\.tuning\?\.speedToggle \?\? savedTuning\?\.speedToggle/);
  assert.match(mainSource, /profile\?\.tuning\?\.combo \?\? savedTuning\?\.combo/);
  assert.doesNotMatch(mainSource, /LUXURY_MATERIAL_DEBUG_TUNING_PREFIX|isLuxuryMaterialDebugTuningPath|luxuryMaterialDebugOnly/);
  assert.match(mainSource, /delete savedTuning\.luxuryMaterialDebug/);
  assert.match(mainSource, /savedLuxuryMaterial\.vehicleBrightness !== SCENE_TUNING\.luxuryMaterial\.vehicleBrightness/);
  assert.match(mainSource, /setTimeout\(flushTuningSave, 150\)/);
  assert.match(mainSource, /if \(EDITOR_ENABLED\) window\.addEventListener\('beforeunload', flushTuningSave\)/);
  assert.match(mainSource, /function initializeGameQueues/);
  assert.match(mainSource, /view\.getConveyorConfig\(\)/);
  assert.match(mainSource, /path === 'conveyorLayout\.selected'/);
  assert.match(mainSource, /path === 'spatialConveyor\.capacity'/);
  assert.match(mainSource, /initializeGameQueues\(\{ resetSlots: conveyorStructureChanged \}\)/);
  // Mechanism art/audio must cover every level the session can reach, which now
  // includes the maps offered by a post-stage picker.
  assert.match(mainSource, /const allSessionLevels = \[\.\.\.sessionLevels, \.\.\.choiceOptionLevels\]/);
  assert.match(mainSource, /const mechanismTypes = getMechanismTypesForLevels\(allSessionLevels\)/);
  assert.match(mainSource, /createGameAudioController\(\{[\s\S]*allSessionLevels\.map\(\(level\) => level\.assets\?\.audio \?\? \{\}\)[\s\S]*getMechanismAudioConfig\(mechanismTypes\)[\s\S]*\}\)/);
  // Every sound-relevant event of the frame must be played, not only lastEvent:
  // a frame can both depart a vehicle and board a group.
  assert.match(mainSource, /for \(const event of state\.frameAudioEvents \?\? \[\]\) \{\s*audio\.handleGameEvent\(event, state\.time, state\.vehicles\);\s*combo\.contact\(event\);/);
  assert.match(mainSource, /audio\.handleGameEvent\(state\.lastEvent, state\.time, state\.vehicles\)/);
  assert.match(mainSource, /audio\.playPassengerUp\(\)/);
  assert.match(mainSource, /audio\.unlock\(\)/);
  assert.match(mainSource, /loadingScreen/);
  assert.match(mainSource, /updateLoadingProgress/);
  assert.match(mainSource, /loadingProgressBar\.style\.width/);
  assert.match(mainSource, /view\.ready\?\.finally/);
  assert.match(mainSource, /updateLoadingProgress\(1\)/);
  assert.match(mainSource, /loadingScreen\?\.classList\.add\('is-hidden'\)/);
  assert.match(mainSource, /const ctaButton = \$\('#cta-button'\)/);
  assert.match(mainSource, /const gameOverTitle = \$\('#game-over-title'\)/);
  assert.equal(SCENE_TUNING.storeLinks.android, 'https://play.google.com/store/apps/details?id=gridplus.busjam.carpuzzle');
  assert.equal(SCENE_TUNING.storeLinks.ios, 'https://apps.apple.com/us/app/bus-fever-party/id6746743297');
  assert.match(mainSource, /const DEFAULT_STORE_LINKS = \{ \.\.\.SCENE_TUNING\.storeLinks \}/);
  assert.match(mainSource, /function refreshDefaultStoreLinks\(\)/);
  assert.match(mainSource, /resolveStoreLink\(platform, links\?\.\[platform\], DEFAULT_STORE_LINKS\[platform\]\)/);
  assert.doesNotMatch(mainSource, /const STORE_URL\s*=/);
  assert.doesNotMatch(mainSource, /itms-apps:\/\/itunes\.apple\.com/);
  assert.match(mainSource, /STORE_OPEN_COOLDOWN_MS = 800/);
  assert.match(mainSource, /function getSuccessfulOperationThreshold\(\)/);
  assert.match(mainSource, /SCENE_TUNING\.installGate\?\.successfulOperationThreshold/);
  assert.match(mainSource, /Math\.max\(1, Math\.floor\(configuredThreshold\)\)/);
  assert.doesNotMatch(mainSource, /INSTALL_GATE_AFTER_SUCCESSFUL_OPERATIONS_ENABLED/);
  assert.match(mainSource, /function applyCtaTuning/);
  assert.match(mainSource, /ctaButton\.hidden = !Boolean\(cta\.enabled \?\? 1\)/);
  // A wider fallback face on some Windows engines must shrink the CTA label
  // instead of letting it wrap onto overlapping lines. Localized labels use the
  // same shrink path, so the maths lives in one shared helper.
  assert.match(mainSource, /function fitCtaLabel\(\{ fontSize, fontHeight, uiScale, availableWidth \}\)/);
  assert.match(mainSource, /fitFontSizeToWidth\(\{ fontSize, measuredWidth: contentWidth, availableWidth \}\)/);
  assert.match(mainSource, /const fitted = fitCtaLabel\(\{/);
  assert.match(mainSource, /availableWidth: renderedWidth - paddingX \* uiScale \* 2/);
  assert.match(mainSource, /showResultOverlay\(state\.lastEvent\.reason === 'ambulance-exceed-step' \? 'Ambulance Failed' : 'Game Over'\)/);
  assert.match(mainSource, /showResultOverlay\('You Win!', \{ failed: false \}\)/);
  assert.match(mainSource, /gameOverTitle\.textContent = title/);
  assert.doesNotMatch(mainSource, /function getGameOverTitleFontFamily/);
  assert.match(mainSource, /function InstallFullGame/);
  assert.match(mainSource, /let lastStoreOpenAt = 0/);
  assert.match(mainSource, /let storeOpenAttempts = 0/);
  assert.match(mainSource, /function isIOSDevice\(\)/);
  assert.match(mainSource, /Macintosh/);
  assert.match(mainSource, /navigator\.maxTouchPoints > 1/);
  assert.match(mainSource, /function getStoreTarget\(\)/);
  assert.match(mainSource, /function getMraidStoreUrl\(target\)/);
  assert.match(mainSource, /function openStore\(\)/);
  assert.match(mainSource, /now - lastStoreOpenAt < STORE_OPEN_COOLDOWN_MS/);
  assert.match(mainSource, /const target = getStoreTarget\(\)/);
  assert.match(mainSource, /storeOpenAttempts \+= 1/);
  assert.match(mainSource, /createPlatformBridge\(\{/);
  assert.match(mainSource, /onStart: startRuntime/);
  assert.match(mainSource, /platformBridge\.initialize\(\)/);
  assert.match(mainSource, /platformBridge\?\.ready\(\)/);
  assert.match(mainSource, /platformBridge\?\.challenge\(\)/);
  assert.match(mainSource, /platformBridge\?\.end\(\)/);
  assert.match(mainSource, /platformBridge\?\.openStore\(\{ ios: url, android: url \}\)/);
  assert.doesNotMatch(mainSource, /window\.open/);
  assert.match(mainSource, /platformBridge\?\.openStore\(\{ ios: url, android: url \}\)/);
  assert.match(mainSource, /createLevelSession\(sessionLevels, \{\s*\n\s*choices: sessionChoices\.map\(\(choice\) => choice\?\.options \?\? null\)\s*\n\s*\}\)/);
  assert.doesNotMatch(mainSource, /let numberCountBus = 0/);
  assert.doesNotMatch(mainSource, /let isFinish = false/);
  assert.doesNotMatch(mainSource, /countedInstallVehicles = new Set\(\)/);
  assert.match(mainSource, /INSTALL_GATE_VEHICLE_STATES = new Set\(\['at-spot', 'boarding-final', 'departing', 'done'\]\)/);
  assert.match(mainSource, /const markInstallVehicle = \(vehicleId\) => \{/);
  assert.match(mainSource, /const threshold = gateEnabled\s*\? Math\.max\(1, getSuccessfulOperationThreshold\(\)\)/);
  assert.match(mainSource, /levelSession\.recordSuccessfulVehicle\(vehicleId, gateEnabled \? threshold : Infinity\)/);
  assert.match(mainSource, /const handleVehicleClick = \(vehicleId\) => \{/);
  assert.match(mainSource, /const result = game\.clickVehicle\(vehicleId\)/);
  assert.match(mainSource, /if \(markInstallVehicle\(vehicleId\)\) \{\s*if \(isReplayEndCardEnabled\(\)\) showResultOverlay\('You Win!', \{ failed: false \}\);\s*else InstallFullGame\(\);/);
  assert.match(mainSource, /function updateInstallGate\(state\)/);
  assert.match(mainSource, /for \(const vehicle of state\.vehicles \?\? \[\]\)/);
  assert.match(mainSource, /levelSession\.hasCountedVehicle\(vehicle\.id\)/);
  assert.match(mainSource, /markInstallVehicle\(vehicle\.id\)/);
  assert.match(mainSource, /levelSession\.shouldOpenStore\(\)/);
  assert.match(mainSource, /stopImmediatePropagation\(\)/);
  assert.match(mainSource, /ctaButton\?\.addEventListener\('click', \(event\) => \{/);
  assert.match(mainSource, /event\.stopPropagation\(\)/);
  assert.match(mainSource, /maxNumberCountBus: getSuccessfulOperationThreshold\(\)/);
  assert.match(mainSource, /const \{ height, width \} = resolveCtaSize\(cta\)/);
  assert.doesNotMatch(mainSource, /Number\(cta\.world[XYZ]\)/);
  assert.match(mainSource, /function scaledPx\(value, scale\)/);

  const packageSource = readFileSync(join('scripts', 'package-applovin-single-html.mjs'), 'utf8');
  assert.match(packageSource, /DATA_URL_ONLY_REQUEST_SCRIPT/);
  assert.match(packageSource, /function __playableDataRequest/);
  assert.match(packageSource, /define: \{ fetch: '__playableDataRequest'/);
  assert.match(packageSource, /new Response\(bytes/);
  assert.match(packageSource, /url\.slice\(0, 5\)\.toLowerCase\(\) === 'data:'/);
  assert.match(packageSource, /application\/octet-stream/);
  assert.match(packageSource, /function normalizeLineEndings/);

  const checkSource = readFileSync(join('scripts', 'check-applovin-package.mjs'), 'utf8');
  assert.match(checkSource, /no browser window\.open fallback/);
  assert.match(checkSource, /data-only offline request loader present/);
  assert.match(checkSource, /inline binary data assets present/);
  assert.match(checkSource, /branding overlay markup present/);
  assert.match(checkSource, /selected branding Icon and Logo images inlined/);
  assert.match(checkSource, /unselected branding Icon omitted/);
  assert.match(checkSource, /legacy large branding Logo omitted/);
  assert.match(checkSource, /no (?:bundled|external) font/i);
  assert.match(mainSource, /--cta-width', scaledPx\(width, uiScale\)/);
  assert.match(mainSource, /--cta-height', scaledPx\(height, uiScale\)/);
  assert.match(mainSource, /--cta-font-size', scaledPx\(fontSize, uiScale\)/);
  assert.match(mainSource, /--cta-stroke-width', scaledPx\(Math\.max\(0, Number\(cta\.strokeWidth\) \|\| 0\), uiScale\)/);
  assert.match(mainSource, /const stageRect = stage\?\.getBoundingClientRect\(\)/);
  assert.match(mainSource, /const uiScale = replay \? Math\.max\(0\.01, Math\.min\(1, stageWidth \/ designWidth, stageHeight \/ designHeight\)\)/);
  assert.match(mainSource, /: getStageUiScale\(stageWidth, designWidth\)/);
  assert.match(mainSource, /--cta-font-height/);
  assert.match(mainSource, /--cta-stroke-color/);
  assert.match(mainSource, /--cta-pulse-duration/);
  assert.doesNotMatch(mainSource, /--game-over-title-font-family/);
  assert.match(mainSource, /const updateCtaPosition = \(\) => \{/);
  assert.match(mainSource, /applyCtaTuning\(\)/);
  assert.match(mainSource, /updateCtaPosition\(\)/);
});

test('branding overlays expose responsive editor controls and drag locking', () => {
  const indexSource = readFileSync('index.html', 'utf8');
  const mainSource = readFileSync(join('src', 'main.js'), 'utf8');
  const editorSource = readFileSync(join('src', 'scene-editor.js'), 'utf8');
  const styleSource = readFileSync(join('src', 'styles.css'), 'utf8');

  assert.equal(existsSync(join('public', 'assets', 'icon-android.jpg')), true);
  assert.equal(existsSync(join('public', 'assets', 'icon-ios.png')), true);
  assert.equal(existsSync(join('public', 'assets', 'main-loading-icon-small.png')), true);
  assert.equal(existsSync(join('public', 'assets', 'icon-crowd.jpg')), true);
  assert.equal(existsSync(join('public', 'assets', 'main-loading-icon-crowd.webp')), true);
  assert.match(indexSource, /id="branding-overlay"/);
  assert.match(indexSource, /id="branding-icon"[^>]+src="\/assets\/icon-android\.jpg"/);
  assert.match(indexSource, /id="branding-logo"[^>]+src="\/assets\/main-loading-icon-small\.png"/);
  assert.doesNotMatch(indexSource, /id="game-over-logo"[^>]+src=/);
  assert.match(indexSource, /id="branding-text"[^>]*>Bus Fever Party!<\/div>/);

  for (const key of ['icon', 'logo', 'text']) {
    const config = SCENE_TUNING.branding[key];
    assert.equal([0, 1].includes(config.enabled), true, `${key} enabled flag`);
    assert.equal([0, 1].includes(config.locked), true, `${key} locked flag`);
    for (const field of ['x', 'y', 'width', 'height']) {
      assert.equal(Number.isFinite(config[field]), true, `${key}.${field}`);
    }
  }
  assert.equal(SCENE_TUNING.branding.icon.asset, '/assets/icon-android.jpg');
  for (const [key, radius, enabled, width] of [['icon', 16, 1, 5.5], ['logo', 0, 0, 4]]) {
    const config = SCENE_TUNING.branding[key];
    assert.equal(config.cornerRadius, radius);
    assert.deepEqual(config.stroke, { enabled, color: 0xffffff, width, opacity: 1 });
    assert.deepEqual(config.shadow, { enabled, color: 0, opacity: .35, blur: 12, offsetX: 0, offsetY: 6 });
  }
  assert.equal(SCENE_TUNING.branding.logo.asset, '/assets/main-loading-icon-small.png');
  assert.equal(typeof SCENE_TUNING.branding.text.content, 'string');
  assert.equal(existsSync(join('public', 'assets', 'icon-crowd.jpg')), true);
  assert.equal(existsSync(join('public', 'assets', 'main-loading-icon-crowd.webp')), true);

  assert.match(editorSource, /Icon\/Logo\\u8c03\\u6574/);
  assert.match(editorSource, /preview\.width/);
  assert.match(editorSource, /preview\.height/);
  for (const path of [
    'branding.icon.asset', 'branding.icon.enabled', 'branding.icon.locked', 'branding.icon.x', 'branding.icon.y',
    'branding.icon.width', 'branding.icon.height',
    'branding.logo.asset', 'branding.logo.enabled', 'branding.logo.locked',
    'branding.logo.x', 'branding.logo.y', 'branding.logo.width', 'branding.logo.height',
    'branding.text.enabled', 'branding.text.locked', 'branding.text.content', 'branding.text.x',
    'branding.text.y', 'branding.text.width', 'branding.text.height'
  ]) {
    assert.match(editorSource, new RegExp(path.replaceAll('.', '\\.')));
  }
  assert.match(editorSource, /class="editor-checkbox" type="checkbox" role="switch"/);
  assert.match(editorSource, /class="editor-text" type="text"/);
  assert.match(editorSource, /\/assets\/icon-android\.jpg/);
  assert.match(editorSource, /\/assets\/icon-ios\.png/);
  assert.match(editorSource, /\/assets\/icon-crowd\.jpg/);
  assert.match(editorSource, /\/assets\/main-loading-icon-crowd\.webp/);

  assert.match(mainSource, /function getBrandingStageMetrics/);
  assert.match(mainSource, /const positionScaleX = stageWidth \/ designWidth/);
  assert.match(mainSource, /const positionScaleY = stageHeight \/ designHeight/);
  assert.match(mainSource, /function applyBrandingTuning/);
  assert.match(mainSource, /gameOverLogo\.src = brandingItems\.logo\.src/);
  assert.match(mainSource, /key === 'icon' \|\| key === 'logo'/);
  assert.match(mainSource, /if \(key === 'logo' && gameOverLogo\) gameOverLogo\.src = element\.src/);
  assert.match(mainSource, /function applyLoadingBranding\(\)/);
  assert.match(mainSource, /resolveBrandingIconAsset\(visibleBranding\(\)\?\.icon\)/);
  assert.doesNotMatch(indexSource, /<img[^>]*id="loading-icon"[^>]*\bsrc=/);
  assert.match(indexSource, /id="loading-icon"/);
  assert.match(indexSource, /id="loading-title"/);
  assert.match(mainSource, /function fitBrandingText/);
  assert.match(mainSource, /function bindBrandingDrag/);
  assert.match(mainSource, /if \(EDITOR_ENABLED\) \{\s+for \(const \[key, element\] of Object\.entries\(brandingItems\)\)/);
  assert.match(mainSource, /function applyBrandingRowLayout/);
  assert.match(mainSource, /applyBrandingTuning\(view\.getBackgroundCanvasBounds\(\)\)/);
  assert.match(mainSource, /path\?\.startsWith\('branding\.'\)/);
  assert.match(mainSource, /branding\.\$\{key\}\.position/);
  assert.match(mainSource, /config\.locked/);
  assert.match(mainSource, /element\.setAttribute\('src', asset\)/);
  assert.match(mainSource, /element\.textContent = content/);
  assert.match(mainSource, /ctaButton\.style\.top = `\$\{layout\.rowY\}px`/);
  assert.match(mainSource, /drawFramedBrandingImage\(context, image, centerX, layout\.rowY, frame\)/);
  assert.match(mainSource, /const x = localX \/ metrics\.positionScaleX/);
  assert.match(mainSource, /const y = localY \/ metrics\.positionScaleY/);
  assert.match(mainSource, /setPointerCapture/);
  assert.match(mainSource, /Math\.max\(0, Math\.min\(metrics\.designWidth, x\)\)/);
  assert.match(mainSource, /Math\.max\(0, Math\.min\(metrics\.designHeight, y\)\)/);

  const sceneViewSource = readFileSync(join('src', 'scene-view.js'), 'utf8');
  assert.match(mainSource, /__PLAYABLE_PLATFORM__ !== 'mintegral' && 'ResizeObserver' in window/);
  assert.match(sceneViewSource, /__PLAYABLE_PLATFORM__ !== 'mintegral' && 'ResizeObserver' in window/);
  assert.match(sceneViewSource, /getBackgroundCanvasBounds\(\)/);
  assert.match(sceneViewSource, /this\.backgroundPlane\.matrixWorld/);
  assert.match(sceneViewSource, /left = Math\.max\(0,/);
  assert.match(sceneViewSource, /right = Math\.min\(canvasWidth,/);

  assert.match(styleSource, /\.branding-overlay/);
  assert.match(styleSource, /\.branding-item\.is-draggable/);
  assert.match(styleSource, /\.branding-item\.is-dragging/);
  assert.match(styleSource, /@font-face[\s\S]*?Poppins-Bold\.ttf/);
  assert.match(styleSource, /'Poppins Branding', Arial, sans-serif/);
  assert.match(styleSource, /\.branding-text/);
  assert.match(styleSource, /\.editor-field-toggle/);
  assert.match(styleSource, /\.editor-field-text/);
  assert.match(styleSource, /\.editor-field-url/);
  assert.match(editorSource, /storeLinks\.android/);
  assert.match(editorSource, /storeLinks\.ios/);
  assert.match(editorSource, /type="url"/);
  assert.match(mainSource, /path\?\.startsWith\('storeLinks\.'\)/);
});

test('successful operation store redirect uses the baked threshold and remains editor-tunable', () => {
  const mainSource = readFileSync(join('src', 'main.js'), 'utf8');
  const editorSource = readFileSync(join('src', 'scene-editor.js'), 'utf8');

  assert.equal(SCENE_TUNING.installGate.successfulOperationThreshold, 64);
  // The early jump is opt-in: the shipped default clears the board first.
  assert.equal(SCENE_TUNING.installGate.enabled, 0);
  assert.match(editorSource, /installGate\.successfulOperationThreshold/);
  assert.match(mainSource, /SCENE_TUNING\.installGate\?\.successfulOperationThreshold/);
  assert.match(mainSource, /if \(markInstallVehicle\(vehicleId\)\) \{\s*if \(isReplayEndCardEnabled\(\)\) showResultOverlay\('You Win!', \{ failed: false \}\);\s*else InstallFullGame\(\);/);
  assert.match(mainSource, /levelSession\.recordSuccessfulVehicle\(vehicleId, gateEnabled \? threshold : Infinity\)/);
  assert.doesNotMatch(mainSource, /INSTALL_GATE_AFTER_SUCCESSFUL_OPERATIONS_ENABLED/);
});

test('scene visibility controls cover vehicles, passengers, and Play Now', () => {
  const editorSource = readFileSync(join('src', 'scene-editor.js'), 'utf8');
  const mainSource = readFileSync(join('src', 'main.js'), 'utf8');
  const stylesSource = readFileSync(join('src', 'styles.css'), 'utf8');
  const viewSource = readFileSync(join('src', 'scene-view.js'), 'utf8');

  for (const path of ['visibility.vehicles', 'visibility.passengers', 'cta.enabled']) {
    assert.match(editorSource, new RegExp(`${path.replaceAll('.', '\\.')}', 0, 1, 1, null, 'toggle'`));
  }
  assert.deepEqual(SCENE_TUNING.visibility, { vehicles: 1, passengers: 1 });
  assert.match(mainSource, /ctaButton\.hidden = !Boolean\(cta\.enabled \?\? 1\)/);
  assert.match(viewSource, /const vehiclesVisible = Boolean\(SCENE_TUNING\.visibility\?\.vehicles \?\? 1\)/);
  assert.match(viewSource, /const passengersVisible = Boolean\(SCENE_TUNING\.visibility\?\.passengers \?\? 1\)/);
  assert.match(viewSource, /view\.visible = vehiclesVisible/);
  assert.match(viewSource, /view\.visible = passengersVisible && slot\.colorIndex !== null/);
  assert.match(viewSource, /entry\.root\.visible = passengersVisible/);
  assert.match(viewSource, /if \(!this\.inputEnabled \|\| this\.isVehicleInputLocked\(\) \|\| !Boolean\(SCENE_TUNING\.visibility\?\.vehicles \?\? 1\)\) return/);
  assert.match(stylesSource, /\.cta-button\[hidden\]\s*\{\s*display:\s*none;\s*\}/);
});

test('frames keep every sound event: a departure and a boarding in one frame both survive', () => {
  const game = new BusLoopGame(LEVEL_1);
  game.initializeQueues([10, 10], 0.4, [4, 4], LEVEL_1.conveyorPathLength ?? 1, {
    layoutId: 'dualQueue2',
    capacity: LEVEL_1.conveyorCapacity,
    queueCapacities: [10, 10],
    entryPercents: [...(LEVEL_1.entryPercents ?? [])],
    exitStart: LEVEL_1.exitStart,
    exitEnd: LEVEL_1.exitEnd,
    directEntrance: false,
    initiallyFull: false
  });
  // lastEvent is a single slot; frameAudioEvents accumulates every sound
  // event so the audio layer never loses an earlier one to a later overwrite.
  game.lastEvent = { type: 'reset' };
  game.frameAudioEvents.length = 0;
  const departed = game.recordEvent({ type: 'vehicle-full', vehicleId: 1 });
  const boarded = game.recordEvent({ type: 'group-boarded', vehicleId: 1, colorIndex: 0, boardedGroups: 1 });
  assert.equal(game.lastEvent.type, 'group-boarded');
  assert.equal(game.lastEvent, boarded);
  assert.equal(departed.type, 'vehicle-full');
  assert.deepEqual(
    game.frameAudioEvents.map((event) => event.type),
    ['vehicle-full', 'group-boarded']
  );
  // The snapshot must expose the list so the runtime can play all of them.
  assert.deepEqual(
    game.snapshot().frameAudioEvents.map((event) => event.type),
    ['vehicle-full', 'group-boarded']
  );
  // And update() starts each frame with a clean list.
  game.update(0.05);
  assert.ok(!game.frameAudioEvents.some((event) => event.type === 'vehicle-full' && event.vehicleId === 1 && game.time > 0));
});

test('sound delay tuning is wired from the editor through the audio controller', () => {
  const audioSource = readFileSync(join('src', 'audio-controller.js'), 'utf8');
  const mainSource = readFileSync(join('src', 'main.js'), 'utf8');
  const editorSource = readFileSync(join('src', 'scene-editor.js'), 'utf8');
  assert.deepEqual(SCENE_TUNING.audio, {
    busHitDelay: 0,
    busFullDelay: 0,
    passengerUpDelay: 0,
    vehicleTapDelay: 0,
    vehicleTapVolume: 1,
    // The looping track is off until a level enables it; the asset, level and
    // fade live here so the editor can tune them per level.
    bgm: {
      enabled: 0,
      asset: '/assets/unity/audio/christmas_bgm.mp3',
      volume: 0.42,
      fadeInSeconds: 0.8
    }
  });
  // Controller: per-sound delay lookup and a scheduled start.
  assert.match(audioSource, /getDelay = null/);
  assert.match(audioSource, /const delay = Math\.max\(0, Number\(this\.getDelay\?\.\(name\)\) \|\| 0\)/);
  assert.match(audioSource, /source\.start\(delaySeconds > 0 \? context\.currentTime \+ delaySeconds : 0\)/);
  // Runtime: the three tuning fields map onto the three clip names.
  assert.match(mainSource, /getDelay: \(name\) => \{/);
  assert.match(mainSource, /if \(name === 'bus_hit'\) return tuning\.busHitDelay \?\? 0/);
  assert.match(mainSource, /if \(name === 'bus_full'\) return tuning\.busFullDelay \?\? 0/);
  assert.match(mainSource, /if \(name === 'passenger_up'\) return tuning\.passengerUpDelay \?\? 0/);
  // Editor fields exist with the positive-delay range.
  assert.match(editorSource, /'audio\.busFullDelay', 0, 2, 0\.01/);
  assert.match(editorSource, /'audio\.busHitDelay', 0, 2, 0\.01/);
  assert.match(editorSource, /'audio\.passengerUpDelay', 0, 2, 0\.01/);
  // The tap sound follows the same delay path plus a volume multiplier.
  assert.match(mainSource, /if \(name === 'vehicle_tap'\) return tuning\.vehicleTapDelay \?\? 0/);
  assert.match(mainSource, /getVolumeScale: \(name\) => \{/);
  assert.match(mainSource, /tuning\.vehicleTapVolume/);
  assert.match(editorSource, /'audio\.vehicleTapDelay', 0, 2, 0\.01/);
  assert.match(editorSource, /'audio\.vehicleTapVolume', 0, 2, 0\.01/);
});

test('collision bump travels to the rendered touch point, with the true gap preserved', () => {
  // `maxBumpDistance` used to cap the animation at 0.5. That is fine for the
  // usual 0.1-gap neighbour, but it stranded an isolated car in mid-air: E-21
  // v#57 sits 0.78 away and needed 1.05 of travel to reach its blocker, so the
  // capped bump stopped with a car-length of empty space in front of it and the
  // player read it as "it hit nothing". Meeting the blocker wins over a short
  // lunge, so the cap no longer applies to the bump travel.
  const source = readFileSync(join('src', 'game-model.js'), 'utf8');
  // No live read of the tuning key remains (the comment above the code mentions
  // it to explain why it was dropped).
  assert.doesNotMatch(source, /Number\(SCENE_TUNING\.collision\?\.maxBumpDistance\)/);
  // Travel = geometric gap + both cars' visual overhang, floored so a
  // nose-touching neighbour still shows movement.
  assert.match(source, /const visualOverhang = collisionVisualOverhang\(contact\.candidate, vehicle, this\.level\)/);
  assert.match(source, /const bumpDistance = Math\.max\(MIN_VISIBLE_BUMP_DISTANCE, contact\.distance \+ visualOverhang\)/);
  assert.match(source, /const motion = getCollisionMotion\(bumpDistance\)/);
  // The true obstacle gap stays available for diagnostics and future tuning.
  assert.match(source, /actualDistance: contact\.distance/);

  // A blocked bump must always reach its contact point: travel >= gap.
  const game = new BusLoopGame(LEVEL_1);
  game.initializeQueues([10, 10], 0.4, [4, 4], LEVEL_1.conveyorPathLength ?? 1, {
    layoutId: 'dualQueue2',
    capacity: LEVEL_1.conveyorCapacity,
    queueCapacities: [10, 10],
    entryPercents: [...(LEVEL_1.entryPercents ?? [])],
    exitStart: LEVEL_1.exitStart,
    exitEnd: LEVEL_1.exitEnd,
    directEntrance: false,
    initiallyFull: false
  });
  for (const v of game.vehicles.filter((item) => item.state === 'parked')) {
    const result = game.clickVehicle(v.id);
    if (result.ok || result.reason !== 'blocked' || !v.collision) continue;
    assert.ok(
      v.collision.distance >= v.collision.actualDistance,
      `v#${v.id} travel ${v.collision.distance} must reach gap ${v.collision.actualDistance}`
    );
  }
});

test('a blocked bump always reaches the rendered touch point, never a capped short one', () => {
  // A cap on bump travel is incompatible with "the car reaches its blocker":
  // E-21 v#57 needs 1.40 units and a 0.5 cap left it marooned with a car-length
  // of empty space ahead. Assert travel covers the collision gap plus BOTH cars'
  // model-vs-footprint overhang for every blocked tap on the shipped levels.
  // 1.141 is measured in the running scene (rendered AABB vs collision box),
  // not derived from modelDepthBySeats x modelScale — that product is 22% too
  // long and makes the car drive into its blocker.
  const RENDERED_OVER_COLLISION = 1.141;
  const overhang = (seats, level) => {
    const collisionLength = Number(
      level.collision?.vehicleSizes?.[seats]?.length ?? level.collision?.maxVehicleSize?.length
    );
    if (!(collisionLength > 0)) return 0;
    return Math.max(0, (collisionLength * RENDERED_OVER_COLLISION - collisionLength) / 2);
  };
  let checked = 0;
  for (const [key, level] of Object.entries(LEVEL_CATALOG)) {
    if (!level?.vehicles?.length) continue;
    for (const entry of level.vehicles) {
      const game = new BusLoopGame(structuredClone(level));
      const vehicle = game.getVehicle(entry.id);
      if (!vehicle || vehicle.state !== 'parked') continue;
      const result = game.clickVehicle(vehicle.id);
      if (result.reason !== 'blocked' || !vehicle.collision) continue;
      const collision = vehicle.collision;
      const target = collision.targetId ? game.getVehicle(collision.targetId) : null;
      const needed = collision.actualDistance
        + overhang(vehicle.seats, level)
        + (target ? overhang(target.seats, level) : 0);
      checked += 1;
      assert.ok(
        collision.distance >= needed - 1e-6,
        `${key} v#${vehicle.id}: travel ${collision.distance} < needed ${needed}`
      );
    }
  }
  assert.ok(checked > 20, `expected many blocked taps, measured ${checked}`);
});

test('hit particles fire for every collision event in a frame, not only lastEvent', () => {
  const effects = readFileSync(join('src', 'vehicle-effects.js'), 'utf8');
  assert.match(effects, /const frameCollisions = \(snapshot\.frameAudioEvents \?\? \[\]\)/);
  assert.match(effects, /\.filter\(\(event\) => event\.type === 'vehicle-collision-contact'\)/);
  assert.match(effects, /for \(const event of frameCollisions\) this\.spawnHitForEvent\(event\)/);
  assert.match(effects, /spawnHitForEvent\(event\) \{/);
  // Duplicate suppression still applies across the frame list and lastEvent.
  assert.match(effects, /if \(key === this\.lastCollisionContactKey\) return;/);
});

test('parking row stays centred on x=0 for every count and spacing when auto-centring is on', async () => {
  const { resolveParkingStartX } = await import('../src/stage-scene.js');
  for (const count of [1, 2, 3, 4, 5, 6, 8]) {
    for (const spacing of [0.5, 0.95, 1.4]) {
      const startX = resolveParkingStartX({ count, spacing, autoCenter: 1, startX: -1.5 });
      const centre = startX + ((count - 1) * spacing) / 2;
      assert.ok(
        Math.abs(centre) < 1e-9,
        `count ${count} spacing ${spacing} should centre on 0, got ${centre}`
      );
    }
  }
  // Turning the toggle off restores the hand-authored edge.
  assert.equal(
    resolveParkingStartX({ count: 4, spacing: 0.95, autoCenter: 0, startX: -1.5 }),
    -1.5
  );
});

test('a stage pins its own parking spot count for both the scene and the game model', async () => {
  const { resolveParkingSpots, resolveParkingStartX, setActiveStageScene } = await import('../src/stage-scene.js');
  try {
    // No stage: the global tuning wins, so single-level playables are unchanged.
    setActiveStageScene(null);
    assert.equal(resolveParkingSpots().count, SCENE_TUNING.parkingSpots.count);

    // Q22 stage 1 opens with six spots and stage 2 runs the four-spot hard board.
    setActiveStageScene({ parkingSpots: { count: 6 } });
    assert.equal(resolveParkingSpots().count, 6);
    const sixStartX = resolveParkingStartX(resolveParkingSpots());
    setActiveStageScene({ parkingSpots: { count: 4 } });
    assert.equal(resolveParkingSpots().count, 4);
    const fourStartX = resolveParkingStartX(resolveParkingSpots());
    // Each count centres its own row, so the left edge differs between stages.
    const spacing = SCENE_TUNING.parkingSpots.spacing;
    assert.notEqual(sixStartX, fourStartX);
    assert.ok(Math.abs(sixStartX + (5 * spacing) / 2) < 1e-9);
    assert.ok(Math.abs(fourStartX + (3 * spacing) / 2) < 1e-9);

    // A stage without the key must not erase the global count.
    setActiveStageScene({ conveyorLayout: 'dualQueue2' });
    assert.equal(resolveParkingSpots().count, SCENE_TUNING.parkingSpots.count);
  } finally {
    setActiveStageScene(null);
  }
});

test('parking spot roots follow the count without a reload', async () => {
  const viewSource = readFileSync('src/scene-view.js', 'utf8');
  const editorSource = readFileSync('src/scene-editor.js', 'utf8');
  // Roots are pooled on demand instead of being built once from the count.
  assert.match(viewSource, /ensureSpotRootCount\(\)/);
  assert.match(viewSource, /while \(this\.spotRoots\.length < desired\)/);
  // applyTuning has to call it, or the editor slider stays invisible until reload.
  const layoutBlock = viewSource.slice(
    viewSource.indexOf('const startX = resolveParkingStartX(spots);'),
    viewSource.indexOf('const startX = resolveParkingStartX(spots);') + 200
  );
  assert.match(layoutBlock, /this\.ensureSpotRootCount\(\)/, 'applyTuning must resize the spot pool');
  assert.match(viewSource, /this\.spotRoots\[i\]\.visible = i < activeCount/);
  assert.match(editorSource, /parkingSpots\.autoCenter', 0, 1, 1, null, 'toggle'/);
});

test('a single-queue level fills every visible queue lane', async () => {
  // A-1 is authored for ConveyorBelt1 (one queue) but the rendered two-lane
  // artwork shows two lanes. Keeping the authored shape left one lane empty, so
  // the operator saw one crowded column beside a bare one and the belt only ever
  // filled from one side.
  const { distributeQueuesAcrossLanes } = await import('../src/game-model.js');

  // Round-robin keeps the authored colour progression in both lanes, so neither
  // column ends up holding only one part of the colour sequence.
  const distributed = distributeQueuesAcrossLanes([[0, 0, 4, 4, 5, 5]], 2);
  assert.equal(distributed.length, 2);
  assert.deepEqual(distributed.map((lane) => lane.length), [3, 3]);
  assert.deepEqual(distributed[0], [0, 4, 5]);
  assert.deepEqual(distributed[1], [0, 4, 5]);
  // No passenger may be lost or duplicated by the split.
  assert.deepEqual(
    distributed.flat().sort((a, b) => a - b),
    [0, 0, 4, 4, 5, 5].sort((a, b) => a - b),
    'the split must preserve the passenger multiset'
  );

  // Already-matching lane counts pass through untouched.
  const paired = [[1, 2], [3, 4]];
  assert.equal(distributeQueuesAcrossLanes(paired, 2), paired);
  // A single lane collapses everything into one column.
  assert.deepEqual(distributeQueuesAcrossLanes([[1], [2]], 1), [[1, 2]]);
  // Degenerate input must not throw.
  assert.deepEqual(distributeQueuesAcrossLanes([], 2), []);

  const base = LEVEL_CATALOG.level5;
  const level = {
    ...JSON.parse(JSON.stringify(base)),
    key: 'level1001',
    passengerQueues: [Array.from({ length: 60 }, (_, index) => index % 3)],
    entryPercents: [0, 0.421]
  };
  const game = new BusLoopGame(level);
  game.initializeQueues([22, 20], 0.4, [10, 10], level.conveyorPathLength, {
    capacity: 36,
    queueCapacities: [22, 20],
    entryPercents: level.entryPercents,
    exitStart: 0.605,
    exitEnd: 0.78,
    directEntrance: false
  });
  const snapshot = game.snapshot();
  // Both lanes receive passengers immediately instead of one sitting empty.
  assert.ok(snapshot.queues.length === 2);
  assert.ok(snapshot.queues[1].length > 0, 'the second lane must not start empty');
  const waiting = game.queues.reduce((sum, queue) => sum + queue.length, 0)
    + game.sourceQueues.reduce((sum, queue) => sum + queue.length, 0);
  assert.equal(waiting, 60, 'no passenger may be lost or duplicated');

  // Both belt entry points must actually feed the belt.
  for (let step = 0; step < 20 * 30; step += 1) game.update(0.05);
  const filled = game.snapshot().slots.filter((slot) => slot.colorIndex !== null);
  const usedEntries = new Set(filled.map((slot) => slot.entryIndex));
  assert.equal(filled.length, 36, 'the belt should be full');
  assert.deepEqual([...usedEntries].sort(), [0, 1], 'both entry points must feed the belt');
});

function resultCardFixture({ retryEnabled = 0, failed = true, replay = false } = {}) {
  const mainSource = readFileSync('src/main.js', 'utf8');
  const start = mainSource.indexOf('  function syncResultInteraction()');
  const end = mainSource.indexOf('  function showResultOverlay(', start);
  assert.ok(start >= 0 && end > start);
  const classes = new Set(failed ? ['is-failed'] : []);
  const attrs = new Map();
  const overlay = {
    hidden: false,
    classList: {
      contains: key => classes.has(key),
      toggle(key, enabled) { if (enabled) classes.add(key); else classes.delete(key); }
    },
    setAttribute: (key, value) => attrs.set(key, value),
    removeAttribute: key => attrs.delete(key)
  };
  const retry = {}, cta = {}, storeCalls = [];
  const create = new Function('gameOverOverlay', 'gameOverRetryButton', 'ctaButton', 'SCENE_TUNING',
    'resolveBrandingCopy', 'InstallFullGame', `
      let gameOverActive = true;
      ${mainSource.slice(start, end)}
      return { syncResultInteraction, handleResultActivation,
        setActive(value) { gameOverActive = value; syncResultInteraction(); } };
    `);
  const controller = create(overlay, retry, cta, { gameOver: { retryEnabled }, superBoost: { enabled: replay ? 1 : 0 } },
    () => ({ ctaLabel: 'Download' }), () => storeCalls.push('store'));
  controller.syncResultInteraction();
  const event = (type = 'click', key) => ({ type, key, prevented: false, stopped: false,
    preventDefault() { this.prevented = true; }, stopPropagation() { this.stopped = true; } });
  return { controller, overlay, retry, cta, classes, attrs, storeCalls, event };
}

test('failure end-card activation waits for the icon, hides Retry and uses one store call per click', () => {
  const f = resultCardFixture();
  assert.equal(f.retry.hidden, true);
  assert.equal(f.cta.disabled, true);
  assert.equal(f.overlay.tabIndex, -1);
  f.controller.handleResultActivation(f.event());
  assert.deepEqual(f.storeCalls, []);
  f.classes.add('is-cta-ready');
  f.controller.syncResultInteraction();
  assert.deepEqual(f.storeCalls, [], 'the icon appearing must not open the store by itself');
  assert.equal(f.overlay.tabIndex, 0);
  assert.equal(f.attrs.get('role'), 'link');
  assert.equal(f.attrs.get('aria-label'), 'Download');
  const click = f.event();
  f.controller.handleResultActivation(click);
  assert.deepEqual(f.storeCalls, ['store']);
  assert.equal(click.prevented && click.stopped, true);
  f.controller.handleResultActivation(f.event('keydown', 'Escape'));
  assert.equal(f.storeCalls.length, 1);
  for (const key of ['Enter', ' ']) f.controller.handleResultActivation(f.event('keydown', key));
  assert.equal(f.storeCalls.length, 3);
  f.overlay.hidden = true;
  f.controller.handleResultActivation(f.event());
  assert.equal(f.storeCalls.length, 3, 'a hidden end card cannot retain its click target');
  f.controller.setActive(false);
  assert.equal(f.cta.disabled, false);
  assert.equal(f.overlay.tabIndex, -1);
  assert.equal(f.attrs.has('role'), false);
  f.controller.handleResultActivation(f.event());
  assert.equal(f.storeCalls.length, 3);
});

test('boost replay cards expose a single action for either outcome and block background store taps', () => {
  for (const failed of [true, false]) {
    const f = resultCardFixture({ replay: true, failed });
    assert.equal(f.retry.hidden, false);
    assert.equal(f.retry.disabled, true);
    assert.equal(f.cta.disabled, true);
    f.classes.add('is-cta-ready');
    f.controller.syncResultInteraction();
    assert.equal(f.retry.disabled, false);
    f.controller.handleResultActivation(f.event());
    assert.deepEqual(f.storeCalls, []);
    assert.equal(f.classes.has('is-tap-to-store'), false);
  }
});

test('Retry mode and winning cards do not acquire the failure card store action', () => {
  for (const config of [{ retryEnabled: 1, failed: true }, { retryEnabled: 0, failed: false }]) {
    const f = resultCardFixture(config);
    f.classes.add('is-cta-ready');
    f.controller.syncResultInteraction();
    f.controller.handleResultActivation(f.event());
    assert.deepEqual(f.storeCalls, []);
    assert.equal(f.retry.hidden, !config.failed);
    assert.equal(f.cta.disabled, config.failed);
    assert.equal(f.overlay.tabIndex, -1);
  }
});

test('failure presentation places Download below the mask without its pulse and wires the full card', () => {
  const mainSource = readFileSync('src/main.js', 'utf8');
  const stylesSource = readFileSync('src/styles.css', 'utf8');
  const dimmed = stylesSource.match(/\.game-over-overlay\.is-failed:not\(\[hidden\]\) ~ \.cta-button \{([^}]+)\}/)[1];
  assert.match(dimmed, /animation: none/);
  assert.match(dimmed, /transform: translate\(-50%, -50%\)/);
  const maskZ = Number(stylesSource.match(/\.game-over-overlay \{[^}]*z-index: (\d+)/)[1]);
  assert.ok(Number(dimmed.match(/z-index: (\d+)/)[1]) < maskZ);
  assert.match(mainSource, /gameOverOverlay\?\.addEventListener\('click', handleResultActivation\)/);
  assert.match(mainSource, /gameOverOverlay\?\.addEventListener\('keydown', handleResultActivation\)/);
});

test('an opted-in Retry restarts the run, while wins and the default store end card hide it', async () => {
  const mainSource = readFileSync('src/main.js', 'utf8');
  const indexSource = readFileSync('index.html', 'utf8');
  const stylesSource = readFileSync('src/styles.css', 'utf8');

  // The button has to exist outside the overlay: the overlay owns the mask and
  // the pop animation, and a button inside it would inherit the fading title
  // stacking. It is a sibling, so the ready state uses `+`, not a descendant.
  const overlayEnd = indexSource.indexOf('</div>', indexSource.indexOf('id="game-over-overlay"'));
  assert.ok(indexSource.indexOf('id="game-over-retry"') > overlayEnd);
  assert.match(stylesSource, /\.game-over-overlay\.is-cta-ready \+ \.game-over-retry/);
  assert.doesNotMatch(stylesSource, /\.game-over-overlay\.is-cta-ready ~ \.game-over-retry/);

  // The default failure card uses the entire overlay as its store link.
  assert.equal(SCENE_TUNING.gameOver.retryEnabled, 0);
  assert.match(mainSource, /gameOverRetryButton\.hidden = !gameOverActive \|\| !failed \|\| tapToStore/);
  assert.match(mainSource, /showResultOverlay\('You Win!', \{ failed: false \}\)/);
  assert.match(mainSource, /function hideGameOver\(\)[\s\S]{0,550}gameOverRetryButton\.hidden = true/);

  // Tapping it restarts the run by default, through the same reset path as the
  // other replay buttons, so the session, install gate and speed state are all
  // rebuilt. A delivery can repoint it at the store with `retryAction: 'store'`
  // (the Q165V1 timed build uses it as a second CTA); that branch must route
  // through the install path, not reset().
  assert.match(
    mainSource,
    /gameOverRetryButton\?\.addEventListener\('click',[\s\S]{0,400}retryAction === 'store'[\s\S]{0,120}InstallFullGame\(\);[\s\S]{0,400}reset\(\);/
  );

  // The pill art ships blank and the word is a text layer, so the operator can
  // size the label independently of the button. It must render exactly once.
  assert.match(indexSource, /id="game-over-retry"[^>]*>Retry<\/button>/);
  assert.equal(indexSource.split('>Retry</button>').length - 1, 1);
  assert.match(stylesSource, /Main_Prop_RedBtn_blank_q90\.webp/);

  // The shared `button:hover` rule paints `background: #fff`, which turned this
  // button into a blank white pill. The art and the centering transform both
  // have to be restated in the hover rule. The art itself is declared once as a
  // custom property, so the single-HTML export inlines it once instead of twice
  // (a repeat trips FINAL_PAYLOAD_DUPLICATE_WASTE).
  assert.match(
    stylesSource,
    /--game-over-retry-background: url\('\/assets\/unity\/ui\/Main_Prop_RedBtn_blank_q90\.webp'\) center \/ 100% 100% no-repeat;/
  );
  assert.match(
    stylesSource,
    /\.game-over-retry:hover,\s*\n\.game-over-retry:focus-visible \{\s*\n\s*background: transparent var\(--game-over-retry-background\);/
  );
  assert.equal(
    stylesSource.split("Main_Prop_RedBtn_blank_q90.webp").length - 1,
    1,
    'the retry pill art must be referenced exactly once so it is inlined once'
  );

  // Default placement is under the logo, not on the CTA strip: the button's
  // default y is derived from the logo's bottom edge, and the shipped value sits
  // above the CTA row.
  assert.match(mainSource, /const logoBottom = [\s\S]{0,260}?const retryDefaultY = logoBottom \+/);
  const { SCENE_TUNING: tuning } = await import('../src/scene-tuning.js');
  const logoBottom = tuning.gameOver.logoY + tuning.gameOver.logoHeight / 2;
  const retryHeight = tuning.gameOver.retryWidth * (383 / 1400);
  const retryTop = tuning.gameOver.retryY - retryHeight / 2;
  assert.ok(retryTop > logoBottom, `Retry (${retryTop}) must start below the logo bottom (${logoBottom})`);
  assert.ok(tuning.gameOver.retryY < tuning.cta.y, 'Retry must sit above the CTA row');

  // Saved profiles snapshot the whole tuning object, so a changed shipped
  // default only reaches existing levels through this migration. It must cover
  // size as well as position, and only rewrite the exact legacy values.
  // Only the label shrinks; the pill keeps its shipped width.
  assert.match(mainSource, /const RETRY_WIDTH = 420;/);
  assert.match(mainSource, /const LEGACY_RETRY_FONT_SIZE = 88;/);
  assert.match(mainSource, /const RETRY_FONT_SIZE = 53;/);
  assert.match(mainSource, /Number\(gameOver\.retryFontSize\) === LEGACY_RETRY_FONT_SIZE/);
  // A saved per-level profile is merged back over SCENE_TUNING, so the global
  // migration alone never reaches a level the operator already opened.
  assert.match(mainSource, /function migrateGameOverRetryPositionProfiles\(\)/);
  assert.match(mainSource, /migrateGameOverRetryPositionProfiles\(\);/);
});
