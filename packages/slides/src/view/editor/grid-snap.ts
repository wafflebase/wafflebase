import type { Frame } from '../../model/element';
import type { ResizeHandle } from './interactions/resize';

/**
 * Grid quantization for hosts that place elements on a lattice.
 *
 * A slide has no grid, so nothing here is reachable from a slides mount:
 * every entry point is gated on a step supplied by the host through
 * `SlidesEditorOptions.getSnapGrid`. The board passes its *visible* grid
 * step (`gridStep(zoom)` in `app/board/board-grid.ts`), so a user always
 * lands on a line they can see.
 *
 * Unlike the edge/guide snapping in `./snap`, this has no threshold — it
 * rounds. The nearest grid line is never further than half a step away,
 * so a threshold in the same 8-unit band the edge snapper uses would
 * leave the feature inert whenever the step grew past it (at zoom 0.25
 * the board's step is 100 world units, so it would engage 16% of the
 * time). "Snap to grid" that only sometimes snaps is worse than none.
 */

/** Smallest size a quantized edge may leave behind. Mirrors `resizeFrame`. */
const MIN_SIZE = 1;

/** Nearest multiple of `step`. */
export function snapToGrid(value: number, step: number): number {
  return Math.round(value / step) * step;
}

/**
 * Round the edges a resize handle moves onto the grid, leaving the anchor
 * edge exactly where it is — the same contract `resizeFrame` follows, so
 * the element does not shift out from under the handle the user is
 * holding.
 *
 * Returns `frame` unchanged when:
 *
 * - **The frame is rotated.** `frame.x/y/w/h` describe the pre-rotation
 *   box, so its edges are not the edges on screen. Rounding them would
 *   move the visible shape to a position that lines up with nothing.
 *   Rotated elements still grid-snap on *move*, where x/y is the
 *   axis-aligned position being dragged.
 * - **Rounding would collapse an axis** (to below {@link MIN_SIZE}).
 *   Dragging a shape down to a sliver is a legitimate gesture; silently
 *   inverting or zeroing it is not. Each axis is judged on its own.
 */
export function quantizeResizeFrame(
  frame: Frame,
  handle: ResizeHandle,
  step: number,
): Frame {
  if (frame.rotation !== 0) return frame;

  let { x, y, w, h } = frame;

  if (handle === 'w' || handle === 'nw' || handle === 'sw') {
    const right = x + w;
    const left = snapToGrid(x, step);
    if (right - left >= MIN_SIZE) {
      x = left;
      w = right - left;
    }
  } else if (handle === 'e' || handle === 'ne' || handle === 'se') {
    const right = snapToGrid(x + w, step);
    if (right - x >= MIN_SIZE) w = right - x;
  }

  if (handle === 'n' || handle === 'nw' || handle === 'ne') {
    const bottom = y + h;
    const top = snapToGrid(y, step);
    if (bottom - top >= MIN_SIZE) {
      y = top;
      h = bottom - top;
    }
  } else if (handle === 's' || handle === 'sw' || handle === 'se') {
    const bottom = snapToGrid(y + h, step);
    if (bottom - y >= MIN_SIZE) h = bottom - y;
  }

  return { ...frame, x, y, w, h };
}
