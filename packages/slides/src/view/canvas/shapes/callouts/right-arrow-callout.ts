import type { PathBuilder, AdjustmentSpec, AdjustmentHandle } from '../builder';
import { adj } from '../builder';
import { insetAlongAxis } from '../handles';

/**
 * Adjustments shared by the four single-direction arrow callouts
 * (right / left / up / down). OOXML defines each variant with the
 * same four-`gd` av-list:
 *   [0] adj1 — shaft half-thickness, % of (h/2 for horizontal arrows,
 *              w/2 for vertical). Default 25000.
 *   [1] adj2 — head half-thickness, same axis as adj1; must be ≥ adj1.
 *              Default 25000.
 *   [2] adj3 — head depth, % of the long axis. Default 25000.
 *   [3] adj4 — callout body extent on the long axis, %. Default 64977.
 */
export const ARROW_CALLOUT_ADJUSTMENTS: readonly AdjustmentSpec[] = [
  { name: 'Shaft thickness', defaultValue: 25000, min: 0, max: 100000 },
  { name: 'Head thickness', defaultValue: 25000, min: 0, max: 100000 },
  { name: 'Head depth', defaultValue: 25000, min: 0, max: 100000 },
  { name: 'Body extent', defaultValue: 64977, min: 0, max: 100000 },
];

// Re-exported for the mirror builders (left/up/down) so the four
// single-direction callouts cannot drift apart silently.
export const DEF_SHAFT = 25000;
export const DEF_HEAD = 25000;
export const DEF_DEPTH = 25000;
export const DEF_BODY = 64977;

/**
 * `rightArrowCallout` — rectangular callout body on the left with
 * an arrow protruding to the right. Used as a "label points at
 * this thing" graphic with a built-in text frame.
 */
export const buildRightArrowCallout: PathBuilder = ({ w, h }, adjustments) => {
  const ss = Math.min(w, h);
  const a2 = adj(adjustments, 1, DEF_HEAD);
  // OOXML: maxAdj1 = a2 * 2, so the shaft half-thickness can grow to at
  // most the head half-thickness (dy1 ≤ dy2) — never the other way round.
  const a1 = Math.min(adj(adjustments, 0, DEF_SHAFT), a2 * 2);
  const a3 = adj(adjustments, 2, DEF_DEPTH);
  const a4 = adj(adjustments, 3, DEF_BODY);
  // dy1 = shaft half-thickness (ss·a1/200000); dy2 = head half-thickness
  // (ss·a2/100000). At default a1=a2 the head flares to 2× the shaft.
  const dy1 = ss * (a1 / 200000);
  const dy2 = ss * (a2 / 100000);
  // OOXML head depth is measured against ss = min(w,h), NOT w, so the
  // arrowhead stays shallow on wide frames (matching PowerPoint).
  const dx1 = ss * (a3 / 100000);
  const bx = Math.min(w - dx1, w * (a4 / 100000));
  const cy = h / 2;
  const path = new Path2D();
  path.moveTo(0, 0);
  path.lineTo(bx, 0);
  path.lineTo(bx, cy - dy1);
  path.lineTo(w - dx1, cy - dy1);
  path.lineTo(w - dx1, cy - dy2);
  path.lineTo(w, cy);
  path.lineTo(w - dx1, cy + dy2);
  path.lineTo(w - dx1, cy + dy1);
  path.lineTo(bx, cy + dy1);
  path.lineTo(bx, h);
  path.lineTo(0, h);
  path.closePath();
  return path;
};

// One handle on the seam where the body meets the shaft —
// dragging horizontally resizes the body (adj4), vertically the
// shaft thickness (adj1). The other two adjustments (head
// thickness, head depth) are reached via the head corner handle.
//
// The builder clamps `bx = min(w - dx1, w * adj4 / 100000)`, so
// the handle uses the same clamp for `position` and bounds adj4
// in `apply` to keep dragging out of the dead range where adj4
// changes but the visible seam does not.
export const RIGHT_ARROW_CALLOUT_HANDLES: readonly AdjustmentHandle[] = [
  {
    position: ({ w, h }, adjustments) => {
      const ss = Math.min(w, h);
      const a1 = adjustments[0] ?? DEF_SHAFT;
      const a3 = adjustments[2] ?? DEF_DEPTH;
      const a4 = adjustments[3] ?? DEF_BODY;
      const bodyX = Math.min(w - ss * (a3 / 100000), w * (a4 / 100000));
      return {
        x: insetAlongAxis(bodyX, w),
        y: insetAlongAxis(h / 2 - ss * (a1 / 200000), h),
      };
    },
    apply: ({ w, h }, start, pointer) => {
      const ss = Math.min(w, h);
      const x = Math.max(0, Math.min(w, pointer.x));
      const y = Math.max(0, Math.min(h, pointer.y));
      const a3 = start[2] ?? DEF_DEPTH;
      // Builder seam is at `w - ss·a3/100000`, so the body max is
      // `100000 - a3·ss/w` (NOT `100000 - a3`, which assumed w-based depth).
      const maxA4 = Math.max(0, 100000 - Math.round((a3 * ss) / w));
      const rawA4 = w > 0 ? Math.round((x / w) * 100000) : DEF_BODY;
      const newA4 = Math.max(0, Math.min(maxA4, rawA4));
      const dy1 = Math.abs(y - h / 2);
      const newA1 = ss > 0 ? Math.round((dy1 / (ss / 2)) * 100000) : DEF_SHAFT;
      return [
        Math.max(0, Math.min(100000, newA1)),
        start[1] ?? DEF_HEAD,
        start[2] ?? DEF_DEPTH,
        newA4,
      ];
    },
  },
  {
    position: ({ w, h }, adjustments) => {
      const ss = Math.min(w, h);
      const a2 = adjustments[1] ?? DEF_HEAD;
      const a3 = adjustments[2] ?? DEF_DEPTH;
      return {
        x: insetAlongAxis(w - ss * (a3 / 100000), w),
        y: insetAlongAxis(h / 2 - ss * (a2 / 100000), h),
      };
    },
    apply: ({ w, h }, start, pointer) => {
      const ss = Math.min(w, h);
      const x = Math.max(0, Math.min(w, pointer.x));
      const y = Math.max(0, Math.min(h, pointer.y));
      const newA3 = ss > 0 ? Math.round(((w - x) / ss) * 100000) : DEF_DEPTH;
      const dy2 = Math.abs(y - h / 2);
      const newA2 = ss > 0 ? Math.round((dy2 / ss) * 100000) : DEF_HEAD;
      return [
        start[0] ?? DEF_SHAFT,
        Math.max(0, Math.min(100000, newA2)),
        Math.max(0, Math.min(100000, newA3)),
        start[3] ?? DEF_BODY,
      ];
    },
  },
];
