import {
  createWorksheet,
  generateTabId,
  getNextDefaultSheetName,
  getUniqueTabName,
  isTabNameTaken,
  normalizeTabName,
} from '@wafflebase/sheets';
import type { SpreadsheetDocument, TabType } from '@wafflebase/sheets';

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
