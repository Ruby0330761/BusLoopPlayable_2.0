import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import * as THREE from 'three';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const PATHS_GUID = '41208ecfcec40ab4c91bb084a7a0f0da';

function documents(source) {
  return source.split(/(?=^--- !u!)/m).filter((s) => /^--- !u!/m.test(s));
}

function vector(source, field, axes = 'xyz') {
  const value = source.match(new RegExp(`^\\s*${field}: \\{([^}]+)\\}`, 'm'))?.[1];
  if (!value) throw new Error(`Missing Unity vector ${field}`);
  return [...axes].map((axis) => {
    const number = Number(value.match(new RegExp(`${axis}: ([^,}]+)`))?.[1]);
    if (!Number.isFinite(number)) throw new Error(`Invalid ${field}.${axis}`);
    return number;
  });
}

function overrides(source, guid, fileId) {
  const result = new Map();
  const pattern = /- target: \{fileID: (-?\d+), guid: ([a-f0-9]+), type: \d+\}\r?\n\s+propertyPath: ([^\r\n]+)\r?\n\s+value:([^\r\n]*)/g;
  for (const [, id, targetGuid, property, value] of source.matchAll(pattern)) {
    if (guid === targetGuid && fileId === id) result.set(property.trim(), value.trim());
  }
  return result;
}

function transform(source, changes = new Map()) {
  const result = {};
  for (const [key, axes] of [['Position', 'xyz'], ['Rotation', 'xyzw'], ['Scale', 'xyz']]) {
    result[key.toLowerCase()] = vector(source, `m_Local${key}`, axes).map((value, i) => (
      changes.has(`m_Local${key}.${axes[i]}`) ? Number(changes.get(`m_Local${key}.${axes[i]}`)) : value
    ));
  }
  return result;
}

function matrix(t) {
  return new THREE.Matrix4().compose(
    new THREE.Vector3(...t.position), new THREE.Quaternion(...t.rotation).normalize(), new THREE.Vector3(...t.scale)
  );
}

export function extractFootage8Paths(prefab, base) {
  const baseDocs = documents(base);
  const prefabDocs = documents(prefab);
  const get = (docs, id) => {
    const doc = docs.find((s) => new RegExp(`^--- !u!\\d+ &${id}\\s*$`, 'm').test(s));
    if (!doc) throw new Error(`Missing referenced Unity object ${id}`);
    return doc;
  };
  const root = prefabDocs.find((s) => /m_Father: \{fileID: 0\}/.test(s) && /\nTransform:/.test(s));
  if (!root) throw new Error('Footage8 root transform is missing');
  const rootMatrix = matrix(transform(root));
  const pathsRoot = get(baseDocs, '4430868751275791235');
  const pathsMatrix = rootMatrix.clone().multiply(matrix(transform(pathsRoot, overrides(prefab, PATHS_GUID, '4430868751275791235'))));
  const spline = (id) => {
    const doc = get(baseDocs, id);
    const props = overrides(prefab, PATHS_GUID, id);
    const pointSource = doc.match(/^    points:\r?\n([\s\S]*?)(?=^    \w)/m)?.[1];
    if (!pointSource) throw new Error(`Missing points in spline ${id}`);
    const positions = [...pointSource.matchAll(/^      position: \{([^}]+)\}/gm)].map((m) => vector(`position: {${m[1]}}`, 'position'));
    const count = Number(props.get('_spline.points.Array.size') ?? positions.length);
    if (!Number.isInteger(count) || count < 2) throw new Error(`Invalid point count for ${id}`);
    // Unity serializes stale Array.data entries after reducing an array's size.
    // Its effective size wins over the highest override index.
    const points = Array.from({ length: count }, (_, i) => [...'xyz'].map((axis, j) => {
      const value = Number(props.get(`_spline.points.Array.data[${i}].position.${axis}`) ?? positions[i]?.[j]);
      if (!Number.isFinite(value)) throw new Error(`Missing inherited ${id} point ${i}.${axis}`);
      return value;
    }));
    const objectId = doc.match(/m_GameObject: \{fileID: (\d+)\}/)[1];
    const pathTransform = baseDocs.find((s) => /\nTransform:/.test(s) && s.includes(`m_GameObject: {fileID: ${objectId}}`));
    const transformId = pathTransform?.match(/^--- !u!4 &(\d+)/m)?.[1];
    if (!transformId) throw new Error(`Missing transform for ${id}`);
    const coordinateSpace = Number(props.get('_space') ?? doc.match(/^  _space: (\d+)/m)?.[1]);
    if (coordinateSpace !== 1) throw new Error(`Unsupported coordinate space in ${id}`);
    const fullMatrix = pathsMatrix.clone().multiply(matrix(transform(pathTransform, overrides(prefab, PATHS_GUID, transformId))));
    return {
      type: Number(props.get('_spline.type') ?? doc.match(/^    type: (\d+)/m)?.[1]),
      points: points.map((p) => new THREE.Vector3(...p).applyMatrix4(fullMatrix).toArray())
    };
  };
  const main = spline('6402202711996024418');
  // Keep the authored queue-to-passenger association: index 0 is Queue_Left.
  const queues = [spline('9172664068133743175'), spline('277259034235598063')];
  const box = new THREE.Box3().setFromPoints(main.points.map((p) => new THREE.Vector3(...p)));
  const pivot = box.getCenter(new THREE.Vector3());
  pivot.y = box.min.y;
  return { main, queues, pivot: pivot.toArray(), rootMatrix };
}

