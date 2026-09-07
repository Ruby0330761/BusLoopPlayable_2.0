import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { MECHANISM_RESOURCE_MANIFEST, deriveLevelMechanics } from '../src/mechanism-resources.js';
import { LEVEL_CATALOG } from '../src/level-catalog.js';

test('mechanism resource manifest keeps every mechanism family under its owned directory', () => {
  for (const paths of Object.values(MECHANISM_RESOURCE_MANIFEST)) {
    for (const asset of paths) assert.equal(existsSync(`public${asset}`), true, asset);
  }
});

test('level mechanism metadata distinguishes ordinary levels from mechanism levels', () => {
  assert.deepEqual(LEVEL_CATALOG.level13.mechanics, {
    isMechanicLevel: false,
    types: ['ordinaryConveyor'],
    counts: {
      luxuryVehicle: 0,
      ambulance: 0,
      turnVehicle: 0,
      hiddenVehicle: 0,
      garage: 0,
      vehicleTransportBelt: 0
    }
  });
  assert.deepEqual(LEVEL_CATALOG.level29.mechanics.types, [
    'ordinaryConveyor', 'luxuryVehicle', 'turnVehicle'
  ]);
  assert.equal(LEVEL_CATALOG.level29.mechanics.isMechanicLevel, true);
  assert.deepEqual(LEVEL_CATALOG.level33.mechanics.types, [
    'ordinaryConveyor', 'turnVehicle', 'hiddenVehicle'
  ]);
  assert.deepEqual(LEVEL_CATALOG.level39.mechanics.types, [
    'ordinaryConveyor', 'turnVehicle', 'garage'
  ]);
});

test('mechanism metadata can be derived from imported level fields', () => {
  const metadata = deriveLevelMechanics({
    vehicles: [{ colorIndex: 15 }, { isTurnVehicle: true }, { isHidden: true }],
    vehicleAmbulances: [{ vid: 1 }],
    containers: [{ type: 2 }, { type: 3 }],
    conveyorBelts: []
  });
  assert.equal(metadata.isMechanicLevel, true);
  assert.deepEqual(metadata.types, [
    'ordinaryConveyor', 'luxuryVehicle', 'ambulance', 'turnVehicle',
    'hiddenVehicle', 'garage', 'vehicleTransportBelt'
  ]);
});
