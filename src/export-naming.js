import { parseExportVariantValues, expandExportVariantTunings } from './export-variants.js';

const REQUIRED_NAMING_FIELDS = [
  'requirementCode', 'materialCode', 'iterationCode', 'language', 'format',
  'designer', 'requester', 'steps', 'version'
];
export const PLAYABLE_CHANNEL_FOLDER_FALLBACKS = Object.freeze({
  applovin: 'AL',
  'google-ads': 'GG',
  meta: 'FB',
  mintegral: 'MT',
  moloco: 'MO',
  tiktok: 'TT',
  unityads: 'UN'
});
const REQUIRED_CHANNELS = Object.keys(PLAYABLE_CHANNEL_FOLDER_FALLBACKS);
export const PLATFORM_FORMATS = Object.freeze({
  applovin: 'html', 'google-ads': 'zip', meta: 'zip', unityads: 'html',
  mintegral: 'zip', moloco: 'html', tiktok: 'zip'
});
const coreFields = REQUIRED_NAMING_FIELDS.slice(0, -2);
const laterFields = coreFields.slice(3);

export function createTestExportNaming(tuning, brandingSet) {
  return {
    requirementCode: brandingSet === 'crowd' ? 'BFT-TEST' : 'BL-TEST',
    materialCode: 'TEST', iterationCode: 'N', language: 'EN', format: 'PL',
    designer: 'TEST', requester: 'TEST', channels: { ...PLAYABLE_CHANNEL_FOLDER_FALLBACKS },
    steps: Number(tuning.installGate?.enabled) === 1 ? String(tuning.installGate.successfulOperationThreshold) : 'N',
    version: Number(tuning.stamina?.enabled) === 1 ? String(tuning.stamina.lives) + 'hp' : 'N'
  };
}

export function isValidExportNamingPart(value) {
  return /^[A-Za-z0-9_-]{1,64}$/u.test(String(value ?? '').trim());
}

export function getExportNamingSegments(naming, platform) {
  return [
    ...coreFields.slice(0, 3).map(key => [key, naming?.[key]]),
    ['n', 'N'],
    ...laterFields.map(key => [key, naming?.[key]]),
    [`channels.${platform}`, naming?.channels?.[platform]],
    ['steps', naming?.steps],
    ['version', naming?.version]
  ];
}

export function formatCompleteExportName(naming, platform) {
  return getExportNamingSegments(naming, platform).map(([, value]) => String(value ?? '').trim()).join('-');
}

export function parseCompleteExportName(value, naming, currentPlatform, { knownChannelOnly = false } = {}) {
  const name = String(value ?? '').trim().replace(/\.(?:html?|zip)$/iu, '');
  const separator = name.includes('-') ? '-' : '_';
  const invalidFormat = '请粘贴完整的试玩命名，包含渠道、步数和尾段版本。';
  if (!name || name.length > 1024) throw new TypeError(invalidFormat);

  const segments = name.split(separator).map(segment => segment.trim());
  const fields = {};
  const channels = naming?.channels ?? {};
  const tailKeys = getExportNamingSegments(naming, currentPlatform).slice(1).reverse();
  for (const [key, previous] of tailKeys) {
    const channel = key.startsWith('channels.');
    const knownParts = channel ? Object.values(channels) : [previous];
    // Keep existing custom segments that contain the separator. The filename
    // itself has no escaping, so unknown multi-part values need individual fields.
    const matching = knownParts.map(part => String(part ?? '').trim())
      .filter(part => {
        const suffix = (separator === '_' ? part.replaceAll('-', '_') : part).split(separator);
        return suffix.length > 1 && segments.slice(-suffix.length).join(separator) === suffix.join(separator);
      }).sort((left, right) => right.length - left.length)[0];
    const part = matching ?? segments.at(-1);
    if (part === undefined) throw new TypeError(invalidFormat);
    const width = matching ? matching.split(separator === '_' ? /[-_]/u : '-').length : 1;
    segments.splice(-width);
    fields[channel ? 'channel' : key] = part;
  }

  const { materialCode, iterationCode, n: fixed, language, format, designer, requester, channel, steps, version } = fields;
  if (fixed !== 'N') throw new TypeError('前贴 / 诱导编号后的固定段须为 N。');
  let requirementCode = segments.join(separator);
  if (segments.slice(1).some(segment => /^Q\d+V\d+$/iu.test(segment))) {
    throw new TypeError('无法确定需求编号和素材编号的分界，请在下方逐项修改。');
  }

  if (separator === '_') {
    const [prefix, ...parts] = requirementCode.split('_');
    const previous = String(naming?.requirementCode ?? '').trim();
    if (previous.replaceAll('-', '_') === requirementCode) requirementCode = previous;
    else if (['BL', 'BFT'].includes(prefix) && parts.length === 1 && /^\d+$/u.test(parts[0])) {
      requirementCode = `${prefix}-${parts[0]}`;
    }
  }
  const requirementError = getRequirementCodeError(requirementCode);
  if (requirementError) throw new TypeError(requirementError);
  if ([materialCode, iterationCode, language, format, designer, requester, channel].some(part => !isValidExportNamingPart(part))) {
    throw new TypeError('命名各段须填写 1～64 位英文字母、数字、中划线或下划线。');
  }
  const normalizedSteps = steps.toUpperCase() === 'N' ? 'N' : steps;
  const normalizedVersion = version.toUpperCase() === 'N' ? 'N' : version;
  parseExportVariantValues(normalizedSteps, 'steps');
  if (normalizedVersion !== 'N') parseExportVariantValues(normalizedVersion, 'stamina');

  const code = channel.toUpperCase();
  const configured = REQUIRED_CHANNELS.filter(platform => String(channels[platform] ?? '').trim().toUpperCase() === code);
  if (configured.length > 1) throw new TypeError('该渠道代号重复，请先修正各渠道的代号。');
  const platform = configured[0]
    ?? REQUIRED_CHANNELS.find(id => PLAYABLE_CHANNEL_FOLDER_FALLBACKS[id] === code)
    ?? (knownChannelOnly ? null : separator === '_' ? 'mintegral' : currentPlatform);
  if (!platform && knownChannelOnly) throw new TypeError(`无法识别渠道 ${channel}。`);
  if (!REQUIRED_CHANNELS.includes(platform) || (separator === '_' && platform !== 'mintegral')) {
    throw new TypeError(invalidFormat);
  }
  return {
    platform,
    naming: {
      ...naming, requirementCode, materialCode, iterationCode, language, format, designer, requester,
      channels: { ...channels, [platform]: channel }, steps: normalizedSteps, version: normalizedVersion
    }
  };
}