export async function generateFootageConveyor({ footage = 8, modelSpecs } = {}) {
  const id = `footage${footage}`;
  const SOURCE = path.join(ROOT, `artifacts/${id}-source`);
  const OUTPUT = path.join(ROOT, `public/assets/unity/conveyors/${id}`);
  const [prefab, base, meta] = await Promise.all([
    readFile(path.join(SOURCE, `ConveyorBelt_Footage${footage}.prefab`), 'utf8'),
    readFile(path.join(SOURCE, 'dependencies/Paths.prefab'), 'utf8'),
    readFile(path.join(SOURCE, 'dependencies/Paths.prefab.meta'), 'utf8')
  ]);
  if (!meta.includes(`guid: ${PATHS_GUID}`)) throw new Error('Base Paths GUID mismatch');
  const extracted = extractFootage8Paths(prefab, base);
  await mkdir(OUTPUT, { recursive: true });
  modelSpecs ??= [
    { file: 'Loop_footage8.FBX', guid: 'b792f72c3adea944d9ebd6d814a71f26', texture: 'Loop_footage.png', shadow: false },
    { file: 'Loop_footage8_shadow.FBX', guid: 'aa77b2de5e537b94298a7f935c7455f3', texture: 'Loop_footage8_shadow.png', shadow: true }
  ];
  const meshes = [];
  // Texture pixels are copied separately; the Node-side converter never opens
  // the original FBX's author-machine texture paths.
  const originalLoad = THREE.TextureLoader.prototype.load;
  THREE.TextureLoader.prototype.load = () => new THREE.Texture();
  try {
    for (const spec of modelSpecs) {
      const data = await readFile(path.join(SOURCE, spec.file));
      const fbx = new FBXLoader().parse(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength), '');
      const instance = documents(prefab).find((s) => s.includes(`m_SourcePrefab: {fileID: 100100000, guid: ${spec.guid}`));
      if (!instance) throw new Error(`Missing ${spec.file} prefab instance`);
      const props = overrides(instance, spec.guid, '-8679921383154817045');
      const sourceTransform = {};
      for (const [key, axes] of [['Position', 'xyz'], ['Rotation', 'xyzw'], ['Scale', 'xyz']]) {
        sourceTransform[key.toLowerCase()] = [...axes].map((axis) => {
          const value = props.get(`m_Local${key}.${axis}`);
          // Model scale is inherited from its verified FBX import settings.
          if (value === undefined && key !== 'Scale') throw new Error(`Missing ${spec.file} ${key}.${axis}`);
          return value === undefined ? 1 : Number(value);
        });
      }
      const meshMatrix = extracted.rootMatrix.clone().multiply(matrix(sourceTransform));
      // FBX right-handed geometry -> Unity's left-handed local mesh. Prefab
      // instance transforms replace the model's FBX root transform.
      meshMatrix.multiply(new THREE.Matrix4().makeScale(-1, 1, 1));
      fbx.traverse((node) => {
        if (!node.isMesh) return;
        const geometry = node.geometry.clone().applyMatrix4(meshMatrix);
        geometry.uuid = spec.guid;
        const count = geometry.attributes.position.count;
        const indices = geometry.index ? Array.from(geometry.index.array) : Array.from({ length: count }, (_, i) => i);
        for (let i = 0; i < indices.length; i += 3) [indices[i + 1], indices[i + 2]] = [indices[i + 2], indices[i + 1]];
        geometry.setIndex(indices);
        meshes.push({ name: node.name, shadow: spec.shadow, geometry: geometry.toJSON() });
      });
      await writeFile(path.join(OUTPUT, spec.texture), await readFile(path.join(SOURCE, spec.texture)));
    }
  } finally {
    THREE.TextureLoader.prototype.load = originalLoad;
  }
  await writeFile(path.join(OUTPUT, 'track.mesh.bin'), gzipSync(JSON.stringify({ meshes }), { level: 9 }));
  const layout = {
    id, label: `Footage${footage}（立体双入口）`, kind: 'model', sourcePrefab: `ConveyorBelt_Footage${footage}.prefab`,
    // Retain the ordinary baseline's 32 slots; importing art must not silently
    // apply Unity's 52 slots, which exceed this prefab's 18+18 initial queues.
    conveyorCapacity: 32, queueCapacities: [18, 18],
    exitStart: Number(prefab.match(/^  exitStartPercent: (.+)$/m)?.[1]),
    exitEnd: Number(prefab.match(/^  exitEndPercent: (.+)$/m)?.[1]),
    splineType: 'bSpline', splinePoints: extracted.main.points.map(([x, , z]) => [x, z]),
    queuePaths: extracted.queues.map((q) => q.points.map(([x, , z]) => [x, z])),
    points3D: extracted.main.points, queuePoints3D: extracted.queues.map((q) => q.points), pivot: extracted.pivot,
    assets: { loopScene: `/assets/unity/conveyors/${id}/${modelSpecs[0].texture}`, model: `/assets/unity/conveyors/${id}/track.mesh.bin`, shadowTexture: `/assets/unity/conveyors/${id}/${modelSpecs[1].texture}` },
    source: { sha256: createHash('sha256').update(prefab).digest('hex'), unityConveyorCapacity: Number(prefab.match(/^  capacity: (\d+)\r?\n  exitStartPercent:/m)?.[1]) }
  };
  const module = `// Generated by scripts/extract-footage${footage}-conveyor.mjs; source and repository provenance live in artifacts/${id}-source/.\nexport const FOOTAGE${footage}_LAYOUT = ${JSON.stringify(layout, null, 2)};\n`;
  await writeFile(path.join(ROOT, `src/generated-${id}-layout.js`), module);
  console.log(`Footage${footage}: ${layout.points3D.length} belt points, ${layout.queuePaths.map((p) => p.length).join('/')} queue points, ${meshes.length} meshes.`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await generateFootageConveyor();
