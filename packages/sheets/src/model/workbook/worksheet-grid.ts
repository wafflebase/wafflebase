import { toSref } from '../core/coordinates';
import type { Axis, Cell, Ref, Sref } from '../core/types';
import {
  createWorksheetAxisId,
  createWorksheetCellKey,
  parseWorksheetCellKey,
  safeWorksheetRecordEntries,
  safeWorksheetRecordKeys,
  type WorksheetGridShape,
} from './worksheet-record';

function ensureAxisLength(
  ws: WorksheetGridShape,
  axis: Axis,
  minLength: number,
): void {
  const order = axis === 'row' ? (ws.rowOrder ??= []) : (ws.colOrder ??= []);
  const counterKey = axis === 'row' ? 'nextRowId' : 'nextColId';
  const prefix = axis === 'row' ? 'r' : 'c';
  let nextValue = ws[counterKey] ?? order.length + 1;

  while (order.length < minLength) {
    order.push(createWorksheetAxisId(prefix, nextValue));
    nextValue += 1;
  }

  ws[counterKey] = nextValue;
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
