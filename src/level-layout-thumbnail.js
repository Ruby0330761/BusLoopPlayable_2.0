// Shared top-down level layout rendering.
//
// One renderer feeds two consumers — the standalone contact sheet script and the
// editor's level overview — so a thumbnail means the same thing in both places.
// It is a pure function of the level document: no DOM, no canvas, no THREE.
//
// Coordinates are the level's own world space. yaw 0 faces +Z and positive yaw
// rotates toward +X, matching src/vehicle-collision.js. The picture puts +Z at
// the top so the conveyor strip appears above the parked rows, as it does in
// game.

import { VEHICLE_COLOR_OPTIONS } from './level-editor-model.js';

// Seat count drives the footprint: a 10-seat bus is visibly longer than a
// 4-seat car, and drawing them alike would misrepresent how tightly a field packs.
const SEAT_SIZES = Object.freeze({
  4: { width: 0.27, length: 0.47157902 },
  6: { width: 0.27, length: 0.486 },
  10: { width: 0.27, length: 0.6785897 }
});
const FALLBACK_SIZE = SEAT_SIZES[10];

const PARKING_DEFAULTS = Object.freeze({
  count: 4, startX: -1.42, spacing: 0.95, z: 0.55,
  modelWidth: 0.78, modelDepth: 1.46, scaleX: 0.7, scaleZ: 0.65
});

const COLOR_BY_ID = new Map(VEHICLE_COLOR_OPTIONS.map((color) => [color.id, color.css]));
const UNKNOWN_VEHICLE_COLOR = '#8a94a3';

export function resolveVehicleSize(vehicle) {
  const direct = vehicle?.collisionSize;
  const length = direct?.length ?? direct?.z ?? direct?.depth;
  if (direct?.width > 0 && length > 0) return { width: direct.width, length };
  return SEAT_SIZES[vehicle?.seats] ?? FALLBACK_SIZE;
}

export function resolveVehicleColor(vehicle) {
  return COLOR_BY_ID.get(vehicle?.colorIndex) ?? UNKNOWN_VEHICLE_COLOR;
}

function round(value) {
  return Math.round(value * 1000) / 1000;
}

// Bounds come from the vehicles only. A level's splinePoints sit far away in
// world space (the conveyor runs at z≈15 while the parked field sits near z≈0),
// so including them would stretch the frame by ~20 units and squash the cars
// into an unreadable smudge. The belt is conveyed by a labelled strip instead.
export function computeLayoutBounds(level) {
  const xs = [];
  const zs = [];
  for (const vehicle of level?.vehicles ?? []) {
    if (Number.isFinite(vehicle?.x) && Number.isFinite(vehicle?.z)) {
      xs.push(vehicle.x);
      zs.push(vehicle.z);
    }
  }
  const minX = xs.length ? Math.min(...xs) : -2;
  const maxX = xs.length ? Math.max(...xs) : 2;
  const minZ = zs.length ? Math.min(...zs) : -3;
  const maxZ = zs.length ? Math.max(...zs) : 2;
  // A little breathing room so edge cars are not clipped by the frame.
  const padX = Math.max((maxX - minX) * 0.06, 0.15);
  const padZ = Math.max((maxZ - minZ) * 0.06, 0.15);
  return { minX: minX - padX, maxX: maxX + padX, minZ: minZ - padZ, maxZ: maxZ + padZ };
}

// Uniform scale that fits the level into the box, centred. Keeping one scale for
// both axes preserves the real proportions, which is what makes two levels
// comparable at a glance.
export function createProjection(bounds, width, height, pad = 10) {
  const spanX = Math.max(bounds.maxX - bounds.minX, 0.001);
  const spanZ = Math.max(bounds.maxZ - bounds.minZ, 0.001);
  const usableWidth = Math.max(width - pad * 2, 1);
  const usableHeight = Math.max(height - pad * 2, 1);
  const scale = Math.min(usableWidth / spanX, usableHeight / spanZ);
  const offsetX = pad + (usableWidth - spanX * scale) / 2;
  const offsetY = pad + (usableHeight - spanZ * scale) / 2;
  return {
    scale,
    point(x, z) {
      return {
        x: offsetX + (x - bounds.minX) * scale,
        // SVG grows downward, so z is flipped to keep +Z at the top.
        y: offsetY + (bounds.maxZ - z) * scale
      };
    }
  };
}

export function vehiclePolygon(vehicle, project) {
  const { width, length } = resolveVehicleSize(vehicle);
  const halfWidth = width / 2;
  const halfLength = length / 2;
  const radians = (vehicle?.yaw ?? 0) * Math.PI / 180;
  const sin = Math.sin(radians);
  const cos = Math.cos(radians);
  // Forward (+Z at yaw 0) and rightward (+X at yaw 0) unit vectors.
  const forwardX = sin;
  const forwardZ = cos;
  const rightX = cos;
  const rightZ = -sin;
  const corners = [
    [halfLength, halfWidth],
    [halfLength, -halfWidth],
    [-halfLength, -halfWidth],
    [-halfLength, halfWidth]
  ];
  return corners.map(([along, across]) => {
    const worldX = vehicle.x + forwardX * along + rightX * across;
    const worldZ = vehicle.z + forwardZ * along + rightZ * across;
    const projected = project.point(worldX, worldZ);
    return `${round(projected.x)},${round(projected.y)}`;
  }).join(' ');
}

