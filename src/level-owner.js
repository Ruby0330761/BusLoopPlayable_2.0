// Operator identity for level authoring requests.
//
// The server refuses to overwrite a level owned by a different operator, so
// every write has to name one. The name is kept in localStorage because there
// is no login on the editor; it is a guardrail against accidental cross-edits,
// not authentication. See `scripts/level-ownership.mjs` for the server side.
export const LEVEL_OWNER_STORAGE_KEY = 'bus-loop-level-owner-v1';
export const LEVEL_OWNER_MAX_LENGTH = 40;
// The dedicated claim endpoint takes the operator header alone; there is no
// "claim" flag on save, so pressing save can never capture an unregistered
// level owned by nobody yet.
export const LEVEL_OWNER_ERROR_CODES = Object.freeze({
  ownerRequired: 'LEVEL_OWNER_REQUIRED',
  unclaimed: 'LEVEL_UNCLAIMED',
  ownedByOther: 'LEVEL_OWNED_BY_OTHER'
});

const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/gu;

/** Same normalization as the server, so one name cannot become two owners. */
export function normalizeLevelOwner(value) {
  if (typeof value !== 'string') return '';
  return value.replace(CONTROL_CHARACTERS, ' ').replace(/\s+/gu, ' ').trim().slice(0, LEVEL_OWNER_MAX_LENGTH);
}

export function readStoredLevelOwner(storage = globalThis.localStorage) {
  try {
    return normalizeLevelOwner(storage?.getItem(LEVEL_OWNER_STORAGE_KEY) ?? '');
  } catch {
    return '';
  }
}

export function storeLevelOwner(owner, storage = globalThis.localStorage) {
  const normalized = normalizeLevelOwner(owner);
  try {
    if (normalized) storage?.setItem(LEVEL_OWNER_STORAGE_KEY, normalized);
    else storage?.removeItem(LEVEL_OWNER_STORAGE_KEY);
  } catch {
    // A blocked or full storage must not stop an authoring request; the caller
    // keeps the value in memory and the header still carries it.
  }
  return normalized;
}

/**
 * Headers for an authoring request. Empty when no operator is set, which the
 * server answers with a 403 that names the missing field, rather than silently
 * overwriting the level.
 */
export function levelOwnerHeaders(owner = readStoredLevelOwner()) {
  const normalized = normalizeLevelOwner(owner);
  return normalized ? { 'X-Level-Owner': encodeURIComponent(normalized) } : {};
}

/** True when the level has no registered owner, so it is read-only until claimed. */
export function isUnregisteredLevelOwner(levelOwner) {
  return !normalizeLevelOwner(levelOwner);
}

/** Merges the operator header into an existing fetch init. */
export function withLevelOwner(init = {}, owner = readStoredLevelOwner()) {
  return {
    ...init,
    headers: { ...(init.headers ?? {}), ...levelOwnerHeaders(owner) }
  };
}

/** Same comparison key as the server, so case alone never locks an operator out. */
export function levelOwnerKey(value) {
  return normalizeLevelOwner(value).toLocaleLowerCase('en-US');
}

/** True when the level belongs to someone else, for read-only warnings. */
export function isForeignLevelOwner(levelOwner, owner = readStoredLevelOwner()) {
  const other = normalizeLevelOwner(levelOwner);
  if (!other) return false;
  return levelOwnerKey(other) !== levelOwnerKey(owner);
}
