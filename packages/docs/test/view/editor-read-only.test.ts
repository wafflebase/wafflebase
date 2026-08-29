// @vitest-environment jsdom
import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { MemDocStore } from '../../src/store/memory.js';
import { initialize, type EditorAPI } from '../../src/view/editor.js';
import { createTableBlock, getBlockText, normalizeBlockStyle } from '../../src/model/types.js';
import type { Block } from '../../src/model/types.js';

const EMPTY_BLOCK_STYLE = normalizeBlockStyle({});

/**
 * Read-only (viewer) mode must block every document mutation while still
 * permitting the read interactions from issue #482 (selection, copy,
 * link opening). These jsdom tests pin the mutation-blocking guarantees
 * and that keyboard-driven selection still works; pointer/copy/link paths
 * that need real pixel layout are covered by manual / browser tests.
 */

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

function setupEditor(
  blocks: Block[],
  readOnly: boolean,
): { editor: EditorAPI; container: HTMLElement; textarea: HTMLTextAreaElement } {
  const store = new MemDocStore();
  store.setDocument({ blocks });
  const container = document.createElement('div');
  document.body.appendChild(container);
  const editor = initialize(container, store, undefined, readOnly);
  const textarea = container.querySelector('textarea') as HTMLTextAreaElement;
  return { editor, container, textarea };
}

/**
 * Build a paste/cut ClipboardEvent carrying a real text payload. jsdom does
 * not populate `clipboardData` on a ClipboardEvent, so stub it: paste reads
 * `text/plain`, cut writes to it (no-op here). A real payload makes the
 * read-only assertions non-vacuous — without the guard the paste would insert.
 */
function clipboardEvent(type: 'paste' | 'cut', text: string): Event {
  const clipboardData = {
    getData: (t: string) => (t === 'text/plain' ? text : ''),
    setData: () => {},
    items: [] as unknown[],
  };
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'clipboardData', { value: clipboardData });
  return event;
}

function para(id: string, text: string): Block {
  return {
    id,
    type: 'paragraph',
    inlines: [{ text, style: { fontFamily: 'Arial', fontSize: 12 } }],
    style: EMPTY_BLOCK_STYLE,
  };
}

function bodyText(editor: EditorAPI): string {
  return editor
    .getDoc()
    .document.blocks.map((b) => getBlockText(b))
    .join('\n');
}

