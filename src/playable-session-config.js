// Direct-to-playable session configuration.
//
// A session is an ordered list of stages. Each stage is one complete level plus
// the presentation that level needs when it starts: the opening guide, the
// entry banner, and the HUD labels. Presentation is scoped to the stage so a
// later stage does not replay the first stage's guide.
//
// The editor does not own this file. It lives in artifacts/ and is read by
// scripts/generate-active-level.mjs, so a playable can be assembled by editing
// JSON instead of clicking through editor controls.

export const PLAYABLE_SESSION_FORMAT = 'bus-loop-playable-session-v1';

const FIRST_CLICK_GUIDE_KEYS = new Set([
  'enabled',
  'vehicleId',
  'durationSeconds',
  'lockInput',
  'maskEnabled',
  'maskOpacity',
  'holePadding',
  'holeRadius',
  'holeOffsetX',
  'holeOffsetY',
  'holeScaleX',
  'holeScaleY'
]);

const ENTRY_BANNER_KEYS = new Set([
  'enabled',
  'style',
  'durationSeconds',
  'maskEnabled',
  'maskOpacity',
  'scale',
  'positionX',
  'positionY'
]);

const LABEL_ALIGNMENTS = new Set(['left', 'center', 'right']);

const STAGE_CHOICE_KEYS = new Set(['title', 'handIndex', 'options']);
const CHOICE_OPTION_KEYS = new Set(['id', 'levelKey', 'label', 'image', 'scene', 'opening', 'labels']);
// The reference layout is a 2x2 grid; allowing a third row keeps a future
// six-map variant expressible without changing the schema again.
const MAX_CHOICE_OPTIONS = 6;

// Belt art and curve data live outside the level document, so a stitched
// session has to name the conveyor each stage needs. Without this a level that
// declares GameSceneDualQueue2 renders on whatever belt the global tuning
// happens to hold.
const CONVEYOR_LAYOUT_IDS = new Set([
  'dualQueue2',
  'dualQueue3',
  'dualQueue5',
  'dualQueue10',
  'starLoop',
  'heartLoop',
  'catLoop'
]);

