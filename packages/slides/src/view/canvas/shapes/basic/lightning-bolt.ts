import type { PathBuilder } from '../builder';

/**
 * `lightningBolt` — non-parametric jagged Z-shape. Six vertices
 * trace the OOXML preset's signature bolt outline (top-left to
 * bottom-right zigzag).
 */
export const buildLightningBolt: PathBuilder = ({ w, h }) => {
  const path = new Path2D();
  // Coordinates expressed as fractions, scaled by w/h. Approximates
  // the OOXML lightningBolt preset's outline.
  const pts: ReadonlyArray<readonly [number, number]> = [
    [0.4, 0.0],
    [0.7, 0.0],
    [0.55, 0.4],
    [0.85, 0.4],
    [0.3, 1.0],
    [0.5, 0.55],
    [0.2, 0.55],
  ];
  path.moveTo(pts[0][0] * w, pts[0][1] * h);
  for (let i = 1; i < pts.length; i++) {
    path.lineTo(pts[i][0] * w, pts[i][1] * h);
  }
  path.closePath();
  return path;
};
