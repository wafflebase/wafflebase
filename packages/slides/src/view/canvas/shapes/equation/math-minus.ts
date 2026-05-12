import type { PathBuilder, AdjustmentHandle } from '../builder';
import { adj } from '../builder';
import { insetAlongAxis } from '../handles';
import { MATH_PLUS_ADJUSTMENTS } from './math-plus';

/**
 * `mathMinus` — `−` glyph: a single horizontal bar centered vertically.
 *
 * Adjustments — re-uses `MATH_PLUS_ADJUSTMENTS`:
 *   [0] armThickness — OOXML thousandths of `min(w,h)`. Default 23520.
 */
export const buildMathMinus: PathBuilder = ({ w, h }, adjustments) => {
  const t = (adj(adjustments, 0, 23520) / 100000) * Math.min(w, h);
  const path = new Path2D();
  path.rect(0, h / 2 - t / 2, w, t);
  return path;
};

// mathMinus is a single horizontal bar [h/2 - t/2, h/2 + t/2]. The
// handle paints at the top of the bar (w/2, h/2 - t/2). Dragging UP
// grows thickness; downward shrinks. Inverse: t = h - 2*pointer.y.
const MP_MIN = MATH_PLUS_ADJUSTMENTS[0].min;
const MP_MAX = MATH_PLUS_ADJUSTMENTS[0].max;
const MP_DEF = MATH_PLUS_ADJUSTMENTS[0].defaultValue;
export const MATH_MINUS_HANDLES: readonly AdjustmentHandle[] = [
  {
    position: ({ w, h }, adjustments) => {
      const t = ((adjustments[0] ?? MP_DEF) / 100000) * Math.min(w, h);
      return { x: w / 2, y: insetAlongAxis(h / 2 - t / 2, h) };
    },
    apply: ({ w, h }, start, pointer) => {
      const y = Math.max(0, Math.min(h, pointer.y));
      const t = h - 2 * y;
      const m = Math.min(w, h);
      const raw = m > 0 ? Math.round((t / m) * 100000) : 0;
      const result = [...start];
      result[0] = Math.max(MP_MIN, Math.min(MP_MAX, raw));
      return result;
    },
  },
];
