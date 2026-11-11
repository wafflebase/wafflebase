import { describe, expect, it, vi } from 'vitest';
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
    autoSizedRenumberings: 0,
    hiddenRows: new Set<number>(),
    hiddenRowSizeBackup: new Map<number, number>(),
    hiddenColumns: new Set<number>(),
    hiddenColSizeBackup: new Map<number, number>(),
    dimensionReloadQueue: Promise.resolve() as Promise<unknown>,
    dimensionReloadsInFlight: 0,
    dimensionReloadGeneration: 0,
    serializeDimensionReload: proto.serializeDimensionReload,
    reloadDimensionsNow: proto.reloadDimensionsNow,
    runHistoryStepNow: proto.runHistoryStepNow,
    takeFittedRows: proto.takeFittedRows,
    restoreFittedRows: proto.restoreFittedRows,
    resyncHiddenAxes: proto.resyncHiddenAxes,
    syncHiddenRowsFromSheet: proto.syncHiddenRowsFromSheet,
    syncHiddenColumnsFromSheet: proto.syncHiddenColumnsFromSheet,
    updateFreezeState: vi.fn(),
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

  it('keeps carrying a fitted row a peer’s insert pushed past the measured range', async () => {
    const { ctx, fit, store, rowOrder } = createContext(ids(40));
    fit(30, 101, 30);

    // Two peer inserts in a row, both reloaded before any fit: the first
    // moves the fitted row to 31, below the last measured row.
    await store.shiftCells('row', 1, 1);
    rowOrder.splice(0, 0, 'n1');
    await reloadDimensions(ctx);
    await store.shiftCells('row', 1, 1);
    rowOrder.splice(0, 0, 'n2');
    await reloadDimensions(ctx);

    expect(ctx.rowDim.getSize(32)).toBe(101);
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

  it('carries nothing when a local insert renumbered rows since the last fit', async () => {
    const { ctx, fit, rowOrder } = createContext(ids(12));
    fit(5, 101);
    fit(6, 62);

    // The user inserts a row above: `rowDim` shifts with the model (101 and
    // 62 now sit on rows 6 and 7), but the view's fit records still name rows
    // 5 and 6. A reload lands before the next fit.
    ctx.rowDim.shift(1, 1);
    rowOrder.splice(0, 0, 'n1');
    await reloadDimensions(ctx);

    // Read by the stale indices, row 6's 101 would have been filed under r6
    // and put back on row 7. Nothing is carried; the next fit measures again.
    expect(ctx.rowDim.getSize(7)).toBe(DefaultCellHeight);
    expect(ctx.rowDim.getSize(6)).toBe(DefaultCellHeight);
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

  it('does not carry a fitted row it has no axis ID for', () => {
    const { ctx, fit } = createContext(ids(12));
    fit(2, 62);
    // Fitted while the row was past axis coverage: no ID was recorded.
    ctx.autoSizedRowIds.delete(2);

    const takeFittedRows = proto.takeFittedRows as unknown as () => Map<
      string,
      number
    >;
    expect(takeFittedRows.call(ctx)).toEqual(new Map());
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
  it('keeps a hidden column hidden across the reload', async () => {
    const { ctx, store, sheet } = createContext(ids(12));
    await store.setHiddenState({ rows: [], columns: [4] });
    await sheet.loadHiddenState();
    ctx.hiddenColumns.add(4);
    ctx.hiddenColSizeBackup.set(4, 140);
    ctx.colDim.setSize(4, 0);

    await reloadDimensions(ctx);

    expect(ctx.colDim.getSize(4)).toBe(0);
  });

  it('never keeps a zero size as the backup of a hidden row', async () => {
    const { ctx, store, sheet } = createContext(ids(12));
    await store.setHiddenState({ rows: [3], columns: [] });
    await sheet.loadHiddenState();
    ctx.hiddenRows.add(3);
    ctx.hiddenRowSizeBackup.set(3, 62);

    const resyncHiddenAxes = proto.resyncHiddenAxes as unknown as () => void;
    // A render already re-hid the row after the reload: it is 0 in `rowDim`.
    ctx.rowDim.setSize(3, 0);
    resyncHiddenAxes.call(ctx);

    expect(ctx.hiddenRowSizeBackup.get(3)).toBe(62);
  });
});

describe('Worksheet.runHistoryStep', () => {
  it('waits for a remote reload already in flight before it snapshots', async () => {
    const { ctx, fit, store, rowOrder, sheet } = createContext(ids(12));
    fit(5, 101);
    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

    // A peer inserts a row above. Its reload is slow to finish: `rowDim` has
    // already been rebuilt from the store (row 5 back at the default) when the
    // user presses undo, and the undo's own step is slower still.
    await store.shiftCells('row', 1, 1);
    rowOrder.splice(0, 0, 'n1');
    const load = sheet.loadDimensions.bind(sheet);
    let slow = true;
    sheet.loadDimensions = async () => {
      await load();
      if (slow) {
        slow = false;
        await sleep(10);
      }
    };
    const reload = reloadDimensions(ctx);
    await sleep(2);
    const undo = runHistoryStep(ctx, async () => {
      await sleep(20);
      return true;
    });
    await Promise.all([reload, undo]);

    // Interleaved, the undo would have snapshotted row 5's default height and
    // written it over the fitted row the reload had just moved to row 6.
    expect(ctx.rowDim.getSize(6)).toBe(101);
  });

  it('counts the reload as in flight for the render path while it runs', async () => {
    const { ctx, sheet } = createContext(ids(12));
    const load = sheet.loadDimensions.bind(sheet);
    let midFlight = -1;
    sheet.loadDimensions = async () => {
      await load();
      midFlight = ctx.dimensionReloadsInFlight;
    };

    await reloadDimensions(ctx);
    expect(midFlight).toBe(1);
    expect(ctx.dimensionReloadsInFlight).toBe(0);

    // The undo path goes through the same queue.
    await runHistoryStep(ctx, async () => {
      midFlight = ctx.dimensionReloadsInFlight;
      return true;
    });
    expect(midFlight).toBe(1);
    expect(ctx.dimensionReloadsInFlight).toBe(0);
    // Each reload bumps the generation on the way in and on the way out.
    expect(ctx.dimensionReloadGeneration).toBe(4);
  });

  it('stops repairing once the view drops its sheet partway through the reload', async () => {
    const { ctx, sheet } = createContext(ids(12));
    const loadStyles = sheet.loadStyles.bind(sheet);
    sheet.loadStyles = async () => {
      await loadStyles();
      (ctx as { sheet: unknown }).sheet = undefined;
    };
    let mergesLoaded = false;
    sheet.loadMerges = async () => {
      mergesLoaded = true;
    };

    await expect(reloadDimensions(ctx)).resolves.toBeUndefined();
    // Nothing more is read or repaired for a sheet the view no longer holds.
    expect(mergesLoaded).toBe(false);
  });

  it('keeps running reloads after one of them fails', async () => {
    const { ctx, fit, sheet } = createContext(ids(12));
    fit(2, 62);
    const load = sheet.loadDimensions.bind(sheet);
    let fail = true;
    sheet.loadDimensions = async () => {
      if (fail) {
        fail = false;
        throw new Error('store went away');
      }
      await load();
    };

    await expect(reloadDimensions(ctx)).rejects.toThrow('store went away');
    // A failed reload must not leave the render path's fit held off.
    expect(ctx.dimensionReloadsInFlight).toBe(0);
    const replayed = await runHistoryStep(ctx, async () => true);

    expect(replayed).toBe(true);
  });

  it('never keeps a zero backup for a hidden column either', async () => {
    const { ctx, store, sheet } = createContext(ids(12));
    await store.setHiddenState({ rows: [], columns: [4] });
    await sheet.loadHiddenState();
    ctx.hiddenColumns.add(4);
    ctx.hiddenColSizeBackup.set(4, 140);
    ctx.colDim.setSize(4, 0);

    (proto.resyncHiddenAxes as unknown as () => void).call(ctx);

    expect(ctx.hiddenColSizeBackup.get(4)).toBe(140);
  });

  it('never keeps a zero backup, even when the previous backup was zero', async () => {
    const { ctx, store, sheet } = createContext(ids(12));
    await store.setHiddenState({ rows: [3], columns: [] });
    await sheet.loadHiddenState();
    ctx.hiddenRows.add(3);
    ctx.hiddenRowSizeBackup.set(3, 0);
    ctx.rowDim.setSize(3, 0);

    (proto.resyncHiddenAxes as unknown as () => void).call(ctx);

    expect(ctx.hiddenRowSizeBackup.get(3)).toBe(DefaultCellHeight);
  });

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
    // The frozen pane caches a pixel offset off `rowDim`; the keyboard undo
    // relies on this call rather than making its own.
    expect(ctx.updateFreezeState).toHaveBeenCalledTimes(1);
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

  it('keeps a hidden fitted row hidden across an undo, with its height backed up', async () => {
    const { ctx, fit, store, sheet } = createContext(ids(12));
    fit(3, 62);
    await store.setHiddenState({ rows: [3], columns: [] });
    await sheet.loadHiddenState();
    ctx.hiddenRows.add(3);
    ctx.hiddenRowSizeBackup.set(3, 62);
    ctx.rowDim.setSize(3, 0);

    await runHistoryStep(ctx, async () => {
      await sheet.loadDimensions();
      return true;
    });

    expect(ctx.rowDim.getSize(3)).toBe(0);
    expect(ctx.hiddenRowSizeBackup.get(3)).toBe(62);
  });

  it('repairs nothing when the view lost its sheet during the replay', async () => {
    const { ctx, fit, sheet } = createContext(ids(12));
    fit(2, 62);

    const replayed = await runHistoryStep(ctx, async () => {
      await sheet.loadDimensions();
      (ctx as { sheet: unknown }).sheet = undefined;
      return true;
    });

    // Without the guard this throws on the dropped sheet. With it, the repair
    // is skipped: the fitted row is still recorded, at the reloaded height.
    expect(replayed).toBe(true);
    expect(ctx.autoSizedRows.has(2)).toBe(true);
    expect(ctx.rowDim.getSize(2)).toBe(DefaultCellHeight);
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
