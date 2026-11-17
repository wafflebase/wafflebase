// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import '../../../src/view/canvas/test-canvas-env';
import { MemSlidesStore } from '../../../src/store/memory';
import { initialize, type SlidesEditor } from '../../../src/view/editor/editor';
import { drawSlide, SlideRenderer } from '../../../src/view/canvas/slide-renderer';

/**
 * The editor host options the board's sections are built on. Each one is
 * a no-op when omitted, which the "Slides default" cases pin down.
 */

vi.mock('../../../src/view/editor/layout-picker', () => ({
  showLayoutPicker: vi.fn(),
}));

function makeFixture() {
  const canvas = document.createElement('canvas');
  canvas.width = 1920;
  canvas.height = 1080;
  const overlay = document.createElement('div');
  overlay.style.position = 'absolute';
  document.body.appendChild(canvas);
  document.body.appendChild(overlay);
  const store = new MemSlidesStore();
  store.batch(() => store.addSlide('blank'));
  return { canvas, overlay, store };
}

function addRect(
  store: MemSlidesStore,
  x: number,
  y: number,
  w: number,
  h: number,
): string {
  let id = '';
  store.batch(() => {
    const sid = store.read().slides[0].id;
    id = store.addElement(sid, {
      type: 'shape',
      frame: { x, y, w, h, rotation: 0 },
      data: { kind: 'rect', fill: { kind: 'srgb' as const, value: '#abc' } },
    });
  });
  return id;
}

const frameOf = (store: MemSlidesStore, id: string) =>
  store.read().slides[0].elements.find((e) => e.id === id)!.frame;

function drag(canvas: HTMLCanvasElement, from: [number, number], to: [number, number]) {
  canvas.dispatchEvent(new PointerEvent('pointerdown', {
    clientX: from[0], clientY: from[1], bubbles: true,
  }));
  document.dispatchEvent(new PointerEvent('pointermove', {
    clientX: to[0], clientY: to[1], bubbles: true,
  }));
  document.dispatchEvent(new PointerEvent('pointerup', {
    clientX: to[0], clientY: to[1], bubbles: true,
  }));
}

