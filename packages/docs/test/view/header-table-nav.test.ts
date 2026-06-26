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
  beforeEach(() => { installCanvasShim(); document.body.innerHTML = ''; });
  afterEach(() => { document.body.innerHTML = ''; });

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
    editor.dispose();
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
    editor.dispose();
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
    editor.dispose();
  });
});
