import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  OFFICIAL_LEVEL_FILE_PATTERN,
  OFFICIAL_LEVEL_ROOT,
  chapterCode,
  listOfficialChapters,
  officialLevelDisplayName,
  officialLevelKey,
  readOfficialChapter,
  readOfficialLevelAsset
} from '../scripts/official-levels.mjs';
import { parseUnityLevelSource } from '../scripts/unity-level-parser.mjs';

function makeAsset({
  name = 'level12',
  id = 12,
  containerType = 1,
  vehicles = [{ id: 1, seats: 4, colorIndex: 2 }],
  passengers = [2, 2, 2, 2]
} = {}) {
  const vehicleSource = vehicles.map((vehicle) => `  - id: ${vehicle.id}
    seats: ${vehicle.seats}
    isHidden: 0
    isTurnVehicle: 0
    colorIndex: ${vehicle.colorIndex}
    position: {x: ${vehicle.id}, y: 0, z: 0}
    rotation: {x: 0, y: 0, z: 0, w: 1}
    containerType: ${containerType}
    containerId: 0`).join('\n');
  const passengerSource = passengers.map((colorIndex, index) => `  - queueId: ${index % 2}
    colorIndex: ${colorIndex}`).join('\n');
  return `%YAML 1.1
%TAG !u! tag:unity3d.com,2011:
--- !u!114 &11400000
MonoBehaviour:
  m_ObjectHideFlags: 0
  m_Script: {fileID: 11500000, guid: e40b6c9a941244a49037a51f0dac6d7f, type: 3}
  m_Name: ${name}
  id: ${id}
  mapScale: 1.33
  conveyorBeltName: ConveyorBelt3
  vehicles:
${vehicleSource}
  containers:
  - id: 0
    type: 1
    position: {x: 0, y: 0, z: 0}
    rotation: {x: 0, y: 0, z: 0, w: 1}
  vehicleDepthes: []
  fixedPassengerSequence:
${passengerSource}
`;
}

async function makeRoot() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'busloop-official-levels-'));
  await mkdir(path.join(root, 'Level_Escape_A'));
  await mkdir(path.join(root, 'Level_Escape_B'));
  await writeFile(path.join(root, 'Level_Escape_A', 'level12.asset'), makeAsset({ name: 'level12' }));
  await writeFile(path.join(root, 'Level_Escape_A', 'guidelevel4.asset'), makeAsset({ name: 'guidelevel4', id: 4 }));
  await writeFile(path.join(root, 'Level_Escape_A', 'level13.asset'), makeAsset({
    name: 'level13',
    id: 13,
    containerType: 4
  }));
  await writeFile(path.join(root, 'Level_Escape_B', 'level12.asset'), makeAsset({ name: 'level12' }));
  await writeFile(path.join(root, 'Level_Escape_A', 'notes.txt'), 'not a level');
  await mkdir(path.join(root, 'not-a-chapter'));
  return root;
}

test('official level keys namespace chapters and guide levels without collisions', () => {
  assert.equal(chapterCode('A'), 1);
  assert.equal(chapterCode('e'), 5);
  assert.throws(() => chapterCode('AA'), /Invalid official level chapter/);
  assert.equal(officialLevelKey('A', 12), 'level1012');
  assert.equal(officialLevelKey('B', 12), 'level2012');
  assert.equal(officialLevelKey('E', 47), 'level5047');
  assert.equal(officialLevelKey('A', 4, { guide: true }), 'level19004');
  assert.equal(officialLevelDisplayName('A', 12), 'A-12（游戏内）');
  assert.equal(officialLevelDisplayName('A', 4, { guide: true }), 'A-引导4（游戏内）');
  assert.throws(() => officialLevelKey('A', 0), /Invalid official level number/);
  assert.throws(() => officialLevelKey('A', 1000), /Invalid official level number/);
  // Chapter A/B share level numbers, so the namespace is what keeps them apart.
  assert.notEqual(officialLevelKey('A', 12), officialLevelKey('B', 12));
});

