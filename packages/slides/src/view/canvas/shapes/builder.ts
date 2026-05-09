// packages/slides/src/view/canvas/shapes/builder.ts

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
