import type { PathBuilder, AdjustmentHandle } from '../builder';
import { adj } from '../builder';
import { insetAlongAxis } from '../handles';
import { MATH_PLUS_ADJUSTMENTS } from './math-plus';

/**
 * `mathMinus` — `−` glyph: a single horizontal bar, matching the
 * ECMA-376 `mathMinus` preset.
 *
 * Adjustments — re-uses `MATH_PLUS_ADJUSTMENTS`:
 *   [0] barThickness — OOXML thousandths of `h`. Default 23520.
 *
 * OOXML proportions: the bar spans only `73.49%` of the width, centred
 * (`dx1 = w * 73490/200000`), so it runs `[hc - dx1, hc + dx1]` — NOT
 * the full width. Half-thickness `dy1 = h * a1/200000` (fraction of h,
 * a1 max 100000).
 */
export const buildMathMinus: PathBuilder = ({ w, h }, adjustments) => {
  const a1 = Math.max(0, Math.min(adj(adjustments, 0, 23520), 100000));
  const dx1 = (w * 73490) / 200000; // half bar-width (73.49% of w)
  const dy1 = (h * a1) / 200000; // half bar-thickness
  const hc = w / 2;
  const vc = h / 2;
  const path = new Path2D();
  path.rect(hc - dx1, vc - dy1, dx1 * 2, dy1 * 2);
  return path;
};

// The bar runs [vc - dy1, vc + dy1] horizontally and only spans the
// inner 73.49% width. The handle paints at the top edge of the bar
// (hc, vc - dy1). Dragging UP grows thickness; inverse: dy1 = vc - y,
// so a1 = dy1 * 200000 / h.
const MP_MIN = MATH_PLUS_ADJUSTMENTS[0].min;
const MP_MAX = MATH_PLUS_ADJUSTMENTS[0].max;
const MP_DEF = MATH_PLUS_ADJUSTMENTS[0].defaultValue;
export const MATH_MINUS_HANDLES: readonly AdjustmentHandle[] = [
  {
    position: ({ w, h }, adjustments) => {
      const a1 = (adjustments[0] ?? MP_DEF);
      const dy1 = (h * a1) / 200000;
      return { x: w / 2, y: insetAlongAxis(h / 2 - dy1, h) };
    },
    apply: ({ h }, start, pointer) => {
      const y = Math.max(0, Math.min(h, pointer.y));
      const dy1 = h / 2 - y;
      const raw = h > 0 ? Math.round((dy1 * 200000) / h) : 0;
      const result = [...start];
      result[0] = Math.max(MP_MIN, Math.min(MP_MAX, raw));
      return result;
    },
  },
];
