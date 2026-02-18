import { describe, it, expect, vi } from 'vitest';
import { MemStore } from '../../src/store/memory';
import { Sheet } from '../../src/model/sheet';
import { formatValue } from '../../src/model/format';

describe('Sheet.Formatting', () => {
  it('should get undefined style for empty cell', async () => {
    const sheet = new Sheet(new MemStore());
    const style = await sheet.getStyle({ r: 1, c: 1 });
    expect(style).toBeUndefined();
  });

  it('should set and get style', async () => {
    const sheet = new Sheet(new MemStore());
    await sheet.setStyle({ r: 1, c: 1 }, { b: true, tc: '#ff0000' });
    const style = await sheet.getStyle({ r: 1, c: 1 });
    expect(style).toEqual({ b: true, tc: '#ff0000' });
  });

  it('should merge styles', async () => {
    const sheet = new Sheet(new MemStore());
    await sheet.setStyle({ r: 1, c: 1 }, { b: true });
    await sheet.setStyle({ r: 1, c: 1 }, { i: true });
    const style = await sheet.getStyle({ r: 1, c: 1 });
    expect(style).toEqual({ b: true, i: true });
  });

  it('should remove default false values that are not needed as overrides', async () => {
    const sheet = new Sheet(new MemStore());
    await sheet.setStyle({ r: 1, c: 1 }, { b: true, i: true });
    await sheet.setStyle({ r: 1, c: 1 }, { b: false });
    const style = await sheet.getStyle({ r: 1, c: 1 });
    expect(style).toEqual({ i: true });
  });

  it('should drop style when only default values remain', async () => {
    const sheet = new Sheet(new MemStore());
    await sheet.setStyle({ r: 1, c: 1 }, { b: true });
    await sheet.setStyle({ r: 1, c: 1 }, { b: false });
    const style = await sheet.getStyle({ r: 1, c: 1 });
    expect(style).toBeUndefined();
  });

  it('should preserve style when setting data', async () => {
    const sheet = new Sheet(new MemStore());
    await sheet.setStyle({ r: 1, c: 1 }, { b: true });
    await sheet.setData({ r: 1, c: 1 }, 'hello');
    const style = await sheet.getStyle({ r: 1, c: 1 });
    expect(style).toEqual({ b: true });
    expect(await sheet.toDisplayString({ r: 1, c: 1 })).toBe('hello');
  });

  it('should toggle boolean style property', async () => {
    const sheet = new Sheet(new MemStore());
    sheet.selectStart({ r: 1, c: 1 });

    await sheet.toggleRangeStyle('b');
    expect(await sheet.getStyle({ r: 1, c: 1 })).toEqual({ b: true });

    await sheet.toggleRangeStyle('b');
    const style = await sheet.getStyle({ r: 1, c: 1 });
    expect(style).toBeUndefined();
  });

  it('should remove default style after toggling bold twice on a value cell', async () => {
    const store = new MemStore();
    const sheet = new Sheet(store);
    await sheet.setData({ r: 2, c: 2 }, '1');
    sheet.selectStart({ r: 2, c: 2 });

    await sheet.toggleRangeStyle('b');
    await sheet.toggleRangeStyle('b');

    expect(await sheet.getStyle({ r: 2, c: 2 })).toBeUndefined();
    expect(await store.get({ r: 2, c: 2 })).toEqual({ v: '1' });
  });

  it('should apply style to range', async () => {
    const sheet = new Sheet(new MemStore());
    sheet.selectStart({ r: 1, c: 1 });
    sheet.selectEnd({ r: 2, c: 2 });

    await sheet.setRangeStyle({ b: true, tc: '#0000ff' });

    expect(await sheet.getStyle({ r: 1, c: 1 })).toEqual({
      b: true,
      tc: '#0000ff',
    });
    expect(await sheet.getStyle({ r: 1, c: 2 })).toEqual({
      b: true,
      tc: '#0000ff',
    });
    expect(await sheet.getStyle({ r: 2, c: 1 })).toEqual({
      b: true,
      tc: '#0000ff',
    });
    expect(await sheet.getStyle({ r: 2, c: 2 })).toEqual({
      b: true,
      tc: '#0000ff',
    });
  });

  it('should apply number format in display string', async () => {
    const sheet = new Sheet(new MemStore());
    await sheet.setData({ r: 1, c: 1 }, '1234.5');
    await sheet.setStyle({ r: 1, c: 1 }, { nf: 'currency' });
    expect(await sheet.toDisplayString({ r: 1, c: 1 })).toBe(
      formatValue('1234.5', 'currency'),
    );
  });

  it('should create cell when setting style on empty cell', async () => {
    const sheet = new Sheet(new MemStore());
    await sheet.setStyle({ r: 5, c: 5 }, { bg: '#ff0000' });
    const style = await sheet.getStyle({ r: 5, c: 5 });
    expect(style).toEqual({ bg: '#ff0000' });
  });

  it('should set style with existing cell value', async () => {
    const sheet = new Sheet(new MemStore());
    await sheet.setData({ r: 1, c: 1 }, '100');
    await sheet.setStyle({ r: 1, c: 1 }, { b: true });
    expect(await sheet.toDisplayString({ r: 1, c: 1 })).toBe('100');
    expect(await sheet.getStyle({ r: 1, c: 1 })).toEqual({ b: true });
  });

  it('should set vertical alignment', async () => {
    const sheet = new Sheet(new MemStore());
    await sheet.setStyle({ r: 1, c: 1 }, { va: 'middle' });
    const style = await sheet.getStyle({ r: 1, c: 1 });
    expect(style).toEqual({ va: 'middle' });
  });

  it('should set horizontal and vertical alignment together', async () => {
    const sheet = new Sheet(new MemStore());
    await sheet.setStyle({ r: 1, c: 1 }, { al: 'center', va: 'bottom' });
    const style = await sheet.getStyle({ r: 1, c: 1 });
    expect(style).toEqual({ al: 'center', va: 'bottom' });
  });

  it('should apply all borders preset to a selected range', async () => {
    const sheet = new Sheet(new MemStore());
    sheet.selectStart({ r: 1, c: 1 });
    sheet.selectEnd({ r: 2, c: 2 });

    expect(await sheet.setRangeBorders('all')).toBe(true);

    expect(await sheet.getStyle({ r: 1, c: 1 })).toEqual({ bt: true, bl: true });
    expect(await sheet.getStyle({ r: 1, c: 2 })).toEqual({
      bt: true,
      bl: true,
      br: true,
    });
    expect(await sheet.getStyle({ r: 2, c: 1 })).toEqual({
      bt: true,
      bl: true,
      bb: true,
    });
    expect(await sheet.getStyle({ r: 2, c: 2 })).toEqual({
      bt: true,
      bl: true,
      br: true,
      bb: true,
    });
  });

  it('should replace all borders with outer border preset', async () => {
    const sheet = new Sheet(new MemStore());
    sheet.selectStart({ r: 1, c: 1 });
    sheet.selectEnd({ r: 2, c: 2 });

    await sheet.setRangeBorders('all');
    expect(await sheet.setRangeBorders('outer')).toBe(true);

    expect(await sheet.getStyle({ r: 1, c: 1 })).toEqual({ bt: true, bl: true });
    expect(await sheet.getStyle({ r: 1, c: 2 })).toEqual({ bt: true, br: true });
    expect(await sheet.getStyle({ r: 2, c: 1 })).toEqual({ bl: true, bb: true });
    expect(await sheet.getStyle({ r: 2, c: 2 })).toEqual({ br: true, bb: true });
  });

  it('should clear borders from selected range', async () => {
    const sheet = new Sheet(new MemStore());
    sheet.selectStart({ r: 1, c: 1 });
    sheet.selectEnd({ r: 2, c: 2 });

    await sheet.setRangeBorders('all');
    expect(await sheet.setRangeBorders('clear')).toBe(true);

    expect(await sheet.getStyle({ r: 1, c: 1 })).toBeUndefined();
    expect(await sheet.getStyle({ r: 1, c: 2 })).toBeUndefined();
    expect(await sheet.getStyle({ r: 2, c: 1 })).toBeUndefined();
    expect(await sheet.getStyle({ r: 2, c: 2 })).toBeUndefined();
  });

  it('should reject border presets for non-cell selections', async () => {
    const sheet = new Sheet(new MemStore());
    sheet.selectColumn(1);
    expect(await sheet.setRangeBorders('all')).toBe(false);
  });
});

