#!/usr/bin/env node
// Builds the Christmas "central rescue" playable level from the editor's
// Christmas board (level26 / remote level62, 70 cars around an empty centre).
//
// What changes against the source board:
//   1. The centre vehicle becomes the Christmas sled. The sled is authored at
//      the 10-seat footprint (scene-view builds its template with seat 10), so
//      a 6-seat sled would render bus-sized over a van-sized collision box. Its
//      authored yaw is kept: the centre rescue car sits diagonally on the board,
//      it is not an axis-aligned van.
//   2. Every other vehicle is repainted with one of two palettes:
//        gradient - Q7V3's five-colour diagonal gradient (Q24).
//        redgreen - a two-colour red/green split, red on the left half and green
//                   on the right (Q159's 红绿双色 brief).
//      Vehicles keep their authored positions and yaw.
//   3. Passenger queues are rebuilt along the engine's clear order, because the
//      source queue was ordered for a colour set that no longer exists. Rank
//      order keeps a released car's colour on the belt instead of dealing the
//      new palette evenly and stalling the run on mismatches.
//
// Usage:
//   node scripts/create-christmas-sled-level.mjs [--source level26]
//     [--key level2601] [--out artifacts/web-levels/level2601.json] [--dry-run]
//     [--palette gradient|redgreen] [--display-name "Q159V1-圣诞中心雪橇"]

import { existsSync, mkdirSync, readFileSync, writeFileSync, copyFileSync } from 'node:fs';
import path from 'node:path';
import { LEVEL_CATALOG } from '../src/level-catalog.js';
import { BusLoopGame } from '../src/game-model.js';
import { setActiveLevel } from '../src/level-data.js';
import {
  createLevelDocument,
  levelDocumentToRuntime,
  validateLevelDocument
} from '../src/level-editor-model.js';

const ROOT = path.resolve(import.meta.dirname, '..');

// Five-colour gradient with Q7V3's own paint slots and body tints, so the field
// reads exactly like the colour reference: dark red, red, cream through the
// middle, green, forest green. Q7V3 reaches dark red / red / forest green by
// tinting its atlas bodies (the plain atlas slots at those indices are pink and
// brown), and its passengers use the same tints.
const GRADIENT_PALETTE = Object.freeze([
  Object.freeze({ colorIndex: 4, body: '#8f1d2c', name: 'dark red' }),
  Object.freeze({ colorIndex: 2, body: '#c9363e', name: 'red' }),
  Object.freeze({ colorIndex: 21, body: null, name: 'cream' }),
  Object.freeze({ colorIndex: 1, body: '#218c4a', name: 'green' }),
  Object.freeze({ colorIndex: 8, body: '#124832', name: 'forest green' })
]);

const GRADIENT_PASSENGER_TINTS = Object.freeze({
  1: { body: '#218c4a' },
  2: { body: '#c9363e' },
  4: { body: '#8f1d2c' },
  8: { body: '#124832' },
  21: { body: '#fff9ef' }
});

// Q159's brief is 红绿双色: red on the left half of the board, green on the
// right. The tinted slots are the same ones the five-colour gradient uses, so
// the delivered atlases and passenger tints stay identical between the two
// Christmas variants.
const RED_GREEN_PALETTE = Object.freeze([
  Object.freeze({ colorIndex: 2, body: '#c9363e', name: 'red' }),
  Object.freeze({ colorIndex: 1, body: '#218c4a', name: 'green' })
]);

const PALETTES = Object.freeze({
  gradient: Object.freeze({ colors: GRADIENT_PALETTE, split: 'diagonal' }),
  redgreen: Object.freeze({ colors: RED_GREEN_PALETTE, split: 'x' })
});

const RESCUE_COLOR_INDEX = 16; // Christmas sled, a runtime vehicle type
const RESCUE_SEATS = 10;
// The sled is authored at the 10-seat footprint, which is 0.19 longer than the
// 6-seat van the source centre car uses. Left at the exact centre it closes a
// ten-car blocker cycle with three cars to its lower left, so it is nudged 3% of
// a car length toward the lower side -- invisible on screen, and the peel then
// clears all 70 cars.
const RESCUE_NUDGE_Z = -0.03;

