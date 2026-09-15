// @vitest-environment jsdom
import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { MemDocStore } from '../../src/store/memory.js';
import { initialize, type EditorAPI } from '../../src/view/editor.js';
import { normalizeBlockStyle, generateBlockId } from '../../src/model/types.js';
import type { Block } from '../../src/model/types.js';

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

/**
 * A table block with no rows at all.
 *
 * This is not a shape any gesture in this editor produces — it is what *every*
 * reader materializes for a table nested at or past `MAX_TABLE_NESTING_DEPTH`
 * (`treeNodeToBlock` returns `{ ...tableData, rows: [] }`), and a peer can put
 * one there with ordinary Tree writes. So it arrives in the model of a
 * document this tab did nothing unusual to, and every "the next block is a
 * table, so enter it" path has to answer something for it.
 */
function rowlessTable(id: string): Block {
  return {
    id,
    type: 'table',
    inlines: [],
    style: EMPTY,
    tableData: { rows: [], columnWidths: [1, 1] },
  };
}

describe('caret navigation across a table with no rows', () => {
  const editors: EditorAPI[] = [];
  beforeEach(() => { installCanvasShim(); document.body.innerHTML = ''; });
  afterEach(() => {
    for (const editor of editors.splice(0)) editor.dispose();
    document.body.innerHTML = '';
  });

  function setup(): { editor: EditorAPI; container: HTMLElement; before: Block; after: Block } {
    const store = new MemDocStore();
    const before = para('before');
    const after = para('after');
    store.setDocument({ blocks: [before, rowlessTable('T'), after] });
    const container = document.createElement('div');
    document.body.appendChild(container);
    const editor = initialize(container, store);
    editors.push(editor);
    return { editor, container, before, after };
  }

  /** Press a key, surfacing anything the keydown listener threw (see below). */
  function press(
    container: HTMLElement,
    key: string,
    init: KeyboardEventInit = {},
  ): unknown {
    const ta = container.querySelector('textarea')!;
    let thrown: unknown;
    const onError = (e: ErrorEvent): void => {
      thrown = e.error ?? new Error(e.message);
      e.preventDefault();
    };
    window.addEventListener('error', onError);
    try {
      ta.dispatchEvent(
        new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init }),
      );
    } catch (err) {
      thrown = err;
    } finally {
      window.removeEventListener('error', onError);
    }
    return thrown;
  }

  /**
   * Unguarded, `moveRight` reached `rows[0].cells[0].blocks[0]` on this block
   * and threw a `TypeError`. `handleArrow` catches every throw as stale layout
   * data, so the visible symptom was not a crash but a dead arrow key — the
   * caret never left `before`, and each press invalidated the whole layout.
   */
  test('ArrowRight steps onto the table instead of into a row that is not there', () => {
    const { editor, container, before } = setup();
    editor._setSelectionForTest({
      anchor: { blockId: before.id, offset: 'before'.length },
      focus: { blockId: before.id, offset: 'before'.length },
    });

    expect(press(container, 'ArrowRight')).toBeUndefined();
    expect(editor._getCursorForTest().blockId).toBe('T');
  });

  /** `moveLeft`'s mirror: entering the same table from below. */
  test('ArrowLeft steps onto the table from the block after it', () => {
    const { editor, container, after } = setup();
    editor._setSelectionForTest({
      anchor: { blockId: after.id, offset: 0 },
      focus: { blockId: after.id, offset: 0 },
    });

    expect(press(container, 'ArrowLeft')).toBeUndefined();
    expect(editor._getCursorForTest().blockId).toBe('T');
  });

  /**
   * The same block one level in: the *last* block of a cell. `Shift+Tab` asks
   * `lastPositionInCell` for the end of the previous cell, which descended
   * through trailing nested tables with a raw
   * `rows[rows.length - 1].cells[...]` — a `TypeError` on a table with no
   * rows. The caret should land on the rowless table block itself.
   */
  test('Shift+Tab lands on a rowless table that ends the previous cell', () => {
    const store = new MemDocStore();
    const inCell = para('a');
    const nextCell = para('b');
    store.setDocument({
      blocks: [{
        id: 'outer',
        type: 'table',
        inlines: [],
        style: EMPTY,
        tableData: {
          rows: [{ cells: [
            { blocks: [inCell, rowlessTable('N')], style: {} },
            { blocks: [nextCell], style: {} },
          ] }],
          columnWidths: [0.5, 0.5],
        },
      }],
    });
    const container = document.createElement('div');
    document.body.appendChild(container);
    const editor = initialize(container, store);
    editors.push(editor);

    editor._setSelectionForTest({
      anchor: { blockId: nextCell.id, offset: 0 },
      focus: { blockId: nextCell.id, offset: 0 },
    });

    expect(press(container, 'Tab', { shiftKey: true })).toBeUndefined();
    expect(editor._getCursorForTest().blockId).toBe('N');
  });

  /** And the caret is not stranded: the next press keeps going. */
  test('the caret can walk straight past it', () => {
    const { editor, container, before, after } = setup();
    editor._setSelectionForTest({
      anchor: { blockId: before.id, offset: 'before'.length },
      focus: { blockId: before.id, offset: 'before'.length },
    });

    press(container, 'ArrowRight');
    press(container, 'ArrowRight');
    expect(editor._getCursorForTest().blockId).toBe(after.id);
  });
});
