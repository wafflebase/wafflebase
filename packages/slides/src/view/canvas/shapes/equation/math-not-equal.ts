import type { PathBuilder, AdjustmentSpec, AdjustmentHandle } from '../builder';
import { adj } from '../builder';
import { angularHandle, insetAlongAxis } from '../handles';

/**
 * `mathNotEqual` — `≠` glyph: two parallel horizontal bars crossed by a
 * diagonal slash, traced as a single closed union polygon.
 *
 * Faithful to the ECMA-376 preset geometry. Adjustments (OOXML order):
 *   [0] adj1 — bar thickness, fraction of `h` in thousandths
 *              (`dy1 = h·a1/100000`).             range 0..50000,   def 23520
 *   [1] adj2 — slash ANGLE, raw 60000ths of a degree. The strike line is
 *              `cadj2 = adj2 − 90°` off vertical. range 70°..110°,  def 110°
 *              (4200000..6600000, def 6600000).
 *   [2] adj3 — gap between the two bars' inner edges, fraction of `h`;
 *              the half-gap is `dy2 = h·a3/200000`. range 0..maxAdj3, def 11760
 *              (maxAdj3 = 100000 − 2·a1).
 *
 * The slash weight is *derived* from the bar thickness (`bhw =
 * len·dy1/hd2`), so the strike paints with the same pen weight as the
 * bars — there is no separate slash-thickness adjustment.
 *
 * Tracing the union outline as one closed polygon (rather than three
 * stroked sub-paths) avoids the small parallelogram seams that would
 * otherwise appear where the slash crosses each bar.
 */
export const MATH_NOT_EQUAL_ADJUSTMENTS: readonly AdjustmentSpec[] = [
  { name: 'Bar thickness', defaultValue: 23520, min: 0, max: 50000 },
  {
    name: 'Slash angle',
    defaultValue: 6600000,
    min: 4200000,
    max: 6600000,
    format: (v) => `${Math.round(v / 60000)}°`,
  },
  { name: 'Gap', defaultValue: 11760, min: 0, max: 50000 },
];

const CD4 = 5400000; // 90° in 60000ths of a degree
const ANGLE_UNIT = Math.PI / (180 * 60000); // 60000ths-of-degree → radians

const clamp = (v: number, lo: number, hi: number): number =>
  Math.max(lo, Math.min(hi, v));

export const buildMathNotEqual: PathBuilder = ({ w, h }, adjustments) => {
  const a1 = clamp(adj(adjustments, 0, 23520), 0, 50000);
  const crAng = clamp(adj(adjustments, 1, 6600000), 4200000, 6600000);
  const maxAdj3 = 100000 - 2 * a1;
  const a3 = clamp(adj(adjustments, 2, 11760), 0, maxAdj3);

  const hc = w / 2;
  const vc = h / 2;
  const hd2 = h / 2;

  const dy1 = (h * a1) / 100000; // bar thickness
  const dy2 = (h * a3) / 200000; // half-gap
  const dx1 = (w * 73490) / 200000; // bars' horizontal half-extent
  const x1 = hc - dx1;
  const x8 = hc + dx1;
  const y2 = vc - dy2; // upper bar inner (bottom) edge
  const y3 = vc + dy2; // lower bar inner (top) edge
  const y1 = y2 - dy1; // upper bar outer (top) edge
  const y4 = y3 + dy1; // lower bar outer (bottom) edge

  const cadj2 = crAng - CD4; // strike inclination off vertical
  const xadj2 = hd2 * Math.tan(cadj2 * ANGLE_UNIT);
  const len = Math.hypot(xadj2, hd2);
  const bhw = (len * dy1) / hd2; // slash width measured horizontally
  const bhw2 = bhw / 2;

  const x7 = hc + xadj2 - bhw2;
  const x6 = x7 - (xadj2 * y1) / hd2;
  const x5 = x7 - (xadj2 * y2) / hd2;
  const x4 = x7 - (xadj2 * y3) / hd2;
  const x3 = x7 - (xadj2 * y4) / hd2;
  const rx7 = x7 + bhw;
  const rx6 = x6 + bhw;
  const rx5 = x5 + bhw;
  const rx4 = x4 + bhw;
  const rx3 = x3 + bhw;

  const dx7 = (dy1 * hd2) / len;
  const rxt = x7 + dx7;
  const lxt = rx7 - dx7;
  const rx = cadj2 > 0 ? rxt : rx7;
  const lx = cadj2 > 0 ? x7 : lxt;

  const dy3 = (dy1 * xadj2) / len;
  const dy4 = -dy3;
  const ry = cadj2 > 0 ? dy3 : 0;
  const ly = cadj2 > 0 ? 0 : dy4;

  const dlx = w - rx;
  const drx = w - lx;
  const dly = h - ry;
  const dry = h - ly;

  const path = new Path2D();
  path.moveTo(x1, y1);
  path.lineTo(x6, y1);
  path.lineTo(lx, ly);
  path.lineTo(rx, ry);
  path.lineTo(rx6, y1);
  path.lineTo(x8, y1);
  path.lineTo(x8, y2);
  path.lineTo(rx5, y2);
  path.lineTo(rx4, y3);
  path.lineTo(x8, y3);
  path.lineTo(x8, y4);
  path.lineTo(rx3, y4);
  path.lineTo(drx, dry);
  path.lineTo(dlx, dly);
  path.lineTo(x3, y4);
  path.lineTo(x1, y4);
  path.lineTo(x1, y3);
  path.lineTo(x4, y3);
  path.lineTo(x5, y2);
  path.lineTo(x1, y2);
  path.closePath();
  return path;
};

