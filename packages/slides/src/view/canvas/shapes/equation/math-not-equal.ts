import type { PathBuilder, AdjustmentSpec, AdjustmentHandle } from '../builder';
import { adj } from '../builder';
import { insetAlongAxis } from '../handles';

/**
 * `mathNotEqual` — `≠` glyph: two parallel horizontal bars with a
 * diagonal slash through them, traced as a single 20-vertex union
 * polygon.
 *
 * Adjustments (`MATH_NOT_EQUAL_ADJUSTMENTS`):
 *   [0] barThickness   — OOXML thousandths of `h`. Default 23520.
 *   [1] gap            — OOXML thousandths of `h`, between the inner
 *                        edges of the two bars. Default 11760.
 *   [2] slashThickness — OOXML thousandths of `h`. Default 6600.
 *
 * Three separate sub-paths (top bar rect + bottom bar rect + rotated
 * slash polygon) would each stroke independently, so the slash's two
 * long edges and each bar's top/bottom edges all paint a small
 * parallelogram outline at the intersections. We instead trace the
 * union outline as a single closed polygon: walking clockwise from
 * the slash's upper-right tip, alternating between slash edges and
 * bar edges at each crossing.
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

  // Bar y-coordinates (top→bottom).
  const yTopT = cy - gap / 2 - bar;
  const yTopB = cy - gap / 2;
  const yBotT = cy + gap / 2;
  const yBotB = cy + gap / 2 + bar;

  // Slash: rotated -45° about (cx, cy), thickness slashT, length
  // 2*halfDiag (slightly longer than the frame so the tips peek out
  // of the frame corners visually).
  const halfDiag = Math.hypot(w, h) / 2;
  const halfT = slashT / 2;
  const c = Math.SQRT1_2; // cos(-45°)
  const s = -Math.SQRT1_2; // sin(-45°)

  /** Rotate slash-local (lx, ly) into canvas coords. */
  function R(lx: number, ly: number): [number, number] {
    return [lx * c - ly * s + cx, lx * s + ly * c + cy];
  }

  // Slash corners in canvas coords. Naming follows visual position:
  //   SUR = slash upper-right tip   (upper edge, right end)
  //   SLR = slash upper-right base  (lower edge, right end, slightly below SUR)
  //   SLL = slash lower-left base   (lower edge, left end)
  //   SUL = slash lower-left tip    (upper edge, left end, slightly above SLL)
  const [SUR_x, SUR_y] = R(halfDiag, -halfT);
  const [SLR_x, SLR_y] = R(halfDiag, halfT);
  const [SLL_x, SLL_y] = R(-halfDiag, halfT);
  const [SUL_x, SUL_y] = R(-halfDiag, -halfT);

  /** x where the slash's `which` edge crosses horizontal line y=Y. */
  function slashEdgeX(which: 'upper' | 'lower', Y: number): number {
    const ly = which === 'upper' ? -halfT : halfT;
    const [x1, y1] = R(-halfDiag, ly);
    const [x2, y2] = R(halfDiag, ly);
    const t = (Y - y1) / (y2 - y1);
    return x1 + t * (x2 - x1);
  }

  // Eight slash×bar crossings.
  const upTopT = slashEdgeX('upper', yTopT);
  const upTopB = slashEdgeX('upper', yTopB);
  const upBotT = slashEdgeX('upper', yBotT);
  const upBotB = slashEdgeX('upper', yBotB);
  const loTopT = slashEdgeX('lower', yTopT);
  const loTopB = slashEdgeX('lower', yTopB);
  const loBotT = slashEdgeX('lower', yBotT);
  const loBotB = slashEdgeX('lower', yBotB);

  // Trace the union outline clockwise from the slash's upper-right tip.
  const path = new Path2D();
  path.moveTo(SUR_x, SUR_y);
  path.lineTo(SLR_x, SLR_y);
  path.lineTo(loTopT, yTopT);
  path.lineTo(w, yTopT);
  path.lineTo(w, yTopB);
  path.lineTo(loTopB, yTopB);
  path.lineTo(loBotT, yBotT);
  path.lineTo(w, yBotT);
  path.lineTo(w, yBotB);
  path.lineTo(loBotB, yBotB);
  path.lineTo(SLL_x, SLL_y);
  path.lineTo(SUL_x, SUL_y);
  path.lineTo(upBotB, yBotB);
  path.lineTo(0, yBotB);
  path.lineTo(0, yBotT);
  path.lineTo(upBotT, yBotT);
  path.lineTo(upTopB, yTopB);
  path.lineTo(0, yTopB);
  path.lineTo(0, yTopT);
  path.lineTo(upTopT, yTopT);
  path.closePath();
  return path;
};

