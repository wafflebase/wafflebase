import type { PathBuilder } from '../builder';

/**
 * `flowChartCollate` — bow-tie (two triangles meeting at the centre).
 * OOXML vertices (2×2 box): (0,0)(2,0)(1,1)(2,2)(0,2)(1,1).
 */
export const buildFlowChartCollate: PathBuilder = ({ w, h }) => {
  const path = new Path2D();
  path.moveTo(0, 0);
  path.lineTo(w, 0);
  path.lineTo(w / 2, h / 2);
  path.lineTo(w, h);
  path.lineTo(0, h);
  path.lineTo(w / 2, h / 2);
  path.closePath();
  return path;
};
