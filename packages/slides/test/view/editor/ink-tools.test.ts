// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import '../../../src/view/canvas/test-canvas-env';
import { MemSlidesStore } from '../../../src/store/memory';
import { initialize, type SlidesEditor, type SlidesEditorOptions } from '../../../src/view/editor/editor';
import type { ShapeElement, Stroke } from '../../../src/model/element';

/**
 * The freehand pipeline through a real editor: Slides' default scribble,
 * the board's sticky marker (`stickyInsertKinds` + `getInkStroke`), the
 * eraser, and the host-driven cancel. jsdom's canvas rect is all zeros,
 * so at hostWidth 1920 a client point is a world point.
 */

function makeFixture() {
  const canvas = document.createElement('canvas');
  const overlay = document.createElement('div');
  document.body.appendChild(canvas);
  document.body.appendChild(overlay);
  const store = new MemSlidesStore();
  store.batch(() => store.addSlide('blank'));
  return { canvas, overlay, store };
}

function mount(extra: Partial<SlidesEditorOptions> = {}) {
  const f = makeFixture();
  const editor = initialize({
    canvas: f.canvas,
    overlay: f.overlay,
    store: f.store,
    hostWidth: 1920,
    hostHeight: 1080,
    dpr: 1,
    ...extra,
  });
  return { ...f, editor };
}

function down(target: EventTarget, x: number, y: number): void {
  target.dispatchEvent(new PointerEvent('pointerdown', { clientX: x, clientY: y, bubbles: true }));
}
function move(x: number, y: number, shiftKey = false): void {
  document.dispatchEvent(new PointerEvent('pointermove', { clientX: x, clientY: y, shiftKey, bubbles: true }));
}
function up(x: number, y: number): void {
  document.dispatchEvent(new PointerEvent('pointerup', { clientX: x, clientY: y, bubbles: true }));
}
function draw(canvas: HTMLCanvasElement, pts: Array<[number, number]>, shiftKey = false): void {
  down(canvas, pts[0][0], pts[0][1]);
  for (const [x, y] of pts.slice(1)) move(x, y, shiftKey);
  const last = pts[pts.length - 1];
  up(last[0], last[1]);
}

function elements(store: MemSlidesStore) {
  return store.read().slides[0].elements;
}

const MARKER: Stroke = { color: { kind: 'srgb', value: '#e5484d' }, width: 4, cap: 'round' };

