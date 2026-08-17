// @vitest-environment jsdom
import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { MemDocStore } from '../../src/store/memory.js';
import { initialize, type EditorAPI } from '../../src/view/editor.js';
import { WAFFLEDOCS_MIME } from '../../src/view/clipboard.js';
import { normalizeBlockStyle } from '../../src/model/types.js';
import type { Block } from '../../src/model/types.js';

/**
 * Pasting an image next to another one (issue #726).
 *
 * `normalizeInlineList` merges neighbouring inlines whose styles compare
 * equal. An image keeps its payload in `style.image` while its text is a
 * single placeholder character, so merging two image runs yields a
 * two-character run under one `style.image` — which cannot describe two
 * images. The second was dropped while the offsets still counted both,
 * so the pasted image vanished, the caret appeared to jump past it, and
 * later typing split the doubled run into copies of the original.
 */

const EMPTY_BLOCK_STYLE = normalizeBlockStyle({});
const IMAGE_A = { src: 'https://example.test/cat.png', width: 120, height: 80 };
const IMAGE_B = { src: 'https://example.test/dog.png', width: 60, height: 40 };

let originalGetContext: typeof HTMLCanvasElement.prototype.getContext;
let originalResizeObserver: typeof globalThis.ResizeObserver | undefined;

function installCanvasShim(): void {
  originalGetContext = HTMLCanvasElement.prototype.getContext;
  originalResizeObserver = (globalThis as { ResizeObserver?: typeof globalThis.ResizeObserver })
    .ResizeObserver;
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
  (HTMLCanvasElement.prototype as unknown as {
    getContext: (kind: string) => unknown;
  }).getContext = (kind: string) => (kind === '2d' ? fakeCtx : null);
  (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  };
}

function setupEditor(blocks: Block[]): {
  editor: EditorAPI;
  textarea: HTMLTextAreaElement;
} {
  const store = new MemDocStore();
  store.setDocument({ blocks });
  const container = document.createElement('div');
  document.body.appendChild(container);
  const editor = initialize(container, store);
  const textarea = container.querySelector('textarea') as HTMLTextAreaElement;
  return { editor, textarea };
}

/** A paragraph of `before` + one image + `after`; the image starts at `before.length`. */
function blockWithImage(before: string, after: string): Block {
  return {
    id: 'b1',
    type: 'paragraph',
    inlines: [
      { text: before, style: {} },
      { text: '￼', style: { image: IMAGE_A } },
      { text: after, style: {} },
    ],
    style: EMPTY_BLOCK_STYLE,
  };
}

/**
 * Paste a one-image WAFFLEDOCS payload with the caret at `offset`, the way
 * an in-editor image copy arrives.
 */
