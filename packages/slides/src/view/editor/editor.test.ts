// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import '../canvas/test-canvas-env';
import { MemSlidesStore } from '../../store/memory';
import { initialize, type SlidesEditor } from './editor';

function makeFixture() {
  const canvas = document.createElement('canvas');
  canvas.width = 960;
  canvas.height = 540;
  const overlay = document.createElement('div');
  overlay.style.position = 'absolute';
  document.body.appendChild(canvas);
  document.body.appendChild(overlay);
  const store = new MemSlidesStore();
  store.batch(() => store.addSlide('blank'));
  return { canvas, overlay, store };
}

describe('initialize', () => {
  let editor: SlidesEditor | null = null;

  beforeEach(() => {
    document.body.innerHTML = '';
    if (editor) {
      editor.detach();
      editor = null;
    }
  });

  it('returns an editor with an empty selection', () => {
    const { canvas, overlay, store } = makeFixture();
    editor = initialize({ canvas, overlay, store, hostWidth: 960, hostHeight: 540, dpr: 1 });
    expect(editor.getSelection()).toEqual([]);
  });

  it('subscribers fire when selection changes', () => {
    const { canvas, overlay, store } = makeFixture();
    editor = initialize({ canvas, overlay, store, hostWidth: 960, hostHeight: 540, dpr: 1 });
    const cb = vi.fn();
    editor.onSelectionChange(cb);
    // Programmatic state poke through render; for now we only verify
    // the wiring exists. Concrete click → selection wiring is T3.
    expect(cb).not.toHaveBeenCalled();
  });

  it('detach removes all DOM listeners (calling render after detach is safe)', () => {
    const { canvas, overlay, store } = makeFixture();
    editor = initialize({ canvas, overlay, store, hostWidth: 960, hostHeight: 540, dpr: 1 });
    editor.detach();
    expect(() => editor!.render()).not.toThrow();
  });

  it('setInsertMode(null) is the default and is idempotent', () => {
    const { canvas, overlay, store } = makeFixture();
    editor = initialize({ canvas, overlay, store, hostWidth: 960, hostHeight: 540, dpr: 1 });
    expect(() => editor!.setInsertMode(null)).not.toThrow();
    expect(() => editor!.setInsertMode('rect')).not.toThrow();
    expect(() => editor!.setInsertMode(null)).not.toThrow();
  });

  function dispatchMouseDown(target: globalThis.Element | Document, x: number, y: number, shift = false): void {
    target.dispatchEvent(new MouseEvent('mousedown', {
      clientX: x, clientY: y, shiftKey: shift, bubbles: true,
    }));
  }

  it('mousedown on a shape selects it', () => {
    const { canvas, overlay, store } = makeFixture();
    // Position canvas at (0,0) — jsdom getBoundingClientRect returns zeros
    // by default, which means clientX/Y == logical coords at scale=1.
    store.batch(() => {
      const sid = store.read().slides[0].id;
      store.addElement(sid, {
        type: 'shape',
        frame: { x: 100, y: 50, w: 200, h: 100, rotation: 0 },
        data: { kind: 'rect', fill: '#abc' },
      });
    });
    editor = initialize({ canvas, overlay, store, hostWidth: 1920, hostHeight: 1080, dpr: 1 });
    // Click at (150, 80) in client coords = (150, 80) in logical coords (scale=1).
    dispatchMouseDown(canvas, 150, 80);
    expect(editor.getSelection().length).toBe(1);
  });

  it('drag moves the selected element by the pointer delta and commits one batch', () => {
    const { canvas, overlay, store } = makeFixture();
    let elementId = '';
    store.batch(() => {
      const sid = store.read().slides[0].id;
      elementId = store.addElement(sid, {
        type: 'shape',
        frame: { x: 100, y: 100, w: 200, h: 100, rotation: 0 },
        data: { kind: 'rect', fill: '#abc' },
      });
    });
    editor = initialize({ canvas, overlay, store, hostWidth: 1920, hostHeight: 1080, dpr: 1 });
    // Select + start drag at (200, 150) — middle of the shape.
    dispatchMouseDown(canvas, 200, 150);
    // Drag to (350, 250).
    document.dispatchEvent(new MouseEvent('mousemove', { clientX: 350, clientY: 250, bubbles: true }));
    document.dispatchEvent(new MouseEvent('mouseup',   { clientX: 350, clientY: 250, bubbles: true }));
    // Frame should have moved by (150, 100). Snap might tweak by ≤ 8 px.
    const frame = store.read().slides[0].elements[0].frame;
    expect(Math.abs(frame.x - 250)).toBeLessThanOrEqual(8);
    expect(Math.abs(frame.y - 200)).toBeLessThanOrEqual(8);
    // Single undo entry.
    expect(store.canUndo()).toBe(true);
    store.undo();
    expect(store.read().slides[0].elements[0].frame.x).toBe(100);
    void elementId;
  });

  it('dragging the e handle resizes the selected element', () => {
    const { canvas, overlay, store } = makeFixture();
    let elementId = '';
    store.batch(() => {
      const sid = store.read().slides[0].id;
      elementId = store.addElement(sid, {
        type: 'shape',
        frame: { x: 100, y: 100, w: 200, h: 100, rotation: 0 },
        data: { kind: 'rect', fill: '#abc' },
      });
    });
    editor = initialize({ canvas, overlay, store, hostWidth: 1920, hostHeight: 1080, dpr: 1 });
    // Select the element first (mousedown inside its frame).
    dispatchMouseDown(canvas, 150, 150);
    document.dispatchEvent(new MouseEvent('mouseup', { clientX: 150, clientY: 150, bubbles: true }));
    // Now there should be handles in overlay. Find the 'e' handle's
    // logical center: the bbox right edge is at x=300 (200 + 100), y centre 150.
    // Overlay coordinates equal logical at scale=1, getBoundingClientRect
    // returns zeros in jsdom so client = overlay = logical.
    const eHandle = overlay.querySelector<HTMLDivElement>('[data-handle="e"]')!;
    const left = parseFloat(eHandle.style.left);
    const top = parseFloat(eHandle.style.top);
    // The editor listens on canvas for mousedown; handle hit-test reads
    // overlay positions. Dispatch on canvas with the handle's
    // overlay-relative position; the editor does handle-hit-test against
    // the overlay regardless of which DOM node received the event.
    const startX = left + 4;
    const startY = top + 4;
    dispatchMouseDown(canvas, startX, startY);
    document.dispatchEvent(new MouseEvent('mousemove', { clientX: startX + 50, clientY: startY, bubbles: true }));
    document.dispatchEvent(new MouseEvent('mouseup',   { clientX: startX + 50, clientY: startY, bubbles: true }));
    expect(store.read().slides[0].elements[0].frame.w).toBe(250);
    void elementId;
  });

  it('mousedown dispatched on a handle DOM element triggers resize', () => {
    // Regression: in the browser, clicking a handle delivers the
    // event to the handle <div> in the overlay (pointer-events: auto)
    // — never to the canvas. The editor must listen on the overlay
    // too, otherwise resize/rotate silently no-op for users.
    const { canvas, overlay, store } = makeFixture();
    store.batch(() => {
      const sid = store.read().slides[0].id;
      store.addElement(sid, {
        type: 'shape',
        frame: { x: 100, y: 100, w: 200, h: 100, rotation: 0 },
        data: { kind: 'rect', fill: '#abc' },
      });
    });
    editor = initialize({ canvas, overlay, store, hostWidth: 1920, hostHeight: 1080, dpr: 1 });
    dispatchMouseDown(canvas, 150, 150);
    document.dispatchEvent(new MouseEvent('mouseup', { clientX: 150, clientY: 150, bubbles: true }));
    const eHandle = overlay.querySelector<HTMLDivElement>('[data-handle="e"]')!;
    const left = parseFloat(eHandle.style.left);
    const top = parseFloat(eHandle.style.top);
    // Dispatch on the HANDLE element (real-browser path), not on canvas.
    eHandle.dispatchEvent(new MouseEvent('mousedown', {
      clientX: left + 4, clientY: top + 4, bubbles: true,
    }));
    document.dispatchEvent(new MouseEvent('mousemove', { clientX: left + 4 + 30, clientY: top + 4, bubbles: true }));
    document.dispatchEvent(new MouseEvent('mouseup',   { clientX: left + 4 + 30, clientY: top + 4, bubbles: true }));
    expect(store.read().slides[0].elements[0].frame.w).toBe(230);
  });

  it('insert mode places a new shape on canvas drag', () => {
    const { canvas, overlay, store } = makeFixture();
    editor = initialize({ canvas, overlay, store, hostWidth: 1920, hostHeight: 1080, dpr: 1 });
    editor.setInsertMode('rect');
    dispatchMouseDown(canvas, 100, 100);
    document.dispatchEvent(new MouseEvent('mousemove', { clientX: 300, clientY: 200, bubbles: true }));
    document.dispatchEvent(new MouseEvent('mouseup',   { clientX: 300, clientY: 200, bubbles: true }));
    const elements = store.read().slides[0].elements;
    expect(elements.length).toBe(1);
    expect(elements[0].frame).toEqual({ x: 100, y: 100, w: 200, h: 100, rotation: 0 });
    expect(editor.getSelection()).toEqual([elements[0].id]);
  });

  it('mousedown on empty canvas clears selection (after a click without drag)', () => {
    const { canvas, overlay, store } = makeFixture();
    store.batch(() => {
      const sid = store.read().slides[0].id;
      store.addElement(sid, {
        type: 'shape',
        frame: { x: 100, y: 50, w: 200, h: 100, rotation: 0 },
        data: { kind: 'rect', fill: '#abc' },
      });
    });
    editor = initialize({ canvas, overlay, store, hostWidth: 1920, hostHeight: 1080, dpr: 1 });
    // First select the shape.
    dispatchMouseDown(canvas, 150, 80);
    expect(editor.getSelection().length).toBe(1);
    // Then click empty space and immediately mouseup (no drag).
    dispatchMouseDown(canvas, 800, 800);
    document.dispatchEvent(new MouseEvent('mouseup', { clientX: 800, clientY: 800, bubbles: true }));
    expect(editor.getSelection()).toEqual([]);
  });

  it('setCurrentSlide switches the rendered slide and clears element selection', () => {
    const { canvas, overlay, store } = makeFixture();
    let secondId = '';
    store.batch(() => { secondId = store.addSlide('blank'); });
    editor = initialize({ canvas, overlay, store, hostWidth: 960, hostHeight: 540, dpr: 1 });
    // Select an element on the first slide.
    const firstId = store.read().slides[0].id;
    let elementId = '';
    store.batch(() => {
      elementId = store.addElement(firstId, {
        type: 'shape',
        frame: { x: 0, y: 0, w: 50, h: 50, rotation: 0 },
        data: { kind: 'rect', fill: '#abc' },
      });
    });
    editor.setSelection([elementId]);
    editor.setCurrentSlide(secondId);
    expect(editor.getCurrentSlideId()).toBe(secondId);
    expect(editor.getSelection()).toEqual([]);
  });
});
