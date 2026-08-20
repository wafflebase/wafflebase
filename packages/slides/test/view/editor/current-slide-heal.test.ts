// @vitest-environment jsdom
//
// Issue #883: `Add slide` makes the new slide current, and undoing it
// restored the `slides` array without moving the editor's cursor — so
// `getCurrentSlideId()` kept naming a slide the deck no longer held and
// the canvas painted nothing. A peer deleting the slide the local user
// is on leaves the same state.
//
// The editor now revalidates the cursor where it resolves it (inside the
// `store.read()` snapshot `render()` / `repaintOverlay()` already hold),
// landing on the slide just before the vanished index.
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

/** Minimal blank paragraph for a text element. */
function emptyBlock(): Block {
  return {
    id: 'b1',
    type: 'paragraph',
    inlines: [{ text: '', style: {} }],
    style: {},
  } as Block;
}

function setup(slideCount: number) {
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
    mountTextBox: mockMountTextBox,
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
    const { store, editor: ed, slideIds } = setup(2);
    editor = ed;
    ed.setCurrentSlide(slideIds[1]);
    frame(ed);
    store.batch(() => store.removeSlides([slideIds[1]]));

    // Repeated frames must not keep walking the cursor backwards.
    for (let i = 0; i < 3; i++) frame(ed);
    expect(ed.getCurrentSlideId()).toBe(slideIds[0]);
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

    // The heal runs inside render(), and tearing the text box down
    // re-enters render() — the cursor is moved first so that nested
    // resolve is a plain hit instead of a second heal.
    store.batch(() => store.removeSlides([slideIds[1]]));
    frame(ed);

    expect(ed.isTextEditing()).toBe(false);
    expect(ed.getCurrentSlideId()).toBe(slideIds[0]);
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
