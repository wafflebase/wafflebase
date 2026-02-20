import { describe, expect, it, vi } from 'vitest';
import { Worksheet } from '../../src/view/worksheet';
import { DefaultCellHeight, RowHeaderWidth } from '../../src/view/layout';

type Ref = { r: number; c: number };

const resolveCellInputLayout = (
  Worksheet.prototype as unknown as {
    resolveCellInputLayout(ref: Ref): {
      left: number;
      top: number;
      width: number;
      height: number;
      maxWidth: number;
      maxHeight: number;
      pinned: boolean;
    };
  }
).resolveCellInputLayout;

const updateCellInputPosition = (
  Worksheet.prototype as unknown as {
    updateCellInputPosition(): void;
  }
).updateCellInputPosition;

const updateAutocompletePositionForActiveInput = (
  Worksheet.prototype as unknown as {
    updateAutocompletePositionForActiveInput(): void;
  }
).updateAutocompletePositionForActiveInput;

describe('Worksheet cell input positioning', () => {
  it('uses the cell position when active cell is visible', () => {
    const ctx = {
      getCellInputRect: vi
        .fn()
        .mockReturnValue({ left: 120, top: 80, width: 100, height: 23 }),
      viewport: {
        left: 0,
        top: 0,
        width: 800,
        height: 600,
      },
    };

    const layout = resolveCellInputLayout.call(ctx as never, { r: 5, c: 5 });

    expect(layout.pinned).toBe(false);
    expect(layout.left).toBe(120);
    expect(layout.top).toBe(80);
    expect(layout.maxWidth).toBe(680);
    expect(layout.maxHeight).toBe(520);
  });

  it('pins the editor inside viewport when active cell is offscreen', () => {
    const ctx = {
      getCellInputRect: vi
        .fn()
        .mockReturnValue({ left: 1200, top: 900, width: 100, height: 23 }),
      viewport: {
        left: 0,
        top: 0,
        width: 800,
        height: 600,
      },
    };

    const layout = resolveCellInputLayout.call(ctx as never, { r: 200, c: 30 });

    expect(layout.pinned).toBe(true);
    expect(layout.left).toBe(692);
    expect(layout.top).toBe(569);
    expect(layout.maxWidth).toBe(100);
    expect(layout.maxHeight).toBe(23);
    expect(layout.left).toBeGreaterThanOrEqual(RowHeaderWidth);
    expect(layout.top).toBeGreaterThanOrEqual(DefaultCellHeight);
  });

  it('shows active cell address hint when editor is pinned', () => {
    const ctx = {
      sheet: {
        getActiveCell: vi.fn().mockReturnValue({ r: 12, c: 3 }),
      },
      cellInput: {
        isShown: vi.fn().mockReturnValue(true),
        updatePlacement: vi.fn(),
        setCellPositionHint: vi.fn(),
      },
      resolveCellInputLayout: vi.fn().mockReturnValue({
        left: 692,
        top: 569,
        width: 100,
        height: 23,
        maxWidth: 100,
        maxHeight: 23,
        pinned: true,
      }),
      updateAutocompletePositionForActiveInput: vi.fn(),
    };

    updateCellInputPosition.call(ctx as never);

    expect(ctx.cellInput.updatePlacement).toHaveBeenCalledWith(
      692,
      569,
      100,
      23,
      100,
      23,
    );
    expect(ctx.cellInput.setCellPositionHint).toHaveBeenCalledWith('C12');
    expect(ctx.updateAutocompletePositionForActiveInput).toHaveBeenCalledTimes(1);
  });

  it('repositions visible autocomplete to the focused cell input', () => {
    const input = {
      getBoundingClientRect: vi
        .fn()
        .mockReturnValue({ left: 40, bottom: 88 }),
    } as unknown as HTMLDivElement;
    const ctx = {
      autocomplete: {
        isListVisible: vi.fn().mockReturnValue(true),
        isHintVisible: vi.fn().mockReturnValue(false),
        reposition: vi.fn(),
      },
      cellInput: {
        isFocused: vi.fn().mockReturnValue(true),
        getInput: vi.fn().mockReturnValue(input),
      },
      formulaBar: {
        isFocused: vi.fn().mockReturnValue(false),
        getFormulaInput: vi.fn(),
      },
    };

    updateAutocompletePositionForActiveInput.call(ctx as never);

    expect(ctx.autocomplete.reposition).toHaveBeenCalledWith({
      left: 40,
      top: 90,
    });
  });
});
