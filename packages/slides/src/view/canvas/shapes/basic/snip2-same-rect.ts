import type {
  AdjustmentHandle,
  AdjustmentSpec,
  PathBuilder,
} from '../builder';
import { adj } from '../builder';
import {
  linearBottomEdgeHandle,
  linearTopEdgeHandle,
} from '../handles';

/**
 * `snip2SameRect` — rectangle with one pair of corners chamfered.
 * Per ECMA-376, `adj1` chamfers the TOP pair (NW + NE, `tx1`) and
 * `adj2` chamfers the BOTTOM pair (SW + SE, `bx1`), each as a
 * fraction of `min(w, h)`. OOXML defaults: adj1 = 16667, adj2 = 0,
 * so by default only the top corners are snipped.
 */
export const SNIP2_SAME_RECT_ADJUSTMENTS: readonly AdjustmentSpec[] = [
  {
    name: 'Top corner cut',
    defaultValue: 16667,
    min: 0,
    max: 50000,
    axisLabel: 'nw',
  },
  {
    name: 'Bottom corner cut',
    defaultValue: 0,
    min: 0,
    max: 50000,
    axisLabel: 'sw',
  },
];

export const buildSnip2SameRect: PathBuilder = ({ w, h }, adjustments) => {
  const a1 = adj(adjustments, 0, SNIP2_SAME_RECT_ADJUSTMENTS[0].defaultValue);
  const a2 = adj(adjustments, 1, SNIP2_SAME_RECT_ADJUSTMENTS[1].defaultValue);
  // adj1 → top pair (tx1); adj2 → bottom pair (bx1).
  const top = (a1 / 100000) * Math.min(w, h);
  const bot = (a2 / 100000) * Math.min(w, h);
  const path = new Path2D();
  path.moveTo(top, 0); // (tx1, t)
  path.lineTo(w - top, 0); // (tx2, t)
  path.lineTo(w, top); // (r, tx1)
  path.lineTo(w, h - bot); // (r, by1)
  path.lineTo(w - bot, h); // (bx2, b)
  path.lineTo(bot, h); // (bx1, b)
  path.lineTo(0, h - bot); // (l, by1)
  path.lineTo(0, top); // (l, tx1)
  path.closePath();
  return path;
};

export const SNIP2_SAME_RECT_HANDLES: readonly AdjustmentHandle[] = [
  // adj1 (top pair): top-edge handle at x = tx1.
  linearTopEdgeHandle({
    forward: (val, { w, h }) => (val / 100000) * Math.min(w, h),
    inverse: (x, { w, h }) => {
      const m = Math.min(w, h);
      return m > 0 ? (x / m) * 100000 : 0;
    },
    spec: SNIP2_SAME_RECT_ADJUSTMENTS[0],
    index: 0,
  }),
  // adj2 (bottom pair): bottom-edge handle at x = bx1.
  linearBottomEdgeHandle({
    forward: (val, { w, h }) => (val / 100000) * Math.min(w, h),
    inverse: (x, { w, h }) => {
      const m = Math.min(w, h);
      return m > 0 ? (x / m) * 100000 : 0;
    },
    spec: SNIP2_SAME_RECT_ADJUSTMENTS[1],
    index: 1,
  }),
];
