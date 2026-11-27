import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import {
  MECHANISM_RESOURCE_MANIFEST,
  MECHANISM_TYPES,
  deriveLevelMechanics,
  getMechanismAudioConfig,
  getMechanismTypesForLevels
} from '../src/mechanism-resources.js';
import { LEVEL_CATALOG } from '../src/level-catalog.js';

test('mechanism resource manifest keeps every mechanism family under its owned directory', () => {
  for (const paths of Object.values(MECHANISM_RESOURCE_MANIFEST)) {
    for (const asset of paths) assert.equal(existsSync(`public${asset}`), true, asset);
  }
});

test('entry banner resources stay isolated and are selected only when enabled', () => {
  const entryBanner = MECHANISM_RESOURCE_MANIFEST.entryBanner;
  // Six layered sprites plus the two single-plate banners that seed the custom
  // style before any upload.
  assert.equal(entryBanner.length, 8);
  assert.ok(entryBanner.every((asset) => asset.includes('/mechanisms/entry-banner/')));
  assert.ok(entryBanner.some((asset) => asset.endsWith('Main_EntryBanner_Storm.webp')));
  assert.ok(entryBanner.some((asset) => asset.endsWith('Main_EntryBanner_Rain.webp')));
  assert.deepEqual(
    deriveLevelMechanics({}).types,
    ['ordinaryConveyor']
  );
  assert.deepEqual(getMechanismTypesForLevels([{}]), ['ordinaryConveyor']);
  assert.deepEqual(getMechanismTypesForLevels([{}], { entryBannerEnabled: true }), [
    'ordinaryConveyor', 'entryBanner'
  ]);
});

