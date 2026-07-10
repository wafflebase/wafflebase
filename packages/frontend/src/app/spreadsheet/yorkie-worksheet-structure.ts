import {
  getWorksheetEntries,
  moveConditionalFormatRules,
  moveDataValidationRules,
  moveDimensionMap,
  moveFormula,
  moveMergeMap,
  moveRangeStylePatches,
  moveRef,
  parseRef,
  shiftConditionalFormatRules,
  shiftDataValidationRules,
  shiftDimensionMap,
  shiftFormula,
  shiftMergeMap,
  shiftRangeStylePatches,
  safeWorksheetRecordEntries,
  safeWorksheetRecordKeys,
  shiftA1Range,
  shiftColumnLabel,
  shiftSref,
  moveA1Range,
  moveColumnLabel,
  toSref,
  writeWorksheetCell,
  type Axis,
  type Cell,
  type MergeSpan,
  type SheetChart,
  type Sref,
  type Worksheet,
} from "@wafflebase/sheets";
import {
  deleteYorkieWorksheetAxis,
  insertYorkieWorksheetAxis,
  moveYorkieWorksheetAxis,
} from "./yorkie-worksheet-axis";

type NormalizeCell = (cell: Cell) => Cell | null;

/**
 * Delete threads whose anchor points to a deleted row or column.
 * Called during the same transaction as the row/column deletion,
 * so undo restores both the deleted rows/columns and their threads together.
 */
export function deleteThreadsForAxis(
  ws: Worksheet,
  axis: "row" | "col",
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
): void {
  for (const [sref, cell] of getWorksheetEntries(ws)) {
    if (!cell.f) {
      continue;
    }

    const normalized = normalizeCell({
      ...cell,
      f: rewrite(cell.f),
    });
    writeWorksheetCell(ws, parseRef(sref), normalized ?? undefined);
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

export function applyYorkieWorksheetShift(options: {
  ws: Worksheet;
  axis: Axis;
  index: number;
  count: number;
  normalizeCell: NormalizeCell;
}): void {
  const { ws, axis, index, count, normalizeCell } = options;

  let deletedAxisIds: Set<string> = new Set();
  if (count > 0) {
    insertYorkieWorksheetAxis(ws, axis, index, count);
  } else if (count < 0) {
    deletedAxisIds = deleteYorkieWorksheetAxis(ws, axis, index, Math.abs(count));
  }

  rewriteFormulaCells(ws, normalizeCell, (formula) =>
    shiftFormula(formula, axis, index, count),
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

  // Auto-delete orphan threads when rows/columns are deleted.
  // Done in the same transaction as the deletion for undo restoration.
  if (deletedAxisIds.size > 0) {
    deleteThreadsForAxis(ws, axis === "row" ? "row" : "col", deletedAxisIds);
  }
}

export function applyYorkieWorksheetMove(options: {
  ws: Worksheet;
  axis: Axis;
  srcIndex: number;
  count: number;
  dstIndex: number;
  normalizeCell: NormalizeCell;
}): void {
  const { ws, axis, srcIndex, count, dstIndex, normalizeCell } = options;

  moveYorkieWorksheetAxis(ws, axis, srcIndex, count, dstIndex);

  rewriteFormulaCells(ws, normalizeCell, (formula) =>
    moveFormula(formula, axis, srcIndex, count, dstIndex),
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
