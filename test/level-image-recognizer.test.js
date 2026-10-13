import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PNG } from 'pngjs';
import {
  RECOGNITION_DEFAULTS,
  blobsToWorldVehicles,
  buildPalette,
  collectBackgroundColors,
  createImageWorldMapping,
  detectEditorOverlayEvidence,
  detectArrowMarkerComponents,
  detectVehicleBlobs,
  imageUvToWorld,
  normalizeRecognitionOptions,
  recognizeLevelFromImage,
  refineGrid,
  summarizeRecognition
} from '../src/level-image-recognizer.js';

const ROAD = { r: 120, g: 130, b: 140 };

function createImage(width, height, background = ROAD) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let index = 0; index < width * height; index += 1) {
    data[index * 4] = background.r;
    data[index * 4 + 1] = background.g;
    data[index * 4 + 2] = background.b;
    data[index * 4 + 3] = 255;
  }
  return { width, height, data };
}

function paintRect(image, { x, y, width, height, css }) {
  const value = Number.parseInt(css.slice(1), 16);
  const rgb = { r: (value >> 16) & 255, g: (value >> 8) & 255, b: value & 255 };
  for (let row = Math.round(y); row < Math.round(y) + height; row += 1) {
    for (let column = Math.round(x); column < Math.round(x) + width; column += 1) {
      if (row < 0 || column < 0 || row >= image.height || column >= image.width) continue;
      const index = (row * image.width + column) * 4;
      image.data[index] = rgb.r;
      image.data[index + 1] = rgb.g;
      image.data[index + 2] = rgb.b;
      image.data[index + 3] = 255;
    }
  }
}

function paintCell(image, column, row, css, { cell = 60, originX = 60, originY = 50, width = 40, height = 22 } = {}) {
  paintRect(image, { x: originX + column * cell, y: originY + row * cell, width, height, css });
}

function paintArrow(image, centerX, centerY, direction = 'right') {
  const points = [];
  for (let offset = -18; offset <= 6; offset += 1) {
    for (let cross = -2; cross <= 2; cross += 1) points.push([offset, cross]);
  }
  for (let offset = 6; offset <= 13; offset += 1) {
    const reach = Math.max(0, 7 - Math.abs(offset - 13));
    for (let cross = -reach; cross <= reach; cross += 1) points.push([offset, cross]);
  }
  for (const [axis, cross] of points) {
    const x = direction === 'up' || direction === 'down' ? cross : axis;
    const y = direction === 'up' || direction === 'down' ? axis : cross;
    const flip = direction === 'left' || direction === 'up' ? -1 : 1;
    const pixelX = Math.round(centerX + (direction === 'up' || direction === 'down' ? x : flip * x));
    const pixelY = Math.round(centerY + (direction === 'up' || direction === 'down' ? flip * y : y));
    if (pixelX < 0 || pixelY < 0 || pixelX >= image.width || pixelY >= image.height) continue;
    const index = (pixelY * image.width + pixelX) * 4;
    image.data[index] = 255;
    image.data[index + 1] = 255;
    image.data[index + 2] = 255;
    image.data[index + 3] = 255;
  }
}

function paintArrowVehicle(image, centerX, centerY, css, direction) {
  paintRect(image, { x: centerX - 30, y: centerY - 22, width: 60, height: 44, css });
  paintArrow(image, centerX, centerY, direction);
}

function fakeBlob(colorIndex, x, y, { width = 30, height = 18, area = 420 } = {}) {
  return {
    colorIndex,
    x,
    y,
    rawX: x,
    rawY: y,
    area,
    minX: x - width / 2,
    minY: y - height / 2,
    maxX: x + width / 2,
    maxY: y + height / 2,
    bboxWidth: width,
    bboxHeight: height,
    aspect: Math.max(width, height) / Math.min(width, height),
    fill: 0.9
  };
}

