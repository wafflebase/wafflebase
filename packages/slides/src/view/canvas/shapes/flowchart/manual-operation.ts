import type { PathBuilder } from '../builder';

/**
 * `flowChartManualOperation` — inverted trapezoid (top wider than
 * bottom). Bottom inset = `w * 0.125` per side, matching the
 * common OOXML preset proportion.
 */
export const buildFlowChartManualOperation: PathBuilder = ({ w, h }) => {
  const inset = w * 0.125;
  const path = new Path2D();
  path.moveTo(0, 0);
  path.lineTo(w, 0);
  path.lineTo(w - inset, h);
  path.lineTo(inset, h);
  path.closePath();
  return path;
};
