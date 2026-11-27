import test from 'node:test';
import assert from 'node:assert/strict';
import {
  deliveryBuilds, formatCompleteExportName, getRequirementCodeError, parseCompleteExportName, parseDeliveryNames,
  validateRequiredExportNaming, validateRequirementCode
} from '../src/export-naming.js';
import { syncExportVariantTuning } from '../src/export-variants.js';
import { buildPlayableArtifactName, exportPlayablePackage, exportAllPlayablePackages } from '../scripts/export-playable-package.mjs';
import { SCENE_TUNING } from '../src/scene-tuning.js';
import { buildExportReview } from '../src/export-review.js';

test('delivery rows pair each actual channel with only its own move and stamina settings', () => {
  const prefix = 'BL-2611045-Q465V1-N-N-EN-PL-LGJ-YQY-';
  const names = ['FB-10moves-N', 'FB-N-5hp.zip', 'AL-N-10hp.html'].map(tail => prefix + tail);
  const text = names.join('\r\n\r\n');
  const tuning = structuredClone(SCENE_TUNING);
  tuning.exportNaming.steps = '';
  const { entries, errors } = parseDeliveryNames(text, tuning.exportNaming, 'bus');
  assert.deepEqual(errors, []);
  assert.deepEqual(entries.map(e => e.line), [1, 3, 5]);
  const builds = deliveryBuilds(tuning, entries);
  assert.deepEqual(builds.map(({ tuning: t, platforms }) => [
    platforms, t.installGate.enabled ? t.installGate.successfulOperationThreshold : null, t.stamina.enabled ? t.stamina.lives : null
  ]), [[['meta'], 10, null], [['meta'], null, 5], [['applovin'], null, 10]]);
  const review = buildExportReview(tuning, { brandingSet: 'bus', platforms: [], deliveryNames: text });
  assert.deepEqual(review.names.flatMap(row => row.files), builds.map(({ tuning: t, platforms }) => buildPlayableArtifactName(t, platforms[0])));
  assert.equal(tuning.exportNaming.steps, '');
});

test('delivery list rejects duplicate output paths, unknown channels, ranges and wrong brands or formats by line', () => {
  const name = 'BL-2611045-Q465V1-N-N-EN-PL-LGJ-YQY-FB-N-5hp';
  const input = [name, name+'.zip', name.replace('-FB-', '-QQ-'), name.replace('5hp','5hp/10hp'),
    name.replace('BL-', 'BFT-'), name+'.html', name.replace('FB-N','MT-N').replaceAll('-','_')];
  const result = parseDeliveryNames(input.join('\n'), SCENE_TUNING.exportNaming, 'bus');
  assert.deepEqual(result.entries.map(e => e.platform), ['meta','mintegral']);
  assert.deepEqual(result.errors.map(s => s.match(/第 (\d+) 行/)[1]), ['2','3','4','5','6']);
});

test('full export names populate naming and round-trip through native channel filenames', () => {
  const original = SCENE_TUNING.exportNaming;
  for (const [filename, platform, channel] of [
    ['BL-2611201-Q195V1-N-N-EN-PL-YXH-TJW-AL-35moves-3hp.html', 'applovin', 'AL'],
    ['BFT-26112012-Q275V1-N-N-EN-PL-YXH-TJW-FB-35moves-3hp.zip', 'meta', 'FB'],
    ['BFT_26112012_Q275V1_N_N_EN_PL_YXH_TJW_MT_35moves_3hp.zip', 'mintegral', 'MT']
  ]) {
    const parsed = parseCompleteExportName(` ${filename}\n`, original, 'google-ads');
    assert.equal(parsed.platform, platform);
    assert.equal(parsed.naming.channels[platform], channel);
    assert.equal(parsed.naming.channels['google-ads'], original.channels['google-ads']);
    assert.equal(buildPlayableArtifactName({ exportNaming: parsed.naming }, platform), filename);
    const formatted = formatCompleteExportName(parsed.naming, platform);
    assert.deepEqual(parseCompleteExportName(formatted, parsed.naming, platform), parsed);
    const tuning = structuredClone(SCENE_TUNING);
    tuning.exportNaming = parsed.naming;
    tuning.stamina.enabled = 1;
    syncExportVariantTuning(tuning, 'exportNaming');
    assert.equal(tuning.stamina.lives, 3);
    assert.equal(tuning.installGate.successfulOperationThreshold, 35);
    assert.equal(tuning.installGate.customThresholdEnabled, 1);
  }
});

