import {
  safeWorksheetRecordKeys,
  createWorksheetAxisId,
  parseWorksheetCellKey,
  type Axis,
} from "@wafflebase/sheets";
import type { Worksheet } from "@/types/worksheet";

function ensureAxisLength(
  ws: Worksheet,
  axis: Axis,
  minLength: number,
): void {
  const order = axis === "row" ? ws.rowOrder : ws.colOrder;
  const counterKey = axis === "row" ? "nextRowId" : "nextColId";
  const prefix = axis === "row" ? "r" : "c";
  let nextValue = ws[counterKey] ?? order.length + 1;

  while (order.length < minLength) {
    order.push(createWorksheetAxisId(prefix, nextValue));
    nextValue += 1;
  }

  ws[counterKey] = nextValue;
}

export function insertYorkieWorksheetAxis(
  ws: Worksheet,
  axis: Axis,
  index: number,
  count: number,
): void {
  ensureAxisLength(ws, axis, Math.max(0, index - 1));

  const order = axis === "row" ? ws.rowOrder : ws.colOrder;
  const counterKey = axis === "row" ? "nextRowId" : "nextColId";
  const prefix = axis === "row" ? "r" : "c";
  let nextValue = ws[counterKey] ?? order.length + 1;
  const created: string[] = [];

  for (let i = 0; i < count; i++) {
    created.push(createWorksheetAxisId(prefix, nextValue));
    nextValue += 1;
  }

  order.splice(Math.max(0, index - 1), 0, ...created);
  ws[counterKey] = nextValue;
}

export function deleteYorkieWorksheetAxis(
  ws: Worksheet,
  axis: Axis,
  index: number,
  count: number,
): void {
  const order = axis === "row" ? ws.rowOrder : ws.colOrder;
  const removedIds = new Set(
    order.splice(Math.max(0, index - 1), Math.max(0, count)),
  );

  if (removedIds.size === 0) {
    return;
  }

  const cells = ws.cells;
  for (const key of safeWorksheetRecordKeys(cells)) {
    const { rowId, colId } = parseWorksheetCellKey(key);
    const axisId = axis === "row" ? rowId : colId;
    if (removedIds.has(axisId)) {
      delete cells[key];
    }
  }
}

export function moveYorkieWorksheetAxis(
  ws: Worksheet,
  axis: Axis,
  srcIndex: number,
  count: number,
  dstIndex: number,
): void {
  ensureAxisLength(ws, axis, Math.max(srcIndex + count - 1, dstIndex - 1));

  const order = axis === "row" ? ws.rowOrder : ws.colOrder;
  const start = Math.max(0, srcIndex - 1);
  const moved = order.splice(start, count);
  if (moved.length === 0) {
    return;
  }

  let destination = Math.max(0, dstIndex - 1);
  if (destination > start) {
    destination -= moved.length;
  }

  order.splice(destination, 0, ...moved);
}
