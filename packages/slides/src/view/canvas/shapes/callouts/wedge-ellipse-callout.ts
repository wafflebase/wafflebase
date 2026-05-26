import type { PathBuilder, AdjustmentSpec, AdjustmentHandle } from '../builder';
import { adj } from '../builder';
import { pointTailHandle } from './handles';

/**
 * `wedgeEllipseCallout` — elliptical speech bubble with a triangular
 * tail. The body is a single `ellipse()` op; the tail is a separate
 * triangular sub-path that connects two points on the ellipse to the
 * tail tip.
 *
 * Adjustments (`WEDGE_ELLIPSE_CALLOUT_ADJUSTMENTS`):
 *   [0] tailX — OOXML thousandths of `w`, from frame centre. Default
 *               -20833.
 *   [1] tailY — OOXML thousandths of `h`, from frame centre. Default
 *               62500.
 */
export const WEDGE_ELLIPSE_CALLOUT_ADJUSTMENTS: readonly AdjustmentSpec[] = [
  { name: 'Tail x', defaultValue: -20833, min: -100000, max: 100000 },
  { name: 'Tail y', defaultValue: 62500, min: -100000, max: 100000 },
];

export const buildWedgeEllipseCallout: PathBuilder = ({ w, h }, adjustments) => {
  const tx = w / 2 + (adj(adjustments, 0, -20833) / 100000) * w;
  const ty = h / 2 + (adj(adjustments, 1, 62500) / 100000) * h;
  const cx = w / 2;
  const cy = h / 2;
  const rx = w / 2;
  const ry = h / 2;
  const path = new Path2D();
  path.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
  // Triangle tail from two points on the ellipse to (tx, ty).
  const angle = Math.atan2(ty - cy, tx - cx);
  const baseSpread = 0.25; // radians
  const a1 = angle - baseSpread;
  const a2 = angle + baseSpread;
  const p1 = { x: cx + rx * Math.cos(a1), y: cy + ry * Math.sin(a1) };
  const p2 = { x: cx + rx * Math.cos(a2), y: cy + ry * Math.sin(a2) };
  path.moveTo(p1.x, p1.y);
  path.lineTo(tx, ty);
  path.lineTo(p2.x, p2.y);
  path.closePath();
  return path;
};

export const WEDGE_ELLIPSE_CALLOUT_HANDLES: readonly AdjustmentHandle[] = [
  pointTailHandle(
    WEDGE_ELLIPSE_CALLOUT_ADJUSTMENTS[0],
    WEDGE_ELLIPSE_CALLOUT_ADJUSTMENTS[1],
  ),
];
