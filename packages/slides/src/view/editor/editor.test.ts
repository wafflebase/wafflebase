// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import '../canvas/test-canvas-env';
import { MemSlidesStore } from '../../store/memory';
import { initialize, type SlidesEditor } from './editor';

vi.mock('./layout-picker', () => ({
  showLayoutPicker: vi.fn(),
}));

import { showLayoutPicker } from './layout-picker';

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
    document.dispatchEvent(new MouseEvent('mousemove', { clientX: 200, clientY: 180, bubbles: true }));
    document.dispatchEvent(new MouseEvent('mouseup',   { clientX: 200, clientY: 180, bubbles: true }));
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
        data: { kind: 'rect', fill: { kind: 'srgb' as const, value: '#abc' } },
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
        data: { kind: 'rect', fill: { kind: 'srgb' as const, value: '#abc' } },
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
    handle!.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: cx, clientY: cy }));
    // Move >2px to cross the threshold (which is 2px in world coords; scale=1
    // so 10px clientX change == 10px world change, well past the threshold).
    document.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: cx + 10, clientY: cy }));
    document.dispatchEvent(new MouseEvent('mouseup',   { bubbles: true, clientX: cx + 10, clientY: cy }));

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

    handle!.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: cx, clientY: cy }));
    // Move only 1px — below the 2px threshold (sqrt(1²+0²)=1 < 2).
    document.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: cx + 1, clientY: cy }));
    document.dispatchEvent(new MouseEvent('mouseup',   { bubbles: true, clientX: cx + 1, clientY: cy }));

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

    handle!.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: cx, clientY: cy }));
    document.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: cx + 10, clientY: cy }));
    document.dispatchEvent(new MouseEvent('mouseup',   { bubbles: true, clientX: cx + 10, clientY: cy }));

    // Selection must still contain the element after the drag commits.
    expect(editor!.getSelection()).toEqual([elementId]);
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