function readArgs(argv) {
  const args = {
    source: 'level26',
    key: 'level2601',
    palette: 'gradient',
    displayName: 'Q24V1-圣诞中心雪橇',
    keepSledBlocked: false,
    stepLimit: 0,
    requireRescuable: false,
    dryRun: false
  };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--dry-run') { args.dryRun = true; continue; }
    if (!token.startsWith('--')) continue;
    const key = token.slice(2).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
    const value = argv[index + 1];
    if (value == null || value.startsWith('--')) { args[key] = true; continue; }
    args[key] = value;
    index += 1;
  }
  args.out ??= `artifacts/web-levels/${args.key}.json`;
  return args;
}

// Diagonal gradient: dark red at the top-left corner, forest green at the
// bottom-right corner.
//
// Ranking is by (x - z) because +X is screen-right and +Z is screen-up, so a
// larger (x - z) is further along the top-left -> bottom-right diagonal. The
// trailing terms only break ties between cars that sit on the same diagonal:
// without them the sort would depend on document order and neighbouring cars
// could land in different colour bands along one diagonal.
//
// The red/green variant ranks by screen X instead: the reference board splits
// left/right, not corner to corner. Both palettes assign bands evenly across
// the ranked ring cars, so a two-colour palette is a 34/35 split.
function paletteForField(vehicles, paletteConfig = PALETTES.gradient) {
  const { colors, split } = paletteConfig;
  const ranked = [...vehicles].sort((first, second) => (
    split === 'x'
      ? first.x - second.x || first.z - second.z || first.id - second.id
      : (first.x - first.z) - (second.x - second.z)
        || first.z - second.z
        || first.id - second.id
  ));
  const lastIndex = Math.max(1, ranked.length - 1);
  return ranked.map((vehicle, index) => {
    const progress = index / lastIndex;
    const slot = Math.min(colors.length - 1, Math.floor(progress * colors.length));
    return { vehicle, palette: colors[slot] };
  });
}

function passengerTintsForPalette(paletteConfig) {
  const tints = {};
  for (const color of paletteConfig.colors) {
    tints[color.colorIndex] = {
      body: color.body ?? GRADIENT_PASSENGER_TINTS[color.colorIndex]?.body
    };
  }
  return tints;
}

// The queue is what makes a dense five-colour field actually playable, and it
// has to be derived from the same rule the engine uses.
//
// A gradient puts each colour in its own region of the board, so the cars a
// player can release at any moment share only a few colours. Emitting the queue
// strictly in peel order interleaves them seat by seat: this level produced 45
// colour runs per belt against Q7V3's 20-30, and a colour-matching solver lost
// with six bays full of cars waiting for a colour that was behind several other
// colours on the belt.
//
// So the peel runs wave by wave -- a wave is every car that is free at that
// moment -- and each wave is emitted colour group by colour group. The player
// who follows that order never parks a car whose colour is not at a belt head,
// and same-colour dispatch runs give the belt the chunky colour blocks the
// reference levels show. Waves alternate between the two belts so both heads
// stay useful.
function buildPlayOrder(runtimeLevel, parkingRowSize = 6) {
  setActiveLevel(runtimeLevel);
  const game = new BusLoopGame(runtimeLevel);
  const parked = game.vehicles.filter((vehicle) => vehicle.state === 'parked');
  const byId = new Map(parked.map((vehicle) => [vehicle.id, vehicle]));
  const blockers = new Map();
  for (const vehicle of parked) {
    blockers.set(vehicle.id, game.getBlockers(vehicle.id).filter((entry) => typeof entry === 'number'));
  }
  const alive = new Set(parked.map((vehicle) => vehicle.id));
  const waves = [];
  let progressed = true;
  while (progressed && alive.size) {
    progressed = false;
    const wave = [];
    for (const id of [...alive]) {
      if (blockers.get(id).some((other) => alive.has(other))) continue;
      wave.push(id);
      progressed = true;
    }
    if (!wave.length) break;
    // Group the wave by colour so consecutive taps share a belt head. Larger
    // groups first: the player clears the colour with the most open cars.
    const groups = new Map();
    for (const id of wave) {
      const color = byId.get(id).colorIndex;
      if (!groups.has(color)) groups.set(color, []);
      groups.get(color).push(id);
    }
    const ordered = [...groups.entries()]
      .sort((first, second) => second[1].length - first[1].length || first[0] - second[0])
      .flatMap(([, ids]) => ids);
    for (const id of ordered) alive.delete(id);
    waves.push(ordered);
  }
  return { waves, stuck: [...alive], byId, parkingRowSize };
}

