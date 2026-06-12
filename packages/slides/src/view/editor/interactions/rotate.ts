/**
 * Rotate-handle math. Pure functions; the editor wires the pointer
 * stream and supplies the slide-coords angles.
 *
 * `applyRotate(startRotation, startAngle, currentAngle, shift)` returns
 * the new rotation (radians). The convention matches `Frame.rotation`:
 * positive radians, counter-clockwise unconstrained — wrapping is up to
 * the renderer / consumer.
 *
 * - `shift = true` snaps the result to 15° (π/12) increments, matching
 *   the line angle snap used in docs.
 * - `shift = false` soft-snaps near the cardinals (0/90/180/270°,
 *   modulo 360°) within ±3°, matching Google Slides' free-rotate
 *   behavior. This stops a drag back toward 0° from leaving a tiny
 *   non-zero radian value that renders crooked.
 */

const STEP = Math.PI / 12; // 15°
const CARDINAL_STEP = Math.PI / 2; // 90°
const CARDINAL_TOLERANCE = Math.PI / 60; // 3°

export function applyRotate(
  startRotation: number,
  startAngle: number,
  currentAngle: number,
  shift: boolean,
): number {
  const delta = currentAngle - startAngle;
  const next = startRotation + delta;
  return shift ? snapAngle(next) : snapToCardinal(next);
}

export function snapAngle(angle: number): number {
  return Math.round(angle / STEP) * STEP;
}

export function snapToCardinal(
  angle: number,
  tolerance: number = CARDINAL_TOLERANCE,
): number {
  const nearest = Math.round(angle / CARDINAL_STEP) * CARDINAL_STEP;
  return Math.abs(angle - nearest) < tolerance ? nearest : angle;
}
