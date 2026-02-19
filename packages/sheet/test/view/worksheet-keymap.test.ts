import { describe, expect, it, vi } from 'vitest';
import { Worksheet } from '../../src/view/worksheet';

type GridSheetMock = {
  resizeRange: ReturnType<typeof vi.fn>;
  moveToEdge: ReturnType<typeof vi.fn>;
  move: ReturnType<typeof vi.fn>;
};

type GridContext = {
  sheet: GridSheetMock;
  readOnly: boolean;
  render: ReturnType<typeof vi.fn>;
  scrollIntoView: ReturnType<typeof vi.fn>;
  showCellInput: ReturnType<typeof vi.fn>;
  isValidCellInput: ReturnType<typeof vi.fn>;
  copy: ReturnType<typeof vi.fn>;
  paste: ReturnType<typeof vi.fn>;
  renderOverlay: ReturnType<typeof vi.fn>;
};

const handleGridKeydown = (
  Worksheet.prototype as unknown as {
    handleGridKeydown: (e: KeyboardEvent) => Promise<void>;
  }
).handleGridKeydown;

const createContext = (): GridContext => ({
  sheet: {
    resizeRange: vi.fn().mockReturnValue(false),
    moveToEdge: vi.fn().mockResolvedValue(false),
    move: vi.fn().mockReturnValue(false),
  },
  readOnly: false,
  render: vi.fn(),
  scrollIntoView: vi.fn(),
  showCellInput: vi.fn(),
  isValidCellInput: vi.fn().mockReturnValue(false),
  copy: vi.fn(),
  paste: vi.fn(),
  renderOverlay: vi.fn(),
});

const createEvent = (
  key: string,
  modifiers: Partial<Pick<KeyboardEvent, 'ctrlKey' | 'metaKey' | 'shiftKey'>>,
) => {
  const preventDefault = vi.fn();
  const event = {
    key,
    ctrlKey: modifiers.ctrlKey ?? false,
    metaKey: modifiers.metaKey ?? false,
    shiftKey: modifiers.shiftKey ?? false,
    altKey: false,
    preventDefault,
  } as unknown as KeyboardEvent;
  return { event, preventDefault };
};

describe('Worksheet grid keymap', () => {
  it('uses Ctrl+Arrow to move to content edge', async () => {
    const ctx = createContext();
    ctx.sheet.moveToEdge.mockResolvedValue(true);
    const { event, preventDefault } = createEvent('ArrowRight', {
      ctrlKey: true,
    });

    await handleGridKeydown.call(ctx, event);

    expect(ctx.sheet.moveToEdge).toHaveBeenCalledWith('right');
    expect(ctx.sheet.move).not.toHaveBeenCalled();
    expect(preventDefault).toHaveBeenCalled();
    expect(ctx.render).toHaveBeenCalledTimes(1);
    expect(ctx.scrollIntoView).toHaveBeenCalledTimes(1);
  });

  it('keeps Shift+Arrow precedence for range resize', async () => {
    const ctx = createContext();
    ctx.sheet.resizeRange.mockReturnValue(true);
    const { event } = createEvent('ArrowDown', {
      ctrlKey: true,
      shiftKey: true,
    });

    await handleGridKeydown.call(ctx, event);

    expect(ctx.sheet.resizeRange).toHaveBeenCalledWith('down');
    expect(ctx.sheet.moveToEdge).not.toHaveBeenCalled();
    expect(ctx.sheet.move).not.toHaveBeenCalled();
  });
});
