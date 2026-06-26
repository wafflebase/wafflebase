// @vitest-environment jsdom
import { describe, expect, it, afterEach } from 'vitest';
import '../../../src/view/canvas/test-canvas-env';
import { MemSlidesStore } from '../../../src/store/memory';
import { LayoutEditStore } from '../../../src/store/layout-edit-store';
import {
  layoutEditSlideId,
  placeholderElementId,
} from '../../../src/model/layout';
import { initialize, type SlidesEditor } from '../../../src/view/editor/editor';
import type {
  MountSlidesTextBoxOptions,
  SlidesTextBoxEditor,
} from '../../../src/view/editor/text-box-editor';

/**
 * PR3 commit 5b — the editor's layout-edit mode. `enterLayoutEditMode`
 * swaps the editor's store to a LayoutEditStore (so it renders/edits a
 * synthetic layout slide) and gates text editing; `exitLayoutEditMode`
 * restores the real store and slide. Geometry commits (drag / nudge)
 * route through the swapped store to `updateLayoutPlaceholderFrame`.
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
      onCursorMove: () => () => {},
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

function click(canvas: HTMLCanvasElement, x: number, y: number) {
  canvas.dispatchEvent(new PointerEvent('pointerdown', {
    clientX: x, clientY: y, pointerType: 'mouse', button: 0, bubbles: true,
  }));
  canvas.dispatchEvent(new PointerEvent('pointerup', {
    clientX: x, clientY: y, pointerType: 'mouse', button: 0, bubbles: true,
  }));
}

describe('editor layout-edit mode', () => {
  let editor: SlidesEditor | null = null;
  afterEach(() => {
    if (editor) { editor.detach(); editor = null; }
  });

  it('enterLayoutEditMode makes the synthetic layout slide current', () => {
    const { canvas, overlay, store } = setup();
    store.batch(() => store.addSlide('title-body'));
    const layoutStore = new LayoutEditStore(store, 'title-body');

    editor = initialize({
      canvas, overlay, store, hostWidth: 1920, hostHeight: 1080, dpr: 1,
      mountTextBox: makeMockMount(),
    });
    editor.enterLayoutEditMode(layoutStore);

    expect(editor.getCurrentSlideId()).toBe(layoutEditSlideId('title-body'));
  });

  it('suppresses text-edit entry while in layout-edit mode (still selects)', () => {
    const { canvas, overlay, store } = setup();
    store.batch(() => store.addSlide('title-body'));
    const layoutStore = new LayoutEditStore(store, 'title-body');

    editor = initialize({
      canvas, overlay, store, hostWidth: 1920, hostHeight: 1080, dpr: 1,
      mountTextBox: makeMockMount(),
    });
    editor.enterLayoutEditMode(layoutStore);

    const titleId = placeholderElementId({ type: 'title', index: 0 });
    const title = layoutStore
      .read()
      .slides[0].elements.find((e) => e.id === titleId)!;

    click(canvas, title.frame.x + title.frame.w / 2, title.frame.y + title.frame.h / 2);

    // Empty placeholder: in normal mode this 1-click-enters edit. In
    // layout-edit mode it must only select.
    expect(editor.getEditingElementId()).toBeNull();
    expect(editor.getSelection()).toEqual([titleId]);
  });

  it('dragging a placeholder commits to the layout (updateLayoutPlaceholderFrame)', () => {
    const { canvas, overlay, store } = setup();
    store.batch(() => store.addSlide('title-body'));
    const layoutStore = new LayoutEditStore(store, 'title-two-columns');

    editor = initialize({
      canvas, overlay, store, hostWidth: 1920, hostHeight: 1080, dpr: 1,
      mountTextBox: makeMockMount(),
    });
    editor.enterLayoutEditMode(layoutStore);

    // First body column of title-two-columns (HALF-width, so snapping to
    // slide edges/centre doesn't dominate the delta).
    const bodyId = placeholderElementId({ type: 'body', index: 0 });
    const before = store
      .read()
      .layouts.find((l) => l.id === 'title-two-columns')!
      .placeholders.filter((p) => p.placeholder.type === 'body')[0].frame;
    editor.setSelection([bodyId]);

    const cx = before.x + before.w / 2;
    const cy = before.y + before.h / 2;
    canvas.dispatchEvent(new PointerEvent('pointerdown', {
      clientX: cx, clientY: cy, pointerType: 'mouse', button: 0, bubbles: true,
    }));
    document.dispatchEvent(new PointerEvent('pointermove', {
      clientX: cx + 120, clientY: cy + 80, bubbles: true,
    }));
    document.dispatchEvent(new PointerEvent('pointerup', {
      clientX: cx + 120, clientY: cy + 80, bubbles: true,
    }));

    const after = store
      .read()
      .layouts.find((l) => l.id === 'title-two-columns')!
      .placeholders.filter((p) => p.placeholder.type === 'body')[0].frame;

    // The layout placeholder moved (~+120,+80 modulo ≤10px snap), and the
    // edit is undoable as one unit.
    expect(Math.abs(after.x - (before.x + 120))).toBeLessThanOrEqual(10);
    expect(Math.abs(after.y - (before.y + 80))).toBeLessThanOrEqual(10);
    expect(store.canUndo()).toBe(true);
    store.undo();
    expect(
      store
        .read()
        .layouts.find((l) => l.id === 'title-two-columns')!
        .placeholders.filter((p) => p.placeholder.type === 'body')[0].frame.x,
    ).toBe(before.x);
  });

  it('exitLayoutEditMode restores the real store and the given slide', () => {
    const { canvas, overlay, store } = setup();
    let sid = '';
    store.batch(() => { sid = store.addSlide('title-body'); });
    const layoutStore = new LayoutEditStore(store, 'title-body');

    editor = initialize({
      canvas, overlay, store, hostWidth: 1920, hostHeight: 1080, dpr: 1,
      mountTextBox: makeMockMount(),
    });
    editor.enterLayoutEditMode(layoutStore);
    expect(editor.getCurrentSlideId()).toBe(layoutEditSlideId('title-body'));

    editor.exitLayoutEditMode(store, sid);
    expect(editor.getCurrentSlideId()).toBe(sid);

    // Re-enter then exit restoring a slide id that no longer exists (e.g.
    // a peer deleted it during layout editing): fall back to a real slide
    // rather than leaving a dangling current id / blank canvas.
    editor.enterLayoutEditMode(layoutStore);
    editor.exitLayoutEditMode(store, "deleted-slide-id");
    expect(editor.getCurrentSlideId()).toBe(sid);

    // Back in normal mode: clicking an empty placeholder enters text edit.
    const titleId = store
      .read()
      .slides.find((s) => s.id === sid)!
      .elements.find((e) => e.placeholderRef?.type === 'title')!.id;
    const title = store
      .read()
      .slides.find((s) => s.id === sid)!
      .elements.find((e) => e.id === titleId)!;
    click(canvas, title.frame.x + title.frame.w / 2, title.frame.y + title.frame.h / 2);
    expect(editor.getEditingElementId()).toBe(titleId);
  });
});
