// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import '../../../../src/view/canvas/test-canvas-env';
import { MemSlidesStore } from '../../../../src/store/memory';
import { initialize, type SlidesEditor } from '../../../../src/view/editor/editor';
import { MIME_TYPE, serializeElements } from '../../../../src/view/editor/interactions/clipboard';

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
      data: { kind: 'rect', fill: { kind: 'srgb' as const, value: '#abc' } },
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

describe('keyboard — Delete / Backspace', () => {
  let editor: SlidesEditor | null = null;
  beforeEach(() => { if (editor) { editor.detach(); editor = null; } });

  it('Delete removes the selected element', () => {
    const { editor: e, store, elementId } = makeFixture();
    editor = e;
    editor.setSelection([elementId]);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true }));
    expect(store.read().slides[0].elements).toHaveLength(0);
    expect(editor.getSelection()).toEqual([]);
  });

  it('Backspace removes the selected element', () => {
    const { editor: e, store, elementId } = makeFixture();
    editor = e;
    editor.setSelection([elementId]);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true }));
    expect(store.read().slides[0].elements).toHaveLength(0);
  });

  it('Delete with no selection is a no-op', () => {
    const { editor: e, store } = makeFixture();
    editor = e;
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true }));
    expect(store.read().slides[0].elements).toHaveLength(1);
  });

  it('Delete removes every element in a multi-selection in one undo entry', () => {
    const { editor: e, store, elementId } = makeFixture();
    editor = e;
    let secondId = '';
    store.batch(() => {
      secondId = store.addElement(store.read().slides[0].id, {
        type: 'shape',
        frame: { x: 400, y: 400, w: 50, h: 50, rotation: 0 },
        data: { kind: 'rect', fill: { kind: 'srgb' as const, value: '#0a0' } },
      });
    });
    editor.setSelection([elementId, secondId]);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true }));
    expect(store.read().slides[0].elements).toHaveLength(0);
    store.undo();
    expect(store.read().slides[0].elements).toHaveLength(2);
  });

  it('Backspace inside a textarea does not delete elements', () => {
    const { editor: e, store, elementId } = makeFixture();
    editor = e;
    editor.setSelection([elementId]);
    const textarea = document.createElement('textarea');
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true }));
    expect(store.read().slides[0].elements).toHaveLength(1);
    textarea.remove();
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
        data: { kind: 'rect', fill: { kind: 'srgb' as const, value: '#0a0' } },
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

describe('keyboard — Cmd+A select all', () => {
  let editor: SlidesEditor | null = null;
  beforeEach(() => { if (editor) { editor.detach(); editor = null; } });

  it('selects every element on the current slide', () => {
    const { editor: e, store, elementId } = makeFixture();
    editor = e;
    const slideId = store.read().slides[0].id;
    let secondId = '';
    store.batch(() => {
      secondId = store.addElement(slideId, {
        type: 'shape',
        frame: { x: 0, y: 0, w: 50, h: 50, rotation: 0 },
        data: { kind: 'rect', fill: { kind: 'srgb' as const, value: '#0a0' } },
      });
    });
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', metaKey: true, bubbles: true }));
    expect(editor.getSelection()).toEqual([elementId, secondId]);
  });

  it('is a no-op when target is a textarea', () => {
    const { editor: e } = makeFixture();
    editor = e;
    const textarea = document.createElement('textarea');
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', metaKey: true, bubbles: true }));
    expect(editor.getSelection()).toEqual([]);
    textarea.remove();
  });
});

describe('keyboard — Esc', () => {
  let editor: SlidesEditor | null = null;
  beforeEach(() => { if (editor) { editor.detach(); editor = null; } });

  it('clears selection when something is selected', () => {
    const { editor: e, elementId } = makeFixture();
    editor = e;
    editor.setSelection([elementId]);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(editor.getSelection()).toEqual([]);
  });

  it('is a no-op when nothing is selected', () => {
    const { editor: e } = makeFixture();
    editor = e;
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(editor.getSelection()).toEqual([]);
  });
});

describe('keyboard — Tab cycle', () => {
  let editor: SlidesEditor | null = null;
  beforeEach(() => { if (editor) { editor.detach(); editor = null; } });

  function fixtureWithTwoElements() {
    const fx = makeFixture();
    let secondId = '';
    fx.store.batch(() => {
      secondId = fx.store.addElement(fx.store.read().slides[0].id, {
        type: 'shape',
        frame: { x: 0, y: 0, w: 50, h: 50, rotation: 0 },
        data: { kind: 'rect', fill: { kind: 'srgb' as const, value: '#0a0' } },
      });
    });
    return { ...fx, secondId };
  }

  it('with empty selection Tab picks the first element', () => {
    const { editor: e, elementId } = fixtureWithTwoElements();
    editor = e;
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
    expect(editor.getSelection()).toEqual([elementId]);
  });

  it('with empty selection Shift+Tab picks the last element', () => {
    const { editor: e, secondId } = fixtureWithTwoElements();
    editor = e;
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true }));
    expect(editor.getSelection()).toEqual([secondId]);
  });

  it('Tab advances and wraps', () => {
    const { editor: e, elementId, secondId } = fixtureWithTwoElements();
    editor = e;
    editor.setSelection([elementId]);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
    expect(editor.getSelection()).toEqual([secondId]);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
    expect(editor.getSelection()).toEqual([elementId]);
  });

  it('Shift+Tab moves backward and wraps', () => {
    const { editor: e, elementId, secondId } = fixtureWithTwoElements();
    editor = e;
    editor.setSelection([elementId]);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true }));
    expect(editor.getSelection()).toEqual([secondId]);
  });
});

