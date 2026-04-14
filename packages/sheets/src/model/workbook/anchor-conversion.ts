import type { Range, Ref, SelectionType } from '../core/types';

export type CellAnchor = {
  rowId: string;
  colId: string;
};

export type RangeAnchor = {
  startRowId: string | null;
  startColId: string | null;
  endRowId: string | null;
  endColId: string | null;
};

export type SelectionPresence = {
  activeCell: CellAnchor;
  ranges: RangeAnchor[];
};

export function anchorToRef(
  anchor: CellAnchor,
  rowOrder: string[],
  colOrder: string[],
): Ref | null {
  const r = rowOrder.indexOf(anchor.rowId);
  const c = colOrder.indexOf(anchor.colId);
  if (r === -1 || c === -1) return null;
  return { r: r + 1, c: c + 1 };
}

export function refToAnchor(
  ref: Ref,
  rowOrder: string[],
  colOrder: string[],
): CellAnchor | null {
  const rowId = rowOrder[ref.r - 1];
  const colId = colOrder[ref.c - 1];
  if (!rowId || !colId) return null;
  return { rowId, colId };
}

export function rangeAnchorToRange(
  anchor: RangeAnchor,
  rowOrder: string[],
  colOrder: string[],
  dimension?: { rows: number; columns: number },
): Range | null {
  const maxRows = dimension?.rows ?? rowOrder.length;
  const maxCols = dimension?.columns ?? colOrder.length;
  const startR = anchor.startRowId ? rowOrder.indexOf(anchor.startRowId) + 1 : 1;
  const startC = anchor.startColId ? colOrder.indexOf(anchor.startColId) + 1 : 1;
  const endR = anchor.endRowId ? rowOrder.indexOf(anchor.endRowId) + 1 : maxRows;
  const endC = anchor.endColId ? colOrder.indexOf(anchor.endColId) + 1 : maxCols;

  // indexOf returns -1 → +1 = 0 means deleted
  if (anchor.startRowId && startR === 0 && anchor.endRowId && endR === 0) return null;
  if (anchor.startColId && startC === 0 && anchor.endColId && endC === 0) return null;

  // When one endpoint is deleted, snap it to the surviving endpoint
  let finalStartR = startR;
  let finalStartC = startC;
  let finalEndR = endR;
  let finalEndC = endC;
  if (anchor.startRowId && finalStartR === 0) finalStartR = finalEndR;
  if (anchor.endRowId && finalEndR === 0) finalEndR = finalStartR;
  if (anchor.startColId && finalStartC === 0) finalStartC = finalEndC;
  if (anchor.endColId && finalEndC === 0) finalEndC = finalStartC;

  const r1 = Math.max(1, Math.min(finalStartR, finalEndR));
  const c1 = Math.max(1, Math.min(finalStartC, finalEndC));
  const r2 = Math.max(1, Math.max(finalStartR, finalEndR));
  const c2 = Math.max(1, Math.max(finalStartC, finalEndC));

  return [
    { r: r1, c: c1 },
    { r: r2, c: c2 },
  ];
}

export function rangeToRangeAnchor(
  range: Range,
  rowOrder: string[],
  colOrder: string[],
  selectionType: SelectionType,
): RangeAnchor {
  const [start, end] = range;
  const useRow = selectionType !== 'column' && selectionType !== 'all';
  const useCol = selectionType !== 'row' && selectionType !== 'all';

  // When an index exceeds the axis order length (e.g. selecting column E
  // when only A-B have data), use null to mean "extends to end of sheet".
  // This is intentional: row/col selection with selectionType 'row'/'column'
  // already sets the other axis to null, but for the selected axis we also
  // need to handle the case where the visual grid is larger than the CRDT
  // axis order.
  return {
    startRowId: useRow ? (rowOrder[start.r - 1] ?? null) : null,
    startColId: useCol ? (colOrder[start.c - 1] ?? null) : null,
    endRowId: useRow ? (rowOrder[end.r - 1] ?? null) : null,
    endColId: useCol ? (colOrder[end.c - 1] ?? null) : null,
  };
}
