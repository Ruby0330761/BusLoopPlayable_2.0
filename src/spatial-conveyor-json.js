export const MAX_SPATIAL_PACKAGE_BYTES = 4 * 1024 * 1024;

const vector = (value, axes = 'xyz') => [...axes].every((axis) => Number.isFinite(value?.[axis]));
const percent = (value) => Number.isFinite(value) && value >= 0 && value <= 1;
const positiveInt = (value) => Number.isSafeInteger(value) && value > 0;
export const isSpatialImportId = (id) => typeof id === 'string' && /^[A-Za-z0-9._-]{1,120}$/u.test(id) && id !== '.' && id !== '..';

function embeddedPng(value) {
  if (typeof value !== 'string' || !/^data:image\/png;base64,iVBORw0KGgo[A-Za-z0-9+/]+=*$/u.test(value)) return false;
  try {
    const bytes = atob(value.slice(22));
    const header = Uint8Array.from(bytes.slice(0, 24), (c) => c.charCodeAt(0));
    const view = new DataView(header.buffer);
    const width = view.getUint32(16);
    const height = view.getUint32(20);
    return bytes.slice(12, 16) === 'IHDR' && bytes.slice(-8, -4) === 'IEND'
      && width > 0 && height > 0 && width <= 4096 && height <= 4096;
  } catch {
    return false;
  }
}

export function validateSpatialJsonImport(data) {
  if (data?.schemaVersion !== 1 || data.kind !== 'spatial' || data.supportPackage !== 'bus-loop-spatial-v1'
      || data.visual?.type !== 'dreamteckSplineMesh') throw new Error('请选择 v1 立体轨道 JSON 文件');
  if (!isSpatialImportId(data.id)) {
    throw new Error('轨道 ID 需使用字母、数字、点、短横线或下划线（最多 120 位）');
  }
  if (data.label != null && typeof data.label !== 'string') throw new Error('轨道名称必须是文本');
  const points = data.path?.points;
  if (!Array.isArray(points) || points.length < 3 || points.length > 2000) throw new Error('路径需要 3 到 2000 个轨道点');
  const ids = new Set();
  for (const point of points) {
    if (typeof point?.id !== 'string' || !point.id || ids.has(point.id)
      || !vector(point.position) || !Number.isFinite(point.size) || point.size <= 0
      || ['tangent', 'tangent2', 'normal'].some((key) => point[key] != null && !vector(point[key]))) {
      throw new Error('轨道点需要唯一 ID、有效坐标和正宽度');
    }
    ids.add(point.id);
  }
  for (const name of ['prefabRoot', 'pathsRoot', 'path', 'loopExit']) {
    const t = data.transforms?.[name];
    if (!vector(t?.position) || !vector(t?.scale) || !vector(t?.rotation, 'xyzw')) throw new Error('轨道变换数据不完整');
  }
  if (data.path.editorPivot != null && !vector(data.path.editorPivot)) throw new Error('轨道中心坐标无效');
  const anchor = data.exit?.visualAnchor;
  if (anchor != null && (!vector(anchor.position) || !vector(anchor.normal) || !vector(anchor.tangent)
      || !Number.isFinite(anchor.size) || anchor.size <= 0)) throw new Error('出口锚点无效');
  if (!percent(data.exit?.startPercent) || !percent(data.exit?.endPercent) || !Array.isArray(data.entrances)
      || !data.entrances.every((e) => percent(e?.percent)) || !positiveInt(data.gameplay?.capacity)) {
    throw new Error('进出口或轨道容量无效');
  }
  const mesh = data.visual.channel;
  if (!positiveInt(mesh?.count) || !Array.isArray(mesh.vertices) || mesh.vertices.length < 3
      || mesh.vertices.length > 16384 || mesh.count * mesh.vertices.length > 250000
      || !mesh.vertices.every((v) => vector(v)) || !Array.isArray(mesh.indices) || !mesh.indices.length
      || mesh.indices.length % 3 || mesh.count * mesh.indices.length > 750000
      || !mesh.indices.every((i) => Number.isInteger(i) && i >= 0 && i < mesh.vertices.length)) {
    throw new Error('轨道截面网格无效或超出编辑器支持的大小');
  }
  for (const [key, axes] of [['normals', 'xyz'], ['colors', 'rgba'], ['uv', 'xy']]) {
    if (mesh[key] != null && (!Array.isArray(mesh[key]) || !mesh[key].every((v) => vector(v, axes)))) {
      throw new Error('轨道截面属性无效');
    }
  }
  if (!embeddedPng(data.visual.material?.loopTextureDataUrl) || !embeddedPng(data.visual.material?.exitTextureDataUrl)) {
    throw new Error('轨道和出口需要有效的内嵌 PNG 贴图（最大 4096 × 4096）');
  }
}
