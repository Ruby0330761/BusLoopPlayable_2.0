import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  LEVEL_OWNER_HEADER,
  LEVEL_OWNER_REGISTRY_VERSION,
  createOwnerRegistry,
  formatOwnerConflict,
  formatOwnerRequired,
  getLevelOwner,
  normalizeLevelOwner,
  recordLevelOwner,
  releaseLevelOwner,
  resolveLevelWrite
} from '../scripts/level-ownership.mjs';
import {
  LEVEL_OWNER_STORAGE_KEY,
  isForeignLevelOwner,
  levelOwnerHeaders,
  normalizeLevelOwner as normalizeClientOwner,
  readStoredLevelOwner,
  storeLevelOwner
} from '../src/level-owner.js';

// The editor is a shared tool over one artifacts volume. A level is a JSON
// file, so two operators working at once could each open the same level and
// save over the other: the revision check only stops a *stale* write, and the
// second operator's revision was current. These tests pin the ownership
// guardrail that turns that accident into a refusal.

function memoryStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => { map.set(key, String(value)); },
    removeItem: (key) => { map.delete(key); },
    get size() { return map.size; }
  };
}

test('an operator name is normalized so one person cannot become two owners', () => {
  assert.equal(normalizeLevelOwner('  WXJ  '), 'WXJ');
  assert.equal(normalizeLevelOwner('WXJ\t'), 'WXJ');
  assert.equal(normalizeLevelOwner('Wang  Xinjie'), 'Wang Xinjie');
  assert.equal(normalizeLevelOwner('a\u0000b'), 'a b');
  assert.equal(normalizeLevelOwner(''), '');
  assert.equal(normalizeLevelOwner(null), '');
  assert.equal(normalizeLevelOwner(42), '');
  assert.equal(normalizeLevelOwner('x'.repeat(120)).length, 40);
  // The client and the server must agree, or a name sent by one is refused by
  // the other while looking identical in the UI.
  for (const sample of ['  WXJ ', 'Wang  Xinjie', '', 'x'.repeat(60)]) {
    assert.equal(normalizeClientOwner(sample), normalizeLevelOwner(sample));
  }
});

test('the registry drops entries it cannot trust', () => {
  const registry = createOwnerRegistry({
    version: 99,
    levels: {
      level5: { owner: ' WXJ ', claimedAt: '2026-10-28T00:00:00.000Z' },
      level7: { owner: '   ' },
      level9: { owner: 'AAA' },
      notALevel: { owner: 'BBB' },
      level12: 'broken'
    }
  });
  assert.equal(registry.version, LEVEL_OWNER_REGISTRY_VERSION);
  assert.deepEqual(Object.keys(registry.levels).sort(), ['level5', 'level9']);
  assert.equal(registry.levels.level5.owner, 'WXJ');
  assert.equal(getLevelOwner(registry, 'level7'), '');
  assert.equal(getLevelOwner(registry, 'level99'), '');
  assert.deepEqual(createOwnerRegistry(null), { version: LEVEL_OWNER_REGISTRY_VERSION, levels: {} });
});

test('an unowned level is read-only until it is explicitly claimed', () => {
  const empty = createOwnerRegistry(null);
  // This is the bug the first version shipped: a plain save claimed whatever it
  // touched, so every level that predated the guard stayed open to whoever
  // pressed save first.
  const plainSave = resolveLevelWrite({ registry: empty, levelKey: 'level5', owner: 'WXJ' });
  assert.equal(plainSave.allowed, false);
  assert.equal(plainSave.reason, 'unclaimed');

  const claimed = recordLevelOwner(empty, 'level5', 'WXJ');
  assert.equal(getLevelOwner(claimed, 'level5'), 'WXJ');
  // Recording must not mutate its input, or a failed save would leave the
  // registry claiming a level it never wrote.
  assert.equal(getLevelOwner(empty, 'level5'), '');

  const own = resolveLevelWrite({ registry: claimed, levelKey: 'level5', owner: 'WXJ' });
  assert.equal(own.allowed, true);
  assert.equal(own.action, 'none');

  const other = resolveLevelWrite({ registry: claimed, levelKey: 'level5', owner: 'TJW' });
  assert.equal(other.allowed, false);
  assert.equal(other.reason, 'owned-by-other');
  assert.equal(other.existingOwner, 'WXJ');
});

