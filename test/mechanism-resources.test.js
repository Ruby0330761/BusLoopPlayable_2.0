import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import {
  MECHANISM_ASSETS,
  MECHANISM_RESOURCE_MANIFEST,
  deriveLevelMechanics,
  getMechanismTypesForLevels
} from '../src/mechanism-resources.js';
import { COLORS } from '../src/level-data.js';
import { LEVEL_CATALOG } from '../src/level-catalog.js';

test('mechanism resource manifest keeps every mechanism family under its owned directory', () => {
  for (const paths of Object.values(MECHANISM_RESOURCE_MANIFEST)) {
    for (const asset of paths) assert.equal(existsSync(`public${asset}`), true, asset);
  }
});

test('entry banner resources stay isolated and are selected only when enabled', () => {
  const entryBanner = MECHANISM_RESOURCE_MANIFEST.entryBanner;
  assert.equal(entryBanner.length, 6);
  assert.ok(entryBanner.every((asset) => asset.includes('/mechanisms/entry-banner/')));
  assert.deepEqual(
    deriveLevelMechanics({}).types,
    ['ordinaryConveyor']
  );
  assert.deepEqual(getMechanismTypesForLevels([{}]), ['ordinaryConveyor']);
  assert.deepEqual(getMechanismTypesForLevels([{}], { entryBannerEnabled: true }), [
    'ordinaryConveyor', 'entryBanner'
  ]);
});

test('angry passenger Emoji resources stay isolated and are selected only when enabled', () => {
  const emojiAssets = MECHANISM_RESOURCE_MANIFEST.passengerEmoji;
  assert.deepEqual(emojiAssets, [
    '/assets/unity/mechanisms/passenger-emoji/angry-emoji-sheet.webp'
  ]);
  assert.ok(emojiAssets.every((asset) => asset.includes('/mechanisms/passenger-emoji/')));
  assert.deepEqual(getMechanismTypesForLevels([{}]), ['ordinaryConveyor']);
  assert.deepEqual(getMechanismTypesForLevels([{}], { passengerEmojiEnabled: true }), [
    'ordinaryConveyor', 'passengerEmoji'
  ]);
  assert.equal(MECHANISM_ASSETS.passengerEmoji.angrySheet, emojiAssets[0]);
  const sheet = readFileSync(`public${emojiAssets[0]}`);
  assert.equal(sheet.subarray(0, 4).toString('ascii'), 'RIFF');
  assert.equal(sheet.subarray(8, 12).toString('ascii'), 'WEBP');
  assert.equal(sheet.subarray(12, 16).toString('ascii'), 'VP8L');
  const width = 1 + ((sheet[21] | (sheet[22] << 8)) & 0x3fff);
  const height = 1 + (((sheet[22] >> 6) | (sheet[23] << 2) | (sheet[24] << 10)) & 0x3fff);
  assert.equal(width, 1024);
  assert.equal(height, 1024);
  const main = readFileSync('src/main.js', 'utf8');
  assert.match(main, /PASSENGER_EMOJI_COLUMNS = 8/);
  assert.match(main, /PASSENGER_EMOJI_ROWS = 8/);
  assert.match(main, /PASSENGER_EMOJI_FRAME_COUNT/);
  assert.match(readFileSync('src/styles.css', 'utf8'), /\.passenger-emoji[\s\S]*background-size: 800% 800%/);
});

