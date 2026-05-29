// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import '../../../src/view/canvas/test-canvas-env';
import type { Block } from '@wafflebase/docs';
import { MemSlidesStore } from '../../../src/store/memory';
import type { TextElement } from '../../../src/model/element';
import { defaultDark } from '../../../src/themes';
import { resolveColor } from '../../../src/model/theme';
import { initialize, type SlidesEditor } from '../../../src/view/editor/editor';
import type {
  MountSlidesTextBoxOptions,
  SlidesTextBoxEditor,
} from '../../../src/view/editor/text-box-editor';

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
  /** Fire onContentHeightChange with a logical height. */
  fireContentHeight(h: number): void;
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
      fireContentHeight(h: number): void {
        opts.onContentHeightChange?.(h);
      },
      opts,
      // Formatting surface — no-op stubs for the mock (real delegation is
      // tested separately via the docs TextBoxEditorAPI tests).
      getSelectionStyle: () => ({}),
      getRangeStyleSummary: () => ({}),
      applyStyle: () => {},
      clearFormatting: () => {},
      applyBlockStyle: () => {},
      getBlockType: () => ({ type: 'paragraph' as const }),
      getBlockStyle: () => ({}),
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
  target.dispatchEvent(new PointerEvent('pointerdown', {
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

  it('double-click inside an already-editing text element does NOT remount', () => {
    // Regression: dblclick inside an edited text-box was bubbling to the
    // slides overlay listener, which called enterEditMode on the same
    // element. enterEditMode short-circuits "already editing" via
    // exitEditMode('commit') → mountTextBox again, which resets the
    // docs cursor to offset 0 and wipes any word selection the inner
    // TextEditor just made on the second mousedown. The slides editor
    // should ignore dblclicks whose hit-target IS the editing element
    // and let the docs TextEditor own word selection.
    const { canvas, overlay, store } = makeFixture();
    addTextElement(store);
    let mountCount = 0;
    const inner = makeMockMount();
    const mount = (opts: MountSlidesTextBoxOptions): SlidesTextBoxEditor => {
      mountCount++;
      return inner.mount(opts);
    };
    editor = initialize({
      canvas, overlay, store,
      hostWidth: 1920, hostHeight: 1080, dpr: 1,
      mountTextBox: mount,
    });
    dispatchDblClick(canvas, 200, 200);
    expect(mountCount).toBe(1);
    // Dispatch a second dblclick at the same point. The hit-target is
    // still the editing element — slides editor must NOT remount.
    dispatchDblClick(canvas, 220, 200);
    expect(mountCount).toBe(1);
  });

  it('double-click on a non-text element does not enter edit mode', () => {
    const { canvas, overlay, store } = makeFixture();
    const slideId = store.read().slides[0].id;
    store.batch(() => {
      store.addElement(slideId, {
        type: 'shape',
        frame: { x: 100, y: 100, w: 200, h: 100, rotation: 0 },
        data: { kind: 'rect', fill: { kind: 'srgb' as const, value: '#abc' } },
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

  it('passes a theme-aware colorResolver so dark-theme text is not painted black', () => {
    // Regression: entering edit mode in a dark deck theme painted text
    // black/invisible because the docs text-box fell back to the default
    // (literal-string) color resolver. The committed slide canvas remaps
    // the docs-default '#000000' and undefined colors to the deck's text
    // role color; edit mode must apply the SAME resolver so the text
    // stays readable while editing.
    const { canvas, overlay, store } = makeFixture();
    store.batch(() => {
      store.addTheme(defaultDark);
      store.applyTheme(defaultDark.id);
    });
    addTextElement(store);
    const { mount, current } = makeMockMount();
    editor = initialize({
      canvas, overlay, store,
      hostWidth: 1920, hostHeight: 1080, dpr: 1,
      mountTextBox: mount,
    });
    dispatchDblClick(canvas, 200, 200);

    const resolver = current()!.opts.colorResolver;
    expect(resolver).toBeDefined();

    const themeText = resolveColor({ kind: 'role', role: 'text' }, defaultDark);
    // Dark theme text role is a light ink — not literal black.
    expect(themeText.toLowerCase()).not.toBe('#000000');
    // The docs editor seeds new inlines with color '#000000' and leaves
    // sparse runs undefined; both must resolve to the deck's text color.
    expect(resolver!('#000000')).toBe(themeText);
    expect(resolver!(undefined)).toBe(themeText);
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

  it('Escape discards in-flight edits (cancel suppresses the subsequent commit write)', () => {
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
    // Real docs editor sequence on Escape: fires onCancel first, then
    // routes the subsequent blur through onCommit with whatever the
    // user typed. Drive both, supplying *modified* blocks so we verify
    // they are NOT persisted.
    tb.fireCancel();
    tb.fireCommit([paragraph('typed-but-discarded')]);
    expect(editor.getEditingElementId()).toBeNull();
    // Store still has the original blocks — edits were discarded.
    const slide = store.read().slides.find((s) => s.id === slideId)!;
    const element = slide.elements.find((e) => e.id === elementId)! as TextElement;
    expect(element.data.blocks[0].inlines[0].text).toBe('hello');
    // The previous (pre-Escape) batch is the addTextElement that ran in
    // the test setup. One undo should remove the text element entirely;
    // if the commit-suppression had failed and a write-batch had been
    // pushed, undo would only roll the blocks back instead of removing
    // the element.
    store.undo();
    expect(store.read().slides[0].elements).toHaveLength(0);
  });

  it('align/distribute are no-ops while a text box is in edit mode', () => {
    // The mounted text-box editor positions its DOM container against
    // the frame coords captured at mount time. Mutating frame.x/y mid-
    // edit would diverge the editor from the underlying element until
    // the next mount cycle. Block layout actions while editing.
    const { canvas, overlay, store } = makeFixture();
    const slideId = store.read().slides[0].id;
    // Add two text elements so multi-select align has something to do.
    const { elementId: aId } = addTextElement(store);
    let bId = '';
    store.batch(() => {
      bId = store.addElement(slideId, {
        type: 'text',
        frame: { x: 800, y: 100, w: 400, h: 200, rotation: 0 },
        data: { blocks: [paragraph('two')] },
      });
    });
    const { mount } = makeMockMount();
    editor = initialize({
      canvas, overlay, store,
      hostWidth: 1920, hostHeight: 1080, dpr: 1,
      mountTextBox: mount,
    });
    editor.setSelection([aId, bId]);
    // Snapshot frames before entering edit mode.
    const beforeA = store.read().slides[0].elements.find((e) => e.id === aId)!.frame;
    const beforeB = store.read().slides[0].elements.find((e) => e.id === bId)!.frame;
    // Enter edit mode on element a.
    dispatchDblClick(canvas, 200, 200);
    expect(editor.getEditingElementId()).toBe(aId);
    // Try to align — should be a no-op while editing.
    editor.align('left');
    editor.distribute('horizontal');
    const afterA = store.read().slides[0].elements.find((e) => e.id === aId)!.frame;
    const afterB = store.read().slides[0].elements.find((e) => e.id === bId)!.frame;
    expect(afterA).toEqual(beforeA);
    expect(afterB).toEqual(beforeB);
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

describe('SlidesEditor text-editing API', () => {
  let editor: SlidesEditor | null = null;

  beforeEach(() => {
    document.body.innerHTML = '';
    if (editor) {
      editor.detach();
      editor = null;
    }
  });

  it('isTextEditing() returns false before any edit, true between enter/exit, false after', () => {
    const { canvas, overlay, store } = makeFixture();
    const { elementId } = (() => {
      let id = '';
      const slideId = store.read().slides[0].id;
      store.batch(() => { id = store.addElement(slideId, { type: 'text', frame: { x: 100, y: 100, w: 400, h: 200, rotation: 0 }, data: { blocks: [paragraph('hello')] } }); });
      return { elementId: id };
    })();
    const { mount, current } = makeMockMount();
    editor = initialize({ canvas, overlay, store, hostWidth: 1920, hostHeight: 1080, dpr: 1, mountTextBox: mount });

    expect(editor.isTextEditing()).toBe(false);

    editor.enterTextEditing(elementId);
    expect(editor.isTextEditing()).toBe(true);

    current()!.fireCommit([paragraph('done')]);
    expect(editor.isTextEditing()).toBe(false);
  });

  it('onTextEditingChange fires once on enter and once on exit', () => {
    const { canvas, overlay, store } = makeFixture();
    const { elementId } = (() => {
      let id = '';
      const slideId = store.read().slides[0].id;
      store.batch(() => { id = store.addElement(slideId, { type: 'text', frame: { x: 100, y: 100, w: 400, h: 200, rotation: 0 }, data: { blocks: [paragraph('hello')] } }); });
      return { elementId: id };
    })();
    const { mount, current } = makeMockMount();
    editor = initialize({ canvas, overlay, store, hostWidth: 1920, hostHeight: 1080, dpr: 1, mountTextBox: mount });

    let calls = 0;
    editor.onTextEditingChange(() => { calls++; });

    editor.enterTextEditing(elementId);
    expect(calls).toBe(1);

    current()!.fireCommit([paragraph('done')]);
    expect(calls).toBe(2);
  });

  it('getActiveTextEditor() returns null when not editing, non-null when editing', () => {
    const { canvas, overlay, store } = makeFixture();
    const { elementId } = (() => {
      let id = '';
      const slideId = store.read().slides[0].id;
      store.batch(() => { id = store.addElement(slideId, { type: 'text', frame: { x: 100, y: 100, w: 400, h: 200, rotation: 0 }, data: { blocks: [paragraph('hello')] } }); });
      return { elementId: id };
    })();
    const { mount, current } = makeMockMount();
    editor = initialize({ canvas, overlay, store, hostWidth: 1920, hostHeight: 1080, dpr: 1, mountTextBox: mount });

    expect(editor.getActiveTextEditor()).toBeNull();

    editor.enterTextEditing(elementId);
    expect(editor.getActiveTextEditor()).not.toBeNull();

    current()!.fireCommit([paragraph('done')]);
    expect(editor.getActiveTextEditor()).toBeNull();
  });

  it('unsubscribe returned from onTextEditingChange removes the listener', () => {
    const { canvas, overlay, store } = makeFixture();
    const { elementId } = (() => {
      let id = '';
      const slideId = store.read().slides[0].id;
      store.batch(() => { id = store.addElement(slideId, { type: 'text', frame: { x: 100, y: 100, w: 400, h: 200, rotation: 0 }, data: { blocks: [paragraph('hello')] } }); });
      return { elementId: id };
    })();
    const { mount, current } = makeMockMount();
    editor = initialize({ canvas, overlay, store, hostWidth: 1920, hostHeight: 1080, dpr: 1, mountTextBox: mount });

    let calls = 0;
    const off = editor.onTextEditingChange(() => { calls++; });

    editor.enterTextEditing(elementId);
    expect(calls).toBe(1);

    off();

    current()!.fireCommit([paragraph('done')]);
    // Listener was removed — should NOT fire on exit.
    expect(calls).toBe(1);
  });

  it('exitTextEditing() commits and exits edit mode', () => {
    const { canvas, overlay, store } = makeFixture();
    const { elementId } = (() => {
      let id = '';
      const slideId = store.read().slides[0].id;
      store.batch(() => { id = store.addElement(slideId, { type: 'text', frame: { x: 100, y: 100, w: 400, h: 200, rotation: 0 }, data: { blocks: [paragraph('hello')] } }); });
      return { elementId: id };
    })();
    const { mount } = makeMockMount();
    editor = initialize({ canvas, overlay, store, hostWidth: 1920, hostHeight: 1080, dpr: 1, mountTextBox: mount });

    editor.enterTextEditing(elementId);
    expect(editor.isTextEditing()).toBe(true);

    editor.exitTextEditing();
    expect(editor.isTextEditing()).toBe(false);
    expect(editor.getActiveTextEditor()).toBeNull();
  });

  it('getActiveTextEditor() exposes the formatting surface of SlidesTextBoxEditor', () => {
    const { canvas, overlay, store } = makeFixture();
    const { elementId } = (() => {
      let id = '';
      const slideId = store.read().slides[0].id;
      store.batch(() => { id = store.addElement(slideId, { type: 'text', frame: { x: 100, y: 100, w: 400, h: 200, rotation: 0 }, data: { blocks: [paragraph('hello')] } }); });
      return { elementId: id };
    })();
    const { mount } = makeMockMount();
    editor = initialize({ canvas, overlay, store, hostWidth: 1920, hostHeight: 1080, dpr: 1, mountTextBox: mount });

    editor.enterTextEditing(elementId);
    const textEditor = editor.getActiveTextEditor();
    expect(textEditor).not.toBeNull();

    // Verify all formatting methods are present and callable.
    expect(typeof textEditor!.getSelectionStyle).toBe('function');
    expect(typeof textEditor!.applyStyle).toBe('function');
    expect(typeof textEditor!.applyBlockStyle).toBe('function');
    expect(typeof textEditor!.getBlockType).toBe('function');
    expect(typeof textEditor!.setBlockType).toBe('function');
    expect(typeof textEditor!.toggleList).toBe('function');
    expect(typeof textEditor!.indent).toBe('function');
    expect(typeof textEditor!.outdent).toBe('function');
    expect(typeof textEditor!.insertLink).toBe('function');
    expect(typeof textEditor!.removeLink).toBe('function');
    expect(typeof textEditor!.getLinkAtCursor).toBe('function');
    expect(typeof textEditor!.requestLink).toBe('function');
    expect(typeof textEditor!.undo).toBe('function');
    expect(typeof textEditor!.redo).toBe('function');
    expect(typeof textEditor!.onCursorMove).toBe('function');
  });
});

describe('slides text-box insert-to-edit + auto-grow', () => {
  let editor: SlidesEditor | null = null;

  beforeEach(() => {
    document.body.innerHTML = '';
    if (editor) { editor.detach(); editor = null; }
  });

  it('inserting a text box enters edit mode and adds the element', () => {
    const { canvas, overlay, store } = makeFixture();
    const { mount } = makeMockMount();
    editor = initialize({
      canvas, overlay, store,
      hostWidth: 1920, hostHeight: 1080, dpr: 1,
      mountTextBox: mount,
    });
    editor.setInsertMode('text');
    canvas.dispatchEvent(new PointerEvent('pointerdown', { clientX: 300, clientY: 200, bubbles: true }));
    document.dispatchEvent(new PointerEvent('pointerup', { clientX: 300, clientY: 200, bubbles: true }));

    const els = store.read().slides[0].elements;
    expect(els.length).toBe(1);
    expect(els[0].type).toBe('text');
    expect(editor.getEditingElementId()).toBe(els[0].id);
    // Insert mode disarms after placing.
    expect(editor.getInsertMode()).toBeNull();
  });

  it('commits the fitted content height into the element frame (one undo entry)', () => {
    const { canvas, overlay, store } = makeFixture();
    const slideId = store.read().slides[0].id;
    let elementId = '';
    store.batch(() => {
      elementId = store.addElement(slideId, {
        type: 'text',
        frame: { x: 100, y: 100, w: 400, h: 80, rotation: 0 },
        data: { blocks: [{ id: 'b1', type: 'paragraph', inlines: [{ text: 'hi', style: {} }], style: {} } as Block] },
      });
    });
    const { mount, current } = makeMockMount();
    editor = initialize({
      canvas, overlay, store,
      hostWidth: 1920, hostHeight: 1080, dpr: 1,
      mountTextBox: mount,
    });
    editor.enterTextEditing(elementId);
    // Simulate the docs editor reporting a grown content height.
    current()!.fireContentHeight(150);
    current()!.fireCommit([{ id: 'b1', type: 'paragraph', inlines: [{ text: 'hi there', style: {} }], style: {} } as Block]);

    const el = store.read().slides[0].elements.find((e) => e.id === elementId)!;
    expect(el.frame.h).toBe(150);
    // Text + height landed in one batch → one undo restores both.
    store.undo();
    const reverted = store.read().slides[0].elements.find((e) => e.id === elementId)!;
    expect(reverted.frame.h).toBe(80);
  });
});
