export function calculateOrthographicHalfHeight({
  width,
  height,
  fitWidth,
  fitHeight,
  padding = 0
}) {
  const safeWidth = Math.max(1, Number(width) || 1);
  const safeHeight = Math.max(1, Number(height) || 1);
  const aspect = safeWidth / safeHeight;
  const paddedWidth = Math.max(0.01, fitWidth + padding * 2);
  const paddedHeight = Math.max(0.01, fitHeight + padding * 2);
  return Math.max(paddedHeight / 2, paddedWidth / (2 * aspect));
}

export function calculateDesignCoverHalfHeight({
  width,
  height,
  designWidth = 1080,
  designHeight = 2160,
  fitHeight
}) {
  return Math.max(0.01, Number(fitHeight) / 2 || 0.01);
}

export function calculatePerspectiveDistance(halfHeight, fovDegrees) {
  const safeHalfHeight = Math.max(0.01, Number(halfHeight) || 0.01);
  const safeFov = Math.min(179, Math.max(0.1, Number(fovDegrees) || 0.1));
  return safeHalfHeight / Math.tan(safeFov * Math.PI / 360);
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function calculateCameraGroundRotation(camera = {}) {
  const azimuth = (Number(camera.azimuthDegrees) || 0) * Math.PI / 180;
  const elevation = (Number(camera.elevationDegrees) || 0) * Math.PI / 180;
  const groundScale = Math.max(0.01, Math.abs(Math.sin(elevation)));
  const cosine = Math.cos(azimuth);
  const sine = Math.sin(azimuth);
  // Undo the baseline ground foreshortening, rotate, then project it again.
  // This keeps the painted ground turning with the vehicles at any elevation.
  return {
    xx: cosine,
    xy: sine / groundScale,
    yx: -sine * groundScale,
    yy: cosine
  };
}

export function clampCenteredRectX({ centerX, width, left, right }) {
  const safeCenterX = Number(centerX);
  const safeWidth = Math.max(0, Number(width) || 0);
  const safeLeft = Number(left);
  const safeRight = Number(right);
  if (
    !Number.isFinite(safeCenterX)
    || !Number.isFinite(safeLeft)
    || !Number.isFinite(safeRight)
    || safeRight <= safeLeft
  ) {
    return safeCenterX;
  }
  if (safeWidth >= safeRight - safeLeft) return (safeLeft + safeRight) / 2;
  return clamp(safeCenterX, safeLeft + safeWidth / 2, safeRight - safeWidth / 2);
}

// Same rule on the vertical axis. A wide viewport letterboxes the portrait
// artwork, so a design-space Y can also land outside the visible scene.
export function clampCenteredRectY({ centerY, height, top, bottom }) {
  const safeCenterY = Number(centerY);
  const safeHeight = Math.max(0, Number(height) || 0);
  const safeTop = Number(top);
  const safeBottom = Number(bottom);
  if (
    !Number.isFinite(safeCenterY)
    || !Number.isFinite(safeTop)
    || !Number.isFinite(safeBottom)
    || safeBottom <= safeTop
  ) {
    return safeCenterY;
  }
  if (safeHeight >= safeBottom - safeTop) return (safeTop + safeBottom) / 2;
  return clamp(safeCenterY, safeTop + safeHeight / 2, safeBottom - safeHeight / 2);
}

function clampCropOffset(offset, cropSize, sourceSize) {
  if (cropSize >= sourceSize) return 0;
  const maxOffset = (sourceSize - cropSize) / 2;
  return clamp(Number(offset) || 0, -maxOffset, maxOffset);
}

export function resolveResponsiveCropFit({
  crop = {},
  background = {}
}) {
  const sourceWidth = Math.max(1, Number(background.sourceWidth) || 1);
  const sourceHeight = Math.max(1, Number(background.sourceHeight) || 1);
  const backgroundWidth = Math.max(0.01, Number(background.width) || 0.01);
  const backgroundHeight = Math.max(0.01, Number(background.height) || 0.01);
  const baseCropWidth = clamp(Math.max(1, Number(crop.width) || sourceWidth), 1, sourceWidth);
  const baseCropHeight = clamp(Math.max(1, Number(crop.height) || sourceHeight), 1, sourceHeight);
  const cropWidth = baseCropWidth;
  const cropHeight = baseCropHeight;
  const offsetX = clampCropOffset(crop.offsetX, cropWidth, sourceWidth);
  const offsetY = clampCropOffset(crop.offsetY, cropHeight, sourceHeight);

  return {
    cropWidth,
    cropHeight,
    fitWidth: backgroundWidth * cropWidth / sourceWidth,
    fitHeight: backgroundHeight * cropHeight / sourceHeight,
    cropOffsetX: offsetX * backgroundWidth / sourceWidth,
    cropOffsetY: offsetY * backgroundHeight / sourceHeight,
    shortScreenScale: 1
  };
}

export function resolveCameraFit({ camera = {} }) {
  const cameraFitWidth = Math.max(0.01, Number(camera.fitWidth) || 0.01);
  const cameraFitHeight = Math.max(0.01, Number(camera.fitHeight) || 0.01);
  return {
    fitWidth: cameraFitWidth,
    fitHeight: cameraFitHeight
  };
}

export function createSceneBounds() {
  return {
    minX: Infinity,
    maxX: -Infinity,
    minZ: Infinity,
    maxZ: -Infinity
  };
}

export function extendSceneBounds(bounds, point, padding = 0) {
  if (!bounds || !point) return bounds;
  const x = Number(point.x);
  const z = Number(point.z);
  if (!Number.isFinite(x) || !Number.isFinite(z)) return bounds;
  const safePadding = Math.max(0, Number(padding) || 0);
  bounds.minX = Math.min(bounds.minX, x - safePadding);
  bounds.maxX = Math.max(bounds.maxX, x + safePadding);
  bounds.minZ = Math.min(bounds.minZ, z - safePadding);
  bounds.maxZ = Math.max(bounds.maxZ, z + safePadding);
  return bounds;
}

export function normalizeSceneBounds(bounds, fallback = {}) {
  const minX = Number(bounds?.minX);
  const maxX = Number(bounds?.maxX);
  const minZ = Number(bounds?.minZ);
  const maxZ = Number(bounds?.maxZ);
  if ([minX, maxX, minZ, maxZ].every(Number.isFinite) && maxX >= minX && maxZ >= minZ) {
    return { minX, maxX, minZ, maxZ };
  }
  const centerX = Number(fallback.centerX) || 0;
  const centerZ = Number(fallback.centerZ) || 0;
  const halfWidth = Math.max(0.5, Number(fallback.halfWidth) || 0.5);
  const halfDepth = Math.max(0.5, Number(fallback.halfDepth) || 0.5);
  return {
    minX: centerX - halfWidth,
    maxX: centerX + halfWidth,
    minZ: centerZ - halfDepth,
    maxZ: centerZ + halfDepth
  };
}

export function calculateAutoCameraFit({
  bounds,
  camera = {},
  margin = 0.7,
  minFitWidth = 8,
  minFitHeight = 8,
  maxFitWidth = 30,
  maxFitHeight = 36
} = {}) {
  const normalized = normalizeSceneBounds(bounds, {
    centerX: camera.targetX,
    centerZ: camera.targetZ,
    halfWidth: 4,
    halfDepth: 4
  });
  const safeMargin = Math.max(0, Number(margin) || 0);
  const elevation = Math.abs(Number(camera.elevationDegrees) || 0) * Math.PI / 180;
  const azimuth = (Number(camera.azimuthDegrees) || 0) * Math.PI / 180;
  const width = normalized.maxX - normalized.minX;
  const depth = normalized.maxZ - normalized.minZ;
  // Rotate the ground bounds into camera space before applying elevation,
  // so automatic framing also fits a scene viewed from the side.
  const sinAzimuth = Math.abs(Math.sin(azimuth));
  const cosAzimuth = Math.abs(Math.cos(azimuth));
  const projectedWidth = width * cosAzimuth + depth * sinAzimuth;
  const projectedDepth = (width * sinAzimuth + depth * cosAzimuth) * Math.sin(elevation);
  return {
    targetX: (normalized.minX + normalized.maxX) / 2,
    targetZ: (normalized.minZ + normalized.maxZ) / 2,
    fitWidth: Math.min(maxFitWidth, Math.max(minFitWidth, projectedWidth + safeMargin * 2)),
    fitHeight: Math.min(maxFitHeight, Math.max(minFitHeight, projectedDepth + safeMargin * 2))
  };
}

export function transformCurveCoordinates(points, tuning = {}, anchorMode = 'center') {
  if (!points.length) return [];
  const offsetX = Number(tuning.offsetX) || 0;
  const offsetZ = Number(tuning.offsetZ) || 0;
  const scaleX = Number.isFinite(Number(tuning.scaleX)) ? Number(tuning.scaleX) : 1;
  const scaleZ = Number.isFinite(Number(tuning.scaleZ)) ? Number(tuning.scaleZ) : 1;
  let anchorX;
  let anchorZ;

  if (anchorMode === 'entry') {
    anchorX = points[0].x;
    anchorZ = points[0].z;
  } else {
    let minX = Infinity;
    let maxX = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    for (const point of points) {
      minX = Math.min(minX, point.x);
      maxX = Math.max(maxX, point.x);
      minZ = Math.min(minZ, point.z);
      maxZ = Math.max(maxZ, point.z);
    }
    anchorX = (minX + maxX) / 2;
    anchorZ = (minZ + maxZ) / 2;
  }

  return points.map((point) => ({
    x: anchorX + (point.x - anchorX) * scaleX + offsetX,
    z: anchorZ + (point.z - anchorZ) * scaleZ + offsetZ
  }));
}

function wrapIndex(index, length) {
  return ((index % length) + length) % length;
}

function evaluateDreamteckBSplineComponent(p0, p1, p2, p3, t) {
  return (
    (-p0 + p2) / 2
    + t * (
      (p0 - 2 * p1 + p2) / 2
      + t * (-p0 + 3 * p1 - 3 * p2 + p3) / 6
    )
  ) * t + (p0 + 4 * p1 + p2) / 6;
}

export function evaluateDreamteckClosedBSpline(points, progress) {
  if (!points.length) return { x: 0, y: 0, z: 0 };
  if (points.length === 1) {
    return {
      x: Number(points[0].x) || 0,
      y: Number(points[0].y) || 0,
      z: Number(points[0].z) || 0
    };
  }

  const pointCount = points.length;
  const clampedProgress = clamp(Number(progress) || 0, 0, 1);
  const doubleIndex = pointCount * clampedProgress;
  const segmentIndex = Math.min(pointCount - 1, Math.floor(doubleIndex));
  const t = doubleIndex - segmentIndex;
  const controls = [-1, 0, 1, 2].map((offset) => (
    points[wrapIndex(segmentIndex + offset, pointCount)]
  ));

  const evaluateAxis = (axis) => evaluateDreamteckBSplineComponent(
    Number(controls[0][axis]) || 0,
    Number(controls[1][axis]) || 0,
    Number(controls[2][axis]) || 0,
    Number(controls[3][axis]) || 0,
    t
  );
  return {
    x: evaluateAxis('x'),
    y: evaluateAxis('y'),
    z: evaluateAxis('z')
  };
}
