import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const PATHS_GUID = '41208ecfcec40ab4c91bb084a7a0f0da';
const CONVEYOR_BELT_6_GUID = 'e138052aedf14c346ba11dca85fc0c4f';
const SPLINE_TYPES = Object.freeze(['catmullRom', 'bSpline', 'bezier', 'linear']);

function getArgument(name, fallback) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

function parseDocuments(source) {
  return source
    .split(/(?=^--- !u!)/m)
    .map((document) => {
      const header = document.match(/^--- !u!(\d+) &(\d+)( stripped)?/m);
      if (!header) return null;
      return {
        classId: Number(header[1]),
        fileId: header[2],
        stripped: Boolean(header[3]),
        source: document
      };
    })
    .filter(Boolean);
}

function parseModifications(source) {
  const modifications = [];
  const pattern = /- target: \{fileID: (-?\d+), guid: ([0-9a-f]+), type: \d+\}\r?\n\s+propertyPath: ([^\r\n]+)\r?\n\s+value:([^\r\n]*)\r?\n\s+objectReference:/g;
  for (const match of source.matchAll(pattern)) {
    modifications.push({
      targetFileId: match[1],
      targetGuid: match[2],
      propertyPath: match[3].trim(),
      value: match[4].trim()
    });
  }
  return modifications;
}

function readPrefab(prefabPath) {
  const source = fs.readFileSync(prefabPath, 'utf8');
  const documents = parseDocuments(source);
  const documentsById = new Map(documents.map((document) => [document.fileId, document]));
  const sourceObjects = new Map();
  const modificationsByInstance = new Map();

  for (const document of documents) {
    if (document.source.includes('PrefabInstance:')) {
      const groups = new Map();
      for (const modification of parseModifications(document.source)) {
        const key = `${modification.targetGuid}:${modification.targetFileId}`;
        if (!groups.has(key)) groups.set(key, new Map());
        groups.get(key).set(modification.propertyPath, modification.value);
      }
      modificationsByInstance.set(document.fileId, groups);
    }

    if (document.stripped) {
      const corresponding = document.source.match(/m_CorrespondingSourceObject: \{fileID: (-?\d+), guid: ([0-9a-f]+), type: \d+\}/);
      const instance = document.source.match(/m_PrefabInstance: \{fileID: (-?\d+)\}/);
      if (corresponding && instance) {
        sourceObjects.set(document.fileId, {
          targetFileId: corresponding[1],
          targetGuid: corresponding[2],
          instanceFileId: instance[1]
        });
      }
    }
  }

  function propertiesForLocalObject(localFileId) {
    const sourceObject = sourceObjects.get(localFileId);
    if (!sourceObject) return new Map();
    const key = `${sourceObject.targetGuid}:${sourceObject.targetFileId}`;
    return new Map(modificationsByInstance.get(sourceObject.instanceFileId)?.get(key) ?? []);
  }

  function findTargetProperties(targetGuid, targetFileId) {
    const key = `${targetGuid}:${targetFileId}`;
    for (const groups of modificationsByInstance.values()) {
      const properties = groups.get(key);
      if (properties) return new Map(properties);
    }
    return new Map();
  }

  const conveyorRoles = [];
  const queueRoles = [];
  for (const document of documents) {
    const conveyorSpline = document.source.match(/conveyorSpline: \{fileID: (-?\d+)\}/);
    if (conveyorSpline) {
      conveyorRoles.push({
        localFileId: conveyorSpline[1],
        capacity: readNumber(document.source, 'capacity'),
        speed: readNumber(document.source, 'conveyorSpeed'),
        exitStart: readNumber(document.source, 'exitStartPercent'),
        exitEnd: readNumber(document.source, 'exitEndPercent')
      });
    }

    const queueSpline = document.source.match(/queueSpline: \{fileID: (-?\d+)\}/);
    if (queueSpline) {
      queueRoles.push({
        localFileId: queueSpline[1],
        index: readNumber(document.source, 'conveyorBeltIndex'),
        capacity: readNumber(document.source, 'capacity')
      });
    }
  }

  return {
    path: prefabPath,
    source,
    documentsById,
    conveyorRoles,
    queueRoles,
    propertiesForLocalObject,
    findTargetProperties
  };
}

