import * as THREE from 'three';

// Indexed X/Z triangles avoid raycasting the entire road for every passenger
// each frame. Select the surface nearest the authored Y at bridge crossings.
export class Footage8Surface {
  constructor(geometry, cellSize = 0.15, { roadOnly = false } = {}) {
    this.cellSize = cellSize;
    this.cells = new Map();
    const positions = geometry.attributes.position;
    const indices = geometry.index;
    for (let i = 0; i < (indices?.count ?? positions.count); i += 3) {
      const p = [0, 1, 2].map((j) => new THREE.Vector3().fromBufferAttribute(positions, indices ? indices.getX(i + j) : i + j));
      const [a, b, c] = p;
      if (roadOnly) {
        // Footage8's first atlas quarter is asphalt; later bands contain the
        // raised curbs. Coverage of the whole mesh includes those curb tops.
        const uv = geometry.attributes.uv;
        const road = [0, 1, 2].every((j) => {
          const u = uv.getX(indices ? indices.getX(i + j) : i + j);
          return u >= -1e-5 && u <= 0.25;
        });
        const normal = b.clone().sub(a).cross(c.clone().sub(a));
        if (!road || Math.abs(normal.y) < normal.length() * 0.5) continue;
      }
      const denominator = (b.z - c.z) * (a.x - c.x) + (c.x - b.x) * (a.z - c.z);
      if (Math.abs(denominator) < 1e-9) continue;
      const triangle = { a, b, c, denominator };
      for (let x = Math.floor(Math.min(...p.map((v) => v.x)) / cellSize); x <= Math.floor(Math.max(...p.map((v) => v.x)) / cellSize); x += 1) {
        for (let z = Math.floor(Math.min(...p.map((v) => v.z)) / cellSize); z <= Math.floor(Math.max(...p.map((v) => v.z)) / cellSize); z += 1) {
          const key = `${x},${z}`;
          if (!this.cells.has(key)) this.cells.set(key, []);
          this.cells.get(key).push(triangle);
        }
      }
    }
  }

  heightAt(point, { highest = false } = {}) {
    const key = `${Math.floor(point.x / this.cellSize)},${Math.floor(point.z / this.cellSize)}`;
    let height = null, nearest = Infinity;
    for (const { a, b, c, denominator } of this.cells.get(key) ?? []) {
      const u = ((b.z - c.z) * (point.x - c.x) + (c.x - b.x) * (point.z - c.z)) / denominator;
      const v = ((c.z - a.z) * (point.x - c.x) + (a.x - c.x) * (point.z - c.z)) / denominator;
      if (u < -1e-7 || v < -1e-7 || u + v > 1 + 1e-7) continue;
      const y = u * a.y + v * b.y + (1 - u - v) * c.y;
      const distance = highest ? -y : Math.abs(y - point.y);
      if (distance < nearest) { nearest = distance; height = y; }
    }
    return height;
  }
}

// Endpoints measured on the supplied Footage8 mesh's open boarding lip.
export const FOOTAGE8_BOARDING_LIP = Object.freeze([
  [0.45266738533973694, -0.017284123227000237, 0.3894275724887848],
  [1.278889536857605, -0.0204094760119915, 0.38909512758255005]
]);

export function clipFootage8RoadJoin(corners, project, minimumY) {
  if (!project || !Number.isFinite(minimumY)) return corners;
  return corners.map((point, index) => {
    if (index < 2 || project(point).y >= minimumY) return point;
    const start = corners[index - 2];
    if (project(start).y < minimumY) return start.clone();
    let lo = 0, hi = 1;
    for (let i = 0; i < 28; i += 1) {
      const middle = (lo + hi) / 2;
      if (project(start.clone().lerp(point, middle)).y >= minimumY) lo = middle;
      else hi = middle;
    }
    return start.clone().lerp(point, lo);
  });
}

export function getFootage8RoadJoinCorners(matrix, spots, extension = -0.18) {
  const lip = FOOTAGE8_BOARDING_LIP.map((p) => new THREE.Vector3(...p).applyMatrix4(matrix));
  const forward = new THREE.Vector3(0, 0, -1).transformDirection(matrix);
  const center = lip[0].clone().add(lip[1]).multiplyScalar(0.5);
  const target = new THREE.Vector3(center.x, spots.y - 0.012, spots.z - spots.modelDepth * spots.scaleZ / 2);
  const length = Math.max(0.15, target.clone().sub(center).dot(forward) + extension);
  const start = lip.map((p) => p.clone().addScaledVector(forward, -0.08));
  const end = lip.map((p) => p.clone().addScaledVector(forward, length).setY(target.y));
  return [...start, ...end];
}

