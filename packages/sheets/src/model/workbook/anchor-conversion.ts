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
): Range | null {
  const startR = anchor.startRowId ? rowOrder.indexOf(anchor.startRowId) + 1 : 1;
  const startC = anchor.startColId ? colOrder.indexOf(anchor.startColId) + 1 : 1;
  const endR = anchor.endRowId ? rowOrder.indexOf(anchor.endRowId) + 1 : rowOrder.length;
  const endC = anchor.endColId ? colOrder.indexOf(anchor.endColId) + 1 : colOrder.length;

  // indexOf returns -1 → +1 = 0 means deleted
  if (anchor.startRowId && startR === 0 && anchor.endRowId && endR === 0) return null;
  if (anchor.startColId && startC === 0 && anchor.endColId && endC === 0) return null;

  return [
    { r: Math.max(1, startR), c: Math.max(1, startC) },
    { r: Math.max(1, endR), c: Math.max(1, endC) },
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

  return {
    startRowId: useRow ? (rowOrder[start.r - 1] ?? null) : null,
    startColId: useCol ? (colOrder[start.c - 1] ?? null) : null,
    endRowId: useRow ? (rowOrder[end.r - 1] ?? null) : null,
    endColId: useCol ? (colOrder[end.c - 1] ?? null) : null,
  };
}
