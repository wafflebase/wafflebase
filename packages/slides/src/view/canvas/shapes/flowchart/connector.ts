import type { PathBuilder } from '../builder';

/**
 * `flowChartConnector` — circle/ellipse inscribed in the frame. OOXML
 * uses four quarter arcs; we use a single full ellipse (identical
 * geometry, simpler path).
 */
export const buildFlowChartConnector: PathBuilder = ({ w, h }) => {
  const path = new Path2D();
  path.ellipse(w / 2, h / 2, w / 2, h / 2, 0, 0, Math.PI * 2);
  return path;
};
