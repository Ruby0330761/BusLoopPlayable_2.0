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
  // A selection with no level data would make every export fail; the editor
  // has to say so rather than leave the picker empty.
  assert.match(sceneEditor, /没有关卡数据，请重新选择关卡/);
  // Long exports show a live counter plus the server-reported duration.
  assert.match(sceneEditor, /X-Playable-Export-Duration-Ms/);
  assert.match(sceneEditor, /\\u5df2\\u7528 \$\{seconds\} \\u79d2/);
});

test('the level picker only lists levels that actually have data', () => {
  const vite = readFileSync('vite.config.js', 'utf8');
  // Phantom keys used to be synthesized from BUILTIN_LEVEL_IDS alone, so
  // level22/29/39 appeared in the picker and selecting one broke every export.
  const identities = vite.slice(
    vite.indexOf('async function readImportedLevelIdentities'),
    vite.indexOf('async function readLevelSourceMtime')
  );
  assert.doesNotMatch(identities, /BUILTIN_LEVEL_IDS/);
  assert.doesNotMatch(identities, /\((?:\$\{key\}|level)\S*\.asset\)/);

  // Selection guard checks the three real data layers instead of the reserved
  // id list.
  const guard = vite.slice(
    vite.indexOf('async function isKnownPlayableLevel'),
    vite.indexOf('function decodePrefabFilename')
  );
  assert.doesNotMatch(guard, /BUILTIN_LEVEL_IDS/);
  assert.match(guard, /WEB_LEVEL_ROOT, `\$\{levelId\}\.json`/);
  assert.match(guard, /readImportedArtifactKeys/);
  assert.match(guard, /readBakedLevelKeys/);

  // Auto-assigned import ids skip reserved builtin ids so a refresh can never
  // land on a key the delete guard protects.
  assert.match(vite, /while \(used\.has\(`level\$\{number\}`\) \|\| BUILTIN_LEVEL_IDS\.has\(`level\$\{number\}`\)\) number \+= 1;/);
});
