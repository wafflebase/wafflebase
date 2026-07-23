// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { MemDocStore } from '../../src/store/memory.js';
import { initialize, type EditorAPI } from '../../src/view/editor.js';
import { createEmptyBlock, createTableBlock } from '../../src/model/types.js';
import type { Block } from '../../src/model/types.js';

/**
 * Link handling inside Docs table cells.
 *
 * Cells are `Block[]` mini-documents sharing the top-level editing
 * pipeline, so `Doc.getBlock` / `applyInlineStyle` / auto-link detection
 * are all cell-aware at the low level. The gaps were higher up:
 *
 * - `handleEnter`'s table-cell branch returned early WITHOUT calling
 *   `tryAutoLinkBeforeCursor`, so a URL finished with Enter inside a cell
 *   never auto-linked (the top-level branch does call it). Fixed by adding
 *   the call to the cell branch.
 * - The Space auto-link path (`handleInput`) was never guarded, so it
 *   already worked in cells — covered here as a non-regression guard.
 * - The trailing-edge exit already worked in cells (the full editor wires
 *   `pending`, and the cell branch already called
 *   `exitLinkIfAtTrailingEdge`) — covered here to lock it in.
 */
function installCanvasShim(): void {
  const ctxHandler: ProxyHandler<object> = {
    get(_t, prop) {
      if (prop === 'measureText') {
        return (text: string) => ({
          width: typeof text === 'string' ? text.length * 6 : 0,
          actualBoundingBoxAscent: 8,
          actualBoundingBoxDescent: 2,
        });
      }
      if (prop === 'getImageData') {
        return (_x: number, _y: number, w: number, h: number) => ({
          data: new Uint8ClampedArray(Math.max(0, w) * Math.max(0, h) * 4),
          width: w,
          height: h,
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
  (HTMLCanvasElement.prototype as unknown as { getContext: (k: string) => unknown }).getContext =
    (kind: string) => (kind === '2d' ? fakeCtx : null);
  (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  };
}

describe('docs table cells — hyperlink recognition & trailing-edge exit', () => {
  const editors: EditorAPI[] = [];
  let container: HTMLElement;

  beforeEach(() => {
    installCanvasShim();
    document.body.innerHTML = '';
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    for (const editor of editors.splice(0)) editor.dispose();
    document.body.innerHTML = '';
  });

  function setup(): { editor: EditorAPI; table: Block } {
    const store = new MemDocStore();
    const table = createTableBlock(2, 2);
    store.setDocument({ blocks: [table, createEmptyBlock()] });
    const editor = initialize(container, store);
    editors.push(editor);
    return { editor, table };
  }

  function textarea(): HTMLTextAreaElement {
    const el = container.querySelector('textarea');
    if (!el) throw new Error('textarea not mounted');
    return el;
  }
  function type(text: string): void {
    const ta = textarea();
    ta.value = text;
    ta.dispatchEvent(new Event('input', { bubbles: true }));
  }
  function pressEnter(): void {
    textarea().dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }),
    );
  }

  /** The live first-cell blocks after mutations (re-read from the store). */
  function firstCellBlocks(editor: EditorAPI): Block[] {
    return editor.getDoc().document.blocks[0].tableData!.rows[0].cells[0].blocks;
  }
  function cellBlockId(table: Block, r: number, c: number): string {
    return table.tableData!.rows[r].cells[c].blocks[0].id;
  }
  function hrefsIn(blocks: Block[]): (string | undefined)[] {
    return blocks.flatMap((b) => b.inlines.map((i) => i.style.href));
  }

  it('auto-links a URL finished with Enter inside a cell (regression for #495 follow-up)', () => {
    const { editor, table } = setup();
    editor.restoreLocalCursor({ blockId: cellBlockId(table, 0, 0), offset: 0 }, null);
    type('https://example.com');
    pressEnter();

    // The URL run stays in the cell's first sub-block and is now linked.
    const linked = firstCellBlocks(editor)
      .flatMap((b) => b.inlines)
      .find((i) => i.text.includes('example.com'));
    expect(linked?.style.href).toBe('https://example.com');
  });

  it('auto-links a URL followed by Space inside a cell (non-regression guard)', () => {
    const { editor, table } = setup();
    editor.restoreLocalCursor({ blockId: cellBlockId(table, 0, 0), offset: 0 }, null);
    type('https://example.com');
    type(' ');

    const inlines = firstCellBlocks(editor).flatMap((b) => b.inlines);
    const linked = inlines.find((i) => i.text.includes('example.com'));
    expect(linked?.style.href).toBe('https://example.com');
    // The trailing space must NOT inherit the link.
    const spaceRun = inlines.find((i) => i.text.endsWith(' ') && !i.text.includes('example'));
    if (spaceRun) expect(spaceRun.style.href).toBeFalsy();
  });

  it('pressing Enter after an auto-linked URL starts a plain new cell block (trailing edge)', () => {
    const { editor, table } = setup();
    editor.restoreLocalCursor({ blockId: cellBlockId(table, 0, 0), offset: 0 }, null);
    // First Enter auto-links the URL and splits within the cell.
    type('https://example.com');
    pressEnter();
    // Now type into the freshly-created cell sub-block; it must be plain.
    type('plain');

    const inlines = firstCellBlocks(editor).flatMap((b) => b.inlines);
    const plainRun = inlines.find((i) => i.text.includes('plain'));
    expect(plainRun).toBeDefined();
    expect(plainRun?.style.href).toBeFalsy();
  });

  it('manual insertLink at a collapsed caret (no selection) links only the target cell', () => {
    const { editor, table } = setup();
    editor.restoreLocalCursor({ blockId: cellBlockId(table, 0, 0), offset: 0 }, null);
    editor.insertLink('https://example.com');

    // Target cell got the link.
    expect(hrefsIn(firstCellBlocks(editor))).toContain('https://example.com');
    // A different cell is untouched.
    const otherCell = editor.getDoc().document.blocks[0].tableData!.rows[1].cells[1].blocks;
    expect(hrefsIn(otherCell).every((h) => !h)).toBe(true);
  });

  it('manual insertLink over an in-cell text selection links that run only (selection branch)', () => {
    // Exercises the rewritten selection branch: a range whose endpoints are
    // cell blocks resolves via blockParentMap (getBlockIndex returns -1 for
    // cell blocks), and the href must land on the selected run in that cell
    // without leaking into other cells.
    const { editor, table } = setup();
    const c00 = cellBlockId(table, 0, 0);
    editor.restoreLocalCursor({ blockId: c00, offset: 0 }, null);
    type('clickme');
    // Select the whole word inside the cell, then link it.
    editor._setSelectionForTest({
      anchor: { blockId: c00, offset: 0 },
      focus: { blockId: c00, offset: 'clickme'.length },
    });
    editor.insertLink('https://example.com');

    // The selected run in the target cell is now linked.
    const linked = firstCellBlocks(editor)
      .flatMap((b) => b.inlines)
      .find((i) => i.text.includes('clickme'));
    expect(linked?.style.href).toBe('https://example.com');
    // Other cells remain unlinked (no over-application across the table).
    const otherCell = editor.getDoc().document.blocks[0].tableData!.rows[1].cells[1].blocks;
    expect(hrefsIn(otherCell).every((h) => !h)).toBe(true);
  });
});
