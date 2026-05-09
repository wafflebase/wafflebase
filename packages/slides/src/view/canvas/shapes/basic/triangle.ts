import type { PathBuilder, AdjustmentSpec } from '../builder';
import { adj } from '../builder';

/**
 * `triangle` — apex on the top edge, base spanning the bottom.
 *
 * Adjustments:
 *   [0] apexX — apex x position as OOXML thousandths of `w`; default
 *       50000 (centred). 0 = apex over top-left, 100000 = top-right.
 */
export const TRIANGLE_ADJUSTMENTS: readonly AdjustmentSpec[] = [
  { name: 'Apex position', defaultValue: 50000, min: 0, max: 100000 },
];

export const buildTriangle: PathBuilder = ({ w, h }, adjustments) => {
  const apexX = (adj(adjustments, 0, 50000) / 100000) * w;
  const path = new Path2D();
  path.moveTo(apexX, 0);
  path.lineTo(w, h);
  path.lineTo(0, h);
  path.closePath();
  return path;
};
