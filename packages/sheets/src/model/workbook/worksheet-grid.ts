import { toSref } from '../core/coordinates';
import type { Axis, Cell, CellStyle, Ref, Sref } from '../core/types';
import { resolveRangeStyleAt } from '../worksheet/range-styles';
import type { RangeStylePatch } from '../worksheet/range-styles';
import {
  createWorksheetAxisId,
  createWorksheetCellKey,
  parseWorksheetCellKey,
  safeWorksheetRecordEntries,
  safeWorksheetRecordKeys,
  type WorksheetGridShape,
} from './worksheet-record';

/**
 * WorksheetStyleShape augments the grid shape with the style layers stored on
 * a worksheet document (keyed by index, mirroring `Sheet`'s in-memory maps).
 */
export type WorksheetStyleShape = WorksheetGridShape & {
  sheetStyle?: CellStyle;
  colStyles?: Record<string, CellStyle>;
  rowStyles?: Record<string, CellStyle>;
  rangeStyles?: RangeStylePatch[];
};

function ensureAxisLength(
  ws: WorksheetGridShape,
  axis: Axis,
  minLength: number,
): void {
  const order = axis === 'row' ? (ws.rowOrder ??= []) : (ws.colOrder ??= []);
  const prefix = axis === 'row' ? 'r' : 'c';
  const existing = new Set(order);

  while (order.length < minLength) {
    const id = createWorksheetAxisId(prefix, existing);
    existing.add(id);
    order.push(id);
  }
}

function ensureWorksheetGrid(
  ws: WorksheetGridShape,
  minRef?: Ref,
): void {
  ws.cells ??= {};
  ws.rowOrder ??= [];
  ws.colOrder ??= [];
  ws.nextRowId ??= ws.rowOrder.length + 1;
  ws.nextColId ??= ws.colOrder.length + 1;

  if (minRef) {
    ensureAxisLength(ws, 'row', minRef.r);
    ensureAxisLength(ws, 'column', minRef.c);
  }
}

export function getWorksheetCell(
  ws: WorksheetGridShape,
  ref: Ref,
): Cell | undefined {
  const rowId = ws.rowOrder?.[ref.r - 1];
  const colId = ws.colOrder?.[ref.c - 1];
  if (!rowId || !colId) {
    return undefined;
  }
  return ws.cells?.[createWorksheetCellKey(rowId, colId)];
}

/**
 * `resolveWorksheetCellStyle` computes the effective style of a cell from a raw
 * worksheet document, merging sheet → column → row → range → cell layers (later
 * layers win), mirroring `Sheet.resolveEffectiveStyle`.
 *
 * Use this when you need a cell's resolved format outside the live `Sheet`
 * instance — e.g. building a source grid for a pivot table from a different
 * tab, where number formats often live in `rangeStyles`/`colStyles` rather
 * than on `cell.s`.
 *
 * Pass `cellStyle` when the caller has already read the cell (e.g. in a grid
 * build loop) to skip a redundant `getWorksheetCell` lookup, matching
 * `Sheet.resolveEffectiveStyle(row, col, cellStyle)`.
 */
export function resolveWorksheetCellStyle(
  ws: WorksheetStyleShape,
  ref: Ref,
  cellStyle?: CellStyle,
): CellStyle | undefined {
  const cell = cellStyle ?? getWorksheetCell(ws, ref)?.s;
  const sheetStyle = ws.sheetStyle;
  const colStyle = ws.colStyles?.[String(ref.c)];
  const rowStyle = ws.rowStyles?.[String(ref.r)];
  const rangeStyle = ws.rangeStyles
    ? resolveRangeStyleAt(ws.rangeStyles, ref.r, ref.c)
    : undefined;
  if (!sheetStyle && !colStyle && !rowStyle && !rangeStyle && !cell) {
    return undefined;
  }
  return { ...sheetStyle, ...colStyle, ...rowStyle, ...rangeStyle, ...cell };
}

function setWorksheetGridCell(
  ws: WorksheetGridShape,
  ref: Ref,
  cell: Cell | undefined,
): void {
  ensureWorksheetGrid(ws, ref);
  const cells = ws.cells;

  const rowId = ws.rowOrder?.[ref.r - 1];
  const colId = ws.colOrder?.[ref.c - 1];
  if (!rowId || !colId || !cells) {
    return;
  }

  const key = createWorksheetCellKey(rowId, colId);
  if (cell) {
    cells[key] = cell;
    return;
  }
  delete cells[key];
}

export function getWorksheetEntries(
  ws: WorksheetGridShape,
): Array<[Sref, Cell]> {
  const rowOrder = ws.rowOrder ?? [];
  const colOrder = ws.colOrder ?? [];
  const rowIndex = new Map<string, number>();
  const colIndex = new Map<string, number>();

  rowOrder.forEach((rowId, index) => rowIndex.set(rowId, index + 1));
  colOrder.forEach((colId, index) => colIndex.set(colId, index + 1));

  const entries: Array<[Sref, Cell]> = [];
  for (const [key, cell] of safeWorksheetRecordEntries(ws.cells)) {
    const { rowId, colId } = parseWorksheetCellKey(key);
    const row = rowIndex.get(rowId);
    const col = colIndex.get(colId);
    if (!row || !col) {
      continue;
    }
    entries.push([toSref({ r: row, c: col }), cell]);
  }

  return entries;
}

export function getWorksheetKeys(ws: WorksheetGridShape): Sref[] {
  return getWorksheetEntries(ws).map(([sref]) => sref);
}

export function forEachWorksheetStoredCell(
  ws: WorksheetGridShape,
  visitor: (key: string, cell: Cell) => void,
): void {
  for (const [key, cell] of safeWorksheetRecordEntries(ws.cells)) {
    visitor(key, cell);
  }
}

export function writeWorksheetCell(
  ws: WorksheetGridShape,
  ref: Ref,
  cell: Cell | undefined,
): void {
  if (cell !== undefined) {
    ensureWorksheetGrid(ws, ref);
    setWorksheetGridCell(ws, ref, cell);
    return;
  }

  if (getWorksheetCell(ws, ref) === undefined) {
    return;
  }

  ensureWorksheetGrid(ws, ref);
  setWorksheetGridCell(ws, ref, undefined);
}

export function updateWorksheetCell(
  ws: WorksheetGridShape,
  ref: Ref,
  updater: (current: Cell | undefined) => Cell | undefined,
): void {
  const current = getWorksheetCell(ws, ref);
  writeWorksheetCell(ws, ref, updater(current));
}

export function replaceWorksheetCells(
  ws: WorksheetGridShape,
  cells: Iterable<[Ref, Cell]>,
): void {
  ensureWorksheetGrid(ws);
  const cellsRecord = ws.cells;
  if (!cellsRecord) {
    return;
  }

  for (const key of safeWorksheetRecordKeys(cellsRecord)) {
    delete cellsRecord[key];
  }

  for (const [ref, cell] of cells) {
    setWorksheetGridCell(ws, ref, cell);
  }
}
