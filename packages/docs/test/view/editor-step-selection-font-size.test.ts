// @vitest-environment jsdom
import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { MemDocStore } from '../../src/store/memory.js';
import { initialize, type EditorAPI } from '../../src/view/editor.js';
import { normalizeBlockStyle, generateBlockId } from '../../src/model/types.js';
import type { Block, TableCell, TableRow, DocRange } from '../../src/model/types.js';

const EMPTY = normalizeBlockStyle({});

/**
 * jsdom-friendly tests for `EditorAPI.stepSelectionFontSize` (issue #343):
 * the `±` spinner on a mixed-size selection steps each run relative to its
 * own effective size, instead of applying one absolute value to the whole
 * selection (contrast `applyStyle({ fontSize })`). See
 * docs-font-controls.md, "`±` on a mixed-size selection...".
 */

// Saved originals so the shim can be torn down after each test — otherwise
// the mocked getContext / ResizeObserver leak into later tests in the worker.
let origGetContext: typeof HTMLCanvasElement.prototype.getContext | undefined;
let origResizeObserver: unknown;
let shimInstalled = false;

function installCanvasShim(): void {
  origGetContext = HTMLCanvasElement.prototype.getContext;
  origResizeObserver = (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver;
  shimInstalled = true;
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
      if (prop === 'canvas') return null;
      if (prop === 'font') return '12px sans-serif';
      return () => {};
    },
    set() { return true; },
  };
  const fakeCtx = new Proxy({}, ctxHandler) as unknown as CanvasRenderingContext2D;
  (HTMLCanvasElement.prototype as unknown as { getContext: (k: string) => unknown }).getContext =
    (kind: string) => (kind === '2d' ? fakeCtx : null);
  (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
    observe(): void {} unobserve(): void {} disconnect(): void {}
  };
}

/** [FONT_SIZE_MIN, FONT_SIZE_MAX] = [1, 400] — mirrors font-catalog.ts. */
const clamp = (n: number): number => Math.max(1, Math.min(400, Math.round(n)));

function para(text: string, fontSize?: number): Block {
  return {
    id: generateBlockId(),
    type: 'paragraph',
    inlines: [{ text, style: fontSize === undefined ? {} : { fontSize } }],
    style: EMPTY,
  };
}

function multiRunPara(runs: Array<[string, number | undefined]>): Block {
  return {
    id: generateBlockId(),
    type: 'paragraph',
    inlines: runs.map(([text, fontSize]) => ({
      text,
      style: fontSize === undefined ? {} : { fontSize },
    })),
    style: EMPTY,
  };
}

function cell(text: string, fontSize?: number): TableCell {
  return { blocks: [para(text, fontSize)], style: {} };
}