test('random playable audio resources stay isolated and are selected only when enabled', () => {
  const audioAssets = MECHANISM_RESOURCE_MANIFEST.randomPlayableAudio;
  assert.deepEqual(audioAssets, [
    '/assets/unity/mechanisms/random-playable-audio/audio/police-ring.bin',
    '/assets/unity/mechanisms/random-playable-audio/audio/move.mp3',
    '/assets/unity/mechanisms/random-playable-audio/audio/hey-move-it.mp3'
  ]);
  assert.ok(audioAssets.every((asset) => asset.includes('/mechanisms/random-playable-audio/')));
  assert.deepEqual(getMechanismTypesForLevels([{}]), ['ordinaryConveyor']);
  assert.deepEqual(getMechanismTypesForLevels([{}], { randomPlayableAudioEnabled: true }), [
    'ordinaryConveyor', 'randomPlayableAudio'
  ]);
  assert.equal(MECHANISM_ASSETS.randomPlayableAudio.policeRing, audioAssets[0]);
  const packedPoliceRing = readFileSync(`public${audioAssets[0]}`);
  assert.equal(packedPoliceRing.subarray(0, 2).toString('hex'), '1f8b');
  const policeRingWav = gunzipSync(packedPoliceRing);
  assert.equal(policeRingWav.subarray(0, 4).toString('ascii'), 'RIFF');
  assert.equal(policeRingWav.subarray(8, 12).toString('ascii'), 'WAVE');
  assert.equal(policeRingWav.readUInt16LE(22), 1);
  assert.equal(policeRingWav.readUInt32LE(24), 16000);
  assert.equal(policeRingWav.readUInt16LE(34), 16);
  assert.ok(packedPoliceRing.length < 160_000);
  assert.equal(readFileSync(`public${audioAssets[1]}`).subarray(0, 3).toString('ascii'), 'ID3');
  assert.equal(readFileSync(`public${audioAssets[2]}`).subarray(0, 3).toString('ascii'), 'ID3');
});

test('police-car resources are isolated and only selected for police vehicles', () => {
  const policeAssets = MECHANISM_RESOURCE_MANIFEST.policeCar;
  assert.deepEqual(policeAssets, [
    '/assets/unity/mechanisms/police-car/models/Police Car_001.fbx',
    '/assets/unity/mechanisms/police-car/models/Idle_boy_police_vatmesh.bin',
    '/assets/unity/mechanisms/police-car/models/Idle_boy_police_anim_map.vatq',
    '/assets/unity/mechanisms/police-car/textures/Police Car.png',
    '/assets/unity/mechanisms/police-car/textures/Idle_boy_police.png',
    '/assets/unity/mechanisms/police-car/audio/police_siren.bin'
  ]);
  assert.deepEqual(deriveLevelMechanics({}).types, ['ordinaryConveyor']);
  assert.deepEqual(deriveLevelMechanics({
    vehicles: [{ id: 1, colorIndex: 11, seats: 4 }]
  }).types, ['ordinaryConveyor', 'policeCar']);
  assert.equal(deriveLevelMechanics({
    vehicles: [{ id: 1, colorIndex: 11, seats: 4 }]
  }).counts.policeCar, 1);
  assert.deepEqual(getMechanismTypesForLevels([{ vehicles: [{ colorIndex: 11 }] }]), [
    'ordinaryConveyor', 'policeCar'
  ]);
  assert.equal(COLORS[11].hex, 0x4f6275);
  assert.equal(COLORS[12].hex, 0xd32f2f);
});

test('fire-truck passenger uses the Unity firefighter texture atlas', () => {
  const asset = '/assets/unity/mechanisms/fire-truck/textures/Idle_boy_firefighter.png';
  const hash = createHash('sha256')
    .update(readFileSync(`public${asset}`))
    .digest('hex')
    .toUpperCase();
  assert.equal(hash, '18F965039B0F91422FBFCC39C4A0E1FEF672286265D6A7E0FB7E413115C69C48');
  assert.match(readFileSync('src/mechanism-resources.js', 'utf8'), /fire-truck\/textures\/Idle_boy_firefighter\.png/);
});

test('fire-truck runtime audio keeps the Unity clips in compact mono PCM files', () => {
  const audioAssets = [
    '/assets/unity/mechanisms/fire-truck/audio/firetruck_1.bin',
    '/assets/unity/mechanisms/fire-truck/audio/firetruck_3.bin'
  ];
  assert.ok(audioAssets.every((asset) => MECHANISM_RESOURCE_MANIFEST.fireTruck.includes(asset)));
  for (const asset of audioAssets) {
    const audio = readFileSync(`public${asset}`);
    assert.equal(audio.subarray(0, 2).toString('hex'), '1f8b');
    const wav = gunzipSync(audio);
    assert.equal(wav.subarray(0, 4).toString('ascii'), 'RIFF');
    assert.equal(wav.subarray(8, 12).toString('ascii'), 'WAVE');
    assert.equal(wav.readUInt16LE(22), 1);
    assert.equal(wav.readUInt32LE(24), 16000);
    assert.equal(wav.readUInt16LE(34), 16);
    assert.ok(audio.length < wav.length);
  }
  assert.match(readFileSync('src/audio-controller.js', 'utf8'), /decodeOptionalGzip/);
});

