// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import '../../../src/view/canvas/test-canvas-env';
import { MemSlidesStore } from '../../../src/store/memory';
import { initialize, type SlidesEditor } from '../../../src/view/editor/editor';
import type { ShapeElement } from '../../../src/model/element';

/**
 * Editor-level tests for the format-painter state machine.
 *
 *  - `beginFormatPaint` captures fill + stroke from the single selected
 *    element and toggles `isPaintingFormat()` to true.
 *  - The next pointer-down on a compatible target element pastes the
 *    snapshot through the store and auto-exits paint mode.
 *  - Cross-type drops are silent no-ops but still exit paint mode.
 *  - `cancelFormatPaint` and Esc both exit without applying.
 *  - `onPaintFormatChange` fires on every state transition.
 */

vi.mock('../../../src/view/editor/layout-picker', () => ({
  showLayoutPicker: vi.fn(),
}));

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

function addShape(
  store: MemSlidesStore,
  fill = { kind: 'srgb' as const, value: '#abc' },
  stroke?: { color: string; width: number },
): string {
  let id = '';
  store.batch(() => {
    const sid = store.read().slides[0].id;
    id = store.addElement(sid, {
      type: 'shape',
      frame: { x: 100, y: 100, w: 200, h: 100, rotation: 0 },
      data: { kind: 'rect', fill, stroke },
    });
  });
  return id;
}

function shapeFill(store: MemSlidesStore, id: string) {
  const slide = store.read().slides[0];
  const el = slide.elements.find((e) => e.id === id) as ShapeElement;
  return el.data.fill;
}

describe('Format painter (editor-level)', () => {
  let editor: SlidesEditor | null = null;

  beforeEach(() => {
    document.body.innerHTML = '';
    if (editor) {
      editor.detach();
      editor = null;
    }
  });

  it('beginFormatPaint captures fill+stroke from the single selected shape', () => {
    const { canvas, overlay, store } = makeFixture();
    const srcId = addShape(store, { kind: 'srgb' as const, value: '#ff0000' }, { color: '#000000', width: 4 });
    editor = initialize({ canvas, overlay, store, hostWidth: 1920, hostHeight: 1080, dpr: 1 });

    expect(editor.isPaintingFormat()).toBe(false);
    editor.setSelection([srcId]);
    editor.beginFormatPaint();
    expect(editor.isPaintingFormat()).toBe(true);
  });

  it('no-ops when multi or empty selection', () => {
    const { canvas, overlay, store } = makeFixture();
    editor = initialize({ canvas, overlay, store, hostWidth: 1920, hostHeight: 1080, dpr: 1 });

    editor.beginFormatPaint();
    expect(editor.isPaintingFormat()).toBe(false);

    const a = addShape(store);
    const b = addShape(store);
    editor.setSelection([a, b]);
    editor.beginFormatPaint();
    expect(editor.isPaintingFormat()).toBe(false);
  });

  it('paste applies snapshot to the next clicked compatible shape and auto-exits', () => {
    const { canvas, overlay, store } = makeFixture();
    const srcId = addShape(store, { kind: 'srgb' as const, value: '#00ff00' });
    // Target sits at a distinct logical position so it does not overlap
    // with the source under the hit test.
    let tgtId = '';
    store.batch(() => {
      const sid = store.read().slides[0].id;
      tgtId = store.addElement(sid, {
        type: 'shape',
        frame: { x: 500, y: 300, w: 200, h: 100, rotation: 0 },
        data: { kind: 'rect', fill: { kind: 'srgb' as const, value: '#0000ff' } },
      });
    });
    editor = initialize({ canvas, overlay, store, hostWidth: 1920, hostHeight: 1080, dpr: 1 });
    editor.setSelection([srcId]);
    editor.beginFormatPaint();

    // Hit-test uses logical coords scaled by host/SLIDE_WIDTH; at host
    // width 1920 and slide width 1920 the ratio is 1.0, so clientX ≈
    // logical x. Click in the middle of the target shape.
    const rect = canvas.getBoundingClientRect();
    canvas.dispatchEvent(new PointerEvent('pointerdown', {
      clientX: rect.left + 600,
      clientY: rect.top + 350,
      pointerType: 'mouse',
      button: 0,
      bubbles: true,
    }));

    const after = shapeFill(store, tgtId);
    expect(after).toEqual({ kind: 'srgb', value: '#00ff00' });
    expect(editor.isPaintingFormat()).toBe(false);
  });

  it('cancelFormatPaint exits without applying', () => {
    const { canvas, overlay, store } = makeFixture();
    const srcId = addShape(store, { kind: 'srgb' as const, value: '#aa00aa' });
    let tgtId = '';
    store.batch(() => {
      const sid = store.read().slides[0].id;
      tgtId = store.addElement(sid, {
        type: 'shape',
        frame: { x: 500, y: 300, w: 200, h: 100, rotation: 0 },
        data: { kind: 'rect', fill: { kind: 'srgb' as const, value: '#000000' } },
      });
    });
    editor = initialize({ canvas, overlay, store, hostWidth: 1920, hostHeight: 1080, dpr: 1 });
    editor.setSelection([srcId]);
    editor.beginFormatPaint();
    editor.cancelFormatPaint();

    const rect = canvas.getBoundingClientRect();
    canvas.dispatchEvent(new PointerEvent('pointerdown', {
      clientX: rect.left + 600,
      clientY: rect.top + 350,
      pointerType: 'mouse',
      button: 0,
      bubbles: true,
    }));

    // Target fill unchanged because paint was cancelled before the click.
    expect(shapeFill(store, tgtId)).toEqual({ kind: 'srgb', value: '#000000' });
    expect(editor.isPaintingFormat()).toBe(false);
  });

  it('onPaintFormatChange fires on enter and exit', () => {
    const { canvas, overlay, store } = makeFixture();
    const srcId = addShape(store);
    editor = initialize({ canvas, overlay, store, hostWidth: 1920, hostHeight: 1080, dpr: 1 });
    editor.setSelection([srcId]);

    const cb = vi.fn();
    const off = editor.onPaintFormatChange(cb);
    editor.beginFormatPaint();
    editor.cancelFormatPaint();
    off();
    editor.beginFormatPaint();
    expect(cb).toHaveBeenCalledTimes(2);
  });

  it('clicking empty canvas while painting exits paint mode silently', () => {
    const { canvas, overlay, store } = makeFixture();
    const srcId = addShape(store);
    editor = initialize({ canvas, overlay, store, hostWidth: 1920, hostHeight: 1080, dpr: 1 });
    editor.setSelection([srcId]);
    editor.beginFormatPaint();
    expect(editor.isPaintingFormat()).toBe(true);

    const rect = canvas.getBoundingClientRect();
    canvas.dispatchEvent(new PointerEvent('pointerdown', {
      clientX: rect.left + 10,
      clientY: rect.top + 10,
      pointerType: 'mouse',
      button: 0,
      bubbles: true,
    }));
    expect(editor.isPaintingFormat()).toBe(false);
  });
});
