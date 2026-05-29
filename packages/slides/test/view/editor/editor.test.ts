// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import '../../../src/view/canvas/test-canvas-env';
import type { Block } from '@wafflebase/docs';
import { MemSlidesStore } from '../../../src/store/memory';
import { initialize, type SlidesEditor } from '../../../src/view/editor/editor';
import type {
  MountSlidesTextBoxOptions,
  SlidesTextBoxEditor,
} from '../../../src/view/editor/text-box-editor';

vi.mock('../../../src/view/editor/layout-picker', () => ({
  showLayoutPicker: vi.fn(),
}));

import { showLayoutPicker } from '../../../src/view/editor/layout-picker';

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

  it('setInsertMode toggles a crosshair cursor on canvas + overlay', () => {
    const { canvas, overlay, store } = makeFixture();
    editor = initialize({ canvas, overlay, store, hostWidth: 960, hostHeight: 540, dpr: 1 });
    // Idle: stylesheet default (empty inline cursor).
    expect(canvas.style.cursor).toBe('');
    expect(overlay.style.cursor).toBe('');
    // Arming any insert kind switches both surfaces to crosshair.
    editor.setInsertMode('rect');
    expect(canvas.style.cursor).toBe('crosshair');
    expect(overlay.style.cursor).toBe('crosshair');
    // Text mode uses the same affordance (single-click insert).
    editor.setInsertMode('text');
    expect(canvas.style.cursor).toBe('crosshair');
    expect(overlay.style.cursor).toBe('crosshair');
    // Disarming restores the default.
    editor.setInsertMode(null);
    expect(canvas.style.cursor).toBe('');
    expect(overlay.style.cursor).toBe('');
  });

  it('hover over a selected shape sets cursor to move', () => {
    const { canvas, overlay, store } = makeFixture();
    let elementId = '';
    store.batch(() => {
      const sid = store.read().slides[0].id;
      elementId = store.addElement(sid, {
        type: 'shape',
        frame: { x: 100, y: 100, w: 200, h: 100, rotation: 0 },
        data: { kind: 'rect', fill: { kind: 'srgb' as const, value: '#abc' } },
      });
    });
    editor = initialize({ canvas, overlay, store, hostWidth: 1920, hostHeight: 1080, dpr: 1 });
    editor.setSelection([elementId]);
    canvas.dispatchEvent(new PointerEvent('pointermove', {
      clientX: 150, clientY: 150, pointerType: 'mouse', bubbles: true,
    }));
    expect(canvas.style.cursor).toBe('move');
    canvas.dispatchEvent(new PointerEvent('pointermove', {
      clientX: 800, clientY: 500, pointerType: 'mouse', bubbles: true,
    }));
    expect(canvas.style.cursor).toBe('');
  });

  it('hover over a non-selected shape does not set move cursor', () => {
    const { canvas, overlay, store } = makeFixture();
    store.batch(() => {
      const sid = store.read().slides[0].id;
      store.addElement(sid, {
        type: 'shape',
        frame: { x: 100, y: 100, w: 200, h: 100, rotation: 0 },
        data: { kind: 'rect', fill: { kind: 'srgb' as const, value: '#abc' } },
      });
    });
    editor = initialize({ canvas, overlay, store, hostWidth: 1920, hostHeight: 1080, dpr: 1 });
    // No selection.
    canvas.dispatchEvent(new PointerEvent('pointermove', {
      clientX: 150, clientY: 150, pointerType: 'mouse', bubbles: true,
    }));
    expect(canvas.style.cursor).toBe('');
  });

  it('move cursor logic is skipped for non-mouse pointers (touch)', () => {
    const { canvas, overlay, store } = makeFixture();
    let elementId = '';
    store.batch(() => {
      const sid = store.read().slides[0].id;
      elementId = store.addElement(sid, {
        type: 'shape',
        frame: { x: 100, y: 100, w: 200, h: 100, rotation: 0 },
        data: { kind: 'rect', fill: { kind: 'srgb' as const, value: '#abc' } },
      });
    });
    editor = initialize({ canvas, overlay, store, hostWidth: 1920, hostHeight: 1080, dpr: 1 });
    editor.setSelection([elementId]);
    canvas.dispatchEvent(new PointerEvent('pointermove', {
      clientX: 150, clientY: 150, pointerType: 'touch', bubbles: true,
    }));
    expect(canvas.style.cursor).toBe('');
  });

  it('hover does not override the crosshair cursor in insert mode', () => {
    const { canvas, overlay, store } = makeFixture();
    let elementId = '';
    store.batch(() => {
      const sid = store.read().slides[0].id;
      elementId = store.addElement(sid, {
        type: 'shape',
        frame: { x: 100, y: 100, w: 200, h: 100, rotation: 0 },
        data: { kind: 'rect', fill: { kind: 'srgb' as const, value: '#abc' } },
      });
    });
    editor = initialize({ canvas, overlay, store, hostWidth: 1920, hostHeight: 1080, dpr: 1 });
    editor.setSelection([elementId]);
    editor.setInsertMode('rect');
    canvas.dispatchEvent(new PointerEvent('pointermove', {
      clientX: 150, clientY: 150, pointerType: 'mouse', bubbles: true,
    }));
    expect(canvas.style.cursor).toBe('crosshair');
  });

  it('repeated pointermove inside a selected shape does not re-write cursor', () => {
    const { canvas, overlay, store } = makeFixture();
    let elementId = '';
    store.batch(() => {
      const sid = store.read().slides[0].id;
      elementId = store.addElement(sid, {
        type: 'shape',
        frame: { x: 100, y: 100, w: 200, h: 100, rotation: 0 },
        data: { kind: 'rect', fill: { kind: 'srgb' as const, value: '#abc' } },
      });
    });
    editor = initialize({ canvas, overlay, store, hostWidth: 1920, hostHeight: 1080, dpr: 1 });
    editor.setSelection([elementId]);

    let writes = 0;
    const cursorStore: { v: string } = { v: '' };
    Object.defineProperty(canvas.style, 'cursor', {
      configurable: true,
      get() { return cursorStore.v; },
      set(v: string) { cursorStore.v = v; writes++; },
    });

    canvas.dispatchEvent(new PointerEvent('pointermove', {
      clientX: 150, clientY: 150, pointerType: 'mouse', bubbles: true,
    }));
    canvas.dispatchEvent(new PointerEvent('pointermove', {
      clientX: 160, clientY: 160, pointerType: 'mouse', bubbles: true,
    }));
    canvas.dispatchEvent(new PointerEvent('pointermove', {
      clientX: 170, clientY: 160, pointerType: 'mouse', bubbles: true,
    }));

    expect(writes).toBe(1);
  });

  it('hover hit-test respects element rotation', () => {
    const { canvas, overlay, store } = makeFixture();
    let elementId = '';
    store.batch(() => {
      const sid = store.read().slides[0].id;
      elementId = store.addElement(sid, {
        type: 'shape',
        // Rotated 45deg around centre (200, 150). The bbox corners
        // (100,100)/(300,200) are now empty space; the rotated extent
        // pushes out beyond the axis-aligned bbox.
        frame: { x: 100, y: 100, w: 200, h: 100, rotation: Math.PI / 4 },
        data: { kind: 'rect', fill: { kind: 'srgb' as const, value: '#abc' } },
      });
    });
    editor = initialize({ canvas, overlay, store, hostWidth: 1920, hostHeight: 1080, dpr: 1 });
    editor.setSelection([elementId]);

    // (100, 100) is INSIDE the axis-aligned bbox but OUTSIDE the rotated
    // shape — the rotated rect's top-left corner is at the centre's
    // y-axis-up direction, well above this point. Should be no 'move'.
    canvas.dispatchEvent(new PointerEvent('pointermove', {
      clientX: 100, clientY: 100, pointerType: 'mouse', bubbles: true,
    }));
    expect(canvas.style.cursor).toBe('');

    // Centre (200, 150) is inside the rotated rect — should be 'move'.
    canvas.dispatchEvent(new PointerEvent('pointermove', {
      clientX: 200, clientY: 150, pointerType: 'mouse', bubbles: true,
    }));
    expect(canvas.style.cursor).toBe('move');
  });

  function dispatchMouseDown(target: globalThis.Element | Document, x: number, y: number, shift = false): void {
    target.dispatchEvent(new PointerEvent('pointerdown', {
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
        data: { kind: 'rect', fill: { kind: 'srgb' as const, value: '#abc' } },
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
        data: { kind: 'rect', fill: { kind: 'srgb' as const, value: '#abc' } },
      });
    });
    editor = initialize({ canvas, overlay, store, hostWidth: 1920, hostHeight: 1080, dpr: 1 });
    // Select + start drag at (200, 150) — middle of the shape.
    dispatchMouseDown(canvas, 200, 150);
    // Drag to (350, 250).
    document.dispatchEvent(new PointerEvent('pointermove', { clientX: 350, clientY: 250, bubbles: true }));
    document.dispatchEvent(new PointerEvent('pointerup',   { clientX: 350, clientY: 250, bubbles: true }));
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

  it('drag does not mutate the store until pointerup (ghost-only preview)', () => {
    const { canvas, overlay, store } = makeFixture();
    store.batch(() => {
      const sid = store.read().slides[0].id;
      store.addElement(sid, {
        type: 'shape',
        frame: { x: 100, y: 100, w: 200, h: 100, rotation: 0 },
        data: { kind: 'rect', fill: { kind: 'srgb' as const, value: '#abc' } },
      });
    });
    editor = initialize({ canvas, overlay, store, hostWidth: 1920, hostHeight: 1080, dpr: 1 });
    dispatchMouseDown(canvas, 200, 150);
    // Mid-drag mousemove — frame in the store must still be the original.
    document.dispatchEvent(new PointerEvent('pointermove', { clientX: 300, clientY: 220, bubbles: true }));
    const midFrame = store.read().slides[0].elements[0].frame;
    expect(midFrame.x).toBe(100);
    expect(midFrame.y).toBe(100);
    // Release commits.
    document.dispatchEvent(new PointerEvent('pointerup', { clientX: 300, clientY: 220, bubbles: true }));
    const finalFrame = store.read().slides[0].elements[0].frame;
    expect(finalFrame.x).not.toBe(100);
  });

  it('multi-select drag keeps selection handles anchored to the original bbox', () => {
    const { canvas, overlay, store } = makeFixture();
    let aId = '';
    let bId = '';
    store.batch(() => {
      const sid = store.read().slides[0].id;
      aId = store.addElement(sid, {
        type: 'shape',
        frame: { x: 100, y: 100, w: 100, h: 100, rotation: 0 },
        data: { kind: 'rect', fill: { kind: 'srgb' as const, value: '#abc' } },
      });
      bId = store.addElement(sid, {
        type: 'shape',
        frame: { x: 400, y: 400, w: 100, h: 100, rotation: 0 },
        data: { kind: 'rect', fill: { kind: 'srgb' as const, value: '#0a0' } },
      });
    });
    editor = initialize({ canvas, overlay, store, hostWidth: 1920, hostHeight: 1080, dpr: 1 });
    editor.setSelection([aId, bId]);

    dispatchMouseDown(canvas, 150, 150);
    document.dispatchEvent(new PointerEvent('pointermove', { clientX: 200, clientY: 180, bubbles: true }));

    // Multi-select renders axis-aligned bbox handles. The 'nw' handle
    // should anchor at the combined bbox top-left (min x = 100, min y = 100)
    // even mid-drag, NOT at the dragged position.
    const nw = overlay.querySelector<HTMLDivElement>('[data-handle="nw"]');
    expect(nw).not.toBeNull();
    const nwLeft = parseFloat(nw!.style.left);
    const nwTop = parseFloat(nw!.style.top);
    // Handles are centred on the corner with a small offset (HANDLE_SIZE/2 = 4).
    // The meaningful assertion: handles are near (100, 100), NOT near (150, 130).
    expect(nwLeft).toBeLessThan(120);
    expect(nwTop).toBeLessThan(120);
    expect(nwLeft).toBeGreaterThan(80);
    expect(nwTop).toBeGreaterThan(80);

    document.dispatchEvent(new PointerEvent('pointerup', { clientX: 200, clientY: 180, bubbles: true }));
  });

  it('drag with a connector in the selection does not throw and translates both together', () => {
    const { canvas, overlay, store } = makeFixture();
    let shapeId = '';
    let connectorId = '';
    store.batch(() => {
      const sid = store.read().slides[0].id;
      shapeId = store.addElement(sid, {
        type: 'shape',
        frame: { x: 100, y: 100, w: 100, h: 100, rotation: 0 },
        data: { kind: 'rect', fill: { kind: 'srgb' as const, value: '#abc' } },
      });
      connectorId = store.addElement(sid, {
        type: 'connector',
        routing: 'straight',
        start: { kind: 'free', x: 300, y: 300 },
        end: { kind: 'free', x: 400, y: 400 },
        arrowheads: {},
        frame: { x: 300, y: 300, w: 100, h: 100, rotation: 0 },
      });
    });
    editor = initialize({ canvas, overlay, store, hostWidth: 1920, hostHeight: 1080, dpr: 1 });
    editor.setSelection([shapeId, connectorId]);

    const shapeBefore = store.read().slides[0].elements.find((e) => e.id === shapeId)!;
    const connectorBefore = store.read().slides[0].elements.find((e) => e.id === connectorId)!;
    dispatchMouseDown(canvas, 150, 150);
    document.dispatchEvent(new PointerEvent('pointermove', { clientX: 250, clientY: 200, bubbles: true }));
    expect(() =>
      document.dispatchEvent(new PointerEvent('pointerup', { clientX: 250, clientY: 200, bubbles: true })),
    ).not.toThrow();

    const shapeAfter = store.read().slides[0].elements.find((e) => e.id === shapeId)!;
    const connectorAfter = store.read().slides[0].elements.find((e) => e.id === connectorId)!;
    // Both elements translate by the same (dx, dy) — connector via
    // commitTranslate (endpoints), shape via updateElementFrame.
    const shapeDx = shapeAfter.frame.x - shapeBefore.frame.x;
    const shapeDy = shapeAfter.frame.y - shapeBefore.frame.y;
    expect(shapeDx).not.toBe(0);
    expect(connectorAfter.frame.x - connectorBefore.frame.x).toBe(shapeDx);
    expect(connectorAfter.frame.y - connectorBefore.frame.y).toBe(shapeDy);
  });

  it('click-without-drag does not push a no-op undo snapshot or wipe redo', () => {
    const { canvas, overlay, store } = makeFixture();
    let shapeId = '';
    store.batch(() => {
      const sid = store.read().slides[0].id;
      shapeId = store.addElement(sid, {
        type: 'shape',
        frame: { x: 100, y: 100, w: 200, h: 100, rotation: 0 },
        data: { kind: 'rect', fill: { kind: 'srgb' as const, value: '#abc' } },
      });
    });
    editor = initialize({ canvas, overlay, store, hostWidth: 1920, hostHeight: 1080, dpr: 1 });

    // Establish a non-empty redo stack so we can verify the click does
    // not silently wipe it.
    store.batch(() => {
      const sid = store.read().slides[0].id;
      store.addElement(sid, {
        type: 'shape',
        frame: { x: 10, y: 10, w: 20, h: 20, rotation: 0 },
        data: { kind: 'rect', fill: { kind: 'srgb' as const, value: '#fff' } },
      });
    });
    store.undo();
    expect(store.canRedo()).toBe(true);
    const undoBefore = store.canUndo();

    editor.setSelection([shapeId]);
    // Mousedown on the selected shape then immediate mouseup with no
    // pointermove — the drag delta is 0. `onUp` must skip the batch
    // entirely (an empty `store.batch` would push an undo snapshot and
    // clear the redo stack).
    dispatchMouseDown(canvas, 200, 150);
    document.dispatchEvent(new PointerEvent('pointerup', { clientX: 200, clientY: 150, bubbles: true }));

    // Undo state must be exactly what it was before the click.
    expect(store.canUndo()).toBe(undoBefore);
    // Redo stack must be intact.
    expect(store.canRedo()).toBe(true);
  });

  it('clicking on an already-selected element preserves the multi-selection and drags all of them', () => {
    const { canvas, overlay, store } = makeFixture();
    let aId = '';
    let bId = '';
    store.batch(() => {
      const sid = store.read().slides[0].id;
      aId = store.addElement(sid, {
        type: 'shape',
        frame: { x: 100, y: 100, w: 100, h: 100, rotation: 0 },
        data: { kind: 'rect', fill: { kind: 'srgb' as const, value: '#abc' } },
      });
      bId = store.addElement(sid, {
        type: 'shape',
        frame: { x: 400, y: 400, w: 100, h: 100, rotation: 0 },
        data: { kind: 'rect', fill: { kind: 'srgb' as const, value: '#0a0' } },
      });
    });
    editor = initialize({ canvas, overlay, store, hostWidth: 1920, hostHeight: 1080, dpr: 1 });
    editor.setSelection([aId, bId]);
    // Click inside element `a` (no shift). Multi-selection should be
    // preserved so the follow-up drag moves both elements.
    dispatchMouseDown(canvas, 150, 150);
    expect(editor.getSelection()).toEqual([aId, bId]);
    document.dispatchEvent(new PointerEvent('pointermove', { clientX: 200, clientY: 180, bubbles: true }));
    document.dispatchEvent(new PointerEvent('pointerup',   { clientX: 200, clientY: 180, bubbles: true }));
    const elements = store.read().slides[0].elements;
    const a = elements.find((el) => el.id === aId)!;
    const b = elements.find((el) => el.id === bId)!;
    // Both elements moved by approximately the same delta. Snap may
    // tweak by ≤ 8 px, but the per-element delta is identical so the
    // gap between a and b is preserved.
    expect(b.frame.x - a.frame.x).toBe(300);
    expect(b.frame.y - a.frame.y).toBe(300);
    expect(a.frame.x).toBeGreaterThan(100);
    expect(a.frame.y).toBeGreaterThan(100);
  });

  it('dragging the e handle resizes the selected element', () => {
    const { canvas, overlay, store } = makeFixture();
    let elementId = '';
    store.batch(() => {
      const sid = store.read().slides[0].id;
      elementId = store.addElement(sid, {
        type: 'shape',
        frame: { x: 100, y: 100, w: 200, h: 100, rotation: 0 },
        data: { kind: 'rect', fill: { kind: 'srgb' as const, value: '#abc' } },
      });
    });
    editor = initialize({ canvas, overlay, store, hostWidth: 1920, hostHeight: 1080, dpr: 1 });
    // Select the element first (mousedown inside its frame).
    dispatchMouseDown(canvas, 150, 150);
    document.dispatchEvent(new PointerEvent('pointerup', { clientX: 150, clientY: 150, bubbles: true }));
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
    document.dispatchEvent(new PointerEvent('pointermove', { clientX: startX + 50, clientY: startY, bubbles: true }));
    document.dispatchEvent(new PointerEvent('pointerup',   { clientX: startX + 50, clientY: startY, bubbles: true }));
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
        data: { kind: 'rect', fill: { kind: 'srgb' as const, value: '#abc' } },
      });
    });
    editor = initialize({ canvas, overlay, store, hostWidth: 1920, hostHeight: 1080, dpr: 1 });
    dispatchMouseDown(canvas, 150, 150);
    document.dispatchEvent(new PointerEvent('pointerup', { clientX: 150, clientY: 150, bubbles: true }));
    const eHandle = overlay.querySelector<HTMLDivElement>('[data-handle="e"]')!;
    const left = parseFloat(eHandle.style.left);
    const top = parseFloat(eHandle.style.top);
    // Dispatch on the HANDLE element (real-browser path), not on canvas.
    eHandle.dispatchEvent(new PointerEvent('pointerdown', {
      clientX: left + 4, clientY: top + 4, bubbles: true,
    }));
    document.dispatchEvent(new PointerEvent('pointermove', { clientX: left + 4 + 30, clientY: top + 4, bubbles: true }));
    document.dispatchEvent(new PointerEvent('pointerup',   { clientX: left + 4 + 30, clientY: top + 4, bubbles: true }));
    expect(store.read().slides[0].elements[0].frame.w).toBe(230);
  });

  it('insert mode places a new shape on canvas drag', () => {
    const { canvas, overlay, store } = makeFixture();
    editor = initialize({ canvas, overlay, store, hostWidth: 1920, hostHeight: 1080, dpr: 1 });
    editor.setInsertMode('rect');
    dispatchMouseDown(canvas, 100, 100);
    document.dispatchEvent(new PointerEvent('pointermove', { clientX: 300, clientY: 200, bubbles: true }));
    document.dispatchEvent(new PointerEvent('pointerup',   { clientX: 300, clientY: 200, bubbles: true }));
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
        data: { kind: 'rect', fill: { kind: 'srgb' as const, value: '#abc' } },
      });
    });
    editor = initialize({ canvas, overlay, store, hostWidth: 1920, hostHeight: 1080, dpr: 1 });
    // First select the shape.
    dispatchMouseDown(canvas, 150, 80);
    expect(editor.getSelection().length).toBe(1);
    // Then click empty space and immediately mouseup (no drag).
    dispatchMouseDown(canvas, 800, 800);
    document.dispatchEvent(new PointerEvent('pointerup', { clientX: 800, clientY: 800, bubbles: true }));
    expect(editor.getSelection()).toEqual([]);
  });

  it('Escape disarms an active insert mode and restores the cursor', () => {
    const { canvas, overlay, store } = makeFixture();
    editor = initialize({ canvas, overlay, store, hostWidth: 960, hostHeight: 540, dpr: 1 });
    editor.setInsertMode('rect');
    expect(editor.getInsertMode()).toBe('rect');
    expect(canvas.style.cursor).toBe('crosshair');
    // Plain Escape (no mod, no editable focus) → disarm.
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    // The key rule is async (returns a Promise via handleKeyDown's
    // `runKeyRules`); flush microtasks so the synchronous-looking
    // setInsertMode update has run before we assert.
    return Promise.resolve().then(() => {
      expect(editor!.getInsertMode()).toBe(null);
      expect(canvas.style.cursor).toBe('');
      expect(overlay.style.cursor).toBe('');
    });
  });

  it('Escape mid-drag aborts the drag-to-size insert without committing', () => {
    const { canvas, overlay, store } = makeFixture();
    editor = initialize({ canvas, overlay, store, hostWidth: 1920, hostHeight: 1080, dpr: 1 });
    editor.setInsertMode('rect');
    // Begin a drag — past the click threshold so the click branch
    // (default-size insert) doesn't fire on the synthetic mouseup.
    dispatchMouseDown(canvas, 100, 100);
    document.dispatchEvent(new PointerEvent('pointermove', { clientX: 300, clientY: 200, bubbles: true }));
    // Mid-drag ESC: capture-phase handler should abort, no element
    // committed, insert mode disarmed.
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    // Even if the user releases after ESC, no commit should land.
    document.dispatchEvent(new PointerEvent('pointerup', { clientX: 300, clientY: 200, bubbles: true }));
    return Promise.resolve().then(() => {
      expect(store.read().slides[0].elements.length).toBe(0);
      expect(editor!.getInsertMode()).toBe(null);
      expect(canvas.style.cursor).toBe('');
    });
  });

  it('disarming insert mode clears the hover ghost state', () => {
    const { canvas, overlay, store } = makeFixture();
    editor = initialize({ canvas, overlay, store, hostWidth: 1920, hostHeight: 1080, dpr: 1 });
    editor.setInsertMode('rect');
    // Fire a mousemove so the editor stages a hoverPreview. We can't
    // observe the private field directly, but `setInsertMode(null)`
    // is documented to cancel the rAF + drop the preview; without
    // that, a pending rAF would later call into a stale renderer.
    canvas.dispatchEvent(new PointerEvent('pointermove', { clientX: 100, clientY: 100, bubbles: true }));
    // Disarming should not throw and should leave the cursor cleared
    // — together these imply the cleanup path ran without trying to
    // paint against a torn-down renderer on a later rAF tick.
    expect(() => editor!.setInsertMode(null)).not.toThrow();
    expect(canvas.style.cursor).toBe('');
    // detach() in the test teardown must also be safe even if a rAF
    // was queued; the editor's detach cancels any pending hover rAF.
    expect(() => editor!.detach()).not.toThrow();
  });

  it('Escape is a no-op when no insert mode is armed (other ESC handlers can layer on)', () => {
    const { canvas, overlay, store } = makeFixture();
    editor = initialize({ canvas, overlay, store, hostWidth: 960, hostHeight: 540, dpr: 1 });
    expect(editor.getInsertMode()).toBe(null);
    const ev = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    document.dispatchEvent(ev);
    return Promise.resolve().then(() => {
      expect(editor!.getInsertMode()).toBe(null);
      // No preventDefault when we didn't act → other consumers stay free.
      expect(ev.defaultPrevented).toBe(false);
    });
  });

  it('notifies onInsertModeChange when setInsertMode is called', () => {
    const { canvas, overlay, store } = makeFixture();
    editor = initialize({ canvas, overlay, store, hostWidth: 960, hostHeight: 540, dpr: 1 });
    const seen: (string | null)[] = [];
    const unsub = editor.onInsertModeChange(() => {
      seen.push(editor!.getInsertMode());
    });

    editor.setInsertMode('rect');
    editor.setInsertMode('text');
    editor.setInsertMode(null);
    unsub();
    editor.setInsertMode('rect'); // post-unsub, should not fire

    expect(seen).toEqual(['rect', 'text', null]);
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
        data: { kind: 'rect', fill: { kind: 'srgb' as const, value: '#abc' } },
      });
    });
    editor.setSelection([elementId]);
    editor.setCurrentSlide(secondId);
    expect(editor.getCurrentSlideId()).toBe(secondId);
    expect(editor.getSelection()).toEqual([]);
  });
});