test('detects a photographed colour grid and maps it into world coordinates', () => {
  const image = createImage(400, 300);
  const palette = ['#FF0000', '#0000FF', '#FFEB04', '#00FF00'];
  for (let row = 0; row < 3; row += 1) {
    for (let column = 0; column < 4; column += 1) {
      paintCell(image, column, row, palette[(row + column) % palette.length]);
    }
  }
  const mapping = createImageWorldMapping({ imageWidth: image.width, imageHeight: image.height, x: 0, z: 0, width: 8 });
  const result = recognizeLevelFromImage(image, mapping, {});

  assert.equal(result.vehicles.length, 12);
  assert.equal(result.summary.rows, 3);
  assert.equal(result.summary.columns, 4);
  assert.equal(result.summary.pitch.x, 60);
  assert.equal(result.summary.pitch.y, 60);
  assert.deepEqual(
    result.summary.byColor.map((entry) => [entry.id, entry.count]),
    [[0, 3], [1, 3], [4, 3], [5, 3]]
  );

  const xs = result.vehicles.map((vehicle) => vehicle.x);
  const zs = result.vehicles.map((vehicle) => vehicle.z);
  assert.equal(Math.round((Math.max(...xs) - Math.min(...xs)) * 100) / 100, 3.6);
  assert.equal(Math.round((Math.max(...zs) - Math.min(...zs)) * 100) / 100, 2.4);
  for (const vehicle of result.vehicles) {
    assert.equal(vehicle.seats, 4);
    assert.equal(vehicle.yaw, 0);
  }
});

test('uses white arrow markers to recover dense vehicle instances and directions', () => {
  const image = createImage(800, 700, { r: 80, g: 90, b: 105 });
  paintArrowVehicle(image, 150, 150, '#00FF00', 'right');
  paintArrowVehicle(image, 350, 150, '#96C882', 'left');
  paintArrowVehicle(image, 150, 350, '#FFE8B8', 'right');
  paintArrowVehicle(image, 350, 350, '#C89808', 'down');
  assert.equal(detectArrowMarkerComponents(image).length, 4);
  const result = detectVehicleBlobs(image, {});
  assert.equal(result.method, 'arrow-markers');
  assert.equal(result.blobs.length, 4);
  // The painted glyph tapers toward the opposite end from the direction passed to
  // paintArrow, so the recovered headings read left, left, up and right.
  assert.deepEqual(result.blobs.map((blob) => blob.yaw).sort((a, b) => a - b), [0, 90, 90, 270]);
  assert.ok(result.blobs.every((blob) => blob.headingConfirmed === true));
  assert.deepEqual(result.blobs.map((blob) => blob.colorIndex).sort((a, b) => a - b), [1, 20, 21, 23]);
});

test('rejects an editor result screenshot before it can become authored vehicles', () => {
  const image = createImage(300, 300, { r: 220, g: 225, b: 240 });
  for (let x = 20; x < 280; x += 1) {
    for (const y of [20, 279]) {
      const offset = (y * image.width + x) * 4;
      image.data[offset] = 235; image.data[offset + 1] = 55; image.data[offset + 2] = 55;
    }
  }
  for (let y = 20; y < 280; y += 1) {
    for (const x of [20, 279]) {
      const offset = (y * image.width + x) * 4;
      image.data[offset] = 235; image.data[offset + 1] = 55; image.data[offset + 2] = 55;
    }
  }
  assert.equal(detectEditorOverlayEvidence(image).detected, true);
  const result = recognizeLevelFromImage(image, createImageWorldMapping({ imageWidth: 300, imageHeight: 300, width: 8 }), {});
  assert.equal(result.method, 'editor-overlay');
  assert.equal(result.vehicles.length, 0);
  assert.match(result.warning, /原始车辆图片/);
});

