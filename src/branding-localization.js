// The bottom caption follows the player's device language. Playable ads run
// inside a WebView, so `navigator.languages` is the only reliable signal; the
// ad-network SDKs do not expose a locale API.
//
// The caption comes from the requester's store-title sheet, which words the same
// market differently on Google Play and the App Store — hence one table per
// storefront.
//
// The CTA button is NOT localized. Its wording is part of the approved creative
// and stays `Play Now` in every market (confirmed 2026-11-10: "play now 不要动").
// Do not reintroduce a per-locale CTA table.
//
// The caption only localizes while it still holds the shipped default. An
// operator who typed their own line, or a Crowd build whose brand is a different
// product, keeps exactly what was authored.
//
// Keep this module pure (no DOM, no tuning import) so the resolver and the fit
// maths are unit-testable.

export const DEFAULT_BRANDING_LOCALE = 'en';
export const DEFAULT_CTA_LABEL = 'Play Now';
// The shipped caption. Anything else in `branding.text.content` is authored copy.
export const DEFAULT_BRAND_TITLE = 'Bus Fever Party!';

// There is deliberately no per-locale CTA table. The button reads `Play Now` in
// every market, whatever the caption says.

// Store titles, transcribed from the requester's sheet
//「Bus fever party 双端商店title（26/11/10）」— Google and iOS sections.
//
// Keyed by storefront first because the two stores word the same market
// differently: Japanese is「バスゲーム」on Google Play and「バス渋滞脱出」on the
// App Store, and simplified Chinese only appears in the iOS section at all. A
// market missing from a storefront means that listing is not localized there, so
// it falls back to the sheet's `en-us及其它未列出的语言` row rather than to a
// translation this table invented.
export const STORE_TITLE_TABLES = Object.freeze({
  google: Object.freeze({
    en: 'Bus Fever Party!',
    ru: 'Bus Fever Party! Автобус игра',
    ar: 'لعبه باص Bus Fever Party!',
    es: 'Bus Fever Party! Juego Autobús',
    pt: 'Bus Fever Party Jogo de Ônibus',
    ja: 'Bus Fever Party! バスゲーム',
    fr: 'Bus Fever Party! Jeu de Bus',
    ko: 'Bus Fever Party! 버스게임',
    de: 'Bus Fever Party—Bus Stau Spiel',
    tr: 'Bus Fever Party! Otobüs Oyunu',
    it: 'Bus Fever Party—Ingorgo di Bus',
    'zh-Hant': 'Bus Fever Party! 巴士遊戲',
    id: 'Bus Fever Party! Macet Bus'
  }),
  ios: Object.freeze({
    en: 'Bus Fever Party!',
    ru: 'Bus Fever Party! Автобус игра',
    ar: 'Bus Fever Party! هروب الباص',
    es: 'Bus Fever Party! Juego Atasco',
    pt: 'Bus Fever Party—Fuga de Ônibus',
    ja: 'Bus Fever Party! バス渋滞脱出',
    fr: 'Bus Fever Party!',
    ko: 'Bus Fever Party! 교통체증',
    de: 'Bus Fever Party—Bus Stau lösen',
    tr: 'Bus Fever Party! Otobüs Park',
    it: 'Bus Fever Party—Ingorgo di Bus',
    'zh-Hant': 'Bus Fever Party! 巴士塞車',
    'zh-Hans': 'Bus Fever Party! Bus Loop',
    id: 'Bus Fever Party! Macet Bus',
    vi: 'Bus Fever Party! Kẹt xe buýt'
  })
});

export const DEFAULT_STOREFRONT = 'google';

// Editor preview choices. "auto" follows the operator's browser language so a
// Chinese-language editor shows what a Chinese player would see; picking a
// locale forces that preview. Exports ignore the override and use the device.
// The list covers every market either storefront title table ships.
export const BRANDING_LOCALE_OPTIONS = Object.freeze([
  ['auto', '跟随浏览器'],
  ['en', 'English'],
  ['zh-Hans', '简体中文'],
  ['zh-Hant', '繁體中文'],
  ['ja', '日本語'],
  ['ko', '한국어'],
  ['es', 'Español'],
  ['fr', 'Français'],
  ['de', 'Deutsch'],
  ['ru', 'Русский'],
  ['ar', 'العربية'],
  ['pt', 'Português'],
  ['tr', 'Türkçe'],
  ['it', 'Italiano'],
  ['id', 'Bahasa Indonesia'],
  ['vi', 'Tiếng Việt']
]);

