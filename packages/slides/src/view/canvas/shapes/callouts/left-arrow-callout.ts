import type { PathBuilder, AdjustmentHandle } from '../builder';
import { adj } from '../builder';
import { insetAlongAxis } from '../handles';
import { DEF_BODY, DEF_DEPTH, DEF_HEAD, DEF_SHAFT } from './right-arrow-callout';

/**
 * `leftArrowCallout` — horizontal mirror of `rightArrowCallout`.
 * Body is on the right; arrowhead protrudes to the left.
 */
export const buildLeftArrowCallout: PathBuilder = ({ w, h }, adjustments) => {
  const a1 = adj(adjustments, 0, DEF_SHAFT);
  const a2 = Math.max(a1, adj(adjustments, 1, DEF_HEAD));
  const a3 = adj(adjustments, 2, DEF_DEPTH);
  const a4 = adj(adjustments, 3, DEF_BODY);
  const dy1 = (h / 2) * (a1 / 100000);
  const dy2 = (h / 2) * (a2 / 100000);
  const dx1 = w * (a3 / 100000);
  const bx = Math.max(dx1, w - w * (a4 / 100000));
  const cy = h / 2;
  const path = new Path2D();
  path.moveTo(w, h);
  path.lineTo(bx, h);
  path.lineTo(bx, cy + dy1);
  path.lineTo(dx1, cy + dy1);
  path.lineTo(dx1, cy + dy2);
  path.lineTo(0, cy);
  path.lineTo(dx1, cy - dy2);
  path.lineTo(dx1, cy - dy1);
  path.lineTo(bx, cy - dy1);
  path.lineTo(bx, 0);
  path.lineTo(w, 0);
  path.closePath();
  return path;
};

export const LEFT_ARROW_CALLOUT_HANDLES: readonly AdjustmentHandle[] = [
  {
    position: ({ w, h }, adjustments) => {
      const a1 = adjustments[0] ?? DEF_SHAFT;
      const a3 = adjustments[2] ?? DEF_DEPTH;
      const a4 = adjustments[3] ?? DEF_BODY;
      // Mirror of right callout — builder clamps
      // `bx = max(dx1, w - w * adj4 / 100000)`.
      const bodyX = Math.max(w * (a3 / 100000), w - w * (a4 / 100000));
      return {
        x: insetAlongAxis(bodyX, w),
        y: insetAlongAxis(h / 2 - (h / 2) * (a1 / 100000), h),
      };
    },
    apply: ({ w, h }, start, pointer) => {
      const x = Math.max(0, Math.min(w, pointer.x));
      const y = Math.max(0, Math.min(h, pointer.y));
      const a3 = start[2] ?? DEF_DEPTH;
      const maxA4 = Math.max(0, 100000 - a3);
      const rawA4 = w > 0 ? Math.round(((w - x) / w) * 100000) : DEF_BODY;
      const newA4 = Math.max(0, Math.min(maxA4, rawA4));
      const dy1 = Math.abs(y - h / 2);
      const newA1 = h > 0 ? Math.round((dy1 / (h / 2)) * 100000) : DEF_SHAFT;
      return [
        Math.max(0, Math.min(100000, newA1)),
        start[1] ?? DEF_HEAD,
        start[2] ?? DEF_DEPTH,
        newA4,
      ];
    },
  },
];
