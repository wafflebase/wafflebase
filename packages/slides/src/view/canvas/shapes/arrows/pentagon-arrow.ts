import type { PathBuilder, AdjustmentSpec } from '../builder';
import { adj } from '../builder';

/**
 * `pentagonArrow` — homePlate-style pentagon pointing right.
 *
 * Adjustments (`PENTAGON_ARROW_ADJUSTMENTS`):
 *   [0] pointLen — OOXML thousandths of `w`; default 50000.
 */
export const PENTAGON_ARROW_ADJUSTMENTS: readonly AdjustmentSpec[] = [
  { name: 'Point length', defaultValue: 50000, min: 0, max: 100000 },
];

export const buildPentagonArrow: PathBuilder = ({ w, h }, adjustments) => {
  const point = (adj(adjustments, 0, 50000) / 100000) * w;
  const path = new Path2D();
  path.moveTo(0, 0);
  path.lineTo(w - point, 0);
  path.lineTo(w, h / 2);
  path.lineTo(w - point, h);
  path.lineTo(0, h);
  path.closePath();
  return path;
};
