import type { PathBuilder, AdjustmentSpec, AdjustmentHandle } from '../builder';
import { adj } from '../builder';
import { buildCloud } from '../basic/cloud';
import { pointTailHandle } from './handles';

/**
 * `cloudCallout` — cloud silhouette plus three small "thought-bubble"
 * connector circles trailing toward (tx, ty).
 *
 * Adjustments (`CLOUD_CALLOUT_ADJUSTMENTS`):
 *   [0] tailX — OOXML thousandths of `w`, from frame centre. Default
 *               -20833.
 *   [1] tailY — OOXML thousandths of `h`, from frame centre. Default
 *               62500.
 *
 * Per ECMA-376 the callout trails THREE thought-bubbles of decreasing
 * radius marching from the cloud body all the way to the tip
 * (xPos, yPos): the largest bubble nearest the cloud, then a middle
 * one, then the smallest at the tip. The OOXML radii are
 * `g13 ≈ (gap/3) + ss·1800/21600` (largest), `ss·1200/21600` (middle),
 * and `ss·600/21600` (smallest). The cloud body itself is delegated to
 * `buildCloud` and composed via `Path2D.addPath`; the connector
 * circles are appended as additional sub-paths.
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
  // Three "thought bubble" circles of decreasing radius marching from
  // the cloud body out to the tip (tx, ty), per ECMA-376. Bubbles are
  // centred on the cloud-centre → tip line at increasing fractions of
  // its length, with the smallest bubble landing on the tip.
  const cx = w / 2;
  const cy = h / 2;
  const dx = tx - cx;
  const dy = ty - cy;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len;
  const uy = dy / len;
  const ss = Math.min(w, h);
  const bubbleAt = (t: number, r: number): { x: number; y: number; r: number } => ({
    x: cx + ux * len * t,
    y: cy + uy * len * t,
    r,
  });
  // OOXML-aligned radii: largest near the cloud, smallest at the tip.
  const bubbles = [
    bubbleAt(0.62, ss * 0.07), // largest, nearest cloud
    bubbleAt(0.82, (ss * 1200) / 21600), // middle ≈ 0.0556·ss
    bubbleAt(1.0, (ss * 600) / 21600), // smallest, at the tip
  ];
  for (const b of bubbles) {
    path.moveTo(b.x + b.r, b.y);
    path.arc(b.x, b.y, b.r, 0, Math.PI * 2);
  }
  return path;
};

export const CLOUD_CALLOUT_HANDLES: readonly AdjustmentHandle[] = [
  pointTailHandle(
    CLOUD_CALLOUT_ADJUSTMENTS[0],
    CLOUD_CALLOUT_ADJUSTMENTS[1],
  ),
];
