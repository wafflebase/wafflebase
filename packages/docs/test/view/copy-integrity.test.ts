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
const IMAGE2 = { src: 'https://example.test/dog.png', width: 60, height: 40 };

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
  options: { withData?: boolean } = {},
): { written: Map<string, string>; event: Event; errors: unknown[] } {
  const written = new Map<string, string>();
  const clipboardData = {
    setData: (t: string, value: string) => written.set(t, value),
    getData: (t: string) => written.get(t) ?? '',
  };
  const event = new Event(type, { bubbles: true, cancelable: true });
  // `withData: false` models the browsers that hand the listener a `null`
  // `clipboardData` (a synthetic or permission-denied clipboard event).
  Object.defineProperty(event, 'clipboardData', {
    value: options.withData === false ? null : clipboardData,
  });
  return { written, event, errors: dispatchCapturingErrors(textarea, event) };
}

/**
 * Dispatch `event` on the textarea and return anything its listeners threw.
 * A DOM listener's exception never propagates to `dispatchEvent`, so without
 * this a handler that throws still looks like a passing test — it only shows
 * up out of band on the `window` `error` event. `preventDefault()` on that
 * error keeps it from escalating to an unhandled rejection as well.
 */
function dispatchCapturingErrors(target: EventTarget, event: Event): unknown[] {
  const errors: unknown[] = [];
  const onError = (e: ErrorEvent) => {
    errors.push(e.error ?? e.message);
    e.preventDefault();
  };
  window.addEventListener('error', onError);
  try {
    target.dispatchEvent(event);
  } finally {
    window.removeEventListener('error', onError);
  }
  return errors;
}

/** Dispatch a `copy` on the hidden textarea and return what was written. */
function dispatchCopy(textarea: HTMLTextAreaElement): Map<string, string> {
  return dispatchClipboard(textarea, 'copy').written;
}

/** Dispatch a `cut` on the hidden textarea and return what was written. */
function dispatchCut(textarea: HTMLTextAreaElement): Map<string, string> {
  return dispatchClipboard(textarea, 'cut').written;
}

/**
 * Press the copy shortcut and return the dispatched event, so a caller can
 * assert on `defaultPrevented` — the whole #870 fix depends on the keydown
 * NOT being cancelled, since that is what lets the browser go on to fire its
 * own `copy` event.
 */
function pressCopyShortcut(
  textarea: HTMLTextAreaElement,
  key = 'c',
  modifiers: { metaKey?: boolean; ctrlKey?: boolean } = { metaKey: true, ctrlKey: true },
): KeyboardEvent {
  const event = new KeyboardEvent('keydown', {
    key,
    metaKey: modifiers.metaKey ?? false,
    ctrlKey: modifiers.ctrlKey ?? false,
    bubbles: true,
    cancelable: true,
  });
  textarea.dispatchEvent(event);
  return event;
}

/** Press a bare (unmodified) key, e.g. Delete. */
function pressKey(textarea: HTMLTextAreaElement, key: string): void {
  textarea.dispatchEvent(new KeyboardEvent('keydown', {
    key, bubbles: true, cancelable: true,
  }));
}

/** Press a bare key and report anything the keydown listener threw. */
function pressKeyCapturingErrors(textarea: HTMLTextAreaElement, key: string): unknown[] {
  return dispatchCapturingErrors(
    textarea,
    new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }),
  );
}

/** The concatenated text of a body block, images included as their ORC. */
function bodyText(editor: EditorAPI, index = 0): string {
  return editor.getDoc().document.blocks[index].inlines.map((i) => i.text).join('');
}

/** The blocks of the first cell of the first body table. */
function cellBlocks(editor: EditorAPI): Block[] {
  return editor.getDoc().document.blocks[0].tableData!.rows[0].cells[0].blocks;
}