// Three handles, all on the upper-left quadrant for visual locality:
//  [0] bar thickness   → top of upper bar (w/2, cy - gap/2 - bar)
//  [1] gap             → bottom of upper bar (w/2, cy - gap/2)
//  [2] slash thickness → midpoint of slash's upper edge — for the
//      -45° slash (direction (SQRT1_2, -SQRT1_2)), the perpendicular
//      offset toward upper-left is (-SQRT1_2, -SQRT1_2). Half the
//      slash thickness in that direction lands the handle at
//      (cx - halfT*SQRT1_2, cy - halfT*SQRT1_2).
const MNE_DEF0 = MATH_NOT_EQUAL_ADJUSTMENTS[0].defaultValue;
const MNE_DEF1 = MATH_NOT_EQUAL_ADJUSTMENTS[1].defaultValue;
const MNE_DEF2 = MATH_NOT_EQUAL_ADJUSTMENTS[2].defaultValue;
const mneClamp = (i: number, v: number) =>
  Math.max(
    MATH_NOT_EQUAL_ADJUSTMENTS[i].min,
    Math.min(MATH_NOT_EQUAL_ADJUSTMENTS[i].max, v),
  );
export const MATH_NOT_EQUAL_HANDLES: readonly AdjustmentHandle[] = [
  {
    position: ({ w, h }, adjustments) => {
      const bar = ((adjustments[0] ?? MNE_DEF0) / 100000) * h;
      const gap = ((adjustments[1] ?? MNE_DEF1) / 100000) * h;
      return { x: w / 2, y: insetAlongAxis(h / 2 - gap / 2 - bar, h) };
    },
    apply: ({ h }, start, pointer) => {
      const y = Math.max(0, Math.min(h, pointer.y));
      const gap = ((start[1] ?? MNE_DEF1) / 100000) * h;
      const bar = h / 2 - gap / 2 - y;
      const raw = h > 0 ? Math.round((bar / h) * 100000) : 0;
      const result = [...start];
      result[0] = mneClamp(0, raw);
      return result;
    },
  },
  {
    position: ({ w, h }, adjustments) => {
      const gap = ((adjustments[1] ?? MNE_DEF1) / 100000) * h;
      return { x: w / 2, y: insetAlongAxis(h / 2 - gap / 2, h) };
    },
    apply: ({ h }, start, pointer) => {
      const y = Math.max(0, Math.min(h, pointer.y));
      const gap = h - 2 * y;
      const raw = h > 0 ? Math.round((gap / h) * 100000) : 0;
      const result = [...start];
      result[1] = mneClamp(1, raw);
      return result;
    },
  },
  {
    position: ({ w, h }, adjustments) => {
      const slashT = ((adjustments[2] ?? MNE_DEF2) / 100000) * h;
      const off = (slashT / 2) * Math.SQRT1_2;
      return {
        x: insetAlongAxis(w / 2 - off, w),
        y: insetAlongAxis(h / 2 - off, h),
      };
    },
    apply: ({ w, h }, start, pointer) => {
      const x = Math.max(0, Math.min(w, pointer.x));
      const y = Math.max(0, Math.min(h, pointer.y));
      // Project (pointer - centre) onto the perpendicular direction
      // (-SQRT1_2, -SQRT1_2). The signed scalar is `proj = -(dx + dy)*SQRT1_2`;
      // slashT/2 corresponds to |proj|.
      const dx = x - w / 2;
      const dy = y - h / 2;
      const proj = -(dx + dy) * Math.SQRT1_2;
      const slashT = 2 * Math.abs(proj);
      const raw = h > 0 ? Math.round((slashT / h) * 100000) : 0;
      const result = [...start];
      result[2] = mneClamp(2, raw);
      return result;
    },
  },
];
