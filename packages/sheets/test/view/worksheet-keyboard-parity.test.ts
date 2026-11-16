import { describe, expect, it, vi } from 'vitest';
import { Worksheet } from '../../src/view/worksheet';
import { Sheet } from '../../src/model/worksheet/sheet';
import { MemStore } from '../../src/store/memory';
import type { Ref } from '../../src/model/core/types';

/**
 * Google Sheets keyboard parity for the grid: the Tab…Enter return column,
 * fill down / right, F2, and the row / column selection chords. Built on a
 * real `Sheet` (selection is the thing under test) with the DOM-facing
 * collaborators stubbed, the technique `worksheet-keymap.test.ts` uses.
 */
type Proto = {
  handleGridKeydown: (e: KeyboardEvent) => Promise<void>;
  handleEditorKeydown: (
    e: KeyboardEvent,
    source: 'formulaBar' | 'cellInput',
  ) => Promise<void>;
  recordTabMove: (from: Ref) => void;
  takeTabReturn: () => Ref | null;
  fillSelection: (direction: 'down' | 'right') => Promise<void>;
  selectEntireAxis: (axis: 'row' | 'column') => void;
  navigateFromNameBox: (text: string) => boolean;
};
const proto = Worksheet.prototype as unknown as Proto;

function createContext(sheet = new Sheet(new MemStore())) {
  const ctx = {
    sheet,
    readOnly: false,
    editMode: false,
    tabRun: null,
    render: vi.fn(),
    renderOverlay: vi.fn(),
    scrollIntoView: vi.fn(),
    getRangeExtentRef: () => sheet.getActiveCell(),
    primeCellInputForSelection: vi.fn(),
    showCellInput: vi.fn(),
    isValidCellInput: (key: string) => key.length === 1,
    finishEditing: vi.fn().mockResolvedValue(true),
    focusGrid: vi.fn(),
    handleAutocompleteKeydown: vi.fn().mockReturnValue(false),
    isArrowKey: (e: KeyboardEvent) => e.key.startsWith('Arrow'),
    isInFormulaRangeMode: vi.fn().mockReturnValue(false),
    activeCellLinks: () => [],
    cellInput: {
      isFocused: vi.fn().mockReturnValue(true),
      isPrimed: vi.fn().mockReturnValue(true),
      isShown: vi.fn().mockReturnValue(true),
      hasFormula: vi.fn().mockReturnValue(false),
      getInput: vi.fn().mockReturnValue({}),
    },
    formulaBar: { getFormulaInput: vi.fn().mockReturnValue({}) },
    recordTabMove: proto.recordTabMove,
    takeTabReturn: proto.takeTabReturn,
    fillSelection: proto.fillSelection,
    selectEntireAxis: proto.selectEntireAxis,
    handleGridKeydown: proto.handleGridKeydown,
    handleEditorKeydown: proto.handleEditorKeydown,
  };
  return ctx;
}

type Ctx = ReturnType<typeof createContext>;

const key = (
  k: string,
  mods: Partial<
    Pick<KeyboardEvent, 'shiftKey' | 'ctrlKey' | 'metaKey' | 'altKey'>
  > = {},
) => {
  const preventDefault = vi.fn();
  const event = {
    key: k,
    shiftKey: mods.shiftKey ?? false,
    ctrlKey: mods.ctrlKey ?? false,
    metaKey: mods.metaKey ?? false,
    altKey: mods.altKey ?? false,
    isComposing: false,
    keyCode: 0,
    preventDefault,
  } as unknown as KeyboardEvent;
  return { event, preventDefault };
};

/** Typing a value and committing it with Tab / Enter from the cell editor. */
const commitWith = (ctx: Ctx, k: string, mods = {}) =>
  proto.handleEditorKeydown.call(ctx, key(k, mods).event, 'cellInput');
const gridKey = (ctx: Ctx, k: string, mods = {}) =>
  proto.handleGridKeydown.call(ctx, key(k, mods).event);

