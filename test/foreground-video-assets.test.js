import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, unlink } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  getForegroundVideoAssetUrl,
  importForegroundVideo,
  listForegroundVideos,
  validateForegroundVideoFilename
} from '../scripts/foreground-video-importer.mjs';

test('foreground video importer stores and lists browser-compatible videos', async () => {
  const outputRoot = await mkdtemp(path.join(os.tmpdir(), 'busloop-foreground-video-'));
  try {
    const first = await importForegroundVideo({
      filename: 'angry intro.mp4',
      bytes: Buffer.from([0, 1, 2, 3])
    }, { outputRoot });
    assert.equal(first.replaced, false);
    assert.equal(first.item.assetUrl, '/assets/playable/foreground-videos/angry intro.mp4');
    assert.deepEqual(await readFile(first.outputPath), Buffer.from([0, 1, 2, 3]));
    assert.deepEqual(await listForegroundVideos({ outputRoot }), [{
      filename: 'angry intro.mp4',
      label: 'angry intro',
      assetUrl: '/assets/playable/foreground-videos/angry intro.mp4',
      size: 4
    }]);

    const replacement = await importForegroundVideo({
      filename: 'angry intro.mp4',
      bytes: Buffer.from([4, 5])
    }, { outputRoot });
    assert.equal(replacement.replaced, true);
    await unlink(replacement.outputPath);
    assert.deepEqual(await listForegroundVideos({ outputRoot }), []);
  } finally {
    await rm(outputRoot, { recursive: true, force: true });
  }
});

test('foreground video importer rejects unsafe and unsupported filenames', () => {
  assert.throws(() => validateForegroundVideoFilename('../intro.mp4'), /Only one local/);
  assert.throws(() => validateForegroundVideoFilename('intro.mov'), /Only one local/);
  assert.equal(getForegroundVideoAssetUrl('intro.webm'), '/assets/playable/foreground-videos/intro.webm');
});

