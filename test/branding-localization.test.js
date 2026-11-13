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

test('both the CTA and the caption localize, and every storefront ships a title', () => {
  // Both pieces of copy follow the player's language: the button and the bottom
  // caption. The button has its own short label per market, because the store
  // titles below are too long to tap.
  for (const [locale, strings] of Object.entries(BRANDING_LOCALIZATION)) {
    const copy = resolveLocalizedBranding({
      languages: [locale],
      storefront: 'ios',
      text: 'Bus Fever Party!'
    });
    assert.equal(copy.ctaLabel, strings.cta, `${locale} CTA`);
    assert.ok(strings.cta.trim().length > 0, `${locale} CTA is non-empty`);
  }
  // A market with no CTA row falls back to the English label rather than
  // rendering nothing.
  assert.equal(
    resolveLocalizedBranding({ languages: ['th-TH'] }).ctaLabel,
    DEFAULT_CTA_LABEL
  );
  // The title table mirrors the requester's sheet, where Google and iOS word the
  // same market differently and iOS lists simplified Chinese while Google does
  // not. Every storefront must still cover the English fallback row, or an
  // unlisted market would render nothing.
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
  // Every market the title table can serve must also have a CTA label, or that
  // player reads a translated caption above an English button.
  for (const locale of known) {
    assert.ok(BRANDING_LOCALIZATION[locale], `CTA table is missing ${locale}`);
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

test('the editor header offers a language picker that drives the preview', () => {
  // The operator asked for a way to *watch* each language without hunting for
  // the 引导 tab. The picker in the header writes the same tuning key the field
  // row edits, so both controls stay in sync.
  assert.match(editorSource, /class="editor-locale-select"/);
  assert.match(editorSource, /BRANDING_LOCALE_OPTIONS\.map/);
  assert.match(editorSource, /next\.branding\.localization\.previewLocale = localeSelect\.value;/);
  // Picking a market turns localization on: a picker that changes nothing looks
  // broken, and the preview locale is meaningless while localization is off.
  assert.match(editorSource, /if \(localeSelect\.value !== 'auto'\) next\.branding\.localization\.enabled = 1;/);
  // The picker mirrors the tuning value, so restoring a profile updates it.
  assert.match(editorSource, /if \(localeSelect\.value !== previewLocale\) localeSelect\.value = previewLocale;/);
});

test('tuning exposes a localization switch and an editor preview locale', () => {
  // The editor opens in English; "follow the browser" is still offered, but it
  // is no longer the default.
  assert.deepEqual(SCENE_TUNING.branding.localization, { enabled: 1, previewLocale: 'en' });
  assert.match(editorSource, /branding\.localization\.enabled', 0, 1, 1, null, 'toggle'/);
  assert.match(editorSource, /branding\.localization\.previewLocale', 0, 0, 1, BRANDING_LOCALE_OPTIONS\]/);
});

test('the device language is read from every WebView signal, not just one', () => {
  // Some Android WebViews report an empty `navigator.languages`, and older ones
  // only expose `userLanguage`. Reading one field makes those devices fall back
  // to English even though the phone is, say, Japanese.
  assert.match(mainSource, /if \(Array\.isArray\(navigator\.languages\)\) navigator\.languages\.forEach\(push\);/);
  assert.match(mainSource, /push\(navigator\.language\);/);
  assert.match(mainSource, /push\(navigator\.userLanguage\);/);
  // Duplicates are harmless but the list is walked in order, so keep it clean.
  assert.match(mainSource, /return \[\.\.\.new Set\(tags\)\];/);
});

test('an exported package can never be pinned to the editor preview locale', () => {
  // The runtime guard: `previewLocale` is only read inside the editor.
  assert.match(
    mainSource,
    /const previewLocale = EDITOR_ENABLED \? String\(localization\.previewLocale \?\? 'auto'\) : 'auto';/
  );
  // The export guard: the packager resets it to 'auto' in the delivered tuning,
  // so the shipped file states the truth even if the runtime guard regressed.
  const applySource = readFileSync(join(ROOT, 'scripts', 'apply-scene-tuning.mjs'), 'utf8');
  assert.match(applySource, /next\.branding\.localization\.previewLocale = 'auto';/);
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
