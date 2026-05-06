/**
 * Rotate-handle math. Pure functions; the editor wires the pointer
 * stream and supplies the slide-coords angles.
 *
 * `applyRotate(startRotation, startAngle, currentAngle, shift)` returns
 * the new rotation (radians). The convention matches `Frame.rotation`:
 * positive radians, counter-clockwise unconstrained — wrapping is up to
 * the renderer / consumer.
 *
 * `shift` snaps the result to 15° (π/12) increments, matching the line
 * angle snap used in docs.
 */

const STEP = Math.PI / 12; // 15°

export function applyRotate(
  startRotation: number,
  startAngle: number,
  currentAngle: number,
  shift: boolean,
): number {
  const delta = currentAngle - startAngle;
  const next = startRotation + delta;
  return shift ? snapAngle(next) : next;
}

export function snapAngle(angle: number): number {
  return Math.round(angle / STEP) * STEP;
}