describe('initialize with readOnly: true', () => {
  let editor: SlidesEditor | null = null;

  beforeEach(() => {
    document.body.innerHTML = '';
    if (editor) {
      editor.detach();
      editor = null;
    }
  });

  it('does not bind pointerdown — clicking an element leaves selection empty', () => {
    const { canvas, overlay, store } = makeFixture();
    let elementId = '';
    store.batch(() => {
      const sid = store.read().slides[0].id;
      elementId = store.addElement(sid, {
        type: 'shape',
        frame: { x: 100, y: 100, w: 200, h: 100, rotation: 0 },
        data: { kind: 'rect', fill: { kind: 'srgb' as const, value: '#abc' } },
      });
    });
    editor = initialize({
      canvas, overlay, store,
      hostWidth: 1920, hostHeight: 1080, dpr: 1,
      readOnly: true,
    });
    // Click within the rect's logical bounds (100,100)-(300,200). With
    // host scale 1920→1920, world coords match client coords.
    canvas.dispatchEvent(new PointerEvent('pointerdown', {
      clientX: 150, clientY: 150, pointerType: 'mouse', bubbles: true,
    }));
    expect(editor.getSelection()).toEqual([]);
    // Sanity: the element does exist; a non-readOnly editor would have
    // selected it. (Mirrors the parallel test under 'initialize'.)
    expect(store.read().slides[0].elements.find((el) => el.id === elementId)).toBeDefined();
  });

  it('does not bind document keydown — Delete leaves the element in place', () => {
    const { canvas, overlay, store } = makeFixture();
    let elementId = '';
    store.batch(() => {
      const sid = store.read().slides[0].id;
      elementId = store.addElement(sid, {
        type: 'shape',
        frame: { x: 100, y: 100, w: 200, h: 100, rotation: 0 },
        data: { kind: 'rect', fill: { kind: 'srgb' as const, value: '#abc' } },
      });
    });
    editor = initialize({
      canvas, overlay, store,
      hostWidth: 1920, hostHeight: 1080, dpr: 1,
      readOnly: true,
    });
    // Programmatic selection still works (the surface for navigation),
    // but the Delete keymap action must not fire because the document
    // keydown listener was never bound.
    editor.setSelection([elementId]);
    document.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'Delete', bubbles: true,
    }));
    expect(
      store.read().slides[0].elements.find((el) => el.id === elementId),
    ).toBeDefined();
  });

  it('does not bind ruler pointerdown — drag-out cannot create a guide', () => {
    const { canvas, overlay, store } = makeFixture();
    const hRulerCanvas = document.createElement('canvas');
    const vRulerCanvas = document.createElement('canvas');
    const rulerCorner = document.createElement('div');
    document.body.append(hRulerCanvas, vRulerCanvas, rulerCorner);
    editor = initialize({
      canvas, overlay, store,
      hostWidth: 1920, hostHeight: 1080, dpr: 1,
      readOnly: true,
      hRulerCanvas, vRulerCanvas, rulerCorner,
    });
    expect(store.read().guides).toEqual([]);
    hRulerCanvas.dispatchEvent(new PointerEvent('pointerdown', {
      clientX: 500, clientY: 5, pointerType: 'mouse', bubbles: true,
    }));
    document.dispatchEvent(new PointerEvent('pointerup', {
      clientX: 500, clientY: 200, pointerType: 'mouse', bubbles: true,
    }));
    expect(store.read().guides).toEqual([]);
  });

  it('does not start guide drag on slide canvas pointerdown', () => {
    const { canvas, overlay, store } = makeFixture();
    // Seed a guide so the hit-test would otherwise succeed.
    store.batch(() => store.addGuide('x', 400));
    editor = initialize({
      canvas, overlay, store,
      hostWidth: 1920, hostHeight: 1080, dpr: 1,
      readOnly: true,
    });
    canvas.dispatchEvent(new PointerEvent('pointerdown', {
      clientX: 400, clientY: 100, pointerType: 'mouse', bubbles: true,
    }));
    document.dispatchEvent(new PointerEvent('pointerup', {
      clientX: 500, clientY: 100, pointerType: 'mouse', bubbles: true,
    }));
    // Guide must stay at 400 — the readOnly editor never bound the
    // pointerdown listener that routes to startGuideMove.
    expect(store.read().guides[0].position).toBe(400);
  });

  it('detach is safe and rendering after detach is a no-op', () => {
    const { canvas, overlay, store } = makeFixture();
    editor = initialize({
      canvas, overlay, store,
      hostWidth: 960, hostHeight: 540, dpr: 1,
      readOnly: true,
    });
    editor.detach();
    // Mirrors the editable-path detach test: post-detach the editor's
    // programmatic surface must stay safe to call without throwing.
    expect(() => editor!.render()).not.toThrow();
    expect(() => editor!.markDirty()).not.toThrow();
    editor = null;
  });
});

