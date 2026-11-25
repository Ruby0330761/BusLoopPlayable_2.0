import { SMOKE_TRAIL_DEFAULTS } from './vehicle-effect-assets.js';

export function resetSavedSmokeTrail(tuning) {
  const effects = tuning?.effects;
  if (!effects || !Object.hasOwn(effects, 'smokeTrail')) return false;
  if (Object.entries(SMOKE_TRAIL_DEFAULTS).every(([key, value]) => effects.smokeTrail?.[key] === value)) return false;
  effects.smokeTrail = { ...effects.smokeTrail, ...SMOKE_TRAIL_DEFAULTS };
  return true;
}

export function migrateSmokeTrailCaches(storage, { current, legacy, profiles, preview }) {
  const marker = 'bus-loop-all-levels-smoke-20261123-v1';
  if (storage.getItem(marker) === '1') return;
  for (const key of [current, legacy, profiles, preview]) {
    const source = storage.getItem(key);
    if (!source) continue;
    let data;
    try { data = JSON.parse(source); } catch { continue; }
    let changed = false;
    if (key === profiles) {
      for (const entry of Object.values(data?.profiles ?? data ?? {})) {
        if (resetSavedSmokeTrail(entry?.tuning)) changed = true;
      }
    } else {
      changed = resetSavedSmokeTrail(key === preview ? data?.document?.tuning : data);
    }
    if (changed) storage.setItem(key, JSON.stringify(data));
  }
  storage.setItem(marker, '1');
}

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
