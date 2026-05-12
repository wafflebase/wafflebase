import type { PathBuilder, AdjustmentHandle } from '../builder';
import { adj } from '../builder';
import { insetAlongAxis } from '../handles';
import { ARROW_ADJUSTMENTS } from './right-arrow';

/**
 * `leftRightArrow` — double-headed horizontal arrow.
 * Reuses `ARROW_ADJUSTMENTS` from `right-arrow.ts`.
 */
export const buildLeftRightArrow: PathBuilder = ({ w, h }, adjustments) => {
  const head = Math.min(w / 2, (adj(adjustments, 0, 50000) / 100000) * (w / 2));
  const headHalf = (adj(adjustments, 1, 50000) / 100000) * (h / 2);
  const path = new Path2D();
  path.moveTo(0, h / 2);
  path.lineTo(head, 0);
  path.lineTo(head, h / 2 - headHalf);
  path.lineTo(w - head, h / 2 - headHalf);
  path.lineTo(w - head, 0);
  path.lineTo(w, h / 2);
  path.lineTo(w - head, h);
  path.lineTo(w - head, h / 2 + headHalf);
  path.lineTo(head, h / 2 + headHalf);
  path.lineTo(head, h);
  path.closePath();
  return path;
};

// leftRightArrow handles: heads on BOTH ends, each "head" extends inward
// from each side. Handle 1 paints at the LEFT arrowhead back on the
// centerline (head, h/2); editing it mirrors symmetrically since the
// path builder uses `w - head` for the right side.
export const LEFT_RIGHT_ARROW_HANDLES: readonly AdjustmentHandle[] = [
  {
    position: ({ w, h }, adjustments) => {
      const head = ((adjustments[0] ?? ARROW_ADJUSTMENTS[0].defaultValue) / 100000) * (w / 2);
      return { x: insetAlongAxis(head, w), y: h / 2 };
    },
    apply: ({ w }, start, pointer) => {
      const x = Math.max(0, Math.min(w / 2, pointer.x));
      const half = w / 2;
      const raw = half > 0 ? Math.round((x / half) * 100000) : 0;
      return [
        Math.max(ARROW_ADJUSTMENTS[0].min, Math.min(ARROW_ADJUSTMENTS[0].max, raw)),
        start[1] ?? ARROW_ADJUSTMENTS[1].defaultValue,
      ];
    },
  },
  {
    position: ({ w, h }, adjustments) => {
      const head = ((adjustments[0] ?? ARROW_ADJUSTMENTS[0].defaultValue) / 100000) * (w / 2);
      const headHalf = ((adjustments[1] ?? ARROW_ADJUSTMENTS[1].defaultValue) / 100000) * (h / 2);
      return {
        x: insetAlongAxis(head, w),
        y: insetAlongAxis(h / 2 - headHalf, h),
      };
    },
    apply: ({ h }, start, pointer) => {
      const y = Math.max(0, Math.min(h, pointer.y));
      const headHalf = Math.abs(y - h / 2);
      const half = h / 2;
      const raw = half > 0 ? Math.round((headHalf / half) * 100000) : 0;
      return [
        start[0] ?? ARROW_ADJUSTMENTS[0].defaultValue,
        Math.max(ARROW_ADJUSTMENTS[1].min, Math.min(ARROW_ADJUSTMENTS[1].max, raw)),
      ];
    },
  },
];