describe('read-only docs editor (issue #482)', () => {
  beforeEach(() => {
    installCanvasShim();
    document.body.innerHTML = '';
  });

  afterEach(() => {
    document.body.innerHTML = '';
    // Restore the global shims so they do not leak into other jsdom tests.
    HTMLCanvasElement.prototype.getContext = originalGetContext;
    if (originalResizeObserver === undefined) {
      delete (globalThis as { ResizeObserver?: unknown }).ResizeObserver;
    } else {
      (globalThis as { ResizeObserver?: unknown }).ResizeObserver = originalResizeObserver;
    }
  });

  test('a text-editor is still constructed (owns selection/copy/link)', () => {
    const { editor, textarea } = setupEditor([para('b1', 'hello world')], true);
    expect(textarea).toBeTruthy();
    editor.dispose();
  });

  test('typing (input event) does not mutate the document', () => {
    const { editor, textarea } = setupEditor([para('b1', 'hello world')], true);
    textarea.value = 'X';
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
    expect(bodyText(editor)).toBe('hello world');
    editor.dispose();
  });

  test('control: typing DOES mutate when not read-only', () => {
    const { editor, textarea } = setupEditor([para('b1', 'hello world')], false);
    textarea.value = 'X';
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
    expect(bodyText(editor)).not.toBe('hello world');
    expect(bodyText(editor)).toContain('X');
    editor.dispose();
  });

  test('paste (with a real payload) does not mutate the document', () => {
    const { editor, textarea } = setupEditor([para('b1', 'hello world')], true);
    // A plain empty paste event inserts nothing regardless of the guard, so
    // carry a real text payload — without the read-only gate this WOULD paste.
    textarea.dispatchEvent(clipboardEvent('paste', 'PASTED'));
    expect(bodyText(editor)).toBe('hello world');
    editor.dispose();
  });

  test('control: the same paste payload DOES insert when not read-only', () => {
    const { editor, textarea } = setupEditor([para('b1', 'hello world')], false);
    textarea.dispatchEvent(clipboardEvent('paste', 'PASTED'));
    expect(bodyText(editor)).toContain('PASTED');
    editor.dispose();
  });

  test('cut does not delete the selection', () => {
    const { editor, textarea } = setupEditor([para('b1', 'hello world')], true);
    editor._setSelectionForTest({
      anchor: { blockId: 'b1', offset: 0 },
      focus: { blockId: 'b1', offset: 5 },
    });
    textarea.dispatchEvent(clipboardEvent('cut', ''));
    expect(bodyText(editor)).toBe('hello world');
    editor.dispose();
  });

  test('control: cut DOES delete the selection when not read-only', () => {
    const { editor, textarea } = setupEditor([para('b1', 'hello world')], false);
    editor._setSelectionForTest({
      anchor: { blockId: 'b1', offset: 0 },
      focus: { blockId: 'b1', offset: 5 },
    });
    textarea.dispatchEvent(clipboardEvent('cut', ''));
    expect(bodyText(editor)).not.toBe('hello world');
    expect(bodyText(editor)).not.toContain('hello');
    editor.dispose();
  });

  test('Cmd/Ctrl+A selects all (navigation aid) without mutating', () => {
    const { editor, textarea } = setupEditor([para('b1', 'hello world')], true);
    editor._setSelectionForTest({
      anchor: { blockId: 'b1', offset: 0 },
      focus: { blockId: 'b1', offset: 0 },
    });
    textarea.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'a',
        ctrlKey: true,
        metaKey: true,
        bubbles: true,
        cancelable: true,
      }),
    );
    const sel = editor.getActiveSelection();
    expect(sel).not.toBeNull();
    // Whole block is selected: caret 0 → end of "hello world".
    expect(sel!.anchor.offset).toBe(0);
    expect(sel!.focus.offset).toBe(11);
    expect(bodyText(editor)).toBe('hello world');
    editor.dispose();
  });

  test('Backspace does not delete text', () => {
    const { editor, textarea } = setupEditor([para('b1', 'hello world')], true);
    // Place a collapsed caret mid-word so Backspace would delete if allowed.
    editor._setSelectionForTest({
      anchor: { blockId: 'b1', offset: 5 },
      focus: { blockId: 'b1', offset: 5 },
    });
    textarea.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true, cancelable: true }),
    );
    expect(bodyText(editor)).toBe('hello world');
    editor.dispose();
  });

  test('Enter does not split the block', () => {
    const { editor, textarea } = setupEditor([para('b1', 'hello world')], true);
    editor._setSelectionForTest({
      anchor: { blockId: 'b1', offset: 5 },
      focus: { blockId: 'b1', offset: 5 },
    });
    textarea.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }),
    );
    expect(editor.getDoc().document.blocks.length).toBe(1);
    editor.dispose();
  });

  test('copy serializes the selected text without mutating the document', () => {
    const { editor, textarea } = setupEditor([para('b1', 'hello world')], true);
    editor._setSelectionForTest({
      anchor: { blockId: 'b1', offset: 0 },
      focus: { blockId: 'b1', offset: 5 },
    });
    // Stub clipboardData; jsdom's ClipboardEvent does not carry one.
    const written = new Map<string, string>();
    const clipboardData = {
      setData: (type: string, value: string) => written.set(type, value),
      getData: (type: string) => written.get(type) ?? '',
    };
    const event = new Event('copy', { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'clipboardData', { value: clipboardData });
    textarea.dispatchEvent(event);
    // Selected text is copied out; the document itself is untouched.
    expect(written.get('text/plain')).toBe('hello');
    expect(bodyText(editor)).toBe('hello world');
    editor.dispose();
  });

  // The programmatic EditorAPI is reachable independently of pointer /
  // keyboard events, so its mutating commands must be gated too — not just
  // the event handlers. These pin the API-boundary guard.

  test('programmatic applyStyle() does not mutate in read-only', () => {
    const { editor } = setupEditor([para('b1', 'hello world')], true);
    editor._setSelectionForTest({
      anchor: { blockId: 'b1', offset: 0 },
      focus: { blockId: 'b1', offset: 5 },
    });
    editor.applyStyle({ bold: true });
    expect(editor.getRangeStyleSummary().bold).not.toBe(true);
    editor.dispose();
  });

  test('control: applyStyle() DOES apply when not read-only', () => {
    const { editor } = setupEditor([para('b1', 'hello world')], false);
    editor._setSelectionForTest({
      anchor: { blockId: 'b1', offset: 0 },
      focus: { blockId: 'b1', offset: 5 },
    });
    editor.applyStyle({ bold: true });
    expect(editor.getRangeStyleSummary().bold).toBe(true);
    editor.dispose();
  });

  /**
   * The cell-rectangle route is the one `applyStyle` path that reaches
   * `Doc.applyInlineStyleToCells`, so this pins that the newest write
   * primitive is unreachable through the guarded API too. (`getDoc()` still
   * hands out the raw model by design — read-only here is a client-side
   * convenience, and the store/server stays the authoritative write
   * boundary; see the `MUTATING_METHODS` comment in `view/editor.ts`.)
   */
  test('programmatic applyStyle() over a cell rectangle does not mutate in read-only', () => {
    const table = createTableBlock(1, 2);
    table.tableData!.rows[0].cells[0].blocks[0].inlines = [
      { text: 'cell', style: {} },
    ];
    const { editor } = setupEditor([para('b1', 'hello world'), table], true);
    const cells = table.tableData!.rows[0].cells;
    editor._setSelectionForTest({
      anchor: { blockId: cells[0].blocks[0].id, offset: 0 },
      focus: { blockId: cells[1].blocks[0].id, offset: 0 },
      tableCellRange: {
        blockId: table.id,
        start: { rowIndex: 0, colIndex: 0 },
        end: { rowIndex: 0, colIndex: 1 },
      },
    });
    editor.applyStyle({ bold: true });
    const stored = editor.getDoc().document.blocks[1]
      .tableData!.rows[0].cells[0].blocks[0];
    expect(stored.inlines[0].style.bold).toBeUndefined();
    editor.dispose();
  });

  test('programmatic insertLink() does not insert text in read-only', () => {
    const { editor } = setupEditor([para('b1', 'hello world')], true);
    editor.insertLink('https://example.com');
    expect(bodyText(editor)).toBe('hello world');
    editor.dispose();
  });

  test('control: insertLink() DOES insert URL text when not read-only', () => {
    const { editor } = setupEditor([para('b1', 'hello world')], false);
    editor._setSelectionForTest({
      anchor: { blockId: 'b1', offset: 11 },
      focus: { blockId: 'b1', offset: 11 },
    });
    editor.insertLink('https://example.com');
    expect(bodyText(editor)).toContain('https://example.com');
    editor.dispose();
  });

  test('programmatic insertTable() does not add a table in read-only', () => {
    const { editor } = setupEditor([para('b1', 'hello world')], true);
    const before = editor.getDoc().document.blocks.length;
    editor.insertTable(2, 2);
    expect(editor.getDoc().document.blocks.length).toBe(before);
    editor.dispose();
  });

  test('control: insertTable() DOES add a table when not read-only', () => {
    const { editor } = setupEditor([para('b1', 'hello world')], false);
    const before = editor.getDoc().document.blocks.length;
    editor.insertTable(2, 2);
    expect(editor.getDoc().document.blocks.length).toBeGreaterThan(before);
    editor.dispose();
  });

  test('Shift+ArrowRight still extends the selection (navigation works)', () => {
    const { editor, textarea } = setupEditor([para('b1', 'hello world')], true);
    editor._setSelectionForTest({
      anchor: { blockId: 'b1', offset: 0 },
      focus: { blockId: 'b1', offset: 0 },
    });
    textarea.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'ArrowRight',
        shiftKey: true,
        bubbles: true,
        cancelable: true,
      }),
    );
    const sel = editor.getActiveSelection();
    expect(sel).not.toBeNull();
    expect(sel!.anchor.offset).toBe(0);
    expect(sel!.focus.offset).toBe(1);
    // Text is unchanged by navigation.
    expect(bodyText(editor)).toBe('hello world');
    editor.dispose();
  });
});

