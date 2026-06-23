import type { PathBuilder } from '../builder';
import { regularPolygonPath } from '../builder';

/**
 * `dodecagon` — regular 12-sided convex polygon. Per the OOXML
 * `dodecagon` preset it has flat edges flush against all four box
 * sides (vertices straddle each cardinal by 15°), so the circumradius
 * is `(half-extent)/cos(15°)` and the ring is rotated by 15°. No
 * adjustments.
 */
export const buildDodecagon: PathBuilder = ({ w, h }) => {
  const cx = w / 2;
  const cy = h / 2;
  // Scale so the flat edges touch the frame, and offset 15° (π/12) so
  // two vertices straddle each cardinal (flat top/bottom/left/right).
  const k = 1 / Math.cos(Math.PI / 12);
  const verts = regularPolygonPath(
    cx,
    cy,
    (w / 2) * k,
    (h / 2) * k,
    12,
    -Math.PI / 2 + Math.PI / 12,
  );
  const path = new Path2D();
  path.moveTo(verts[0].x, verts[0].y);
  for (let i = 1; i < verts.length; i++) {
    path.lineTo(verts[i].x, verts[i].y);
  }
  path.closePath();
  return path;
};