test('runtime audio initialization follows the same per-level mechanism selection as packaging', () => {
  const main = readFileSync('src/main.js', 'utf8');
  assert.match(main, /getMechanismTypesForLevels\(sessionLevels[\s\S]*passengerEmojiEnabled[\s\S]*randomPlayableAudioEnabled/);
  for (const type of ['ambulance', 'policeCar', 'turnVehicle', 'hiddenVehicle', 'fireTruck', 'garage']) {
    assert.match(main, new RegExp(`sessionMechanismTypes\\.has\\(MECHANISM_TYPES\\.${type}\\)`));
  }
  assert.doesNotMatch(main, /\.\.\.LEVEL_1\.assets\.audio,\s*ambulance_countdown:/);
});

test('fire-truck VAT mesh preserves FBX UV seam vertices and mirrored winding', () => {
  const packedMesh = readFileSync('public/assets/unity/mechanisms/fire-truck/models/Idle_boy_firefighter_vatmesh.bin');
  assert.equal(packedMesh.subarray(0, 2).toString('hex'), '1f8b');
  const mesh = gunzipSync(packedMesh);
  assert.equal(mesh.subarray(0, 4).toString('ascii'), 'VATM');
  assert.equal(mesh.readUInt32LE(4), 2);
  assert.equal(mesh.readUInt32LE(8), 2856);
  assert.equal(mesh.readUInt32LE(12), 2856);
  const packedVat = readFileSync('public/assets/unity/mechanisms/fire-truck/models/Idle_boy_firefighter_anim_map.vatq');
  assert.equal(packedVat.subarray(0, 2).toString('hex'), '1f8b');
  const vat = gunzipSync(packedVat);
  assert.equal(vat.readUInt32LE(8), 706);
  const sceneSource = readFileSync('src/scene-view.js', 'utf8');
  assert.match(sceneSource, /textureWidth: 706/);
  assert.match(sceneSource, /fireTruckPassengerVat[\s\S]*mirrorX: true/);
  assert.match(readFileSync('scripts/extract-firetruck-vat.mjs', 'utf8'), /vatPointInSourceSpace/);
  assert.match(readFileSync('scripts/extract-firetruck-vat.mjs', 'utf8'), /index\[triangleIndex \+ 1\] = b/);
});

test('fire-truck UI keeps the Unity timer separate from the full-stage warning effect', () => {
  const fireTruckAssets = MECHANISM_RESOURCE_MANIFEST.fireTruck;
  const effectAssets = [
    '/assets/unity/mechanisms/fire-truck/ui/Fire_01.webp',
    '/assets/unity/mechanisms/fire-truck/ui/Warning_01.webp',
    '/assets/unity/mechanisms/fire-truck/ui/Warning_02.webp'
  ];
  const timerAssets = [
    '/assets/unity/mechanisms/fire-truck/ui/Guide_FireTruck_TimeBg.png',
    '/assets/unity/mechanisms/fire-truck/ui/Main_Prop_Icon_Truck.png',
    '/assets/unity/mechanisms/fire-truck/ui/Main_Prop_TimeBg.png',
    '/assets/unity/mechanisms/fire-truck/ui/Main_Prop_Icon_Clock.png'
  ];
  assert.ok(effectAssets.every((asset) => fireTruckAssets.includes(asset) && existsSync(`public${asset}`)));
  assert.ok(timerAssets.every((asset) => fireTruckAssets.includes(asset) && existsSync(`public${asset}`)));
  assert.ok(fireTruckAssets.every((asset) => !asset.endsWith('.png') || timerAssets.includes(asset)
    || asset.includes('/textures/')));
  assert.ok(fireTruckAssets.every((asset) => !asset.endsWith('/Idle_boy_firefighter.FBX')));

  const markup = readFileSync('index.html', 'utf8');
  const styles = readFileSync('src/styles.css', 'utf8');
  const main = readFileSync('src/main.js', 'utf8');
  assert.match(markup, /firetruck-screen-effect[\s\S]*firetruck-timer/);
  assert.match(markup, /firetruck-screen-effect__warning--primary/);
  assert.match(markup, /firetruck-screen-effect__warning--strong/);
  assert.doesNotMatch(markup, /firetruck-hud__label|firetruck-hud__panel/);
  assert.match(styles, /\.firetruck-hud\s*\{[\s\S]*?left: 0;[\s\S]*?width: 100%;[\s\S]*?pointer-events: none;/);
  assert.match(styles, /\.firetruck-screen-effect__warning\s*\{[\s\S]*?object-fit: fill;/);
  assert.match(styles, /\.firetruck-timer\s*\{[\s\S]*?border-radius: 999px;[\s\S]*?overflow: hidden;/);
  assert.match(styles, /\.firetruck-timer__readout-bg\s*\{[\s\S]*?display: none !important;/);
  assert.match(styles, /\.firetruck-hud\[data-stage="2"\] \.firetruck-screen-effect__flame/);
  assert.match(main, /timerFrameTexture/);
  assert.match(main, /--firetruck-fire-texture/);
  assert.match(main, /getBackgroundCanvasBounds/);
  assert.match(main, /syncFireTruckHudBounds\(view\)/);
  assert.doesNotMatch(readFileSync('src/scene-view.js', 'utf8'), /fireTruckUiTextures/);
});

test('entry banner uses the supplied title/background images and keeps the matched fade timeline', () => {
  const sceneSource = readFileSync('src/scene-view.js', 'utf8');
  const styleSource = readFileSync('src/styles.css', 'utf8');
  const editorSource = readFileSync('src/scene-editor.js', 'utf8');
  const tuningSource = readFileSync('src/scene-tuning.js', 'utf8');
  assert.match(sceneSource, /ENTRY_BANNER_TIMELINE_SECONDS = 1\.45/);
  assert.match(sceneSource, /progress \* ENTRY_BANNER_TIMELINE_SECONDS/);
  assert.match(sceneSource, /banner\.mask\.style\.opacity = String\(maskFade\)/);
  assert.match(sceneSource, /assets\.hardBackground/);
  assert.match(sceneSource, /assets\.superHardBackground/);
  assert.match(sceneSource, /assets\.hardTitle/);
  assert.match(sceneSource, /assets\.superHardTitle/);
  assert.match(sceneSource, /this\.entryBanner = this\.createEntryBanner\(\)/);
  assert.match(sceneSource, /this\.updateEntryBanner\(\)/);
  assert.doesNotMatch(editorSource, /entryBanner\.debug/);
  assert.match(editorSource, /entryBanner\.components\./);
  assert.doesNotMatch(editorSource, /EntryBanner \u4e34\u65f6\u8c03\u8bd5/);
  assert.match(tuningSource, /"entryBanner": \{/);
  assert.match(tuningSource, /"components": \{/);
  assert.doesNotMatch(tuningSource, /"debug": \{/);
  assert.match(sceneSource, /SCENE_TUNING\.entryBanner\?\.components/);
  assert.doesNotMatch(sceneSource, /entryBanner\?\.debug/);
  assert.match(sceneSource, /const alpha = frame\(\[\[start, 0\], \[end, 1\], \[end \+ 0\.25, 1\], \[end \+ 0\.32, 0\]\]/);
  assert.match(styleSource, /\.entry-banner-arrow-group[\s\S]*z-index: 3/);
  assert.match(styleSource, /\.entry-banner-label-group[\s\S]*z-index: 4/);
  assert.match(styleSource, /\.entry-banner-label[\s\S]*height: 67\.5%/);
  assert.doesNotMatch(styleSource, /-webkit-text-fill-color: transparent/);
  assert.equal(existsSync('public/assets/unity/mechanisms/entry-banner/sprites/Hard.png'), true);
  assert.equal(existsSync('public/assets/unity/mechanisms/entry-banner/sprites/HardBg.png'), true);
  assert.equal(existsSync('public/assets/unity/mechanisms/entry-banner/sprites/SuperHard.png'), true);
  assert.equal(existsSync('public/assets/unity/mechanisms/entry-banner/sprites/SuperHardBg.png'), true);
  const removedEntryBannerAssets = [
    'EntryBanner.cs',
    'EntryBanner.prefab',
    'EntryBannerDispatcher.cs',
    'Main_EntryBanner_Bg.png',
    'Main_EntryBanner_Mask.png',
    'Main_EntryBanner_PersonPose1.png',
    'Main_EntryBanner_PersonPose2.png',
    'Main_EntryBanner_PersonPose3.png',
    'Main_EntryBanner_PersonPose4.png',
    'Main_EntryBanner_Purple.png',
    'Main_EntryBanner_Red.png',
    'Main_EntryBanner_Shade.png',
    'Main_EntryTipTextBanner_Bg.png',
    'Main_EntryTipTextBanner_HardFire.png',
    'Main_EntryTipTextBanner_SuperHardFire.png'
  ];
  assert.ok(removedEntryBannerAssets.every((name) => (
    !existsSync(`public/assets/unity/mechanisms/entry-banner/sprites/${name}`)
  )));
  assert.match(sceneSource, /updateEntryBannerLayout\(\)/);
  assert.match(sceneSource, /this\.getBackgroundCanvasBounds\?\.\(\)/);
  assert.match(sceneSource, /parent\.clientLeft/);
  assert.match(sceneSource, /const uiScale = Math\.min\(1, playableWidth \/ designWidth, playableHeight \/ designHeight\)/);
  assert.match(sceneSource, /banner\.root\.style\.width = `\$\{playableWidth\}px`/);
  assert.match(sceneSource, /banner\.scene\.style\.width = `\$\{1080 \* uiScale\}px`/);
  assert.equal(existsSync('public/assets/unity/fonts/Poppins-Bold.ttf'), true);
});

test('level mechanism metadata distinguishes ordinary levels from mechanism levels', () => {
  assert.deepEqual(LEVEL_CATALOG.level13.mechanics, {
    isMechanicLevel: false,
    types: ['ordinaryConveyor'],
    counts: {
      luxuryVehicle: 0,
      ambulance: 0,
      policeCar: 0,
      turnVehicle: 0,
      hiddenVehicle: 0,
      garage: 0,
      vehicleTransportBelt: 0
    }
  });
  assert.deepEqual(LEVEL_CATALOG.level29.mechanics.types, [
    'ordinaryConveyor', 'fireTruck'
  ]);
  assert.equal(LEVEL_CATALOG.level29.mechanics.isMechanicLevel, true);
  assert.deepEqual(LEVEL_CATALOG.level28.mechanics.types, [
    'ordinaryConveyor', 'turnVehicle'
  ]);
  assert.deepEqual(LEVEL_CATALOG.level280.mechanics.types, [
    'ordinaryConveyor', 'policeCar'
  ]);
});

test('mechanism metadata can be derived from imported level fields', () => {
  const metadata = deriveLevelMechanics({
    vehicles: [{ colorIndex: 15 }, { isTurnVehicle: true }, { isHidden: true }],
    vehicleAmbulances: [{ vid: 1 }],
    containers: [{ type: 2 }, { type: 3 }],
    conveyorBelts: []
  });
  assert.equal(metadata.isMechanicLevel, true);
  assert.deepEqual(metadata.types, [
    'ordinaryConveyor', 'luxuryVehicle', 'ambulance', 'turnVehicle',
    'hiddenVehicle', 'garage', 'vehicleTransportBelt'
  ]);
});
