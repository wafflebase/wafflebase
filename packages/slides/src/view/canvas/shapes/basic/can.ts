import type { PathBuilder, AdjustmentSpec } from '../builder';
import { adj } from '../builder';

/**
 * `can` — cylinder side view. Outline is a top half-ellipse, two
 * vertical sides, a bottom half-ellipse, plus a separate full top
 * ellipse so the lid is visible when the shape is stroked.
 *
 * Canvas-angle reminder (y-down): angle 0 is +x (right), increasing
 * angle visually rotates clockwise. PI/2 = visually DOWN, 3PI/2 =
 * visually UP. With `anticlockwise=false` (default), the arc traces
 * by increasing angle. So `ellipse(..., PI, 0)` (CW) traces from the
 * left point through 3PI/2 (top) to the right point — the upper half.
 * Conversely `ellipse(..., 0, PI)` (CW) traces through PI/2 (bottom).
 *
 * Adjustments:
 *   [0] topEllipseHeight — half-height of the top/bottom ellipses as
 *       OOXML thousandths of `h`; default 25000 (25%).
 */
export const CAN_ADJUSTMENTS: readonly AdjustmentSpec[] = [
  { name: 'Top ellipse height', defaultValue: 25000, min: 0, max: 50000 },
];

export const buildCan: PathBuilder = ({ w, h }, adjustments) => {
  const ry = (adj(adjustments, 0, 25000) / 100000) * h;
  const path = new Path2D();
  // Body silhouette: cylinder side view.
  // Start at the left edge of the top lid level, sweep over the top
  // half-ellipse, down the right side, through the bottom half-ellipse,
  // then back up the left side via closePath.
  path.moveTo(0, ry);
  // Upper half-arc — anticlockwise=false (default). From PI (left) to
  // 0 (right) the angle parameter wraps PI → 3PI/2 → 2PI, tracing
  // through the top of the ellipse.
  path.ellipse(w / 2, ry, w / 2, ry, 0, Math.PI, 0);
  path.lineTo(w, h - ry);
  // Lower half-arc — anticlockwise=false (default). From 0 (right) to
  // PI (left), angle increases through PI/2, tracing through the
  // bottom of the ellipse.
  path.ellipse(w / 2, h - ry, w / 2, ry, 0, 0, Math.PI);
  path.closePath();
  // Lid line — separate sub-path so the can opening stays visible
  // when the shape is stroked. Drawn after the body fills, the lid
  // ellipse renders as a thin oval across the top.
  path.ellipse(w / 2, ry, w / 2, ry, 0, 0, Math.PI * 2);
  return path;
};
