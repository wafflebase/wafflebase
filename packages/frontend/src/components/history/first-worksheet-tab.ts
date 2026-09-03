import type { SpreadsheetDocument } from '@wafflebase/sheets';

/**
 * The first tab that actually has a worksheet to render.
 *
 * `tabOrder[0]` is not it: a `datasource` or `lakehouse` tab gets a `tabs`
 * entry and a `tabOrder` slot but no `sheets[tabId]` (its rows come from the
 * external query, not from the CRDT), so a workbook whose first tab is one of
 * those has `sheets[tabOrder[0]] === undefined` — and previewing it rendered a
 * banner over an entirely blank pane, which reads as "this version was empty".
 *
 * Lives in its own module rather than in `revision-preview.tsx` so that file
 * exports components only (the frontend's `react-refresh/only-export-components`
 * lint rule is an error at `--max-warnings 0`).
 */
export function firstWorksheetTabId(
  doc: SpreadsheetDocument,
): string | undefined {
  return (doc.tabOrder ?? []).find((tabId) => !!doc.sheets?.[tabId]);
}
