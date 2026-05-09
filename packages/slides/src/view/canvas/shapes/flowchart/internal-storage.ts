import type { PathBuilder } from '../builder';

/**
 * `flowChartInternalStorage` — rectangle with one horizontal bar
 * at `y = h/8` (top "header") and one vertical bar at `x = w/8`
 * (left "stub"), evoking a register / memory cell.
 */
export const buildFlowChartInternalStorage: PathBuilder = ({ w, h }) => {
  const path = new Path2D();
  path.rect(0, 0, w, h);
  path.moveTo(0, h / 8);
  path.lineTo(w, h / 8);
  path.moveTo(w / 8, 0);
  path.lineTo(w / 8, h);
  return path;
};
