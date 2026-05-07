// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import '../../canvas/test-canvas-env';
import { MemSlidesStore } from '../../../store/memory';
import { initialize, type SlidesEditor } from '../editor';
import { MIME_TYPE, serializeElements } from './clipboard';

const trackedEditors: SlidesEditor[] = [];

afterEach(() => {
  // Editors register `keydown` listeners on `document`. Without a global
  // teardown, listeners from earlier tests fire during later tests and
  // throw off mock-call counts (e.g. the Cmd+C copy assertion below).
  while (trackedEditors.length) trackedEditors.pop()!.detach();
});

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
  trackedEditors.push(editor);
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

describe('keyboard — Cmd+D duplicate element', () => {
  let editor: SlidesEditor | null = null;
  beforeEach(() => { if (editor) { editor.detach(); editor = null; } });

  it('duplicates selected elements and selects the copies', () => {
    const { editor: e, store, elementId } = makeFixture();
    editor = e;
    editor.setSelection([elementId]);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'd', metaKey: true, bubbles: true }));
    const elements = store.read().slides[0].elements;
    expect(elements).toHaveLength(2);
    // Copy is offset by (10, 10).
    expect(elements[1].frame).toEqual({ x: 110, y: 110, w: 200, h: 100, rotation: 0 });
    expect(editor.getSelection()).toEqual([elements[1].id]);
  });

  it('with no element selected, duplicates the current slide', () => {
    const { editor: e, store } = makeFixture();
    editor = e;
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'd', metaKey: true, bubbles: true }));
    expect(store.read().slides).toHaveLength(2);
  });
});

describe('keyboard — z-order shortcuts', () => {
  let editor: SlidesEditor | null = null;
  beforeEach(() => { if (editor) { editor.detach(); editor = null; } });

  it('Cmd+ArrowUp brings forward', () => {
    const { editor: e, store } = makeFixture();
    editor = e;
    store.batch(() => {
      store.addElement(store.read().slides[0].id, {
        type: 'shape',
        frame: { x: 0, y: 0, w: 50, h: 50, rotation: 0 },
        data: { kind: 'rect', fill: '#0a0' },
      });
    });
    // Now elements: [a (the original), b]. Selection = a.
    const aId = store.read().slides[0].elements[0].id;
    editor.setSelection([aId]);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', metaKey: true, bubbles: true }));
    // a should now be at index 1 (forward).
    expect(store.read().slides[0].elements[1].id).toBe(aId);
  });
});

describe('keyboard — Cmd+C copy', () => {
  let editor: SlidesEditor | null = null;
  let originalClipboard: unknown;
  let originalClipboardItem: unknown;

  beforeEach(() => {
    if (editor) { editor.detach(); editor = null; }
    // jsdom ships neither navigator.clipboard nor ClipboardItem, so
    // mock both for this suite. The pure serialization path is
    // covered by clipboard.test.ts; here we only assert that Cmd+C
    // wires the editor selection through navigator.clipboard.write
    // with the right MIME type.
    originalClipboard = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
    originalClipboardItem = (globalThis as { ClipboardItem?: unknown }).ClipboardItem;
    class FakeClipboardItem {
      readonly types: string[];
      constructor(public readonly parts: Record<string, Blob>) {
        this.types = Object.keys(parts);
      }
      async getType(type: string): Promise<Blob> {
        return this.parts[type];
      }
    }
    (globalThis as unknown as { ClipboardItem: typeof FakeClipboardItem }).ClipboardItem =
      FakeClipboardItem;
    Object.defineProperty(navigator, 'clipboard', {
      value: {
        write: vi.fn(async (_items: unknown[]) => {}),
        read: vi.fn(async () => []),
      },
      configurable: true,
    });
  });

  it('Cmd+C calls navigator.clipboard.write with the slides MIME', async () => {
    const { editor: e, elementId } = makeFixture();
    editor = e;
    editor.setSelection([elementId]);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'c', metaKey: true, bubbles: true }));
    // The handler is async; let microtasks flush.
    await new Promise((r) => setTimeout(r, 0));
    const writeFn = navigator.clipboard.write as unknown as { mock: { calls: unknown[][] } };
    expect(writeFn.mock.calls).toHaveLength(1);
    const items = writeFn.mock.calls[0][0] as Array<{ types: string[] }>;
    expect(items[0].types).toContain(MIME_TYPE);
    // Sanity-check serialization helper used by the implementation.
    expect(typeof serializeElements).toBe('function');
    // Cleanup.
    if (originalClipboard) {
      Object.defineProperty(navigator, 'clipboard', originalClipboard as PropertyDescriptor);
    } else {
      delete (navigator as { clipboard?: unknown }).clipboard;
    }
    (globalThis as { ClipboardItem?: unknown }).ClipboardItem = originalClipboardItem as never;
  });
});
