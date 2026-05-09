import type { PathBuilder } from '../builder';

/**
 * `rtTriangle` — right triangle with the right angle at bottom-left.
 * No adjustments. Vertices: (0, 0), (0, h), (w, h).
 */
export const buildRtTriangle: PathBuilder = ({ w, h }) => {
  const path = new Path2D();
  path.moveTo(0, 0);
  path.lineTo(0, h);
  path.lineTo(w, h);
  path.closePath();
  return path;
};
