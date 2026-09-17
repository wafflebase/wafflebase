import { describe, it, expect } from 'vitest';
import {
  resolveUndoSelection,
  type UndoOperation,
  type UndoTabSnapshot,
} from '../../src/model/workbook/undo-selection';

const TabA = 'tab-1-aaa';
const TabB = 'tab-2-bbb';
const TabC = 'tab-3-ccc';

function snapshot(partial: Partial<UndoTabSnapshot> = {}): UndoTabSnapshot {
  return {
    rowOrder: partial.rowOrder ?? ['r1', 'r2', 'r3'],
    colOrder: partial.colOrder ?? ['c1', 'c2', 'c3'],
    rangeStyles: partial.rangeStyles ?? [],
  };
}

/** Both sides identical, for the cases that do not need an axis diff. */
function stable(
  tabs: Record<string, UndoTabSnapshot>,
): [Map<string, UndoTabSnapshot>, Map<string, UndoTabSnapshot>] {
  return [new Map(Object.entries(tabs)), new Map(Object.entries(tabs))];
}

function resolve(
  ops: Array<UndoOperation>,
  tabs: Record<string, UndoTabSnapshot> = { [TabA]: snapshot() },
  currentTabId = TabA,
) {
  const [before, after] = stable(tabs);
  return resolveUndoSelection(ops, before, after, currentTabId);
}

