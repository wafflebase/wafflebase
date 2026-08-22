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
    await sheet.setData({ r: 1, c: 1 }, '12.5');
    sheet.selectStart({ r: 1, c: 1 });

    await sheet.changeDecimals(-1);
    expect(await sheet.getStyle({ r: 1, c: 1 })).toEqual({
      dp: 0,
      nf: 'number',
    });

    await sheet.changeDecimals(1);
    expect(await sheet.getStyle({ r: 1, c: 1 })).toBeUndefined();
    expect(await sheet.toDisplayString({ r: 1, c: 1 })).toBe('12.5');
  });

  it('should keep the grouping separators the step would flatten', async () => {
    const sheet = new Sheet(new MemStore());
    await sheet.setData({ r: 1, c: 1 }, '1234.5');
    sheet.selectStart({ r: 1, c: 1 });

    await sheet.changeDecimals(-1);
    await sheet.changeDecimals(1);

    // Unsetting would drop `nf: 'number'` and with it the grouping the cell
    // shows right now ('1,234.5' → '1234.5'), so the format stays and the step
    // is written explicitly.
    expect(await sheet.getStyle({ r: 1, c: 1 })).toEqual({
      dp: 1,
      nf: 'number',
    });
    expect(await sheet.toDisplayString({ r: 1, c: 1 })).toBe(
      formatValue('1234.5', 'number', 1),
    );
  });

  it('should keep a grouped number format the user chose', async () => {
    const sheet = new Sheet(new MemStore());
    await sheet.setData({ r: 1, c: 1 }, '1234.5');
    sheet.selectStart({ r: 1, c: 1 });
    await sheet.setRangeStyle({ dp: 0, nf: 'number' });

    // The step lands on the value's own precision, but restoring inheritance
    // would take the user's number format — and its separators — with it.
    await sheet.changeDecimals(1);
    expect(await sheet.getStyle({ r: 1, c: 1 })).toEqual({
      dp: 1,
      nf: 'number',
    });
  });

  it('should keep a currency format whose decimals it cannot restore', async () => {
    const sheet = new Sheet(new MemStore());
    await sheet.setData({ r: 1, c: 1 }, '1.5');
    sheet.selectStart({ r: 1, c: 1 });
    await sheet.setRangeStyle({ dp: 0, nf: 'currency', cu: 'USD' });

    // An absent `dp` means the currency format's own two decimals, not the
    // value's one, so the unset would *increase* what is on screen.
    await sheet.changeDecimals(1);
    expect(await sheet.getStyle({ r: 1, c: 1 })).toEqual({
      dp: 1,
      nf: 'currency',
      cu: 'USD',
    });
  });

  it('should still step a selection whose active cell has no decimals', async () => {
    const sheet = new Sheet(new MemStore());
    await sheet.setData({ r: 1, c: 1 }, '12');
    await sheet.setData({ r: 1, c: 2 }, '1.2345');
    sheet.selectStart({ r: 1, c: 1 });
    sheet.selectEnd({ r: 1, c: 2 });

    // A1 has nothing to drop, but B1 does — the step is not a no-op just
    // because the active cell is already at zero decimals.
    await sheet.changeDecimals(-1);
    expect(await sheet.toDisplayString({ r: 1, c: 2 })).toBe(
      formatValue('1.2345', 'number', 0),
    );
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

  it('should not strip a format another cell in the selection carries', async () => {
    const sheet = new Sheet(new MemStore());
    await sheet.setData({ r: 1, c: 2 }, '5');
    await sheet.setStyle({ r: 1, c: 2 }, { nf: 'currency', cu: 'USD' });

    sheet.selectStart({ r: 1, c: 1 });
    await sheet.changeDecimals(1);

    // B1 disagrees about `nf`, so the unset is refused for the whole selection
    // and the currency format survives.
    sheet.selectStart({ r: 1, c: 1 });
    sheet.selectEnd({ r: 1, c: 2 });
    await sheet.changeDecimals(-1);
    const style = await sheet.getStyle({ r: 1, c: 2 });
    expect(style?.nf).toBe('currency');
    expect(style?.cu).toBe('USD');
  });

  it('should not strip a format a sheet-wide step would reach', async () => {
    const sheet = new Sheet(new MemStore());
    await sheet.setData({ r: 3, c: 3 }, '0.25');
    await sheet.setStyle({ r: 3, c: 3 }, { nf: 'percent' });

    sheet.selectAllCells();
    await sheet.changeDecimals(1);
    await sheet.changeDecimals(-1);

    expect((await sheet.getStyle({ r: 3, c: 3 }))?.nf).toBe('percent');
  });

  it('should not strip decimals another cell in the selection set deeper', async () => {
    const sheet = new Sheet(new MemStore());
    await sheet.setData({ r: 1, c: 2 }, '1.23456');
    await sheet.setStyle({ r: 1, c: 2 }, { dp: 5, nf: 'number' });

    sheet.selectStart({ r: 1, c: 1 });
    await sheet.changeDecimals(1);

    // B1 sits at a different `dp`, so the selection takes the explicit write
    // rather than unsetting B1's own decimals along with A1's.
    sheet.selectStart({ r: 1, c: 1 });
    sheet.selectEnd({ r: 1, c: 2 });
    await sheet.changeDecimals(-1);
    expect(await sheet.getStyle({ r: 1, c: 2 })).toEqual({
      dp: 0,
      nf: 'number',
    });
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

  it('should round trip a row selection', async () => {
    const sheet = new Sheet(new MemStore());
    sheet.selectRow(1);

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

  it('should round trip a whole-sheet selection', async () => {
    const sheet = new Sheet(new MemStore());
    sheet.selectAllCells();

    await sheet.changeDecimals(1);
    expect(await sheet.getStyle({ r: 2, c: 2 })).toEqual({
      dp: 1,
      nf: 'number',
    });

    await sheet.changeDecimals(-1);
    const style = await sheet.getStyle({ r: 2, c: 2 });
    expect(style?.dp).toBeUndefined();
    expect(style?.nf).toBeUndefined();
  });

  it('should write an explicit value when a row style sets decimals', async () => {
    const sheet = new Sheet(new MemStore());
    sheet.selectRow(1);
    await sheet.setRangeStyle({ dp: 1, nf: 'number' });

    // A1 cannot unset what row 1 inherits across, so it stores dp: 0 instead.
    sheet.selectStart({ r: 1, c: 1 });
    await sheet.changeDecimals(-1);
    expect(await sheet.getStyle({ r: 1, c: 1 })).toEqual({
      dp: 0,
      nf: 'number',
    });
    expect(await sheet.getStyle({ r: 1, c: 5 })).toEqual({
      dp: 1,
      nf: 'number',
    });
  });

  it('should write an explicit value when a sheet style sets decimals', async () => {
    const sheet = new Sheet(new MemStore());
    sheet.selectAllCells();
    await sheet.setRangeStyle({ dp: 1, nf: 'number' });

    sheet.selectStart({ r: 2, c: 2 });
    await sheet.changeDecimals(-1);
    expect(await sheet.getStyle({ r: 2, c: 2 })).toEqual({
      dp: 0,
      nf: 'number',
    });
    expect(await sheet.getStyle({ r: 4, c: 4 })).toEqual({
      dp: 1,
      nf: 'number',
    });
  });

  it('should refuse a column unset when another column disagrees', async () => {
    const sheet = new Sheet(new MemStore());
    sheet.selectColumn(1);
    await sheet.setRangeStyle({ dp: 1, nf: 'number' });
    sheet.selectColumn(2);
    await sheet.setRangeStyle({ dp: 3, nf: 'number' });

    // Column 2 sits at a different dp, so both columns take the explicit write
    // rather than losing their format to column 1's unset.
    sheet.selectColumn(1);
    sheet.selectColumnRange(1, 2);
    await sheet.changeDecimals(-1);
    expect(await sheet.getStyle({ r: 1, c: 1 })).toEqual({
      dp: 0,
      nf: 'number',
    });
    expect(await sheet.getStyle({ r: 1, c: 2 })).toEqual({
      dp: 0,
      nf: 'number',
    });
  });

  it('should refuse a sheet-wide unset when a cell holds deeper decimals', async () => {
    const sheet = new Sheet(new MemStore());
    await sheet.setData({ r: 3, c: 3 }, '25');
    await sheet.setStyle({ r: 3, c: 3 }, { dp: 4, nf: 'number' });

    sheet.selectAllCells();
    await sheet.changeDecimals(1);
    await sheet.changeDecimals(-1);

    // C3 disagrees about `dp`, so the sheet style takes the explicit write and
    // C3 keeps the decimals it was given.
    expect((await sheet.getStyle({ r: 3, c: 3 }))?.dp).toBe(4);
    expect((await sheet.getStyle({ r: 1, c: 1 }))?.dp).toBe(0);
  });

  it('should keep a zero-decimal format when decrease has no room left', async () => {
    const sheet = new Sheet(new MemStore());
    await sheet.setData({ r: 1, c: 1 }, '1234');
    sheet.selectStart({ r: 1, c: 1 });
    await sheet.setRangeStyle({ dp: 0, nf: 'number' });

    // Decrease at the floor reverses nothing, so it must not take the format
    // with it — the cell keeps rendering grouped and without decimals.
    await sheet.changeDecimals(-1);
    expect(await sheet.getStyle({ r: 1, c: 1 })).toEqual({
      dp: 0,
      nf: 'number',
    });
    expect(await sheet.toDisplayString({ r: 1, c: 1 })).toBe(
      formatValue('1234', 'number', 0),
    );
  });

  it('should not strip a number format from a cell that stores no decimals', async () => {
    const sheet = new Sheet(new MemStore());
    await sheet.setData({ r: 1, c: 2 }, '5');
    await sheet.setStyle({ r: 1, c: 2 }, { nf: 'number' });

    sheet.selectStart({ r: 1, c: 1 });
    await sheet.changeDecimals(1);

    // B1 carries `nf` with no `dp` beside it, so it is none of the unset's
    // business and keeps the format the user chose.
    sheet.selectStart({ r: 1, c: 1 });
    sheet.selectEnd({ r: 1, c: 2 });
    await sheet.changeDecimals(-1);
    expect((await sheet.getStyle({ r: 1, c: 2 }))?.nf).toBe('number');
  });

  it('should follow the step when the selection disagrees about its precision', async () => {
    const sheet = new Sheet(new MemStore());
    await sheet.setData({ r: 1, c: 1 }, '1.5');
    await sheet.setData({ r: 2, c: 1 }, '1.2345');
    sheet.selectStart({ r: 1, c: 1 });
    sheet.selectEnd({ r: 2, c: 1 });

    await sheet.changeDecimals(-1);
    await sheet.changeDecimals(1);

    // Restoring inheritance would send A2 back to four decimals instead of the
    // one decimal the step asks for, so the selection takes the explicit write.
    expect(await sheet.toDisplayString({ r: 1, c: 1 })).toBe(
      formatValue('1.5', 'number', 1),
    );
    expect(await sheet.toDisplayString({ r: 2, c: 1 })).toBe(
      formatValue('1.2345', 'number', 1),
    );
  });

  it('should step a neighbour whose decimals come from its format', async () => {
    const sheet = new Sheet(new MemStore());
    await sheet.setData({ r: 1, c: 1 }, '12');
    await sheet.setData({ r: 1, c: 2 }, '12');
    await sheet.setStyle({ r: 1, c: 2 }, { nf: 'number' });
    sheet.selectStart({ r: 1, c: 1 });
    sheet.selectEnd({ r: 1, c: 2 });

    // A1 shows no decimals, but B1 renders '12.00' through its number format,
    // so the selection still has decimals to drop.
    await sheet.changeDecimals(-1);
    expect(await sheet.toDisplayString({ r: 1, c: 2 })).toBe(
      formatValue('12', 'number', 0),
    );
  });

  it('should not unset decimals another cell renders through its format', async () => {
    const sheet = new Sheet(new MemStore());
    await sheet.setData({ r: 1, c: 1 }, '12');
    await sheet.setStyle({ r: 1, c: 1 }, { dp: 1 });
    await sheet.setData({ r: 1, c: 2 }, '0.5');
    await sheet.setStyle({ r: 1, c: 2 }, { dp: 1, nf: 'percent' });
    sheet.selectStart({ r: 1, c: 1 });
    sheet.selectEnd({ r: 1, c: 2 });

    // The active cell would round trip to no style, but B1 renders through its
    // own percent format, which falls back to two decimals without its `dp` —
    // more decimals, not fewer. So the selection takes the explicit write and
    // B1 keeps a `dp` instead of having it silently dropped.
    await sheet.changeDecimals(-1);
    expect((await sheet.getStyle({ r: 1, c: 2 }))?.dp).toBe(0);
  });

  it('should clamp decimals at the largest count Intl accepts', async () => {
    const sheet = new Sheet(new MemStore());
    await sheet.setData({ r: 1, c: 1 }, '1.5');
    await sheet.setStyle({ r: 1, c: 1 }, { dp: 20, nf: 'number' });
    sheet.selectStart({ r: 1, c: 1 });

    await sheet.changeDecimals(1);
    expect((await sheet.getStyle({ r: 1, c: 1 }))?.dp).toBe(20);
    // `toDisplayString` is async, so a rejected `Intl` call would surface as a
    // rejected promise rather than a synchronous throw: await the string and
    // read its digits.
    expect(await sheet.toDisplayString({ r: 1, c: 1 })).toMatch(
      new RegExp(`^1[.,]50{19}$`),
    );
  });

  it('should render a stored dp beyond the Intl range instead of throwing', async () => {
    const sheet = new Sheet(new MemStore());
    await sheet.setData({ r: 1, c: 1 }, '1.5');
    // A `dp` an import or a peer could have written; Intl rejects it outright.
    await sheet.setStyle({ r: 1, c: 1 }, { dp: 400, nf: 'number' });

    // 20 fraction digits, spelled out rather than compared against another
    // `formatValue` call through the same clamp.
    expect(await sheet.toDisplayString({ r: 1, c: 1 })).toMatch(
      new RegExp(`^1[.,]50{19}$`),
    );
  });

  it('should step a stored dp beyond the Intl range from what it renders', async () => {
    const sheet = new Sheet(new MemStore());
    await sheet.setData({ r: 1, c: 1 }, '1.5');
    await sheet.setStyle({ r: 1, c: 1 }, { dp: 400, nf: 'number' });
    sheet.selectStart({ r: 1, c: 1 });

    // The cell renders at 20 digits, so one Decrease has to land on 19 rather
    // than spending 380 presses walking back from a `dp` nothing ever showed.
    await sheet.changeDecimals(-1);
    expect((await sheet.getStyle({ r: 1, c: 1 }))?.dp).toBe(19);
  });

  it('should step a NaN dp instead of wedging on it', async () => {
    const sheet = new Sheet(new MemStore());
    await sheet.setData({ r: 1, c: 1 }, '1.5');
    // `NaN + delta` is `NaN`, which used to be written straight back.
    await sheet.setStyle({ r: 1, c: 1 }, { dp: NaN, nf: 'number' });
    sheet.selectStart({ r: 1, c: 1 });

    await sheet.changeDecimals(1);
    // The cell rendered at the format's 2 digits, so Increase lands on 3.
    expect((await sheet.getStyle({ r: 1, c: 1 }))?.dp).toBe(3);
    expect(await sheet.toDisplayString({ r: 1, c: 1 })).toBe(
      formatValue('1.5', 'number', 3),
    );
  });

  it('should keep a neighbour number format the step is not about', async () => {
    const sheet = new Sheet(new MemStore());
    await sheet.setData({ r: 1, c: 1 }, '1.5');
    await sheet.setData({ r: 1, c: 2 }, '0.5');
    await sheet.setStyle({ r: 1, c: 2 }, { nf: 'percent' });
    sheet.selectStart({ r: 1, c: 1 });
    sheet.selectEnd({ r: 1, c: 2 });

    // The active cell has no format, so the step gives it `nf: 'number'` — as a
    // default for the cells that have none, not as a conversion of B1, which
    // still has to read as a percentage afterwards.
    await sheet.changeDecimals(-1);
    expect((await sheet.getStyle({ r: 1, c: 2 }))?.nf).toBe('percent');
    expect(await sheet.toDisplayString({ r: 1, c: 2 })).toBe(
      formatValue('0.5', 'percent', 0),
    );
    expect(await sheet.toDisplayString({ r: 1, c: 1 })).toBe(
      formatValue('1.5', 'number', 0),
    );
  });

  it('should keep a neighbour format inherited from a column style', async () => {
    const sheet = new Sheet(new MemStore());
    await sheet.setData({ r: 1, c: 1 }, '1.5');
    await sheet.setData({ r: 1, c: 2 }, '0.5');
    sheet.selectColumn(2);
    await sheet.setRangeStyle({ nf: 'percent' });

    sheet.selectStart({ r: 1, c: 1 });
    sheet.selectEnd({ r: 1, c: 2 });
    await sheet.changeDecimals(-1);

    // The range patch the step appends sits above the column style, so B1 needs
    // its inherited format pinned to keep rendering as a percentage.
    expect(await sheet.toDisplayString({ r: 1, c: 2 })).toBe(
      formatValue('0.5', 'percent', 0),
    );
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

  /**
   * `defaultKeys: ['nf']` exists so a decimal step cannot overwrite a format
   * the user chose — a `percent` neighbour has to survive the step. But
   * `nf: 'plain'` is the *declared default*: it means "no number format", and
   * `formatValue` returns the raw value for it without ever reading `dp`.
   * Defending it made both buttons a silent no-op while `dp` climbed forever,
   * and nothing self-corrected. Reachable straight from the toolbar — select a
   * column header, or Ctrl+A, then Format → Plain text.
   *
   * One case per layer, because the two default-key paths are different code:
   * a column/row/sheet selection goes through `withoutSetDefaults`, a cell
   * selection through `collectStyleValuesToPin`.
   */
  describe('an explicit plain number format', () => {
    const stepped = [
      formatValue('12.5', 'number', 2),
      formatValue('12.5', 'number', 3),
    ];

    async function twoIncreases(sheet: Sheet): Promise<string[]> {
      const seen: string[] = [];
      for (let i = 0; i < 2; i++) {
        sheet.selectStart({ r: 1, c: 1 });
        await sheet.changeDecimals(1);
        seen.push(await sheet.toDisplayString({ r: 1, c: 1 }));
      }
      return seen;
    }

    it('does not stop Increase Decimals at the column level', async () => {
      const sheet = new Sheet(new MemStore());
      await sheet.setData({ r: 1, c: 1 }, '12.5');
      sheet.selectColumn(1);
      await sheet.setRangeStyle({ nf: 'plain' });

      expect(await twoIncreases(sheet)).toEqual(stepped);
    });

    it('does not stop Increase Decimals at the sheet level', async () => {
      const sheet = new Sheet(new MemStore());
      await sheet.setData({ r: 1, c: 1 }, '12.5');
      sheet.selectAllCells();
      await sheet.setRangeStyle({ nf: 'plain' });

      expect(await twoIncreases(sheet)).toEqual(stepped);
    });

    it('does not stop Increase Decimals at the cell level', async () => {
      const sheet = new Sheet(new MemStore());
      await sheet.setData({ r: 1, c: 1 }, '12.5');
      await sheet.setStyle({ r: 1, c: 1 }, { nf: 'plain' });

      expect(await twoIncreases(sheet)).toEqual(stepped);
    });

    // The other half of the contract: a real format still wins. Without this
    // the fix above could be "stop defending anything" and still look green.
    it('still leaves a percent neighbour alone', async () => {
      const sheet = new Sheet(new MemStore());
      await sheet.setData({ r: 1, c: 1 }, '12.5');
      await sheet.setData({ r: 2, c: 1 }, '0.5');
      await sheet.setStyle({ r: 2, c: 1 }, { nf: 'percent', dp: 1 });
      sheet.selectStart({ r: 1, c: 1 });
      sheet.selectEnd({ r: 2, c: 1 });

      await sheet.changeDecimals(1);

      expect(await sheet.toDisplayString({ r: 2, c: 1 })).toBe(
        formatValue('0.5', 'percent', 2),
      );
    });
  });
});
