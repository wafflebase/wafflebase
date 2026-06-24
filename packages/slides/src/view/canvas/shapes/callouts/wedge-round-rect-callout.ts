import type { PathBuilder, AdjustmentSpec, AdjustmentHandle } from '../builder';
import { adj } from '../builder';
import { linearTopEdgeHandle } from '../handles';
import { pointTailHandle } from './handles';
import { wedgeTailGuides } from './wedge-common';
import { arcTo, CD2, CD3_4, CD4 } from './ooxml-math';

/**
 * `wedgeRoundRectCallout` — rounded speech-bubble rectangle with a
 * triangular tail. Faithful port of the ECMA-376 preset: same tail
 * guides as `wedgeRectCallout` (see `wedge-common.ts`), plus rounded
 * corners of radius `u1 = ss·adj3/100000`.
 *
 * Adjustments (`WEDGE_ROUND_RECT_CALLOUT_ADJUSTMENTS`):
 *   [0] adj1 — tail tip x, thousandths of `w` from centre. Default -20833.
 *   [1] adj2 — tail tip y, thousandths of `h` from centre. Default 62500.
 *   [2] adj3 — corner radius, thousandths of `min(w, h)`. Default 16667.
 */
export const WEDGE_ROUND_RECT_CALLOUT_ADJUSTMENTS: readonly AdjustmentSpec[] = [
  { name: 'Tail x', defaultValue: -20833, min: -100000, max: 100000 },
  { name: 'Tail y', defaultValue: 62500, min: -100000, max: 100000 },
  { name: 'Corner radius', defaultValue: 16667, min: 0, max: 50000 },
];

export const buildWedgeRoundRectCallout: PathBuilder = (
  { w, h },
  adjustments,
) => {
  const g = wedgeTailGuides(
    w,
    h,
    adj(adjustments, 0, -20833),
    adj(adjustments, 1, 62500),
  );
  const ss = Math.min(w, h);
  const u1 = (ss * adj(adjustments, 2, 16667)) / 100000;
  const u2 = w - u1;
  const v2 = h - u1;

  const path = new Path2D();
  // OOXML pathLst: rounded rectangle (quarter-circle corners of radius u1)
  // walked clockwise from the top-left, with the same conditional tail
  // vertex inserted into each edge as the sharp-cornered variant.
  let cur = { x: 0, y: u1 };
  path.moveTo(cur.x, cur.y);
  cur = arcTo(path, cur, u1, u1, CD2, CD4); // top-left corner
  path.lineTo(g.x1, 0);
  path.lineTo(g.xt, g.yt);
  path.lineTo(g.x2, 0);
  path.lineTo(u2, 0);
  cur = { x: u2, y: 0 };
  cur = arcTo(path, cur, u1, u1, CD3_4, CD4); // top-right corner
  path.lineTo(w, g.y1);
  path.lineTo(g.xr, g.yr);
  path.lineTo(w, g.y2);
  path.lineTo(w, v2);
  cur = { x: w, y: v2 };
  cur = arcTo(path, cur, u1, u1, 0, CD4); // bottom-right corner
  path.lineTo(g.x2, h);
  path.lineTo(g.xb, g.yb);
  path.lineTo(g.x1, h);
  path.lineTo(u1, h);
  cur = { x: u1, y: h };
  cur = arcTo(path, cur, u1, u1, CD4, CD4); // bottom-left corner
  path.lineTo(0, g.y2);
  path.lineTo(g.xl, g.yl);
  path.lineTo(0, g.y1);
  path.closePath();
  return path;
};

// Two handles: the tail tip (point-axis on x/y around frame centre)
// and the corner radius (linear on the top edge, controlling
// adjustments[2]). The radius handle reuses the same forward/inverse
// math as roundRect — `r = (adj/100000) * min(w,h)`.
export const WEDGE_ROUND_RECT_CALLOUT_HANDLES: readonly AdjustmentHandle[] = [
  pointTailHandle(
    WEDGE_ROUND_RECT_CALLOUT_ADJUSTMENTS[0],
    WEDGE_ROUND_RECT_CALLOUT_ADJUSTMENTS[1],
  ),
  linearTopEdgeHandle({
    forward: (adj, { w, h }) => (adj / 100000) * Math.min(w, h),
    inverse: (x, { w, h }) => (x / Math.min(w, h)) * 100000,
    spec: WEDGE_ROUND_RECT_CALLOUT_ADJUSTMENTS[2],
    index: 2,
  }),
];
