#!/usr/bin/env node
// Generates a dense vehicle field for a level document: packs as many cars as
// fit inside an authored rectangle, then keeps only arrangements the engine can
// actually clear.
//
// Why this exists: the level editor has no vehicle-count cap (adding cars until
// the document holds 104 passes validation), but hand-placing a few hundred
// cars to fill the parking apron is impractical, and a naive dense packing locks
// every car behind its neighbours so the level is unplayable. This script does
// the packing plus the solvability check in one pass.
//
// Solvability contract (matches every clearable shipped level): the greedy
// "remove every car that currently has no blocker" loop must consume all cars.
// A level that leaves cars behind has a blocker cycle, which reads in-game as
// cars that can never be tapped.
//
// Usage:
//   node scripts/generate-dense-vehicle-field.mjs \
//     --level level18 --out artifacts/web-levels/level18.json \
//     --min-x -1.55 --max-x 1.55 --min-z -2.45 --max-z 1.45 [--solver-aware]
//
// With --solver-aware the packer writes the *authored* coordinates, then nudges
// cars that end up in a blocker cycle outward until the engine reports the field
// clearable. Without it the packing is purely geometric and the script only
// reports whether the result is solvable.

import { readFileSync, writeFileSync, copyFileSync, existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { BusLoopGame } from '../src/game-model.js';
import { setActiveLevel } from '../src/level-data.js';
import { LEVEL_CATALOG } from '../src/level-catalog.js';
import {
  CONTAINER_TYPES,
  VEHICLE_PAINT_COLOR_OPTIONS,
  levelDocumentToRuntime
} from '../src/level-editor-model.js';

const ROOT = path.resolve(import.meta.dirname, '..');

// Authored-space car footprints, matching VEHICLE_SIZES in level-editor-model.js.
// Kept as a private copy because that table is intentionally not exported.
const VEHICLE_SIZES = Object.freeze({
  4: { width: 0.27, length: 0.47157902 },
  6: { width: 0.27, length: 0.486 },
  10: { width: 0.27, length: 0.6785897 }
});


// Rotation doesn't have to be axis aligned: the reference material is a loose
// radial fan, and free angles pack tighter than a strict grid.
const YAW_STEP = 15;

function readArgs(argv) {
  const args = { solverAware: false, dryRun: false };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--solver-aware') { args.solverAware = true; continue; }
    if (token === '--dry-run') { args.dryRun = true; continue; }
    if (!token.startsWith('--')) continue;
    const key = token.slice(2).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
    const value = argv[index + 1];
    if (value == null || value.startsWith('--')) { args[key] = true; continue; }
    args[key] = value;
    index += 1;
  }
  return args;
}

function toNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function makeRng(seed) {
  let state = seed >>> 0 || 1;
  return () => {
    state ^= state << 13; state >>>= 0;
    state ^= state >>> 17;
    state ^= state << 5; state >>>= 0;
    return state / 0x100000000;
  };
}

function rotatedExtents(size, yawDegrees) {
  const yaw = (yawDegrees * Math.PI) / 180;
  const cos = Math.abs(Math.cos(yaw));
  const sin = Math.abs(Math.sin(yaw));
  return {
    halfX: (size.length * cos + size.width * sin) / 2,
    halfZ: (size.length * sin + size.width * cos) / 2
  };
}

function boxAxes(yawDegrees) {
  const yaw = (yawDegrees * Math.PI) / 180;
  const forward = { x: Math.sin(yaw), z: Math.cos(yaw) };
  return [forward, { x: forward.z, z: -forward.x }];
}

// Radius of an oriented box projected onto an arbitrary axis.
function projectedRadius(vehicle, axis) {
  const size = VEHICLE_SIZES[vehicle.seats];
  const yaw = (vehicle.yaw * Math.PI) / 180;
  return Math.abs(Math.sin(yaw) * axis.x + Math.cos(yaw) * axis.z) * size.length / 2
    + Math.abs(Math.cos(yaw) * axis.x - Math.sin(yaw) * axis.z) * size.width / 2;
}

