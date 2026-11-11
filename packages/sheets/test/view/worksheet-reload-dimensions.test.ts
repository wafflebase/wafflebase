import { describe, expect, it } from 'vitest';
import { Worksheet } from '../../src/view/worksheet';
import { Sheet } from '../../src/model/worksheet/sheet';
import { DimensionIndex } from '../../src/model/worksheet/dimensions';
import { MemStore } from '../../src/store/memory';
import { DefaultCellHeight, DefaultCellWidth } from '../../src/view/layout';

type Proto = Record<string, (...args: never[]) => unknown>;
const proto = Worksheet.prototype as unknown as Proto;

/**
 * A remote change runs `reloadDimensions`, and an undo or redo runs
 * `runHistoryStep`; both rebuild `rowDim` from the stored heights before the
 * next render fits rows to their content again. Whatever is drawn in between
 * — the overlay on the presence update that comes with a peer's edit — reads
 * `rowDim`, so a fitted row reset to the default shifts every selection and
 * peer cursor below it (#1123).
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
    autoSizedRows: new Set<number>(),
    autoSizedRowIds: new Map<number, string>(),
    autoSizedMaxRow: 0,
    hiddenRows: new Set<number>(),
    hiddenRowSizeBackup: new Map<number, number>(),
    hiddenColumns: new Set<number>(),
    hiddenColSizeBackup: new Map<number, number>(),
    takeFittedRows: proto.takeFittedRows,
    restoreFittedRows: proto.restoreFittedRows,
    resyncHiddenAxes: proto.resyncHiddenAxes,
    syncHiddenRowsFromSheet: proto.syncHiddenRowsFromSheet,
    syncHiddenColumnsFromSheet: proto.syncHiddenColumnsFromSheet,
    updateFreezeState: () => {},
    updateCellInputPosition: () => {},
  };
  /** What `applyAutoRowHeights` leaves behind after fitting `row`. */
  const fit = (row: number, height: number, maxRow = 30) => {
    rowDim.setSize(row, height);
    ctx.autoSizedRows.add(row);
    ctx.autoSizedRowIds.set(row, rowOrder[row - 1]);
    ctx.autoSizedMaxRow = maxRow;
  };
  return { store, sheet, ctx, fit, rowOrder };
};

const reloadDimensions = (ctx: unknown) =>
  (proto.reloadDimensions as unknown as () => Promise<void>).call(ctx);
const runHistoryStep = (ctx: unknown, step: () => Promise<boolean>) =>
  (
    proto.runHistoryStep as unknown as (
      step: () => Promise<boolean>,
    ) => Promise<boolean>
  ).call(ctx, step);

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
    // order gains two IDs ahead of it.
    await store.shiftCells('row', 1, 2);
    rowOrder.splice(0, 0, 'n1', 'n2');
    await reloadDimensions(ctx);

    expect(ctx.rowDim.getSize(5)).toBe(DefaultCellHeight);
    expect(ctx.rowDim.getSize(7)).toBe(101);
    expect([...ctx.autoSizedRows]).toEqual([7]);
    expect(ctx.autoSizedRowIds.get(7)).toBe('r5');
  });

  it('drops a fitted row a peer deleted', async () => {
    const { ctx, fit, store, rowOrder } = createContext(ids(12));
    fit(5, 101);

    await store.shiftCells('row', 5, -1);
    rowOrder.splice(4, 1);
    await reloadDimensions(ctx);

    expect(ctx.rowDim.getSize(5)).toBe(DefaultCellHeight);
    expect(ctx.autoSizedRows.size).toBe(0);
  });

  it('applies a height a peer pinned on a fitted row', async () => {
    const { ctx, fit, store } = createContext(ids(12));
    fit(2, 62);
    await store.setDimensionSize('row', 2, 90);

    await reloadDimensions(ctx);

    expect(ctx.rowDim.getSize(2)).toBe(90);
    expect(ctx.autoSizedRows.has(2)).toBe(false);
  });

  it('leaves a row below the last fitted range to be measured again', async () => {
    const { ctx, fit } = createContext(ids(60));
    fit(50, 101, 30);

    await reloadDimensions(ctx);

    expect(ctx.rowDim.getSize(50)).toBe(DefaultCellHeight);
  });

  it('leaves a row with no axis ID to be measured again', async () => {
    const { ctx, fit } = createContext(ids(3));
    fit(8, 101);

    await reloadDimensions(ctx);

    expect(ctx.rowDim.getSize(8)).toBe(DefaultCellHeight);
  });

  it('keeps a hidden fitted row hidden, with its fitted height to come back to', async () => {
    const { ctx, fit, store, sheet } = createContext(ids(12));
    fit(3, 62);
    await store.setHiddenState({ rows: [3], columns: [] });
    await sheet.loadHiddenState();
    ctx.hiddenRows.add(3);
    ctx.hiddenRowSizeBackup.set(3, 62);
    ctx.rowDim.setSize(3, 0);

    await reloadDimensions(ctx);

    expect(ctx.rowDim.getSize(3)).toBe(0);
    expect(ctx.hiddenRowSizeBackup.get(3)).toBe(62);
  });
});

describe('Worksheet.runHistoryStep', () => {
  it('keeps fitted rows across an undo', async () => {
    const { ctx, fit, sheet } = createContext(ids(12));
    fit(2, 62);

    const replayed = await runHistoryStep(ctx, async () => {
      // What `Sheet.replayHistory` does to `rowDim`.
      await sheet.loadDimensions();
      return true;
    });

    expect(replayed).toBe(true);
    expect(ctx.rowDim.getSize(2)).toBe(62);
  });

  it('re-hides a hidden row the replay reset', async () => {
    const { ctx, store, sheet } = createContext(ids(12));
    await store.setHiddenState({ rows: [4], columns: [] });
    await sheet.loadHiddenState();
    ctx.hiddenRows.add(4);
    ctx.hiddenRowSizeBackup.set(4, DefaultCellHeight);
    ctx.rowDim.setSize(4, 0);

    await runHistoryStep(ctx, async () => {
      await sheet.loadDimensions();
      return true;
    });

    expect(ctx.rowDim.getSize(4)).toBe(0);
  });

  it('touches nothing when there was no step to replay', async () => {
    const { ctx, fit } = createContext(ids(12));
    fit(2, 62);

    const replayed = await runHistoryStep(ctx, async () => false);

    expect(replayed).toBe(false);
    expect(ctx.autoSizedRows.has(2)).toBe(true);
    expect(ctx.rowDim.getSize(2)).toBe(62);
  });
});
