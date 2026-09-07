// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { initialize, type EditorAPI } from '../../src/view/editor.js';
import { MemDocStore } from '../../src/store/memory.js';
import { generateBlockId, normalizeBlockStyle } from '../../src/model/types.js';
import type { Block } from '../../src/model/types.js';

/**
 * Link snapping in the **header/footer** edit context (#1038).
 *
 * `link-snap-pointer.test.ts` covers the body drag. Header/footer drag
 * selection is a separate branch of `TextEditor.updateDragSelection` that
 * wrote the range straight to `Selection`, so "a pointer selection never
 * partially covers a link" — the invariant `insertLink`'s edit-in-place
 * branch and `linkRunCoveringRange` are built on — was reachable-false
 * there while holding everywhere else.
 */
const EMPTY = normalizeBlockStyle({});
const FONT = { fontFamily: 'Arial', fontSize: 12 };
const URL = 'https://ex.com';
const LINK_START = 6;
const LINK_END = LINK_START + URL.length;

function installCanvasShim(): void {
  const ctxHandler: ProxyHandler<object> = {
    get(_t, prop) {
      if (prop === 'measureText') {
        return (text: string) => ({
          width: typeof text === 'string' ? text.length * 6 : 0,
          actualBoundingBoxAscent: 8,
          actualBoundingBoxDescent: 2,
        });
      }
      if (prop === 'canvas') return null;
      if (prop === 'font') return '12px sans-serif';
      return () => {};
    },
    set() {
      return true;
    },
  };
  const fakeCtx = new Proxy({}, ctxHandler) as unknown as CanvasRenderingContext2D;
  (HTMLCanvasElement.prototype as unknown as { getContext: (k: string) => unknown }).getContext =
    (kind: string) => (kind === '2d' ? fakeCtx : null);
  (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  };
  // jsdom answers every box with zeros, which collapses the scale factor and
  // with it every coordinate this file round-trips. A viewport wider than a
  // Letter page puts the editor at scale 1, so a client x is a document x.
  HTMLElement.prototype.getBoundingClientRect = function (): DOMRect {
    return {
      x: 0, y: 0, left: 0, top: 0, right: 1000, bottom: 800,
      width: 1000, height: 800, toJSON: () => ({}),
    } as DOMRect;
  };
}

/** "plain https://ex.com plain", the URL hyperlinked to itself. */
function linkParagraph(): Block {
  return {
    id: generateBlockId(),
    type: 'paragraph',
    inlines: [
      { text: 'plain ', style: { ...FONT } },
      { text: URL, style: { ...FONT, href: URL } },
      { text: ' plain', style: { ...FONT } },
    ],
    style: EMPTY,
  };
}

describe('link snapping during a header drag (#1038)', () => {
  let container: HTMLElement;
  let editor: EditorAPI;
  let headerBlockId: string;
  let origRAF: typeof window.requestAnimationFrame;
  let points: Array<{ x: number; y: number }>;

  beforeEach(() => {
    installCanvasShim();
    document.body.innerHTML = '';
    // A no-op RAF: the drag-scroll loop reschedules itself for as long as
    // the button is held, and a microtask-backed stub would spin.
    origRAF = window.requestAnimationFrame;
    window.requestAnimationFrame = (): number => 0;

    const header = linkParagraph();
    headerBlockId = header.id;
    const store = new MemDocStore();
    store.setDocument({
      blocks: [
        {
          id: generateBlockId(),
          type: 'paragraph',
          inlines: [{ text: 'body text', style: { ...FONT } }],
          style: EMPTY,
        },
      ],
      header: { blocks: [header], marginFromEdge: 48 },
    });

    container = document.createElement('div');
    document.body.appendChild(container);
    editor = initialize(container, store);
    editor._setEditContextForTest('header', 0);

    // Coordinates up front, once: reading a caret rect moves the caret,
    // which would wipe the selection state (and `rawAnchor`) the gestures
    // below are about.
    points = [];
    const total = 'plain ' + URL + ' plain';
    for (let offset = 0; offset <= total.length; offset++) {
      editor._setSelectionForTest({
        anchor: { blockId: headerBlockId, offset },
        focus: { blockId: headerBlockId, offset },
      });
      const rect = editor.getCursorScreenRect();
      if (!rect) throw new Error(`no header caret rect at offset ${offset}`);
      points.push({ x: rect.x, y: rect.y + rect.height / 2 });
    }
    editor._setSelectionForTest(null);
  });

  afterEach(() => {
    editor.dispose();
    document.body.innerHTML = '';
    window.requestAnimationFrame = origRAF;
  });

  function press(offset: number): void {
    const { x, y } = points[offset];
    container.dispatchEvent(new MouseEvent('mousedown', {
      bubbles: true, cancelable: true, button: 0, clientX: x, clientY: y,
    }));
  }

  function moveTo(offset: number): void {
    const { x, y } = points[offset];
    container.dispatchEvent(new MouseEvent('mousemove', {
      bubbles: true, clientX: x, clientY: y,
    }));
  }

  function release(): void {
    document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
  }

  function span(): { anchor: number; focus: number } | null {
    const sel = editor.getActiveSelection();
    if (!sel) return null;
    return { anchor: sel.anchor.offset, focus: sel.focus.offset };
  }

  it('control: a plain header drag selects exactly what it covers', () => {
    // Keeps the assertions below honest — without this they could pass
    // merely because the gesture stopped resolving header offsets.
    press(0);
    moveTo(5);
    release();

    expect(span()).toEqual({ anchor: 0, focus: 5 });
  });

  it('a header drag that ends mid-link grows out to the whole link', () => {
    press(2);
    moveTo(12);

    expect(span()).toEqual({ anchor: 2, focus: LINK_END });
    release();
  });

  it('a header drag that begins mid-link grows its anchor out too', () => {
    press(12);
    moveTo(24);

    expect(span()).toEqual({ anchor: LINK_START, focus: 24 });
    release();
  });

  it('dragging back out of a header link un-snaps instead of ratcheting', () => {
    press(12);
    moveTo(13);
    expect(span()).toEqual({ anchor: LINK_START, focus: LINK_END });

    // Back at the press point the selection is empty again; a ratchet would
    // still be reporting the whole link.
    moveTo(12);
    expect(span()).toBeNull();
    release();
  });
});