function requireObject(value, location) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${location} must be an object.`);
  }
  return value;
}

function toFiniteNumber(value, location) {
  const number = Number(value);
  if (!Number.isFinite(number)) throw new TypeError(`${location} must be a finite number.`);
  return number;
}

function toToggle(value, location) {
  return Number(value) ? 1 : 0;
}

function normalizeKnownKeys(source, allowed, location) {
  for (const key of Object.keys(source)) {
    if (!allowed.has(key)) throw new TypeError(`${location}.${key} is not supported.`);
  }
}

export function normalizeStageOpening(opening = {}) {
  requireObject(opening, 'stage.opening');
  normalizeKnownKeys(opening, new Set(['firstClickGuide', 'entryBanner']), 'stage.opening');
  const normalized = {};

  if (opening.firstClickGuide !== undefined) {
    const guide = requireObject(opening.firstClickGuide, 'stage.opening.firstClickGuide');
    normalizeKnownKeys(guide, FIRST_CLICK_GUIDE_KEYS, 'stage.opening.firstClickGuide');
    const next = {};
    if (guide.enabled !== undefined) next.enabled = toToggle(guide.enabled, 'stage.opening.firstClickGuide.enabled');
    if (guide.maskEnabled !== undefined) next.maskEnabled = toToggle(guide.maskEnabled, 'stage.opening.firstClickGuide.maskEnabled');
    if (guide.lockInput !== undefined) next.lockInput = toToggle(guide.lockInput, 'stage.opening.firstClickGuide.lockInput');
    for (const key of [
      'vehicleId', 'durationSeconds', 'maskOpacity', 'holePadding', 'holeRadius',
      'holeOffsetX', 'holeOffsetY', 'holeScaleX', 'holeScaleY'
    ]) {
      if (guide[key] !== undefined) {
        next[key] = toFiniteNumber(guide[key], `stage.opening.firstClickGuide.${key}`);
      }
    }
    normalized.firstClickGuide = next;
  }

  if (opening.entryBanner !== undefined) {
    const banner = requireObject(opening.entryBanner, 'stage.opening.entryBanner');
    normalizeKnownKeys(banner, ENTRY_BANNER_KEYS, 'stage.opening.entryBanner');
    const next = {};
    if (banner.enabled !== undefined) next.enabled = toToggle(banner.enabled, 'stage.opening.entryBanner.enabled');
    if (banner.maskEnabled !== undefined) next.maskEnabled = toToggle(banner.maskEnabled, 'stage.opening.entryBanner.maskEnabled');
    if (banner.style !== undefined) {
      const style = String(banner.style).toLowerCase();
      if (style !== 'hard' && style !== 'superhard') {
        throw new TypeError('stage.opening.entryBanner.style must be hard or superhard.');
      }
      next.style = style;
    }
    for (const key of ['durationSeconds', 'maskOpacity', 'scale', 'positionX', 'positionY']) {
      if (banner[key] !== undefined) {
        next[key] = toFiniteNumber(banner[key], `stage.opening.entryBanner.${key}`);
      }
    }
    normalized.entryBanner = next;
  }

  return normalized;
}

export function normalizeStageLabels(labels = []) {
  if (!Array.isArray(labels)) throw new TypeError('stage.labels must be an array.');
  if (labels.length > 4) throw new TypeError('stage.labels supports at most 4 labels.');
  return labels.map((label, index) => {
    const location = `stage.labels[${index}]`;
    requireObject(label, location);
    normalizeKnownKeys(label, new Set(['text', 'x', 'y', 'align']), location);
    const text = String(label.text ?? '').trim();
    if (!text) throw new TypeError(`${location}.text is required.`);
    if (text.length > 40) throw new TypeError(`${location}.text is too long.`);
    const align = label.align === undefined ? 'center' : String(label.align).toLowerCase();
    if (!LABEL_ALIGNMENTS.has(align)) {
      throw new TypeError(`${location}.align must be left, center, or right.`);
    }
    return {
      text,
      x: toFiniteNumber(label.x ?? 0.5, `${location}.x`),
      y: toFiniteNumber(label.y ?? 0.1, `${location}.y`),
      align
    };
  });
}

export function normalizeStageScene(scene = {}) {
  requireObject(scene, 'stage.scene');
  normalizeKnownKeys(scene, new Set(['conveyorLayout', 'background', 'parkingSpots']), 'stage.scene');
  const normalized = {};
  if (scene.conveyorLayout !== undefined && scene.conveyorLayout !== null) {
    const conveyorLayout = String(scene.conveyorLayout).trim();
    const isSpatial = /^spatial:[A-Za-z0-9._-]{1,120}$/u.test(conveyorLayout);
    if (!isSpatial && !CONVEYOR_LAYOUT_IDS.has(conveyorLayout)) {
      throw new TypeError(`stage.scene.conveyorLayout is not a known layout: ${conveyorLayout}`);
    }
    normalized.conveyorLayout = conveyorLayout;
  }
  if (scene.background !== undefined && scene.background !== null) {
    const background = String(scene.background).trim();
    if (!/^\/assets\/[A-Za-z0-9][A-Za-z0-9._/-]{0,239}$/u.test(background) || background.includes('..')) {
      throw new TypeError('stage.scene.background must be a project asset path.');
    }
    normalized.background = background;
  }
  if (scene.parkingSpots !== undefined && scene.parkingSpots !== null) {
    const spots = requireObject(scene.parkingSpots, 'stage.scene.parkingSpots');
    normalizeKnownKeys(spots, new Set(['count']), 'stage.scene.parkingSpots');
    if (spots.count === undefined) {
      throw new TypeError('stage.scene.parkingSpots.count is required when parkingSpots is set.');
    }
    const count = toFiniteNumber(spots.count, 'stage.scene.parkingSpots.count');
    if (!Number.isInteger(count) || count < 1 || count > 10) {
      throw new TypeError('stage.scene.parkingSpots.count must be an integer from 1 to 10.');
    }
    normalized.parkingSpots = { count };
  }
  return normalized;
}

// A stage may end in a choice instead of a handoff. Its four preview maps are
// authored as data, not DOM: the runner only draws cards and reports the picked
// level key, so the same session document drives export, QA and the editor.
export function normalizeStageChoice(choice) {
  if (choice === undefined || choice === null) return null;
  requireObject(choice, 'stage.choice');
  normalizeKnownKeys(choice, STAGE_CHOICE_KEYS, 'stage.choice');

  const title = String(choice.title ?? 'Please Choose a Stage').trim();
  if (!title) throw new TypeError('stage.choice.title is required.');
  if (title.length > 60) throw new TypeError('stage.choice.title is too long.');

  const rawHandIndex = choice.handIndex === undefined ? 0 : choice.handIndex;
  const handIndex = rawHandIndex === null ? -1 : toFiniteNumber(rawHandIndex, 'stage.choice.handIndex');
  if (!Number.isInteger(handIndex) || handIndex < -1) {
    throw new TypeError('stage.choice.handIndex must be -1 (hidden) or a non-negative integer.');
  }

  if (!Array.isArray(choice.options) || choice.options.length === 0) {
    throw new TypeError('stage.choice.options must be a non-empty array.');
  }
  if (choice.options.length > MAX_CHOICE_OPTIONS) {
    throw new TypeError(`stage.choice.options supports at most ${MAX_CHOICE_OPTIONS} entries.`);
  }

  const seenIds = new Set();
  const seenLevels = new Set();
  const options = choice.options.map((option, index) => {
    const location = `stage.choice.options[${index}]`;
    requireObject(option, location);
    normalizeKnownKeys(option, CHOICE_OPTION_KEYS, location);

    const id = String(option.id ?? '').trim();
    if (!id) throw new TypeError(`${location}.id is required.`);
    if (seenIds.has(id)) throw new TypeError(`${location}.id is duplicated: ${id}`);
    seenIds.add(id);

    const levelKey = String(option.levelKey ?? '').trim();
    if (!/^level[1-9]\d*$/u.test(levelKey)) {
      throw new TypeError(`${location}.levelKey must look like level12.`);
    }
    if (seenLevels.has(levelKey)) {
      throw new TypeError(`${location}.levelKey is used twice: ${levelKey}`);
    }
    seenLevels.add(levelKey);

    const image = String(option.image ?? '').trim();
    if (!/^\/assets\/[A-Za-z0-9][A-Za-z0-9._/-]{0,239}$/u.test(image) || image.includes('..')) {
      throw new TypeError(`${location}.image must be a project asset path.`);
    }

    const label = String(option.label ?? '').trim();
    if (!label) throw new TypeError(`${location}.label is required.`);
    if (label.length > 40) throw new TypeError(`${location}.label is too long.`);

    return {
      id,
      levelKey,
      label,
      image,
      scene: normalizeStageScene(option.scene ?? {}),
      opening: normalizeStageOpening(option.opening ?? {}),
      labels: normalizeStageLabels(option.labels ?? [])
    };
  });

  if (handIndex >= options.length && handIndex !== -1) {
    throw new TypeError(`stage.choice.handIndex ${handIndex} points past the last option.`);
  }

  return { title, handIndex, options };
}

export function normalizeSessionExportNaming(naming) {  if (naming === undefined) return {};
  requireObject(naming, 'session.exportNaming');
  normalizeKnownKeys(naming, new Set(['materialCode', 'requirementCode', 'iterationCode', 'version']), 'session.exportNaming');
  const normalized = {};
  for (const [key, value] of Object.entries(naming)) {
    const part = String(value ?? '').trim();
    if (!/^[A-Za-z0-9]{1,16}$/u.test(part)) {
      throw new TypeError(`session.exportNaming.${key} must be 1-16 alphanumerics.`);
    }
    normalized[key] = part;
  }
  return normalized;
}

export function normalizeSessionStages(stages) {
  if (!Array.isArray(stages) || stages.length === 0) {
    throw new TypeError('session.stages must be a non-empty array.');
  }
  const seenIds = new Set();
  return stages.map((stage, index) => {
    const location = `session.stages[${index}]`;
    requireObject(stage, location);
    const id = String(stage.id ?? '').trim();
    if (!id) throw new TypeError(`${location}.id is required.`);
    if (seenIds.has(id)) throw new TypeError(`${location}.id is duplicated: ${id}`);
    seenIds.add(id);
    const levelKey = String(stage.levelKey ?? '').trim();
    if (!/^level[1-9]\d*$/u.test(levelKey)) {
      throw new TypeError(`${location}.levelKey must look like level12.`);
    }
    return {
      id,
      levelKey,
      scene: normalizeStageScene(stage.scene ?? {}),
      opening: normalizeStageOpening(stage.opening ?? {}),
      labels: normalizeStageLabels(stage.labels ?? []),
      choice: normalizeStageChoice(stage.choice)
    };
  });
}

export function resolvePlayableSession(config, requestedKey = null) {
  requireObject(config, 'playable session config');
  if (config.format !== PLAYABLE_SESSION_FORMAT) {
    throw new TypeError(`Unsupported playable session format: ${config.format}`);
  }
  const key = String(requestedKey ?? config.active ?? '').trim();
  // An empty active key keeps the legacy single-level selection path.
  if (!key) return null;
  const sessions = requireObject(config.sessions ?? {}, 'playable session config.sessions');
  const session = sessions[key];
  if (!session) throw new TypeError(`Unknown playable session: ${key}`);
  if (session.exportNaming !== undefined) {
    normalizeSessionExportNaming(session.exportNaming);
  }
  const stages = normalizeSessionStages(session.stages);
  // A choice ends a stage, so it can only belong to the last one; an earlier
  // choice would silently skip the stages authored after it.
  for (const [index, stage] of stages.entries()) {
    if (stage.choice && index !== stages.length - 1) {
      throw new TypeError(
        `session.stages[${index}].choice is only supported on the last stage of a session.`
      );
    }
  }
  return {
    key,
    stages,
    preRollEnabled: session.preRoll === undefined
      ? null
      : Boolean(Number(toToggle(session.preRoll, 'session.preRoll')))
  };
}

// Stage presentation overrides are merged over the global tuning at read time.
// They are never written back into SCENE_TUNING, so editor caching and local
// storage keep the authoring values intact.
export function mergeStageTuning(base, override) {
  if (!override) return base ?? {};
  return { ...(base ?? {}), ...override };
}
