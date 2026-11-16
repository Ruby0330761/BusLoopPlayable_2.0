import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { SCENE_TUNING } from '../src/scene-tuning.js';
import { LEVEL_1 } from '../src/level-data.js';
import { collectPlayableInlineAssetUrls } from '../src/playable-inline-assets.js';

const read = (relative) => readFile(new URL(`../${relative}`, import.meta.url), 'utf8');

const baseOptions = () => ({
  tuning: structuredClone(SCENE_TUNING),
  levels: [LEVEL_1],
  spatialSelection: SCENE_TUNING.conveyorLayout.selected,
  conveyorLayouts: [SCENE_TUNING.conveyorLayout.selected]
});

test('the inline asset set always carries the runtime shell and the level assets', () => {
  const urls = collectPlayableInlineAssetUrls(baseOptions());
  // The four UI bitmaps every build needs, without which the packaged ad ships
  // blank buttons.
  for (const required of [
    '/assets/applovin/icon_q75.jpg',
    '/assets/applovin/main-guide-hand_q80.webp',
    '/assets/unity/ui/Main_Prop_GreenBtn.png',
    '/assets/unity/ui/Main_Prop_RedBtn_blank_q90.webp'
  ]) {
    assert.ok(urls.has(required), `missing base runtime asset ${required}`);
  }
  // Level documents are walked wholesale: an art path a level stops naming is
  // one the package silently loses.
  assert.ok(urls.has(LEVEL_1.assets.loopScene), 'level loop scene art is missing');
  assert.ok(urls.has(LEVEL_1.assets.background), 'level background is missing');
  assert.ok(urls.has(LEVEL_1.assets.colorTextures[0]), 'level colour atlas is missing');
  assert.ok(urls.has(LEVEL_1.assets.audio.bus_hit.clips[0]), 'level audio clip is missing');
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
  // A hidden layer still assigns `src`, so the browser fetches it.
  assert.ok(urls.has('/assets/editor-free-assets/sticker.webp'));
  assert.ok(urls.has('/assets/editor-free-assets/hidden.webp'));
});

test('a custom entry-banner plate is inlined only when the banner is on', () => {
  const tuning = structuredClone(SCENE_TUNING);
  tuning.entryBanner.customAsset = '/assets/editor-banners/banner-abc-storm.webp';
  const withBanner = collectPlayableInlineAssetUrls({
    ...baseOptions(),
    tuning,
    entryBannerEnabled: true
  });
  assert.ok(withBanner.has('/assets/editor-banners/banner-abc-storm.webp'));
  // A build that can never show the banner must not pay for its plate.
  const withoutBanner = collectPlayableInlineAssetUrls({ ...baseOptions(), tuning });
  assert.ok(!withoutBanner.has('/assets/editor-banners/banner-abc-storm.webp'));
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
  // A guide car id that is not in the level hides the hand with no error.
  assert.match(editor, /不在本关/);
  // A threshold above the fleet can never be reached.
  assert.match(editor, /永远触发不了/);
});
