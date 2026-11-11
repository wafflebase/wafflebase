import { describe, expect, it } from 'vitest';
import { Sheet } from '../../src/model/worksheet/sheet';
import { DimensionIndex } from '../../src/model/worksheet/dimensions';
import { MemStore } from '../../src/store/memory';
import { DefaultCellHeight, DefaultCellWidth } from '../../src/view/layout';

/**
 * `clearRowHeight` is the other half of the "fit to data" rule: a row with no
 * stored height is sized by the view on every render, so clearing the stored
 * entry is how a row is handed back to its content. Setting the default as an
 * explicit value would look like a height somebody chose and be left alone.
 */
const createSheet = (): { sheet: Sheet; store: MemStore } => {
  const store = new MemStore();
  const sheet = new Sheet(store);
  sheet.setDimensions(
    new DimensionIndex(DefaultCellHeight),
    new DimensionIndex(DefaultCellWidth),
  );
  return { sheet, store };
};

describe('Sheet row heights', () => {
  it('stores an explicit row height', async () => {
    const { sheet, store } = createSheet();

    sheet.setRowHeight(3, 90);

    expect(sheet.getRowDimensions()!.getSize(3)).toBe(90);
    expect(await store.getDimensionSizes('row')).toEqual(new Map([[3, 90]]));
  });

  it('drops the stored entry rather than storing the default', async () => {
    const { sheet, store } = createSheet();
    sheet.setRowHeight(3, 90);

    sheet.clearRowHeight(3);

    expect(sheet.getRowDimensions()!.getSize(3)).toBe(DefaultCellHeight);
    const stored = await store.getDimensionSizes('row');
    expect(stored.has(3)).toBe(false);
  });

  it('leaves other rows alone', async () => {
    const { sheet, store } = createSheet();
    sheet.setRowHeight(3, 90);
    sheet.setRowHeight(4, 120);

    sheet.clearRowHeight(3);

    expect(sheet.getRowDimensions()!.getSize(4)).toBe(120);
    expect((await store.getDimensionSizes('row')).get(4)).toBe(120);
  });

  it('survives a reload: the cleared row comes back at the default', async () => {
    const { sheet, store } = createSheet();
    sheet.setRowHeight(3, 90);
    sheet.clearRowHeight(3);

    const reopened = new Sheet(store);
    reopened.setDimensions(
      new DimensionIndex(DefaultCellHeight),
      new DimensionIndex(DefaultCellWidth),
    );
    await reopened.loadDimensions();

    expect(reopened.getRowDimensions()!.getSize(3)).toBe(DefaultCellHeight);
  });

  it('is a no-op on a row that never had a height', async () => {
    const { sheet, store } = createSheet();

    sheet.clearRowHeight(7);

    expect(sheet.getRowDimensions()!.getSize(7)).toBe(DefaultCellHeight);
    expect((await store.getDimensionSizes('row')).size).toBe(0);
  });
});

/**
 * Rows sized to their content are never stored, so a reload from the store
 * alone would reset them. Every remote change reloads dimensions, and a row
 * that drops to the default between the reload and the next fit moves the
 * overlay off the grid for a frame (#1123).
 */
describe('Sheet.loadDimensions with fitted rows', () => {
  it('keeps a fitted height the store has no entry for', async () => {
    const { sheet } = createSheet();
    const rowDim = sheet.getRowDimensions()!;
    rowDim.setSize(2, 62);

    await sheet.loadDimensions(new Map([[2, 62]]));

    expect(rowDim.getSize(2)).toBe(62);
  });

  it('resets a fitted row when no fitted heights are passed', async () => {
    const { sheet } = createSheet();
    const rowDim = sheet.getRowDimensions()!;
    rowDim.setSize(2, 62);

    await sheet.loadDimensions();

    expect(rowDim.getSize(2)).toBe(DefaultCellHeight);
  });

  it('lets a stored height win over a fitted one', async () => {
    const { sheet } = createSheet();
    sheet.setRowHeight(2, 90);

    await sheet.loadDimensions(new Map([[2, 62]]));

    expect(sheet.getRowDimensions()!.getSize(2)).toBe(90);
  });

  it('still drops sizes the store no longer has', async () => {
    const { sheet, store } = createSheet();
    sheet.setRowHeight(4, 90);
    await store.clearDimensionSize('row', 4);

    await sheet.loadDimensions(new Map([[2, 62]]));

    expect(sheet.getRowDimensions()!.getSize(4)).toBe(DefaultCellHeight);
    expect(sheet.getRowDimensions()!.getSize(2)).toBe(62);
  });
});
