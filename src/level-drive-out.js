import { fixedParkingExitGraph } from './vehicle-collision.js';
import { BusLoopGame } from './game-model.js';
import { LEVEL_1 } from './level-data.js';
import { levelDocumentToRuntime } from './level-editor-model.js';
import { SCENE_TUNING } from './scene-tuning.js';

function peel(graph) {
  const remaining = new Set(graph.keys());
  let removed;
  do {
    removed = false;
    for (const id of remaining) {
      if (graph.get(id).some(other => remaining.has(other))) continue;
      remaining.delete(id);
      removed = true;
    }
  } while (removed);
  return [...remaining];
}

function settleGarages(game) {
  // Advance only the garage animation. Passenger flow and free station slots
  // are independent of the question this layout check answers.
  for (;;) {
    const { releasedVehicleIds } = game.refreshGarages();
    if (!releasedVehicleIds.length) return;
    for (const id of releasedVehicleIds) {
      const car = game.getVehicle(id);
      Object.assign(car, car.motionData.to, { state: 'parked', motionData: null });
      const garage = game.getGarage(car.garageId);
      garage.vehicleIds = garage.vehicleIds.filter(member => member !== id);
      garage.exitingVehicleId = null;
    }
  }
}

function checkMovingLayout(level) {
  const game = new BusLoopGame({ ...level, turnVehicleRotateDuration: 0 });
  let idleSteps = 0;
  while (game.vehicles.some(car => car.state !== 'done')) {
    settleGarages(game);
    const car = game.vehicles.find(car => game.canMoveToStation(car) && game.collisionContext.canVehicleDriveOut(game, car.id));
    if (!car) {
      const belt = game.mechanicState.conveyors.find(item => item.vehicleIds.length && item.speed > 0);
      if (belt && ++idleSteps <= 24) {
        game.updateConveyors(belt.slotCount * belt.unitLength / belt.speed / 24);
        continue;
      }
      return { status: 'review', ids: game.vehicles.filter(item => item.state !== 'done').map(item => item.id) };
    }
    idleSteps = 0;
    car.state = 'done';
    const belt = game.mechanicState.conveyors.find(item => item.id === car.conveyorId);
    if (belt) belt.vehicleIds = belt.vehicleIds.filter(id => id !== car.id);
    game.startTurnVehicleRotation(car);
    game.refreshGateQueues();
    game.refreshElevators();
  }
  return { status: 'clear', ids: [] };
}

// A turn car reverses after each dispatch. Its occupied rectangle stays the same,
// so two precomputed graphs cover every possible departure order on a fixed board.
function checkTurnLayout(level) {
  const cars = level.vehicles;
  const reversed = cars.map(car => car.isTurnVehicle ? { ...car, yaw: car.yaw + 180 } : car);
  const graphs = [cars, reversed].map(poses => fixedParkingExitGraph(level, poses));
  const bits = cars.map((_, index) => 1n << BigInt(index));
  const bitById = new Map(cars.map((car, index) => [car.id, bits[index]]));
  const masks = graphs.map(graph => cars.map(car =>
    graph.get(car.id).reduce((mask, id) => mask | bitById.get(id), 0n)));
  const dead = new Set();
  const all = (1n << BigInt(cars.length)) - 1n;
  let closest = all;
  let deepest = 0;
  let visits = 0;
  function search(remaining, depth) {
    if (!remaining) return true;
    if (dead.has(remaining)) return false;
    if (++visits > 25000) return null;
    if (depth > deepest) { deepest = depth; closest = remaining; }
    for (let i = 0; i < cars.length; i++) {
      if (!(bits[i] & remaining) || (masks[depth % 2][i] & remaining)) continue;
      const result = search(remaining ^ bits[i], depth + 1);
      if (result !== false) return result;
    }
    dead.add(remaining);
    return false;
  }
  const result = search(all, 0);
  return result ? { status: 'clear', ids: [] } : {
    status: result === null ? 'review' : 'blocked',
    ids: cars.filter((_, i) => closest & bits[i]).map(car => car.id)
  };
}

export function checkLayoutDriveOut(document, area = document.tuning?.vehicleArea ?? SCENE_TUNING.vehicleArea, base = LEVEL_1) {
  const level = document.format === 'bus-loop-web-level-v1'
    ? levelDocumentToRuntime(document, base) : { ...base, ...document };
  level.collisionVehicleArea = area;
  const fixed = level.vehicles.filter(car => !car.isTurnVehicle && (car.containerType ?? 1) === 1);
  // A cycle among fixed cars cannot be cleared even after all moving mechanisms leave.
  const ids = peel(fixedParkingExitGraph(level, fixed));
  if (ids.length) return { status: 'blocked', ids };
  if (fixed.length === level.vehicles.length) return { status: 'clear', ids: [] };
  if (level.vehicles.every(car => (car.containerType ?? 1) === 1)) return checkTurnLayout(level);
  return checkMovingLayout(level);
}

export function driveOutLabel({ status, ids }) {
  if (status === 'clear') return '车辆均可驶出';
  const label = status === 'blocked' ? '无法驶出' : '需试玩复核';
  return label + ' · ' + ids.map(id => '#' + id).join('、');
}
