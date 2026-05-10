import type { PathBuilder } from '../builder';

/**
 * `flowChartManualInput` — quadrilateral with the top-left vertex
 * pulled down to `y = h/4`, giving a slanted top edge. Bottom is
 * a flat line.
 */
export const buildFlowChartManualInput: PathBuilder = ({ w, h }) => {
  const path = new Path2D();
  path.moveTo(0, h / 4);
  path.lineTo(w, 0);
  path.lineTo(w, h);
  path.lineTo(0, h);
  path.closePath();
  return path;
};
