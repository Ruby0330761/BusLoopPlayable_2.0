import test from 'node:test';
import assert from 'node:assert/strict';
import { expandExportVariantTunings, getExportVariantPlan, isInstallGateEnabled, parseExportVariantValues, syncExportVariantTuning } from '../src/export-variants.js';
import { SCENE_TUNING } from '../src/scene-tuning.js';
import { buildPlayableArtifactName, createEditorExportSession, validateTuning } from '../scripts/export-playable-package.mjs';
import { resolvePlayableSession } from '../src/playable-session-config.js';
import { createLevelSession } from '../src/level-session.js';

function fixture() {
  const tuning = structuredClone(SCENE_TUNING);
  tuning.stamina.enabled = 1;
  tuning.installGate.enabled = 1;
  tuning.installGate.successfulOperationThreshold = 56;
  tuning.installGate.customThresholdEnabled = 1;
  tuning.exportNaming.version = '3/5/10';
  tuning.exportNaming.steps = '10/20moves';
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

test('every steps label combines with every stamina version and sets its own store gate', () => {
  const tuning = fixture();
  const original = structuredClone(tuning);
  const variants = expandExportVariantTunings(tuning);
  assert.equal(getExportVariantPlan(tuning).count, 6);
  assert.equal(variants.length, 6);
  for (const [index, variant] of variants.entries()) {
    validateTuning(variant, SCENE_TUNING);
    const step = index < 3 ? 10 : 20;
    const hp = variant.stamina.lives;
    assert.equal(hp, [3, 5, 10][index % 3]);
    assert.equal(variant.installGate.successfulOperationThreshold, step);
    assert.equal(variant.installGate.customThresholdEnabled, 1, 'the threshold survives stripped naming metadata');
    const stepName = step === 10 ? '10' : '20moves';
    assert.match(buildPlayableArtifactName(variant, 'meta'), new RegExp(`-FB-${stepName}-${hp}hp\\.zip$`));
    assert.match(buildPlayableArtifactName(variant, 'mintegral'), new RegExp(`_MT_${stepName}_${hp}hp\\.zip$`));
  }
  variants[0].stamina.lives = 9;
  assert.equal(variants[1].stamina.lives, 5);
  assert.deepEqual(tuning, original);
});

test('N disables the exported store gate and blank or invalid step labels are rejected', () => {
  const tuning = fixture();
  tuning.stamina.enabled = 0;
  assert.equal(SCENE_TUNING.exportNaming.steps, 'N');
  for (const steps of ['', '  ', 'bad']) {
    tuning.exportNaming.steps = steps;
    assert.throws(() => getExportVariantPlan(tuning), /步数/);
  }
  tuning.installGate.enabled = 0;
  syncExportVariantTuning(tuning, 'installGate.enabled');
  const [variant] = expandExportVariantTunings(tuning);
  assert.equal(variant.exportNaming.version, 'N');
  assert.equal(variant.exportNaming.steps, 'N');
  assert.equal(variant.stamina.enabled, 0);
  assert.equal(variant.installGate.enabled, 0);
  assert.equal(isInstallGateEnabled({ successfulOperationThreshold: 5 }), true, 'old configurations retain their gate');
});

test('stamina and steps preview the first value and follow guide edits', () => {
  const tuning = fixture();
  tuning.exportNaming.steps = '10moves/20';
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
  assert.equal(tuning.exportNaming.steps, '15moves');
});

test('35 and 35moves remain separate names and both reach the store gate on operation 35', () => {
  const tuning = structuredClone(SCENE_TUNING);
  assert.equal(tuning.installGate.enabled, 0);
  tuning.exportNaming.steps = '35 / 35moves / 35MOVES';
  const variants = expandExportVariantTunings(tuning);
  assert.deepEqual(variants.map(variant => variant.exportNaming.steps), ['35', '35moves']);
  for (const variant of variants) {
    const { successfulOperationThreshold: threshold, enabled, customThresholdEnabled } = variant.installGate;
    assert.deepEqual([threshold, enabled, customThresholdEnabled], [35, 1, 1]);
    assert.ok(buildPlayableArtifactName(variant, 'applovin').endsWith(`-AL-${variant.exportNaming.steps}-N.html`));
    const session = createLevelSession([{ key: 'level33' }]);
    for (let step = 1; step <= 35; step += 1) {
      assert.equal(session.recordSuccessfulVehicle(step, threshold), step === 35);
    }
  }
});

test('editing a step name enables the gate, preserves invalid drafts and accepts N to turn it off', () => {
  const tuning = structuredClone(SCENE_TUNING);
  for (const steps of ['35', '35moves', '35moves/', '']) {
    tuning.exportNaming.steps = steps;
    syncExportVariantTuning(tuning, 'exportNaming.steps');
    assert.equal(tuning.exportNaming.steps, steps);
    assert.equal(tuning.installGate.enabled, 1);
    assert.equal(tuning.installGate.successfulOperationThreshold, 35);
    if (!steps || steps.endsWith('/')) assert.throws(() => getExportVariantPlan(tuning));
  }
  tuning.exportNaming.steps = 'N';
  syncExportVariantTuning(tuning, 'exportNaming.steps');
  assert.equal(tuning.installGate.enabled, 0);
  assert.equal(tuning.installGate.customThresholdEnabled, 0);
  syncExportVariantTuning(tuning, 'initialize');
  assert.equal(tuning.exportNaming.steps, 'N');
  assert.equal(expandExportVariantTunings(tuning)[0].installGate.enabled, 0);
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

test('initializing a legacy enabled gate uses its threshold when no numeric step name exists', () => {
  const tuning = fixture();
  tuning.exportNaming.steps = 'N';
  delete tuning.installGate.enabled;
  syncExportVariantTuning(tuning, 'initialize');
  assert.equal(tuning.exportNaming.steps, '56');
  assert.equal(tuning.installGate.successfulOperationThreshold, 56);
  assert.equal(tuning.exportNaming.version, '3/5/10');
  assert.equal(tuning.stamina.lives, 3);
  tuning.exportNaming.version = '10hp';
  syncExportVariantTuning(tuning, 'initialize');
  assert.equal(tuning.stamina.lives, 10, 'loaded names and preview must agree');
  tuning.installGate.customThresholdEnabled = 0;
  tuning.exportNaming.steps = '12';
  syncExportVariantTuning(tuning, 'initialize');
  assert.equal(tuning.installGate.customThresholdEnabled, 1);
  assert.equal(tuning.installGate.successfulOperationThreshold, 12);
});