const HANT_SUBTAGS = new Set(['hant', 'tw', 'hk', 'mo']);
const SIMPLE_LANGUAGE_MAP = Object.freeze({
  en: 'en',
  ja: 'ja',
  ko: 'ko',
  es: 'es',
  fr: 'fr',
  de: 'de',
  ru: 'ru',
  ar: 'ar',
  pt: 'pt',
  tr: 'tr',
  it: 'it',
  id: 'id',
  vi: 'vi'
});

function normalizeTag(tag) {
  return String(tag ?? '').trim().replaceAll('_', '-').toLowerCase();
}

function matchSupportedLocale(tag) {
  const normalized = normalizeTag(tag);
  if (!normalized) return null;
  const [language, ...subtags] = normalized.split('-');
  if (language === 'zh') {
    return subtags.some((subtag) => HANT_SUBTAGS.has(subtag)) ? 'zh-Hant' : 'zh-Hans';
  }
  return SIMPLE_LANGUAGE_MAP[language] ?? null;
}

// First supported language in preference order wins. Browsers list the user's
// preferred languages first, so `['ru', 'ja-JP', 'en']` plays Russian rather
// than falling straight through to the English default.
export function resolveBrandingLocale(languages = []) {
  const candidates = Array.isArray(languages) ? languages : [languages];
  for (const candidate of candidates) {
    const locale = matchSupportedLocale(candidate);
    if (locale) return locale;
  }
  return DEFAULT_BRANDING_LOCALE;
}

export function normalizeStorefront(storefront) {
  const value = String(storefront ?? '').trim().toLowerCase();
  return Object.hasOwn(STORE_TITLE_TABLES, value) ? value : DEFAULT_STOREFRONT;
}

/**
 * The store title for `locale` on `storefront`.
 *
 * Falls back to the sheet's English row, which the requester labelled
 *「en-us及其它未列出的语言」— that is the authoritative answer for a market the
 * sheet does not list, not a gap to improvise around.
 */
export function resolveStoreTitle(locale, storefront = DEFAULT_STOREFRONT) {
  const table = STORE_TITLE_TABLES[normalizeStorefront(storefront)];
  return table[locale] ?? table[DEFAULT_BRANDING_LOCALE] ?? DEFAULT_BRAND_TITLE;
}

// An authored line is product copy, not a translation slot. Treat empty and the
// shipped default (in any width variant of the exclamation mark) as "untouched,
// safe to localize"; anything else passes through byte for byte.
function isShippedDefaultTitle(value) {
  const normalized = String(value ?? '').normalize('NFKC').trim();
  return normalized === '' || normalized === DEFAULT_BRAND_TITLE;
}

function titleForAuthoredText(authored, localized) {
  return isShippedDefaultTitle(authored) ? localized : String(authored).trim();
}

export function resolveLocalizedBranding({
  languages = [],
  enabled = true,
  text = '',
  loadingTitle = '',
  storefront = DEFAULT_STOREFRONT
} = {}) {
  const active = Boolean(enabled);
  const locale = active ? resolveBrandingLocale(languages) : DEFAULT_BRANDING_LOCALE;
  const localizedTitle = active ? resolveStoreTitle(locale, storefront) : DEFAULT_BRAND_TITLE;
  return {
    enabled: active,
    locale,
    // Never localized: the button keeps the approved wording in every market.
    ctaLabel: DEFAULT_CTA_LABEL,
    title: titleForAuthoredText(text, localizedTitle),
    loadingTitle: titleForAuthoredText(loadingTitle, localizedTitle)
  };
}

// Both the bottom caption and the CTA are fixed-size boxes with `nowrap`, so a
// localized string must shrink instead of spilling. Text width scales linearly
// with font size; the 2% margin keeps glyph outlines off the border.
export function fitFontSizeToWidth({ fontSize, measuredWidth, availableWidth, safety = 0.98 } = {}) {
  const size = Number(fontSize);
  if (!Number.isFinite(size) || size <= 0) return 0;
  const measured = Number(measuredWidth);
  const available = Number(availableWidth);
  if (!(measured > 0) || !(available > 0) || measured <= available) return size;
  return Math.max(1, size * (available / measured) * safety);
}
