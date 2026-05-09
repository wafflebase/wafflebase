import type { PathBuilder, AdjustmentSpec } from '../builder';
import { adj } from '../builder';

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
