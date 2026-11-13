import test from 'node:test';
import assert from 'node:assert/strict';
import { expandExportVariantTunings, getExportVariantPlan, isInstallGateEnabled, parseExportVariantValues, syncExportVariantTuning } from '../src/export-variants.js';
import { SCENE_TUNING } from '../src/scene-tuning.js';
import { buildPlayableArtifactName, createEditorExportSession, validateTuning } from '../scripts/export-playable-package.mjs';
import { resolvePlayableSession } from '../src/playable-session-config.js';

function fixture() {
  const tuning = structuredClone(SCENE_TUNING);
  tuning.stamina.enabled = 1;
  tuning.exportNaming.version = '3/5/10';
  tuning.exportNaming.steps = '10/20';
  return tuning;
}

test('editor export isolates the selected mother level from the repository default session', () => {
  for (const levelKey of ['level24', 'level25', 'level9']) {
    const tuning = fixture();
    tuning.level.selected = levelKey;
    const session = resolvePlayableSession(createEditorExportSession(tuning));
    assert.deepEqual(session.stages.map(stage => stage.levelKey), levelKey === 'level9' ? ['level9', 'level7'] : [levelKey]);
    assert.deepEqual(session.stages[0].scene, {});
    assert.deepEqual(session.stages[0].opening, {});
  }
});

test('lists accept bare numbers and suffixes, normalize duplicates in order', () => {
  assert.deepEqual(parseExportVariantValues('3 / 5hp / 03 / 10HP', 'stamina'), [3, 5, 10]);
  assert.deepEqual(parseExportVariantValues('10moves / 200 / 10', 'steps'), [10, 200]);
  for (const value of ['', 'N', '3/', '/3', '3//5', '0', '11', '1.5', '-1', '3moves', '../3', '1e1']) {
    assert.throws(() => parseExportVariantValues(value, 'stamina'), TypeError, value);
  }
  assert.throws(() => parseExportVariantValues('201', 'steps'));
  assert.throws(() => parseExportVariantValues('3hp', 'steps'));
  assert.deepEqual(parseExportVariantValues('invalid', 'stamina', false), [null]);
});

test('every Cartesian variant has a matching artifact name and actual settings', () => {
  const tuning = fixture();
  const original = structuredClone(tuning);
  const variants = expandExportVariantTunings(tuning);
  assert.equal(getExportVariantPlan(tuning).count, 6);
  assert.equal(variants.length, 6);
  for (const variant of variants) {
    validateTuning(variant, SCENE_TUNING);
    const step = variant.installGate.successfulOperationThreshold;
    const hp = variant.stamina.lives;
    assert.equal(variant.installGate.customThresholdEnabled, 1, 'the threshold survives stripped naming metadata');
    assert.match(buildPlayableArtifactName(variant, 'meta'), new RegExp(`-FB-${step}moves-${hp}hp\\.zip$`));
    assert.match(buildPlayableArtifactName(variant, 'mintegral'), new RegExp(`_MT_${step}moves_${hp}hp\\.zip$`));
  }
  variants[0].stamina.lives = 9;
  assert.equal(variants[1].stamina.lives, 5);
  assert.deepEqual(tuning, original);
});

test('disabled features emit N and are disabled inside the output', () => {
  const tuning = fixture();
  tuning.stamina.enabled = 0;
  tuning.installGate.enabled = 0;
  const [variant] = expandExportVariantTunings(tuning);
  assert.equal(variant.exportNaming.version, 'N');
  assert.equal(variant.exportNaming.steps, 'N');
  assert.equal(variant.stamina.enabled, 0);
  assert.equal(variant.installGate.enabled, 0);
  assert.equal(isInstallGateEnabled({ successfulOperationThreshold: 5 }), true, 'old configurations retain their gate');
  assert.equal(isInstallGateEnabled(variant.installGate), false);
});

test('typing a list previews the first value; guide edits replace the list', () => {
  const tuning = fixture();
  syncExportVariantTuning(tuning, 'exportNaming.version');
  syncExportVariantTuning(tuning, 'exportNaming.steps');
  assert.equal(tuning.stamina.lives, 3);
  assert.equal(tuning.installGate.successfulOperationThreshold, 10);
  assert.equal(tuning.exportNaming.version, '3/5/10');
  tuning.stamina.lives = 8;
  syncExportVariantTuning(tuning, 'stamina.lives');
  assert.equal(tuning.exportNaming.version, '8');
  tuning.installGate.successfulOperationThreshold = 15;
  syncExportVariantTuning(tuning, 'installGate.successfulOperationThreshold');
  assert.equal(tuning.exportNaming.steps, '15');
});

test('toggle off clears to N, toggle on requires a value, invalid drafts do not change preview', () => {
  const tuning = fixture();
  tuning.stamina.enabled = 0;
  syncExportVariantTuning(tuning, 'stamina.enabled');
  assert.equal(tuning.exportNaming.version, 'N');
  tuning.stamina.enabled = 1;
  syncExportVariantTuning(tuning, 'stamina.enabled');
  assert.equal(tuning.exportNaming.version, '');
  assert.throws(() => getExportVariantPlan(tuning));
  syncExportVariantTuning(tuning, 'initialize');
  assert.equal(tuning.exportNaming.version, '', 'refresh must preserve an explicit empty required draft');
  assert.throws(() => getExportVariantPlan(tuning));
  tuning.exportNaming.version = 'invalid';
  syncExportVariantTuning(tuning, 'exportNaming.version');
  assert.equal(tuning.stamina.lives, SCENE_TUNING.stamina.lives);
});

test('initial legacy on settings get their current values without overwriting lists', () => {
  const tuning = fixture();
  tuning.exportNaming.steps = 'N';
  delete tuning.installGate.enabled;
  syncExportVariantTuning(tuning, 'initialize');
  assert.equal(tuning.exportNaming.steps, String(tuning.installGate.successfulOperationThreshold));
  assert.equal(tuning.exportNaming.version, '3/5/10');
  assert.equal(tuning.stamina.lives, 3);
  tuning.exportNaming.version = '10hp';
  syncExportVariantTuning(tuning, 'initialize');
  assert.equal(tuning.stamina.lives, 10, 'loaded names and preview must agree');
});
