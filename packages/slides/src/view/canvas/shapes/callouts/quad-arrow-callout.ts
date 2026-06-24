import type { PathBuilder, AdjustmentSpec, AdjustmentHandle } from '../builder';
import { adj } from '../builder';
import { insetAlongAxis } from '../handles';

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
  const dim = Math.min(w, h);
  const a2 = adj(adjustments, 1, DEF_HEAD);
  // OOXML: maxAdj1 = a2 * 2, so the shaft half-thickness can grow to at
  // most the head half-thickness (shaft ≤ head) — never the other way round.
  const a1 = Math.min(adj(adjustments, 0, DEF_SHAFT), a2 * 2);
  const a3 = adj(adjustments, 2, DEF_DEPTH);
  const a4 = adj(adjustments, 3, DEF_BODY);
  // shaft = ss·a1/200000 (half-thickness); head = ss·a2/100000 (half-
  // thickness). At default a1=a2 the head flares to 2× the shaft.
  const shaft = dim * (a1 / 200000);
  const head = dim * (a2 / 100000);
  const depth = dim * (a3 / 100000);
  const body = Math.min((dim / 2) * (a4 / 100000), w / 2 - depth, h / 2 - depth);
  const cx = w / 2;
  const cy = h / 2;
  const path = new Path2D();
  // CCW from top tip.
  path.moveTo(cx, 0);
  path.lineTo(cx + head, depth);
  path.lineTo(cx + shaft, depth);
  path.lineTo(cx + shaft, cy - body);
  path.lineTo(cx + body, cy - body);
  path.lineTo(cx + body, cy - shaft);
  path.lineTo(w - depth, cy - shaft);
  path.lineTo(w - depth, cy - head);
  path.lineTo(w, cy);
  path.lineTo(w - depth, cy + head);
  path.lineTo(w - depth, cy + shaft);
  path.lineTo(cx + body, cy + shaft);
  path.lineTo(cx + body, cy + body);
  path.lineTo(cx + shaft, cy + body);
  path.lineTo(cx + shaft, h - depth);
  path.lineTo(cx + head, h - depth);
  path.lineTo(cx, h);
  path.lineTo(cx - head, h - depth);
  path.lineTo(cx - shaft, h - depth);
  path.lineTo(cx - shaft, cy + body);
  path.lineTo(cx - body, cy + body);
  path.lineTo(cx - body, cy + shaft);
  path.lineTo(depth, cy + shaft);
  path.lineTo(depth, cy + head);
  path.lineTo(0, cy);
  path.lineTo(depth, cy - head);
  path.lineTo(depth, cy - shaft);
  path.lineTo(cx - body, cy - shaft);
  path.lineTo(cx - body, cy - body);
  path.lineTo(cx - shaft, cy - body);
  path.lineTo(cx - shaft, depth);
  path.lineTo(cx - head, depth);
  path.closePath();
  return path;
};

// One handle on the top-right corner of the body — drag horizontally
// to size the body (adj4), vertically to size shaft thickness (adj1).
// Builder clamps `body = min((dim/2)*adj4, w/2-depth, h/2-depth)`, so
// the handle uses the same clamp and bounds adj4 against the head
// depth to keep dragging out of the dead range.
export const QUAD_ARROW_CALLOUT_HANDLES: readonly AdjustmentHandle[] = [
  {
    position: ({ w, h }, adjustments) => {
      const dim = Math.min(w, h);
      const a1 = adjustments[0] ?? DEF_SHAFT;
      const a3 = adjustments[2] ?? DEF_DEPTH;
      const a4 = adjustments[3] ?? DEF_BODY;
      const shaft = dim * (a1 / 200000);
      const depth = dim * (a3 / 100000);
      const body = Math.min(
        (dim / 2) * (a4 / 100000),
        w / 2 - depth,
        h / 2 - depth,
      );
      return {
        x: insetAlongAxis(w / 2 + body, w),
        y: insetAlongAxis(h / 2 - shaft, h),
      };
    },
    apply: ({ w, h }, start, pointer) => {
      const dim = Math.min(w, h);
      const x = Math.max(0, Math.min(w, pointer.x));
      const y = Math.max(0, Math.min(h, pointer.y));
      const dx = Math.abs(x - w / 2);
      const dy = Math.abs(y - h / 2);
      const a3 = start[2] ?? DEF_DEPTH;
      const maxA4 = Math.max(0, 100000 - 2 * a3);
      const rawA4 = dim > 0 ? Math.round((dx / (dim / 2)) * 100000) : DEF_BODY;
      const newA4 = Math.max(0, Math.min(maxA4, rawA4));
      const newA1 = dim > 0 ? Math.round((dy / (dim / 2)) * 100000) : DEF_SHAFT;
      return [
        Math.max(0, Math.min(50000, newA1)),
        start[1] ?? DEF_HEAD,
        start[2] ?? DEF_DEPTH,
        newA4,
      ];
    },
  },
];
