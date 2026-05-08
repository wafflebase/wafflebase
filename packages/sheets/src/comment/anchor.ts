import { toSref } from '../model/core/coordinates';

export type AxisOrder = {
  rowOrder: readonly string[];
  colOrder: readonly string[];
};

export type CellAnchorIds = { rowId: string; colId: string };

/**
 * `isAnchorAlive` returns whether both the row and column IDs exist in the axis order.
 * This indicates that the anchor is still valid (neither axis has been deleted).
 */
export function isAnchorAlive(anchor: CellAnchorIds, order: AxisOrder): boolean {
  return order.rowOrder.includes(anchor.rowId) && order.colOrder.includes(anchor.colId);
}

/**
 * `cellAnchorToSref` converts a CellAnchor (rowId/colId pair) to a visual Sref string (e.g., "B3").
 * Returns null if either the row or column ID has been deleted.
 */
export function cellAnchorToSref(
  anchor: CellAnchorIds,
  order: AxisOrder,
): string | null {
  const r = order.rowOrder.indexOf(anchor.rowId);
  const c = order.colOrder.indexOf(anchor.colId);
  if (r < 0 || c < 0) return null;
  // indexOf returns 0-based indices, toSref expects 1-based
  return toSref({ r: r + 1, c: c + 1 });
}
