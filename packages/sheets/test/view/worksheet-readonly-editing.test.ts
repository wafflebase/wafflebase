import { describe, expect, it, vi } from 'vitest';
import { Worksheet } from '../../src/view/worksheet';

type FinishEditingContext = {
  readOnly: boolean;
  autocomplete: {
    hide: ReturnType<typeof vi.fn>;
  };
  functionBrowser: {
    hide: ReturnType<typeof vi.fn>;
  };
  sheet: {
    getActiveCell: ReturnType<typeof vi.fn>;
    setData: ReturnType<typeof vi.fn>;
  };
  formulaBar: {
    isFocused: ReturnType<typeof vi.fn>;
    getValue: ReturnType<typeof vi.fn>;
    blur: ReturnType<typeof vi.fn>;
  };
  cellInput: {
    isFocused: ReturnType<typeof vi.fn>;
    isPrimed: ReturnType<typeof vi.fn>;
    getValue: ReturnType<typeof vi.fn>;
    hide: ReturnType<typeof vi.fn>;
  };
  autoResizeRow: ReturnType<typeof vi.fn>;
  formulaRanges: Array<unknown>;
  resetFormulaRangeState: ReturnType<typeof vi.fn>;
};

const finishEditing = (
  Worksheet.prototype as unknown as {
    finishEditing: () => Promise<void>;
  }
).finishEditing;

const createContext = (readOnly: boolean): FinishEditingContext => ({
  readOnly,
  autocomplete: {
    hide: vi.fn(),
  },
  functionBrowser: {
    hide: vi.fn(),
  },
  sheet: {
    getActiveCell: vi.fn().mockReturnValue({ r: 3, c: 2 }),
    setData: vi.fn().mockResolvedValue(undefined),
  },
  formulaBar: {
    isFocused: vi.fn().mockReturnValue(true),
    getValue: vi.fn().mockReturnValue('123'),
    blur: vi.fn(),
  },
  cellInput: {
    isFocused: vi.fn().mockReturnValue(false),
    isPrimed: vi.fn().mockReturnValue(false),
    getValue: vi.fn(),
    hide: vi.fn(),
  },
  autoResizeRow: vi.fn().mockResolvedValue(undefined),
  formulaRanges: [{ before: true }],
  resetFormulaRangeState: vi.fn(),
});

describe('Worksheet read-only editing', () => {
  it('does not commit formula-bar edits in read-only mode', async () => {
    const ctx = createContext(true);

    await finishEditing.call(ctx);

    expect(ctx.sheet.setData).not.toHaveBeenCalled();
    expect(ctx.autoResizeRow).not.toHaveBeenCalled();
    expect(ctx.formulaBar.blur).toHaveBeenCalledTimes(1);
    expect(ctx.cellInput.hide).toHaveBeenCalledTimes(1);
    expect(ctx.resetFormulaRangeState).toHaveBeenCalledTimes(1);
    expect(ctx.formulaRanges).toEqual([]);
  });

  it('does not commit primed cell-input focus state', async () => {
    const ctx = createContext(false);
    ctx.formulaBar.isFocused.mockReturnValue(false);
    ctx.cellInput.isFocused.mockReturnValue(true);
    ctx.cellInput.isPrimed.mockReturnValue(true);
    ctx.cellInput.getValue.mockReturnValue('');

    await finishEditing.call(ctx);

    expect(ctx.sheet.setData).not.toHaveBeenCalled();
    expect(ctx.autoResizeRow).not.toHaveBeenCalled();
    expect(ctx.cellInput.hide).toHaveBeenCalledTimes(1);
    expect(ctx.resetFormulaRangeState).toHaveBeenCalledTimes(1);
    expect(ctx.formulaRanges).toEqual([]);
  });
});
