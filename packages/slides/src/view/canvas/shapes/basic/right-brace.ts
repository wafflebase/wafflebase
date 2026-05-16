import type { PathBuilder, AdjustmentHandle } from '../builder';
import { adj } from '../builder';
import { insetAlongAxis } from '../handles';
import {
  braceCornerRadius,
  DEF_BRACE_NOTCH,
  DEF_BRACE_RADIUS,
} from './left-brace';

/** `rightBrace` — "}" shape, mirror of `leftBrace`. */
export const buildRightBrace: PathBuilder = (size, adjustments) => {
  const { w, h } = size;
  const a0 = adj(adjustments, 0, DEF_BRACE_RADIUS);
  const a1 = adj(adjustments, 1, DEF_BRACE_NOTCH);
  const r = braceCornerRadius(size, a0, a1);
  const notchY = Math.max(r * 2, Math.min(h - r * 2, h * (a1 / 100000)));
  const path = new Path2D();
  path.moveTo(0, 0);
  path.lineTo(w / 2 - r, 0);
  path.quadraticCurveTo(w / 2, 0, w / 2, r);
  path.lineTo(w / 2, notchY - r);
  path.quadraticCurveTo(w / 2, notchY, w / 2 + r, notchY);
  path.quadraticCurveTo(w / 2, notchY, w / 2, notchY + r);
  path.lineTo(w / 2, h - r);
  path.quadraticCurveTo(w / 2, h, w / 2 - r, h);
  path.lineTo(0, h);
  return path;
};

export const RIGHT_BRACE_HANDLES: readonly AdjustmentHandle[] = [
  {
    position: (size, adjustments) => {
      const a1 = adjustments[1] ?? DEF_BRACE_NOTCH;
      return {
        x: insetAlongAxis(size.w, size.w),
        y: insetAlongAxis(size.h * (a1 / 100000), size.h),
      };
    },
    apply: ({ h }, start, pointer) => {
      const y = Math.max(0, Math.min(h, pointer.y));
      const newA1 = h > 0 ? Math.round((y / h) * 100000) : DEF_BRACE_NOTCH;
      return [
        start[0] ?? DEF_BRACE_RADIUS,
        Math.max(0, Math.min(100000, newA1)),
      ];
    },
  },
];
