import type { PathBuilder } from '../builder';

/**
 * `flowChartSort` — diamond bisected by a horizontal line. OOXML
 * diamond vertices (2×2 box): (0,1)(1,0)(2,1)(1,2); the divider runs
 * across the middle. The divider is emitted as a second open subpath
 * so it strokes without affecting the diamond's fill.
 */
export const buildFlowChartSort: PathBuilder = ({ w, h }) => {
  const path = new Path2D();
  path.moveTo(0, h / 2);
  path.lineTo(w / 2, 0);
  path.lineTo(w, h / 2);
  path.lineTo(w / 2, h);
  path.closePath();
  // Horizontal divider.
  path.moveTo(0, h / 2);
  path.lineTo(w, h / 2);
  return path;
};