test('complete naming preserves configured custom codes and rejects invalid names', () => {
  const naming = structuredClone(SCENE_TUNING.exportNaming);
  naming.channels.meta = 'CUSTOM-FB';
  naming.designer = 'YXH-X';
  const full = 'BL-2611201-Q195V1-N-N-EN-PL-YXH-X-TJW-CUSTOM-FB-35/35moves-3hp/5hp';
  const parsed = parseCompleteExportName(full, naming, 'applovin');
  assert.equal(parsed.platform, 'meta');
  assert.equal(formatCompleteExportName(parsed.naming, parsed.platform), full);
  const customChannel = parseCompleteExportName('BL-2611201-Q195V1-N-N-EN-PL-YXH-TJW-NEW-N-N', naming, 'moloco');
  assert.equal(customChannel.naming.channels.moloco, 'NEW');
  assert.equal(customChannel.naming.channels.meta, naming.channels.meta);
  const customMt = parseCompleteExportName('BL_2611201_Q195V1_N_N_EN_PL_YXH_TJW_NEWM_N_N.zip', naming, 'applovin');
  assert.equal(customMt.platform, 'mintegral');
  assert.equal(customMt.naming.channels.mintegral, 'NEWM');

  for (const value of ['', 'BL-2611201-Q195V1', 'bl-2611201-Q195V1-N-N-EN-PL-YXH-TJW-AL-N-N',
    'BL-2611201-Q195V1-N-X-EN-PL-YXH-TJW-AL-N-N', 'BL-2611201-Q195V1-N-N-EN-PL-YXH-TJW-AL-999-N',
    'BL-2611201-Q195V1-N-N-EN-PL-YXH-TJW-AL-N-15hp']) {
    assert.throws(() => parseCompleteExportName(value, naming, 'applovin'), TypeError);
  }
});

test('requirement codes are mandatory, uppercase, bounded and limited to BL/BFT', () => {
  for (const code of ['BL-2610295', 'BFT-26102313', 'BL_2610295']) {
    assert.equal(getRequirementCodeError(code), '', code);
  }
  for (const code of ['', ' ', undefined, 'AC-2610295', 'bl-2610295', 'bft-2610295',
    'Bl-2610295', 'Bft-2610295', 'BL-q1', 'BL../1', 'BL/1', 'BL 1', 'BL-中文', 'BL' + '1'.repeat(63)]) {
    assert.notEqual(getRequirementCodeError(code), '', String(code));
  }
});

test('switching export sets requires the operator to correct the prefix', () => {
  for (const [brandingSet, matching, other] of [
    ['bus', 'BL-2610295', 'BFT-26102313'],
    ['crowd', 'BFT-26102313', 'BL-2610295']
  ]) {
    assert.equal(validateRequirementCode(matching, brandingSet), matching);
    assert.match(getRequirementCodeError(other, brandingSet), /当前选择.*请将需求编号改为/);
    assert.throws(() => validateRequirementCode(other, brandingSet), error => error.statusCode === 400);
    assert.equal(validateRequirementCode(matching, brandingSet), matching);
  }
});

test('single and batch exports reject a mismatched requirement before building, even with checks skipped', async () => {
  for (const exporter of [exportPlayablePackage, exportAllPlayablePackages]) {
    for (const [brandingSet, requirementCode] of [['bus', 'BFT-26102313'], ['crowd', 'BL-2610295']]) {
      const tuning = structuredClone(SCENE_TUNING);
      tuning.exportNaming.requirementCode = requirementCode;
      await assert.rejects(exporter({
        platform: 'applovin', tuning, brandingSet, skipChecks: true, useSelectedLevel: true
      }), error => error.statusCode === 400 && /当前选择/.test(error.message));
    }
  }
});

test('export validation uses the final naming override', async () => {
  await assert.rejects(exportPlayablePackage({
    platform: 'applovin', tuning: structuredClone(SCENE_TUNING), brandingSet: 'bus',
    namingOverride: { requirementCode: 'BFT-26102313' }, useSelectedLevel: true
  }), error => error.statusCode === 400 && /当前选择 BL/.test(error.message));
});

test('editor export rejects missing naming segments for all channels before building', async () => {
  const tuning = structuredClone(SCENE_TUNING);
  assert.doesNotThrow(() => validateRequiredExportNaming(tuning.exportNaming));
  tuning.exportNaming.materialCode = '   ';
  delete tuning.exportNaming.requester;
  tuning.exportNaming.steps = '';
  tuning.exportNaming.channels['google-ads'] = '';
  for (const exporter of [exportPlayablePackage, exportAllPlayablePackages]) {
    await assert.rejects(exporter({
      platform: 'applovin', tuning, useSelectedLevel: true, skipChecks: true
    }), error => error.statusCode === 400
      && /materialCode、requester、steps、channels\.google-ads/.test(error.message));
  }
});
