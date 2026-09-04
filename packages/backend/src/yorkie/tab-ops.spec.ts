import { createSpreadsheetDocument } from '@wafflebase/sheets';
import type { SpreadsheetDocument } from '@wafflebase/sheets';
import {
  applyDelete,
  applyMove,
  createTab,
  duplicateTab,
  resolveDelete,
  resolveMove,
  resolveRename,
} from './tab-ops';

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

describe('resolveDelete / applyDelete', () => {
  it('resolves a delete when another tab remains', () => {
    const root = baseDoc();
    const extra = createTab(root, { name: 'History' });
    expect(resolveDelete(root, extra.id)).toEqual({ ok: true, name: 'History' });
  });

  it('refuses the last remaining tab', () => {
    const root = baseDoc();
    expect(resolveDelete(root, 'tab-1')).toEqual({
      ok: false,
      reason: 'last_tab',
    });
  });

  it('reports not_found for an unknown tab', () => {
    const root = baseDoc();
    createTab(root);
    expect(resolveDelete(root, 'tab-nope')).toEqual({
      ok: false,
      reason: 'not_found',
    });
  });

  it('names the pivot output tabs that read from it instead of cascading', () => {
    const root = baseDoc();
    const pivot = createTab(root, { name: 'Pivot' });
    root.sheets[pivot.id].pivotTable = {
      sourceTabId: 'tab-1',
    } as never;

    expect(resolveDelete(root, 'tab-1')).toEqual({
      ok: false,
      reason: 'pivot_dependents',
      dependents: [pivot.id],
    });
  });

  it('removes metadata, order and the worksheet', () => {
    const root = baseDoc();
    const extra = createTab(root, { name: 'History' });
    applyDelete(root, extra.id);

    expect(root.tabs[extra.id]).toBeUndefined();
    expect(root.sheets[extra.id]).toBeUndefined();
    expect(root.tabOrder).toEqual(['tab-1']);
  });
});

describe('resolveMove / applyMove', () => {
  it('converts a 1-based position to a pair of array indices', () => {
    const root = baseDoc();
    const second = createTab(root);
    expect(resolveMove(root, second.id, 1)).toEqual({ ok: true, from: 1, to: 0 });
  });

  it('clamps a position past the end to the last slot', () => {
    const root = baseDoc();
    createTab(root);
    expect(resolveMove(root, 'tab-1', 99)).toEqual({ ok: true, from: 0, to: 1 });
  });

  it('reports not_found for an unknown tab', () => {
    const root = baseDoc();
    expect(resolveMove(root, 'tab-nope', 1)).toEqual({
      ok: false,
      reason: 'not_found',
    });
  });

  it('reorders tabOrder and nothing else', () => {
    const root = baseDoc();
    const second = createTab(root, { name: 'History' });
    applyMove(root, 1, 0);
    expect(root.tabOrder).toEqual([second.id, 'tab-1']);
    expect(Object.keys(root.tabs).sort()).toEqual(
      [second.id, 'tab-1'].sort(),
    );
  });
});

describe('duplicateTab', () => {
  it('inserts the copy right after the source with a uniqued name', () => {
    const root = baseDoc();
    root.sheets['tab-1'].cells['1:1'] = { v: '42' } as never;
    createTab(root, { name: 'Last' });

    const copy = duplicateTab(root, 'tab-1', root.sheets['tab-1']);

    expect(copy.name).toBe('Sheet1 (copy)');
    expect(root.tabOrder[1]).toBe(copy.id);
    expect(root.sheets[copy.id].cells['1:1']).toEqual({ v: '42' });
  });

  it('honours a requested name and uniques a collision', () => {
    const root = baseDoc();
    const copy = duplicateTab(root, 'tab-1', root.sheets['tab-1'], 'Sheet1');
    expect(copy.name).toBe('Sheet1 (2)');
  });

  it('does not carry the source comments into the copy', () => {
    const root = baseDoc();
    root.sheets['tab-1'].comments = {
      't1': {
        id: 't1',
        anchor: { kind: 'sheet-cell', tabId: 'tab-1', rowId: 'r1', colId: 'c1' },
        comments: [],
        resolved: false,
        createdAt: 1,
      } as never,
    };

    const copy = duplicateTab(root, 'tab-1', root.sheets['tab-1']);
    expect(root.sheets[copy.id].comments).toEqual({});
    expect(root.sheets['tab-1'].comments).toHaveProperty('t1');
  });
});
