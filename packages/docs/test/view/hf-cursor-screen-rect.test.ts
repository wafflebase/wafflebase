// @vitest-environment jsdom
import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { MemDocStore } from '../../src/store/memory.js';
import { initialize, type EditorAPI } from '../../src/view/editor.js';
import { normalizeBlockStyle, generateBlockId } from '../../src/model/types.js';
import type { Block } from '../../src/model/types.js';

const EMPTY = normalizeBlockStyle({});

function installCanvasShim(): void {
  const ctxHandler: ProxyHandler<object> = {
    get(_t, prop) {
      if (prop === 'measureText') {
        return (text: string) => ({
          width: typeof text === 'string' ? text.length * 6 : 0,
          actualBoundingBoxAscent: 8, actualBoundingBoxDescent: 2,
        });
      }
      if (prop === 'getImageData') {
        return (_x: number, _y: number, w: number, h: number) => ({
          data: new Uint8ClampedArray(Math.max(0, w) * Math.max(0, h) * 4), width: w, height: h,
        });
      }
      if (prop === 'canvas') return null;
      if (prop === 'font') return '12px sans-serif';
      return () => {};
    },
    set() { return true; },
  };
  const fakeCtx = new Proxy({}, ctxHandler) as unknown as CanvasRenderingContext2D;
  (HTMLCanvasElement.prototype as unknown as { getContext: (k: string) => unknown }).getContext =
    (kind: string) => (kind === '2d' ? fakeCtx : null);
  (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
    observe(): void {} unobserve(): void {} disconnect(): void {}
  };
  // jsdom answers every getBoundingClientRect with zeros, which drives
  // `computeScaleFactor(0, pageWidth)` to ~0 and collapses every pixel this
  // file asserts on to ~1e-14. Ordering survives that, but nothing else does
  // — an `x` or a `height` "greater than zero" stops meaning anything you
  // could point at on screen. A viewport wider than a Letter page (816px at
  // 96dpi) puts the editor at scale 1, so the numbers below are the document
  // coordinates themselves.
  HTMLElement.prototype.getBoundingClientRect = function (): DOMRect {
    return {
      x: 0, y: 0, left: 0, top: 0, right: 1000, bottom: 800,
      width: 1000, height: 800, toJSON: () => ({}),
    } as DOMRect;
  };
}

function para(text: string): Block {
  return {
    id: generateBlockId(),
    type: 'paragraph',
    inlines: [{ text, style: { fontFamily: 'Arial', fontSize: 12 } }],
    style: EMPTY,
  };
}

/**
 * `getCursorScreenRect` is what anchors the link popover (context-menu
 * "Add link" and ⌘K). It resolved the caret against the *body* layout only,
 * so a caret parked in a header or footer produced `undefined` and the
 * frontend's `onLinkRequest` bailed silently — the row was offered and did
 * nothing. See `computeHFCursorPixel` and the comment above the render
 * path's edit-context branch.
 */
