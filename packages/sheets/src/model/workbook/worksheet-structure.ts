import { parseRef, toSref } from '../core/coordinates';
import {
  moveConditionalFormatRules,
  shiftConditionalFormatRules,
} from '../worksheet/conditional-format';
import {
  moveDataValidationRules,
  shiftDataValidationRules,
} from '../worksheet/data-validation';
import {
  normalizeFilterColumnsToRange,
  pruneHiddenRowsOutsideFilter,
  shiftFilterBoundary,
} from '../worksheet/filter';
import { moveMergeMap, shiftMergeMap } from '../worksheet/merging';
import {
  moveRangeStylePatches,
  shiftRangeStylePatches,
} from '../worksheet/range-styles';
import {
  moveA1Range,
  moveColumnLabel,
  moveDimensionMap,
  moveFormula,
  moveRef,
  remapIndex,
  shiftA1Range,
  shiftColumnLabel,
  shiftDimensionMap,
  shiftFormula,
  shiftSref,
} from '../worksheet/shifting';
import { getWorksheetEntries, writeWorksheetCell } from './worksheet-grid';
import {
  safeWorksheetRecordEntries,
  safeWorksheetRecordKeys,
} from './worksheet-record';
import type { Axis, Cell, MergeSpan, Sref } from '../core/types';
import type {
  SheetChart,
  Worksheet,
  WorksheetFilterState,
} from './worksheet-document';
import {
  deleteWorksheetAxis,
  insertWorksheetAxis,
  moveWorksheetAxis,
} from './worksheet-axis';

type NormalizeCell = (cell: Cell) => Cell | null;

/**
 * Delete threads whose anchor points to a deleted row or column.
 * Called during the same transaction as the row/column deletion,
 * so undo restores both the deleted rows/columns and their threads together.
 */
export function deleteThreadsForAxis(
  ws: Pick<Worksheet, 'comments'>,
  axis: 'row' | 'col',
  deletedAxisIds: Set<string>,
): void {
  const comments = ws.comments;
  if (!comments) return;
  for (const [threadId, thread] of Object.entries(comments)) {
    if (thread.anchor.kind !== "sheet-cell") continue;
    const id = axis === "row" ? thread.anchor.rowId : thread.anchor.colId;
    if (deletedAxisIds.has(id)) delete comments[threadId];
  }
}

function toIndexedMap<T>(record: Record<string, T>): Map<number, T> {
  return new Map(
    safeWorksheetRecordEntries(record).map(([key, value]) => [Number(key), value]),
  );
}

function replaceIndexedRecord<T>(
  record: Record<string, T>,
  next: Map<number, T>,
): void {
  for (const key of safeWorksheetRecordKeys(record)) {
    delete record[key];
  }

  for (const [index, value] of next) {
    record[String(index)] = value;
  }
}

function rewriteFormulaCells(
  ws: Worksheet,
  normalizeCell: NormalizeCell,
  rewrite: (formula: string) => string,
  invalidateValues = false,
): void {
  for (const [sref, cell] of getWorksheetEntries(ws)) {
    if (!cell.f) {
      continue;
    }

    const next: Cell = { ...cell, f: rewrite(cell.f) };
    // A structural edit invalidates every cached formula value on the sheet,
    // and not only the ones whose text changed: `=SUM(A:A)` reads a different
    // range after an insert without being rewritten at all, and a reference
    // into a deleted row becomes `#REF!` while `v` keeps the last good number.
    //
    // Callers that recalculate straight afterwards leave this off — the editor
    // does, and clearing there would flash blanks at peers between the two
    // updates. Callers with no calculator turn it on so a reader gets `null`
    // rather than a number that no longer matches the formula beside it.
    if (invalidateValues) {
      delete next.v;
    }
    const normalized = normalizeCell(next);
    writeWorksheetCell(ws, parseRef(sref), normalized ?? undefined);
  }
}

/**
 * Remap a list of 1-based indices, dropping anything the edit deleted.
 *
 * `shiftDimensionMap` is the same primitive `Sheet` uses for these sets; it
 * takes a map because its usual payload is a row height, and the value is
 * irrelevant here.
 */
function shiftIndexList(list: number[], index: number, count: number): number[] {
  const shifted = shiftDimensionMap(
    new Map(list.map((i) => [i, 1])),
    index,
    count,
  );
  return [...shifted.keys()].sort((a, b) => a - b);
}

function moveIndexList(
  list: number[],
  src: number,
  count: number,
  dst: number,
): number[] {
  return list.map((i) => remapIndex(i, src, count, dst)).sort((a, b) => a - b);
}