/**
 * The image-resize drag, driven through real pointer events.
 *
 * The CRDT write at the end of `handleImageResizeMouseUp` is guarded three
 * times over: `handleImageMouseDown` only arms the drag when editable,
 * `handleImageResizeMouseMove` returns early on `readOnly`, and the commit
 * itself returns early on `readOnly`. That redundancy is deliberate — the
 * client flag is the effective write boundary for an anonymous share link
 * whenever the Yorkie auth webhook is left in shadow mode — but it also means
 * no single-gate deletion is observable on its own.
 *
 * What these tests can and cannot pin, precisely:
 *
 * - The **arming** gate (`!readOnly` in `handleImageMouseDown`) is pinned
 *   individually: arming is visible in the canvas cursor, so a viewer's
 *   handle press setting a resize cursor turns a test red.
 * - The move and commit gates are **unreachable in read-only by
 *   construction**, and so cannot be pinned individually by any test: the
 *   arming branch is the only thing that ever assigns `imageResizeDrag`, and
 *   `readOnly` is fixed at `initialize()`, so a read-only editor can never
 *   enter either handler with a drag in flight. Deleting either one alone is
 *   unobservable because the gate above it already refused. This is an
 *   architecture fact, not a gap in the harness.
 * - What *is* pinned is the conjunction — "a viewer cannot resize an image"
 *   survives no matter which gates are removed together, since the size
 *   assertion below only goes green while at least one still stands.
 *
 * The editable control test is what keeps all of that non-vacuous: it proves
 * this exact gesture really does drive a resize, so a read-only assertion can
 * never pass merely because the pointer geometry stopped landing on a handle.
 */
