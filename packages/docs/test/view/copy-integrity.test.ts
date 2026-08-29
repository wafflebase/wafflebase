// @vitest-environment jsdom
import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { MemDocStore } from '../../src/store/memory.js';
import { initialize, type EditorAPI } from '../../src/view/editor.js';
import { WAFFLEDOCS_MIME } from '../../src/view/clipboard.js';
import { normalizeBlockStyle, createTableBlock } from '../../src/model/types.js';
import type { Block } from '../../src/model/types.js';

/**
 * Copy-path integrity.
 *
 * Issue #872 — a selection anchored inside a table cell produced an empty
 * `WAFFLEDOCS_MIME` payload, because `getSelectedBlocks()` resolved block ids
 * against `layout.blocks` (top-level only). The clipboard carried plain text
 * alone, so bold/italic/colour and images were lost on paste.
 *
 * Issue #870 — an image selected by clicking it is view-local state, not a
 * text selection, so `handleCopy` early-returned and Cmd/Ctrl+C wrote nothing
 * at all.
 */

const EMPTY_BLOCK_STYLE = normalizeBlockStyle({});
const IMAGE = { src: 'https://example.test/cat.png', width: 120, height: 80 };

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

/** Dispatch a `copy` on the hidden textarea and return what was written. */
function dispatchCopy(textarea: HTMLTextAreaElement): Map<string, string> {
  const written = new Map<string, string>();
  const clipboardData = {
    setData: (type: string, value: string) => written.set(type, value),
    getData: (type: string) => written.get(type) ?? '',
  };
  const event = new Event('copy', { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'clipboardData', { value: clipboardData });
  textarea.dispatchEvent(event);
  return written;
}

/** Press the copy shortcut. Both modifiers so the assertion is OS-agnostic. */
function pressCopyShortcut(textarea: HTMLTextAreaElement, key = 'c'): void {
  textarea.dispatchEvent(new KeyboardEvent('keydown', {
    key, metaKey: true, ctrlKey: true, bubbles: true, cancelable: true,
  }));
}

function payloadBlocks(written: Map<string, string>): Block[] {
  const json = written.get(WAFFLEDOCS_MIME);
  expect(json, `no ${WAFFLEDOCS_MIME} flavour on the clipboard`).toBeTruthy();
  return JSON.parse(json!).blocks as Block[];
}

/** A one-cell table whose cell holds bold text, an image, and plain text. */
function tableWithRichCell(): Block {
  const table = createTableBlock(1, 1);
  table.id = 't1';
  table.tableData!.rows[0].cells[0].blocks = [{
    id: 'c1',
    type: 'paragraph',
    inlines: [
      { text: 'Bold', style: { bold: true } },
      { text: '￼', style: { image: IMAGE } },
      { text: 'tail', style: {} },
    ],
    style: EMPTY_BLOCK_STYLE,
  }];
  return table;
}

/** A paragraph of `before` + one image + `after`; the image sits at `before.length`. */
function blockWithImage(before: string, after: string): Block {
  return {
    id: 'b1',
    type: 'paragraph',
    inlines: [
      { text: before, style: {} },
      { text: '￼', style: { image: IMAGE } },
      { text: after, style: {} },
    ],
    style: EMPTY_BLOCK_STYLE,
  };
}

describe('copy path integrity', () => {
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

  describe('copying inside a table cell (issue #872)', () => {
    test('carries inline formatting and images, not just plain text', () => {
      const { editor, textarea } = setupEditor([tableWithRichCell()]);
      editor._setSelectionForTest({
        anchor: { blockId: 'c1', offset: 0 },
        focus: { blockId: 'c1', offset: 9 },
      });

      const written = dispatchCopy(textarea);
      const blocks = payloadBlocks(written);

      expect(blocks).toHaveLength(1);
      expect(blocks[0].inlines.map((i) => i.text).join('')).toBe('Bold￼tail');
      expect(blocks[0].inlines[0].style.bold).toBe(true);
      expect(blocks[0].inlines[1].style.image).toEqual(IMAGE);
      // The plain-text flavour is unchanged.
      expect(written.get('text/plain')).toBe('Bold￼tail');
      editor.dispose();
    });

    test('trims to the selection boundaries like a body-text copy', () => {
      const { editor, textarea } = setupEditor([tableWithRichCell()]);
      editor._setSelectionForTest({
        anchor: { blockId: 'c1', offset: 2 },
        focus: { blockId: 'c1', offset: 4 },
      });

      const blocks = payloadBlocks(dispatchCopy(textarea));
      expect(blocks).toHaveLength(1);
      expect(blocks[0].inlines.map((i) => i.text).join('')).toBe('ld');
      expect(blocks[0].inlines[0].style.bold).toBe(true);
      editor.dispose();
    });

    test('spans multiple blocks within one cell', () => {
      const table = createTableBlock(1, 1);
      table.id = 't1';
      table.tableData!.rows[0].cells[0].blocks = [
        {
          id: 'c1', type: 'paragraph',
          inlines: [{ text: 'first', style: { italic: true } }],
          style: EMPTY_BLOCK_STYLE,
        },
        {
          id: 'c2', type: 'heading', headingLevel: 2,
          inlines: [{ text: 'second', style: {} }],
          style: EMPTY_BLOCK_STYLE,
        },
      ];
      const { editor, textarea } = setupEditor([table]);
      editor._setSelectionForTest({
        anchor: { blockId: 'c1', offset: 0 },
        focus: { blockId: 'c2', offset: 6 },
      });

      const blocks = payloadBlocks(dispatchCopy(textarea));
      expect(blocks).toHaveLength(2);
      expect(blocks[0].inlines[0].style.italic).toBe(true);
      expect(blocks[1].type).toBe('heading');
      expect(blocks[1].headingLevel).toBe(2);
      editor.dispose();
    });
  });

  describe('copying a click-selected image (issue #870)', () => {
    test('the copy shortcut does not drop the image selection', () => {
      const { editor, textarea } = setupEditor([blockWithImage('ab', 'cd')]);
      editor.selectImageAt('b1', 2);
      expect(editor.getSelectedImage()).not.toBeNull();

      pressCopyShortcut(textarea);

      expect(editor.getSelectedImage()).not.toBeNull();
      editor.dispose();
    });

    test('Caps Lock does not drop the image selection', () => {
      // The browser reports the *modified* character, so Caps Lock makes
      // Cmd/Ctrl+C arrive as `'C'`. A raw comparison misses it and the
      // catch-all clears the selection, silently reintroducing #870.
      const { editor, textarea } = setupEditor([blockWithImage('ab', 'cd')]);
      editor.selectImageAt('b1', 2);

      pressCopyShortcut(textarea, 'C');

      expect(editor.getSelectedImage()).not.toBeNull();
      const blocks = payloadBlocks(dispatchCopy(textarea));
      expect(blocks[0].inlines[0].style.image).toEqual(IMAGE);
      editor.dispose();
    });

    test('writes the image onto the clipboard', () => {
      const { editor, textarea } = setupEditor([blockWithImage('ab', 'cd')]);
      editor.selectImageAt('b1', 2);
      pressCopyShortcut(textarea);

      const blocks = payloadBlocks(dispatchCopy(textarea));
      expect(blocks).toHaveLength(1);
      expect(blocks[0].inlines).toHaveLength(1);
      expect(blocks[0].inlines[0].style.image).toEqual(IMAGE);
      // Nothing was mutated by a copy.
      expect(editor.getDoc().document.blocks[0].inlines).toHaveLength(3);
      editor.dispose();
    });

    test('a copied image round-trips back through paste', () => {
      const { editor, textarea } = setupEditor([blockWithImage('ab', 'cd')]);
      editor.selectImageAt('b1', 2);
      pressCopyShortcut(textarea);
      const payload = dispatchCopy(textarea).get(WAFFLEDOCS_MIME)!;

      editor.clearImageSelection();
      editor._setSelectionForTest({
        anchor: { blockId: 'b1', offset: 5 },
        focus: { blockId: 'b1', offset: 5 },
      });
      const paste = new Event('paste', { bubbles: true, cancelable: true });
      Object.defineProperty(paste, 'clipboardData', {
        value: {
          types: [WAFFLEDOCS_MIME],
          getData: (t: string) => (t === WAFFLEDOCS_MIME ? payload : ''),
          items: [] as unknown[],
        },
      });
      textarea.dispatchEvent(paste);

      const images = editor.getDoc().document.blocks
        .flatMap((b) => b.inlines)
        .filter((i) => i.style.image);
      expect(images).toHaveLength(2);
      editor.dispose();
    });

    test('an image selection is ignored when there is also a text selection', () => {
      const { editor, textarea } = setupEditor([blockWithImage('ab', 'cd')]);
      editor._setSelectionForTest({
        anchor: { blockId: 'b1', offset: 0 },
        focus: { blockId: 'b1', offset: 2 },
      });

      const written = dispatchCopy(textarea);
      expect(written.get('text/plain')).toBe('ab');
      const blocks = payloadBlocks(written);
      expect(blocks[0].inlines[0].style.image).toBeUndefined();
      editor.dispose();
    });
  });
});
