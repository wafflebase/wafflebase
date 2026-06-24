import type { PathBuilder, AdjustmentSpec, AdjustmentHandle } from '../builder';
import { adj } from '../builder';
import { insetAlongAxis } from '../handles';

/**
 * `rightArrow` — block arrow pointing right.
 *
 * Adjustments (shared with leftArrow/upArrow/downArrow/leftRightArrow
 * via `ARROW_ADJUSTMENTS`):
 *   [0] headLen  — OOXML thousandths of `w`; default 50000.
 *   [1] headWidth — OOXML thousandths of `h/2` (half-height); default 50000.
 */
export const ARROW_ADJUSTMENTS: readonly AdjustmentSpec[] = [
  { name: 'Head length', defaultValue: 50000, min: 0, max: 100000 },
  { name: 'Head width', defaultValue: 50000, min: 0, max: 100000 },
];

export const buildRightArrow: PathBuilder = ({ w, h }, adjustments) => {
  // OOXML: dx1 = ss * adj2 / 100000 where ss = min(w, h). The head length
  // scales by the shorter side so the arrowhead keeps its proportion when
  // the bounding box is stretched. Clamp to w so it never exceeds the box.
  const ss = Math.min(w, h);
  const headLen = Math.min(w, (adj(adjustments, 0, 50000) / 100000) * ss);
  const headHalf = (adj(adjustments, 1, 50000) / 100000) * (h / 2);
  const path = new Path2D();
  path.moveTo(0, h / 2 - headHalf);
  path.lineTo(w - headLen, h / 2 - headHalf);
  path.lineTo(w - headLen, 0);
  path.lineTo(w, h / 2);
  path.lineTo(w - headLen, h);
  path.lineTo(w - headLen, h / 2 + headHalf);
  path.lineTo(0, h / 2 + headHalf);
  path.closePath();
  return path;
};

// rightArrow handles:
//  [0] head length — back of arrowhead on centerline (w-headLen, h/2)
//  [1] head width — upper-outer corner of arrowhead (w-headLen, h/2-headHalf)
const ARROW_LEN_MIN = ARROW_ADJUSTMENTS[0].min;
const ARROW_LEN_MAX = ARROW_ADJUSTMENTS[0].max;
const ARROW_WID_MIN = ARROW_ADJUSTMENTS[1].min;
const ARROW_WID_MAX = ARROW_ADJUSTMENTS[1].max;
const ARROW_LEN_DEF = ARROW_ADJUSTMENTS[0].defaultValue;
const ARROW_WID_DEF = ARROW_ADJUSTMENTS[1].defaultValue;

export const RIGHT_ARROW_HANDLES: readonly AdjustmentHandle[] = [
  {
    position: ({ w, h }, adjustments) => {
      const ss = Math.min(w, h);
      const headLen = ((adjustments[0] ?? ARROW_LEN_DEF) / 100000) * ss;
      return { x: insetAlongAxis(w - headLen, w), y: h / 2 };
    },
    apply: ({ w, h }, start, pointer) => {
      const ss = Math.min(w, h);
      const x = Math.max(0, Math.min(w, pointer.x));
      const headLen = w - x;
      const raw = ss > 0 ? Math.round((headLen / ss) * 100000) : 0;
      return [
        Math.max(ARROW_LEN_MIN, Math.min(ARROW_LEN_MAX, raw)),
        start[1] ?? ARROW_WID_DEF,
      ];
    },
  },
  {
    position: ({ w, h }, adjustments) => {
      const ss = Math.min(w, h);
      const headLen = ((adjustments[0] ?? ARROW_LEN_DEF) / 100000) * ss;
      const headHalf = ((adjustments[1] ?? ARROW_WID_DEF) / 100000) * (h / 2);
      return {
        x: insetAlongAxis(w - headLen, w),
        y: insetAlongAxis(h / 2 - headHalf, h),
      };
    },
    apply: ({ h }, start, pointer) => {
      const y = Math.max(0, Math.min(h, pointer.y));
      // Symmetric across centerline so dragging below also widens.
      const headHalf = Math.abs(y - h / 2);
      const half = h / 2;
      const raw = half > 0 ? Math.round((headHalf / half) * 100000) : 0;
      return [
        start[0] ?? ARROW_LEN_DEF,
        Math.max(ARROW_WID_MIN, Math.min(ARROW_WID_MAX, raw)),
      ];
    },
  },
];
