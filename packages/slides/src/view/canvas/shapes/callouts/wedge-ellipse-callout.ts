import type { PathBuilder, AdjustmentSpec, AdjustmentHandle } from '../builder';
import { adj } from '../builder';
import { pointTailHandle } from './handles';
import { arcTo, deg60kToRad, FULL_ANGLE, radToDeg60k } from './ooxml-math';

/**
 * `wedgeEllipseCallout` — elliptical speech bubble with a triangular
 * tail. Faithful port of the ECMA-376 preset.
 *
 * Adjustments (`WEDGE_ELLIPSE_CALLOUT_ADJUSTMENTS`):
 *   [0] adj1 — tail tip x, thousandths of `w` from centre. Default -20833.
 *   [1] adj2 — tail tip y, thousandths of `h` from centre. Default 62500.
 *
 * The tail base spans ±11° (660000 in 60000ths) around the tip direction,
 * measured in the "circle-normalised" space (`sdx = dxPos·h`,
 * `sdy = dyPos·w`) so the base stays angularly symmetric on non-square
 * ellipses. The body is the major arc between the two base points.
 */
export const WEDGE_ELLIPSE_CALLOUT_ADJUSTMENTS: readonly AdjustmentSpec[] = [
  { name: 'Tail x', defaultValue: -20833, min: -100000, max: 100000 },
  { name: 'Tail y', defaultValue: 62500, min: -100000, max: 100000 },
];

const HALF_BASE = deg60kToRad(660000); // ±11°

export const buildWedgeEllipseCallout: PathBuilder = (
  { w, h },
  adjustments,
) => {
  const hc = w / 2;
  const vc = h / 2;
  const wd2 = w / 2;
  const hd2 = h / 2;

  const dxPos = (w * adj(adjustments, 0, -20833)) / 100000;
  const dyPos = (h * adj(adjustments, 1, 62500)) / 100000;
  const xPos = hc + dxPos;
  const yPos = vc + dyPos;

  // Angle to the tip in circle-normalised space, then the two tail-base
  // directions ±11° from it. `stAng`/`enAng` are the PARAMETRIC angles of
  // the two base points on the ellipse — the base point (x1,y1) is exactly
  // the parametric point (wd2·cos stAng, hd2·sin stAng), so the arc must be
  // swept with these same parametric angles. (Deriving the start from
  // atan2(dy1,dx1) would be the polar angle, drifting the arc centre off
  // the frame centre on non-square ellipses.)
  const pang = Math.atan2(dyPos * w, dxPos * h);
  const stAng = pang + HALF_BASE;
  const enAng = pang - HALF_BASE;
  const x1 = hc + wd2 * Math.cos(stAng);
  const y1 = vc + hd2 * Math.sin(stAng);

  // Body arc swept the long way round so the ±11° tail notch is the gap.
  const stAng60 = radToDeg60k(stAng);
  const swAng1 = radToDeg60k(enAng) - stAng60;
  const swAng = swAng1 > 0 ? swAng1 : swAng1 + FULL_ANGLE;

  const path = new Path2D();
  path.moveTo(xPos, yPos);
  path.lineTo(x1, y1);
  arcTo(path, { x: x1, y: y1 }, wd2, hd2, stAng60, swAng);
  path.closePath();
  return path;
};

export const WEDGE_ELLIPSE_CALLOUT_HANDLES: readonly AdjustmentHandle[] = [
  pointTailHandle(
    WEDGE_ELLIPSE_CALLOUT_ADJUSTMENTS[0],
    WEDGE_ELLIPSE_CALLOUT_ADJUSTMENTS[1],
  ),
];
