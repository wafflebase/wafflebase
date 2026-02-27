import { describe, expect, it } from 'vitest';
import { Sheet } from '../../src/model/sheet';
import { MemStore } from '../../src/store/memory';

class BatchCountingStore extends MemStore {
  public beginBatchCount = 0;
  public endBatchCount = 0;

  beginBatch(): void {
    this.beginBatchCount++;
    super.beginBatch();
  }

  endBatch(): void {
    this.endBatchCount++;
    super.endBatch();
  }

  resetBatchCounts(): void {
    this.beginBatchCount = 0;
    this.endBatchCount = 0;
  }
}

describe('Sheet.Filter', () => {
  it('creates a filter and hides rows that do not match', async () => {
    const sheet = new Sheet(new MemStore());
    await sheet.setData({ r: 1, c: 1 }, 'Name');
    await sheet.setData({ r: 2, c: 1 }, 'Alice');
    await sheet.setData({ r: 3, c: 1 }, 'Bob');
    await sheet.setData({ r: 4, c: 1 }, 'AL');

    sheet.selectStart({ r: 1, c: 1 });
    sheet.selectEnd({ r: 4, c: 1 });
    expect(await sheet.createFilterFromSelection()).toBe(true);

    expect(await sheet.setColumnFilter(1, { op: 'contains', value: 'al' })).toBe(
      true,
    );
    expect(sheet.getHiddenRows()).toEqual(new Set([3]));
  });

  it('expands header-only selection when creating a filter', async () => {
    const sheet = new Sheet(new MemStore());
    await sheet.setData({ r: 1, c: 1 }, 'Name');
    await sheet.setData({ r: 1, c: 2 }, 'Team');
    await sheet.setData({ r: 2, c: 1 }, 'Alice');
    await sheet.setData({ r: 2, c: 2 }, 'Core');
    await sheet.setData({ r: 3, c: 1 }, 'Bob');
    await sheet.setData({ r: 3, c: 2 }, 'Infra');

    sheet.selectStart({ r: 1, c: 1 });
    sheet.selectEnd({ r: 1, c: 2 });

    expect(await sheet.createFilterFromSelection()).toBe(true);
    expect(sheet.getFilterState()?.range).toEqual([
      { r: 1, c: 1 },
      { r: 3, c: 2 },
    ]);
    expect(sheet.getRange()).toEqual([
      { r: 1, c: 1 },
      { r: 3, c: 2 },
    ]);
  });

  it('does not create a filter from header-only selection without data rows', async () => {
    const sheet = new Sheet(new MemStore());
    await sheet.setData({ r: 1, c: 1 }, 'Name');
    await sheet.setData({ r: 1, c: 2 }, 'Team');

    sheet.selectStart({ r: 1, c: 1 });
    sheet.selectEnd({ r: 1, c: 2 });

    expect(await sheet.createFilterFromSelection()).toBe(false);
    expect(sheet.hasFilter()).toBe(false);
  });

  it('expands header-only filter range only through contiguous data rows', async () => {
    const sheet = new Sheet(new MemStore());
    await sheet.setData({ r: 1, c: 1 }, 'Name');
    await sheet.setData({ r: 1, c: 2 }, 'Team');
    await sheet.setData({ r: 2, c: 1 }, 'Alice');
    await sheet.setData({ r: 2, c: 2 }, 'Core');
    await sheet.setData({ r: 4, c: 1 }, 'Bob');
    await sheet.setData({ r: 4, c: 2 }, 'Infra');

    sheet.selectStart({ r: 1, c: 1 });
    sheet.selectEnd({ r: 1, c: 2 });

    expect(await sheet.createFilterFromSelection()).toBe(true);
    expect(sheet.getFilterState()?.range).toEqual([
      { r: 1, c: 1 },
      { r: 2, c: 2 },
    ]);
  });

  it('recomputes filtered rows when edited values change', async () => {
    const sheet = new Sheet(new MemStore());
    await sheet.setData({ r: 1, c: 1 }, 'Status');
    await sheet.setData({ r: 2, c: 1 }, 'Open');
    await sheet.setData({ r: 3, c: 1 }, 'Done');

    sheet.selectStart({ r: 1, c: 1 });
    sheet.selectEnd({ r: 3, c: 1 });
    await sheet.createFilterFromSelection();
    await sheet.setColumnFilter(1, { op: 'equals', value: 'open' });
    expect(sheet.getHiddenRows()).toEqual(new Set([3]));

    await sheet.setData({ r: 3, c: 1 }, 'Open');
    expect(sheet.getHiddenRows()).toEqual(new Set());
  });

  it('clears a single column filter', async () => {
    const sheet = new Sheet(new MemStore());
    await sheet.setData({ r: 1, c: 1 }, 'Team');
    await sheet.setData({ r: 2, c: 1 }, 'Core');
    await sheet.setData({ r: 3, c: 1 }, 'Infra');

    sheet.selectStart({ r: 1, c: 1 });
    sheet.selectEnd({ r: 3, c: 1 });
    await sheet.createFilterFromSelection();
    await sheet.setColumnFilter(1, { op: 'equals', value: 'core' });
    expect(sheet.getHiddenRows()).toEqual(new Set([3]));

    expect(await sheet.clearColumnFilter(1)).toBe(true);
    expect(sheet.getHiddenRows()).toEqual(new Set());
  });

  it('loads persisted filter state from store', async () => {
    const store = new MemStore();
    const source = new Sheet(store);
    await source.setData({ r: 1, c: 1 }, 'Name');
    await source.setData({ r: 2, c: 1 }, 'Alice');
    await source.setData({ r: 3, c: 1 }, 'Bob');
    source.selectStart({ r: 1, c: 1 });
    source.selectEnd({ r: 3, c: 1 });
    await source.createFilterFromSelection();
    await source.setColumnFilter(1, { op: 'equals', value: 'alice' });

    const restored = new Sheet(store);
    await restored.loadFilterState();
    expect(restored.hasFilter()).toBe(true);
    expect(restored.getHiddenRows()).toEqual(new Set([3]));
    expect(restored.getFilterState()?.range).toEqual([
      { r: 1, c: 1 },
      { r: 3, c: 1 },
    ]);
  });

  it('remaps filter criteria when columns are inserted', async () => {
    const sheet = new Sheet(new MemStore());
    await sheet.setData({ r: 1, c: 1 }, 'Name');
    await sheet.setData({ r: 1, c: 2 }, 'Team');
    await sheet.setData({ r: 2, c: 1 }, 'Alice');
    await sheet.setData({ r: 2, c: 2 }, 'Core');
    await sheet.setData({ r: 3, c: 1 }, 'Bob');
    await sheet.setData({ r: 3, c: 2 }, 'Infra');

    sheet.selectStart({ r: 1, c: 1 });
    sheet.selectEnd({ r: 3, c: 2 });
    await sheet.createFilterFromSelection();
    await sheet.setColumnFilter(2, { op: 'equals', value: 'core' });
    expect(sheet.getHiddenRows()).toEqual(new Set([3]));

    await sheet.insertColumns(1, 1);
    const state = sheet.getFilterState();
    expect(state).toBeDefined();
    expect(state?.range).toEqual([
      { r: 1, c: 2 },
      { r: 3, c: 3 },
    ]);
    expect(Object.keys(state?.columns || {})).toEqual(['3']);
  });

  it('filters by explicit included values', async () => {
    const sheet = new Sheet(new MemStore());
    await sheet.setData({ r: 1, c: 1 }, 'Status');
    await sheet.setData({ r: 2, c: 1 }, 'Open');
    await sheet.setData({ r: 3, c: 1 }, 'Done');
    await sheet.setData({ r: 4, c: 1 }, 'Open');

    sheet.selectStart({ r: 1, c: 1 });
    sheet.selectEnd({ r: 4, c: 1 });
    await sheet.createFilterFromSelection();

    const options = await sheet.getFilterColumnValues(1);
    expect(options?.values).toEqual(['Done', 'Open']);
    expect(await sheet.setColumnIncludedValues(1, ['Open'])).toBe(true);
    expect(sheet.getHiddenRows()).toEqual(new Set([3]));
  });

  it('sorts filter rows by column value', async () => {
    const sheet = new Sheet(new MemStore());
    await sheet.setData({ r: 1, c: 1 }, 'Name');
    await sheet.setData({ r: 2, c: 1 }, 'Charlie');
    await sheet.setData({ r: 3, c: 1 }, 'Alice');
    await sheet.setData({ r: 4, c: 1 }, 'Bob');

    sheet.selectStart({ r: 1, c: 1 });
    sheet.selectEnd({ r: 4, c: 1 });
    await sheet.createFilterFromSelection();

    expect(await sheet.sortFilterByColumn(1, 'asc')).toBe(true);
    expect(await sheet.toDisplayString({ r: 2, c: 1 })).toBe('Alice');
    expect(await sheet.toDisplayString({ r: 3, c: 1 })).toBe('Bob');
    expect(await sheet.toDisplayString({ r: 4, c: 1 })).toBe('Charlie');
  });

  it('preserves filter range when sorting', async () => {
    const sheet = new Sheet(new MemStore());
    await sheet.setData({ r: 1, c: 1 }, 'Name');
    await sheet.setData({ r: 2, c: 1 }, 'Charlie');
    await sheet.setData({ r: 3, c: 1 }, 'Alice');
    await sheet.setData({ r: 4, c: 1 }, 'Bob');

    sheet.selectStart({ r: 1, c: 1 });
    sheet.selectEnd({ r: 4, c: 1 });
    await sheet.createFilterFromSelection();

    const rangeBefore = sheet.getFilterRange();
    expect(rangeBefore).toEqual([
      { r: 1, c: 1 },
      { r: 4, c: 1 },
    ]);

    await sheet.sortFilterByColumn(1, 'asc');

    expect(sheet.getFilterRange()).toEqual(rangeBefore);
  });

  it('does not move cells outside filter column range when sorting', async () => {
    const sheet = new Sheet(new MemStore());
    // Filter covers columns 2–3; column 1 and column 4 are outside.
    await sheet.setData({ r: 1, c: 1 }, 'Outside1');
    await sheet.setData({ r: 1, c: 2 }, 'Name');
    await sheet.setData({ r: 1, c: 3 }, 'Score');
    await sheet.setData({ r: 1, c: 4 }, 'Outside2');

    await sheet.setData({ r: 2, c: 1 }, 'X2');
    await sheet.setData({ r: 2, c: 2 }, 'Charlie');
    await sheet.setData({ r: 2, c: 3 }, '30');
    await sheet.setData({ r: 2, c: 4 }, 'Y2');

    await sheet.setData({ r: 3, c: 1 }, 'X3');
    await sheet.setData({ r: 3, c: 2 }, 'Alice');
    await sheet.setData({ r: 3, c: 3 }, '10');
    await sheet.setData({ r: 3, c: 4 }, 'Y3');

    await sheet.setData({ r: 4, c: 1 }, 'X4');
    await sheet.setData({ r: 4, c: 2 }, 'Bob');
    await sheet.setData({ r: 4, c: 3 }, '20');
    await sheet.setData({ r: 4, c: 4 }, 'Y4');

    // Create filter on columns 2–3 only.
    sheet.selectStart({ r: 1, c: 2 });
    sheet.selectEnd({ r: 4, c: 3 });
    expect(await sheet.createFilterFromSelection()).toBe(true);

    // Sort by column 2 (Name) ascending.
    expect(await sheet.sortFilterByColumn(2, 'asc')).toBe(true);

    // Filter columns should be sorted.
    expect(await sheet.toDisplayString({ r: 2, c: 2 })).toBe('Alice');
    expect(await sheet.toDisplayString({ r: 3, c: 2 })).toBe('Bob');
    expect(await sheet.toDisplayString({ r: 4, c: 2 })).toBe('Charlie');
    expect(await sheet.toDisplayString({ r: 2, c: 3 })).toBe('10');
    expect(await sheet.toDisplayString({ r: 3, c: 3 })).toBe('20');
    expect(await sheet.toDisplayString({ r: 4, c: 3 })).toBe('30');

    // Cells outside the filter range should remain untouched.
    expect(await sheet.toDisplayString({ r: 2, c: 1 })).toBe('X2');
    expect(await sheet.toDisplayString({ r: 3, c: 1 })).toBe('X3');
    expect(await sheet.toDisplayString({ r: 4, c: 1 })).toBe('X4');
    expect(await sheet.toDisplayString({ r: 2, c: 4 })).toBe('Y2');
    expect(await sheet.toDisplayString({ r: 3, c: 4 })).toBe('Y3');
    expect(await sheet.toDisplayString({ r: 4, c: 4 })).toBe('Y4');
  });

  it('skips hidden rows when expanding selection range vertically', async () => {
    const sheet = new Sheet(new MemStore());
    await sheet.setData({ r: 1, c: 1 }, 'Status');
    await sheet.setData({ r: 2, c: 1 }, 'Keep');
    await sheet.setData({ r: 3, c: 1 }, 'Hide');
    await sheet.setData({ r: 4, c: 1 }, 'Hide');
    await sheet.setData({ r: 5, c: 1 }, 'Keep');

    sheet.selectStart({ r: 1, c: 1 });
    sheet.selectEnd({ r: 5, c: 1 });
    await sheet.createFilterFromSelection();
    await sheet.setColumnFilter(1, { op: 'equals', value: 'keep' });
    expect(sheet.getHiddenRows()).toEqual(new Set([3, 4]));

    sheet.selectStart({ r: 2, c: 1 });
    expect(sheet.resizeRange('down')).toBe(true);
    expect(sheet.getRange()).toEqual([
      { r: 2, c: 1 },
      { r: 5, c: 1 },
    ]);
  });

  it('uses one batch transaction for filter and sort actions', async () => {
    const store = new BatchCountingStore();
    const sheet = new Sheet(store);
    await sheet.setData({ r: 1, c: 1 }, 'Name');
    await sheet.setData({ r: 2, c: 1 }, 'Charlie');
    await sheet.setData({ r: 3, c: 1 }, 'Alice');
    await sheet.setData({ r: 4, c: 1 }, 'Bob');

    sheet.selectStart({ r: 1, c: 1 });
    sheet.selectEnd({ r: 4, c: 1 });

    store.resetBatchCounts();
    expect(await sheet.createFilterFromSelection()).toBe(true);
    expect(store.beginBatchCount).toBe(1);
    expect(store.endBatchCount).toBe(1);

    store.resetBatchCounts();
    expect(await sheet.setColumnFilter(1, { op: 'contains', value: 'a' })).toBe(
      true,
    );
    expect(store.beginBatchCount).toBe(1);
    expect(store.endBatchCount).toBe(1);

    store.resetBatchCounts();
    expect(await sheet.sortFilterByColumn(1, 'asc')).toBe(true);
    expect(store.beginBatchCount).toBe(1);
    expect(store.endBatchCount).toBe(1);

    store.resetBatchCounts();
    await sheet.clearFilter();
    expect(store.beginBatchCount).toBe(1);
    expect(store.endBatchCount).toBe(1);
  });
});
