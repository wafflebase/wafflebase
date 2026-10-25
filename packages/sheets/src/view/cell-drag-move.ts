import { Ref } from '../model/core/types';
import type { DimensionIndex } from '../model/worksheet/dimensions';

/**
 * How far, in CSS pixels, the pointer must travel after pressing the
 * selection border or the fill handle before the press becomes a drag.
 * Below it the gesture is a click.
 */
export const CellDragThreshold = 4;

export type Point = { x: number; y: number };

/**
 * `BoundaryProbe` is the sub-pixel step used to read the index on the near
 * side of a boundary. It is far below any real row height or column width,
 * and far above the float precision of a sheet-space offset.
 */
const BoundaryProbe = 1e-3;

/**
 * `snapToVisible` returns the nearest index with an interior, searching in
 * the direction the pointer is travelling. `findIndex` never answers a
 * zero-size index, so this is only ever reached from the hidden-anchor path
 * below, which counts indices rather than resolving an offset.
 */
function snapToVisible(
  index: number,
  dim: DimensionIndex,
  forward: boolean,
): number {
  if (dim.getSize(index) > 0) {
    return index;
  }

  const offset = dim.getOffset(index);
  if (!forward && offset > BoundaryProbe) {
    return dim.findIndex(offset - BoundaryProbe);
  }
  // The offset of a hidden index is shared by its whole collapsed run, so
  // resolving it answers the first visible index after the run.
  return dim.findIndex(offset);
}

/**
 * `carryAxis` returns where `anchor` lands on one axis once its sheet-space
 * `point` has been carried by `travel`.
 */
function carryAxis(
  anchor: number,
  point: number,
  travel: number,
  dim: DimensionIndex,
): number {
  if (travel === 0) {
    return anchor;
  }
  const forward = travel > 0;

  // A cell with an interior holds its own point, so the point resolves to the
  // anchor and the carried point resolves outright. A hidden (zero-size)
  // anchor has none: its point is a boundary belonging both to the end of the
  // previous visible cell and to the start of the next, and `findIndex`
  // answers the latter. Read the base on the side the pointer is heading for,
  // so the first pixel of travel costs one index in either direction instead
  // of the whole collapsed run — which backwards would have jumped the
  // destination past every hidden cell at once, and for a run reaching the
  // top of the sheet all the way to row 1.
  const base =
    dim.getSize(anchor) > 0
      ? anchor
      : dim.findIndex(forward ? point : point - BoundaryProbe);

  const carried = Math.max(1, anchor + dim.findIndex(point + travel) - base);
  return carried === anchor ? carried : snapToVisible(carried, dim, forward);
}

/**
 * `carryPoint` returns where `anchor` lands once its sheet-space `point` has
 * been carried by `travel` — the distance the pointer has moved since the
 * press, in sheet pixels (CSS travel divided by zoom, plus any scroll since).
 *
 * Drags off the selection border and the fill handle use this instead of the
 * cell under the pointer. Both hit areas straddle the selection's edge, so the
 * press often lands in a neighbouring cell, and in index space that cell can
 * be far away: past rows a filter hid, or across the freeze gap, which maps to
 * the first unscrolled row. Carrying a point of the selection itself keeps the
 * grab offset Excel and Google Sheets keep, and working in sheet space keeps
 * freeze panes out of it. `findIndex` skips zero-height (hidden) rows.
 *
 * The result is the anchor plus however many indices the point crossed, not
 * the index the carried point alone resolves to. The two agree for every cell
 * with an interior, and they are what keeps zero travel at the anchor when it
 * has none: a cell a filter hid resolves to the *next* visible one, which as
 * a bare target would defeat the drop-in-place no-op guard and move the range
 * onto its neighbour before the pointer had moved at all. Counting from a
 * hidden anchor can land on another hidden index, which resolving an offset
 * never does, so any destination other than the anchor itself is snapped back
 * onto a cell that is actually drawn: `moveRangeTo` and `autofill` take the
 * ref as given, and a filter-hidden one would drop the range out of sight.
 */
export function carryPoint(
  anchor: Ref,
  point: Point,
  travel: Point,
  rowDim: DimensionIndex,
  colDim: DimensionIndex,
): Ref {
  return {
    r: carryAxis(anchor.r, point.y, travel.y, rowDim),
    c: carryAxis(anchor.c, point.x, travel.x, colDim),
  };
}

/**
 * `cellCentre` returns the sheet-space centre of a cell, the point a
 * drag-move carries: aiming at the centre keeps it off the gridlines.
 *
 * Half the cell's own size lands inside it however narrow the cell is. A
 * cell a filter hid has no interior at all (`size === 0`), so the point is
 * its offset, which belongs to the next *visible* cell — the one drawn where
 * the user grabbed. `carryPoint` counts from there rather than resolving the
 * point outright, so the drag still starts at the anchor.
 */
export function cellCentre(
  ref: Ref,
  rowDim: DimensionIndex,
  colDim: DimensionIndex,
): Point {
  return {
    x: colDim.getOffset(ref.c) + colDim.getSize(ref.c) / 2,
    y: rowDim.getOffset(ref.r) + rowDim.getSize(ref.r) / 2,
  };
}

/**
 * `cellCornerInset` returns a sheet-space point `inset` pixels inside a
 * cell's bottom-right corner, the point a drag-fill carries. The fill handle
 * sits on that corner and its hit area reaches `inset` past it, so with the
 * hit area's reach as the inset, the target leaves the cell only once the
 * handle has been carried further than anywhere it could have been pressed.
 *
 * The inset is capped at the cell's own size: a boundary column narrower
 * than the handle's reach — or one a filter hid — would otherwise put the
 * point in the *previous* cell, so the fill would read its reach off the
 * wrong cell's edges. A zero-size cell has no interior, so the point is its
 * offset; see `cellCentre`.
 */
export function cellCornerInset(
  ref: Ref,
  inset: number,
  rowDim: DimensionIndex,
  colDim: DimensionIndex,
): Point {
  const width = colDim.getSize(ref.c);
  const height = rowDim.getSize(ref.r);
  return {
    x: colDim.getOffset(ref.c) + width - Math.min(inset, width),
    y: rowDim.getOffset(ref.r) + height - Math.min(inset, height),
  };
}

/**
 * `exceedsCellDragThreshold` reports whether the pointer has travelled
 * far enough from the press to start a drag-move or a drag-fill.
 */
export function exceedsCellDragThreshold(
  startX: number,
  startY: number,
  x: number,
  y: number,
): boolean {
  return Math.hypot(x - startX, y - startY) >= CellDragThreshold;
}
