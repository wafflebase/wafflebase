import { describe, expect, it } from 'vitest';
import { Worksheet } from '../../src/view/worksheet';
import { autoRowHeight } from '../../src/view/auto-row-height';
import { DefaultCellHeight } from '../../src/view/layout';
import { DimensionIndex } from '../../src/model/worksheet/dimensions';
import { buildFreezeState, NoFreeze } from '../../src/view/layout';
import type { FreezeState } from '../../src/view/layout';
import type { Grid, MergeSpan, Range, Sref } from '../../src/model/core/types';

const applyAutoRowHeights = (
  Worksheet.prototype as unknown as {
    applyAutoRowHeights: (
      grid: Grid,
      maxRow: number,
      maxCol: number,
    ) => Promise<boolean>;
  }
).applyAutoRowHeights;

const fetchRowRemainder = (
  Worksheet.prototype as unknown as {
    fetchRowRemainder: (...args: Array<unknown>) => Promise<Grid>;
  }
).fetchRowRemainder;

const updateFreezeState = (
  Worksheet.prototype as unknown as {
    updateFreezeState: () => void;
  }
).updateFreezeState;

/**
 * The real grid spans every column, so a fake sheet that answers `fetchGrid`
 * from a fixed map is what lets a test put a tall cell to the right of the
 * fetched viewport.
 */
type Context = {
  sheet: unknown;
  resizeDragging: boolean;
  hiddenRows: Set<number>;
  autoSizedRows: Set<number>;
  autoSizedRowIds: Map<number, string>;
  autoSizedMaxRow: number;
  autoSizedRenumberings: number;
  rowDim: DimensionIndex;
  colDim: DimensionIndex;
  freezeState: FreezeState;
  fetchRowRemainder: typeof fetchRowRemainder;
  updateFreezeState: typeof updateFreezeState;
};

const DefaultColumns = 18278;

const createContext = (options?: {
  pinned?: Array<[number, number]>;
  merges?: Array<[Sref, MergeSpan]>;
  offscreen?: Grid;
  frozenRows?: number;
  rowOrder?: Array<string>;
}): Context => {
  const rowDim = new DimensionIndex(DefaultCellHeight);
  const colDim = new DimensionIndex(100);
  const offscreen = options?.offscreen ?? new Map();
  return {
    sheet: {
      getStore: () => ({
        getDimensionSizes: async () => new Map(options?.pinned ?? []),
        getRowOrder: () => options?.rowOrder ?? [],
      }),
      getMerges: () => new Map(options?.merges ?? []),
      getDimension: () => ({ rows: 1000000, columns: DefaultColumns }),
      getFreezePane: () => ({
        frozenRows: options?.frozenRows ?? 0,
        frozenCols: 0,
      }),
      fetchGrid: async (range: Range) => {
        const within: Grid = new Map();
        for (const [sref, cell] of offscreen) {
          const col = colOf(sref);
          if (col >= range[0].c && col <= range[1].c) {
            within.set(sref, cell);
          }
        }
        return within;
      },
    },
    resizeDragging: false,
    hiddenRows: new Set<number>(),
    autoSizedRows: new Set<number>(),
    autoSizedRowIds: new Map<number, string>(),
    autoSizedMaxRow: 0,
    autoSizedRenumberings: 0,
    rowDim,
    colDim,
    freezeState: options?.frozenRows
      ? buildFreezeState(options.frozenRows, 0, rowDim, colDim)
      : NoFreeze,
    fetchRowRemainder,
    updateFreezeState,
  };
};

const colOf = (sref: string): number => {
  const letters = sref.match(/^[A-Z]+/)![0];
  let col = 0;
  for (const ch of letters) {
    col = col * 26 + (ch.charCodeAt(0) - 64);
  }
  return col;
};

const multiLineGrid = (...srefs: Array<Sref>): Grid =>
  new Map(srefs.map((sref) => [sref, { v: 'first\nsecond' }]));

