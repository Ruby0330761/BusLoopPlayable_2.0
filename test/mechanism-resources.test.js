import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import {
  MECHANISM_RESOURCE_MANIFEST,
  deriveLevelMechanics,
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
  assert.match(editorSource, /entryBanner\.debug\.preview/);
  assert.match(editorSource, /entryBanner\.debug\.components/);
  assert.match(tuningSource, /"entryBanner": \{/);
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
      turnVehicle: 0,
      hiddenVehicle: 0,
      garage: 0,
      vehicleTransportBelt: 0
    }
  });
  assert.deepEqual(LEVEL_CATALOG.level29.mechanics.types, [
    'ordinaryConveyor', 'luxuryVehicle', 'turnVehicle'
  ]);
  assert.equal(LEVEL_CATALOG.level29.mechanics.isMechanicLevel, true);
  assert.deepEqual(LEVEL_CATALOG.level33.mechanics.types, [
    'ordinaryConveyor', 'turnVehicle', 'hiddenVehicle'
  ]);
  assert.deepEqual(LEVEL_CATALOG.level39.mechanics.types, [
    'ordinaryConveyor', 'turnVehicle', 'garage'
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
