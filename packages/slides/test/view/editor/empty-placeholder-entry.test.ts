// @vitest-environment jsdom
import { describe, expect, it, afterEach } from 'vitest';
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

  // Detach in `afterEach` so the final test's editor doesn't leave its
  // document-level pointerup/pointercancel capture listeners attached
  // — `beforeEach` would only clean up *before* the next test, leaving
  // the last instance dangling.
  afterEach(() => {
    if (editor) { editor.detach(); editor = null; }
  });

  it('calls preventDefault on the pointerdown so the textarea keeps focus', () => {
    // Real-browser regression: without preventDefault, the synthetic
    // click that follows pointerup re-focuses the canvas / body and the
    // just-mounted textarea blurs → onCommit → exitEditMode within
    // ~1 ms, dropping the user back out of edit mode before they can
    // type. The dblclick path already preventDefaults for the same
    // reason. This test would have caught the dev-mode failure.
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

    const downEvent = new PointerEvent('pointerdown', {
      clientX: title.frame.x + title.frame.w / 2,
      clientY: title.frame.y + title.frame.h / 2,
      pointerType: 'mouse', button: 0, bubbles: true, cancelable: true,
    });
    canvas.dispatchEvent(downEvent);
    expect(downEvent.defaultPrevented).toBe(true);
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

  it('one click per region: title click → commit → body click both auto-enter edit', () => {
    // Drive the full real-user flow: click empty Title (enters edit),
    // commit out, then click empty Body. Selection still holds the
    // title id after commit (see `finishEditMode` — it only clears
    // editing state, not selection), so the body click is a fresh
    // *replacement* selection. Both clicks must auto-enter edit; the
    // body click in particular has to work even though edit-then-
    // commit just ran on a *different* element. A shortcut via
    // `editor.setSelection([titleId])` would skip the commit lifecycle
    // and miss any "lingering edit state blocks the next 1-click"
    // regression.
    const { canvas, overlay, store } = setup();
    let sid = '';
    store.batch(() => { sid = store.addSlide('title-body'); });
    const titleId = findPlaceholderId(store, sid, 'title');
    const bodyId = findPlaceholderId(store, sid, 'body');
    const slide = store.read().slides.find((s) => s.id === sid)!;
    const title = slide.elements.find((e) => e.id === titleId)!;
    const body = slide.elements.find((e) => e.id === bodyId)!;

    editor = initialize({
      canvas, overlay, store,
      hostWidth: 1920, hostHeight: 1080, dpr: 1,
      mountTextBox: makeMockMount(),
    });

    // 1. Click empty Title → 1-click entry should fire.
    click(
      canvas,
      title.frame.x + title.frame.w / 2,
      title.frame.y + title.frame.h / 2,
    );
    expect(editor.getEditingElementId()).toBe(titleId);

    // 2. Commit out of edit (mirrors the user pressing Esc / clicking
    //    away). Selection keeps titleId per `finishEditMode`.
    editor.exitTextEditing();
    expect(editor.getEditingElementId()).toBeNull();
    expect(editor.getSelection()).toEqual([titleId]);

    // 3. Click empty Body — fresh replacement selection; 1-click entry
    //    must fire again.
    click(
      canvas,
      body.frame.x + body.frame.w / 2,
      body.frame.y + body.frame.h / 2,
    );
    expect(editor.getEditingElementId()).toBe(bodyId);
    expect(editor.getSelection()).toEqual([bodyId]);
  });

  it('does NOT enter edit on a single click after programmatic selection (P1.5 requires a real prior click)', () => {
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

    // Pre-select without going through the pointer path (collab presence
    // restore, Tab navigation, programmatic setSelection). The next
    // pointer-down lands the "already selected" short-circuit in
    // `onPointerDown`, but P1.5 stays disarmed because there was no
    // prior click on this element within the sequence window — only the
    // SECOND click on a selected element enters edit. See
    // docs/design/slides/slides-hover-and-text-edit-entry.md § P1.5.
    editor.setSelection([titleId]);

    click(
      canvas,
      title.frame.x + title.frame.w / 2,
      title.frame.y + title.frame.h / 2,
    );

    expect(editor.getEditingElementId()).toBeNull();
    expect(editor.getSelection()).toEqual([titleId]);
  });

  it('enters edit via P1.5 on the SECOND click on a selected text-capable element', () => {
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

    const cx = title.frame.x + title.frame.w / 2;
    const cy = title.frame.y + title.frame.h / 2;

    // First click: P1.4 fires because this is an empty placeholder and
    // a fresh selection — the element wasn't selected before.
    click(canvas, cx, cy);
    expect(editor.getEditingElementId()).toBe(titleId);
    // Commit out (mirrors clicking away then back).
    editor.exitTextEditing();
    expect(editor.getEditingElementId()).toBeNull();

    // Second click on the same (still-selected) element within the
    // sequence window → P1.5 enters edit.
    click(canvas, cx, cy);
    expect(editor.getEditingElementId()).toBe(titleId);
  });

  it('P1.5 enters edit on a shape WITHOUT any text body yet (matches dblclick parity)', () => {
    // Regression: tryEnterEditFromSlowDoubleClick previously bailed via
    // getTextRegionRect returning null for shapes whose `data.text` was
    // never seeded — silently no-op on freshly-inserted shapes that
    // dblclick can still enter. Fix falls back to the
    // SHAPE_TEXT_PADDING-inset frame in that case.
    const { canvas, overlay, store } = setup();
    let sid = '';
    let shapeId = '';
    store.batch(() => {
      sid = store.addSlide('blank');
      shapeId = store.addElement(sid, {
        type: 'shape',
        frame: { x: 100, y: 100, w: 300, h: 200, rotation: 0 },
        data: { kind: 'rect', fill: { kind: 'srgb' as const, value: '#abc' } },
      });
    });

    editor = initialize({
      canvas, overlay, store,
      hostWidth: 1920, hostHeight: 1080, dpr: 1,
      mountTextBox: makeMockMount(),
    });

    const cx = 250;
    const cy = 200;

    // First click selects (no edit — shape is not an empty placeholder).
    click(canvas, cx, cy);
    expect(editor.getEditingElementId()).toBeNull();
    expect(editor.getSelection()).toEqual([shapeId]);

    // Second click on the same selected shape within the sequence window
    // → P1.5 must enter edit even though `data.text` is undefined.
    click(canvas, cx, cy);
    expect(editor.getEditingElementId()).toBe(shapeId);
  });
});
