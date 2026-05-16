import type { PathBuilder, AdjustmentSpec, AdjustmentHandle } from '../builder';
import { adj } from '../builder';
import { insetAlongAxis } from '../handles';

/**
 * `leftBrace` — "{" shape rendered as an open path. The middle
 * notch points right. Like brackets, fill is skipped by the
 * renderer (`OPEN_PATH_KINDS`) — only stroke paints.
 *
 * Adjustments:
 *   [0] corner radius — OOXML `g1 = ss * adj1 / 100000` (% of
 *       min(w,h)). Default 8333 → 8.33% of min(w,h).
 *   [1] notch y position % of h (default 50000 = middle).
 *
 * The OOXML constraint `maxAdj1 = q2/2` (where `q2` depends on
 * notch position) is enforced at runtime by clamping the radius
 * to leave room for the two corner radii per arm.
 */
export const BRACE_ADJUSTMENTS: readonly AdjustmentSpec[] = [
  { name: 'Corner radius', defaultValue: 8333, min: 0, max: 50000 },
  { name: 'Notch position', defaultValue: 50000, min: 0, max: 100000 },
];

export const DEF_BRACE_RADIUS = 8333;
export const DEF_BRACE_NOTCH = 50000;

export function braceCornerRadius(
  { w, h }: { w: number; h: number },
  a: number,
  notchA: number,
): number {
  const ss = Math.min(w, h);
  // OOXML `maxAdj1 = q2 / 2` where q2 = min(notch, 100000 - notch).
  // That caps `g1` at ss * q2 / 200000. Default notch=50000 → max
  // radius = ss/4 (4 corners share the shorter arm = h/2).
  const q2 = Math.min(notchA, 100000 - notchA);
  const maxAdj = q2 / 2;
  const clampedAdj = Math.max(0, Math.min(maxAdj, a));
  return ss * (clampedAdj / 100000);
}

export const buildLeftBrace: PathBuilder = (size, adjustments) => {
  const { w, h } = size;
  const a0 = adj(adjustments, 0, DEF_BRACE_RADIUS);
  const a1 = adj(adjustments, 1, DEF_BRACE_NOTCH);
  const r = braceCornerRadius(size, a0, a1);
  // Notch y is clamped so the two arms each have room for the
  // top/bottom corner radii.
  const notchY = Math.max(r * 2, Math.min(h - r * 2, h * (a1 / 100000)));
  const path = new Path2D();
  path.moveTo(w, 0);
  path.lineTo(w / 2 + r, 0);
  path.quadraticCurveTo(w / 2, 0, w / 2, r);
  path.lineTo(w / 2, notchY - r);
  path.quadraticCurveTo(w / 2, notchY, w / 2 - r, notchY);
  // Mirror through the notch back to the right inner edge.
  path.quadraticCurveTo(w / 2, notchY, w / 2, notchY + r);
  path.lineTo(w / 2, h - r);
  path.quadraticCurveTo(w / 2, h, w / 2 + r, h);
  path.lineTo(w, h);
  return path;
};

export const LEFT_BRACE_HANDLES: readonly AdjustmentHandle[] = [
  {
    position: (size, adjustments) => {
      const a1 = adjustments[1] ?? DEF_BRACE_NOTCH;
      return {
        x: insetAlongAxis(0, size.w),
        y: insetAlongAxis(size.h * (a1 / 100000), size.h),
      };
    },
    apply: ({ h }, start, pointer) => {
      const y = Math.max(0, Math.min(h, pointer.y));
      const newA1 = h > 0 ? Math.round((y / h) * 100000) : DEF_BRACE_NOTCH;
      return [
        start[0] ?? DEF_BRACE_RADIUS,
        Math.max(0, Math.min(100000, newA1)),
      ];
    },
  },
];
