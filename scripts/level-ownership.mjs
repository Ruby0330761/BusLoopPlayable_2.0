// Per-level write ownership for the authoring service.
//
// The editor is a shared internal tool: several operators open it at once
// against the same artifacts volume, and a level is just a JSON file. The
// revision check already stops a *stale* save, but nothing stopped a second
// operator from opening someone else's level, editing it, and saving it over
// the top — the revision they loaded was current, so the write succeeded.
//
// Ownership here is a guardrail against that accident, not authentication.
// The operator name comes from the browser and any client could send another
// one; it makes "I did not mean to touch that level" impossible, and it makes
// "I am taking over this level" a deliberate act (an explicit claim on an
// unowned level, or being told who owns it) instead of a silent overwrite.
//
// The registry is a sidecar file rather than a field on the level document:
// `createLevelDocument` rebuilds the document from a fixed key list, so any
// owner field stored inside it would be dropped on the next save.
export const LEVEL_OWNER_REGISTRY_VERSION = 1;
export const LEVEL_OWNER_HEADER = 'x-level-owner';
// Set to "1" when the request is an explicit takeover of an unregistered level.
// Without it an unowned level is read-only, so a level that predates the guard
// cannot be captured by whoever saves it first.
export const LEVEL_CLAIM_HEADER = 'x-level-claim';
export const LEVEL_OWNER_MAX_LENGTH = 40;
export const LEVEL_OWNER_ERROR_CODES = Object.freeze({
  ownerRequired: 'LEVEL_OWNER_REQUIRED',
  unclaimed: 'LEVEL_UNCLAIMED',
  ownedByOther: 'LEVEL_OWNED_BY_OTHER'
});

const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/gu;

/**
 * Normalizes an operator name into the form stored on a level.
 *
 * Whitespace is collapsed and control characters dropped so "WXJ", " wxj " and
 * a copy-pasted "WXJ\t" resolve to the same owner instead of silently becoming
 * a different person who is refused access to their own level.
 */
export function normalizeLevelOwner(value) {
  if (typeof value !== 'string') return '';
  return value.replace(CONTROL_CHARACTERS, ' ').replace(/\s+/gu, ' ').trim().slice(0, LEVEL_OWNER_MAX_LENGTH);
}

/** Returns the registry in canonical shape, dropping unusable entries. */
export function createOwnerRegistry(raw) {
  const levels = {};
  const source = raw?.levels;
  if (source && typeof source === 'object' && !Array.isArray(source)) {
    for (const [levelKey, entry] of Object.entries(source)) {
      if (!/^level[1-9]\d*$/u.test(levelKey)) continue;
      const owner = normalizeLevelOwner(entry?.owner);
      if (!owner) continue;
      levels[levelKey] = {
        owner,
        claimedAt: typeof entry?.claimedAt === 'string' ? entry.claimedAt : null
      };
    }
  }
  return { version: LEVEL_OWNER_REGISTRY_VERSION, levels };
}

export function getLevelOwner(registry, levelKey) {
  return registry?.levels?.[levelKey]?.owner ?? '';
}

/**
 * Comparison key for an operator name.
 *
 * Ownership is a guardrail against accidental overwrites, not authentication,
 * so a name typed in a different case must not lock someone out of their own
 * level: "WXJ" and "wxj" are the same operator. The stored form keeps the
 * spelling that was first typed, so the picker still shows a readable name.
 */
export function levelOwnerKey(value) {
  return normalizeLevelOwner(value).toLocaleLowerCase('en-US');
}

/**
 * Decides whether `owner` may write `levelKey`.
 *
 * Ownership is enforced, not inferred. A level with no registry entry is *not*
 * writable by the next person who happens to save it: the first version of this
 * let any save claim an unowned level silently, so every level created before
 * the guard existed stayed open to whoever touched it first. Instead an unowned
 * level is refused until the operator explicitly claims it (`claim: true`),
 * which is a deliberate, recorded act rather than a side effect of pressing
 * save.
 *
 * Brand-new levels are the exception and are handled by the caller: there is no
 * file yet, so there is nothing to protect and the creator owns it outright.
 */
export function resolveLevelWrite({ registry, levelKey, owner, claim = false }) {
  const normalizedOwner = normalizeLevelOwner(owner);
  const existingOwner = getLevelOwner(registry, levelKey);
  if (!normalizedOwner) {
    return { allowed: false, action: 'none', reason: 'owner-required', existingOwner };
  }
  if (!existingOwner) {
    if (!claim) {
      return { allowed: false, action: 'none', reason: 'unclaimed', existingOwner: '' };
    }
    return { allowed: true, action: 'claim', reason: 'unowned', existingOwner: '' };
  }
  if (levelOwnerKey(existingOwner) === levelOwnerKey(normalizedOwner)) {
    return { allowed: true, action: 'none', reason: 'owned', existingOwner };
  }
  return { allowed: false, action: 'none', reason: 'owned-by-other', existingOwner };
}

/** Records or clears ownership. Returns a new registry; never mutates input. */
export function recordLevelOwner(registry, levelKey, owner, claimedAt = new Date().toISOString()) {
  const next = createOwnerRegistry(registry);
  const normalizedOwner = normalizeLevelOwner(owner);
  if (!normalizedOwner) return next;
  next.levels[levelKey] = { owner: normalizedOwner, claimedAt };
  return next;
}

export function releaseLevelOwner(registry, levelKey) {
  const next = createOwnerRegistry(registry);
  delete next.levels[levelKey];
  return next;
}

export function formatOwnerConflict(levelKey, existingOwner) {
  return `关卡 ${levelKey} 属于「${existingOwner}」，你不能修改或删除它。`
    + `如需接手，请联系「${existingOwner}」；或把操作用户切换成该名字（不区分大小写）。`;
}

export function formatUnclaimedConflict(levelKey) {
  return `关卡 ${levelKey} 还没有登记归属，默认只读。`
    + '如果你要接手这个关卡，请先明确认领；认领后它归你所有。';
}

export function formatOwnerRequired() {
  return '请先在“关卡”面板填写操作用户名，再保存、导入或删除关卡。';
}
