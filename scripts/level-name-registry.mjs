// Level display-name identity for the authoring endpoints. Duplicate levels
// have historically appeared as copy-suffixed files (" (1)") or auto-generated
// import labels (" (level12.asset)"); both describe an existing level, so they
// collapse onto the bare name and a second entry can no longer be created under
// a label that only differs by that decoration.

export function normalizeLevelDisplayName(value) {
  return String(value ?? '')
    .normalize('NFKC')
    .trim()
    .toLocaleLowerCase()
    .replace(/\s*\(\d+\)$/u, '')
    .replace(/\s*\([^()]*\.asset\)$/u, '')
    .trim();
}

export function findLevelNameConflict(levels, { levelId = null, displayName } = {}) {
  const normalized = normalizeLevelDisplayName(displayName);
  return levels.find((level) => (
    level?.key !== levelId && normalizeLevelDisplayName(level?.displayName) === normalized
  )) ?? null;
}
