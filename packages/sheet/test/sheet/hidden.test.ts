import { describe, expect, it } from 'vitest';
import { Sheet } from '../../src/model/sheet';
import { MemStore } from '../../src/store/memory';

describe('Sheet.Hidden', () => {
  // --- hideRows / showRows ---

  it('hides rows and getHiddenRows returns them', async () => {
    const sheet = new Sheet(new MemStore());
    await sheet.hideRows([2, 4]);
    expect(sheet.getHiddenRows()).toEqual(new Set([2, 4]));
    expect(sheet.getUserHiddenRows()).toEqual(new Set([2, 4]));
  });

  it('showRows unhides rows', async () => {
    const sheet = new Sheet(new MemStore());
    await sheet.hideRows([2, 3, 4]);
    await sheet.showRows([3]);
    expect(sheet.getUserHiddenRows()).toEqual(new Set([2, 4]));
  });

  // --- hideColumns / showColumns ---

  it('hides columns and getHiddenColumns returns them', async () => {
    const sheet = new Sheet(new MemStore());
    await sheet.hideColumns([2, 5]);
    expect(sheet.getHiddenColumns()).toEqual(new Set([2, 5]));
  });

  it('showColumns unhides columns', async () => {
    const sheet = new Sheet(new MemStore());
    await sheet.hideColumns([1, 2, 3]);
    await sheet.showColumns([2]);
    expect(sheet.getHiddenColumns()).toEqual(new Set([1, 3]));
  });

  // --- getHiddenRows returns filter ∪ user-hidden ---

  it('getHiddenRows returns union of filter-hidden and user-hidden', async () => {
    const sheet = new Sheet(new MemStore());
    await sheet.setData({ r: 1, c: 1 }, 'Name');
    await sheet.setData({ r: 2, c: 1 }, 'Alice');
    await sheet.setData({ r: 3, c: 1 }, 'Bob');
    await sheet.setData({ r: 4, c: 1 }, 'Charlie');

    // Create filter that hides row 3
    sheet.selectStart({ r: 1, c: 1 });
    sheet.selectEnd({ r: 4, c: 1 });
    expect(await sheet.createFilterFromSelection()).toBe(true);
    await sheet.setColumnFilter(1, { op: 'equals', value: 'Alice' });

    // Manually hide row 4
    await sheet.hideRows([4]);

    const hidden = sheet.getHiddenRows();
    // Row 3 (filter) and row 4 (user) should both be hidden
    expect(hidden.has(3)).toBe(true);
    expect(hidden.has(4)).toBe(true);
  });

  // --- clearFilter does NOT clear user-hidden ---

  it('clearFilter does not clear user-hidden rows', async () => {
    const sheet = new Sheet(new MemStore());
    await sheet.setData({ r: 1, c: 1 }, 'Name');
    await sheet.setData({ r: 2, c: 1 }, 'Alice');
    await sheet.setData({ r: 3, c: 1 }, 'Bob');

    sheet.selectStart({ r: 1, c: 1 });
    sheet.selectEnd({ r: 3, c: 1 });
    await sheet.createFilterFromSelection();
    await sheet.setColumnFilter(1, { op: 'equals', value: 'Alice' });

    // Manually hide row 2
    await sheet.hideRows([2]);

    await sheet.clearFilter();

    // Filter-hidden rows should be cleared, but user-hidden should remain
    expect(sheet.getUserHiddenRows()).toEqual(new Set([2]));
    expect(sheet.getHiddenRows()).toEqual(new Set([2]));
  });

  // --- Navigation skips hidden rows ---

  it('move skips hidden rows', async () => {
    const sheet = new Sheet(new MemStore());
    sheet.setActiveCell({ r: 1, c: 1 });
    await sheet.hideRows([2]);

    sheet.move('down');
    expect(sheet.getActiveCell()).toEqual({ r: 3, c: 1 });

    sheet.move('up');
    expect(sheet.getActiveCell()).toEqual({ r: 1, c: 1 });
  });

  // --- Navigation skips hidden columns ---

  it('move skips hidden columns', async () => {
    const sheet = new Sheet(new MemStore());
    sheet.setActiveCell({ r: 1, c: 1 });
    await sheet.hideColumns([2]);

    sheet.move('right');
    expect(sheet.getActiveCell()).toEqual({ r: 1, c: 3 });

    sheet.move('left');
    expect(sheet.getActiveCell()).toEqual({ r: 1, c: 1 });
  });

  // --- Insert shifts hidden indices ---

  it('inserting rows shifts hidden row indices', async () => {
    const sheet = new Sheet(new MemStore());
    await sheet.hideRows([3, 5]);

    // Insert 2 rows before row 4
    await sheet.insertRows(4, 2);

    // Row 3 stays, row 5 shifts to 7
    expect(sheet.getUserHiddenRows()).toEqual(new Set([3, 7]));
  });

  it('inserting columns shifts hidden column indices', async () => {
    const sheet = new Sheet(new MemStore());
    await sheet.hideColumns([2, 4]);

    // Insert 1 column before column 3
    await sheet.insertColumns(3, 1);

    // Column 2 stays, column 4 shifts to 5
    expect(sheet.getHiddenColumns()).toEqual(new Set([2, 5]));
  });

  // --- Delete shifts hidden indices ---

  it('deleting rows shifts hidden row indices', async () => {
    const sheet = new Sheet(new MemStore());
    await sheet.hideRows([3, 5]);

    // Delete row 2
    await sheet.deleteRows(2, 1);

    // Row 3→2, row 5→4
    expect(sheet.getUserHiddenRows()).toEqual(new Set([2, 4]));
  });

  it('deleting hidden rows removes them', async () => {
    const sheet = new Sheet(new MemStore());
    await sheet.hideRows([3, 5]);

    // Delete rows 3-4
    await sheet.deleteRows(3, 2);

    // Row 3 deleted, row 5→3
    expect(sheet.getUserHiddenRows()).toEqual(new Set([3]));
  });

  // --- Active cell moves off hidden row/column ---

  it('active cell moves off hidden row after hiding', async () => {
    const sheet = new Sheet(new MemStore());
    sheet.setActiveCell({ r: 3, c: 1 });
    await sheet.hideRows([3]);

    // Active cell should move to next visible row
    const ac = sheet.getActiveCell();
    expect(ac.r).not.toBe(3);
  });

  it('active cell moves off hidden column after hiding', async () => {
    const sheet = new Sheet(new MemStore());
    sheet.setActiveCell({ r: 1, c: 3 });
    await sheet.hideColumns([3]);

    const ac = sheet.getActiveCell();
    expect(ac.c).not.toBe(3);
  });

  // --- Store round-trip ---

  it('persists hidden state to store and reloads', async () => {
    const store = new MemStore();
    const sheet1 = new Sheet(store);
    await sheet1.hideRows([2, 5]);
    await sheet1.hideColumns([3]);

    // Create a new sheet with the same store and load
    const sheet2 = new Sheet(store);
    await sheet2.loadHiddenState();

    expect(sheet2.getUserHiddenRows()).toEqual(new Set([2, 5]));
    expect(sheet2.getHiddenColumns()).toEqual(new Set([3]));
  });

  it('clearing all hidden state removes from store', async () => {
    const store = new MemStore();
    const sheet = new Sheet(store);
    await sheet.hideRows([2]);
    await sheet.hideColumns([3]);

    await sheet.showRows([2]);
    await sheet.showColumns([3]);

    const state = await store.getHiddenState();
    expect(state).toBeUndefined();
  });

  // --- resizeRange skips hidden columns ---

  it('resizeRange skips hidden columns', async () => {
    const sheet = new Sheet(new MemStore());
    sheet.setActiveCell({ r: 1, c: 1 });
    await sheet.hideColumns([2]);

    sheet.resizeRange('right');
    const range = sheet.getRange();
    expect(range).toBeDefined();
    // The range end column should skip column 2
    expect(range![1].c).toBe(3);
  });
});