describe('read-only image resize drag', () => {
  const IMAGE = { src: 'https://example.test/cat.png', width: 120, height: 80 };

  let originalRect: typeof Element.prototype.getBoundingClientRect;

  /**
   * jsdom reports every box as 0×0, which collapses the document layout and
   * leaves no image to hit. Give every element the page's own 816×1056 box:
   * the editor then picks scale 1 and `collectImageRects` lays the page out at
   * `x = 0`, so a client coordinate and a document coordinate are the same
   * number and the handle positions below are readable.
   */
  function installGeometryShim(): void {
    originalRect = Element.prototype.getBoundingClientRect;
    Element.prototype.getBoundingClientRect = function (): DOMRect {
      return {
        x: 0, y: 0, left: 0, top: 0, right: 816, bottom: 1056,
        width: 816, height: 1056, toJSON: () => ({}),
      } as DOMRect;
    };
  }

  function restoreGeometryShim(): void {
    Element.prototype.getBoundingClientRect = originalRect;
  }

  function imageBlock(): Block {
    return {
      id: 'b1',
      type: 'paragraph',
      // ORC — an image inline is exactly one character.
      inlines: [{ text: '￼', style: { image: { ...IMAGE } } }],
      style: EMPTY_BLOCK_STYLE,
    };
  }

  /**
   * Centre of the image's south-east resize handle, in client coordinates.
   *
   * Derived by scanning the mounted editor for every point that arms a drag:
   * the armed region spans `x ∈ [104, 228]`, `y ∈ [126, 212]`, and a handle
   * reaches `HANDLE_HALF + HANDLE_HIT_SLACK` = 8px in each direction, so the
   * image rect is `x ∈ [112, 220]`, `y ∈ [134, 204]` and its bottom-right
   * corner — where the `se` handle is centred — is (220, 204). The editable
   * control test re-proves this lands on a handle on every run.
   */
  const SE_HANDLE = { x: 220, y: 204 };

  /** Press the se handle, drag 40px down-right, release. */
  function dragSouthEast(container: HTMLElement): void {
    container.dispatchEvent(new MouseEvent('mousedown', {
      bubbles: true, cancelable: true, button: 0,
      clientX: SE_HANDLE.x, clientY: SE_HANDLE.y,
    }));
    document.dispatchEvent(new MouseEvent('mousemove', {
      bubbles: true, clientX: SE_HANDLE.x + 40, clientY: SE_HANDLE.y + 40,
    }));
    document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
  }

  /** Press the se handle and hold, so arming is observable before teardown. */
  function pressSouthEast(container: HTMLElement): void {
    container.dispatchEvent(new MouseEvent('mousedown', {
      bubbles: true, cancelable: true, button: 0,
      clientX: SE_HANDLE.x, clientY: SE_HANDLE.y,
    }));
  }

  /**
   * Arming is what puts a resize cursor on the canvas. The editor mounts more
   * than one canvas, so ask whether *any* of them took one rather than
   * depending on which.
   */
  function resizeCursorCount(container: HTMLElement): number {
    return [...container.querySelectorAll('canvas')]
      .filter((c) => (c as HTMLCanvasElement).style.cursor.endsWith('-resize'))
      .length;
  }

  function imageWidth(editor: EditorAPI): number | undefined {
    return editor.getSelectedImage()?.data.width;
  }

  beforeEach(() => {
    installCanvasShim();
    installGeometryShim();
    document.body.innerHTML = '';
  });

  afterEach(() => {
    restoreGeometryShim();
    document.body.innerHTML = '';
  });

  test('editable: dragging the se handle resizes the image', () => {
    // The control. Everything below asserts that a viewer gets *nothing* from
    // this gesture, which would also be true if the gesture had quietly
    // stopped reaching a handle at all.
    const { editor, container } = setupEditor([imageBlock()], false);
    editor.selectImageAt('b1', 0);
    expect(imageWidth(editor)).toBe(120);

    dragSouthEast(container);

    expect(imageWidth(editor)).toBeGreaterThan(120);
    editor.dispose();
  });

  test('editable: pressing the se handle arms the drag', () => {
    // The other half of the control: proves a resize cursor is an observable
    // signal of arming, so the read-only assertion on it is not vacuous.
    const { editor, container } = setupEditor([imageBlock()], false);
    editor.selectImageAt('b1', 0);

    pressSouthEast(container);

    expect(resizeCursorCount(container)).toBeGreaterThan(0);
    document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    editor.dispose();
  });

  test('read-only: pressing the se handle arms nothing', () => {
    // Pins the arming gate on its own: without `!readOnly` in
    // `handleImageMouseDown` the drag arms here and the cursor changes, even
    // though the two gates below it would still refuse the write.
    const { editor, container } = setupEditor([imageBlock()], true);
    editor.selectImageAt('b1', 0);

    pressSouthEast(container);

    expect(resizeCursorCount(container)).toBe(0);
    document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    editor.dispose();
  });

  test('read-only: dragging the se handle does not resize the image', () => {
    // Pins the conjunction of all three gates: green only while at least one
    // of them still refuses the write.
    const { editor, container } = setupEditor([imageBlock()], true);
    editor.selectImageAt('b1', 0);
    expect(imageWidth(editor)).toBe(120);

    dragSouthEast(container);

    expect(imageWidth(editor)).toBe(120);
    editor.dispose();
  });

  test('read-only: a viewer can still select an image by clicking it', () => {
    // The opening this PR made, pinned with the same real geometry: the click
    // that arms nothing must still select, or the read-only image copy has no
    // way in.
    const { editor, container } = setupEditor([imageBlock()], true);

    container.dispatchEvent(new MouseEvent('mousedown', {
      bubbles: true, cancelable: true, button: 0, clientX: 160, clientY: 170,
    }));

    expect(editor.getSelectedImage()?.data.src).toBe(IMAGE.src);
    expect(resizeCursorCount(container)).toBe(0);
    editor.dispose();
  });
});