describe('keyboard — F2 / Enter enters text edit', () => {
  let editor: SlidesEditor | null = null;
  beforeEach(() => { if (editor) { editor.detach(); editor = null; } });

  function fixtureWithTextElement() {
    document.body.innerHTML = '';
    const canvas = document.createElement('canvas');
    canvas.width = 960; canvas.height = 540;
    const overlay = document.createElement('div');
    document.body.appendChild(canvas);
    document.body.appendChild(overlay);
    const store = new MemSlidesStore();
    let textId = '';
    store.batch(() => {
      const sid = store.addSlide('blank');
      textId = store.addElement(sid, {
        type: 'text',
        frame: { x: 0, y: 0, w: 200, h: 80, rotation: 0 },
        data: { blocks: [] },
      });
    });
    // Mount fixture uses a fake text-box mount so jsdom isn't asked to
    // drive the real docs text editor.
    const mountedSpy = vi.fn();
    const fakeMount = ((opts: { overlay: HTMLDivElement }) => {
      mountedSpy();
      const container = document.createElement('div');
      opts.overlay.appendChild(container);
      return {
        isEditing: () => true,
        focus: () => undefined,
        detach: () => container.remove(),
        commit: () => undefined,
        container,
      };
    }) as unknown as Parameters<typeof initialize>[0]['mountTextBox'];
    const ed = initialize({
      canvas, overlay, store, hostWidth: 960, hostHeight: 540, dpr: 1,
      mountTextBox: fakeMount,
    });
    trackedEditors.push(ed);
    return { editor: ed, store, textId, mountedSpy };
  }

  it('F2 mounts the text-box editor on the selected text element', () => {
    const { editor: e, textId, mountedSpy } = fixtureWithTextElement();
    editor = e;
    editor.setSelection([textId]);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'F2', bubbles: true }));
    expect(mountedSpy).toHaveBeenCalledTimes(1);
    expect(editor.getEditingElementId()).toBe(textId);
  });

  it('Enter mounts the text-box editor on the selected text element', () => {
    const { editor: e, textId, mountedSpy } = fixtureWithTextElement();
    editor = e;
    editor.setSelection([textId]);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(mountedSpy).toHaveBeenCalledTimes(1);
    expect(editor.getEditingElementId()).toBe(textId);
  });

  it('does not enter edit mode for non-text elements', () => {
    const { editor: e, store, mountedSpy } = fixtureWithTextElement();
    editor = e;
    // The non-text element from makeFixture style — add a shape and select it instead.
    let shapeId = '';
    store.batch(() => {
      shapeId = store.addElement(store.read().slides[0].id, {
        type: 'shape',
        frame: { x: 300, y: 100, w: 100, h: 60, rotation: 0 },
        data: { kind: 'rect', fill: { kind: 'srgb' as const, value: '#abc' } },
      });
    });
    editor.setSelection([shapeId]);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(mountedSpy).not.toHaveBeenCalled();
    expect(editor.getEditingElementId()).toBe(null);
  });
});

describe('keyboard — interactive-widget gate', () => {
  let editor: SlidesEditor | null = null;
  beforeEach(() => { if (editor) { editor.detach(); editor = null; } });

  it('Tab inside a focused dialog does not cycle slide selection', () => {
    const { editor: e, elementId } = makeFixture();
    editor = e;
    editor.setSelection([elementId]);
    const dialog = document.createElement('div');
    dialog.setAttribute('role', 'dialog');
    const button = document.createElement('button');
    dialog.appendChild(button);
    document.body.appendChild(dialog);
    button.focus();
    button.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
    expect(editor.getSelection()).toEqual([elementId]);
    dialog.remove();
  });

  it('Enter on a focused button does not enter text-edit mode', () => {
    const { editor: e, elementId } = makeFixture();
    editor = e;
    editor.setSelection([elementId]);
    const button = document.createElement('button');
    document.body.appendChild(button);
    button.focus();
    button.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(editor.getEditingElementId()).toBe(null);
    button.remove();
  });
});

