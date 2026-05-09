import type { PathBuilder, AdjustmentSpec } from '../builder';
import { adj } from '../builder';

/**
 * `quadArrow` — four-headed arrow.
 *
 * Adjustments (`QUAD_ARROW_ADJUSTMENTS`):
 *   [0] headLen        — OOXML thousandths of `min(w,h)`; default 22500.
 *   [1] headWidth      — OOXML thousandths of `min(w,h)`; default 22500.
 *   [2] shaftThickness — OOXML thousandths of `min(w,h)`; default 22500.
 */
export const QUAD_ARROW_ADJUSTMENTS: readonly AdjustmentSpec[] = [
  { name: 'Head length', defaultValue: 22500, min: 0, max: 50000 },
  { name: 'Head width', defaultValue: 22500, min: 0, max: 50000 },
  { name: 'Shaft thickness', defaultValue: 22500, min: 0, max: 50000 },
];

export const buildQuadArrow: PathBuilder = ({ w, h }, adjustments) => {
  const dim = Math.min(w, h);
  const head = (adj(adjustments, 0, 22500) / 100000) * dim;
  const headHalf = (adj(adjustments, 1, 22500) / 100000) * dim;
  const shaft = (adj(adjustments, 2, 22500) / 100000) * dim;
  const cx = w / 2;
  const cy = h / 2;
  const path = new Path2D();
  // Walk: top, right, bottom, left (each direction = 5 lineTo).
  path.moveTo(cx, 0);
  path.lineTo(cx + headHalf, head);
  path.lineTo(cx + shaft, head);
  path.lineTo(cx + shaft, cy - shaft);
  path.lineTo(w - head, cy - shaft);
  path.lineTo(w - head, cy - headHalf);
  path.lineTo(w, cy);
  path.lineTo(w - head, cy + headHalf);
  path.lineTo(w - head, cy + shaft);
  path.lineTo(cx + shaft, cy + shaft);
  path.lineTo(cx + shaft, h - head);
  path.lineTo(cx + headHalf, h - head);
  path.lineTo(cx, h);
  path.lineTo(cx - headHalf, h - head);
  path.lineTo(cx - shaft, h - head);
  path.lineTo(cx - shaft, cy + shaft);
  path.lineTo(head, cy + shaft);
  path.lineTo(head, cy + headHalf);
  path.lineTo(0, cy);
  path.lineTo(head, cy - headHalf);
  path.lineTo(head, cy - shaft);
  path.lineTo(cx - shaft, cy - shaft);
  path.lineTo(cx - shaft, head);
  path.lineTo(cx - headHalf, head);
  path.closePath();
  return path;
};
