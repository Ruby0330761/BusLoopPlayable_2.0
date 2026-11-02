import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import zlib from 'node:zlib';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import {
  MECHANISM_ASSETS,
  MECHANISM_RESOURCE_MANIFEST,
  MECHANISM_TYPES,
  deriveLevelMechanics,
  getMechanismResourcePaths,
  getMechanismTypesForLevels
} from '../src/mechanism-resources.js';
import { COLORS } from '../src/level-data.js';
import { getSpecialVehicleColorIndex, isSpecialVehicle } from '../src/level-editor-model.js';
import { validateUnityLevelSource } from '../scripts/unity-level-importer.mjs';

const CHRISTMAS_ROOT = 'public/assets/unity/christmas';

// FBXLoader reaches for a DOM Image while parsing embedded texture references,
// which the shipped files all carry. A no-op stub is enough for geometry-only
// assertions; no texture is ever decoded here.
globalThis.document ??= {
  createElementNS: () => ({ addEventListener() {}, removeEventListener() {} }),
  createElement: () => ({ getContext: () => null })
};

// Shipped FBX files come in two forms: Arrow_01 is gzip-compressed, Arrow_06 is
// plain Kaydara binary. Normalise before handing either to FBXLoader.
function readFbxBytes(file) {
  let buffer = readFileSync(file);
  if (buffer[0] === 0x1f && buffer[1] === 0x8b) buffer = zlib.gunzipSync(buffer);
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
}