test('a vehicle clipped by the image border cannot poison the background model', () => {
  const image = createImage(400, 300);
  paintRect(image, { x: 0, y: 140, width: 24, height: 22, css: '#FF0000' });
  paintRect(image, { x: 200, y: 140, width: 24, height: 22, css: '#FF0000' });
  paintRect(image, { x: 300, y: 60, width: 24, height: 22, css: '#0000FF' });
  const result = recognizeLevelFromImage(image, createImageWorldMapping({ imageWidth: 400, imageHeight: 300, width: 8 }), {});

  assert.equal(result.summary.byColor.find((entry) => entry.id === 4)?.count, 2);
  assert.equal(result.summary.byColor.find((entry) => entry.id === 0)?.count, 1);
  // Gray #96989B sits within background tolerance of this road, so it is undetectable.
  assert.deepEqual(result.skippedColorIds, [25]);
});

test('ignores background-sized patches and reports palette colours the scene hides', () => {
  const image = createImage(400, 300, { r: 150, g: 152, b: 155 });
  // A huge mint patch that is not a vehicle, plus one real car.
  paintRect(image, { x: 40, y: 40, width: 260, height: 120, css: '#69C8AA' });
  paintRect(image, { x: 60, y: 240, width: 40, height: 22, css: '#0000FF' });
  const result = recognizeLevelFromImage(image, createImageWorldMapping({ imageWidth: 400, imageHeight: 300, width: 8 }), {});

  assert.equal(result.vehicles.length, 1);
  assert.equal(result.vehicles[0].colorIndex, 0);
  assert.ok(result.rejected.area >= 1 || result.rejected.edge >= 1);
  // Gray #96989B is the scene background itself. Brown now uses the actual
  // vehicle atlas colour instead of the former green-tinted editor placeholder.
  assert.deepEqual(result.skippedColorIds, [25]);
});

test('re-spaces jittered detections onto an even grid', () => {
  const settings = normalizeRecognitionOptions({}, { width: 600, height: 600 });
  const blobs = [];
  for (let row = 0; row < 3; row += 1) {
    for (let column = 0; column < 4; column += 1) {
      blobs.push(fakeBlob(0, 100 + column * 50 + (row % 2 ? 2 : -2), 100 + row * 50 + (column % 2 ? 1.5 : -1.5)));
    }
  }
  const grid = refineGrid(blobs, settings);
  assert.equal(grid.rows, 3);
  assert.equal(grid.pitchX, 50);
  assert.equal(grid.pitchY, 50);

  const rows = new Map();
  for (const blob of grid.blobs) {
    if (!rows.has(blob.row)) rows.set(blob.row, []);
    rows.get(blob.row).push(blob);
  }
  for (const row of rows.values()) {
    const sorted = row.sort((a, b) => a.x - b.x);
    for (let index = 1; index < sorted.length; index += 1) {
      assert.ok(Math.abs(sorted[index].x - sorted[index - 1].x - 50) < 1e-6);
    }
    for (const blob of sorted) assert.equal(blob.y, sorted[0].y);
  }
});

test('classifies a clearly longer body as 10 seats and honours a forced seat count', () => {
  const image = createImage(400, 200);
  // 28/20 = 1.4x, the real 10-seat to 4-seat length ratio.
  paintRect(image, { x: 60, y: 53, width: 26, height: 28, css: '#FF0000' });
  paintRect(image, { x: 140, y: 57, width: 26, height: 20, css: '#FF0000' });
  paintRect(image, { x: 220, y: 57, width: 26, height: 20, css: '#FF0000' });
  const auto = recognizeLevelFromImage(image, createImageWorldMapping({ imageWidth: 400, imageHeight: 200, width: 8 }), {});
  assert.deepEqual(auto.vehicles.map((vehicle) => vehicle.seats).sort((a, b) => a - b), [4, 4, 10]);

  const forced = recognizeLevelFromImage(image, createImageWorldMapping({ imageWidth: 400, imageHeight: 200, width: 8 }), { seats: 6 });
  assert.deepEqual(forced.vehicles.map((vehicle) => vehicle.seats), [6, 6, 6]);
});

