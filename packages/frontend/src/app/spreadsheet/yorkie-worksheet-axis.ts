import type { Axis } from "@wafflebase/sheet";
import type { Worksheet } from "@/types/worksheet";

const CellKeySeparator = "|";

function isDuplicateOwnKeysError(error: unknown): boolean {
  return (
    error instanceof TypeError &&
    error.message.includes("ownKeys") &&
    error.message.includes("duplicate")
  );
}

function snapshotRecord<T>(obj: Record<string, T>): Record<string, T> {
  const maybeToJSON = (obj as { toJSON?: () => string | Record<string, T> })
    .toJSON;
  if (typeof maybeToJSON === "function") {
    const value = maybeToJSON.call(obj);
    if (typeof value === "string") {
      return JSON.parse(value) as Record<string, T>;
    }
    return value;
  }
  return { ...obj };
}

function safeYorkieRecordKeys<T>(obj: Record<string, T>): string[] {
  try {
    return Object.keys(obj);
  } catch (error) {
    if (isDuplicateOwnKeysError(error)) {
      return Object.keys(snapshotRecord(obj));
    }
    throw error;
  }
}

function createAxisId(prefix: "r" | "c", index: number): string {
  return `${prefix}${index}`;
}

function parseCellKey(key: string): { rowId: string; colId: string } {
  const pivot = key.indexOf(CellKeySeparator);
  if (pivot === -1) {
    return { rowId: "", colId: "" };
  }

  return {
    rowId: key.slice(0, pivot),
    colId: key.slice(pivot + 1),
  };
}

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
    order.push(createAxisId(prefix, nextValue));
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
    created.push(createAxisId(prefix, nextValue));
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
  for (const key of safeYorkieRecordKeys(cells)) {
    const { rowId, colId } = parseCellKey(key);
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
