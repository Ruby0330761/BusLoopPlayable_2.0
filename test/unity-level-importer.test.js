import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { readFileSync } from 'node:fs';
import {
  importUnityLevelAsset,
  validateUnityLevelSource
} from '../scripts/unity-level-importer.mjs';

function makeLevelSource({
  name = 'level19',
  vehicleIds = [1],
  vehicleSeats = 4,
  vehicleColorIndex = 2,
  turnVehicleIds = [],
  hiddenVehicleIds = [],
  garageVehicleIds = [],
  conveyorVehicleIds = [],
  conveyorSection = '  conveyorBelts: []',
  passengerColors = [2, 2, 2, 2],
  mechanismSection = '  vehicleExt: []',
  ambulanceSection = '  vehicleAmbulances: []',
  firetruckSection = '  vehicleFiretrucks: []'
} = {}) {
  const vehicles = vehicleIds.map((id) => `  - id: ${id}
    seats: ${vehicleSeats}
    isHidden: ${hiddenVehicleIds.includes(id) ? 1 : 0}
    isTurnVehicle: ${turnVehicleIds.includes(id) ? 1 : 0}
    colorIndex: ${vehicleColorIndex}
    priority: 0
    position: {x: ${id}, y: 0, z: 0}
    rotation: {x: 0, y: 0, z: 0, w: 1}
    containerType: ${conveyorVehicleIds.includes(id) ? 3 : garageVehicleIds.includes(id) ? 2 : 1}
    containerId: ${conveyorVehicleIds.includes(id) ? 4 : garageVehicleIds.includes(id) ? 1 : 0}`).join('\n');
  const passengers = passengerColors.map((colorIndex, index) => `  - queueId: ${index % 2}
    colorIndex: ${colorIndex}`).join('\n');
  return `%YAML 1.1
%TAG !u! tag:unity3d.com,2011:
--- !u!114 &11400000
MonoBehaviour:
  m_ObjectHideFlags: 0
  m_Script: {fileID: 11500000, guid: e40b6c9a941244a49037a51f0dac6d7f, type: 3}
  m_Name: ${name}
  id: 19
  mapScale: 1
  vehicles:
${vehicles}
  containers:
  - id: 0
    type: 1
    position: {x: 0, y: 0, z: 0}
    rotation: {x: 0, y: 0, z: 0, w: 1}
${garageVehicleIds.length > 0 ? `  - id: 1
    type: 2
    position: {x: 1, y: 0, z: -1}
    rotation: {x: 0, y: 0, z: 0, w: 1}
` : ''}${conveyorVehicleIds.length > 0 ? `  - id: 4
    type: 3
    position: {x: 0, y: 0, z: -1}
    rotation: {x: 0, y: 0, z: 0, w: 1}
${conveyorSection}
` : ''}${mechanismSection}
  vehicleLinkages: []
  vehicleWrenches: []
  vehicleCombinations: []
${ambulanceSection}
${firetruckSection}
  vehicleAnchors: []
  vehiclePassengerLocations: []
  vehicleDepthes: []
  fixedPassengerSequence:
${passengers}
`;
}

test('validates a supported Unity level and reports import counts', () => {
  const result = validateUnityLevelSource({
    filename: 'level19.asset',
    source: makeLevelSource()
  });
  assert.deepEqual(result, {
    key: 'level19',
    filename: 'level19.asset',
    sourceName: 'level19',
    unityId: 19,
    mapScale: 1,
    vehicleCount: 1,
    turnVehicleCount: 0,
    ambulanceCount: 0,
    luxuryCount: 0,
    garageCount: 0,
    garageVehicleCount: 0,
    containerCount: 1,
    garageCount: 0,
    garageVehicleCount: 0,
    mechanics: {
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
    },
    queueCounts: [2, 2],
    passengerCount: 4
  });
});

test('rejects unsafe filenames and malformed Unity asset names', () => {
  const source = makeLevelSource();
  assert.throws(
    () => validateUnityLevelSource({ filename: '../level19.asset', source }),
    /Only one local Unity level file/
  );
  assert.throws(
    () => validateUnityLevelSource({ filename: 'level19.txt', source }),
    /level<number>\.asset/
  );
  const renamed = validateUnityLevelSource({ filename: 'level20.asset', source });
  assert.equal(renamed.key, 'level20');
  assert.equal(renamed.sourceName, 'level19');
  assert.throws(
    () => validateUnityLevelSource({ filename: 'level19.asset', source: source.replace('m_Name: level19', 'm_Name: custom') }),
    /m_Name must use the level<number> format/
  );
});

