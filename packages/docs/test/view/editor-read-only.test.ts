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

  test('programmatic setPageSetup() does not change the page in read-only', () => {
    const { editor } = setupEditor([para('b1', 'hello world')], true);
    const before = editor.getPageSetup();
    editor.setPageSetup({
      ...before,
      margins: { ...before.margins, top: before.margins.top + 48 },
    });
    expect(editor.getPageSetup()).toEqual(before);
    editor.dispose();
  });

  test('setPageSetup() through getStore() does not change the page in read-only', () => {
    // Defence in depth over exactly one method, not a boundary: `getStore()`
    // returns a store whose `setPageSetup` behaves like the neutered
    // `EditorAPI.setPageSetup`, so the two doors to that single write agree.
    // Every other mutator on the handle still writes — see the next test.
    const { editor } = setupEditor([para('b1', 'hello world')], true);
    const before = editor.getPageSetup();
    editor.getStore().setPageSetup({
      ...before,
      margins: { ...before.margins, top: before.margins.top + 48 },
    });
    expect(editor.getPageSetup()).toEqual(before);
    expect(editor.getStore().getDocument().pageSetup).toBeUndefined();
    editor.dispose();
  });

  /**
   * Pins the *limit* of the wrapper above, so nothing here can be read as
   * read-only enforcement on the store handle. `getStore()` replaces
   * `setPageSetup` and nothing else: the other ~30 `DocStore` mutators forward
   * untouched, and so does the `Doc` from `getDoc()`. That bypass predates the
   * wrapper — on `main` neither accessor appears in `MUTATING_METHODS` — and
   * is tracked as issue #989.
   *
   * When #989 lands this test must fail. Invert it then; do not delete it.
   */
  test('getStore() is not a read-only boundary — only setPageSetup is guarded (#989)', () => {
    const { editor } = setupEditor([para('b1', 'hello world')], true);
    editor.getStore().insertText('b1', 5, '!!');
    // Read the store back, not `getDoc()`: the write lands in the store the
    // handle wraps, which is exactly the reach #989 is about.
    const stored = editor.getStore().getDocument().blocks[0];
    expect(getBlockText(stored)).toBe('hello!! world');
    editor.dispose();
  });

  test('programmatic pasteFormat() does not restyle in read-only', () => {
    const { editor } = setupEditor([para('b1', 'hello world')], true);
    editor._setSelectionForTest({
      anchor: { blockId: 'b1', offset: 0 },
      focus: { blockId: 'b1', offset: 5 },
    });
    editor.copyFormat();
    // Returns `false`, not `undefined`: a neutered method must not report a
    // write it did not make.
    expect(editor.pasteFormat()).toBe(false);
    expect(
      editor.getDoc().document.blocks[0].inlines.every((i) => !i.style.bold),
    ).toBe(true);
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
