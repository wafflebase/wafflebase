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
 * `carryPoint` returns the cell under a sheet-space point after it has been
 * carried by `travel` — the distance the pointer has moved since the press,
 * in sheet pixels (CSS travel divided by zoom, plus any scroll since).
 *
 * Drags off the selection border and the fill handle use this instead of the
 * cell under the pointer. Both hit areas straddle the selection's edge, so the
 * press often lands in a neighbouring cell, and in index space that cell can
 * be far away: past rows a filter hid, or across the freeze gap, which maps to
 * the first unscrolled row. Carrying a point of the selection itself keeps the
 * grab offset Excel and Google Sheets keep, and working in sheet space keeps
 * freeze panes out of it. `findIndex` skips zero-height (hidden) rows.
 */
export function carryPoint(
  point: Point,
  travel: Point,
  rowDim: DimensionIndex,
  colDim: DimensionIndex,
): Ref {
  return {
    r: rowDim.findIndex(point.y + travel.y),
    c: colDim.findIndex(point.x + travel.x),
  };
}

/**
 * `cellCentre` returns the sheet-space centre of a cell, the point a
 * drag-move carries: aiming at the centre keeps it off the gridlines.
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
 */
export function cellCornerInset(
  ref: Ref,
  inset: number,
  rowDim: DimensionIndex,
  colDim: DimensionIndex,
): Point {
  return {
    x: colDim.getOffset(ref.c) + colDim.getSize(ref.c) - inset,
    y: rowDim.getOffset(ref.r) + rowDim.getSize(ref.r) - inset,
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
