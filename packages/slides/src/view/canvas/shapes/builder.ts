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
