// @vitest-environment jsdom
import { describe, expect, it, beforeEach } from 'vitest';
import '../../../src/view/canvas/test-canvas-env';
import type { Block } from '@wafflebase/docs';
import { MemSlidesStore } from '../../../src/store/memory';
import { initialize, type SlidesEditor } from '../../../src/view/editor/editor';
import type {
  MountSlidesTextBoxOptions,
  SlidesTextBoxEditor,
} from '../../../src/view/editor/text-box-editor';

/**
 * Same mock-mount factory `hover-highlight.test.ts` uses: commits
 * synchronously on `commit()`, no canvas calls. Duplicated here on
 * purpose to keep each spec self-contained.
 */
function makeMockMount() {
  return function mount(opts: MountSlidesTextBoxOptions): SlidesTextBoxEditor {
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
      getRangeStyleSummary: () => ({}),
      applyStyle: () => {},
      clearInlineFormatting: () => {},
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
  };
}

function setup() {
  document.body.innerHTML = '';
  const canvas = document.createElement('canvas');
  canvas.width = 1920;
  canvas.height = 1080;
  const overlay = document.createElement('div');
  overlay.style.position = 'absolute';
  document.body.appendChild(canvas);
  document.body.appendChild(overlay);
  const store = new MemSlidesStore();
  return { canvas, overlay, store };
}

function emptyBlock(): Block {
  return {
    id: 'b1', type: 'paragraph',
    inlines: [{ text: '', style: {} }],
    style: {},
  } as Block;
}

function filledBlock(text: string): Block {
  return {
    id: 'b1', type: 'paragraph',
    inlines: [{ text, style: {} }],
    style: {},
  } as Block;
}

/**
 * Dispatch a pointerdown+pointerup pair at logical-slide (x, y). The
 * editor's `onPointerDown` is what triggers Phase B's 1-click entry;
 * the matching pointerup just unwinds the per-gesture suppression flag.
 * client = logical for the 1:1 canvas configured in `setup()`.
 */
function click(canvas: HTMLCanvasElement, x: number, y: number, mods: { shift?: boolean } = {}) {
  canvas.dispatchEvent(new PointerEvent('pointerdown', {
    clientX: x, clientY: y, pointerType: 'mouse',
    button: 0, shiftKey: mods.shift ?? false, bubbles: true,
  }));
  canvas.dispatchEvent(new PointerEvent('pointerup', {
    clientX: x, clientY: y, pointerType: 'mouse',
    button: 0, shiftKey: mods.shift ?? false, bubbles: true,
  }));
}

function findPlaceholderId(store: MemSlidesStore, slideId: string, type: string): string {
  const slide = store.read().slides.find((s) => s.id === slideId)!;
  const el = slide.elements.find((e) => e.placeholderRef?.type === type)!;
  return el.id;
}

describe('empty-placeholder 1-click entry', () => {
  let editor: SlidesEditor | null = null;

  beforeEach(() => {
    if (editor) { editor.detach(); editor = null; }
  });

  it('enters edit mode on first click into an empty Title placeholder', () => {
    const { canvas, overlay, store } = setup();
    let sid = '';
    store.batch(() => { sid = store.addSlide('title-body'); });
    const titleId = findPlaceholderId(store, sid, 'title');
    const title = store.read().slides
      .find((s) => s.id === sid)!.elements.find((e) => e.id === titleId)!;

    editor = initialize({
      canvas, overlay, store,
      hostWidth: 1920, hostHeight: 1080, dpr: 1,
      mountTextBox: makeMockMount(),
    });

    click(
      canvas,
      title.frame.x + title.frame.w / 2,
      title.frame.y + title.frame.h / 2,
    );

    expect(editor.getEditingElementId()).toBe(titleId);
  });

  it('does NOT enter edit on a fresh click into a NON-empty placeholder', () => {
    const { canvas, overlay, store } = setup();
    let sid = '';
    let titleId = '';
    store.batch(() => {
      sid = store.addSlide('title-body');
      titleId = findPlaceholderId(store, sid, 'title');
      // Replace the title's body with real content so the predicate
      // returns false.
      store.updateElementData(sid, titleId, {
        blocks: [filledBlock('Hi')],
      });
    });
    const title = store.read().slides
      .find((s) => s.id === sid)!.elements.find((e) => e.id === titleId)!;

    editor = initialize({
      canvas, overlay, store,
      hostWidth: 1920, hostHeight: 1080, dpr: 1,
      mountTextBox: makeMockMount(),
    });

    click(
      canvas,
      title.frame.x + title.frame.w / 2,
      title.frame.y + title.frame.h / 2,
    );

    expect(editor.getEditingElementId()).toBeNull();
    expect(editor.getSelection()).toEqual([titleId]);
  });

  it('does NOT enter edit on an empty NON-placeholder text box (no placeholderRef)', () => {
    const { canvas, overlay, store } = setup();
    let sid = '';
    let elId = '';
    store.batch(() => {
      sid = store.addSlide('blank');
      elId = store.addElement(sid, {
        type: 'text',
        frame: { x: 0, y: 0, w: 200, h: 100, rotation: 0 },
        data: { blocks: [emptyBlock()] },
      });
    });

    editor = initialize({
      canvas, overlay, store,
      hostWidth: 1920, hostHeight: 1080, dpr: 1,
      mountTextBox: makeMockMount(),
    });

    click(canvas, 50, 50);

    expect(editor.getEditingElementId()).toBeNull();
    expect(editor.getSelection()).toEqual([elId]);
  });

  it('shift-click into an empty placeholder does NOT auto-enter edit', () => {
    const { canvas, overlay, store } = setup();
    let sid = '';
    store.batch(() => { sid = store.addSlide('title-body'); });
    const titleId = findPlaceholderId(store, sid, 'title');
    const title = store.read().slides
      .find((s) => s.id === sid)!.elements.find((e) => e.id === titleId)!;

    editor = initialize({
      canvas, overlay, store,
      hostWidth: 1920, hostHeight: 1080, dpr: 1,
      mountTextBox: makeMockMount(),
    });

    click(
      canvas,
      title.frame.x + title.frame.w / 2,
      title.frame.y + title.frame.h / 2,
      { shift: true },
    );

    expect(editor.getEditingElementId()).toBeNull();
    expect(editor.getSelection()).toEqual([titleId]);
  });

  it('does NOT re-enter edit when clicking an already-selected empty placeholder', () => {
    const { canvas, overlay, store } = setup();
    let sid = '';
    store.batch(() => { sid = store.addSlide('title-body'); });
    const titleId = findPlaceholderId(store, sid, 'title');
    const title = store.read().slides
      .find((s) => s.id === sid)!.elements.find((e) => e.id === titleId)!;

    editor = initialize({
      canvas, overlay, store,
      hostWidth: 1920, hostHeight: 1080, dpr: 1,
      mountTextBox: makeMockMount(),
    });

    // Pre-select without going through the pointer path. This exercises
    // the "already selected" short-circuit in `onPointerDown`: that
    // branch routes to `startDrag` and must NOT auto-enter edit.
    editor.setSelection([titleId]);

    click(
      canvas,
      title.frame.x + title.frame.w / 2,
      title.frame.y + title.frame.h / 2,
    );

    expect(editor.getEditingElementId()).toBeNull();
    expect(editor.getSelection()).toEqual([titleId]);
  });
});
