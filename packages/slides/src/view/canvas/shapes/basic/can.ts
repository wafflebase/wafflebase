import type { PathBuilder, AdjustmentSpec } from '../builder';
import { adj } from '../builder';

/**
 * `can` — cylinder side view. Outline is a top half-ellipse, two
 * vertical sides, a bottom half-ellipse, plus a separate full top
 * ellipse so the lid is visible when the shape is stroked.
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
  // Outline: top half-ellipse + right side + bottom half-ellipse + left side.
  path.moveTo(0, ry);
  path.bezierCurveTo(0, 0, w, 0, w, ry);
  path.lineTo(w, h - ry);
  path.bezierCurveTo(w, h, 0, h, 0, h - ry);
  path.closePath();
  // Top ellipse drawn as a separate sub-path so the lid is visible
  // when the renderer strokes both sub-paths.
  path.ellipse(w / 2, ry, w / 2, ry, 0, 0, Math.PI * 2);
  return path;
};
