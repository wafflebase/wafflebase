import { describe, expect, it } from 'vitest';
import { duplicateTab } from '../../src/model/workbook/tab-duplicate';
import {
  createSpreadsheetDocument,
  createWorksheet,
} from '../../src/model/workbook/worksheet-document';

function docWithTwoTabs() {
  const root = createSpreadsheetDocument();
  root.tabs['tab-2'] = { id: 'tab-2', name: 'Data', type: 'sheet' };
  root.tabOrder.push('tab-2');
  root.sheets['tab-2'] = createWorksheet();
  return root;
}

describe('duplicateTab', () => {
  it('inserts the copy right after the source with a "(copy)" name', () => {
    const root = docWithTwoTabs();
    root.sheets['tab-1'].cells['1:1'] = { v: '42' } as never;

    const copy = duplicateTab(root, 'tab-1', root.sheets['tab-1']);

    expect(copy).toEqual({ id: copy.id, name: 'Sheet1 (copy)', type: 'sheet' });
    expect(root.tabOrder).toEqual(['tab-1', copy.id, 'tab-2']);
    expect(root.sheets[copy.id].cells['1:1']).toEqual({ v: '42' });
  });

  it('uniques a name that collides', () => {
    const root = docWithTwoTabs();
    const first = duplicateTab(root, 'tab-1', root.sheets['tab-1']);
    const second = duplicateTab(root, 'tab-1', root.sheets['tab-1']);
    expect(first.name).toBe('Sheet1 (copy)');
    expect(second.name).not.toBe(first.name);
  });

  it('drops comments and repoints only self-sourced charts', () => {
    const root = docWithTwoTabs();
    root.sheets['tab-1'].comments = { t1: { id: 't1' } as never };
    root.sheets['tab-1'].charts = {
      own: { id: 'own', sourceTabId: 'tab-1', sourceRange: 'A1:B2' } as never,
      foreign: {
        id: 'foreign',
        sourceTabId: 'tab-2',
        sourceRange: 'A1:B2',
      } as never,
    };

    const copy = duplicateTab(root, 'tab-1', root.sheets['tab-1']);

    expect(root.sheets[copy.id].comments).toEqual({});
    expect(root.sheets[copy.id].charts!.own.sourceTabId).toBe(copy.id);
    expect(root.sheets[copy.id].charts!.foreign.sourceTabId).toBe('tab-2');
    expect(root.sheets['tab-1'].charts!.own.sourceTabId).toBe('tab-1');
    expect(root.sheets['tab-1'].comments).toHaveProperty('t1');
  });

  it('turns a pivot output into a plain snapshot sheet', () => {
    const root = docWithTwoTabs();
    root.tabs['tab-2'].kind = 'pivot';
    root.sheets['tab-2'].pivotTable = { sourceTabId: 'tab-1' } as never;

    const copy = duplicateTab(root, 'tab-2', root.sheets['tab-2']);

    expect(root.tabs[copy.id].kind).toBeUndefined();
    expect(root.sheets[copy.id].pivotTable).toBeUndefined();
  });
});
