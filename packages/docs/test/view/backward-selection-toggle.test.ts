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

function dispatchKey(
  container: HTMLElement,
  key: string,
  modifiers: { altKey?: boolean; shiftKey?: boolean } = {},
): void {
  const textarea = container.querySelector('textarea');
  if (!textarea) throw new Error('textarea not mounted');
  textarea.dispatchEvent(
    new KeyboardEvent('keydown', {
      key,
      metaKey: true,
      ctrlKey: true,
      altKey: modifiers.altKey ?? false,
      shiftKey: modifiers.shiftKey ?? false,
      bubbles: true,
      cancelable: true,
    }),
  );
}

/** Type one character at the caret, so any pending style is consumed. */
function typeChar(container: HTMLElement, char: string): void {
  const textarea = container.querySelector('textarea');
  if (!textarea) throw new Error('textarea not mounted');
  textarea.value = char;
  textarea.dispatchEvent(new Event('input', { bubbles: true }));
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

  /**
   * The *collapsed caret* half of the same fix. `isStyleOnInSelection`
   * returns `undefined` without a selection, so this is the only path that
   * exercises the named-style default layer at the caret
   * (`styleDefaultsAtCursor`): without it, Cmd+I inside a Heading 6 computed
   * `!false` and staged `italic: true` — a pending style the renderer could
   * never show, and the opposite verdict from the toolbar's summary.
   */
  function placeCaret(editor: EditorAPI, offset: number): void {
    // A degenerate range is not a selection (`hasSelection()` is false) but
    // still moves the caret, so this is the collapsed-caret path.
    editor._setSelectionForTest({
      anchor: { blockId: BLOCK_ID, offset },
      focus: { blockId: BLOCK_ID, offset },
    });
  }

  test('Cmd+I at a collapsed caret stages italic OFF, not on', () => {
    const { editor, container } = setupHeading6();
    placeCaret(editor, 2);

    dispatchKey(container, 'i');

    // The pending style layered over the caret style — the state the toolbar
    // reads back and the next typed run inherits.
    expect(editor.getSelectionStyle().italic).toBe(false);
    expect(editor.getRangeStyleSummary().italic).toBe(false);
    editor.dispose();
  });

  test('Cmd+B at a collapsed caret still stages bold ON', () => {
    const { editor, container } = setupHeading6();
    placeCaret(editor, 2);

    dispatchKey(container, 'b');

    // The heading's named style sets italic, not bold, so the same layer
    // must leave bold's add-vs-remove decision alone.
    expect(editor.getSelectionStyle().bold).toBe(true);
    editor.dispose();
  });

  /**
   * The stated invariant behind keeping `visual` raw: the *decision* layers
   * the named-style defaults in, but what gets *stored* must not, or the run
   * stops tracking the style when it is later redefined.
   */
  test('the staged pending style stays raw — no baked heading defaults', () => {
    const { editor, store, container } = setupHeading6();
    placeCaret(editor, 2);

    dispatchKey(container, 'i');
    typeChar(container, 'X');

    const inlines = store.getDocument().blocks[0].inlines;
    const typed = inlines.find((inline) => inline.text.includes('X'));
    expect(typed).toBeDefined();
    // The toggle's own key is written explicitly...
    expect(typed!.style.italic).toBe(false);
    // ...but nothing the Heading 6 named style merely supplies is.
    expect(typed!.style.fontSize).toBeUndefined();
    expect(typed!.style.fontFamily).toBeUndefined();
    expect(typed!.style.bold).toBeUndefined();
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
    // Turning it off clears the key rather than storing `false` (#749).
    for (const block of storedCellBlocks(store)) {
      for (const inline of block.inlines) {
        expect('bold' in inline.style).toBe(false);
      }
    }
  });
});

/**
 * The shared traversal (`visitRangeSlices`, which the summary read and
 * `Doc.applyInlineStyle`'s write both drive) normalizes an endpoint that
 * lives inside a table cell to its parent *table* block before indexing the
 * context blocks. Before that, a selection whose endpoints sat in two
 * different cells (or one in a cell and one in the body) failed
 * `getBlockIndex` and produced an empty summary, so the toggles could only
 * ever add a style. A table caught inside such a selection is covered whole.
 */