test('rejects duplicate vehicle ids and passenger-seat mismatches', () => {
  assert.throws(
    () => validateUnityLevelSource({
      filename: 'level19.asset',
      source: makeLevelSource({ vehicleIds: [1, 1], passengerColors: Array(8).fill(2) })
    }),
    /Vehicle id 1 is duplicated/
  );
  assert.throws(
    () => validateUnityLevelSource({
      filename: 'level19.asset',
      source: makeLevelSource({ passengerColors: [2, 2, 2] })
    }),
    /4 seats but 3 passengers/
  );
});

test('rejects missing required top-level values', () => {
  const source = makeLevelSource().replace('  id: 19\n', '');
  assert.throws(
    () => validateUnityLevelSource({ filename: 'level19.asset', source }),
    /id is required/
  );
});

test('accepts Unity turn vehicle flags and reports their count', () => {
  const result = validateUnityLevelSource({
    filename: 'level19.asset',
    source: makeLevelSource({ turnVehicleIds: [1] })
  });
  assert.equal(result.turnVehicleCount, 1);
});

test('preserves Unity hidden vehicle flags during import', async () => {
  const outputRoot = await mkdtemp(path.join(os.tmpdir(), 'busloop-hidden-import-'));
  const result = await importUnityLevelAsset({
    filename: 'level19.asset',
    source: makeLevelSource({ hiddenVehicleIds: [1] })
  }, {
    outputRoot,
    metadataPaths: [],
    updateCatalog: async () => {}
  });
  assert.match(await readFile(result.outputPath, 'utf8'), /isHidden: 1/);
});

test('accepts garage containers and reports their vehicle counts', () => {
  const result = validateUnityLevelSource({
    filename: 'level19.asset',
    source: makeLevelSource({ garageVehicleIds: [1] })
  });
  assert.equal(result.containerCount, 2);
  assert.equal(result.garageCount, 1);
  assert.equal(result.garageVehicleCount, 1);
});

test('accepts conveyor-belt containers and reports their vehicle counts', () => {
  const result = validateUnityLevelSource({
    filename: 'level19.asset',
    source: makeLevelSource({
      vehicleIds: [1, 2],
      conveyorVehicleIds: [1, 2],
      passengerColors: Array(8).fill(2),
      conveyorSection: `  conveyorBelts:
  - vcId: 4
    width: 3.8`
    })
  });
  assert.equal(result.containerCount, 2);
  assert.equal(result.conveyorBeltCount, 1);
  assert.equal(result.conveyorVehicleCount, 2);
});

test('rejects conveyor belts without a matching container or vehicle', () => {
  const source = makeLevelSource({
    vehicleIds: [1],
    conveyorVehicleIds: [1],
    passengerColors: Array(4).fill(2),
    conveyorSection: `  conveyorBelts:
  - vcId: 9
    width: 3.8`
  });
  assert.throws(
    () => validateUnityLevelSource({ filename: 'level19.asset', source }),
    /references a missing container/
  );
  const empty = makeLevelSource({
    conveyorVehicleIds: [],
    mechanismSection: `  conveyorBelts:
  - vcId: 4
    width: 3.8`
  });
  assert.throws(
    () => validateUnityLevelSource({ filename: 'level19.asset', source: empty }),
    /references a missing container/
  );
  const missingConfig = makeLevelSource({
    vehicleIds: [1],
    conveyorVehicleIds: [1],
    passengerColors: Array(4).fill(2),
    conveyorSection: '  conveyorBelts: []'
  });
  assert.throws(
    () => validateUnityLevelSource({ filename: 'level19.asset', source: missingConfig }),
    /missing conveyorBelts configuration/
  );
  const wrongType = makeLevelSource({
    vehicleIds: [1],
    conveyorVehicleIds: [],
    passengerColors: Array(4).fill(2)
  }).replace(
    '  vehicleLinkages: []',
    `  conveyorBelts:
  - vcId: 0
    width: 3.8
  vehicleLinkages: []`
  );
  assert.throws(
    () => validateUnityLevelSource({ filename: 'level19.asset', source: wrongType }),
    /must reference a type 3 conveyor container/
  );
});

test('rejects vehicle and container type mismatches', () => {
  const source = makeLevelSource({ garageVehicleIds: [1] })
    .replace('containerType: 2', 'containerType: 1');
  assert.throws(
    () => validateUnityLevelSource({ filename: 'level19.asset', source }),
    /does not match container 1 type 2/
  );
});