describe('section host options', () => {
  let editor: SlidesEditor | null = null;

  beforeEach(() => {
    document.body.innerHTML = '';
    if (editor) {
      editor.detach();
      editor = null;
    }
  });

  describe('getCompanionMoveIds', () => {
    it('moves companions with a drag, in one undo step', () => {
      const { canvas, overlay, store } = makeFixture();
      const outer = addRect(store, 100, 100, 600, 400);
      const inner = addRect(store, 1000, 800, 50, 50);
      const companions = vi.fn((_ids: readonly string[], _slide: unknown) => [inner]);
      editor = initialize({
        canvas, overlay, store, hostWidth: 1920, hostHeight: 1080, dpr: 1,
        getCompanionMoveIds: companions,
      });
      // Grab the outer rect away from the inner one.
      drag(canvas, [150, 150], [253, 247]);
      const o = frameOf(store, outer);
      const i = frameOf(store, inner);
      // Same delta on both, whatever snapping settled on.
      expect(i.x - 1000).toBe(o.x - 100);
      expect(i.y - 800).toBe(o.y - 100);
      expect(o.x).not.toBe(100);
      expect(companions).toHaveBeenCalledWith([outer], expect.anything());
      // Only the selection is selected: companions ride along unselected.
      expect(editor.getSelection()).toEqual([outer]);
      store.undo();
      expect(frameOf(store, outer).x).toBe(100);
      expect(frameOf(store, inner).x).toBe(1000);
    });

    it('ghosts no companion the host marks unselectable (hidden contents)', () => {
      const { canvas, overlay, store } = makeFixture();
      addRect(store, 100, 100, 600, 400);
      const shown = addRect(store, 1000, 800, 50, 50);
      const covered = addRect(store, 1200, 800, 50, 50);
      editor = initialize({
        canvas, overlay, store, hostWidth: 1920, hostHeight: 1080, dpr: 1,
        getCompanionMoveIds: () => [shown, covered],
        getUnselectableIds: () => new Set([covered]),
      });
      const spy = vi.spyOn(SlideRenderer.prototype, 'forceRender');
      canvas.dispatchEvent(new PointerEvent('pointerdown', { clientX: 150, clientY: 150, bubbles: true }));
      document.dispatchEvent(new PointerEvent('pointermove', { clientX: 250, clientY: 250, bubbles: true }));
      const ghostIds = (spy.mock.calls.at(-1)?.[2] ?? []).map((g) => g.id);
      document.dispatchEvent(new PointerEvent('pointerup', { clientX: 250, clientY: 250, bubbles: true }));
      spy.mockRestore();
      expect(ghostIds).toContain(shown);
      expect(ghostIds).not.toContain(covered);
      // It still moves.
      expect(frameOf(store, covered).x).not.toBe(1200);
    });

    it('nudges companions with an arrow key', () => {
      const { canvas, overlay, store } = makeFixture();
      const outer = addRect(store, 100, 100, 600, 400);
      const inner = addRect(store, 1000, 800, 50, 50);
      editor = initialize({
        canvas, overlay, store, hostWidth: 1920, hostHeight: 1080, dpr: 1,
        getCompanionMoveIds: () => [inner],
      });
      editor.setSelection([outer]);
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
      expect(frameOf(store, outer).x).toBe(101);
      expect(frameOf(store, inner).x).toBe(1001);
    });

    it('Slides default: a drag moves only the selection', () => {
      const { canvas, overlay, store } = makeFixture();
      addRect(store, 100, 100, 600, 400);
      const other = addRect(store, 1000, 800, 50, 50);
      editor = initialize({ canvas, overlay, store, hostWidth: 1920, hostHeight: 1080, dpr: 1 });
      drag(canvas, [150, 150], [253, 247]);
      expect(frameOf(store, other).x).toBe(1000);
    });
  });

  describe('getUnselectableIds', () => {
    it('lets a click pass through to what is underneath', () => {
      const { canvas, overlay, store } = makeFixture();
      const below = addRect(store, 100, 100, 400, 400);
      const locked = addRect(store, 150, 150, 100, 100);
      editor = initialize({
        canvas, overlay, store, hostWidth: 1920, hostHeight: 1080, dpr: 1,
        getUnselectableIds: () => new Set([locked]),
      });
      canvas.dispatchEvent(new PointerEvent('pointerdown', {
        clientX: 200, clientY: 200, bubbles: true,
      }));
      expect(editor.getSelection()).toEqual([below]);
      expect(editor.hasContentAt(200, 200)).toBe(true);
    });

    it('keeps the element out of Mod+A and a lasso', () => {
      const { canvas, overlay, store } = makeFixture();
      const a = addRect(store, 100, 100, 50, 50);
      const locked = addRect(store, 300, 100, 50, 50);
      editor = initialize({
        canvas, overlay, store, hostWidth: 1920, hostHeight: 1080, dpr: 1,
        getUnselectableIds: () => new Set([locked]),
      });
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', metaKey: true, bubbles: true }));
      expect(editor.getSelection()).toEqual([a]);
      editor.setSelection([]);
      drag(canvas, [50, 50], [500, 300]);
      expect(editor.getSelection()).toEqual([a]);
    });
  });

  describe('filterLassoSelection', () => {
    it('has the final say over a lasso', () => {
      const { canvas, overlay, store } = makeFixture();
      const a = addRect(store, 100, 100, 50, 50);
      const b = addRect(store, 300, 100, 50, 50);
      const filter = vi.fn(
        (ids: readonly string[], _slide: unknown, _rect: { x: number; y: number; w: number; h: number }) =>
          ids.filter((id) => id !== b),
      );
      editor = initialize({
        canvas, overlay, store, hostWidth: 1920, hostHeight: 1080, dpr: 1,
        filterLassoSelection: filter,
      });
      drag(canvas, [50, 50], [500, 300]);
      expect(editor.getSelection()).toEqual([a]);
      const rect = filter.mock.calls[0][2];
      expect(rect).toMatchObject({ x: 50, y: 50, w: 450, h: 250 });
    });
  });

  describe('interceptTextEdit', () => {
    it('claims a double-click text edit', () => {
      const { canvas, overlay, store } = makeFixture();
      const id = addRect(store, 100, 100, 200, 200);
      const intercept = vi.fn((_el: unknown, _text?: string) => true);
      editor = initialize({
        canvas, overlay, store, hostWidth: 1920, hostHeight: 1080, dpr: 1,
        interceptTextEdit: intercept,
      });
      canvas.dispatchEvent(new PointerEvent('pointerdown', {
        clientX: 200, clientY: 200, bubbles: true,
      }));
      canvas.dispatchEvent(new MouseEvent('dblclick', {
        clientX: 200, clientY: 200, bubbles: true,
      }));
      expect(intercept).toHaveBeenCalledWith(expect.objectContaining({ id }), undefined);
      expect(editor.isTextEditing()).toBe(false);
    });

    it('passes the typed character of type-to-edit', () => {
      const { canvas, overlay, store } = makeFixture();
      const id = addRect(store, 100, 100, 200, 200);
      const intercept = vi.fn((_el: unknown, _text?: string) => true);
      editor = initialize({
        canvas, overlay, store, hostWidth: 1920, hostHeight: 1080, dpr: 1,
        interceptTextEdit: intercept,
      });
      editor.setSelection([id]);
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'q', bubbles: true }));
      expect(intercept).toHaveBeenCalledWith(expect.objectContaining({ id }), 'q');
      expect(editor.isTextEditing()).toBe(false);
    });
  });

  describe('hostElementMenuItems', () => {
    it('appends host entries to an element menu', () => {
      const { canvas, overlay, store } = makeFixture();
      const id = addRect(store, 100, 100, 200, 200);
      const run = vi.fn();
      const items = vi.fn((_ids: readonly string[]) => [{ label: 'Hide section', run }]);
      editor = initialize({
        canvas, overlay, store, hostWidth: 1920, hostHeight: 1080, dpr: 1,
        hostElementMenuItems: items,
      });
      canvas.dispatchEvent(new MouseEvent('contextmenu', {
        clientX: 200, clientY: 200, bubbles: true, cancelable: true,
      }));
      expect(items).toHaveBeenCalledWith([id]);
      const menu = document.querySelector('.wfb-slides-context-menu') as HTMLElement;
      const li = [...menu.querySelectorAll('li')].find((l) =>
        l.textContent?.includes('Hide section'),
      ) as HTMLElement;
      li.click();
      expect(run).toHaveBeenCalledTimes(1);
    });

    it('hands the clicked point to empty-canvas host items', () => {
      const { canvas, overlay, store } = makeFixture();
      const items = vi.fn((_at: { x: number; y: number }) => []);
      editor = initialize({
        canvas, overlay, store, hostWidth: 1920, hostHeight: 1080, dpr: 1,
        hostCanvasMenuItems: items,
      });
      canvas.dispatchEvent(new MouseEvent('contextmenu', {
        clientX: 70, clientY: 40, bubbles: true, cancelable: true,
      }));
      expect(items).toHaveBeenCalledWith({ x: 70, y: 40 });
    });
  });

  describe('paintAfterElements', () => {
    it('runs after the elements, with the slide and document', () => {
      const { store } = makeFixture();
      addRect(store, 100, 100, 200, 200);
      const doc = store.read();
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d')!;
      const paint = vi.fn();
      drawSlide(ctx, doc.slides[0], doc, {
        hostWidth: 1920, hostHeight: 1080, dpr: 1,
        paintAfterElements: paint,
      });
      expect(paint).toHaveBeenCalledWith(ctx, doc.slides[0], doc);
    });
  });
});
