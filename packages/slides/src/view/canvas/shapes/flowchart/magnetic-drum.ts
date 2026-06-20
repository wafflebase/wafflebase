import type { PathBuilder } from '../builder';

/**
 * `flowChartMagneticDrum` — a horizontal cylinder (drum on its side).
 * The `can` silhouette rotated 90°: straight top/bottom edges, convex
 * half-ellipse caps on the left and right (radius `w/6`), and the
 * concave seam of the right cap drawn to show the drum face.
 */
export const buildFlowChartMagneticDrum: PathBuilder = ({ w, h }) => {
  const rx = w / 6;
  const cy = h / 2;
  const path = new Path2D();
  path.moveTo(rx, 0);
  path.lineTo(w - rx, 0);
  // Right cap — convex outward.
  path.ellipse(w - rx, cy, rx, h / 2, 0, -Math.PI / 2, Math.PI / 2, false);
  path.lineTo(rx, h);
  // Left cap — convex outward.
  path.ellipse(rx, cy, rx, h / 2, 0, Math.PI / 2, (3 * Math.PI) / 2, false);
  path.closePath();
  // Drum-face seam — concave inner half of the right cap.
  path.moveTo(w - rx, 0);
  path.ellipse(w - rx, cy, rx, h / 2, 0, -Math.PI / 2, Math.PI / 2, true);
  return path;
};
