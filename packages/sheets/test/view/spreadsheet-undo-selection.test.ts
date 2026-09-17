import { describe, expect, it, vi } from 'vitest';
import { Spreadsheet } from '../../src/view/spreadsheet';
import { Sheet } from '../../src/model/worksheet/sheet';
import { MemStore } from '../../src/store/memory';
import type { UndoSelection } from '../../src/store/store';

/**
 * `Spreadsheet.focusUndoSelection` is the landing half of a cross-tab undo:
 * the engine that reported the step has already been torn down, the host has
 * switched tabs, and this is what turns the reported `UndoSelection` into a
 * selection on the newly mounted grid. Without it the undo applies to the
 * CRDT and shows nothing — the exact defect the feature exists to remove — so
 * it is covered at both levels.
 *
 * The substance lives in `Sheet.applySelection`, which the same-tab path also
 * runs, so that is exercised against a real `Sheet`. The `Spreadsheet` wrapper
 * is called against a hand-built context, the technique
 * `spreadsheet-readonly-recalc.test.ts` uses.
 */
type FocusContext = {
  sheet: { applySelection: ReturnType<typeof vi.fn> } | undefined;
  worksheet: {
    render: ReturnType<typeof vi.fn>;
    revealActiveCell: ReturnType<typeof vi.fn>;
  };
  notifySelectionChange: ReturnType<typeof vi.fn>;
};

const focusUndoSelection = (
  Spreadsheet.prototype as unknown as {
    focusUndoSelection: (selection: UndoSelection) => void;
  }
).focusUndoSelection;

const createContext = (withSheet = true): FocusContext => ({
  sheet: withSheet ? { applySelection: vi.fn() } : undefined,
  worksheet: { render: vi.fn(), revealActiveCell: vi.fn() },
  notifySelectionChange: vi.fn(),
});

const cellSelection: UndoSelection = {
  tabId: 'tab-1-aaa',
  otherTab: true,
  selectionType: 'cell',
  range: [
    { r: 3, c: 2 },
    { r: 3, c: 2 },
  ],
};

describe('Spreadsheet.focusUndoSelection', () => {
  it('applies the selection, repaints and scrolls it into view', () => {
    const ctx = createContext();

    focusUndoSelection.call(ctx, cellSelection);

    expect(ctx.sheet!.applySelection).toHaveBeenCalledWith(cellSelection);
    expect(ctx.worksheet.render).toHaveBeenCalledTimes(1);
    // Landing on a cell nobody can see would be the same as not landing.
    expect(ctx.worksheet.revealActiveCell).toHaveBeenCalledTimes(1);
    expect(ctx.notifySelectionChange).toHaveBeenCalledTimes(1);
  });

  it('does nothing before a sheet is attached', () => {
    const ctx = createContext(false);

    focusUndoSelection.call(ctx, cellSelection);

    expect(ctx.worksheet.render).not.toHaveBeenCalled();
    expect(ctx.worksheet.revealActiveCell).not.toHaveBeenCalled();
    expect(ctx.notifySelectionChange).not.toHaveBeenCalled();
  });
});

/**
 * `Spreadsheet.undo` / `redo` restore the selection through the model and then
 * have to bring it on screen — a selection scrolled out of view is the same as
 * no selection. The keyboard path in `worksheet.ts` already did this; the
 * public API path did not.
 */
type ReplayContext = {
  _readOnly: boolean;
  sheet: { undo: ReturnType<typeof vi.fn>; redo: ReturnType<typeof vi.fn> } | undefined;
  worksheet: {
    render: ReturnType<typeof vi.fn>;
    revealActiveCell: ReturnType<typeof vi.fn>;
  };
  notifySelectionChange: ReturnType<typeof vi.fn>;
};

const prototype = Spreadsheet.prototype as unknown as {
  undo: () => Promise<void>;
  redo: () => Promise<void>;
};

const createReplayContext = (
  changed: boolean,
  readOnly = false,
): ReplayContext => ({
  _readOnly: readOnly,
  sheet: {
    undo: vi.fn().mockResolvedValue(changed),
    redo: vi.fn().mockResolvedValue(changed),
  },
  worksheet: { render: vi.fn(), revealActiveCell: vi.fn() },
  notifySelectionChange: vi.fn(),
});

