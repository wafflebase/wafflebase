// @vitest-environment jsdom
//
// `SlidesEditorImpl.render()` is driven from the host's RAF loop
// (SlidesView, board-view), so it runs ~60x a second whether or not the
// document changed. It used to call `store.read()` unconditionally at
// the top; the dirty short-circuit lived one level down inside
// `SlideRenderer.render()`, i.e. AFTER the read had already deep-copied
// the whole document. On a Yorkie-backed board (one unbounded slide
// holding every element) that made an idle frame cost ~65 ms.
//
// These tests pin the guard: no read on a clean idle frame, and a read
// (+ paint) on every frame that genuinely has something to paint.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import '../../../src/view/canvas/test-canvas-env';
import { MemSlidesStore } from '../../../src/store/memory';
import { initialize, type SlidesEditor } from '../../../src/view/editor/editor';
import type { SlidesDocument } from '../../../src/model/presentation';
import type { Block } from '@wafflebase/docs';
import type {
  MountSlidesTextBoxOptions,
  SlidesTextBoxEditor,
} from '../../../src/view/editor/text-box-editor';

/** MemSlidesStore that counts how many times `read()` was called. */
class CountingStore extends MemSlidesStore {
  reads = 0;
  override read(): SlidesDocument {
    this.reads++;
    return super.read();
  }
}

/**
 * Count canvas paints. `drawSlide` always calls `ctx.setTransform` at
 * least once, and nothing else in the editor's clean-frame path touches
 * the 2D context, so a non-zero delta means "the canvas was painted".
 * The test-canvas-env stub hands out a fresh ctx per `getContext('2d')`,
 * so the counter has to be installed on the prototype before the editor
 * acquires its context.
 */
let paintOps = 0;
const originalGetContext = HTMLCanvasElement.prototype.getContext;

beforeEach(() => {
  document.body.innerHTML = '';
  paintOps = 0;
  HTMLCanvasElement.prototype.getContext = function patched(
    this: HTMLCanvasElement,
    contextId: string,
    ...rest: unknown[]
  ): unknown {
    const ctx = (
      originalGetContext as (this: HTMLCanvasElement, ...a: unknown[]) => unknown
    ).call(this, contextId, ...rest) as Record<string, unknown> | null;
    if (contextId === '2d' && ctx) {
      const inner = ctx.setTransform as (...a: unknown[]) => unknown;
      ctx.setTransform = (...args: unknown[]) => {
        paintOps++;
        return inner.apply(ctx, args);
      };
    }
    return ctx;
  } as HTMLCanvasElement['getContext'];
});

afterEach(() => {
  HTMLCanvasElement.prototype.getContext = originalGetContext;
});

function mockMountTextBox(opts: MountSlidesTextBoxOptions): SlidesTextBoxEditor {
  const container = document.createElement('div');
  container.className = 'wfb-slides-text-box-editor';
  container.style.position = 'absolute';
  opts.overlay.appendChild(container);
  let mounted = true;
  return {
    isEditing: () => mounted,
    focus: () => undefined,
    commit: () => opts.onCommit(opts.blocks),
    detach: () => {
      mounted = false;
      container.remove();
    },
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
    onCursorMove: () => () => {},
  };
}

function setup() {
  const canvas = document.createElement('canvas');
  canvas.width = 1920;
  canvas.height = 1080;
  const overlay = document.createElement('div');
  overlay.style.position = 'absolute';
  document.body.appendChild(canvas);
  document.body.appendChild(overlay);
  const store = new CountingStore();
  let slideId = '';
  store.batch(() => {
    slideId = store.addSlide('blank');
  });
  const editor = initialize({
    canvas,
    overlay,
    store,
    hostWidth: 1920,
    hostHeight: 1080,
    dpr: 1,
    mountTextBox: mockMountTextBox,
  });
  return { canvas, overlay, store, editor, slideId };
}

function addImage(store: CountingStore, slideId: string): string {
  let id = '';
  store.batch(() => {
    id = store.addElement(slideId, {
      type: 'image',
      frame: { x: 200, y: 200, w: 400, h: 300, rotation: 0 },
      data: { src: 'data:image/png;base64,AAAA' },
    });
  });
  return id;
}