describe('EditorAPI.stepSelectionFontSize', () => {
  const editors: EditorAPI[] = [];
  beforeEach(() => { installCanvasShim(); document.body.innerHTML = ''; });
  afterEach(() => {
    for (const editor of editors.splice(0)) editor.dispose();
    document.body.innerHTML = '';
    // Restore the browser APIs the shim replaced so they don't leak.
    if (shimInstalled) {
      HTMLCanvasElement.prototype.getContext =
        origGetContext as typeof HTMLCanvasElement.prototype.getContext;
      (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver =
        origResizeObserver;
      shimInstalled = false;
    }
  });

  function setupEditor(blocks: Block[]): { editor: EditorAPI; store: MemDocStore } {
    const store = new MemDocStore();
    store.setDocument({ blocks });
    const container = document.createElement('div');
    document.body.appendChild(container);
    const editor = initialize(container, store);
    editors.push(editor);
    return { editor, store };
  }

  test('steps each run relative to its own size in a mixed single-block selection', () => {
    const block = multiRunPara([['aa', 11], ['bb', 36]]);
    const { editor, store } = setupEditor([block]);
    editor._setSelectionForTest({
      anchor: { blockId: block.id, offset: 0 },
      focus: { blockId: block.id, offset: 4 },
    });

    editor.stepSelectionFontSize(1, clamp);

    const inlines = store.getDocument().blocks[0].inlines;
    expect(inlines[0].style.fontSize).toBe(12);
    expect(inlines[1].style.fontSize).toBe(37);
  });

  test('steps runs across a cross-block selection relative to each run\'s own size', () => {
    const b1 = para('first', 14);
    const b2 = para('second', 18);
    const { editor, store } = setupEditor([b1, b2]);
    editor._setSelectionForTest({
      anchor: { blockId: b1.id, offset: 0 },
      focus: { blockId: b2.id, offset: 6 },
    });

    editor.stepSelectionFontSize(-1, clamp);

    const doc = store.getDocument();
    expect(doc.blocks[0].inlines[0].style.fontSize).toBe(13);
    expect(doc.blocks[1].inlines[0].style.fontSize).toBe(17);
  });

  test('runs outside the selection are left untouched', () => {
    const block = multiRunPara([['aa', 10], ['bb', 20], ['cc', 30]]);
    const { editor, store } = setupEditor([block]);
    // Select only the middle run ("bb", offsets 2..4).
    editor._setSelectionForTest({
      anchor: { blockId: block.id, offset: 2 },
      focus: { blockId: block.id, offset: 4 },
    });

    editor.stepSelectionFontSize(1, clamp);

    const inlines = store.getDocument().blocks[0].inlines;
    expect(inlines[0].style.fontSize).toBe(10);
    expect(inlines[1].style.fontSize).toBe(21);
    expect(inlines[2].style.fontSize).toBe(30);
  });

  test('steps only the selected sub-range when the selection starts/ends mid-run, splitting each partially-covered run', () => {
    // Two runs, "aaaa"@10 and "bbbb"@20. Select offsets 2..6 — the anchor
    // sits inside the first run and the focus inside the second run, so
    // neither boundary lands on a run edge.
    const block = multiRunPara([['aaaa', 10], ['bbbb', 20]]);
    const { editor, store } = setupEditor([block]);
    editor._setSelectionForTest({
      anchor: { blockId: block.id, offset: 2 },
      focus: { blockId: block.id, offset: 6 },
    });

    editor.stepSelectionFontSize(1, clamp);

    // Each partially-covered run splits: the selected half steps, the
    // unselected half keeps its original size.
    const inlines = store.getDocument().blocks[0].inlines;
    expect(inlines.map((i) => [i.text, i.style.fontSize])).toEqual([
      ['aa', 10],
      ['aa', 11],
      ['bb', 21],
      ['bb', 20],
    ]);
  });

  test('resolves an unset run to the docs default (11) before stepping', () => {
    const block = multiRunPara([['aa', undefined], ['bb', 20]]);
    const { editor, store } = setupEditor([block]);
    editor._setSelectionForTest({
      anchor: { blockId: block.id, offset: 0 },
      focus: { blockId: block.id, offset: 4 },
    });

    editor.stepSelectionFontSize(1, clamp);

    const inlines = store.getDocument().blocks[0].inlines;
    expect(inlines[0].style.fontSize).toBe(12); // 11 (default) + 1
    expect(inlines[1].style.fontSize).toBe(21);
  });

  test('clamps at FONT_SIZE_MAX when stepping up past the ceiling', () => {
    const block = para('big', 400);
    const { editor, store } = setupEditor([block]);
    editor._setSelectionForTest({
      anchor: { blockId: block.id, offset: 0 },
      focus: { blockId: block.id, offset: 3 },
    });

    editor.stepSelectionFontSize(1, clamp);

    expect(store.getDocument().blocks[0].inlines[0].style.fontSize).toBe(400);
  });

  test('clamps at FONT_SIZE_MIN when stepping down past the floor', () => {
    const block = para('small', 1);
    const { editor, store } = setupEditor([block]);
    editor._setSelectionForTest({
      anchor: { blockId: block.id, offset: 0 },
      focus: { blockId: block.id, offset: 5 },
    });

    editor.stepSelectionFontSize(-1, clamp);

    expect(store.getDocument().blocks[0].inlines[0].style.fontSize).toBe(1);
  });

  test('a collapsed caret steps the single current value (unaffected by mixed logic)', () => {
    const block = para('abc', 11);
    const { editor } = setupEditor([block]);
    editor._setSelectionForTest({
      anchor: { blockId: block.id, offset: 1 },
      focus: { blockId: block.id, offset: 1 },
    });

    editor.stepSelectionFontSize(1, clamp);

    // Collapsed-caret steps go through the pending-style path (same as
    // applyStyle at a caret) — getRangeStyleSummary reflects it immediately.
    expect(editor.getRangeStyleSummary().fontSize).toBe(12);
  });

  test('steps runs inside a table cell-range selection relative to each run\'s own size, leaving cells outside the range untouched', () => {
    const rows: TableRow[] = [
      { cells: [cell('a', 10), cell('b', 20)] },
      { cells: [cell('c', 30), cell('d', 40)] },
    ];
    const table: Block = {
      id: generateBlockId(),
      type: 'table',
      inlines: [],
      style: EMPTY,
      tableData: { rows, columnWidths: [0.5, 0.5] },
    };
    const { editor, store } = setupEditor([table]);

    const range: DocRange = {
      anchor: { blockId: rows[0].cells[0].blocks[0].id, offset: 0 },
      focus: { blockId: rows[0].cells[0].blocks[0].id, offset: 0 },
      tableCellRange: {
        blockId: table.id,
        start: { rowIndex: 0, colIndex: 0 },
        end: { rowIndex: 0, colIndex: 1 },
      },
    };
    editor._setSelectionForTest(range);

    editor.stepSelectionFontSize(1, clamp);

    const t = store.getDocument().blocks[0].tableData!;
    expect(t.rows[0].cells[0].blocks[0].inlines[0].style.fontSize).toBe(11);
    expect(t.rows[0].cells[1].blocks[0].inlines[0].style.fontSize).toBe(21);
    // Second row is outside the cell range — untouched.
    expect(t.rows[1].cells[0].blocks[0].inlines[0].style.fontSize).toBe(30);
    expect(t.rows[1].cells[1].blocks[0].inlines[0].style.fontSize).toBe(40);
  });
});
