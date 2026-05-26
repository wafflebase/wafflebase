import type { PathBuilder } from '../builder';
import { regularPolygonPath } from '../builder';

/**
 * `pentagon` — regular convex pentagon inscribed in the element frame
 * with the apex at the top edge midpoint. No adjustments.
 */
export const buildPentagon: PathBuilder = ({ w, h }) => {
  const cx = w / 2;
  const cy = h / 2;
  const verts = regularPolygonPath(cx, cy, w / 2, h / 2, 5);
  const path = new Path2D();
  path.moveTo(verts[0].x, verts[0].y);
  for (let i = 1; i < verts.length; i++) {
    path.lineTo(verts[i].x, verts[i].y);
  }
  path.closePath();
  return path;
};
