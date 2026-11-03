import { describe, expect, it } from 'vitest';
import { Worksheet } from '../../src/view/worksheet';
import { autoRowHeight } from '../../src/view/auto-row-height';
import { DefaultCellHeight } from '../../src/view/layout';
import { DimensionIndex } from '../../src/model/worksheet/dimensions';
import type { Grid, MergeSpan, Sref } from '../../src/model/core/types';

const applyAutoRowHeights = (
  Worksheet.prototype as unknown as {
    applyAutoRowHeights: (grid: Grid, maxRow: number) => Promise<boolean>;
  }
).applyAutoRowHeights;

type Context = {
  sheet: unknown;
  resizeDragging: boolean;
  hiddenRows: Set<number>;
  autoSizedRows: Set<number>;
  rowDim: DimensionIndex;
};

const createContext = (options?: {
  pinned?: Array<[number, number]>;
  merges?: Array<[Sref, MergeSpan]>;
}): Context => ({
  sheet: {
    getStore: () => ({
      getDimensionSizes: async () => new Map(options?.pinned ?? []),
    }),
    getMerges: () => new Map(options?.merges ?? []),
  },
  resizeDragging: false,
  hiddenRows: new Set<number>(),
  autoSizedRows: new Set<number>(),
  rowDim: new DimensionIndex(DefaultCellHeight),
});

const multiLineGrid = (...srefs: Array<Sref>): Grid =>
  new Map(srefs.map((sref) => [sref, { v: 'first\nsecond' }]));

describe('Worksheet.applyAutoRowHeights', () => {
  it('grows a row holding a multi-line value', async () => {
    const ctx = createContext();

    const changed = await applyAutoRowHeights.call(
      ctx,
      multiLineGrid('A1'),
      10,
    );

    expect(changed).toBe(true);
    expect(ctx.rowDim.getSize(1)).toBe(autoRowHeight(2));
    expect(ctx.autoSizedRows.has(1)).toBe(true);
  });

  it('reports no change once the rows already fit', async () => {
    const ctx = createContext();
    await applyAutoRowHeights.call(ctx, multiLineGrid('A1'), 10);

    expect(await applyAutoRowHeights.call(ctx, multiLineGrid('A1'), 10)).toBe(
      false,
    );
  });

  it('returns a row to the default height when its content shrinks', async () => {
    const ctx = createContext();
    await applyAutoRowHeights.call(ctx, multiLineGrid('A1'), 10);

    const changed = await applyAutoRowHeights.call(ctx, new Map(), 10);

    expect(changed).toBe(true);
    expect(ctx.rowDim.getSize(1)).toBe(DefaultCellHeight);
    expect(ctx.autoSizedRows.size).toBe(0);
  });

  it('leaves a row that fell out of the fetched range alone', async () => {
    const ctx = createContext();
    await applyAutoRowHeights.call(ctx, multiLineGrid('A8'), 10);

    const changed = await applyAutoRowHeights.call(ctx, new Map(), 5);

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
    );

    expect(changed).toBe(false);
    expect(ctx.rowDim.getSize(1)).toBe(60);
  });

  it('leaves hidden rows at zero height', async () => {
    const ctx = createContext();
    ctx.hiddenRows.add(1);
    ctx.rowDim.setSize(1, 0);

    const changed = await applyAutoRowHeights.call(
      ctx,
      multiLineGrid('A1'),
      10,
    );

    expect(changed).toBe(false);
    expect(ctx.rowDim.getSize(1)).toBe(0);
  });

  it('skips the anchor row of a merge spanning several rows', async () => {
    const ctx = createContext({ merges: [['A1', { rs: 2, cs: 1 }]] });

    const changed = await applyAutoRowHeights.call(
      ctx,
      multiLineGrid('A1'),
      10,
    );

    expect(changed).toBe(false);
    expect(ctx.rowDim.getSize(1)).toBe(DefaultCellHeight);
  });

  it('does not fight a row-border drag in progress', async () => {
    const ctx = createContext();
    ctx.resizeDragging = true;
    ctx.rowDim.setSize(1, 90);

    const changed = await applyAutoRowHeights.call(
      ctx,
      multiLineGrid('A1'),
      10,
    );

    expect(changed).toBe(false);
    expect(ctx.rowDim.getSize(1)).toBe(90);
  });
});