/** Minimal blank paragraph for a text element (see hover-highlight.test.ts). */
function emptyBlock(): Block {
  return {
    id: 'b1',
    type: 'paragraph',
    inlines: [{ text: '', style: {} }],
    style: {},
  } as Block;
}

function addText(store: CountingStore, slideId: string): string {
  let id = '';
  store.batch(() => {
    id = store.addElement(slideId, {
      type: 'text',
      frame: { x: 100, y: 100, w: 400, h: 120, rotation: 0 },
      data: { blocks: [emptyBlock()] },
    });
  });
  return id;
}

/** Run `n` idle RAF frames and report the work each one cost. */
function idleFrames(editor: SlidesEditor, store: CountingStore, n: number) {
  const readsBefore = store.reads;
  const paintsBefore = paintOps;
  for (let i = 0; i < n; i++) editor.render();
  return { reads: store.reads - readsBefore, paints: paintOps - paintsBefore };
}

describe('render() idle short-circuit', () => {
  let editor: SlidesEditor | null = null;

  afterEach(() => {
    if (editor) {
      editor.detach();
      editor = null;
    }
  });

  it('does not call store.read() on a clean idle frame', () => {
    const fixture = setup();
    editor = fixture.editor;
    // First frame: the renderer starts dirty, so it must read + paint.
    const first = idleFrames(editor, fixture.store, 1);
    expect(first.reads).toBeGreaterThan(0);
    expect(first.paints).toBeGreaterThan(0);

    // Every subsequent frame with no change: zero reads, zero paints.
    // This is the actual defect being fixed — before the guard, a clean
    // frame still paid a full `store.read()`.
    const idle = idleFrames(editor, fixture.store, 10);
    expect(idle.reads).toBe(0);
    expect(idle.paints).toBe(0);
  });

  it('reads and paints again once the renderer is marked dirty', () => {
    const fixture = setup();
    editor = fixture.editor;
    editor.render();
    expect(idleFrames(editor, fixture.store, 1).reads).toBe(0);

    editor.markDirty();
    const dirty = idleFrames(editor, fixture.store, 1);
    expect(dirty.reads).toBeGreaterThan(0);
    expect(dirty.paints).toBeGreaterThan(0);

    // ...and settles back to free frames afterwards.
    expect(idleFrames(editor, fixture.store, 3).reads).toBe(0);
  });

  it('reads and paints on every frame while text editing', () => {
    const fixture = setup();
    editor = fixture.editor;
    const textId = addText(fixture.store, fixture.slideId);
    editor.enterTextEditing(textId);
    expect(editor.isTextEditing()).toBe(true);

    // The text-box editor composites its own canvas over the slide
    // canvas, so the slide must repaint (with the edited element masked)
    // on every frame — the dirty flag must NOT short-circuit this.
    const frames = idleFrames(editor, fixture.store, 3);
    expect(frames.reads).toBe(3);
    expect(frames.paints).toBeGreaterThan(0);
  });

  it('reads and paints on every frame during a crop session', () => {
    const fixture = setup();
    editor = fixture.editor;
    const imageId = addImage(fixture.store, fixture.slideId);
    editor.enterImageCrop(imageId);
    expect(editor.isCropping()).toBe(true);

    // The crop preview (dimmed full bitmap + bright window) is live
    // session state the renderer knows nothing about, so it too has to
    // bypass the dirty flag every frame.
    const frames = idleFrames(editor, fixture.store, 3);
    expect(frames.reads).toBe(3);
    expect(frames.paints).toBeGreaterThan(0);
  });

  it('returns to free idle frames after leaving crop and text edit', () => {
    const fixture = setup();
    editor = fixture.editor;
    const imageId = addImage(fixture.store, fixture.slideId);
    editor.enterImageCrop(imageId);
    expect(idleFrames(editor, fixture.store, 1).reads).toBe(1);

    editor.exitImageCrop(false);
    expect(editor.isCropping()).toBe(false);
    // One settling frame for the exit's own repaint, then free.
    editor.render();
    expect(idleFrames(editor, fixture.store, 5).reads).toBe(0);
  });
});