describe('keyboard — Cmd+M new slide', () => {
  let editor: SlidesEditor | null = null;
  beforeEach(() => { if (editor) { editor.detach(); editor = null; } });

  it('inserts after the current slide and switches to it', () => {
    const { editor: e, store } = makeFixture();
    editor = e;
    const startId = store.read().slides[0].id;
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'm', metaKey: true, bubbles: true }));
    const slides = store.read().slides;
    expect(slides).toHaveLength(2);
    expect(slides[0].id).toBe(startId);
    expect(editor.getCurrentSlideId()).toBe(slides[1].id);
  });

  it('reuses the current slide\'s layout', () => {
    const { editor: e, store } = makeFixture();
    editor = e;
    const layoutId = store.read().slides[0].layoutId;
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'm', metaKey: true, bubbles: true }));
    expect(store.read().slides[1].layoutId).toBe(layoutId);
  });
});

describe('keyboard — Cmd+Shift+D duplicate slide', () => {
  let editor: SlidesEditor | null = null;
  beforeEach(() => { if (editor) { editor.detach(); editor = null; } });

  it('duplicates the current slide even when an element is selected', () => {
    const { editor: e, store, elementId } = makeFixture();
    editor = e;
    editor.setSelection([elementId]);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'd', metaKey: true, shiftKey: true, bubbles: true }));
    expect(store.read().slides).toHaveLength(2);
  });
});

describe('keyboard — Page Up / Page Down', () => {
  let editor: SlidesEditor | null = null;
  beforeEach(() => { if (editor) { editor.detach(); editor = null; } });

  function fixtureWithTwoSlides() {
    const fx = makeFixture();
    fx.store.batch(() => fx.store.addSlide('blank'));
    return fx;
  }

  it('Page Down advances to next slide', () => {
    const { editor: e, store } = fixtureWithTwoSlides();
    editor = e;
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'PageDown', bubbles: true }));
    expect(editor.getCurrentSlideId()).toBe(store.read().slides[1].id);
  });

  it('Page Up returns to previous slide', () => {
    const { editor: e, store } = fixtureWithTwoSlides();
    editor = e;
    editor.setCurrentSlide(store.read().slides[1].id);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'PageUp', bubbles: true }));
    expect(editor.getCurrentSlideId()).toBe(store.read().slides[0].id);
  });

  it('is a no-op at boundaries', () => {
    const { editor: e, store } = fixtureWithTwoSlides();
    editor = e;
    const firstId = store.read().slides[0].id;
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'PageUp', bubbles: true }));
    expect(editor.getCurrentSlideId()).toBe(firstId);
  });
});

describe('keyboard — Present mode shortcuts', () => {
  let editor: SlidesEditor | null = null;
  beforeEach(() => { if (editor) { editor.detach(); editor = null; } });

  it('Cmd+Enter fires onStartPresentation with current', () => {
    document.body.innerHTML = '';
    const canvas = document.createElement('canvas');
    canvas.width = 960; canvas.height = 540;
    const overlay = document.createElement('div');
    document.body.appendChild(canvas);
    document.body.appendChild(overlay);
    const store = new MemSlidesStore();
    store.batch(() => store.addSlide('blank'));
    const onStartPresentation = vi.fn();
    editor = initialize({
      canvas, overlay, store, hostWidth: 960, hostHeight: 540, dpr: 1,
      onStartPresentation,
    });
    trackedEditors.push(editor);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', metaKey: true, bubbles: true }));
    expect(onStartPresentation).toHaveBeenCalledWith('current');
  });

  it('Cmd+Shift+Enter fires onStartPresentation with first', () => {
    document.body.innerHTML = '';
    const canvas = document.createElement('canvas');
    canvas.width = 960; canvas.height = 540;
    const overlay = document.createElement('div');
    document.body.appendChild(canvas);
    document.body.appendChild(overlay);
    const store = new MemSlidesStore();
    store.batch(() => store.addSlide('blank'));
    const onStartPresentation = vi.fn();
    editor = initialize({
      canvas, overlay, store, hostWidth: 960, hostHeight: 540, dpr: 1,
      onStartPresentation,
    });
    trackedEditors.push(editor);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', metaKey: true, shiftKey: true, bubbles: true }));
    expect(onStartPresentation).toHaveBeenCalledWith('first');
  });
});

describe('keyboard — Cmd+/ shortcuts help', () => {
  let editor: SlidesEditor | null = null;
  beforeEach(() => { if (editor) { editor.detach(); editor = null; } });

  it('fires onShowShortcutsHelp even while a textarea is focused', () => {
    document.body.innerHTML = '';
    const canvas = document.createElement('canvas');
    canvas.width = 960; canvas.height = 540;
    const overlay = document.createElement('div');
    document.body.appendChild(canvas);
    document.body.appendChild(overlay);
    const store = new MemSlidesStore();
    store.batch(() => store.addSlide('blank'));
    const onShowShortcutsHelp = vi.fn();
    editor = initialize({
      canvas, overlay, store, hostWidth: 960, hostHeight: 540, dpr: 1,
      onShowShortcutsHelp,
    });
    trackedEditors.push(editor);
    const textarea = document.createElement('textarea');
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.dispatchEvent(new KeyboardEvent('keydown', { key: '/', metaKey: true, bubbles: true }));
    expect(onShowShortcutsHelp).toHaveBeenCalled();
    textarea.remove();
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
