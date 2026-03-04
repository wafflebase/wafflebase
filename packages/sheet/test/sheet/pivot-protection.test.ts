import { describe, expect, it } from 'vitest';
import { Sheet } from '../../src/model/sheet';
import { MemStore } from '../../src/store/memory';
import type { PivotTableDefinition } from '../../src/model/types';

const pivotDef: PivotTableDefinition = {
  id: 'p1',
  sourceTabId: 'tab-1',
  sourceRange: 'A1:C5',
  rowFields: [],
  columnFields: [],
  valueFields: [],
  filterFields: [],
  showTotals: { rows: true, columns: true },
};

describe('Pivot sheet protection', () => {
  it('isPivotSheet returns false for normal sheets', async () => {
    const sheet = new Sheet(new MemStore());
    expect(sheet.isPivotSheet()).toBe(false);
  });

  it('isPivotSheet returns true after loading pivot definition', async () => {
    const store = new MemStore();
    await store.setPivotDefinition(pivotDef);
    const sheet = new Sheet(store);
    await sheet.loadPivotDefinition();
    expect(sheet.isPivotSheet()).toBe(true);
  });

  it('blocks setData on pivot sheets', async () => {
    const store = new MemStore();
    await store.setPivotDefinition(pivotDef);
    const sheet = new Sheet(store);
    await sheet.loadPivotDefinition();
    await sheet.setData({ r: 1, c: 1 }, 'test');
    const cell = await store.get({ r: 1, c: 1 });
    expect(cell).toBeUndefined();
  });

  it('blocks removeData on pivot sheets', async () => {
    const store = new MemStore();
    await store.set({ r: 1, c: 1 }, { v: 'existing' });
    await store.setPivotDefinition(pivotDef);
    const sheet = new Sheet(store);
    await sheet.loadPivotDefinition();
    await sheet.removeData();
    const cell = await store.get({ r: 1, c: 1 });
    expect(cell?.v).toBe('existing');
  });

  it('blocks paste on pivot sheets', async () => {
    const store = new MemStore();
    await store.setPivotDefinition(pivotDef);
    const sheet = new Sheet(store);
    await sheet.loadPivotDefinition();
    await sheet.paste({ text: 'pasted' });
    const cell = await store.get({ r: 1, c: 1 });
    expect(cell).toBeUndefined();
  });

  it('allows normal sheets to edit cells', async () => {
    const store = new MemStore();
    const sheet = new Sheet(store);
    await sheet.setData({ r: 1, c: 1 }, 'test');
    const cell = await store.get({ r: 1, c: 1 });
    expect(cell?.v).toBe('test');
  });

  it('getPivotDefinition returns undefined for normal sheets', () => {
    const sheet = new Sheet(new MemStore());
    expect(sheet.getPivotDefinition()).toBeUndefined();
  });

  it('getPivotDefinition returns a clone of the definition', async () => {
    const store = new MemStore();
    await store.setPivotDefinition(pivotDef);
    const sheet = new Sheet(store);
    await sheet.loadPivotDefinition();
    const def = sheet.getPivotDefinition();
    expect(def).toEqual(pivotDef);
    // Verify it's a clone, not the same reference
    expect(def).not.toBe(pivotDef);
  });
});
