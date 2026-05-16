import type { PathBuilder, AdjustmentHandle } from '../builder';
import { insetAlongAxis } from '../handles';
import { bracketCornerRadius, DEF_BRACKET_RADIUS } from './left-bracket';

/** `rightBracket` — "]" shape, mirror of `leftBracket`. */
export const buildRightBracket: PathBuilder = (size, adjustments) => {
  const { w, h } = size;
  const r = bracketCornerRadius(size, adjustments);
  const path = new Path2D();
  path.moveTo(0, 0);
  path.lineTo(w - r, 0);
  path.quadraticCurveTo(w, 0, w, r);
  path.lineTo(w, h - r);
  path.quadraticCurveTo(w, h, w - r, h);
  path.lineTo(0, h);
  return path;
};

export const RIGHT_BRACKET_HANDLES: readonly AdjustmentHandle[] = [
  {
    position: (size, adjustments) => {
      const r = bracketCornerRadius(size, adjustments);
      return { x: insetAlongAxis(size.w, size.w), y: insetAlongAxis(r, size.h) };
    },
    apply: ({ w, h }, _start, pointer) => {
      const ss = Math.min(w, h);
      const y = Math.max(0, Math.min(ss / 2, pointer.y));
      const raw = ss > 0 ? Math.round((y / (ss / 2)) * 50000) : DEF_BRACKET_RADIUS;
      return [Math.max(0, Math.min(50000, raw))];
    },
  },
];
