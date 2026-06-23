import type {
  AdjustmentHandle,
  AdjustmentSpec,
  PathBuilder,
} from '../builder';
import { adj } from '../builder';
import { linearTopEdgeHandle } from '../handles';

/**
 * `snip2DiagRect` — rectangle whose corners are chamfered in two
 * diagonal pairs. Per ECMA-376, `adj1` controls the NW + SE pair
 * (`lx1`) and `adj2` controls the NE + SW pair (`rx1`), each as a
 * fraction of `min(w, h)`. OOXML defaults: adj1 = 0, adj2 = 16667,
 * so by default only the NE + SW diagonal is snipped.
 */
export const SNIP2_DIAG_RECT_ADJUSTMENTS: readonly AdjustmentSpec[] = [
  {
    name: 'NW/SE corner cut',
    defaultValue: 0,
    min: 0,
    max: 50000,
    axisLabel: 'nw',
  },
  {
    name: 'NE/SW corner cut',
    defaultValue: 16667,
    min: 0,
    max: 50000,
    axisLabel: 'ne',
  },
];

export const buildSnip2DiagRect: PathBuilder = ({ w, h }, adjustments) => {
  const a1 = adj(adjustments, 0, SNIP2_DIAG_RECT_ADJUSTMENTS[0].defaultValue);
  const a2 = adj(adjustments, 1, SNIP2_DIAG_RECT_ADJUSTMENTS[1].defaultValue);
  // adj1 → NW + SE chamfer (lx1); adj2 → NE + SW chamfer (rx1).
  const cNwSe = (a1 / 100000) * Math.min(w, h);
  const cNeSw = (a2 / 100000) * Math.min(w, h);
  const path = new Path2D();
  // Start on the top edge after the NW chamfer.
  path.moveTo(cNwSe, 0); // (lx1, t)
  path.lineTo(w - cNeSw, 0); // (rx2, t) — NE chamfer top
  path.lineTo(w, cNeSw); // (r, rx1) — NE chamfer right
  path.lineTo(w, h - cNwSe); // (r, ly1) — SE chamfer right
  path.lineTo(w - cNwSe, h); // (lx2, b) — SE chamfer bottom
  path.lineTo(cNeSw, h); // (rx1, b) — SW chamfer bottom
  path.lineTo(0, h - cNeSw); // (l, ry1) — SW chamfer left
  path.lineTo(0, cNwSe); // (l, lx1) — NW chamfer left
  path.closePath();
  return path;
};

export const SNIP2_DIAG_RECT_HANDLES: readonly AdjustmentHandle[] = [
  // adj1 (NW/SE pair): top-edge handle at x = cNwSe (the NW snip on top edge).
  linearTopEdgeHandle({
    forward: (val, { w, h }) => (val / 100000) * Math.min(w, h),
    inverse: (x, { w, h }) => {
      const m = Math.min(w, h);
      return m > 0 ? (x / m) * 100000 : 0;
    },
    spec: SNIP2_DIAG_RECT_ADJUSTMENTS[0],
    index: 0,
  }),
  // adj2 (NE/SW pair): top-edge handle at x = w - cNeSw (the NE snip on top edge).
  linearTopEdgeHandle({
    forward: (val, { w, h }) => w - (val / 100000) * Math.min(w, h),
    inverse: (x, { w, h }) => {
      const m = Math.min(w, h);
      return m > 0 ? ((w - x) / m) * 100000 : 0;
    },
    spec: SNIP2_DIAG_RECT_ADJUSTMENTS[1],
    index: 1,
  }),
];