describe('getCursorScreenRect — header / footer edit context', () => {
  const editors: EditorAPI[] = [];
  beforeEach(() => { installCanvasShim(); document.body.innerHTML = ''; });
  afterEach(() => {
    for (const editor of editors.splice(0)) editor.dispose();
    document.body.innerHTML = '';
  });

  function setup(): {
    editor: EditorAPI;
    store: MemDocStore;
    container: HTMLElement;
    body: Block;
    header: Block;
    footer: Block;
  } {
    const store = new MemDocStore();
    const body = para('body text');
    const header = para('header text');
    const footer = para('footer text');
    store.setDocument({
      blocks: [body],
      header: { blocks: [header], marginFromEdge: 48 },
      footer: { blocks: [footer], marginFromEdge: 48 },
    });
    const container = document.createElement('div');
    document.body.appendChild(container);
    const editor = initialize(container, store);
    editors.push(editor);
    return { editor, store, container, body, header, footer };
  }

  function place(editor: EditorAPI, blockId: string, offset: number): void {
    editor._setSelectionForTest({
      anchor: { blockId, offset },
      focus: { blockId, offset },
    });
  }

  test('resolves a rect for a body caret (regression guard)', () => {
    const { editor, body } = setup();
    place(editor, body.id, 3);
    const rect = editor.getCursorScreenRect();
    expect(rect).toBeDefined();
    expect(rect!.height).toBeGreaterThan(0);
  });

  test('resolves a rect for a caret inside the header', () => {
    const { editor, header } = setup();
    editor._setEditContextForTest('header');
    place(editor, header.id, 3);
    const rect = editor.getCursorScreenRect();
    expect(rect).toBeDefined();
    expect(rect!.height).toBeGreaterThan(0);
  });

  test('resolves a rect for a caret inside the footer', () => {
    const { editor, footer } = setup();
    editor._setEditContextForTest('footer');
    place(editor, footer.id, 3);
    const rect = editor.getCursorScreenRect();
    expect(rect).toBeDefined();
    expect(rect!.height).toBeGreaterThan(0);
  });

  test('the footer rect sits below the header rect', () => {
    const { editor, header, footer } = setup();
    editor._setEditContextForTest('header');
    place(editor, header.id, 0);
    const headerRect = editor.getCursorScreenRect();
    editor._setEditContextForTest('footer');
    place(editor, footer.id, 0);
    const footerRect = editor.getCursorScreenRect();
    expect(headerRect).toBeDefined();
    expect(footerRect).toBeDefined();
    expect(footerRect!.y).toBeGreaterThan(headerRect!.y);
  });

  /**
   * The single-page cases above cannot fail on a page offset: with one page,
   * "footer below header" holds even if every header resolved onto page 1,
   * because that is just page geometry. `computeHFCursorPixel` takes the
   * active page index and offsets `y` by it (`getHeaderYStart` /
   * `getFooterYStart`), and `resolveActiveCursorPixel` is what now forwards
   * it from `getCursorScreenRect` — a regression that dropped the index (or
   * hardcoded 0) would anchor the link popover over page 1 while the caret
   * blinks on page 2, which the tests above would not notice.
   */
  describe('two pages', () => {
    function setupTwoPages(): {
      editor: EditorAPI;
      body: Block;
      header: Block;
      footer: Block;
    } {
      const store = new MemDocStore();
      // Enough body paragraphs to overflow one page's content box. 200 is far
      // past the ~55 a Letter page fits at this line height, so the assertion
      // does not depend on the exact page setup.
      const bodyBlocks = Array.from({ length: 200 }, (_, i) => para(`line ${i}`));
      const header = para('header text');
      const footer = para('footer text');
      store.setDocument({
        blocks: bodyBlocks,
        header: { blocks: [header], marginFromEdge: 48 },
        footer: { blocks: [footer], marginFromEdge: 48 },
      });
      const container = document.createElement('div');
      document.body.appendChild(container);
      const editor = initialize(container, store);
      editors.push(editor);
      return { editor, body: bodyBlocks[0], header, footer };
    }

    test('the page-2 header rect sits below page 1 entirely', () => {
      const { editor, body, header, footer } = setupTwoPages();

      place(editor, body.id, 0);
      const bodyTop = editor.getCursorScreenRect();

      editor._setEditContextForTest('header', 0);
      place(editor, header.id, 0);
      const headerP1 = editor.getCursorScreenRect();

      editor._setEditContextForTest('footer', 0);
      place(editor, footer.id, 0);
      const footerP1 = editor.getCursorScreenRect();

      editor._setEditContextForTest('header', 1);
      place(editor, header.id, 0);
      const headerP2 = editor.getCursorScreenRect();

      for (const r of [bodyTop, headerP1, footerP1, headerP2]) {
        expect(r).toBeDefined();
      }
      // Page 1, top to bottom.
      expect(headerP1!.y).toBeLessThan(bodyTop!.y);
      expect(bodyTop!.y).toBeLessThan(footerP1!.y);
      // The one assertion the single-page cases cannot make: the *same*
      // header block resolves to a different y once the active page moves,
      // and that y is past everything on page 1.
      expect(headerP2!.y).toBeGreaterThan(footerP1!.y);
    });

    test('a header caret is inset by the page and left margin, not pinned to 0', () => {
      // `height > 0` and a y ordering both survive an x that never left the
      // origin, so pin the x too: `computeHFCursorPixel` adds the page offset
      // and the left margin before the in-line caret offset.
      const { editor, header } = setupTwoPages();
      editor._setEditContextForTest('header', 1);
      place(editor, header.id, 3);
      const rect = editor.getCursorScreenRect();

      expect(rect).toBeDefined();
      expect(rect!.x).toBeGreaterThan(0);
      expect(rect!.height).toBeGreaterThan(0);
    });
  });

  test('⌘K in the header reaches onLinkRequest with a usable anchor', () => {
    const { editor, container, header } = setup();
    editor._setEditContextForTest('header');
    place(editor, header.id, 3);

    let anchor: { x: number; y: number; height: number } | undefined;
    let fired = false;
    editor.onLinkRequest(() => {
      fired = true;
      anchor = editor.getCursorScreenRect();
    });

    const ta = container.querySelector('textarea')!;
    ta.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'k', ctrlKey: true, metaKey: true, bubbles: true, cancelable: true,
    }));

    expect(fired).toBe(true);
    expect(anchor).toBeDefined();
  });

  /**
   * Documents, does not guard. This passes on `main` too: `insertLink` was
   * never the broken half — it already wrote to a header block, and only the
   * *anchor* the popover needed was missing. It is here because that is the
   * fact which made "add the anchor" the right fix instead of gating the menu
   * row off, and a reader should not have to re-derive it. Do not count it
   * among this change's regression tests; the ones that fail on `main` are
   * the header/footer rect cases and the ⌘K case above.
   */
  test('insertLink writes to a header block, so the offered action is not dead', () => {
    const { editor, store, header } = setup();
    editor._setEditContextForTest('header');
    editor._setSelectionForTest({
      anchor: { blockId: header.id, offset: 0 },
      focus: { blockId: header.id, offset: 6 },
    });

    editor.insertLink('https://example.com');

    const stored = store.getDocument().header!.blocks.find((b) => b.id === header.id)!;
    expect(stored.inlines.some((i) => i.style.href === 'https://example.com')).toBe(true);
  });
});
