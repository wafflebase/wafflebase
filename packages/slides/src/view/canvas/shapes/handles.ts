// packages/slides/src/view/canvas/shapes/handles.ts
//
// Cross-family adjustment-handle factories. Per-family handles (e.g.
// `stars/handles.ts`) sit next to their shapes; factories shared
// across families live here.
import type {
  AdjustmentHandle,
  AdjustmentSpec,
  FrameSize,
  Point,
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
/**
 * Angular drag handle — diamond traces a circle / ellipse around a
 * pivot as the underlying angle adjustment changes.
 *
 * Used by every arc-based P3-B shape: `pie`, `arc`, `chord`,
 * `blockArc`, `circularArrow`, `uturnArrow`, `bentArrow`,
 * `bentUpArrow`, and the four `curved*Arrow` shapes.
 *
 * Storage: OOXML 60000ths of a degree (`60000 ⇒ 1°`, `21600000 ⇒
 * 360°`). The factory reads / writes the raw OOXML unit; conversion
 * to radians is done internally for `position` and `apply`.
 *
 * Winding disambiguation: `atan2` returns `(−180°, 180°]` but the
 * underlying adjustment may sit at any degree value within the
 * spec's `[min, max]`. On drag we unwrap the atan2 result by ±360°
 * to land on the angle nearest `startAdjustments[index]`, so
 * dragging across the 0°/360° boundary doesn't snap to the opposite
 * side of the circle.
 *
 * Inset guard: the painted position is clamped axis-wise via
 * `insetAlongAxis`, matching the precedent for linear factories.
 * Callers should choose a `radius` that keeps the diamond inside
 * the inset envelope at every angle (typically
 * `min(w, h) / 2 - 12` or smaller); the inset is a defensive net
 * for degenerate frames.
 */
export function angularHandle(opts: {
  /** Pivot point. Usually `frame center` but a few shapes (cloud
   *  callout tails, scroll banners) pivot off-centre. */
  center: (frame: FrameSize) => Point;
  /** Radii of the circle / ellipse the diamond traces. */
  radius: (frame: FrameSize) => { rx: number; ry: number };
  /** Adjustment index this handle writes. Other indices pass through
   *  from `startAdjustments` per the `AdjustmentHandle` contract. */
  index: number;
  /** Matching `ADJUSTMENT_SPECS` entry; `min` / `max` in OOXML
   *  60000ths. */
  spec: AdjustmentSpec;
}): AdjustmentHandle {
  const { center, radius, index, spec } = opts;
  return {
    position: (frame, adjustments) => {
      const c = center(frame);
      const { rx, ry } = radius(frame);
      const ooxml = adjustments[index] ?? spec.defaultValue;
      const theta = (ooxml / 60000) * (Math.PI / 180);
      return {
        x: insetAlongAxis(c.x + rx * Math.cos(theta), frame.w),
        y: insetAlongAxis(c.y + ry * Math.sin(theta), frame.h),
      };
    },
    apply: (frame, start, pointer) => {
      const c = center(frame);
      const dx = pointer.x - c.x;
      const dy = pointer.y - c.y;
      let degrees = (Math.atan2(dy, dx) * 180) / Math.PI;
      const startDegrees = (start[index] ?? spec.defaultValue) / 60000;
      // Unwrap so the chosen branch is within 180° of the start
      // angle. Handles drags across the 0°/360° (or any 360°k)
      // boundary without snapping to the opposite side.
      while (degrees - startDegrees > 180) degrees -= 360;
      while (degrees - startDegrees < -180) degrees += 360;
      const ooxml = Math.round(degrees * 60000);
      const clamped = Math.max(spec.min, Math.min(spec.max, ooxml));
      const result = [...start];
      result[index] = clamped;
      return result;
    },
  };
}

/**
 * Mirror of `linearTopEdgeHandle` for adjustments whose visual is
 * "diamond slides along the left edge as the value changes" — e.g.
 * `halfFrame` / `corner` top-arm thickness, or any inner-rectangle
 * vertical inset. Forward maps the adjustment to a y coordinate;
 * inverse maps a pointer y back to the adjustment unit.
 */
export function linearLeftEdgeHandle(opts: {
  forward: (adj: number, frame: FrameSize) => number;
  inverse: (y: number, frame: FrameSize) => number;
  spec: AdjustmentSpec;
  index?: number;
}): AdjustmentHandle {
  const { forward, inverse, spec, index = 0 } = opts;
  return {
    position: (frame, adjustments) => ({
      x: 0,
      y: insetAlongAxis(
        forward(adjustments[index] ?? spec.defaultValue, frame),
        frame.h,
      ),
    }),
    apply: (frame, start, pointer) => {
      const raw = Math.round(inverse(pointer.y, frame));
      const clamped = Math.max(spec.min, Math.min(spec.max, raw));
      const result = [...start];
      result[index] = clamped;
      return result;
    },
  };
}

export function linearTopEdgeHandle(opts: {
  forward: (adj: number, frame: FrameSize) => number;
  inverse: (x: number, frame: FrameSize) => number;
  spec: AdjustmentSpec;
  /**
   * Which adjustment index this handle controls. Defaults to 0 for
   * single-adjustment shapes; multi-adjustment shapes pass the right
   * index (e.g. wedgeRoundRectCallout's corner radius is index 2).
   * Other indices are passed through from `startAdjustments` per the
   * `AdjustmentHandle` contract.
   */
  index?: number;
}): AdjustmentHandle {
  const { forward, inverse, spec, index = 0 } = opts;
  return {
    position: (frame, adjustments) => ({
      x: insetAlongAxis(
        forward(adjustments[index] ?? spec.defaultValue, frame),
        frame.w,
      ),
      y: 0,
    }),
    apply: (frame, start, pointer) => {
      const raw = Math.round(inverse(pointer.x, frame));
      const clamped = Math.max(spec.min, Math.min(spec.max, raw));
      const result = [...start];
      result[index] = clamped;
      return result;
    },
  };
}
