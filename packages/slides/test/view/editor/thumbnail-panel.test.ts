// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import '../../../src/view/canvas/test-canvas-env';

import { MemSlidesStore } from '../../../src/store/memory';
import { initialize } from '../../../src/view/editor/editor';
import { mountThumbnailPanel } from '../../../src/view/editor/thumbnail-panel';

beforeEach(() => { document.body.innerHTML = ''; });

function makeFixture() {
  const canvas = document.createElement('canvas');
  canvas.width = 960; canvas.height = 540;
  const overlay = document.createElement('div');
  const panel = document.createElement('div');
  document.body.appendChild(canvas);
  document.body.appendChild(overlay);
  document.body.appendChild(panel);
  const store = new MemSlidesStore();
  store.batch(() => { store.addSlide('blank'); store.addSlide('title'); });
  const editor = initialize({ canvas, overlay, store, hostWidth: 960, hostHeight: 540, dpr: 1 });
  return { canvas, overlay, panel, store, editor };
}

describe('mountThumbnailPanel', () => {
  it('renders one thumbnail per slide', () => {
    const { panel, store, editor } = makeFixture();
    mountThumbnailPanel(panel, store, editor);
    expect(panel.querySelectorAll('[data-slide-id]')).toHaveLength(2);
  });

  it('clicking a thumbnail switches the current slide', () => {
    const { panel, store, editor } = makeFixture();
    mountThumbnailPanel(panel, store, editor);
    const slideIds = store.read().slides.map((s) => s.id);
    const second = panel.querySelector<HTMLDivElement>(`[data-slide-id="${slideIds[1]}"]`)!;
    second.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    expect(editor.getCurrentSlideId()).toBe(slideIds[1]);
  });

  it('highlights the current slide', () => {
    const { panel, store, editor } = makeFixture();
    mountThumbnailPanel(panel, store, editor);
    const firstId = store.read().slides[0].id;
    const first = panel.querySelector<HTMLDivElement>(`[data-slide-id="${firstId}"]`)!;
    expect(first.classList.contains('current')).toBe(true);
  });

  it('updates when a new slide is added (refresh handle)', () => {
    const { panel, store, editor } = makeFixture();
    const handle = mountThumbnailPanel(panel, store, editor);
    store.batch(() => store.addSlide('blank'));
    handle.refresh();
    expect(panel.querySelectorAll('[data-slide-id]')).toHaveLength(3);
  });

  it('shift-click toggles slide multi-selection without switching current slide', () => {
    const { panel, store, editor } = makeFixture();
    const handle = mountThumbnailPanel(panel, store, editor);
    const slideIds = store.read().slides.map((s) => s.id);
    const initial = editor.getCurrentSlideId();
    const second = panel.querySelector<HTMLDivElement>(`[data-slide-id="${slideIds[1]}"]`)!;
    second.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, shiftKey: true }));
    // Shift-click does not change the current slide.
    expect(editor.getCurrentSlideId()).toBe(initial);
    expect(handle.getSelectedSlideIds()).toEqual([slideIds[1]]);
    // Shift-click again removes from selection.
    second.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, shiftKey: true }));
    expect(handle.getSelectedSlideIds()).toEqual([]);
  });

  it('dispose detaches editor selection subscription', () => {
    const { panel, store, editor } = makeFixture();
    const handle = mountThumbnailPanel(panel, store, editor);
    expect(() => handle.dispose()).not.toThrow();
  });
});

