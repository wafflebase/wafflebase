import { describe, expect, it } from 'vitest';
import { Worksheet } from '../../src/view/worksheet';
import { Sheet } from '../../src/model/worksheet/sheet';
import { DimensionIndex } from '../../src/model/worksheet/dimensions';
import { MemStore } from '../../src/store/memory';
import { DefaultCellHeight, DefaultCellWidth } from '../../src/view/layout';

const reloadDimensions = (
  Worksheet.prototype as unknown as {
    reloadDimensions: () => Promise<void>;
  }
).reloadDimensions;

/**
 * A remote change runs `reloadDimensions` before the next render re-fits
 * rows to their content. Whatever is drawn in between — the overlay on the
 * presence update that comes with a peer's edit — reads `rowDim`, so a fitted
 * row that the reload reset to the default shifts every selection and peer
 * cursor below it (#1123).
 *
 * The sheet is real so the reload goes through the real store read; the
 * view-only passes that follow it are stubbed.
 */
const createContext = () => {
  const store = new MemStore();
  const sheet = new Sheet(store);
  const rowDim = new DimensionIndex(DefaultCellHeight);
  const colDim = new DimensionIndex(DefaultCellWidth);
  sheet.setDimensions(rowDim, colDim);
  return {
    store,
    ctx: {
      sheet,
      rowDim,
      colDim,
      autoSizedRows: new Set<number>(),
      hiddenRows: new Set<number>(),
      hiddenRowSizeBackup: new Map<number, number>(),
      hiddenColumns: new Set<number>(),
      hiddenColSizeBackup: new Map<number, number>(),
      syncHiddenRowsFromSheet: () => {},
      syncHiddenColumnsFromSheet: () => {},
      updateFreezeState: () => {},
      updateCellInputPosition: () => {},
    },
  };
};

describe('Worksheet.reloadDimensions', () => {
  it('keeps rows fitted to their content at their fitted height', async () => {
    const { ctx } = createContext();
    ctx.rowDim.setSize(2, 62);
    ctx.rowDim.setSize(5, 101);
    ctx.autoSizedRows.add(2);
    ctx.autoSizedRows.add(5);

    await reloadDimensions.call(ctx);

    expect(ctx.rowDim.getSize(2)).toBe(62);
    expect(ctx.rowDim.getSize(5)).toBe(101);
    expect(ctx.rowDim.getOffset(10)).toBe(
      7 * DefaultCellHeight + 62 + 101,
    );
  });

  it('applies a height a peer pinned on a fitted row', async () => {
    const { ctx, store } = createContext();
    ctx.rowDim.setSize(2, 62);
    ctx.autoSizedRows.add(2);
    await store.setDimensionSize('row', 2, 90);

    await reloadDimensions.call(ctx);

    expect(ctx.rowDim.getSize(2)).toBe(90);
  });

  it('does not carry a hidden row’s zero height across the reload', async () => {
    const { ctx } = createContext();
    ctx.rowDim.setSize(3, 0);
    ctx.autoSizedRows.add(3);
    ctx.hiddenRows.add(3);

    await reloadDimensions.call(ctx);

    expect(ctx.rowDim.getSize(3)).toBe(DefaultCellHeight);
  });
});
