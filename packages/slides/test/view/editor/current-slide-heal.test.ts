// @vitest-environment jsdom
//
// Issue #883: `Add slide` makes the new slide current, and undoing it
// restored the `slides` array without moving the editor's cursor — so
// `getCurrentSlideId()` kept naming a slide the deck no longer held and
// the canvas painted nothing. A peer deleting the slide the local user
// is on leaves the same state.
//
// The editor now revalidates the cursor on the store's change channel
// (`store.onChange`, subscribed by the editor itself), landing on the
// slide just before the vanished index. The hook is deliberately NOT the
// paint path: hosts without a render loop (the mobile edit shell) get the
// same invariant, and painting stays free of cursor moves, teardown and
// listener notifications.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import '../../../src/view/canvas/test-canvas-env';
import { MemSlidesStore } from '../../../src/store/memory';
import { initialize, type SlidesEditor } from '../../../src/view/editor/editor';
import type { Block } from '@wafflebase/docs';
import type {
  MountSlidesTextBoxOptions,
  SlidesTextBoxEditor,
} from '../../../src/view/editor/text-box-editor';

/** Same stub the other editor suites mount (see text-box-autogrow). */
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
    stepSelectionFontSize: () => {},
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

/**
 * Same stub, but reproducing the one behaviour of the real editor that
 * makes the heal's "discard" claim testable: `detach()` flushes a final
 * `onCommit` when the box still has focus
 * (`packages/docs/src/view/text-box-editor.ts` — `if (focused &&
 * !committedOnce)`). The plain stub above detaches silently, so a teardown
 * that writes to the store looks identical to one that does not.
 */
function mockMountTextBoxFlushing(
  opts: MountSlidesTextBoxOptions,
): SlidesTextBoxEditor {
  const tb = mockMountTextBox(opts);
  let committedOnce = false;
  return {
    ...tb,
    commit: () => {
      if (committedOnce) return;
      committedOnce = true;
      opts.onCommit(opts.blocks);
    },
    detach: () => {
      if (!committedOnce) {
        committedOnce = true;
        opts.onCommit(opts.blocks);
      }
      tb.detach();
    },
  };
}

/** Minimal blank paragraph for a text element. */
function emptyBlock(): Block {
  return {
    id: 'b1',
    type: 'paragraph',
    inlines: [{ text: '', style: {} }],
    style: {},
  } as Block;
}

function setup(
  slideCount: number,
  mountTextBox: typeof mockMountTextBox = mockMountTextBox,
) {
  const canvas = document.createElement('canvas');
  canvas.width = 1920;
  canvas.height = 1080;
  const overlay = document.createElement('div');
  overlay.style.position = 'absolute';
  document.body.appendChild(canvas);
  document.body.appendChild(overlay);
  const store = new MemSlidesStore();
  const slideIds: string[] = [];
  store.batch(() => {
    for (let i = 0; i < slideCount; i++) slideIds.push(store.addSlide('blank'));
  });
  const editor = initialize({
    canvas,
    overlay,
    store,
    hostWidth: 1920,
    hostHeight: 1080,
    dpr: 1,
    mountTextBox,
  });
  return { store, editor, slideIds };
}

/** One host RAF frame: what SlidesView's loop does on a store change. */
function frame(editor: SlidesEditor): void {
  editor.markDirty();
  editor.render();
}

