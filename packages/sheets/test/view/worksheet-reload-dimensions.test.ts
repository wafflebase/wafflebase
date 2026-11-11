import { describe, expect, it, vi } from 'vitest';
import { Worksheet } from '../../src/view/worksheet';
import { Sheet } from '../../src/model/worksheet/sheet';
import { DimensionIndex } from '../../src/model/worksheet/dimensions';
import { MemStore } from '../../src/store/memory';
import { DefaultCellHeight, DefaultCellWidth } from '../../src/view/layout';

type Proto = Record<string, (...args: never[]) => unknown>;
const proto = Worksheet.prototype as unknown as Proto;

/**
 * Every remote change runs `reloadDimensions`, which rebuilds `rowDim` from
 * the stored heights. Rows fitted to their content have no stored height;
 * when the reload dropped them, whatever was drawn before the next render
 * fitted them again — the overlay on the presence update that comes with a
 * peer's edit — put the selection and peer cursors below them too high
 * (#1123).
 *
 * The sheet and store are real, and so is the hidden-row pass; only view
 * passes that need a DOM are stubbed. `MemStore` has no axis IDs, so each
 * test hands it a row order the way a collaborative store would hold one.
 */
const createContext = (rowOrder: Array<string>) => {
  const store = new MemStore();
  (store as unknown as { getRowOrder: () => Array<string> }).getRowOrder =
    () => [...rowOrder];
  const sheet = new Sheet(store);
  const rowDim = new DimensionIndex(DefaultCellHeight);
  const colDim = new DimensionIndex(DefaultCellWidth);
  sheet.setDimensions(rowDim, colDim);
  const ctx = {
    sheet,
    rowDim,
    colDim,
    syncHiddenRowsFromSheet: proto.syncHiddenRowsFromSheet,
    syncHiddenColumnsFromSheet: proto.syncHiddenColumnsFromSheet,
    updateFreezeState: vi.fn(),
    updateCellInputPosition: () => {},
  };
  /** What `applyAutoRowHeights` leaves behind after fitting `row`. */
  const fit = (row: number, height: number) =>
    rowDim.setFittedSize(row, height, rowOrder[row - 1]);
  return { store, sheet, ctx, fit, rowOrder };
};

const reloadDimensions = (ctx: unknown) =>
  (proto.reloadDimensions as unknown as () => Promise<void>).call(ctx);

const ids = (n: number) => Array.from({ length: n }, (_, i) => `r${i + 1}`);

