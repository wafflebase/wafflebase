// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import '../../../src/view/canvas/test-canvas-env';
import { MemSlidesStore } from '../../../src/store/memory';
import { initialize, type SlidesEditor, type SlidesEditorOptions } from '../../../src/view/editor/editor';
import type { ElementInit, ShapeElement, Stroke } from '../../../src/model/element';
import {
  pointInPolygon,
  polygonBounds,
  selectInPolygon,
} from '../../../src/view/editor/interactions/free-lasso';

/**
 * The host hooks the board's live ink, smart shapes and free lasso hang
 * off: `onInkProgress`, `transformInkStroke`, `freeLasso` and
 * `setPeerInkStroke`. Each defaults to today's Slides behaviour, which
 * `ink-tools.test.ts` already pins.
 */

function mount(extra: Partial<SlidesEditorOptions> = {}) {
  const canvas = document.createElement('canvas');
  const overlay = document.createElement('div');
  document.body.appendChild(canvas);
  document.body.appendChild(overlay);
  const store = new MemSlidesStore();
  store.batch(() => store.addSlide('blank'));
  const editor = initialize({
    canvas,
    overlay,
    store,
    hostWidth: 1920,
    hostHeight: 1080,
    dpr: 1,
    ...extra,
  });
  return { canvas, overlay, store, editor };
}

function down(target: EventTarget, x: number, y: number, altKey = false): void {
  target.dispatchEvent(
    new PointerEvent('pointerdown', { clientX: x, clientY: y, altKey, bubbles: true }),
  );
}
function move(x: number, y: number): void {
  document.dispatchEvent(new PointerEvent('pointermove', { clientX: x, clientY: y, bubbles: true }));
}
function up(x: number, y: number): void {
  document.dispatchEvent(new PointerEvent('pointerup', { clientX: x, clientY: y, bubbles: true }));
}
function draw(canvas: HTMLCanvasElement, pts: Array<[number, number]>, altKey = false): void {
  down(canvas, pts[0][0], pts[0][1], altKey);
  for (const [x, y] of pts.slice(1)) move(x, y);
  const last = pts[pts.length - 1];
  up(last[0], last[1]);
}

const MARKER: Stroke = { color: '#1e1e1e', width: 4, cap: 'round' };

function addShape(store: MemSlidesStore, x: number, y: number): string {
  let id = '';
  const slideId = store.read().slides[0].id;
  store.batch(() => {
    id = store.addElement(slideId, {
      type: 'shape',
      frame: { x, y, w: 40, h: 40, rotation: 0 },
      data: { kind: 'rect' },
    });
  });
  return id;
}

