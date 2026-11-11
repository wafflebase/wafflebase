import { describe, expect, it, vi } from 'vitest';
import { Worksheet } from '../../src/view/worksheet';
import { DimensionIndex } from '../../src/model/worksheet/dimensions';
import { DefaultCellHeight } from '../../src/view/layout';

type Proto = Record<string, (...args: never[]) => unknown>;
const proto = Worksheet.prototype as unknown as Proto;

const renderSheet = proto.renderSheet as unknown as (
  targetVersion?: number,
) => Promise<void>;

/**
 * What `renderSheet` hands the fit and the painter, and what it refreshes
 * first. Driven against a hand-built `this`, like the other view suites; the
 * fit itself is a spy, tested in `worksheet-auto-row-height.test.ts`, and so
 * is the painter. Sheet getters the painter's arguments need, and nothing
 * here asserts on, answer `undefined`.
 */
const createContext = (options?: {
  hiddenRows?: boolean;
  hiddenColumns?: boolean;
  fitChanged?: boolean;
}) => {
  const order = ['r1', 'r2', 'r3'];
  const store = {
    getRowOrder: vi.fn(() => [...order]),
    getColOrder: () => [],
    getAxisCoverage: () => ({ rows: order.length, cols: 0 }),
    listThreads: async () => [],
  };
  const known: Record<string, unknown> = {
    getStore: () => store,
    getHiddenRows: () => new Set(),
    getHiddenColumns: () => new Set(),
    // A peer inserts a row at the top while the grid is being fetched.
    fetchGrid: vi.fn(async () => {
      order.unshift('peer');
      return new Map();
    }),
  };
  const sheet = new Proxy(known, {
    get: (target, prop: string) => target[prop] ?? (() => undefined),
  });
  const ctx = {
    sheet,
    renderVersion: 1,
    zoom: 1.5,
    gridSize: { width: 1000, height: 1000 },
    freezeState: { frozenRows: 0, frozenCols: 0 },
    viewport: { left: 0, top: 0, width: 800, height: 600 },
    scroll: { left: 0, top: 0 },
    viewRange: [
      { r: 1, c: 1 },
      { r: 30, c: 10 },
    ],
    rowDim: new DimensionIndex(DefaultCellHeight),
    gridContainer: { updateDummySize: vi.fn() },
    gridCanvas: { render: vi.fn() },
    takeRowAxis: proto.takeRowAxis,
    syncHiddenRowsFromSheet: vi.fn(() => options?.hiddenRows ?? false),
    syncHiddenColumnsFromSheet: vi.fn(() => options?.hiddenColumns ?? false),
    updateFreezeState: vi.fn(),
    refreshLinkHoverAfterRender: vi.fn(),
    render: vi.fn(),
    applyAutoRowHeights: vi.fn(
      async (..._args: Array<unknown>) => options?.fitChanged ?? false,
    ),
  };
  return { ctx, store };
};

describe('Worksheet.renderSheet', () => {
  it('hands the fit and the painter the row order the grid was read against', async () => {
    const { ctx, store } = createContext();

    await renderSheet.call(ctx, 1);

    const axis = ctx.applyAutoRowHeights.mock.calls[0][3] as {
      order: Array<string>;
    };
    expect(axis.order).toEqual(['r1', 'r2', 'r3']);
    // The painter's argument after `zoom` is the row order.
    const painted = ctx.gridCanvas.render.mock.calls[0];
    expect(painted[painted.indexOf(1.5) + 1]).toBe(axis.order);
    // One copy of the axis for the whole pass.
    expect(store.getRowOrder).toHaveBeenCalledTimes(1);
  });

  it('lines the fitted heights up with that order before anything reads them', async () => {
    const { ctx } = createContext();
    // Fitted for r2 while it sat at row 3; a peer's move the view has not
    // reloaded yet put it at row 2.
    ctx.rowDim.setFittedSize(3, 80, 'r2');

    await renderSheet.call(ctx, 1);

    expect(ctx.rowDim.getSize(2)).toBe(80);
    expect(ctx.updateFreezeState).toHaveBeenCalledTimes(1);
  });

  it('paints nothing when the fit changed a height', async () => {
    const { ctx } = createContext({ fitChanged: true });

    await renderSheet.call(ctx, 1);

    expect(ctx.render).toHaveBeenCalledTimes(1);
    expect(ctx.gridCanvas.render).not.toHaveBeenCalled();
  });

  it('rebuilds the cached freeze state when rows were hidden or shown', async () => {
    const { ctx } = createContext({ hiddenRows: true });

    await renderSheet.call(ctx, 1);

    expect(ctx.updateFreezeState).toHaveBeenCalledTimes(1);
  });

  it('rebuilds it when columns were hidden or shown', async () => {
    const { ctx } = createContext({ hiddenColumns: true });

    await renderSheet.call(ctx, 1);

    expect(ctx.updateFreezeState).toHaveBeenCalledTimes(1);
  });

  it('leaves the freeze state alone when nothing moved, was hidden or shown', async () => {
    const { ctx } = createContext();

    await renderSheet.call(ctx, 1);

    expect(ctx.updateFreezeState).not.toHaveBeenCalled();
  });
});
