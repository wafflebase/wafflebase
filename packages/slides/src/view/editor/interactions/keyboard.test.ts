// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import '../../canvas/test-canvas-env';
import { MemSlidesStore } from '../../../store/memory';
import { initialize, type SlidesEditor } from '../editor';

function makeFixture() {
  document.body.innerHTML = '';
  const canvas = document.createElement('canvas');
  canvas.width = 960; canvas.height = 540;
  const overlay = document.createElement('div');
  document.body.appendChild(canvas);
  document.body.appendChild(overlay);
  const store = new MemSlidesStore();
  let elementId = '';
  store.batch(() => {
    const sid = store.addSlide('blank');
    elementId = store.addElement(sid, {
      type: 'shape',
      frame: { x: 100, y: 100, w: 200, h: 100, rotation: 0 },
      data: { kind: 'rect', fill: '#abc' },
    });
  });
  const editor = initialize({ canvas, overlay, store, hostWidth: 960, hostHeight: 540, dpr: 1 });
  return { canvas, overlay, store, editor, elementId };
}

describe('keyboard — nudge', () => {
  let editor: SlidesEditor | null = null;
  beforeEach(() => { if (editor) { editor.detach(); editor = null; } });

  it('Arrow keys nudge the selected element by 1 px', () => {
    const { editor: e, store, elementId } = makeFixture();
    editor = e;
    editor.setSelection([elementId]);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown',  bubbles: true }));
    const frame = store.read().slides[0].elements[0].frame;
    expect(frame.x).toBe(101);
    expect(frame.y).toBe(101);
  });

  it('Shift+Arrow nudges by 10 px', () => {
    const { editor: e, store, elementId } = makeFixture();
    editor = e;
    editor.setSelection([elementId]);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', shiftKey: true, bubbles: true }));
    expect(store.read().slides[0].elements[0].frame.x).toBe(110);
  });

  it('arrow keys with no selection are a no-op', () => {
    const { editor: e, store } = makeFixture();
    editor = e;
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    expect(store.read().slides[0].elements[0].frame.x).toBe(100);
  });

  it('each arrow keystroke is its own undo entry', () => {
    const { editor: e, store, elementId } = makeFixture();
    editor = e;
    editor.setSelection([elementId]);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    expect(store.read().slides[0].elements[0].frame.x).toBe(102);
    store.undo();
    expect(store.read().slides[0].elements[0].frame.x).toBe(101);
    store.undo();
    expect(store.read().slides[0].elements[0].frame.x).toBe(100);
  });
});

describe('keyboard — undo/redo', () => {
  let editor: SlidesEditor | null = null;
  beforeEach(() => { if (editor) { editor.detach(); editor = null; } });

  it('Cmd+Z undoes the last batch', () => {
    const { editor: e, store, elementId } = makeFixture();
    editor = e;
    editor.setSelection([elementId]);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', metaKey: true, bubbles: true }));
    expect(store.read().slides[0].elements[0].frame.x).toBe(100);
  });

  it('Cmd+Shift+Z redoes', () => {
    const { editor: e, store, elementId } = makeFixture();
    editor = e;
    editor.setSelection([elementId]);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', metaKey: true, bubbles: true }));
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', metaKey: true, shiftKey: true, bubbles: true }));
    expect(store.read().slides[0].elements[0].frame.x).toBe(101);
  });

  it('Ctrl+Z works on Windows/Linux too', () => {
    const { editor: e, store, elementId } = makeFixture();
    editor = e;
    editor.setSelection([elementId]);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true }));
    expect(store.read().slides[0].elements[0].frame.x).toBe(100);
  });
});
