// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import '../../../src/view/canvas/test-canvas-env';
import { MemSlidesStore } from '../../../src/store/memory';
import { initialize, type SlidesEditor } from '../../../src/view/editor/editor';
import type { Element } from '../../../src/model/element';

let editor: SlidesEditor | null = null;
afterEach(() => {
  editor?.detach();
  editor = null;
  document.body.innerHTML = '';
});

/** A 100×100 square selected on a 1920-wide host (overlay px == logical px). */
function mount(lockAspectRatio?: (el: Element) => boolean) {
  const canvas = document.createElement('canvas');
  const overlay = document.createElement('div');
  overlay.style.position = 'absolute';
  document.body.append(canvas, overlay);
  const store = new MemSlidesStore();
  let id = '';
  store.batch(() => {
    const sid = store.addSlide('blank');
    id = store.addElement(sid, {
      type: 'shape',
      frame: { x: 0, y: 0, w: 100, h: 100, rotation: 0 },
      data: { kind: 'rect', fill: { kind: 'srgb' as const, value: '#abc' } },
    });
  });
  editor = initialize({
    canvas, overlay, store, hostWidth: 1920, hostHeight: 1080, dpr: 1,
    lockAspectRatio,
  });
  editor.setSelection([id]);
  return { canvas, overlay, store, id };
}

/** Drag the SE handle by (dx, dy) client px. */
function dragSe(canvas: HTMLCanvasElement, overlay: HTMLDivElement, dx: number, dy: number) {
  const handle = overlay.querySelector<HTMLDivElement>('[data-handle="se"]')!;
  const x = parseFloat(handle.style.left) + 4;
  const y = parseFloat(handle.style.top) + 4;
  canvas.dispatchEvent(new PointerEvent('pointerdown', { clientX: x, clientY: y, bubbles: true }));
  document.dispatchEvent(new PointerEvent('pointermove', { clientX: x + dx, clientY: y + dy, bubbles: true }));
  document.dispatchEvent(new PointerEvent('pointerup', { clientX: x + dx, clientY: y + dy, bubbles: true }));
}

describe('lockAspectRatio', () => {
  it('keeps a locked element square on a corner drag without Shift', () => {
    const { canvas, overlay, store } = mount(() => true);
    dragSe(canvas, overlay, 80, 20);
    const f = store.read().slides[0].elements[0].frame;
    expect(f.w).toBeCloseTo(180, 3);
    expect(f.h).toBeCloseTo(180, 3);
  });

  it('is off by default: a corner drag resizes freely', () => {
    const { canvas, overlay, store } = mount();
    dragSe(canvas, overlay, 80, 20);
    const f = store.read().slides[0].elements[0].frame;
    expect(f.w).toBeCloseTo(180, 3);
    expect(f.h).toBeCloseTo(120, 3);
  });

  it('asks per element: a host that declines leaves the drag free', () => {
    const { canvas, overlay, store } = mount(() => false);
    dragSe(canvas, overlay, 80, 20);
    expect(store.read().slides[0].elements[0].frame.h).toBeCloseTo(120, 3);
  });
});
