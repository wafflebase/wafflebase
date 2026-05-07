// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import '../canvas/test-canvas-env';
import type { Block } from '@wafflebase/docs';
import { MemSlidesStore } from '../../store/memory';
import type { TextElement } from '../../model/element';
import { initialize, type SlidesEditor } from './editor';
import type {
  MountSlidesTextBoxOptions,
  SlidesTextBoxEditor,
} from './text-box-editor';

/**
 * Slides text-box editor wiring tests. We mock the docs `initializeTextBox`
 * factory by injecting a custom `mountTextBox` into the slides editor
 * — the docs TextEditor needs a real Canvas 2D context to drive cursor
 * placement, which jsdom can't supply. The mock exposes hooks for the
 * test to call commit/cancel on demand, mimicking what the real docs
 * editor would do on blur / Escape.
 */

interface MockTextBox extends SlidesTextBoxEditor {
  /** Fire onCommit with the supplied blocks, simulating a real blur. */
  fireCommit(blocks: Block[]): void;
  /** Fire onCancel, simulating an Escape press. */
  fireCancel(): void;
  /** Snapshot of the original mount opts for inspection. */
  opts: MountSlidesTextBoxOptions;
}

function makeMockMount(): {
  mount: (opts: MountSlidesTextBoxOptions) => SlidesTextBoxEditor;
  current: () => MockTextBox | null;
} {
  let current: MockTextBox | null = null;
  function mount(opts: MountSlidesTextBoxOptions): SlidesTextBoxEditor {
    const container = document.createElement('div');
    container.className = 'wfb-slides-text-box-editor';
    container.style.position = 'absolute';
    container.style.left = `${opts.frame.x * opts.scale}px`;
    container.style.top = `${opts.frame.y * opts.scale}px`;
    container.style.width = `${opts.frame.w * opts.scale}px`;
    container.style.height = `${opts.frame.h * opts.scale}px`;
    container.style.pointerEvents = 'auto';
    opts.overlay.appendChild(container);
    let mounted = true;

    const tb: MockTextBox = {
      isEditing(): boolean { return mounted; },
      focus(): void { /* no textarea in the mock */ },
      commit(): void {
        // The real docs editor commits on blur; here the test drives
        // commit() explicitly via fireCommit when it wants the
        // round-trip to happen.
        // Default behaviour: commit with whatever we last seeded.
        opts.onCommit(opts.blocks);
      },
      detach(): void {
        if (!mounted) return;
        mounted = false;
        container.remove();
      },
      container,
      fireCommit(blocks: Block[]): void {
        opts.onCommit(blocks);
      },
      fireCancel(): void {
        opts.onCancel();
      },
      opts,
    };
    current = tb;
    return tb;
  }
  return { mount, current: (): MockTextBox | null => current };
}

function makeFixture() {
  const canvas = document.createElement('canvas');
  canvas.width = 1920;
  canvas.height = 1080;
  const overlay = document.createElement('div');
  overlay.style.position = 'absolute';
  document.body.appendChild(canvas);
  document.body.appendChild(overlay);
  const store = new MemSlidesStore();
  store.batch(() => store.addSlide('blank'));
  return { canvas, overlay, store };
}

function paragraph(text: string): Block {
  return {
    id: `b${Math.random().toString(36).slice(2, 8)}`,
    type: 'paragraph',
    inlines: [{ text, style: {} }],
    style: {},
  } as Block;
}

function dispatchDblClick(target: EventTarget, x: number, y: number): void {
  target.dispatchEvent(new MouseEvent('dblclick', {
    clientX: x, clientY: y, bubbles: true, cancelable: true,
  }));
}

function dispatchMouseDown(target: EventTarget, x: number, y: number): void {
  target.dispatchEvent(new MouseEvent('mousedown', {
    clientX: x, clientY: y, bubbles: true,
  }));
}

