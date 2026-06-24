import type { PathBuilder } from '../builder';

/**
 * `flowChartManualOperation` — inverted trapezoid (top wider than
 * bottom). Per ECMA-376 (path box 5×5, bottom corners at `x=1`/`x=4`)
 * the bottom inset = `w * 0.2` per side.
 */
export const buildFlowChartManualOperation: PathBuilder = ({ w, h }) => {
  const inset = w * 0.2;
  const path = new Path2D();
  path.moveTo(0, 0);
  path.lineTo(w, 0);
  path.lineTo(w - inset, h);
  path.lineTo(inset, h);
  path.closePath();
  return path;
};
