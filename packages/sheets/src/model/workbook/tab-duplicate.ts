import { generateTabId, getUniqueTabName, normalizeTabName } from './tab-name';
import type {
  SpreadsheetDocument,
  TabMeta,
  TabType,
  Worksheet,
} from './worksheet-document';

/**
 * Appends a copy of `tabId` immediately after it, carrying the supplied plain
 * worksheet snapshot as the new tab's content. Shared by the editor's tab
 * menu "Duplicate" and the v1 `POST .../tabs/:tabId/duplicate` route, so both
 * produce the same copy.
 *
 * The snapshot is passed in rather than read here because the source is a
 * Yorkie proxy at the call site and has to be detached first (assigning a
 * proxy into another key would store Yorkie's own `toJSON` string rather than
 * a grid). Comments are dropped, matching what "Make a copy" does to a whole
 * document: a duplicated grid is new content, and carrying a conversation
 * about the original into it attributes remarks to a place they were never
 * made.
 *
 * Two more fields cannot be copied verbatim, because both name a *tab* and a
 * verbatim copy would leave the new tab pointing at the old one:
 *
 * - **Charts** carry a `sourceTabId`, and the editor creates a chart
 *   self-sourced (`sourceTabId: tabId`). Copied as-is, every chart on the
 *   duplicate reads `root.sheets[<original>]` — the source tab's numbers, not
 *   the copy's — so a chart that looked duplicated would silently stop
 *   tracking the grid under it. A chart that sources a *different* tab is left
 *   alone: that reference is still the tab the user chose.
 * - **A pivot definition** is dropped, and with it the `pivot` tab kind. The
 *   copy keeps the materialized cells (so it reads as the snapshot of the
 *   pivot it was taken from) but is a plain sheet. Carrying the definition
 *   would make the copy a second output tab nobody configured, recomputing
 *   over the same source — and deleting that source would then cascade to a
 *   tab the user never asked for.
 */
export function duplicateTab(
  root: SpreadsheetDocument,
  tabId: string,
  worksheet: Worksheet,
  requestedName?: string,
): { id: string; name: string; type: TabType } {
  const source = root.tabs[tabId];
  const preferred =
    normalizeTabName(requestedName ?? '') || `${source.name} (copy)`;
  const name = getUniqueTabName(root.tabs, preferred, 'Sheet');
  const newTabId = generateTabId();
  const type = source.type;

  const meta: TabMeta = { id: newTabId, name, type };
  if (source.kind !== undefined && source.kind !== 'pivot') {
    meta.kind = source.kind;
  }
  if (source.datasourceId !== undefined) meta.datasourceId = source.datasourceId;
  if (source.query !== undefined) meta.query = source.query;
  root.tabs[newTabId] = meta;

  const copy: Worksheet = { ...worksheet, comments: {} };
  if (copy.charts) {
    const charts: NonNullable<Worksheet['charts']> = {};
    for (const [chartId, chart] of Object.entries(copy.charts)) {
      if (!chart || typeof chart !== 'object') continue;
      charts[chartId] =
        chart.sourceTabId === tabId
          ? { ...chart, sourceTabId: newTabId }
          : chart;
    }
    copy.charts = charts;
  }
  delete copy.pivotTable;
  root.sheets[newTabId] = copy;

  const index = root.tabOrder.indexOf(tabId);
  root.tabOrder.splice(
    index === -1 ? root.tabOrder.length : index + 1,
    0,
    newTabId,
  );

  return { id: newTabId, name, type };
}