describe('align/distribute', () => {
  let editor: SlidesEditor | null = null;

  beforeEach(() => {
    document.body.innerHTML = '';
    if (editor) {
      editor.detach();
      editor = null;
    }
  });

  function addShape(
    store: MemSlidesStore,
    sid: string,
    x: number,
    y: number,
    w: number,
    h: number,
  ): string {
    let id = '';
    store.batch(() => {
      id = store.addElement(sid, {
        type: 'shape',
        frame: { x, y, w, h, rotation: 0 },
        data: { kind: 'rect', fill: { kind: 'srgb' as const, value: '#abc' } },
      });
    });
    return id;
  }

  it('align left with multi-select moves all frames to bbox.x', () => {
    const { canvas, overlay, store } = makeFixture();
    const sid = store.read().slides[0].id;
    // a at x=100, b at x=300, both w=50; bbox.x = 100.
    const aId = addShape(store, sid, 100, 0, 50, 50);
    const bId = addShape(store, sid, 300, 0, 50, 50);
    editor = initialize({ canvas, overlay, store, hostWidth: 1920, hostHeight: 1080, dpr: 1 });
    editor.setSelection([aId, bId]);
    editor.align('left');
    const elements = store.read().slides[0].elements;
    const a = elements.find((e) => e.id === aId)!;
    const b = elements.find((e) => e.id === bId)!;
    expect(a.frame.x).toBe(100);
    expect(b.frame.x).toBe(100);
  });

  it('align center-h with single-select centers element on slide', () => {
    const { canvas, overlay, store } = makeFixture();
    const sid = store.read().slides[0].id;
    // x=0, w=200; slide is 1920x1080; expected x = (1920 - 200) / 2 = 860.
    const id = addShape(store, sid, 0, 0, 200, 100);
    editor = initialize({ canvas, overlay, store, hostWidth: 1920, hostHeight: 1080, dpr: 1 });
    editor.setSelection([id]);
    editor.align('center-h');
    const el = store.read().slides[0].elements.find((e) => e.id === id)!;
    expect(el.frame.x).toBe(860);
  });

  it('align is a no-op when selection is empty', () => {
    const { canvas, overlay, store } = makeFixture();
    const sid = store.read().slides[0].id;
    addShape(store, sid, 100, 50, 200, 100);
    editor = initialize({ canvas, overlay, store, hostWidth: 1920, hostHeight: 1080, dpr: 1 });
    const before = store.read().slides[0].elements[0].frame;
    // Snapshot the undo depth before align so we can verify it didn't grow.
    let undoDepth = 0;
    while (store.canUndo()) {
      store.undo();
      undoDepth++;
    }
    while (store.canRedo()) store.redo();
    // No setSelection — selection is empty.
    editor.align('left');
    // Frame unchanged.
    const after = store.read().slides[0].elements[0].frame;
    expect(after).toEqual(before);
    // align must NOT have added a new undo entry on top of the existing ones.
    let postDepth = 0;
    while (store.canUndo()) {
      store.undo();
      postDepth++;
    }
    expect(postDepth).toBe(undoDepth);
  });

  it('distribute horizontal with 3 elements equalizes gaps', () => {
    const { canvas, overlay, store } = makeFixture();
    const sid = store.read().slides[0].id;
    // a@x=0/w=100, b@x=150/w=50, c@x=400/w=100
    // gap = (400 - 0 - 150) / 2 = 125; expected b.x = 0 + 100 + 125 = 225
    const aId = addShape(store, sid, 0, 0, 100, 100);
    const bId = addShape(store, sid, 150, 0, 50, 100);
    const cId = addShape(store, sid, 400, 0, 100, 100);
    editor = initialize({ canvas, overlay, store, hostWidth: 1920, hostHeight: 1080, dpr: 1 });
    editor.setSelection([aId, bId, cId]);
    editor.distribute('horizontal');
    const elements = store.read().slides[0].elements;
    const a = elements.find((e) => e.id === aId)!;
    const b = elements.find((e) => e.id === bId)!;
    const c = elements.find((e) => e.id === cId)!;
    // Endpoints unchanged.
    expect(a.frame.x).toBe(0);
    expect(c.frame.x).toBe(400);
    // Inner element placed at expected position.
    expect(b.frame.x).toBe(225);
  });

  it('distribute is a no-op for 2 elements', () => {
    const { canvas, overlay, store } = makeFixture();
    const sid = store.read().slides[0].id;
    const aId = addShape(store, sid, 0, 0, 100, 100);
    const bId = addShape(store, sid, 400, 0, 100, 100);
    editor = initialize({ canvas, overlay, store, hostWidth: 1920, hostHeight: 1080, dpr: 1 });
    editor.setSelection([aId, bId]);
    const beforeA = store.read().slides[0].elements.find((e) => e.id === aId)!.frame;
    const beforeB = store.read().slides[0].elements.find((e) => e.id === bId)!.frame;
    editor.distribute('horizontal');
    const afterA = store.read().slides[0].elements.find((e) => e.id === aId)!.frame;
    const afterB = store.read().slides[0].elements.find((e) => e.id === bId)!.frame;
    expect(afterA).toEqual(beforeA);
    expect(afterB).toEqual(beforeB);
  });

  it('align uses axis-aligned frame fields and preserves rotation', () => {
    const { canvas, overlay, store } = makeFixture();
    const sid = store.read().slides[0].id;
    // Two rotated elements at different unrotated x values. align('left')
    // must write the result directly to frame.x and leave rotation alone.
    let aId = '';
    let bId = '';
    const aRotation = Math.PI / 4;
    const bRotation = Math.PI / 6;
    store.batch(() => {
      aId = store.addElement(sid, {
        type: 'shape',
        frame: { x: 100, y: 0, w: 50, h: 50, rotation: aRotation },
        data: { kind: 'rect', fill: { kind: 'srgb' as const, value: '#abc' } },
      });
      bId = store.addElement(sid, {
        type: 'shape',
        frame: { x: 300, y: 0, w: 50, h: 50, rotation: bRotation },
        data: { kind: 'rect', fill: { kind: 'srgb' as const, value: '#abc' } },
      });
    });
    editor = initialize({ canvas, overlay, store, hostWidth: 1920, hostHeight: 1080, dpr: 1 });
    editor.setSelection([aId, bId]);
    editor.align('left');
    const elements = store.read().slides[0].elements;
    const a = elements.find((e) => e.id === aId)!;
    const b = elements.find((e) => e.id === bId)!;
    // Both elements' frame.x collapses to the same value (left-align
    // pulls every selected frame to the reference's x — they share a
    // common left edge after the op).
    expect(a.frame.x).toBe(b.frame.x);
    // Rotation preserved exactly on both elements.
    expect(a.frame.rotation).toBe(aRotation);
    expect(b.frame.rotation).toBe(bRotation);
  });

  it('align/distribute commit through one store.batch (one undo step)', () => {
    const { canvas, overlay, store } = makeFixture();
    const sid = store.read().slides[0].id;
    // 3 elements at differing x so align('left') moves two of them
    // (and so produces a non-empty batch).
    const aId = addShape(store, sid, 100, 0, 100, 100);
    const bId = addShape(store, sid, 300, 0, 100, 100);
    const cId = addShape(store, sid, 500, 0, 100, 100);
    const originalA = store.read().slides[0].elements.find((e) => e.id === aId)!.frame;
    const originalB = store.read().slides[0].elements.find((e) => e.id === bId)!.frame;
    const originalC = store.read().slides[0].elements.find((e) => e.id === cId)!.frame;
    editor = initialize({ canvas, overlay, store, hostWidth: 1920, hostHeight: 1080, dpr: 1 });
    editor.setSelection([aId, bId, cId]);
    editor.align('left');
    expect(store.canUndo()).toBe(true);
    // Single undo restores all three back to original positions.
    store.undo();
    const elements = store.read().slides[0].elements;
    expect(elements.find((e) => e.id === aId)!.frame).toEqual(originalA);
    expect(elements.find((e) => e.id === bId)!.frame).toEqual(originalB);
    expect(elements.find((e) => e.id === cId)!.frame).toEqual(originalC);
  });
});