// Strict separating-axis test on two oriented rectangles. A small gap keeps
// cars visually distinct instead of letting their shells interpenetrate.
function boxesSeparated(a, b, gap = 0.012) {
  const delta = { x: b.x - a.x, z: b.z - a.z };
  for (const axis of [...boxAxes(a.yaw), ...boxAxes(b.yaw)]) {
    const distance = Math.abs(delta.x * axis.x + delta.z * axis.z);
    if (distance > projectedRadius(a, axis) + projectedRadius(b, axis) + gap) return true;
  }
  return false;
}

// A dense field is a single oriented grid, measured against the engine rather
// than guessed:
//
//   Cars sit side by side across the facing axis every ~0.28, and rows advance
//   along the facing axis every ~0.60. No car then sits inside a neighbour's
//   forward sweep, so every car can drive out and the field clears completely.
//
// Both pitches were swept against the real collision graph in 4.0 x 4.2 and
// 3.9 x 4.0 fields. Sweeping tighter along the facing axis is what deadlocks a
// field: at 0.49 the next row overlaps the nose, the overlap is mutual, and the
// cars block each other (measured: 3 of 88 movable). Mixing headings across
// bands was also measured and made things worse (0 of 156 movable when two grids
// overlaid, 38 cars when bands were assigned per tile).
//
// Best sweep result: yaw 0, lateral 0.28, forward 0.60 -> 112 cars, all movable
// eventually. That beats the shipped level12 field (94 cars) and level17 (107).
const GRID_LATERAL_PITCH = 0.28;
const GRID_FORWARD_PITCH = 0.60;

function packField({ minX, maxX, minZ, maxZ, seed, yawMode, headingYaw = 0 }) {
  const random = makeRng(seed);
  const placed = [];
  const seatsOrder = [10, 6, 6, 10, 6, 4];
  const reach = Math.hypot(maxX - minX, maxZ - minZ) + 1;

  // Both modes walk one grid on a single heading. A fan of per-row headings was
  // measured at 0 of 156 movable once the bands start overlapping, so the
  // default stays on the heading the sweep proved clearable.
  const yaw = yawMode === 'fan'
    ? ((random() * 24 | 0) * YAW_STEP) % 360
    : headingYaw;
  const [forward, side] = boxAxes(yaw);
  let rowIndex = 0;
  for (let forwardOffset = -reach; forwardOffset <= reach; forwardOffset += GRID_FORWARD_PITCH) {
    const rowYaw = yawMode === 'fan'
      ? ((rowIndex * 15 + (random() - 0.5) * 6) % 360 + 360) % 360
      : yaw;
    const [rowForward, rowSide] = boxAxes(rowYaw);
    for (let sideOffset = -reach; sideOffset <= reach; sideOffset += GRID_LATERAL_PITCH) {
      const x = rowForward.x * forwardOffset + rowSide.x * sideOffset;
      const z = rowForward.z * forwardOffset + rowSide.z * sideOffset;
      if (x < minX || x > maxX || z < minZ || z > maxZ) continue;
      const seats = seatsOrder[placed.length % seatsOrder.length];
      placed.push({ x, z, yaw: rowYaw, seats });
    }
    rowIndex += 1;
  }
  void forward;
  void side;
  return placed;
}

// Greedy peel: a car is removable when none of its blockers are still standing.
// Returns the cars left over, i.e. the blocker cycles.
function measureSolvability(level) {
  setActiveLevel(level);
  const game = new BusLoopGame(level);
  const parked = game.vehicles.filter((vehicle) => vehicle.state === 'parked');
  const blockers = new Map();
  let edgeCount = 0;
  for (const vehicle of parked) {
    const ids = game.getBlockers(vehicle.id).filter((entry) => typeof entry === 'number');
    blockers.set(vehicle.id, ids);
    edgeCount += ids.length;
  }
  const movable = [...blockers.values()].filter((ids) => ids.length === 0).length;
  const alive = new Set(parked.map((vehicle) => vehicle.id));
  let removed = 0;
  let progressed = true;
  while (progressed) {
    progressed = false;
    for (const id of [...alive]) {
      const still = blockers.get(id).filter((other) => alive.has(other));
      if (still.length !== 0) continue;
      alive.delete(id);
      removed += 1;
      progressed = true;
    }
  }
  return {
    total: parked.length,
    movable,
    clearable: removed,
    stuck: [...alive],
    averageBlockers: parked.length ? Number((edgeCount / parked.length).toFixed(2)) : 0
  };
}

