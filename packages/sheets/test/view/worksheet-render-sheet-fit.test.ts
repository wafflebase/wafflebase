import { describe, expect, it, vi } from 'vitest';
import { Worksheet } from '../../src/view/worksheet';

const renderSheet = (
  Worksheet.prototype as unknown as {
    renderSheet: (targetVersion?: number) => Promise<void>;
  }
).renderSheet;

/**
 * `renderSheet` hands the fit the reload generation it took *before* fetching
 * the grid the fit measures. A reload that runs during that fetch changes the
 * layout the grid was read against, and only a generation taken before the
 * fetch shows it (#1123). Driven against a hand-built `this`, like the other
 * view suites; the fit itself is a spy, since its own hold-off is tested in
 * `worksheet-auto-row-height.test.ts`.
 */
const createContext = () => {
  const ctx = {
    renderVersion: 1,
    dimensionReloadGeneration: 4,
    zoom: 1,
    gridSize: { width: 1000, height: 1000 },
    freezeState: { frozenRows: 0, frozenCols: 0 },
    viewport: { left: 0, top: 0, width: 800, height: 600 },
    scroll: { left: 0, top: 0 },
    viewRange: [
      { r: 1, c: 1 },
      { r: 30, c: 10 },
    ],
    rowDim: { getRenumberings: () => 3 },
    gridContainer: { updateDummySize: vi.fn() },
    syncHiddenRowsFromSheet: vi.fn(),
    syncHiddenColumnsFromSheet: vi.fn(),
    render: vi.fn(),
    applyAutoRowHeights: vi.fn(async (..._args: Array<unknown>) => true),
    sheet: {
      // A reload starts and finishes while the grid is being fetched.
      fetchGrid: vi.fn(async () => {
        ctx.dimensionReloadGeneration += 2;
        return new Map();
      }),
    },
  };
  return ctx;
};

describe('Worksheet.renderSheet', () => {
  it('passes the fit the reload generation taken before the grid fetch', async () => {
    const ctx = createContext();

    await renderSheet.call(ctx, 1);

    expect(ctx.applyAutoRowHeights).toHaveBeenCalledTimes(1);
    expect(ctx.applyAutoRowHeights.mock.calls[0][3]).toEqual({
      reloadGeneration: 4,
      renumberings: 3,
    });
    // The fit asked for another frame: nothing is painted from this pass.
    expect(ctx.render).toHaveBeenCalledTimes(1);
  });
});
