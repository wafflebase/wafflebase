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
