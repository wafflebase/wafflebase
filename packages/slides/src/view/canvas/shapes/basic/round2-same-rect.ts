import type {
  AdjustmentHandle,
  AdjustmentSpec,
  PathBuilder,
} from '../builder';
import { adj } from '../builder';
import { polylineArc } from '../curves';
import {
  linearBottomEdgeHandle,
  linearTopEdgeHandle,
} from '../handles';

/**
 * `round2SameRect` — rectangle with one pair of corners rounded.
 * Per ECMA-376, `adj1` rounds the TOP pair (NW + NE, `tx1`) and
 * `adj2` rounds the BOTTOM pair (SW + SE, `bx1`), each a radius as a
 * fraction of `min(w, h)`. OOXML defaults: adj1 = 16667, adj2 = 0,
 * so by default only the top corners are rounded.
 */
export const ROUND2_SAME_RECT_ADJUSTMENTS: readonly AdjustmentSpec[] = [
  {
    name: 'Top corner radius',
    defaultValue: 16667,
    min: 0,
    max: 50000,
    axisLabel: 'nw',
  },
  {
    name: 'Bottom corner radius',
    defaultValue: 0,
    min: 0,
    max: 50000,
    axisLabel: 'sw',
  },
];

export const buildRound2SameRect: PathBuilder = ({ w, h }, adjustments) => {
  const a1 = adj(adjustments, 0, ROUND2_SAME_RECT_ADJUSTMENTS[0].defaultValue);
  const a2 = adj(adjustments, 1, ROUND2_SAME_RECT_ADJUSTMENTS[1].defaultValue);
  // adj1 → top pair radius (tx1); adj2 → bottom pair radius (bx1).
  const rt = (a1 / 100000) * Math.min(w, h);
  const rb = (a2 / 100000) * Math.min(w, h);
  const path = new Path2D();
  // Start on the top edge after the NW round.
  path.moveTo(rt, 0); // (tx1, t)
  path.lineTo(w - rt, 0); // (tx2, t)
  // NE rounded corner (center w-rt, rt): top → right edge.
  const ne = polylineArc(w - rt, rt, rt, rt, -Math.PI / 2, 0);
  for (const p of ne) path.lineTo(p.x, p.y);
  path.lineTo(w, h - rb); // (r, by1)
  // SE rounded corner (center w-rb, h-rb): right → bottom edge.
  const se = polylineArc(w - rb, h - rb, rb, rb, 0, Math.PI / 2);
  for (const p of se) path.lineTo(p.x, p.y);
  path.lineTo(rb, h); // (bx1, b)
  // SW rounded corner (center rb, h-rb): bottom → left edge.
  const sw = polylineArc(rb, h - rb, rb, rb, Math.PI / 2, Math.PI);
  for (const p of sw) path.lineTo(p.x, p.y);
  path.lineTo(0, rt); // (l, tx1)
  // NW rounded corner (center rt, rt): left → top edge.
  const nw = polylineArc(rt, rt, rt, rt, Math.PI, (3 * Math.PI) / 2);
  for (const p of nw) path.lineTo(p.x, p.y);
  path.closePath();
  return path;
};

export const ROUND2_SAME_RECT_HANDLES: readonly AdjustmentHandle[] = [
  // adj1 (top pair): top-edge handle at x = tx1.
  linearTopEdgeHandle({
    forward: (val, { w, h }) => (val / 100000) * Math.min(w, h),
    inverse: (x, { w, h }) => (x / Math.min(w, h)) * 100000,
    spec: ROUND2_SAME_RECT_ADJUSTMENTS[0],
    index: 0,
  }),
  // adj2 (bottom pair): bottom-edge handle at x = bx1.
  linearBottomEdgeHandle({
    forward: (val, { w, h }) => (val / 100000) * Math.min(w, h),
    inverse: (x, { w, h }) => (x / Math.min(w, h)) * 100000,
    spec: ROUND2_SAME_RECT_ADJUSTMENTS[1],
    index: 1,
  }),
];
