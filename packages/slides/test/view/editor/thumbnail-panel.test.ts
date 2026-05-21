// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import '../../../src/view/canvas/test-canvas-env';

import { MemSlidesStore } from '../../../src/store/memory';
import { clearImageCacheForTests } from '../../../src/view/canvas/image-cache';
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
    second.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
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
    second.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, shiftKey: true }));
    // Shift-click does not change the current slide.
    expect(editor.getCurrentSlideId()).toBe(initial);
    expect(handle.getSelectedSlideIds()).toEqual([slideIds[1]]);
    // Shift-click again removes from selection.
    second.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, shiftKey: true }));
    expect(handle.getSelectedSlideIds()).toEqual([]);
  });

  it('dispose detaches editor current-slide subscription', () => {
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
    second.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));

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

  it('panel handler is a no-op when a modifier key (Cmd/Ctrl/Alt) is held', () => {
    // Modifier+arrow combinations are owned by other key rules (e.g.
    // Cmd+Arrow z-order in interactions/keyboard.ts). The panel must
    // bail so those keep working when the panel happens to have focus.
    const { panel, store, editor } = makeFixture();
    mountThumbnailPanel(panel, store, editor);
    const slideIds = store.read().slides.map((s) => s.id);
    const event = new KeyboardEvent('keydown', {
      key: 'ArrowDown',
      metaKey: true,
      bubbles: true,
      cancelable: true,
    });
    panel.dispatchEvent(event);
    expect(editor.getCurrentSlideId()).toBe(slideIds[0]);
    expect(event.defaultPrevented).toBe(false);
  });

  it('panel handler defers to the canvas nudge rule when an element is selected', () => {
    // Clicking a thumbnail focuses the panel; clicking a canvas element
    // afterwards leaves focus on the panel (the canvas isn't focusable).
    // ArrowUp/Down would then steal the user's element-nudge — we must
    // bail when getSelection() is non-empty so the document-level rule
    // can run.
    const { panel, store, editor } = makeFixture();
    mountThumbnailPanel(panel, store, editor);
    const slideIds = store.read().slides.map((s) => s.id);
    // Add an element so we have something to "select".
    let elementId = '';
    store.batch(() => {
      elementId = store.addElement(slideIds[0], {
        type: 'shape',
        frame: { x: 100, y: 100, w: 200, h: 100, rotation: 0 },
        data: { kind: 'rect', fill: { kind: 'srgb' as const, value: '#abc' } },
      });
    });
    editor.setSelection([elementId]);
    // Dispatch on `panel` (target=panel). The panel listener fires
    // first (and must bail); the bubble to `document` reaches the
    // editor's keyRules where the canvas-nudge rule matches.
    const event = new KeyboardEvent('keydown', {
      key: 'ArrowDown',
      bubbles: true,
      cancelable: true,
    });
    panel.dispatchEvent(event);

    // Panel handler bailed → current slide unchanged, selection
    // preserved. The element-nudge rule consumed the event downstream.
    expect(editor.getCurrentSlideId()).toBe(slideIds[0]);
    expect(editor.getSelection()).toEqual([elementId]);
    const movedY = store.read().slides[0].elements[0].frame.y;
    expect(movedY).toBeGreaterThan(100);
  });

  it('ArrowDown calls preventDefault on a successful move (blocks default page scroll)', () => {
    const { panel, store, editor } = makeFixture();
    mountThumbnailPanel(panel, store, editor);
    const event = new KeyboardEvent('keydown', {
      key: 'ArrowDown',
      bubbles: true,
      cancelable: true,
    });
    panel.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
  });

  it('clicking a thumbnail focuses the panel so subsequent arrow keys route here', () => {
    const { panel, store, editor } = makeFixture();
    mountThumbnailPanel(panel, store, editor);
    const slideIds = store.read().slides.map((s) => s.id);
    const second = panel.querySelector<HTMLDivElement>(
      `[data-slide-id="${slideIds[1]}"]`,
    )!;
    second.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    expect(document.activeElement).toBe(panel);
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
    second.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, shiftKey: true }));
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
    first.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, shiftKey: true }));
    second.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, shiftKey: true }));
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
    first.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, shiftKey: true }));
    second.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, shiftKey: true }));
    expect(handle.getSelectedSlideIds()).toHaveLength(2);
    rightClick(second);
    const changeItem = Array.from(
      document.body.querySelectorAll<HTMLLIElement>('.wfb-slides-context-menu li'),
    ).find((li) => li.textContent === 'Change layout…')!;
    expect(changeItem.style.opacity).toBe('0.5');
  });
});

