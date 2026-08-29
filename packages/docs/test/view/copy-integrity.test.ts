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

function setupEditor(blocks: Block[], readOnly = false): {
  editor: EditorAPI;
  textarea: HTMLTextAreaElement;
  store: MemDocStore;
} {
  const store = new MemDocStore();
  store.setDocument({ blocks });
  const container = document.createElement('div');
  document.body.appendChild(container);
  const editor = initialize(container, store, undefined, readOnly);
  const textarea = container.querySelector('textarea') as HTMLTextAreaElement;
  return { editor, textarea, store };
}

/**
 * Dispatch a clipboard event on the hidden textarea and report everything the
 * handler did with it:
 *
 * - `written` — the flavours it put on the clipboard.
 * - `event.defaultPrevented` — the only way to tell "we deliberately wrote
 *   nothing and left the browser to it" apart from "we claimed the event and
 *   then wrote nothing".
 * - `errors` — anything the listener threw. A DOM listener's exception never
 *   propagates to the dispatcher, so without capturing it here a handler that
 *   throws still looks like a passing test. `preventDefault()` on the error
 *   event keeps it from escalating to an unhandled rejection as well.
 */
function dispatchClipboard(
  textarea: HTMLTextAreaElement,
  type: 'copy' | 'cut',
): { written: Map<string, string>; event: Event; errors: unknown[] } {
  const written = new Map<string, string>();
  const clipboardData = {
    setData: (t: string, value: string) => written.set(t, value),
    getData: (t: string) => written.get(t) ?? '',
  };
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'clipboardData', { value: clipboardData });
  const errors: unknown[] = [];
  const onError = (e: ErrorEvent) => {
    errors.push(e.error ?? e.message);
    e.preventDefault();
  };
  window.addEventListener('error', onError);
  try {
    textarea.dispatchEvent(event);
  } finally {
    window.removeEventListener('error', onError);
  }
  return { written, event, errors };
}

/** Dispatch a `copy` on the hidden textarea and return what was written. */
function dispatchCopy(textarea: HTMLTextAreaElement): Map<string, string> {
  return dispatchClipboard(textarea, 'copy').written;
}

/** Dispatch a `cut` on the hidden textarea and return what was written. */
function dispatchCut(textarea: HTMLTextAreaElement): Map<string, string> {
  return dispatchClipboard(textarea, 'cut').written;
}

/** Press the copy shortcut. Both modifiers so the assertion is OS-agnostic. */
function pressCopyShortcut(textarea: HTMLTextAreaElement, key = 'c'): void {
  textarea.dispatchEvent(new KeyboardEvent('keydown', {
    key, metaKey: true, ctrlKey: true, bubbles: true, cancelable: true,
  }));
}

