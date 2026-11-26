import test from 'node:test';
import assert from 'node:assert/strict';
import { migrateBrandingIconRadius, resolveBrandingImageFrame, resolveBrandingRowLayout, safeBrandingCenterY, syncBrandingRowTuning } from '../src/branding-image-frame.js';
import { SCENE_TUNING } from '../src/scene-tuning.js';
import { createBrandingVariantTuning, PLAYABLE_BRANDING_SETS, validateTuning } from '../scripts/export-playable-package.mjs';

test('Logo anchors the brand row while the caption follows the clamped CTA', () => {
  const { branding, cta, preview } = structuredClone(SCENE_TUNING);
  Object.assign(branding.logo, { y: 1500 });
  const metrics = {
    designWidth: preview.width, designHeight: preview.height, stageWidth: 360, stageHeight: 720,
    positionScaleX: 1 / 3, positionScaleY: 1 / 3, uiScale: 1 / 3
  };
  const bounds = { left: 10, right: 350 };
  const layout = () => resolveBrandingRowLayout(branding, cta, {}, metrics, 'mintegral', bounds);
  const initial = layout();
  assert.equal(initial.rowY, 500);
  assert.equal(initial.textCenterX, initial.buttonCenterX);
  assert.equal(initial.textCenterY, 532);
  assert.ok(initial.logo.centerX < initial.buttonCenterX && initial.icon.centerX > initial.buttonCenterX);

  branding.logo.y = preview.height;
  branding.text.x += 30;
  cta.x = 0;
  const clamped = layout();
  const iconBottom = clamped.rowY + clamped.icon.frame.height / 2;
  const shadow = clamped.icon.frame.shadow;
  assert.equal(iconBottom + shadow.y + shadow.blur * 1.5, 720 - 86 - 4);
  assert.ok(clamped.buttonCenterX > 0);
  assert.equal(clamped.textCenterX, clamped.buttonCenterX + 190);
  assert.equal(clamped.textCenterY, clamped.rowY + 32);
});

test('CTA changes move the caption by the same amount and keep the saved row aligned', () => {
  const tuning = structuredClone(SCENE_TUNING);
  const { cta, branding } = tuning;
  const originalCta = { ...cta };
  const originalText = { ...branding.text };
  cta.x += 60;
  syncBrandingRowTuning(tuning, originalCta, 'cta.x');
  assert.equal(branding.text.x, originalText.x + 60);
  cta.y -= 120;
  syncBrandingRowTuning(tuning, originalCta, 'cta.y');
  assert.equal(branding.text.y, originalText.y - 120);
  assert.equal(branding.icon.y, cta.y);
  assert.equal(branding.logo.y, cta.y);

  const previousCta = { ...cta };
  branding.logo.y += 100;
  syncBrandingRowTuning(tuning, previousCta, 'branding.logo.position');
  assert.equal(cta.y, originalCta.y - 20);
  assert.equal(branding.icon.y, cta.y);
  assert.equal(branding.text.y, originalText.y - 20);
});

test('brand art and its shadow clear each bottom band and higher authored positions stay put', () => {
  const frame = { height: 50, shadow: { y: 3, blur: 4 } };
  for (const [channel, portrait, landscape] of [
    ['applovin', 40, 54], ['google-ads', 64, 54], ['mintegral', 86, 62],
    ['unityads', 82, 60], ['moloco', 76, 58], ['meta', 40, 54], ['tiktok', 40, 54]
  ]) {
    for (const [w, h, inset] of [[360, 800, portrait], [800, 360, landscape]]) {
      assert.equal(safeBrandingCenterY(h, frame, w, h, channel) + 25 + 9, h - inset - 4);
      assert.equal(safeBrandingCenterY(70, frame, w, h, channel), 70);
    }
  }
});

test('a saved pixel radius keeps its visible size and an explicit zero percentage wins', () => {
  const old = { width: 180, height: 123, radius: 30 };
  assert.ok(migrateBrandingIconRadius(old));
  assert.equal(migrateBrandingIconRadius(old), false);
  const frame = resolveBrandingImageFrame(old, { naturalWidth: 512, naturalHeight: 512 }, .5);
  assert.equal(frame.width, 61.5);
  assert.equal(frame.radius, 15);
  const migrated = validateTuning({ branding: { icon: { radius: 30, cornerRadius: 0 } } }, SCENE_TUNING);
  assert.deepEqual(migrated.branding.icon, { cornerRadius: 0 });
});

test('reference frame follows the painted logo bounds and survives brand retargeting', () => {
  const config = structuredClone(SCENE_TUNING);
  Object.assign(config.branding.logo, {
    width: 200, height: 160, cornerRadius: 19,
    stroke: { ...config.branding.logo.stroke, enabled: 1, width: 6 },
    shadow: { ...config.branding.logo.shadow, enabled: 1 }
  });
  for (const variant of Object.values(PLAYABLE_BRANDING_SETS).flat()) {
    const { logo, icon } = createBrandingVariantTuning(validateTuning(config, SCENE_TUNING), variant.id).branding;
    const frame = resolveBrandingImageFrame(logo, { naturalWidth: 400, naturalHeight: 200 }, .5);
    assert.deepEqual([frame.width, frame.height, frame.radius, frame.strokeWidth], [100, 50, 9.5, 3]);
    assert.deepEqual(frame.shadow, { x: 0, y: 3, blur: 6, color: 'rgba(0, 0, 0, 0.35)' });
    assert.equal(icon.height, 123);
    assert.equal(icon.cornerRadius, 16);
    assert.deepEqual(icon.stroke, { enabled: 1, color: 0xffffff, width: 5.5, opacity: 1 });
    assert.deepEqual(icon.shadow, { enabled: 1, color: 0, opacity: 0.35, blur: 12, offsetX: 0, offsetY: 6 });
  }
});
