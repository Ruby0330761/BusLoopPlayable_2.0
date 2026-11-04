import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import {
  computeLayoutBounds,
  createProjection,
  levelSvgStyles,
  renderLevelSvg,
  resolveVehicleColor,
  resolveVehicleSize,
  summarizeLevel,
  vehicleArrowPoints,
  vehicleCabinRect,
  vehiclePolygon
} from '../src/level-layout-thumbnail.js';

function loadLevel(key) {
  return JSON.parse(readFileSync(new URL(`../artifacts/web-levels/${key}.json`, import.meta.url), 'utf8'));
}

test('vehicle size follows seat count so a bus is longer than a car', () => {
  const car = resolveVehicleSize({ seats: 4 });
  const bus = resolveVehicleSize({ seats: 10 });
  assert.ok(bus.length > car.length, '10-seat vehicle should be longer than a 4-seat one');
  assert.equal(car.width, bus.width, 'width is shared across seat counts');
});

test('an explicit collisionSize wins over the seat table', () => {
  const size = resolveVehicleSize({ seats: 4, collisionSize: { width: 0.5, length: 0.9 } });
  assert.deepEqual(size, { width: 0.5, length: 0.9 });
});

test('unknown seat counts fall back instead of producing NaN geometry', () => {
  const size = resolveVehicleSize({ seats: 7 });
  assert.ok(Number.isFinite(size.width) && size.width > 0);
  assert.ok(Number.isFinite(size.length) && size.length > 0);
});