describe('z-order and rotate', () => {
  let editor: SlidesEditor | null = null;

  beforeEach(() => {
    document.body.innerHTML = '';
    if (editor) {
      editor.detach();
      editor = null;
    }
  });

  function addShape(
    store: MemSlidesStore,
    sid: string,
    x: number,
    y: number,
    w: number,
    h: number,
    rotation = 0,
  ): string {
    let id = '';
    store.batch(() => {
      id = store.addElement(sid, {
        type: 'shape',
        frame: { x, y, w, h, rotation },
        data: { kind: 'rect', fill: { kind: 'srgb' as const, value: '#abc' } },
      });
    });
    return id;
  }

  it('bringForward moves element at index 1 to index 2 in a 3-element slide', () => {
    const { canvas, overlay, store } = makeFixture();
    const sid = store.read().slides[0].id;
    const aId = addShape(store, sid, 0, 0, 100, 100);
    const bId = addShape(store, sid, 100, 0, 100, 100);
    const cId = addShape(store, sid, 200, 0, 100, 100);
    editor = initialize({ canvas, overlay, store, hostWidth: 1920, hostHeight: 1080, dpr: 1 });
    editor.setSelection([bId]);
    editor.bringForward();
    const elements = store.read().slides[0].elements;
    expect(elements.map((e) => e.id)).toEqual([aId, cId, bId]);
  });

  it('bringForward is a no-op for element already at the end', () => {
    const { canvas, overlay, store } = makeFixture();
    const sid = store.read().slides[0].id;
    const aId = addShape(store, sid, 0, 0, 100, 100);
    const bId = addShape(store, sid, 100, 0, 100, 100);
    editor = initialize({ canvas, overlay, store, hostWidth: 1920, hostHeight: 1080, dpr: 1 });
    editor.setSelection([bId]);
    editor.bringForward();
    const elements = store.read().slides[0].elements;
    expect(elements.map((e) => e.id)).toEqual([aId, bId]);
  });

  it('bringForward is a no-op when selection is empty', () => {
    const { canvas, overlay, store } = makeFixture();
    const sid = store.read().slides[0].id;
    const aId = addShape(store, sid, 0, 0, 100, 100);
    const bId = addShape(store, sid, 100, 0, 100, 100);
    editor = initialize({ canvas, overlay, store, hostWidth: 1920, hostHeight: 1080, dpr: 1 });
    // no setSelection
    editor.bringForward();
    expect(store.read().slides[0].elements.map((e) => e.id)).toEqual([aId, bId]);
  });

  it('sendToBack moves element at index 2 to index 0', () => {
    const { canvas, overlay, store } = makeFixture();
    const sid = store.read().slides[0].id;
    const aId = addShape(store, sid, 0, 0, 100, 100);
    const bId = addShape(store, sid, 100, 0, 100, 100);
    const cId = addShape(store, sid, 200, 0, 100, 100);
    editor = initialize({ canvas, overlay, store, hostWidth: 1920, hostHeight: 1080, dpr: 1 });
    editor.setSelection([cId]);
    editor.sendToBack();
    const elements = store.read().slides[0].elements;
    expect(elements.map((e) => e.id)).toEqual([cId, aId, bId]);
  });

  it('bringToFront moves selected elements to the end preserving relative order', () => {
    const { canvas, overlay, store } = makeFixture();
    const sid = store.read().slides[0].id;
    const aId = addShape(store, sid, 0, 0, 100, 100);
    const bId = addShape(store, sid, 100, 0, 100, 100);
    const cId = addShape(store, sid, 200, 0, 100, 100);
    const dId = addShape(store, sid, 300, 0, 100, 100);
    editor = initialize({ canvas, overlay, store, hostWidth: 1920, hostHeight: 1080, dpr: 1 });
    editor.setSelection([aId, cId]);
    editor.bringToFront();
    const elements = store.read().slides[0].elements;
    // b and d unselected stay, then a and c at the end in original order
    expect(elements.map((e) => e.id)).toEqual([bId, dId, aId, cId]);
  });

  it('sendBackward moves element one position toward index 0', () => {
    const { canvas, overlay, store } = makeFixture();
    const sid = store.read().slides[0].id;
    const aId = addShape(store, sid, 0, 0, 100, 100);
    const bId = addShape(store, sid, 100, 0, 100, 100);
    const cId = addShape(store, sid, 200, 0, 100, 100);
    editor = initialize({ canvas, overlay, store, hostWidth: 1920, hostHeight: 1080, dpr: 1 });
    editor.setSelection([bId]);
    editor.sendBackward();
    expect(store.read().slides[0].elements.map((e) => e.id)).toEqual([bId, aId, cId]);
  });

  it('rotateBy π/2 on a frame with rotation 0 results in rotation π/2', () => {
    const { canvas, overlay, store } = makeFixture();
    const sid = store.read().slides[0].id;
    const id = addShape(store, sid, 0, 0, 100, 100);
    editor = initialize({ canvas, overlay, store, hostWidth: 1920, hostHeight: 1080, dpr: 1 });
    editor.setSelection([id]);
    editor.rotateBy(Math.PI / 2);
    const el = store.read().slides[0].elements.find((e) => e.id === id)!;
    expect(el.frame.rotation).toBeCloseTo(Math.PI / 2);
  });

  it('rotateBy normalises rotation into [0, 2π)', () => {
    const { canvas, overlay, store } = makeFixture();
    const sid = store.read().slides[0].id;
    const id = addShape(store, sid, 0, 0, 100, 100, (3 * Math.PI) / 2);
    editor = initialize({ canvas, overlay, store, hostWidth: 1920, hostHeight: 1080, dpr: 1 });
    editor.setSelection([id]);
    // 3π/2 + π = 5π/2; normalised → π/2
    editor.rotateBy(Math.PI);
    const el = store.read().slides[0].elements.find((e) => e.id === id)!;
    expect(el.frame.rotation).toBeCloseTo(Math.PI / 2);
  });

  it('rotateBy is a no-op when selection is empty', () => {
    const { canvas, overlay, store } = makeFixture();
    const sid = store.read().slides[0].id;
    const id = addShape(store, sid, 0, 0, 100, 100);
    editor = initialize({ canvas, overlay, store, hostWidth: 1920, hostHeight: 1080, dpr: 1 });
    // no setSelection
    editor.rotateBy(Math.PI / 2);
    const el = store.read().slides[0].elements.find((e) => e.id === id)!;
    expect(el.frame.rotation).toBe(0);
  });

  /**
   * Minimal mock mount factory: mirrors the fuller mock in text-box-editor.test.ts
   * but without the fireCommit/fireCancel extras not needed here. A real
   * container is created and appended to the overlay so the editor's
   * `reattachEditingTextBox` path (which reads `tb.container.parentNode`) works.
   */
  function makeMockMount() {
    function mount(opts: MountSlidesTextBoxOptions): SlidesTextBoxEditor {
      const container = document.createElement('div');
      container.className = 'wfb-slides-text-box-editor';
      container.style.position = 'absolute';
      opts.overlay.appendChild(container);
      let mounted = true;
      return {
        isEditing: () => mounted,
        focus: () => undefined,
        commit: () => opts.onCommit(opts.blocks),
        detach: () => { mounted = false; container.remove(); },
        container,
        getSelectionStyle: () => ({}),
        applyStyle: () => {},
        clearInlineFormatting: () => {},
        applyBlockStyle: () => {},
        getBlockType: () => ({ type: 'paragraph' as const }),
        setBlockType: () => {},
        toggleList: () => {},
        indent: () => {},
        outdent: () => {},
        insertLink: () => {},
        removeLink: () => {},
        getLinkAtCursor: () => undefined,
        requestLink: () => {},
        undo: () => {},
        redo: () => {},
        onCursorMove: () => {},
      };
    }
    return mount;
  }

  it.each([
    ['bringForward',  (ed: SlidesEditor) => ed.bringForward()],
    ['sendBackward',  (ed: SlidesEditor) => ed.sendBackward()],
    ['bringToFront',  (ed: SlidesEditor) => ed.bringToFront()],
    ['sendToBack',    (ed: SlidesEditor) => ed.sendToBack()],
    ['rotateBy',      (ed: SlidesEditor) => ed.rotateBy(Math.PI / 2)],
  ] as const)('%s is a no-op while text-editing', (_name, invoke) => {
    const { canvas, overlay, store } = makeFixture();
    const sid = store.read().slides[0].id;
    // Three shapes at indices 0–2 so that z-order operations have room to move.
    const e1 = addShape(store, sid, 0,   0, 100, 100);
    const e2 = addShape(store, sid, 100, 0, 100, 100);
    const e3 = addShape(store, sid, 200, 0, 100, 100);
    // A text element at index 3 — required by enterTextEditing.
    let textId = '';
    store.batch(() => {
      textId = store.addElement(sid, {
        type: 'text',
        frame: { x: 300, y: 0, w: 100, h: 100, rotation: 0 },
        data: {
          blocks: [{
            id: 'b1',
            type: 'paragraph',
            inlines: [{ text: '', style: {} }],
            style: {},
          } as Block],
        },
      });
    });
    editor = initialize({
      canvas, overlay, store,
      hostWidth: 1920, hostHeight: 1080, dpr: 1,
      mountTextBox: makeMockMount(),
    });
    // Enter text-editing on the text element (sets editingElementId).
    editor.enterTextEditing(textId);
    // Now select a shape; the guard fires before any re-order / rotate.
    editor.setSelection([e2]);
    // Snapshot the element order + rotation before invoking the method.
    const before = store.read().slides.find((s) => s.id === sid)!.elements.map((e) => e.id);
    invoke(editor);
    const after = store.read().slides.find((s) => s.id === sid)!.elements.map((e) => e.id);
    expect(after).toEqual(before);
    // Rotation of the actually-selected shape must also be unchanged
    // (covers rotateBy — selection is [e2]).
    const el2 = store.read().slides.find((s) => s.id === sid)!.elements.find((e) => e.id === e2)!;
    expect(el2.frame.rotation).toBe(0);
    void [e1, e3];
  });
});

describe('Editor — adjustment drag (Task 12)', () => {
  let editor: SlidesEditor | null = null;

  beforeEach(() => {
    document.body.innerHTML = '';
    if (editor) {
      editor.detach();
      editor = null;
    }
  });

  /**
   * Build a fixture with a single roundRect shape and return the
   * editor, store, and element id. We use hostWidth=1920 so that
   * scale = hostWidth / SLIDE_WIDTH = 1920 / 1920 = 1, meaning overlay
   * pixel positions equal logical slide coordinates.
   */
  function setupRoundRect() {
    const canvas = document.createElement('canvas');
    canvas.width = 1920;
    canvas.height = 1080;
    const overlay = document.createElement('div');
    overlay.style.position = 'absolute';
    document.body.appendChild(canvas);
    document.body.appendChild(overlay);
    const store = new MemSlidesStore();
    let slideId = '';
    let elementId = '';
    store.batch(() => {
      slideId = store.addSlide('blank');
      elementId = store.addElement(slideId, {
        type: 'shape',
        frame: { x: 100, y: 100, w: 200, h: 100, rotation: 0 },
        data: { kind: 'roundRect', fill: { kind: 'srgb' as const, value: '#abc' } },
      });
    });
    editor = initialize({ canvas, overlay, store, hostWidth: 1920, hostHeight: 1080, dpr: 1 });
    // Select the element so the overlay renders adjustment handles.
    editor.setSelection([elementId]);
    // Force overlay repaint (setSelection triggers repaintOverlay via selection.subscribe).
    return { canvas, overlay, store, elementId };
  }

  function readAdjustments(store: MemSlidesStore, elementId: string): readonly number[] | undefined {
    const slide = store.read().slides[0];
    const el = slide.elements.find((e) => e.id === elementId);
    if (!el || el.type !== 'shape') return undefined;
    // Use the stored adjustments, falling back to undefined when absent.
    return (el.data as { adjustments?: number[] }).adjustments;
  }

  it('commits one updateElementData with changed adjustments on a real drag (>2px)', () => {
    const { overlay, store, elementId } = setupRoundRect();
    // The adjust-0 handle is rendered inside the overlay. Its style.left/top
    // give the hit-test-readable position (scale=1 means overlay px == logical px).
    const handle = overlay.querySelector<HTMLDivElement>('[data-handle="adjust-0"]');
    expect(handle).not.toBeNull();
    const left = parseFloat(handle!.style.left);
    const top = parseFloat(handle!.style.top);
    // Click center of the handle (left + ADJUST_HANDLE_SIZE/2 = left + 4).
    const cx = left + 4;
    const cy = top + 4;

    // Dispatch on the handle element (real-browser path — the overlay listener
    // in the editor catches it and routes to startAdjustmentDrag).
    handle!.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: cx, clientY: cy }));
    // Move >2px to cross the threshold (which is 2px in world coords; scale=1
    // so 10px clientX change == 10px world change, well past the threshold).
    document.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: cx + 10, clientY: cy }));
    document.dispatchEvent(new PointerEvent('pointerup',   { bubbles: true, clientX: cx + 10, clientY: cy }));

    // The store must now have adjustments set (non-default) on the element.
    const adjustments = readAdjustments(store, elementId);
    expect(adjustments).toBeDefined();
    // Default is [16667]. A 10-px rightward drag moves the handle, producing
    // a different corner radius ratio.
    expect(adjustments![0]).not.toBe(16667);
    // Sanity: undo must be possible (one batch was committed).
    expect(store.canUndo()).toBe(true);
  });

  it('does not commit when drag is below the 2px threshold', () => {
    const { overlay, store, elementId } = setupRoundRect();
    const handle = overlay.querySelector<HTMLDivElement>('[data-handle="adjust-0"]');
    expect(handle).not.toBeNull();
    const left = parseFloat(handle!.style.left);
    const top = parseFloat(handle!.style.top);
    const cx = left + 4;
    const cy = top + 4;

    handle!.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: cx, clientY: cy }));
    // Move only 1px — below the 2px threshold (sqrt(1²+0²)=1 < 2).
    document.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: cx + 1, clientY: cy }));
    document.dispatchEvent(new PointerEvent('pointerup',   { bubbles: true, clientX: cx + 1, clientY: cy }));

    // No store update → adjustments field absent (never written).
    const adjustments = readAdjustments(store, elementId);
    expect(adjustments).toBeUndefined();
  });

  it('preserves element selection after a real drag', () => {
    const { overlay, elementId } = setupRoundRect();
    const handle = overlay.querySelector<HTMLDivElement>('[data-handle="adjust-0"]');
    expect(handle).not.toBeNull();
    const left = parseFloat(handle!.style.left);
    const top = parseFloat(handle!.style.top);
    const cx = left + 4;
    const cy = top + 4;

    handle!.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: cx, clientY: cy }));
    document.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: cx + 10, clientY: cy }));
    document.dispatchEvent(new PointerEvent('pointerup',   { bubbles: true, clientX: cx + 10, clientY: cy }));

    // Selection must still contain the element after the drag commits.
    expect(editor!.getSelection()).toEqual([elementId]);
  });
});