function readNumber(source, field) {
  const match = source.match(new RegExp(`^  ${field}: ([^\\r\\n]+)`, 'm'));
  if (!match) return undefined;
  const value = Number(match[1]);
  return Number.isFinite(value) ? value : undefined;
}

function mergeProperties(...propertySets) {
  const merged = new Map();
  for (const properties of propertySets) {
    for (const [key, value] of properties) merged.set(key, value);
  }
  return merged;
}

function extractPoints(properties, label) {
  const points = new Map();
  const pattern = /^_spline\.points\.Array\.data\[(\d+)]\.position\.(x|y|z)$/;
  for (const [propertyPath, rawValue] of properties) {
    const match = propertyPath.match(pattern);
    if (!match) continue;
    const index = Number(match[1]);
    if (!points.has(index)) points.set(index, {});
    points.get(index)[match[2]] = Number(rawValue);
  }

  const result = [...points.entries()]
    .sort(([left], [right]) => left - right)
    .map(([index, point]) => {
      if (!Number.isFinite(point.x) || !Number.isFinite(point.z)) {
        throw new Error(`${label} point ${index} is missing x or z after prefab override merging.`);
      }
      return [point.x, point.z];
    });

  if (result.length < 2) throw new Error(`${label} did not contain a usable spline.`);
  return result;
}

function extractSplineType(properties, label) {
  const typeIndex = Number(properties.get('_spline.type'));
  const splineType = SPLINE_TYPES[typeIndex];
  if (!splineType) {
    throw new Error(`${label} has an unsupported or missing _spline.type value.`);
  }
  return splineType;
}

function extractDirectLayout(prefab, metadata) {
  if (prefab.conveyorRoles.length !== 1) {
    throw new Error(`${metadata.id} expected one conveyor spline, found ${prefab.conveyorRoles.length}.`);
  }
  const conveyor = prefab.conveyorRoles[0];
  const conveyorProperties = prefab.propertiesForLocalObject(conveyor.localFileId);
  const queues = [...prefab.queueRoles].sort((left, right) => left.index - right.index);
  const queuePaths = queues
    .map((queue) => extractPoints(
      prefab.propertiesForLocalObject(queue.localFileId),
      `${metadata.id} queue ${queue.index}`
    ))
    .sort((left, right) => left[0][0] - right[0][0]);
  return {
    ...metadata,
    conveyorCapacity: conveyor.capacity,
    queueCapacities: queues.map((queue) => queue.capacity),
    exitStart: conveyor.exitStart,
    exitEnd: conveyor.exitEnd,
    splineType: extractSplineType(conveyorProperties, `${metadata.id} conveyor`),
    splinePoints: extractPoints(conveyorProperties, `${metadata.id} conveyor`),
    queuePaths
  };
}

function extractNestedLayout(scenePrefab, basePrefab, metadata) {
  if (basePrefab.conveyorRoles.length !== 1) {
    throw new Error(`${metadata.id} base expected one conveyor spline.`);
  }
  const conveyor = basePrefab.conveyorRoles[0];
  const queues = [...basePrefab.queueRoles].sort((left, right) => left.index - right.index);
  const mergedForRole = (role) => mergeProperties(
    basePrefab.propertiesForLocalObject(role.localFileId),
    scenePrefab.findTargetProperties(CONVEYOR_BELT_6_GUID, role.localFileId)
  );

  const queuePaths = queues
    .map((queue) => extractPoints(mergedForRole(queue), `${metadata.id} queue ${queue.index}`))
    .sort((left, right) => left[0][0] - right[0][0]);
  const conveyorProperties = mergedForRole(conveyor);
  return {
    ...metadata,
    conveyorCapacity: conveyor.capacity,
    queueCapacities: queues.map((queue) => queue.capacity),
    exitStart: conveyor.exitStart,
    exitEnd: conveyor.exitEnd,
    splineType: extractSplineType(conveyorProperties, `${metadata.id} conveyor`),
    splinePoints: extractPoints(conveyorProperties, `${metadata.id} conveyor`),
    queuePaths
  };
}

