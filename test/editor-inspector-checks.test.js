import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { SCENE_TUNING } from '../src/scene-tuning.js';
import { LEVEL_1 } from '../src/level-data.js';
import { MECHANISM_ASSETS, RETRY_BUTTON_ASSET_PATH, SPEED_TOGGLE_ASSET_PATHS, SPEED_TOGGLE_BACKGROUND_ASSET_PATH } from '../src/mechanism-resources.js';
import { SPEED_TOGGLE_ICON_PATHS } from '../src/speed-toggle.js';
import { collectPlayableInlineAssetUrls, getReachableStageArt } from '../src/playable-inline-assets.js';

const read = (relative) => readFile(new URL(`../${relative}`, import.meta.url), 'utf8');

const baseOptions = () => ({
  tuning: structuredClone(SCENE_TUNING),
  levels: [LEVEL_1],
  spatialSelection: SCENE_TUNING.conveyorLayout.selected,
  conveyorLayouts: [SCENE_TUNING.conveyorLayout.selected]
});

test('the inline asset set always carries the runtime shell and the level assets', () => {
  const urls = collectPlayableInlineAssetUrls(baseOptions());
  // The UI bitmaps every build needs, without which the packaged ad ships blank
  // buttons. The speed switch art is deliberately absent: it follows
  // `speedToggle.enabled`, which is off in the shipped tuning.
  for (const required of [
    SCENE_TUNING.branding.icon.asset,
    '/assets/unity/ui/Main_Prop_GreenBtn.png'
  ]) {
    assert.ok(urls.has(required), `missing base runtime asset ${required}`);
  }
  // Level documents are walked wholesale: an art path a level stops naming is
  // one the package silently loses. `assets.loopScene` is the exception — the
  // renderer draws belt art from the conveyor layout, so the level's own copy is
  // dead weight; the selected layout's image is asserted below instead.
  assert.ok(!urls.has(LEVEL_1.assets.loopScene), 'the level\'s authored belt art is dead weight');
  assert.ok(urls.has('/assets/unity/conveyors/Loop_03_q80.webp'), 'the selected layout\'s belt art is missing');
  assert.ok(urls.has(LEVEL_1.assets.background), 'level background is missing');
  assert.ok(!urls.has('/assets/applovin/icon_q75.jpg'), 'unused standalone loader icon');
  assert.ok(LEVEL_1.assets.colorTextures.filter(Boolean).every(url => !urls.has(url)));
  assert.ok(urls.has(LEVEL_1.assets.models.passengerVatMesh));
  assert.ok(urls.has(LEVEL_1.assets.models.passengerVatTexture));
  assert.ok(urls.has(LEVEL_1.assets.audio.bus_hit.clips[0]), 'level audio clip is missing');
});

test('shell artwork follows reachable guides, choices, CTA and retry', () => {
  const tuning = { cta: { enabled: 0 }, vehicleGuideHand: { enabled: 1, levelKey: 'level36' } };
  const urls = (stages, choices = []) => collectPlayableInlineAssetUrls({
    tuning, levels: stages.map(s => s.level), ...getReachableStageArt(tuning, stages, choices)
  });
  const hand = '/assets/applovin/main-guide-hand_q80.webp';
  const stage = { level: { key: 'level122' } };
  const off = urls([stage]);
  assert.ok(!off.has(hand) && !off.has('/assets/unity/ui/Main_Prop_GreenBtn.png') && !off.has('/assets/unity/ui/Main_Prop_RedBtn_blank_q90.webp'));
  assert.ok(urls([stage, {level:{key:'level36'}}]).has(hand));
  assert.ok(urls([stage], [{ options:[{opening:{firstClickGuide:{enabled:1,durationSeconds:2}}}], handIndex:-1 }]).has(hand));
  assert.ok(urls([stage], [{ options:[{}], handIndex:0 }]).has(hand));
});