describe('Tab…Enter return column', () => {
  it('returns to the column where the Tab run started', async () => {
    const ctx = createContext();
    ctx.sheet.selectStart({ r: 1, c: 1 });

    for (let i = 0; i < 4; i++) await commitWith(ctx, 'Tab');
    expect(ctx.sheet.getActiveCell()).toEqual({ r: 1, c: 5 });

    await commitWith(ctx, 'Enter');
    expect(ctx.sheet.getActiveCell()).toEqual({ r: 2, c: 1 });
  });

  it('counts plain grid Tabs as part of the run', async () => {
    const ctx = createContext();
    ctx.sheet.selectStart({ r: 3, c: 2 });

    await commitWith(ctx, 'Tab');
    await gridKey(ctx, 'Tab');
    await commitWith(ctx, 'Enter');

    expect(ctx.sheet.getActiveCell()).toEqual({ r: 4, c: 2 });
  });

  it('starts a new run after the next Enter', async () => {
    const ctx = createContext();
    ctx.sheet.selectStart({ r: 1, c: 1 });
    await commitWith(ctx, 'Tab');
    await commitWith(ctx, 'Enter');
    expect(ctx.sheet.getActiveCell()).toEqual({ r: 2, c: 1 });

    // A plain Enter now moves straight down.
    ctx.sheet.selectStart({ r: 2, c: 3 });
    await commitWith(ctx, 'Enter');
    expect(ctx.sheet.getActiveCell()).toEqual({ r: 3, c: 3 });
  });

  it('forgets the run once the selection is moved some other way', async () => {
    const ctx = createContext();
    ctx.sheet.selectStart({ r: 1, c: 1 });
    await commitWith(ctx, 'Tab');
    await commitWith(ctx, 'Tab');

    // Arrow navigation resets the anchor.
    await gridKey(ctx, 'ArrowDown');
    await commitWith(ctx, 'Enter');
    expect(ctx.sheet.getActiveCell()).toEqual({ r: 3, c: 3 });
  });

  it('forgets the run when the user clicks elsewhere', async () => {
    const ctx = createContext();
    ctx.sheet.selectStart({ r: 1, c: 1 });
    await commitWith(ctx, 'Tab');
    // A click: the selection lands somewhere the Tab did not put it.
    ctx.sheet.selectStart({ r: 7, c: 4 });
    await commitWith(ctx, 'Enter');
    expect(ctx.sheet.getActiveCell()).toEqual({ r: 8, c: 4 });
  });

  it('does not return on Shift+Enter', async () => {
    const ctx = createContext();
    ctx.sheet.selectStart({ r: 5, c: 1 });
    await commitWith(ctx, 'Tab');
    await commitWith(ctx, 'Enter', { shiftKey: true });
    expect(ctx.sheet.getActiveCell()).toEqual({ r: 4, c: 2 });
  });
});

describe('fill down / right', () => {
  it('binds Mod+D and Mod+R', async () => {
    const ctx = createContext();
    ctx.fillSelection = vi.fn().mockResolvedValue(undefined);

    const d = key('d', { metaKey: true });
    await proto.handleGridKeydown.call(ctx, d.event);
    expect(ctx.fillSelection).toHaveBeenCalledWith('down');
    expect(d.preventDefault).toHaveBeenCalled();

    const r = key('r', { ctrlKey: true });
    await proto.handleGridKeydown.call(ctx, r.event);
    expect(ctx.fillSelection).toHaveBeenCalledWith('right');
    expect(r.preventDefault).toHaveBeenCalled();
  });

  it('leaves Mod+Shift+D alone', async () => {
    const ctx = createContext();
    ctx.fillSelection = vi.fn();
    await gridKey(ctx, 'd', { metaKey: true, shiftKey: true });
    expect(ctx.fillSelection).not.toHaveBeenCalled();
  });

  it('fills the selection through the sheet and repaints', async () => {
    const ctx = createContext();
    await ctx.sheet.setData({ r: 1, c: 1 }, 'top');
    ctx.sheet.selectStart({ r: 1, c: 1 });
    ctx.sheet.selectEnd({ r: 3, c: 1 });

    await proto.fillSelection.call(ctx, 'down');

    expect(await ctx.sheet.toDisplayString({ r: 3, c: 1 })).toBe('top');
    expect(ctx.render).toHaveBeenCalled();
  });

  it('refuses to fill for a read-only viewer', async () => {
    const ctx = createContext();
    ctx.readOnly = true;
    await ctx.sheet.setData({ r: 1, c: 1 }, 'top');
    ctx.sheet.selectStart({ r: 1, c: 1 });
    ctx.sheet.selectEnd({ r: 2, c: 1 });

    await proto.fillSelection.call(ctx, 'down');

    expect(await ctx.sheet.toDisplayString({ r: 2, c: 1 })).toBe('');
  });
});

describe('F2', () => {
  it('opens the editor on the active cell with its value', async () => {
    const ctx = createContext();
    const { event, preventDefault } = key('F2');
    await proto.handleGridKeydown.call(ctx, event);
    // No arguments: keep the value, focus it, caret at the end.
    expect(ctx.showCellInput).toHaveBeenCalledWith();
    expect(preventDefault).toHaveBeenCalled();
  });

  it('does nothing for a read-only viewer', async () => {
    const ctx = createContext();
    ctx.readOnly = true;
    await gridKey(ctx, 'F2');
    expect(ctx.showCellInput).not.toHaveBeenCalled();
  });
});

