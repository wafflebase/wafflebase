import type { PathBuilder } from '../builder';

/**
 * `flowChartExtract` — upward triangle. OOXML vertices (2×2 box):
 * (0,2)(1,0)(2,2).
 */
export const buildFlowChartExtract: PathBuilder = ({ w, h }) => {
  const path = new Path2D();
  path.moveTo(0, h);
  path.lineTo(w / 2, 0);
  path.lineTo(w, h);
  path.closePath();
  return path;
};
