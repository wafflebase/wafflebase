import type { PathBuilder } from '../builder';
import { polylineArc } from '../curves';

/**
 * `heart` — non-parametric heart outline. Two top semicircular
 * lobes meeting at the centre dip + V-shape descending to the
 * bottom tip. V0 polyline approximation of the OOXML preset's
 * cubic Béziers.
 *
 * Path traced clockwise from the centre dip: through the LEFT
 * lobe's top half, down the V to the tip, up the right side, and
 * through the RIGHT lobe's top half back to the dip.
 */
export const buildHeart: PathBuilder = ({ w, h }) => {
  const cx = w / 2;
  const lobeR = w / 4;
  const lobeY = h / 4;
  const path = new Path2D();
  // Centre dip — start of CW outline.
  path.moveTo(cx, lobeY);
  // Left lobe: top semicircle from (cx, lobeY) via the top to
  // (cx − w/2, lobeY). θ runs 0 → −π (negative = upward in screen
  // y-down).
  const left = polylineArc(cx - lobeR, lobeY, lobeR, lobeR, 0, -Math.PI, 16);
  for (let i = 1; i < left.length; i++) {
    path.lineTo(left[i].x, left[i].y);
  }
  // Down the V to the bottom tip.
  path.lineTo(cx, h);
  // Right lobe: top semicircle from (cx + w/2, lobeY) [right
  // shoulder] via the top back to (cx, lobeY) [dip]. θ runs 0 →
  // −π so the first point is the right shoulder. Walking from
  // i = 0 makes the V's upward stroke land as the first lineTo
  // from the tip.
  const right = polylineArc(cx + lobeR, lobeY, lobeR, lobeR, 0, -Math.PI, 16);
  for (const p of right) {
    path.lineTo(p.x, p.y);
  }
  path.closePath();
  return path;
};
