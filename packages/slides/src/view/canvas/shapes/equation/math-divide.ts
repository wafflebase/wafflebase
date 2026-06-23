import type { PathBuilder, AdjustmentSpec, AdjustmentHandle } from '../builder';
import { adj } from '../builder';
import { insetAlongAxis } from '../handles';

/**
 * `mathDivide` — `÷` glyph: a horizontal bar with a dot above and a
 * dot below.
 *
 * Adjustments (`MATH_DIVIDE_ADJUSTMENTS`):
 *   [0] barThickness — OOXML thousandths of `h`. Default 23520.
 *   [1] dotRadius    — OOXML `adj3`, thousandths of `h`. Default 11760.
 *   [2] gap          — OOXML `adj2`, thousandths of `h`, between bar
 *                      edge and the nearest edge of each dot. Default
 *                      5880.
 *
 * NOTE: the ECMA-376 preset's `adj3` is the dot RADIUS (default 11760)
 * and `adj2` is the gap (default 5880) — the previous implementation
 * had these two defaults swapped (radius 5880 / gap 11760).
 *
 * OOXML proportions (origin = frame top-left, y DOWN):
 *   dy1 = h * a1/200000             half bar-thickness
 *   rad = h * a3/100000             dot radius (a3 = adj index 1)
 *   yg  = h * a2/100000             gap (a2 = adj index 2)
 *   dx1 = w * 73490/200000          half bar-width (73.49% of w)
 *   y3 = vc - dy1                   bar top edge
 *   y2 = y3 - (yg + rad)            top-dot centre
 *   y1 = y2 - rad                   top-dot top edge
 *   y5 = b - y1                     bottom-dot centre (symmetric)
 * The bar therefore spans only the inner 73.49% of the width.
 */
export const MATH_DIVIDE_ADJUSTMENTS: readonly AdjustmentSpec[] = [
  { name: 'Bar thickness', defaultValue: 23520, min: 0, max: 50000 },
  { name: 'Dot radius', defaultValue: 11760, min: 0, max: 25000 },
  { name: 'Gap', defaultValue: 5880, min: 0, max: 50000 },
];

export const buildMathDivide: PathBuilder = ({ w, h }, adjustments) => {
  const dy1 = (adj(adjustments, 0, 23520) / 200000) * h; // half bar
  const dotR = (adj(adjustments, 1, 11760) / 100000) * h; // a3 radius
  const gap = (adj(adjustments, 2, 5880) / 100000) * h; // a2 gap
  const dx1 = (w * 73490) / 200000; // half bar-width (73.49% of w)
  const hc = w / 2;
  const vc = h / 2;
  const barTop = vc - dy1;
  const barBottom = vc + dy1;
  // Top-dot centre sits gap + radius above the bar's top edge.
  const topDotY = barTop - gap - dotR;
  const bottomDotY = barBottom + gap + dotR;
  const path = new Path2D();
  path.rect(hc - dx1, barTop, dx1 * 2, dy1 * 2);
  // Top dot.
  path.moveTo(hc + dotR, topDotY);
  path.arc(hc, topDotY, dotR, 0, Math.PI * 2);
  // Bottom dot.
  path.moveTo(hc + dotR, bottomDotY);
  path.arc(hc, bottomDotY, dotR, 0, Math.PI * 2);
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
