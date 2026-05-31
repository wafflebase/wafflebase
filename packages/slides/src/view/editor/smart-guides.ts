import type { Frame } from '../../model/element';

/**
 * One side of an arrow span used by the smart-guide overlay. `from` /
 * `to` are world coords on the matched axis; `perpendicular` is the
 * fixed coordinate on the other axis (the row/column the arrow is
 * drawn at).
 */
export type Span = { from: number; to: number; perpendicular: number };

/**
 * Result of detecting an equal-spacing trio, an equal-distance pair,
 * or an equal-size match. Rendered by `overlay.ts` alongside the
 * existing edge / center / user-guide `SnapGuide` set.
 *
 *  - equal-spacing  → two same-axis arrows at the middle element's
 *                     centre, one for each gap.
 *  - equal-distance → two same-axis arrows — the existing pair's gap
 *                     and the new (drag, neighbour) gap.
 *  - equal-size     → a dashed outline around every matched frame.
 */
export type SmartGuide =
  | { kind: 'equal-spacing';  axis: 'x' | 'y'; spans: [Span, Span] }
  | { kind: 'equal-distance'; axis: 'x' | 'y'; spans: [Span, Span] }
  | { kind: 'equal-size';     axis: 'x' | 'y'; matchedFrames: Frame[] };

/**
 * Refine the snap-corrected (`dx`, `dy`) further when the dragged
 * bbox would form an equal-spacing trio or equal-distance pair with
 * `others`. Called AFTER `snapDelta`: any edge/centre/guide snap has
 * already won. Threshold is the same 8 px band the rest of the editor
 * uses.
 *
 * Axes are independent — `x` may match equal-spacing while `y` is
 * untouched.
 *
 * Skeleton implementation returns the input unchanged; subsequent
 * tasks add equal-spacing and equal-distance detection.
 */
export function smartGuides(
  bbox: { x: number; y: number; w: number; h: number },
  dx: number,
  dy: number,
  others: readonly Frame[],
): { dx: number; dy: number; guides: SmartGuide[] } {
  // Reference `bbox` and `others` so TypeScript does not flag them as
  // unused; the next tasks fill in the body.
  void bbox;
  void others;
  return { dx, dy, guides: [] };
}
