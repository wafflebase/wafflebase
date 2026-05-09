import type { PathBuilder, AdjustmentSpec } from '../builder';
import { adj } from '../builder';

/**
 * `mathNotEqual` — `≠` glyph: two parallel horizontal bars with a
 * diagonal slash through them.
 *
 * Adjustments (`MATH_NOT_EQUAL_ADJUSTMENTS`):
 *   [0] barThickness   — OOXML thousandths of `h`. Default 23520.
 *   [1] gap            — OOXML thousandths of `h`, between the inner
 *                        edges of the two bars. Default 11760.
 *   [2] slashThickness — OOXML thousandths of `h`. Default 6600.
 *
 * The slash is expressed as an explicit polygon (rotated -45° about
 * the frame centre) for the same reason as `mathMultiply`'s arms —
 * the test environment's Path2D shim does not support transform-
 * scoped sub-paths.
 */
export const MATH_NOT_EQUAL_ADJUSTMENTS: readonly AdjustmentSpec[] = [
  { name: 'Bar thickness', defaultValue: 23520, min: 0, max: 50000 },
  { name: 'Gap', defaultValue: 11760, min: 0, max: 50000 },
  { name: 'Slash thickness', defaultValue: 6600, min: 0, max: 50000 },
];

export const buildMathNotEqual: PathBuilder = ({ w, h }, adjustments) => {
  const bar = (adj(adjustments, 0, 23520) / 100000) * h;
  const gap = (adj(adjustments, 1, 11760) / 100000) * h;
  const slashT = (adj(adjustments, 2, 6600) / 100000) * h;
  const cx = w / 2;
  const cy = h / 2;
  const path = new Path2D();
  path.rect(0, cy - gap / 2 - bar, w, bar);
  path.rect(0, cy + gap / 2, w, bar);
  // Diagonal slash from bottom-left toward top-right.
  const halfDiag = Math.hypot(w, h) / 2;
  const cosR = Math.cos(-Math.PI / 4);
  const sinR = Math.sin(-Math.PI / 4);
  const corners: Array<[number, number]> = [
    [-halfDiag, -slashT / 2],
    [halfDiag, -slashT / 2],
    [halfDiag, slashT / 2],
    [-halfDiag, slashT / 2],
  ];
  corners.forEach(([x, y], i) => {
    const xr = x * cosR - y * sinR + cx;
    const yr = x * sinR + y * cosR + cy;
    if (i === 0) path.moveTo(xr, yr);
    else path.lineTo(xr, yr);
  });
  path.closePath();
  return path;
};