test('chapter listing ignores non-chapter folders and counts only level assets', async () => {
  const root = await makeRoot();
  const chapters = await listOfficialChapters(root);
  assert.deepEqual(chapters.map((chapter) => [chapter.id, chapter.count]), [['A', 3], ['B', 1]]);
});

test('a chapter summary renders thumbnails and flags unsupported mechanisms', async () => {
  const root = await makeRoot();
  const payload = await readOfficialChapter('A', { root });
  assert.equal(payload.id, 'A');
  assert.deepEqual(payload.items.map((item) => item.fileName), [
    'guidelevel4.asset',
    'level12.asset',
    'level13.asset'
  ]);
  const [guide, normal, unsupported] = payload.items;
  assert.equal(normal.key, 'level1012');
  assert.equal(normal.displayName, 'A-12（游戏内）');
  assert.equal(normal.status, 'ready');
  assert.equal(normal.vehicleCount, 1);
  assert.equal(normal.passengerCount, 4);
  assert.match(normal.svg, /^<svg /);
  // A layout that cannot be imported yet still shows its real layout, with the
  // blocking reason attached, instead of vanishing from the library.
  assert.equal(unsupported.status, 'unsupported');
  assert.match(unsupported.error, /container type 4/);
  assert.match(unsupported.svg, /^<svg /);
  assert.equal(guide.guide, true);
  assert.equal(guide.key, 'level19004');
  assert.equal(guide.status, 'ready');
});

test('chapter summaries are cached until a file changes', async () => {
  const root = await makeRoot();
  const first = await readOfficialChapter('A', { root });
  const second = await readOfficialChapter('A', { root });
  assert.equal(first, second);
  await writeFile(path.join(root, 'Level_Escape_A', 'level14.asset'), makeAsset({ name: 'level14', id: 14 }));
  const third = await readOfficialChapter('A', { root });
  assert.equal(third.items.length, 4);
});

test('reading one asset rejects unknown chapters and path traversal', async () => {
  const root = await makeRoot();
  const asset = await readOfficialLevelAsset('A', 'level12.asset', { root });
  assert.equal(asset.key, 'level1012');
  assert.equal(asset.fileName, 'level12.asset');
  assert.match(asset.source, /m_Name: level12/);
  await assert.rejects(() => readOfficialLevelAsset('Z', 'level12.asset', { root }), /chapter not found/);
  await assert.rejects(() => readOfficialLevelAsset('A', '../Level_Escape_B/level12.asset', { root }), /Invalid official level file/);
  await assert.rejects(() => readOfficialLevelAsset('A', 'notes.txt', { root }), /Invalid official level file/);
  await assert.rejects(() => readOfficialLevelAsset('A', 'level99.asset', { root }), /not found/);
});

test('shipped official levels live outside the persistent artifacts volume', () => {
  // artifacts/ is a Docker volume seeded once, so anything added there after the
  // first deploy never reaches the live editor. The library must ship in the image.
  assert.equal(OFFICIAL_LEVEL_ROOT, path.resolve('official-levels'));
});

test('the shared parser still reproduces a stored catalog level exactly', async () => {
  // Guards the extraction refactor: extract-unity-levels.mjs now delegates to
  // unity-level-parser.mjs, and the catalog it writes must not drift.
  const catalog = JSON.parse(await readFile('artifacts/unity-levels.json', 'utf8'));
  const stored = catalog.levels.find((level) => level.key === 'level33');
  assert.ok(stored, 'expected level33 in the generated catalog');
  const source = await readFile('artifacts/unity-level-sources/level33.asset', 'utf8');
  const parsed = parseUnityLevelSource(source, {
    fileName: 'level33.asset',
    key: 'level33',
    displayName: stored.displayName
  });
  for (const field of [
    'vehicles', 'containers', 'passengerQueues', 'mapVehicle', 'mapScale',
    'unityId', 'vehicleDepthes', 'conveyorBelts', 'vehicleAmbulances', 'mechanics'
  ]) {
    if (!(field in stored)) continue;
    assert.deepEqual(parsed[field], stored[field], `${field} drifted from the catalog`);
  }
});