const MNE_DEF0 = MATH_NOT_EQUAL_ADJUSTMENTS[0].defaultValue;
const MNE_DEF2 = MATH_NOT_EQUAL_ADJUSTMENTS[2].defaultValue;
const mneClamp = (i: number, v: number) =>
  clamp(
    v,
    MATH_NOT_EQUAL_ADJUSTMENTS[i].min,
    MATH_NOT_EQUAL_ADJUSTMENTS[i].max,
  );

/**
 * Three handles:
 *  [0] bar thickness — diamond on the upper bar's outer (top) edge at
 *      (hc, y1). Dragging up thickens both bars.
 *  [1] slash angle   — polar handle swept around the centre; reuses the
 *      shared `angularHandle` factory (raw 60000ths storage).
 *  [2] gap           — diamond on the upper bar's inner (bottom) edge at
 *      (hc, y2). Dragging up widens the gap, clamped to maxAdj3.
 */
export const MATH_NOT_EQUAL_HANDLES: readonly AdjustmentHandle[] = [
  {
    position: ({ w, h }, adjustments) => {
      const a1 = clamp(adjustments[0] ?? MNE_DEF0, 0, 50000);
      const a3 = adjustments[2] ?? MNE_DEF2;
      const dy1 = (h * a1) / 100000;
      const dy2 = (h * a3) / 200000;
      return { x: w / 2, y: insetAlongAxis(h / 2 - dy2 - dy1, h) };
    },
    apply: ({ h }, start, pointer) => {
      const a3 = start[2] ?? MNE_DEF2;
      const dy2 = (h * a3) / 200000;
      const y = clamp(pointer.y, 0, h);
      const dy1 = Math.max(0, h / 2 - dy2 - y);
      const raw = h > 0 ? Math.round((dy1 / h) * 100000) : 0;
      const result = [...start];
      result[0] = mneClamp(0, raw);
      return result;
    },
  },
  angularHandle({
    center: ({ w, h }) => ({ x: w / 2, y: h / 2 }),
    radius: ({ w, h }) => ({ rx: w / 2, ry: h / 2 }),
    index: 1,
    spec: MATH_NOT_EQUAL_ADJUSTMENTS[1],
  }),
  {
    position: ({ w, h }, adjustments) => {
      const a3 = adjustments[2] ?? MNE_DEF2;
      const dy2 = (h * a3) / 200000;
      return { x: w / 2, y: insetAlongAxis(h / 2 - dy2, h) };
    },
    apply: ({ h }, start, pointer) => {
      const y = clamp(pointer.y, 0, h);
      const dy2 = Math.max(0, h / 2 - y);
      const raw = h > 0 ? Math.round((dy2 / h) * 200000) : 0;
      const a1 = clamp(start[0] ?? MNE_DEF0, 0, 50000);
      const maxAdj3 = 100000 - 2 * a1;
      const result = [...start];
      result[2] = clamp(raw, MATH_NOT_EQUAL_ADJUSTMENTS[2].min, maxAdj3);
      return result;
    },
  },
];