describe('cell endpoints normalize to the parent table (issue #715)', () => {
  const editors: EditorAPI[] = [];
  beforeEach(() => {
    installCanvasShim();
    document.body.innerHTML = '';
  });
  afterEach(() => {
    for (const editor of editors.splice(0)) editor.dispose();
    document.body.innerHTML = '';
  });

  const para = (text: string, style: Record<string, boolean>): Block => ({
    id: generateBlockId(),
    type: 'paragraph',
    inlines: [{ text, style }],
    style: EMPTY_BLOCK_STYLE,
  });

  /**
   * Body paragraph "body" (bold per `bodyBold`), then a 1×2 table whose two
   * cells hold one bold paragraph each, then a trailing body paragraph.
   */
  function setup(bodyBold: boolean, leftBold = true): {
    editor: EditorAPI;
    store: MemDocStore;
    container: HTMLElement;
    table: Block;
    body: Block;
  } {
    const left = para('left', leftBold ? { bold: true } : {});
    const right = para('right', { bold: true });
    const rows: TableRow[] = [
      {
        cells: [
          { blocks: [left], style: {} } as TableCell,
          { blocks: [right], style: {} } as TableCell,
        ],
      },
    ];
    const table: Block = {
      id: generateBlockId(),
      type: 'table',
      inlines: [],
      style: EMPTY_BLOCK_STYLE,
      tableData: { rows, columnWidths: [0.5, 0.5] },
    };
    const body = para('body', bodyBold ? { bold: true } : {});
    const store = new MemDocStore();
    store.setDocument({ blocks: [body, table, para('tail', { bold: true })] });
    const container = document.createElement('div');
    document.body.appendChild(container);
    const editor = initialize(container, store);
    editors.push(editor);
    return { editor, store, container, table, body };
  }

  /** The stored paragraph of cell `col` in the document's table block. */
  function storedCellBlock(store: MemDocStore, col: number): Block {
    const table = store.getDocument().blocks[1];
    return table.tableData!.rows[0].cells[col].blocks[0];
  }

  test('a selection spanning two different cells reports the shared style', () => {
    const { editor, table } = setup(true);
    const left = table.tableData!.rows[0].cells[0].blocks[0];
    const right = table.tableData!.rows[0].cells[1].blocks[0];
    editor._setSelectionForTest({
      anchor: { blockId: left.id, offset: 0 },
      focus: { blockId: right.id, offset: 5 },
    });

    // Both endpoints normalize to the table block, which is then read whole.
    expect(editor.getRangeStyleSummary().bold).toBe(true);
  });

  test('Cmd+B on a cross-cell selection removes bold from both cells', () => {
    const { editor, store, container, table } = setup(true);
    const left = table.tableData!.rows[0].cells[0].blocks[0];
    const right = table.tableData!.rows[0].cells[1].blocks[0];
    editor._setSelectionForTest({
      anchor: { blockId: left.id, offset: 0 },
      focus: { blockId: right.id, offset: 5 },
    });

    dispatchKey(container, 'b');

    for (const col of [0, 1]) {
      for (const inline of storedCellBlock(store, col).inlines) {
        // Cleared, not stored as `false` (#749).
        expect('bold' in inline.style).toBe(false);
      }
    }
  });

  test('a body-to-cell selection is mixed when the body run is unstyled', () => {
    const { editor, table, body } = setup(false);
    const right = table.tableData!.rows[0].cells[1].blocks[0];
    editor._setSelectionForTest({
      anchor: { blockId: body.id, offset: 0 },
      focus: { blockId: right.id, offset: 5 },
    });

    // The body run is not bold, the cell runs are — 'mixed', which the
    // toggles treat as "not applied" so the next press styles everything.
    expect(editor.getRangeStyleSummary().bold).toBe('mixed');
  });

  test('Cmd+B on a mixed body-to-cell selection bolds the whole range', () => {
    const { editor, store, container, table, body } = setup(false);
    const right = table.tableData!.rows[0].cells[1].blocks[0];
    editor._setSelectionForTest({
      anchor: { blockId: body.id, offset: 0 },
      focus: { blockId: right.id, offset: 5 },
    });

    dispatchKey(container, 'b');

    for (const inline of store.getDocument().blocks[0].inlines) {
      expect(inline.style.bold).toBe(true);
    }
    for (const col of [0, 1]) {
      for (const inline of storedCellBlock(store, col).inlines) {
        expect(inline.style.bold).toBe(true);
      }
    }
  });

  test('a cell rectangle selection decides the keyboard toggle from its cells', () => {
    const { editor, store, container, table } = setup(true);
    editor._setSelectionForTest({
      anchor: { blockId: table.tableData!.rows[0].cells[0].blocks[0].id, offset: 0 },
      focus: { blockId: table.tableData!.rows[0].cells[1].blocks[0].id, offset: 5 },
      tableCellRange: {
        blockId: table.id,
        start: { rowIndex: 0, colIndex: 0 },
        end: { rowIndex: 0, colIndex: 1 },
      },
    });

    // Every block of every selected cell is bold, so the press removes it.
    expect(editor.getRangeStyleSummary().bold).toBe(true);
    dispatchKey(container, 'b');

    for (const col of [0, 1]) {
      for (const inline of storedCellBlock(store, col).inlines) {
        // Cleared, not stored as `false` (#749).
        expect('bold' in inline.style).toBe(false);
      }
    }
  });

  test('a cell rectangle whose cells are not all bold gets bolded', () => {
    // The left cell is unstyled, so the rectangle reads as mixed.
    const { editor, store, container, table } = setup(true, false);
    editor._setSelectionForTest({
      anchor: { blockId: table.tableData!.rows[0].cells[0].blocks[0].id, offset: 0 },
      focus: { blockId: table.tableData!.rows[0].cells[1].blocks[0].id, offset: 5 },
      tableCellRange: {
        blockId: table.id,
        start: { rowIndex: 0, colIndex: 0 },
        end: { rowIndex: 0, colIndex: 1 },
      },
    });

    dispatchKey(container, 'b');

    for (const col of [0, 1]) {
      for (const inline of storedCellBlock(store, col).inlines) {
        expect(inline.style.bold).toBe(true);
      }
    }
  });

  /**
   * A nested table inside a cell is not reached by the shared traversal: it
   * walks the cell's direct blocks and a table block has zero text length.
   * Since the read and the write are the *same* traversal, that gap is
   * symmetric by construction — the alternative, reading runs the write
   * cannot reach, would flip the verdict to "already bold" and leave the
   * toggle an unremovable no-op (the #715 shape). Recorded as a known gap in
   * docs/design/docs/tables/docs-nested-tables.md.
   */
  test('a nested table is neither read nor written by a cross-block toggle', () => {
    const inner = para('inner', {});
    const innerTable: Block = {
      id: generateBlockId(),
      type: 'table',
      inlines: [],
      style: EMPTY_BLOCK_STYLE,
      tableData: {
        rows: [{ cells: [{ blocks: [inner], style: {} } as TableCell] }],
        columnWidths: [1],
      },
    };
    const outerPara = para('outer', { bold: true });
    const outer: Block = {
      id: generateBlockId(),
      type: 'table',
      inlines: [],
      style: EMPTY_BLOCK_STYLE,
      tableData: {
        rows: [{ cells: [{ blocks: [outerPara, innerTable], style: {} } as TableCell] }],
        columnWidths: [1],
      },
    };
    const before = para('before', { bold: true });
    const after = para('after', { bold: true });
    const store = new MemDocStore();
    store.setDocument({ blocks: [before, outer, after] });
    const container = document.createElement('div');
    document.body.appendChild(container);
    const editor = initialize(container, store);
    editors.push(editor);

    editor._setSelectionForTest({
      anchor: { blockId: before.id, offset: 0 },
      focus: { blockId: after.id, offset: 5 },
    });

    // The unstyled nested-table run is invisible to the read, so the range
    // reads uniformly bold — exactly the set the write can reach.
    expect(editor.getRangeStyleSummary().bold).toBe(true);

    dispatchKey(container, 'b');

    const storedOuter = store.getDocument().blocks[1];
    const cellBlocks = storedOuter.tableData!.rows[0].cells[0].blocks;
    // Written: the flag is cleared, not stored as `false` (#749).
    expect('bold' in cellBlocks[0].inlines[0].style).toBe(false);
    // Untouched: the write never descends into the nested table.
    const storedInner = cellBlocks[1].tableData!.rows[0].cells[0].blocks[0];
    expect(storedInner.inlines[0].style.bold).toBeUndefined();
  });
});