// Lazy paint via IntersectionObserver. jsdom doesn't ship the global, so
// the panel's default path is the "paint everything" fallback. To exercise
// the lazy branch we stub a controllable IO that captures observed
// elements and lets the test drive `isIntersecting` per-id.
describe('mountThumbnailPanel — IntersectionObserver lazy paint', () => {
  type MockEntry = { isIntersecting: boolean; target: Element };
  type MockCallback = (entries: MockEntry[]) => void;
  let activeCb: MockCallback | null = null;
  let observed: Element[] = [];

  class MockIntersectionObserver {
    constructor(cb: MockCallback) { activeCb = cb; }
    observe(el: Element): void { observed.push(el); }
    unobserve(el: Element): void {
      observed = observed.filter((o) => o !== el);
    }
    disconnect(): void { observed = []; activeCb = null; }
    takeRecords(): MockEntry[] { return []; }
  }

  beforeEach(() => {
    activeCb = null;
    observed = [];
    vi.stubGlobal('IntersectionObserver', MockIntersectionObserver);
  });
  afterEach(() => { vi.unstubAllGlobals(); });

  it('does not paint a thumb until the observer reports it as intersecting', () => {
    const { panel, store, editor } = makeFixture();
    // Two slides; observe both via the mock.
    mountThumbnailPanel(panel, store, editor);
    const slideIds = store.read().slides.map((s) => s.id);

    // Both items were observed but neither painted yet — the mock's
    // constructor capture means we control all paint timing.
    expect(observed).toHaveLength(2);
    const canvasFor = (id: string): HTMLCanvasElement =>
      panel.querySelector<HTMLCanvasElement>(
        `[data-slide-id="${id}"] canvas`,
      )!;
    expect(canvasFor(slideIds[0]).dataset.paintCount).toBeUndefined();
    expect(canvasFor(slideIds[1]).dataset.paintCount).toBeUndefined();

    // Fire intersection for slide 0 only.
    const item0 = panel.querySelector<HTMLElement>(
      `[data-slide-id="${slideIds[0]}"]`,
    )!;
    activeCb!([{ isIntersecting: true, target: item0 }]);
    expect(canvasFor(slideIds[0]).dataset.paintCount).toBe('1');
    expect(canvasFor(slideIds[1]).dataset.paintCount).toBeUndefined();

    // Now reveal slide 1 — only it paints, slide 0 stays at one paint.
    const item1 = panel.querySelector<HTMLElement>(
      `[data-slide-id="${slideIds[1]}"]`,
    )!;
    activeCb!([{ isIntersecting: true, target: item1 }]);
    expect(canvasFor(slideIds[0]).dataset.paintCount).toBe('1');
    expect(canvasFor(slideIds[1]).dataset.paintCount).toBe('1');
  });

  it('does not repaint a thumb that has already been painted once', () => {
    const { panel, store, editor } = makeFixture();
    mountThumbnailPanel(panel, store, editor);
    const slideId = store.read().slides[0].id;
    const item = panel.querySelector<HTMLElement>(
      `[data-slide-id="${slideId}"]`,
    )!;
    const canvas = panel.querySelector<HTMLCanvasElement>(
      `[data-slide-id="${slideId}"] canvas`,
    )!;
    activeCb!([{ isIntersecting: true, target: item }]);
    expect(canvas.dataset.paintCount).toBe('1');
    // Scrolling the thumb out and back in (the observer would fire two
    // more entries) must not redo the paint — the bitmap is still valid.
    activeCb!([{ isIntersecting: false, target: item }]);
    activeCb!([{ isIntersecting: true, target: item }]);
    expect(canvas.dataset.paintCount).toBe('1');
  });

  it('dispose disconnects the observer and clears the observed list', () => {
    const { panel, store, editor } = makeFixture();
    const handle = mountThumbnailPanel(panel, store, editor);
    expect(observed.length).toBeGreaterThan(0);
    handle.dispose();
    expect(observed).toHaveLength(0);
  });

  it('refreshContent repaints painted thumbs without rebuilding DOM (no flicker on content edit)', () => {
    // refreshContent routes through ThumbnailScheduler so a burst of
    // store.onChange events coalesces into one paint per thumb. Use
    // fake timers to assert the scheduled paint deterministically.
    vi.useFakeTimers();
    try {
      const { panel, store, editor } = makeFixture();
      const handle = mountThumbnailPanel(panel, store, editor);
      const slideIds = store.read().slides.map((s) => s.id);

      // Paint slide 0; leave slide 1 unpainted (offscreen).
      const item0 = panel.querySelector<HTMLElement>(
        `[data-slide-id="${slideIds[0]}"]`,
      )!;
      activeCb!([{ isIntersecting: true, target: item0 }]);
      const canvas0 = panel.querySelector<HTMLCanvasElement>(
        `[data-slide-id="${slideIds[0]}"] canvas`,
      )!;
      const canvas1 = panel.querySelector<HTMLCanvasElement>(
        `[data-slide-id="${slideIds[1]}"] canvas`,
      )!;
      expect(canvas0.dataset.paintCount).toBe('1');
      expect(canvas1.dataset.paintCount).toBeUndefined();

      // Simulate a content edit on slide 0.
      store.batch(() => {
        store.updateSlideBackground(slideIds[0], {
          fill: { kind: 'srgb', value: '#abcdef' },
        });
      });
      handle.refreshContent();
      // Scheduler is debouncing — no repaint yet.
      expect(canvas0.dataset.paintCount).toBe('1');
      vi.advanceTimersByTime(200);

      // Slide 0 was painted → repainted once more. Slide 1 was unpainted
      // → stays unpainted (will pick up the new content when scrolled
      // into view). Crucially, the DOM elements are the SAME nodes (no
      // wipe + rebuild), so there's no blank-frame flicker.
      expect(canvas0.dataset.paintCount).toBe('2');
      expect(canvas1.dataset.paintCount).toBeUndefined();
      expect(
        panel.querySelector<HTMLElement>(`[data-slide-id="${slideIds[0]}"] canvas`),
      ).toBe(canvas0);
      expect(
        panel.querySelector<HTMLElement>(`[data-slide-id="${slideIds[1]}"] canvas`),
      ).toBe(canvas1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('refreshContent falls back to structural render() when slide order diverges (remote reorder)', () => {
    const { panel, store, editor } = makeFixture();
    const handle = mountThumbnailPanel(panel, store, editor);
    const before = store.read().slides.map((s) => s.id);
    expect(before).toHaveLength(2);

    // Simulate a remote reorder: same slide ids, swapped positions.
    store.batch(() => {
      store.moveSlide(before[1], 0);
    });
    // refreshContent must detect the order divergence and rebuild.
    handle.refreshContent();
    const after = Array.from(
      panel.querySelectorAll<HTMLElement>('[data-slide-id]'),
    ).map((el) => el.dataset.slideId!);
    expect(after).toEqual([before[1], before[0]]);
  });

  it('refreshContent is a no-op when state is empty (called before first render)', () => {
    const { panel, store, editor } = makeFixture();
    const handle = mountThumbnailPanel(panel, store, editor);
    handle.dispose();
    // After dispose, state is cleared. refreshContent must not throw.
    expect(() => handle.refreshContent()).not.toThrow();
  });

  it('switching the current slide updates the highlight without repainting canvases', () => {
    const { panel, store, editor } = makeFixture();
    mountThumbnailPanel(panel, store, editor);
    const slideIds = store.read().slides.map((s) => s.id);

    // Paint both thumbs by firing intersection for each.
    for (const id of slideIds) {
      const item = panel.querySelector<HTMLElement>(`[data-slide-id="${id}"]`)!;
      activeCb!([{ isIntersecting: true, target: item }]);
    }
    const canvasFor = (id: string): HTMLCanvasElement =>
      panel.querySelector<HTMLCanvasElement>(
        `[data-slide-id="${id}"] canvas`,
      )!;
    expect(canvasFor(slideIds[0]).dataset.paintCount).toBe('1');
    expect(canvasFor(slideIds[1]).dataset.paintCount).toBe('1');

    // Click the second thumb to switch current.
    panel
      .querySelector<HTMLElement>(`[data-slide-id="${slideIds[1]}"]`)!
      .dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));

    // Highlight has moved.
    expect(
      panel.querySelector<HTMLElement>(`[data-slide-id="${slideIds[0]}"]`)!.classList.contains('current'),
    ).toBe(false);
    expect(
      panel.querySelector<HTMLElement>(`[data-slide-id="${slideIds[1]}"]`)!.classList.contains('current'),
    ).toBe(true);
    // But paint counts haven't budged — the canvases were left intact.
    expect(canvasFor(slideIds[0]).dataset.paintCount).toBe('1');
    expect(canvasFor(slideIds[1]).dataset.paintCount).toBe('1');
  });
});

// Async-image background flow: a slide whose background image is still
// loading when the first paint happens. The renderer's onAssetLoad fires
// once the image cache resolves — the panel must coalesce that signal
// via ThumbnailScheduler into a second paint of the same canvas.
describe('mountThumbnailPanel — async image-background repaint', () => {
  class FakeImage {
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    complete = false;
    naturalWidth = 100;
    naturalHeight = 80;
    private _src = '';
    get src(): string { return this._src; }
    set src(value: string) {
      this._src = value;
      // queueMicrotask flips complete + fires onload on the next
      // microtask, mirroring the slide-renderer.test pattern.
      queueMicrotask(() => {
        this.complete = true;
        this.onload?.();
      });
    }
  }

  type MockEntry = { isIntersecting: boolean; target: Element };
  type MockCallback = (entries: MockEntry[]) => void;
  let activeCb: MockCallback | null = null;
  let observed: Element[] = [];

  class MockIntersectionObserver {
    constructor(cb: MockCallback) { activeCb = cb; }
    observe(el: Element): void { observed.push(el); }
    unobserve(el: Element): void {
      observed = observed.filter((o) => o !== el);
    }
    disconnect(): void { observed = []; activeCb = null; }
    takeRecords(): MockEntry[] { return []; }
  }

  beforeEach(() => {
    activeCb = null;
    observed = [];
    vi.useFakeTimers();
    vi.stubGlobal('Image', FakeImage);
    vi.stubGlobal('IntersectionObserver', MockIntersectionObserver);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
    clearImageCacheForTests();
  });

  it('repaints a thumb after its background image finishes loading', async () => {
    const { panel, store, editor } = makeFixture();
    // Re-create the deck so the first slide has a background image.
    const blank = store.read().slides[0].id;
    const second = store.read().slides[1].id;
    store.batch(() => {
      store.removeSlide(blank);
      store.removeSlide(second);
      const id = store.addSlide('blank');
      store.updateSlideBackground(id, {
        fill: { kind: 'srgb', value: '#fff' },
        image: { src: 'panel-bg.png' },
      });
    });
    mountThumbnailPanel(panel, store, editor);
    const slideId = store.read().slides[0].id;
    const item = panel.querySelector<HTMLElement>(
      `[data-slide-id="${slideId}"]`,
    )!;
    const canvas = panel.querySelector<HTMLCanvasElement>(
      `[data-slide-id="${slideId}"] canvas`,
    )!;
    // First paint: image-cache still resolving → drawImage no-op,
    // onAssetLoad subscribed.
    activeCb!([{ isIntersecting: true, target: item }]);
    expect(canvas.dataset.paintCount).toBe('1');

    // Let the FakeImage onload fire. Microtasks run synchronously under
    // vi.useFakeTimers without needing advanceTimersByTime.
    await Promise.resolve();
    // The scheduler is debouncing now — no repaint yet.
    expect(canvas.dataset.paintCount).toBe('1');

    // Advance past the scheduler debounce window — repaint fires.
    vi.advanceTimersByTime(200);
    expect(canvas.dataset.paintCount).toBe('2');
  });

  it('does not repaint after dispose, even if an image load is still in flight', async () => {
    const { panel, store, editor } = makeFixture();
    const blank = store.read().slides[0].id;
    const second = store.read().slides[1].id;
    store.batch(() => {
      store.removeSlide(blank);
      store.removeSlide(second);
      const id = store.addSlide('blank');
      store.updateSlideBackground(id, {
        fill: { kind: 'srgb', value: '#fff' },
        image: { src: 'panel-bg-2.png' },
      });
    });
    const handle = mountThumbnailPanel(panel, store, editor);
    const slideId = store.read().slides[0].id;
    const item = panel.querySelector<HTMLElement>(
      `[data-slide-id="${slideId}"]`,
    )!;
    const canvas = panel.querySelector<HTMLCanvasElement>(
      `[data-slide-id="${slideId}"] canvas`,
    )!;
    activeCb!([{ isIntersecting: true, target: item }]);
    expect(canvas.dataset.paintCount).toBe('1');
    handle.dispose();
    await Promise.resolve();
    vi.advanceTimersByTime(500);
    // No second paint — scheduler bails out on the `disposed` flag.
    expect(canvas.dataset.paintCount).toBe('1');
  });
});

// Chunked DOM construction for big decks. The first chunk runs
// synchronously inside mount(); the rest are deferred via rAF so the
// main thread doesn't block while building hundreds of items.
describe('mountThumbnailPanel — chunked render for large decks', () => {
  // Stubbed rAF queue so the test drives chunk-by-chunk progress
  // deterministically. jsdom does ship a rAF that defers via timers,
  // but capturing the callback directly lets us assert "exactly one
  // chunk has been built so far" without time-advancing heuristics.
  let rafQueue: Array<{ id: number; cb: () => void }> = [];
  let nextRafId = 1;
  const flushOneRAF = (): void => {
    const next = rafQueue.shift();
    if (next) next.cb();
  };

  beforeEach(() => {
    rafQueue = [];
    nextRafId = 1;
    vi.stubGlobal('requestAnimationFrame', (cb: () => void) => {
      const id = nextRafId++;
      rafQueue.push({ id, cb });
      return id;
    });
    vi.stubGlobal('cancelAnimationFrame', (id: number) => {
      rafQueue = rafQueue.filter((e) => e.id !== id);
    });
  });
  afterEach(() => { vi.unstubAllGlobals(); });

  const makeBigDeck = (n: number): ReturnType<typeof makeFixture> => {
    const fx = makeFixture();
    fx.store.batch(() => {
      for (let i = 0; i < n - 2; i++) fx.store.addSlide('blank');
    });
    return fx;
  };

  it('builds only the first chunk synchronously; remaining slides land via rAF', () => {
    const { panel, store, editor } = makeBigDeck(35);
    mountThumbnailPanel(panel, store, editor);
    // First chunk only — 20 by RENDER_CHUNK_SIZE.
    expect(panel.querySelectorAll('[data-slide-id]')).toHaveLength(20);
    expect(rafQueue).toHaveLength(1);

    // Second chunk lands.
    flushOneRAF();
    expect(panel.querySelectorAll('[data-slide-id]').length).toBe(35);
    // Build is done — no more pending chunks.
    expect(rafQueue).toHaveLength(0);
  });

  it('a follow-up render() during chunking discards items the stale generation would have appended', () => {
    // Mount 60 slides → first chunk builds 20, 40 pending. Then remove
    // 20 slides from the deck and call refresh(). If the stale token's
    // pending chunks leaked through, the DOM would end up with > 40
    // items (or duplicates / removed-slide ids). Token-guarded code
    // bails them out, leaving exactly the new generation's 40.
    const { panel, store, editor } = makeBigDeck(60);
    const handle = mountThumbnailPanel(panel, store, editor);
    expect(panel.querySelectorAll('[data-slide-id]').length).toBe(20);
    expect(rafQueue.length).toBeGreaterThan(0);
    const beforeIds = store.read().slides.map((s) => s.id);

    // Shrink the deck before any further chunks land.
    store.batch(() => {
      for (let i = 0; i < 20; i++) store.removeSlide(beforeIds[i]);
    });
    handle.refresh();
    // The new render's first chunk built; old chunks still queued (and
    // freshly queued for the new generation).
    while (rafQueue.length) flushOneRAF();

    const ids = Array.from(
      panel.querySelectorAll<HTMLElement>('[data-slide-id]'),
    ).map((el) => el.dataset.slideId!);
    const remaining = store.read().slides.map((s) => s.id);
    // The DOM exactly matches the post-shrink store — no stale items.
    expect(ids).toEqual(remaining);
    // And contains none of the removed slide ids.
    const removed = beforeIds.slice(0, 20);
    for (const id of removed) expect(ids).not.toContain(id);
  });

  it('dispose during chunking cancels pending chunks without painting more items', () => {
    const { panel, store, editor } = makeBigDeck(40);
    const handle = mountThumbnailPanel(panel, store, editor);
    expect(panel.querySelectorAll('[data-slide-id]').length).toBe(20);
    handle.dispose();
    // Even if a stale rAF entry escaped cancelAnimationFrame (e.g. via
    // a polyfill quirk), the token + disposed guard inside buildChunk
    // keeps it from appending more.
    while (rafQueue.length) flushOneRAF();
    // The DOM is left as-is by dispose (per the existing handle
    // contract that says "DOM is left in place"), so the partial 20
    // items remain — but nothing further was appended.
    expect(panel.querySelectorAll('[data-slide-id]').length).toBe(20);
  });
});
