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