function filterColumnsToMap(
  columns: WorksheetFilterState['columns'],
): Map<number, WorksheetFilterState['columns'][string]> {
  return new Map(
    safeWorksheetRecordEntries(columns).map(([key, value]) => [
      Number(key),
      value,
    ]),
  );
}

function filterColumnsFromMap(
  columns: Map<number, WorksheetFilterState['columns'][string]>,
): WorksheetFilterState['columns'] {
  const next: WorksheetFilterState['columns'] = {};
  for (const [col, condition] of columns) {
    next[String(col)] = condition;
  }
  return next;
}

/**
 * Remap the worksheet state that is keyed by **index** rather than by axis id:
 * the filter range and its per-column criteria, the user-hidden rows/columns,
 * and the freeze pane.
 *
 * Cells survive a structural edit for free because they are keyed by
 * `rowId:colId`, and that is exactly why these five fields do not: they store
 * plain 1-based numbers, so an insert above them silently repoints them at the
 * wrong rows. `Sheet.shiftCells` has always done this work itself, immediately
 * around `store.shiftCells` — `shiftFilterState`, `shiftUserHiddenState` and
 * the freeze-pane block. Doing it here instead means every caller of
 * {@link applyWorksheetShift} gets it, not just the editor.
 *
 * Applying it in both places is safe: `Sheet` persists these fields by
 * assigning the whole value it computed from its own in-memory state
 * (`setFilterState`, `setHiddenState`, `setFreezePane` are absolute writes,
 * never read-modify-write), so the editor's later write is the same value
 * again.
 */
function shiftWorksheetViewState(
  ws: Worksheet,
  axis: Axis,
  index: number,
  count: number,
): void {
  const filter = ws.filter;
  if (filter) {
    if (axis === 'row') {
      const a = shiftFilterBoundary(filter.startRow, index, count);
      const b = shiftFilterBoundary(filter.endRow, index, count);
      const startRow = Math.max(1, Math.min(a, b));
      const endRow = Math.max(1, Math.max(a, b));
      const hidden = shiftIndexList(
        [...(filter.hiddenRows ?? [])],
        index,
        count,
      );
      ws.filter = {
        ...filter,
        startRow,
        endRow,
        columns: { ...filter.columns },
        hiddenRows: [
          ...pruneHiddenRowsOutsideFilter(
            [{ r: startRow, c: filter.startCol }, { r: endRow, c: filter.endCol }],
            new Set(hidden),
          ),
        ].sort((x, y) => x - y),
      };
    } else {
      const a = shiftFilterBoundary(filter.startCol, index, count);
      const b = shiftFilterBoundary(filter.endCol, index, count);
      const startCol = Math.max(1, Math.min(a, b));
      const endCol = Math.max(1, Math.max(a, b));
      const columns = shiftDimensionMap(
        filterColumnsToMap(filter.columns),
        index,
        count,
      );
      normalizeFilterColumnsToRange(
        [{ r: filter.startRow, c: startCol }, { r: filter.endRow, c: endCol }],
        columns,
        (col) => col >= startCol && col <= endCol,
      );
      ws.filter = {
        ...filter,
        startCol,
        endCol,
        columns: filterColumnsFromMap(columns),
        hiddenRows: [...(filter.hiddenRows ?? [])],
      };
    }
  }

  if (axis === 'row' && ws.hiddenRows?.length) {
    ws.hiddenRows = shiftIndexList([...ws.hiddenRows], index, count);
  }
  if (axis === 'column' && ws.hiddenColumns?.length) {
    ws.hiddenColumns = shiftIndexList([...ws.hiddenColumns], index, count);
  }

  // Freeze pane. An insert inside the frozen band grows it; a delete inside it
  // shrinks it by however much of the band was removed. An edit below the band
  // leaves it alone. Mirrors `Sheet.shiftCells`.
  const frozen = axis === 'row' ? ws.frozenRows : ws.frozenCols;
  if (frozen > 0 && index <= frozen) {
    let next: number | undefined;
    if (count > 0) {
      next = frozen + count;
    } else if (count < 0) {
      const deletedInFrozen = Math.min(Math.abs(count), frozen - index + 1);
      next = Math.max(0, frozen - deletedInFrozen);
    }
    if (next !== undefined) {
      if (axis === 'row') {
        ws.frozenRows = next;
      } else {
        ws.frozenCols = next;
      }
    }
  }
}

