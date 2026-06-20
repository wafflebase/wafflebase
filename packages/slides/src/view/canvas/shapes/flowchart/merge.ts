import type { PathBuilder } from '../builder';

/**
 * `flowChartMerge` — downward triangle. OOXML vertices (2×2 box):
 * (0,0)(2,0)(1,2).
 */
export const buildFlowChartMerge: PathBuilder = ({ w, h }) => {
  const path = new Path2D();
  path.moveTo(0, 0);
  path.lineTo(w, 0);
  path.lineTo(w / 2, h);
  path.closePath();
  return path;
};