test('entry banner uses the supplied title/background images and keeps the matched fade timeline', () => {
  const sceneSource = readFileSync('src/scene-view.js', 'utf8');
  const styleSource = readFileSync('src/styles.css', 'utf8');
  const editorSource = readFileSync('src/scene-editor.js', 'utf8');
  const tuningSource = readFileSync('src/scene-tuning.js', 'utf8');
  assert.match(sceneSource, /ENTRY_BANNER_TIMELINE_SECONDS = 1\.45/);
  assert.match(sceneSource, /progress \* ENTRY_BANNER_TIMELINE_SECONDS/);
  assert.match(sceneSource, /banner\.mask\.style\.opacity = String\(maskFade\)/);
  assert.match(sceneSource, /getEntryBannerArt\(tuning\)/);
  assert.match(sceneSource, /banner\.label\.src = art\.label/);
  assert.match(sceneSource, /this\.entryBanner = SCENE_TUNING\.entryBanner\?\.enabled \? this\.createEntryBanner\(\) : null/);
  assert.match(sceneSource, /if \(!this\.entryBanner\) this\.entryBanner = this\.createEntryBanner\(\)/);
  assert.match(sceneSource, /this\.updateEntryBanner\(\)/);
  assert.doesNotMatch(editorSource, /entryBanner\.debug/);
  assert.match(editorSource, /entryBanner\.components\./);
  assert.doesNotMatch(editorSource, /EntryBanner \u4e34\u65f6\u8c03\u8bd5/);
  assert.match(tuningSource, /"entryBanner": \{/);
  assert.match(tuningSource, /"components": \{/);
  assert.doesNotMatch(tuningSource, /"debug": \{/);
  // Stage presentation overrides the global banner tuning, so components are
  // read through the merged getter rather than straight off SCENE_TUNING.
  assert.match(sceneSource, /this\.getEntryBannerTuning\(\)\?\.components/);
  assert.doesNotMatch(sceneSource, /entryBanner\?\.debug/);
  assert.match(sceneSource, /const alpha = frame\(\[\[start, 0\], \[end, 1\], \[end \+ 0\.25, 1\], \[end \+ 0\.32, 0\]\]/);
  assert.match(styleSource, /\.entry-banner-arrow-group[\s\S]*z-index: 3/);
  assert.match(styleSource, /\.entry-banner-label-group[\s\S]*z-index: 4/);
  assert.match(styleSource, /\.entry-banner-label[\s\S]*height: 67\.5%/);
  // The custom style draws one uploaded plate: the arrow and title layers are
  // hidden and the group sizes itself from the plate's own aspect ratio.
  assert.match(styleSource, /\.entry-banner-overlay\.is-custom \.entry-banner-banner-group[\s\S]*aspect-ratio/);
  assert.match(styleSource, /\.entry-banner-overlay\.is-custom \.entry-banner-arrow-group[\s\S]*display: none/);
  assert.match(sceneSource, /applyEntryBannerPlateAspect/);
  assert.match(sceneSource, /applyEntryBannerPlateAspect\(art\.card\)/);
  // A custom plate must not inherit the layered art's 1.9x component scale: that
  // scale bleeds the band off both edges by design, which ran a phone-width plate
  // past the screen edges. The plate takes `none` instead.
  assert.match(sceneSource, /banner\.card\.style\.transform = 'none'/);
  assert.doesNotMatch(styleSource, /-webkit-text-fill-color: transparent/);
  assert.equal(existsSync('public/assets/unity/mechanisms/entry-banner/sprites/Hard.png'), true);
  assert.equal(existsSync('public/assets/unity/mechanisms/entry-banner/sprites/HardBg.png'), true);
  assert.equal(existsSync('public/assets/unity/mechanisms/entry-banner/sprites/SuperHard.png'), true);
  assert.equal(existsSync('public/assets/unity/mechanisms/entry-banner/sprites/SuperHardBg.png'), true);
  assert.equal(existsSync('public/assets/unity/mechanisms/entry-banner/sprites/Main_EntryBanner_Storm.webp'), true);
  assert.equal(existsSync('public/assets/unity/mechanisms/entry-banner/sprites/Main_EntryBanner_Rain.webp'), true);
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
      turnVehicle: 0,
      hiddenVehicle: 0,
      garage: 0,
      vehicleTransportBelt: 0
    }
  });
  assert.deepEqual(LEVEL_CATALOG.level26.mechanics.types, [
    'ordinaryConveyor', 'ambulance'
  ]);
  assert.equal(LEVEL_CATALOG.level26.mechanics.isMechanicLevel, true);
  assert.deepEqual(LEVEL_CATALOG.level28.mechanics.types, [
    'ordinaryConveyor', 'turnVehicle'
  ]);
  assert.equal(LEVEL_CATALOG.level28.mechanics.isMechanicLevel, true);
  assert.deepEqual(LEVEL_CATALOG.level33.mechanics.types, ['ordinaryConveyor']);
  assert.equal(LEVEL_CATALOG.level33.mechanics.isMechanicLevel, false);
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

test('firetruck and police resources are discoverable and classified from level data', () => {
  const metadata = deriveLevelMechanics({
    vehicles: [
      { mechanism: { type: 'firetruck' } },
      { mechanism: { type: 'police' } }
    ]
  });
  assert.deepEqual(metadata.types, [
    'ordinaryConveyor', 'firetruck', 'police'
  ]);
  assert.equal(metadata.counts.firetruck, 1);
  assert.equal(metadata.counts.police, 1);
  for (const type of ['firetruck', 'police']) {
    assert.ok(MECHANISM_RESOURCE_MANIFEST[type].length > 0);
    assert.ok(MECHANISM_RESOURCE_MANIFEST[type].every((asset) => asset.includes(`/mechanisms/${type}/`)));
  }
});

test('firetruck and police passengers use their dedicated visuals', () => {
  const sceneSource = readFileSync('src/scene-view.js', 'utf8');
  assert.match(sceneSource, /firetruckPassengerTemplate/);
  assert.match(sceneSource, /firetruckPassengerTexture/);
  assert.match(sceneSource, /firetruckPassengerVat/);
  assert.match(sceneSource, /loadVatGeometry\(FIRETRUCK_ASSETS\.passengerVatMesh/);
  assert.match(sceneSource, /loadPackedVatTexture\(FIRETRUCK_ASSETS\.passengerVatTexture/);
  assert.match(sceneSource, /key: 'firetruck-passenger-rgba8-packed'/);
  assert.match(sceneSource, /const version = view\.getUint32\(4, true\)/);
  assert.match(sceneSource, /\[1, 2\]\.includes\(version\)/);
  assert.match(sceneSource, /policePassengerTemplate/);
  assert.match(sceneSource, /policePassengerTexture/);
  assert.match(sceneSource, /key: 'police-passenger-rgba8-packed'/);
  assert.match(sceneSource, /policePassengerVat/);
  assert.match(sceneSource, /createSpecialPassengerAnimation/);
  assert.match(sceneSource, /specialPassengerType/);
  assert.doesNotMatch(sceneSource, /Firefighter Visual Badge|addFirefighterVisualBadge/);
  assert.match(sceneSource, /!root\.userData\.specialPassengerType/);
  assert.match(sceneSource, /visualRoot\?\.userData\.specialPassengerType/);
  assert.match(sceneSource, /!this\.hasFiretruckVehicles\(\)/);
  assert.match(sceneSource, /!this\.hasPoliceVehicles\(\)/);
});

test('mechanism audio config includes only mechanisms used by the session', () => {
  assert.deepEqual(getMechanismAudioConfig([MECHANISM_TYPES.ordinaryConveyor]), {});

  const config = getMechanismAudioConfig([
    MECHANISM_TYPES.turnVehicle,
    MECHANISM_TYPES.hiddenVehicle
  ]);
  assert.deepEqual(Object.keys(config), ['turn_vehicle_complete', 'hidden_vehicle_reveal']);
  assert.equal(
    config.turn_vehicle_complete.clips[0],
    '/assets/unity/mechanisms/turn-vehicle/audio/guidemove.bin'
  );
  assert.equal(
    config.hidden_vehicle_reveal.clips[0],
    '/assets/unity/mechanisms/hidden-vehicle/audio/hidden_reveal.bin'
  );
  assert.equal('ambulance_countdown' in config, false);
  assert.equal('garage_out' in config, false);
});
