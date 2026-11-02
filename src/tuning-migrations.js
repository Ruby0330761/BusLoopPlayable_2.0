// Saved editor tuning and per-level profiles snapshot the whole tuning object.
// A field removed from source therefore keeps coming back through deepMerge,
// and the exporter rejects the entire package for one unknown key. Pruning
// against the current defaults turns that into a silent, self-healing cleanup.
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