describe('resolveUndoSelection', () => {
  it('points at a cell whose value was rewritten in place', () => {
    // The case state diffing missed: the key set is identical either side.
    const selection = resolve([
      { type: 'set', path: `$.sheets.${TabA}.cells`, key: 'r2|c2' },
    ]);

    expect(selection).toEqual({
      tabId: TabA,
      otherTab: false,
      selectionType: 'cell',
      range: [
        { r: 2, c: 2 },
        { r: 2, c: 2 },
      ],
    });
  });

  it('reads a cell written one field at a time', () => {
    const selection = resolve([
      { type: 'set', path: `$.sheets.${TabA}.cells.r3|c1`, key: 'v' },
    ]);

    expect(selection?.range).toEqual([
      { r: 3, c: 1 },
      { r: 3, c: 1 },
    ]);
  });

  it('bounds several cells into one range', () => {
    const selection = resolve([
      { type: 'set', path: `$.sheets.${TabA}.cells`, key: 'r1|c3' },
      { type: 'remove', path: `$.sheets.${TabA}.cells`, key: 'r3|c1' },
      { type: 'set', path: `$.sheets.${TabA}.cells`, key: 'r2|c2' },
    ]);

    expect(selection?.selectionType).toBe('cell');
    expect(selection?.range).toEqual([
      { r: 1, c: 1 },
      { r: 3, c: 3 },
    ]);
  });

  it('skips a cell whose row no longer exists', () => {
    // Undoing a row insert removes the row and its cells together; there is
    // nothing left to point at.
    const selection = resolve([
      { type: 'remove', path: `$.sheets.${TabA}.cells`, key: 'r9|c1' },
    ]);

    expect(selection?.range).toBeUndefined();
  });

  it('selects the row headers an insert or delete moved', () => {
    const before = new Map([
      [TabA, snapshot({ rowOrder: ['r1', 'r9', 'r2', 'r3'] })],
    ]);
    const after = new Map([[TabA, snapshot({ rowOrder: ['r1', 'r2', 'r3'] })]]);

    const selection = resolveUndoSelection(
      [{ type: 'remove', path: `$.sheets.${TabA}.rowOrder` }],
      before,
      after,
      TabA,
    );

    expect(selection?.selectionType).toBe('row');
    expect(selection?.range).toEqual([
      { r: 2, c: 1 },
      { r: 2, c: 3 },
    ]);
  });

  it('spans every row a multi-row insert brought back', () => {
    const before = new Map([[TabA, snapshot({ rowOrder: ['r1', 'r3'] })]]);
    const after = new Map([
      [TabA, snapshot({ rowOrder: ['r1', 'rA', 'rB', 'r3'] })],
    ]);

    const selection = resolveUndoSelection(
      [{ type: 'add', path: `$.sheets.${TabA}.rowOrder` }],
      before,
      after,
      TabA,
    );

    expect(selection?.selectionType).toBe('row');
    expect(selection?.range?.[0].r).toBe(2);
    expect(selection?.range?.[1].r).toBe(3);
  });

  it('selects column headers for a column axis change', () => {
    const before = new Map([[TabA, snapshot({ colOrder: ['c1', 'c2', 'c3'] })]]);
    const after = new Map([[TabA, snapshot({ colOrder: ['c1', 'c3'] })]]);

    const selection = resolveUndoSelection(
      [{ type: 'remove', path: `$.sheets.${TabA}.colOrder` }],
      before,
      after,
      TabA,
    );

    expect(selection?.selectionType).toBe('column');
    expect(selection?.range).toEqual([
      { r: 1, c: 2 },
      { r: 3, c: 2 },
    ]);
  });

  it('selects the column a width change resized', () => {
    const selection = resolve([
      { type: 'set', path: `$.sheets.${TabA}.colWidths`, key: '2' },
    ]);

    expect(selection?.selectionType).toBe('column');
    expect(selection?.range).toEqual([
      { r: 1, c: 2 },
      { r: 3, c: 2 },
    ]);
  });

  it('selects the rows a height change resized', () => {
    const selection = resolve([
      { type: 'set', path: `$.sheets.${TabA}.rowHeights`, key: '1' },
      { type: 'set', path: `$.sheets.${TabA}.rowHeights`, key: '3' },
    ]);

    expect(selection?.selectionType).toBe('row');
    expect(selection?.range).toEqual([
      { r: 1, c: 1 },
      { r: 3, c: 3 },
    ]);
  });

  it('recovers the range of a style patch that was added', () => {
    const patch = {
      range: [
        { r: 2, c: 2 },
        { r: 4, c: 5 },
      ] as const,
      style: { bold: true },
    };
    const before = new Map([[TabA, snapshot({ rangeStyles: [] })]]);
    const after = new Map([
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      [TabA, snapshot({ rangeStyles: [patch as any] })],
    ]);

    const selection = resolveUndoSelection(
      [{ type: 'add', path: `$.sheets.${TabA}.rangeStyles` }],
      before,
      after,
      TabA,
    );

    expect(selection?.selectionType).toBe('cell');
    expect(selection?.range).toEqual([
      { r: 2, c: 2 },
      { r: 4, c: 5 },
    ]);
  });

  it('recovers the range of a style patch that was removed', () => {
    const patch = {
      range: [
        { r: 1, c: 1 },
        { r: 1, c: 2 },
      ],
      style: { bold: true },
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const before = new Map([[TabA, snapshot({ rangeStyles: [patch as any] })]]);
    const after = new Map([[TabA, snapshot({ rangeStyles: [] })]]);

    const selection = resolveUndoSelection(
      [{ type: 'remove', path: `$.sheets.${TabA}.rangeStyles` }],
      before,
      after,
      TabA,
    );

    expect(selection?.range).toEqual([
      { r: 1, c: 1 },
      { r: 1, c: 2 },
    ]);
  });

  it('bounds a style patch that was replaced, not merely added', () => {
    // Styling a range usually rewrites one compacted patch into another.
    // Reporting only the new one would leave out whatever the old one
    // covered beyond it.
    const was = {
      range: [
        { r: 1, c: 1 },
        { r: 6, c: 2 },
      ],
      style: { bold: true },
    };
    const now = {
      range: [
        { r: 1, c: 1 },
        { r: 3, c: 2 },
      ],
      style: { bold: true, italic: true },
    };
    /* eslint-disable @typescript-eslint/no-explicit-any */
    const before = new Map([[TabA, snapshot({ rangeStyles: [was as any] })]]);
    const after = new Map([[TabA, snapshot({ rangeStyles: [now as any] })]]);
    /* eslint-enable @typescript-eslint/no-explicit-any */

    const selection = resolveUndoSelection(
      [{ type: 'set', path: `$.sheets.${TabA}.rangeStyles` }],
      before,
      after,
      TabA,
    );

    // Rows 4-6 belong only to the patch that went away.
    expect(selection?.range).toEqual([
      { r: 1, c: 1 },
      { r: 6, c: 2 },
    ]);
  });

  it('reports no style change when the patch list is unchanged', () => {
    const patch = {
      range: [
        { r: 2, c: 2 },
        { r: 2, c: 2 },
      ],
      style: { bold: true },
    };
    const selection = resolve(
      [{ type: 'set', path: `$.sheets.${TabA}.rangeStyles` }],
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { [TabA]: snapshot({ rangeStyles: [patch as any] }) },
    );

    expect(selection?.range).toBeUndefined();
  });

  it('reports another tab so the editor can switch to it', () => {
    const selection = resolve(
      [{ type: 'set', path: `$.sheets.${TabB}.cells`, key: 'r1|c2' }],
      { [TabA]: snapshot(), [TabB]: snapshot() },
    );

    expect(selection?.tabId).toBe(TabB);
    expect(selection?.otherTab).toBe(true);
    expect(selection?.range).toEqual([
      { r: 1, c: 2 },
      { r: 1, c: 2 },
    ]);
  });

  it('stays on the current tab when the step also touched it', () => {
    // A structural edit rewrites dependent formulas in other tabs. Undo
    // should not send you away to show a side effect of a change made here.
    const selection = resolve(
      [
        { type: 'set', path: `$.sheets.${TabB}.cells`, key: 'r1|c1' },
        { type: 'set', path: `$.sheets.${TabB}.cells`, key: 'r2|c1' },
        { type: 'set', path: `$.sheets.${TabA}.cells`, key: 'r3|c3' },
      ],
      { [TabA]: snapshot(), [TabB]: snapshot() },
    );

    expect(selection?.tabId).toBe(TabA);
    expect(selection?.otherTab).toBe(false);
  });

  it('follows a structural edit out of the tab that only absorbed it', () => {
    // `shiftCrossTabDataRanges` rewrites every other tab's chart and pivot
    // source ranges inside the same change as the row insert that moved
    // them. Staying on the tab holding the chart would leave undo with
    // nothing to show, which is the failure this resolver exists to remove.
    const before = new Map([
      [TabA, snapshot({ rowOrder: ['r1', 'r9', 'r2', 'r3'] })],
      [TabB, snapshot()],
    ]);
    const after = new Map([
      [TabA, snapshot({ rowOrder: ['r1', 'r2', 'r3'] })],
      [TabB, snapshot()],
    ]);

    const selection = resolveUndoSelection(
      [
        { type: 'remove', path: `$.sheets.${TabA}.rowOrder` },
        { type: 'set', path: `$.sheets.${TabB}.charts.chart-1`, key: 'sourceRange' },
        { type: 'set', path: `$.sheets.${TabB}.pivotTable`, key: 'sourceRange' },
      ],
      before,
      after,
      // The user is sitting on the tab that merely absorbed the side effect.
      TabB,
    );

    expect(selection?.tabId).toBe(TabA);
    expect(selection?.otherTab).toBe(true);
    expect(selection?.selectionType).toBe('row');
    expect(selection?.range).toEqual([
      { r: 2, c: 1 },
      { r: 2, c: 3 },
    ]);
  });

  it('leaves the current tab when only another tab has coordinates', () => {
    const selection = resolve(
      [
        { type: 'set', path: `$.sheets.${TabA}`, key: 'frozenRows' },
        { type: 'set', path: `$.sheets.${TabB}.cells`, key: 'r2|c2' },
      ],
      { [TabA]: snapshot(), [TabB]: snapshot() },
      TabA,
    );

    expect(selection?.tabId).toBe(TabB);
    expect(selection?.range).toEqual([
      { r: 2, c: 2 },
      { r: 2, c: 2 },
    ]);
  });

  it('stays put when both tabs changed substantively', () => {
    // The original reasoning, kept: between two tabs that both carry
    // coordinates, undo should not send you away from the one you are in.
    const selection = resolve(
      [
        { type: 'set', path: `$.sheets.${TabB}.cells`, key: 'r1|c1' },
        { type: 'set', path: `$.sheets.${TabA}.cells`, key: 'r3|c3' },
      ],
      { [TabA]: snapshot(), [TabB]: snapshot() },
      TabA,
    );

    expect(selection?.tabId).toBe(TabA);
    expect(selection?.otherTab).toBe(false);
  });

  it('names the tab but no range when the step has no coordinates', () => {
    const selection = resolve(
      [{ type: 'set', path: `$.sheets.${TabB}`, key: 'frozenRows' }],
      { [TabA]: snapshot(), [TabB]: snapshot() },
    );

    expect(selection?.tabId).toBe(TabB);
    expect(selection?.otherTab).toBe(true);
    expect(selection?.range).toBeUndefined();
  });

  it('selects the block a merge change covered', () => {
    const selection = resolve([
      { type: 'set', path: `$.sheets.${TabA}.merges`, key: 'B2' },
    ]);

    expect(selection?.selectionType).toBe('cell');
    expect(selection?.range).toEqual([
      { r: 2, c: 2 },
      { r: 2, c: 2 },
    ]);
  });

  it('ignores a merge key the engine cannot parse', () => {
    expect(
      resolve([
        { type: 'set', path: `$.sheets.${TabA}.merges`, key: 'not-a-ref' },
      ])?.range,
    ).toBeUndefined();
  });

  it('selects the rows a row-style change covered', () => {
    const selection = resolve([
      { type: 'set', path: `$.sheets.${TabA}.rowStyles`, key: '2' },
    ]);

    expect(selection?.selectionType).toBe('row');
    expect(selection?.range?.[0].r).toBe(2);
  });

  it('selects the columns a column-style change covered', () => {
    const selection = resolve([
      { type: 'set', path: `$.sheets.${TabA}.colStyles`, key: '3' },
    ]);

    expect(selection?.selectionType).toBe('column');
    expect(selection?.range?.[0].c).toBe(3);
  });

  it('bounds a step that changed both row and column metadata', () => {
    // Neither header selection describes it, so the block they bound is the
    // honest answer — reporting nothing would leave the selection put.
    const selection = resolve([
      { type: 'set', path: `$.sheets.${TabA}.rowHeights`, key: '2' },
      { type: 'set', path: `$.sheets.${TabA}.colWidths`, key: '3' },
    ]);

    expect(selection?.selectionType).toBe('cell');
    expect(selection?.range).toEqual([
      { r: 2, c: 3 },
      { r: 2, c: 3 },
    ]);
  });

  it('breaks a tie between equally-ranked tabs by weight', () => {
    // Neither tab is the open one, so the heavier share wins.
    const selection = resolve(
      [
        { type: 'set', path: `$.sheets.${TabB}.cells`, key: 'r1|c1' },
        { type: 'set', path: `$.sheets.${TabB}.cells`, key: 'r2|c1' },
        { type: 'set', path: `$.sheets.${TabC}.cells`, key: 'r3|c3' },
      ],
      { [TabA]: snapshot(), [TabB]: snapshot(), [TabC]: snapshot() },
      TabA,
    );

    expect(selection?.tabId).toBe(TabB);
  });

  it('leaves an unrelated style patch out of the reported range', () => {
    // The whole array is rewritten on every style write, so the diff has to
    // match untouched patches by value rather than reporting the lot.
    const untouched = {
      range: [
        { r: 40, c: 8 },
        { r: 40, c: 8 },
      ],
      style: { italic: true },
    };
    const before = {
      range: [
        { r: 2, c: 2 },
        { r: 3, c: 2 },
      ],
      style: { bold: true },
    };
    /* eslint-disable @typescript-eslint/no-explicit-any */
    const beforeMap = new Map([
      [TabA, snapshot({ rangeStyles: [untouched as any, before as any] })],
    ]);
    const afterMap = new Map([
      [TabA, snapshot({ rangeStyles: [untouched as any] })],
    ]);
    /* eslint-enable @typescript-eslint/no-explicit-any */

    const selection = resolveUndoSelection(
      [{ type: 'set', path: `$.sheets.${TabA}`, key: 'rangeStyles' }],
      beforeMap,
      afterMap,
      TabA,
    );

    // Row 40 belongs to the patch that did not move.
    expect(selection?.range).toEqual([
      { r: 2, c: 2 },
      { r: 3, c: 2 },
    ]);
  });

  it('reads a style write that replaced the whole patch array', () => {
    // `setRangeStyles` assigns the array on the worksheet rather than
    // mutating it, so the operation names the field in `key`. Matching only
    // the array op left the selection put for most style undos.
    const patch = {
      range: [
        { r: 5, c: 1 },
        { r: 7, c: 4 },
      ],
      style: { bold: true },
    };
    const before = new Map([[TabA, snapshot({ rangeStyles: [] })]]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const after = new Map([[TabA, snapshot({ rangeStyles: [patch as any] })]]);

    const selection = resolveUndoSelection(
      [{ type: 'set', path: `$.sheets.${TabA}`, key: 'rangeStyles' }],
      before,
      after,
      TabA,
    );

    expect(selection?.range).toEqual([
      { r: 5, c: 1 },
      { r: 7, c: 4 },
    ]);
  });

  it('treats a tail-only axis change as extent growth, not a structure edit', () => {
    // Deliberate, and the one case the operation log cannot disambiguate:
    // writing a cell into untouched space grows the axis at its tail, and so
    // does inserting a row past the last one. Both arrive as the same array
    // diff, so the cell branch wins — which selects the cells the step
    // touched rather than a header. Every interior insert/delete is exact;
    // see `docs/design/sheets/sheet.md` § Selection after undo / redo.
    const before = new Map([[TabA, snapshot({ rowOrder: ['r1', 'r2'] })]]);
    const after = new Map([
      [TabA, snapshot({ rowOrder: ['r1', 'r2', 'r3', 'r4'] })],
    ]);

    const selection = resolveUndoSelection(
      [
        { type: 'add', path: `$.sheets.${TabA}.rowOrder` },
        { type: 'set', path: `$.sheets.${TabA}.cells`, key: 'r4|c1' },
      ],
      before,
      after,
      TabA,
    );

    expect(selection?.selectionType).toBe('cell');
    expect(selection?.range).toEqual([
      { r: 4, c: 1 },
      { r: 4, c: 1 },
    ]);
  });

  it('ignores operations outside any worksheet', () => {
    expect(
      resolve([
        { type: 'set', path: '$.tabs', key: TabA },
        { type: 'add', path: '$.tabOrder' },
      ]),
    ).toBeUndefined();
  });

  it('ignores a worksheet it has no snapshot for', () => {
    expect(
      resolve([{ type: 'set', path: '$.sheets.tab-gone.cells', key: 'r1|c1' }]),
    ).toBeUndefined();
  });

  it('returns nothing for an empty replay', () => {
    expect(resolve([])).toBeUndefined();
  });
});
