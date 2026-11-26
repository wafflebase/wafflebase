import {
  anchorToRef,
  toColumnLabel,
  toSref,
  type Range,
  type SelectionType,
} from "@wafflebase/sheets";
import {
  MAX_ANCHOR_LABEL,
  MAX_ANCHOR_SPAN,
  type SheetAnchor,
} from "@wafflebase/core/document-link";

import { clip } from "@/components/chat/send-to-chat";

/**
 * A tab name as a formula would write it before `!`: bare when it is a
 * plain identifier, else single-quoted with quotes doubled (`'Q4 plan'!A1`).
 */
export function sheetTabRef(name: string): string {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(name)
    ? name
    : `'${name.replace(/'/g, "''")}'`;
}

function normalize(range: Range): Range {
  const [a, b] = range;
  return [
    { r: Math.min(a.r, b.r), c: Math.min(a.c, b.c) },
    { r: Math.max(a.r, b.r), c: Math.max(a.c, b.c) },
  ];
}

/** "C3:E7", "C3", "3:5" for whole rows, "C:E" for whole columns. */
function rangeText(range: Range, type: SelectionType | undefined): string {
  const [from, to] = range;
  if (type === "row") return `${from.r}:${to.r}`;
  if (type === "column") return `${toColumnLabel(from.c)}:${toColumnLabel(to.c)}`;
  if (from.r === to.r && from.c === to.c) return toSref(from);
  return `${toSref(from)}:${toSref(to)}`;
}

/**
 * A sheet anchor for `range` on tab `tabId`: the axis ids of its top-left
 * cell plus its spans, which stay put when rows or columns are inserted
 * elsewhere (`docs/design/sheets/axis-id-selection.md`). Null when the
 * top-left cell has no ids yet — a read-only viewer selecting past the
 * written area, where nothing may grow the axis — and the link is then
 * sent document-level rather than pointing somewhere else.
 */
export function sheetChatAnchor({
  tabId,
  tabName,
  range,
  selectionType,
  rowOrder,
  colOrder,
}: {
  tabId: string;
  tabName: string;
  range: Range;
  selectionType?: SelectionType;
  rowOrder: readonly string[];
  colOrder: readonly string[];
}): SheetAnchor | null {
  const [from, to] = normalize(range);
  const rowId = rowOrder[from.r - 1];
  const colId = colOrder[from.c - 1];
  if (!rowId || !colId) return null;
  const where = selectionType === "all" ? "" : `!${rangeText([from, to], selectionType)}`;
  return {
    tabId,
    rowId,
    colId,
    rowSpan: Math.min(to.r - from.r + 1, MAX_ANCHOR_SPAN),
    colSpan: Math.min(to.c - from.c + 1, MAX_ANCHOR_SPAN),
    // Absent means a cell range, so a plain range adds nothing to the URL.
    ...(selectionType && selectionType !== "cell" ? { kind: selectionType } : {}),
    label: clip(`${sheetTabRef(tabName)}${where}`, MAX_ANCHOR_LABEL),
  };
}

/** What "Send to chat" reads off a live sheet editor. */
export interface SheetSendSource {
  getSelectionRangeOrActiveCell(): Range | undefined | null;
  getSelectionType(): SelectionType | undefined;
}

/** The parts of a spreadsheet root "Send to chat" reads. */
export interface SheetSendRoot {
  tabs: Record<string, { name?: string } | undefined>;
  sheets: Record<
    string,
    { rowOrder?: Iterable<string>; colOrder?: Iterable<string> } | undefined
  >;
}

/**
 * The anchor "Send to chat" sends from tab `tabId` of a live sheet: its
 * selection (or active cell), labelled with that tab's name, its axis ids
 * read from that tab's own row and column orders. Null when there is nothing
 * to anchor to, and the link goes out document-level.
 */
export function sheetSendToChatAnchor(
  sheet: SheetSendSource | null | undefined,
  root: SheetSendRoot | null | undefined,
  tabId: string,
): SheetAnchor | null {
  const range = sheet?.getSelectionRangeOrActiveCell();
  const ws = root?.sheets[tabId];
  if (!sheet || !range || !root || !ws) return null;
  return sheetChatAnchor({
    tabId,
    tabName: root.tabs[tabId]?.name ?? "",
    range,
    selectionType: sheet.getSelectionType(),
    rowOrder: Array.from(ws.rowOrder ?? []),
    colOrder: Array.from(ws.colOrder ?? []),
  });
}

/**
 * Where `anchor` is now: its top-left cell found by axis id, its spans
 * counted from there. Null when that row or column has since been deleted.
 */
export function resolveSheetChatAnchor(
  anchor: SheetAnchor,
  rowOrder: string[],
  colOrder: string[],
): Range | null {
  const from = anchorToRef(anchor, rowOrder, colOrder);
  if (!from) return null;
  return [
    from,
    { r: from.r + anchor.rowSpan - 1, c: from.c + anchor.colSpan - 1 },
  ];
}

/**
 * Whether `anchor` was shared as whole rows, whole columns or a cell range,
 * from its `kind`. A whole-sheet share, and an anchor without a kind, is
 * restored as its cell range: `applySelection` has no "all" of its own.
 */
export function sheetAnchorSelectionType(
  anchor: SheetAnchor,
): "cell" | "row" | "column" {
  return anchor.kind === "row" || anchor.kind === "column" ? anchor.kind : "cell";
}
