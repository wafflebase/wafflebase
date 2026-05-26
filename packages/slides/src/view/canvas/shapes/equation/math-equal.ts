import type { PathBuilder, AdjustmentSpec, AdjustmentHandle } from '../builder';
import { adj } from '../builder';
import { insetAlongAxis } from '../handles';

/**
 * `mathEqual` — `=` glyph: two parallel horizontal bars centred on
 * the frame.
 *
 * Adjustments (`MATH_EQUAL_ADJUSTMENTS`):
 *   [0] barThickness — OOXML thousandths of `h`. Default 23520.
 *   [1] gap          — OOXML thousandths of `h`, between the inner
 *                      edges of the two bars. Default 11760.
 */
export const MATH_EQUAL_ADJUSTMENTS: readonly AdjustmentSpec[] = [
  { name: 'Bar thickness', defaultValue: 23520, min: 0, max: 50000 },
  { name: 'Gap', defaultValue: 11760, min: 0, max: 50000 },
];

export const buildMathEqual: PathBuilder = ({ w, h }, adjustments) => {
  const bar = (adj(adjustments, 0, 23520) / 100000) * h;
  const gap = (adj(adjustments, 1, 11760) / 100000) * h;
  const cy = h / 2;
  const path = new Path2D();
  path.rect(0, cy - gap / 2 - bar, w, bar);
  path.rect(0, cy + gap / 2, w, bar);
  return path;
};

// Two handles on the upper bar:
//  [0] bar thickness → top of upper bar (w/2, cy - gap/2 - bar)
//  [1] gap           → bottom of upper bar (w/2, cy - gap/2)
const ME_BAR_MIN = MATH_EQUAL_ADJUSTMENTS[0].min;
const ME_BAR_MAX = MATH_EQUAL_ADJUSTMENTS[0].max;
const ME_BAR_DEF = MATH_EQUAL_ADJUSTMENTS[0].defaultValue;
const ME_GAP_MIN = MATH_EQUAL_ADJUSTMENTS[1].min;
const ME_GAP_MAX = MATH_EQUAL_ADJUSTMENTS[1].max;
const ME_GAP_DEF = MATH_EQUAL_ADJUSTMENTS[1].defaultValue;
export const MATH_EQUAL_HANDLES: readonly AdjustmentHandle[] = [
  {
    position: ({ w, h }, adjustments) => {
      const bar = ((adjustments[0] ?? ME_BAR_DEF) / 100000) * h;
      const gap = ((adjustments[1] ?? ME_GAP_DEF) / 100000) * h;
      return { x: w / 2, y: insetAlongAxis(h / 2 - gap / 2 - bar, h) };
    },
    apply: ({ h }, start, pointer) => {
      const y = Math.max(0, Math.min(h, pointer.y));
      const gap = ((start[1] ?? ME_GAP_DEF) / 100000) * h;
      const bar = h / 2 - gap / 2 - y;
      const raw = h > 0 ? Math.round((bar / h) * 100000) : 0;
      const result = [...start];
      result[0] = Math.max(ME_BAR_MIN, Math.min(ME_BAR_MAX, raw));
      return result;
    },
  },
  {
    position: ({ w, h }, adjustments) => {
      const gap = ((adjustments[1] ?? ME_GAP_DEF) / 100000) * h;
      return { x: w / 2, y: insetAlongAxis(h / 2 - gap / 2, h) };
    },
    apply: ({ h }, start, pointer) => {
      const y = Math.max(0, Math.min(h, pointer.y));
      const gap = h - 2 * y; // gap = h - 2y so 2y = h - gap → y = (h - gap)/2 → gap = h - 2y
      const raw = h > 0 ? Math.round((gap / h) * 100000) : 0;
      const result = [...start];
      result[1] = Math.max(ME_GAP_MIN, Math.min(ME_GAP_MAX, raw));
      return result;
    },
  },
];