function rebuildQueues(document, playOrder, { leadColorIndex = null, leadSeats = 0 } = {}) {
  const queues = [[], []];
  // The first passengers on the belt are the sled's own riders.
  //
  // Requirement: the opening queue has to show Santa. Santa passengers are
  // colour index 16 — the same slot the sled's vehicle type uses, which is what
  // makes them ride the sled — and the wave order would otherwise put them
  // 60-odd cars in. Because the sled is also the guide target and can be tapped
  // on the first frame, leading with them turns the opening into "Santa is
  // waiting, tap the sled" instead of a mismatch the player has to wait out.
  if (leadColorIndex !== null && leadSeats > 0) {
    for (let seat = 0; seat < leadSeats; seat += 1) queues[0].push(leadColorIndex);
  }
  for (const wave of playOrder.waves) {
    // Alternate waves between the belts so both heads stay useful, but send each
    // wave to whichever belt is currently shorter: waves differ by a whole
    // colour group, and a strict alternation left one belt 50% longer than the
    // other, which wastes the range the two entrances are meant to spread.
    const target = queues[0].length <= queues[1].length ? 0 : 1;
    for (const id of wave) {
      const vehicle = playOrder.byId.get(id);
      if (!vehicle) continue;
      // The sled's own seats are already at the head of queue 0.
      if (vehicle.colorIndex === leadColorIndex && leadSeats > 0) continue;
      for (let seat = 0; seat < vehicle.seats; seat += 1) queues[target].push(vehicle.colorIndex);
    }
  }
  document.passengerQueues = queues;
  return queues;
}

function countColorRuns(queue) {
  let runs = 0;
  let previous = null;
  for (const color of queue) {
    if (color !== previous) runs += 1;
    previous = color;
  }
  return runs;
}

// How many cars have to leave before the rescue vehicle can drive out. Every
// car in the transitive blocker closure must go, and nothing outside it does,
// so this is the minimum number of dispatches a focused player needs. It is
// the number a step limit has to clear for the board to be rescuable at all.
function countCarsToClear(game, rescueId) {
  const closure = new Set();
  const stack = game.getBlockers(rescueId).filter((entry) => typeof entry === 'number');
  while (stack.length) {
    const id = stack.pop();
    if (closure.has(id)) continue;
    closure.add(id);
    for (const blocker of game.getBlockers(id).filter((entry) => typeof entry === 'number')) {
      if (!closure.has(blocker)) stack.push(blocker);
    }
  }
  return closure.size;
}

// The ids the engine reports as blocking one vehicle, computed on an otherwise
// empty queue so the answer depends only on geometry.
function getCollisionContextBlockers(document, vehicle) {
  const runtime = levelDocumentToRuntime({ ...document, passengerQueues: [[], []] }, LEVEL_CATALOG.level5);
  setActiveLevel(runtime);
  const game = new BusLoopGame(runtime);
  return game.getBlockers(vehicle.id).filter((entry) => typeof entry === 'number');
}

