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
      measuredOrder?: ReadonlyArray<string>,
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
 *
 * `order` is the row order the store holds, `r1`, `r2`, … unless a test
 * changes it; `onPinnedRead` runs inside the pass's last await, which is
 * where a peer's change or a local edit lands while the pass is suspended.
 */
type Context = {
  sheet: unknown;
  resizeDragging: boolean;
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
  order?: Array<string>;
  onPinnedRead?: () => void;
}): Context & { order: Array<string> } => {
  const rowDim = new DimensionIndex(DefaultCellHeight);
  const colDim = new DimensionIndex(100);
  const offscreen = options?.offscreen ?? new Map();
  const order = options?.order ?? ids(50);
  return {
    order,
    sheet: {
      getStore: () => ({
        getDimensionSizes: async () => {
          options?.onPinnedRead?.();
          return new Map(options?.pinned ?? []);
        },
        getRowOrder: () => [...order],
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

const ids = (n: number) => Array.from({ length: n }, (_, i) => `r${i + 1}`);

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
    // Fitted, not stored: a reload from the store replaces only the latter.
    expect(ctx.rowDim.getFittedSize(1)).toBe(autoRowHeight(2));
    expect(ctx.rowDim.hasCustomSizes()).toBe(false);
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
    expect(ctx.rowDim.hasFittedSizes()).toBe(false);
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

  it('measures a hidden row, drawing it at zero until it is shown', async () => {
    const ctx = createContext();
    ctx.rowDim.setHidden([1]);

    await applyAutoRowHeights.call(ctx, multiLineGrid('A1'), 10, 5);

    expect(ctx.rowDim.getSize(1)).toBe(0);
    ctx.rowDim.setHidden([]);
    expect(ctx.rowDim.getSize(1)).toBe(autoRowHeight(2));
  });

  it('drops the fitted height of a row somebody pinned', async () => {
    const ctx = createContext({ pinned: [[1, DefaultCellHeight]] });
    ctx.rowDim.setFittedSize(1, autoRowHeight(2), 'r1');

    // Pinned to the default, which `rowDim` stores as no entry at all: the
    // fitted height would otherwise still be what is drawn.
    const changed = await applyAutoRowHeights.call(
      ctx,
      multiLineGrid('A1'),
      10,
      5,
    );

    expect(changed).toBe(true);
    expect(ctx.rowDim.getSize(1)).toBe(DefaultCellHeight);
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

  it('records the axis ID of each row it fits, so the height can follow the row', async () => {
    const ctx = createContext();
    await applyAutoRowHeights.call(ctx, multiLineGrid('A3'), 10, 5);

    // A peer inserts a row at the top; the reload realigns `rowDim`.
    ctx.rowDim.realignFitted(['peer', ...ids(50)]);

    expect(ctx.rowDim.getSize(3)).toBe(DefaultCellHeight);
    expect(ctx.rowDim.getSize(4)).toBe(autoRowHeight(2));
  });

  describe('when rows are renumbered while it awaits', () => {
    // `renderSheet` read the grid against `measuredOrder`; a peer's insert at
    // the top landed during that fetch, so the store now holds `order`.
    const shifted = () => {
      const measuredOrder = ids(50);
      return { measuredOrder, order: ['peer', ...ids(50)] };
    };

    it('reads the remaining columns in the grid’s row numbering', async () => {
      const { measuredOrder, order } = shifted();
      // r1's tall cell, off to the right, read after the insert: at row 2.
      const ctx = createContext({ order, offscreen: multiLineGrid('Z2') });

      await applyAutoRowHeights.call(ctx, new Map(), 10, 5, measuredOrder);

      expect(ctx.rowDim.getSize(1)).toBe(DefaultCellHeight);
      expect(ctx.rowDim.getSize(2)).toBe(autoRowHeight(2));
      expect(ctx.rowDim.getSize(3)).toBe(DefaultCellHeight);
    });

    it('reads the merges in the grid’s row numbering', async () => {
      const { measuredOrder, order } = shifted();
      // r1 anchors a two-row merge, read after the insert: at row 2.
      const ctx = createContext({ order, merges: [['A2', { rs: 2, cs: 1 }]] });

      await applyAutoRowHeights.call(
        ctx,
        multiLineGrid('A1'),
        10,
        5,
        measuredOrder,
      );

      expect(ctx.rowDim.hasFittedSizes()).toBe(false);
    });

    it('sizes the row it measured where a peer’s insert moved it', async () => {
      const ctx = createContext({
        onPinnedRead: () => ctx.order.splice(0, 0, 'peer'),
      });
      const measuredOrder = [...ctx.order];

      const changed = await applyAutoRowHeights.call(
        ctx,
        multiLineGrid('A1'),
        10,
        5,
        measuredOrder,
      );

      expect(changed).toBe(true);
      expect(ctx.rowDim.getSize(1)).toBe(DefaultCellHeight);
      expect(ctx.rowDim.getSize(2)).toBe(autoRowHeight(2));
    });

    it('sizes nothing for a row a peer deleted', async () => {
      const ctx = createContext({
        onPinnedRead: () => ctx.order.splice(0, 1),
      });
      const measuredOrder = [...ctx.order];

      await applyAutoRowHeights.call(
        ctx,
        multiLineGrid('A1'),
        10,
        5,
        measuredOrder,
      );

      expect(ctx.rowDim.hasFittedSizes()).toBe(false);
    });

    it('follows a local insert, which renumbers `rowDim` as well', async () => {
      const ctx = createContext({
        onPinnedRead: () => {
          ctx.order.splice(0, 0, 'new');
          ctx.rowDim.shift(1, 1);
        },
      });
      ctx.rowDim.setFittedSize(5, autoRowHeight(3), 'r5');
      const measuredOrder = [...ctx.order];

      await applyAutoRowHeights.call(
        ctx,
        multiLineGrid('A1', 'A5'),
        10,
        5,
        measuredOrder,
      );

      // r1 measured at 1 now sits at 2; r5 shrank to two lines, at 6.
      expect(ctx.rowDim.getSize(1)).toBe(DefaultCellHeight);
      expect(ctx.rowDim.getSize(2)).toBe(autoRowHeight(2));
      expect(ctx.rowDim.getSize(5)).toBe(DefaultCellHeight);
      expect(ctx.rowDim.getSize(6)).toBe(autoRowHeight(2));
    });

    it('shrinks a row it measured short back to the default where it now sits', async () => {
      const ctx = createContext({
        onPinnedRead: () => ctx.order.splice(0, 0, 'peer'),
      });
      ctx.rowDim.setFittedSize(3, autoRowHeight(2), 'r3');
      const measuredOrder = [...ctx.order];

      // Row 3's tall value is gone; a peer's insert lands mid-pass.
      const changed = await applyAutoRowHeights.call(
        ctx,
        new Map(),
        10,
        5,
        measuredOrder,
      );

      expect(changed).toBe(true);
      expect(ctx.rowDim.hasFittedSizes()).toBe(false);
    });

    it('leaves a fitted row alone that was past the range it measured', async () => {
      const ctx = createContext({
        onPinnedRead: () => ctx.order.splice(0, 1),
      });
      ctx.rowDim.setFittedSize(11, autoRowHeight(2), 'r11');
      const measuredOrder = [...ctx.order];

      // Rows 1..10 are measured; a peer's delete of row 1 then pulls r11 up
      // to 10, inside that range, though its content was never read.
      await applyAutoRowHeights.call(ctx, new Map(), 10, 5, measuredOrder);

      expect(ctx.rowDim.getFittedIndices()).toEqual([10]);
      expect(ctx.rowDim.getSize(10)).toBe(autoRowHeight(2));
    });
  });
});
