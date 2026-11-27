import { Vector2 } from 'three';

const strokeData = new WeakMap();

export function roofArrowStrokeRatio(scale) {
  const amount = Math.max(0, scale - 1);
  return 0.065 * amount / (0.035 + amount);
}

// FBX triangles can duplicate vertices along UV seams. Match their XZ positions
// before finding the outline, so interior diagonals never become stroke edges.
export function createRoofArrowOutline(source) {
  const position = source.getAttribute('position');
  const points = new Map();
  const vertices = [];
  for (let i = 0; i < position.count; i++) {
    const x = position.getX(i), z = position.getZ(i);
    const key = Math.round(x * 1e5) + ',' + Math.round(z * 1e5);
    if (!points.has(key)) points.set(key, { id: points.size, point: new Vector2(x, z), normals: [] });
    vertices.push(points.get(key));
  }
  const edges = new Map();
  const vertexAt = i => vertices[source.index ? source.index.getX(i) : i];
  for (let i = 0; i < (source.index?.count ?? position.count); i += 3) {
    const a = vertexAt(i), b = vertexAt(i + 1), c = vertexAt(i + 2);
    const ab = b.point.clone().sub(a.point), ac = c.point.clone().sub(a.point);
    const winding = Math.sign(ab.cross(ac));
    if (!winding) continue;
    for (const [start, end] of [[a, b], [b, c], [c, a]]) {
      const key = Math.min(start.id, end.id) + ':' + Math.max(start.id, end.id);
      if (edges.has(key)) { edges.set(key, null); continue; }
      const dir = end.point.clone().sub(start.point);
      const normal = new Vector2(dir.y, -dir.x).normalize().multiplyScalar(winding);
      edges.set(key, { start, end, normal });
    }
  }
  for (const edge of edges.values()) {
    if (!edge) continue;
    edge.start.normals.push(edge.normal);
    edge.end.normals.push(edge.normal);
  }
  for (const vertex of points.values()) {
    const [a, b = a] = vertex.normals;
    vertex.miter = a ? a.clone().add(b).divideScalar(Math.max(0.001, 1 + a.dot(b))).clampLength(0, 2) : new Vector2();
  }
  const geometry = source.clone();
  source.computeBoundingBox();
  const depth = source.boundingBox.max.z - source.boundingBox.min.z;
  strokeData.set(geometry, { position, vertices, depth, ratio: null });
  return geometry;
}

export function updateRoofArrowOutline(geometry, scale) {
  const data = strokeData.get(geometry);
  if (!data) return false;
  const ratio = roofArrowStrokeRatio(scale);
  if (data.ratio !== ratio) {
    const output = geometry.getAttribute('position');
    const distance = data.depth * ratio;
    data.vertices.forEach(({ miter }, i) => {
      output.setXYZ(i, data.position.getX(i) + miter.x * distance, data.position.getY(i),
        data.position.getZ(i) + miter.y * distance);
    });
    output.needsUpdate = true;
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
    data.ratio = ratio;
  }
  return true;
}
