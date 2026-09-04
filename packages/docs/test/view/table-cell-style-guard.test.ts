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
  return {
    id: generateBlockId(),
    type: 'paragraph',
    inlines: [{ text, style: { fontFamily: 'Arial', fontSize: 12 } }],
    style: EMPTY,
  };
}
function cell(text: string): TableCell {
  return { blocks: [para(text)], style: {} };
}
function tableBlock(): Block {
  const rows: TableRow[] = [
    { cells: [cell('a'), cell('b')] },
    { cells: [cell('c'), cell('d')] },
  ];
  return {
    id: generateBlockId(), type: 'table', inlines: [], style: EMPTY,
    tableData: { rows, columnWidths: [0.5, 0.5] },
  };
}

/**
 * `applyTableCellStyle` snapshotted before its `!cellInfo` guard, unlike
 * every sibling table method (`deleteTable` carries the comment stating the
 * convention). A call with the caret outside a table wrote nothing but still
 * pushed an undo entry, so the next ⌘Z did nothing visible.
 */
describe('applyTableCellStyle — undo snapshot ordering', () => {
  const editors: EditorAPI[] = [];
  beforeEach(() => { installCanvasShim(); document.body.innerHTML = ''; });
  afterEach(() => {
    for (const editor of editors.splice(0)) editor.dispose();
    document.body.innerHTML = '';
  });

  function setup(): { editor: EditorAPI; store: MemDocStore; body: Block; table: Block } {
    const store = new MemDocStore();
    const body = para('outside');
    const table = tableBlock();
    store.setDocument({ blocks: [body, table, para('after')] });
    const container = document.createElement('div');
    document.body.appendChild(container);
    const editor = initialize(container, store);
    editors.push(editor);
    return { editor, store, body, table };
  }

  function place(editor: EditorAPI, blockId: string): void {
    editor._setSelectionForTest({
      anchor: { blockId, offset: 0 },
      focus: { blockId, offset: 0 },
    });
  }

  test('a no-op call with the caret outside a table burns no undo step', () => {
    const { editor, store, body } = setup();
    place(editor, body.id);
    expect(store.canUndo()).toBe(false);

    editor.applyTableCellStyle({ backgroundColor: '#ff0000' });

    expect(store.canUndo()).toBe(false);
  });

  test('a real call with the caret in a cell still snapshots and applies', () => {
    const { editor, store, table } = setup();
    place(editor, table.tableData!.rows[0].cells[0].blocks[0].id);
    expect(store.canUndo()).toBe(false);

    editor.applyTableCellStyle({ backgroundColor: '#ff0000' });

    expect(store.canUndo()).toBe(true);
    expect(
      store.getDocument().blocks.find((b) => b.id === table.id)!
        .tableData!.rows[0].cells[0].style.backgroundColor,
    ).toBe('#ff0000');

    editor.undo();
    expect(
      store.getDocument().blocks.find((b) => b.id === table.id)!
        .tableData!.rows[0].cells[0].style.backgroundColor,
    ).toBeUndefined();
  });
});
