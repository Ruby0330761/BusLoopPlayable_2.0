import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { gunzipSync, gzipSync } from 'node:zlib';
import { LoadingManager, Texture } from 'three';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { stripUnreferencedFbxDisplayLayers as strip } from '../scripts/playable-fbx-display-layers.mjs';

function sceneSnapshot(node) {
  const { geometry } = node;
  return {
    type: node.type, name: node.name, visible: node.visible, matrix: node.matrix.toArray(),
    geometry: geometry && {
      attributes: Object.fromEntries(Object.entries(geometry.attributes).map(([name, value]) => [
        name, { itemSize: value.itemSize, array: value.array, normalized: value.normalized }
      ])),
      index: geometry.index?.array,
      groups: geometry.groups
    },
    materials: node.material && [node.material].flat().map(material => ({
      type: material.type, name: material.name, color: material.color?.toArray(),
      side: material.side, opacity: material.opacity, map: material.map?.userData.source
    })),
    animations: (node.animations ?? []).map(({ name, duration, tracks }) => ({
      name, duration, tracks: tracks.map(({ name, times, values }) => ({ name, times, values }))
    })),
    children: node.children.map(sceneSnapshot)
  };
}

test('shipped binary, packed .fbx.bin and ASCII model cleanup preserves the Three.js scene', async t => {
  const manager = new LoadingManager();
  manager.addHandler(/.*/u, {
    path: '',
    setPath(value) { this.path = value; return this; },
    load(source) {
      const texture = new Texture();
      texture.userData.source = source;
      return texture;
    }
  });
  const loader = new FBXLoader(manager);
  const decode = bytes => {
    const raw = gunzipSync(bytes);
    return loader.parse(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.length), '');
  };
  const window = globalThis.window;
  globalThis.window = { URL };
  t.after(() => { globalThis.window = window; });
  for (const [file, removedLayers] of [
    ['models/Arrow_01.fbx', 712], ['models/Bus_001.fbx', 712], ['models/Van_001.fbx', 712],
    ['models/Shadow_01.fbx', 711], ['models/Idle_boy01.fbx', 1],
    ['mechanisms/hidden-vehicle/models/questionmark.fbx.bin', 712],
    ['mechanisms/police/models/Idle_boy_police.fbx', 1]
  ]) {
    const source = await readFile('public/assets/unity/' + file);
    const result = strip(source);
    assert.equal(result.removedLayers, removedLayers, file);
    assert.deepEqual(sceneSnapshot(decode(result.bytes)), sceneSnapshot(decode(source)), file);
    assert.equal(strip(result.bytes).bytes, result.bytes, file);
  }
});

test('the parser preserves layers referenced at either end and keeps other collection types', () => {
  const lines = [
    '; FBX 7.7.0 project file', 'Definitions: {', '\tCount: 6', '\tObjectType: "CollectionExclusive" {',
    '\t\tCount: 4', '\t}', '}', 'Objects: {', '\tModel: 1, "Model::Car", "Mesh" {', '\t}',
    '\tCollectionExclusive: 2, "DisplayLayer::Unused", "DisplayLayer" {', '\t}',
    '\tCollectionExclusive: 3, "DisplayLayer::Destination", "DisplayLayer" {', '\t}',
    '\tCollectionExclusive: 4, "DisplayLayer::Source", "DisplayLayer" {', '\t}',
    '\tCollectionExclusive: 5, "Other::Keep", "OtherType" {', '\t}',
    '}', 'Connections: {', '\tC: "OO",1,3', '\tC: "OO",4,1', '}', ''
  ];
  const source = Buffer.from(lines.join('\r\n'));
  const result = strip(source);
  assert.equal(result.removedLayers, 1);
  const expected = source.toString().replace('\tCollectionExclusive: 2, "DisplayLayer::Unused", "DisplayLayer" {\r\n\t}', '')
    .replace('Count: 6', 'Count: 5').replace('Count: 4', 'Count: 3');
  assert.equal(result.bytes.toString(), expected);

  const unknownLink = Buffer.from(source.toString().replace('C: "OO",1,3', 'UnknownLink: 1,3'));
  const brokenGzip = gzipSync(source).subarray(0, -10);
  for (const bytes of [unknownLink, brokenGzip]) {
    assert.equal(strip(bytes).bytes, bytes);
    assert.equal(strip(bytes).reason, 'unsupported-fbx-structure');
  }
});
