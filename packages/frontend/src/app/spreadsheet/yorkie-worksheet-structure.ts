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
  safeWorksheetRecordValues,
  shiftSref,
  toSref,
  writeWorksheetCell,
  type Axis,
  type Cell,
  type MergeSpan,
  type SheetChart,
  type SheetImage,
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

function shiftChartAnchors(
  charts: Worksheet["charts"] | undefined,
  axis: Axis,
  index: number,
  count: number,
): void {
  if (!charts) {
    return;
  }

  for (const chart of safeWorksheetRecordValues(charts as Record<string, SheetChart>)) {
    const shiftedAnchor = shiftSref(chart.anchor, axis, index, count);
    if (shiftedAnchor) {
      chart.anchor = shiftedAnchor;
      continue;
    }

    // If anchor cell was deleted, pin to the deletion boundary.
    const fallback = parseRef(chart.anchor);
    if (axis === "row") {
      fallback.r = Math.max(1, index);
    } else {
      fallback.c = Math.max(1, index);
    }
    chart.anchor = toSref(fallback);
  }
}

function shiftImageAnchors(
  images: Worksheet['images'] | undefined,
  axis: Axis,
  index: number,
  count: number,
): void {
  if (!images) return;

  for (const key of safeWorksheetRecordKeys(images as Record<string, SheetImage>)) {
    const image = images[key];
    if (!image) continue;
    const shiftedAnchor = shiftSref(image.anchor, axis, index, count);
    if (shiftedAnchor) {
      image.anchor = shiftedAnchor;
      continue;
    }
    const fallback = parseRef(image.anchor);
    if (axis === 'row') {
      fallback.r = Math.max(1, index);
    } else {
      fallback.c = Math.max(1, index);
    }
    image.anchor = toSref(fallback);
  }
}

function moveChartAnchors(
  charts: Worksheet["charts"] | undefined,
  axis: Axis,
  srcIndex: number,
  count: number,
  dstIndex: number,
): void {
  if (!charts) {
    return;
  }

  for (const chart of safeWorksheetRecordValues(charts as Record<string, SheetChart>)) {
    const nextAnchor = moveRef(
      parseRef(chart.anchor),
      axis,
      srcIndex,
      count,
      dstIndex,
    );
    chart.anchor = toSref(nextAnchor);
  }
}

function moveImageAnchors(
  images: Worksheet['images'] | undefined,
  axis: Axis,
  srcIndex: number,
  count: number,
  dstIndex: number,
): void {
  if (!images) return;

  for (const key of safeWorksheetRecordKeys(images as Record<string, SheetImage>)) {
    const image = images[key];
    if (!image) continue;
    const nextAnchor = moveRef(
      parseRef(image.anchor),
      axis,
      srcIndex,
      count,
      dstIndex,
    );
    image.anchor = toSref(nextAnchor);
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

  shiftChartAnchors(ws.charts, axis, index, count);
  shiftImageAnchors(ws.images, axis, index, count);
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

  moveChartAnchors(ws.charts, axis, srcIndex, count, dstIndex);
  moveImageAnchors(ws.images, axis, srcIndex, count, dstIndex);
}