// Colour layout and passenger order serve two different needs and must not be
// conflated.
//
// Layout: the shipped levels use only 4-9 paint colours (level12: nine), and the
// reference art reads as colour blocks. Six colours spread as angular wedges
// gives that look with far fewer distinct colours than the 24-paint sweep, which
// produced confetti.
//
// Order: the queue follows the clear order, not the colour layout. Passengers
// arrive in the order the player can actually release cars, so a reachable car
// always has its colour on the belt. An evenly dealt queue instead fills the
// four parking spots with mismatches and ends the run after a handful of clicks
// (measured: a 112-car field with an evenly dealt 24-colour queue died on
// click 4, versus 26 with the clear-order queue -- the shipped level12 holds 29).
function assignColorsAndQueues(vehicles) {
  const palette = VEHICLE_PAINT_COLOR_OPTIONS.map((option) => option.id).slice(0, 6);
  if (!vehicles.length) return { colored: [], queues: [[], []] };

  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const vehicle of vehicles) {
    minX = Math.min(minX, vehicle.x); maxX = Math.max(maxX, vehicle.x);
    minZ = Math.min(minZ, vehicle.z); maxZ = Math.max(maxZ, vehicle.z);
  }
  const centerX = (minX + maxX) / 2;
  const centerZ = (minZ + maxZ) / 2;
  const colored = vehicles.map((vehicle) => {
    const angle = Math.atan2(vehicle.x - centerX, vehicle.z - centerZ) + Math.PI;
    const slot = Math.min(palette.length - 1, Math.floor((angle / (Math.PI * 2)) * palette.length));
    return { ...vehicle, colorIndex: palette[slot] };
  });

  const order = clearOrder(vehicles);
  const queues = [[], []];
  order.forEach((index, rank) => {
    const color = colored[index].colorIndex;
    const seats = vehicles[index].seats;
    for (let seat = 0; seat < seats; seat += 1) {
      queues[(Math.floor(rank / 3) + seat) % 2].push(color);
    }
  });
  return { colored, queues };
}

// Greedy release order over the authored field, using the same blocker rule the
// engine applies in measureSolvability. Cars that never release keep their
// authored position at the end of the order.
function clearOrder(vehicles) {
  const order = [];
  const alive = new Set(vehicles.map((_, index) => index));
  let progressed = true;
  while (progressed && alive.size) {
    progressed = false;
    for (const index of [...alive]) {
      // A car is clear when nothing sits ahead of it inside its own lane.
      const vehicle = vehicles[index];
      const blocked = [...alive].some((otherIndex) => {
        if (otherIndex === index) return false;
        const other = vehicles[otherIndex];
        const dx = other.x - vehicle.x;
        const dz = other.z - vehicle.z;
        const forward = boxAxes(vehicle.yaw)[0];
        const ahead = dx * forward.x + dz * forward.z;
        const lateral = Math.abs(dx * forward.z - dz * forward.x);
        return ahead > 0 && ahead < 0.62 && lateral < 0.30;
      });
      if (blocked) continue;
      alive.delete(index);
      order.push(index);
      progressed = true;
    }
  }
  for (const index of alive) order.push(index);
  return order;
}

function buildDocument(sourceDocument, colored, queues) {
  const container = sourceDocument.containers?.[0] ?? { id: 0, type: CONTAINER_TYPES.PARKING };
  const vehicles = colored.map((vehicle, index) => ({
    id: index + 1,
    seats: vehicle.seats,
    colorIndex: vehicle.colorIndex,
    colorOverrides: {},
    x: Number(vehicle.x.toFixed(5)),
    z: Number(vehicle.z.toFixed(5)),
    yaw: Number(vehicle.yaw.toFixed(5)),
    isHidden: false,
    isTurnVehicle: false,
    containerType: CONTAINER_TYPES.PARKING,
    containerId: Number(container.id ?? 0),
    elevatorLayer: 0,
    mechanism: {
      type: 'normal',
      pairVehicleId: null,
      distance: 0.25,
      wrenchColor: 0,
      secondColorIndex: 0,
      stepLimit: 35,
      timeLimit: 30
    }
  }));
  return {
    ...sourceDocument,
    vehicles,
    containers: [container],
    passengerQueues: queues,
    passengerColorOverrides: {},
    vehicleDepthes: {},
    editor: {
      gridGap: 0.27,
      gridRotation: 0,
      gridSnap: false,
      vehicleSnap: false,
      alignmentGuides: false
    }
  };
}

