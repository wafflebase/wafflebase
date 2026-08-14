// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import '../../../src/view/canvas/test-canvas-env';
import { MemSlidesStore } from '../../../src/store/memory';
import { initialize, type SlidesEditor } from '../../../src/view/editor/editor';
import type { PeerView } from '../../../src/view/editor/peers';

/**
 * Regression guard for the peer-cursor tick destroying the local text
 * edit.
 *
 * The docs `TextEditor` appends its hidden IME textarea INSIDE the
 * text-box container, which lives in the editor's DOM overlay. Every
 * `renderOverlay` call clears `overlay.innerHTML`, so any overlay rebuild
 * detaches that textarea and `document.activeElement` falls back to
 * `<body>` — the user's keystrokes then reach the editor's GLOBAL key
 * rules instead of the text editor (Delete deletes the element, printable
 * characters arm insert mode). Peer presence used to rebuild the overlay
 * on every `setPeers` call, and the board publishes a cursor once per
 * animation frame, so a collaborator moving their mouse made local text
 * editing unusable.
 *
 * These tests deliberately mount the REAL text box (no `mountTextBox`
 * stub): the pre-existing suites all inject a mock whose `focus()` is a
 * no-op and which owns no textarea, which is exactly why this shipped.
 */
function makeFixture() {
  const canvas = document.createElement('canvas');
  canvas.width = 960;
  canvas.height = 540;
  const overlay = document.createElement('div');
  overlay.style.position = 'absolute';
  document.body.appendChild(canvas);
  document.body.appendChild(overlay);
  const store = new MemSlidesStore();
  store.batch(() => store.addSlide('blank'));
  let textId = '';
  store.batch(() => {
    const slideId = store.read().slides[0].id;
    textId = store.addElement(slideId, {
      type: 'text',
      frame: { x: 100, y: 100, w: 400, h: 120, rotation: 0 },
      data: { blocks: [] },
    });
  });
  return { canvas, overlay, store, textId };
}

/** A peer on the board's single slide, cursor optional. */
function peer(cursor?: { x: number; y: number }): PeerView {
  return {
    clientID: 'peer-1',
    color: '#ff0000',
    label: 'Ada',
    activeSlideId: 'slide-under-test',
    selectedElementIds: [],
    cursor,
  };
}

describe('peer cursor ticks vs. the in-place text editor', () => {
  let editor: SlidesEditor | null = null;

  beforeEach(() => {
    document.body.innerHTML = '';
  });

  afterEach(() => {
    editor?.detach();
    editor = null;
  });

  it('keeps the text editor focused across a cursor-only setPeers', () => {
    const { canvas, overlay, store, textId } = makeFixture();
    editor = initialize({
      canvas,
      overlay,
      store,
      hostWidth: 960,
      hostHeight: 540,
      dpr: 1,
    });
    const slideId = store.read().slides[0].id;

    editor.enterTextEditing(textId);
    const textarea = overlay.querySelector('textarea');
    expect(textarea, 'the real text box mounts a hidden IME textarea').toBeTruthy();
    textarea!.focus();
    expect(document.activeElement).toBe(textarea);

    const onSlide = (cursor?: { x: number; y: number }): PeerView => ({
      ...peer(cursor),
      activeSlideId: slideId,
    });

    // First tick: a peer appears (chrome change — allowed to repaint).
    editor.setPeers([onSlide({ x: 10, y: 10 })]);
    textarea!.focus();

    // Now the failure mode: the peer only moves its pointer.
    for (let i = 0; i < 5; i++) {
      editor.setPeers([onSlide({ x: 10 + i, y: 10 + i })]);
    }

    expect(textarea!.isConnected, 'textarea stays in the DOM').toBe(true);
    expect(document.activeElement, 'and keeps focus').toBe(textarea);
    expect(editor.isTextEditing()).toBe(true);
  });

  it('still paints the moved cursor on that cursor-only tick', () => {
    const { canvas, overlay, store, textId } = makeFixture();
    editor = initialize({
      canvas,
      overlay,
      store,
      hostWidth: 1920,
      hostHeight: 1080,
      dpr: 1,
    });
    const slideId = store.read().slides[0].id;
    const onSlide = (cursor: { x: number; y: number }): PeerView => ({
      ...peer(cursor),
      activeSlideId: slideId,
    });

    editor.enterTextEditing(textId);
    editor.setPeers([onSlide({ x: 10, y: 20 })]);
    const dot = () =>
      overlay.querySelector('.wfb-slides-peer-cursor') as HTMLElement | null;
    expect(dot()).toBeTruthy();
    const firstLeft = dot()!.style.left;

    editor.setPeers([onSlide({ x: 200, y: 20 })]);

    expect(dot()).toBeTruthy();
    expect(dot()!.style.left).not.toBe(firstLeft);
    // Exactly one dot + one name tag — the layer is rebuilt, not appended to.
    expect(overlay.querySelectorAll('.wfb-slides-peer-cursor')).toHaveLength(1);
    expect(overlay.querySelectorAll('.wfb-slides-peer-cursor-label')).toHaveLength(1);
  });

  it('survives a full overlay rebuild: cursors are re-attached, not lost', () => {
    const { canvas, overlay, store } = makeFixture();
    editor = initialize({
      canvas,
      overlay,
      store,
      hostWidth: 1920,
      hostHeight: 1080,
      dpr: 1,
    });
    const slideId = store.read().slides[0].id;
    editor.setPeers([{ ...peer({ x: 10, y: 20 }), activeSlideId: slideId }]);
    expect(overlay.querySelectorAll('.wfb-slides-peer-cursor')).toHaveLength(1);

    // A chrome-changing tick goes through the full `renderOverlay`
    // rebuild (`overlay.innerHTML = ''`).
    editor.setPeers([
      {
        ...peer({ x: 10, y: 20 }),
        activeSlideId: slideId,
        selectedElementIds: ['nope'],
      },
    ]);

    expect(overlay.querySelectorAll('.wfb-slides-peer-cursor')).toHaveLength(1);
  });

  it('clears the cursor when a peer leaves', () => {
    const { canvas, overlay, store } = makeFixture();
    editor = initialize({
      canvas,
      overlay,
      store,
      hostWidth: 1920,
      hostHeight: 1080,
      dpr: 1,
    });
    const slideId = store.read().slides[0].id;
    editor.setPeers([{ ...peer({ x: 10, y: 20 }), activeSlideId: slideId }]);
    expect(overlay.querySelectorAll('.wfb-slides-peer-cursor')).toHaveLength(1);

    editor.setPeers([]);

    expect(overlay.querySelectorAll('.wfb-slides-peer-cursor')).toHaveLength(0);
  });
});
