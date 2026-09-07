// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { initialize, type EditorAPI } from '../../src/view/editor.js';
import { MemDocStore } from '../../src/store/memory.js';
import { createEmptyBlock } from '../../src/model/types.js';

/**
 * The *pointer wiring* of link snapping (#1038): `expandRangeForLinks` is
 * unit-tested in `link-run.test.ts`, but the behaviour the issue is about
 * lives in `TextEditor.setSnappedRange` and its call sites — drag,
 * shift+click and word select — and in `Selection.rawAnchor`, which is what
 * keeps a snapped anchor from becoming a one-way ratchet.
 *
 * Driven through real `mousedown`/`mousemove` events at real coordinates:
 * every offset below is converted to a client x by asking the editor where
 * its own caret sits at that offset, so a test never hard-codes geometry.
 */
function makeCtxSpy() {
  return {
    fillStyle: '#000',
    strokeStyle: '#000',
    lineWidth: 1,
    font: '10px sans-serif',
    textAlign: 'start' as CanvasTextAlign,
    textBaseline: 'alphabetic' as CanvasTextBaseline,
    globalAlpha: 1,
    fillRect: vi.fn(),
    fillText: vi.fn(),
    clearRect: vi.fn(),
    setTransform: vi.fn(),
    save: vi.fn(),
    restore: vi.fn(),
    scale: vi.fn(),
    translate: vi.fn(),
    rotate: vi.fn(),
    transform: vi.fn(),
    clip: vi.fn(),
    rect: vi.fn(),
    measureText: (text: string) => ({ width: text.length * 8 }),
    beginPath: vi.fn(),
    closePath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    arc: vi.fn(),
    stroke: vi.fn(),
    quadraticCurveTo: vi.fn(),
    bezierCurveTo: vi.fn(),
  };
}