test('rejects mechanism sections that are not supported by the current editor', () => {
  assert.throws(
    () => validateUnityLevelSource({
      filename: 'level19.asset',
      source: makeLevelSource({ mechanismSection: '  vehicleExt:\n  - id: 1' })
    }),
    /vehicleExt contains a mechanism/
  );
  assert.throws(
    () => validateUnityLevelSource({
      filename: 'level19.asset',
      source: makeLevelSource({ firetruckSection: '  vehicleFiretrucks:\n  - vid: 1' })
    }),
    /vehicleFiretrucks contains a mechanism/
  );
});

test('validates ambulance vehicle identity, color, seats, and step limit', () => {
  const result = validateUnityLevelSource({
    filename: 'level19.asset',
    source: makeLevelSource({
      vehicleSeats: 6,
      vehicleColorIndex: 13,
      passengerColors: Array(6).fill(13),
      ambulanceSection: '  vehicleAmbulances:\n  - vid: 1\n    stepLimit: 35'
    })
  });
  assert.equal(result.ambulanceCount, 1);
  assert.throws(
    () => validateUnityLevelSource({
      filename: 'level19.asset',
      source: makeLevelSource({
        vehicleSeats: 6,
        vehicleColorIndex: 13,
        passengerColors: Array(6).fill(13)
      })
    }),
    /has no vehicleAmbulances configuration/
  );
  assert.throws(
    () => validateUnityLevelSource({
      filename: 'level19.asset',
      source: makeLevelSource({
        vehicleSeats: 6,
        vehicleColorIndex: 13,
        passengerColors: Array(6).fill(13),
        ambulanceSection: '  vehicleAmbulances:\n  - vid: 1\n    stepLimit: 0'
      })
    }),
    /stepLimit/
  );
});

test('validates luxury vehicles and passengers without requiring a mechanism section', () => {
  const result = validateUnityLevelSource({
    filename: 'level19.asset',
    source: makeLevelSource({
      vehicleSeats: 6,
      vehicleColorIndex: 15,
      passengerColors: Array(6).fill(15)
    })
  });
  assert.equal(result.luxuryCount, 1);
  assert.throws(
    () => validateUnityLevelSource({
      filename: 'level19.asset',
      source: makeLevelSource({
        vehicleSeats: 4,
        vehicleColorIndex: 15,
        passengerColors: Array(4).fill(15)
      })
    }),
    /Luxury vehicle 1 must use 6 seats/
  );
  assert.throws(
    () => validateUnityLevelSource({
      filename: 'level19.asset',
      source: makeLevelSource({
        vehicleSeats: 6,
        vehicleColorIndex: 15,
        passengerColors: Array(6).fill(14)
      })
    }),
    /unsupported color index 14/
  );
});

test('imports a validated source and reports replacements', async () => {
  const outputRoot = await mkdtemp(path.join(os.tmpdir(), 'busloop-level-import-'));
  const source = makeLevelSource();
  const updateCalls = [];
  const options = {
    outputRoot,
    metadataPaths: [],
    updateCatalog: async (sourcePath, level) => updateCalls.push({ sourcePath, level })
  };
  const first = await importUnityLevelAsset({ filename: 'level19.asset', source }, options);
  const second = await importUnityLevelAsset({ filename: 'level19.asset', source }, options);
  assert.equal(first.replaced, false);
  assert.equal(second.replaced, true);
  assert.equal(await readFile(first.outputPath, 'utf8'), source);
  assert.equal(updateCalls.length, 2);
  assert.equal(updateCalls[0].level.key, 'level19');
});

test('restores the previous source when catalog generation fails', async () => {
  const outputRoot = await mkdtemp(path.join(os.tmpdir(), 'busloop-level-rollback-'));
  const original = makeLevelSource();
  await importUnityLevelAsset({ filename: 'level19.asset', source: original }, {
    outputRoot,
    metadataPaths: [],
    updateCatalog: async () => {}
  });
  const changed = original.replace('mapScale: 1', 'mapScale: 1.25');
  await assert.rejects(
    importUnityLevelAsset({ filename: 'level19.asset', source: changed }, {
      outputRoot,
      metadataPaths: [],
      updateCatalog: async () => { throw new Error('catalog failed'); }
    }),
    /catalog failed/
  );
  assert.equal(await readFile(path.join(outputRoot, 'level19.asset'), 'utf8'), original);
});

test('editor and Vite service expose Unity level import controls', () => {
  const editorSource = readFileSync('src/scene-editor.js', 'utf8');
  const viteSource = readFileSync('vite.config.js', 'utf8');
  assert.match(editorSource, /editor-level-import/);
  assert.match(editorSource, /editor-level-open-folder/);
  assert.match(editorSource, /X-Level-Filename/);
  assert.match(viteSource, /__unity-levels\/import/);
  assert.match(viteSource, /__unity-levels\/open-folder/);
  assert.match(viteSource, /importUnityLevelAsset/);
});
