// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { initialize, type EditorAPI } from '../../src/view/editor.js';
import { MemDocStore } from '../../src/store/memory.js';
import { Doc } from '../../src/model/document.js';
import { createEmptyBlock, createTableBlock } from '../../src/model/types.js';
import type { BlockCellInfo, TableCell } from '../../src/model/types.js';
import { Theme } from '../../src/view/theme.js';
import { WAFFLEDOCS_MIME } from '../../src/view/clipboard.js';
import { resolveNestedTableLayout } from '../../src/view/table-layout.js';
import { Selection } from '../../src/view/selection.js';
import { resolvePositionPixel } from '../../src/view/peer-cursor.js';
import type { DocumentLayout } from '../../src/view/layout.js';
import type { PaginatedLayout } from '../../src/view/pagination.js';
import type { TextMeasurer } from '../../src/view/measurer.js';

/**
 * The half of #1049 that lives inside a *nested* table.
 *
 * A nested table is not in `layout.blocks` — it hangs off a cell of the table
 * that is — so every flat `layout.blocks.find(...)` lookup missed it. Painting
 * was fixed by routing through `resolveNestedTableLayout`; these tests hold
 * the other two sites to the same rule (shift+click, clipboard copy) and pin
 * the resolver's parent-chain walk against a cyclic map.
 */

const fills: Array<{ style: string; rect: number[] }> = [];

function makeCtxSpy(): Record<string, unknown> {
  const spy: Record<string, unknown> = {
    fillStyle: '#000',
    strokeStyle: '#000',
    lineWidth: 1,
    font: '10px sans-serif',
    textAlign: 'start' as CanvasTextAlign,
    textBaseline: 'alphabetic' as CanvasTextBaseline,
    globalAlpha: 1,
    fillRect: vi.fn((x: number, y: number, w: number, h: number) => {
      fills.push({ style: String(spy.fillStyle), rect: [x, y, w, h] });
    }),
    fillText: vi.fn(),
    clearRect: vi.fn(),
    setTransform: vi.fn(),
    save: vi.fn(),
    restore: vi.fn(),
    scale: vi.fn(),
    translate: vi.fn(),
    rotate: vi.fn(),
    transform: vi.fn(),
    clip: vi.fn(),
    rect: vi.fn(),
    measureText: (text: string) => ({ width: text.length * 8 }),
    beginPath: vi.fn(),
    closePath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    arc: vi.fn(),
    stroke: vi.fn(),
    fill: vi.fn(),
    strokeRect: vi.fn(),
    setLineDash: vi.fn(),
    quadraticCurveTo: vi.fn(),
    bezierCurveTo: vi.fn(),
  };
  return spy;
}

