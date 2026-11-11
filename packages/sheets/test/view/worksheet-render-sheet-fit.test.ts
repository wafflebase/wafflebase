import { describe, expect, it, vi } from 'vitest';
import { Worksheet } from '../../src/view/worksheet';

const renderSheet = (
  Worksheet.prototype as unknown as {
    renderSheet: (targetVersion?: number) => Promise<void>;
  }
).renderSheet;

/**
 * What `renderSheet` hands the fit, and what it refreshes first. Driven
 * against a hand-built `this`, like the other view suites; the fit itself is
 * a spy, tested in `worksheet-auto-row-height.test.ts`. It asks for another
 * frame, so nothing past it runs.
 */
const createContext = (options?: { hiddenChanged?: boolean }) => {
  const order = ['r1', 'r2', 'r3'];
  const ctx = {
    renderVersion: 1,
    zoom: 1,
    gridSize: { width: 1000, height: 1000 },
    freezeState: { frozenRows: 0, frozenCols: 0 },
    viewport: { left: 0, top: 0, width: 800, height: 600 },
    scroll: { left: 0, top: 0 },
    viewRange: [
      { r: 1, c: 1 },
      { r: 30, c: 10 },
    ],
    gridContainer: { updateDummySize: vi.fn() },
    syncHiddenRowsFromSheet: vi.fn(() => options?.hiddenChanged ?? false),
    syncHiddenColumnsFromSheet: vi.fn(() => false),
    updateFreezeState: vi.fn(),
    render: vi.fn(),
    applyAutoRowHeights: vi.fn(async (..._args: Array<unknown>) => true),
    sheet: {
      getStore: () => ({ getRowOrder: () => [...order] }),
      // A peer inserts a row at the top while the grid is being fetched.
      fetchGrid: vi.fn(async () => {
        order.unshift('peer');
        return new Map();
      }),
    },
  };
  return ctx;
};

describe('Worksheet.renderSheet', () => {
  it('passes the fit the row order the grid was read against', async () => {
    const ctx = createContext();

    await renderSheet.call(ctx, 1);

    expect(ctx.applyAutoRowHeights).toHaveBeenCalledTimes(1);
    expect(ctx.applyAutoRowHeights.mock.calls[0][3]).toEqual(['r1', 'r2', 'r3']);
  });

  it('rebuilds the cached freeze state when rows were hidden or shown', async () => {
    const ctx = createContext({ hiddenChanged: true });

    await renderSheet.call(ctx, 1);

    expect(ctx.updateFreezeState).toHaveBeenCalledTimes(1);
  });

  it('leaves the freeze state alone when nothing was hidden or shown', async () => {
    const ctx = createContext();

    await renderSheet.call(ctx, 1);

    expect(ctx.updateFreezeState).not.toHaveBeenCalled();
  });
});