export function parseDeliveryNames(text, naming, brandingSet) {
  const entries = [];
  const errors = [];
  const seen = new Set();
  if (typeof text !== 'string' || text.length > 32768) {
    return { entries, errors: ['交付清单超过输入范围。'] };
  }
  for (const [index, raw] of text.split(/\r\n?|\n/u).entries()) {
    const line = raw.trim();
    if (!line) continue;
    try {
      const parsed = parseCompleteExportName(line, naming, 'applovin', { knownChannelOnly: true });
      validateRequirementCode(parsed.naming.requirementCode, brandingSet);
      const { steps, version } = parsed.naming;
      if (steps.includes('/') || version.includes('/')) throw new TypeError('每行只填一个步数和一个体力值。');
      // The normal exporter spells stamina as e.g. 5hp. Keep the reviewed
      // filename and the bytes delivered by that exporter in agreement.
      if (version !== 'N') parsed.naming.version = parseExportVariantValues(version, 'stamina')[0] + 'hp';
      const format = PLATFORM_FORMATS[parsed.platform];
      const extension = /\.(html?|zip)$/iu.exec(line)?.[1].toLowerCase();
      if (extension && extension !== format) throw new TypeError(`该渠道的文件扩展名应为 .${format}。`);
      let stem = formatCompleteExportName(parsed.naming, parsed.platform);
      if (parsed.platform === 'mintegral') stem = stem.replaceAll('-', '_');
      if (stem.length > (parsed.platform === 'google-ads' ? 128 : 180)) throw new TypeError('文件名超出该渠道长度限制。');
      const fileName = stem + '.' + format;
      const key = fileName.toLowerCase();
      if (seen.has(key)) throw new TypeError('交付文件名重复。');
      seen.add(key);
      entries.push({ ...parsed, fileName, line: index + 1 });
    } catch (error) {
      errors.push(`第 ${index + 1} 行：${error.message}`);
    }
  }
  return { entries, errors };
}

export function deliveryBuilds(tuning, entries) {
  const groups = new Map();
  for (const { naming, platform } of entries) {
    const key = JSON.stringify(naming);
    if (!groups.has(key)) {
      const [variant] = expandExportVariantTunings({
        ...tuning, exportNaming: naming, stamina: { ...tuning.stamina, enabled: naming.version === 'N' ? 0 : 1 }
      });
      groups.set(key, { tuning: variant, platforms: [] });
    }
    groups.get(key).platforms.push(platform);
  }
  return [...groups.values()];
}

export function validateRequiredExportNaming(naming) {
  const isBlank = (value) => typeof value !== 'string' || !value.trim();
  const missing = REQUIRED_NAMING_FIELDS.filter((field) => isBlank(naming?.[field]));
  for (const channel of REQUIRED_CHANNELS) {
    if (isBlank(naming?.channels?.[channel])) missing.push(`channels.${channel}`);
  }
  if (missing.length) {
    const error = new TypeError(`请填写导出命名必填项（${missing.join('、')}）`);
    error.statusCode = 400;
    throw error;
  }
}

// Shared by the editor and export service. Never rewrite a requirement identity.
export function getRequirementCodeError(value, brandingSet) {
  const code = String(value ?? '').trim();
  if (!code || code.length > 64 || !/^(BL|BFT)[A-Z0-9_-]*$/.test(code)) {
    return '需求编号必填，只能以大写 BL 或 BFT 开头，使用大写字母、数字、中划线或下划线（最多 64 位）';
  }
  const prefix = brandingSet === 'bus' ? 'BL' : brandingSet === 'crowd' ? 'BFT' : null;
  if (prefix && !code.startsWith(prefix)) {
    return `当前选择 ${prefix} 套系，请将需求编号改为大写 ${prefix} 开头`;
  }
  return '';
}

export function validateRequirementCode(value, brandingSet) {
  const message = getRequirementCodeError(value, brandingSet);
  if (message) {
    const error = new TypeError(message);
    error.statusCode = 400;
    throw error;
  }
  return String(value).trim();
}