describe('Spreadsheet undo/redo reveal', () => {
  it('scrolls the restored selection into view after an undo', async () => {
    const ctx = createReplayContext(true);

    await prototype.undo.call(ctx);

    expect(ctx.worksheet.render).toHaveBeenCalledTimes(1);
    expect(ctx.worksheet.revealActiveCell).toHaveBeenCalledTimes(1);
  });

  it('scrolls the restored selection into view after a redo', async () => {
    const ctx = createReplayContext(true);

    await prototype.redo.call(ctx);

    expect(ctx.worksheet.revealActiveCell).toHaveBeenCalledTimes(1);
  });

  it('does not scroll when there was nothing to replay', async () => {
    const ctx = createReplayContext(false);

    await prototype.undo.call(ctx);

    expect(ctx.worksheet.render).not.toHaveBeenCalled();
    expect(ctx.worksheet.revealActiveCell).not.toHaveBeenCalled();
  });

  it('does not replay at all on a read-only mount', async () => {
    const ctx = createReplayContext(true, true);

    await prototype.undo.call(ctx);

    expect(ctx.sheet!.undo).not.toHaveBeenCalled();
    expect(ctx.worksheet.revealActiveCell).not.toHaveBeenCalled();
  });
});

describe('Sheet.applySelection', () => {
  const sheet = () => new Sheet(new MemStore());

  it('puts the cursor on a single cell without opening a range', () => {
    const s = sheet();

    s.applySelection({ ...cellSelection });

    expect(s.getActiveCell()).toEqual({ r: 3, c: 2 });
    expect(s.getRanges()).toEqual([]);
    expect(s.getSelectionType()).toBe('cell');
  });

  it('opens a range for a multi-cell step', () => {
    const s = sheet();

    s.applySelection({
      tabId: 'tab-1-aaa',
      otherTab: true,
      selectionType: 'cell',
      range: [
        { r: 2, c: 2 },
        { r: 5, c: 4 },
      ],
    });

    expect(s.getActiveCell()).toEqual({ r: 2, c: 2 });
    expect(s.getRanges()).toEqual([
      [
        { r: 2, c: 2 },
        { r: 5, c: 4 },
      ],
    ]);
  });

  it('restores a multi-row header selection', () => {
    const s = sheet();

    s.applySelection({
      tabId: 'tab-1-aaa',
      otherTab: true,
      selectionType: 'row',
      range: [
        { r: 3, c: 1 },
        { r: 5, c: 1 },
      ],
    });

    expect(s.getSelectionType()).toBe('row');
    expect(s.getActiveCell()).toEqual({ r: 3, c: 1 });
    const [[start, end]] = s.getRanges();
    expect(start).toEqual({ r: 3, c: 1 });
    expect(end.r).toBe(5);
    // Spans the sheet's own width, not the width the reporter guessed.
    expect(end.c).toBeGreaterThan(1);
  });

  it('restores a single-row header selection', () => {
    const s = sheet();

    s.applySelection({
      tabId: 'tab-1-aaa',
      otherTab: true,
      selectionType: 'row',
      range: [
        { r: 4, c: 1 },
        { r: 4, c: 1 },
      ],
    });

    expect(s.getSelectionType()).toBe('row');
    const [[start, end]] = s.getRanges();
    expect(start.r).toBe(4);
    expect(end.r).toBe(4);
  });

  it('restores a multi-column header selection', () => {
    const s = sheet();

    s.applySelection({
      tabId: 'tab-1-aaa',
      otherTab: true,
      selectionType: 'column',
      range: [
        { r: 1, c: 2 },
        { r: 1, c: 4 },
      ],
    });

    expect(s.getSelectionType()).toBe('column');
    expect(s.getActiveCell()).toEqual({ r: 1, c: 2 });
    const [[start, end]] = s.getRanges();
    expect(start.c).toBe(2);
    expect(end.c).toBe(4);
    expect(end.r).toBeGreaterThan(1);
  });

  it('holds the merge invariant on the landing tab too', async () => {
    const s = sheet();
    s.selectStart({ r: 2, c: 2 });
    s.selectEnd({ r: 4, c: 4 });
    expect(await s.mergeSelection()).toBe(true);

    s.applySelection({
      tabId: 'tab-1-aaa',
      otherTab: true,
      selectionType: 'cell',
      range: [
        { r: 3, c: 3 },
        { r: 3, c: 3 },
      ],
    });

    expect(s.getActiveCell()).toEqual({ r: 2, c: 2 });
  });

  it('leaves the selection alone for a step with no coordinates', () => {
    const s = sheet();
    s.selectStart({ r: 6, c: 2 });

    s.applySelection({
      tabId: 'tab-1-aaa',
      otherTab: true,
      selectionType: 'cell',
    });

    expect(s.getActiveCell()).toEqual({ r: 6, c: 2 });
  });
});