test('editor and packaging keep foreground video selection conditional', async () => {
  const [editor, vite, packager, checker, main, markup, styles, tuning] = await Promise.all([
    readFile(new URL('../src/scene-editor.js', import.meta.url), 'utf8'),
    readFile(new URL('../vite.config.js', import.meta.url), 'utf8'),
    readFile(new URL('../scripts/package-applovin-single-html.mjs', import.meta.url), 'utf8'),
    readFile(new URL('../scripts/check-applovin-package.mjs', import.meta.url), 'utf8'),
    readFile(new URL('../src/main.js', import.meta.url), 'utf8'),
    readFile(new URL('../index.html', import.meta.url), 'utf8'),
    readFile(new URL('../src/styles.css', import.meta.url), 'utf8'),
    import('../src/scene-tuning.js')
  ]);
  assert.match(editor, /可玩素材 - 前贴片动画/);
  assert.match(editor, /__foreground-videos\/import/);
  assert.match(editor, /__foreground-videos\/open-folder/);
  assert.match(editor, /refreshForegroundVideoOptions/);
  assert.match(editor, /转场特效/);
  assert.match(editor, /导入转场特效/);
  assert.match(editor, /转场触发延迟/);
  assert.match(editor, /foregroundVideo\.transitionSelected/);
  assert.match(editor, /foregroundVideo\.transitionEnabled/);
  assert.match(editor, /使用转场特效/);
  assert.match(editor, /foregroundVideo\.transitionDelaySeconds/);
  assert.match(vite, /__foreground-videos/);
  assert.match(packager, /foregroundVideoAssetUrl/);
  assert.match(packager, /foregroundTransitionAssetUrl/);
  assert.match(packager, /foregroundVideo\?\.transitionEnabled !== 0/);
  assert.match(packager, /__BUS_LOOP_FOREGROUND_TRANSITION_ASSET__/);
  assert.match(checker, /foreground video follows display selection/);
  assert.match(checker, /foreground transition follows display selection/);
  assert.match(checker, /foregroundVideo\?\.transitionEnabled !== 0/);
  assert.match(checker, /selectedForegroundAssetUrls/);
  assert.match(markup, /<video[\s\S]*?muted[\s\S]*?playsinline[\s\S]*?preload="auto"/);
  assert.match(markup, /<video\b(?=[^>]*\bid="foreground-transition-video")(?=[^>]*\bmuted)(?=[^>]*\bplaysinline)(?=[^>]*\bpreload="auto")(?=[^>]*\bhidden)[^>]*>/);
  assert.match(styles, /\.foreground-video-overlay[\s\S]*?z-index: 29/);
  assert.match(styles, /\.foreground-video-backdrop[\s\S]*?filter: blur\(18px\)/);
  assert.match(styles, /\.foreground-video[\s\S]*?position: absolute[\s\S]*?inset: 0[\s\S]*?object-fit: contain/);
  assert.match(styles, /\.foreground-transition-video\s*\{[\s\S]*?z-index:\s*30[\s\S]*?object-fit:\s*cover[\s\S]*?mix-blend-mode:\s*screen/);
  assert.match(main, /function drawForegroundVideoBackdrop\(\)/);
  assert.match(main, /context\.drawImage\([\s\S]*?cropWidth[\s\S]*?cropHeight/);
  assert.match(main, /foregroundVideo\.defaultMuted = true/);
  assert.match(main, /foregroundVideo\.muted = true/);
  assert.match(main, /foregroundVideo\.volume = 0/);
  assert.match(main, /const foregroundTransitionVideo = \$\('#foreground-transition-video'\)/);
  assert.match(main, /globalThis\.__BUS_LOOP_FOREGROUND_TRANSITION_ASSET__/);
  assert.match(main, /const foregroundTransitionSource = foregroundVideoSource[\s\S]*?configuredForegroundVideo\.transitionEnabled !== 0[\s\S]*?configuredForegroundVideo\.transitionSelected/);
  assert.match(main, /foregroundTransitionVideo\.defaultMuted = true/);
  assert.match(main, /foregroundTransitionVideo\.muted = true/);
  assert.match(main, /foregroundTransitionVideo\.volume = 0/);
  assert.match(main, /!spatialEditorActive && !foregroundVideoBlocking/);
  assert.match(main, /const sceneReady = \(view\.ready \?\? Promise\.resolve\(\)\)/);
  assert.match(main, /await playForegroundVideoIntro\(foregroundVideoSource, foregroundTransitionSource, sceneReady\)/);
  assert.match(main, /if \(!ready \|\| !foregroundVideo \|\| !foregroundVideoOverlay\) \{[\s\S]*?await sceneReady;[\s\S]*?dismissLoadingScreen\(\)/);
  assert.match(main, /await sceneReady;[\s\S]*?foregroundVideoOverlay\.classList\.add\('is-ending'\)/);
  assert.match(main, /foregroundVideoOverlay\.classList\.add\('is-ending'\);[\s\S]*?transitionDelaySeconds[\s\S]*?playForegroundTransition\(transitionReady\)/);
  assert.match(main, /foregroundVideo\?\.fadeOutSeconds/);
  assert.match(styles, /--foreground-video-fade-duration/);
  assert.match(editor, /结束淡出秒数/);
  assert.ok(main.indexOf('await playForegroundVideoIntro') < main.indexOf('view.showEntryBanner?.()'));
  assert.ok(main.indexOf('await transitionPlayback') < main.indexOf('foregroundVideoBlocking = false'));
  assert.deepEqual(tuning.SCENE_TUNING.foregroundVideo, {
    selected: '20260915-161751.mp4',
    enabled: 1,
    fadeOutSeconds: 0.85,
    transitionSelected: 'transition-20260915.mp4',
    transitionEnabled: 1,
    transitionDelaySeconds: 0.15
  });
});
