import type { PathBuilder, AdjustmentSpec, AdjustmentHandle } from '../builder';
import { adj } from '../builder';
import { insetAlongAxis } from '../handles';

/**
 * `mathNotEqual` — `≠` glyph: two parallel horizontal bars with a
 * diagonal slash through them, traced as a single 20-vertex union
 * polygon matching the ECMA-376 `mathNotEqual` preset.
 *
 * Adjustments (`MATH_NOT_EQUAL_ADJUSTMENTS`):
 *   [0] barThickness — OOXML `adj1`, thousandths of `h`. Default 23520.
 *   [1] gap          — OOXML `adj3`, thousandths of `h`, between the
 *                      inner edges of the two bars. Default 11760.
 *   [2] slashAngle   — OOXML `adj2` `crAng`, 60000ths of a degree (the
 *                      angle of the slash). Default 6600000 (= 110°),
 *                      range [4200000, 6600000] (70°–110°).
 *
 * NOTE: the ECMA-376 preset's `adj2` is the slash ANGLE `crAng` (default
 * 6600000 = 110°), and the slash THICKNESS is derived from the bar
 * thickness (`dy1`) — it is not a free adjustment. The previous
 * implementation wrongly exposed `adj[2]` as a "slash thickness"
 * (default 6600) and hard-coded the slash to −45°. The slash now tilts
 * per the angle adjustment and the bars span only the inner 73.49% of
 * the width (`dx1 = w * 73490/200000`).
 *
 * Geometry is a direct port of the preset's `gdLst`/`pathLst` (origin =
 * frame top-left, y DOWN). A single union polygon is traced so the
 * slash/bar overlap edges are not stroked.
 */
export const MATH_NOT_EQUAL_ADJUSTMENTS: readonly AdjustmentSpec[] = [
  { name: 'Bar thickness', defaultValue: 23520, min: 0, max: 50000 },
  { name: 'Gap', defaultValue: 11760, min: 0, max: 50000 },
  {
    // OOXML `crAng`, 60000ths of a degree. Range 70°–110°.
    name: 'Slash angle',
    defaultValue: 6600000,
    min: 4200000,
    max: 6600000,
  },
];

export const buildMathNotEqual: PathBuilder = ({ w, h }, adjustments) => {
  const a1 = Math.max(0, Math.min(adj(adjustments, 0, 23520), 50000));
  const crAng = Math.max(
    4200000,
    Math.min(adj(adjustments, 2, 6600000), 6600000),
  );
  const maxAdj3 = 100000 - 2 * a1;
  const a3 = Math.max(0, Math.min(adj(adjustments, 1, 11760), maxAdj3));

  const hc = w / 2;
  const vc = h / 2;
  const hd2 = h / 2;

  const dy1 = (h * a1) / 100000; // bar thickness (full)
  const dy2 = (h * a3) / 200000; // half gap
  const dx1 = (w * 73490) / 200000; // half bar-width (73.49% of w)

  const x1 = hc - dx1;
  const x8 = hc + dx1;

  const y2 = vc - dy2;
  const y3 = vc + dy2;
  const y1 = y2 - dy1;
  const y4 = y3 + dy1;

  // Slash geometry. `crAng` is measured such that `cadj2 = crAng - 90°`
  // is the slant; `xadj2 = hd2 * tan(cadj2)` is the horizontal run of
  // the slash centre-line over a half-height. `len = hypot(xadj2, hd2)`.
  const cadj2 = (crAng - 5400000) / 60000; // degrees
  const cadj2Rad = (cadj2 * Math.PI) / 180;
  const xadj2 = hd2 * Math.tan(cadj2Rad);
  const len = Math.hypot(xadj2, hd2);

  const bhw = (len * dy1) / hd2; // slash width measured along x
  const bhw2 = bhw / 2;
  const x7 = hc + xadj2 + bhw2;

  const x6 = x7 - (xadj2 * y1) / hd2;
  const x5 = x7 - (xadj2 * y2) / hd2;
  const x4 = x7 - (xadj2 * y3) / hd2;
  const x3 = x7 - (xadj2 * y4) / hd2;

  const rx6 = x6 + bhw;
  const rx5 = x5 + bhw;
  const rx4 = x4 + bhw;
  const rx3 = x3 + bhw;
  const rx7 = x7 + bhw;

  const dx7 = (dy1 * hd2) / len;
  const rxt = x7 + dx7;
  const lxt = rx7 - dx7;
  // `?: cadj2 a b` → cadj2 > 0 ? a : b.
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

// Three handles:
//  [0] bar thickness → top of upper bar (hc, y1 = vc - gap/2 - bar)
//  [1] gap           → bottom of upper bar (hc, y2 = vc - gap/2)
//  [2] slash angle   → the slash's upper-left tip (lx, ly), which
//      traces along the top edge as `crAng` changes.
const MNE_DEF0 = MATH_NOT_EQUAL_ADJUSTMENTS[0].defaultValue;
const MNE_DEF1 = MATH_NOT_EQUAL_ADJUSTMENTS[1].defaultValue;
const MNE_DEF2 = MATH_NOT_EQUAL_ADJUSTMENTS[2].defaultValue;
const mneClamp = (i: number, v: number) =>
  Math.max(
    MATH_NOT_EQUAL_ADJUSTMENTS[i].min,
    Math.min(MATH_NOT_EQUAL_ADJUSTMENTS[i].max, v),
  );

/** Upper-left slash tip (lx, ly) for the given angle adjustment. */
function slashTopTip(
  w: number,
  h: number,
  a1: number,
  crAngRaw: number,
): { x: number; y: number } {
  const crAng = Math.max(4200000, Math.min(crAngRaw, 6600000));
  const hd2 = h / 2;
  const dy1 = (h * a1) / 100000;
  const cadj2 = (crAng - 5400000) / 60000;
  const xadj2 = hd2 * Math.tan((cadj2 * Math.PI) / 180);
  const len = Math.hypot(xadj2, hd2);
  const bhw = (len * dy1) / hd2;
  const x7 = w / 2 + xadj2 + bhw / 2;
  const rx7 = x7 + bhw;
  const dx7 = (dy1 * hd2) / len;
  const lxt = rx7 - dx7;
  const dy4 = -(dy1 * xadj2) / len;
  const lx = cadj2 > 0 ? x7 : lxt;
  const ly = cadj2 > 0 ? 0 : dy4;
  return { x: lx, y: ly };
}

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
      const a1 = adjustments[0] ?? MNE_DEF0;
      const crAng = adjustments[2] ?? MNE_DEF2;
      const tip = slashTopTip(w, h, a1, crAng);
      return {
        x: insetAlongAxis(tip.x, w),
        y: insetAlongAxis(tip.y, h),
      };
    },
    apply: ({ w, h }, start, pointer) => {
      // The slash centre-line passes through frame centre at angle
      // `crAng` from horizontal. Recover the angle from the pointer
      // relative to the centre: the slash tilt `cadj2 = crAng - 90°`
      // satisfies `tan(cadj2) = dx / -dy` for a point above centre.
      const dx = pointer.x - w / 2;
      const dy = pointer.y - h / 2;
      // angle of the centre-line measured from vertical (upward).
      const cadj2Deg = (Math.atan2(dx, -dy) * 180) / Math.PI;
      const crAng = Math.round(cadj2Deg * 60000 + 5400000);
      const result = [...start];
      result[2] = mneClamp(2, crAng);
      return result;
    },
  },
];
