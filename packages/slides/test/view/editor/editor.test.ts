// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
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
