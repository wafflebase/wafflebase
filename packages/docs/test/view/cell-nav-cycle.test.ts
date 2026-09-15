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

/** A 1×1 table whose only cell holds exactly `blocks`. */
function table(id: string, blocks: Block[]): Block {
  const cell: TableCell = { blocks, style: {} };
  const rows: TableRow[] = [{ cells: [cell] }];
  return {
    id,
    type: 'table',
    inlines: [],
    style: EMPTY,
    tableData: { rows, columnWidths: [1] },
  };
}

/**
 * A document whose `blockParentMap` loops.
 *
 * Block ids are peer-written CRDT attributes, so two tables can share one —
 * there is no schema that stops it. Here the innermost table reuses the
 * outermost table's id, which makes the layout's parent map read
 * `outer → inner → outer`. Both cell walks step *out* of a nested table by
 * recursing on the parent cell's first block, so on this map they ping-pong
 * between the two ids until the stack overflows. `seen` is what stops them.
 *
 *   T1 (top level)
 *     └ cell → T2
 *               └ cell → T1 (same id!)
 *                          └ cell → paragraph 'x'
 */
function cyclicDocument(): { blocks: Block[]; leafId: string } {
  const leaf = para('x');
  const innerT1 = table('T1', [leaf]);
  const t2 = table('T2', [innerT1]);
  const outerT1 = table('T1', [t2]);
  return { blocks: [outerT1, para('after')], leafId: leaf.id };
}

describe('table cell navigation over a cyclic parent map', () => {
  const editors: EditorAPI[] = [];
  beforeEach(() => { installCanvasShim(); document.body.innerHTML = ''; });
  afterEach(() => {
    for (const editor of editors.splice(0)) editor.dispose();
    document.body.innerHTML = '';
  });

  function setup(): { editor: EditorAPI; container: HTMLElement; leafId: string } {
    const store = new MemDocStore();
    const { blocks, leafId } = cyclicDocument();
    store.setDocument({ blocks });
    const container = document.createElement('div');
    document.body.appendChild(container);
    const editor = initialize(container, store);
    editors.push(editor);
    // Force a layout so `blockParentMap` — and with it the cycle — exists.
    editor._setSelectionForTest({
      anchor: { blockId: leafId, offset: 0 },
      focus: { blockId: leafId, offset: 0 },
    });
    return { editor, container, leafId };
  }

  /**
   * Press a key and return whatever the keydown listener threw.
   *
   * jsdom does not let an exception out of `dispatchEvent` — it reports it to
   * the window as an `error` event instead — so a bare `expect(…).not.toThrow`
   * around the dispatch would pass even on a stack overflow. Collecting the
   * `error` event is what makes the assertion real.
   */
  function press(container: HTMLElement, key: string, shiftKey = false): unknown {
    const ta = container.querySelector('textarea')!;
    let thrown: unknown;
    const onError = (e: ErrorEvent): void => {
      thrown = e.error ?? new Error(e.message);
      e.preventDefault();
    };
    window.addEventListener('error', onError);
    try {
      ta.dispatchEvent(
        new KeyboardEvent('keydown', { key, shiftKey, bubbles: true, cancelable: true }),
      );
    } catch (err) {
      thrown = err;
    } finally {
      window.removeEventListener('error', onError);
    }
    return thrown;
  }

  test('the parent map really does loop', () => {
    const { editor, leafId } = setup();
    const map = editor.getDoc().blockParentMap;
    expect(map.get(leafId)?.tableBlockId).toBe('T1');
    expect(map.get('T1')?.tableBlockId).toBe('T2');
    expect(map.get('T2')?.tableBlockId).toBe('T1');
  });

  test('Shift+Tab out of the last cell stops instead of overflowing', () => {
    const { editor, container, leafId } = setup();

    // Unguarded, `moveToPrevCell` recurses T1 → T2 → T1 → … and throws
    // `RangeError: Maximum call stack size exceeded` out of the keydown
    // handler. Guarded it simply reports no movement.
    expect(press(container, 'Tab', true)).toBeUndefined();
    // The caret is still on a block of this document, not left dangling.
    expect(typeof editor._getCursorForTest().blockId).toBe('string');
    expect(leafId).toBeDefined();
  });

  /**
   * The forward walk, through ArrowRight at the end of the innermost cell —
   * the one branch of `moveToNextCell` that steps out of a nested table (Tab
   * appends a row there instead, so it never recurses).
   *
   * `handleArrow` wraps its body in a `catch` that treats any throw as stale
   * layout data, so an overflow here surfaces as neither an exception nor an
   * error event — and the caret ends up on the same block either way. What
   * the guard changes is how much walking happens first: bounded, the walk
   * steps out of T1 onto T2, recognises T1 as already seen and gives up, for
   * a handful of `getBlock` lookups. Unbounded it ping-pongs until the stack
   * blows, thousands of lookups later. Counting them is what tells the two
   * apart.
   */
  test('ArrowRight out of the last cell stops after a bounded walk', () => {
    const { editor, container, leafId } = setup();
    // Caret at the end of the only text in the innermost cell.
    editor._setSelectionForTest({
      anchor: { blockId: leafId, offset: 1 },
      focus: { blockId: leafId, offset: 1 },
    });

    const doc = editor.getDoc();
    const realGetBlock = doc.getBlock.bind(doc);
    let lookups = 0;
    (doc as unknown as { getBlock: (id: string) => unknown }).getBlock = (id: string) => {
      lookups++;
      return realGetBlock(id);
    };
    try {
      // Three presses: the first two walk the caret off the text and onto the
      // nested table blocks, and only the third finds nothing left to move to
      // and enters the parent walk.
      press(container, 'ArrowRight');
      press(container, 'ArrowRight');
      press(container, 'ArrowRight');
    } finally {
      (doc as unknown as { getBlock: unknown }).getBlock = realGetBlock;
    }

    // Measured: 18 with the guard, 12,282 without it (the count at which the
    // recursion hits the stack limit).
    expect(lookups).toBeLessThan(100);
    expect(typeof editor._getCursorForTest().blockId).toBe('string');
  });
});
