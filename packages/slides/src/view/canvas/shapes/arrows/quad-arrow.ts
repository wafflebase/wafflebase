import type { PathBuilder, AdjustmentSpec, AdjustmentHandle } from '../builder';
import { adj } from '../builder';
import { insetAlongAxis } from '../handles';

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

// quadArrow handles — three diamonds clustered around the TOP
// arrowhead since that is the closest 4-fold-symmetry axis the user
// will visually associate with each adjustment:
//
//  [0] head length    — at (cx, head)            (drag vertically)
//  [1] head width     — at (cx + headHalf, head) (drag horizontally)
//  [2] shaft thickness — at (cx + shaft, cy)     (drag horizontally)
//
// Defaults make all three adjustments equal (22500), which puts the
// head-width and shaft handles at the same x; the shaft handle uses
// y = cy to keep them visually separable. All three scale by
// min(w,h), matching the path builder.
const QA_MIN = QUAD_ARROW_ADJUSTMENTS[0].min;
const QA_MAX = QUAD_ARROW_ADJUSTMENTS[0].max;
const QA_DEF = QUAD_ARROW_ADJUSTMENTS[0].defaultValue;

export const QUAD_ARROW_HANDLES: readonly AdjustmentHandle[] = [
  {
    position: ({ w, h }, adjustments) => {
      const dim = Math.min(w, h);
      const head = ((adjustments[0] ?? QA_DEF) / 100000) * dim;
      return { x: w / 2, y: insetAlongAxis(head, h) };
    },
    apply: ({ w, h }, start, pointer) => {
      const dim = Math.min(w, h);
      const y = Math.max(0, Math.min(h, pointer.y));
      const raw = dim > 0 ? Math.round((y / dim) * 100000) : 0;
      return [
        Math.max(QA_MIN, Math.min(QA_MAX, raw)),
        start[1] ?? QA_DEF,
        start[2] ?? QA_DEF,
      ];
    },
  },
  {
    position: ({ w, h }, adjustments) => {
      const dim = Math.min(w, h);
      const head = ((adjustments[0] ?? QA_DEF) / 100000) * dim;
      const headHalf = ((adjustments[1] ?? QA_DEF) / 100000) * dim;
      return {
        x: insetAlongAxis(w / 2 + headHalf, w),
        y: insetAlongAxis(head, h),
      };
    },
    apply: ({ w, h }, start, pointer) => {
      const dim = Math.min(w, h);
      const x = Math.max(0, Math.min(w, pointer.x));
      const headHalf = Math.abs(x - w / 2);
      const raw = dim > 0 ? Math.round((headHalf / dim) * 100000) : 0;
      return [
        start[0] ?? QA_DEF,
        Math.max(QA_MIN, Math.min(QA_MAX, raw)),
        start[2] ?? QA_DEF,
      ];
    },
  },
  {
    position: ({ w, h }, adjustments) => {
      const dim = Math.min(w, h);
      const shaft = ((adjustments[2] ?? QA_DEF) / 100000) * dim;
      return { x: insetAlongAxis(w / 2 + shaft, w), y: h / 2 };
    },
    apply: ({ w, h }, start, pointer) => {
      const dim = Math.min(w, h);
      const x = Math.max(0, Math.min(w, pointer.x));
      const shaft = Math.abs(x - w / 2);
      const raw = dim > 0 ? Math.round((shaft / dim) * 100000) : 0;
      return [
        start[0] ?? QA_DEF,
        start[1] ?? QA_DEF,
        Math.max(QA_MIN, Math.min(QA_MAX, raw)),
      ];
    },
  },
];
