import type { PathBuilder } from '../builder';

/**
 * `flowChartMagneticDisk` — the database cylinder (vertical). Same
 * silhouette as the basic `can` but with a fixed lid height of `h/6`
 * (OOXML `hR=1` of a 6-unit box). Top half-ellipse + sides + bottom
 * half-ellipse, plus the lower half of the top ellipse drawn as the
 * visible lid seam.
 */
export const buildFlowChartMagneticDisk: PathBuilder = ({ w, h }) => {
  const ry = h / 6;
  const path = new Path2D();
  path.moveTo(0, ry);
  path.ellipse(w / 2, ry, w / 2, ry, 0, Math.PI, 0);
  path.lineTo(w, h - ry);
  path.ellipse(w / 2, h - ry, w / 2, ry, 0, 0, Math.PI);
  path.closePath();
  // Lid seam — lower half of the top ellipse only.
  path.moveTo(w, ry);
  path.ellipse(w / 2, ry, w / 2, ry, 0, 0, Math.PI);
  return path;
};