/** The concatenated text of that cell. */
function cellText(editor: EditorAPI): string {
  return cellBlocks(editor)
    .flatMap((b) => b.inlines)
    .map((i) => i.text)
    .join('');
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

/**
 * `ab` + IMAGE + `c` + IMAGE2 + `d`. Offsets: 0–1 text, 2 IMAGE, 3 `c`,
 * 4 IMAGE2, 5 `d`. Deleting the leading `ab` shifts IMAGE2 onto offset 2 —
 * the offset a selection of IMAGE was holding, which is what makes a stale
 * image selection observable rather than merely wrong-looking.
 */
function blockWithTwoImages(): Block {
  return {
    id: 'b1',
    type: 'paragraph',
    inlines: [
      { text: 'ab', style: {} },
      { text: '￼', style: { image: IMAGE } },
      { text: 'c', style: {} },
      { text: '￼', style: { image: IMAGE2 } },
      { text: 'd', style: {} },
    ],
    style: EMPTY_BLOCK_STYLE,
  };
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

    test('the copy shortcut is left uncancelled so the browser still copies', () => {
      // The whole fix rests on this: `imageKeyHandler` consumes Cmd/Ctrl+C
      // *without* `preventDefault()`, because the browser only fires its own
      // `copy` event — the one that actually writes the clipboard — for a
      // keydown it was allowed to act on. Dispatching the keydown and the
      // clipboard event separately (as every other test here does) cannot see
      // that: a `preventDefault()` added to the handler would leave them all
      // green while the shortcut stopped working in a real browser.
      const { editor, textarea } = setupEditor([blockWithImage('ab', 'cd')]);
      editor.selectImageAt('b1', 2);

      expect(pressCopyShortcut(textarea, 'c').defaultPrevented).toBe(false);
      editor.dispose();
    });

    test('either modifier alone carries the copy shortcut', () => {
      // `navigator.platform` is an empty string in some browsers, so a
      // platform-keyed choice between Meta and Ctrl silently picks the wrong
      // one and the shortcut falls into the catch-all that clears the image
      // selection — issue #870 again. Cmd+C and Ctrl+C both mean copy.
      for (const modifiers of [{ metaKey: true }, { ctrlKey: true }]) {
        const { editor, textarea } = setupEditor([blockWithImage('ab', 'cd')]);
        editor.selectImageAt('b1', 2);

        const event = pressCopyShortcut(textarea, 'c', modifiers);

        expect(event.defaultPrevented).toBe(false);
        expect(editor.getSelectedImage()).not.toBeNull();
        expect(payloadBlocks(dispatchCopy(textarea))[0].inlines[0].style.image)
          .toEqual(IMAGE);
        editor.dispose();
      }
    });

    test('a read-only viewer can copy a click-selected image', () => {
      // This is what the docs context menu's read-only Copy entry offers. A
      // read-only editor deliberately never focuses on mount, and the image
      // mousedown path stops propagation before `TextEditor.handleMouseDown`
      // can focus, so unless selecting an image focuses the hidden textarea
      // itself the viewer receives neither the keydown nor the `copy` event.
      const { editor, textarea } = setupEditor([blockWithImage('ab', 'cd')], true);
      expect(document.activeElement).not.toBe(textarea);

      editor.selectImageAt('b1', 2);

      expect(document.activeElement).toBe(textarea);
      expect(pressCopyShortcut(textarea, 'c').defaultPrevented).toBe(false);
      const blocks = payloadBlocks(dispatchCopy(textarea));
      expect(blocks[0].inlines[0].style.image).toEqual(IMAGE);
      // Read-only stays read-only: copying mutated nothing.
      expect(editor.getDoc().document.blocks[0].inlines).toHaveLength(3);
      editor.dispose();
    });

    test('a null clipboardData leaves the copy to the browser', () => {
      // `preventDefault()` before knowing the clipboard is writable is the
      // worst of both: the native copy is suppressed and nothing is written,
      // so the shortcut silently clears the user's system clipboard.
      const { editor, textarea } = setupEditor([blockWithImage('ab', 'cd')]);
      editor.selectImageAt('b1', 2);

      const { event, errors } = dispatchClipboard(textarea, 'copy', { withData: false });

      expect(errors).toEqual([]);
      expect(event.defaultPrevented).toBe(false);
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

    test('Delete deletes nothing when the offset no longer holds an image', () => {
      // The stored selection is coordinates, not a handle. Drive the remote
      // path production uses (`docs-view.tsx`'s `store.onRemoteChange` →
      // `editor.getDoc().refresh()`, which leaves the image selection alone):
      // a peer rewrites the block to plain `abcd`, so offset 2 — where the
      // image used to be — now names the character `c`. Deleting one
      // character there without re-validating silently eats the wrong
      // character and the user's document reads `abd`.
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

      const errors = pressKeyCapturingErrors(textarea, 'Delete');

      expect(errors).toEqual([]);
      expect(bodyText(editor)).toBe('abcd');
      expect(editor.getSelectedImage()).toBeNull();
      editor.dispose();
    });

    test('Delete deletes nothing when a peer deleted the block', () => {
      // Same stale-selection hazard, other half: the block itself is gone, so
      // the unvalidated `deleteText` throws out of the keydown listener.
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

      const errors = pressKeyCapturingErrors(textarea, 'Delete');

      expect(errors).toEqual([]);
      expect(bodyText(editor)).toBe('peer');
      expect(editor.getSelectedImage()).toBeNull();
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

    test('the cut shortcut is left uncancelled so the browser still cuts', () => {
      // Same reason as the copy shortcut: cancelling the keydown means the
      // browser never fires the `cut` event that does the work.
      const { editor, textarea } = setupEditor([blockWithImage('ab', 'cd')]);
      editor.selectImageAt('b1', 2);

      expect(pressCopyShortcut(textarea, 'x').defaultPrevented).toBe(false);
      editor.dispose();
    });

    test('a null clipboardData cuts nothing at all', () => {
      // A cut that suppresses the native event, writes nothing because the
      // clipboard is not writable, and deletes anyway destroys content
      // outright. Bail before both.
      const { editor, textarea } = setupEditor([blockWithImage('ab', 'cd')]);
      editor.selectImageAt('b1', 2);

      const { event, errors } = dispatchClipboard(textarea, 'cut', { withData: false });

      expect(errors).toEqual([]);
      expect(event.defaultPrevented).toBe(false);
      expect(editor.getDoc().document.blocks[0].inlines).toHaveLength(3);
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

    test('cutting text clears a coexisting image selection', () => {
      // Both selections can be live at once, and the text branch wins. It
      // deletes the text but the image selection is coordinates into the
      // block it just shifted — leaving it set makes the editor report a
      // *different* image as selected, and the next Delete removes that one.
      const { editor, textarea } = setupEditor([blockWithTwoImages()]);
      // `selectImageAt` clears the text range, so the image goes first.
      editor.selectImageAt('b1', 2);
      editor._setSelectionForTest({
        anchor: { blockId: 'b1', offset: 0 },
        focus: { blockId: 'b1', offset: 2 },
      });
      expect(editor.getSelectedImage()).not.toBeNull();

      const written = dispatchCut(textarea);

      // The text path ran: 'ab' is on the clipboard and out of the document.
      expect(written.get('text/plain')).toBe('ab');
      expect(bodyText(editor)).toBe('￼c￼d');
      // Offset 2 now holds IMAGE2. A surviving selection would name it.
      expect(editor.getSelectedImage()).toBeNull();

      // And the harm it would do: with no image selected, Delete is an
      // ordinary forward delete at the caret the cut left at offset 0, so it
      // takes IMAGE. A stale image selection would route the same keystroke
      // into `deleteSelectedImageInline` and take IMAGE2 instead.
      pressKey(textarea, 'Delete');

      expect(bodyText(editor)).toBe('c￼d');
      expect(editor.getDoc().document.blocks[0].inlines
        .find((i) => i.style.image)?.style.image).toEqual(IMAGE2);
      editor.dispose();
    });
  });

  describe('cutting inside a table cell (issue #872)', () => {
    test('carries inline formatting and removes the text from the cell', () => {
      // The other consumer of the rewritten `getSelectedBlocks()`: the cut
      // path has to resolve the cell block the same way copy does, or the
      // clipboard carries plain text while the document loses the styled run.
      const { editor, textarea } = setupEditor([tableWithRichCell()]);
      editor._setSelectionForTest({
        anchor: { blockId: 'c1', offset: 0 },
        focus: { blockId: 'c1', offset: 4 },
      });

      const written = dispatchCut(textarea);
      const blocks = payloadBlocks(written);

      expect(blocks).toHaveLength(1);
      expect(blocks[0].inlines.map((i) => i.text).join('')).toBe('Bold');
      expect(blocks[0].inlines[0].style.bold).toBe(true);
      expect(written.get('text/plain')).toBe('Bold');
      expect(cellText(editor)).toBe('￼tail');
      editor.dispose();
    });

    test('a cut cell run round-trips back through paste', () => {
      const { editor, textarea } = setupEditor([tableWithRichCell()]);
      editor._setSelectionForTest({
        anchor: { blockId: 'c1', offset: 0 },
        focus: { blockId: 'c1', offset: 5 },
      });
      const payload = dispatchCut(textarea).get(WAFFLEDOCS_MIME)!;
      expect(cellText(editor)).toBe('tail');

      editor._setSelectionForTest({
        anchor: { blockId: 'c1', offset: 4 },
        focus: { blockId: 'c1', offset: 4 },
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

      const pasted = cellBlocks(editor).flatMap((b) => b.inlines);
      expect(pasted.some((i) => i.style.bold)).toBe(true);
      expect(pasted.some((i) => i.style.image)).toBe(true);
      editor.dispose();
    });

    test('a read-only editor cuts nothing out of a cell', () => {
      const { editor, textarea } = setupEditor([tableWithRichCell()], true);
      editor._setSelectionForTest({
        anchor: { blockId: 'c1', offset: 0 },
        focus: { blockId: 'c1', offset: 4 },
      });

      const written = dispatchCut(textarea);

      expect(written.size).toBe(0);
      expect(cellText(editor)).toBe('Bold￼tail');
      editor.dispose();
    });
  });

  describe('the modifier key that precedes the shortcut', () => {
    // A real keyboard delivers Cmd+C as TWO keydowns: `Meta` on its own,
    // then `c` with `metaKey` set. Every other test here synthesizes only the
    // second, so a handler that clears the image selection on the first stays
    // green while the shortcut is dead in a browser.
    for (const modifier of ['Meta', 'Control', 'Shift', 'Alt']) {
      test(`a bare ${modifier} keydown keeps the image selection`, () => {
        const { editor, textarea } = setupEditor([blockWithImage('ab', 'cd')]);
        editor.selectImageAt('b1', 2);

        pressKey(textarea, modifier);

        expect(editor.getSelectedImage()).not.toBeNull();
        editor.dispose();
      });
    }

    test('the real two-keydown Cmd+C sequence still copies the image', () => {
      const { editor, textarea } = setupEditor([blockWithImage('ab', 'cd')]);
      editor.selectImageAt('b1', 2);

      pressKey(textarea, 'Meta');
      expect(pressCopyShortcut(textarea, 'c', { metaKey: true }).defaultPrevented)
        .toBe(false);

      expect(payloadBlocks(dispatchCopy(textarea))[0].inlines[0].style.image)
        .toEqual(IMAGE);
      editor.dispose();
    });

    test('a non-modifier key still drops the image selection', () => {
      // The catch-all must keep working — typing over a selected image
      // replaces it, matching Google Docs.
      const { editor, textarea } = setupEditor([blockWithImage('ab', 'cd')]);
      editor.selectImageAt('b1', 2);

      pressKey(textarea, 'F5');

      expect(editor.getSelectedImage()).toBeNull();
      editor.dispose();
    });
  });

  describe('a read-only viewer selecting an image', () => {
    test('a click elsewhere clears a read-only image selection', () => {
      // `handleImageMouseDown` used to return at the top on `readOnly`, which
      // made the whole read-only copy path unreachable: nothing could select
      // an image, so the viewer had nothing to copy. A mousedown that reaches
      // the handler at all — here one that misses every image and so takes
      // the "clear and fall through" branch — is what proves the gate is gone.
      const { editor } = setupEditor([blockWithImage('ab', 'cd')], true);
      const container = document.body.firstElementChild as HTMLElement;
      editor.selectImageAt('b1', 2);
      expect(editor.getSelectedImage()).not.toBeNull();

      container.dispatchEvent(new MouseEvent('mousedown', {
        button: 0, clientX: 0, clientY: 0, bubbles: true, cancelable: true,
      }));

      expect(editor.getSelectedImage()).toBeNull();
      // Still read-only: the click mutated nothing.
      expect(bodyText(editor)).toBe('ab￼cd');
      editor.dispose();
    });
  });

  describe('mutations that shift the offsets under an image selection', () => {
    // `selectedImage` is a (blockId, offset) coordinate, not a handle on the
    // inline. `blockWithTwoImages` makes a stale one observable: deleting or
    // inserting text slides IMAGE2 onto the offset IMAGE was selected at, so
    // a selection left behind names the wrong picture rather than merely
    // looking odd.
    test('a paste clears it', () => {
      const { editor, textarea } = setupEditor([blockWithTwoImages()]);
      editor._setSelectionForTest({
        anchor: { blockId: 'b1', offset: 0 },
        focus: { blockId: 'b1', offset: 0 },
      });
      editor.selectImageAt('b1', 2);
      expect(editor.getSelectedImage()!.data).toEqual(IMAGE);

      const paste = new Event('paste', { bubbles: true, cancelable: true });
      Object.defineProperty(paste, 'clipboardData', {
        value: {
          types: ['text/plain'],
          getData: (t: string) => (t === 'text/plain' ? 'XYZ' : ''),
          items: [] as unknown[],
        },
      });
      textarea.dispatchEvent(paste);

      expect(bodyText(editor)).toBe('XYZab￼c￼d');
      expect(editor.getSelectedImage()).toBeNull();
      editor.dispose();
    });

    test('insertTable clears it', () => {
      const { editor } = setupEditor([blockWithTwoImages()]);
      editor.selectImageAt('b1', 2);

      editor.insertTable(2, 2);

      expect(editor.getSelectedImage()).toBeNull();
      editor.dispose();
    });

    test('insertImage clears it', () => {
      const { editor } = setupEditor([blockWithTwoImages()]);
      editor._setSelectionForTest({
        anchor: { blockId: 'b1', offset: 0 },
        focus: { blockId: 'b1', offset: 0 },
      });
      editor.selectImageAt('b1', 2);

      editor.insertImage(IMAGE2.src, IMAGE2.width, IMAGE2.height, {
        position: { blockId: 'b1', offset: 0 },
      });

      expect(editor.getSelectedImage()).toBeNull();
      editor.dispose();
    });

    test('insertLink clears it', () => {
      // The caret branch inserts the URL as literal text, so every offset
      // after it moves. Toolbar/⌘K-driven — no keydown ran to clear it.
      const { editor } = setupEditor([blockWithTwoImages()]);
      editor._setSelectionForTest({
        anchor: { blockId: 'b1', offset: 0 },
        focus: { blockId: 'b1', offset: 0 },
      });
      editor.selectImageAt('b1', 2);
      expect(editor.getSelectedImage()!.data).toEqual(IMAGE);

      editor.insertLink('https://example.com');

      expect(editor.getSelectedImage()).toBeNull();
      editor.dispose();
    });

    test('a toolbar undo clears it', () => {
      // ⌘Z is safe by accident — the keydown reaches `imageKeyHandler`'s
      // catch-all. The toolbar's Undo button calls `EditorAPI.undo()`
      // straight through, so `undoFn` has to clear it itself.
      const { editor } = setupEditor([blockWithTwoImages()]);
      editor._setSelectionForTest({
        anchor: { blockId: 'b1', offset: 0 },
        focus: { blockId: 'b1', offset: 0 },
      });
      editor.insertTable(2, 2);
      editor.selectImageAt('b1', 2);
      expect(editor.getSelectedImage()!.data).toEqual(IMAGE);

      editor.undo();

      expect(editor.getSelectedImage()).toBeNull();
      editor.dispose();
    });

    test('a toolbar redo clears it', () => {
      const { editor } = setupEditor([blockWithTwoImages()]);
      editor._setSelectionForTest({
        anchor: { blockId: 'b1', offset: 0 },
        focus: { blockId: 'b1', offset: 0 },
      });
      editor.insertTable(2, 2);
      editor.undo();
      editor.selectImageAt('b1', 2);
      expect(editor.getSelectedImage()!.data).toEqual(IMAGE);

      editor.redo();

      expect(editor.getSelectedImage()).toBeNull();
      editor.dispose();
    });

    // The table structure APIs are toolbar/context-menu driven, so like
    // undo/redo no keydown precedes them. Each adds or removes blocks, which
    // is the strongest form of the hazard: the selection can end up naming a
    // block id that no longer exists at all.
    const tableOps: Array<[string, (editor: EditorAPI) => void]> = [
      ['deleteTable', (e) => e.deleteTable()],
      ['insertTableRow', (e) => e.insertTableRow(true)],
      ['deleteTableRow', (e) => e.deleteTableRow()],
      ['insertTableColumn', (e) => e.insertTableColumn(true)],
      ['deleteTableColumn', (e) => e.deleteTableColumn()],
      ['splitTableCell', (e) => e.splitTableCell()],
    ];
    for (const [name, run] of tableOps) {
      test(`${name} clears it`, () => {
        const { editor } = setupEditor([blockWithTwoImages(), tableWithRichCell()]);
        // Cursor inside the table (so the op is not a no-op), image selection
        // out in the body paragraph.
        editor._setSelectionForTest({
          anchor: { blockId: 'c1', offset: 0 },
          focus: { blockId: 'c1', offset: 0 },
        });
        editor.selectImageAt('b1', 2);
        expect(editor.getSelectedImage()!.data).toEqual(IMAGE);

        run(editor);

        expect(editor.getSelectedImage()).toBeNull();
        editor.dispose();
      });
    }

    test('a table op called outside a table leaves it alone', () => {
      // The clear sits after each op's `if (!cellInfo) return` guard, so a
      // call that mutates nothing must not drop the selection either.
      const { editor } = setupEditor([blockWithTwoImages()]);
      editor.selectImageAt('b1', 2);

      editor.deleteTableRow();

      expect(editor.getSelectedImage()!.data).toEqual(IMAGE);
      editor.dispose();
    });

    test('resetAfterDocumentReplace clears it', () => {
      // Import / "replace content" swaps the whole document, so the block the
      // selection names is very likely gone.
      const { editor, store } = setupEditor([blockWithTwoImages()]);
      editor.selectImageAt('b1', 2);
      expect(editor.getSelectedImage()!.data).toEqual(IMAGE);

      store.setDocument({ blocks: [blockWithImage('zz', 'yy', IMAGE2)] });
      editor.resetAfterDocumentReplace();

      expect(editor.getSelectedImage()).toBeNull();
      editor.dispose();
    });

    test('selecting an image in a block that is gone returns rather than throws', () => {
      // `selectImageAt` / `getSelectedImage` / `updateSelectedImage` all read
      // the selection coordinate through `findBlock`; `getBlock` throws on a
      // missing id, and these are reached from view code (context menu,
      // Image Options panel) holding a coordinate read a moment earlier.
      const { editor } = setupEditor([blockWithTwoImages()]);

      expect(() => editor.selectImageAt('gone', 0)).not.toThrow();

      expect(editor.getSelectedImage()).toBeNull();
      editor.dispose();
    });

    test('the exported clearImageSelection drops it, for out-of-module mutators', () => {
      // `FindReplaceState.replaceActive` / `replaceAll` run against the `Doc`
      // directly from the find bar, so they cannot be funnelled through the
      // editor's own mutation entry points. This is the seam they use
      // instead (`docs-find-bar.tsx`); if it ever stops clearing, a replace
      // leaves the selection naming whichever inline slid into the slot.
      const { editor } = setupEditor([blockWithTwoImages()]);
      editor.selectImageAt('b1', 2);
      expect(editor.getSelectedImage()!.data).toEqual(IMAGE);

      editor.clearImageSelection();

      expect(editor.getSelectedImage()).toBeNull();
      editor.dispose();
    });
  });
  /**
   * Header and footer copy.
   *
   * `getSelectedBlocks()` / `getSelectedTableCells()` / `getSelectedText()`
   * all resolved the selection against `getLayout()` — the *body* layout —
   * while their siblings (`isInTable()`, `getVisualLineRange()`, …) use
   * `getActiveLayout()`, which follows the edit context. A header or footer
   * block is not in `layout.blocks` and not in the body's `blockParentMap`,
   * so every id lookup missed and the copy wrote `{"blocks":[]}` with an
   * empty `text/plain` — the whole clipboard, not just its styles.
   *
   * That made the issue #872 acceptance criterion ("copying a styled range
   * inside a table cell carries inline styles") only true in the body, which
   * is why these live here: the criterion is now unqualified and pinned.
   */
  describe('copying from a header or footer', () => {
    /** A one-cell table whose cell holds bold text plus an image. */
    function hfTableWithRichCell(cellBlockId: string): Block {
      const table = createTableBlock(1, 1);
      table.id = `hft-${cellBlockId}`;
      table.tableData!.rows[0].cells[0].blocks = [{
        id: cellBlockId,
        type: 'paragraph',
        inlines: [
          { text: 'Bold', style: { bold: true } },
          { text: '\uFFFC', style: { image: IMAGE } },
        ],
        style: EMPTY_BLOCK_STYLE,
      }];
      return table;
    }

    function richPara(id: string, text: string): Block {
      return {
        id,
        type: 'paragraph',
        inlines: [{ text, style: { bold: true, italic: true } }],
        style: EMPTY_BLOCK_STYLE,
      };
    }

    /** Mount an editor whose header and footer carry their own blocks. */
    function setupHFEditor(opts: {
      header?: Block[];
      footer?: Block[];
    }): { editor: EditorAPI; textarea: HTMLTextAreaElement } {
      const store = new MemDocStore();
      store.setDocument({
        blocks: [richPara('body1', 'body text')],
        ...(opts.header ? { header: { blocks: opts.header, marginFromEdge: 48 } } : {}),
        ...(opts.footer ? { footer: { blocks: opts.footer, marginFromEdge: 48 } } : {}),
      });
      const container = document.createElement('div');
      document.body.appendChild(container);
      const editor = initialize(container, store);
      const textarea = container.querySelector('textarea') as HTMLTextAreaElement;
      return { editor, textarea };
    }

    test('a styled range in a header table cell carries its styles', () => {
      const { editor, textarea } = setupHFEditor({
        header: [hfTableWithRichCell('hc1')],
      });
      editor._setEditContextForTest('header');
      editor._setSelectionForTest({
        anchor: { blockId: 'hc1', offset: 0 },
        focus: { blockId: 'hc1', offset: 5 },
      });

      const written = dispatchCopy(textarea);
      const blocks = payloadBlocks(written);

      expect(blocks).toHaveLength(1);
      expect(blocks[0].inlines.map((i) => i.text).join('')).toBe('Bold\uFFFC');
      expect(blocks[0].inlines[0].style.bold).toBe(true);
      expect(blocks[0].inlines[1].style.image).toEqual(IMAGE);
      expect(written.get('text/plain')).toBe('Bold\uFFFC');
      editor.dispose();
    });

    test('a styled range in a footer table cell carries its styles', () => {
      const { editor, textarea } = setupHFEditor({
        footer: [hfTableWithRichCell('fc1')],
      });
      editor._setEditContextForTest('footer');
      editor._setSelectionForTest({
        anchor: { blockId: 'fc1', offset: 0 },
        focus: { blockId: 'fc1', offset: 5 },
      });

      const blocks = payloadBlocks(dispatchCopy(textarea));

      expect(blocks).toHaveLength(1);
      expect(blocks[0].inlines[0].style.bold).toBe(true);
      expect(blocks[0].inlines[1].style.image).toEqual(IMAGE);
      editor.dispose();
    });

    test('a plain header paragraph copies at all', () => {
      // Not a table case: the body-layout lookup missed *every* header block,
      // so a header selection wrote an empty clipboard even with no table in
      // sight. Cut is worse still — `deleteSelection` has its own
      // header/footer branch, so it deleted the text and wrote nothing.
      const { editor, textarea } = setupHFEditor({
        header: [richPara('hp1', 'header text')],
      });
      editor._setEditContextForTest('header');
      editor._setSelectionForTest({
        anchor: { blockId: 'hp1', offset: 0 },
        focus: { blockId: 'hp1', offset: 6 },
      });

      const written = dispatchCopy(textarea);
      const blocks = payloadBlocks(written);

      expect(blocks).toHaveLength(1);
      expect(blocks[0].inlines.map((i) => i.text).join('')).toBe('header');
      expect(blocks[0].inlines[0].style.bold).toBe(true);
      expect(blocks[0].inlines[0].style.italic).toBe(true);
      expect(written.get('text/plain')).toBe('header');
      editor.dispose();
    });

    test('a whole-cell rectangle in a header carries the cells', () => {
      // The other copy shape: a cell *rectangle* takes the
      // `getSelectedTableCells()` branch, which resolved the table block
      // through the body layout too. `blocks` is empty by design here; the
      // payload rides in `tableCells`.
      const table = createTableBlock(1, 2);
      table.id = 'hft2';
      table.tableData!.rows[0].cells[0].blocks = [{
        id: 'hr0c0', type: 'paragraph',
        inlines: [{ text: 'Left', style: { bold: true } }],
        style: EMPTY_BLOCK_STYLE,
      }];
      table.tableData!.rows[0].cells[1].blocks = [{
        id: 'hr0c1', type: 'paragraph',
        inlines: [{ text: 'Right', style: {} }],
        style: EMPTY_BLOCK_STYLE,
      }];
      const store = new MemDocStore();
      store.setDocument({
        blocks: [richPara('body1', 'body text')],
        header: { blocks: [table], marginFromEdge: 48 },
      });
      const container = document.createElement('div');
      document.body.appendChild(container);
      const editor = initialize(container, store);
      const textarea = container.querySelector('textarea') as HTMLTextAreaElement;

      editor._setEditContextForTest('header');
      editor._setSelectionForTest({
        anchor: { blockId: 'hr0c0', offset: 0 },
        focus: { blockId: 'hr0c1', offset: 0 },
        tableCellRange: {
          blockId: 'hft2',
          start: { rowIndex: 0, colIndex: 0 },
          end: { rowIndex: 0, colIndex: 1 },
        },
      });

      const written = dispatchCopy(textarea);
      const payload = JSON.parse(written.get(WAFFLEDOCS_MIME)!);

      expect(payload.tableCells).toHaveLength(1);
      expect(payload.tableCells[0]).toHaveLength(2);
      expect(payload.tableCells[0][0].blocks[0].inlines[0].text).toBe('Left');
      expect(payload.tableCells[0][0].blocks[0].inlines[0].style.bold).toBe(true);
      expect(payload.tableCells[0][1].blocks[0].inlines[0].text).toBe('Right');
      expect(written.get('text/plain')).toBe('Left\tRight');
      editor.dispose();
    });

    test('a body copy is unaffected while a header exists', () => {
      // `getActiveLayout()` falls through to `getLayout()` in the body
      // context, so the body path must be byte-for-byte what it was.
      const { editor, textarea } = setupHFEditor({
        header: [richPara('hp1', 'header text')],
      });
      editor._setSelectionForTest({
        anchor: { blockId: 'body1', offset: 0 },
        focus: { blockId: 'body1', offset: 4 },
      });

      const written = dispatchCopy(textarea);
      const blocks = payloadBlocks(written);

      expect(blocks).toHaveLength(1);
      expect(blocks[0].inlines.map((i) => i.text).join('')).toBe('body');
      expect(written.get('text/plain')).toBe('body');
      editor.dispose();
    });
  });
});
