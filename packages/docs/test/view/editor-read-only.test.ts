// @vitest-environment jsdom
import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { MemDocStore } from '../../src/store/memory.js';
import { initialize, type EditorAPI } from '../../src/view/editor.js';
import { Doc } from '../../src/model/document.js';
import { Cursor } from '../../src/view/cursor.js';
import { Selection } from '../../src/view/selection.js';
import { TextEditor } from '../../src/view/text-editor.js';
import type { DocumentLayout } from '../../src/view/layout.js';
import type { PaginatedLayout } from '../../src/view/pagination.js';
import type { TextMeasurer } from '../../src/view/measurer.js';
import { createTableBlock, getBlockText, normalizeBlockStyle } from '../../src/model/types.js';
import type { Block } from '../../src/model/types.js';
import type { DocStore } from '../../src/store/store.js';

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

/**
 * `TextEditor` is exported from the package root, so `initialize()`'s
 * `MUTATING_METHODS` allowlist is not the only thing standing between a
 * read-only mount and a write — anything holding the instance can call a
 * mutator on it directly. Every other programmatic mutator on the class
 * (`insertText()` is the model) carries its own `readOnly` guard for that
 * reason; `pasteFormat()` is tested here against the class, not the API.
 */
describe('TextEditor.pasteFormat() read-only guard', () => {
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

  /**
   * A bare `TextEditor` over two paragraphs. Only the collaborators
   * `copyFormat` / `pasteFormat` actually touch are real. `copyFormat` reads
   * the layout to resolve which end of the selection the format comes from
   * (a backward drag picks up the first *highlighted* character, not the
   * caret), so the block layout is stubbed with just the two blocks it walks;
   * the paginated layout and the measurer stay unreachable, since the write
   * itself goes through `Doc` and reads no geometry.
   */
  function bareTextEditor(readOnly: boolean) {
    const store = new MemDocStore();
    store.setDocument({
      blocks: [
        {
          id: 'source',
          type: 'paragraph',
          inlines: [{ text: 'styled', style: { bold: true } }],
          style: EMPTY_BLOCK_STYLE,
        },
        para('target', 'plain'),
      ],
    });
    const doc = new Doc(store);
    const cursor = new Cursor('source', 0);
    const selection = new Selection();
    const container = document.createElement('div');
    document.body.appendChild(container);
    const unreached = () => {
      throw new Error('layout should not be read on the format-painter path');
    };
    // `copyFormat` resolves the selection's start through the block layout;
    // with no range set it falls back to the caret, so an empty layout is
    // enough. The paginated layout and the measurer stay unreachable — the
    // write goes through `Doc` and touches no geometry.
    const blockLayout = () =>
      ({ blocks: [], blockParentMap: new Map() }) as unknown as DocumentLayout;
    const snapshots: number[] = [];
    const textEditor = new TextEditor(
      container,
      doc,
      cursor,
      selection,
      blockLayout,
      unreached as unknown as () => PaginatedLayout,
      unreached as unknown as () => TextMeasurer,
      () => 800,
      () => 1,
      () => 0,
      () => {},
      () => snapshots.push(1),
      () => {},
      () => {},
      () => {},
      () => {},
      undefined,
      undefined,
      readOnly,
    );
    const targetStyle = () => doc.document.blocks[1].inlines[0].style;
    return { textEditor, selection, snapshots, targetStyle };
  }

  function pickUpAndPaste(readOnly: boolean) {
    const ctx = bareTextEditor(readOnly);
    ctx.textEditor.copyFormat();
    ctx.selection.setRange({
      anchor: { blockId: 'target', offset: 0 },
      focus: { blockId: 'target', offset: 5 },
    });
    const applied = ctx.textEditor.pasteFormat();
    return { ...ctx, applied };
  }

  test('reports no write, writes nothing, and takes no snapshot', () => {
    const { applied, targetStyle, snapshots } = pickUpAndPaste(true);

    expect(applied).toBe(false);
    expect(targetStyle().bold).toBeUndefined();
    // A snapshot with no write behind it would cost an empty undo step.
    expect(snapshots).toHaveLength(0);
  });

  test('control: the same call DOES restyle when not read-only', () => {
    const { applied, targetStyle, snapshots } = pickUpAndPaste(false);

    expect(applied).toBe(true);
    expect(targetStyle().bold).toBe(true);
    expect(snapshots).toHaveLength(1);
  });
});

/**
 * The two accessors that hand out live handles (issue #989).
 *
 * `MUTATING_METHODS` neuters members of `EditorAPI` itself, which a store
 * handle simply walks around: `getStore()` returns a `DocStore` and
 * `getDoc()` a `Doc` whose ~30 mutators all delegate to one. Under
 * `readOnly` both are now backed by `readOnlyDocStore`, so these pin that the
 * document behind them is untouched — and, just as importantly, that reads
 * through them still work, since a viewer needs `getDoc().refresh()` to see
 * peer edits at all.
 */
