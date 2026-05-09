// @vitest-environment jsdom
import '../canvas/test-canvas-env';
import { describe, it, expect, vi } from 'vitest';
import { MemSlidesStore } from '../../store/memory';
import { showLayoutPicker } from './layout-picker';

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
});