test('case alone never locks an operator out of their own level', () => {
  const registry = recordLevelOwner(createOwnerRegistry(null), 'level5', 'WXJ');
  for (const variant of ['wxj', ' WxJ ', 'wxJ']) {
    const decision = resolveLevelWrite({ registry, levelKey: 'level5', owner: variant });
    assert.equal(decision.allowed, true, `"${variant}" is the same operator as WXJ`);
    assert.equal(decision.existingOwner, 'WXJ', 'the stored spelling is what the picker shows');
  }
  // A genuinely different name is still refused.
  assert.equal(resolveLevelWrite({ registry, levelKey: 'level5', owner: 'TJ' }).allowed, false);
  assert.equal(isForeignLevelOwner('WXJ', 'wxj'), false);
});

test('a missing operator name is refused instead of silently overwriting', () => {
  const registry = recordLevelOwner(createOwnerRegistry(null), 'level5', 'WXJ');
  const anonymous = resolveLevelWrite({ registry, levelKey: 'level5', owner: '' });
  assert.equal(anonymous.allowed, false);
  assert.equal(anonymous.reason, 'owner-required');
  // Even an unowned level needs a name: otherwise the write could never be
  // attributed, and the guard would start out unenforced.
  const anonymousNew = resolveLevelWrite({ registry: createOwnerRegistry(null), levelKey: 'level9', owner: '  ', claim: true });
  assert.equal(anonymousNew.allowed, false);
  assert.equal(anonymousNew.reason, 'owner-required');
});

test('deleting releases the name so a re-import is not blocked by a ghost owner', () => {
  const owned = recordLevelOwner(createOwnerRegistry(null), 'level5', 'WXJ');
  const released = releaseLevelOwner(owned, 'level5');
  assert.equal(getLevelOwner(released, 'level5'), '');
  // It is unowned again, so it is read-only until someone claims it explicitly.
  assert.equal(resolveLevelWrite({ registry: released, levelKey: 'level5', owner: 'TJW' }).allowed, false);
  const reclaimed = resolveLevelWrite({ registry: released, levelKey: 'level5', owner: 'TJW', claim: true });
  assert.equal(reclaimed.allowed, true);
  assert.equal(reclaimed.action, 'claim');
  // The input registry is untouched.
  assert.equal(getLevelOwner(owned, 'level5'), 'WXJ');
});

test('conflict messages name the owner so the operator knows who to ask', () => {
  const conflict = formatOwnerConflict('level5', 'WXJ');
  assert.match(conflict, /level5/u);
  assert.match(conflict, /WXJ/u);
  assert.match(formatOwnerRequired(), /操作用户/u);
});

test('the browser keeps one operator name and sends it as a header', () => {
  const storage = memoryStorage();
  assert.equal(readStoredLevelOwner(storage), '');
  assert.deepEqual(levelOwnerHeaders(''), {}, 'no name means no header');

  assert.equal(storeLevelOwner('  WXJ ', storage), 'WXJ');
  assert.equal(readStoredLevelOwner(storage), 'WXJ');
  assert.equal(storage.getItem(LEVEL_OWNER_STORAGE_KEY), 'WXJ');

  const headers = levelOwnerHeaders('王 鑫杰');
  // The client sends `X-Level-Owner`; Node lowercases incoming header names, so
  // the server constant is lowercase and the two must match case-insensitively.
  const headerNames = Object.keys(headers);
  assert.equal(headerNames.length, 1);
  assert.equal(headerNames[0].toLowerCase(), LEVEL_OWNER_HEADER);
  assert.equal(decodeURIComponent(headers[headerNames[0]]), '王 鑫杰');

  // Clearing the field removes the stored name instead of storing an empty one.
  assert.equal(storeLevelOwner('   ', storage), '');
  assert.equal(storage.size, 0);
  assert.equal(readStoredLevelOwner(storage), '');
});

test('a broken storage does not break the authoring request', () => {
  const hostile = {
    getItem() { throw new Error('blocked'); },
    setItem() { throw new Error('full'); },
    removeItem() { throw new Error('blocked'); }
  };
  assert.equal(readStoredLevelOwner(hostile), '');
  // The caller keeps the value in memory and the header still carries it.
  assert.equal(storeLevelOwner('WXJ', hostile), 'WXJ');
  const headers = levelOwnerHeaders('WXJ');
  const names = Object.keys(headers);
  assert.equal(names.length, 1);
  assert.equal(names[0].toLowerCase(), LEVEL_OWNER_HEADER);
  assert.equal(headers[names[0]], 'WXJ');
});

test('a foreign level is recognised from the picker label', () => {
  assert.equal(isForeignLevelOwner('WXJ', 'WXJ'), false);
  assert.equal(isForeignLevelOwner('WXJ', 'wxj'), false, 'case is not a different person');
  assert.equal(isForeignLevelOwner('WXJ', 'TJW'), true);
  assert.equal(isForeignLevelOwner('', 'TJW'), false, 'an unowned level belongs to nobody');
  assert.equal(isForeignLevelOwner('WXJ', ''), true, 'without a name nothing is yours');
});