describe('Shift+Space / Ctrl+Space', () => {
  it('selects the rows of the selection with Shift+Space', async () => {
    const ctx = createContext();
    ctx.sheet.selectStart({ r: 2, c: 3 });
    ctx.sheet.selectEnd({ r: 4, c: 5 });
    const { event, preventDefault } = key(' ', { shiftKey: true });

    await proto.handleGridKeydown.call(ctx, event);

    expect(ctx.sheet.getSelectionType()).toBe('row');
    expect(ctx.sheet.getSelectedIndices()).toEqual({
      axis: 'row',
      from: 2,
      to: 4,
    });
    expect(preventDefault).toHaveBeenCalled();
    // Not read as the first keystroke of an edit.
    expect(ctx.showCellInput).not.toHaveBeenCalled();
  });

  it('selects the columns of the selection with Ctrl+Space', async () => {
    const ctx = createContext();
    ctx.sheet.selectStart({ r: 2, c: 3 });
    ctx.sheet.selectEnd({ r: 4, c: 5 });

    await gridKey(ctx, ' ', { ctrlKey: true });

    expect(ctx.sheet.getSelectedIndices()).toEqual({
      axis: 'column',
      from: 3,
      to: 5,
    });
  });

  it('still starts an edit with a plain space', async () => {
    const ctx = createContext();
    ctx.cellInput.isFocused.mockReturnValue(false);
    await gridKey(ctx, ' ');
    expect(ctx.showCellInput).toHaveBeenCalledWith(true, false, true);
    expect(ctx.sheet.getSelectionType()).toBe('cell');
  });

  it('types a space while editing (the editor keymap leaves it alone)', async () => {
    const ctx = createContext();
    const { event, preventDefault } = key(' ', { shiftKey: true });
    await proto.handleEditorKeydown.call(ctx, event, 'cellInput');
    expect(preventDefault).not.toHaveBeenCalled();
    expect(ctx.sheet.getSelectionType()).toBe('cell');
  });
});

describe('name box navigation', () => {
  const navCtx = () => {
    const ctx = createContext() as Ctx & { navigateFromNameBox: Proto['navigateFromNameBox'] };
    return ctx;
  };

  it('moves to a cell', () => {
    const ctx = navCtx();
    expect(proto.navigateFromNameBox.call(ctx, 'C3')).toBe(true);
    expect(ctx.sheet.getActiveCell()).toEqual({ r: 3, c: 3 });
    expect(ctx.focusGrid).toHaveBeenCalled();
    expect(ctx.primeCellInputForSelection).toHaveBeenCalled();
  });

  it('selects a range with the active cell at its top-left', () => {
    const ctx = navCtx();
    expect(proto.navigateFromNameBox.call(ctx, 'B2:D4')).toBe(true);
    expect(ctx.sheet.getActiveCell()).toEqual({ r: 2, c: 2 });
    expect(ctx.sheet.getRange()).toEqual([
      { r: 2, c: 2 },
      { r: 4, c: 4 },
    ]);
  });

  it('selects whole columns and rows', () => {
    const ctx = navCtx();
    proto.navigateFromNameBox.call(ctx, 'B:C');
    expect(ctx.sheet.getSelectedIndices()).toEqual({
      axis: 'column',
      from: 2,
      to: 3,
    });
    proto.navigateFromNameBox.call(ctx, '3:4');
    expect(ctx.sheet.getSelectedIndices()).toEqual({
      axis: 'row',
      from: 3,
      to: 4,
    });
  });

  it('leaves the selection and the data alone for an invalid entry', async () => {
    const ctx = navCtx();
    ctx.sheet.selectStart({ r: 8, c: 6 });
    expect(proto.navigateFromNameBox.call(ctx, 'hello')).toBe(false);
    expect(ctx.sheet.getActiveCell()).toEqual({ r: 8, c: 6 });
    expect(await ctx.sheet.toDisplayString({ r: 8, c: 6 })).toBe('');
    expect(ctx.focusGrid).not.toHaveBeenCalled();
  });
});

describe('returnFocusToGrid', () => {
  const returnFocusToGrid = (
    Worksheet.prototype as unknown as { returnFocusToGrid: () => void }
  ).returnFocusToGrid;

  const focusCtx = (editing: boolean) => ({
    sheet: new Sheet(new MemStore()),
    primeCellInputForSelection: vi.fn(),
    cellInput: {
      isShown: () => editing,
      isPrimed: () => !editing,
    },
    formulaBar: {
      isFocused: () => false,
      getNameBox: () => ({ blur: vi.fn() }),
    },
  });

  it('re-primes the grid on the current selection', () => {
    const ctx = focusCtx(false);
    returnFocusToGrid.call(ctx);
    expect(ctx.primeCellInputForSelection).toHaveBeenCalled();
  });

  it('leaves an edit in progress alone', () => {
    const ctx = focusCtx(true);
    returnFocusToGrid.call(ctx);
    expect(ctx.primeCellInputForSelection).not.toHaveBeenCalled();
  });
});
