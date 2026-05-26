import type { PathBuilder, AdjustmentSpec, AdjustmentHandle } from '../builder';
import { adj } from '../builder';
import { insetAlongAxis } from '../handles';

/**
 * `donut` — annulus (ring). Two concentric ellipses, the inner one
 * drawn counter-clockwise so the dispatcher's `evenodd` fill rule
 * punches out the hole.
 *
 * Adjustments:
 *   [0] holeRatio — ring thickness as OOXML thousandths of `min(w,h)`;
 *       default 25000 (25%).
 *
 * Dispatcher contract: `shape-renderer` looks up the kind in
 * `EVENODD_KINDS` and passes `'evenodd'` to `ctx.fill(path, ...)` for
 * donut. Without that, the inner ellipse is drawn but not punched.
 */
export const DONUT_ADJUSTMENTS: readonly AdjustmentSpec[] = [
  { name: 'Hole ratio', defaultValue: 25000, min: 1, max: 50000 },
];

export const buildDonut: PathBuilder = ({ w, h }, adjustments) => {
  const t = (adj(adjustments, 0, 25000) / 100000) * Math.min(w, h);
  const outerRx = w / 2;
  const outerRy = h / 2;
  const innerRx = Math.max(0.5, outerRx - t);
  const innerRy = Math.max(0.5, outerRy - t);
  const path = new Path2D();
  path.ellipse(outerRx, outerRy, outerRx, outerRy, 0, 0, Math.PI * 2);
  // Explicit moveTo before the inner ellipse so Canvas2D doesn't
  // emit an implicit lineTo from the outer ellipse's end point at
  // (w, h/2) to the inner arc's start at (outerRx + innerRx,
  // outerRy) — that line was visible as a horizontal stroke on the
  // right side of the donut in real browsers (the test-canvas
  // shim's ellipse does not replicate this implicit lineTo, so
  // unit tests pass without it).
  path.moveTo(outerRx + innerRx, outerRy);
  // Counter-clockwise inner ellipse. The dispatcher pairs this with
  // `'evenodd'` fill rule to produce the hole.
  path.ellipse(outerRx, outerRy, innerRx, innerRy, 0, 0, Math.PI * 2, true);
  return path;
};

// Handle paints where the inner ring crosses the horizontal centre
// line on the right side: (w - t, h/2). Dragging leftward thickens
// the ring (larger t); rightward thins it. The donut's t is
// subtractive (`innerRx = outerRx - t`), not multiplicative like the
// stars' radial ratio, so the existing radialStarHandle factory in
// stars/handles.ts does not fit; this handle is inlined.
//
// `apply` clamps pointer.x to [0, w] before inverting so dragging
// past the outer ring still maps to the boundary value, matching the
// spec's "data still reaches min/max" contract.
const DONUT_MIN = DONUT_ADJUSTMENTS[0].min;
const DONUT_MAX = DONUT_ADJUSTMENTS[0].max;
export const DONUT_HANDLES: readonly AdjustmentHandle[] = [
  {
    position: ({ w, h }, adjustments) => {
      const t = ((adjustments[0] ?? 25000) / 100000) * Math.min(w, h);
      return { x: insetAlongAxis(w - t, w), y: h / 2 };
    },
    apply: ({ w, h }, _start, pointer) => {
      const x = Math.max(0, Math.min(w, pointer.x));
      const t = w - x;
      const m = Math.min(w, h);
      const raw = m > 0 ? Math.round((t / m) * 100000) : 0;
      return [Math.max(DONUT_MIN, Math.min(DONUT_MAX, raw))];
    },
  },
];
