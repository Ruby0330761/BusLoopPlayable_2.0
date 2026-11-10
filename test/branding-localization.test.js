import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

import {
  BRANDING_LOCALIZATION,
  BRANDING_LOCALE_OPTIONS,
  DEFAULT_CTA_LABEL,
  STORE_TITLE_TABLES,
  fitFontSizeToWidth,
  resolveBrandingLocale,
  resolveLocalizedBranding,
  resolveStoreTitle
} from '../src/branding-localization.js';
import { SCENE_TUNING } from '../src/scene-tuning.js';

const ROOT = process.cwd();
const mainSource = readFileSync(join(ROOT, 'src', 'main.js'), 'utf8');
const editorSource = readFileSync(join(ROOT, 'src', 'scene-editor.js'), 'utf8');

test('device language resolution covers the eight shipped store languages', () => {
  assert.equal(resolveBrandingLocale(['en-US']), 'en');
  assert.equal(resolveBrandingLocale(['zh-CN']), 'zh-Hans');
  assert.equal(resolveBrandingLocale(['zh-SG']), 'zh-Hans');
  assert.equal(resolveBrandingLocale(['zh-TW']), 'zh-Hant');
  assert.equal(resolveBrandingLocale(['zh-HK']), 'zh-Hant');
  assert.equal(resolveBrandingLocale(['ja-JP']), 'ja');
  assert.equal(resolveBrandingLocale(['ko-KR']), 'ko');
  assert.equal(resolveBrandingLocale(['es-419']), 'es');
  assert.equal(resolveBrandingLocale(['fr-CA']), 'fr');
  assert.equal(resolveBrandingLocale(['de-AT']), 'de');
});

test('language resolution follows the player preference order and falls back to English', () => {
  // A device set to Russian but with Japanese as a secondary language must not
  // discard the player's supported choice.
  // Both `ru` and `ja` are supported now that the store-title sheet covers every
  // market it lists, so the first preference wins outright.
  assert.equal(resolveBrandingLocale(['ru-RU', 'ja-JP', 'en-US']), 'ru');
  assert.equal(resolveBrandingLocale(['pt-BR', 'it-IT']), 'pt');
  assert.equal(resolveBrandingLocale(['vi-VN', 'th-TH']), 'vi');
  assert.equal(resolveBrandingLocale(['th-TH']), 'en');
  assert.equal(resolveBrandingLocale([]), 'en');
  assert.equal(resolveBrandingLocale(undefined), 'en');
  // Some WebViews expose underscore tags.
  assert.equal(resolveBrandingLocale(['zh_CN']), 'zh-Hans');
});

test('every locale ships a CTA label, and every storefront ships a title', () => {
  for (const [locale, strings] of Object.entries(BRANDING_LOCALIZATION)) {
    assert.equal(typeof strings.cta, 'string', `${locale} cta`);
    assert.ok(strings.cta.trim().length > 0, `${locale} cta is non-empty`);
  }
  // The title table is a different shape on purpose: it mirrors the requester's
  // sheet, where Google and iOS word the same market differently and iOS lists
  // simplified Chinese while Google does not. Every storefront must still cover
  // the English fallback row, or an unlisted market would render nothing.
  for (const [storefront, table] of Object.entries(STORE_TITLE_TABLES)) {
    assert.ok(table.en && table.en.trim().length > 0, `${storefront} needs an English fallback`);
    for (const [locale, title] of Object.entries(table)) {
      assert.equal(typeof title, 'string', `${storefront}/${locale}`);
      assert.ok(title.trim().length > 0, `${storefront}/${locale} is non-empty`);
    }
  }
  // The editor offers exactly the markets the title table can serve.
  const offered = BRANDING_LOCALE_OPTIONS.map(([value]) => value).filter((value) => value !== 'auto');
  const known = new Set(Object.values(STORE_TITLE_TABLES).flatMap((table) => Object.keys(table)));
  assert.deepEqual(offered.sort(), [...known].sort());
  // Every CTA locale must also be a title locale, so the caption and the button
  // never disagree about which languages the ad speaks.
  for (const locale of Object.keys(BRANDING_LOCALIZATION)) {
    assert.ok(known.has(locale), `title table is missing ${locale}`);
  }
});

test('store titles follow the storefront, not a single shared translation', () => {
  // The same market reads differently on each store in the requester's sheet.
  assert.equal(resolveStoreTitle('ja', 'google'), 'Bus Fever Party! バスゲーム');
  assert.equal(resolveStoreTitle('ja', 'ios'), 'Bus Fever Party! バス渋滞脱出');
  assert.equal(resolveStoreTitle('de', 'google'), 'Bus Fever Party—Bus Stau Spiel');
  assert.equal(resolveStoreTitle('de', 'ios'), 'Bus Fever Party—Bus Stau lösen');
  // Simplified Chinese only appears in the iOS section.
  assert.equal(resolveStoreTitle('zh-Hans', 'ios'), 'Bus Fever Party! Bus Loop');
  assert.equal(resolveStoreTitle('zh-Hans', 'google'), STORE_TITLE_TABLES.google.en);
  // A market the sheet does not list falls back to its English row.
  assert.equal(resolveStoreTitle('th', 'ios'), STORE_TITLE_TABLES.ios.en);
  // An unknown storefront resolves to the default rather than throwing.
  assert.equal(resolveStoreTitle('ja', 'nope'), STORE_TITLE_TABLES.google.ja || resolveStoreTitle('ja', 'google'));
});