describe('slides text-box editor wiring', () => {
  let editor: SlidesEditor | null = null;

  beforeEach(() => {
    document.body.innerHTML = '';
    if (editor) {
      editor.detach();
      editor = null;
    }
  });

  function addTextElement(store: MemSlidesStore, blocks: Block[] = [paragraph('hello')]): {
    slideId: string;
    elementId: string;
  } {
    let elementId = '';
    const slideId = store.read().slides[0].id;
    store.batch(() => {
      elementId = store.addElement(slideId, {
        type: 'text',
        frame: { x: 100, y: 100, w: 400, h: 200, rotation: 0 },
        data: { blocks },
      });
    });
    return { slideId, elementId };
  }

  it('double-click on a text element enters edit mode', () => {
    const { canvas, overlay, store } = makeFixture();
    const { elementId } = addTextElement(store);
    const { mount, current } = makeMockMount();
    editor = initialize({
      canvas, overlay, store,
      hostWidth: 1920, hostHeight: 1080, dpr: 1,
      mountTextBox: mount,
    });
    expect(editor.getEditingElementId()).toBeNull();
    // Double-click in the middle of the text element (200, 200 logical
    // = 200, 200 client at scale 1).
    dispatchDblClick(canvas, 200, 200);
    expect(editor.getEditingElementId()).toBe(elementId);
    expect(current()).not.toBeNull();
    expect(current()!.isEditing()).toBe(true);
  });

  it('double-click on a non-text element does not enter edit mode', () => {
    const { canvas, overlay, store } = makeFixture();
    const slideId = store.read().slides[0].id;
    store.batch(() => {
      store.addElement(slideId, {
        type: 'shape',
        frame: { x: 100, y: 100, w: 200, h: 100, rotation: 0 },
        data: { kind: 'rect', fill: '#abc' },
      });
    });
    const { mount, current } = makeMockMount();
    editor = initialize({
      canvas, overlay, store,
      hostWidth: 1920, hostHeight: 1080, dpr: 1,
      mountTextBox: mount,
    });
    dispatchDblClick(canvas, 150, 150);
    expect(editor.getEditingElementId()).toBeNull();
    expect(current()).toBeNull();
  });

  it('selection handles are hidden for the element while editing', () => {
    const { canvas, overlay, store } = makeFixture();
    const { elementId } = addTextElement(store);
    const { mount } = makeMockMount();
    editor = initialize({
      canvas, overlay, store,
      hostWidth: 1920, hostHeight: 1080, dpr: 1,
      mountTextBox: mount,
    });
    // Select first to confirm handles render normally.
    editor.setSelection([elementId]);
    expect(overlay.querySelectorAll('[data-handle]').length).toBeGreaterThan(0);
    // Now enter edit mode → handles for this element should disappear.
    dispatchDblClick(canvas, 200, 200);
    expect(overlay.querySelectorAll('[data-handle]').length).toBe(0);
  });

  it('committed blocks persist via store.withTextElement', () => {
    const { canvas, overlay, store } = makeFixture();
    const { slideId, elementId } = addTextElement(store, [paragraph('hello')]);
    const { mount, current } = makeMockMount();
    editor = initialize({
      canvas, overlay, store,
      hostWidth: 1920, hostHeight: 1080, dpr: 1,
      mountTextBox: mount,
    });
    dispatchDblClick(canvas, 200, 200);
    expect(current()).not.toBeNull();
    const newBlocks = [paragraph('world')];
    current()!.fireCommit(newBlocks);
    // Edit mode exits.
    expect(editor.getEditingElementId()).toBeNull();
    // Store reflects the new blocks.
    const slide = store.read().slides.find((s) => s.id === slideId)!;
    const element = slide.elements.find((e) => e.id === elementId)! as TextElement;
    expect(element.data.blocks.length).toBe(1);
    expect(element.data.blocks[0].inlines[0].text).toBe('world');
    // Single undo entry (one batch).
    expect(store.canUndo()).toBe(true);
  });

  it('clicking outside the editing text-box commits and exits edit mode', () => {
    const { canvas, overlay, store } = makeFixture();
    addTextElement(store, [paragraph('hello')]);
    const { mount, current } = makeMockMount();
    editor = initialize({
      canvas, overlay, store,
      hostWidth: 1920, hostHeight: 1080, dpr: 1,
      mountTextBox: mount,
    });
    dispatchDblClick(canvas, 200, 200);
    expect(editor.getEditingElementId()).not.toBeNull();
    // Override commit to call onCommit synchronously with the seeded blocks
    // (the mock's default commit() does this).
    const tb = current()!;
    const commitSpy = vi.spyOn(tb, 'commit');
    // Click outside the text-box (canvas, far from element).
    dispatchMouseDown(canvas, 1500, 900);
    expect(commitSpy).toHaveBeenCalledTimes(1);
    expect(editor.getEditingElementId()).toBeNull();
  });

  it('clicking inside the editing text-box does NOT exit edit mode', () => {
    const { canvas, overlay, store } = makeFixture();
    addTextElement(store, [paragraph('hello')]);
    const { mount, current } = makeMockMount();
    editor = initialize({
      canvas, overlay, store,
      hostWidth: 1920, hostHeight: 1080, dpr: 1,
      mountTextBox: mount,
    });
    dispatchDblClick(canvas, 200, 200);
    expect(editor.getEditingElementId()).not.toBeNull();
    const tb = current()!;
    // Dispatch mousedown on the text-box container itself.
    dispatchMouseDown(tb.container, 200, 200);
    expect(editor.getEditingElementId()).not.toBeNull();
  });

  it('cancel (Escape) exits edit mode without committing changes', () => {
    const { canvas, overlay, store } = makeFixture();
    const { slideId, elementId } = addTextElement(store, [paragraph('hello')]);
    const { mount, current } = makeMockMount();
    editor = initialize({
      canvas, overlay, store,
      hostWidth: 1920, hostHeight: 1080, dpr: 1,
      mountTextBox: mount,
    });
    dispatchDblClick(canvas, 200, 200);
    const tb = current()!;
    // Fire cancel — onCancel is the editor's hook for "user pressed Escape".
    // The real docs editor still emits onCommit from the subsequent blur,
    // but onCancel itself is just notification. Here we drive only the
    // cancel signal so the test confirms onCancel alone is a no-op for
    // store state.
    tb.fireCancel();
    // Edit mode is still active because cancel alone doesn't exit;
    // the docs editor calls api.blur() after onCancel which routes
    // through onCommit. Drive that path next:
    tb.fireCommit([paragraph('hello')]);  // no-op write of identical blocks
    expect(editor.getEditingElementId()).toBeNull();
    // The store still has the original blocks.
    const slide = store.read().slides.find((s) => s.id === slideId)!;
    const element = slide.elements.find((e) => e.id === elementId)! as TextElement;
    expect(element.data.blocks[0].inlines[0].text).toBe('hello');
  });

  it('detach() during edit mode tears the text-box down cleanly', () => {
    const { canvas, overlay, store } = makeFixture();
    addTextElement(store);
    const { mount, current } = makeMockMount();
    editor = initialize({
      canvas, overlay, store,
      hostWidth: 1920, hostHeight: 1080, dpr: 1,
      mountTextBox: mount,
    });
    dispatchDblClick(canvas, 200, 200);
    const tb = current()!;
    expect(tb.isEditing()).toBe(true);
    editor.detach();
    expect(tb.isEditing()).toBe(false);
    // Container removed from overlay.
    expect(overlay.contains(tb.container)).toBe(false);
  });
});