/** Press a bare (unmodified) key, e.g. Delete. */
function pressKey(textarea: HTMLTextAreaElement, key: string): void {
  textarea.dispatchEvent(new KeyboardEvent('keydown', {
    key, bubbles: true, cancelable: true,
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

/**
 * An outer 1x1 table whose only cell also holds an inner 1x1 table, whose
 * only cell holds one rich paragraph (`nc1`). Resolving `nc1` needs the full
 * `resolveNestedTableLayout` walk — `layout.blocks` only knows `outer`.
 */
function nestedTableWithRichCell(): Block {
  const outer = createTableBlock(1, 1);
  outer.id = 'outer';
  const inner = createTableBlock(1, 1);
  inner.id = 'inner';
  inner.tableData!.rows[0].cells[0].blocks = [{
    id: 'nc1',
    type: 'paragraph',
    inlines: [
      { text: 'Deep', style: { bold: true } },
      { text: '￼', style: { image: IMAGE } },
    ],
    style: EMPTY_BLOCK_STYLE,
  }];
  outer.tableData!.rows[0].cells[0].blocks.push(inner);
  return outer;
}

/** A paragraph of `before` + one image + `after`; the image sits at `before.length`. */
function blockWithImage(before: string, after: string, image = IMAGE): Block {
  return {
    id: 'b1',
    type: 'paragraph',
    inlines: [
      { text: before, style: {} },
      { text: '￼', style: { image } },
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

    test('resolves a cell inside a nested table', () => {
      // `layout.blocks` holds only the outer table, so the inner table's cell
      // is reachable only through `resolveNestedTableLayout`. A `.find()` over
      // `layout.blocks` would miss it and the payload would come back empty.
      const { editor, textarea } = setupEditor([nestedTableWithRichCell()]);
      editor._setSelectionForTest({
        anchor: { blockId: 'nc1', offset: 0 },
        focus: { blockId: 'nc1', offset: 5 },
      });

      const blocks = payloadBlocks(dispatchCopy(textarea));

      expect(blocks).toHaveLength(1);
      expect(blocks[0].inlines.map((i) => i.text).join('')).toBe('Deep￼');
      expect(blocks[0].inlines[0].style.bold).toBe(true);
      expect(blocks[0].inlines[1].style.image).toEqual(IMAGE);
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
      // Establish *both*: `selectImageAt` clears the text range, so the image
      // has to come first and the text selection second. Without both live,
      // the assertion below would pass under inverted precedence too.
      editor.selectImageAt('b1', 2);
      editor._setSelectionForTest({
        anchor: { blockId: 'b1', offset: 0 },
        focus: { blockId: 'b1', offset: 2 },
      });
      expect(editor.getSelectedImage()).not.toBeNull();

      const written = dispatchCopy(textarea);

      // The text selection wins: 'ab', no image inline on the payload.
      expect(written.get('text/plain')).toBe('ab');
      const blocks = payloadBlocks(written);
      expect(blocks[0].inlines.map((i) => i.text).join('')).toBe('ab');
      expect(blocks[0].inlines.some((i) => i.style.image)).toBe(false);
      editor.dispose();
    });

    test('the plain-text flavour carries the alt text', () => {
      const withAlt = { ...IMAGE, alt: 'A cat' };
      const { editor, textarea } = setupEditor([blockWithImage('ab', 'cd', withAlt)]);
      editor.selectImageAt('b1', 2);

      const written = dispatchCopy(textarea);

      expect(written.get('text/plain')).toBe('A cat');
      expect(payloadBlocks(written)[0].inlines[0].style.image).toEqual(withAlt);
      editor.dispose();
    });

    test('the plain-text flavour is empty when the image has no alt', () => {
      // Not "absent": a plain-text consumer must still get a defined value
      // rather than whatever the previous clipboard owner left behind.
      const { editor, textarea } = setupEditor([blockWithImage('ab', 'cd')]);
      editor.selectImageAt('b1', 2);

      const written = dispatchCopy(textarea);

      expect(written.has('text/plain')).toBe(true);
      expect(written.get('text/plain')).toBe('');
      editor.dispose();
    });

    test('writes nothing when a peer deleted the block under the selection', () => {
      // The editor keeps no remote-change subscription of its own: production
      // drives this from `docs-view.tsx`'s `store.onRemoteChange`, which calls
      // `editor.getDoc().refresh()` and leaves the image selection untouched.
      // Reproduce exactly that — the store loses the block, the selection
      // still names it. `imageSelectionProvider` must return null rather than
      // let `getBlock` throw out of the browser's `copy` listener.
      const { editor, textarea, store } = setupEditor([blockWithImage('ab', 'cd')]);
      editor.selectImageAt('b1', 2);

      store.setDocument({
        blocks: [{
          id: 'b2', type: 'paragraph',
          inlines: [{ text: 'peer', style: {} }],
          style: EMPTY_BLOCK_STYLE,
        }],
      });
      editor.getDoc().refresh();

      const { written, event, errors } = dispatchClipboard(textarea, 'copy');

      // The throwing `getBlock` this guard replaced would land here.
      expect(errors).toEqual([]);
      expect(written.size).toBe(0);
      // Not claimed: the native copy still runs, so the system clipboard keeps
      // whatever it held instead of being wiped.
      expect(event.defaultPrevented).toBe(false);
      editor.dispose();
    });

    test('writes nothing when the offset no longer holds an image', () => {
      // Same remote-change path, but the block survives and only the image
      // inline is gone — the second of the provider's two null guards.
      const { editor, textarea, store } = setupEditor([blockWithImage('ab', 'cd')]);
      editor.selectImageAt('b1', 2);

      store.setDocument({
        blocks: [{
          id: 'b1', type: 'paragraph',
          inlines: [{ text: 'abcd', style: {} }],
          style: EMPTY_BLOCK_STYLE,
        }],
      });
      editor.getDoc().refresh();

      const { written, event, errors } = dispatchClipboard(textarea, 'copy');

      expect(errors).toEqual([]);
      expect(written.size).toBe(0);
      expect(event.defaultPrevented).toBe(false);
      editor.dispose();
    });
  });

  describe('deleting a click-selected image', () => {
    test('Delete removes the image inline and leaves the caret in its place', () => {
      const { editor, textarea } = setupEditor([blockWithImage('ab', 'cd')]);
      editor.selectImageAt('b1', 2);

      pressKey(textarea, 'Delete');

      const block = editor.getDoc().document.blocks[0];
      expect(block.inlines.some((i) => i.style.image)).toBe(false);
      expect(block.inlines.map((i) => i.text).join('')).toBe('abcd');
      expect(editor.getSelectedImage()).toBeNull();
      expect(editor._getCursorForTest()).toMatchObject({ blockId: 'b1', offset: 2 });
      editor.dispose();
    });

    test('a read-only editor refuses to delete the selected image', () => {
      // `imageKeyHandler` runs *before* `handleKeyDown`'s read-only guard
      // (text-editor.ts: the handler is consulted at the top of the method),
      // so without the early return in `deleteSelectedImageInline` a viewer
      // could delete an image out of a read-only document.
      const { editor, textarea } = setupEditor([blockWithImage('ab', 'cd')], true);
      editor.selectImageAt('b1', 2);
      expect(editor.getSelectedImage()).not.toBeNull();

      pressKey(textarea, 'Delete');
      pressKey(textarea, 'Backspace');

      const block = editor.getDoc().document.blocks[0];
      expect(block.inlines).toHaveLength(3);
      expect(block.inlines[1].style.image).toEqual(IMAGE);
      editor.dispose();
    });
  });

  describe('cutting a click-selected image (issue #870)', () => {
    test('the cut shortcut does not drop the image selection', () => {
      const { editor, textarea } = setupEditor([blockWithImage('ab', 'cd')]);
      editor.selectImageAt('b1', 2);

      pressCopyShortcut(textarea, 'x');

      expect(editor.getSelectedImage()).not.toBeNull();
      editor.dispose();
    });

    test('Caps Lock does not drop the image selection', () => {
      // Same normalization trap as Cmd/Ctrl+C: the browser reports `'X'`.
      const { editor, textarea } = setupEditor([blockWithImage('ab', 'cd')]);
      editor.selectImageAt('b1', 2);

      pressCopyShortcut(textarea, 'X');

      expect(editor.getSelectedImage()).not.toBeNull();
      const blocks = payloadBlocks(dispatchCut(textarea));
      expect(blocks[0].inlines[0].style.image).toEqual(IMAGE);
      expect(editor.getDoc().document.blocks[0].inlines.some((i) => i.style.image))
        .toBe(false);
      editor.dispose();
    });

    test('writes the same payload copy does', () => {
      const { editor, textarea } = setupEditor([blockWithImage('ab', 'cd')]);
      editor.selectImageAt('b1', 2);

      pressCopyShortcut(textarea, 'c');
      const copied = dispatchCopy(textarea);
      // Re-select: the copy left the selection alone, but be explicit.
      editor.selectImageAt('b1', 2);
      pressCopyShortcut(textarea, 'x');
      const cut = dispatchCut(textarea);

      expect(cut.get('text/plain')).toBe(copied.get('text/plain'));
      // Block ids are regenerated per write, so compare the payload's content.
      const cutBlocks = payloadBlocks(cut);
      const copiedBlocks = payloadBlocks(copied);
      expect(cutBlocks).toHaveLength(1);
      expect(cutBlocks[0].inlines).toEqual(copiedBlocks[0].inlines);
      expect(cutBlocks[0].inlines[0].style.image).toEqual(IMAGE);
      editor.dispose();
    });

    test('removes the image inline and leaves the caret in its place', () => {
      const { editor, textarea } = setupEditor([blockWithImage('ab', 'cd')]);
      editor.selectImageAt('b1', 2);
      pressCopyShortcut(textarea, 'x');

      dispatchCut(textarea);

      const block = editor.getDoc().document.blocks[0];
      expect(block.inlines.some((i) => i.style.image)).toBe(false);
      expect(block.inlines.map((i) => i.text).join('')).toBe('abcd');
      expect(editor.getSelectedImage()).toBeNull();
      expect(editor._getCursorForTest()).toMatchObject({ blockId: 'b1', offset: 2 });
      editor.dispose();
    });

    test('is undoable as one unit', () => {
      const { editor, textarea, store } = setupEditor([blockWithImage('ab', 'cd')]);
      editor.selectImageAt('b1', 2);
      pressCopyShortcut(textarea, 'x');
      dispatchCut(textarea);

      editor.undo();

      const block = editor.getDoc().document.blocks[0];
      expect(block.inlines).toHaveLength(3);
      expect(block.inlines[1].style.image).toEqual(IMAGE);
      // One unit: the cut pushed exactly one snapshot, so nothing is left to
      // undo. A second `snapshot()` inside the cut would leave one here.
      expect(store.canUndo()).toBe(false);
      editor.dispose();
    });

    test('a read-only editor cuts nothing', () => {
      const { editor, textarea } = setupEditor([blockWithImage('ab', 'cd')], true);
      editor.selectImageAt('b1', 2);
      pressCopyShortcut(textarea, 'x');

      const written = dispatchCut(textarea);

      expect(written.size).toBe(0);
      expect(editor.getDoc().document.blocks[0].inlines).toHaveLength(3);
      editor.dispose();
    });

    test('a cut image round-trips back through paste', () => {
      // Payload parity with copy is asserted above; this proves the payload
      // a *cut* writes is the one that comes back, so the removal and the
      // clipboard write cannot disagree about which image was taken.
      const { editor, textarea } = setupEditor([blockWithImage('ab', 'cd')]);
      editor.selectImageAt('b1', 2);
      pressCopyShortcut(textarea, 'x');
      const payload = dispatchCut(textarea).get(WAFFLEDOCS_MIME)!;

      editor._setSelectionForTest({
        anchor: { blockId: 'b1', offset: 4 },
        focus: { blockId: 'b1', offset: 4 },
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
      expect(images).toHaveLength(1);
      expect(images[0].style.image).toEqual(IMAGE);
      editor.dispose();
    });
  });
});