describe('link snapping through real pointer gestures (#1038)', () => {
  let container: HTMLElement;
  let editor: EditorAPI;
  let blockId: string;
  let origGetContext: HTMLCanvasElement['getContext'];
  let origRect: typeof Element.prototype.getBoundingClientRect;
  let origRAF: typeof window.requestAnimationFrame;

  /**
   * "plain https://ex.com plain", with the URL hyperlinked to itself —
   * offsets 6..20. A self-labelled link is the shape that matters: its
   * display text is full of word separators, so `getWordRange` carves it
   * up and a word select really can land inside it.
   */
  const TEXT = 'plain https://ex.com plain';
  const LINK_START = 6;
  const LINK_END = 20;
  let points: Array<{ x: number; y: number }>;

  beforeEach(() => {
    (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    };
    (globalThis as unknown as { OffscreenCanvas: unknown }).OffscreenCanvas = class {
      constructor(public width: number, public height: number) {}
      getContext(): unknown {
        return {
          font: '10px sans-serif',
          measureText: (t: string) => ({ width: t.length * 8 }),
        };
      }
    };
    origGetContext = HTMLCanvasElement.prototype.getContext;
    const spy = makeCtxSpy();
    HTMLCanvasElement.prototype.getContext = function patched(id: string): unknown {
      return id === '2d' ? spy : null;
    } as HTMLCanvasElement['getContext'];
    // jsdom reports every box as 0×0, which collapses the layout and leaves
    // nothing to hit. Give every element the page's own box, so scale is 1
    // and a client x is a document x.
    origRect = Element.prototype.getBoundingClientRect;
    Element.prototype.getBoundingClientRect = function (): DOMRect {
      return {
        x: 0, y: 0, left: 0, top: 0, right: 816, bottom: 1056,
        width: 816, height: 1056, toJSON: () => ({}),
      } as DOMRect;
    };
    // A no-op RAF: the drag-scroll loop reschedules itself for as long as
    // the button is held, and a microtask-backed stub would spin.
    origRAF = window.requestAnimationFrame;
    window.requestAnimationFrame = (): number => 0;

    container = document.createElement('div');
    document.body.appendChild(container);
    const store = new MemDocStore();
    store.setDocument({ blocks: [createEmptyBlock()] });
    editor = initialize(container, store);

    const ta = container.querySelector('textarea') as HTMLTextAreaElement;
    ta.value = TEXT;
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    blockId = editor.getDoc().document.blocks[0].id;
    editor._setSelectionForTest({
      anchor: { blockId, offset: LINK_START },
      focus: { blockId, offset: LINK_END },
    });
    editor.insertLink('https://ex.com');

    // Coordinates are collected up front, once: reading a caret rect means
    // moving the caret, which would wipe the very selection state (and
    // `rawAnchor`) these gestures are about.
    points = [];
    for (let offset = 0; offset <= TEXT.length; offset++) {
      editor._setSelectionForTest({
        anchor: { blockId, offset },
        focus: { blockId, offset },
      });
      const rect = editor.getCursorScreenRect();
      if (!rect) throw new Error(`no caret rect at offset ${offset}`);
      points.push({ x: rect.x, y: rect.y + rect.height / 2 });
    }
    editor._setSelectionForTest(null);
  });

  afterEach(() => {
    editor.dispose();
    document.body.removeChild(container);
    HTMLCanvasElement.prototype.getContext = origGetContext;
    Element.prototype.getBoundingClientRect = origRect;
    window.requestAnimationFrame = origRAF;
  });

  /**
   * Client coordinates of the caret at `offset`, as the editor itself
   * reported them. `getCursorScreenRect` and the mousedown hit test are
   * exact inverses under the geometry shim above, which the control tests
   * below re-prove on every run so nothing here can go vacuous.
   */
  function pointAt(offset: number): { x: number; y: number } {
    return points[offset];
  }

  function press(offset: number, opts: { shiftKey?: boolean } = {}): void {
    const { x, y } = pointAt(offset);
    container.dispatchEvent(new MouseEvent('mousedown', {
      bubbles: true, cancelable: true, button: 0, clientX: x, clientY: y,
      shiftKey: opts.shiftKey ?? false,
    }));
  }

  function moveTo(offset: number): void {
    const { x, y } = pointAt(offset);
    container.dispatchEvent(new MouseEvent('mousemove', {
      bubbles: true, clientX: x, clientY: y,
    }));
  }

  function release(): void {
    document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
  }

  /** Two presses at the same point inside the double-click window. */
  function doubleClick(offset: number): void {
    press(offset);
    release();
    press(offset);
    release();
  }

  function span(): { anchor: number; focus: number } | null {
    const sel = editor.getActiveSelection();
    if (!sel) return null;
    return { anchor: sel.anchor.offset, focus: sel.focus.offset };
  }

  it('control: a plain drag selects exactly what it covers', () => {
    // Keeps every assertion below honest — without this, a snapped range
    // could pass merely because the gesture stopped resolving offsets.
    press(0);
    moveTo(5);
    release();

    expect(span()).toEqual({ anchor: 0, focus: 5 });
  });

  it('a drag that ends mid-link grows out to the whole link', () => {
    press(2);
    moveTo(12);

    expect(span()).toEqual({ anchor: 2, focus: LINK_END });
    release();
  });

  it('dragging back out of the link un-snaps instead of ratcheting', () => {
    // The whole reason `rawAnchor` exists. The press at 12 is mid-link, so
    // the first move snaps the *anchor* out to 6; re-snapping from that
    // moved anchor would leave the link permanently selected however far
    // back the pointer comes.
    press(12);
    moveTo(13);
    expect(span()).toEqual({ anchor: LINK_START, focus: LINK_END });

    // Back to the press point: the selection is empty again. A ratchet
    // would still be reporting the whole link here.
    moveTo(12);
    expect(span()).toBeNull();

    // And on past the link's start: the anchor still snaps out to the link
    // *end*, because the raw press at 8 was inside it. Re-snapping from the
    // moved anchor (6) would leave the link out of the selection entirely.
    moveTo(4);
    expect(span()).toEqual({ anchor: LINK_END, focus: 4 });
    release();
  });

  it('shift+click re-extends from the raw anchor, not the snapped one', () => {
    press(12);
    release();
    press(13, { shiftKey: true });
    release();
    expect(span()).toEqual({ anchor: LINK_START, focus: LINK_END });

    // Extending backwards past the link: the raw press at 8 is inside it,
    // so the link stays covered. Extending from the snapped anchor (6)
    // would instead drop it out of the selection entirely.
    press(2, { shiftKey: true });
    release();

    expect(span()).toEqual({ anchor: LINK_END, focus: 2 });
  });

  it('a backward drag that ends mid-link grows the same span', () => {
    press(24);
    moveTo(12);

    expect(span()).toEqual({ anchor: 24, focus: LINK_START });
    release();
  });

  it('a drag that merely abuts the link does not swallow it', () => {
    press(0);
    moveTo(LINK_START);
    release();

    expect(span()).toEqual({ anchor: 0, focus: LINK_START });
  });

  it('double-clicking inside a link selects the whole link', () => {
    // `getWordRange` stops at the link text's own boundaries, so before the
    // snap this left a partially covered link — the state a drag can no
    // longer produce.
    doubleClick(8);

    expect(span()).toEqual({ anchor: LINK_START, focus: LINK_END });
  });

  it('control: double-clicking a plain word selects just that word', () => {
    doubleClick(2);

    expect(span()).toEqual({ anchor: 0, focus: 5 });
  });

  it('a word select establishes its own raw anchor for the next shift+click', () => {
    // Without an explicit raw anchor, `setSnappedRange` would reuse the one
    // the first press of the double-click left behind (offset 8), and the
    // shift+click below would extend from inside the word.
    doubleClick(2);
    press(24, { shiftKey: true });
    release();

    expect(span()).toEqual({ anchor: 0, focus: 24 });
  });
});
