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
