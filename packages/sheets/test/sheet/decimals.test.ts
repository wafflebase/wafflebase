import { describe, it, expect } from 'vitest';
import { MemStore } from '../../src/store/memory';
import { Sheet } from '../../src/model/worksheet/sheet';
import { formatValue } from '../../src/model/worksheet/format';

describe('Sheet.Decimals', () => {
  it('should leave an empty cell unstyled after increase then decrease', async () => {
    const sheet = new Sheet(new MemStore());
    sheet.selectStart({ r: 1, c: 1 });

    await sheet.changeDecimals(1);
    expect(await sheet.getStyle({ r: 1, c: 1 })).toEqual({
      dp: 1,
      nf: 'number',
    });

    await sheet.changeDecimals(-1);
    expect(await sheet.getStyle({ r: 1, c: 1 })).toBeUndefined();

    // The residue used to pin the cell to zero decimals.
    await sheet.setData({ r: 1, c: 1 }, '12.5');
    expect(await sheet.toDisplayString({ r: 1, c: 1 })).toBe('12.5');
  });

  it('should leave an integer cell unstyled after increase then decrease', async () => {
    const sheet = new Sheet(new MemStore());
    await sheet.setData({ r: 1, c: 1 }, '12');
    sheet.selectStart({ r: 1, c: 1 });

    await sheet.changeDecimals(1);
    expect(await sheet.toDisplayString({ r: 1, c: 1 })).toBe(
      formatValue('12', 'number', 1),
    );

    await sheet.changeDecimals(-1);
    expect(await sheet.getStyle({ r: 1, c: 1 })).toBeUndefined();

    await sheet.setData({ r: 1, c: 1 }, '12.5');
    expect(await sheet.toDisplayString({ r: 1, c: 1 })).toBe('12.5');
  });

  it('should return a decimal cell to its own precision', async () => {
    const sheet = new Sheet(new MemStore());
    await sheet.setData({ r: 1, c: 1 }, '12.5');
    sheet.selectStart({ r: 1, c: 1 });

    await sheet.changeDecimals(1);
    expect(await sheet.getStyle({ r: 1, c: 1 })).toEqual({
      dp: 2,
      nf: 'number',
    });

    await sheet.changeDecimals(-1);
    expect(await sheet.getStyle({ r: 1, c: 1 })).toBeUndefined();

    await sheet.setData({ r: 1, c: 1 }, '12.567');
    expect(await sheet.toDisplayString({ r: 1, c: 1 })).toBe('12.567');
  });

  it('should round trip with equal counts of increase and decrease', async () => {
    const sheet = new Sheet(new MemStore());
    sheet.selectStart({ r: 1, c: 1 });

    for (let i = 0; i < 3; i++) {
      await sheet.changeDecimals(1);
    }
    expect(await sheet.getStyle({ r: 1, c: 1 })).toEqual({
      dp: 3,
      nf: 'number',
    });

    for (let i = 0; i < 3; i++) {
      await sheet.changeDecimals(-1);
    }
    expect(await sheet.getStyle({ r: 1, c: 1 })).toBeUndefined();
  });

  it('should round trip in the decrease-then-increase order', async () => {
    const sheet = new Sheet(new MemStore());
    await sheet.setData({ r: 1, c: 1 }, '1234.5');
    sheet.selectStart({ r: 1, c: 1 });

    await sheet.changeDecimals(-1);
    expect(await sheet.getStyle({ r: 1, c: 1 })).toEqual({
      dp: 0,
      nf: 'number',
    });

    await sheet.changeDecimals(1);
    expect(await sheet.getStyle({ r: 1, c: 1 })).toBeUndefined();
    expect(await sheet.toDisplayString({ r: 1, c: 1 })).toBe('1234.5');
  });

  it('should not write a style when there are no decimals to drop', async () => {
    const store = new MemStore();
    const sheet = new Sheet(store);
    sheet.selectStart({ r: 1, c: 1 });

    await sheet.changeDecimals(-1);
    expect(await sheet.getStyle({ r: 1, c: 1 })).toBeUndefined();
    expect(await store.getRangeStyles()).toEqual([]);
  });

  it('should keep stepping a selection whose active cell is already at zero', async () => {
    const sheet = new Sheet(new MemStore());
    await sheet.setData({ r: 1, c: 1 }, '12.5');
    await sheet.setStyle({ r: 1, c: 1 }, { dp: 0, nf: 'number' });
    await sheet.setData({ r: 1, c: 2 }, '12.567');
    await sheet.setStyle({ r: 1, c: 2 }, { dp: 3, nf: 'number' });
    sheet.selectStart({ r: 1, c: 1 });
    sheet.selectEnd({ r: 1, c: 2 });

    // A1 cannot go below zero, but the rest of the selection still follows it.
    await sheet.changeDecimals(-1);
    expect((await sheet.getStyle({ r: 1, c: 1 }))?.dp).toBe(0);
    expect((await sheet.getStyle({ r: 1, c: 2 }))?.dp).toBe(0);
  });

  it('should clear the range patch for a multi-cell selection', async () => {
    const store = new MemStore();
    const sheet = new Sheet(store);
    sheet.selectStart({ r: 1, c: 1 });
    sheet.selectEnd({ r: 2, c: 2 });

    await sheet.changeDecimals(1);
    expect(await sheet.getStyle({ r: 2, c: 2 })).toEqual({
      dp: 1,
      nf: 'number',
    });

    await sheet.changeDecimals(-1);
    expect(await sheet.getStyle({ r: 2, c: 2 })).toBeUndefined();
    expect(await store.getRangeStyles()).toEqual([]);
  });

  it('should drop cell-level decimal keys and the empty cell with them', async () => {
    const store = new MemStore();
    const sheet = new Sheet(store);
    await sheet.setStyle({ r: 1, c: 1 }, { dp: 1, nf: 'number' });
    sheet.selectStart({ r: 1, c: 1 });

    await sheet.changeDecimals(-1);
    expect(await sheet.getStyle({ r: 1, c: 1 })).toBeUndefined();
    expect(await store.get({ r: 1, c: 1 })).toBeUndefined();
  });

  it('should keep other cell style keys while dropping the decimal keys', async () => {
    const sheet = new Sheet(new MemStore());
    await sheet.setStyle({ r: 1, c: 1 }, { b: true, dp: 1, nf: 'number' });
    sheet.selectStart({ r: 1, c: 1 });

    await sheet.changeDecimals(-1);
    expect(await sheet.getStyle({ r: 1, c: 1 })).toEqual({ b: true });
  });

  it('should keep a number format the user chose', async () => {
    const sheet = new Sheet(new MemStore());
    await sheet.setData({ r: 1, c: 1 }, '12');
    sheet.selectStart({ r: 1, c: 1 });
    await sheet.setRangeStyle({ nf: 'number' });

    // The format renders 2 decimals on its own, so increase/decrease around it
    // leaves the format alone.
    await sheet.changeDecimals(1);
    expect(await sheet.getStyle({ r: 1, c: 1 })).toEqual({
      dp: 3,
      nf: 'number',
    });

    await sheet.changeDecimals(-1);
    expect((await sheet.getStyle({ r: 1, c: 1 }))?.nf).toBe('number');
    expect(await sheet.toDisplayString({ r: 1, c: 1 })).toBe(
      formatValue('12', 'number', 2),
    );
  });

  it('should write an explicit value when a column style sets decimals', async () => {
    const store = new MemStore();
    const sheet = new Sheet(store);
    sheet.selectColumn(1);
    await sheet.setRangeStyle({ dp: 1, nf: 'number' });

    // A1 cannot unset what column 1 inherits down, so it stores dp: 0 instead.
    sheet.selectStart({ r: 1, c: 1 });
    await sheet.changeDecimals(-1);
    expect(await sheet.getStyle({ r: 1, c: 1 })).toEqual({
      dp: 0,
      nf: 'number',
    });
    expect(await sheet.getStyle({ r: 5, c: 1 })).toEqual({
      dp: 1,
      nf: 'number',
    });
  });

  it('should round trip a column selection', async () => {
    const store = new MemStore();
    const sheet = new Sheet(store);
    sheet.selectColumn(1);

    await sheet.changeDecimals(1);
    expect(await sheet.getStyle({ r: 1, c: 1 })).toEqual({
      dp: 1,
      nf: 'number',
    });

    await sheet.changeDecimals(-1);
    const style = await sheet.getStyle({ r: 1, c: 1 });
    expect(style?.dp).toBeUndefined();
    expect(style?.nf).toBeUndefined();
  });

  it('should report the value precision and whether dp is stored', async () => {
    const sheet = new Sheet(new MemStore());
    await sheet.setData({ r: 1, c: 1 }, '12.34');
    sheet.selectStart({ r: 1, c: 1 });

    expect(await sheet.getActiveDecimalState()).toEqual({
      dp: 2,
      nf: undefined,
      valueDp: 2,
      explicitDp: false,
    });

    await sheet.setRangeStyle({ dp: 4, nf: 'number' });
    expect(await sheet.getActiveDecimalState()).toEqual({
      dp: 4,
      nf: 'number',
      valueDp: 2,
      explicitDp: true,
    });
  });
});
