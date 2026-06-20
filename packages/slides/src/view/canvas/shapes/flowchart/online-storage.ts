import type { PathBuilder } from '../builder';

/**
 * `flowChartOnlineStorage` — a rectangle with a convex left edge and a
 * concave right edge (both half-ellipses of radius `w/6`). OOXML path
 * box 6×6: top runs from x=1 to x=6, the right edge curves inward, the
 * bottom runs back to x=1, and the left edge bulges outward.
 */
export const buildFlowChartOnlineStorage: PathBuilder = ({ w, h }) => {
  const rx = w / 6;
  const cy = h / 2;
  const path = new Path2D();
  // Top edge.
  path.moveTo(rx, 0);
  path.lineTo(w, 0);
  // Right edge — concave inward half-ellipse (centre at x=w).
  path.ellipse(w, cy, rx, h / 2, 0, -Math.PI / 2, Math.PI / 2, true);
  // Bottom edge.
  path.lineTo(rx, h);
  // Left edge — convex outward half-ellipse (centre at x=rx).
  path.ellipse(rx, cy, rx, h / 2, 0, Math.PI / 2, (3 * Math.PI) / 2, false);
  path.closePath();
  return path;
};
