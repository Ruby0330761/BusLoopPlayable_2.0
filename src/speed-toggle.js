// The playable's sticky speed switch scales the whole simulation clock. Scaling
// the frame delta (rather than the belt multiplier) means vehicle routes,
// boarding, collisions, and the conveyor all keep their relative pace, which is
// what a player reads as "2x".

export function normalizeSpeedMultiplier(value, fallback = 1) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.max(0.1, number) : fallback;
}

export function resolveTimeScale({ multiplier = 2, boosted = false } = {}) {
  return boosted ? normalizeSpeedMultiplier(multiplier, 2) : 1;
}

export function formatSpeedLabel(multiplier) {
  return `x${Math.round(normalizeSpeedMultiplier(multiplier, 1) * 100) / 100}`;
}
