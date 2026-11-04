// Authored coordinate -> runtime display coordinate.
//
// A level document stores one coordinate system, but the playable never draws
// it directly: `vehicle-area.js` shifts it around the position pivot, scales it
// by `positionUnitScale`, converts Unity units to world units, optionally
// mirrors Z, and the scene then rotates the whole formation around its own
// centre, mirroring each heading along with it.
//
// Any authoring view that wants to look like the playable — the layout canvas,
// the overview thumbnails, the contact sheet — must go through this transform.
// Drawing raw authoring space instead produces a mirrored field at a different
// scale, which reads as "the editor and the game disagree".
//
// The translation is deliberately dropped: only relative placement decides
// whether two pictures match, and keeping the field near the origin lets both
// the canvas camera and the thumbnail fit stay simple.

const DEFAULTS = Object.freeze({
  positionUnitScale: 1,
  unityToWorldScale: 1,
  positionPivotX: 0,
  positionPivotZ: 0,
  sourceRootX: 0,
  sourceRootZ: 0,
  offsetX: 0,
  offsetZ: 0,
  mirrorZ: false,
  rotationDegrees: 0
});

function numberOr(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

/**
 * Build a reusable transform for one `vehicleArea` tuning object.
 *
 * `point` maps an authored (x, z) to display space. `unproject` is its inverse,
 * so pointer input can still report authoring coordinates. `yaw` maps a heading,
 * because a Z mirror turns a nose into its mirror image (180 - yaw) and the
 * formation rotation then subtracts from every heading in the same frame.
 */
export function createVehicleAreaTransform(area = {}) {
  const unitScale = numberOr(area.positionUnitScale, DEFAULTS.positionUnitScale);
  const worldScale = numberOr(area.unityToWorldScale, DEFAULTS.unityToWorldScale);
  const pivotX = numberOr(area.positionPivotX, DEFAULTS.positionPivotX);
  const pivotZ = numberOr(area.positionPivotZ, DEFAULTS.positionPivotZ);
  const rootX = numberOr(area.sourceRootX, DEFAULTS.sourceRootX);
  const rootZ = numberOr(area.sourceRootZ, DEFAULTS.sourceRootZ);
  const offsetX = numberOr(area.offsetX, DEFAULTS.offsetX);
  const offsetZ = numberOr(area.offsetZ, DEFAULTS.offsetZ);
  const mirrorZ = area.mirrorZ === true;
  const rotationDegrees = numberOr(area.rotationDegrees, DEFAULTS.rotationDegrees);
  const rotation = rotationDegrees * Math.PI / 180;
  const cosRotation = Math.cos(rotation);
  const sinRotation = Math.sin(rotation);
  const mirrorSign = mirrorZ ? -1 : 1;
  // Authored units -> display units, before the canvas zoom is applied.
  const scale = unitScale * worldScale;

  const mapRaw = (x, z) => ({
    x: (rootX + (x - pivotX) * unitScale + pivotX) * worldScale + offsetX,
    z: (rootZ + (z - pivotZ) * unitScale + pivotZ) * worldScale * mirrorSign + offsetZ
  });
  const origin = mapRaw(0, 0);

  return {
    scale,
    mirrorZ,
    rotationDegrees,
    origin,
    point(x, z) {
      const raw = mapRaw(numberOr(x, 0), numberOr(z, 0));
      const dx = raw.x - origin.x;
      const dz = raw.z - origin.z;
      return {
        x: dx * cosRotation - dz * sinRotation,
        z: dx * sinRotation + dz * cosRotation
      };
    },
    unproject(x, z) {
      const unrotatedX = x * cosRotation + z * sinRotation + origin.x;
      const unrotatedZ = -x * sinRotation + z * cosRotation + origin.z;
      const scaledX = (unrotatedX - offsetX) / worldScale - rootX;
      const scaledZ = (unrotatedZ - offsetZ) / (worldScale * mirrorSign) - rootZ;
      return {
        x: (scaledX - pivotX) / unitScale + pivotX,
        z: (scaledZ - pivotZ) / unitScale + pivotZ
      };
    },
    yaw(yawDegrees) {
      const value = numberOr(yawDegrees, 0);
      return (mirrorZ ? 180 - value : value) - rotationDegrees;
    },
    // Canvas rotation for a sprite whose nose is drawn at local -Y.
    //
    // The playable camera sits above and on the +Z side looking back at the
    // field, so on screen +X is right and +Z is DOWN. A canvas also grows
    // downward in Y, which makes world→screen a direct (not mirrored) mapping:
    // sx = cx + x·k, sy = cy + z·k.
    //
    // A sprite rotated by φ has its nose along (sin φ, -cos φ) in canvas space.
    // The playable points the nose along the runtime heading, (sin θ, cos θ).
    // Solving sin φ = sin θ and -cos φ = cos θ gives φ = 180° - θ. Rotating by
    // the heading itself (φ = θ) points every car exactly backwards — which
    // reads as the whole board being mirrored.
    canvasYaw(yawDegrees) {
      return 180 - this.yaw(yawDegrees);
    }
  };
}

// Tuning objects are replaced wholesale when they change, and the canvas asks
// for the transform for every point of every car, so cache by identity.
let cachedSource = null;
let cachedTransform = null;

export function vehicleAreaTransformFor(area) {
  if (area === cachedSource && cachedTransform) return cachedTransform;
  cachedSource = area;
  cachedTransform = createVehicleAreaTransform(area ?? {});
  return cachedTransform;
}

/**
 * The screen projection every authoring view must use.
 *
 * The playable camera sits above the field on its +Z side, so on screen world
 * +X runs right and world +Z runs **down**. A canvas grows downward in Y too,
 * which makes this a direct mapping with no axis flip:
 *
 *     sx = centerX + (x - cameraX) * pixelsPerUnit
 *     sy = centerY + (z - cameraZ) * pixelsPerUnit
 *
 * Drawing `sy = centerY - z * k` (the usual "z points up" convention) mirrors
 * the whole board vertically and, with it, every heading.
 */
export function worldToScreenPoint(camera, rect, x, z, pixelsPerUnit) {
  return {
    x: rect.width * 0.5 + (x - camera.x) * pixelsPerUnit,
    y: rect.height * 0.5 + (z - camera.z) * pixelsPerUnit
  };
}

export function screenToWorldPoint(camera, rect, x, y, pixelsPerUnit) {
  return {
    x: camera.x + (x - rect.width * 0.5) / pixelsPerUnit,
    z: camera.z + (y - rect.height * 0.5) / pixelsPerUnit
  };
}

// Collision footprints are the wrong size for a picture. The playable draws a
// normalized 3D model (`modelDepthBySeats` scaled by `modelScale`), which is
// noticeably longer than the 0.27 x 0.47 collision box, so any authoring view
// that draws collision boxes looks airier than the game. Every authoring view
// takes its on-screen car size from here instead.
const COLLISION_SIZES = Object.freeze({
  4: { width: 0.27, length: 0.47157902 },
  6: { width: 0.27, length: 0.486 },
  10: { width: 0.27, length: 0.6785897 }
});

export function collisionVehicleSize(vehicle) {
  const direct = vehicle?.collisionSize;
  const directLength = direct?.length ?? direct?.z ?? direct?.depth;
  if (direct?.width > 0 && directLength > 0) return { width: direct.width, length: directLength };
  return COLLISION_SIZES[Number(vehicle?.seats)] ?? COLLISION_SIZES[4];
}

/**
 * Car width/length in display units — the size the playable actually renders.
 *
 * Falls back to the collision footprint scaled into display units when the
 * model tuning is missing, so a stripped-down tuning object still draws cars.
 */
export function displayVehicleSize(vehicle, area) {
  const collision = collisionVehicleSize(vehicle);
  const transform = vehicleAreaTransformFor(area);
  const depth = Number(area?.modelDepthBySeats?.[vehicle?.seats]);
  const modelScale = Number(area?.modelScale);
  if (!(depth > 0) || !(modelScale > 0)) {
    return {
      width: collision.width * transform.scale,
      length: collision.length * transform.scale
    };
  }
  const length = depth * modelScale;
  return { width: length * (collision.width / collision.length), length };
}
