// Shared authoring/export contract. Raw lists never reach an artifact name.
export function isInstallGateEnabled(config) {
  return config?.enabled === undefined || Number(config.enabled) === 1;
}

function parseExportVariantParts(raw, kind) {
  const stamina = kind === 'stamina';
  const limit = stamina ? 10 : 200;
  const text = String(raw ?? '').trim();
  if (!stamina && text.toUpperCase() === 'N') return [{ value: null, name: 'N' }];
  const pattern = stamina ? /^(\d+)(?:hp)?$/i : /^(\d+)(?:moves)?$/i;
  const message = stamina
    ? '尾段版本（体力）必须填写1～10的整数，多个值用 / 分隔'
    : '步数请输入 1～200 的整数，可加 moves，多个版本用 / 分隔。填 N 表示清空关卡后跳转。';
  if (!text || text.length > 256) throw new TypeError(message);
  return text.split('/').map(part => {
    const name = part.trim();
    const match = name.match(pattern);
    const value = match ? Number(match[1]) : NaN;
    if (!Number.isInteger(value) || value < 1 || value > limit || (!stamina && name.length > 64)) {
      throw new TypeError(message);
    }
    return { value, name };
  });
}

export function parseExportVariantValues(raw, kind, enabled = true) {
  if (!enabled) return [null];
  return [...new Set(parseExportVariantParts(raw, kind).map(({ value }) => value))];
}

export function getExportVariantPlan(tuning) {
  const lives = parseExportVariantValues(tuning.exportNaming?.version, 'stamina', Number(tuning.stamina?.enabled) === 1);
  const rawSteps = tuning.exportNaming?.steps ?? (isInstallGateEnabled(tuning.installGate) ? '' : 'N');
  const steps = [];
  const seenStepNames = new Set();
  for (const variant of parseExportVariantParts(rawSteps, 'steps')) {
    const nameKey = variant.name.toLowerCase();
    if (seenStepNames.has(nameKey)) continue;
    seenStepNames.add(nameKey);
    steps.push(variant);
  }
  return { lives, steps, count: lives.length * steps.length };
}

export function expandExportVariantTunings(tuning) {
  const { lives, steps } = getExportVariantPlan(tuning);
  return steps.flatMap(({ value: stepCount, name: stepName }) => lives.map(lifeCount => {
    const next = structuredClone(tuning);
    next.exportNaming ??= {};
    next.stamina ??= {};
    next.installGate ??= {};
    next.exportNaming.version = lifeCount === null ? 'N' : `${lifeCount}hp`;
    next.exportNaming.steps = stepName;
    next.stamina.enabled = lifeCount === null ? 0 : 1;
    next.installGate.enabled = stepCount === null ? 0 : 1;
    next.installGate.customThresholdEnabled = next.installGate.enabled;
    if (lifeCount !== null) next.stamina.lives = lifeCount;
    if (stepCount !== null) next.installGate.successfulOperationThreshold = stepCount;
    return next;
  }));
}

function syncStepNaming(tuning, path) {
  const { exportNaming, installGate } = tuning;
  const enabled = isInstallGateEnabled(installGate);
  const rawSteps = String(exportNaming.steps ?? '').trim();
  const isNoStepName = rawSteps.toUpperCase() === 'N';

  if (path === 'installGate.enabled') {
    if (!enabled) {
      exportNaming.steps = 'N';
      installGate.customThresholdEnabled = 0;
    } else if (isNoStepName) {
      exportNaming.steps = '';
    }
    return;
  }
  if (path === 'installGate.successfulOperationThreshold' && enabled) {
    const suffix = rawSteps.split('/', 1)[0].trim().match(/moves$/i)?.[0] ?? '';
    exportNaming.steps = `${installGate.successfulOperationThreshold}${suffix}`;
    installGate.customThresholdEnabled = 1;
    return;
  }
  if (path === 'initialize' && (!Object.hasOwn(exportNaming, 'steps') || (isNoStepName && enabled))) {
    exportNaming.steps = enabled ? String(installGate.successfulOperationThreshold ?? 64) : 'N';
  }
  if (path !== 'exportNaming.steps' && path !== 'exportNaming' && path !== 'initialize') return;
  try {
    const [threshold] = parseExportVariantValues(exportNaming.steps, 'steps');
    installGate.enabled = threshold === null ? 0 : 1;
    installGate.customThresholdEnabled = installGate.enabled;
    if (threshold !== null) installGate.successfulOperationThreshold = threshold;
  } catch {
    // Keep the draft visible and continue previewing the last valid settings.
  }
}

// Authoring changes only; exporting always clones the current preview.
export function syncExportVariantTuning(tuning, path) {
  tuning.exportNaming ??= {};
  tuning.stamina ??= {};
  tuning.installGate ??= {};
  const { exportNaming, stamina } = tuning;
  const staminaEnabled = Number(stamina.enabled) === 1;
  if (!staminaEnabled) exportNaming.version = 'N';
  else if (path === 'stamina.lives') exportNaming.version = String(stamina.lives);
  else if (path === 'stamina.enabled' && exportNaming.version === 'N') exportNaming.version = '';
  else if (path === 'initialize' && (!Object.hasOwn(exportNaming, 'version') || exportNaming.version === 'N')) {
    exportNaming.version = String(stamina.lives ?? 3);
  }
  if (staminaEnabled && (path === 'exportNaming.version' || path === 'exportNaming' || path === 'initialize')) {
    try { [stamina.lives] = parseExportVariantValues(exportNaming.version, 'stamina'); }
    catch { /* Preserve the invalid draft so the field can explain the error. */ }
  }
  syncStepNaming(tuning, path);
  return tuning;
}