const unityRoot = path.resolve(getArgument('--unity-root', 'D:/UnityProjects/BusLoop'));
const prefabRoot = path.join(unityRoot, 'Assets/BusJam/Game/Bundleables/Prefabs');
const readScene = (name) => readPrefab(path.join(prefabRoot, `${name}.prefab`));

const layout2 = extractDirectLayout(readScene('GameSceneDualQueue2'), {
  id: 'dualQueue2',
  label: 'GameSceneDualQueue2',
  sourcePrefab: 'GameSceneDualQueue2.prefab',
  textureFile: 'Loop_02.png',
  spriteRect: { x: 0, y: 57, width: 2100, height: 1243, imageWidth: 2100, imageHeight: 1300 }
});
const layout3 = extractDirectLayout(readScene('GameSceneDualQueue3'), {
  id: 'dualQueue3',
  label: 'GameSceneDualQueue3',
  sourcePrefab: 'GameSceneDualQueue3.prefab',
  textureFile: 'Loop_03.png',
  spriteRect: { x: 0, y: 56, width: 2100, height: 1244, imageWidth: 2100, imageHeight: 1300 }
});
const layout5 = extractNestedLayout(
  readScene('GameSceneDualQueue5'),
  readPrefab(path.join(prefabRoot, 'ConveyorBelt6.prefab')),
  {
    id: 'dualQueue5',
    label: 'GameSceneDualQueue5',
    sourcePrefab: 'GameSceneDualQueue5.prefab + ConveyorBelt6.prefab',
    textureFile: 'Loop_06.png',
    spriteRect: { x: 0, y: 58, width: 2100, height: 1242, imageWidth: 2100, imageHeight: 1300 }
  }
);
const layout10 = extractDirectLayout(readScene('GameSceneDualQueue10'), {
  id: 'dualQueue10',
  label: 'GameSceneDualQueue10',
  sourcePrefab: 'GameSceneDualQueue10.prefab',
  textureFile: 'Loop_04.png',
  spriteRect: { x: 0, y: 57, width: 2100, height: 1243, imageWidth: 2100, imageHeight: 1300 }
});

const layouts = [layout2, layout3, layout5, layout10];
const outputPath = getArgument('--output');
const moduleOutputPath = getArgument('--module-output');
const json = `${JSON.stringify(layouts, null, 2)}\n`;
if (outputPath) {
  fs.writeFileSync(path.resolve(outputPath), json);
}
if (moduleOutputPath) {
  const layoutMap = Object.fromEntries(layouts.map((layout) => [layout.id, {
    ...layout,
    assets: {
      loopScene: `/assets/unity/conveyors/${layout.textureFile.replace(/\.png$/i, '_q80.webp')}`,
      loopSpriteRect: layout.spriteRect
    }
  }]));
  const moduleSource = `// Generated from Unity prefab overrides by scripts/extract-unity-conveyor-layouts.mjs.\n`
    + `const deepFreeze = (value) => {\n`
    + `  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;\n`
    + `  Object.freeze(value);\n`
    + `  Object.values(value).forEach(deepFreeze);\n`
    + `  return value;\n`
    + `};\n\n`
    + `export const CONVEYOR_LAYOUTS = deepFreeze(${JSON.stringify(layoutMap, null, 2)});\n\n`
    + `export const CONVEYOR_LAYOUT_IDS = Object.freeze(Object.keys(CONVEYOR_LAYOUTS));\n`
    + `export const MAX_CONVEYOR_CAPACITY = Math.max(...Object.values(CONVEYOR_LAYOUTS).map((layout) => layout.conveyorCapacity));\n`
    + `export const MAX_QUEUE_CAPACITY = Math.max(...Object.values(CONVEYOR_LAYOUTS).flatMap((layout) => layout.queueCapacities));\n\n`
    + `export function getConveyorLayout(layoutId) {\n`
    + `  return CONVEYOR_LAYOUTS[layoutId] ?? CONVEYOR_LAYOUTS.dualQueue2;\n`
    + `}\n`;
  fs.writeFileSync(path.resolve(moduleOutputPath), moduleSource);
}
if (!outputPath && !moduleOutputPath) {
  process.stdout.write(json);
}