describe('mountThumbnailPanel — scroll preservation across re-render', () => {
  it('restores parent scrollTop after innerHTML wipe (simulated browser clamp)', () => {
    const { panel, store, editor } = makeFixture();
    // Wrap the panel in a scrollable host so findScrollParent (overflowY=auto)
    // picks it up. Mirrors the slides-view layout.
    panel.remove();
    const scrollable = document.createElement('div');
    scrollable.style.overflowY = 'auto';
    scrollable.appendChild(panel);
    document.body.appendChild(scrollable);
    mountThumbnailPanel(panel, store, editor);

    // jsdom doesn't compute layout, so scrollTop isn't clamped automatically.
    // Simulate the real-browser clamp synchronously: the moment innerHTML is
    // wiped, slam scrollTop to 0 — what Chrome does when scrollHeight briefly
    // drops below the current scroll offset. The panel must capture scrollTop
    // BEFORE the wipe and restore it AFTER appending children.
    let scrollTopVal = 250;
    Object.defineProperty(scrollable, 'scrollTop', {
      get: () => scrollTopVal,
      set: (v: number) => { scrollTopVal = v; },
      configurable: true,
    });
    const innerHTMLDesc = Object.getOwnPropertyDescriptor(
      Element.prototype,
      'innerHTML',
    )!;
    Object.defineProperty(panel, 'innerHTML', {
      get() { return innerHTMLDesc.get!.call(this); },
      set(value: string) {
        innerHTMLDesc.set!.call(this, value);
        if (value === '') scrollTopVal = 0; // simulated clamp
      },
      configurable: true,
    });

    // Click a different thumbnail — triggers render().
    const slideIds = store.read().slides.map((s) => s.id);
    const second = panel.querySelector<HTMLDivElement>(
      `[data-slide-id="${slideIds[1]}"]`,
    )!;
    second.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));

    expect(scrollable.scrollTop).toBe(250);
  });
});

describe('mountThumbnailPanel — arrow key navigation', () => {
  function keydown(target: HTMLElement, key: string) {
    target.dispatchEvent(
      new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }),
    );
  }

  it('ArrowDown advances to the next slide', () => {
    const { panel, store, editor } = makeFixture();
    mountThumbnailPanel(panel, store, editor);
    const slideIds = store.read().slides.map((s) => s.id);
    expect(editor.getCurrentSlideId()).toBe(slideIds[0]);
    keydown(panel, 'ArrowDown');
    expect(editor.getCurrentSlideId()).toBe(slideIds[1]);
  });

  it('ArrowUp reverses to the previous slide', () => {
    const { panel, store, editor } = makeFixture();
    mountThumbnailPanel(panel, store, editor);
    const slideIds = store.read().slides.map((s) => s.id);
    editor.setCurrentSlide(slideIds[1]);
    keydown(panel, 'ArrowUp');
    expect(editor.getCurrentSlideId()).toBe(slideIds[0]);
  });

  it('ArrowUp on the first slide is a no-op', () => {
    const { panel, store, editor } = makeFixture();
    mountThumbnailPanel(panel, store, editor);
    const slideIds = store.read().slides.map((s) => s.id);
    expect(editor.getCurrentSlideId()).toBe(slideIds[0]);
    keydown(panel, 'ArrowUp');
    expect(editor.getCurrentSlideId()).toBe(slideIds[0]);
  });

  it('ArrowDown on the last slide is a no-op', () => {
    const { panel, store, editor } = makeFixture();
    mountThumbnailPanel(panel, store, editor);
    const slideIds = store.read().slides.map((s) => s.id);
    editor.setCurrentSlide(slideIds[slideIds.length - 1]);
    keydown(panel, 'ArrowDown');
    expect(editor.getCurrentSlideId()).toBe(slideIds[slideIds.length - 1]);
  });

  it('ignores arrow keys with modifier (Cmd/Ctrl/Alt) so existing shortcuts pass through', () => {
    const { panel, store, editor } = makeFixture();
    mountThumbnailPanel(panel, store, editor);
    const slideIds = store.read().slides.map((s) => s.id);
    panel.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'ArrowDown',
        metaKey: true,
        bubbles: true,
        cancelable: true,
      }),
    );
    expect(editor.getCurrentSlideId()).toBe(slideIds[0]);
  });

  it('panel is keyboard-focusable (tabIndex=0)', () => {
    const { panel, store, editor } = makeFixture();
    mountThumbnailPanel(panel, store, editor);
    expect(panel.tabIndex).toBe(0);
  });
});

