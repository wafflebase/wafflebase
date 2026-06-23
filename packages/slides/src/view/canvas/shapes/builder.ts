// packages/slides/src/view/canvas/shapes/builder.ts

import type { Point } from '../../../model/frame';

export type { Point };
export type FrameSize = { w: number; h: number };

/**
 * Pure path geometry. Given a frame size and the optional OOXML-style
 * adjustments array, return a closed Path2D in element-local
 * coordinates (top-left at 0,0). Path builders MUST NOT touch
 * fillStyle/strokeStyle — the dispatcher handles theme colour.
 */
export type PathBuilder = (
  size: FrameSize,
  adjustments?: number[],
) => Path2D;

/**
 * One filled face of a multi-fill (3D-look / folded) shape. `path` is a
 * closed Path2D in element-local coordinates; `shade` is a signed
 * luminance delta applied to the shape's resolved fill color before
 * painting this face — positive lightens (toward white), negative
 * darkens (toward black), `0`/absent paints the base fill. This is how
 * OOXML `<a:lumMod>`/`<a:lumOff>` 3D faces (cube/bevel/ribbon/scroll) are
 * approximated within a single solid fill color.
 *
 * Faces are painted in array order (back-to-front), so later faces draw
 * over earlier ones where they overlap.
 */
export type ShapeFace = {
  path: Path2D;
  shade?: number;
};

/**
 * Optional companion to a `PathBuilder` for shapes that paint several
 * differently-shaded faces (raised bevel, folded ribbon, scroll curl).
 * The shape STILL registers a `PathBuilder` returning the union
 * silhouette (used for hit-test, icon, snapshot, and export); the
 * `FaceBuilder` only drives the multi-fill paint at render time.
 */
export type FaceBuilder = (
  size: FrameSize,
  adjustments?: number[],
) => ShapeFace[];

/**
 * Per-shape declaration of an adjustable parameter. Read by Phase 2's
 * toolbar UI to build numeric inputs; Phase 1 only uses `defaultValue`.
 *
 * Units follow OOXML's "thousandths" convention (e.g. 25000 means 25%
 * of the relevant dimension); the per-shape file documents what
 * dimension each index refers to.
 */
export type AdjustmentSpec = {
  name: string;
  defaultValue: number;
  min: number;
  max: number;
  format?: (value: number) => string;
  /**
   * Optional short label for the multi-axis drag tooltip
   * ("x: 75% / y: 100%"). When absent the tooltip falls back to the
   * last whitespace-delimited word of `name` (e.g. "Tail x" → "x").
   * Populate this when the heuristic would collide — e.g. mathNotEqual's
   * "Bar thickness" and "Slash thickness" both end in "thickness" and
   * need explicit labels to stay distinguishable.
   */
  axisLabel?: string;
};

/**
 * Helper for builders that need an indexed adjustment with a default
 * fall-through. Returns `defaultValue` if `adjustments` is undefined
 * or shorter than required.
 */
export function adj(
  adjustments: number[] | undefined,
  index: number,
  defaultValue: number,
): number {
  return adjustments?.[index] ?? defaultValue;
}

/**
 * Vertices of a regular N-gon inscribed in an ellipse. Used by the
 * pentagon builder and star builders. Returned in polygon-walk
 * order (no Path2D), so callers can interleave with a second ring
 * (stars) or close into a Path2D directly (pentagon).
 *
 * @param cx, cy   ellipse centre
 * @param rx, ry   ellipse radii (frame-local, may be unequal)
 * @param points   vertex count (>= 3)
 * @param rotation starting angle in radians; default `-Math.PI / 2`
 *                 (first vertex straight up)
 */
export function regularPolygonPath(
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  points: number,
  rotation: number = -Math.PI / 2,
): { x: number; y: number }[] {
  if (!Number.isInteger(points) || points < 3) {
    throw new RangeError(
      `regularPolygonPath: \`points\` must be an integer >= 3, got ${points}`,
    );
  }
  const verts: { x: number; y: number }[] = [];
  for (let i = 0; i < points; i++) {
    const angle = rotation + (i / points) * Math.PI * 2;
    verts.push({
      x: cx + rx * Math.cos(angle),
      y: cy + ry * Math.sin(angle),
    });
  }
  return verts;
}

/**
 * One drag handle for one (or more) adjustment value(s) on a shape.
 * Both functions work in element-local coordinates — origin = frame
 * top-left, axes = pre-rotation. The editor applies the rotation
 * transform once at paint and inverse-transform once at hit-test.
 */
export type AdjustmentHandle = {
  /** Where to draw the diamond, in element-local coords. */
  position: (frame: FrameSize, adjustments: number[]) => Point;
  /**
   * Drag pointer (element-local) → new full adjustments array.
   * Indices the handle does not control are passed through from
   * `startAdjustments`. Values must be clamped to the matching
   * AdjustmentSpec's `min`/`max`.
   */
  apply: (
    frame: FrameSize,
    startAdjustments: number[],
    pointer: Point,
  ) => number[];
};