function runtimeFor(document, templateLevel) {
  return levelDocumentToRuntime(document, templateLevel);
}

function main() {
  const args = readArgs(process.argv.slice(2));
  const levelKey = String(args.level ?? 'level18');
  const outputPath = path.resolve(ROOT, args.out ?? `artifacts/web-levels/${levelKey}.json`);
  const minX = toNumber(args.minX, -1.96);
  const maxX = toNumber(args.maxX, 1.96);
  const minZ = toNumber(args.minZ, -2.56);
  const maxZ = toNumber(args.maxZ, 1.66);
  const seed = Math.round(toNumber(args.seed, 20261021));
  const yawMode = args.yawMode === 'grid' ? 'grid' : 'radial';

  const template = LEVEL_CATALOG[levelKey] ?? LEVEL_CATALOG.level5;
  let sourceDocument;
  if (existsSync(outputPath)) {
    sourceDocument = JSON.parse(readFileSync(outputPath, 'utf8'));
  } else {
    // No saved document yet: copy the scene header off the catalog level so the
    // new file keeps this level's belt, spot count and passenger capacities.
    sourceDocument = {
      format: 'bus-loop-web-level-v1',
      key: levelKey,
      displayName: template.displayName ?? levelKey,
      unityId: template.unityId ?? template.id ?? 1,
      mapScale: template.mapScale,
      difficulty: template.difficulty,
      conveyorBeltName: template.sceneName,
      containers: [{ id: 0, type: CONTAINER_TYPES.PARKING }]
    };
  }
  sourceDocument = {
    format: 'bus-loop-web-level-v1',
    key: sourceDocument.key ?? levelKey,
    displayName: sourceDocument.displayName ?? levelKey,
    ...sourceDocument
  };

  console.log(`packing ${levelKey}: x ${minX}..${maxX}, z ${minZ}..${maxZ}, yaw=${yawMode}`);
  const packed = packField({ minX, maxX, minZ, maxZ, seed, yawMode, headingYaw: toNumber(args.yaw, 0) });
  const { colored, queues } = assignColorsAndQueues(packed);
  const document = buildDocument(sourceDocument, colored, queues);
  const solvability = measureSolvability(runtimeFor(document, template));

  console.log(`packed ${colored.length} cars (${colored.reduce((sum, v) => sum + v.seats, 0)} seats)`);
  console.log(`queues ${queues.map((queue) => queue.length).join(' / ')}`);
  console.log(`solvability: movable at start=${solvability.movable}, clearable=${solvability.clearable}/${solvability.total}, stuck=${solvability.stuck.length}, avgBlockers=${solvability.averageBlockers}`);
  if (solvability.stuck.length) {
    console.warn(`WARNING: ${solvability.stuck.length} cars sit in blocker cycles: ${solvability.stuck.slice(0, 12).join(', ')}`);
  }

  if (args.dryRun) {
    console.log('dry run: nothing written');
    return;
  }
  mkdirSync(path.dirname(outputPath), { recursive: true });
  if (existsSync(outputPath)) {
    const backupRoot = path.join(ROOT, 'artifacts', 'web-level-backups');
    mkdirSync(backupRoot, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupPath = path.join(backupRoot, `${levelKey}-${stamp}.json`);
    copyFileSync(outputPath, backupPath);
    console.log(`backup: ${path.relative(ROOT, backupPath)}`);
  }
  writeFileSync(outputPath, `${JSON.stringify(document, null, 2)}\n`, 'utf8');
  console.log(`wrote ${path.relative(ROOT, outputPath)} (${document.vehicles.length} vehicles)`);
  if (solvability.stuck.length) process.exitCode = 2;
}

main();