test('christmas sled resources are shipped under their own directory', () => {
  for (const path of MECHANISM_RESOURCE_MANIFEST[MECHANISM_TYPES.christmas]) {
    assert.equal(existsSync(`public${path}`), true, path);
    assert.match(path, /^\/assets\/unity\/christmas\//);
  }
});

test('christmas asset entry names every file the loader fetches', () => {
  const assets = MECHANISM_ASSETS.christmas;
  // The FBX is authored with three material slots that all bind the delivered
  // atlas, so the vehicle and passenger share a single texture file.
  assert.equal(assets.vehicleTexture, assets.passengerTexture);
  const paths = [...new Set(Object.values(assets))];
  for (const path of paths) {
    assert.equal(
      MECHANISM_RESOURCE_MANIFEST[MECHANISM_TYPES.christmas].includes(path),
      true,
      `export whitelist is missing ${path}`
    );
    assert.equal(existsSync(`public${path}`), true, path);
  }
});

test('converted Santa VAT binaries keep the runtime container contract', () => {
  const mesh = readFileSync(`${CHRISTMAS_ROOT}/models/Idle_boy_Santa_vatmesh.bin`);
  assert.equal(mesh.subarray(0, 4).toString('ascii'), 'VATM');
  assert.equal(mesh.readUInt32LE(4), 2, 'VATM v2 carries the explicit vatIndex array');
  const vertexCount = mesh.readUInt32LE(8);
  const indexCount = mesh.readUInt32LE(12);
  assert.equal(vertexCount, 621);
  assert.equal(indexCount, 3066);
  // 16-byte header + position/normal/uv + indices + vatIndex, all 32-bit.
  assert.equal(mesh.length, 16 + vertexCount * (3 + 3 + 2) * 4 + indexCount * 4 + vertexCount * 4);

  // vatIndex is the animation column and `loadVatGeometry` reads it as uint32.
  // Storing it as float32 would turn 1.0 into 1065353216, the shader would
  // sample an absurd UV, and every vertex would collapse — the passenger
  // becomes invisible while its shadow still draws.
  const vatIndexOffset = 16 + vertexCount * 8 * 4 + indexCount * 4;
  for (const index of [0, 1, 2, 3, vertexCount - 1]) {
    assert.equal(
      mesh.readUInt32LE(vatIndexOffset + index * 4),
      index,
      `vatIndex[${index}] must be the plain integer column index`
    );
  }

  const atlas = readFileSync(`${CHRISTMAS_ROOT}/models/Idle_boy_Santa_anim_map.vatq`);
  assert.equal(atlas.subarray(0, 4).toString('ascii'), 'VATQ');
  assert.equal(atlas.readUInt32LE(4), 1);
  assert.equal(atlas.readUInt32LE(8), vertexCount);
  assert.equal(atlas.readUInt32LE(12), 102, 'the supplied clips span 102 frame rows');
});

test('christmas vehicles classify as a mechanism family', () => {
  const metadata = deriveLevelMechanics({
    vehicles: [{ mechanism: { type: 'christmas' } }, { colorIndex: 16 }]
  });
  assert.equal(metadata.isMechanicLevel, true);
  assert.equal(metadata.counts.christmas, 2);
  assert.equal(metadata.types.includes(MECHANISM_TYPES.christmas), true);
  assert.equal(
    getMechanismTypesForLevels([{ vehicles: [{ colorIndex: 16 }] }]).includes(MECHANISM_TYPES.christmas),
    true
  );
  assert.equal(
    getMechanismResourcePaths([MECHANISM_TYPES.christmas]).length,
    MECHANISM_RESOURCE_MANIFEST[MECHANISM_TYPES.christmas].length
  );
});

test('colour index 16 is the Christmas runtime vehicle type', () => {
  assert.equal(COLORS[16].name, 'Christmas');
  assert.equal(getSpecialVehicleColorIndex('christmas'), 16);
  assert.equal(isSpecialVehicle({ mechanism: { type: 'christmas' } }), true);
  assert.equal(isSpecialVehicle({ colorIndex: 16 }), true);

  // The Unity importer must accept a level that paints cars with index 16, the
  // same way it already accepts the ambulance (13) and luxury (15) slots.
  const source = readFileSync('test/unity-level-importer.test.js', 'utf8');
  assert.match(source, /vehicleColorIndex/);
  assert.match(
    readFileSync('scripts/unity-level-importer.mjs', 'utf8'),
    /CHRISTMAS_COLOR_INDEX = 16/
  );
  assert.doesNotThrow(() => validateUnityLevelSource({
    filename: 'level16.asset',
    source: `%YAML 1.1
%TAG !u! tag:unity3d.com,2011:
--- !u!114 &11400000
MonoBehaviour:
  m_ObjectHideFlags: 0
  m_Script: {fileID: 11500000, guid: e40b6c9a941244a49037a51f0dac6d7f, type: 3}
  m_Name: level16
  id: 16
  mapScale: 1
  vehicles:
  - id: 1
    seats: 4
    isHidden: 0
    isTurnVehicle: 0
    colorIndex: 16
    priority: 0
    position: {x: 0, y: 0, z: 0}
    rotation: {x: 0, y: 0, z: 0, w: 1}
    containerType: 1
    containerId: 0
  containers:
  - id: 0
    type: 1
    position: {x: 0, y: 0, z: 0}
    rotation: {x: 0, y: 0, z: 0, w: 1}
  vehicleLinkages: []
  vehicleWrenches: []
  vehicleCombinations: []
  vehicleAmbulances: []
  vehicleFiretrucks: []
  vehicleAnchors: []
  vehiclePassengerLocations: []
  vehicleDepthes: []
  fixedPassengerSequence:
  - queueId: 0
    colorIndex: 16
  - queueId: 1
    colorIndex: 16
  - queueId: 0
    colorIndex: 16
  - queueId: 1
    colorIndex: 16
`
  }));
});

test('christmas rendering is wired into the scene view', () => {
  const source = readFileSync('src/scene-view.js', 'utf8');
  assert.match(source, /const CHRISTMAS_COLOR_INDEX = 16/);
  assert.match(source, /CHRISTMAS_PASSENGER_ANIMATIONS/);
  assert.match(source, /loadChristmasAssets\(\)/);
  assert.match(source, /this\.hasChristmasVehicles\(\)/);
  assert.match(source, /christmasPassengerVat/);
  assert.match(source, /type: 'christmas'/);
  assert.match(source, /this\.christmasArrowTemplate/);
  // The Christmas passenger must never be repainted with a queue colour.
  assert.match(source, /!root\.userData\.specialPassengerType/);
});

test('the Christmas arrow is flipped to match the shipped arrow direction', () => {
  // Arrow_06's tip points at +Z; Arrow_01's (every other vehicle family) points
  // at -Z. Without a 180° correction the sled's marker contradicted its own
  // driving direction. The flip has to happen on the source before the geometry
  // is baked, because `toStaticMeshGroup` copies each child's matrixWorld —
  // rotating the resulting template would stack with the shared
  // `facing.arrowYawDegrees` instead and cancel out.
  const source = readFileSync('src/scene-view.js', 'utf8');
  const block = source.slice(
    source.indexOf('Arrow_06 ships without UVs'),
    source.indexOf('this.christmasArrowTemplate = normalizeObject')
  );
  assert.match(block, /arrowFbx\.rotation\.y = Math\.PI/);
  assert.doesNotMatch(block, /const christmasArrow = toStaticMeshGroup/);

  // The baked geometry must then point the same way as Arrow_01.
  const tipEnd = (file) => {
    const obj = new FBXLoader().parse(readFbxBytes(file), '');
    obj.updateMatrixWorld(true);
    let mesh = null;
    obj.traverse((child) => { if (!mesh && child.isMesh) mesh = child; });
    const geometry = mesh.geometry.clone();
    geometry.applyMatrix4(mesh.matrixWorld);
    geometry.computeBoundingBox();
    const box = geometry.boundingBox;
    const pos = geometry.attributes.position;
    const bins = 10;
    const width = Array.from({ length: bins }, () => ({ min: Infinity, max: -Infinity, n: 0 }));
    for (let i = 0; i < pos.count; i += 1) {
      const t = (pos.getZ(i) - box.min.z) / Math.max(box.max.z - box.min.z, 1e-6);
      const bin = Math.min(bins - 1, Math.max(0, Math.floor(t * bins)));
      width[bin].min = Math.min(width[bin].min, pos.getX(i));
      width[bin].max = Math.max(width[bin].max, pos.getX(i));
      width[bin].n += 1;
    }
    const widths = width.map((entry) => (entry.n ? entry.max - entry.min : null));
    return widths[0] < widths[bins - 1] ? '-Z' : '+Z';
  };
  assert.equal(tipEnd('public/assets/unity/models/Arrow_01.fbx'), '-Z');
  assert.equal(tipEnd('public/assets/unity/christmas/models/Arrow_06.fbx'), '+Z',
    'the source still points the other way; the 180° flip in scene-view is what corrects it');
});

test('packagers rewrite the Christmas asset root, not only the mechanism root', () => {
  // Mechanism art is addressed as `${ROOT}/models/...`, so a full URL never
  // appears in the bundle and the plain URL replacement cannot inline it. The
  // AppLovin packager rewrote only /assets/unity/mechanisms, so a sled level
  // shipped with its passenger atlas still pointing at a root-relative URL:
  // the runtime gate caught a 404 for
  // /assets/unity/christmas/textures/Idle_boy_Santa.png.
  const packager = readFileSync('scripts/package-applovin-single-html.mjs', 'utf8');
  const roots = packager.slice(
    packager.indexOf('const DYNAMIC_MECHANISM_ROOTS'),
    packager.indexOf('function replaceBundledDynamicAssetUrls')
  );
  assert.match(roots, /'\/assets\/unity\/mechanisms'/);
  assert.match(roots, /'\/assets\/unity\/christmas'/);
  const replacer = packager.slice(
    packager.indexOf('function replaceBundledDynamicAssetUrls'),
    packager.indexOf('function reuseDocumentImageAsset')
  );
  assert.match(replacer, /for \(const root of DYNAMIC_MECHANISM_ROOTS\)/);
  assert.doesNotMatch(replacer, /startsWith\('\/assets\/unity\/mechanisms\/'\)/);
});

test('the runtime gate fails when Unity assets fall back to untextured geometry', () => {
  // A missing asset used to be invisible: the scene keeps drawing untextured
  // boxes, the canvas is non-blank, and every check passed. One build shipped
  // that way (the sled and all vehicle models were missing). The gate now reads
  // the flag the scene already sets.
  const gate = readFileSync('scripts/check-playable-runtime.mjs', 'utf8');
  const scene = readFileSync('src/scene-view.js', 'utf8');
  assert.match(scene, /this\.unityAssetsFailed = true/);
  assert.match(scene, /this\.unityAssetsError = String\(/);
  assert.match(gate, /unityAssetsFailed/);
  assert.match(gate, /RUNTIME-ASSETS-001/);
  assert.match(gate, /readiness\.unityAssetsFailed !== true/);
});