function pasteImagePayload(
  textarea: HTMLTextAreaElement,
  editor: EditorAPI,
  image: { src: string; width: number; height: number },
  offset: number,
): void {
  const payload = JSON.stringify({
    version: 1,
    blocks: [
      {
        id: 'p1',
        type: 'paragraph',
        inlines: [{ text: '￼', style: { image } }],
        style: EMPTY_BLOCK_STYLE,
      },
    ],
  });
  editor._setSelectionForTest({
    anchor: { blockId: 'b1', offset },
    focus: { blockId: 'b1', offset },
  });
  const event = new Event('paste', { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'clipboardData', {
    value: {
      types: [WAFFLEDOCS_MIME],
      getData: (t: string) => (t === WAFFLEDOCS_MIME ? payload : ''),
      items: [] as unknown[],
    },
  });
  textarea.dispatchEvent(event);
}

/** Paste a plain-text WAFFLEDOCS payload with the caret at `offset`. */
function pasteTextPayload(
  textarea: HTMLTextAreaElement,
  editor: EditorAPI,
  text: string,
  offset: number,
): void {
  const payload = JSON.stringify({
    version: 1,
    blocks: [
      { id: 'p1', type: 'paragraph', inlines: [{ text, style: {} }], style: EMPTY_BLOCK_STYLE },
    ],
  });
  editor._setSelectionForTest({
    anchor: { blockId: 'b1', offset },
    focus: { blockId: 'b1', offset },
  });
  const event = new Event('paste', { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'clipboardData', {
    value: {
      types: [WAFFLEDOCS_MIME],
      getData: (t: string) => (t === WAFFLEDOCS_MIME ? payload : ''),
      items: [] as unknown[],
    },
  });
  textarea.dispatchEvent(event);
}

describe('pasting an image beside another (issue #726)', () => {
  beforeEach(() => {
    installCanvasShim();
    document.body.innerHTML = '';
  });

  afterEach(() => {
    document.body.innerHTML = '';
    HTMLCanvasElement.prototype.getContext = originalGetContext;
    if (originalResizeObserver === undefined) {
      delete (globalThis as { ResizeObserver?: unknown }).ResizeObserver;
    } else {
      (globalThis as { ResizeObserver?: unknown }).ResizeObserver = originalResizeObserver;
    }
  });

  test('a different image pasted next to one keeps both', () => {
    const { editor, textarea } = setupEditor([blockWithImage('ab', 'cd')]);
    pasteImagePayload(textarea, editor, IMAGE_B, 3);

    const srcs = editor
      .getDoc()
      .document.blocks[0].inlines.flatMap((i) =>
        i.style.image ? [{ src: i.style.image.src, len: i.text.length }] : [],
      );
    expect(srcs).toEqual([
      { src: IMAGE_A.src, len: 1 },
      { src: IMAGE_B.src, len: 1 },
    ]);
    editor.dispose();
  });

  test('text pasted just before an image does not swallow it', () => {
    // The worst shape of the same defect: the image run merged into the
    // plain run in front of it, and since the *first* run's style wins,
    // `style.image` was dropped altogether — the image disappeared from a
    // paste that never touched it.
    const { editor, textarea } = setupEditor([blockWithImage('', '')]);
    pasteTextPayload(textarea, editor, 'hi', 0);

    const inlines = editor.getDoc().document.blocks[0].inlines;
    expect(inlines.map((i) => i.text)).toEqual(['hi', '￼']);
    expect(inlines[1].style.image?.src).toBe(IMAGE_A.src);
    editor.dispose();
  });

  test('text pasted just after an image is not absorbed into it', () => {
    // Merged the other way the image survives, but the text joins its run
    // — so it inherits `style.image` and renders as part of the image.
    const { editor, textarea } = setupEditor([blockWithImage('', '')]);
    pasteTextPayload(textarea, editor, 'hi', 1);

    const inlines = editor.getDoc().document.blocks[0].inlines;
    expect(inlines.map((i) => i.text)).toEqual(['￼', 'hi']);
    expect(inlines[1].style.image).toBeUndefined();
    editor.dispose();
  });

  test('text pasted next to a page number is not absorbed into it', () => {
    // Same shape for the other structural kind, and worse on screen: the
    // renderer replaces a page-number run *whole* with the page number,
    // so absorbed text is swallowed entirely.
    const { editor, textarea } = setupEditor([
      {
        id: 'b1',
        type: 'paragraph',
        inlines: [{ text: '#', style: { pageNumber: true } }],
        style: EMPTY_BLOCK_STYLE,
      },
    ]);
    pasteTextPayload(textarea, editor, 'hi', 1);

    const inlines = editor.getDoc().document.blocks[0].inlines;
    expect(inlines.map((i) => i.text)).toEqual(['#', 'hi']);
    expect(inlines[1].style.pageNumber).toBeUndefined();
    editor.dispose();
  });

  test('a copy of the same image pasted beside itself keeps both', () => {
    // The reported flow: copy an image, put the caret right next to it,
    // paste. Both runs then hold *identical* ImageData, so comparing
    // styles by value still reports "equal" — an image inline has to be
    // unmergeable on structure, not on equality.
    const { editor, textarea } = setupEditor([blockWithImage('', '')]);
    pasteImagePayload(textarea, editor, IMAGE_A, 1);

    const imageRuns = editor
      .getDoc()
      .document.blocks[0].inlines.filter((i) => i.style.image);
    expect(imageRuns).toHaveLength(2);
    // Each image still occupies exactly one offset — a two-character run
    // would render one image while the caret counted two.
    expect(imageRuns.every((i) => i.text.length === 1)).toBe(true);
    editor.dispose();
  });
});
