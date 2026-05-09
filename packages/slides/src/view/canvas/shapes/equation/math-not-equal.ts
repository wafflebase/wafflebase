import type { PathBuilder, AdjustmentSpec } from '../builder';
import { adj } from '../builder';

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
