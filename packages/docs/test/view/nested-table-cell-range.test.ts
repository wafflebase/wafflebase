// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { initialize, type EditorAPI } from '../../src/view/editor.js';
import { MemDocStore } from '../../src/store/memory.js';
import { createEmptyBlock, createTableBlock } from '../../src/model/types.js';
import type { BlockCellInfo, TableCell } from '../../src/model/types.js';
import { Theme } from '../../src/view/theme.js';
import { WAFFLEDOCS_MIME } from '../../src/view/clipboard.js';
import { resolveNestedTableLayout } from '../../src/view/table-layout.js';

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

  it('copying a nested cell rectangle writes the cells, not nothing', () => {
    shiftClickRects([0, 0], [2, 0]);

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

    const json = written.get(WAFFLEDOCS_MIME);
    expect(json, `no ${WAFFLEDOCS_MIME} flavour on the clipboard`).toBeTruthy();
    const payload = JSON.parse(json!) as { tableCells?: TableCell[][] };
    expect(payload.tableCells).toBeTruthy();
    expect(payload.tableCells).toHaveLength(3);
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
});
