// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import '../canvas/test-canvas-env';
import { MemSlidesStore } from '../../store/memory';
import { initialize } from './editor';
import { mountThumbnailPanel } from './thumbnail-panel';

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

  it('"+" button appends a new slide', () => {
    const { panel, store, editor } = makeFixture();
    mountThumbnailPanel(panel, store, editor);
    const before = store.read().slides.length;
    const addBtn = panel.querySelector('button')!;
    addBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(store.read().slides.length).toBe(before + 1);
    // Panel re-rendered to reflect the new slide.
    expect(panel.querySelectorAll('[data-slide-id]')).toHaveLength(before + 1);
  });

  it('dispose detaches editor selection subscription', () => {
    const { panel, store, editor } = makeFixture();
    const handle = mountThumbnailPanel(panel, store, editor);
    expect(() => handle.dispose()).not.toThrow();
  });
});
