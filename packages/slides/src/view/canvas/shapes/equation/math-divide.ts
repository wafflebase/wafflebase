import type { PathBuilder, AdjustmentSpec } from '../builder';
import { adj } from '../builder';

/**
 * `mathDivide` — `÷` glyph: a horizontal bar with a dot above and a
 * dot below.
 *
 * Adjustments (`MATH_DIVIDE_ADJUSTMENTS`):
 *   [0] barThickness — OOXML thousandths of `h`. Default 23520.
 *   [1] dotRadius    — OOXML thousandths of `h`. Default 5880.
 *   [2] gap          — OOXML thousandths of `h`, between bar edge and
 *                      the nearest edge of each dot. Default 11760.
 */
export const MATH_DIVIDE_ADJUSTMENTS: readonly AdjustmentSpec[] = [
  { name: 'Bar thickness', defaultValue: 23520, min: 0, max: 50000 },
  { name: 'Dot radius', defaultValue: 5880, min: 0, max: 25000 },
  { name: 'Gap', defaultValue: 11760, min: 0, max: 50000 },
];

export const buildMathDivide: PathBuilder = ({ w, h }, adjustments) => {
  const bar = (adj(adjustments, 0, 23520) / 100000) * h;
  const dotR = (adj(adjustments, 1, 5880) / 100000) * h;
  const gap = (adj(adjustments, 2, 11760) / 100000) * h;
  const cx = w / 2;
  const cy = h / 2;
  const path = new Path2D();
  path.rect(0, cy - bar / 2, w, bar);
  // Top dot.
  path.moveTo(cx + dotR, cy - bar / 2 - gap - dotR);
  path.arc(cx, cy - bar / 2 - gap - dotR, dotR, 0, Math.PI * 2);
  // Bottom dot.
  path.moveTo(cx + dotR, cy + bar / 2 + gap + dotR);
  path.arc(cx, cy + bar / 2 + gap + dotR, dotR, 0, Math.PI * 2);
  return path;
};