describe('Editor — connector endpoint drag deadband', () => {
  let editor: SlidesEditor | null = null;

  beforeEach(() => {
    document.body.innerHTML = '';
    if (editor) {
      editor.detach();
      editor = null;
    }
  });

  /**
   * Build a fixture with a single connector and return the editor,
   * store, and connector id. hostWidth=1920 matches SLIDE_WIDTH so
   * scale=1 and overlay pixel positions equal logical slide coords.
   */
  function setupConnector() {
    const canvas = document.createElement('canvas');
    canvas.width = 1920;
    canvas.height = 1080;
    const overlay = document.createElement('div');
    overlay.style.position = 'absolute';
    document.body.appendChild(canvas);
    document.body.appendChild(overlay);
    const store = new MemSlidesStore();
    let slideId = '';
    let connectorId = '';
    store.batch(() => {
      slideId = store.addSlide('blank');
      connectorId = store.addElement(slideId, {
        type: 'connector',
        routing: 'straight',
        start: { kind: 'free', x: 100, y: 100 },
        end: { kind: 'free', x: 300, y: 100 },
        arrowheads: {},
        frame: { x: 100, y: 100, w: 200, h: 0, rotation: 0 },
      });
    });
    editor = initialize({ canvas, overlay, store, hostWidth: 1920, hostHeight: 1080, dpr: 1 });
    // Select the connector so the overlay renders its endpoint handles.
    editor.setSelection([connectorId]);
    return { canvas, overlay, store, connectorId };
  }

  it('pure click on an endpoint handle does not pollute the undo stack', () => {
    const { overlay, store } = setupConnector();
    // After setup the bootstrap batch (addSlide+addConnector) is the
    // only entry on the undo stack. `canUndo()` is boolean-only, so we
    // probe undo stack depth indirectly: a pure click that pollutes
    // the stack would leave `canUndo()` still true after one undo.
    expect(store.canUndo()).toBe(true);

    const handle = overlay.querySelector<HTMLDivElement>('[data-handle="start"]');
    expect(handle).not.toBeNull();
    const left = parseFloat(handle!.style.left);
    const top = parseFloat(handle!.style.top);
    // Click center of the handle (HANDLE_SIZE = 8, so half = 4).
    const cx = left + 4;
    const cy = top + 4;

    // mousedown + mouseup at exactly the same coords — pure click, no
    // movement. The 1px deadband in startConnectorEndpointDrag must
    // skip the store.batch wrap and leave the undo stack untouched.
    handle!.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: cx, clientY: cy }));
    document.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: cx, clientY: cy }));

    // One undo drains the bootstrap entry; if the deadband had pushed
    // a second entry, `canUndo()` would still be true here.
    store.undo();
    expect(store.canUndo()).toBe(false);
  });

  it('drag past the 1px deadband commits and grows the undo stack', () => {
    const { overlay, store } = setupConnector();
    // Bootstrap entry is the only thing on the stack at this point.
    expect(store.canUndo()).toBe(true);

    const handle = overlay.querySelector<HTMLDivElement>('[data-handle="start"]');
    expect(handle).not.toBeNull();
    const left = parseFloat(handle!.style.left);
    const top = parseFloat(handle!.style.top);
    const cx = left + 4;
    const cy = top + 4;

    // Move 5px — comfortably past the 1px deadband (sqrt(5²+0²)=5 > 1).
    handle!.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: cx, clientY: cy }));
    document.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: cx + 5, clientY: cy }));
    document.dispatchEvent(new PointerEvent('pointerup',   { bubbles: true, clientX: cx + 5, clientY: cy }));

    // Two entries now: bootstrap + drag commit. One undo pops the
    // drag entry but leaves the bootstrap entry behind — so `canUndo()`
    // remains true. Confirms the commit pushed a fresh undo entry.
    store.undo();
    expect(store.canUndo()).toBe(true);
  });

  it('mid-drag: real handle stays anchored at the pre-drag position', () => {
    // The canvas-side ghost line is painted via the renderer's
    // `forceRender(slide, doc, ghost)` slot — covered by the renderer's
    // own tests. Here we only assert the overlay-side invariant: the
    // handle DOM does NOT follow the cursor during the drag, so the
    // user has a stable anchor to compare the ghost line against.
    const { overlay } = setupConnector();
    const handle = overlay.querySelector<HTMLDivElement>('[data-handle="start"]');
    expect(handle).not.toBeNull();
    const initialLeft = parseFloat(handle!.style.left);
    const initialTop = parseFloat(handle!.style.top);
    const cx = initialLeft + 4;
    const cy = initialTop + 4;

    handle!.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: cx, clientY: cy }));
    document.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: cx + 50, clientY: cy + 30 }));

    const realStart = overlay.querySelector<HTMLDivElement>('[data-handle="start"]')!;
    expect(realStart).not.toBeNull();
    expect(parseFloat(realStart.style.left)).toBe(initialLeft);
    expect(parseFloat(realStart.style.top)).toBe(initialTop);

    document.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: cx + 50, clientY: cy + 30 }));
  });
});

describe('Editor — dragging connectors translates endpoints', () => {
  let editor: SlidesEditor | null = null;

  beforeEach(() => {
    document.body.innerHTML = '';
    if (editor) {
      editor.detach();
      editor = null;
    }
  });

  /**
   * Fixture with a diagonal connector so its bbox frame is non-degenerate
   * (width 200, height 100) and can be hit-tested by a click on its body.
   */
  function setupDiagonalConnector() {
    const canvas = document.createElement('canvas');
    canvas.width = 1920;
    canvas.height = 1080;
    const overlay = document.createElement('div');
    overlay.style.position = 'absolute';
    document.body.appendChild(canvas);
    document.body.appendChild(overlay);
    const store = new MemSlidesStore();
    let slideId = '';
    let connectorId = '';
    store.batch(() => {
      slideId = store.addSlide('blank');
      connectorId = store.addElement(slideId, {
        type: 'connector',
        routing: 'straight',
        start: { kind: 'free', x: 100, y: 100 },
        end:   { kind: 'free', x: 300, y: 200 },
        arrowheads: {},
        frame: { x: 100, y: 100, w: 200, h: 100, rotation: 0 },
      });
    });
    editor = initialize({ canvas, overlay, store, hostWidth: 1920, hostHeight: 1080, dpr: 1 });
    return { canvas, overlay, store, slideId, connectorId };
  }

  it('drags a connector via its body without throwing and translates free endpoints', () => {
    const { canvas, store, connectorId } = setupDiagonalConnector();
    editor!.setSelection([connectorId]);

    // Click inside the connector bbox (which contains the diagonal line).
    canvas.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: 200, clientY: 150 }));
    document.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: 250, clientY: 170 }));
    document.dispatchEvent(new PointerEvent('pointerup',   { bubbles: true, clientX: 250, clientY: 170 }));

    const slide = store.read().slides[0];
    const el = slide.elements.find((e) => e.id === connectorId);
    expect(el?.type).toBe('connector');
    if (el?.type !== 'connector') throw new Error('unreachable');
    // Endpoints translated by (+50, +20).
    expect(el.start).toEqual({ kind: 'free', x: 150, y: 120 });
    expect(el.end).toEqual({ kind: 'free', x: 350, y: 220 });
  });

  it('multi-select drag translates a connector alongside a shape', () => {
    const canvas = document.createElement('canvas');
    canvas.width = 1920;
    canvas.height = 1080;
    const overlay = document.createElement('div');
    overlay.style.position = 'absolute';
    document.body.appendChild(canvas);
    document.body.appendChild(overlay);
    const store = new MemSlidesStore();
    let slideId = '';
    let shapeId = '';
    let connectorId = '';
    store.batch(() => {
      slideId = store.addSlide('blank');
      shapeId = store.addElement(slideId, {
        type: 'shape',
        frame: { x: 500, y: 500, w: 200, h: 100, rotation: 0 },
        data: { kind: 'rect', fill: { kind: 'srgb' as const, value: '#abc' } },
      });
      connectorId = store.addElement(slideId, {
        type: 'connector',
        routing: 'straight',
        start: { kind: 'free', x: 100, y: 100 },
        end:   { kind: 'free', x: 300, y: 200 },
        arrowheads: {},
        frame: { x: 100, y: 100, w: 200, h: 100, rotation: 0 },
      });
    });
    editor = initialize({ canvas, overlay, store, hostWidth: 1920, hostHeight: 1080, dpr: 1 });
    editor.setSelection([shapeId, connectorId]);

    // Drag from inside the shape — no shift, so the existing multi-select
    // is preserved (per `selectAt`'s already-selected guard).
    canvas.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: 600, clientY: 550 }));
    document.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: 610, clientY: 560 }));
    document.dispatchEvent(new PointerEvent('pointerup',   { bubbles: true, clientX: 610, clientY: 560 }));

    const slide = store.read().slides[0];
    const shape = slide.elements.find((e) => e.id === shapeId)!;
    const connector = slide.elements.find((e) => e.id === connectorId)!;
    expect(shape.frame.x).toBe(510);
    expect(shape.frame.y).toBe(510);
    if (connector.type !== 'connector') throw new Error('unreachable');
    expect(connector.start).toEqual({ kind: 'free', x: 110, y: 110 });
    expect(connector.end).toEqual({ kind: 'free', x: 310, y: 210 });
  });

  it('body-drag of a half-attached connector translates the free end and leaves the attached end pinned', () => {
    const canvas = document.createElement('canvas');
    canvas.width = 1920;
    canvas.height = 1080;
    const overlay = document.createElement('div');
    overlay.style.position = 'absolute';
    document.body.appendChild(canvas);
    document.body.appendChild(overlay);
    const store = new MemSlidesStore();
    let slideId = '';
    let hostId = '';
    let connectorId = '';
    store.batch(() => {
      slideId = store.addSlide('blank');
      // Tiny host tucked in the corner — its connection site is near
      // (25, 10), so the connector's straight line spans from there to
      // its free end at (300, 200). The click target lands directly on
      // the line (precise hit-test requires this — bbox-only clicks no
      // longer select connectors), and the host is far enough from the
      // dragged path edges that snap (8px threshold) can't engage.
      hostId = store.addElement(slideId, {
        type: 'shape',
        frame: { x: 10, y: 10, w: 30, h: 30, rotation: 0 },
        data: { kind: 'rect', fill: { kind: 'srgb' as const, value: '#abc' } },
      });
      connectorId = store.addElement(slideId, {
        type: 'connector',
        routing: 'straight',
        start: { kind: 'attached', elementId: hostId, siteIndex: 0 },
        end:   { kind: 'free', x: 300, y: 200 },
        arrowheads: {},
        frame: { x: 25, y: 10, w: 275, h: 190, rotation: 0 },
      });
    });
    editor = initialize({ canvas, overlay, store, hostWidth: 1920, hostHeight: 1080, dpr: 1 });
    editor.setSelection([connectorId]);

    // Drag the connector body by (+30, +15). The pointerdown lands on
    // the midpoint of the line from (25, 10) to (300, 200) so the
    // precise hit-test selects the connector.
    canvas.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: 162, clientY: 105 }));
    document.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: 192, clientY: 120 }));
    document.dispatchEvent(new PointerEvent('pointerup',   { bubbles: true, clientX: 192, clientY: 120 }));

    const slide = store.read().slides[0];
    const connector = slide.elements.find((e) => e.id === connectorId)!;
    if (connector.type !== 'connector') throw new Error('unreachable');
    // Attached endpoint untouched — host did not move, so the renderer
    // keeps it pinned. Free endpoint translated by the drag delta.
    expect(connector.start).toEqual({ kind: 'attached', elementId: hostId, siteIndex: 0 });
    expect(connector.end).toEqual({ kind: 'free', x: 330, y: 215 });
    // Sanity: the host frame did not move.
    const host = slide.elements.find((e) => e.id === hostId)!;
    expect(host.frame.x).toBe(10);
    expect(host.frame.y).toBe(10);
  });

  it('body-drag of a fully-attached connector leaves both endpoints anchored to their hosts', () => {
    // The "attachment wins" contract: when both endpoints attach to
    // shapes not in the selection, translating the connector commits
    // zero ops — the renderer keeps both ends pinned to their hosts.
    const canvas = document.createElement('canvas');
    canvas.width = 1920;
    canvas.height = 1080;
    const overlay = document.createElement('div');
    overlay.style.position = 'absolute';
    document.body.appendChild(canvas);
    document.body.appendChild(overlay);
    const store = new MemSlidesStore();
    let slideId = '';
    let hostAId = '';
    let hostBId = '';
    let connectorId = '';
    store.batch(() => {
      slideId = store.addSlide('blank');
      hostAId = store.addElement(slideId, {
        type: 'shape',
        frame: { x: 10, y: 10, w: 30, h: 30, rotation: 0 },
        data: { kind: 'rect', fill: { kind: 'srgb' as const, value: '#abc' } },
      });
      hostBId = store.addElement(slideId, {
        type: 'shape',
        frame: { x: 300, y: 200, w: 30, h: 30, rotation: 0 },
        data: { kind: 'rect', fill: { kind: 'srgb' as const, value: '#abc' } },
      });
      connectorId = store.addElement(slideId, {
        type: 'connector',
        routing: 'straight',
        start: { kind: 'attached', elementId: hostAId, siteIndex: 0 },
        end:   { kind: 'attached', elementId: hostBId, siteIndex: 0 },
        arrowheads: {},
        frame: { x: 25, y: 10, w: 290, h: 190, rotation: 0 },
      });
    });
    editor = initialize({ canvas, overlay, store, hostWidth: 1920, hostHeight: 1080, dpr: 1 });
    editor.setSelection([connectorId]);

    canvas.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: 200, clientY: 150 }));
    document.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: 230, clientY: 165 }));
    document.dispatchEvent(new PointerEvent('pointerup',   { bubbles: true, clientX: 230, clientY: 165 }));

    const slide = store.read().slides[0];
    const connector = slide.elements.find((e) => e.id === connectorId)!;
    if (connector.type !== 'connector') throw new Error('unreachable');
    // Both endpoints retain the attachment to their original hosts.
    expect(connector.start).toEqual({ kind: 'attached', elementId: hostAId, siteIndex: 0 });
    expect(connector.end).toEqual({ kind: 'attached', elementId: hostBId, siteIndex: 0 });
    // Hosts did not move either.
    const hostA = slide.elements.find((e) => e.id === hostAId)!;
    const hostB = slide.elements.find((e) => e.id === hostBId)!;
    expect(hostA.frame.x).toBe(10);
    expect(hostB.frame.x).toBe(300);
  });

  it('keyboard arrow nudge translates a connector', () => {
    const { canvas, store, connectorId } = setupDiagonalConnector();
    editor!.setSelection([connectorId]);

    // Nudge right by 1px.
    canvas.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }));

    const slide = store.read().slides[0];
    const el = slide.elements.find((e) => e.id === connectorId);
    if (el?.type !== 'connector') throw new Error('unreachable');
    expect(el.start).toEqual({ kind: 'free', x: 101, y: 100 });
    expect(el.end).toEqual({ kind: 'free', x: 301, y: 200 });
  });
});