test('belt art follows the reachable layouts, not the whole catalog', () => {
  const one = collectPlayableInlineAssetUrls(baseOptions());
  // dualQueue3 is the shipped selection; the other ten belts are ~642 KB of art
  // the package can never draw.
  for (const unselected of [
    '/assets/unity/conveyors/Loop_02_q80.webp',
    '/assets/unity/conveyors/Loop_04_q80.webp',
    '/assets/unity/conveyors/Loop_06_q80.webp',
    '/assets/unity/conveyors/Loop_07_q80.webp',
    '/assets/unity/conveyors/Loop_footage2_q80.webp'
  ]) {
    assert.ok(!one.has(unselected), `unselected belt art ${unselected} was inlined`);
  }
  // A stitched session that can switch belts must carry every belt it can show.
  const stitched = collectPlayableInlineAssetUrls({
    ...baseOptions(),
    conveyorLayouts: ['dualQueue3', 'starLoop']
  });
  assert.ok(stitched.has('/assets/unity/conveyors/Loop_03_q80.webp'));
  assert.ok(stitched.has('/assets/unity/conveyors/Loop_07_q80.webp'));
  assert.ok(!stitched.has('/assets/unity/conveyors/Loop_04_q80.webp'));
});

test('retry art follows the retry toggle even when CSS references it', () => {
  for (const enabled of [0, 1, false, true, undefined]) {
    const options = baseOptions();
    options.tuning.gameOver.retryEnabled = enabled;
    options.extraUrls = [RETRY_BUTTON_ASSET_PATH];
    const urls = collectPlayableInlineAssetUrls(options);
    assert.equal(urls.has(RETRY_BUTTON_ASSET_PATH), Boolean(enabled));
  }
});

test('speed switch art is omitted when disabled even when CSS references it', () => {
  const off = baseOptions();
  off.tuning.speedToggle.enabled = 0;
  off.extraUrls = SPEED_TOGGLE_ASSET_PATHS;
  const withoutSwitch = collectPlayableInlineAssetUrls(off);
  for (const asset of SPEED_TOGGLE_ASSET_PATHS) {
    assert.ok(!withoutSwitch.has(asset), `${asset} was inlined with the switch off`);
  }
});

test('speed switch exports only the selected skin, including normal and boosted icons', () => {
  for (const style of ['default', 'light', ' LIGHT ', 'unknown', undefined]) {
    const options = baseOptions();
    options.tuning.speedToggle = { ...options.tuning.speedToggle, enabled: 1, style };
    // Simulate shell/CSS references to both skins. Final selection must win.
    options.extraUrls = SPEED_TOGGLE_ASSET_PATHS;
    const urls = collectPlayableInlineAssetUrls(options);
    const selected = style?.trim().toLowerCase() === 'light' ? 'light' : 'default';
    const expected = new Set(Object.values(SPEED_TOGGLE_ICON_PATHS[selected]));
    if (selected === 'default') expected.add(SPEED_TOGGLE_BACKGROUND_ASSET_PATH);
    assert.deepEqual(new Set(SPEED_TOGGLE_ASSET_PATHS.filter(asset => urls.has(asset))), expected);
  }
});

test('opt-in layers only join the inline set when they are enabled', () => {
  const off = baseOptions();
  off.tuning.progressHud.enabled = 0;
  off.tuning.countdown.enabled = 0;
  off.tuning.stamina.enabled = 0;
  const minimal = collectPlayableInlineAssetUrls(off);

  const on = baseOptions();
  on.tuning.progressHud.enabled = 1;
  on.tuning.countdown.enabled = 1;
  on.tuning.countdown.sirenEnabled = 1;
  on.tuning.stamina.enabled = 1;
  const full = collectPlayableInlineAssetUrls(on);

  for (const url of minimal) {
    assert.ok(full.has(url), `enabling layers dropped ${url}`);
  }
  assert.ok(full.size > minimal.size, 'enabling the HUD, countdown and stamina added no assets');
  assert.ok(!minimal.has('/assets/applovin/countdown/timer-frame.png'));
  assert.ok(full.has('/assets/applovin/countdown/timer-frame.png'));
  assert.ok(full.has('/assets/applovin/countdown/ambulance-siren.mp3'));
});

test('a session that disables the pre-roll keeps its MP4 out of the package', () => {
  const tuning = structuredClone(SCENE_TUNING);
  tuning.preRoll.enabled = 1;
  tuning.preRoll.asset = '/assets/preroll/TP1327.mp4';
  const allowed = collectPlayableInlineAssetUrls({ ...baseOptions(), tuning, activeSession: null });
  assert.ok(allowed.has('/assets/preroll/TP1327.mp4'));

  const blocked = collectPlayableInlineAssetUrls({
    ...baseOptions(),
    tuning,
    activeSession: { preRollEnabled: false }
  });
  assert.ok(!blocked.has('/assets/preroll/TP1327.mp4'));
});

