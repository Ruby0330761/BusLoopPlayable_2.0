import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  findLevelNameConflict,
  normalizeLevelDisplayName
} from '../scripts/level-name-registry.mjs';

test('level display names collapse copy suffixes and auto-generated import labels', () => {
  assert.equal(normalizeLevelDisplayName('level35'), 'level35');
  assert.equal(normalizeLevelDisplayName('level35 (level35.asset)'), 'level35');
  assert.equal(normalizeLevelDisplayName('level12 (level12.asset) (1)'), 'level12');
  assert.equal(normalizeLevelDisplayName('Q9V2（南瓜） (1)'), normalizeLevelDisplayName('Q9V2（南瓜） (2)'));
  assert.equal(normalizeLevelDisplayName('Q9V2（南瓜） (1)'), normalizeLevelDisplayName('Q9V2（南瓜）'));
  assert.equal(normalizeLevelDisplayName('  Test  '), 'test');
  assert.equal(normalizeLevelDisplayName(null), '');
  // A parenthetical that is part of the real name must survive.
  assert.equal(normalizeLevelDisplayName('level36 - 参考图密集车阵'), 'level36 - 参考图密集车阵');
});

test('conflict lookup ignores the level being renamed and matches across decorations', () => {
  const levels = [
    { key: 'level35', displayName: 'level35 (level35.asset)' },
    { key: 'level20', displayName: 'level35' },
    { key: 'level21', displayName: 'Q9V2（叶子）' }
  ];
  assert.equal(findLevelNameConflict(levels, { displayName: 'level35' })?.key, 'level35');
  assert.equal(findLevelNameConflict(levels, { levelId: 'level35', displayName: 'level35 (level35.asset)' })?.key, 'level20');
  // Renaming level20 to the bare name still collides with level35's label.
  assert.equal(findLevelNameConflict(levels, { levelId: 'level20', displayName: 'level35' })?.key, 'level35');
  assert.equal(findLevelNameConflict(levels, { displayName: 'Q9V3（幽灵）' }), null);
});

test('authoring service rejects duplicate level names on save and on Unity import', () => {
  const vite = readFileSync('vite.config.js', 'utf8');
  assert.match(vite, /findLevelNameConflict/);
  assert.match(vite, /import \{[\s\S]*level-name-registry\.mjs/);
  // Renames (non-createOnly saves) must check the merged list too.
  assert.match(vite, /关卡名称「\$\{document\.displayName\}」已被/);
  // Unity imports refresh a same-named imported level in place and refuse a
  // web-level name collision instead of stacking another copy.
  assert.match(vite, /const targetKey = importedConflict\?\.key \?\? await nextAvailableLevelId\(\)/);
  assert.match(vite, /readImportedArtifactKeys/);
  // Only bundle-only levels (no imported source of their own) keep the
  // explicit rename request; imports that already live in the artifact get
  // refreshed in place even when their key is a builtin id.
  assert.match(vite, /if \(!artifactKeys\.has\(importedConflict\.key\)\)/);
  assert.match(vite, /关卡名称「\$\{displayName\}」已被网页关卡 \$\{webConflict\.key\} 使用/);
});

test('editor level selects rebuild from the merged server list without stale options', () => {
  const sceneEditor = readFileSync('src/scene-editor.js', 'utf8');
  assert.doesNotMatch(sceneEditor, /LEVEL_EDITOR_OPTIONS/);
  assert.doesNotMatch(sceneEditor, /Q9V5/);
  // The refresh must clear every existing option so renamed levels cannot keep
  // an old label, and must repopulate the guide-hand select as well.
  assert.match(sceneEditor, /for \(const option of \[\.\.\.select\.options\]\) option\.remove\(\)/);
  assert.match(sceneEditor, /for \(const path of \['level\.selected', 'vehicleGuideHand\.levelKey'\]\)/);
});
