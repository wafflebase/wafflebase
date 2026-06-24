import type { PathBuilder } from '../builder';

/**
 * `flowChartManualInput` — quadrilateral with the top-left vertex
 * pulled down to `y = h/5` (ECMA-376 path box 5×5, `y=1`), giving a
 * slanted top edge that rises to the top-right corner. Bottom is a
 * flat line.
 */
export const buildFlowChartManualInput: PathBuilder = ({ w, h }) => {
  const path = new Path2D();
  path.moveTo(0, h / 5);
  path.lineTo(w, 0);
  path.lineTo(w, h);
  path.lineTo(0, h);
  path.closePath();
  return path;
};