/**
 * Every keyboard style command must route a cell rectangle to the rectangle
 * write. `Doc.applyInlineStyle` ignores `range.tableCellRange` by contract:
 * handed a rectangle it normalizes the endpoints to the parent *table* block
 * and rewrites every cell in the table. The B/I/U/S toggles routed around it,
 * but clear formatting (Cmd+\) and the format painter's apply (Cmd+Alt+V)
 * called it directly, so both spilled outside the selected cells.
 */
describe('cell-rectangle routing for clear formatting and the format painter', () => {
  const editors: EditorAPI[] = [];
  beforeEach(() => {
    installCanvasShim();
    document.body.innerHTML = '';
  });
  afterEach(() => {
    for (const editor of editors.splice(0)) editor.dispose();
    document.body.innerHTML = '';
  });

  const para = (text: string, style: Record<string, boolean>): Block => ({
    id: generateBlockId(),
    type: 'paragraph',
    inlines: [{ text, style }],
    style: EMPTY_BLOCK_STYLE,
  });

  /**
   * A body paragraph (italic, the format painter's source) then a 1×3 table
   * whose three cells each hold one bold paragraph. The rectangle under test
   * covers columns 0–1, leaving column 2 as the witness.
   */
  function setup(): {
    editor: EditorAPI;
    store: MemDocStore;
    container: HTMLElement;
    table: Block;
    source: Block;
  } {
    const cells: TableCell[] = [0, 1, 2].map(
      (i) => ({ blocks: [para(`c${i}`, { bold: true })], style: {} }) as TableCell,
    );
    const table: Block = {
      id: generateBlockId(),
      type: 'table',
      inlines: [],
      style: EMPTY_BLOCK_STYLE,
      tableData: { rows: [{ cells }], columnWidths: [0.34, 0.33, 0.33] },
    };
    const source = para('src', { italic: true });
    const store = new MemDocStore();
    store.setDocument({ blocks: [source, table] });
    const container = document.createElement('div');
    document.body.appendChild(container);
    const editor = initialize(container, store);
    editors.push(editor);
    return { editor, store, container, table, source };
  }

  /** Select columns 0–1 of the table as a cell rectangle. */
  function selectFirstTwoCells(editor: EditorAPI, table: Block): void {
    const cells = table.tableData!.rows[0].cells;
    editor._setSelectionForTest({
      anchor: { blockId: cells[0].blocks[0].id, offset: 0 },
      focus: { blockId: cells[1].blocks[0].id, offset: 2 },
      tableCellRange: {
        blockId: table.id,
        start: { rowIndex: 0, colIndex: 0 },
        end: { rowIndex: 0, colIndex: 1 },
      },
    });
  }

  /** The stored paragraph of cell `col` in the document's table block. */
  function storedCell(store: MemDocStore, col: number): Block {
    return store.getDocument().blocks[1].tableData!.rows[0].cells[col].blocks[0];
  }

  test('Cmd+\\ clears only the selected cells, not the whole table', () => {
    const { editor, store, container, table } = setup();
    selectFirstTwoCells(editor, table);

    dispatchKey(container, '\\');

    for (const col of [0, 1]) {
      expect(storedCell(store, col).inlines[0].style.bold).toBeUndefined();
    }
    // The witness: outside the rectangle, so untouched.
    expect(storedCell(store, 2).inlines[0].style.bold).toBe(true);
  });

  test('Cmd+Alt+V paints only the selected cells, not the whole table', () => {
    const { editor, store, container, table, source } = setup();
    // Copy formatting from the italic body paragraph…
    editor._setSelectionForTest({
      anchor: { blockId: source.id, offset: 1 },
      focus: { blockId: source.id, offset: 1 },
    });
    dispatchKey(container, 'c', { shiftKey: true });

    // …then paste it over the two-cell rectangle.
    selectFirstTwoCells(editor, table);
    dispatchKey(container, 'v', { altKey: true });

    for (const col of [0, 1]) {
      expect(storedCell(store, col).inlines[0].style.italic).toBe(true);
    }
    expect(storedCell(store, 2).inlines[0].style.italic).toBeUndefined();
  });

  /**
   * The painter applies its buffer as a *merge patch*, so a buffer holding
   * only the flags the source happens to carry can add a flag but never take
   * one away. It used to get that for free from the toggle-off writing an
   * explicit `false`; once toggle-off started clearing the key (issue #749)
   * the buffer has to make every boolean explicit itself.
   *
   * The source paragraph here is italic and *not* bold; the cells are bold.
   */
  test('Cmd+Alt+V removes a flag the copied format does not have', () => {
    const { editor, store, container, table, source } = setup();
    editor._setSelectionForTest({
      anchor: { blockId: source.id, offset: 1 },
      focus: { blockId: source.id, offset: 1 },
    });
    dispatchKey(container, 'c', { shiftKey: true });

    selectFirstTwoCells(editor, table);
    dispatchKey(container, 'v', { altKey: true });

    for (const col of [0, 1]) {
      expect(storedCell(store, col).inlines[0].style.bold).toBeUndefined();
    }
    expect(storedCell(store, 2).inlines[0].style.bold).toBe(true);
  });
});

