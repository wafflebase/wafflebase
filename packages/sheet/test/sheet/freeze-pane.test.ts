import { describe, it, expect } from 'vitest';
import { MemStore } from '../../src/store/memory';
import { Sheet } from '../../src/model/sheet';
import { DimensionIndex } from '../../src/model/dimensions';
import { buildFreezeState, NoFreeze, toRefWithFreeze } from '../../src/view/layout';

describe('Sheet.FreezePane', () => {
  it('should default to no freeze', () => {
    const sheet = new Sheet(new MemStore());
    const freeze = sheet.getFreezePane();
    expect(freeze.frozenRows).toBe(0);
    expect(freeze.frozenCols).toBe(0);
  });

  it('should set and get freeze pane', async () => {
    const sheet = new Sheet(new MemStore());
    await sheet.setFreezePane(2, 1);
    const freeze = sheet.getFreezePane();
    expect(freeze.frozenRows).toBe(2);
    expect(freeze.frozenCols).toBe(1);
  });

  it('should unfreeze all', async () => {
    const sheet = new Sheet(new MemStore());
    await sheet.setFreezePane(3, 2);
    await sheet.setFreezePane(0, 0);
    const freeze = sheet.getFreezePane();
    expect(freeze.frozenRows).toBe(0);
    expect(freeze.frozenCols).toBe(0);
  });

  it('should load freeze pane from store', async () => {
    const store = new MemStore();
    await store.setFreezePane(5, 3);

    const sheet = new Sheet(store);
    await sheet.loadFreezePane();
    const freeze = sheet.getFreezePane();
    expect(freeze.frozenRows).toBe(5);
    expect(freeze.frozenCols).toBe(3);
  });

  it('should adjust frozenRows when inserting rows within frozen area', async () => {
    const sheet = new Sheet(new MemStore());
    await sheet.setFreezePane(3, 0);

    // Insert 2 rows at index 2 (within frozen area)
    await sheet.insertRows(2, 2);
    const freeze = sheet.getFreezePane();
    expect(freeze.frozenRows).toBe(5);
  });

  it('should not adjust frozenRows when inserting rows after frozen area', async () => {
    const sheet = new Sheet(new MemStore());
    await sheet.setFreezePane(3, 0);

    // Insert 2 rows at index 5 (after frozen area)
    await sheet.insertRows(5, 2);
    const freeze = sheet.getFreezePane();
    expect(freeze.frozenRows).toBe(3);
  });

  it('should adjust frozenRows when deleting rows within frozen area', async () => {
    const sheet = new Sheet(new MemStore());
    await sheet.setFreezePane(3, 0);

    // Delete 1 row at index 2 (within frozen area)
    await sheet.deleteRows(2, 1);
    const freeze = sheet.getFreezePane();
    expect(freeze.frozenRows).toBe(2);
  });

  it('should remove freeze when all frozen rows are deleted', async () => {
    const sheet = new Sheet(new MemStore());
    await sheet.setFreezePane(2, 0);

    // Delete 2 rows at index 1 (all frozen rows)
    await sheet.deleteRows(1, 2);
    const freeze = sheet.getFreezePane();
    expect(freeze.frozenRows).toBe(0);
  });

  it('should adjust frozenCols when inserting columns within frozen area', async () => {
    const sheet = new Sheet(new MemStore());
    await sheet.setFreezePane(0, 2);

    // Insert 1 column at index 1 (within frozen area)
    await sheet.insertColumns(1, 1);
    const freeze = sheet.getFreezePane();
    expect(freeze.frozenCols).toBe(3);
  });

  it('should adjust frozenCols when deleting columns within frozen area', async () => {
    const sheet = new Sheet(new MemStore());
    await sheet.setFreezePane(0, 3);

    // Delete 1 column at index 2 (within frozen area)
    await sheet.deleteColumns(2, 1);
    const freeze = sheet.getFreezePane();
    expect(freeze.frozenCols).toBe(2);
  });

  it('should not adjust frozenCols when deleting columns after frozen area', async () => {
    const sheet = new Sheet(new MemStore());
    await sheet.setFreezePane(0, 3);

    // Delete 1 column at index 5 (after frozen area)
    await sheet.deleteColumns(5, 1);
    const freeze = sheet.getFreezePane();
    expect(freeze.frozenCols).toBe(3);
  });
});

