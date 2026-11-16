import { describe, expect, it, vi } from 'vitest';
import { Worksheet } from '../../src/view/worksheet';

/**
 * Clicking the name box while a cell is being edited must save that edit,
 * the way leaving the cell any other way does — not drop what was typed.
 */
const commit = (
  Worksheet.prototype as unknown as {
    commitEditForNameBox: () => Promise<void>;
  }
).commitEditForNameBox;

function createContext(options: {
  shown: boolean;
  primed: boolean;
  readOnly?: boolean;
}) {
  const order: string[] = [];
  const ctx = {
    readOnly: options.readOnly ?? false,
    sheet: { getActiveCell: () => ({ r: 3, c: 2 }) },
    cellInput: {
      isShown: () => options.shown,
      isPrimed: () => options.primed,
      getValue: () => '=SUM(A1:A3)',
      hide: vi.fn(() => order.push('hide')),
    },
    autocomplete: { hide: vi.fn() },
    formulaRanges: [{}] as unknown[],
    resetFormulaRangeState: vi.fn(),
    commitCellValue: vi.fn(async () => {
      order.push('commit');
    }),
    render: vi.fn(() => order.push('render')),
  };
  return { ctx, order };
}

describe('Worksheet name box focus', () => {
  it('saves the edit in progress to the active cell', async () => {
    const { ctx, order } = createContext({ shown: true, primed: false });

    await commit.call(ctx);

    expect(ctx.commitCellValue).toHaveBeenCalledWith(
      { r: 3, c: 2 },
      '=SUM(A1:A3)',
    );
    expect(ctx.autocomplete.hide).toHaveBeenCalled();
    expect(ctx.formulaRanges).toEqual([]);
    expect(order).toEqual(['hide', 'commit', 'render']);
  });

  it('writes nothing when no edit is in progress', async () => {
    // A primed input is the hidden keyboard sink, not an edit.
    for (const state of [
      { shown: false, primed: false },
      { shown: true, primed: true },
    ]) {
      const { ctx } = createContext(state);
      await commit.call(ctx);
      expect(ctx.commitCellValue).not.toHaveBeenCalled();
      expect(ctx.cellInput.hide).not.toHaveBeenCalled();
    }
  });

  it('writes nothing for a read-only viewer', async () => {
    const { ctx } = createContext({
      shown: true,
      primed: false,
      readOnly: true,
    });

    await commit.call(ctx);

    expect(ctx.commitCellValue).not.toHaveBeenCalled();
  });
});