describe('cell-range selection inside a nested table (#1049)', () => {
  let container: HTMLElement;
  let editor: EditorAPI;
  let innerId: string;
  let points: Map<string, { x: number; y: number }>;
  let origGetContext: HTMLCanvasElement['getContext'];
  let origRect: typeof Element.prototype.getBoundingClientRect;
  let origRAF: typeof window.requestAnimationFrame;

  /** Inner cells addressable by a caret — the covered `(1,1)` is not one. */
  const INNER_CELLS: Array<[number, number]> = [
    [0, 0], [0, 1],
    [1, 0],
    [2, 0], [2, 1],
  ];

  beforeEach(() => {
    (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    };
    (globalThis as unknown as { OffscreenCanvas: unknown }).OffscreenCanvas = class {
      constructor(public width: number, public height: number) {}
      getContext(): unknown {
        return {
          font: '10px sans-serif',
          measureText: (t: string) => ({ width: t.length * 8 }),
        };
      }
    };
    origGetContext = HTMLCanvasElement.prototype.getContext;
    const spy = makeCtxSpy();
    HTMLCanvasElement.prototype.getContext = function patched(id: string): unknown {
      return id === '2d' ? spy : null;
    } as HTMLCanvasElement['getContext'];
    origRect = Element.prototype.getBoundingClientRect;
    Element.prototype.getBoundingClientRect = function (): DOMRect {
      return {
        x: 0, y: 0, left: 0, top: 0, right: 816, bottom: 1056,
        width: 816, height: 1056, toJSON: () => ({}),
      } as DOMRect;
    };
    origRAF = window.requestAnimationFrame;
    window.requestAnimationFrame = (): number => 0;

    container = document.createElement('div');
    document.body.appendChild(container);

    // An outer 1×1 table whose only cell holds a 3×2 table, with the inner
    // row 1 merged across both columns — the shape whose covered column the
    // issue reported as unpainted.
    const inner = createTableBlock(3, 2);
    const itd = inner.tableData!;
    // Each addressable cell carries its own address as text, so a plain-text
    // copy can be asserted against the exact rectangle rather than merely
    // being non-empty — an all-empty fixture cannot tell a correct rectangle
    // from a wrong one. The covered cell `(1,1)` stays empty.
    for (const [r, c] of INNER_CELLS) {
      itd.rows[r].cells[c].blocks[0].inlines = [{ text: `r${r}c${c}`, style: {} }];
    }
    itd.rows[1].cells[0].colSpan = 2;
    itd.rows[1].cells[0].rowSpan = 1;
    itd.rows[1].cells[1].colSpan = 0;
    const outer = createTableBlock(1, 1);
    outer.tableData!.rows[0].cells[0].blocks = [inner];
    innerId = inner.id;

    const store = new MemDocStore();
    store.setDocument({ blocks: [outer, createEmptyBlock()] });
    editor = initialize(container, store);
    editor.render();

    // Collected up front: reading a cell's point moves the caret, which
    // would wipe the selection a gesture just produced.
    points = new Map();
    const live = editor.getDoc().getBlock(innerId).tableData!;
    for (const [r, c] of INNER_CELLS) {
      const blockId = live.rows[r].cells[c].blocks[0].id;
      editor._setSelectionForTest({
        anchor: { blockId, offset: 0 },
        focus: { blockId, offset: 0 },
      });
      const rect = editor.getCursorScreenRect();
      if (!rect) throw new Error(`no caret rect for inner cell ${r},${c}`);
      points.set(`${r},${c}`, { x: rect.x + 4, y: rect.y + rect.height / 2 });
    }
    editor._setSelectionForTest(null);
  });

  afterEach(() => {
    editor.dispose();
    document.body.removeChild(container);
    HTMLCanvasElement.prototype.getContext = origGetContext;
    Element.prototype.getBoundingClientRect = origRect;
    window.requestAnimationFrame = origRAF;
    fills.length = 0;
  });

  function pointAt(r: number, c: number): { x: number; y: number } {
    return points.get(`${r},${c}`)!;
  }

  function press(r: number, c: number, opts: { shiftKey?: boolean } = {}): void {
    const p = pointAt(r, c);
    container.dispatchEvent(new MouseEvent('mousedown', {
      bubbles: true, cancelable: true, button: 0,
      clientX: p.x, clientY: p.y, shiftKey: opts.shiftKey ?? false,
    }));
  }

  function release(): void {
    document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
  }

  /** Repaint and return the selection-coloured rectangles, ordered. */
  function highlightRects(): number[][] {
    fills.length = 0;
    editor.render();
    return fills
      .filter((f) => f.style === Theme.selectionColor || f.style === Theme.selectionColorInactive)
      .map((f) => f.rect)
      .sort((a, b) => a[1] - b[1] || a[0] - b[0]);
  }

  function dragRects(from: [number, number], to: [number, number]): number[][] {
    const a = pointAt(...from);
    const b = pointAt(...to);
    editor._setSelectionForTest(null);
    press(...from);
    for (let i = 1; i <= 10; i++) {
      const t = i / 10;
      container.dispatchEvent(new MouseEvent('mousemove', {
        bubbles: true,
        clientX: a.x + (b.x - a.x) * t,
        clientY: a.y + (b.y - a.y) * t,
      }));
    }
    release();
    return highlightRects();
  }

  function shiftClickRects(from: [number, number], to: [number, number]): number[][] {
    editor._setSelectionForTest(null);
    press(...from);
    release();
    press(...to, { shiftKey: true });
    release();
    return highlightRects();
  }

  it('shift+click paints exactly what the equivalent drag paints', () => {
    const dragged = dragRects([0, 1], [2, 1]);
    // More than the caret: the gesture crosses cells, so it is a rectangle.
    expect(dragged.length).toBeGreaterThan(1);
    expect(shiftClickRects([0, 1], [2, 1])).toEqual(dragged);
  });

  it('shift+click across the merged row covers the merge whole', () => {
    const rects = shiftClickRects([0, 0], [2, 0]);
    // Rows 0 and 2 paint both columns; row 1 paints one band spanning both.
    expect(rects).toHaveLength(5);
  });

  /** Fire a copy at the editor and return the flavours it wrote. */
  function copyFlavours(): Map<string, string> {
    const textarea = container.querySelector('textarea') as HTMLTextAreaElement;
    const written = new Map<string, string>();
    const event = new Event('copy', { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'clipboardData', {
      value: {
        setData: (type: string, data: string) => written.set(type, data),
        getData: (type: string) => written.get(type) ?? '',
        types: [] as string[],
        items: [] as unknown[],
        files: [] as unknown[],
      },
    });
    textarea.dispatchEvent(event);
    return written;
  }

  it('copying a nested cell rectangle writes the cells, not nothing', () => {
    shiftClickRects([0, 0], [2, 0]);

    const written = copyFlavours();

    const json = written.get(WAFFLEDOCS_MIME);
    expect(json, `no ${WAFFLEDOCS_MIME} flavour on the clipboard`).toBeTruthy();
    const payload = JSON.parse(json!) as { tableCells?: TableCell[][] };
    expect(payload.tableCells).toBeTruthy();
    expect(payload.tableCells).toHaveLength(3);

    // The plain-text flavour is written from `Selection.getSelectedText`,
    // which had kept the flat `layout.blocks` lookup — so a paste into any
    // app but this one got nothing. Asserted cell by cell: the rectangle the
    // merge expands to is rows 0–2 × both columns, and the covered cell
    // `(1,1)` contributes an empty column rather than disappearing.
    expect(written.get('text/plain')).toBe(
      'r0c0\tr0c1\nr1c0\t\nr2c0\tr2c1',
    );
  });

  it('copying a text selection inside a nested cell writes that text', () => {
    // The *other* nested-aware lookup in `getSelectedText`: an ordinary
    // caret-drag inside one nested cell, which takes the cell-internal branch
    // rather than the cell-rectangle one. Its flat `layout.blocks` lookup
    // missed the nested table exactly the same way, so copy wrote an empty
    // `text/plain` — and cut deleted the text while putting nothing on the
    // clipboard.
    const live = editor.getDoc().getBlock(innerId).tableData!;
    const blockId = live.rows[2].cells[1].blocks[0].id;
    editor._setSelectionForTest({
      anchor: { blockId, offset: 0 },
      focus: { blockId, offset: 4 },
    });

    expect(copyFlavours().get('text/plain')).toBe('r2c1');
  });

  it('copying part of a nested cell writes only that part', () => {
    const live = editor.getDoc().getBlock(innerId).tableData!;
    const blockId = live.rows[0].cells[1].blocks[0].id;
    editor._setSelectionForTest({
      anchor: { blockId, offset: 1 },
      focus: { blockId, offset: 3 },
    });

    expect(copyFlavours().get('text/plain')).toBe('0c');
  });
});

describe('resolveNestedTableLayout parent-chain walk', () => {
  /**
   * Block ids come verbatim out of peer-written CRDT attributes, so a parent
   * chain that loops back on itself is representable. The walk used to be an
   * unbounded `while (true)`, and it now runs once per painted cell
   * rectangle — so a loop would hang the tab of anyone selecting cells.
   */
  it('bails out of a cyclic blockParentMap instead of spinning', () => {
    const info = (tableBlockId: string): BlockCellInfo => ({
      tableBlockId, rowIndex: 0, colIndex: 0,
    });
    const blockParentMap = new Map<string, BlockCellInfo>([
      ['a', info('b')],
      ['b', info('a')],
    ]);

    expect(resolveNestedTableLayout('a', { blocks: [], blockParentMap })).toBeUndefined();
  });

  it('still resolves a self-referential id to nothing', () => {
    const blockParentMap = new Map<string, BlockCellInfo>([
      ['a', { tableBlockId: 'a', rowIndex: 0, colIndex: 0 }],
    ]);

    expect(resolveNestedTableLayout('a', { blocks: [], blockParentMap })).toBeUndefined();
  });

  /**
   * The resolver was not the only walk over this map. `normalizeRange` and
   * `resolvePositionPixel` walk the same peer-written chain on the same render
   * path, so guarding one site alone left the hang reachable through the other
   * two. Each of these would run forever before its guard; vitest's per-test
   * timeout is what turns that into a failure rather than a wedged suite.
   */
  function cyclicLayout(): DocumentLayout {
    const info = (tableBlockId: string): BlockCellInfo => ({
      tableBlockId, rowIndex: 0, colIndex: 0,
    });
    return {
      blocks: [],
      blockParentMap: new Map<string, BlockCellInfo>([
        ['x', info('a')],
        ['a', info('b')],
        ['b', info('a')],
      ]),
    } as unknown as DocumentLayout;
  }

  it('normalizeRange stops on a cyclic chain instead of spinning', () => {
    const selection = new Selection();
    selection.setRange({
      anchor: { blockId: 'x', offset: 0 },
      focus: { blockId: 'x', offset: 3 },
    });

    expect(selection.getNormalizedRange(cyclicLayout())).toBeNull();
  });

  /**
   * The model walks the same map, by recursion rather than a loop — so a
   * cycle there is a stack overflow (a crash, thrown from wherever the lookup
   * was called) rather than the `undefined` every other unresolvable id gets.
   * `findBlock` is reached with these same peer-written ids from the copy/cut
   * and cell-range paths, through `siblingBlocksOf` and `getParentTableBlock`.
   */
  it('Doc.findBlock stops on a cyclic chain instead of overflowing', () => {
    const store = new MemDocStore();
    store.setDocument({ blocks: [createEmptyBlock()] });
    const doc = new Doc(store);
    const info = (tableBlockId: string): BlockCellInfo => ({
      tableBlockId, rowIndex: 0, colIndex: 0,
    });
    doc.setBlockParentMap(new Map<string, BlockCellInfo>([
      ['x', info('a')],
      ['a', info('b')],
      ['b', info('a')],
    ]));

    expect(doc.findBlock('x')).toBeUndefined();
    // The throwing variant still reports a missing block, not a RangeError.
    expect(() => doc.getBlock('x')).toThrowError(/Block not found/);
  });

  /**
   * The other peer-written field on this render path. `tableCellRange` is
   * carried in presence and reaches `normalizeRange` verbatim, and every
   * consumer walks its indices as loop bounds — so an unclamped `1e9` spins
   * once per paint.
   */
  it('clamps a peer-written cell rectangle to the table it names', () => {
    const table = createTableBlock(2, 2);
    const selection = new Selection();
    selection.setRange({
      anchor: { blockId: table.id, offset: 0 },
      focus: { blockId: table.id, offset: 0 },
      tableCellRange: {
        blockId: table.id,
        start: { rowIndex: -1e9, colIndex: Number.NaN },
        end: { rowIndex: 1e9, colIndex: 1e9 },
      },
    });

    const normalized = selection.getNormalizedRange({
      blocks: [{ block: table }],
      blockParentMap: new Map<string, BlockCellInfo>(),
    } as unknown as DocumentLayout);

    expect(normalized?.tableCellRange?.start).toEqual({ rowIndex: 0, colIndex: 0 });
    expect(normalized?.tableCellRange?.end).toEqual({ rowIndex: 1, colIndex: 1 });
  });

  it('resolvePositionPixel stops on a cyclic chain instead of spinning', () => {
    const pixel = resolvePositionPixel(
      { blockId: 'x', offset: 0 },
      undefined,
      { pages: [] } as unknown as PaginatedLayout,
      cyclicLayout(),
      { measureText: (t: string) => t.length * 8 } as unknown as TextMeasurer,
      600,
    );

    expect(pixel).toBeUndefined();
  });
});
