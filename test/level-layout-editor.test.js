import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('scene editor and main runtime expose the full level layout workspace', () => {
  const sceneEditor = readFileSync('src/scene-editor.js', 'utf8');
  const main = readFileSync('src/main.js', 'utf8');
  const workspace = readFileSync('src/level-layout-editor.js', 'utf8');
  assert.match(sceneEditor, /editor-level-edit/);
  assert.match(sceneEditor, /openLevelLayoutEditor/);
  assert.match(main, /createLevelLayoutEditor/);
  assert.match(main, /bus-loop-level-editor-preview-v1/);
  for (const feature of [
    '添加车辆', '添加车库', '添加运输带', '添加闸门', '添加升降舱',
    '重算深度', '验证', '保存', '试玩', '导入 JSON', 'exportUnityLevelAsset'
  ]) assert.match(workspace, new RegExp(feature));
  assert.match(workspace, /event\.code === 'KeyQ'/);
  assert.match(workspace, /event\.code === 'KeyE'/);
  assert.match(workspace, /anchorRotationCenter = model\.selectionCenter\(\)/);
  assert.match(workspace, /model\.rotateSelectedAroundCenter\(angle, anchorRotationCenter\)/);
  assert.match(workspace, /window\.addEventListener\('keydown', handleShortcut, true\)/);
  assert.match(workspace, /window\.removeEventListener\('keydown', handleShortcut, true\)/);
  assert.match(workspace, /window\.addEventListener\('keyup', handleShortcutKeyUp, true\)/);
  assert.match(workspace, /window\.removeEventListener\('keyup', handleShortcutKeyUp, true\)/);
});

test('development service saves versioned level documents with backups', () => {
  const vite = readFileSync('vite.config.js', 'utf8');
  assert.match(vite, /__level-authoring/);
  assert.match(vite, /validateWebLevelDocument/);
  assert.match(vite, /WEB_LEVEL_BACKUP_ROOT/);
  assert.match(vite, /baseRevision/);
  assert.match(vite, /statusCode = 409/);
});

test('workspace styles preserve stable desktop and narrow-screen columns', () => {
  const css = readFileSync('src/level-layout-editor.css', 'utf8');
  assert.match(css, /grid-template-columns: 154px minmax\(360px, 1fr\) 300px/);
  assert.match(css, /@media \(max-width: 680px\)/);
  assert.match(css, /overflow: hidden/);
  assert.match(css, /touch-action: none/);
});
