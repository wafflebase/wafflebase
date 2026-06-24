import type { PathBuilder } from '../builder';
import { regularPolygonPath } from '../builder';

/**
 * `decagon` — regular 10-sided convex polygon inscribed in the
 * element frame. Per the OOXML `decagon` preset it has a vertex on
 * the horizontal axis (points left/right, flat-ish top/bottom), not
 * an apex at the top. No adjustments.
 */
export const buildDecagon: PathBuilder = ({ w, h }) => {
  const cx = w / 2;
  const cy = h / 2;
  // rotation 0 ⇒ first vertex on the +x axis (right), matching OOXML.
  const verts = regularPolygonPath(cx, cy, w / 2, h / 2, 10, 0);
  const path = new Path2D();
  path.moveTo(verts[0].x, verts[0].y);
  for (let i = 1; i < verts.length; i++) {
    path.lineTo(verts[i].x, verts[i].y);
  }
  path.closePath();
  return path;
};
