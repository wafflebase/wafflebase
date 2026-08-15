import { createSpreadsheetDocument } from '@wafflebase/sheets';
import type { SpreadsheetDocument } from '@wafflebase/sheets';
import { createTab, resolveRename } from './tab-ops';

function baseDoc(): SpreadsheetDocument {
  // { tab-1: "Sheet1" }
  return createSpreadsheetDocument();
}

describe('createTab', () => {
  it('appends metadata, order and an empty worksheet', () => {
    const root = baseDoc();
    const res = createTab(root, { name: 'History' });

    expect(res.name).toBe('History');
    expect(res.type).toBe('sheet');
    expect(root.tabs[res.id]).toEqual({
      id: res.id,
      name: 'History',
      type: 'sheet',
    });
    expect(root.tabOrder).toContain(res.id);
    expect(root.tabOrder[root.tabOrder.length - 1]).toBe(res.id);
    expect(root.sheets[res.id]).toBeDefined();
    expect(root.sheets[res.id].cells).toEqual({});
  });

  it('falls back to the next default SheetN when no name is given', () => {
    const root = baseDoc(); // already has "Sheet1"
    const res = createTab(root);
    expect(res.name).toBe('Sheet2');
  });

  it('suffixes a duplicate requested name instead of colliding', () => {
    const root = baseDoc();
    createTab(root, { name: 'History' });
    const second = createTab(root, { name: 'History' });
    expect(second.name).toBe('History (2)');
  });

  it('generates distinct tab ids', () => {
    const root = baseDoc();
    const a = createTab(root);
    const b = createTab(root);
    expect(a.id).not.toBe(b.id);
  });
});

describe('resolveRename', () => {
  it('resolves a valid rename to the normalized name', () => {
    const root = baseDoc();
    const res = resolveRename(root.tabs, 'tab-1', '  Summary  ');
    expect(res).toEqual({ ok: true, name: 'Summary', type: 'sheet' });
  });

  it('reports not_found for a missing tab', () => {
    const root = baseDoc();
    expect(resolveRename(root.tabs, 'tab-nope', 'X')).toEqual({
      ok: false,
      reason: 'not_found',
    });
  });

  it('reports blank for an empty / whitespace name', () => {
    const root = baseDoc();
    expect(resolveRename(root.tabs, 'tab-1', '   ')).toEqual({
      ok: false,
      reason: 'blank',
    });
  });

  it('reports conflict when another tab already has the name', () => {
    const root = baseDoc();
    const other = createTab(root, { name: 'History' });
    // renaming tab-1 to an existing sibling name conflicts
    expect(resolveRename(root.tabs, 'tab-1', 'History')).toEqual({
      ok: false,
      reason: 'conflict',
    });
    // renaming the tab to its own (case-different) name is allowed
    expect(resolveRename(root.tabs, other.id, 'HISTORY')).toEqual({
      ok: true,
      name: 'HISTORY',
      type: 'sheet',
    });
  });
});
