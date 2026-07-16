import test from 'node:test';
import assert from 'node:assert/strict';
import {
  calculateDesignCoverHalfHeight,
  calculateOrthographicHalfHeight,
  calculatePerspectiveDistance,
  evaluateDreamteckClosedBSpline,
  resolveCameraFit,
  resolveResponsiveCropFit,
  transformCurveCoordinates
} from '../src/scene-layout.js';

const BACKGROUND = Object.freeze({
  width: 14.1,
  height: 22.708,
  sourceWidth: 2100,
  sourceHeight: 3382
});

const SOURCE_CROP = Object.freeze({
  width: 1080,
  height: 2160,
  offsetX: 0,
  offsetY: 211
});

const CAMERA = Object.freeze({
  fitWidth: 14.8,
  fitHeight: 19.4
});

function assertClose(actual, expected, epsilon = 1e-10) {
  assert.ok(Math.abs(actual - expected) < epsilon, `${actual} !== ${expected}`);
}

test('orthographic fit keeps both configured width and height visible', () => {
  assert.equal(calculateOrthographicHalfHeight({
    width: 1000,
    height: 500,
    fitWidth: 14,
    fitHeight: 16
  }), 8);
  assert.equal(calculateOrthographicHalfHeight({
    width: 500,
    height: 1000,
    fitWidth: 14,
    fitHeight: 16
  }), 14);
});

test('Unity narrow FOV perspective preserves the configured fit height', () => {
  const distance = calculatePerspectiveDistance(9.7, 4.7);
  const visibleHeight = 2 * distance * Math.tan(4.7 * Math.PI / 360);
  assert.ok(Math.abs(visibleHeight - 19.4) < 1e-10);
});

test('responsive crop keeps the 1080x2160 baseline unchanged', () => {
  const result = resolveResponsiveCropFit({
    width: 1080,
    height: 2160,
    crop: SOURCE_CROP,
    background: BACKGROUND
  });
  assert.equal(result.cropWidth, 1080);
  assert.equal(result.cropHeight, 2160);
  assert.equal(result.shortScreenScale, 1);
  assertClose(result.fitWidth, BACKGROUND.width * 1080 / BACKGROUND.sourceWidth);
  assertClose(result.fitHeight, BACKGROUND.height * 2160 / BACKGROUND.sourceHeight);
  assertClose(result.cropOffsetY, BACKGROUND.height * 211 / BACKGROUND.sourceHeight);
});

test('design cover keeps 1080x2160 visual scale', () => {
  assert.equal(calculateDesignCoverHalfHeight({
    width: 1080,
    height: 2160,
    fitHeight: 14.9
  }), 7.45);
});

test('design cover keeps visible height at 14.9 across device aspects', () => {
  assert.equal(calculateDesignCoverHalfHeight({
    width: 1080,
    height: 1920,
    fitHeight: 14.9
  }), 7.45);
  assert.equal(calculateDesignCoverHalfHeight({
    width: 720,
    height: 1280,
    fitHeight: 14.9
  }), 7.45);
  assert.equal(calculateDesignCoverHalfHeight({
    width: 612,
    height: 916,
    fitHeight: 14.9
  }), 7.45);
  assert.equal(calculateDesignCoverHalfHeight({
    width: 1080,
    height: 2400,
    fitHeight: 14.9
  }), 7.45);
});

test('responsive crop keeps short screens on the authored baseline crop', () => {
  const shortScreen = resolveResponsiveCropFit({
    width: 1080,
    height: 1920,
    crop: SOURCE_CROP,
    background: BACKGROUND
  });
  assert.equal(shortScreen.shortScreenScale, 1);
  assert.equal(shortScreen.cropHeight, 2160);
  assert.equal(shortScreen.cropWidth, 1080);
});

test('camera fit ignores responsive crop when preserving authored content bounds', () => {
  const shortScreenCrop = resolveResponsiveCropFit({
    width: 1080,
    height: 1920,
    crop: SOURCE_CROP,
    background: BACKGROUND
  });
  const fit = resolveCameraFit({
    camera: CAMERA,
    responsiveCrop: shortScreenCrop,
    cropEnabled: true
  });
  assert.equal(fit.fitWidth, CAMERA.fitWidth);
  assert.equal(fit.fitHeight, CAMERA.fitHeight);
  assert.ok(fit.fitHeight > shortScreenCrop.fitHeight);
});

test('responsive crop keeps tall screens on the authored baseline crop', () => {
  const result = resolveResponsiveCropFit({
    width: 1080,
    height: 2340,
    crop: SOURCE_CROP,
    background: BACKGROUND
  });
  assert.equal(result.cropWidth, 1080);
  assert.equal(result.cropHeight, 2160);
  assert.equal(result.shortScreenScale, 1);
});

test('middle loop scales around its own center', () => {
  const result = transformCurveCoordinates(
    [{ x: -2, z: -1 }, { x: 2, z: 1 }],
    { offsetX: 1, offsetZ: -2, scaleX: 2, scaleZ: 3 },
    'center'
  );
  assert.deepEqual(result, [
    { x: -3, z: -5 },
    { x: 5, z: 1 }
  ]);
});

test('queue curve scales from its conveyor entry and keeps even curve sampling available', () => {
  const result = transformCurveCoordinates(
    [{ x: 1, z: 2 }, { x: 3, z: 6 }],
    { offsetX: -1, offsetZ: 1, scaleX: 2, scaleZ: 0.5 },
    'entry'
  );
  assert.deepEqual(result, [
    { x: 0, z: 3 },
    { x: 4, z: 5 }
  ]);
});

test('Dreamteck closed B-spline evaluation matches the authored cubic formula', () => {
  const points = [
    { x: 0, y: 0, z: 0 },
    { x: 6, y: 3, z: -6 },
    { x: 12, y: 6, z: -12 },
    { x: 18, y: 9, z: -18 }
  ];
  const result = evaluateDreamteckClosedBSpline(points, 0.125);
  assertClose(result.x, 3.5);
  assertClose(result.y, 1.75);
  assertClose(result.z, -3.5);
});

test('Dreamteck closed B-spline wraps control points continuously at the boundary', () => {
  const points = [
    { x: 0, y: 0, z: 0 },
    { x: 6, y: 3, z: -6 },
    { x: 12, y: 6, z: -12 },
    { x: 18, y: 9, z: -18 }
  ];
  const start = evaluateDreamteckClosedBSpline(points, 0);
  const end = evaluateDreamteckClosedBSpline(points, 1);
  assert.deepEqual(start, { x: 4, y: 2, z: -4 });
  assert.deepEqual(end, start);
  assert.deepEqual(evaluateDreamteckClosedBSpline(points, -1), start);
  assert.deepEqual(evaluateDreamteckClosedBSpline(points, 2), end);
});
