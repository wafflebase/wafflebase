import type { PathBuilder } from '../builder';

/**
 * `flowChartPredefinedProcess` — rectangle with two thin vertical
 * bars at `x = w/8` and `x = 7w/8`. Bars render as separate
 * sub-paths so stroke draws them; fill paints the outer rect only
 * via nonzero rule (bars are zero-area lines).
 */
export const buildFlowChartPredefinedProcess: PathBuilder = ({ w, h }) => {
  const path = new Path2D();
  path.rect(0, 0, w, h);
  path.moveTo(w / 8, 0);
  path.lineTo(w / 8, h);
  path.moveTo((7 * w) / 8, 0);
  path.lineTo((7 * w) / 8, h);
  return path;
};