describe('Editor canvas context menu — Change layout', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    (showLayoutPicker as unknown as ReturnType<typeof vi.fn>).mockClear?.();
  });

  it('right-clicking the slide background opens a context menu with "Change layout…"', () => {
    const { canvas, overlay, store } = makeFixture();
    const ed = initialize({ canvas, overlay, store, hostWidth: 1920, hostHeight: 1080, dpr: 1 });
    canvas.dispatchEvent(new MouseEvent('contextmenu', {
      clientX: 50, clientY: 50, bubbles: true, cancelable: true,
    }));
    const menu = document.querySelector('.wfb-slides-context-menu') as HTMLElement;
    expect(menu).toBeTruthy();
    const labels = [...menu.querySelectorAll('li')].map((li) => li.textContent);
    expect(labels).toContain('Change layout…');
    ed.detach();
  });

  it('clicking "Change layout…" opens the picker with selectedLayoutId set to the current slide layout', () => {
    const { canvas, overlay, store } = makeFixture(); // makeFixture creates a 'blank' slide
    const ed = initialize({ canvas, overlay, store, hostWidth: 1920, hostHeight: 1080, dpr: 1 });
    canvas.dispatchEvent(new MouseEvent('contextmenu', {
      clientX: 50, clientY: 75, bubbles: true, cancelable: true,
    }));
    const menu = document.querySelector('.wfb-slides-context-menu') as HTMLElement;
    const item = [...menu.querySelectorAll('li')].find((li) => li.textContent === 'Change layout…') as HTMLElement;
    item.click();
    expect(showLayoutPicker).toHaveBeenCalled();
    const call = (showLayoutPicker as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    const opts = call[1] as { selectedLayoutId?: string; anchor: { x: number; y: number }; onPick: (id: string) => void };
    expect(opts.selectedLayoutId).toBe('blank');
    expect(opts.anchor).toEqual({ x: 50, y: 75 });

    // onPick wiring: picking a layout calls store.applyLayout under store.batch.
    const slideId = store.read().slides[0].id;
    opts.onPick('title-body');
    expect(store.read().slides.find((s) => s.id === slideId)!.layoutId).toBe('title-body');
    ed.detach();
  });
});

// ---------------------------------------------------------------------------
// Task 9 Phase C — scope-aware overlay at rest
// ---------------------------------------------------------------------------

