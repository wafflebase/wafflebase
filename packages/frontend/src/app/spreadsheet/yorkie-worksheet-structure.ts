import {
  getWorksheetEntries,
  moveConditionalFormatRules,
  moveDimensionMap,
  moveFormula,
  moveMergeMap,
  moveRangeStylePatches,
  moveRef,
  parseRef,
  shiftConditionalFormatRules,
  shiftDimensionMap,
  shiftFormula,
  shiftMergeMap,
  shiftRangeStylePatches,
  safeWorksheetRecordEntries,
  safeWorksheetRecordKeys,
  shiftSref,
  toSref,
  writeWorksheetCell,
  type Axis,
  type Cell,
  type MergeSpan,
  type Sref,
  type Worksheet,
} from "@wafflebase/sheets";
import {
  deleteYorkieWorksheetAxis,
  insertYorkieWorksheetAxis,
  moveYorkieWorksheetAxis,
} from "./yorkie-worksheet-axis";

type NormalizeCell = (cell: Cell) => Cell | null;

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

  if (count > 0) {
    insertYorkieWorksheetAxis(ws, axis, index, count);
  } else if (count < 0) {
    deleteYorkieWorksheetAxis(ws, axis, index, Math.abs(count));
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