/**
 * Move counterpart of {@link shiftWorksheetViewState}.
 *
 * `Sheet.moveCells` deliberately leaves the freeze pane alone — a move changes
 * no axis count, so the boundary stays where it is — and so does this.
 */
function moveWorksheetViewState(
  ws: Worksheet,
  axis: Axis,
  src: number,
  count: number,
  dst: number,
): void {
  const filter = ws.filter;
  if (filter) {
    if (axis === 'row') {
      const a = remapIndex(filter.startRow, src, count, dst);
      const b = remapIndex(filter.endRow, src, count, dst);
      const startRow = Math.min(a, b);
      const endRow = Math.max(a, b);
      const hidden = moveIndexList(
        [...(filter.hiddenRows ?? [])],
        src,
        count,
        dst,
      );
      ws.filter = {
        ...filter,
        startRow,
        endRow,
        columns: { ...filter.columns },
        hiddenRows: [
          ...pruneHiddenRowsOutsideFilter(
            [{ r: startRow, c: filter.startCol }, { r: endRow, c: filter.endCol }],
            new Set(hidden),
          ),
        ].sort((x, y) => x - y),
      };
    } else {
      const a = remapIndex(filter.startCol, src, count, dst);
      const b = remapIndex(filter.endCol, src, count, dst);
      const startCol = Math.min(a, b);
      const endCol = Math.max(a, b);
      const columns = moveDimensionMap(
        filterColumnsToMap(filter.columns),
        src,
        count,
        dst,
      );
      normalizeFilterColumnsToRange(
        [{ r: filter.startRow, c: startCol }, { r: filter.endRow, c: endCol }],
        columns,
        (col) => col >= startCol && col <= endCol,
      );
      ws.filter = {
        ...filter,
        startCol,
        endCol,
        columns: filterColumnsFromMap(columns),
        hiddenRows: [...(filter.hiddenRows ?? [])],
      };
    }
  }

  if (axis === 'row' && ws.hiddenRows?.length) {
    ws.hiddenRows = moveIndexList([...ws.hiddenRows], src, count, dst);
  }
  if (axis === 'column' && ws.hiddenColumns?.length) {
    ws.hiddenColumns = moveIndexList([...ws.hiddenColumns], src, count, dst);
  }
}

function replaceMerges(ws: Worksheet, nextMerges: Map<Sref, MergeSpan>): void {
  ws.merges = {};
  for (const [sref, span] of nextMerges) {
    ws.merges[sref] = span;
  }
}

/**
 * Shift anchors for any record of anchored objects (charts, images, etc.)
 * when rows/columns are inserted or deleted. Uses key-based access so
 * mutations go through the Yorkie proxy.
 */
function shiftAnchors(
  record: Record<string, { anchor: Sref }> | undefined,
  axis: Axis,
  index: number,
  count: number,
): void {
  if (!record) return;

  for (const key of safeWorksheetRecordKeys(record)) {
    const item = record[key];
    if (!item) continue;
    const shiftedAnchor = shiftSref(item.anchor, axis, index, count);
    if (shiftedAnchor) {
      item.anchor = shiftedAnchor;
      continue;
    }
    // If anchor cell was deleted, pin to the deletion boundary.
    const fallback = parseRef(item.anchor);
    if (axis === 'row') {
      fallback.r = Math.max(1, index);
    } else {
      fallback.c = Math.max(1, index);
    }
    item.anchor = toSref(fallback);
  }
}

/**
 * Shift a single chart's data ranges (sourceRange, xAxisColumn, seriesColumns).
 */
function shiftOneChartRange(
  chart: SheetChart,
  axis: Axis,
  index: number,
  count: number,
): void {
  if (chart.sourceRange) {
    const shifted = shiftA1Range(chart.sourceRange, axis, index, count);
    if (shifted) {
      chart.sourceRange = shifted;
    }
  }

  if (axis === 'column') {
    if (chart.xAxisColumn) {
      const shifted = shiftColumnLabel(chart.xAxisColumn, index, count);
      if (shifted) {
        chart.xAxisColumn = shifted;
      }
    }

    if (chart.seriesColumns) {
      const result: string[] = [];
      for (const col of chart.seriesColumns) {
        const shifted = shiftColumnLabel(col, index, count);
        if (shifted) {
          result.push(shifted);
        }
      }
      chart.seriesColumns = result;
    }
  }
}

/**
 * Move a single chart's data ranges.
 */
