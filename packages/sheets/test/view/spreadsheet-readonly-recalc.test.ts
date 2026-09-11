import { describe, expect, it, vi } from 'vitest';
import { Spreadsheet } from '../../src/view/spreadsheet';

/**
 * `Spreadsheet.recalculateCrossSheetFormulas` is the engine-level backstop for
 * a read-only mount: `Sheet.recalculateCrossSheetFormulas` opens a store batch
 * and persists every formula's new cached value through it, so on a share-link
 * `viewer` the pass is a `doc.update()` the Yorkie auth webhook refuses —
 * wedging that viewer's own sync. The gate exists so no call site, present or
 * future, can leak it; the repaint still has to happen either way.
 *
 * Constructing a real `Spreadsheet` needs a DOM container, a `Store` and an
 * async `initialize()`. The method under test reads exactly three fields off
 * `this`, so it is called against a hand-built context — the same technique
 * `worksheet-readonly-editing.test.ts` uses for `Worksheet.finishEditing`.
 */
type RecalcContext = {
  _readOnly: boolean;
  sheet: { recalculateCrossSheetFormulas: ReturnType<typeof vi.fn> } | undefined;
  worksheet: { render: ReturnType<typeof vi.fn> };
};

const recalculate = (
  Spreadsheet.prototype as unknown as {
    recalculateCrossSheetFormulas: () => Promise<void>;
  }
).recalculateCrossSheetFormulas;

const createContext = (readOnly: boolean): RecalcContext => ({
  _readOnly: readOnly,
  sheet: {
    recalculateCrossSheetFormulas: vi.fn().mockResolvedValue(undefined),
  },
  worksheet: { render: vi.fn() },
});

describe('Spreadsheet read-only cross-sheet recalculation', () => {
  it('recalculates and repaints on a writable mount', async () => {
    const ctx = createContext(false);

    await recalculate.call(ctx);

    expect(ctx.sheet!.recalculateCrossSheetFormulas).toHaveBeenCalledTimes(1);
    expect(ctx.worksheet.render).toHaveBeenCalledTimes(1);
  });

  it('repaints without recalculating on a read-only mount', async () => {
    const ctx = createContext(true);

    await recalculate.call(ctx);

    // The write the webhook would refuse is never attempted...
    expect(ctx.sheet!.recalculateCrossSheetFormulas).not.toHaveBeenCalled();
    // ...but the viewer's grid is still repainted from the cached values the
    // document already carries, so the caller's reason for asking (another
    // tab's data changed) still produces a frame.
    expect(ctx.worksheet.render).toHaveBeenCalledTimes(1);
  });

  it('does nothing at all before a sheet is attached', async () => {
    const ctx = createContext(true);
    ctx.sheet = undefined;

    await recalculate.call(ctx);

    expect(ctx.worksheet.render).not.toHaveBeenCalled();
  });
});
