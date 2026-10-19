import { describe, expect, it, vi } from 'vitest';
import { Spreadsheet } from '../../src/view/spreadsheet';
import type { Ref } from '../../src/model/core/types';

/**
 * `find` scans the grid asynchronously, so a search dispatched from the find
 * bar outlives the bar itself. The host withholds that bar when a revision
 * preview opens and calls `clearFind()` to drop the highlights it left — but
 * the in-flight scan used to resume afterwards and re-arm everything just
 * cleared, including a `focusCell` that moves the LIVE selection and
 * republishes presence from a document the user is no longer looking at.
 *
 * A search epoch makes an abandoned scan publish nothing. The same guard
 * orders two overlapping queries, so a slow earlier scan can no longer
 * overwrite a newer one's results.
 *
 * Built against a hand-made context, the technique
 * `spreadsheet-undo-selection.test.ts` uses.
 */
type FindContext = {
  sheet:
    | {
        findCells: ReturnType<typeof vi.fn>;
        getActiveCell: () => Ref;
      }
    | undefined;
  worksheet: {
    setSearchHighlights: ReturnType<typeof vi.fn>;
    renderOverlay: ReturnType<typeof vi.fn>;
    cleanup: ReturnType<typeof vi.fn>;
  };
  selectionChangeCallbacks: unknown[];
  focusCell: ReturnType<typeof vi.fn>;
  searchResults: Ref[];
  searchCurrentIndex: number;
  searchEpoch: number;
};

const prototype = Spreadsheet.prototype as unknown as {
  find: (query: string) => Promise<number>;
  findNext: () => Promise<void>;
  clearFind: () => void;
  cleanup: () => void;
  getSearchState: () => { total: number; currentIndex: number };
};

const createContext = (
  findCells: ReturnType<typeof vi.fn>,
  results: Ref[] = [],
): FindContext => ({
  sheet: { findCells, getActiveCell: () => ({ r: 1, c: 1 }) },
  worksheet: {
    setSearchHighlights: vi.fn(),
    renderOverlay: vi.fn(),
    cleanup: vi.fn(),
  },
  selectionChangeCallbacks: [],
  focusCell: vi.fn().mockResolvedValue(undefined),
  searchResults: results,
  searchCurrentIndex: results.length > 0 ? 0 : -1,
  searchEpoch: 0,
});

/** A `findCells` whose promise this test resolves by hand. */
const deferredFindCells = () => {
  let release!: (refs: Ref[]) => void;
  const findCells = vi.fn(
    () =>
      new Promise<Ref[]>((resolve) => {
        release = resolve;
      }),
  );
  return { findCells, release: (refs: Ref[]) => release(refs) };
};

describe('Spreadsheet.find abandonment', () => {
  it('publishes nothing when clearFind lands while the scan is running', async () => {
    const { findCells, release } = deferredFindCells();
    const ctx = createContext(findCells);

    const pending = prototype.find.call(ctx, 'waffle');
    // The preview opens: the bar is withheld and the host clears the find.
    prototype.clearFind.call(ctx);
    ctx.worksheet.setSearchHighlights.mockClear();
    ctx.worksheet.renderOverlay.mockClear();

    release([{ r: 4, c: 2 }]);
    await expect(pending).resolves.toBe(0);

    // The move that would drag the live selection to the match.
    expect(ctx.focusCell).not.toHaveBeenCalled();
    // And the highlights `clearFind` dropped stay dropped.
    expect(ctx.worksheet.setSearchHighlights).not.toHaveBeenCalled();
    expect(prototype.getSearchState.call(ctx)).toEqual({
      total: 0,
      currentIndex: -1,
    });
  });

  it('lets a newer query win over a slower earlier one', async () => {
    const first = deferredFindCells();
    const ctx = createContext(first.findCells);

    const stale = prototype.find.call(ctx, 'waff');

    // The user keeps typing; the second scan answers immediately.
    ctx.sheet!.findCells = vi.fn().mockResolvedValue([{ r: 9, c: 9 }]);
    await prototype.find.call(ctx, 'waffle');
    expect(prototype.getSearchState.call(ctx)).toEqual({
      total: 1,
      currentIndex: 0,
    });

    first.release([
      { r: 1, c: 1 },
      { r: 2, c: 2 },
    ]);
    await expect(stale).resolves.toBe(0);

    expect(prototype.getSearchState.call(ctx)).toEqual({
      total: 1,
      currentIndex: 0,
    });
    expect(ctx.searchResults).toEqual([{ r: 9, c: 9 }]);
  });

  it('still publishes a scan nobody abandoned', async () => {
    const ctx = createContext(vi.fn().mockResolvedValue([{ r: 4, c: 2 }]));

    await expect(prototype.find.call(ctx, 'waffle')).resolves.toBe(1);

    expect(ctx.focusCell).toHaveBeenCalledWith({ r: 4, c: 2 });
    expect(ctx.worksheet.setSearchHighlights).toHaveBeenCalledWith(
      [{ r: 4, c: 2 }],
      0,
    );
  });

  it('re-arms no highlights when clearFind lands mid findNext', async () => {
    const ctx = createContext(vi.fn(), [
      { r: 1, c: 1 },
      { r: 2, c: 2 },
    ]);
    let releaseFocus!: () => void;
    ctx.focusCell = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          releaseFocus = resolve;
        }),
    );

    const pending = prototype.findNext.call(ctx);
    prototype.clearFind.call(ctx);
    ctx.worksheet.setSearchHighlights.mockClear();

    releaseFocus();
    await pending;

    expect(ctx.worksheet.setSearchHighlights).not.toHaveBeenCalled();
  });

  // Teardown is the other way a scan is abandoned: a tab switch or a
  // `SheetView` unmount calls `cleanup()` while the find bar's debounced scan
  // is still awaiting. `Worksheet.cleanup()` drops its sheet, so a resumed
  // scan's `focusCell` would throw in a promise nobody catches.
  it('publishes nothing when cleanup lands while the scan is running', async () => {
    const { findCells, release } = deferredFindCells();
    const ctx = createContext(findCells);

    const pending = prototype.find.call(ctx, 'waffle');
    prototype.cleanup.call(ctx);

    release([{ r: 4, c: 2 }]);
    await expect(pending).resolves.toBe(0);

    expect(ctx.focusCell).not.toHaveBeenCalled();
    expect(ctx.worksheet.setSearchHighlights).not.toHaveBeenCalled();
    expect(ctx.worksheet.renderOverlay).not.toHaveBeenCalled();
  });

  // Enter in the bar steps through the results it already has. That must not
  // cancel the scan for a query the user just typed — the new results would
  // then never be published, leaving the bar on the previous query's matches.
  it('lets a findNext step without cancelling an in-flight find', async () => {
    const { findCells, release } = deferredFindCells();
    const ctx = createContext(findCells, [
      { r: 1, c: 1 },
      { r: 2, c: 2 },
    ]);

    const pending = prototype.find.call(ctx, 'waffle');
    await prototype.findNext.call(ctx);

    release([{ r: 9, c: 9 }]);
    await expect(pending).resolves.toBe(1);
    expect(ctx.searchResults).toEqual([{ r: 9, c: 9 }]);
    expect(ctx.worksheet.setSearchHighlights).toHaveBeenLastCalledWith(
      [{ r: 9, c: 9 }],
      0,
    );
  });
});
