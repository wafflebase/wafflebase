// @vitest-environment jsdom
/**
 * Issue #715 — a backward (right-to-left) selection parks the caret at the
 * range's *start*, where the caret walk resolves the run *preceding* the
 * selection. Anything that decides add-vs-remove from the caret therefore
 * inverts the wrong value: after clearing bold from a sub-range of a bold
 * run, re-applying bold was a permanent no-op.
 *
 * These tests pin the two halves of the fix at the engine level:
 *
 *  1. `getSelectionStyle()` really does report the preceding run for a
 *     backward selection while `getRangeStyleSummary()` reports the range —
 *     the premise the toolbar toggles rely on (the frontend component tests
 *     mock this disagreement; here it is produced by the real editor).
 *  2. The Cmd/Ctrl+B keyboard path decides from the range too, so keyboard
 *     and toolbar agree on the same selection.
 */
import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { MemDocStore } from '../../src/store/memory.js';
import { initialize, type EditorAPI } from '../../src/view/editor.js';
import { normalizeBlockStyle, generateBlockId } from '../../src/model/types.js';
import type { Block, TableCell, TableRow } from '../../src/model/types.js';

const EMPTY_BLOCK_STYLE = normalizeBlockStyle({});
const BLOCK_ID = 'b1';

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
          width: w, height: h,
        });
      }
      if (prop === 'createLinearGradient' || prop === 'createRadialGradient' ||
          prop === 'createPattern') {
        return () => ({ addColorStop: () => {} });
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

/**
 * One paragraph, two runs: `head` (styled per `headBold`) then `tail`.
 * "ab" occupies offsets [0, 2), "cd" offsets [2, 4).
 */
function setupEditor(
  headBold: boolean,
  tailBold: boolean,
): { editor: EditorAPI; store: MemDocStore; container: HTMLElement } {
  const blocks: Block[] = [
    {
      id: BLOCK_ID,
      type: 'paragraph',
      inlines: [
        { text: 'ab', style: headBold ? { bold: true } : {} },
        { text: 'cd', style: tailBold ? { bold: true } : {} },
      ],
      style: EMPTY_BLOCK_STYLE,
    },
  ];
  const store = new MemDocStore();
  store.setDocument({ blocks });
  const container = document.createElement('div');
  document.body.appendChild(container);
  const editor = initialize(container, store);
  return { editor, store, container };
}

/** Select "cd" right-to-left: anchor at the end, focus (caret) at the start. */
function selectTailBackward(editor: EditorAPI): void {
  editor._setSelectionForTest({
    anchor: { blockId: BLOCK_ID, offset: 4 },
    focus: { blockId: BLOCK_ID, offset: 2 },
  });
}

function dispatchKey(container: HTMLElement, key: string): void {
  const textarea = container.querySelector('textarea');
  if (!textarea) throw new Error('textarea not mounted');
  textarea.dispatchEvent(
    new KeyboardEvent('keydown', {
      key,
      metaKey: true,
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    }),
  );
}

/** Is every character of "cd" bold in the stored document? */
function tailIsBold(store: MemDocStore): boolean {
  const inlines = store.getDocument().blocks[0].inlines;
  let pos = 0;
  let sawRun = false;
  let allBold = true;
  for (const inline of inlines) {
    const end = pos + inline.text.length;
    if (inline.text.length > 0 && end > 2 && pos < 4) {
      sawRun = true;
      if (!inline.style.bold) allBold = false;
    }
    pos = end;
  }
  return sawRun && allBold;
}

describe('backward selection style resolution (issue #715)', () => {
  beforeEach(() => {
    installCanvasShim();
    document.body.innerHTML = '';
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  test('caret style reports the preceding run while the summary reports the range', () => {
    const { editor } = setupEditor(true, false);
    selectTailBackward(editor);

    // The caret sits at offset 2 — the boundary — and resolves the bold
    // run before the selection. This is the trap the toggles used to fall
    // into, reproduced here by the real editor rather than a mock.
    expect(editor.getSelectionStyle().bold).toBe(true);
    // The range summary looks at the selected runs only: "cd" is not bold.
    expect(editor.getRangeStyleSummary().bold).not.toBe(true);

    editor.dispose();
  });

  test('the summary still reads true when the backward range is uniformly bold', () => {
    const { editor } = setupEditor(false, true);
    selectTailBackward(editor);

    expect(editor.getSelectionStyle().bold).not.toBe(true);
    expect(editor.getRangeStyleSummary().bold).toBe(true);

    editor.dispose();
  });

  test('Cmd+B on a backward, unstyled range applies bold (was a silent no-op)', () => {
    const { editor, store, container } = setupEditor(true, false);
    selectTailBackward(editor);

    dispatchKey(container, 'b');

    expect(tailIsBold(store)).toBe(true);
    editor.dispose();
  });

  test('Cmd+B on a backward, uniformly bold range removes bold', () => {
    const { editor, store, container } = setupEditor(false, true);
    selectTailBackward(editor);

    dispatchKey(container, 'b');

    expect(tailIsBold(store)).toBe(false);
    editor.dispose();
  });

  test('Cmd+B on a forward range still toggles from the range', () => {
    const { editor, store, container } = setupEditor(true, true);
    editor._setSelectionForTest({
      anchor: { blockId: BLOCK_ID, offset: 2 },
      focus: { blockId: BLOCK_ID, offset: 4 },
    });

    dispatchKey(container, 'b');

    expect(tailIsBold(store)).toBe(false);
    editor.dispose();
  });
});

/**
 * The keyboard path and the toolbar must read the *same* effective style —
 * including the named-style inline defaults the renderer paints. Built-in
 * Heading 6 is italic, so a plain run inside one renders italic while its
 * `inline.style` carries nothing. A keyboard read of the raw run style would
 * answer "not italic" and Cmd+I would re-apply italic (a visual no-op), while
 * the toolbar's summary answered "italic" and removed it — the disagreement
 * issue #715 set out to end.
 */
describe('named-style inline defaults in the range read (issue #715)', () => {
  beforeEach(() => {
    installCanvasShim();
    document.body.innerHTML = '';
  });
  afterEach(() => {
    document.body.innerHTML = '';
  });

  function setupHeading6(): {
    editor: EditorAPI;
    store: MemDocStore;
    container: HTMLElement;
  } {
    const blocks: Block[] = [
      {
        id: BLOCK_ID,
        type: 'heading',
        headingLevel: 6,
        inlines: [{ text: 'abcd', style: {} }],
        style: EMPTY_BLOCK_STYLE,
      },
    ];
    const store = new MemDocStore();
    store.setDocument({ blocks });
    const container = document.createElement('div');
    document.body.appendChild(container);
    const editor = initialize(container, store);
    return { editor, store, container };
  }

  function selectAll(editor: EditorAPI): void {
    editor._setSelectionForTest({
      anchor: { blockId: BLOCK_ID, offset: 0 },
      focus: { blockId: BLOCK_ID, offset: 4 },
    });
  }

  test('the summary reports the style-provided italic', () => {
    const { editor } = setupHeading6();
    selectAll(editor);

    expect(editor.getRangeStyleSummary().italic).toBe(true);

    editor.dispose();
  });

  test('Cmd+I removes the style-provided italic instead of re-applying it', () => {
    const { editor, store, container } = setupHeading6();
    selectAll(editor);

    dispatchKey(container, 'i');

    // The keyboard must reach the same verdict the toolbar does: italic is
    // already on, so the press writes an explicit `italic: false` override.
    for (const inline of store.getDocument().blocks[0].inlines) {
      expect(inline.style.italic).toBe(false);
    }
    editor.dispose();
  });

  test('Cmd+B still adds bold in the same block (defaults set no bold)', () => {
    const { editor, store, container } = setupHeading6();
    selectAll(editor);

    dispatchKey(container, 'b');

    for (const inline of store.getDocument().blocks[0].inlines) {
      expect(inline.style.bold).toBe(true);
    }
    editor.dispose();
  });
});

/**
 * A multi-block selection inside a *header/footer* table cell used to fall
 * through `getRangeStyleSummary`'s body-only `layout.blockParentMap` lookup
 * and return an empty summary, so the slim header/footer B/I/U toggles could
 * only ever add a style, never remove it (and disagreed with the keyboard,
 * which resolves cells through the active layout).
 */
describe('header table cell range summary (issue #715)', () => {
  const editors: EditorAPI[] = [];
  beforeEach(() => {
    installCanvasShim();
    document.body.innerHTML = '';
  });
  afterEach(() => {
    for (const editor of editors.splice(0)) editor.dispose();
    document.body.innerHTML = '';
  });

  /** A header table whose first cell holds two bold paragraphs. */
  function setup(): {
    editor: EditorAPI;
    table: Block;
    container: HTMLElement;
    store: MemDocStore;
  } {
    const boldPara = (text: string): Block => ({
      id: generateBlockId(),
      type: 'paragraph',
      inlines: [{ text, style: { bold: true } }],
      style: EMPTY_BLOCK_STYLE,
    });
    const twoBlockCell: TableCell = {
      blocks: [boldPara('one'), boldPara('two')],
      style: {},
    };
    const rows: TableRow[] = [
      { cells: [twoBlockCell, { blocks: [boldPara('right')], style: {} }] },
    ];
    const table: Block = {
      id: generateBlockId(),
      type: 'table',
      inlines: [],
      style: EMPTY_BLOCK_STYLE,
      tableData: { rows, columnWidths: [0.5, 0.5] },
    };
    const store = new MemDocStore();
    store.setDocument({
      blocks: [
        {
          id: BLOCK_ID,
          type: 'paragraph',
          inlines: [{ text: 'body', style: {} }],
          style: EMPTY_BLOCK_STYLE,
        },
      ],
      header: { blocks: [table], marginFromEdge: 48 },
    });
    const container = document.createElement('div');
    document.body.appendChild(container);
    const editor = initialize(container, store);
    editors.push(editor);
    return { editor, table, container, store };
  }

  /** The stored (post-edit) blocks of the header table's first cell. */
  function storedCellBlocks(store: MemDocStore): Block[] {
    const headerTable = store.getDocument().header!.blocks[0];
    return headerTable.tableData!.rows[0].cells[0].blocks;
  }

  test('a selection spanning two blocks of a header cell reports bold', () => {
    const { editor, table } = setup();
    const cellBlocks = table.tableData!.rows[0].cells[0].blocks;
    editor._setEditContextForTest('header');
    editor._setSelectionForTest({
      anchor: { blockId: cellBlocks[0].id, offset: 0 },
      focus: { blockId: cellBlocks[1].id, offset: 3 },
    });

    // Empty before the fix — the toggle could only add bold, never remove it.
    expect(editor.getRangeStyleSummary().bold).toBe(true);
  });

  test('a backward selection across the same two blocks reports bold too', () => {
    const { editor, table } = setup();
    const cellBlocks = table.tableData!.rows[0].cells[0].blocks;
    editor._setEditContextForTest('header');
    editor._setSelectionForTest({
      anchor: { blockId: cellBlocks[1].id, offset: 3 },
      focus: { blockId: cellBlocks[0].id, offset: 0 },
    });

    expect(editor.getRangeStyleSummary().bold).toBe(true);
  });

  test('Cmd+B on that selection removes bold from both blocks', () => {
    const { editor, table, container, store } = setup();
    const cellBlocks = table.tableData!.rows[0].cells[0].blocks;
    editor._setEditContextForTest('header');
    editor._setSelectionForTest({
      anchor: { blockId: cellBlocks[0].id, offset: 0 },
      focus: { blockId: cellBlocks[1].id, offset: 3 },
    });

    dispatchKey(container, 'b');

    // Keyboard and toolbar now read the same runs, so both turn bold off.
    for (const block of storedCellBlocks(store)) {
      for (const inline of block.inlines) {
        expect(inline.style.bold).toBe(false);
      }
    }
  });
});
