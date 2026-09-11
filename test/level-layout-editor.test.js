import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('scene editor and main runtime expose the full level layout workspace', () => {
  const sceneEditor = readFileSync('src/scene-editor.js', 'utf8');
  const main = readFileSync('src/main.js', 'utf8');
  const workspace = readFileSync('src/level-layout-editor.js', 'utf8');
  assert.match(sceneEditor, /editor-level-edit/);
  assert.match(sceneEditor, /openLevelLayoutEditor/);
  assert.match(sceneEditor, /refreshWebLevelOptions/);
  assert.match(sceneEditor, /fetch\('\/__level-authoring'/);
  assert.match(sceneEditor, /option\.textContent = item\.displayName/);
  assert.match(main, /createLevelLayoutEditor/);
  assert.match(main, /bus-loop-level-editor-preview-v3/);
  assert.match(main, /LEGACY_LEVEL_EDITOR_PREVIEW_STORAGE_KEYS/);
  assert.match(main, /bus-loop-level-editor-preview-v1/);
  assert.match(main, /bus-loop-level-editor-preview-v2/);
  assert.match(main, /readSavedWebLevelEntry/);
  assert.match(main, /previewEntry\.baseRevision === savedRevision/);
  assert.match(main, /writeLevelEditorPreviewDocument\(webEntry\.document, 'saved', webEntry\.revision\)/);
  for (const feature of [
    '添加车辆', '添加车库', '添加运输带', '添加闸门', '添加升降舱',
    '新建关卡', '重算深度', '验证', '保存', '试玩', '导入 JSON', 'exportUnityLevelAsset',
    '打开队列编辑器', '乘客操作区', '队列编辑区', 'Passenger Flow 预览区', '数据统计区',
    '添加到队尾', '插入到前面', '插入到后面', '替换所选', '一键排序', '一键修复'
  ]) assert.match(workspace, new RegExp(feature));
  assert.match(workspace, /event\.code === 'KeyQ'/);
  assert.match(workspace, /event\.code === 'KeyE'/);
  assert.match(workspace, /anchorRotationCenter = model\.selectionCenter\(\)/);
  assert.match(workspace, /model\.rotateSelectedAroundCenter\(angle, anchorRotationCenter\)/);
  assert.match(workspace, /window\.addEventListener\('keydown', handleShortcut, true\)/);
  assert.match(workspace, /window\.removeEventListener\('keydown', handleShortcut, true\)/);
  assert.match(workspace, /window\.addEventListener\('keyup', handleShortcutKeyUp, true\)/);
  assert.match(workspace, /window\.removeEventListener\('keyup', handleShortcutKeyUp, true\)/);
  assert.match(workspace, /garage-2d\.png/);
  assert.match(workspace, /conveyor-belt-2d\.png/);
  assert.match(workspace, /getGateQueueBounds/);
  assert.match(workspace, /getGateQueuePath/);
  assert.match(workspace, /getGateQueueTangentHandles/);
  assert.match(workspace, /model\.setGateQueueTangentHandle/);
  assert.match(workspace, /model\.resizeElevatorByHandle/);
  assert.match(workspace, /persistentDocumentSource/);
  assert.match(workspace, /numberField\('出口宽度', 'conveyorWidth'/);
  assert.match(workspace, /显示曲线控制点/);
  assert.match(workspace, /data-action="elevator-upper"/);
  assert.match(workspace, /data-action="elevator-lower"/);
  assert.match(workspace, /data-action="center-elevator"/);
  assert.match(workspace, /上层车辆/);
  assert.match(workspace, /舱外车辆/);
  assert.match(workspace, /model\.enterContainer\(hit\.id\)/);
  assert.match(workspace, /model\.exitActiveContainer\(\)/);
  assert.match(workspace, /data-action="exit-container"/);
  assert.match(workspace, /event\.key === 'Escape' && model\.activeContainerId !== 0/);
  assert.match(workspace, /level-layout-color-swatch/);
  assert.match(workspace, /\$\{color\.id\}: \$\{color\.name\} \/ \$\{color\.label\}/);
  assert.doesNotMatch(workspace, /\$\{color\.label\} · \$\{color\.css\}/);
  assert.match(workspace, /const inverseColor = vehicle\.isHidden \? '#ffffff' : invertHexColor\(vehicleColor\)/);
  assert.match(workspace, /VEHICLE_COLOR_OPTIONS\.slice\(0, 11\)/);
  assert.match(workspace, /PASSENGER_QUEUE_COLORS/);
  assert.match(workspace, /data-passenger-action="repair"/);
  assert.match(workspace, /data-passenger-action="sort-by-depth"/);
  assert.match(workspace, /model\.sortPassengerQueuesByDepth\(DEFAULT_INITIAL_PASSENGER_COUNT\)/);
  assert.match(workspace, /data-passenger-index/);
  assert.match(workspace, /passenger-queue-selection-box/);
  assert.match(workspace, /addEventListener\('pointerdown'/);
  assert.match(workspace, /addEventListener\('pointermove', updatePassengerBoxSelection, true\)/);
  assert.match(workspace, /passengerRectsOverlap\(selectionRect, item\.getBoundingClientRect\(\)\)/);
  assert.match(workspace, /mode: moveSelection \? 'move' : 'select'/);
  assert.match(workspace, /moveSelectedPassengers\(gesture\.targetQueueId, gesture\.targetIndex\)/);
  assert.match(workspace, /is-drop-before/);
  assert.match(workspace, /gesture\.targetIndex \+= 1/);
  assert.doesNotMatch(workspace, /textarea data-queue/);
  assert.match(workspace, /__level-authoring-status/);
  assert.match(workspace, /name=\$\{encodeURIComponent\(displayName\)\}/);
  assert.match(workspace, /关卡名称已被/);
  assert.match(workspace, /createLevelDocument\(\{ key, unityId: number, displayName \}\)/);
  assert.match(workspace, /body: JSON\.stringify\(\{ document: model\.document, baseRevision: revision, createOnly \}\)/);
  assert.match(workspace, /writeLevelEditorPreviewDocument\(model\.document, 'saved', revision\)/);
  assert.match(workspace, /writeLevelEditorPreviewDocument\(model\.document, 'draft', revision\)/);
  assert.match(workspace, /initialDocument \? null : persistentDocumentSource\(model\.document\)/);
  assert.match(workspace, /setStatus\(`已保存并应用/);
  assert.match(main, /readLevelEditorPreviewDocument\(\)/);
  assert.match(main, /localStorage\.removeItem\(LEVEL_EDITOR_PREVIEW_STORAGE_KEY\)/);
});

test('development service saves versioned level documents with backups', () => {
  const vite = readFileSync('vite.config.js', 'utf8');
  assert.match(vite, /__level-authoring/);
  assert.match(vite, /validateWebLevelDocument/);
  assert.match(vite, /WEB_LEVEL_BACKUP_ROOT/);
  assert.match(vite, /baseRevision/);
  assert.match(vite, /statusCode = 409/);
  assert.match(vite, /getWebLevelAvailability/);
  assert.match(vite, /pathname === '\/__level-authoring'/);
  assert.match(vite, /sendJson\(response, 200, \{ items \}\)/);
  assert.match(vite, /normalize\('NFKC'\)\.trim\(\)\.toLocaleLowerCase\(\)/);
  assert.match(vite, /readImportedLevelIdentities/);
  assert.match(vite, /readWebLevelIdentities/);
  assert.match(vite, /availability\.reason === 'name'/);
  assert.match(vite, /createOnly && currentSource/);
  assert.match(vite, /result\.created \? 201 : 200/);
});

test('workspace styles preserve stable desktop and narrow-screen columns', () => {
  const css = readFileSync('src/level-layout-editor.css', 'utf8');
  assert.match(css, /grid-template-columns: 154px minmax\(360px, 1fr\) 300px/);
  assert.match(css, /@media \(max-width: 680px\)/);
  assert.match(css, /overflow: hidden/);
  assert.match(css, /touch-action: none/);
  assert.match(css, /grid-template-columns: 235px minmax\(380px, 1fr\) 235px/);
  assert.match(css, /passenger-queue-item\.is-selected/);
  assert.match(css, /passenger-queue-selection-box/);
  assert.match(css, /passenger-queue-item\.is-drop-before/);
  assert.match(css, /level-layout-new-dialog/);
});
