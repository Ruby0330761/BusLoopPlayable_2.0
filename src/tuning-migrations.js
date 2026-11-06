// Saved editor tuning and per-level profiles snapshot the whole tuning object.
// A field removed from source therefore keeps coming back through deepMerge,
// and the exporter rejects the entire package for one unknown key. Pruning
// against the current defaults turns that into a silent, self-healing cleanup.
export function migrateFootage8PresentationTuning(source) {
  const tuning = source?.footage8Conveyor;
  if (!tuning || Number(tuning.presentationRevision) >= 2) return false;
  // Only migrate the previous default; retain deliberately denser/wider rows.
  if ([0.26, 0.32].includes(Number(tuning.rowSpacing))) tuning.rowSpacing = 0.2;
  if (Number(tuning.roadJoinExtension) === 0.25) tuning.roadJoinExtension = -0.18;
  tuning.presentationRevision = 2;
  return true;
}

export function pruneUnknownTuning(target, template) {
  if (!target || typeof target !== 'object' || !template || typeof template !== 'object') return false;
  let changed = false;
  if (Array.isArray(target)) {
    const itemTemplate = Array.isArray(template) ? template[0] : null;
    if (itemTemplate && typeof itemTemplate === 'object') {
      for (const item of target) {
        if (pruneUnknownTuning(item, itemTemplate)) changed = true;
      }
    }
    return changed;
  }
  for (const key of Object.keys(target)) {
    if (!(key in template)) {
      delete target[key];
      changed = true;
      continue;
    }
    if (pruneUnknownTuning(target[key], template[key])) changed = true;
  }
  return changed;
}