export function parkingBayPolygons(level, project) {
  const spots = { ...PARKING_DEFAULTS, ...(level?.tuning?.parkingSpots ?? {}) };
  const count = Number(spots.count) || 0;
  if (count <= 0) return [];
  const halfWidth = (Number(spots.modelWidth) * Number(spots.scaleX)) / 2;
  const halfDepth = (Number(spots.modelDepth) * Number(spots.scaleZ)) / 2;
  const spacing = Number(spots.spacing) || PARKING_DEFAULTS.spacing;
  const startX = Number(spots.startX) || 0;
  const z = Number.isFinite(spots.z) ? spots.z : PARKING_DEFAULTS.z;
  const bays = [];
  for (let index = 0; index < count; index += 1) {
    const centerX = startX + index * spacing;
    bays.push([
      [centerX - halfWidth, z - halfDepth],
      [centerX + halfWidth, z - halfDepth],
      [centerX + halfWidth, z + halfDepth],
      [centerX - halfWidth, z + halfDepth]
    ].map(([x, zz]) => {
      const projected = project.point(x, zz);
      return `${round(projected.x)},${round(projected.y)}`;
    }).join(' '));
  }
  return bays;
}

export function summarizeLevel(level) {
  const vehicles = level?.vehicles ?? [];
  const seatCounts = new Map();
  const colorIds = new Set();
  for (const vehicle of vehicles) {
    seatCounts.set(vehicle.seats, (seatCounts.get(vehicle.seats) ?? 0) + 1);
    colorIds.add(vehicle.colorIndex);
  }
  return {
    vehicleCount: vehicles.length,
    passengerCount: (level?.passengerQueues ?? []).flat().length,
    colorCount: colorIds.size,
    seatSummary: [...seatCounts.entries()]
      .sort((first, second) => first[0] - second[0])
      .map(([seats, count]) => `${seats}座×${count}`)
      .join(' ')
  };
}

/**
 * Render one level as a standalone SVG string.
 *
 * `className` prefixes the generated class names so inline instances in the
 * editor cannot collide with the page's own styles, and `ariaLabel` keeps the
 * graphic meaningful to screen readers.
 */
export function renderLevelSvg(level, {
  width = 260,
  height = 200,
  pad = 10,
  className = 'level-thumb',
  ariaLabel = null
} = {}) {
  const bounds = computeLayoutBounds(level);
  const project = createProjection(bounds, width, height, pad);
  const bays = parkingBayPolygons(level, project)
    .map((points) => `<polygon points="${points}" class="${className}__bay" />`)
    .join('');
  const vehicles = (level?.vehicles ?? []).map((vehicle) => {
    const classes = [`${className}__car`];
    if (vehicle.isHidden) classes.push(`${className}__car--hidden`);
    if (vehicle.isTurnVehicle) classes.push(`${className}__car--turn`);
    return `<polygon points="${vehiclePolygon(vehicle, project)}" fill="${resolveVehicleColor(vehicle)}" class="${classes.join(' ')}" />`;
  }).join('');
  const label = ariaLabel ?? `${level?.displayName ?? level?.key ?? ''} 布局`;
  const emptyLabel = vehicles
    ? ''
    : `<text x="${width / 2}" y="${height / 2}" class="${className}__empty" text-anchor="middle">空关卡（无车辆）</text>`;
  const beltName = level?.tuning?.conveyorLayout?.selected ?? level?.conveyorBeltName ?? '';
  const belt = beltName
    ? `<text x="${pad}" y="${pad + 8}" class="${className}__belt">${escapeXml(String(beltName))}</text>`
    : '';
  return `<svg viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img" aria-label="${escapeXml(label)}">`
    + `<rect x="0" y="0" width="${width}" height="${height}" class="${className}__canvas" />`
    + belt
    + bays
    + vehicles
    + emptyLabel
    + '</svg>';
}

/**
 * Stylesheet for the classes emitted by renderLevelSvg. Consumers inject it once;
 * keeping it next to the renderer stops the two copies from drifting apart.
 */
export function levelSvgStyles(className = 'level-thumb', palette = {}) {
  const colors = {
    canvas: '#0e1013',
    belt: '#5b6470',
    bay: '#3d444f',
    empty: '#5b6470',
    hidden: '#f5c542',
    turn: '#43d1c4',
    ...palette
  };
  return `.${className}__canvas { fill: ${colors.canvas}; }`
    + `.${className}__belt { fill: ${colors.belt}; font-size: 8px; font-family: ui-monospace, monospace; }`
    + `.${className}__bay { fill: none; stroke: ${colors.bay}; stroke-width: 0.8; stroke-dasharray: 2 2; }`
    + `.${className}__car { stroke: rgba(0,0,0,0.45); stroke-width: 0.5; }`
    + `.${className}__car--hidden { stroke: ${colors.hidden}; stroke-width: 1.2; }`
    + `.${className}__car--turn { stroke: ${colors.turn}; stroke-width: 1.2; }`
    + `.${className}__empty { fill: ${colors.empty}; font-size: 11px; }`;
}

export function escapeXml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}
