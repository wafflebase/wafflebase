import type {
  AdjustmentHandle,
  AdjustmentSpec,
  PathBuilder,
} from '../builder';
import { adj } from '../builder';
import { insetAlongAxis } from '../handles';

/**
 * `leftRightUpArrow` — three-way arrow (left + right + up).
 *
 * Adjustments:
 *   [0] horizontal head length — OOXML thousandths of `w/2`
 *   [1] head width — OOXML thousandths of `h/2`
 *   [2] up-arm length — OOXML thousandths of `h`
 */
// Bumped vs the OOXML 25000-uniform defaults so the three arms are
// each visibly prominent at picker / cell aspect ratios; the OOXML
// values render as a tiny T at 140 × 100.
export const LEFT_RIGHT_UP_ARROW_ADJUSTMENTS: readonly AdjustmentSpec[] = [
  { name: 'Head length', defaultValue: 35000, min: 0, max: 50000 },
  { name: 'Head width', defaultValue: 50000, min: 0, max: 100000 },
  { name: 'Up arm length', defaultValue: 35000, min: 0, max: 100000 },
];

const LRU_DEFAULT_HEAD_LENGTH = LEFT_RIGHT_UP_ARROW_ADJUSTMENTS[0].defaultValue;
const LRU_DEFAULT_HEAD_WIDTH = LEFT_RIGHT_UP_ARROW_ADJUSTMENTS[1].defaultValue;
const LRU_DEFAULT_UP_ARM = LEFT_RIGHT_UP_ARROW_ADJUSTMENTS[2].defaultValue;

export const buildLeftRightUpArrow: PathBuilder = ({ w, h }, adjustments) => {
  const headLen = (adj(adjustments, 0, LRU_DEFAULT_HEAD_LENGTH) / 100000) * (w / 2);
  const headHalf = (adj(adjustments, 1, LRU_DEFAULT_HEAD_WIDTH) / 100000) * (h / 2);
  const upLen = (adj(adjustments, 2, LRU_DEFAULT_UP_ARM) / 100000) * h;
  const shaftHalfV = headHalf * 0.5;
  const cx = w / 2;
  const cy = h - headHalf; // central horizontal shaft sits near the bottom
  const path = new Path2D();
  // Trace CW starting at left tip.
  path.moveTo(0, cy);
  path.lineTo(headLen, cy - headHalf);
  path.lineTo(headLen, cy - shaftHalfV);
  // Up arm
  path.lineTo(cx - shaftHalfV, cy - shaftHalfV);
  path.lineTo(cx - shaftHalfV, upLen + headHalf);
  path.lineTo(cx - headHalf, upLen + headHalf);
  path.lineTo(cx, upLen);
  path.lineTo(cx + headHalf, upLen + headHalf);
  path.lineTo(cx + shaftHalfV, upLen + headHalf);
  path.lineTo(cx + shaftHalfV, cy - shaftHalfV);
  // Right side
  path.lineTo(w - headLen, cy - shaftHalfV);
  path.lineTo(w - headLen, cy - headHalf);
  path.lineTo(w, cy);
  path.lineTo(w - headLen, cy + headHalf);
  path.lineTo(headLen, cy + headHalf);
  path.closePath();
  return path;
};

export const LEFT_RIGHT_UP_ARROW_HANDLES: readonly AdjustmentHandle[] = [
  // Head length — diamond on the horizontal centerline at left head.
  {
    position: ({ w, h }, adjustments) => {
      const headLen = ((adjustments[0] ?? LRU_DEFAULT_HEAD_LENGTH) / 100000) * (w / 2);
      const headHalf = ((adjustments[1] ?? LRU_DEFAULT_HEAD_WIDTH) / 100000) * (h / 2);
      const cy = h - headHalf;
      return { x: insetAlongAxis(headLen, w), y: cy };
    },
    apply: ({ w }, start, pointer) => {
      const x = Math.max(0, Math.min(w / 2, pointer.x));
      const raw = w > 0 ? Math.round((x / (w / 2)) * 100000) : 0;
      const spec = LEFT_RIGHT_UP_ARROW_ADJUSTMENTS[0];
      return [
        Math.max(spec.min, Math.min(spec.max, raw)),
        start[1] ?? LRU_DEFAULT_HEAD_WIDTH,
        start[2] ?? LRU_DEFAULT_UP_ARM,
      ];
    },
  },
  // Head width — diamond at outer corner of left head.
  {
    position: ({ w, h }, adjustments) => {
      const headLen = ((adjustments[0] ?? LRU_DEFAULT_HEAD_LENGTH) / 100000) * (w / 2);
      const headHalf = ((adjustments[1] ?? LRU_DEFAULT_HEAD_WIDTH) / 100000) * (h / 2);
      const cy = h - headHalf;
      return {
        x: insetAlongAxis(headLen, w),
        y: insetAlongAxis(cy - headHalf, h),
      };
    },
    apply: ({ h }, start, pointer) => {
      const y = Math.max(0, Math.min(h, pointer.y));
      // `position` places the diamond at `y = cy − headHalf` where
      // `cy = h − headHalf`, so `y = h − 2·headHalf`. The inverse
      // must halve `(h − y)` to round-trip; the earlier `h − y`
      // doubled the value (e.g. 50000 → 100000 on a no-op drag).
      const headHalf = Math.max(0, Math.min(h / 2, (h - y) / 2));
      const raw = h > 0 ? Math.round((headHalf / (h / 2)) * 100000) : 0;
      const spec = LEFT_RIGHT_UP_ARROW_ADJUSTMENTS[1];
      return [
        start[0] ?? LRU_DEFAULT_HEAD_LENGTH,
        Math.max(spec.min, Math.min(spec.max, raw)),
        start[2] ?? LRU_DEFAULT_UP_ARM,
      ];
    },
  },
  // Up-arm length — diamond at the tip of the up arrow.
  {
    position: ({ w, h }, adjustments) => {
      const upLen = ((adjustments[2] ?? LRU_DEFAULT_UP_ARM) / 100000) * h;
      return { x: w / 2, y: insetAlongAxis(upLen, h) };
    },
    apply: ({ h }, start, pointer) => {
      const y = Math.max(0, Math.min(h, pointer.y));
      const raw = h > 0 ? Math.round((y / h) * 100000) : 0;
      const spec = LEFT_RIGHT_UP_ARROW_ADJUSTMENTS[2];
      return [
        start[0] ?? LRU_DEFAULT_HEAD_LENGTH,
        start[1] ?? LRU_DEFAULT_HEAD_WIDTH,
        Math.max(spec.min, Math.min(spec.max, raw)),
      ];
    },
  },
];
