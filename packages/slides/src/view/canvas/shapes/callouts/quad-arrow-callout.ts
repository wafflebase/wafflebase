import type { PathBuilder, AdjustmentSpec, AdjustmentHandle } from '../builder';
import { adj } from '../builder';
import { insetAlongAxis } from '../handles';
import { pin } from './ooxml-math';

/**
 * `quadArrowCallout` — four-headed arrow with a square callout body
 * in the centre. All four adjustments scale against `min(w, h)` so
 * proportions stay square-ish when the frame isn't 1:1.
 *
 * OOXML adj defaults: 18515 / 18515 / 18515 / 48123.
 */
export const QUAD_ARROW_CALLOUT_ADJUSTMENTS: readonly AdjustmentSpec[] = [
  { name: 'Shaft thickness', defaultValue: 18515, min: 0, max: 50000 },
  { name: 'Head thickness', defaultValue: 18515, min: 0, max: 50000 },
  { name: 'Head depth', defaultValue: 18515, min: 0, max: 50000 },
  { name: 'Body extent', defaultValue: 48123, min: 0, max: 100000 },
];

const DEF_SHAFT = 18515;
const DEF_HEAD = 18515;
const DEF_DEPTH = 18515;
const DEF_BODY = 48123;

export const buildQuadArrowCallout: PathBuilder = ({ w, h }, adjustments) => {
  const ss = Math.min(w, h);
  const hc = w / 2;
  const vc = h / 2;
  // OOXML pin chain: a2 ≤ 50000; a1 ≤ 2·a2 (shaft ≤ head); a3 ≤ 50000−a2;
  // a4 ∈ [a1, 100000−2·a3] (body extent at least the shaft, never into a head).
  const a2 = pin(0, adj(adjustments, 1, DEF_HEAD), 50000);
  const a1 = pin(0, adj(adjustments, 0, DEF_SHAFT), 2 * a2);
  const a3 = pin(0, adj(adjustments, 2, DEF_DEPTH), 50000 - a2);
  const a4 = pin(a1, adj(adjustments, 3, DEF_BODY), 100000 - 2 * a3);
  // Shaft / head half-thickness and head depth scale against ss = min(w,h);
  // the central body is rectangular (w-based half-width, h-based half-height).
  const head = (ss * a2) / 100000; // dx2
  const shaft = (ss * a1) / 200000; // dx3
  const ah = (ss * a3) / 100000; // head depth
  const dx1 = (w * a4) / 200000; // body half-width
  const dy1 = (h * a4) / 200000; // body half-height
  const x2 = hc - dx1;
  const x7 = hc + dx1;
  const x3 = hc - head;
  const x6 = hc + head;
  const x4 = hc - shaft;
  const x5 = hc + shaft;
  const x8 = w - ah;
  const y2 = vc - dy1;
  const y7 = vc + dy1;
  const y3 = vc - head;
  const y6 = vc + head;
  const y4 = vc - shaft;
  const y5 = vc + shaft;
  const y8 = h - ah;

  const path = new Path2D();
  // OOXML pathLst, walked from the left tip clockwise around all four heads.
  path.moveTo(0, vc);
  path.lineTo(ah, y3);
  path.lineTo(ah, y4);
  path.lineTo(x2, y4);
  path.lineTo(x2, y2);
  path.lineTo(x4, y2);
  path.lineTo(x4, ah);
  path.lineTo(x3, ah);
  path.lineTo(hc, 0);
  path.lineTo(x6, ah);
  path.lineTo(x5, ah);
  path.lineTo(x5, y2);
  path.lineTo(x7, y2);
  path.lineTo(x7, y4);
  path.lineTo(x8, y4);
  path.lineTo(x8, y3);
  path.lineTo(w, vc);
  path.lineTo(x8, y6);
  path.lineTo(x8, y5);
  path.lineTo(x7, y5);
  path.lineTo(x7, y7);
  path.lineTo(x5, y7);
  path.lineTo(x5, y8);
  path.lineTo(x6, y8);
  path.lineTo(hc, h);
  path.lineTo(x3, y8);
  path.lineTo(x4, y8);
  path.lineTo(x4, y7);
  path.lineTo(x2, y7);
  path.lineTo(x2, y5);
  path.lineTo(ah, y5);
  path.lineTo(ah, y6);
  path.closePath();
  return path;
};

// One handle on the top-right corner of the central body — drag
// horizontally to size the body extent (adj4), vertically to size the
// shaft thickness (adj1). Body half-width is `dx1 = w·adj4/200000`;
// shaft half-thickness is `ss·adj1/200000`. adj4's max mirrors the
// builder's pin (`100000 − 2·adj3`).
export const QUAD_ARROW_CALLOUT_HANDLES: readonly AdjustmentHandle[] = [
  {
    position: ({ w, h }, adjustments) => {
      const ss = Math.min(w, h);
      const a1 = adjustments[0] ?? DEF_SHAFT;
      const a4 = adjustments[3] ?? DEF_BODY;
      return {
        x: insetAlongAxis(w / 2 + (w * a4) / 200000, w),
        y: insetAlongAxis(h / 2 - (ss * a1) / 200000, h),
      };
    },
    apply: ({ w, h }, start, pointer) => {
      const ss = Math.min(w, h);
      const x = Math.max(0, Math.min(w, pointer.x));
      const y = Math.max(0, Math.min(h, pointer.y));
      const dx = Math.abs(x - w / 2);
      const dy = Math.abs(y - h / 2);
      const a3 = start[2] ?? DEF_DEPTH;
      const maxA4 = Math.max(0, 100000 - 2 * a3);
      const rawA4 = w > 0 ? Math.round((dx / (w / 2)) * 100000) : DEF_BODY;
      const newA4 = Math.max(0, Math.min(maxA4, rawA4));
      const newA1 = ss > 0 ? Math.round((dy / (ss / 2)) * 100000) : DEF_SHAFT;
      return [
        Math.max(0, Math.min(50000, newA1)),
        start[1] ?? DEF_HEAD,
        start[2] ?? DEF_DEPTH,
        newA4,
      ];
    },
  },
];