test('colours resolve from the shared atlas table', () => {
  assert.equal(resolveVehicleColor({ colorIndex: 0 }), '#0061E8');
  assert.equal(resolveVehicleColor({ colorIndex: 17 }), '#2D2D30');
  // An unknown index must stay visible rather than rendering as transparent.
  assert.match(resolveVehicleColor({ colorIndex: 99 }), /^#[0-9a-f]{6}$/i);
});

test('an authored colour override wins over the atlas index', () => {
  // The red/green rescue boards recolour atlas slots per vehicle; reading only
  // colorIndex painted those boards in the atlas pink and blue.
  assert.equal(resolveVehicleColor({ colorIndex: 2, colorOverrides: { body: '#c9363e' } }), '#c9363e');
  assert.equal(resolveVehicleColor({ colorIndex: 2, colorOverrides: { body: 'not-a-colour' } }), '#F338AF');
});

test('each car draws a cabin roof and a heading arrow inside its footprint', () => {
  const project = createProjection({ minX: -5, maxX: 5, minZ: -5, maxZ: 5 }, 200, 200, 10);
  for (const seats of [4, 6, 10]) {
    const vehicle = { x: 0, z: 0, yaw: 0, seats };
    assert.equal(vehicleCabinRect(vehicle, project).split(' ').length, 4);
    assert.equal(vehicleArrowPoints(vehicle, project).split(' ').length, 3);
  }
  // The roof has to follow yaw, otherwise a turned car looks like a straight one.
  const straight = vehicleCabinRect({ x: 0, z: 0, yaw: 0, seats: 6 }, project);
  const turned = vehicleCabinRect({ x: 0, z: 0, yaw: 90, seats: 6 }, project);
  assert.notEqual(straight, turned);
});

test('bounds ignore conveyor spline points so the car field fills the picture', async () => {
  // Catalog levels carry spline points (the conveyor runs at z≈15 while the
  // parked field sits near z≈0). Web-level fixtures do not, so this needs the
  // baked catalog rather than a file on disk.
  const { LEVEL_CATALOG } = await import('../src/level-catalog.js');
  const level = LEVEL_CATALOG.level5;
  assert.ok(Array.isArray(level.splinePoints), 'fixture should carry spline points');
  assert.ok(level.splinePoints.length > 0);
  const bounds = computeLayoutBounds(level);
  const splineZ = Math.max(...level.splinePoints.map((point) => point[1] ?? point.z));
  assert.ok(
    bounds.maxZ < splineZ,
    'spline points sit far from the field; including them would squash the cars'
  );
  const vehicleZ = level.vehicles.map((vehicle) => vehicle.z);
  assert.ok(bounds.minZ <= Math.min(...vehicleZ) && bounds.maxZ >= Math.max(...vehicleZ),
    'every vehicle must stay inside the frame');
});

test('projection centres the level and keeps one scale for both axes', () => {
  const bounds = { minX: -2, maxX: 2, minZ: -3, maxZ: 1 };
  const project = createProjection(bounds, 200, 200, 10);
  const center = project.point(0, -1);
  assert.ok(Math.abs(center.x - 100) < 1e-6, 'x centre should land mid-canvas');
  assert.ok(Math.abs(center.y - 100) < 1e-6, 'z centre should land mid-canvas');
  // The playable camera looks from the field's +Z side, so +Z runs DOWN the
  // screen: a higher z must produce a LARGER SVG y. Getting this backwards
  // mirrored every thumbnail vertically against the game.
  assert.ok(project.point(0, 1).y > project.point(0, -3).y);
  // A square in world space stays square on screen.
  const dx = project.point(2, 0).x - project.point(0, 0).x;
  const dz = Math.abs(project.point(0, 2).y - project.point(0, 0).y);
  assert.ok(Math.abs(dx - dz) < 1e-6);
});

test('a vehicle polygon has four corners and rotates with yaw', () => {
  const project = createProjection({ minX: -5, maxX: 5, minZ: -5, maxZ: 5 }, 200, 200, 10);
  const straight = vehiclePolygon({ x: 0, z: 0, yaw: 0, seats: 10 }, project);
  const turned = vehiclePolygon({ x: 0, z: 0, yaw: 90, seats: 10 }, project);
  assert.equal(straight.split(' ').length, 4);
  assert.notEqual(straight, turned, 'yaw must change the footprint');
});

test('renders every vehicle of a real level', () => {
  const level = loadLevel('level36');
  const svg = renderLevelSvg(level);
  assert.equal((svg.match(/level-thumb__car"/g) ?? []).length, level.vehicles.length);
  assert.match(svg, /^<svg viewBox="0 0 \d+ \d+"/);
  assert.match(svg, /role="img"/);
  // The legend classes must exist in the stylesheet the overlay injects.
  const css = levelSvgStyles();
  assert.match(css, /level-thumb__car/);
  assert.match(css, /level-thumb__bay/);
});

test('an empty level renders an explicit message instead of a blank frame', () => {
  const svg = renderLevelSvg({ key: 'level1', displayName: '空', vehicles: [], passengerQueues: [] });
  assert.match(svg, /空关卡/);
  assert.doesNotMatch(svg, /level-thumb__car"/);
});

test('hidden and turning vehicles are tagged for their outline styles', () => {
  const svg = renderLevelSvg({
    vehicles: [
      { id: 1, x: 0, z: 0, yaw: 0, seats: 4, colorIndex: 0, isHidden: true },
      { id: 2, x: 1, z: 0, yaw: 0, seats: 4, colorIndex: 1, isTurnVehicle: true }
    ],
    passengerQueues: []
  });
  assert.match(svg, /level-thumb__car--hidden/);
  assert.match(svg, /level-thumb__car--turn/);
});

test('summarizeLevel reports the counts the overview cards show', () => {
  const level = loadLevel('level36');
  const summary = summarizeLevel(level);
  assert.equal(summary.vehicleCount, level.vehicles.length);
  assert.equal(summary.passengerCount, level.passengerQueues.flat().length);
  assert.ok(summary.colorCount > 0);
  assert.match(summary.seatSummary, /座×\d+/);
});

test('every shipped web level renders without throwing', () => {
  const keys = readdirSync(new URL('../artifacts/web-levels', import.meta.url))
    .filter((name) => name.endsWith('.json'));
  assert.ok(keys.length > 0, 'expected web level fixtures');
  for (const name of keys) {
    const level = JSON.parse(readFileSync(new URL(`../artifacts/web-levels/${name}`, import.meta.url), 'utf8'));
    const svg = renderLevelSvg(level);
    assert.match(svg, /^<svg /, `${name} should render`);
    assert.doesNotMatch(svg, /NaN/, `${name} must not emit NaN coordinates`);
  }
});