test('every authoring write path requires the operator header', () => {
  const vite = readFileSync('vite.config.js', 'utf8');
  // Save (PUT), import (both web JSON and Unity .asset), and delete.
  assert.match(vite, /requireRequestLevelOwner\(request\)/);
  const requireCalls = (vite.match(/requireRequestLevelOwner\(request\)/gu) ?? []).length;
  assert.ok(requireCalls >= 4, `expected save/import/import-unity/delete to require an owner, saw ${requireCalls}`);
  assert.match(vite, /assertLevelWritable\(levelId, owner\)/);
  assert.match(vite, /await assertLevelWritable\(targetKey, owner\)/);
  assert.match(vite, /await assertLevelWritable\(unityDeleteMatch\[1\], owner\)/);
  assert.match(vite, /claimLevelOwner\(levelId, normalizeLevelOwner\(owner\)\)/);
  assert.match(vite, /LEVEL_OWNER_REGISTRY_PATH/);
  // Reads stay open: a read must not require an identity or the picker empties.
  assert.match(vite, /const items = identities/);
});

test('the editor collects the operator name before writing', () => {
  const sceneEditor = readFileSync('src/scene-editor.js', 'utf8');
  assert.match(sceneEditor, /editor-level-owner-input/);
  assert.match(sceneEditor, /readStoredLevelOwner\(\)/);
  assert.match(sceneEditor, /storeLevelOwner\(levelOwnerInput\.value\)/);
  // Every write the scene editor performs must carry the header.
  assert.match(sceneEditor, /levelOwnerHeaders\(requireLevelOwner\(\)\)/);
  assert.equal(
    (sceneEditor.match(/levelOwnerHeaders\(/gu) ?? []).length >= 3,
    true,
    'web import, Unity import, and delete all need the owner header'
  );

  const layoutEditor = readFileSync('src/level-layout-editor.js', 'utf8');
  assert.match(layoutEditor, /levelOwnerHeaders\(owner\)/);
  assert.match(layoutEditor, /readStoredLevelOwner\(\)/);
});

test('a brand-new level is created owned, so creation is not blocked by the guard', () => {
  const vite = readFileSync('vite.config.js', 'utf8');
  // The save path checks whether the file already exists: a new level has no
  // file, so there is nothing to protect and its creator owns it outright.
  // Existing levels go through assertLevelWritable instead.
  assert.match(vite, /const existsBefore = await pathExists/);
  assert.match(vite, /if \(existsBefore\) \{\s*\n\s*await assertLevelWritable\(levelId, owner\)/);
  // Both branches record the writer as the owner of the bytes on disk.
  assert.match(vite, /if \(owner\) await claimLevelOwner\(levelId, normalizeLevelOwner\(owner\)\)/);
});

test('a claim is only possible on a real, unowned level', () => {
  const vite = readFileSync('vite.config.js', 'utf8');
  // The dedicated endpoint exists so a normal save cannot capture a level.
  assert.match(vite, /async function claimUnregisteredLevel/);
  assert.match(vite, /webLevelClaimMatch/);
  // Claiming an owned level would let anyone take a colleague's work.
  assert.match(vite, /if \(existingOwner\) \{[\s\S]{0,240}LEVEL_OWNER_ERROR_CODES\.ownedByOther/);
  // Claiming a key with no level behind it would reserve a name for a ghost.
  assert.match(vite, /无法认领/);
});

test('the editor offers claim only for an unregistered level', () => {
  const sceneEditor = readFileSync('src/scene-editor.js', 'utf8');
  assert.match(sceneEditor, /editor-level-claim/);
  assert.match(sceneEditor, /还没有登记归属，默认只读/);
  assert.match(sceneEditor, /认领此关卡/);
  // The claim request goes to the dedicated endpoint, not a save.
  assert.match(sceneEditor, /\/__level-authoring\/\$\{encodeURIComponent\(key\)\}\/claim/);
});

test('the picker exposes ownership so a foreign level is visible before saving', () => {
  const vite = readFileSync('vite.config.js', 'utf8');
  assert.match(vite, /owner: getLevelOwner\(owners, level\.key\)/);
  const sceneEditor = readFileSync('src/scene-editor.js', 'utf8');
  assert.match(sceneEditor, /item\.owner \? `/);
  assert.match(sceneEditor, /isForeignLevelOwner\(levelOwner, owner\)/);
});
