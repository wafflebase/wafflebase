import type { PathBuilder, AdjustmentHandle } from '../builder';
import { adj } from '../builder';
import { insetAlongAxis } from '../handles';
import { DEF_BODY, DEF_DEPTH, DEF_HEAD, DEF_SHAFT } from './right-arrow-callout';

/**
 * `upArrowCallout` — vertical version. Body is at the bottom of
 * the frame; arrowhead points up. Long axis is `h`.
 */
export const buildUpArrowCallout: PathBuilder = ({ w, h }, adjustments) => {
  const ss = Math.min(w, h);
  const a2 = adj(adjustments, 1, DEF_HEAD);
  const a1 = Math.min(adj(adjustments, 0, DEF_SHAFT), a2 * 2);
  const a3 = adj(adjustments, 2, DEF_DEPTH);
  const a4 = adj(adjustments, 3, DEF_BODY);
  // dx1 = shaft half-thickness (ss·a1/200000); dx2 = head half-thickness
  // (ss·a2/100000). At default a1=a2 the head flares to 2× the shaft.
  const dx1 = ss * (a1 / 200000);
  const dx2 = ss * (a2 / 100000);
  // OOXML head depth uses ss = min(w,h), not h (shallow head on tall frames).
  const dy1 = ss * (a3 / 100000);
  const by = Math.max(dy1, h - h * (a4 / 100000));
  const cx = w / 2;
  const path = new Path2D();
  path.moveTo(w, h);
  path.lineTo(w, by);
  path.lineTo(cx + dx1, by);
  path.lineTo(cx + dx1, dy1);
  path.lineTo(cx + dx2, dy1);
  path.lineTo(cx, 0);
  path.lineTo(cx - dx2, dy1);
  path.lineTo(cx - dx1, dy1);
  path.lineTo(cx - dx1, by);
  path.lineTo(0, by);
  path.lineTo(0, h);
  path.closePath();
  return path;
};

export const UP_ARROW_CALLOUT_HANDLES: readonly AdjustmentHandle[] = [
  {
    position: ({ w, h }, adjustments) => {
      const ss = Math.min(w, h);
      const a1 = adjustments[0] ?? DEF_SHAFT;
      const a3 = adjustments[2] ?? DEF_DEPTH;
      const a4 = adjustments[3] ?? DEF_BODY;
      // Builder clamps `by = max(dy1, h - h * adj4 / 100000)`.
      const bodyY = Math.max(ss * (a3 / 100000), h - h * (a4 / 100000));
      return {
        x: insetAlongAxis(w / 2 + ss * (a1 / 200000), w),
        y: insetAlongAxis(bodyY, h),
      };
    },
    apply: ({ w, h }, start, pointer) => {
      const ss = Math.min(w, h);
      const x = Math.max(0, Math.min(w, pointer.x));
      const y = Math.max(0, Math.min(h, pointer.y));
      const a3 = start[2] ?? DEF_DEPTH;
      // Vertical: body max matches the ss-based seam: 100000 - a3·ss/h.
      const maxA4 = Math.max(0, 100000 - Math.round((a3 * ss) / h));
      const rawA4 = h > 0 ? Math.round(((h - y) / h) * 100000) : DEF_BODY;
      const newA4 = Math.max(0, Math.min(maxA4, rawA4));
      const dx1 = Math.abs(x - w / 2);
      const newA1 = ss > 0 ? Math.round((dx1 / (ss / 2)) * 100000) : DEF_SHAFT;
      return [
        Math.max(0, Math.min(100000, newA1)),
        start[1] ?? DEF_HEAD,
        start[2] ?? DEF_DEPTH,
        newA4,
      ];
    },
  },
];