function moveOneChartRange(
  chart: SheetChart,
  axis: Axis,
  srcIndex: number,
  count: number,
  dstIndex: number,
): void {
  if (chart.sourceRange) {
    chart.sourceRange = moveA1Range(
      chart.sourceRange, axis, srcIndex, count, dstIndex,
    );
  }

  if (axis === 'column') {
    if (chart.xAxisColumn) {
      chart.xAxisColumn = moveColumnLabel(
        chart.xAxisColumn, srcIndex, count, dstIndex,
      );
    }

    if (chart.seriesColumns) {
      chart.seriesColumns = chart.seriesColumns.map((col) =>
        moveColumnLabel(col, srcIndex, count, dstIndex),
      );
    }
  }
}

/**
 * Shift chart data ranges for charts whose sourceTabId matches the
 * tab being modified.
 */
function shiftChartRanges(
  charts: Record<string, SheetChart> | undefined,
  sourceTabId: string,
  axis: Axis,
  index: number,
  count: number,
): void {
  if (!charts) return;

  for (const key of safeWorksheetRecordKeys(charts)) {
    const chart = charts[key];
    if (!chart || chart.sourceTabId !== sourceTabId) continue;
    shiftOneChartRange(chart, axis, index, count);
  }
}

/**
 * Move chart data ranges for charts whose sourceTabId matches the
 * tab being modified.
 */
function moveChartRanges(
  charts: Record<string, SheetChart> | undefined,
  sourceTabId: string,
  axis: Axis,
  srcIndex: number,
  count: number,
  dstIndex: number,
): void {
  if (!charts) return;

  for (const key of safeWorksheetRecordKeys(charts)) {
    const chart = charts[key];
    if (!chart || chart.sourceTabId !== sourceTabId) continue;
    moveOneChartRange(chart, axis, srcIndex, count, dstIndex);
  }
}

/**
 * Move anchors for any record of anchored objects when rows/columns
 * are reordered.
 */
function moveAnchors(
  record: Record<string, { anchor: Sref }> | undefined,
  axis: Axis,
  srcIndex: number,
  count: number,
  dstIndex: number,
): void {
  if (!record) return;

  for (const key of safeWorksheetRecordKeys(record)) {
    const item = record[key];
    if (!item) continue;
    const nextAnchor = moveRef(
      parseRef(item.anchor),
      axis,
      srcIndex,
      count,
      dstIndex,
    );
    item.anchor = toSref(nextAnchor);
  }
}

export function applyWorksheetShift(options: {
  ws: Worksheet;
  axis: Axis;
  index: number;
  count: number;
  normalizeCell: NormalizeCell;
  /** See {@link rewriteFormulaCells}. Off by default, for the editor. */
  invalidateFormulaValues?: boolean;
}): void {
  const { ws, axis, index, count, normalizeCell, invalidateFormulaValues } =
    options;

  let deletedAxisIds: Set<string> = new Set();
  if (count > 0) {
    insertWorksheetAxis(ws, axis, index, count);
  } else if (count < 0) {
    deletedAxisIds = deleteWorksheetAxis(ws, axis, index, Math.abs(count));
  }

  rewriteFormulaCells(
    ws,
    normalizeCell,
    (formula) => shiftFormula(formula, axis, index, count),
    invalidateFormulaValues,
  );

  const dimensionRecord = axis === "row" ? ws.rowHeights : ws.colWidths;
  replaceIndexedRecord(
    dimensionRecord,
    shiftDimensionMap(toIndexedMap(dimensionRecord), index, count),
  );

  const styleRecord = axis === "row" ? ws.rowStyles : ws.colStyles;
  replaceIndexedRecord(
    styleRecord,
    shiftDimensionMap(toIndexedMap(styleRecord), index, count),
  );

  if (ws.rangeStyles) {
    ws.rangeStyles = shiftRangeStylePatches(ws.rangeStyles, axis, index, count);
  }

  if (ws.conditionalFormats) {
    ws.conditionalFormats = shiftConditionalFormatRules(
      ws.conditionalFormats,
      axis,
      index,
      count,
    );
  }

  if (ws.dataValidations) {
    ws.dataValidations = shiftDataValidationRules(
      ws.dataValidations,
      axis,
      index,
      count,
    );
  }

  replaceMerges(
    ws,
    shiftMergeMap(
      new Map(safeWorksheetRecordEntries(ws.merges) as Array<[Sref, MergeSpan]>),
      axis,
      index,
      count,
    ),
  );

  shiftAnchors(ws.charts as Record<string, { anchor: Sref }>, axis, index, count);
  shiftAnchors(ws.images as Record<string, { anchor: Sref }>, axis, index, count);

  shiftWorksheetViewState(ws, axis, index, count);

  // Auto-delete orphan threads when rows/columns are deleted.
  // Done in the same transaction as the deletion for undo restoration.
  if (deletedAxisIds.size > 0) {
    deleteThreadsForAxis(ws, axis === "row" ? "row" : "col", deletedAxisIds);
  }
}

