import type { PathBuilder, AdjustmentHandle } from '../builder';
import { adj } from '../builder';
import { insetAlongAxis } from '../handles';
import { ARROW_ADJUSTMENTS } from './right-arrow';

/**
 * `upArrow` — block arrow pointing up.
 * Reuses `ARROW_ADJUSTMENTS` from `right-arrow.ts`.
 */
export const buildUpArrow: PathBuilder = ({ w, h }, adjustments) => {
  const headLen = Math.min(h, (adj(adjustments, 0, 50000) / 100000) * h);
  const headHalf = (adj(adjustments, 1, 50000) / 100000) * (w / 2);
  const path = new Path2D();
  path.moveTo(w / 2 - headHalf, h);
  path.lineTo(w / 2 - headHalf, headLen);
  path.lineTo(0, headLen);
  path.lineTo(w / 2, 0);
  path.lineTo(w, headLen);
  path.lineTo(w / 2 + headHalf, headLen);
  path.lineTo(w / 2 + headHalf, h);
  path.closePath();
  return path;
};

// upArrow handles: head on the TOP, back of head at (w/2, headLen).
// Drag DOWN to grow head; head width perpendicular (along x).
export const UP_ARROW_HANDLES: readonly AdjustmentHandle[] = [
  {
    position: ({ w, h }, adjustments) => {
      const headLen = ((adjustments[0] ?? ARROW_ADJUSTMENTS[0].defaultValue) / 100000) * h;
      return { x: w / 2, y: insetAlongAxis(headLen, h) };
    },
    apply: ({ h }, start, pointer) => {
      const y = Math.max(0, Math.min(h, pointer.y));
      const raw = h > 0 ? Math.round((y / h) * 100000) : 0;
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
        y: insetAlongAxis(headLen, h),
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