test('guide media and free-placed layers are inlined from tuning, not from the level', () => {
  const tuning = structuredClone(SCENE_TUNING);
  tuning.weatherEffect.enabled = 1;
  tuning.weatherEffect.sprite = '/assets/editor-effects/snowflake.png';
  tuning.freeAssets.layers = [
    { id: 'a', asset: '/assets/editor-free-assets/sticker.webp', x: 540, y: 1080 },
    { id: 'b', asset: '/assets/editor-free-assets/hidden.webp', x: 10, y: 10, visible: 0 }
  ];
  const urls = collectPlayableInlineAssetUrls({ ...baseOptions(), tuning });
  assert.ok(urls.has('/assets/editor-effects/snowflake.png'));
  assert.ok(urls.has('/assets/editor-free-assets/sticker.webp'));
  assert.ok(!urls.has('/assets/editor-free-assets/hidden.webp'));
});

test('only reachable banner styles and plates ship, including inherited stage and choice settings', () => {
  const art = MECHANISM_ASSETS.entryBanner;
  const upload = '/assets/editor-banners/banner-abc-storm.webp';
  const tuning = { entryBanner: { enabled: 1, style: 'custom', customAsset: upload } };
  const stage = entryBanner => ({ opening: { entryBanner } });
  const included = (stages, options = []) => [...collectPlayableInlineAssetUrls({
    tuning, ...getReachableStageArt(tuning, stages, [{ options }])
  })].filter(url => url.includes('banner'));
  assert.deepEqual(included([]), [upload]);
  assert.deepEqual(included([stage({ enabled: 0 })]), []);
  assert.deepEqual(included([stage({ customAsset: '' })]), [art.stormBanner]);
  assert.deepEqual(included([stage({ customAsset: art.rainBanner })]), [art.rainBanner]);
  assert.deepEqual(new Set(included([stage({ style: 'hard' })], [stage({ style: 'superhard' }), stage({})])), new Set([
    art.hardBackground, art.hardTitle, art.redArrows, art.superHardBackground, art.superHardTitle, art.purpleArrows, upload
  ]));
});

test('ordinary passengers never add colour atlases even for stitched legacy levels', () => {
  const assets = { colorTextures: Array.from({ length: 26 }, (_, i) => '/assets/test-' + i + '.webp') };
  const urls = collectPlayableInlineAssetUrls({ levels: [
    { assets, vehicles: [{ colorIndex: 19 }], passengerQueues: [[17], [18]] },
    { assets, vehicles: [{ colorIndex: 6 }], passengerSequence: [25] }
  ] });
  assert.deepEqual(assets.colorTextures.filter(url => urls.has(url)), []);
});

test('the editor preflight shares the packager inline set and the 5 MB budget', async () => {
  const [editor, inliner, server] = await Promise.all([
    read('src/scene-editor.js'),
    read('scripts/package-applovin-single-html.mjs'),
    read('vite.config.js')
  ]);
  // One implementation of "what gets inlined", or the panel reports a size the
  // exporter never produces.
  assert.match(inliner, /collectPlayableInlineAssetUrls\(\{/);
  assert.match(editor, /collectPlayableInlineAssetUrls\(\{/);
  assert.match(editor, /PLAYABLE_PAYLOAD_BUDGET_BYTES = 5 \* 1024 \* 1024/);
  // Sizes can only be measured on the server, so the panel asks for them.
  assert.match(server, /pathname === '\/__playable-asset-sizes'/);
  assert.match(editor, /fetch\('\/__playable-asset-sizes'/);
  assert.match(server, /PLAYABLE_ASSET_SIZE_ROOTS/);
});

test('the checks panel validates channels, guide targets, level data and the install gate', async () => {
  const editor = await read('src/scene-editor.js');
  for (const title of ['导出命名', '渠道代号', '倒计时配置', '商店链接', '关卡数据', '安装门槛', '引导目标', '素材体积', '单包体积（估算）']) {
    assert.ok(editor.includes(title), `checks panel lost ${title}`);
  }
  // Channel codes must be unique or two deliveries resolve to one filename.
  assert.match(editor, /duplicateChannels\.push/);
  assert.match(editor, /getVehicleGuideHandIssue/);
  assert.match(editor, /state: handIssue \? 'bad'/);
  // A threshold above the fleet can never be reached.
  assert.match(editor, /永远触发不了/);
});
