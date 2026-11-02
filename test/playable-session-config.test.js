import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { BusLoopGame } from '../src/game-model.js';
import { LEVEL_CATALOG } from '../src/level-catalog.js';
import { levelDocumentToRuntime } from '../src/level-editor-model.js';
import {
  PLAYABLE_SESSION_FORMAT,
  mergeStageTuning,
  normalizeSessionStages,
  normalizeStageChoice,
  normalizeStageLabels,
  normalizeStageOpening,
  resolvePlayableSession
} from '../src/playable-session-config.js';

function loadRuntimeLevel(levelKey) {
  const document = JSON.parse(readFileSync(
    new URL(`../artifacts/web-levels/${levelKey}.json`, import.meta.url),
    'utf8'
  ));
  return { ...levelDocumentToRuntime(document, LEVEL_CATALOG.level5), sourceFile: levelKey };
}

test('stage opening normalizes toggles, numbers, and banner style', () => {
  const opening = normalizeStageOpening({
    firstClickGuide: { enabled: true, vehicleId: '140', durationSeconds: '3' },
    entryBanner: { enabled: 1, style: 'SUPERHARD', durationSeconds: 2.2 }
  });
  assert.equal(opening.firstClickGuide.enabled, 1);
  assert.equal(opening.firstClickGuide.vehicleId, 140);
  assert.equal(opening.firstClickGuide.durationSeconds, 3);
  assert.equal(opening.entryBanner.enabled, 1);
  assert.equal(opening.entryBanner.style, 'superhard');
});

test('stage opening rejects unsupported keys and banner styles', () => {
  assert.throws(() => normalizeStageOpening({ firstClickGuide: { levelKey: 'level7' } }), /not supported/);
  assert.throws(() => normalizeStageOpening({ entryBanner: { style: 'expert' } }), /hard or superhard/);
  assert.throws(() => normalizeStageOpening({ entryBanner: { opacity: 1 } }), /not supported/);
});

test('stage labels are clamped to a small bounded list with numeric positions', () => {
  const labels = normalizeStageLabels([
    { text: 'level 1', x: 0.06, y: 0.04, align: 'left' },
    { text: 'level 99' }
  ]);
  assert.deepEqual(labels[0], { text: 'level 1', x: 0.06, y: 0.04, align: 'left' });
  assert.deepEqual(labels[1], { text: 'level 99', x: 0.5, y: 0.1, align: 'center' });
  assert.throws(() => normalizeStageLabels([{ text: '' }]), /text is required/);
  assert.throws(() => normalizeStageLabels(Array.from({ length: 5 }, () => ({ text: 'x' }))), /at most 4/);
});

test('stage ids must be unique and level keys must look like levelN', () => {
  assert.throws(
    () => normalizeSessionStages([{ id: 'a', levelKey: 'level1' }, { id: 'a', levelKey: 'level2' }]),
    /duplicated/
  );
  assert.throws(() => normalizeSessionStages([{ id: 'a', levelKey: 'sunfish' }]), /must look like level12/);
  assert.throws(() => normalizeSessionStages([]), /non-empty/);
});

test('session resolution honours the requested key and returns null without one', () => {
  const config = {
    format: PLAYABLE_SESSION_FORMAT,
    active: 'special',
    sessions: {
      special: { stages: [{ id: 'first', levelKey: 'level27' }, { id: 'second', levelKey: 'level12' }] },
      rect: { stages: [{ id: 'rect-first', levelKey: 'level2' }] }
    }
  };
  assert.deepEqual(
    resolvePlayableSession(config, 'rect').stages.map((stage) => stage.levelKey),
    ['level2']
  );
  assert.equal(resolvePlayableSession(config, null).key, 'special');
  assert.equal(resolvePlayableSession({ ...config, active: '' }, null), null);
  assert.throws(() => resolvePlayableSession(config, 'missing'), /Unknown playable session/);
  assert.throws(() => resolvePlayableSession({ ...config, format: 'other' }, 'special'), /Unsupported/);
});

test('stage overrides merge over global tuning without mutating it', () => {
  const base = { enabled: 0, vehicleId: 1, maskOpacity: 0.68 };
  const merged = mergeStageTuning(base, { enabled: 1, vehicleId: 140 });
  assert.deepEqual(merged, { enabled: 1, vehicleId: 140, maskOpacity: 0.68 });
  assert.deepEqual(base, { enabled: 0, vehicleId: 1, maskOpacity: 0.68 });
  assert.equal(mergeStageTuning(base, null), base);
});