export function applyWorksheetMove(options: {
  ws: Worksheet;
  axis: Axis;
  srcIndex: number;
  count: number;
  dstIndex: number;
  normalizeCell: NormalizeCell;
  /** See {@link rewriteFormulaCells}. Off by default, for the editor. */
  invalidateFormulaValues?: boolean;
}): void {
  const {
    ws,
    axis,
    srcIndex,
    count,
    dstIndex,
    normalizeCell,
    invalidateFormulaValues,
  } = options;

  moveWorksheetAxis(ws, axis, srcIndex, count, dstIndex);

  rewriteFormulaCells(
    ws,
    normalizeCell,
    (formula) => moveFormula(formula, axis, srcIndex, count, dstIndex),
    invalidateFormulaValues,
  );

  const dimensionRecord = axis === "row" ? ws.rowHeights : ws.colWidths;
  replaceIndexedRecord(
    dimensionRecord,
    moveDimensionMap(toIndexedMap(dimensionRecord), srcIndex, count, dstIndex),
  );

  const styleRecord = axis === "row" ? ws.rowStyles : ws.colStyles;
  replaceIndexedRecord(
    styleRecord,
    moveDimensionMap(toIndexedMap(styleRecord), srcIndex, count, dstIndex),
  );

  if (ws.rangeStyles) {
    ws.rangeStyles = moveRangeStylePatches(
      ws.rangeStyles,
      axis,
      srcIndex,
      count,
      dstIndex,
    );
  }

  if (ws.conditionalFormats) {
    ws.conditionalFormats = moveConditionalFormatRules(
      ws.conditionalFormats,
      axis,
      srcIndex,
      count,
      dstIndex,
    );
  }

  if (ws.dataValidations) {
    ws.dataValidations = moveDataValidationRules(
      ws.dataValidations,
      axis,
      srcIndex,
      count,
      dstIndex,
    );
  }

  replaceMerges(
    ws,
    moveMergeMap(
      new Map(safeWorksheetRecordEntries(ws.merges) as Array<[Sref, MergeSpan]>),
      axis,
      srcIndex,
      count,
      dstIndex,
    ),
  );

  moveAnchors(ws.charts as Record<string, { anchor: Sref }>, axis, srcIndex, count, dstIndex);
  moveAnchors(ws.images as Record<string, { anchor: Sref }>, axis, srcIndex, count, dstIndex);

  moveWorksheetViewState(ws, axis, srcIndex, count, dstIndex);
}

/**
 * Shift chart/pivot data ranges across all tabs whose sourceTabId matches
 * the tab being structurally modified. This handles cross-tab references
 * (e.g. a pivot on tab-2 referencing data on tab-1).
 */
export function shiftCrossTabDataRanges(
  sheets: Record<string, Worksheet>,
  sourceTabId: string,
  axis: Axis,
  index: number,
  count: number,
): void {
  for (const tabId of Object.keys(sheets)) {
    const ws = sheets[tabId];
    if (!ws) continue;

    shiftChartRanges(
      ws.charts as Record<string, SheetChart>,
      sourceTabId, axis, index, count,
    );

    if (ws.pivotTable?.sourceTabId === sourceTabId && ws.pivotTable.sourceRange) {
      const shifted = shiftA1Range(ws.pivotTable.sourceRange, axis, index, count);
      if (shifted) {
        ws.pivotTable.sourceRange = shifted;
      }
    }
  }
}

/**
 * Move chart/pivot data ranges across all tabs whose sourceTabId matches
 * the tab being structurally modified.
 */
export function moveCrossTabDataRanges(
  sheets: Record<string, Worksheet>,
  sourceTabId: string,
  axis: Axis,
  srcIndex: number,
  count: number,
  dstIndex: number,
): void {
  for (const tabId of Object.keys(sheets)) {
    const ws = sheets[tabId];
    if (!ws) continue;

    moveChartRanges(
      ws.charts as Record<string, SheetChart>,
      sourceTabId, axis, srcIndex, count, dstIndex,
    );

    if (ws.pivotTable?.sourceTabId === sourceTabId && ws.pivotTable.sourceRange) {
      ws.pivotTable.sourceRange = moveA1Range(
        ws.pivotTable.sourceRange, axis, srcIndex, count, dstIndex,
      );
    }
  }
}
