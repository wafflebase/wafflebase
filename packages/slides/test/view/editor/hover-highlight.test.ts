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
 * Build a minimal mock text-box mount so `enterTextEditing` can
 * complete synchronously in jsdom without spinning up the real docs
 * Canvas-based editor. The mock commits immediately on `commit()`.
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
  }
  return mount;
}

/**
 * Build a minimal blank text Block for use with text elements.
 */
function emptyBlock(): Block {
  return {
    id: 'b1',
    type: 'paragraph',
    inlines: [{ text: '', style: {} }],
    style: {},
  } as Block;
}

describe('hover highlight state', () => {
  let editor: SlidesEditor | null = null;

  beforeEach(() => {
    document.body.innerHTML = '';
    if (editor) {
      editor.detach();
      editor = null;
    }
  });

  it('sets hoverHighlightId when pointer is over an unselected element', () => {
    const canvas = document.createElement('canvas');
    canvas.width = 1920;
    canvas.height = 1080;
    const overlay = document.createElement('div');
    overlay.style.position = 'absolute';
    document.body.appendChild(canvas);
    document.body.appendChild(overlay);
    const store = new MemSlidesStore();
    store.batch(() => store.addSlide('blank'));
    let elementId = '';
    store.batch(() => {
      const sid = store.read().slides[0].id;
      elementId = store.addElement(sid, {
        type: 'shape',
        frame: { x: 0, y: 0, w: 100, h: 100, rotation: 0 },
        data: { kind: 'rect', fill: { kind: 'srgb' as const, value: '#abc' } },
      });
    });
    editor = initialize({ canvas, overlay, store, hostWidth: 1920, hostHeight: 1080, dpr: 1 });

    canvas.dispatchEvent(new PointerEvent('pointermove', {
      clientX: 50, clientY: 50, pointerType: 'mouse', bubbles: true,
    }));
    expect(editor.getHoverHighlightId()).toBe(elementId);
  });

  it('clears hoverHighlightId when pointer leaves all elements', () => {
    const canvas = document.createElement('canvas');
    canvas.width = 1920;
    canvas.height = 1080;
    const overlay = document.createElement('div');
    overlay.style.position = 'absolute';
    document.body.appendChild(canvas);
    document.body.appendChild(overlay);
    const store = new MemSlidesStore();
    store.batch(() => store.addSlide('blank'));
    store.batch(() => {
      const sid = store.read().slides[0].id;
      store.addElement(sid, {
        type: 'shape',
        frame: { x: 0, y: 0, w: 100, h: 100, rotation: 0 },
        data: { kind: 'rect', fill: { kind: 'srgb' as const, value: '#abc' } },
      });
    });
    editor = initialize({ canvas, overlay, store, hostWidth: 1920, hostHeight: 1080, dpr: 1 });

    canvas.dispatchEvent(new PointerEvent('pointermove', {
      clientX: 50, clientY: 50, pointerType: 'mouse', bubbles: true,
    }));
    canvas.dispatchEvent(new PointerEvent('pointermove', {
      clientX: 500, clientY: 500, pointerType: 'mouse', bubbles: true,
    }));
    expect(editor.getHoverHighlightId()).toBeNull();
  });

  it('does NOT set hoverHighlightId for an already-selected element', () => {
    const canvas = document.createElement('canvas');
    canvas.width = 1920;
    canvas.height = 1080;
    const overlay = document.createElement('div');
    overlay.style.position = 'absolute';
    document.body.appendChild(canvas);
    document.body.appendChild(overlay);
    const store = new MemSlidesStore();
    store.batch(() => store.addSlide('blank'));
    let elementId = '';
    store.batch(() => {
      const sid = store.read().slides[0].id;
      elementId = store.addElement(sid, {
        type: 'shape',
        frame: { x: 0, y: 0, w: 100, h: 100, rotation: 0 },
        data: { kind: 'rect', fill: { kind: 'srgb' as const, value: '#abc' } },
      });
    });
    editor = initialize({ canvas, overlay, store, hostWidth: 1920, hostHeight: 1080, dpr: 1 });
    editor.setSelection([elementId]);

    canvas.dispatchEvent(new PointerEvent('pointermove', {
      clientX: 50, clientY: 50, pointerType: 'mouse', bubbles: true,
    }));
    expect(editor.getHoverHighlightId()).toBeNull();
  });

  it('clears hoverHighlightId when entering edit mode', () => {
    const canvas = document.createElement('canvas');
    canvas.width = 1920;
    canvas.height = 1080;
    const overlay = document.createElement('div');
    overlay.style.position = 'absolute';
    document.body.appendChild(canvas);
    document.body.appendChild(overlay);
    const store = new MemSlidesStore();
    store.batch(() => store.addSlide('blank'));
    let textId = '';
    store.batch(() => {
      const sid = store.read().slides[0].id;
      textId = store.addElement(sid, {
        type: 'text',
        frame: { x: 0, y: 0, w: 100, h: 100, rotation: 0 },
        data: { blocks: [emptyBlock()] },
      });
    });
    editor = initialize({
      canvas, overlay, store,
      hostWidth: 1920, hostHeight: 1080, dpr: 1,
      mountTextBox: makeMockMount(),
    });

    // Hover over the text element (unselected).
    canvas.dispatchEvent(new PointerEvent('pointermove', {
      clientX: 50, clientY: 50, pointerType: 'mouse', bubbles: true,
    }));
    expect(editor.getHoverHighlightId()).toBe(textId);

    // Enter edit mode — highlight should clear.
    editor.enterTextEditing(textId);
    expect(editor.getHoverHighlightId()).toBeNull();
  });
});
