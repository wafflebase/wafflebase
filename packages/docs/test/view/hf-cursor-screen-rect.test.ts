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
