// @vitest-environment jsdom
import { describe, expect, it, vi, afterEach } from 'vitest';
import '../../../src/view/canvas/test-canvas-env';
import { MemSlidesStore } from '../../../src/store/memory';
import { BUILT_IN_LAYOUTS } from '../../../src/model/layout';
import { mountLayoutListPanel } from '../../../src/view/editor/layout-list-panel';

/**
 * PR3 commit 5c — `mountLayoutListPanel` replaces the slide thumbnail
 * rail while in layout-edit mode: a selectable list of the deck's
 * layouts. Clicking one drives the editor to edit that layout.
 */
function setup() {
  document.body.innerHTML = '';
  const container = document.createElement('div');
  document.body.appendChild(container);
  const store = new MemSlidesStore();
  return { container, store };
}

describe('mountLayoutListPanel', () => {
  let handle: ReturnType<typeof mountLayoutListPanel> | null = null;
  afterEach(() => {
    if (handle) { handle.dispose(); handle = null; }
  });

  it('renders one selectable row per built-in layout, labelled by name', () => {
    const { container, store } = setup();
    handle = mountLayoutListPanel(container, store, { onSelect: () => {} });

    const rows = container.querySelectorAll('[data-layout-id]');
    expect(rows).toHaveLength(BUILT_IN_LAYOUTS.length);
    const names = Array.from(rows).map((r) => r.textContent);
    for (const layout of BUILT_IN_LAYOUTS) {
      expect(names.some((n) => n?.includes(layout.name))).toBe(true);
    }
  });

  it('calls onSelect with the layout id when a row is clicked', () => {
    const { container, store } = setup();
    const onSelect = vi.fn();
    handle = mountLayoutListPanel(container, store, { onSelect });

    container
      .querySelector<HTMLElement>('[data-layout-id="title-body"]')!
      .click();

    expect(onSelect).toHaveBeenCalledWith('title-body');
  });

  it('marks the selected layout row and moves the marker on update', () => {
    const { container, store } = setup();
    handle = mountLayoutListPanel(container, store, {
      selectedLayoutId: 'title-body',
      onSelect: () => {},
    });

    const selected = () =>
      container.querySelector<HTMLElement>('[data-selected="true"]')?.dataset
        .layoutId;
    expect(selected()).toBe('title-body');

    handle.setSelectedLayoutId('big-number');
    expect(selected()).toBe('big-number');
  });

  it('dispose removes the panel DOM and unsubscribes', () => {
    const { container, store } = setup();
    handle = mountLayoutListPanel(container, store, { onSelect: () => {} });
    expect(container.querySelectorAll('[data-layout-id]').length).toBeGreaterThan(0);

    handle.dispose();
    handle = null;
    expect(container.querySelectorAll('[data-layout-id]')).toHaveLength(0);
  });
});
