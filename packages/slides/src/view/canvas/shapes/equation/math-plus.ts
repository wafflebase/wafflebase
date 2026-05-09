import type { PathBuilder, AdjustmentSpec } from '../builder';
import { adj } from '../builder';

/**
 * `mathPlus` — `+` glyph filling the frame as a single 12-vertex
 * cross polygon.
 *
 * Adjustments (`MATH_PLUS_ADJUSTMENTS`):
 *   [0] armThickness — OOXML thousandths of `min(w,h)`. Default 23520.
 *
 * Implemented as one closed polygon outlining the union of horizontal
 * and vertical bars (same shape as `basic/plus`). Two separate rect
 * sub-paths would each stroke independently, painting a visible
 * square outline at the centre where the bars overlap.
 */
export const MATH_PLUS_ADJUSTMENTS: readonly AdjustmentSpec[] = [
  { name: 'Arm thickness', defaultValue: 23520, min: 0, max: 50000 },
];

export const buildMathPlus: PathBuilder = ({ w, h }, adjustments) => {
  const t = (adj(adjustments, 0, 23520) / 100000) * Math.min(w, h);
  const xL = (w - t) / 2;
  const xR = (w + t) / 2;
  const yT = (h - t) / 2;
  const yB = (h + t) / 2;
  const path = new Path2D();
  path.moveTo(xL, 0);
  path.lineTo(xR, 0);
  path.lineTo(xR, yT);
  path.lineTo(w, yT);
  path.lineTo(w, yB);
  path.lineTo(xR, yB);
  path.lineTo(xR, h);
  path.lineTo(xL, h);
  path.lineTo(xL, yB);
  path.lineTo(0, yB);
  path.lineTo(0, yT);
  path.lineTo(xL, yT);
  path.closePath();
  return path;
};
