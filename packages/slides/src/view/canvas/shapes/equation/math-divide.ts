import type { PathBuilder, AdjustmentSpec, AdjustmentHandle } from '../builder';
import { adj } from '../builder';
import { insetAlongAxis } from '../handles';

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

// Three handles, all on the upper half:
//  [0] bar thickness → top of central bar (w/2, cy - bar/2)
//  [1] dot radius    → right edge of top dot (cx + dotR, dotY)
//  [2] gap           → midpoint between bar top and top dot bottom
const MD_DEF0 = MATH_DIVIDE_ADJUSTMENTS[0].defaultValue;
const MD_DEF1 = MATH_DIVIDE_ADJUSTMENTS[1].defaultValue;
const MD_DEF2 = MATH_DIVIDE_ADJUSTMENTS[2].defaultValue;
const mdClamp = (i: number, v: number) =>
  Math.max(MATH_DIVIDE_ADJUSTMENTS[i].min, Math.min(MATH_DIVIDE_ADJUSTMENTS[i].max, v));
export const MATH_DIVIDE_HANDLES: readonly AdjustmentHandle[] = [
  {
    position: ({ w, h }, adjustments) => {
      const bar = ((adjustments[0] ?? MD_DEF0) / 100000) * h;
      return { x: w / 2, y: insetAlongAxis(h / 2 - bar / 2, h) };
    },
    apply: ({ h }, start, pointer) => {
      const y = Math.max(0, Math.min(h, pointer.y));
      const bar = h - 2 * y;
      const raw = h > 0 ? Math.round((bar / h) * 100000) : 0;
      const result = [...start];
      result[0] = mdClamp(0, raw);
      return result;
    },
  },
  {
    position: ({ w, h }, adjustments) => {
      const bar = ((adjustments[0] ?? MD_DEF0) / 100000) * h;
      const dotR = ((adjustments[1] ?? MD_DEF1) / 100000) * h;
      const gap = ((adjustments[2] ?? MD_DEF2) / 100000) * h;
      const dotY = h / 2 - bar / 2 - gap - dotR;
      return {
        x: insetAlongAxis(w / 2 + dotR, w),
        y: insetAlongAxis(dotY, h),
      };
    },
    apply: ({ w, h }, start, pointer) => {
      const x = Math.max(0, Math.min(w, pointer.x));
      const dotR = Math.abs(x - w / 2);
      const raw = h > 0 ? Math.round((dotR / h) * 100000) : 0;
      const result = [...start];
      result[1] = mdClamp(1, raw);
      return result;
    },
  },
  {
    position: ({ w, h }, adjustments) => {
      const bar = ((adjustments[0] ?? MD_DEF0) / 100000) * h;
      const gap = ((adjustments[2] ?? MD_DEF2) / 100000) * h;
      // Midpoint of the gap between bar top and top dot bottom edge.
      // (Top dot bottom edge = cy - bar/2 - gap, since the gap is
      // measured from bar edge to nearest dot edge; dotR shifts the
      // dot center but not the dot bottom edge that bounds the gap.)
      const barTop = h / 2 - bar / 2;
      const dotBottom = h / 2 - bar / 2 - gap;
      return { x: w / 2, y: insetAlongAxis((barTop + dotBottom) / 2, h) };
    },
    apply: ({ h }, start, pointer) => {
      const y = Math.max(0, Math.min(h, pointer.y));
      const bar = ((start[0] ?? MD_DEF0) / 100000) * h;
      // y = (barTop + dotBottom)/2 = (h/2 - bar/2 + h/2 - bar/2 - gap)/2
      //   = h/2 - bar/2 - gap/2  →  gap = 2*(h/2 - bar/2 - y) = h - bar - 2y
      const gap = h - bar - 2 * y;
      const raw = h > 0 ? Math.round((gap / h) * 100000) : 0;
      const result = [...start];
      result[2] = mdClamp(2, raw);
      return result;
    },
  },
];
