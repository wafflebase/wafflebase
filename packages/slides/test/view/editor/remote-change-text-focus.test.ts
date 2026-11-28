// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import '../../../src/view/canvas/test-canvas-env';
import { MemSlidesStore } from '../../../src/store/memory';
import { initialize, type SlidesEditor } from '../../../src/view/editor/editor';
import type { PeerView } from '../../../src/view/editor/peers';

/**
 * Regression guard for a collaborator's edit stealing the local text
 * edit's focus.
 *
 * A remote change reaches the editor as `markDirty()` (board-view and
 * SlidesView call it from `store.onChange`), and a peer selecting or
 * dragging something is a chrome-changing `setPeers`. Both rebuild the
 * DOM overlay, and `renderOverlay` clears `overlay.innerHTML` — which
 * used to detach the in-place text box, and with it the docs editor's
 * hidden IME textarea. In Chrome the removal fires `blur`, which commits
 * and closes the edit mid-sentence (an IME composition is cut off with
 * it); the next keystroke re-enters through type-to-edit with the caret
 * at the start of the text. jsdom fires no `blur` on removal, so here the
 * symptom is focus falling back to `<body>` — asserted below together
 * with the root cause, the detach itself.
 */
function makeFixture() {
  const canvas = document.createElement('canvas');
  const overlay = document.createElement('div');
  document.body.append(canvas, overlay);
  const store = new MemSlidesStore();
  store.batch(() => store.addSlide('blank'));
  let textId = '';
  store.batch(() => {
    textId = store.addElement(store.read().slides[0].id, {
      type: 'text',
      frame: { x: 100, y: 100, w: 400, h: 120, rotation: 0 },
      data: { blocks: [] },
    });
  });
  return { canvas, overlay, store, textId };
}

describe('collaborator activity vs. the in-place text editor', () => {
  let editor: SlidesEditor | null = null;

  beforeEach(() => {
    document.body.innerHTML = '';
  });

  afterEach(() => {
    editor?.detach();
    editor = null;
  });

  function startEditing() {
    const fx = makeFixture();
    editor = initialize({
      canvas: fx.canvas,
      overlay: fx.overlay,
      store: fx.store,
      hostWidth: 960,
      hostHeight: 540,
      dpr: 1,
    });
    editor.enterTextEditing(fx.textId);
    const textarea = fx.overlay.querySelector('textarea');
    expect(textarea, 'the real text box mounts a hidden IME textarea').toBeTruthy();
    textarea!.focus();
    expect(document.activeElement).toBe(textarea);
    return { ...fx, editor, textarea: textarea! };
  }

  it('keeps the textarea in the DOM and focused across a remote change', () => {
    const { editor, textarea } = startEditing();
    const removed: Node[] = [];
    const watch = new MutationObserver((records) => {
      for (const r of records) removed.push(...r.removedNodes);
    });
    watch.observe(document.body, { childList: true, subtree: true });

    editor.markDirty();

    watch.takeRecords().forEach((r) => removed.push(...r.removedNodes));
    watch.disconnect();
    expect(
      removed.some((n) => n.contains(textarea)),
      'the text box is never detached, even momentarily',
    ).toBe(false);
    expect(document.activeElement, 'and keeps focus').toBe(textarea);
    expect(editor.isTextEditing()).toBe(true);
  });

  it('keeps focus when a peer changes selection or drags', () => {
    const { editor, store, textarea } = startEditing();
    const slideId = store.read().slides[0].id;
    const peer = (over: Partial<PeerView>): PeerView => ({
      clientID: 'peer-1',
      color: '#ff0000',
      label: 'Ada',
      activeSlideId: slideId,
      selectedElementIds: [],
      ...over,
    });

    editor.setPeers([peer({})]);
    editor.setPeers([peer({ selectedElementIds: ['other'] })]);
    for (let i = 0; i < 3; i++) {
      editor.setPeers([
        peer({
          selectedElementIds: ['other'],
          activeFrames: [
            { elementId: 'other', x: i, y: 0, w: 10, h: 10, rotation: 0 },
          ],
        }),
      ]);
    }

    expect(document.activeElement).toBe(textarea);
    expect(editor.isTextEditing()).toBe(true);
  });

  it('never leaves a stale text box behind when editing moves on', () => {
    const fx = makeFixture();
    let otherId = '';
    fx.store.batch(() => {
      otherId = fx.store.addElement(fx.store.read().slides[0].id, {
        type: 'text',
        frame: { x: 100, y: 300, w: 400, h: 120, rotation: 0 },
        data: { blocks: [] },
      });
    });
    editor = initialize({
      canvas: fx.canvas,
      overlay: fx.overlay,
      store: fx.store,
      hostWidth: 960,
      hostHeight: 540,
      dpr: 1,
    });
    editor.enterTextEditing(fx.textId);
    // Focus moves to a keepalive toolbar control: the box stays open, and
    // its blur-driven `commit()` becomes a no-op from here on.
    const button = document.createElement('button');
    button.setAttribute('data-text-edit-keepalive', '');
    document.body.appendChild(button);
    fx.overlay.querySelector('textarea')!.focus();
    button.focus();
    expect(editor.isTextEditing()).toBe(true);
    editor.enterTextEditing(otherId);
    editor.markDirty();

    expect(fx.overlay.querySelectorAll('.wfb-slides-text-box-editor')).toHaveLength(1);
  });

  it('keeps the text box above a peer-cursor layer created mid-edit', () => {
    const { editor, store, overlay } = startEditing();
    const slideId = store.read().slides[0].id;
    editor.setPeers([
      {
        clientID: 'peer-1',
        color: '#ff0000',
        label: 'Ada',
        activeSlideId: slideId,
        selectedElementIds: [],
        cursor: { x: 10, y: 10 },
      },
    ]);
    const last = overlay.lastElementChild;
    expect(last?.classList.contains('wfb-slides-text-box-editor')).toBe(true);
  });
});