describe('Worksheet.reloadDimensions', () => {
  it('keeps rows fitted to their content at their fitted height', async () => {
    const { ctx, fit } = createContext(ids(12));
    fit(2, 62);
    fit(5, 101);

    await reloadDimensions(ctx);

    expect(ctx.rowDim.getSize(2)).toBe(62);
    expect(ctx.rowDim.getSize(5)).toBe(101);
    expect(ctx.rowDim.getOffset(10)).toBe(7 * DefaultCellHeight + 62 + 101);
  });

  it('follows a fitted row to where a peer’s insert moved it', async () => {
    const { ctx, fit, store, rowOrder } = createContext(ids(12));
    fit(5, 101);

    // A peer inserts two rows above row 5: the store renumbers, and the row
    // order gains two IDs ahead of it. Nothing calls `rowDim.shift`.
    await store.shiftCells('row', 1, 2);
    rowOrder.splice(0, 0, 'n1', 'n2');
    await reloadDimensions(ctx);

    expect(ctx.rowDim.getSize(5)).toBe(DefaultCellHeight);
    expect(ctx.rowDim.getSize(7)).toBe(101);
  });

  it('follows a fitted row a peer moved', async () => {
    const { ctx, fit, store, rowOrder } = createContext(ids(12));
    fit(2, 62);

    await store.moveCells('row', 2, 1, 6);
    rowOrder.splice(4, 0, ...rowOrder.splice(1, 1));
    await reloadDimensions(ctx);

    expect(ctx.rowDim.getSize(2)).toBe(DefaultCellHeight);
    expect(ctx.rowDim.getSize(5)).toBe(62);
  });

  it('drops a fitted row a peer deleted', async () => {
    const { ctx, fit, store, rowOrder } = createContext(ids(12));
    fit(5, 101);

    await store.shiftCells('row', 5, -1);
    rowOrder.splice(4, 1);
    await reloadDimensions(ctx);

    expect(ctx.rowDim.getSize(5)).toBe(DefaultCellHeight);
    expect(ctx.rowDim.hasFittedSizes()).toBe(false);
  });

  it('applies a height a peer pinned on a fitted row', async () => {
    const { ctx, fit, store } = createContext(ids(12));
    fit(3, 62);

    await store.setDimensionSize('row', 3, 140);
    await reloadDimensions(ctx);

    expect(ctx.rowDim.getSize(3)).toBe(140);
  });

  it('applies a peer’s pin even when it is the default height', async () => {
    const { ctx, fit, store } = createContext(ids(12));
    fit(3, 62);

    // `rowDim` keeps no stored entry for the default, so this is the case
    // where the fitted height could otherwise show through.
    await store.setDimensionSize('row', 3, DefaultCellHeight);
    await reloadDimensions(ctx);

    expect(ctx.rowDim.getSize(3)).toBe(DefaultCellHeight);
  });

  it('pins the row the peer pinned, not the one that sat there before', async () => {
    const { ctx, fit, store, rowOrder } = createContext(ids(12));
    fit(3, 62);
    fit(4, 80);

    // A peer inserts a row at the top and pins what is now row 4 (r3).
    await store.shiftCells('row', 1, 1);
    rowOrder.splice(0, 0, 'n1');
    await store.setDimensionSize('row', 4, 140);
    await reloadDimensions(ctx);

    expect(ctx.rowDim.getSize(4)).toBe(140);
    expect(ctx.rowDim.getSize(5)).toBe(80);
  });

  it('keeps a height set locally while the reload reads the store', async () => {
    const { ctx, store, sheet } = createContext(ids(12));
    const read = store.getDimensionSizes.bind(store);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    store.getDimensionSizes = async (axis) => {
      // The read is taken before the local edit, and answers after it.
      const sizes = await read(axis);
      await gate;
      return sizes;
    };

    const reload = reloadDimensions(ctx);
    sheet.setRowHeight(3, 90);
    release();
    await reload;

    expect(ctx.rowDim.getSize(3)).toBe(90);
  });

  it('keeps a hidden fitted row hidden, with its fitted height to come back to', async () => {
    const { ctx, fit, store, sheet } = createContext(ids(12));
    fit(3, 62);
    await store.setHiddenState({ rows: [3], columns: [] });
    await sheet.loadHiddenState();
    (proto.syncHiddenRowsFromSheet as unknown as () => void).call(ctx);

    await reloadDimensions(ctx);
    expect(ctx.rowDim.getSize(3)).toBe(0);

    // Shown again, by a peer: it is back at its fitted height at once.
    await store.setHiddenState({ rows: [], columns: [] });
    await reloadDimensions(ctx);
    expect(ctx.rowDim.getSize(3)).toBe(62);
  });

  it('keeps a hidden column hidden, with its width to come back to', async () => {
    const { ctx, store, sheet } = createContext(ids(12));
    await store.setDimensionSize('column', 4, 140);
    await store.setHiddenState({ rows: [], columns: [4] });
    await sheet.loadHiddenState();
    await reloadDimensions(ctx);
    expect(ctx.colDim.getSize(4)).toBe(0);

    await reloadDimensions(ctx);
    expect(ctx.colDim.getSize(4)).toBe(0);

    await store.setHiddenState({ rows: [], columns: [] });
    await reloadDimensions(ctx);
    expect(ctx.colDim.getSize(4)).toBe(140);
  });
});

describe('Worksheet.initialize', () => {
  it('drops the previous sheet’s fitted heights and hidden axes before loading', async () => {
    const { ctx } = createContext(ids(12));
    ctx.rowDim.setFittedSize(2, 62, 'r2');
    ctx.rowDim.setHidden([4]);
    ctx.colDim.setHidden([3]);
    const next = createContext(ids(12)).sheet;
    // What the view shows while the new sheet loads.
    let during: Array<number> = [];
    const load = next.loadDimensions.bind(next);
    next.loadDimensions = async () => {
      during = [
        ctx.rowDim.getSize(2),
        ctx.rowDim.getSize(4),
        ctx.colDim.getSize(3),
      ];
      await load();
    };

    await (
      proto.initialize as unknown as (sheet: unknown) => Promise<void>
    ).call(
      {
        ...ctx,
        formulaBar: { initialize: () => {} },
        addEventListeners: () => {},
        resizeObserver: { observe: () => {} },
        render: () => {},
        primeCellInputForSelection: () => {},
      },
      next,
    );

    expect(during).toEqual([
      DefaultCellHeight,
      DefaultCellHeight,
      DefaultCellWidth,
    ]);
  });
});