describe('Sheet.ColumnRowSheetStyles', () => {
  it('should apply column style to any cell in that column', async () => {
    const store = new MemStore();
    const sheet = new Sheet(store);
    sheet.selectColumn(2);
    await sheet.setRangeStyle({ b: true });

    // Any cell in column 2 should inherit bold
    expect(await sheet.getStyle({ r: 1, c: 2 })).toEqual({ b: true });
    expect(await sheet.getStyle({ r: 500, c: 2 })).toEqual({ b: true });
    // Cell in different column should not be affected
    expect(await sheet.getStyle({ r: 1, c: 1 })).toBeUndefined();
  });

  it('should apply row style to any cell in that row', async () => {
    const store = new MemStore();
    const sheet = new Sheet(store);
    sheet.selectRow(3);
    await sheet.setRangeStyle({ i: true });

    expect(await sheet.getStyle({ r: 3, c: 1 })).toEqual({ i: true });
    expect(await sheet.getStyle({ r: 3, c: 100 })).toEqual({ i: true });
    expect(await sheet.getStyle({ r: 1, c: 1 })).toBeUndefined();
  });

  it('should apply sheet style to any cell', async () => {
    const store = new MemStore();
    const sheet = new Sheet(store);
    sheet.selectAllCells();
    await sheet.setRangeStyle({ tc: '#ff0000' });

    expect(await sheet.getStyle({ r: 1, c: 1 })).toEqual({ tc: '#ff0000' });
    expect(await sheet.getStyle({ r: 999, c: 999 })).toEqual({ tc: '#ff0000' });
  });

  it('should follow style precedence: cell > row > column > sheet', async () => {
    const store = new MemStore();
    const sheet = new Sheet(store);

    // Set sheet style
    sheet.selectAllCells();
    await sheet.setRangeStyle({ tc: '#000000', bg: '#ffffff' });

    // Set column style (overrides sheet for column 1)
    sheet.selectColumn(1);
    await sheet.setRangeStyle({ tc: '#ff0000' });

    // Set row style (overrides column for row 1)
    sheet.selectRow(1);
    await sheet.setRangeStyle({ tc: '#00ff00' });

    // Set cell style (overrides row for A1)
    sheet.selectStart({ r: 1, c: 1 });
    await sheet.setStyle({ r: 1, c: 1 }, { tc: '#0000ff' });

    // Cell A1: cell tc wins
    expect(await sheet.getStyle({ r: 1, c: 1 })).toEqual({
      tc: '#0000ff',
      bg: '#ffffff',
    });

    // Cell A2 (row 2, col 1): column tc wins over sheet
    expect(await sheet.getStyle({ r: 2, c: 1 })).toEqual({
      tc: '#ff0000',
      bg: '#ffffff',
    });

    // Cell B1 (row 1, col 2): row tc wins over sheet
    expect(await sheet.getStyle({ r: 1, c: 2 })).toEqual({
      tc: '#00ff00',
      bg: '#ffffff',
    });

    // Cell B2: only sheet style
    expect(await sheet.getStyle({ r: 2, c: 2 })).toEqual({
      tc: '#000000',
      bg: '#ffffff',
    });
  });

  it('should NOT call store.set() per cell for column styling', async () => {
    const store = new MemStore();
    const setSpy = vi.spyOn(store, 'set');
    const sheet = new Sheet(store);
    sheet.selectColumn(1);
    await sheet.setRangeStyle({ b: true });

    // store.set should NOT be called for individual cells
    expect(setSpy).not.toHaveBeenCalled();
  });

  it('should shift column styles when inserting columns', async () => {
    const store = new MemStore();
    const sheet = new Sheet(store);

    // Bold column 2
    sheet.selectColumn(2);
    await sheet.setRangeStyle({ b: true });
    expect(await sheet.getStyle({ r: 1, c: 2 })).toEqual({ b: true });

    // Insert column at 2 — old column 2 becomes column 3
    await sheet.insertColumns(2, 1);
    expect(await sheet.getStyle({ r: 1, c: 2 })).toBeUndefined();
    expect(await sheet.getStyle({ r: 1, c: 3 })).toEqual({ b: true });
  });

  it('should shift row styles when inserting rows', async () => {
    const store = new MemStore();
    const sheet = new Sheet(store);

    // Italic row 3
    sheet.selectRow(3);
    await sheet.setRangeStyle({ i: true });
    expect(await sheet.getStyle({ r: 3, c: 1 })).toEqual({ i: true });

    // Insert row at 3 — old row 3 becomes row 4
    await sheet.insertRows(3, 1);
    expect(await sheet.getStyle({ r: 3, c: 1 })).toBeUndefined();
    expect(await sheet.getStyle({ r: 4, c: 1 })).toEqual({ i: true });
  });

  it('should drop column styles when deleting columns', async () => {
    const store = new MemStore();
    const sheet = new Sheet(store);

    sheet.selectColumn(2);
    await sheet.setRangeStyle({ b: true });

    // Delete column 2
    await sheet.deleteColumns(2, 1);
    expect(await sheet.getStyle({ r: 1, c: 2 })).toBeUndefined();
  });

  it('should toggle correctly with inherited column style', async () => {
    const store = new MemStore();
    const sheet = new Sheet(store);

    // Bold column 1
    sheet.selectColumn(1);
    await sheet.setRangeStyle({ b: true });

    // Select cell A1 and toggle bold off — should set cell-level b: false
    sheet.selectStart({ r: 1, c: 1 });
    await sheet.toggleRangeStyle('b');

    // The cell-level override should make effective bold = false
    const cell = await store.get({ r: 1, c: 1 });
    expect(cell?.s?.b).toBe(false);

    // Effective style: column b:true + cell b:false → cell wins → b: false
    const effective = await sheet.getStyle({ r: 1, c: 1 });
    expect(effective?.b).toBe(false);

    // Other cells in column 1 still have bold
    expect(await sheet.getStyle({ r: 2, c: 1 })).toEqual({ b: true });
  });

  it('should apply column number format in display string', async () => {
    const store = new MemStore();
    const sheet = new Sheet(store);

    // Set column 1 to currency format
    sheet.selectColumn(1);
    await sheet.setRangeStyle({ nf: 'currency' });

    // Enter data in a cell
    await sheet.setData({ r: 1, c: 1 }, '1234.5');
    expect(await sheet.toDisplayString({ r: 1, c: 1 })).toBe(
      formatValue('1234.5', 'currency'),
    );
  });

  it('should apply style to multiple columns at once', async () => {
    const store = new MemStore();
    const sheet = new Sheet(store);
    sheet.selectColumn(1);
    sheet.selectColumnRange(1, 3);
    await sheet.setRangeStyle({ b: true });

    expect(await sheet.getStyle({ r: 1, c: 1 })).toEqual({ b: true });
    expect(await sheet.getStyle({ r: 1, c: 2 })).toEqual({ b: true });
    expect(await sheet.getStyle({ r: 1, c: 3 })).toEqual({ b: true });
    expect(await sheet.getStyle({ r: 1, c: 4 })).toBeUndefined();
  });

  it('should load styles from store', async () => {
    const store = new MemStore();
    await store.setColumnStyle(1, { b: true });
    await store.setRowStyle(2, { i: true });
    await store.setSheetStyle({ tc: '#333' });

    const sheet = new Sheet(store);
    await sheet.loadStyles();

    expect(await sheet.getStyle({ r: 5, c: 1 })).toEqual({ tc: '#333', b: true });
    expect(await sheet.getStyle({ r: 2, c: 5 })).toEqual({ tc: '#333', i: true });
    expect(await sheet.getStyle({ r: 5, c: 5 })).toEqual({ tc: '#333' });
  });
});
