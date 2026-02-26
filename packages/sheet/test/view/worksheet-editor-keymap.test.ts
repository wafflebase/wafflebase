import { describe, expect, it, vi } from 'vitest';
import { Worksheet } from '../../src/view/worksheet';

type EditorSource = 'formulaBar' | 'cellInput';

type EditorContext = {
  handleAutocompleteKeydown: ReturnType<typeof vi.fn>;
  isArrowKey: ReturnType<typeof vi.fn>;
  finishEditing: ReturnType<typeof vi.fn>;
  focusGrid: ReturnType<typeof vi.fn>;
  render: ReturnType<typeof vi.fn>;
  scrollIntoView: ReturnType<typeof vi.fn>;
  primeCellInputForSelection: ReturnType<typeof vi.fn>;
  isInFormulaRangeMode: ReturnType<typeof vi.fn>;
  applyFormulaRangeArrowKey: ReturnType<typeof vi.fn>;
  toggleAbsoluteReference: ReturnType<typeof vi.fn>;
  showCellInput: ReturnType<typeof vi.fn>;
  editMode: boolean;
  sheet: {
    move: ReturnType<typeof vi.fn>;
    moveInRange: ReturnType<typeof vi.fn>;
  };
  formulaBar: {
    getFormulaInput: ReturnType<typeof vi.fn>;
  };
  cellInput: {
    getInput: ReturnType<typeof vi.fn>;
    hasFormula: ReturnType<typeof vi.fn>;
    isShown: ReturnType<typeof vi.fn>;
  };
};

const handleEditorKeydown = (
  Worksheet.prototype as unknown as {
    handleEditorKeydown: (
      e: KeyboardEvent,
      source: EditorSource,
    ) => Promise<void>;
  }
).handleEditorKeydown;

const createContext = (): EditorContext => {
  const formulaInput = {} as HTMLDivElement;
  const cellInput = {} as HTMLDivElement;
  return {
    handleAutocompleteKeydown: vi.fn().mockReturnValue(false),
    isArrowKey: vi.fn((e: KeyboardEvent) => e.key.startsWith('Arrow')),
    finishEditing: vi.fn().mockResolvedValue(undefined),
    focusGrid: vi.fn(),
    render: vi.fn(),
    scrollIntoView: vi.fn(),
    primeCellInputForSelection: vi.fn(),
    isInFormulaRangeMode: vi.fn().mockReturnValue(false),
    applyFormulaRangeArrowKey: vi.fn().mockReturnValue({ r: 1, c: 1 }),
    toggleAbsoluteReference: vi.fn(),
    showCellInput: vi.fn(),
    editMode: false,
    sheet: {
      move: vi.fn(),
      moveInRange: vi.fn(),
    },
    formulaBar: {
      getFormulaInput: vi.fn().mockReturnValue(formulaInput),
    },
    cellInput: {
      getInput: vi.fn().mockReturnValue(cellInput),
      hasFormula: vi.fn().mockReturnValue(false),
      isShown: vi.fn().mockReturnValue(true),
    },
  };
};

const createEvent = (
  key: string,
  mods?: Partial<
    Pick<KeyboardEvent, 'altKey' | 'shiftKey' | 'ctrlKey' | 'metaKey'>
  >,
) => {
  const preventDefault = vi.fn();
  const event = {
    key,
    altKey: mods?.altKey ?? false,
    shiftKey: mods?.shiftKey ?? false,
    ctrlKey: mods?.ctrlKey ?? false,
    metaKey: mods?.metaKey ?? false,
    isComposing: false,
    preventDefault,
  } as unknown as KeyboardEvent;
  return { event, preventDefault };
};

describe('Worksheet editor keymap', () => {
  it('commits and moves down for formula input Enter', async () => {
    const ctx = createContext();
    const { event, preventDefault } = createEvent('Enter');

    await handleEditorKeydown.call(ctx, event, 'formulaBar');

    expect(ctx.handleAutocompleteKeydown).toHaveBeenCalledTimes(1);
    expect(ctx.finishEditing).toHaveBeenCalledTimes(1);
    expect(ctx.focusGrid).toHaveBeenCalledTimes(1);
    expect(ctx.sheet.move).toHaveBeenCalledWith('down');
    expect(ctx.sheet.moveInRange).not.toHaveBeenCalled();
    expect(ctx.render).toHaveBeenCalledTimes(1);
    expect(ctx.scrollIntoView).toHaveBeenCalledTimes(1);
    expect(ctx.primeCellInputForSelection).toHaveBeenCalledTimes(1);
    expect(preventDefault).toHaveBeenCalled();
  });

  it('commits and moves in range for cell input Enter', async () => {
    const ctx = createContext();
    const { event, preventDefault } = createEvent('Enter', { shiftKey: true });

    await handleEditorKeydown.call(ctx, event, 'cellInput');

    expect(ctx.finishEditing).toHaveBeenCalledTimes(1);
    expect(ctx.focusGrid).not.toHaveBeenCalled();
    expect(ctx.sheet.move).not.toHaveBeenCalled();
    expect(ctx.sheet.moveInRange).toHaveBeenCalledWith(-1, 0);
    expect(ctx.render).toHaveBeenCalledTimes(1);
    expect(ctx.scrollIntoView).toHaveBeenCalledTimes(1);
    expect(ctx.primeCellInputForSelection).toHaveBeenCalledTimes(1);
    expect(preventDefault).toHaveBeenCalled();
  });

  it('shows inline cell input when typing from formula bar', async () => {
    const ctx = createContext();
    ctx.cellInput.isShown.mockReturnValue(false);
    const { event } = createEvent('a');

    await handleEditorKeydown.call(ctx, event, 'formulaBar');

    expect(ctx.showCellInput).toHaveBeenCalledWith(true, true);
  });

  it('routes Shift+Arrow key to formula-range reference update', async () => {
    const ctx = createContext();
    ctx.isInFormulaRangeMode.mockReturnValue(true);
    ctx.applyFormulaRangeArrowKey.mockReturnValue({ r: 8, c: 9 });
    const { event, preventDefault } = createEvent('ArrowRight', {
      shiftKey: true,
    });

    await handleEditorKeydown.call(ctx, event, 'formulaBar');

    expect(ctx.applyFormulaRangeArrowKey).toHaveBeenCalledWith(event);
    expect(ctx.scrollIntoView).toHaveBeenCalledWith({ r: 8, c: 9 });
    expect(preventDefault).toHaveBeenCalled();
    expect(ctx.finishEditing).not.toHaveBeenCalled();
  });

  it('moves selection with arrow keys in plain cell input mode', async () => {
    const ctx = createContext();
    const { event, preventDefault } = createEvent('ArrowUp');

    await handleEditorKeydown.call(ctx, event, 'cellInput');

    expect(ctx.finishEditing).toHaveBeenCalledTimes(1);
    expect(ctx.sheet.move).toHaveBeenCalledWith('up');
    expect(ctx.render).toHaveBeenCalledTimes(1);
    expect(ctx.scrollIntoView).toHaveBeenCalledTimes(1);
    expect(ctx.primeCellInputForSelection).toHaveBeenCalledTimes(1);
    expect(preventDefault).toHaveBeenCalled();
  });
});
