import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const DEFAULT_SUPPORT_ROOT = path.join(
  ROOT,
  'tools',
  'spatial-conveyor-import-support',
  'bus-loop-spatial-v1'
);
export const DEFAULT_OUTPUT_ROOT = path.join(ROOT, 'artifacts', 'spatial-conveyors');

const SPLINE_TYPES = Object.freeze(['catmullRom', 'bSpline', 'bezier', 'linear']);

function parseDocuments(source) {
  return source
    .split(/(?=^--- !u!)/m)
    .map((document) => {
      const header = document.match(/^--- !u!(\d+) &(-?\d+)( stripped)?/m);
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

function propertiesForTarget(source, targetGuid, targetFileId) {
  const properties = new Map();
  for (const modification of parseModifications(source)) {
    if (modification.targetGuid !== targetGuid || modification.targetFileId !== targetFileId) continue;
    properties.set(modification.propertyPath, modification.value);
  }
  return properties;
}

function getDocument(documents, fileId, label) {
  const document = documents.find((candidate) => candidate.fileId === String(fileId));
  if (!document) throw new Error(`${label} document ${fileId} is missing from the bundled support package.`);
  return document;
}

function parseInlineObject(rawValue) {
  const value = rawValue.trim().replace(/^\{/, '').replace(/\}$/, '');
  const result = {};
  for (const part of value.split(',')) {
    const separator = part.indexOf(':');
    if (separator < 0) continue;
    const key = part.slice(0, separator).trim();
    const number = Number(part.slice(separator + 1).trim());
    if (key && Number.isFinite(number)) result[key] = number;
  }
  return result;
}

function cloneValue(value) {
  return JSON.parse(JSON.stringify(value));
}

function defaultSplinePoint() {
  return {
    type: 0,
    position: { x: 0, y: 0, z: 0 },
    tangent: { x: 0, y: 0, z: 0 },
    tangent2: { x: 0, y: 0, z: 0 },
    normal: { x: 0, y: 1, z: 0 },
    size: 1,
    color: { r: 1, g: 1, b: 1, a: 1 }
  };
}

function parseDirectSpline(documentSource) {
  const lines = documentSource.split(/\r?\n/);
  const splineStart = lines.findIndex((line) => line === '  _spline:');
  if (splineStart < 0) throw new Error('The bundled main SplineComputer does not contain _spline data.');
  const spline = {
    type: 0,
    closed: false,
    sampleRate: 10,
    knotParametrization: 0,
    points: []
  };
  let currentPoint = null;
  for (let index = splineStart + 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (line.startsWith('  _originalSamplePercents:')) break;
    let match = line.match(/^    - _type: (.+)$/);
    if (match) {
      currentPoint = defaultSplinePoint();
      currentPoint.type = Number(match[1]);
      spline.points.push(currentPoint);
      continue;
    }
    match = line.match(/^      (position|tangent|tangent2|normal|color): (\{.+\})$/);
    if (match && currentPoint) {
      currentPoint[match[1]] = parseInlineObject(match[2]);
      continue;
    }
    match = line.match(/^      size: (.+)$/);
    if (match && currentPoint) {
      currentPoint.size = Number(match[1]);
      continue;
    }
    match = line.match(/^    type: (.+)$/);
    if (match) spline.type = Number(match[1]);
    match = line.match(/^    sampleRate: (.+)$/);
    if (match) spline.sampleRate = Number(match[1]);
    match = line.match(/^    closed: (.+)$/);
    if (match) spline.closed = Boolean(Number(match[1]));
    match = line.match(/^    _knotParametrization: (.+)$/);
    if (match) spline.knotParametrization = Number(match[1]);
  }
  return spline;
}

function setPointProperty(point, propertyPath, rawValue) {
  const vectorMatch = propertyPath.match(/^(position|tangent|tangent2|normal|color)\.(x|y|z|r|g|b|a)$/);
  if (vectorMatch) {
    point[vectorMatch[1]][vectorMatch[2]] = Number(rawValue);
    return;
  }
  if (propertyPath === '_type') point.type = Number(rawValue);
  if (propertyPath === 'size') point.size = Number(rawValue);
}

function applySplineOverrides(spline, properties) {
  const result = cloneValue(spline);
  const sizeValue = properties.get('_spline.points.Array.size');
  const effectiveSize = sizeValue == null ? result.points.length : Math.max(0, Number(sizeValue));
  while (result.points.length < effectiveSize) result.points.push(defaultSplinePoint());

  for (const [propertyPath, rawValue] of properties) {
    const pointMatch = propertyPath.match(/^_spline\.points\.Array\.data\[(\d+)]\.(.+)$/);
    if (pointMatch) {
      const pointIndex = Number(pointMatch[1]);
      if (pointIndex >= effectiveSize) continue;
      while (result.points.length <= pointIndex) result.points.push(defaultSplinePoint());
      setPointProperty(result.points[pointIndex], pointMatch[2], rawValue);
      continue;
    }
    if (propertyPath === '_spline.type') result.type = Number(rawValue);
    if (propertyPath === '_spline.closed') result.closed = Boolean(Number(rawValue));
    if (propertyPath === '_spline.sampleRate') result.sampleRate = Number(rawValue);
    if (propertyPath === '_spline._knotParametrization') result.knotParametrization = Number(rawValue);
  }
  result.points = result.points.slice(0, effectiveSize);
  return result;
}

function parseTransform(documentSource) {
  const read = (field, fallback) => {
    const match = documentSource.match(new RegExp(`^  ${field}: (\\{[^\\r\\n]+\\})`, 'm'));
    return match ? parseInlineObject(match[1]) : fallback;
  };
  return {
    position: read('m_LocalPosition', { x: 0, y: 0, z: 0 }),
    rotation: read('m_LocalRotation', { x: 0, y: 0, z: 0, w: 1 }),
    scale: read('m_LocalScale', { x: 1, y: 1, z: 1 })
  };
}

function parseSpriteSize(documentSource) {
  const match = documentSource.match(/^  m_Size: (\{[^\r\n]+\})/m);
  return match ? parseInlineObject(match[1]) : { x: 1, y: 1 };
}

function applyTransformOverrides(transform, properties) {
  const result = cloneValue(transform);
  for (const [propertyPath, rawValue] of properties) {
    const match = propertyPath.match(/^m_Local(Position|Rotation|Scale)\.(x|y|z|w)$/);
    if (!match) continue;
    const target = match[1] === 'Position' ? result.position : match[1] === 'Rotation' ? result.rotation : result.scale;
    target[match[2]] = Number(rawValue);
  }
  return result;
}

function readDirectNumber(documentSource, field, fallback) {
  const escapedField = field.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = documentSource.match(new RegExp(`^\\s+${escapedField}: ([^\\r\\n]+)`, 'm'));
  if (!match) return fallback;
  const value = Number(match[1]);
  return Number.isFinite(value) ? value : fallback;
}

function readOverriddenNumber(documentSource, field, properties, fallback) {
  const direct = readDirectNumber(documentSource, field, fallback);
  const rawValue = properties.get(field);
  if (rawValue == null) return direct;
  const value = Number(rawValue);
  return Number.isFinite(value) ? value : direct;
}

function parseArrayEntries(documentSource, field) {
  const lines = documentSource.split(/\r?\n/);
  const fieldIndex = lines.findIndex((line) => {
    const trimmed = line.trim();
    return trimmed === `${field}:` || trimmed === `- ${field}:`;
  });
  if (fieldIndex < 0) return [];
  const values = [];
  for (let index = fieldIndex + 1; index < lines.length; index += 1) {
    const match = lines[index].match(/^\s+- (\{.+\})$/);
    if (!match) break;
    values.push(parseInlineObject(match[1]));
  }
  return values;
}

function decodeUInt32Array(hex) {
  if (!hex) return [];
  const buffer = Buffer.from(hex, 'hex');
  const values = [];
  for (let offset = 0; offset + 4 <= buffer.length; offset += 4) values.push(buffer.readUInt32LE(offset));
  return values;
}

function parseVertexGroups(documentSource) {
  const lines = documentSource.split(/\r?\n/);
  const start = lines.findIndex((line) => line.trim() === 'vertexGroups:');
  if (start < 0) return [];
  const groups = [];
  let current = null;
  for (let index = start + 1; index < lines.length; index += 1) {
    let match = lines[index].match(/^\s+- value: (.+)$/);
    if (match) {
      current = { value: Number(match[1]), percent: 0, ids: [] };
      groups.push(current);
      continue;
    }
    match = lines[index].match(/^\s+percent: (.+)$/);
    if (match && current) current.percent = Number(match[1]);
    match = lines[index].match(/^\s+ids: ([0-9a-f]+)$/);
    if (match && current) current.ids = decodeUInt32Array(match[1]);
    if (lines[index].trim().startsWith('_mesh:')) break;
  }
  return groups;
}

function parseSplineMesh(documentSource) {
  const triangleMatch = documentSource.match(/^\s+triangles: ([0-9a-f]+)$/m);
  return {
    vertices: parseArrayEntries(documentSource, 'vertices'),
    normals: parseArrayEntries(documentSource, 'normals'),
    tangents: parseArrayEntries(documentSource, 'tangents'),
    colors: parseArrayEntries(documentSource, 'colors'),
    uv: parseArrayEntries(documentSource, 'uv'),
    indices: decodeUInt32Array(triangleMatch?.[1]),
    vertexGroups: parseVertexGroups(documentSource),
    count: readDirectNumber(documentSource, '_count', 1),
    autoCount: Boolean(readDirectNumber(documentSource, '_autoCount', 0)),
    type: readDirectNumber(documentSource, '_type', 0),
    clipFrom: readDirectNumber(documentSource, '_clipFrom', 0),
    clipTo: readDirectNumber(documentSource, '_clipTo', 1),
    spacing: readDirectNumber(documentSource, '_spacing', 0)
  };
}

function applySplineMeshOverrides(mesh, ...propertySets) {
  const result = cloneValue(mesh);
  for (const properties of propertySets) {
    const count = properties.get('_channels.Array.data[0]._count');
    const autoCount = properties.get('_channels.Array.data[0]._autoCount');
    const type = properties.get('_channels.Array.data[0]._type');
    const clipFrom = properties.get('_channels.Array.data[0]._clipFrom');
    const clipTo = properties.get('_channels.Array.data[0]._clipTo');
    const spacing = properties.get('_channels.Array.data[0]._spacing');
    if (count != null) result.count = Number(count);
    if (autoCount != null) result.autoCount = Boolean(Number(autoCount));
    if (type != null) result.type = Number(type);
    if (clipFrom != null) result.clipFrom = Number(clipFrom);
    if (clipTo != null) result.clipTo = Number(clipTo);
    if (spacing != null) result.spacing = Number(spacing);
  }
  return result;
}

function countDirectQueues(documentSource) {
  const match = documentSource.match(/^  queues:\r?\n((?:  - \{[^\r\n]+\}\r?\n)*)/m);
  return match ? (match[1].match(/^  - /gm) ?? []).length : 0;
}

function getPackageName(filename) {
  const rawFilename = String(filename ?? '');
  if (path.basename(rawFilename) !== rawFilename) {
    throw new Error('Prefab filename is not valid for the spatial conveyor package.');
  }
  const name = path.parse(rawFilename).name.trim();
  if (!name || name === '.' || name === '..' || /[<>:"/\\|?*\x00-\x1f]/.test(name)) {
    throw new Error('Prefab filename is not valid for the spatial conveyor package.');
  }
  return name;
}

function hash(value) {
  return createHash('sha256').update(value).digest('hex');
}

async function readSupportPackage(supportRoot) {
  const manifest = JSON.parse(await readFile(path.join(supportRoot, 'manifest.json'), 'utf8'));
  const [templateSource, pathsSource, loopTexture, exitTexture] = await Promise.all([
    readFile(path.join(supportRoot, manifest.files.templatePrefab), 'utf8'),
    readFile(path.join(supportRoot, manifest.files.pathsPrefab), 'utf8'),
    readFile(path.join(supportRoot, manifest.files.loopTexture)),
    readFile(path.join(supportRoot, manifest.files.exitTexture))
  ]);
  return { manifest, templateSource, pathsSource, loopTexture, exitTexture };
}

export async function buildSpatialConveyorPackage({
  filename,
  source,
  supportRoot = DEFAULT_SUPPORT_ROOT
}) {
  const packageName = getPackageName(filename);
  const support = await readSupportPackage(supportRoot);
  const { manifest, templateSource, pathsSource } = support;
  const sourcePrefab = source.match(/m_SourcePrefab: \{fileID: 100100000, guid: ([0-9a-f]+), type: 3\}/);
  if (!sourcePrefab || sourcePrefab[1] !== manifest.templateGuid) {
    throw new Error(`Unsupported spatial conveyor prefab. Expected template GUID ${manifest.templateGuid}.`);
  }

  const pathsDocuments = parseDocuments(pathsSource);
  const templateDocuments = parseDocuments(templateSource);
  const targets = manifest.targets;
  const baseSplineDocument = getDocument(pathsDocuments, targets.baseMainSpline, 'SplineComputer');
  const baseMeshDocument = getDocument(pathsDocuments, targets.baseSplineMesh, 'SplineMesh');
  const basePathsRootDocument = getDocument(pathsDocuments, targets.basePathsRootTransform, 'Paths root transform');
  const basePathTransformDocument = getDocument(pathsDocuments, targets.basePathTransform, 'Path transform');
  const templateRootDocument = getDocument(templateDocuments, targets.templateRootTransform, 'Template root transform');
  const conveyorDocument = getDocument(templateDocuments, targets.templateConveyor, 'ConveyorBelt');
  const queueGroupDocument = getDocument(templateDocuments, targets.templateQueueGroup, 'PassengerQueueGroup');
  const loopExitDocument = getDocument(templateDocuments, targets.templateLoopExitTransform, 'Loop exit transform');
  const loopExitSpriteDocument = getDocument(
    templateDocuments,
    targets.templateLoopExitSpriteRenderer,
    'Loop exit sprite renderer'
  );

  const templateSplineOverrides = propertiesForTarget(templateSource, manifest.pathsGuid, targets.baseMainSpline);
  const variantSplineOverrides = propertiesForTarget(source, manifest.templateGuid, targets.variantMainSpline);
  const spline = applySplineOverrides(
    applySplineOverrides(parseDirectSpline(baseSplineDocument.source), templateSplineOverrides),
    variantSplineOverrides
  );
  if (spline.points.length < 2) throw new Error('The imported spatial conveyor contains fewer than two effective points.');

  const templateMeshOverrides = propertiesForTarget(templateSource, manifest.pathsGuid, targets.baseSplineMesh);
  const variantMeshOverrides = propertiesForTarget(source, manifest.templateGuid, targets.variantSplineMesh);
  const mesh = applySplineMeshOverrides(
    parseSplineMesh(baseMeshDocument.source),
    templateMeshOverrides,
    variantMeshOverrides
  );
  if (!mesh.vertices.length || !mesh.indices.length || !mesh.vertexGroups.length) {
    throw new Error(
      `The bundled SplineMesh support data is incomplete ` +
      `(vertices=${mesh.vertices.length}, indices=${mesh.indices.length}, vertexGroups=${mesh.vertexGroups.length}).`
    );
  }

  const variantConveyorOverrides = propertiesForTarget(source, manifest.templateGuid, targets.variantConveyor);
  const variantQueueOverrides = propertiesForTarget(source, manifest.templateGuid, targets.variantQueueGroup);
  const directQueueCount = countDirectQueues(queueGroupDocument.source);
  const queueCount = Number(variantQueueOverrides.get('queues.Array.size') ?? directQueueCount);
  const entranceMode = queueCount === 0 ? 'direct' : 'queue';

  const pathsRootTransform = applyTransformOverrides(
    parseTransform(basePathsRootDocument.source),
    propertiesForTarget(templateSource, manifest.pathsGuid, targets.basePathsRootTransform)
  );
  const rootTransform = applyTransformOverrides(
    parseTransform(templateRootDocument.source),
    propertiesForTarget(source, manifest.templateGuid, targets.variantRootTransform)
  );
  const loopExitTransform = applyTransformOverrides(
    parseTransform(loopExitDocument.source),
    propertiesForTarget(source, manifest.templateGuid, targets.variantLoopExitTransform)
  );

  return {
    schemaVersion: 1,
    id: packageName,
    label: packageName,
    kind: 'spatial',
    supportPackage: manifest.id,
    source: {
      filename: path.basename(filename),
      sha256: hash(source),
      templateGuid: manifest.templateGuid
    },
    transforms: {
      prefabRoot: rootTransform,
      pathsRoot: pathsRootTransform,
      path: parseTransform(basePathTransformDocument.source),
      loopExit: loopExitTransform
    },
    path: {
      type: SPLINE_TYPES[spline.type] ?? `unknown:${spline.type}`,
      typeIndex: spline.type,
      closed: spline.closed,
      wrapAtEnd: !spline.closed,
      sampleRate: spline.sampleRate,
      knotParametrization: spline.knotParametrization,
      coordinateSpace: 'local',
      points: spline.points.map((point, index) => ({ id: `point-${index + 1}`, ...point }))
    },
    entrances: entranceMode === 'direct'
      ? [{ id: 'entrance-1', mode: 'direct', percent: 0 }]
      : [],
    entranceMode,
    exit: {
      startPercent: readOverriddenNumber(conveyorDocument.source, 'exitStartPercent', variantConveyorOverrides, 0.8),
      endPercent: readOverriddenNumber(conveyorDocument.source, 'exitEndPercent', variantConveyorOverrides, 0.9),
      allowWrappedEnd: Boolean(readOverriddenNumber(conveyorDocument.source, 'allowWrappedExitEnd', variantConveyorOverrides, 0)),
      directBoardingExitDistance: readOverriddenNumber(
        conveyorDocument.source,
        'directBoardingExitDistance',
        variantConveyorOverrides,
        0
      )
    },
    gameplay: {
      capacity: readOverriddenNumber(conveyorDocument.source, 'capacity', variantConveyorOverrides, 8),
      queueCount,
      directEntranceClearance: 0.9
    },
    visual: {
      type: 'dreamteckSplineMesh',
      channel: mesh,
      exitSprite: {
        size: parseSpriteSize(loopExitSpriteDocument.source)
      },
      material: {
        type: 'unlitTextureVertexColor',
        transparent: true,
        loopTextureDataUrl: `data:image/png;base64,${support.loopTexture.toString('base64')}`,
        exitTextureDataUrl: `data:image/png;base64,${support.exitTexture.toString('base64')}`
      }
    }
  };
}

export async function importSpatialConveyorPrefab({
  filename,
  source,
  supportRoot = DEFAULT_SUPPORT_ROOT,
  outputRoot = DEFAULT_OUTPUT_ROOT
}) {
  const conveyorPackage = await buildSpatialConveyorPackage({ filename, source, supportRoot });
  await mkdir(outputRoot, { recursive: true });
  const outputPath = path.resolve(outputRoot, `${conveyorPackage.id}.json`);
  const resolvedRoot = `${path.resolve(outputRoot)}${path.sep}`;
  if (!outputPath.startsWith(resolvedRoot)) throw new Error('Spatial conveyor output path escaped the package directory.');
  await writeFile(outputPath, `${JSON.stringify(conveyorPackage, null, 2)}\n`, 'utf8');
  return { conveyorPackage, outputPath };
}

function getArgument(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const input = getArgument('--input');
  const outputRoot = getArgument('--output-root') ?? DEFAULT_OUTPUT_ROOT;
  if (!input) throw new Error('Usage: node scripts/spatial-conveyor-importer.mjs --input <prefab> [--output-root <dir>]');
  const result = await importSpatialConveyorPrefab({
    filename: path.basename(input),
    source: await readFile(path.resolve(input), 'utf8'),
    outputRoot: path.resolve(outputRoot)
  });
  process.stdout.write(`${result.outputPath}\n`);
}