describe('mountThumbnailPanel — responsive sizing + DPR', () => {
  it('thumbnail outer box scales to the container width with 16:9 inner', () => {
    const { panel, store, editor } = makeFixture();
    // jsdom does not compute layout, so we pin clientWidth directly.
    Object.defineProperty(panel, 'clientWidth', { value: 240, configurable: true });
    mountThumbnailPanel(panel, store, editor);
    const item = panel.querySelector<HTMLDivElement>('[data-slide-id]')!;
    expect(item.style.width).toBe('240px');
    // innerW = 240 - 2 = 238, innerH = round(238 / (16/9)) = 134,
    // outerH = 134 + 2 = 136.
    expect(item.style.height).toBe('136px');
  });

  it('thumbnail outer box clamps to MIN_THUMB_W (80px) on a very narrow panel', () => {
    const { panel, store, editor } = makeFixture();
    Object.defineProperty(panel, 'clientWidth', { value: 40, configurable: true });
    mountThumbnailPanel(panel, store, editor);
    const item = panel.querySelector<HTMLDivElement>('[data-slide-id]')!;
    expect(item.style.width).toBe('80px');
  });

  it('thumbnail outer box clamps to MAX_THUMB_W (320px) on a very wide panel', () => {
    const { panel, store, editor } = makeFixture();
    Object.defineProperty(panel, 'clientWidth', { value: 800, configurable: true });
    mountThumbnailPanel(panel, store, editor);
    const item = panel.querySelector<HTMLDivElement>('[data-slide-id]')!;
    expect(item.style.width).toBe('320px');
  });

  it('inner canvas box is exactly 16:9 so the slide fills it (no letterbox gap)', () => {
    const { panel, store, editor } = makeFixture();
    Object.defineProperty(panel, 'clientWidth', { value: 240, configurable: true });
    mountThumbnailPanel(panel, store, editor);
    const canvas = panel.querySelector<HTMLCanvasElement>('[data-slide-id] canvas')!;
    // innerW / innerH must round-trip to 16:9 within 1 pixel.
    const innerW = Number.parseInt(canvas.style.width, 10);
    const innerH = Number.parseInt(canvas.style.height, 10);
    expect(innerW).toBe(238);
    expect(innerH).toBe(Math.round(238 / (16 / 9)));
  });

  it('canvas backing store is sized at devicePixelRatio for crisp Retina paint', () => {
    const originalDpr = window.devicePixelRatio;
    Object.defineProperty(window, 'devicePixelRatio', { value: 2, configurable: true });
    try {
      const { panel, store, editor } = makeFixture();
      Object.defineProperty(panel, 'clientWidth', { value: 200, configurable: true });
      mountThumbnailPanel(panel, store, editor);
      const canvas = panel.querySelector<HTMLCanvasElement>('[data-slide-id] canvas')!;
      // 1px border on each side → innerW = 200 - 2 = 198,
      // innerH = round(198 / (16/9)) = 111. Backing store is innerW/H × dpr.
      const innerW = 198;
      const innerH = Math.round(innerW / (16 / 9));
      expect(canvas.width).toBe(innerW * 2);
      expect(canvas.height).toBe(innerH * 2);
      expect(canvas.style.width).toBe(`${innerW}px`);
    } finally {
      Object.defineProperty(window, 'devicePixelRatio', { value: originalDpr, configurable: true });
    }
  });

  it('refresh() re-renders at the container\'s current width', () => {
    const { panel, store, editor } = makeFixture();
    Object.defineProperty(panel, 'clientWidth', { value: 160, configurable: true });
    const handle = mountThumbnailPanel(panel, store, editor);
    expect(panel.querySelector<HTMLDivElement>('[data-slide-id]')!.style.width).toBe('160px');
    Object.defineProperty(panel, 'clientWidth', { value: 280, configurable: true });
    handle.refresh();
    expect(panel.querySelector<HTMLDivElement>('[data-slide-id]')!.style.width).toBe('280px');
  });

  it('falls back to a sensible default size when the container has no measured width', () => {
    // jsdom default: clientWidth === 0. Falls back to FALLBACK_THUMB_W (192).
    const { panel, store, editor } = makeFixture();
    mountThumbnailPanel(panel, store, editor);
    const item = panel.querySelector<HTMLDivElement>('[data-slide-id]')!;
    expect(item.style.width).toBe('192px');
    // innerW = 190, innerH = round(190 / (16/9)) = 107, outerH = 109.
    expect(item.style.height).toBe('109px');
  });

  it('does not render an in-panel "+ Add slide" button (moved to toolbar)', () => {
    const { panel, store, editor } = makeFixture();
    mountThumbnailPanel(panel, store, editor);
    expect(panel.querySelector('[data-add-slide-insert]')).toBeNull();
    expect(panel.querySelector('[data-add-slide-dropdown]')).toBeNull();
    // No <button> children at all should remain in the panel after the
    // refactor — the only interactive elements are the slide thumbs.
    expect(panel.querySelectorAll('button')).toHaveLength(0);
  });
});