describe('repaintOverlay — scope-aware drilled-in element handles', () => {
  let editor: SlidesEditor | null = null;

  beforeEach(() => {
    document.body.innerHTML = '';
    if (editor) {
      editor.detach();
      editor = null;
    }
  });

  /**
   * Build a slide with one group at (100, 200, 200, 100) containing one
   * child rect. The child is stored at group-local (20, 10, 60, 40, rot=0).
   * World position of the child: (100+20, 200+10) = (120, 210).
   *
   * After drilling into the group and selecting the child, the overlay
   * handles must appear at the WORLD nw corner (120, 210), not at the
   * group-local corner (20, 10).
   */
  it('places nw handle at world coordinates, not group-local, when a nested child is selected at rest', () => {
    const canvas = document.createElement('canvas');
    canvas.width = 1920;
    canvas.height = 1080;
    const overlay = document.createElement('div');
    overlay.style.position = 'absolute';
    document.body.appendChild(canvas);
    document.body.appendChild(overlay);

    const store = new MemSlidesStore();
    let sid!: string;
    let childId!: string;
    let groupId!: string;
    store.batch(() => {
      sid = store.addSlide('blank');
      // Add two sibling shapes that will be grouped.
      // a: world (100, 200, 80, 50), b: world (180, 210, 80, 40)
      // AABB of a+b: x=100, y=200, w=160, h=50.
      const aId = store.addElement(sid, {
        type: 'shape',
        frame: { x: 100, y: 200, w: 80, h: 50, rotation: 0 },
        data: { kind: 'rect' },
      });
      const bId = store.addElement(sid, {
        type: 'shape',
        frame: { x: 180, y: 210, w: 80, h: 40, rotation: 0 },
        data: { kind: 'rect' },
      });
      ({ groupId } = store.group(sid, [aId, bId]));
      // After grouping, the first child (aId) is in group-local space.
      // group bbox = (100, 200, 160, 50); aId local = (0, 0, 80, 50).
      childId = aId;
    });

    editor = initialize({ canvas, overlay, store, hostWidth: 1920, hostHeight: 1080, dpr: 1 });

    // Directly set scope + selection to simulate a drill-in state.
    // We cast to access the internal `selection` field (which is public
    // on SlidesEditorImpl but not on the SlidesEditor interface).
    const impl = editor as unknown as { selection: import('../../../src/view/editor/selection').Selection };
    impl.selection.setScope([groupId]);
    impl.selection.set([childId]);
    // The subscriber fires synchronously from set(), so repaintOverlay
    // has already run. Check the overlay DOM.

    // At scale 1 (hostWidth 1920 = slide width 1920), handles are placed
    // in host pixels = logical pixels. The child (aId) is at group-local
    // (0, 0, 80, 50); group at world (100, 200, 160, 50).
    // So child world position = (100, 200), nw handle at (100, 200).
    const HANDLE_SIZE = 8;
    const nw = overlay.querySelector<HTMLDivElement>('[data-handle="nw"]');
    expect(nw).not.toBeNull();
    const left = parseFloat(nw!.style.left);
    const top = parseFloat(nw!.style.top);
    // World nw = (100, 200). Handle centred: left = 100 - 4, top = 200 - 4.
    expect(left).toBeCloseTo(100 - HANDLE_SIZE / 2, 1);
    expect(top).toBeCloseTo(200 - HANDLE_SIZE / 2, 1);
    // Confirm it is NOT at the group-local nw (0, 0).
    expect(left).not.toBeCloseTo(0 - HANDLE_SIZE / 2, 0);
  });

  it('places handles at world coordinates for a child in a rotated group', () => {
    const canvas = document.createElement('canvas');
    canvas.width = 1920;
    canvas.height = 1080;
    const overlay = document.createElement('div');
    overlay.style.position = 'absolute';
    document.body.appendChild(canvas);
    document.body.appendChild(overlay);

    const store = new MemSlidesStore();
    let sid!: string;
    let childId!: string;
    let groupId!: string;
    store.batch(() => {
      sid = store.addSlide('blank');
      const aId = store.addElement(sid, {
        type: 'shape',
        frame: { x: 100, y: 200, w: 80, h: 50, rotation: 0 },
        data: { kind: 'rect' },
      });
      const bId = store.addElement(sid, {
        type: 'shape',
        frame: { x: 180, y: 210, w: 80, h: 40, rotation: 0 },
        data: { kind: 'rect' },
      });
      ({ groupId } = store.group(sid, [aId, bId]));
      childId = aId;
    });

    // Rotate the group by π/2.
    const gEl = store.read().slides[0].elements[0];
    const rotatedGroupFrame = { ...gEl.frame, rotation: Math.PI / 2 };
    store.batch(() => store.updateElementFrame(sid, groupId, rotatedGroupFrame));

    editor = initialize({ canvas, overlay, store, hostWidth: 1920, hostHeight: 1080, dpr: 1 });
    const impl = editor as unknown as { selection: import('../../../src/view/editor/selection').Selection };
    impl.selection.setScope([groupId]);
    impl.selection.set([childId]);

    // With a rotated group, the single rotated-element path in renderOverlay
    // applies. The important thing is that handles ARE rendered (i.e. the
    // child was found and its world frame computed), and the outline has a
    // CSS transform rotate applied.
    const outline = overlay.querySelector<HTMLDivElement>('.wfb-slides-selection-frame');
    expect(outline).not.toBeNull();
    // The world frame has a non-zero rotation, so CSS transform is set.
    expect(outline!.style.transform).toMatch(/rotate\(/);
  });
});

// ---------------------------------------------------------------------------
// Drill-in click handler tests (Task 9)
// ---------------------------------------------------------------------------

/**
 * Build a fixture with two shapes grouped together at slide-root.
 *
 * Shape A: world (100, 100, 100, 80)
 * Shape B: world (300, 200, 80, 60)
 * Group:   world AABB of A and B = (100, 100, 280, 160)
 *
 * After grouping, children are in group-local space. Shape A is at
 * group-local (0, 0, 100, 80) and Shape B is at group-local (200, 100, 80, 60).
 * A world click at (150, 140) = group-local (50, 40) hits Shape A.
 */
function makeGroupedFixture() {
  const canvas = document.createElement('canvas');
  canvas.width = 1920;
  canvas.height = 1080;
  const overlay = document.createElement('div');
  overlay.style.position = 'absolute';
  document.body.appendChild(canvas);
  document.body.appendChild(overlay);

  const store = new MemSlidesStore();
  let slideId!: string;
  let aId!: string;
  let bId!: string;
  let groupId!: string;
  store.batch(() => {
    slideId = store.addSlide('blank');
    aId = store.addElement(slideId, {
      type: 'shape',
      frame: { x: 100, y: 100, w: 100, h: 80, rotation: 0 },
      data: { kind: 'rect', fill: { kind: 'srgb' as const, value: '#abc' } },
    });
    bId = store.addElement(slideId, {
      type: 'shape',
      frame: { x: 300, y: 200, w: 80, h: 60, rotation: 0 },
      data: { kind: 'rect', fill: { kind: 'srgb' as const, value: '#0a0' } },
    });
    ({ groupId } = store.group(slideId, [aId, bId]));
  });

  return { canvas, overlay, store, slideId, aId, bId, groupId };
}

type SelectionImpl = {
  selection: import('../../../src/view/editor/selection').Selection;
};

describe('drill-in click handlers (Task 9)', () => {
  let editor: SlidesEditor | null = null;

  beforeEach(() => {
    document.body.innerHTML = '';
    if (editor) {
      editor.detach();
      editor = null;
    }
  });

  it('right-click on a group child selects the outermost group (drill-in rules)', () => {
    // Right-click should route through the same Selection.click drill-in
    // state machine as single-click. Without that, selection lands on the
    // leaf child (whose frame is in group-local coords) and the overlay
    // renders handles at the wrong position; the Ungroup menu item also
    // stays disabled because selection is no longer the group.
    const { canvas, overlay, store, aId, groupId } = makeGroupedFixture();
    editor = initialize({ canvas, overlay, store, hostWidth: 1920, hostHeight: 1080, dpr: 1 });
    canvas.dispatchEvent(new MouseEvent('contextmenu', {
      clientX: 150, clientY: 140, bubbles: true,
    }));
    // scope is empty, hit.ancestorPath is [groupId, aId]; pickAtScope
    // returns ancestorPath[0] = groupId.
    expect(editor.getSelection()).toEqual([groupId]);
    expect(editor.getSelection()).not.toContain(aId);
  });

  it('single click on a group child selects the outermost group, not the child', () => {
    const { canvas, overlay, store, aId, groupId } = makeGroupedFixture();
    editor = initialize({ canvas, overlay, store, hostWidth: 1920, hostHeight: 1080, dpr: 1 });
    // Click inside shape A's world bounds (150, 140). With Selection.click
    // and scope=[], the outermost ancestor should be selected.
    canvas.dispatchEvent(new PointerEvent('pointerdown', {
      clientX: 150, clientY: 140, bubbles: true,
    }));
    // scope is empty, so pickAtScope returns ancestorPath[0] = groupId.
    expect(editor.getSelection()).toEqual([groupId]);
    // The inner child aId should NOT be directly in the selection.
    expect(editor.getSelection()).not.toContain(aId);
  });

  it('double-click on a group child drills in and selects the child', () => {
    const { canvas, overlay, store, aId, groupId } = makeGroupedFixture();
    editor = initialize({ canvas, overlay, store, hostWidth: 1920, hostHeight: 1080, dpr: 1 });
    const impl = editor as unknown as SelectionImpl;

    // Double-click inside shape A's world bounds (150, 140).
    canvas.dispatchEvent(new MouseEvent('dblclick', {
      clientX: 150, clientY: 140, bubbles: true,
    }));
    // After double-click, scope should be [groupId] and ids should be [aId].
    expect(impl.selection.getScope()).toEqual([groupId]);
    expect(editor.getSelection()).toEqual([aId]);
  });
});

// ---------------------------------------------------------------------------
// editor.group() / editor.ungroup() methods
// ---------------------------------------------------------------------------

describe('editor.group() / editor.ungroup()', () => {
  let editor: SlidesEditor | null = null;

  beforeEach(() => {
    document.body.innerHTML = '';
    if (editor) { editor.detach(); editor = null; }
  });

  function makeTwoShapeFixture() {
    const canvas = document.createElement('canvas');
    canvas.width = 960; canvas.height = 540;
    const overlay = document.createElement('div');
    document.body.appendChild(canvas);
    document.body.appendChild(overlay);
    const store = new MemSlidesStore();
    let slideId = '';
    let aId = '';
    let bId = '';
    store.batch(() => {
      slideId = store.addSlide('blank');
      aId = store.addElement(slideId, {
        type: 'shape',
        frame: { x: 0,   y: 0, w: 100, h: 100, rotation: 0 },
        data: { kind: 'rect', fill: { kind: 'srgb' as const, value: '#f00' } },
      });
      bId = store.addElement(slideId, {
        type: 'shape',
        frame: { x: 200, y: 0, w: 100, h: 100, rotation: 0 },
        data: { kind: 'rect', fill: { kind: 'srgb' as const, value: '#00f' } },
      });
    });
    const e = initialize({ canvas, overlay, store, hostWidth: 960, hostHeight: 540, dpr: 1 });
    return { editor: e, store, slideId, aId, bId };
  }

  it('group() with ≥2 elements creates a GroupElement and selects it', () => {
    const { editor: e, store, slideId, aId, bId } = makeTwoShapeFixture();
    editor = e;
    editor.setSelection([aId, bId]);
    editor.group();
    const slide = store.read().slides.find((s) => s.id === slideId)!;
    expect(slide.elements).toHaveLength(1);
    expect(slide.elements[0].type).toBe('group');
    expect(editor.getSelection()).toEqual([slide.elements[0].id]);
  });

  it('group() with <2 elements is a no-op', () => {
    const { editor: e, store, slideId, aId } = makeTwoShapeFixture();
    editor = e;
    editor.setSelection([aId]);
    editor.group();
    const slide = store.read().slides.find((s) => s.id === slideId)!;
    expect(slide.elements).toHaveLength(2);
  });

  it('ungroup() with a group selection dissolves it and selects children', () => {
    const { editor: e, store, slideId, aId, bId } = makeTwoShapeFixture();
    editor = e;
    let groupId = '';
    store.batch(() => {
      groupId = store.group(slideId, [aId, bId]).groupId;
    });
    editor.setSelection([groupId]);
    editor.ungroup();
    const slide = store.read().slides.find((s) => s.id === slideId)!;
    expect(slide.elements).toHaveLength(2);
    const childIds = editor.getSelection();
    expect(childIds).toHaveLength(2);
    expect(childIds).toContain(aId);
    expect(childIds).toContain(bId);
  });

  it('ungroup() with a plain shape selection is a no-op', () => {
    const { editor: e, store, slideId, aId } = makeTwoShapeFixture();
    editor = e;
    editor.setSelection([aId]);
    editor.ungroup();
    const slide = store.read().slides.find((s) => s.id === slideId)!;
    expect(slide.elements).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// Context-menu Group / Ungroup items
// ---------------------------------------------------------------------------

describe('context menu — Group / Ungroup items', () => {
  let editor: SlidesEditor | null = null;

  beforeEach(() => {
    document.body.innerHTML = '';
    (showLayoutPicker as unknown as ReturnType<typeof vi.fn>).mockClear?.();
    if (editor) { editor.detach(); editor = null; }
  });

  function makeTwoShapeOnSameSlide() {
    const canvas = document.createElement('canvas');
    canvas.width = 1920; canvas.height = 1080;
    const overlay = document.createElement('div');
    document.body.appendChild(canvas);
    document.body.appendChild(overlay);
    const store = new MemSlidesStore();
    let slideId = '';
    let aId = '';
    let bId = '';
    store.batch(() => {
      slideId = store.addSlide('blank');
      // Place shapes so right-clicking either hits them in the test.
      aId = store.addElement(slideId, {
        type: 'shape',
        frame: { x: 100, y: 100, w: 200, h: 200, rotation: 0 },
        data: { kind: 'rect', fill: { kind: 'srgb' as const, value: '#f00' } },
      });
      bId = store.addElement(slideId, {
        type: 'shape',
        frame: { x: 600, y: 100, w: 200, h: 200, rotation: 0 },
        data: { kind: 'rect', fill: { kind: 'srgb' as const, value: '#00f' } },
      });
    });
    const e = initialize({ canvas, overlay, store, hostWidth: 1920, hostHeight: 1080, dpr: 1 });
    return { editor: e, store, canvas, slideId, aId, bId };
  }

  it('Group item is enabled when ≥2 elements are selected', () => {
    const { editor: e, canvas, aId, bId } = makeTwoShapeOnSameSlide();
    editor = e;
    // Select both shapes before right-clicking.
    editor.setSelection([aId, bId]);
    // Right-click on shape A's location.
    canvas.dispatchEvent(new MouseEvent('contextmenu', {
      clientX: 200, clientY: 200, bubbles: true, cancelable: true,
    }));
    const menu = document.querySelector('.wfb-slides-context-menu') as HTMLElement;
    expect(menu).toBeTruthy();
    const groupLi = [...menu.querySelectorAll('li')].find(
      (li) => li.textContent?.trim() === 'Group',
    ) as HTMLElement | undefined;
    expect(groupLi).toBeTruthy();
    expect(groupLi!.style.opacity).not.toBe('0.5'); // not disabled
  });

  it('Group item is disabled when only 1 element is selected', () => {
    const { editor: e, canvas, aId } = makeTwoShapeOnSameSlide();
    editor = e;
    editor.setSelection([aId]);
    canvas.dispatchEvent(new MouseEvent('contextmenu', {
      clientX: 200, clientY: 200, bubbles: true, cancelable: true,
    }));
    const menu = document.querySelector('.wfb-slides-context-menu') as HTMLElement;
    const groupLi = [...menu.querySelectorAll('li')].find(
      (li) => li.textContent?.trim() === 'Group',
    ) as HTMLElement | undefined;
    expect(groupLi).toBeTruthy();
    expect(groupLi!.style.opacity).toBe('0.5'); // disabled
  });

  it('Ungroup item is enabled when right-click descends to a group at slide-root scope', () => {
    // Right-click routes through Selection.click. At scope=[] with the
    // click hitting a group child, drill-in rules pick the outermost
    // group as the selection, so the Ungroup predicate is satisfied.
    const { editor: e, store, canvas, slideId, aId, bId } = makeTwoShapeOnSameSlide();
    editor = e;
    let groupId = '';
    store.batch(() => {
      groupId = store.group(slideId, [aId, bId]).groupId;
    });
    // Pre-clear selection so the right-click re-resolves through drill-in.
    editor.setSelection([]);
    canvas.dispatchEvent(new MouseEvent('contextmenu', {
      clientX: 200, clientY: 200, bubbles: true, cancelable: true,
    }));
    expect(editor.getSelection()).toEqual([groupId]);
    const menu = document.querySelector('.wfb-slides-context-menu') as HTMLElement;
    const ungroupLi = [...menu.querySelectorAll('li')].find(
      (li) => li.textContent?.trim() === 'Ungroup',
    ) as HTMLElement | undefined;
    expect(ungroupLi).toBeTruthy();
    expect(ungroupLi!.style.opacity).not.toBe('0.5');
  });
});

describe('Editor — group() with connector exclusion calls onToast', () => {
  let editor: SlidesEditor | null = null;

  beforeEach(() => {
    document.body.innerHTML = '';
    if (editor) {
      editor.detach();
      editor = null;
    }
  });

  it('fires onToast when a connector with an external endpoint is excluded', () => {
    const { canvas, overlay, store } = makeFixture();
    const toastCb = vi.fn();

    let e!: SlidesEditor;
    let sid!: string;
    let a!: string;
    let b!: string;
    let outside!: string;
    let c!: string;

    // Build slide with two shapes (a, b), one external shape (outside), and
    // a connector (c) with one endpoint on `a` and the other on `outside`.
    const doc = store.read();
    sid = doc.slides[0].id;
    store.batch(() => {
      a = store.addElement(sid, {
        type: 'shape',
        frame: { x: 0, y: 0, w: 50, h: 50, rotation: 0 },
        data: { kind: 'rect' },
      });
      b = store.addElement(sid, {
        type: 'shape',
        frame: { x: 100, y: 0, w: 50, h: 50, rotation: 0 },
        data: { kind: 'rect' },
      });
      outside = store.addElement(sid, {
        type: 'shape',
        frame: { x: 300, y: 0, w: 50, h: 50, rotation: 0 },
        data: { kind: 'rect' },
      });
      c = store.addElement(sid, {
        type: 'connector',
        routing: 'straight',
        start: { kind: 'attached', elementId: a, siteIndex: 0 },
        end:   { kind: 'attached', elementId: outside, siteIndex: 0 },
        arrowheads: {},
        frame: { x: 0, y: 0, w: 0, h: 0, rotation: 0 },
      });
    });

    e = initialize({
      canvas, overlay, store,
      hostWidth: 960, hostHeight: 540, dpr: 1,
      onToast: toastCb,
    });
    editor = e;

    // Select a, b, and c; group them.
    e.setSelection([a, b, c]);
    e.group();

    // onToast should have been called once with a message about the excluded connector.
    expect(toastCb).toHaveBeenCalledTimes(1);
    expect(toastCb.mock.calls[0][0]).toMatch(/1 connector/i);
    expect(toastCb.mock.calls[0][0]).toMatch(/excluded/i);
  });

  it('does NOT fire onToast when all connectors join the group', () => {
    const { canvas, overlay, store } = makeFixture();
    const toastCb = vi.fn();

    let e!: SlidesEditor;
    let sid!: string;
    let a!: string;
    let b!: string;
    let c!: string;

    const doc = store.read();
    sid = doc.slides[0].id;
    store.batch(() => {
      a = store.addElement(sid, {
        type: 'shape',
        frame: { x: 0, y: 0, w: 50, h: 50, rotation: 0 },
        data: { kind: 'rect' },
      });
      b = store.addElement(sid, {
        type: 'shape',
        frame: { x: 100, y: 0, w: 50, h: 50, rotation: 0 },
        data: { kind: 'rect' },
      });
      // Connector between a and b — both endpoints are inside the selection.
      c = store.addElement(sid, {
        type: 'connector',
        routing: 'straight',
        start: { kind: 'attached', elementId: a, siteIndex: 0 },
        end:   { kind: 'attached', elementId: b, siteIndex: 0 },
        arrowheads: {},
        frame: { x: 0, y: 0, w: 0, h: 0, rotation: 0 },
      });
    });

    e = initialize({
      canvas, overlay, store,
      hostWidth: 960, hostHeight: 540, dpr: 1,
      onToast: toastCb,
    });
    editor = e;

    e.setSelection([a, b, c]);
    e.group();

    // No connectors excluded → no toast.
    expect(toastCb).not.toHaveBeenCalled();
  });
});

describe('repaintOverlay — group selection visuals', () => {
  let editor: SlidesEditor | null = null;

  beforeEach(() => {
    document.body.innerHTML = '';
    if (editor) {
      editor.detach();
      editor = null;
    }
  });

  afterEach(() => {
    if (editor) {
      editor.detach();
      editor = null;
    }
    document.body.innerHTML = '';
  });

  function addShape(
    store: MemSlidesStore,
    sid: string,
    x: number,
    y: number,
    w: number,
    h: number,
  ): string {
    let id = '';
    store.batch(() => {
      id = store.addElement(sid, {
        type: 'shape',
        frame: { x, y, w, h, rotation: 0 },
        data: { kind: 'rect', fill: { kind: 'srgb' as const, value: '#abc' } },
      });
    });
    return id;
  }

  it('outlines each member when a group is selected', () => {
    const { canvas, overlay, store } = makeFixture();
    const sid = store.read().slides[0].id;
    const aId = addShape(store, sid, 100, 100, 50, 50);
    const bId = addShape(store, sid, 300, 100, 50, 50);
    let groupId = '';
    store.batch(() => {
      groupId = store.group(sid, [aId, bId]).groupId;
    });
    editor = initialize({
      canvas,
      overlay,
      store,
      hostWidth: 1920,
      hostHeight: 1080,
      dpr: 1,
    });
    editor.setSelection([groupId]);

    expect(
      overlay.querySelectorAll('.wfb-slides-member-outline').length,
    ).toBe(2);
    // The group itself still gets resize handles.
    expect(overlay.querySelector('[data-handle="nw"]')).not.toBeNull();
  });

  it('does not outline members for a single non-group element', () => {
    const { canvas, overlay, store } = makeFixture();
    const sid = store.read().slides[0].id;
    const id = addShape(store, sid, 100, 100, 50, 50);
    editor = initialize({
      canvas,
      overlay,
      store,
      hostWidth: 1920,
      hostHeight: 1080,
      dpr: 1,
    });
    editor.setSelection([id]);

    expect(
      overlay.querySelectorAll('.wfb-slides-member-outline').length,
    ).toBe(0);
  });

  it('shows a context box around the group when drilled into a child', () => {
    const { canvas, overlay, store } = makeGroupedFixture();
    editor = initialize({
      canvas,
      overlay,
      store,
      hostWidth: 1920,
      hostHeight: 1080,
      dpr: 1,
    });
    // Double-click inside shape A's world bounds (150, 140) drills in.
    canvas.dispatchEvent(
      new MouseEvent('dblclick', { clientX: 150, clientY: 140, bubbles: true }),
    );

    // The enclosing group is shown as a context box; the drilled-in
    // child is a shape, so there are no member outlines.
    expect(overlay.querySelectorAll('.wfb-slides-context-box').length).toBe(1);
    expect(
      overlay.querySelectorAll('.wfb-slides-member-outline').length,
    ).toBe(0);
  });
});

describe('elementContextItems — text vertical align', () => {
  let editor: SlidesEditor | null = null;

  beforeEach(() => {
    document.body.innerHTML = '';
    if (editor) {
      editor.detach();
      editor = null;
    }
  });

  type ContextItemLike = { label: string; selected?: boolean; run: () => void };
  type EditorWithContextItems = {
    elementContextItems(slideId: string): ReadonlyArray<ContextItemLike>;
  };

  function getContextItems(ed: SlidesEditor, slideId: string): ReadonlyArray<ContextItemLike> {
    return (ed as unknown as EditorWithContextItems).elementContextItems(slideId);
  }

  it('shows three text-align items for a single TextElement', () => {
    const { canvas, overlay, store } = makeFixture();
    const slideId = store.read().slides[0].id;
    let textId = '';
    store.batch(() => {
      textId = store.addElement(slideId, {
        type: 'text',
        frame: { x: 100, y: 100, w: 300, h: 200, rotation: 0 },
        data: {
          blocks: [{
            id: 'b1',
            type: 'paragraph',
            inlines: [{ text: 'Hello', style: {} }],
            style: {},
          } as Block],
        },
      });
    });
    editor = initialize({ canvas, overlay, store, hostWidth: 1920, hostHeight: 1080, dpr: 1 });
    editor.setSelection([textId]);
    const items = getContextItems(editor, slideId);

    const labels = items.map((it) => it.label);
    expect(labels).toContain('Align text top');
    expect(labels).toContain('Align text middle');
    expect(labels).toContain('Align text bottom');

    // undefined verticalAnchor => implicit top => 'Align text top' is selected
    const top = items.find((it) => it.label === 'Align text top');
    expect(top?.selected).toBe(true);
  });

  it('marks the configured anchor as selected', () => {
    const { canvas, overlay, store } = makeFixture();
    const slideId = store.read().slides[0].id;
    let textId = '';
    store.batch(() => {
      textId = store.addElement(slideId, {
        type: 'text',
        frame: { x: 100, y: 100, w: 300, h: 200, rotation: 0 },
        data: {
          blocks: [{
            id: 'b1',
            type: 'paragraph',
            inlines: [{ text: 'Hi', style: {} }],
            style: {},
          } as Block],
          verticalAnchor: 'bottom',
        },
      });
    });
    editor = initialize({ canvas, overlay, store, hostWidth: 1920, hostHeight: 1080, dpr: 1 });
    editor.setSelection([textId]);
    const items = getContextItems(editor, slideId);

    expect(items.find((it) => it.label === 'Align text bottom')?.selected).toBe(true);
    expect(items.find((it) => it.label === 'Align text top')?.selected).toBeFalsy();
  });

  it('omits the items when more than one element is selected', () => {
    const { canvas, overlay, store } = makeFixture();
    const slideId = store.read().slides[0].id;
    let aId = '';
    let bId = '';
    store.batch(() => {
      aId = store.addElement(slideId, {
        type: 'text',
        frame: { x: 0, y: 0, w: 100, h: 50, rotation: 0 },
        data: {
          blocks: [{
            id: 'a',
            type: 'paragraph',
            inlines: [{ text: 'A', style: {} }],
            style: {},
          } as Block],
        },
      });
      bId = store.addElement(slideId, {
        type: 'text',
        frame: { x: 0, y: 60, w: 100, h: 50, rotation: 0 },
        data: {
          blocks: [{
            id: 'b',
            type: 'paragraph',
            inlines: [{ text: 'B', style: {} }],
            style: {},
          } as Block],
        },
      });
    });
    editor = initialize({ canvas, overlay, store, hostWidth: 1920, hostHeight: 1080, dpr: 1 });
    editor.setSelection([aId, bId]);
    const items = getContextItems(editor, slideId);

    expect(items.find((it) => it.label.startsWith('Align text'))).toBeUndefined();
  });

  it('omits the items for a non-text element', () => {
    const { canvas, overlay, store } = makeFixture();
    const slideId = store.read().slides[0].id;
    let shapeId = '';
    store.batch(() => {
      shapeId = store.addElement(slideId, {
        type: 'shape',
        frame: { x: 0, y: 0, w: 100, h: 100, rotation: 0 },
        data: { kind: 'rect', fill: { kind: 'srgb' as const, value: '#abc' } },
      });
    });
    editor = initialize({ canvas, overlay, store, hostWidth: 1920, hostHeight: 1080, dpr: 1 });
    editor.setSelection([shapeId]);
    const items = getContextItems(editor, slideId);

    expect(items.find((it) => it.label.startsWith('Align text'))).toBeUndefined();
  });

  it('clicking an item calls store.updateElementData with the new anchor', () => {
    const { canvas, overlay, store } = makeFixture();
    const slideId = store.read().slides[0].id;
    let textId = '';
    store.batch(() => {
      textId = store.addElement(slideId, {
        type: 'text',
        frame: { x: 100, y: 100, w: 300, h: 200, rotation: 0 },
        data: {
          blocks: [{
            id: 'b1',
            type: 'paragraph',
            inlines: [{ text: 'Hi', style: {} }],
            style: {},
          } as Block],
        },
      });
    });
    editor = initialize({ canvas, overlay, store, hostWidth: 1920, hostHeight: 1080, dpr: 1 });
    editor.setSelection([textId]);
    const items = getContextItems(editor, slideId);

    const middle = items.find((it) => it.label === 'Align text middle')!;
    expect(middle).toBeDefined();
    middle.run();

    const updated = store.read().slides[0].elements.find((el) => el.id === textId);
    expect(updated?.type).toBe('text');
    if (updated?.type === 'text') {
      expect(updated.data.verticalAnchor).toBe('middle');
    }
  });

  it('clicking an item commits one undo entry (store.batch)', () => {
    const { canvas, overlay, store } = makeFixture();
    const slideId = store.read().slides[0].id;
    let textId = '';
    store.batch(() => {
      textId = store.addElement(slideId, {
        type: 'text',
        frame: { x: 100, y: 100, w: 300, h: 200, rotation: 0 },
        data: {
          blocks: [{
            id: 'b1',
            type: 'paragraph',
            inlines: [{ text: 'Hi', style: {} }],
            style: {},
          } as Block],
        },
      });
    });
    editor = initialize({ canvas, overlay, store, hostWidth: 1920, hostHeight: 1080, dpr: 1 });
    editor.setSelection([textId]);
    const items = getContextItems(editor, slideId);

    items.find((it) => it.label === 'Align text bottom')!.run();

    // One undo reverts the anchor change back to undefined (top).
    expect(store.canUndo()).toBe(true);
    store.undo();
    const reverted = store.read().slides[0].elements.find((el) => el.id === textId);
    if (reverted?.type === 'text') {
      expect(reverted.data.verticalAnchor).toBeUndefined();
    }
  });

  it('clicking the currently-selected anchor does not change the store', () => {
    const { canvas, overlay, store } = makeFixture();
    const slideId = store.read().slides[0].id;
    let textId = '';
    store.batch(() => {
      textId = store.addElement(slideId, {
        type: 'text',
        frame: { x: 0, y: 0, w: 100, h: 50, rotation: 0 },
        data: {
          blocks: [{
            id: 'b1',
            type: 'paragraph',
            inlines: [{ text: 'Hi', style: {} }],
            style: {},
          } as Block],
          verticalAnchor: 'middle',
        },
      });
    });
    editor = initialize({ canvas, overlay, store, hostWidth: 1920, hostHeight: 1080, dpr: 1 });
    editor.setSelection([textId]);
    const undoBefore = store.canUndo();
    const redoBefore = store.canRedo();
    const before = JSON.stringify(store.read().slides[0].elements);
    const items = getContextItems(editor, slideId);

    items.find((it) => it.label === 'Align text middle')!.run();

    const after = JSON.stringify(store.read().slides[0].elements);
    expect(after).toBe(before);
    // The short-circuit must not push a no-op batch onto the undo stack.
    expect(store.canUndo()).toBe(undoBefore);
    expect(store.canRedo()).toBe(redoBefore);
  });
});