describe('freehand ink', () => {
  let editor: SlidesEditor | null = null;
  beforeEach(() => {
    editor?.detach();
    editor = null;
    document.body.innerHTML = '';
  });

  it('Slides default: one scribble, selected, then back to Select', () => {
    const m = mount();
    editor = m.editor;
    editor.setInsertMode('freeform');
    draw(m.canvas, [[100, 100], [150, 140], [200, 110]]);
    const els = elements(m.store);
    expect(els).toHaveLength(1);
    const data = (els[0] as ShapeElement).data;
    expect(data.kind).toBe('freeform');
    expect(data.stroke?.width).toBe(2);
    expect(editor.getSelection()).toEqual([els[0].id]);
    expect(editor.getInsertMode()).toBe(null);
  });

  it('sticky marker: stays armed, unselected, and uses the host stroke', () => {
    const m = mount({ stickyInsertKinds: ['freeform', 'eraser'], getInkStroke: () => MARKER });
    editor = m.editor;
    editor.setInsertMode('freeform');
    draw(m.canvas, [[100, 100], [150, 140], [200, 110]]);
    draw(m.canvas, [[300, 300], [350, 340]]);
    const els = elements(m.store);
    expect(els).toHaveLength(2);
    expect((els[0] as ShapeElement).data.stroke).toEqual(MARKER);
    expect(editor.getSelection()).toEqual([]);
    expect(editor.getInsertMode()).toBe('freeform');
    // One stroke, one undo unit.
    m.store.undo();
    expect(elements(m.store)).toHaveLength(1);
  });

  it('sticky marker: a tap commits a dot', () => {
    const m = mount({ stickyInsertKinds: ['freeform'], getInkStroke: () => MARKER });
    editor = m.editor;
    editor.setInsertMode('freeform');
    draw(m.canvas, [[100, 100]]);
    expect(elements(m.store)).toHaveLength(1);
  });

  it('Shift draws a straight line from the start point', () => {
    const m = mount({ stickyInsertKinds: ['freeform'], getInkStroke: () => MARKER });
    editor = m.editor;
    editor.setInsertMode('freeform');
    draw(m.canvas, [[100, 100], [150, 160], [200, 103]], true);
    const data = (elements(m.store)[0] as ShapeElement).data;
    expect(data.path!.commands.map((c) => c.c)).toEqual(['M', 'L']);
    // Snapped to 0°: the frame is a 1px-tall horizontal line.
    expect(elements(m.store)[0].frame.h).toBe(1);
  });

  it('Esc mid-stroke discards it but keeps a sticky tool armed; idle Esc disarms', async () => {
    const m = mount({ stickyInsertKinds: ['freeform'], getInkStroke: () => MARKER });
    editor = m.editor;
    editor.setInsertMode('freeform');
    down(m.canvas, 100, 100);
    move(150, 150);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    up(150, 150);
    expect(elements(m.store)).toHaveLength(0);
    expect(editor.getInsertMode()).toBe('freeform');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await Promise.resolve();
    expect(editor.getInsertMode()).toBe(null);
  });

  it('cancelInkStroke drops the stroke in progress', () => {
    const m = mount({ stickyInsertKinds: ['freeform'], getInkStroke: () => MARKER });
    editor = m.editor;
    editor.setInsertMode('freeform');
    down(m.canvas, 100, 100);
    move(150, 150);
    editor.cancelInkStroke();
    up(150, 150);
    expect(elements(m.store)).toHaveLength(0);
    expect(editor.getInsertMode()).toBe('freeform');
  });

  it('eraser deletes only strokes its path crosses, in one undo', () => {
    const m = mount({ stickyInsertKinds: ['freeform', 'eraser'], getInkStroke: () => MARKER });
    editor = m.editor;
    editor.setInsertMode('freeform');
    draw(m.canvas, [[100, 100], [200, 200]]); // diagonal
    draw(m.canvas, [[400, 100], [400, 200]]); // vertical
    draw(m.canvas, [[600, 100], [700, 100]]); // far away
    expect(elements(m.store)).toHaveLength(3);
    editor.setInsertMode('eraser');
    // Crosses the diagonal and the vertical; passes through the
    // diagonal's bbox corner without touching the far stroke.
    draw(m.canvas, [[100, 200], [200, 100], [450, 150]]);
    expect(elements(m.store)).toHaveLength(1);
    expect(editor.getInsertMode()).toBe('eraser');
    m.store.undo();
    expect(elements(m.store)).toHaveLength(3);
  });

  it('a click inside a stroke bbox but off its line selects what is beneath', () => {
    const m = mount();
    editor = m.editor;
    const sid = m.store.read().slides[0].id;
    let rectId = '';
    m.store.batch(() => {
      rectId = m.store.addElement(sid, {
        type: 'shape',
        frame: { x: 160, y: 110, w: 30, h: 30, rotation: 0 },
        data: { kind: 'rect', fill: { kind: 'srgb', value: '#abc' } },
      });
    });
    editor.setInsertMode('freeform');
    draw(m.canvas, [[100, 100], [200, 200]]); // diagonal over the rect's area
    editor.setSelection([]);
    // (175, 125) is in the stroke's bbox, 35px off its line, on the rect.
    down(m.canvas, 175, 125);
    up(175, 125);
    expect(editor.getSelection()).toEqual([rectId]);
  });
});