describe('Worksheet.applyAutoRowHeights', () => {
  it('grows a row holding a multi-line value', async () => {
    const ctx = createContext();

    const changed = await applyAutoRowHeights.call(
      ctx,
      multiLineGrid('A1'),
      10,
      5,
    );

    expect(changed).toBe(true);
    expect(ctx.rowDim.getSize(1)).toBe(autoRowHeight(2));
    expect(ctx.autoSizedRows.has(1)).toBe(true);
  });

  it('records the axis ID of each fitted row, and the range it measured', async () => {
    const ctx = createContext({ rowOrder: ['r1', 'r2', 'r3'] });

    await applyAutoRowHeights.call(ctx, multiLineGrid('A2'), 10, 5);

    expect(ctx.autoSizedRowIds).toEqual(new Map([[2, 'r2']]));
    expect(ctx.autoSizedMaxRow).toBe(10);
  });

  it('forgets the axis ID of a row that shrinks back to the default', async () => {
    const ctx = createContext({ rowOrder: ['r1', 'r2'] });
    await applyAutoRowHeights.call(ctx, multiLineGrid('A2'), 10, 5);

    await applyAutoRowHeights.call(ctx, new Map(), 10, 5);

    expect(ctx.autoSizedRows.has(2)).toBe(false);
    expect(ctx.autoSizedRowIds.has(2)).toBe(false);
  });

  it('reports no change once the rows already fit', async () => {
    const ctx = createContext();
    await applyAutoRowHeights.call(ctx, multiLineGrid('A1'), 10, 5);

    expect(
      await applyAutoRowHeights.call(ctx, multiLineGrid('A1'), 10, 5),
    ).toBe(false);
  });

  it('returns a row to the default height when its content shrinks', async () => {
    const ctx = createContext();
    await applyAutoRowHeights.call(ctx, multiLineGrid('A1'), 10, 5);

    const changed = await applyAutoRowHeights.call(ctx, new Map(), 10, 5);

    expect(changed).toBe(true);
    expect(ctx.rowDim.getSize(1)).toBe(DefaultCellHeight);
    expect(ctx.autoSizedRows.size).toBe(0);
  });

  it('leaves a row that fell out of the fetched range alone', async () => {
    const ctx = createContext();
    await applyAutoRowHeights.call(ctx, multiLineGrid('A8'), 10, 5);

    const changed = await applyAutoRowHeights.call(ctx, new Map(), 5, 5);

    expect(changed).toBe(false);
    expect(ctx.rowDim.getSize(8)).toBe(autoRowHeight(2));
  });

  it('never overrules a pinned height', async () => {
    const ctx = createContext({ pinned: [[1, 60]] });
    ctx.rowDim.setSize(1, 60);

    const changed = await applyAutoRowHeights.call(
      ctx,
      multiLineGrid('A1'),
      10,
      5,
    );

    expect(changed).toBe(false);
    expect(ctx.rowDim.getSize(1)).toBe(60);
  });

  it('leaves hidden rows at zero height', async () => {
    const ctx = createContext();
    // Seed the row as auto-sized so the pass has a candidate to walk: the
    // hidden-row guard is what has to spare it, not the early return.
    ctx.autoSizedRows.add(1);
    ctx.hiddenRows.add(1);
    ctx.rowDim.setSize(1, 0);

    const changed = await applyAutoRowHeights.call(
      ctx,
      multiLineGrid('A1'),
      10,
      5,
    );

    expect(changed).toBe(false);
    expect(ctx.rowDim.getSize(1)).toBe(0);
    expect(ctx.autoSizedRows.has(1)).toBe(true);
  });

  it('skips the anchor row of a merge spanning several rows', async () => {
    const ctx = createContext({ merges: [['A1', { rs: 2, cs: 1 }]] });

    const changed = await applyAutoRowHeights.call(
      ctx,
      multiLineGrid('A1'),
      10,
      5,
    );

    expect(changed).toBe(false);
    expect(ctx.rowDim.getSize(1)).toBe(DefaultCellHeight);
  });

  it('keeps an auto-sized row at its height once it becomes a merge anchor', async () => {
    const ctx = createContext();
    await applyAutoRowHeights.call(ctx, multiLineGrid('A1'), 10, 5);
    expect(ctx.rowDim.getSize(1)).toBe(autoRowHeight(2));

    // The same row, now the anchor of a two-row merge: it is excluded from
    // measurement, so it must not be shrunk by the same pass either.
    const merged = createContext({ merges: [['A1', { rs: 2, cs: 1 }]] });
    merged.rowDim = ctx.rowDim;
    merged.autoSizedRows = ctx.autoSizedRows;

    const changed = await applyAutoRowHeights.call(
      merged,
      multiLineGrid('A1'),
      10,
      5,
    );

    expect(changed).toBe(false);
    expect(merged.rowDim.getSize(1)).toBe(autoRowHeight(2));
  });

  it('does not fight a row-border drag in progress', async () => {
    const ctx = createContext();
    ctx.resizeDragging = true;
    ctx.rowDim.setSize(1, 90);

    const changed = await applyAutoRowHeights.call(
      ctx,
      multiLineGrid('A1'),
      10,
      5,
    );

    expect(changed).toBe(false);
    expect(ctx.rowDim.getSize(1)).toBe(90);
  });

  it('measures columns to the right of the fetched viewport', async () => {
    const ctx = createContext({ offscreen: multiLineGrid('Z1') });

    // The painter fetched columns A..E only; the tall cell lives in Z.
    const changed = await applyAutoRowHeights.call(ctx, new Map(), 10, 5);

    expect(changed).toBe(true);
    expect(ctx.rowDim.getSize(1)).toBe(autoRowHeight(2));
  });

  it('keeps a row at its height when its tall cell scrolls off to the right', async () => {
    const ctx = createContext({ offscreen: multiLineGrid('Z1') });
    await applyAutoRowHeights.call(ctx, multiLineGrid('Z1'), 10, 26);
    expect(ctx.rowDim.getSize(1)).toBe(autoRowHeight(2));

    // Scrolled back left: the painted grid no longer holds Z1, but the row
    // is still as tall as its tallest cell.
    const changed = await applyAutoRowHeights.call(ctx, new Map(), 10, 5);

    expect(changed).toBe(false);
    expect(ctx.rowDim.getSize(1)).toBe(autoRowHeight(2));
  });

  it('rebuilds the cached freeze state after sizing a frozen row', async () => {
    const ctx = createContext({ frozenRows: 2 });
    const before = ctx.freezeState.frozenHeight;

    const changed = await applyAutoRowHeights.call(
      ctx,
      multiLineGrid('A1'),
      10,
      5,
    );

    expect(changed).toBe(true);
    expect(ctx.freezeState.frozenHeight).toBe(
      before + autoRowHeight(2) - DefaultCellHeight,
    );
  });

  it('leaves the freeze state alone when no frozen row moved', async () => {
    const ctx = createContext({ frozenRows: 2 });
    const before = ctx.freezeState;

    await applyAutoRowHeights.call(ctx, multiLineGrid('A5'), 10, 5);

    expect(ctx.freezeState).toBe(before);
  });
});