describe('mountThumbnailPanel — right-click context menu', () => {
  function rightClick(target: HTMLElement) {
    target.dispatchEvent(
      new MouseEvent('contextmenu', { bubbles: true, clientX: 10, clientY: 10 }),
    );
  }
  function menuLabels(): string[] {
    return Array.from(
      document.body.querySelectorAll('.wfb-slides-context-menu li'),
    )
      .map((li) => li.textContent ?? '')
      .filter((s) => s.length > 0);
  }

  it('right-click opens the menu with single-slide labels', () => {
    const { panel, store, editor } = makeFixture();
    mountThumbnailPanel(panel, store, editor);
    const firstId = store.read().slides[0].id;
    const item = panel.querySelector<HTMLDivElement>(`[data-slide-id="${firstId}"]`)!;
    rightClick(item);
    const labels = menuLabels();
    expect(labels).toContain('New slide');
    expect(labels).toContain('Duplicate slide');
    expect(labels).toContain('Delete slide');
    expect(labels).toContain('Change layout…');
  });

  it('right-click on a slide outside the multi-selection collapses it to that slide', () => {
    const { panel, store, editor } = makeFixture();
    const handle = mountThumbnailPanel(panel, store, editor);
    const ids = store.read().slides.map((s) => s.id);
    // Shift-click the second slide into the multi-selection.
    const second = panel.querySelector<HTMLDivElement>(`[data-slide-id="${ids[1]}"]`)!;
    second.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, shiftKey: true }));
    expect(handle.getSelectedSlideIds()).toEqual([ids[1]]);
    // Right-click on the first slide (NOT in the multi-selection) →
    // selection collapses to just the first slide.
    const first = panel.querySelector<HTMLDivElement>(`[data-slide-id="${ids[0]}"]`)!;
    rightClick(first);
    expect(handle.getSelectedSlideIds()).toEqual([ids[0]]);
    // Menu uses single-slide labels.
    expect(menuLabels()).toContain('Delete slide');
  });

  it('right-click on a slide already in the multi-selection keeps the set and switches labels to plural', () => {
    const { panel, store, editor } = makeFixture();
    const handle = mountThumbnailPanel(panel, store, editor);
    const ids = store.read().slides.map((s) => s.id);
    // Shift-click both slides to multi-select.
    const first = panel.querySelector<HTMLDivElement>(`[data-slide-id="${ids[0]}"]`)!;
    const second = panel.querySelector<HTMLDivElement>(`[data-slide-id="${ids[1]}"]`)!;
    first.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, shiftKey: true }));
    second.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, shiftKey: true }));
    expect(handle.getSelectedSlideIds()).toHaveLength(2);
    // Right-click second (in the set) — selection stays.
    rightClick(panel.querySelector<HTMLDivElement>(`[data-slide-id="${ids[1]}"]`)!);
    expect(handle.getSelectedSlideIds()).toHaveLength(2);
    expect(menuLabels()).toContain('Delete 2 slides');
    expect(menuLabels()).toContain('Duplicate 2 slides');
  });

  it('clicking "New slide" inserts a slide after the right-clicked one and switches current', () => {
    const { panel, store, editor } = makeFixture();
    mountThumbnailPanel(panel, store, editor);
    const firstId = store.read().slides[0].id;
    rightClick(panel.querySelector<HTMLDivElement>(`[data-slide-id="${firstId}"]`)!);
    const newSlideItem = Array.from(
      document.body.querySelectorAll<HTMLLIElement>('.wfb-slides-context-menu li'),
    ).find((li) => li.textContent === 'New slide')!;
    newSlideItem.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    const slides = store.read().slides;
    expect(slides).toHaveLength(3);
    // Inserted at index 1 (after the right-clicked first slide).
    expect(slides[0].id).toBe(firstId);
    expect(editor.getCurrentSlideId()).toBe(slides[1].id);
  });

  it('clicking "Duplicate slide" inserts a copy and switches current to it', () => {
    const { panel, store, editor } = makeFixture();
    mountThumbnailPanel(panel, store, editor);
    const firstId = store.read().slides[0].id;
    rightClick(panel.querySelector<HTMLDivElement>(`[data-slide-id="${firstId}"]`)!);
    const dupItem = Array.from(
      document.body.querySelectorAll<HTMLLIElement>('.wfb-slides-context-menu li'),
    ).find((li) => li.textContent === 'Duplicate slide')!;
    dupItem.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    const slides = store.read().slides;
    expect(slides).toHaveLength(3);
    // The duplicate sits immediately after the source.
    expect(slides[0].id).toBe(firstId);
    expect(editor.getCurrentSlideId()).toBe(slides[1].id);
  });

  it('clicking "Delete slide" removes it and switches current to a survivor when current was deleted', () => {
    const { panel, store, editor } = makeFixture();
    mountThumbnailPanel(panel, store, editor);
    const ids = store.read().slides.map((s) => s.id);
    expect(editor.getCurrentSlideId()).toBe(ids[0]);
    rightClick(panel.querySelector<HTMLDivElement>(`[data-slide-id="${ids[0]}"]`)!);
    const delItem = Array.from(
      document.body.querySelectorAll<HTMLLIElement>('.wfb-slides-context-menu li'),
    ).find((li) => li.textContent === 'Delete slide')!;
    delItem.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(store.read().slides.map((s) => s.id)).toEqual([ids[1]]);
    expect(editor.getCurrentSlideId()).toBe(ids[1]);
  });

  it('"Delete slide" is disabled when only one slide remains in the deck', () => {
    // Single-slide fixture (the real fixture has two; trim one first).
    const { panel, store, editor } = makeFixture();
    const firstId = store.read().slides[0].id;
    const secondId = store.read().slides[1].id;
    store.batch(() => store.removeSlide(secondId));
    mountThumbnailPanel(panel, store, editor);
    rightClick(panel.querySelector<HTMLDivElement>(`[data-slide-id="${firstId}"]`)!);
    const delItem = Array.from(
      document.body.querySelectorAll<HTMLLIElement>('.wfb-slides-context-menu li'),
    ).find((li) => li.textContent === 'Delete slide')!;
    expect(delItem.style.opacity).toBe('0.5');
  });

  it('"Change layout…" is disabled with multi-selection', () => {
    const { panel, store, editor } = makeFixture();
    const handle = mountThumbnailPanel(panel, store, editor);
    const ids = store.read().slides.map((s) => s.id);
    const first = panel.querySelector<HTMLDivElement>(`[data-slide-id="${ids[0]}"]`)!;
    const second = panel.querySelector<HTMLDivElement>(`[data-slide-id="${ids[1]}"]`)!;
    first.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, shiftKey: true }));
    second.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, shiftKey: true }));
    expect(handle.getSelectedSlideIds()).toHaveLength(2);
    rightClick(second);
    const changeItem = Array.from(
      document.body.querySelectorAll<HTMLLIElement>('.wfb-slides-context-menu li'),
    ).find((li) => li.textContent === 'Change layout…')!;
    expect(changeItem.style.opacity).toBe('0.5');
  });
});
