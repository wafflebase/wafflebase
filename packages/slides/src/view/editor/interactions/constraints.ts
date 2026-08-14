/**
 * Pure constraint helpers used by drag interactions when the user
 * holds Shift. Each function is DOM-free, deterministic, and sized
 * for unit testing. Call sites: see editor.ts.
 *
 * Mirrors the structure of sibling modules (resize.ts, rotate.ts,
 * adjustment.ts): pure functions next to their consumers.
 */

const ANGLE_STEP = Math.PI / 12; // 15°, matches rotate.ts STEP.

/**
 * Force a 1:1 aspect on a drag rect. The longer of |dx| / |dy|
 * defines the side length; the shorter axis's sign is preserved so
 * the result stays in the user's drag quadrant.
 *
 * start === end returns end unchanged.
 */
export function constrainToSquare(
  start: { x: number; y: number },
  end: { x: number; y: number },
): { x: number; y: number } {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const adx = Math.abs(dx);
  const ady = Math.abs(dy);
  if (adx === 0 && ady === 0) return end;
  const side = Math.max(adx, ady);
  const sx = dx < 0 ? -1 : 1;
  const sy = dy < 0 ? -1 : 1;
  return { x: start.x + side * sx, y: start.y + side * sy };
}

/**
 * Rotate `end` around `start` so the angle from start→end snaps to
 * the nearest 15° increment. Length |end - start| is preserved; only
 * direction changes.
 *
 * start === end returns end unchanged (zero-length vector has no
 * meaningful angle).
 */
export function snapEndpointAngle(
  start: { x: number; y: number },
  end: { x: number; y: number },
): { x: number; y: number } {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  if (dx === 0 && dy === 0) return end;
  const length = Math.hypot(dx, dy);
  const angle = Math.atan2(dy, dx);
  const snapped = Math.round(angle / ANGLE_STEP) * ANGLE_STEP;
  return {
    x: start.x + Math.cos(snapped) * length,
    y: start.y + Math.sin(snapped) * length,
  };
}

/**
 * Which axis a Shift-constrained drag should keep. |dx| >= |dy| picks
 * X; the tie goes to X for determinism.
 *
 * Split out from {@link lockAxis} because the axis has to be decided
 * from the RAW pointer delta and then re-applied after the snap
 * pipeline has run. Re-deriving it from corrected values is not safe:
 * grid snapping can cancel the intended axis to zero and add up to half
 * a step to the perpendicular one, which flips the answer and sends the
 * element sideways. Callers that need both should resolve the axis once
 * and hold on to it.
 *
 * Re-evaluated every mousemove — when the user changes drag direction
 * mid-stream, the lock switches axes naturally.
 */
export function dominantAxis(dx: number, dy: number): 'x' | 'y' {
  return Math.abs(dx) >= Math.abs(dy) ? 'x' : 'y';
}

/**
 * Project a pointer delta onto the dominant axis. When |dx| >= |dy|
 * returns (dx, 0); otherwise (0, dy).
 */
export function lockAxis(
  dx: number,
  dy: number,
): { dx: number; dy: number } {
  return dominantAxis(dx, dy) === 'x' ? { dx, dy: 0 } : { dx: 0, dy };
}

/** Zero the axis `axis` does not name, keeping the other as-is. */
export function applyAxisLock(
  axis: 'x' | 'y',
  dx: number,
  dy: number,
): { dx: number; dy: number } {
  return axis === 'x' ? { dx, dy: 0 } : { dx: 0, dy };
}
