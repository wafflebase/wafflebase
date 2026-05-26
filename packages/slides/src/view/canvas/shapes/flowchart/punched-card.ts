import type { PathBuilder } from '../builder';

/**
 * `flowChartPunchedCard` — rectangle with the top-left corner cut
 * along a diagonal of length `min(w, h) * 0.25`.
 */
export const buildFlowChartPunchedCard: PathBuilder = ({ w, h }) => {
  const cut = Math.min(w, h) * 0.25;
  const path = new Path2D();
  path.moveTo(cut, 0);
  path.lineTo(w, 0);
  path.lineTo(w, h);
  path.lineTo(0, h);
  path.lineTo(0, cut);
  path.closePath();
  return path;
};
