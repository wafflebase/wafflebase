// @vitest-environment jsdom
import '../../../src/view/canvas/test-canvas-env';
import { describe, it, expect, vi } from 'vitest';
import { MemSlidesStore } from '../../../src/store/memory';
import { showLayoutPicker } from '../../../src/view/editor/layout-picker';

function host(): HTMLElement {
  const el = document.createElement('div');
  document.body.appendChild(el);
  return el;
}

describe('showLayoutPicker', () => {
  it('mounts a popover with a cell per built-in layout', () => {
    const store = new MemSlidesStore();
    const h = host();
    showLayoutPicker(h, {
      store,
      anchor: { x: 100, y: 100 },
      onPick: () => {},
      onClose: () => {},
    });
    const cells = h.querySelectorAll('[data-layout-id]');
    expect(cells.length).toBe(11);
  });

  it('clicking a cell calls onPick(layoutId) then onClose', () => {
    const store = new MemSlidesStore();
    const onPick = vi.fn();
    const onClose = vi.fn();
    const h = host();
    showLayoutPicker(h, {
      store,
      anchor: { x: 0, y: 0 },
      onPick,
      onClose,
    });
    const cell = h.querySelector('[data-layout-id="title-body"]') as HTMLElement;
    cell.click();
    expect(onPick).toHaveBeenCalledWith('title-body');
    expect(onClose).toHaveBeenCalled();
  });

  it('outlines the cell whose layoutId matches selectedLayoutId', () => {
    const store = new MemSlidesStore();
    const h = host();
    showLayoutPicker(h, {
      store,
      anchor: { x: 0, y: 0 },
      selectedLayoutId: 'title-body',
      onPick: () => {},
      onClose: () => {},
    });
    const selected = h.querySelector('[data-layout-id="title-body"]') as HTMLElement;
    expect(selected.dataset.selected).toBe('true');
  });

  it('Escape key closes via onClose', () => {
    const store = new MemSlidesStore();
    const onClose = vi.fn();
    const h = host();
    showLayoutPicker(h, {
      store,
      anchor: { x: 0, y: 0 },
      onPick: () => {},
      onClose,
    });
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(onClose).toHaveBeenCalled();
  });

  it('outside-click closes via onClose', () => {
    const store = new MemSlidesStore();
    const onPick = vi.fn();
    const onClose = vi.fn();
    const h = host();
    showLayoutPicker(h, {
      store,
      anchor: { x: 0, y: 0 },
      onPick,
      onClose,
    });
    // Click on document.body (outside the popover) — should close.
    document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    expect(onClose).toHaveBeenCalled();
    expect(onPick).not.toHaveBeenCalled();
  });

  it('cells are keyboard-focusable with role=option', () => {
    const store = new MemSlidesStore();
    const h = host();
    showLayoutPicker(h, {
      store,
      anchor: { x: 0, y: 0 },
      onPick: () => {},
      onClose: () => {},
    });
    const popover = h.querySelector('.wfb-slides-layout-picker') as HTMLElement;
    expect(popover.getAttribute('role')).toBe('listbox');
    const cell = h.querySelector<HTMLElement>('[data-layout-id="title-body"]')!;
    expect(cell.tabIndex).toBe(0);
    expect(cell.getAttribute('role')).toBe('option');
  });

  it('Enter on a focused cell fires onPick + onClose', () => {
    const store = new MemSlidesStore();
    const onPick = vi.fn();
    const onClose = vi.fn();
    const h = host();
    showLayoutPicker(h, {
      store,
      anchor: { x: 0, y: 0 },
      onPick,
      onClose,
    });
    const cell = h.querySelector<HTMLElement>('[data-layout-id="title-body"]')!;
    cell.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(onPick).toHaveBeenCalledWith('title-body');
    expect(onClose).toHaveBeenCalled();
  });

  it('returns a close fn that dismisses the popover and fires onClose', () => {
    const store = new MemSlidesStore();
    const onClose = vi.fn();
    const h = host();
    const close = showLayoutPicker(h, {
      store,
      anchor: { x: 0, y: 0 },
      onPick: () => {},
      onClose,
    });
    expect(typeof close).toBe('function');
    expect(h.querySelector('.wfb-slides-layout-picker')).toBeTruthy();
    close();
    expect(h.querySelector('.wfb-slides-layout-picker')).toBeNull();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('returned close fn is idempotent — second call is a no-op', () => {
    const store = new MemSlidesStore();
    const onClose = vi.fn();
    const close = showLayoutPicker(host(), {
      store,
      anchor: { x: 0, y: 0 },
      onPick: () => {},
      onClose,
    });
    close();
    close();
    close();
    // Without the closed-flag guard, onClose would fire 3x and the
    // toolbar's pickerCloseRef.current = null would also re-fire,
    // causing surprising state churn during unmount races.
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('mousedown on the registered trigger does NOT close the popover', () => {
    const store = new MemSlidesStore();
    const onClose = vi.fn();
    const h = host();
    const trigger = document.createElement('button');
    document.body.appendChild(trigger);
    showLayoutPicker(h, {
      store,
      anchor: { x: 0, y: 0 },
      trigger,
      onPick: () => {},
      onClose,
    });
    // Mousedown on the trigger — the toolbar's chevron click toggles
    // the picker via the returned close handle, so the picker's own
    // outside-click handler must not also close it (the "first
    // mousedown closes, then click reopens" race).
    trigger.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    expect(onClose).not.toHaveBeenCalled();
    expect(h.querySelector('.wfb-slides-layout-picker')).toBeTruthy();
    // A click somewhere genuinely outside still closes.
    document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
