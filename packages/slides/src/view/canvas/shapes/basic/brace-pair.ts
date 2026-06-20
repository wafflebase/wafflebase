// packages/slides/src/view/canvas/shapes/basic/brace-pair.ts
import type { PathBuilder, AdjustmentSpec, AdjustmentHandle } from '../builder';
import { adj } from '../builder';
import { insetAlongAxis } from '../handles';

/**
 * `bracePair` — a matched pair of curly braces "{ }". Each brace has a
 * vertical spine inset by the corner radius `r`, rounded top/bottom
 * corners, and a center cusp poking outward to the frame edge. Like
 * brackets it is stroke-only (`OPEN_PATH_KINDS`) — two sub-paths in
 * one Path2D.
 *
 * adj: corner radius as ‰ of min(w, h) — OOXML `x1 = ss * a / 100000`,
 * `a = pin 0 adj 25000`. Default 8333 → 8.33% of min(w, h).
 */
export const BRACE_PAIR_ADJUSTMENTS: readonly AdjustmentSpec[] = [
  { name: 'Corner radius', defaultValue: 8333, min: 0, max: 25000 },
];

export const DEF_BRACE_PAIR_RADIUS = 8333;

export function bracePairRadius(
  { w, h }: { w: number; h: number },
  adjustments?: number[],
): number {
  const a = Math.max(0, Math.min(25000, adj(adjustments, 0, DEF_BRACE_PAIR_RADIUS)));
  const ss = Math.min(w, h);
  // The cusp needs `r` above and below center (so `r <= h/4`), and the
  // two braces need `2r` each without overlapping (so `r <= w/4`).
  return Math.min((ss * a) / 100000, w / 4, h / 4);
}

export const buildBracePair: PathBuilder = (size, adjustments) => {
  const { w, h } = size;
  const r = bracePairRadius(size, adjustments);
  const mid = h / 2;
  const path = new Path2D();
  // Left brace "{" — spine at x = r, cusp pokes left to x = 0.
  path.moveTo(2 * r, 0);
  path.quadraticCurveTo(r, 0, r, r);
  path.lineTo(r, mid - r);
  path.quadraticCurveTo(r, mid, 0, mid);
  path.quadraticCurveTo(r, mid, r, mid + r);
  path.lineTo(r, h - r);
  path.quadraticCurveTo(r, h, 2 * r, h);
  // Right brace "}" — mirror about x = w.
  path.moveTo(w - 2 * r, 0);
  path.quadraticCurveTo(w - r, 0, w - r, r);
  path.lineTo(w - r, mid - r);
  path.quadraticCurveTo(w - r, mid, w, mid);
  path.quadraticCurveTo(w - r, mid, w - r, mid + r);
  path.lineTo(w - r, h - r);
  path.quadraticCurveTo(w - r, h, w - 2 * r, h);
  return path;
};

export const BRACE_PAIR_HANDLES: readonly AdjustmentHandle[] = [
  {
    position: (size, adjustments) => {
      const r = bracePairRadius(size, adjustments);
      return { x: insetAlongAxis(0, size.w), y: insetAlongAxis(r, size.h) };
    },
    apply: ({ w, h }, _start, pointer) => {
      const ss = Math.min(w, h);
      // The radius (and thus the diamond) tops out at ss/4 (a = 25000),
      // so map the drag over [0, ss/4] — clamping to ss/2 here would
      // leave the upper half of the travel as a dead zone.
      const y = Math.max(0, Math.min(ss / 4, pointer.y));
      const raw = ss > 0 ? Math.round((y / (ss / 4)) * 25000) : DEF_BRACE_PAIR_RADIUS;
      return [Math.max(0, Math.min(25000, raw))];
    },
  },
];
