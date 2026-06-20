import type { PathBuilder } from '../builder';

/**
 * `flowChartPreparation` — elongated hexagon. OOXML vertices (10×10
 * path box): (0,5)(2,0)(8,0)(10,5)(8,10)(2,10).
 */
export const buildFlowChartPreparation: PathBuilder = ({ w, h }) => {
  const path = new Path2D();
  path.moveTo(0, h * 0.5);
  path.lineTo(w * 0.2, 0);
  path.lineTo(w * 0.8, 0);
  path.lineTo(w, h * 0.5);
  path.lineTo(w * 0.8, h);
  path.lineTo(w * 0.2, h);
  path.closePath();
  return path;
};
