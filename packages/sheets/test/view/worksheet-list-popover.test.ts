// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { Worksheet } from '../../src/view/worksheet';

// Access the private methods off the prototype (same technique as the
// editor-keymap test) so we can exercise the popover in isolation.
const proto = Worksheet.prototype as unknown as {
  renderListPopover: () => void;
  highlightListPopoverRow: () => void;
  chooseListValue: (value: string) => Promise<void>;
};
const realChooseListValue = proto.chooseListValue;
const realHighlight = proto.highlightListPopoverRow;

type PopoverContext = {
  theme: string;
  readOnly: boolean;
  listPopover: HTMLDivElement;
  listPopoverState: { ref: { r: number; c: number }; options: string[]; activeIndex: number } | null;
  listPopoverOutsideClickUnsub: (() => void) | null;
  listPopoverKeyboardUnsub: (() => void) | null;
  sheet: { setData: ReturnType<typeof vi.fn> };
  render: ReturnType<typeof vi.fn>;
  hideListPopover: () => void;
};

const createContext = (): PopoverContext => {
  const ctx: PopoverContext = {
    theme: 'light',
    readOnly: false,
    listPopover: document.createElement('div'),
    listPopoverState: {
      ref: { r: 1, c: 1 },
      options: ['Red', 'Green', 'Blue'],
      activeIndex: 0,
    },
    listPopoverOutsideClickUnsub: null,
    listPopoverKeyboardUnsub: null,
    sheet: { setData: vi.fn().mockResolvedValue(undefined) },
    render: vi.fn(),
    hideListPopover: vi.fn(function (this: PopoverContext) {
      this.listPopover.innerHTML = '';
      this.listPopoverState = null;
    }),
  };
  // The row handlers call `this.chooseListValue` / `this.highlightListPopoverRow`;
  // wire the real methods so the test exercises the true paths.
  (ctx as unknown as { chooseListValue: typeof realChooseListValue }).chooseListValue =
    realChooseListValue;
  (ctx as unknown as { highlightListPopoverRow: typeof realHighlight }).highlightListPopoverRow =
    realHighlight;
  return ctx;
};

describe('Worksheet list popover', () => {
  it('renders one clickable row per option', () => {
    const ctx = createContext();
    proto.renderListPopover.call(ctx);
    expect(ctx.listPopover.children).toHaveLength(3);
    expect(ctx.listPopover.children[1].textContent).toBe('Green');
  });

  it('keeps row elements stable when the hover highlight changes', () => {
    // Regression: hovering must NOT rebuild the DOM, or the row under the
    // cursor is destroyed mid-click and the option never commits.
    const ctx = createContext();
    proto.renderListPopover.call(ctx);
    const before = [...ctx.listPopover.children];

    // Simulate hovering the second row.
    (before[1] as HTMLDivElement).dispatchEvent(
      new MouseEvent('mouseenter', { bubbles: false }),
    );

    const after = [...ctx.listPopover.children];
    expect(after).toHaveLength(3);
    // Same element instances — not recreated.
    expect(after[0]).toBe(before[0]);
    expect(after[1]).toBe(before[1]);
    expect(after[2]).toBe(before[2]);
    // Highlight moved to the hovered row.
    expect((after[1] as HTMLElement).style.backgroundColor).not.toBe('');
    expect((after[0] as HTMLElement).style.backgroundColor).toBe('');
  });

  it('commits the option value on a row mousedown', async () => {
    const ctx = createContext();
    proto.renderListPopover.call(ctx);

    const row = ctx.listPopover.children[2] as HTMLDivElement; // "Blue"
    const event = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
    row.dispatchEvent(event);
    // The handler dispatches an async chooseListValue; flush microtasks.
    await Promise.resolve();
    await Promise.resolve();

    expect(ctx.sheet.setData).toHaveBeenCalledWith({ r: 1, c: 1 }, 'Blue');
  });
});
