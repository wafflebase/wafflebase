import type { PathBuilder, AdjustmentHandle } from '../builder';
import { adj } from '../builder';
import { insetAlongAxis } from '../handles';
import { ARROW_ADJUSTMENTS } from './right-arrow';

/**
 * `leftArrow` — block arrow pointing left. Mirror of `rightArrow`.
 * Reuses `ARROW_ADJUSTMENTS` from `right-arrow.ts`.
 */
export const buildLeftArrow: PathBuilder = ({ w, h }, adjustments) => {
  // OOXML: dx2 = ss * adj2 / 100000 where ss = min(w, h). Mirror of rightArrow.
  const ss = Math.min(w, h);
  const headLen = Math.min(w, (adj(adjustments, 0, 50000) / 100000) * ss);
  const headHalf = (adj(adjustments, 1, 50000) / 100000) * (h / 2);
  const path = new Path2D();
  path.moveTo(w, h / 2 - headHalf);
  path.lineTo(headLen, h / 2 - headHalf);
  path.lineTo(headLen, 0);
  path.lineTo(0, h / 2);
  path.lineTo(headLen, h);
  path.lineTo(headLen, h / 2 + headHalf);
  path.lineTo(w, h / 2 + headHalf);
  path.closePath();
  return path;
};

// leftArrow handles: head on the LEFT side, back of head at (headLen, h/2).
export const LEFT_ARROW_HANDLES: readonly AdjustmentHandle[] = [
  {
    position: ({ w, h }, adjustments) => {
      const ss = Math.min(w, h);
      const headLen = ((adjustments[0] ?? ARROW_ADJUSTMENTS[0].defaultValue) / 100000) * ss;
      return { x: insetAlongAxis(headLen, w), y: h / 2 };
    },
    apply: ({ w, h }, start, pointer) => {
      const ss = Math.min(w, h);
      const x = Math.max(0, Math.min(w, pointer.x));
      const raw = ss > 0 ? Math.round((x / ss) * 100000) : 0;
      return [
        Math.max(ARROW_ADJUSTMENTS[0].min, Math.min(ARROW_ADJUSTMENTS[0].max, raw)),
        start[1] ?? ARROW_ADJUSTMENTS[1].defaultValue,
      ];
    },
  },
  {
    position: ({ w, h }, adjustments) => {
      const ss = Math.min(w, h);
      const headLen = ((adjustments[0] ?? ARROW_ADJUSTMENTS[0].defaultValue) / 100000) * ss;
      const headHalf = ((adjustments[1] ?? ARROW_ADJUSTMENTS[1].defaultValue) / 100000) * (h / 2);
      return {
        x: insetAlongAxis(headLen, w),
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