test('the checked-in playable session config is valid and keeps Q22 stage pairs', () => {
  const config = JSON.parse(readFileSync(new URL('../artifacts/playable-session.json', import.meta.url), 'utf8'));
  assert.equal(config.format, PLAYABLE_SESSION_FORMAT);
  const special = resolvePlayableSession(config, 'q22-special');
  const rect = resolvePlayableSession(config, 'q22-rect');
  assert.deepEqual(special.stages.map((stage) => stage.levelKey), ['level27', 'level12']);
  // level9804 is the in-game lv2 (unityId 9804, 12 vehicles) that shipped as its
  // own playable; level2 in this repo is Q7V1改 (unityId 52, 84 vehicles) and is
  // a different board, so the rectangle version must not point at it.
  assert.deepEqual(rect.stages.map((stage) => stage.levelKey), ['level9804', 'level30']);
  // The sheet numbers the rectangle pair (lv2 + lv154) as version 1 and the
  // special pair (BL-2610142 + lv12) as version 2. The sessions used to carry
  // the opposite material codes, so the delivered files were swapped.
  const materialCode = (key) => config.sessions[key].exportNaming.materialCode;
  assert.equal(materialCode('q22-rect'), 'Q22V1');
  assert.equal(materialCode('q22-special'), 'Q22V2');
  // The first stage greys the board; the second stage shows the super hard banner.
  for (const session of [special, rect]) {
    assert.equal(session.stages[0].opening.firstClickGuide?.enabled, 1);
    assert.equal(session.stages[0].opening.entryBanner?.enabled, 0);
    assert.equal(session.stages[1].opening.firstClickGuide?.enabled, 0);
    assert.equal(session.stages[1].opening.entryBanner?.style, 'superhard');
    // Title-case to match the delivered badge art (the sheet spells them
    // lowercase, but the reference playables render "Level N").
    assert.deepEqual(session.stages.map((stage) => stage.labels[0]?.text), ['Level 1', 'Level 99']);
    // Both badges sit top centre, clear of the speed switch in the top-right.
    for (const stage of session.stages) {
      assert.equal(stage.labels[0]?.align, 'center');
      assert.equal(stage.labels[0]?.x, 0.5);
    }
  }
});

test('the Q23 session runs the simple stage and then offers four maps', () => {
  const config = JSON.parse(readFileSync(new URL('../artifacts/playable-session.json', import.meta.url), 'utf8'));
  const session = resolvePlayableSession(config, 'q23-choice');
  assert.equal(session.preRollEnabled, false);
  assert.deepEqual(session.stages.map((stage) => stage.levelKey), ['level27']);
  const choice = session.stages[0].choice;
  assert.ok(choice, 'the simple stage must end in a map picker');

  // The set the brief names, in the editor's own naming: lv13 fish, lv7 rainbow,
  // lv5 matrix, lv154. level30 is the web copy labelled level154; level21 is a
  // catalog level with the same label and must not be substituted for it.
  // Reading order is row-major, so the matrix card sits bottom-left and the
  // rainbow card stays top-right under the pointing hand.
  assert.deepEqual(choice.options.map((option) => option.levelKey), [
    'level13', 'level7', 'level5', 'level30'
  ]);
  // The reference art points at the top-right card, not the first one.
  assert.equal(choice.handIndex, 1);
  assert.equal(choice.title, 'Please Choose a Stage');
  assert.deepEqual(choice.options.map((option) => option.label), [
    'Lv13 Fish', 'Lv7 Rainbow', 'Lv5 Matrix', 'Lv154'
  ]);

  // The four picked maps all run on a four-bay road; the simple opening stage
  // keeps its own six-bay layout.
  for (const option of choice.options) {
    assert.equal(option.scene.parkingSpots?.count, 4, `${option.levelKey} must use four parking spots`);
  }
  assert.equal(session.stages[0].scene.parkingSpots?.count, 6);

  // Each card needs its own preview art, and those files must exist because the
  // packager inlines them into the single-HTML build.
  for (const option of choice.options) {
    assert.match(option.image, /^\/assets\/applovin\/stage-choice\/level\d+\.webp$/u);
    assert.ok(
      existsSync(new URL(`../public${option.image}`, import.meta.url)),
      `missing stage-choice preview art: ${option.image}`
    );
  }
  assert.equal(new Set(choice.options.map((option) => option.image)).size, 4);
});

test('a picker is only allowed on the last stage of a session', () => {
  const config = JSON.parse(readFileSync(new URL('../artifacts/playable-session.json', import.meta.url), 'utf8'));
  const option = config.sessions['q23-choice'].stages[0].choice;
  const badStages = [
    { id: 'first', levelKey: 'level27', choice: option },
    { id: 'second', levelKey: 'level12' }
  ];
  assert.throws(
    () => resolvePlayableSession({ ...config, active: 'bad', sessions: { bad: { stages: badStages } } }, 'bad'),
    /only supported on the last stage/u
  );
});

