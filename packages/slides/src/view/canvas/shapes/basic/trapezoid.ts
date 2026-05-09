import type { PathBuilder, AdjustmentSpec } from '../builder';
import { adj } from '../builder';

/**
 * `trapezoid` — narrower top, full-width bottom.
 *
 * Adjustments:
 *   [0] topInset — symmetric inset of each top corner as OOXML
 *       thousandths of `w`; default 25000 (25%).
 */
export const TRAPEZOID_ADJUSTMENTS: readonly AdjustmentSpec[] = [
  { name: 'Top inset', defaultValue: 25000, min: 0, max: 50000 },
];

export const buildTrapezoid: PathBuilder = ({ w, h }, adjustments) => {
  const inset = (adj(adjustments, 0, 25000) / 100000) * w;
  const path = new Path2D();
  path.moveTo(inset, 0);
  path.lineTo(w - inset, 0);
  path.lineTo(w, h);
  path.lineTo(0, h);
  path.closePath();
  return path;
};