test('maps normalized image coordinates through position, size and rotation', () => {
  const mapping = createImageWorldMapping({ imageWidth: 100, imageHeight: 100, x: 1, z: 2, width: 10, height: 6 });
  assert.deepEqual(imageUvToWorld(mapping, 0.5, 0.5), { x: 1, z: 2 });
  assert.deepEqual(imageUvToWorld(mapping, 1, 0.5), { x: 6, z: 2 });
  // Image top maps to +Z, matching the editor underlay.
  assert.deepEqual(imageUvToWorld(mapping, 0.5, 0), { x: 1, z: 5 });

  const rotated = createImageWorldMapping({ imageWidth: 100, imageHeight: 100, x: 1, z: 2, width: 10, height: 6, rotation: 90 });
  const point = imageUvToWorld(rotated, 1, 0.5);
  assert.ok(Math.abs(point.x - 1) < 1e-9);
  assert.ok(Math.abs(point.z - -3) < 1e-9);
});

test('world vehicles follow the underlay transform without re-detecting pixels', () => {
  const image = createImage(200, 200);
  paintRect(image, { x: 80, y: 89, width: 40, height: 22, css: '#FF0000' });
  const detection = detectVehicleBlobs(image, {});
  assert.equal(detection.blobs.length, 1);

  const centred = blobsToWorldVehicles(detection.blobs, createImageWorldMapping({ imageWidth: 200, imageHeight: 200, x: 0, z: 0, width: 10, height: 5 }));
  const moved = blobsToWorldVehicles(detection.blobs, createImageWorldMapping({ imageWidth: 200, imageHeight: 200, x: 3, z: -2, width: 10, height: 5 }));
  assert.ok(Math.abs(centred[0].x - 0) < 0.05);
  assert.ok(Math.abs(centred[0].z - 0) < 0.05);
  assert.deepEqual([moved[0].x, moved[0].z], [centred[0].x + 3, centred[0].z - 2]);
});

test('rotating the underlay rotates recognized vehicle headings with it', () => {
  const mapping = createImageWorldMapping({
    imageWidth: 200, imageHeight: 200, width: 10, height: 10, rotation: 90
  });
  const vehicles = blobsToWorldVehicles([{ ...fakeBlob(4, 100, 100), yaw: 270 }], mapping);
  assert.equal(vehicles.length, 1);
  assert.equal(vehicles[0].yaw, 0);
});

test('recognition options normalise to the documented bounds', () => {
  const settings = normalizeRecognitionOptions({ tolerance: 9999, seats: '7', minArea: null, mergeGap: 40 }, { width: 1000, height: 1000 });
  assert.equal(settings.tolerance, 442);
  assert.equal(settings.seats, 'auto');
  assert.equal(settings.minArea, Math.round(1000 * 1000 * RECOGNITION_DEFAULTS.minAreaRatio));
  assert.equal(settings.mergeGap, 12);
  assert.equal(settings.snapToGrid, true);
});

test('background sampling only keeps colours that run along the whole border', () => {
  const image = createImage(300, 300, { r: 20, g: 30, b: 40 });
  // A thin red sliver clipped by the left edge must not become scene background.
  for (let y = 0; y < 300; y += 1) {
    for (let x = 0; x < 2; x += 1) {
      const index = (y * 300 + x) * 4;
      image.data[index] = 200;
      image.data[index + 1] = 40;
      image.data[index + 2] = 40;
    }
  }
  const clusters = collectBackgroundColors(image, normalizeRecognitionOptions({}, image));
  assert.equal(clusters.length, 1);
  assert.equal(Math.round(clusters[0].r), 20);

  const palette = buildPalette(normalizeRecognitionOptions({}, image));
  assert.ok(palette.some((color) => color.id === 4));
  // Black #2D2D30 is too close to this night-dark scene to be detected.
  const result = recognizeLevelFromImage(image, createImageWorldMapping({ imageWidth: 300, imageHeight: 300, width: 8 }), { minArea: 100 });
  assert.deepEqual(result.skippedColorIds, [17]);
});

