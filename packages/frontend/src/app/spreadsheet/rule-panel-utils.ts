import { Range, isIntersectRanges, parseRef, toSref } from "@wafflebase/sheets";

/**
 * Shared helpers for the range-scoped rule panels (conditional formatting and
 * data validation): A1 range parsing, and deciding what a panel shows when it
 * opens.
 */

/**
 * `parseA1Ranges` reads a comma-separated list of A1 ranges (`A1:B10, D1:E10`),
 * normalizing each to top-left / bottom-right. Returns null on any malformed
 * segment so a typo never applies a partial range.
 */
export function parseA1Ranges(input: string): Range[] | null {
  const segments = input
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (segments.length === 0) {
    return null;
  }

  const ranges: Range[] = [];
  for (const segment of segments) {
    const tokens = segment
      .toUpperCase()
      .replace(/\$/g, "")
      .split(":")
      .map((token) => token.trim())
      .filter(Boolean);
    if (tokens.length !== 2) {
      return null;
    }
    try {
      const a = parseRef(tokens[0]);
      const b = parseRef(tokens[1]);
      ranges.push([
        { r: Math.min(a.r, b.r), c: Math.min(a.c, b.c) },
        { r: Math.max(a.r, b.r), c: Math.max(a.c, b.c) },
      ]);
    } catch {
      return null;
    }
  }
  return ranges;
}

/**
 * `formatA1Ranges` is the inverse of `parseA1Ranges`.
 */
export function formatA1Ranges(ranges: Range[]): string {
  return ranges.map((r) => `${toSref(r[0])}:${toSref(r[1])}`).join(", ");
}

/**
 * The part of the `Spreadsheet` API `selectionToA1` reads.
 */
export type SelectionSource = {
  getSelectionType(): string | undefined;
  getSelectionRanges(): Range[];
  getSelectionRangeOrActiveCell(): Range | undefined;
};

/**
 * `selectionToA1` formats the current cell selection as the A1 text the
 * range-scoped side panels (chart, conditional formatting, data validation)
 * read. A plain click leaves no drag range — the selection is only the active
 * cell — so this falls back to that cell (or the merge covering it) rather
 * than reporting no selection; otherwise the most common case, one selected
 * cell, could never seed a rule. Returns null for a row/column/all selection.
 */
export function selectionToA1(sheet: SelectionSource): string | null {
  if (sheet.getSelectionType() !== "cell") {
    return null;
  }
  const ranges = sheet.getSelectionRanges();
  if (ranges.length > 0) {
    return formatA1Ranges(ranges);
  }
  const active = sheet.getSelectionRangeOrActiveCell();
  return active ? formatA1Ranges([active]) : null;
}

export type PanelOpening =
  | { kind: "existing"; ruleId: string }
  | { kind: "draft"; ranges: Range[] }
  | { kind: "none" };

/**
 * `panelOpeningFor` decides what a rule panel starts on, the way Google Sheets
 * does: a rule that already covers the selection is selected; a selection no
 * rule covers starts a new, unsaved rule for exactly that selection; with no
 * usable selection the panel opens on its list.
 */
export function panelOpeningFor(
  rules: ReadonlyArray<{ id: string; ranges: Range[] }>,
  selection: string | null,
): PanelOpening {
  const ranges = selection ? parseA1Ranges(selection) : null;
  if (!ranges) {
    return { kind: "none" };
  }
  const covering = rules.find((rule) => isIntersectRanges(rule.ranges, ranges));
  if (covering) {
    return { kind: "existing", ruleId: covering.id };
  }
  return { kind: "draft", ranges };
}