describe('ink host hooks', () => {
  let editor: SlidesEditor | null = null;
  beforeEach(() => {
    editor?.detach();
    editor = null;
    document.body.innerHTML = '';
  });

  it('onInkProgress reports the stroke as it grows, then null', () => {
    const seen: Array<number | null> = [];
    const m = mount({
      stickyInsertKinds: ['freeform'],
      getInkStroke: () => MARKER,
      onInkProgress: (pts) => seen.push(pts === null ? null : pts.length),
    });
    editor = m.editor;
    editor.setInsertMode('freeform');
    draw(m.canvas, [[100, 100], [150, 140], [200, 110]]);
    expect(seen).toEqual([1, 2, 3, null]);
  });

  it('transformInkStroke replaces the stroke in the same undo unit', () => {
    const replacement: ElementInit = {
      type: 'shape',
      frame: { x: 0, y: 0, w: 10, h: 10, rotation: 0 },
      data: { kind: 'ellipse', stroke: MARKER },
    };
    const m = mount({
      stickyInsertKinds: ['freeform'],
      getInkStroke: () => MARKER,
      transformInkStroke: (pts, stroke) => {
        expect(pts.length).toBeGreaterThan(1);
        expect(stroke).toEqual(MARKER);
        return [replacement];
      },
    });
    editor = m.editor;
    editor.setInsertMode('freeform');
    draw(m.canvas, [[100, 100], [150, 140], [200, 110]]);
    const els = m.store.read().slides[0].elements;
    expect(els).toHaveLength(1);
    expect((els[0] as ShapeElement).data.kind).toBe('ellipse');
    m.store.undo();
    expect(m.store.read().slides[0].elements).toHaveLength(0);
  });

  it('transformInkStroke returning null keeps the stroke', () => {
    const m = mount({
      stickyInsertKinds: ['freeform'],
      getInkStroke: () => MARKER,
      transformInkStroke: () => null,
    });
    editor = m.editor;
    editor.setInsertMode('freeform');
    draw(m.canvas, [[100, 100], [150, 140]]);
    expect((m.store.read().slides[0].elements[0] as ShapeElement).data.kind).toBe('freeform');
  });

  it('a local stroke ending leaves a peer stroke on the live layer', () => {
    const m = mount({ stickyInsertKinds: ['freeform'], getInkStroke: () => MARKER });
    editor = m.editor;
    editor.setPeerInkStroke('p1', { points: [{ x: 1, y: 1 }, { x: 5, y: 5 }], color: '#f00', width: 2 });
    editor.setInsertMode('freeform');
    draw(m.canvas, [[100, 100], [150, 140]]);
    const layer = document.querySelector('canvas.wfb-slides-live-ink');
    expect(layer).not.toBeNull();
    // The layer's private map still holds the peer stroke.
    const strokes = (editor as unknown as { liveInk: { strokes: Map<string, unknown> } }).liveInk
      .strokes;
    expect([...strokes.keys()]).toEqual(['peer:p1']);
    editor.setPeerInkStroke('p1', null);
    expect(strokes.size).toBe(0);
  });

  it('freeLasso: Alt+drag loops around elements; plain drag is still the rectangle', () => {
    const m = mount({ freeLasso: (press) => press.altKey });
    editor = m.editor;
    const inside = addShape(m.store, 100, 100); // centre 120,120
    const outside = addShape(m.store, 400, 100); // centre 420,120
    // A loop around the first shape only.
    draw(
      m.canvas,
      [[80, 80], [180, 80], [180, 180], [80, 180], [80, 82]],
      true,
    );
    expect(editor.getSelection()).toEqual([inside]);
    // The rectangle lasso still runs without Alt.
    draw(m.canvas, [[50, 50], [500, 200]]);
    expect([...editor.getSelection()].sort()).toEqual([inside, outside].sort());
  });

  it('freeLasso: an Alt-click clears the selection', () => {
    const m = mount({ freeLasso: (press) => press.altKey });
    editor = m.editor;
    const id = addShape(m.store, 100, 100);
    editor.setSelection([id]);
    draw(m.canvas, [[600, 600]], true);
    expect(editor.getSelection()).toEqual([]);
  });
});

describe('free-lasso geometry', () => {
  const square = [
    { x: 0, y: 0 },
    { x: 10, y: 0 },
    { x: 10, y: 10 },
    { x: 0, y: 10 },
  ];

  it('pointInPolygon', () => {
    expect(pointInPolygon({ x: 5, y: 5 }, square)).toBe(true);
    expect(pointInPolygon({ x: 15, y: 5 }, square)).toBe(false);
  });

  it('polygonBounds', () => {
    expect(polygonBounds(square)).toEqual({ x: 0, y: 0, w: 10, h: 10 });
    expect(polygonBounds([])).toEqual({ x: 0, y: 0, w: 0, h: 0 });
  });

  it('selects a stroke the loop crosses even when its centre is outside', () => {
    const stroke = {
      id: 'ink',
      type: 'shape' as const,
      frame: { x: 5, y: 5, w: 100, h: 1, rotation: 0 },
      data: {
        kind: 'freeform' as const,
        path: { commands: [{ c: 'M' as const, x: 0, y: 0 }, { c: 'L' as const, x: 1, y: 0 }] },
        stroke: { color: '#000', width: 2 },
      },
    };
    // Centre (55, 5.5) is outside the 10×10 loop, but the line runs through it.
    expect(selectInPolygon([stroke], square)).toEqual(['ink']);
    const rect = { ...stroke, id: 'rect', data: { kind: 'rect' as const } };
    expect(selectInPolygon([rect], square)).toEqual([]);
    expect(selectInPolygon([stroke], square.slice(0, 2))).toEqual([]);
  });
});
