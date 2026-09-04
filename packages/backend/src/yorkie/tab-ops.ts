import {
  createWorksheet,
  generateTabId,
  getNextDefaultSheetName,
  getUniqueTabName,
  isTabNameTaken,
  normalizeTabName,
} from '@wafflebase/sheets';
import type {
  SpreadsheetDocument,
  TabMeta,
  TabType,
  Worksheet,
} from '@wafflebase/sheets';

/**
 * Pure tab create/rename operations over the spreadsheet document root.
 *
 * They mutate (create) or validate (rename) a plain `SpreadsheetDocument`
 * shape, so they work both inside a Yorkie `doc.update` (root proxy) and in
 * unit tests over a plain object — no running Yorkie required.
 */

// Fallback base for getUniqueTabName; only used when the requested name is
// empty, which the `requested ?` guard already excludes — so it never
// actually surfaces, but keeps the call well-formed without walking the tab
// map for an unused default name.
const SHEET_NAME_FALLBACK = 'Sheet';

export type TabResult = { id: string; name: string; type: TabType };

/**
 * Appends a new sheet tab: metadata (`tabs`), display order (`tabOrder`) and
 * an empty worksheet (`sheets`) — mirroring the frontend `addSheetTab` path.
 * A requested name is made unique with a numeric suffix; an empty name falls
 * back to the next default `SheetN`.
 */
export function createTab(
  root: SpreadsheetDocument,
  input: { name?: string } = {},
): TabResult {
  const tabs = root.tabs ?? {};
  const requested = normalizeTabName(input.name ?? '');
  const name = requested
    ? getUniqueTabName(tabs, requested, SHEET_NAME_FALLBACK)
    : getNextDefaultSheetName(tabs);
  const type: TabType = 'sheet';
  const tabId = generateTabId();

  root.tabs[tabId] = { id: tabId, name, type };
  root.tabOrder.push(tabId);
  root.sheets[tabId] = createWorksheet();

  return { id: tabId, name, type };
}

export type DeleteResolution =
  | { ok: true; name: string }
  | { ok: false; reason: 'not_found' | 'last_tab' }
  | { ok: false; reason: 'pivot_dependents'; dependents: string[] };

/**
 * Validates a tab delete without mutating.
 *
 * Two refusals, both of which the editor handles with UI an API caller does
 * not have:
 *
 * - **The last tab.** A workbook with no tabs is a state nothing produces;
 *   the tab bar hides its delete entry entirely when one tab is left.
 * - **A pivot output tab that reads from this one.** The editor deletes those
 *   too, after a confirm dialog naming them. Cascading destructive deletes off
 *   a single request instead reports them, so the caller decides.
 */
export function resolveDelete(
  root: SpreadsheetDocument,
  tabId: string,
): DeleteResolution {
  const tab = root.tabs?.[tabId];
  if (!tab) return { ok: false, reason: 'not_found' };

  const order = root.tabOrder ?? [];
  if (order.length <= 1) return { ok: false, reason: 'last_tab' };

  const dependents: string[] = [];
  for (const id of order) {
    if (id === tabId) continue;
    const pivot = root.sheets?.[id]?.pivotTable;
    if (pivot && String(pivot.sourceTabId) === tabId) dependents.push(id);
  }
  if (dependents.length > 0) {
    return { ok: false, reason: 'pivot_dependents', dependents };
  }

  return { ok: true, name: tab.name };
}

/**
 * Removes a tab's three records: its metadata, its display-order entry, and
 * its worksheet. The worksheet is deleted only when it exists — a
 * `datasource` / `lakehouse` tab has metadata and no `sheets` entry.
 */
export function applyDelete(root: SpreadsheetDocument, tabId: string): void {
  delete root.tabs[tabId];
  if (root.sheets?.[tabId]) delete root.sheets[tabId];
  const index = root.tabOrder.indexOf(tabId);
  if (index !== -1) root.tabOrder.splice(index, 1);
}

export type MoveResolution =
  | { ok: true; from: number; to: number }
  | { ok: false; reason: 'not_found' };

/**
 * Resolves a tab move to a pair of 0-based `tabOrder` indices. `position` is
 * 1-based on the wire, matching the row/column endpoints, and clamps to the
 * ends rather than failing — a number past the last tab means "last".
 */
export function resolveMove(
  root: SpreadsheetDocument,
  tabId: string,
  position: number,
): MoveResolution {
  const order = root.tabOrder ?? [];
  const from = order.indexOf(tabId);
  if (from === -1) return { ok: false, reason: 'not_found' };
  const to = Math.min(Math.max(position, 1), order.length) - 1;
  return { ok: true, from, to };
}

export function applyMove(
  root: SpreadsheetDocument,
  from: number,
  to: number,
): void {
  const [moved] = root.tabOrder.splice(from, 1);
  root.tabOrder.splice(to, 0, moved);
}

/**
 * Appends a copy of `tabId` immediately after it, carrying the supplied plain
 * worksheet snapshot as the new tab's content.
 *
 * The snapshot is passed in rather than read here because the source is a
 * Yorkie proxy at the call site and has to be detached first (`unwrapJson`).
 * Comments are dropped, matching what "Make a copy" does to a whole document:
 * a duplicated grid is new content, and carrying a conversation about the
 * original into it attributes remarks to a place they were never made.
 */
export function duplicateTab(
  root: SpreadsheetDocument,
  tabId: string,
  worksheet: Worksheet,
  requestedName?: string,
): TabResult {
  const source = root.tabs[tabId];
  const preferred = normalizeTabName(requestedName ?? '') || `${source.name} (copy)`;
  const name = getUniqueTabName(root.tabs, preferred, SHEET_NAME_FALLBACK);
  const newTabId = generateTabId();
  const type = source.type;

  const meta: TabMeta = { id: newTabId, name, type };
  if (source.kind !== undefined) meta.kind = source.kind;
  if (source.datasourceId !== undefined) meta.datasourceId = source.datasourceId;
  if (source.query !== undefined) meta.query = source.query;
  root.tabs[newTabId] = meta;

  const copy: Worksheet = { ...worksheet, comments: {} };
  root.sheets[newTabId] = copy;

  const index = root.tabOrder.indexOf(tabId);
  root.tabOrder.splice(index === -1 ? root.tabOrder.length : index + 1, 0, newTabId);

  return { id: newTabId, name, type };
}

export type RenameResolution =
  | { ok: true; name: string; type: TabType }
  | { ok: false; reason: 'not_found' | 'blank' | 'conflict' };

/**
 * Validates a tab rename without mutating: 404 (missing), blank (empty after
 * trim), or conflict (name already used by another tab). On success returns
 * the normalized name so the caller can apply it inside `doc.update`.
 */
export function resolveRename(
  tabs: SpreadsheetDocument['tabs'],
  tabId: string,
  rawName: string,
): RenameResolution {
  const tab = tabs?.[tabId];
  if (!tab) return { ok: false, reason: 'not_found' };

  const name = normalizeTabName(rawName ?? '');
  if (!name) return { ok: false, reason: 'blank' };

  if (isTabNameTaken(tabs, name, tabId)) {
    return { ok: false, reason: 'conflict' };
  }

  return { ok: true, name, type: tab.type };
}