/**
 * A style write inside a header/footer region resolves its blocks against the
 * *context* block array (`Doc.getContextBlocks()`), never the body's — that is
 * what `Doc.getBlockIndex` returns indices into. The dirty-marking that
 * follows the write used to feed those context-relative indices to
 * `doc.document.blocks` (body only): with a header longer than the body it
 * dereferenced `undefined.id` and threw, aborting the write's repaint on both
 * the toolbar path (`view/editor.ts`) and the single keyboard write path
 * (`view/text-editor.ts`, which the diff made shared by the B/I/U/S toggles,
 * clear formatting and the format painter).
 *
 * The header here is deliberately three blocks long against a one-block body,
 * which is what makes the mismatch observable rather than merely wrong.
 */
describe('style write inside a header region', () => {
  const editors: EditorAPI[] = [];

  beforeEach(() => {
    installCanvasShim();
    document.body.innerHTML = '';
  });

  afterEach(() => {
    for (const editor of editors.splice(0)) editor.dispose();
    document.body.innerHTML = '';
  });

  function para(text: string): Block {
    return {
      id: generateBlockId(),
      type: 'paragraph',
      inlines: [{ text, style: {} }],
      style: EMPTY_BLOCK_STYLE,
    };
  }

  /** One body block, three header blocks, all three header blocks selected. */
  function setup(): {
    editor: EditorAPI;
    store: MemDocStore;
    container: HTMLElement;
  } {
    const header = [para('one'), para('two'), para('three')];
    const store = new MemDocStore();
    store.setDocument({
      blocks: [para('body')],
      header: { blocks: header, marginFromEdge: 48 },
    });
    const container = document.createElement('div');
    document.body.appendChild(container);
    const editor = initialize(container, store);
    editors.push(editor);
    editor._setEditContextForTest('header');
    editor._setSelectionForTest({
      anchor: { blockId: header[0].id, offset: 0 },
      focus: { blockId: header[2].id, offset: 'three'.length },
    });
    return { editor, store, container };
  }

  /** Bold flag of the first run of each stored header block. */
  function headerBold(store: MemDocStore): Array<boolean | undefined> {
    return store.getDocument().header!.blocks.map(
      (block) => block.inlines[0].style.bold,
    );
  }

  function bodyBold(store: MemDocStore): boolean | undefined {
    return store.getDocument().blocks[0].inlines[0].style.bold;
  }

  test('the toolbar path bolds every selected header block', () => {
    const { editor, store } = setup();

    editor.applyStyle({ bold: true });

    expect(headerBold(store)).toEqual([true, true, true]);
    expect(bodyBold(store)).toBeUndefined();
  });

  test('the keyboard path bolds every selected header block', () => {
    const { store, container } = setup();
    // A listener exception inside `dispatchEvent` is reported to the window
    // rather than rethrown, so the keyboard path needs this to see the crash.
    const errors: string[] = [];
    const onError = (e: ErrorEvent): void => {
      errors.push(String(e.message ?? e.error));
    };
    window.addEventListener('error', onError);

    dispatchKey(container, 'b');

    window.removeEventListener('error', onError);
    expect(errors).toEqual([]);
    expect(headerBold(store)).toEqual([true, true, true]);
    expect(bodyBold(store)).toBeUndefined();
  });
});
