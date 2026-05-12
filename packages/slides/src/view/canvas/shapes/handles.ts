// packages/slides/src/view/canvas/shapes/handles.ts
//
// Cross-family adjustment-handle factories. Per-family handles (e.g.
// `stars/handles.ts`) sit next to their shapes; factories shared
// across families live here.
import type {
  AdjustmentHandle,
  AdjustmentSpec,
  FrameSize,
} from './builder';

const HANDLE_INSET = 8;

/**
 * Clamp `coord` so a handle painted at it stays at least
 * `HANDLE_INSET` away from both ends of an axis of length `dim`.
 * Degenerate dimensions (`dim < 2 * HANDLE_INSET`) return the raw
 * coord rather than producing an inverted clamp.
 *
 * Exposed so per-shape inline handles (e.g. `can`, `donut`) can
 * apply the same corner/edge inset that `linearTopEdgeHandle`
 * applies automatically.
 */
export function insetAlongAxis(coord: number, dim: number): number {
  return dim >= 2 * HANDLE_INSET
    ? Math.min(Math.max(coord, HANDLE_INSET), dim - HANDLE_INSET)
    : coord;
}

/**
 * Linear drag handle that paints on a shape's top edge (`y = 0`).
 *
 * Each shape supplies a `forward(adj, frame) → x` mapping its single
 * adjustment to an element-local x coordinate, and the matching
 * `inverse(x, frame) → adj`. The factory wraps both with the spec's
 * `[min, max]` clamp on commit and an 8px corner inset on paint —
 * the diamond never overlaps a corner resize handle even when the
 * adjustment sits at a boundary value. The data itself still reaches
 * the boundary; only the painted handle position is clipped.
 *
 * Degenerate frames (`w < 2 * HANDLE_INSET`) skip the inset to avoid
 * an inverted clamp.
 *
 * Use this for any single-axis adjustment whose visual is "diamond
 * slides along the top edge as the value changes" — triangle apex,
 * parallelogram slant, trapezoid inset, hexagon notch, octagon
 * corner cut, plus arm thickness, pentagonArrow point length, and
 * roundRect corner radius all match this pattern.
 */
export function linearTopEdgeHandle(opts: {
  forward: (adj: number, frame: FrameSize) => number;
  inverse: (x: number, frame: FrameSize) => number;
  spec: AdjustmentSpec;
}): AdjustmentHandle {
  const { forward, inverse, spec } = opts;
  return {
    position: (frame, adjustments) => ({
      x: insetAlongAxis(
        forward(adjustments[0] ?? spec.defaultValue, frame),
        frame.w,
      ),
      y: 0,
    }),
    apply: (frame, _start, pointer) => {
      const raw = Math.round(inverse(pointer.x, frame));
      return [Math.max(spec.min, Math.min(spec.max, raw))];
    },
  };
}
