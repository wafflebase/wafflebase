import type { PathBuilder, AdjustmentSpec } from '../builder';
import { adj } from '../builder';
import { buildCloud } from '../basic/cloud';

/**
 * `cloudCallout` — cloud silhouette plus two small "thought-bubble"
 * connector circles trailing toward (tx, ty).
 *
 * Adjustments (`CLOUD_CALLOUT_ADJUSTMENTS`):
 *   [0] tailX — OOXML thousandths of `w`, from frame centre. Default
 *               -20833.
 *   [1] tailY — OOXML thousandths of `h`, from frame centre. Default
 *               62500.
 *
 * The cloud body itself is delegated to `buildCloud` and composed via
 * `Path2D.addPath`; the two connector circles are appended as
 * additional sub-paths.
 */
export const CLOUD_CALLOUT_ADJUSTMENTS: readonly AdjustmentSpec[] = [
  { name: 'Tail x', defaultValue: -20833, min: -100000, max: 100000 },
  { name: 'Tail y', defaultValue: 62500, min: -100000, max: 100000 },
];

export const buildCloudCallout: PathBuilder = ({ w, h }, adjustments) => {
  const tx = w / 2 + (adj(adjustments, 0, -20833) / 100000) * w;
  const ty = h / 2 + (adj(adjustments, 1, 62500) / 100000) * h;
  const path = new Path2D();
  // Compose with the basic cloud builder.
  const cloud = buildCloud({ w, h });
  path.addPath(cloud);
  // Two small "thought bubble" circles between cloud edge and (tx, ty).
  const cx = w / 2;
  const cy = h / 2;
  const dx = tx - cx;
  const dy = ty - cy;
  const len = Math.hypot(dx, dy);
  const ux = dx / len;
  const uy = dy / len;
  const small1 = {
    x: cx + ux * len * 0.65,
    y: cy + uy * len * 0.65,
    r: Math.min(w, h) * 0.07,
  };
  const small2 = {
    x: cx + ux * len * 0.85,
    y: cy + uy * len * 0.85,
    r: Math.min(w, h) * 0.04,
  };
  path.moveTo(small1.x + small1.r, small1.y);
  path.arc(small1.x, small1.y, small1.r, 0, Math.PI * 2);
  path.moveTo(small2.x + small2.r, small2.y);
  path.arc(small2.x, small2.y, small2.r, 0, Math.PI * 2);
  return path;
};
