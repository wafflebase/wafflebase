import type { PathBuilder, AdjustmentHandle } from '../builder';
import { adj } from '../builder';
import { insetAlongAxis } from '../handles';
import { ARROW_ADJUSTMENTS } from './right-arrow';

/**
 * `downArrow` — block arrow pointing down.
 * Reuses `ARROW_ADJUSTMENTS` from `right-arrow.ts`.
 */
export const buildDownArrow: PathBuilder = ({ w, h }, adjustments) => {
  const headLen = Math.min(h, (adj(adjustments, 0, 50000) / 100000) * h);
  const headHalf = (adj(adjustments, 1, 50000) / 100000) * (w / 2);
  const path = new Path2D();
  path.moveTo(w / 2 - headHalf, 0);
  path.lineTo(w / 2 - headHalf, h - headLen);
  path.lineTo(0, h - headLen);
  path.lineTo(w / 2, h);
  path.lineTo(w, h - headLen);
  path.lineTo(w / 2 + headHalf, h - headLen);
  path.lineTo(w / 2 + headHalf, 0);
  path.closePath();
  return path;
};

// downArrow handles: head on the BOTTOM, back of head at (w/2, h-headLen).
export const DOWN_ARROW_HANDLES: readonly AdjustmentHandle[] = [
  {
    position: ({ w, h }, adjustments) => {
      const headLen = ((adjustments[0] ?? ARROW_ADJUSTMENTS[0].defaultValue) / 100000) * h;
      return { x: w / 2, y: insetAlongAxis(h - headLen, h) };
    },
    apply: ({ h }, start, pointer) => {
      const y = Math.max(0, Math.min(h, pointer.y));
      const headLen = h - y;
      const raw = h > 0 ? Math.round((headLen / h) * 100000) : 0;
      return [
        Math.max(ARROW_ADJUSTMENTS[0].min, Math.min(ARROW_ADJUSTMENTS[0].max, raw)),
        start[1] ?? ARROW_ADJUSTMENTS[1].defaultValue,
      ];
    },
  },
  {
    position: ({ w, h }, adjustments) => {
      const headLen = ((adjustments[0] ?? ARROW_ADJUSTMENTS[0].defaultValue) / 100000) * h;
      const headHalf = ((adjustments[1] ?? ARROW_ADJUSTMENTS[1].defaultValue) / 100000) * (w / 2);
      return {
        x: insetAlongAxis(w / 2 - headHalf, w),
        y: insetAlongAxis(h - headLen, h),
      };
    },
    apply: ({ w }, start, pointer) => {
      const x = Math.max(0, Math.min(w, pointer.x));
      const headHalf = Math.abs(x - w / 2);
      const half = w / 2;
      const raw = half > 0 ? Math.round((headHalf / half) * 100000) : 0;
      return [
        start[0] ?? ARROW_ADJUSTMENTS[0].defaultValue,
        Math.max(ARROW_ADJUSTMENTS[1].min, Math.min(ARROW_ADJUSTMENTS[1].max, raw)),
      ];
    },
  },
];
