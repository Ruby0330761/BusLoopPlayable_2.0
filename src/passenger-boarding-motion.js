// Keep each passenger visible for three advancing visual frames after contact.
// This is a per-passenger frame count, independent of run speed or centre arrival.
export const BOARDING_CONTACT_HIDE_FRAMES = 3;
// A short entry into the body keeps even slow/boosted frames away from the bay
// centre. Spread this inset over the three frames so the passenger keeps moving.
export const BOARDING_CONTACT_ENTRY_FRACTION = 0.25;

// The next row may leave when the third passenger in this row starts running.
// Share the interval between the model gate and the individual visual delays.
export function getBoardingRowTiming(passengers = {}, groupSize = 4) {
  const configured = Number(passengers.aboardInterval);
  const passengerInterval = Number.isFinite(configured) && configured > 0 ? configured : 0.05;
  const count = Math.max(1, Math.floor(Number(groupSize) || 4));
  return {
    passengerInterval,
    rowInterval: Math.max(1, Math.min(2, count - 1)) * passengerInterval
  };
}

// The vehicle-facing edge is the outside of the row at the boarding exit.
// Resolve it in world space so mirrored/rotated tracks do not reverse the order.
export function getBoardingPassengerOrder(starts, target) {
  const distanceSquared = (point) => (
    (point.x - target.x) ** 2 + (point.y - target.y) ** 2 + (point.z - target.z) ** 2
  );
  return starts.map((_, index) => index).sort((a, b) => (
    distanceSquared(starts[a]) - distanceSquared(starts[b]) || a - b
  ));
}

// Sweep the passenger's path through the car's horizontal contact bounds.
// A sweep also catches contact when a fast/low-FPS frame crosses the boundary.
// Points and bounds must all use the same (vehicle-local) coordinate space.
export function getBoardingContactProgress(start, end, bounds, footprint = []) {
  if (!bounds) return null;
  const axes = [{ x: 1, z: 0 }, { x: 0, z: 1 }];
  // Include the passenger's axes too: expanding only the car's local AABB
  // would falsely report early contact at rotated rectangle corners.
  for (let index = 0; index < footprint.length; index += 1) {
    const point = footprint[index];
    const next = footprint[(index + 1) % footprint.length];
    const length = Math.hypot(next.x - point.x, next.z - point.z);
    if (length > 1e-12) axes.push({ x: -(next.z - point.z) / length, z: (next.x - point.x) / length });
  }
  let enter = 0;
  let leave = 1;
  for (const axis of axes) {
    const project = (point) => point.x * axis.x + point.z * axis.z;
    const from = project(start);
    const delta = project(end) - from;
    const passenger = footprint.length ? footprint.map(project) : [0];
    const min = (axis.x >= 0 ? bounds.min.x : bounds.max.x) * axis.x
      + (axis.z >= 0 ? bounds.min.z : bounds.max.z) * axis.z - Math.max(...passenger);
    const max = (axis.x >= 0 ? bounds.max.x : bounds.min.x) * axis.x
      + (axis.z >= 0 ? bounds.max.z : bounds.min.z) * axis.z - Math.min(...passenger);
    if (![from, delta, min, max].every(Number.isFinite) || min > max) return null;
    if (Math.abs(delta) < 1e-12) {
      if (from < min || from > max) return null;
      continue;
    }
    const a = (min - from) / delta;
    const b = (max - from) / delta;
    enter = Math.max(enter, Math.min(a, b));
    leave = Math.min(leave, Math.max(a, b));
    if (enter > leave + 1e-9) return null;
  }
  return Math.max(0, Math.min(1, enter));
}
