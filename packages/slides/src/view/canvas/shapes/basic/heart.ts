import type { PathBuilder } from '../builder';

/**
 * `heart` — faithful to the ECMA-376 preset geometry: two cubic Béziers
 * (one per half) whose control points reach above the top edge
 * (`y1 = −h/3`) and beyond the sides (`x4 = 73w/48`, `x1 = −25w/48`) to
 * form the rounded lobes and the curved sides tapering to the bottom tip.
 *
 * Traced from the centre dip `(hc, hd4)`: down the right side to the tip
 * `(hc, b)`, then up the left side back to the dip.
 *
 * Guides (hc=w/2, hd4=h/4, hd3=h/3, t=0, b=h):
 *   dx1 = w·49/48, dx2 = w·10/48
 *   x1 = hc−dx1, x2 = hc−dx2, x3 = hc+dx2, x4 = hc+dx1, y1 = t−hd3
 */
export const buildHeart: PathBuilder = ({ w, h }) => {
  const hc = w / 2;
  const hd4 = h / 4;
  const hd3 = h / 3;
  const dx1 = (w * 49) / 48;
  const dx2 = (w * 10) / 48;
  const x1 = hc - dx1;
  const x2 = hc - dx2;
  const x3 = hc + dx2;
  const x4 = hc + dx1;
  const y1 = -hd3; // t − hd3

  const path = new Path2D();
  path.moveTo(hc, hd4);
  path.bezierCurveTo(x3, y1, x4, hd4, hc, h);
  path.bezierCurveTo(x1, hd4, x2, y1, hc, hd4);
  path.closePath();
  return path;
};
