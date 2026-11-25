import { CubicBezierCurve3 } from 'three';

// Preserve the approaching row's heading at the junction, then match the
// conveyor position and heading downstream. Both sides of the turn are C1.
export function createPassengerEntryTurn({ queueCurve, conveyorCurve, entryPercent, distance }) {
  if (!queueCurve || !conveyorCurve || !(distance > 0)) return null;
  const length = conveyorCurve.getLength();
  if (!(length > 0)) return null;
  const joinDistance = Math.min(distance, length * 0.1);
  // Start at the original waiting point. Only a dequeued row takes this turn;
  // queued rows keep their authored position and heading until called in.
  const start = queueCurve.getPointAt(0);
  const incoming = queueCurve.getTangentAt(0).negate();
  const joinPercent = ((entryPercent + joinDistance / length) % 1 + 1) % 1;
  const end = conveyorCurve.getPointAt(joinPercent);
  const outgoing = conveyorCurve.getTangentAt(joinPercent);
  const handleLength = Math.min(joinDistance * 0.45, start.distanceTo(end) * 0.55);
  if (!(handleLength > 0.000001)) return null;
  const curve = new CubicBezierCurve3(
    start,
    start.clone().addScaledVector(incoming, handleLength),
    end.clone().addScaledVector(outgoing, -handleLength),
    end
  );
  curve.arcLengthDivisions = 96;
  return { curve, distance: joinDistance };
}

export function samplePassengerEntryTurn(turn, distance) {
  const progress = Math.min(1, Math.max(0, distance / turn.distance));
  return {
    position: turn.curve.getPointAt(progress),
    tangent: turn.curve.getTangentAt(progress)
  };
}
