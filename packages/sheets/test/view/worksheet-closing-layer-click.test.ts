// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import { Worksheet } from '../../src/view/worksheet';

/**
 * A modal layer (Radix Dialog, AlertDialog, ContextMenu, DropdownMenu)
 * neutralizes the page with `body { pointer-events: none }` and keeps doing
 * so through its exit animation; a Dialog's overlay also stays on top until
 * the animation ends. A click on the grid in that window — Esc, then
 * straight to the next cell — landed on the fading overlay (or on <html>)
 * and was lost, so the following keystrokes went into the cell that was
 * selected before the dialog opened.
 */
const handle = (
  Worksheet.prototype as unknown as {
    handleNeutralizedMouseDown: (e: MouseEvent) => void;
  }
).handleNeutralizedMouseDown;
const notePointerDown = (
  Worksheet.prototype as unknown as {
    handleLayerPointerDown: () => void;
  }
).handleLayerPointerDown;

/**
 * jsdom does no hit testing, so each case states what the page would put
 * under the pointer once it is no longer neutralized: by default the grid.
 */
function stackAtPoint(...stack: Element[]) {
  document.elementsFromPoint = () => stack;
}

function createContext() {
  const scroll = document.createElement('div');
  document.body.appendChild(scroll);
  scroll.getBoundingClientRect = () =>
    ({
      left: 100,
      top: 50,
      right: 900,
      bottom: 650,
      width: 800,
      height: 600,
    }) as DOMRect;
  Object.defineProperty(scroll, 'clientWidth', { value: 785 });
  Object.defineProperty(scroll, 'clientHeight', { value: 585 });
  const container = document.createElement('div');
  container.appendChild(scroll);
  document.body.appendChild(container);
  stackAtPoint(scroll);
  return {
    container,
    gridContainer: { getScrollContainer: () => scroll },
    handleMouseDown: vi.fn().mockResolvedValue(undefined),
  };
}

function mousedown(target: Element, clientX: number, clientY: number) {
  const event = new MouseEvent('mousedown', {
    bubbles: true,
    cancelable: true,
    clientX,
    clientY,
    button: 0,
    detail: 1,
  });
  Object.defineProperty(event, 'target', { value: target });
  return event;
}

function closingOverlay(): HTMLElement {
  const overlay = document.createElement('div');
  overlay.setAttribute('data-state', 'closed');
  overlay.style.position = 'fixed';
  document.body.appendChild(overlay);
  return overlay;
}

afterEach(() => {
  document.body.innerHTML = '';
  document.body.style.pointerEvents = '';
});

describe('Worksheet click through a closing modal layer', () => {
  it('selects the clicked cell through a dialog overlay that is animating out', () => {
    const ctx = createContext();
    document.body.style.pointerEvents = 'none';
    const overlay = closingOverlay();
    stackAtPoint(overlay, ctx.gridContainer.getScrollContainer());
    const event = mousedown(overlay, 300, 200);

    handle.call(ctx, event);

    expect(ctx.handleMouseDown).toHaveBeenCalledTimes(1);
    const forwarded = ctx.handleMouseDown.mock.calls[0][0] as MouseEvent;
    // Offsets are relative to the grid's scroll container, as a direct hit
    // would report them.
    expect(forwarded.offsetX).toBe(200);
    expect(forwarded.offsetY).toBe(150);
    expect(forwarded.button).toBe(0);
    expect(event.defaultPrevented).toBe(true);
  });

  it('selects the clicked cell when the neutralized page hands the click to <html>', () => {
    const ctx = createContext();
    document.body.style.pointerEvents = 'none';

    handle.call(ctx, mousedown(document.documentElement, 300, 200));

    expect(ctx.handleMouseDown).toHaveBeenCalledTimes(1);
  });

  it('leaves the click to a layer that is still open', () => {
    const ctx = createContext();
    document.body.style.pointerEvents = 'none';
    const dialog = document.createElement('div');
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('data-state', 'open');
    document.body.appendChild(dialog);

    handle.call(ctx, mousedown(document.documentElement, 300, 200));

    expect(ctx.handleMouseDown).not.toHaveBeenCalled();
  });

  it('ignores clicks outside the grid, and on its scrollbars', () => {
    const ctx = createContext();
    document.body.style.pointerEvents = 'none';
    const overlay = closingOverlay();

    handle.call(ctx, mousedown(overlay, 50, 200));
    handle.call(ctx, mousedown(overlay, 895, 200));

    expect(ctx.handleMouseDown).not.toHaveBeenCalled();
  });

  it('ignores ordinary clicks when no modal layer has the page', () => {
    const ctx = createContext();
    const button = document.createElement('button');
    button.setAttribute('data-state', 'closed'); // e.g. a tooltip trigger
    document.body.appendChild(button);

    handle.call(ctx, mousedown(button, 300, 200));
    handle.call(ctx, mousedown(document.documentElement, 300, 200));

    expect(ctx.handleMouseDown).not.toHaveBeenCalled();
  });

  it('ignores a closing element that is not a page-covering layer', () => {
    const ctx = createContext();
    document.body.style.pointerEvents = 'none';
    const trigger = document.createElement('button');
    trigger.setAttribute('data-state', 'closed');
    document.body.appendChild(trigger);

    handle.call(ctx, mousedown(trigger, 300, 200));

    expect(ctx.handleMouseDown).not.toHaveBeenCalled();
  });

  it('leaves the click alone when something else covers the grid', () => {
    // A revision preview paints over the live sheet, which stays mounted:
    // a click there belongs to the preview, never to the live document.
    const ctx = createContext();
    document.body.style.pointerEvents = 'none';
    const preview = document.createElement('div');
    document.body.appendChild(preview);
    stackAtPoint(preview, ctx.gridContainer.getScrollContainer());

    handle.call(ctx, mousedown(document.documentElement, 300, 200));

    expect(ctx.handleMouseDown).not.toHaveBeenCalled();
    // The hit test must not leave the page un-neutralized.
    expect(document.body.style.pointerEvents).toBe('none');
  });

  it('does not act on the grid with the click that dismisses a layer', () => {
    // An open menu is dismissed by an outside pointerdown, which flips it to
    // `closed` before the mousedown arrives. That click closes the menu; it
    // must not also select, toggle a checkbox or follow a link on the grid.
    const ctx = createContext();
    document.body.style.pointerEvents = 'none';
    const menu = document.createElement('div');
    menu.setAttribute('role', 'menu');
    menu.setAttribute('data-state', 'open');
    document.body.appendChild(menu);

    notePointerDown.call(ctx);
    menu.setAttribute('data-state', 'closed');
    handle.call(ctx, mousedown(document.documentElement, 300, 200));

    expect(ctx.handleMouseDown).not.toHaveBeenCalled();
  });
});
