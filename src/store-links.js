const STORE_LINK_RULES = Object.freeze({
  android: Object.freeze({
    hostname: 'play.google.com',
    pathPattern: /^\/store\/apps\/details\/?$/u
  }),
  ios: Object.freeze({
    hostname: 'apps.apple.com',
    pathPattern: /^\/(?:[a-z]{2}\/)?app\/(?:[^/]+\/)?id\d+\/?$/iu
  })
});

function parseStoreLink(platform, value) {
  const rule = STORE_LINK_RULES[platform];
  if (!rule || typeof value !== 'string') return null;
  const normalized = value.trim();
  if (!normalized || normalized.length > 2048) return null;
  try {
    const url = new URL(normalized);
    if (
      url.protocol !== 'https:'
      || url.hostname !== rule.hostname
      || url.port
      || url.username
      || url.password
      || url.hash
      || !rule.pathPattern.test(url.pathname)
    ) return null;
    if (platform === 'android' && !/^[A-Za-z0-9._]+$/u.test(url.searchParams.get('id') ?? '')) return null;
    return url.href;
  } catch {
    return null;
  }
}

export function isValidStoreLink(platform, value) {
  return parseStoreLink(platform, value) !== null;
}

export function validateStoreLink(platform, value, location = `${platform} store link`) {
  const normalized = parseStoreLink(platform, value);
  if (normalized) return normalized;
  const expected = platform === 'android' ? 'Google Play' : platform === 'ios' ? 'Apple App Store' : platform;
  throw new TypeError(`${location} must be a valid HTTPS ${expected} product URL.`);
}

export function resolveStoreLink(platform, value, fallback) {
  return parseStoreLink(platform, value) ?? validateStoreLink(platform, fallback, `Fallback ${platform} store link`);
}
