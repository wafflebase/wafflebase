import type { PathBuilder, AdjustmentHandle } from '../builder';
import { adj } from '../builder';
import { insetAlongAxis } from '../handles';
import { DEF_BODY, DEF_DEPTH, DEF_HEAD, DEF_SHAFT } from './right-arrow-callout';

/**
 * `downArrowCallout` — vertical mirror of `upArrowCallout`.
 * Body sits at the top; arrow points down.
 */
export const buildDownArrowCallout: PathBuilder = ({ w, h }, adjustments) => {
  const a1 = adj(adjustments, 0, DEF_SHAFT);
  const a2 = Math.max(a1, adj(adjustments, 1, DEF_HEAD));
  const a3 = adj(adjustments, 2, DEF_DEPTH);
  const a4 = adj(adjustments, 3, DEF_BODY);
  const dx1 = (w / 2) * (a1 / 100000);
  const dx2 = (w / 2) * (a2 / 100000);
  const dy1 = h * (a3 / 100000);
  const by = Math.min(h - dy1, h * (a4 / 100000));
  const cx = w / 2;
  const path = new Path2D();
  path.moveTo(0, 0);
  path.lineTo(0, by);
  path.lineTo(cx - dx1, by);
  path.lineTo(cx - dx1, h - dy1);
  path.lineTo(cx - dx2, h - dy1);
  path.lineTo(cx, h);
  path.lineTo(cx + dx2, h - dy1);
  path.lineTo(cx + dx1, h - dy1);
  path.lineTo(cx + dx1, by);
  path.lineTo(w, by);
  path.lineTo(w, 0);
  path.closePath();
  return path;
};

export const DOWN_ARROW_CALLOUT_HANDLES: readonly AdjustmentHandle[] = [
  {
    position: ({ w, h }, adjustments) => {
      const a1 = adjustments[0] ?? DEF_SHAFT;
      const a3 = adjustments[2] ?? DEF_DEPTH;
      const a4 = adjustments[3] ?? DEF_BODY;
      // Builder clamps `by = min(h - dy1, h * adj4 / 100000)`.
      const bodyY = Math.min(h - h * (a3 / 100000), h * (a4 / 100000));
      return {
        x: insetAlongAxis(w / 2 + (w / 2) * (a1 / 100000), w),
        y: insetAlongAxis(bodyY, h),
      };
    },
    apply: ({ w, h }, start, pointer) => {
      const x = Math.max(0, Math.min(w, pointer.x));
      const y = Math.max(0, Math.min(h, pointer.y));
      const a3 = start[2] ?? DEF_DEPTH;
      const maxA4 = Math.max(0, 100000 - a3);
      const rawA4 = h > 0 ? Math.round((y / h) * 100000) : DEF_BODY;
      const newA4 = Math.max(0, Math.min(maxA4, rawA4));
      const dx1 = Math.abs(x - w / 2);
      const newA1 = w > 0 ? Math.round((dx1 / (w / 2)) * 100000) : DEF_SHAFT;
      return [
        Math.max(0, Math.min(100000, newA1)),
        start[1] ?? DEF_HEAD,
        start[2] ?? DEF_DEPTH,
        newA4,
      ];
    },
  },
];
