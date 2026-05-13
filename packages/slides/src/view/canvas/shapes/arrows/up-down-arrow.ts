import type {
  AdjustmentHandle,
  AdjustmentSpec,
  PathBuilder,
} from '../builder';
import { adj } from '../builder';
import { insetAlongAxis } from '../handles';

/**
 * `upDownArrow` — vertical double-headed block arrow. Two
 * adjustments parallel to `ARROW_ADJUSTMENTS`:
 *   [0] head length — OOXML thousandths of `h`; default 50000
 *   [1] head width — OOXML thousandths of `w/2`; default 50000
 * Shaft width fixed at 50% of head width (matches OOXML default).
 */
export const UP_DOWN_ARROW_ADJUSTMENTS: readonly AdjustmentSpec[] = [
  { name: 'Head length', defaultValue: 50000, min: 0, max: 100000 },
  { name: 'Head width', defaultValue: 50000, min: 0, max: 100000 },
];

export const buildUpDownArrow: PathBuilder = ({ w, h }, adjustments) => {
  const headLen = Math.min(h / 2, (adj(adjustments, 0, 50000) / 100000) * h);
  const headHalf = (adj(adjustments, 1, 50000) / 100000) * (w / 2);
  const shaftHalf = headHalf * 0.5;
  const cx = w / 2;
  const path = new Path2D();
  path.moveTo(cx, 0); // top tip
  path.lineTo(cx + headHalf, headLen);
  path.lineTo(cx + shaftHalf, headLen);
  path.lineTo(cx + shaftHalf, h - headLen);
  path.lineTo(cx + headHalf, h - headLen);
  path.lineTo(cx, h); // bottom tip
  path.lineTo(cx - headHalf, h - headLen);
  path.lineTo(cx - shaftHalf, h - headLen);
  path.lineTo(cx - shaftHalf, headLen);
  path.lineTo(cx - headHalf, headLen);
  path.closePath();
  return path;
};

const LEN_MIN = UP_DOWN_ARROW_ADJUSTMENTS[0].min;
const LEN_MAX = UP_DOWN_ARROW_ADJUSTMENTS[0].max;
const WID_MIN = UP_DOWN_ARROW_ADJUSTMENTS[1].min;
const WID_MAX = UP_DOWN_ARROW_ADJUSTMENTS[1].max;
const LEN_DEF = UP_DOWN_ARROW_ADJUSTMENTS[0].defaultValue;
const WID_DEF = UP_DOWN_ARROW_ADJUSTMENTS[1].defaultValue;

export const UP_DOWN_ARROW_HANDLES: readonly AdjustmentHandle[] = [
  // Head length — diamond at the head/shaft boundary on the
  // centerline (cx, headLen).
  {
    position: ({ w, h }, adjustments) => {
      const headLen = ((adjustments[0] ?? LEN_DEF) / 100000) * h;
      return { x: w / 2, y: insetAlongAxis(headLen, h) };
    },
    apply: ({ h }, start, pointer) => {
      const y = Math.max(0, Math.min(h, pointer.y));
      const raw = h > 0 ? Math.round((y / h) * 100000) : 0;
      return [
        Math.max(LEN_MIN, Math.min(LEN_MAX, raw)),
        start[1] ?? WID_DEF,
      ];
    },
  },
  // Head width — diamond at the outer corner of the upper head
  // (cx + headHalf, headLen).
  {
    position: ({ w, h }, adjustments) => {
      const headLen = ((adjustments[0] ?? LEN_DEF) / 100000) * h;
      const headHalf = ((adjustments[1] ?? WID_DEF) / 100000) * (w / 2);
      return {
        x: insetAlongAxis(w / 2 + headHalf, w),
        y: insetAlongAxis(headLen, h),
      };
    },
    apply: ({ w }, start, pointer) => {
      const x = Math.max(0, Math.min(w, pointer.x));
      const headHalf = Math.abs(x - w / 2);
      const half = w / 2;
      const raw = half > 0 ? Math.round((headHalf / half) * 100000) : 0;
      return [
        start[0] ?? LEN_DEF,
        Math.max(WID_MIN, Math.min(WID_MAX, raw)),
      ];
    },
  },
];