describe('read-only store and doc handles', () => {
  beforeEach(() => {
    installCanvasShim();
    document.body.innerHTML = String();
  });
  afterEach(() => {
    document.body.innerHTML = String();
    HTMLCanvasElement.prototype.getContext = originalGetContext;
    if (originalResizeObserver === undefined) {
      delete (globalThis as { ResizeObserver?: unknown }).ResizeObserver;
    } else {
      (globalThis as { ResizeObserver?: unknown }).ResizeObserver = originalResizeObserver;
    }
  });

  function mount(readOnly: boolean): {
    editor: EditorAPI;
    store: MemDocStore;
    text: () => string;
  } {
    const store = new MemDocStore();
    store.setDocument({
      blocks: [
        {
          id: 'b1',
          type: 'paragraph',
          inlines: [{ text: 'hello', style: {} }],
          style: EMPTY_BLOCK_STYLE,
        },
      ],
    });
    const container = document.createElement('div');
    document.body.appendChild(container);
    const editor = initialize(container, store, undefined, readOnly);
    const text = () => getBlockText(store.getDocument().blocks[0]);
    return { editor, store, text };
  }

  test('getStore() mutators write nothing', () => {
    const { editor, store, text } = mount(true);

    editor.getStore().insertText('b1', 5, ' world');
    editor.getStore().deleteText('b1', 0, 2);
    editor.getStore().applyStyle('b1', 0, 5, { bold: true });
    editor.getStore().setDocument({ blocks: [] });
    editor.getStore().deleteBlock('b1');
    editor.getStore().undo();

    expect(text()).toBe('hello');
    expect(store.getDocument().blocks).toHaveLength(1);
    expect(store.getDocument().blocks[0].inlines[0].style.bold).toBeUndefined();
  });

  test('getDoc() mutators write nothing', () => {
    const { editor, store, text } = mount(true);

    editor.getDoc().insertText({ blockId: 'b1', offset: 5 }, ' world');
    editor.getDoc().deleteText({ blockId: 'b1', offset: 0 }, 2);
    editor.getDoc().applyInlineStyle(
      { anchor: { blockId: 'b1', offset: 0 }, focus: { blockId: 'b1', offset: 5 } },
      { bold: true },
    );

    expect(text()).toBe('hello');
    expect(store.getDocument().blocks[0].inlines[0].style.bold).toBeUndefined();
  });

  // `Doc.store` is `private` only to TypeScript — it is an ordinary property
  // at runtime, and the whole point of neutering the store the `Doc` holds
  // (rather than the `Doc`) is that reaching it buys nothing.
  test('the store reached through getDoc() is the neutered one', () => {
    const { editor, text } = mount(true);

    const inner = (editor.getDoc() as unknown as { store: DocStore }).store;
    inner.insertText('b1', 5, ' world');

    expect(text()).toBe('hello');
  });

  // A `get`/`set`-only proxy is reachable this way: `YorkieDocStore`'s
  // methods live on its class prototype, so `getPrototypeOf(store).m.call(
  // store, …)` would hit the target untouched.
  test('the prototype is not a way around it', () => {
    const { editor, text } = mount(true);

    expect(Object.getPrototypeOf(editor.getStore())).toBeNull();
    expect(() => { (editor.getStore() as unknown as Record<string, unknown>).insertText = () => {}; })
      .toThrow(TypeError);
    expect(() => Object.defineProperty(editor.getStore(), 'insertText', {
      value: () => {},
    })).toThrow(TypeError);

    expect(text()).toBe('hello');
  });

  // Hiding the methods is not enough on its own. Both implementations keep
  // their live state in an own *field*: `MemDocStore.doc` is the internal
  // `Document`, and `YorkieDocStore.doc` is the CRDT handle whose
  // `update()` is the documented write path. A `get` trap that forwarded
  // data properties would leave a wider hole than the prototype one, and
  // reachable without a method call at all.
  test('the live internal state is not reachable as a property', () => {
    const { editor, store, text } = mount(true);

    const handle = editor.getStore() as unknown as Record<string, unknown>;
    expect(handle.doc).toBeUndefined();
    expect(handle.undoStack).toBeUndefined();

    // A descriptor read carries the value with it, and enumeration happens
    // before the read for spread / `Object.keys` / `structuredClone`.
    expect(Object.keys(handle)).toEqual([]);
    expect(Object.getOwnPropertyDescriptor(handle, 'doc')).toBeUndefined();
    expect({ ...handle }).toEqual({});

    expect(text()).toBe('hello');
    expect(store.getDocument().blocks).toHaveLength(1);
  });
  // Reporting a null prototype is not the same as refusing to be given
  // one. An untrapped `setPrototypeOf` forwards to the target, and then an
  // accessor planted on the chain runs with `this` bound to the real store
  // — a complete escape that leaves every published assertion still
  // passing, since the handle keeps reporting a null prototype afterwards.
  test('a prototype cannot be planted to recover the raw store', () => {
    const { editor, store, text } = mount(true);
    const handle = editor.getStore();

    let stolen: unknown;
    expect(() =>
      Object.setPrototypeOf(handle, {
        get probe() {
          stolen = this;
          return undefined;
        },
      }),
    ).toThrow(TypeError);
    void (handle as unknown as Record<string, unknown>).probe;

    expect(stolen).toBeUndefined();
    expect(Object.getPrototypeOf(store)).not.toBeNull();
    expect(text()).toBe('hello');
  });

  // `Object.freeze` runs `preventExtensions` first, so an untrapped one
  // makes the real store non-extensible — and from then on the hiding
  // traps violate a proxy invariant and every enumeration throws.
  test('the handle cannot make the underlying store non-extensible', () => {
    const { editor, store } = mount(true);
    const handle = editor.getStore();

    expect(() => Object.preventExtensions(handle)).toThrow(TypeError);
    expect(Object.isExtensible(store)).toBe(true);
    // Still usable afterwards: the invariant was never broken.
    expect(Object.keys(handle)).toEqual([]);
    expect(handle.getPageSetup()).toBeDefined();
  });

  // `in` does not consult `ownKeys`, so it needs its own trap to agree
  // with what `get` hands back.
  test('`in` reports what get will actually return', () => {
    const handle = mount(true).editor.getStore();

    expect('doc' in handle).toBe(false);
    expect('undoStack' in handle).toBe(false);
    expect('getDocument' in handle).toBe(true);
    // A mutator is still present — it is neutered, not absent, so a
    // feature detection followed by a call behaves consistently.
    expect('insertText' in handle).toBe(true);
  });
  // Reads are the reason the accessors exist at all, so they must survive.
  test('reads through both handles still work', () => {
    const { editor } = mount(true);

    expect(getBlockText(editor.getStore().getDocument().blocks[0])).toBe('hello');
    expect(editor.getStore().getBlock('b1')).toBeDefined();
    expect(editor.getStore().getPageSetup()).toBeDefined();
    expect(editor.getStore().canUndo()).toBe(false);
    expect(getBlockText(editor.getDoc().document.blocks[0])).toBe('hello');
    // What `docs-view` calls on every remote change; a viewer that loses it
    // stops seeing peer edits.
    expect(() => editor.getDoc().refresh()).not.toThrow();
  });

  // `batch(fn)` groups writes into one undo unit; it is not itself a write.
  // A bare no-op would swallow the body, so a viewer batching *reads* would
  // silently get none of them.
  test('batch runs its body, and the writes inside it are still dead', () => {
    const { editor, store, text } = mount(true);

    let ran = false;
    editor.getStore().batch(() => {
      ran = true;
      expect(store.getDocument().blocks).toHaveLength(1);
      editor.getStore().insertText('b1', 5, '!');
    });

    expect(ran).toBe(true);
    expect(text()).toBe('hello');
  });

  // `initialize` seeds an empty store with one paragraph so the editor has
  // something to render. That predates the read-only work and ran before the
  // guard existed, so a viewer wrote to the shared store — and `setDocument`
  // replaces the whole tree with `Doc.create()`'s output, which has no
  // header, no footer and no named styles. A viewer could destroy all three
  // for every collaborator, in a change they could not undo.
  //
  // A zero-block document is unreachable by typing but reachable through the
  // non-interactive writers (a DOCX with no paragraph in its body, and
  // `PUT /api/v1/.../content`, which accepts `blocks: []`).
  test('a read-only mount does not seed an empty store', () => {
    const store = new MemDocStore();
    store.setDocument({ blocks: [] });
    store.setHeader({
      blocks: [{ id: 'h1', type: 'paragraph', inlines: [{ text: 'confidential', style: {} }], style: EMPTY_BLOCK_STYLE }],
      marginFromEdge: 48,
    });
    const container = document.createElement('div');
    document.body.appendChild(container);

    expect(() => initialize(container, store, undefined, true)).not.toThrow();

    // Nothing written, and the header the placeholder would have dropped is
    // still there.
    expect(store.getDocument().blocks).toHaveLength(0);
    expect(getBlockText(store.getHeader()!.blocks[0])).toBe('confidential');
  });

  test('control: an editable mount still seeds an empty store', () => {
    const store = new MemDocStore();
    store.setDocument({ blocks: [] });
    const container = document.createElement('div');
    document.body.appendChild(container);

    initialize(container, store, undefined, false);

    expect(store.getDocument().blocks).toHaveLength(1);
  });
  test('control: the same calls DO write when not read-only', () => {
    const { editor, text } = mount(false);

    editor.getStore().insertText('b1', 5, ' world');
    expect(text()).toBe('hello world');

    editor.getDoc().insertText({ blockId: 'b1', offset: 11 }, '!');
    expect(text()).toBe('hello world!');

    expect(Object.getPrototypeOf(editor.getStore())).not.toBeNull();
  });
});
