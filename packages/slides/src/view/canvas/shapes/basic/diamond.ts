import type { PathBuilder } from '../builder';

/**
 * `diamond` — rhombus with vertices at the midpoints of each frame
 * edge. No adjustments.
 */
export const buildDiamond: PathBuilder = ({ w, h }) => {
  const path = new Path2D();
  path.moveTo(w / 2, 0);
  path.lineTo(w, h / 2);
  path.lineTo(w / 2, h);
  path.lineTo(0, h / 2);
  path.closePath();
  return path;
};