test('the editor exposes a dedicated in-game level button and picker', async () => {
  const editor = await readFile('src/scene-editor.js', 'utf8');
  assert.match(editor, /editor-level-official/);
  assert.match(editor, /游戏内关卡/);
  assert.match(editor, /import\('\.\/official-levels-picker\.js'\)/);
  const picker = await readFile('src/official-levels-picker.js', 'utf8');
  assert.match(picker, /\/__official-levels/);
  assert.match(picker, /\/import/);
  // The import is a write, so it must carry the operator header.
  assert.match(picker, /levelOwnerHeaders/);
  const vite = await readFile('vite.config.js', 'utf8');
  assert.match(vite, /listOfficialChapters/);
  assert.match(vite, /readOfficialLevelAsset/);
  assert.match(vite, /\/__official-levels/);
});

test('gate queue and elevator assets expose their runtime fields', async () => {
  // E-42 is the only shipped level with elevators; E-31 has gate queues. Both
  // used to be rejected because their containers are types 4 and 5.
  const gate = await readFile('official-levels/Level_Escape_E/level31.asset', 'utf8');
  const gateLevel = parseUnityLevelSource(gate, {
    fileName: 'level31.asset', key: 'level5031', displayName: 'E-31', baseLevel: {}, validate: false
  });
  const gates = gateLevel.containers.filter((container) => container.type === 4);
  assert.equal(gates.length, 2);
  for (const container of gates) {
    assert.ok(container.gateQueuePathPoints.length >= 2, `gate ${container.id} lost its path`);
    assert.ok(container.gateQueueGap > 0, `gate ${container.id} lost its gap`);
  }

  const lift = await readFile('official-levels/Level_Escape_E/level42.asset', 'utf8');
  const liftLevel = parseUnityLevelSource(lift, {
    fileName: 'level42.asset', key: 'level5042', displayName: 'E-42', baseLevel: {}, validate: false
  });
  const elevators = liftLevel.containers.filter((container) => container.type === 5);
  assert.equal(elevators.length, 2);
  for (const container of elevators) {
    assert.ok(container.elevatorSize.x > 0 && container.elevatorSize.y > 0, `elevator ${container.id} lost its size`);
  }
  const lowerCars = liftLevel.vehicles.filter((vehicle) => vehicle.elevatorLayer === 1);
  assert.ok(lowerCars.length > 0, 'the lower floor must survive parsing');
  // Upper-floor cars carry no flag, so ordinary levels stay byte-identical.
  assert.ok(liftLevel.vehicles.some((vehicle) => vehicle.elevatorLayer === undefined));
});

test('every shipped official level passes import validation', async () => {
  // Guards the loosened rules: surplus seats and container types 4/5 must all
  // be accepted, otherwise the picker shows "暂不支持" again.
  const { validateUnityLevelSource } = await import('../scripts/unity-level-importer.mjs');
  for (const [chapter, dir] of [['A', 'Level_Escape_A'], ['B', 'Level_Escape_B'], ['E', 'Level_Escape_E']]) {
    const files = (await readdir(path.join('official-levels', dir)))
      .filter((name) => OFFICIAL_LEVEL_FILE_PATTERN.test(name));
    assert.ok(files.length > 0, `chapter ${chapter} has no assets`);
    for (const fileName of files) {
      const match = OFFICIAL_LEVEL_FILE_PATTERN.exec(fileName);
      const guide = Boolean(match[1]);
      const key = officialLevelKey(chapter, Number(match[2]), { guide });
      const source = await readFile(path.join('official-levels', dir, fileName), 'utf8');
      assert.doesNotThrow(
        () => validateUnityLevelSource({
          filename: fileName,
          source,
          targetKey: key,
          displayName: officialLevelDisplayName(chapter, Number(match[2]), { guide })
        }),
        `${dir}/${fileName} must import`
      );
    }
  }
});