test('the shipped default title and loading title localize, custom copy does not', () => {
  const chinese = resolveLocalizedBranding({
    languages: ['zh-CN'],
    text: 'Bus Fever Party!',
    loadingTitle: 'Bus Fever Party!'
  });
  assert.equal(chinese.locale, 'zh-Hans');
  // Simplified Chinese is an iOS-only listing in the sheet, so the default
  // storefront (Google) falls back to its English row.
  assert.equal(chinese.title, STORE_TITLE_TABLES.google.en);
  assert.equal(chinese.loadingTitle, STORE_TITLE_TABLES.google.en);
  assert.equal(chinese.ctaLabel, BRANDING_LOCALIZATION['zh-Hans'].cta);

  // On iOS the same device gets the localized listing.
  const chineseIos = resolveLocalizedBranding({
    languages: ['zh-CN'],
    storefront: 'ios',
    text: 'Bus Fever Party!'
  });
  assert.equal(chineseIos.title, 'Bus Fever Party! Bus Loop');

  // A brand switch (Crowd) and an operator-written line are product copy, not
  // something a translation table may overwrite.
  const crowd = resolveLocalizedBranding({
    languages: ['ja-JP'],
    text: 'Bus Crowd',
    loadingTitle: 'Bus Crowd'
  });
  assert.equal(crowd.title, 'Bus Crowd');
  assert.equal(crowd.loadingTitle, 'Bus Crowd');

  const custom = resolveLocalizedBranding({ languages: ['de-DE'], text: 'Download now' });
  assert.equal(custom.title, 'Download now');
});

test('the full-width exclamation used by older tuning exports still counts as default', () => {
  const copy = resolveLocalizedBranding({ languages: ['ko-KR'], text: 'Bus Fever Party！' });
  assert.equal(copy.title, STORE_TITLE_TABLES.google.ko);
});

test('disabling localization keeps the English creative exactly as authored', () => {
  const copy = resolveLocalizedBranding({
    languages: ['ja-JP'],
    text: 'Bus Fever Party!',
    loadingTitle: 'Bus Fever Party!',
    enabled: false
  });
  assert.equal(copy.locale, 'en');
  assert.equal(copy.title, 'Bus Fever Party!');
  assert.equal(copy.loadingTitle, 'Bus Fever Party!');
  assert.equal(copy.ctaLabel, DEFAULT_CTA_LABEL);
});

test('localized strings shrink to the tuned box instead of overflowing it', () => {
  // A Japanese CTA at the shipped 63px type is wider than the green plate.
  const shrunk = fitFontSizeToWidth({ fontSize: 63, measuredWidth: 420, availableWidth: 302 });
  assert.ok(shrunk < 63 && shrunk > 40, `unexpected fitted size ${shrunk}`);
  assert.ok(420 * (shrunk / 63) <= 302, 'fitted text must fit the available width');

  // Text that already fits keeps its authored size.
  assert.equal(fitFontSizeToWidth({ fontSize: 63, measuredWidth: 200, availableWidth: 302 }), 63);
  // Degenerate measurements never produce NaN or zero-size type.
  assert.equal(fitFontSizeToWidth({ fontSize: 63, measuredWidth: 0, availableWidth: 302 }), 63);
  assert.equal(fitFontSizeToWidth({ fontSize: 63, measuredWidth: 400, availableWidth: 0 }), 63);
  assert.equal(fitFontSizeToWidth({}), 0);
});

test('tuning exposes a localization switch and an editor preview locale', () => {
  assert.deepEqual(SCENE_TUNING.branding.localization, { enabled: 1, previewLocale: 'auto' });
  assert.match(editorSource, /branding\.localization\.enabled', 0, 1, 1, null, 'toggle'/);
  assert.match(editorSource, /branding\.localization\.previewLocale', 0, 0, 1, BRANDING_LOCALE_OPTIONS\]/);
});

test('runtime resolves the copy before measuring the fixed-size boxes', () => {
  // The bottom caption is swapped before fitBrandingText measures it.
  assert.match(mainSource, /const copy = resolveBrandingCopy\(\);/);
  assert.match(mainSource, /element\.textContent = content;\n\s*element\.setAttribute\('aria-label', content\);/);
  assert.match(mainSource, /const content = copy\.title;/);
  // The CTA label is swapped before fitCtaLabel runs.
  assert.match(mainSource, /const ctaLabel = resolveBrandingCopy\(\)\.ctaLabel;/);
  assert.match(mainSource, /ctaButton\.textContent = ctaLabel;/);
  // The screenshot compositor draws the same localized label, not a literal.
  assert.match(mainSource, /const ctaLabel = resolveBrandingCopy\(\)\.ctaLabel;[\s\S]{0,2000}strokeText\(ctaLabel/);
  assert.doesNotMatch(mainSource, /strokeText\('Play Now'/);
  // The loader shows the same localized title. Its heading sizes itself with
  // clamp(), so there is no fit pass to assert — only that the swap happens.
  assert.match(mainSource, /const title = resolveBrandingCopy\(\)\.loadingTitle;/);
  assert.match(mainSource, /loadingTitle\.textContent = title;/);
  // Exports must never honour the editor preview override.
  assert.match(mainSource, /const previewLocale = EDITOR_ENABLED \? String\(localization\.previewLocale \?\? 'auto'\) : 'auto';/);
});
