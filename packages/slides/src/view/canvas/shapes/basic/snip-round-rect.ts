import type { AdjustmentHandle, AdjustmentSpec, PathBuilder } from '../builder';
import { adj } from '../builder';
import { polylineArc } from '../curves';
import { linearLeftEdgeHandle, linearTopEdgeHandle } from '../handles';

/**
 * `snipRoundRect` — rectangle with the NW (top-left) corner rounded
 * (quarter arc) and the NE (top-right) corner chamfered (straight
 * snip); the SW and SE (bottom) corners stay square.
 *
 * Per ECMA-376 OOXML `prstGeom` preset `snipRoundRect`:
 * - `adj1` (default 16667) → NW round radius (`x1 = ss * adj1 / 100000`)
 * - `adj2` (default 16667) → NE snip size (`dx2 = ss * adj2 / 100000`)
 *
 * where `ss = min(w, h)`. The reference path (y down,
 * l=0,t=0,r=w,b=h) is:
 *
 *   moveTo(x1, t) → lnTo(x2, t) → lnTo(r, dx2) → lnTo(r, b)
 *   → lnTo(l, b) → lnTo(l, x1) → arcTo(NW quarter circle) → close
 */
export const SNIP_ROUND_RECT_ADJUSTMENTS: readonly AdjustmentSpec[] = [
  {
    name: 'NW corner radius',
    defaultValue: 16667,
    min: 0,
    max: 50000,
    axisLabel: 'nw',
  },
  {
    name: 'NE corner snip',
    defaultValue: 16667,
    min: 0,
    max: 50000,
    axisLabel: 'ne',
  },
];

export const buildSnipRoundRect: PathBuilder = ({ w, h }, adjustments) => {
  const a1 = adj(adjustments, 0, SNIP_ROUND_RECT_ADJUSTMENTS[0].defaultValue);
  const a2 = adj(adjustments, 1, SNIP_ROUND_RECT_ADJUSTMENTS[1].defaultValue);
  const ss = Math.min(w, h);
  const rNw = (a1 / 100000) * ss; // NW round radius (x1)
  const cNe = (a2 / 100000) * ss; // NE snip size (dx2)
  const path = new Path2D();
  // Start on the top edge just right of the NW rounded corner.
  path.moveTo(rNw, 0);
  // Top edge across to the start of the NE snip.
  path.lineTo(w - cNe, 0);
  // NE snip: diagonal cut down the right edge.
  path.lineTo(w, cNe);
  // Right edge down to SE (square).
  path.lineTo(w, h);
  // Bottom edge across to SW (square).
  path.lineTo(0, h);
  // Left edge up to the start of the NW rounded corner.
  path.lineTo(0, rNw);
  // NW round: quarter arc, center (rNw, rNw), from (0, rNw) up to (rNw, 0).
  const nw = polylineArc(rNw, rNw, rNw, rNw, Math.PI, (3 * Math.PI) / 2, 8);
  for (const p of nw) path.lineTo(p.x, p.y);
  path.closePath();
  return path;
};

export const SNIP_ROUND_RECT_HANDLES: readonly AdjustmentHandle[] = [
  linearLeftEdgeHandle({
    forward: (val, { w, h }) => (val / 100000) * Math.min(w, h),
    inverse: (y, { w, h }) => {
      const ss = Math.min(w, h);
      return ss > 0
        ? (y / ss) * 100000
        : SNIP_ROUND_RECT_ADJUSTMENTS[0].defaultValue;
    },
    spec: SNIP_ROUND_RECT_ADJUSTMENTS[0],
    index: 0,
  }),
  linearTopEdgeHandle({
    forward: (val, { w, h }) => w - (val / 100000) * Math.min(w, h),
    inverse: (x, { w, h }) => {
      const ss = Math.min(w, h);
      return ss > 0
        ? ((w - x) / ss) * 100000
        : SNIP_ROUND_RECT_ADJUSTMENTS[1].defaultValue;
    },
    spec: SNIP_ROUND_RECT_ADJUSTMENTS[1],
    index: 1,
  }),
];
