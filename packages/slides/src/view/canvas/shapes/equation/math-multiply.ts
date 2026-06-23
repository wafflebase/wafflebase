import type { PathBuilder, AdjustmentHandle } from '../builder';
import { adj } from '../builder';
import { insetAlongAxis } from '../handles';
import { MATH_PLUS_ADJUSTMENTS } from './math-plus';

/**
 * `mathMultiply` — `×` glyph: a single 12-vertex polygon outlining the
 * X, matching the ECMA-376 `mathMultiply` preset.
 *
 * Adjustments — re-uses `MATH_PLUS_ADJUSTMENTS`:
 *   [0] armThickness — OOXML thousandths of `min(w,h)`. Default 23520.
 *
 * Key OOXML detail: the arm direction is `a = at2 w h` (the box
 * diagonal angle), NOT a fixed 45°. The arms therefore align to the
 * actual box corners at any aspect ratio (only coinciding with 45° at
 * a square). The previous implementation hard-coded a 45° rotation,
 * which only matched on square frames and skewed everywhere else.
 *
 * Geometry follows the preset's `gdLst` directly (origin = frame
 * top-left, y DOWN):
 *   th  = ss * a1/100000                  arm thickness
 *   a   = atan2(h, w)                     diagonal angle
 *   dl  = hypot(w, h)                     diagonal length
 *   rw  = dl * 51965/100000               trimmed reach
 *   lM  = dl - rw;  xM = cos*lM/2; yM = sin*lM/2   arm-tip centre offset
 *   dxAM = sin*th/2;  dyAM = cos*th/2     half-thickness offsets ⟂ arm
 * The 12-vertex outline is then assembled from xA/xB/xD/xE/xF/xL and
 * yA/yB/yC/yG/yH/yI exactly as the preset's `pathLst`.
 *
 * Single polygon (not two diagonal rects) so the inner overlap edges
 * are not stroked, avoiding a visible square at the centre.
 */
export const buildMathMultiply: PathBuilder = ({ w, h }, adjustments) => {
  const a1 = Math.max(0, Math.min(adj(adjustments, 0, 23520), 51965));
  const ss = Math.min(w, h);
  const th = (ss * a1) / 100000;
  const hc = w / 2;
  const vc = h / 2;

  const a = Math.atan2(h, w); // at2 w h
  const sa = Math.sin(a);
  const ca = Math.cos(a);
  const ta = Math.tan(a);

  const dl = Math.hypot(w, h); // mod w h 0
  const rw = (dl * 51965) / 100000;
  const lM = dl - rw;
  const xM = (ca * lM) / 2;
  const yM = (sa * lM) / 2;

  const dxAM = (sa * th) / 2;
  const dyAM = (ca * th) / 2;
  const xA = xM - dxAM;
  const yA = yM + dyAM;
  const xB = xM + dxAM;
  const yB = yM - dyAM;

  const xBC = hc - xB;
  const yBC = xBC * ta;
  const yC = yBC + yB;

  const xD = w - xB;
  const xE = w - xA;

  const yFE = vc - yA;
  const xFE = yFE / ta;
  const xF = xE - xFE;
  const xL = xA + xFE;

  const yG = h - yA;
  const yH = h - yB;
  const yI = h - yC;

  const path = new Path2D();
  path.moveTo(xA, yA);
  path.lineTo(xB, yB);
  path.lineTo(hc, yC);
  path.lineTo(xD, yB);
  path.lineTo(xE, yA);
  path.lineTo(xF, vc);
  path.lineTo(xE, yG);
  path.lineTo(xD, yH);
  path.lineTo(hc, yI);
  path.lineTo(xB, yH);
  path.lineTo(xA, yG);
  path.lineTo(xL, vc);
  path.closePath();
  return path;
};

// The arm-thickness handle anchors on the top-left arm's outer corner
// (xA, yA). Forward computes yA from the adjustment; inverse maps a
// pointer back to the thickness fraction of min(w,h).
//   yA = yM + (cos(a) * th)/2,  th = ss * a1/100000
//   ⇒ a1 = (yA - yM) * 2 / cos(a) / ss * 100000
const MM_MIN = MATH_PLUS_ADJUSTMENTS[0].min;
const MM_MAX = MATH_PLUS_ADJUSTMENTS[0].max;
const MM_DEF = MATH_PLUS_ADJUSTMENTS[0].defaultValue;
const armTipCorner = (w: number, h: number, a1: number) => {
  const ss = Math.min(w, h);
  const th = (ss * a1) / 100000;
  const a = Math.atan2(h, w);
  const dl = Math.hypot(w, h);
  const lM = dl - (dl * 51965) / 100000;
  const xM = (Math.cos(a) * lM) / 2;
  const yM = (Math.sin(a) * lM) / 2;
  return {
    x: xM - (Math.sin(a) * th) / 2,
    y: yM + (Math.cos(a) * th) / 2,
    yM,
    ca: Math.cos(a),
    ss,
  };
};
export const MATH_MULTIPLY_HANDLES: readonly AdjustmentHandle[] = [
  {
    position: ({ w, h }, adjustments) => {
      const a1 = adjustments[0] ?? MM_DEF;
      const c = armTipCorner(w, h, a1);
      return { x: insetAlongAxis(c.x, w), y: insetAlongAxis(c.y, h) };
    },
    apply: ({ w, h }, start, pointer) => {
      const y = Math.max(0, Math.min(h, pointer.y));
      const c = armTipCorner(w, h, MM_DEF);
      const th = ((y - c.yM) * 2) / c.ca;
      const raw = c.ss > 0 ? Math.round((th / c.ss) * 100000) : 0;
      const result = [...start];
      result[0] = Math.max(MM_MIN, Math.min(MM_MAX, raw));
      return result;
    },
  },
];