function main() {
  const args = readArgs(process.argv.slice(2));
  const source = LEVEL_CATALOG[args.source];
  if (!source) throw new Error(`Unknown source level: ${args.source}`);

  const document = createLevelDocument({
    ...source,
    key: args.key,
    displayName: args.displayName
  });

  const rescue = document.vehicles.find((vehicle) => vehicle.mechanism.type === 'ambulance')
    ?? document.vehicles.reduce((best, vehicle) => (
      Math.hypot(vehicle.x, vehicle.z) < Math.hypot(best.x, best.z) ? vehicle : best
    ));
  if (!rescue) throw new Error('Source level has no vehicle to turn into the sled.');

  // The sled's authored texture replaces the paint atlas, so it carries no
  // body override; colour index 16 is a vehicle type, not a paint slot.
  rescue.seats = RESCUE_SEATS;
  rescue.colorIndex = RESCUE_COLOR_INDEX;
  rescue.colorOverrides = {};
  rescue.isLuxury = false;
  rescue.z = Number((rescue.z + RESCUE_NUDGE_Z).toFixed(5));
  rescue.mechanism = { ...rescue.mechanism, type: 'christmas' };
  const stepLimit = Math.max(0, Math.round(Number(args.stepLimit) || 0));
  if (stepLimit > 0) {
    // Centre-rescue countdown: every other car the player dispatches burns one
    // of the sled's moves. The runtime reads `ambulanceStepLimit` (it is the
    // step-limit field, not a model family) and renders the heart badge on this
    // vehicle because of it.
    rescue.mechanism.stepLimited = true;
    rescue.mechanism.stepLimit = stepLimit;
    rescue.mechanism.type = 'christmas';
  } else {
    rescue.mechanism.stepLimited = false;
  }

  if (args.keepSledBlocked) {
    // Central rescue: the sled stays where the source board put it. Its -45°
    // yaw is part of the reference composition and, more importantly, the six
    // cars around it are what the player has to peel away before the sled can
    // drive out. Opening the lane or squaring the sled up would erase the
    // mechanic.
    console.log(`  sled kept diagonal at yaw ${rescue.yaw.toFixed(1)} with its ring intact`);
  } else {
    // Face the parking row. The source board's centre car faces -45°, which
    // points into the ring wall; the sled has to be the car the opening guide
    // highlights, and a guide that points at a car which cannot leave is worse
    // than no guide.
    rescue.yaw = 0;

    // Open the lane the sled needs.
    //
    // The Christmas board is a closed ring of cars with the rescue vehicle in the
    // middle, so the centre car can never drive out until part of the ring is
    // gone — that is how the source level worked too (its ambulance was blocked
    // behind six cars). Since the opening guide now spotlights the sled, it has to
    // be tappable on the first frame, which means the ring gets one gap.
    //
    // The cars removed are exactly the ones the collision graph reports as
    // blocking the sled while it faces the parking row: the top-centre arc closest
    // to it, so the gap reads as the sled's own exit rather than a missing chunk
    // of the border. They cannot be shifted aside instead — every neighbour is
    // 0.27 wide on a 0.28 pitch, so there is nowhere to put them.
    const laneBlockers = getCollisionContextBlockers(document, rescue);
    document.vehicles = document.vehicles.filter((vehicle) => !laneBlockers.includes(vehicle.id));
    if (!document.vehicles.length) throw new Error('Opening the sled lane removed every vehicle.');
  }

  const paletteConfig = PALETTES[args.palette];
  if (!paletteConfig) throw new Error(`Unknown palette: ${args.palette} (expected ${Object.keys(PALETTES).join(' or ')})`);
  const ring = document.vehicles.filter((vehicle) => vehicle !== rescue);
  const assignments = paletteForField(ring, paletteConfig);
  for (const { vehicle, palette } of assignments) {
    vehicle.colorIndex = palette.colorIndex;
    vehicle.colorOverrides = palette.body ? { body: palette.body } : {};
  }

  document.passengerColorOverrides = passengerTintsForPalette(paletteConfig);

  // The queue has to be rebuilt before the runtime exists, and the runtime has
  // to exist to know the peel order, so seed both queues empty first and let the
  // rebuild write the real content.
  document.passengerQueues = [[], []];
  const seededRuntime = levelDocumentToRuntime(document, LEVEL_CATALOG.level5);
  const playOrder = buildPlayOrder(seededRuntime);
  if (playOrder.stuck.length) {
    throw new Error(`Source field has ${playOrder.stuck.length} cars in blocker cycles: ${playOrder.stuck.slice(0, 10).join(', ')}`);
  }
  // Leading the belt with the sled's own riders is the requirement for both
  // layouts: the opening queue has to show Santa. With the ring intact the sled
  // is the rescue target rather than the first tap, so those ten passengers wait
  // at the belt head until the way is clear — which is the centre-rescue fantasy
  // rather than a mismatch, as long as the belt keeps enough room for the colours
  // the player can actually serve (capacity 32, ten held back).
  const queues = rebuildQueues(document, playOrder, {
    leadColorIndex: RESCUE_COLOR_INDEX,
    leadSeats: rescue.seats
  });

  const errors = validateLevelDocument(document);
  if (errors.length) throw new Error(`Level validation failed:\n${errors.join('\n')}`);

  const runtime = levelDocumentToRuntime(document, LEVEL_CATALOG.level5);
  const seatTotals = new Map();
  for (const vehicle of document.vehicles) {
    seatTotals.set(vehicle.colorIndex, (seatTotals.get(vehicle.colorIndex) ?? 0) + vehicle.seats);
  }
  const clearedCars = playOrder.waves.reduce((sum, wave) => sum + wave.length, 0);
  console.log(`level ${args.key}: ${document.vehicles.length} vehicles, ${document.vehicles.reduce((sum, vehicle) => sum + vehicle.seats, 0)} seats`);
  console.log(`  sled: id ${rescue.id} seats ${rescue.seats} at (${rescue.x.toFixed(3)}, ${rescue.z.toFixed(3)}) yaw ${rescue.yaw.toFixed(1)}`);
  console.log(`  palette: ${[...seatTotals.entries()].sort((a, b) => a[0] - b[0]).map(([color, seats]) => `${color}:${seats}`).join('  ')}`);
  console.log(`  queues: ${queues.map((queue) => queue.length).join(' / ')}  clearable ${clearedCars}/${document.vehicles.length}  runs ${queues.map(countColorRuns).join(' / ')}`);

  setActiveLevel(runtime);
  const startGame = new BusLoopGame(runtime);
  const sledBlockers = startGame.getBlockers(rescue.id).filter((entry) => typeof entry === 'number');
  console.log(`  sled blockers at start: ${sledBlockers.length ? sledBlockers.join(', ') : 'none (tappable)'}`);
  const carsToClear = countCarsToClear(startGame, rescue.id);
  console.log(`  sled reachable after clearing ${carsToClear} cars`);
  if (stepLimit > 0) {
    // The step limit is the ad's ending beat, but it must not make the board
    // mathematically impossible: the heart budget has to clear the blocker
    // closure, otherwise no player can ever rescue the sled.
    if (carsToClear > stepLimit) {
      throw new Error(
        `The sled needs ${carsToClear} cars cleared before it is tappable, but the step limit is ${stepLimit};`
        + ' the board cannot be rescued inside its own move budget.'
      );
    }
    console.log(`  step limit ${stepLimit}: ${stepLimit - carsToClear} moves of slack after the sled is reachable`);
    if (args.requireRescuable && carsToClear > stepLimit) {
      throw new Error(
        `The sled needs ${carsToClear} cars cleared but the budget is ${stepLimit} (--require-rescuable).`
      );
    }
  }
  if (args.requireTappableSled && sledBlockers.length) {
    throw new Error(`The centre sled must be tappable at start (--require-tappable-sled); blocked by ${sledBlockers.join(', ')}`);
  }

  if (args.dryRun) {
    console.log('dry run: nothing written');
    return;
  }

  const outputPath = path.resolve(ROOT, args.out);
  mkdirSync(path.dirname(outputPath), { recursive: true });
  if (existsSync(outputPath)) {
    const backupRoot = path.join(ROOT, 'artifacts', 'web-level-backups');
    mkdirSync(backupRoot, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    copyFileSync(outputPath, path.join(backupRoot, `${path.basename(outputPath, '.json')}-${stamp}.json`));
  }
  writeFileSync(outputPath, `${JSON.stringify(document, null, 2)}\n`, 'utf8');
  console.log(`wrote ${path.relative(ROOT, outputPath)}`);
  void readFileSync;
}

main();
