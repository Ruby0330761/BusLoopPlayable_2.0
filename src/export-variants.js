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
  const steps = parseExportVariantValues(tuning.exportNaming?.steps, 'steps', isInstallGateEnabled(tuning.installGate));
  return { lives, steps, count: lives.length * steps.length };
}

export function expandExportVariantTunings(tuning) {
  const { lives, steps } = getExportVariantPlan(tuning);
  return steps.flatMap(stepCount => lives.map(lifeCount => {
    const next = structuredClone(tuning);
    next.exportNaming ??= {};
    next.stamina ??= {};
    next.installGate ??= {};
    next.exportNaming.version = lifeCount === null ? 'N' : `${lifeCount}hp`;
    next.exportNaming.steps = stepCount === null ? 'N' : `${stepCount}moves`;
    next.stamina.enabled = lifeCount === null ? 0 : 1;
    next.installGate.enabled = stepCount === null ? 0 : 1;
    next.installGate.customThresholdEnabled = stepCount === null ? 0 : 1;
    if (lifeCount !== null) next.stamina.lives = lifeCount;
    if (stepCount !== null) next.installGate.successfulOperationThreshold = stepCount;
    return next;
  }));
}

// Authoring changes only; exporting always clones the current preview.
export function syncExportVariantTuning(tuning, path) {
  tuning.exportNaming ??= {};
  tuning.stamina ??= {};
  tuning.installGate ??= {};
  for (const [kind, name, enabled, valuePath, valueObject, valueKey, togglePath] of [
    ['stamina', 'version', Number(tuning.stamina?.enabled) === 1, 'stamina.lives', tuning.stamina, 'lives', 'stamina.enabled'],
    ['steps', 'steps', isInstallGateEnabled(tuning.installGate), 'installGate.successfulOperationThreshold', tuning.installGate, 'successfulOperationThreshold', 'installGate.enabled']
  ]) {
    if (kind === 'steps' && !enabled) tuning.installGate.customThresholdEnabled = 0;
    if (!enabled) tuning.exportNaming[name] = 'N';
    else if (path === valuePath) tuning.exportNaming[name] = String(valueObject[valueKey]);
    else if (path === togglePath && tuning.exportNaming[name] === 'N') tuning.exportNaming[name] = '';
    else if (path === 'initialize' && (!Object.hasOwn(tuning.exportNaming, name) || tuning.exportNaming[name] === 'N')) {
      tuning.exportNaming[name] = String(valueObject?.[valueKey] ?? (kind === 'stamina' ? 3 : 64));
    }
    if (enabled && (path === `exportNaming.${name}` || path === 'initialize')) {
      try {
        valueObject[valueKey] = parseExportVariantValues(tuning.exportNaming[name], kind)[0];
        if (kind === 'steps') tuning.installGate.customThresholdEnabled = 1;
      }
      catch { /* Preserve the invalid draft so the field can explain the error. */ }
    }
    if (kind === 'steps' && path === valuePath) tuning.installGate.customThresholdEnabled = 1;
  }
  return tuning;
}