export class Footage8RoadJoin {
  constructor() {
    this.geometry = new THREE.BufferGeometry();
    this.root = new THREE.Mesh(this.geometry, new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, side: THREE.DoubleSide }));
    this.root.name = 'Footage8 boarding road connection';
    this.root.renderOrder = -20;
    this.root.visible = false;
    this.sides = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshStandardMaterial({ color: 0x96969f, roughness: 1, side: THREE.DoubleSide }));
    this.edges = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshStandardMaterial({ color: 0xf2f1ef, roughness: 1, side: THREE.DoubleSide }));
    this.root.add(this.sides, this.edges);
  }

  update(matrix, spots, tuning, visible, roadMaterial, protection = {}) {
    this.root.visible = Boolean(visible && tuning.roadJoinEnabled);
    if (!this.root.visible) return;
    const landing = Math.max(0, Number(tuning.roadJoinLanding) || 0);
    const rawCorners = getFootage8RoadJoinCorners(matrix, spots, (tuning.roadJoinExtension ?? -.18) + landing);
    const bottomY = spots.y - .04;
    // Protect the full solid base, not only the elevated top surface. Keep the
    // final tread on parking-ground height when shortening its footprint.
    const projectBase = protection.project ? (p) => protection.project(p.clone().setY(bottomY)) : null;
    const corners = clipFootage8RoadJoin(rawCorners, projectBase, protection.minimumY);
    corners[2].y = rawCorners[2].y; corners[3].y = rawCorners[3].y;
    const [left, right, endLeft, endRight] = corners;
    const count = THREE.MathUtils.clamp(Math.round(Number(tuning.roadJoinSteps) || 0), 0, 5);
    const top = [], sides = [], edges = [];
    const quad = (out, a, b, c, d) => { for (const p of [a,b,c,b,d,c]) out.push(p.x,p.y,p.z); };
    const cross = (t, height) => [left.clone().lerp(endLeft,t).setY(height[0]), right.clone().lerp(endRight,t).setY(height[1])];
    const height = (t) => [THREE.MathUtils.lerp(left.y,endLeft.y,t),THREE.MathUtils.lerp(right.y,endRight.y,t)];
    const landingFraction = .35;
    const sections = [{ t: 0, h: height(0) }, { t: landingFraction, h: height(0) }];
    if (count) {
      for (let i = 1; i <= count; i++) {
        const t0 = landingFraction + (1-landingFraction)*(i-1)/count;
        const t1 = landingFraction + (1-landingFraction)*i/count;
        sections.push({t:t0,h:height(i/count)},{t:t1,h:height(i/count)});
      }
    } else {
      for (let i=1;i<=16;i++) sections.push({t:landingFraction+(1-landingFraction)*i/16,h:height(THREE.MathUtils.smoothstep(i/16,0,1))});
    }
    for(let i=1;i<sections.length;i++) {
      const a=cross(sections[i-1].t,sections[i-1].h),b=cross(sections[i].t,sections[i].h);
      const riser=sections[i-1].t===sections[i].t;
      quad(riser?sides:top,a[0],a[1],b[0],b[1]);
      for(const side of [0,1]) {
        const p=a[side],q=b[side];
        quad(sides,p,q,p.clone().setY(bottomY),q.clone().setY(bottomY));
        // Continue the model's pale curb along each side, leaving the opening
        // and step noses clear for boarding passengers.
        const inward=a[1-side].clone().sub(p).setY(0).normalize().multiplyScalar(.035);
        const pTop=p.clone().add(new THREE.Vector3(0,.025,0)),qTop=q.clone().add(new THREE.Vector3(0,.025,0));
        quad(edges,pTop,qTop,pTop.clone().add(inward),qTop.clone().add(inward));
        quad(edges,p,q,pTop,qTop);
      }
    }
    const end=cross(1,height(1));
    quad(sides,end[0],end[1],end[0].clone().setY(bottomY),end[1].clone().setY(bottomY));
    for(const [geometry,positions,textured]of [[this.geometry,top,true],[this.sides.geometry,sides,false],[this.edges.geometry,edges,false]]){
      geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));
      if(textured) geometry.setAttribute('uv',new THREE.Float32BufferAttribute(Array.from({length:positions.length/3},()=>[.126,.174]).flat(),2));
      geometry.computeVertexNormals();geometry.computeBoundingSphere();
    }
    this.corners = corners;
    this.surface = new Footage8Surface(this.geometry);
    if (roadMaterial?.map && this.root.material.map !== roadMaterial.map) {
      this.root.material.map = roadMaterial.map;
      this.root.material.needsUpdate = true;
    }
  }
}
