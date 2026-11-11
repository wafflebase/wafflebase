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
 * An undo or a redo reloads the dimensions from the store
 * (`Sheet.replayHistory`), just as a remote change does — and it can be the
 * replay of an insert, delete or move, which renumbers rows without
 * `DimensionIndex.shift` ever running. `MemStore` keeps no history, so each
 * test hands it the step to replay, and a row order to hold axis IDs in.
 */
describe('Sheet undo and redo', () => {
  const createReplay = (step: (store: MemStore, order: string[]) => Promise<void>) => {
    const { sheet, store } = createSheet();
    const order = Array.from({ length: 12 }, (_, i) => `r${i + 1}`);
    Object.assign(store, {
      getRowOrder: () => [...order],
      undo: async () => {
        await step(store, order);
        return { success: true };
      },
    });
    return { sheet, rowDim: sheet.getRowDimensions()!, order };
  };

  it('keep rows fitted to their content, following them across a replayed insert', async () => {
    // Undoing a local insert of row 2.
    const { sheet, rowDim, order } = createReplay(async (store, order) => {
      await store.shiftCells('row', 2, -1);
      order.splice(1, 1);
    });
    rowDim.setFittedSize(5, 101, order[4]);

    expect(await sheet.undo()).toBe(true);

    expect(rowDim.getSize(4)).toBe(101);
    expect(rowDim.getSize(5)).toBe(DefaultCellHeight);
  });

  it('keep hidden rows hidden', async () => {
    const { sheet, rowDim } = createReplay(async (store) => {
      await store.setDimensionSize('row', 7, 90);
    });
    rowDim.setHidden([3]);

    await sheet.undo();

    expect(rowDim.getSize(3)).toBe(0);
    expect(rowDim.getSize(7)).toBe(90);
  });
});