describe('current slide healing', () => {
  let editor: SlidesEditor | null = null;

  beforeEach(() => {
    document.body.innerHTML = '';
  });

  afterEach(() => {
    if (editor) {
      editor.detach();
      editor = null;
    }
  });

  it('lands on the previously-current slide after undoing Add slide', () => {
    const { store, editor: ed, slideIds } = setup(2);
    editor = ed;
    ed.setCurrentSlide(slideIds[1]);
    frame(ed);

    // Add slide: appended after the current one and made current, the
    // way the toolbar / Ctrl+M path does it.
    let added = '';
    store.batch(() => {
      added = store.addSlide('blank', 2);
    });
    ed.setCurrentSlide(added);
    frame(ed);
    expect(store.read().slides).toHaveLength(3);
    expect(ed.getCurrentSlideId()).toBe(added);

    store.undo();
    frame(ed);

    expect(store.read().slides).toHaveLength(2);
    // The cursor must name a slide the deck actually holds — and
    // specifically the one the user was on before the insertion.
    expect(ed.getCurrentSlideId()).toBe(slideIds[1]);
  });

  it('notifies current-slide subscribers when it heals', () => {
    const { store, editor: ed, slideIds } = setup(2);
    editor = ed;
    ed.setCurrentSlide(slideIds[1]);
    frame(ed);
    let added = '';
    store.batch(() => {
      added = store.addSlide('blank', 2);
    });
    ed.setCurrentSlide(added);
    frame(ed);

    let notified = 0;
    const off = ed.onCurrentSlideChange(() => {
      notified++;
    });
    store.undo();
    frame(ed);
    off();

    // The thumbnail highlight and the presence broadcast both hang off
    // this callback, so a silent heal would leave them stale.
    expect(notified).toBeGreaterThan(0);
    expect(ed.getCurrentSlideId()).toBe(slideIds[1]);
  });

  it('heals when the current slide is removed out from under the editor', () => {
    const { store, editor: ed, slideIds } = setup(3);
    editor = ed;
    ed.setCurrentSlide(slideIds[2]);
    frame(ed);

    // A peer's delete (or any removal that never told the editor).
    store.batch(() => store.removeSlides([slideIds[2]]));
    frame(ed);

    expect(ed.getCurrentSlideId()).toBe(slideIds[1]);
  });

  it('clamps to the first slide when the deck head is removed', () => {
    const { store, editor: ed, slideIds } = setup(2);
    editor = ed;
    ed.setCurrentSlide(slideIds[0]);
    frame(ed);

    store.batch(() => store.removeSlides([slideIds[0]]));
    frame(ed);

    expect(ed.getCurrentSlideId()).toBe(slideIds[1]);
  });

  it('drops the selection carried on the removed slide', () => {
    const { store, editor: ed, slideIds } = setup(2);
    editor = ed;
    ed.setCurrentSlide(slideIds[1]);
    let elementId = '';
    store.batch(() => {
      elementId = store.addElement(slideIds[1], {
        type: 'image',
        frame: { x: 100, y: 100, w: 200, h: 150, rotation: 0 },
        data: { src: 'data:image/png;base64,AAAA' },
      });
    });
    ed.setSelection([elementId]);
    frame(ed);
    expect(ed.getSelection()).toEqual([elementId]);

    store.batch(() => store.removeSlides([slideIds[1]]));
    frame(ed);

    expect(ed.getCurrentSlideId()).toBe(slideIds[0]);
    expect(ed.getSelection()).toEqual([]);
  });

  it('settles after one heal and stays on the healed slide', () => {
    // Three slides, not two: with two, `Math.min(Math.max(i - 1, 0), 0)`
    // pins the answer to the first slide however many times the heal runs,
    // so the claim this test makes cannot fail. Removing the last of three
    // heals to index 1, and a heal that re-ran every frame would walk on to
    // index 0 — which is what the loop below actually rules out.
    const { store, editor: ed, slideIds } = setup(3);
    editor = ed;
    ed.setCurrentSlide(slideIds[2]);
    frame(ed);
    store.batch(() => store.removeSlides([slideIds[2]]));

    for (let i = 0; i < 3; i++) frame(ed);
    expect(ed.getCurrentSlideId()).toBe(slideIds[1]);
  });

  /**
   * The heal tears an anchored text edit down with `exitEditMode('cancel')`
   * and its comment says the edit "is discarded rather than committed". It
   * was not: `detach()` flushes a final `onCommit` for a still-focused box,
   * and that write goes through `store.batch()`, which pushes an undo entry
   * before running — so the teardown left a phantom step on the undo stack
   * from inside `render()`, and the user's next Ctrl+Z spent itself on it
   * instead of bringing the slide back.
   *
   * Asserted through undo rather than through the redo stack: the removal
   * that triggers the heal already clears redo on its own, so redo cannot
   * tell the two behaviours apart.
   */
  it('discards the anchored edit without leaving a phantom undo step', () => {
    const { store, editor: ed, slideIds } = setup(2, mockMountTextBoxFlushing);
    editor = ed;
    ed.setCurrentSlide(slideIds[1]);
    let textId = '';
    store.batch(() => {
      textId = store.addElement(slideIds[1], {
        type: 'text',
        frame: { x: 100, y: 100, w: 400, h: 120, rotation: 0 },
        data: { blocks: [emptyBlock()] },
      });
    });
    ed.enterTextEditing(textId);
    frame(ed);
    expect(ed.isTextEditing()).toBe(true);

    // A peer removes the slide the edit is anchored to.
    store.batch(() => store.removeSlides([slideIds[1]]));
    frame(ed);
    expect(ed.getCurrentSlideId()).toBe(slideIds[0]);
    expect(ed.isTextEditing()).toBe(false);

    // The removal is the last thing that happened, so one undo must undo it.
    store.undo();
    expect(store.read().slides.map((s) => s.id)).toEqual(slideIds);
  });

  /**
   * `removeSlides` is a bare filter with no non-empty guard — only the
   * thumbnail panel stops you deleting the last slide, and that gate is
   * local — so a peer can empty the deck. The heal used to return early on
   * an empty deck, above the teardown, leaving a live text-box editor
   * anchored to a slide that no longer existed.
   */
  it('tears the anchored edit down even when the deck is emptied', () => {
    const { store, editor: ed, slideIds } = setup(1, mockMountTextBoxFlushing);
    editor = ed;
    ed.setCurrentSlide(slideIds[0]);
    let textId = '';
    store.batch(() => {
      textId = store.addElement(slideIds[0], {
        type: 'text',
        frame: { x: 100, y: 100, w: 400, h: 120, rotation: 0 },
        data: { blocks: [emptyBlock()] },
      });
    });
    ed.enterTextEditing(textId);
    frame(ed);
    expect(ed.isTextEditing()).toBe(true);

    store.batch(() => store.removeSlides([slideIds[0]]));
    frame(ed);

    expect(store.read().slides).toHaveLength(0);
    expect(ed.getCurrentSlideId()).toBeUndefined();
    expect(ed.isTextEditing()).toBe(false);
    // And no phantom step: one undo brings the deck back.
    store.undo();
    expect(store.read().slides).toHaveLength(1);
  });

  it('cancels a text edit anchored to the removed slide', () => {
    const { store, editor: ed, slideIds } = setup(2);
    editor = ed;
    ed.setCurrentSlide(slideIds[1]);
    let textId = '';
    store.batch(() => {
      textId = store.addElement(slideIds[1], {
        type: 'text',
        frame: { x: 100, y: 100, w: 400, h: 120, rotation: 0 },
        data: { blocks: [emptyBlock()] },
      });
    });
    ed.enterTextEditing(textId);
    expect(ed.isTextEditing()).toBe(true);

    // Tearing the text box down re-enters render() — the cursor is moved
    // first so that nested resolve is a plain hit, not a second heal.
    store.batch(() => store.removeSlides([slideIds[1]]));
    frame(ed);

    expect(ed.isTextEditing()).toBe(false);
    expect(ed.getCurrentSlideId()).toBe(slideIds[0]);
  });

  /**
   * The mirror of the test above. A text edit survives a slide switch on
   * purpose (`setCurrentSlide` does not exit edit mode), so an edit whose
   * own slide is untouched must survive some OTHER slide being removed —
   * discarding it would throw away work the removal never invalidated.
   */
  it('keeps a text edit anchored to a slide that still exists', () => {
    const { store, editor: ed, slideIds } = setup(3, mockMountTextBoxFlushing);
    editor = ed;
    ed.setCurrentSlide(slideIds[2]);
    let textId = '';
    store.batch(() => {
      textId = store.addElement(slideIds[2], {
        type: 'text',
        frame: { x: 100, y: 100, w: 400, h: 120, rotation: 0 },
        data: { blocks: [emptyBlock()] },
      });
    });
    ed.enterTextEditing(textId);
    // The user navigates away with the box still live, the way the
    // thumbnail panel's click path leaves it.
    ed.setCurrentSlide(slideIds[1]);
    expect(ed.isTextEditing()).toBe(true);

    // A peer removes the slide the CURSOR is on — not the edit's slide.
    store.batch(() => store.removeSlides([slideIds[1]]));
    frame(ed);

    expect(ed.getCurrentSlideId()).toBe(slideIds[0]);
    expect(ed.isTextEditing()).toBe(true);
  });

  /**
   * The heal hangs off `store.onChange`, not off a paint, so a host that
   * mounts the editor without a render loop (mobile edit mode has no RAF
   * tick and no `onChange → markDirty` wiring) gets the invariant too.
   * Deliberately never calls `frame()`.
   */
  it('heals with no render loop driving the editor', () => {
    const { store, editor: ed, slideIds } = setup(3);
    editor = ed;
    ed.setCurrentSlide(slideIds[2]);

    store.batch(() => store.removeSlides([slideIds[2]]));

    expect(ed.getCurrentSlideId()).toBe(slideIds[1]);
  });

  /**
   * Healing an emptied deck parks the cursor at `undefined`. That must be
   * a resting state, not a dead end: when slides come back — undoing the
   * delete that emptied the deck — the cursor has to be re-seeded, or the
   * canvas stays blank forever with no way back.
   */
  it('re-seeds the cursor when slides come back to an emptied deck', () => {
    const { store, editor: ed, slideIds } = setup(1);
    editor = ed;
    ed.setCurrentSlide(slideIds[0]);
    frame(ed);

    store.batch(() => store.removeSlides([slideIds[0]]));
    expect(ed.getCurrentSlideId()).toBeUndefined();

    store.undo();
    frame(ed);

    expect(store.read().slides).toHaveLength(1);
    expect(ed.getCurrentSlideId()).toBe(slideIds[0]);
  });

  /** A store that publishes no changes still heals, from the paint path. */
  it('falls back to healing during paint when the store has no onChange', () => {
    const { store, editor: ed, slideIds } = setup(3);
    editor = ed;
    ed.setCurrentSlide(slideIds[2]);
    frame(ed);
    // Simulate a `SlidesStore` implementation that omits the optional
    // `onChange` by silencing the one this editor subscribed to.
    (store as unknown as { changeListeners: Set<() => void> }).changeListeners.clear();
    (ed as unknown as { storeChangeOff: (() => void) | null }).storeChangeOff = null;

    store.batch(() => store.removeSlides([slideIds[2]]));
    expect(ed.getCurrentSlideId()).toBe(slideIds[2]);

    frame(ed);
    expect(ed.getCurrentSlideId()).toBe(slideIds[1]);
  });

  it('discards a crop session anchored to the removed slide', () => {
    const { store, editor: ed, slideIds } = setup(2);
    editor = ed;
    ed.setCurrentSlide(slideIds[1]);
    let imageId = '';
    store.batch(() => {
      imageId = store.addElement(slideIds[1], {
        type: 'image',
        frame: { x: 200, y: 200, w: 400, h: 300, rotation: 0 },
        data: { src: 'data:image/png;base64,AAAA' },
      });
    });
    ed.enterImageCrop(imageId);
    expect(ed.isCropping()).toBe(true);

    // The session's image is gone with its slide, so it is discarded
    // rather than committed — a commit would write to nowhere.
    store.batch(() => store.removeSlides([slideIds[1]]));
    frame(ed);

    expect(ed.isCropping()).toBe(false);
    expect(ed.getCurrentSlideId()).toBe(slideIds[0]);
  });

  it('leaves the cursor alone while the current slide still exists', () => {
    const { store, editor: ed, slideIds } = setup(3);
    editor = ed;
    ed.setCurrentSlide(slideIds[1]);
    frame(ed);

    // Removing a different slide must not move the cursor, even though
    // the current slide's index shifts.
    store.batch(() => store.removeSlides([slideIds[0]]));
    frame(ed);

    expect(ed.getCurrentSlideId()).toBe(slideIds[1]);
  });
});