test('stage choice rejects duplicate maps, bad image paths, and a detached hand', () => {
  const base = {
    title: 'Please Choose a Stage',
    handIndex: 0,
    options: [
      { id: 'a', levelKey: 'level13', label: 'A', image: '/assets/applovin/stage-choice/level13.webp' },
      { id: 'b', levelKey: 'level5', label: 'B', image: '/assets/applovin/stage-choice/level5.webp' }
    ]
  };
  assert.equal(normalizeStageChoice(base).options.length, 2);
  assert.equal(normalizeStageChoice({ ...base, handIndex: -1 }).handIndex, -1);

  assert.throws(() => normalizeStageChoice({ ...base, title: '' }), /title is required/u);
  assert.throws(
    () => normalizeStageChoice({ ...base, options: [base.options[0], { ...base.options[1], levelKey: 'level13' }] }),
    /levelKey is used twice/u
  );
  assert.throws(
    () => normalizeStageChoice({ ...base, options: [base.options[0], { ...base.options[1], id: 'a' }] }),
    /id is duplicated/u
  );
  assert.throws(
    () => normalizeStageChoice({ ...base, options: [{ ...base.options[0], image: 'https://cdn.example.com/a.png' }] }),
    /must be a project asset path/u
  );
  assert.throws(
    () => normalizeStageChoice({ ...base, options: [base.options[0], { ...base.options[1], image: '/assets/../secret.png' }] }),
    /must be a project asset path/u
  );
  assert.throws(() => normalizeStageChoice({ ...base, handIndex: 2 }), /past the last option/u);
  assert.throws(
    () => normalizeStageChoice({ ...base, options: Array.from({ length: 7 }, (_u, i) => ({
      ...base.options[0], id: `o${i}`, levelKey: `level${20 + i}`
    })) }),
    /at most 6/u
  );
});

test('the stage badge reads as HUD text, not as part of the dimmed board', async () => {
  const styles = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');
  const label = styles.slice(styles.indexOf('.stage-label {'), styles.indexOf('.stage-label.is-left'));
  // The badge is plain white type: no chip behind it.
  assert.match(label, /background:\s*none/u);
  assert.doesNotMatch(label, /border-radius/u);
  // A thin rim only. A wide 8-way shadow reads as a heavy black outline, which
  // is what the first attempt shipped. Only the eight hard rim layers count;
  // the trailing soft drop shadow carries a blur radius and is not an outline.
  const block = label.match(/text-shadow:([\s\S]*?);/u)?.[1] ?? '';
  const OFFSET = '(-?\\d*\\.?\\d+)em';
  const rim = [...block.matchAll(new RegExp(
    `(?:${OFFSET}|\\b0\\b)\\s+(?:${OFFSET}|\\b0\\b)\\s+0\\s+#`,
    'g'
  ))];
  assert.equal(rim.length, 8, 'expected the 8-way rim');
  const maxOffset = Math.max(...rim.flatMap((m) => [
    m[1] === undefined ? 0 : Math.abs(Number(m[1])),
    m[2] === undefined ? 0 : Math.abs(Number(m[2]))
  ]));
  assert.ok(maxOffset <= 0.05, `rim is too thick: ${maxOffset}em`);

  // The overlay must out-stack the opening dim mask so the badge stays white
  // while the board greys out, but stay under the entry banner and end panel.
  const overlayZ = Number(styles.match(/\.stage-label-overlay\s*\{[\s\S]*?z-index:\s*(\d+)/u)?.[1]);
  const maskZ = Number(styles.match(/\.first-click-guide-mask\s*\{[\s\S]*?z-index:\s*(\d+)/u)?.[1]);
  const bannerZ = Number(styles.match(/\.entry-banner-overlay\s*\{[\s\S]*?z-index:\s*(\d+)/u)?.[1]);
  assert.equal(overlayZ, maskZ, 'badge should level with the dim mask and win on DOM order');
  assert.ok(overlayZ < bannerZ, 'SUPER HARD must still cover the badge');
});

test('every Q22 opening guide points at a vehicle the player can actually move', () => {
  const config = JSON.parse(readFileSync(new URL('../artifacts/playable-session.json', import.meta.url), 'utf8'));
  for (const key of ['q22-special', 'q22-rect']) {
    const session = resolvePlayableSession(config, key);
    for (const stage of session.stages) {
      const guide = stage.opening.firstClickGuide;
      if (!guide?.enabled) continue;
      const level = loadRuntimeLevel(stage.levelKey);
      const game = new BusLoopGame(level);
      const vehicle = game.getVehicle(guide.vehicleId);
      assert.ok(vehicle, `${key}/${stage.id} guides vehicle ${guide.vehicleId}, which ${stage.levelKey} does not contain`);
      assert.deepEqual(
        game.getBlockers(guide.vehicleId),
        [],
        `${key}/${stage.id} guides vehicle ${guide.vehicleId}, which is blocked at stage start`
      );
      assert.equal(game.clickVehicle(guide.vehicleId).ok, true);
    }
  }
});
