// @vitest-environment jsdom
import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { MemDocStore } from '../../src/store/memory.js';
import { initialize, type EditorAPI } from '../../src/view/editor.js';
import { normalizeBlockStyle, generateBlockId } from '../../src/model/types.js';
import type { Block, TableCell, TableRow } from '../../src/model/types.js';

const EMPTY = normalizeBlockStyle({});

function installCanvasShim(): void {
  const ctxHandler: ProxyHandler<object> = {
    get(_t, prop) {
      if (prop === 'measureText') {
        return (text: string) => ({
          width: typeof text === 'string' ? text.length * 6 : 0,
          actualBoundingBoxAscent: 8, actualBoundingBoxDescent: 2,
        });
      }
      if (prop === 'getImageData') {
        return (_x: number, _y: number, w: number, h: number) => ({
          data: new Uint8ClampedArray(Math.max(0, w) * Math.max(0, h) * 4), width: w, height: h,
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

function para(text: string): Block {
  return { id: generateBlockId(), type: 'paragraph', inlines: [{ text, style: { fontFamily: 'Arial', fontSize: 12 } }], style: EMPTY };
}
function cell(text: string): TableCell {
  return { blocks: [para(text)], style: {} };
}
function headerTableBlock(): Block {
  const rows: TableRow[] = [
    { cells: [cell('ACME'), cell('Right')] },
    { cells: [cell('Invoice'), cell('No42')] },
  ];
  return { id: generateBlockId(), type: 'table', inlines: [], style: EMPTY, tableData: { rows, columnWidths: [0.5, 0.5] } };
}

describe('header table arrow navigation', () => {
  const editors: EditorAPI[] = [];
  beforeEach(() => { installCanvasShim(); document.body.innerHTML = ''; });
  afterEach(() => {
    // Dispose even if an assertion threw before the test's own dispose(),
    // so document/container listeners don't leak into the next test.
    for (const editor of editors.splice(0)) editor.dispose();
    document.body.innerHTML = '';
  });

  function setup(): { editor: EditorAPI; table: Block; container: HTMLElement } {
    const store = new MemDocStore();
    const table = headerTableBlock();
    store.setDocument({
      blocks: [para('body')],
      header: { blocks: [table, para('')], marginFromEdge: 48 },
    });
    const container = document.createElement('div');
    document.body.appendChild(container);
    const editor = initialize(container, store);
    editors.push(editor);
    return { editor, table, container };
  }

  function pressArrow(container: HTMLElement, key: string): void {
    const ta = container.querySelector('textarea')!;
    ta.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
  }

  test('ArrowRight within a cell moves by one char, not out of the table', () => {
    const { editor, table, container } = setup();
    const c00 = table.tableData!.rows[0].cells[0].blocks[0].id;
    editor._setEditContextForTest('header');
    editor._setSelectionForTest({ anchor: { blockId: c00, offset: 0 }, focus: { blockId: c00, offset: 0 } });

    pressArrow(container, 'ArrowRight');
    const pos = editor._getCursorForTest();
    expect(pos.blockId).toBe(c00);
    expect(pos.offset).toBe(1);
  });

  test('ArrowRight at cell end moves to the next cell', () => {
    const { editor, table, container } = setup();
    const c00 = table.tableData!.rows[0].cells[0].blocks[0].id;
    const c01 = table.tableData!.rows[0].cells[1].blocks[0].id;
    editor._setEditContextForTest('header');
    // 'ACME' length 4 — caret at end.
    editor._setSelectionForTest({ anchor: { blockId: c00, offset: 4 }, focus: { blockId: c00, offset: 4 } });

    pressArrow(container, 'ArrowRight');
    const pos = editor._getCursorForTest();
    expect(pos.blockId).toBe(c01);
    expect(pos.offset).toBe(0);
  });

  test('ArrowDown moves to the cell below in the same column', () => {
    const { editor, table, container } = setup();
    const c01 = table.tableData!.rows[0].cells[1].blocks[0].id;
    const c11 = table.tableData!.rows[1].cells[1].blocks[0].id;
    editor._setEditContextForTest('header');
    editor._setSelectionForTest({ anchor: { blockId: c01, offset: 0 }, focus: { blockId: c01, offset: 0 } });

    pressArrow(container, 'ArrowDown');
    const pos = editor._getCursorForTest();
    expect(pos.blockId).toBe(c11);
  });
});

describe('header table structural edits (region-aware)', () => {
  const editors: EditorAPI[] = [];
  beforeEach(() => { installCanvasShim(); document.body.innerHTML = ''; });
  afterEach(() => {
    for (const editor of editors.splice(0)) editor.dispose();
    document.body.innerHTML = '';
  });

  function setup(): {
    editor: EditorAPI;
    table: Block;
    container: HTMLElement;
    store: MemDocStore;
  } {
    const store = new MemDocStore();
    const table = headerTableBlock();
    store.setDocument({
      blocks: [para('body')],
      header: { blocks: [table, para('')], marginFromEdge: 48 },
    });
    const container = document.createElement('div');
    document.body.appendChild(container);
    const editor = initialize(container, store);
    editors.push(editor);
    return { editor, table, container, store };
  }

  function placeInCell(editor: EditorAPI, blockId: string): void {
    editor._setEditContextForTest('header');
    editor._setSelectionForTest({
      anchor: { blockId, offset: 0 },
      focus: { blockId, offset: 0 },
    });
  }

  test('isInTable / getCellAddress resolve a header cell cursor', () => {
    const { editor, table } = setup();
    placeInCell(editor, table.tableData!.rows[0].cells[0].blocks[0].id);
    expect(editor.isInTable()).toBe(true);
    expect(editor.getCellAddress()).toEqual({ rowIndex: 0, colIndex: 0 });
  });

  test('insertTableRow adds a row to the header table', () => {
    const { editor, table, store } = setup();
    placeInCell(editor, table.tableData!.rows[0].cells[0].blocks[0].id);
    editor.insertTableRow(false);
    const rows = store.getDocument().header!.blocks[0].tableData!.rows;
    expect(rows).toHaveLength(3);
  });

  test('deleteTableRow removes a row from the header table', () => {
    const { editor, table, store } = setup();
    placeInCell(editor, table.tableData!.rows[1].cells[0].blocks[0].id);
    editor.deleteTableRow();
    const rows = store.getDocument().header!.blocks[0].tableData!.rows;
    expect(rows).toHaveLength(1);
  });

  test('insertTableColumn adds a column to the header table', () => {
    const { editor, table, store } = setup();
    placeInCell(editor, table.tableData!.rows[0].cells[0].blocks[0].id);
    editor.insertTableColumn(false);
    const td = store.getDocument().header!.blocks[0].tableData!;
    expect(td.columnWidths).toHaveLength(3);
    expect(td.rows[0].cells).toHaveLength(3);
  });

  test('deleteTableColumn removes a column from the header table', () => {
    const { editor, table, store } = setup();
    placeInCell(editor, table.tableData!.rows[0].cells[0].blocks[0].id);
    editor.deleteTableColumn();
    const td = store.getDocument().header!.blocks[0].tableData!;
    expect(td.columnWidths).toHaveLength(1);
    expect(td.rows[0].cells).toHaveLength(1);
  });

  test('Tab at the last header cell appends a row and moves into it', () => {
    const { editor, table, container, store } = setup();
    const last = table.tableData!.rows[1].cells[1].blocks[0].id;
    placeInCell(editor, last);
    const ta = container.querySelector('textarea')!;
    ta.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }));
    const rows = store.getDocument().header!.blocks[0].tableData!.rows;
    expect(rows).toHaveLength(3);
    // Caret moved into the freshly inserted row's first cell.
    expect(editor._getCursorForTest().blockId).toBe(rows[2].cells[0].blocks[0].id);
  });

  test('ArrowRight at the last header cell exits into the trailing header paragraph', () => {
    const { editor, table, container, store } = setup();
    // c11 'No42' length 4 — caret at end.
    const c11 = table.tableData!.rows[1].cells[1].blocks[0].id;
    editor._setEditContextForTest('header');
    editor._setSelectionForTest({
      anchor: { blockId: c11, offset: 4 },
      focus: { blockId: c11, offset: 4 },
    });
    const ta = container.querySelector('textarea')!;
    ta.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }));
    const trailingParaId = store.getDocument().header!.blocks[1].id;
    expect(editor._getCursorForTest().blockId).toBe(trailingParaId);
    expect(editor.isInTable()).toBe(false);
  });
});