test('summary groups colours, seats and rejected fragments', () => {
  const image = createImage(400, 300);
  paintCell(image, 0, 0, '#FF0000');
  paintCell(image, 1, 0, '#FF0000');
  paintCell(image, 0, 1, '#00FF00');
  paintCell(image, 1, 1, '#00FF00');
  const result = recognizeLevelFromImage(image, createImageWorldMapping({ imageWidth: 400, imageHeight: 300, width: 8 }), {});
  const summary = summarizeRecognition(result);
  assert.equal(summary.total, 4);
  assert.deepEqual(summary.seats, { 4: 4 });
  assert.equal(typeof summary.rejected.area, 'number');
  assert.equal(summary.byColor.find((entry) => entry.id === 4).label, '红');
});

test('reads a clearly longer body as 10 seats when its neighbours set the car size', () => {
  const image = createImage(400, 300);
  for (let column = 0; column < 3; column += 1) paintRect(image, { x: 60 + column * 70, y: 60, width: 26, height: 20, css: '#FF0000' });
  paintRect(image, { x: 60, y: 180, width: 26, height: 30, css: '#FF0000' });
  const result = recognizeLevelFromImage(image, createImageWorldMapping({ imageWidth: 400, imageHeight: 300, width: 8 }), {});
  assert.equal(result.vehicles.length, 4);
  assert.deepEqual(result.summary.seats, { 4: 3, 10: 1 });
});

test('splitMerged separates a touching run of cars instead of reading one long vehicle', () => {
  const image = createImage(400, 300);
  paintRect(image, { x: 40, y: 60, width: 26, height: 20, css: '#0000FF' });
  paintRect(image, { x: 120, y: 60, width: 52, height: 20, css: '#0000FF' });
  const mapping = createImageWorldMapping({ imageWidth: 400, imageHeight: 300, width: 8 });
  const merged = recognizeLevelFromImage(image, mapping, {});
  assert.equal(merged.vehicles.length, 2);
  // A touching run stays a single 4-seat vehicle: at capture scale a wide blob is
  // a run of cars, not a long bus.
  assert.deepEqual(merged.vehicles.map((vehicle) => vehicle.seats), [4, 4]);

  const split = recognizeLevelFromImage(image, mapping, { splitMerged: true });
  assert.equal(split.vehicles.length, 3);
  assert.deepEqual(split.vehicles.map((vehicle) => vehicle.x).sort((a, b) => a - b).length, 3);
});

// Photographed toy formations: the arrows are a handful of anti-aliased pixels, so
// the detector must find every vehicle and its body colour, but a heading read off a
// glyph that short is not trustworthy and stays unconfirmed for the operator.
// Counts and colours were verified vehicle by vehicle against the reference photos.
const PHOTO_FORMATIONS = {
  // 1.png reads as 45, not 44: the yellow car at the upper left of the leaf is real,
  // its arrow has only faded into the roof highlight. Recounted vehicle by vehicle.
  '1.png': { vehicles: 45, colors: { 4: 20, 5: 13, 6: 10, 8: 2 } },
  '4.png': { vehicles: 60, colors: { 4: 27, 5: 20, 6: 10, 8: 3 } }
};

function loadPhoto(file) {
  const png = PNG.sync.read(readFileSync(new URL(`../artifacts/color-supplement-sources/${file}`, import.meta.url)));
  return { width: png.width, height: png.height, data: png.data };
}

test('finds every vehicle and its colour in a photographed formation, leaving short arrows unconfirmed', () => {
  for (const [file, expected] of Object.entries(PHOTO_FORMATIONS)) {
    const image = loadPhoto(file);
    const result = recognizeLevelFromImage(image, createImageWorldMapping({ imageWidth: image.width, imageHeight: image.height, width: 6 }), {});
    assert.equal(result.method, 'arrow-markers', file);
    assert.equal(result.vehicles.length, expected.vehicles, file);
    const colors = {};
    for (const vehicle of result.vehicles) colors[vehicle.colorIndex] = (colors[vehicle.colorIndex] ?? 0) + 1;
    assert.deepEqual(colors, expected.colors, file);
    assert.ok(result.blobs.every((blob) => blob.headingConfirmed === false), file);
    assert.ok(result.blobs.some((blob) => blob.yaw % 90 !== 0), file);
  }
});
