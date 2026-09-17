import { describe, it, expect, vi } from 'vitest';
import { MemStore } from '../../src/store/memory';
import { Sheet } from '../../src/model/worksheet/sheet';
import type { UndoResult, UndoSelection } from '../../src/store/store';

const TabA = 'tab-1-aaa';
const TabB = 'tab-2-bbb';

/**
 * A store whose history replays one scripted result. `MemStore` keeps no
 * history of its own (it answers `{ success: false }`), so the selection
 * restore is exercised here rather than through a real collaborative store.
 */
class ScriptedHistoryStore extends MemStore {
  constructor(private result: UndoResult) {
    super();
  }

  async undo(): Promise<UndoResult> {
    return this.result;
  }

  async redo(): Promise<UndoResult> {
    return this.result;
  }
}

async function sheetAfterUndo(result: UndoResult): Promise<Sheet> {
  const sheet = new Sheet(new ScriptedHistoryStore(result));
  await sheet.undo();
  return sheet;
}

describe('Sheet undo selection', () => {
  it('puts the cursor on a single changed cell', async () => {
    const sheet = await sheetAfterUndo({
      success: true,
      selection: {
        tabId: TabA,
        otherTab: false,
        selectionType: 'cell',
        range: [
          { r: 4, c: 3 },
          { r: 4, c: 3 },
        ],
      },
    });

    expect(sheet.getActiveCell()).toEqual({ r: 4, c: 3 });
    // A single cell is a cursor, not a range — the shape a click leaves.
    expect(sheet.getRanges()).toEqual([]);
    expect(sheet.getSelectionType()).toBe('cell');
  });

  it('selects the whole range a multi-cell step changed', async () => {
    const sheet = await sheetAfterUndo({
      success: true,
      selection: {
        tabId: TabA,
        otherTab: false,
        selectionType: 'cell',
        range: [
          { r: 2, c: 2 },
          { r: 5, c: 4 },
        ],
      },
    });

    expect(sheet.getActiveCell()).toEqual({ r: 2, c: 2 });
    expect(sheet.getRanges()).toEqual([
      [
        { r: 2, c: 2 },
        { r: 5, c: 4 },
      ],
    ]);
  });

  it('selects row headers for a structural row step', async () => {
    const sheet = await sheetAfterUndo({
      success: true,
      selection: {
        tabId: TabA,
        otherTab: false,
        selectionType: 'row',
        range: [
          { r: 3, c: 1 },
          { r: 5, c: 1 },
        ],
      },
    });

    expect(sheet.getSelectionType()).toBe('row');
    expect(sheet.getActiveCell()).toEqual({ r: 3, c: 1 });
    const [[start, end]] = sheet.getRanges();
    expect(start).toEqual({ r: 3, c: 1 });
    expect(end.r).toBe(5);
    // The range spans the sheet's own width, not whatever the store reported.
    expect(end.c).toBeGreaterThan(1);
  });

  it('selects column headers for a structural column step', async () => {
    const sheet = await sheetAfterUndo({
      success: true,
      selection: {
        tabId: TabA,
        otherTab: false,
        selectionType: 'column',
        range: [
          { r: 1, c: 2 },
          { r: 1, c: 2 },
        ],
      },
    });

    expect(sheet.getSelectionType()).toBe('column');
    expect(sheet.getActiveCell()).toEqual({ r: 1, c: 2 });
    const [[, end]] = sheet.getRanges();
    expect(end.c).toBe(2);
    expect(end.r).toBeGreaterThan(1);
  });

  it('never leaves the cursor or a range cutting a merged block', async () => {
    // Every other selection path holds this invariant (`selectStart`,
    // `selectEnd`, `resizeRange`). A replayed step reports raw coordinates,
    // so it can land inside a block that a click never could.
    const store = new ScriptedHistoryStore({
      success: true,
      selection: {
        tabId: TabA,
        otherTab: false,
        selectionType: 'cell',
        range: [
          { r: 3, c: 3 },
          { r: 3, c: 3 },
        ],
      },
    });
    const sheet = new Sheet(store);
    sheet.selectStart({ r: 2, c: 2 });
    sheet.selectEnd({ r: 4, c: 4 });
    expect(await sheet.mergeSelection()).toBe(true);

    await sheet.undo();

    // C3 sits inside the B2:D4 block, so the cursor snaps to its anchor.
    expect(sheet.getActiveCell()).toEqual({ r: 2, c: 2 });
    expect(sheet.getRanges()).toEqual([]);
  });

  it('expands a restored range to cover the merges it cuts', async () => {
    const store = new ScriptedHistoryStore({
      success: true,
      selection: {
        tabId: TabA,
        otherTab: false,
        selectionType: 'cell',
        range: [
          { r: 1, c: 1 },
          { r: 3, c: 3 },
        ],
      },
    });
    const sheet = new Sheet(store);
    sheet.selectStart({ r: 2, c: 2 });
    sheet.selectEnd({ r: 5, c: 5 });
    expect(await sheet.mergeSelection()).toBe(true);

    await sheet.undo();

    // A1:C3 clips the B2:E5 block, so the range grows to contain it whole.
    expect(sheet.getRanges()).toEqual([
      [
        { r: 1, c: 1 },
        { r: 5, c: 5 },
      ],
    ]);
  });

  it('reports a step in another tab instead of moving this one', async () => {
    const selection: UndoSelection = {
      tabId: TabB,
      otherTab: true,
      selectionType: 'cell',
      range: [
        { r: 7, c: 7 },
        { r: 7, c: 7 },
      ],
    };
    const sheet = new Sheet(new ScriptedHistoryStore({ success: true, selection }));
    const onJump = vi.fn();
    sheet.setOnUndoTabJump(onJump);

    await sheet.undo();

    expect(onJump).toHaveBeenCalledWith(selection);
    // This mount holds a different tab, so its own cursor must not move.
    expect(sheet.getActiveCell()).toEqual({ r: 1, c: 1 });
  });

  it('leaves the selection alone for a step with no coordinates', async () => {
    const sheet = new Sheet(
      new ScriptedHistoryStore({
        success: true,
        selection: { tabId: TabA, otherTab: false, selectionType: 'cell' },
      }),
    );
    sheet.selectStart({ r: 6, c: 2 });

    await sheet.undo();

    expect(sheet.getActiveCell()).toEqual({ r: 6, c: 2 });
  });

  it('leaves the selection alone when there was nothing to undo', async () => {
    const sheet = new Sheet(new ScriptedHistoryStore({ success: false }));
    sheet.selectStart({ r: 3, c: 3 });

    expect(await sheet.undo()).toBe(false);
    expect(sheet.getActiveCell()).toEqual({ r: 3, c: 3 });
  });

  it('restores on redo the same way it does on undo', async () => {
    const sheet = new Sheet(
      new ScriptedHistoryStore({
        success: true,
        selection: {
          tabId: TabA,
          otherTab: false,
          selectionType: 'cell',
          range: [
            { r: 2, c: 5 },
            { r: 2, c: 5 },
          ],
        },
      }),
    );

    expect(await sheet.redo()).toBe(true);
    expect(sheet.getActiveCell()).toEqual({ r: 2, c: 5 });
  });
});
