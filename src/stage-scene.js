import { SCENE_TUNING } from './scene-tuning.js';

// A playable stage owns the scene values that differ between the levels of one
// stitched session. They live outside both the renderer and the game model so
// neither has to import the other: scene-view reads them for art and layout,
// and the game model reads the spot count because it decides parking capacity.
let activeStageScene = null;

export function setActiveStageScene(scene = null) {
  activeStageScene = scene && typeof scene === 'object' ? scene : null;
}

export function getActiveStageScene() {
  return activeStageScene;
}

function normalizeSpotCount(value) {
  const count = Math.floor(Number(value));
  return Number.isFinite(count) && count > 0 ? count : null;
}

// Q22 runs a six-spot opening level and a four-spot hard level in one session.
// The count is not purely visual -- the game model parks cars into it -- so a
// stage that pins it has to win over the global tuning for both readers.
export function resolveParkingSpots(tuning = SCENE_TUNING.parkingSpots) {
  const base = tuning ?? {};
  const stageCount = normalizeSpotCount(activeStageScene?.parkingSpots?.count);
  if (stageCount === null) return base;
  return { ...base, count: stageCount };
}

// The parking row is laid out from a single left edge, so any count change moves
// its centre. With auto-centring on, the left edge is instead derived so the row
// stays centred on x = 0 whatever the count and spacing are.
//
// Both the renderer and the game model must use this: the model places a parked
// car on the spot it computed, and a fixed startX leaves it short of the visual
// row by half the width difference (0.075 at four spots, 0.875 at six).
export function resolveParkingStartX(spots = resolveParkingSpots()) {
  const count = Math.max(1, Math.floor(Number(spots?.count) || 1));
  const spacing = Number(spots?.spacing) || 0;
  const span = (count - 1) * spacing;
  const manual = Number(spots?.startX);
  if (!Number(spots?.autoCenter)) return Number.isFinite(manual) ? manual : -span / 2;
  return -span / 2;
}
