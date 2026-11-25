// Shared authoring/export contract. Raw lists never reach an artifact name.
export function isInstallGateEnabled(config) {
  return config?.enabled === undefined || Number(config.enabled) === 1;
}

export function parseExportVariantValues(raw, kind, enabled = true) {
  if (!enabled) return [null];
  const stamina = kind === 'stamina';
  const label = stamina ? '尾段版本（体力）' : '步数';
  const limit = stamina ? 10 : 200;
  const text = String(raw ?? '').trim();
  if (!stamina && (!text || text.toUpperCase() === 'N')) return [null];
  const pattern = stamina ? /^(\d+)(?:hp)?$/i : /^(\d+)(?:moves)?$/i;
  const message = `${label}必须填写1～${limit}的整数，多个值用 / 分隔`;
  if (!text || text.length > 256) throw new TypeError(message);
  const values = text.split('/').map(part => {
    const match = part.trim().match(pattern);
    const value = match ? Number(match[1]) : NaN;
    if (!Number.isInteger(value) || value < 1 || value > limit) throw new TypeError(message);
    return value;
  });
  return [...new Set(values)];
}

export function getExportVariantPlan(tuning) {
  const lives = parseExportVariantValues(tuning.exportNaming?.version, 'stamina', Number(tuning.stamina?.enabled) === 1);
  const steps = parseExportVariantValues(tuning.exportNaming?.steps, 'steps');
  return { lives, steps, count: lives.length * steps.length };
}

export function expandExportVariantTunings(tuning) {
  const { lives, steps } = getExportVariantPlan(tuning);
  return steps.flatMap(stepCount => lives.map(lifeCount => {
    const next = structuredClone(tuning);
    next.exportNaming ??= {};
    next.stamina ??= {};
    next.exportNaming.version = lifeCount === null ? 'N' : `${lifeCount}hp`;
    next.exportNaming.steps = stepCount === null ? 'N' : `${stepCount}moves`;
    next.stamina.enabled = lifeCount === null ? 0 : 1;
    if (lifeCount !== null) next.stamina.lives = lifeCount;
    return next;
  }));
}

// Authoring changes only; exporting always clones the current preview.
export function syncExportVariantTuning(tuning, path) {
  tuning.exportNaming ??= {};
  tuning.stamina ??= {};
  const naming = tuning.exportNaming;
  const stamina = tuning.stamina;
  if (Number(stamina.enabled) !== 1) naming.version = 'N';
  else if (path === 'stamina.lives') naming.version = String(stamina.lives);
  else if (path === 'stamina.enabled' && naming.version === 'N') naming.version = '';
  else if (path === 'initialize' && (!Object.hasOwn(naming, 'version') || naming.version === 'N')) {
    naming.version = String(stamina.lives ?? 3);
  }
  if (Number(stamina.enabled) === 1 && (path === 'exportNaming.version' || path === 'initialize')) {
    try { stamina.lives = parseExportVariantValues(naming.version, 'stamina')[0]; }
    catch { /* Preserve the invalid draft so the field can explain the error. */ }
  }
  return tuning;
}