describe('MemStore.FreezePane', () => {
  it('should persist freeze pane state', async () => {
    const store = new MemStore();
    expect(await store.getFreezePane()).toEqual({ frozenRows: 0, frozenCols: 0 });

    await store.setFreezePane(2, 1);
    expect(await store.getFreezePane()).toEqual({ frozenRows: 2, frozenCols: 1 });

    await store.setFreezePane(0, 0);
    expect(await store.getFreezePane()).toEqual({ frozenRows: 0, frozenCols: 0 });
  });
});

describe('buildFreezeState', () => {
  it('should return NoFreeze for zero frozen rows and cols', () => {
    const rowDim = new DimensionIndex(23);
    const colDim = new DimensionIndex(100);
    const state = buildFreezeState(0, 0, rowDim, colDim);
    expect(state).toBe(NoFreeze);
  });

  it('should compute frozenWidth and frozenHeight', () => {
    const rowDim = new DimensionIndex(23);
    const colDim = new DimensionIndex(100);
    const state = buildFreezeState(2, 1, rowDim, colDim);
    expect(state.frozenRows).toBe(2);
    expect(state.frozenCols).toBe(1);
    // 2 rows at 23px each = offset(3) = 46
    expect(state.frozenHeight).toBe(46);
    // 1 col at 100px = offset(2) = 100
    expect(state.frozenWidth).toBe(100);
  });

  it('should handle freeze rows only', () => {
    const rowDim = new DimensionIndex(23);
    const colDim = new DimensionIndex(100);
    const state = buildFreezeState(3, 0, rowDim, colDim);
    expect(state.frozenRows).toBe(3);
    expect(state.frozenCols).toBe(0);
    expect(state.frozenHeight).toBe(69);
    expect(state.frozenWidth).toBe(0);
  });

  it('should handle freeze cols only', () => {
    const rowDim = new DimensionIndex(23);
    const colDim = new DimensionIndex(100);
    const state = buildFreezeState(0, 2, rowDim, colDim);
    expect(state.frozenRows).toBe(0);
    expect(state.frozenCols).toBe(2);
    expect(state.frozenHeight).toBe(0);
    expect(state.frozenWidth).toBe(200);
  });
});

describe('toRefWithFreeze', () => {
  const rowDim = new DimensionIndex(23); // 23px per row
  const colDim = new DimensionIndex(100); // 100px per col

  it('should map coordinates in frozen area (Quadrant A)', () => {
    const freeze = buildFreezeState(2, 1, rowDim, colDim);
    // Click at (60, 30) — within RowHeaderWidth(50) + frozenWidth(100) = 150
    // and within DefaultCellHeight(23) + frozenHeight(46) = 69
    const ref = toRefWithFreeze(60, 30, { left: 500, top: 500 }, rowDim, colDim, freeze);
    // x=60: in frozen cols, absX = 60-50 = 10, col = findIndex(10) = 1
    // y=30: in frozen rows, absY = 30-23 = 7, row = findIndex(7) = 1
    expect(ref.r).toBe(1);
    expect(ref.c).toBe(1);
  });

  it('should map coordinates in unfrozen area (Quadrant D) with scroll', () => {
    const freeze = buildFreezeState(2, 1, rowDim, colDim);
    // Click at (200, 100) — beyond frozen region
    // x=200: not in frozen cols (200 > 50+100=150)
    //   absX = (200-50-100) + colDim.getOffset(2) + scroll.left = 50 + 100 + 100 = 250
    //   col = findIndex(250) = 3 (0-based offset: 0=col1, 100=col2, 200=col3)
    // y=100: not in frozen rows (100 > 23+46=69)
    //   absY = (100-23-46) + rowDim.getOffset(3) + scroll.top = 31 + 46 + 50 = 127
    //   row = findIndex(127) = 6 (0-based offset: 0..22=row1, 23..45=row2, ..., 115..137=row6)
    const ref = toRefWithFreeze(200, 100, { left: 100, top: 50 }, rowDim, colDim, freeze);
    expect(ref.c).toBe(3);
    expect(ref.r).toBe(6);
  });
});
