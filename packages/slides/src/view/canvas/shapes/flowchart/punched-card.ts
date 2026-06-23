import type { PathBuilder } from '../builder';

/**
 * `flowChartPunchedCard` — rectangle with the top-left corner cut
 * along a diagonal. Per ECMA-376 (path box 5×5) the cut consumes
 * `0.2` of EACH axis independently: `w * 0.2` horizontally and
 * `h * 0.2` vertically (so the diagonal slants on a non-square box).
 */
export const buildFlowChartPunchedCard: PathBuilder = ({ w, h }) => {
  const cutX = w * 0.2;
  const cutY = h * 0.2;
  const path = new Path2D();
  path.moveTo(cutX, 0);
  path.lineTo(w, 0);
  path.lineTo(w, h);
  path.lineTo(0, h);
  path.lineTo(0, cutY);
  path.closePath();
  return path;
};
