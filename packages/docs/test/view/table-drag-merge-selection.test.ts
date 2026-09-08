// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { initialize, type EditorAPI } from '../../src/view/editor.js';
import { MemDocStore } from '../../src/store/memory.js';
import { createEmptyBlock } from '../../src/model/types.js';
import { Theme } from '../../src/view/theme.js';

/**
 * The cell-rectangle contract of #1049, measured on painted pixels rather
 * than on the selection object: a gesture across cells highlights the
 * bounding rectangle of both endpoints, grown so every merged region it
 * touches is covered whole, and the cell the gesture started in is always
 * part of it.
 *
 * The table is 4 rows × 3 columns with row 1 merged across columns 0–1 —
 * the shape the issue was measured on. Gestures are driven through real
 * `mousedown`/`mousemove`/`mouseup` events at coordinates the editor itself
 * reported for each cell, and the result is read back by asking which cells
 * those coordinates now sit inside a highlight, so nothing here hard-codes
 * geometry.
 */

/** Every `fillRect` on the canvas, with the `fillStyle` in force at the time. */
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

/** Cells addressable by a caret — the covered `(1,1)` is not one of them. */
const CELLS: Array<[number, number]> = [
  [0, 0], [0, 1], [0, 2],
  [1, 0], [1, 2],
  [2, 0], [2, 1], [2, 2],
  [3, 0], [3, 1], [3, 2],
];

describe('table cell-rectangle selection across a colSpan merge (#1049)', () => {
  let container: HTMLElement;
  let editor: EditorAPI;
  let tableId: string;
  let points: Map<string, { x: number; y: number }>;
  let colX: number[];
  let colW: number[];
  let rowY: number[];
  let origGetContext: HTMLCanvasElement['getContext'];
  let origRect: typeof Element.prototype.getBoundingClientRect;
  let origRAF: typeof window.requestAnimationFrame;

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
    // jsdom reports every box as 0×0, which collapses the layout and leaves
    // nothing to hit. Give every element the page's own box, so scale is 1
    // and a client x is a document x.
    origRect = Element.prototype.getBoundingClientRect;
    Element.prototype.getBoundingClientRect = function (): DOMRect {
      return {
        x: 0, y: 0, left: 0, top: 0, right: 816, bottom: 1056,
        width: 816, height: 1056, toJSON: () => ({}),
      } as DOMRect;
    };
    // A no-op RAF: the drag-scroll loop reschedules itself for as long as
    // the button is held, and a microtask-backed stub would spin.
    origRAF = window.requestAnimationFrame;
    window.requestAnimationFrame = (): number => 0;

    container = document.createElement('div');
    document.body.appendChild(container);
    const store = new MemDocStore();
    store.setDocument({ blocks: [createEmptyBlock()] });
    editor = initialize(container, store);

    const doc = editor.getDoc();
    tableId = doc.insertTable(1, 4, 3);
    doc.mergeCells(tableId, {
      start: { rowIndex: 1, colIndex: 0 },
      end: { rowIndex: 1, colIndex: 1 },
    });
    editor.render();

    // Collected once, up front: reading a cell's point moves the caret,
    // which would wipe the very selection a gesture just produced.
    points = new Map();
    const td = doc.getBlock(tableId).tableData!;
    for (const [r, c] of CELLS) {
      const blockId = td.rows[r].cells[c].blocks[0].id;
      editor._setSelectionForTest({
        anchor: { blockId, offset: 0 },
        focus: { blockId, offset: 0 },
      });
      const rect = editor.getCursorScreenRect();
      if (!rect) throw new Error(`no caret rect for cell ${r},${c}`);
      points.set(`${r},${c}`, { x: rect.x + 4, y: rect.y + rect.height / 2 });
    }
    editor._setSelectionForTest(null);
    calibrate();
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

  /** Repaint and return the selection-coloured rectangles. */
  function highlightRects(): number[][] {
    fills.length = 0;
    editor.render();
    return fills
      .filter((f) => f.style === Theme.selectionColor || f.style === Theme.selectionColorInactive)
      .map((f) => f.rect);
  }

  /**
   * The highlight as `row,col` addresses (`row,c0-c1` for a band spanning
   * several columns), read against the grid the editor itself painted in
   * `calibrate()`. Going through the painted geometry rather than the
   * caret's keeps the read-back honest about what a user sees — a band the
   * width of two columns is reported as two columns.
   */
  function highlighted(): string[] {
    return cellsOf(highlightRects()).sort();
  }

  function cellsOf(rects: number[][]): string[] {
    const nearest = (vals: number[], v: number): number =>
      vals.reduce((best, x, i) => (Math.abs(x - v) < Math.abs(vals[best] - v) ? i : best), 0);
    return rects.map(([x, y, w]) => {
      const row = nearest(rowY, y);
      const c0 = nearest(colX, x);
      let c1 = c0;
      let acc = colW[c0];
      while (acc < w - 1 && c1 + 1 < colW.length) {
        c1 += 1;
        acc += colW[c1];
      }
      return c0 === c1 ? `${row},${c0}` : `${row},${c0}-${c1}`;
    });
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

  /** Press in `from`, move to `to` in ten steps as a real drag does, release. */
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

  function drag(from: [number, number], to: [number, number]): string[] {
    return cellsOf(dragRects(from, to)).sort();
  }

  /**
   * Learn the painted grid from two gestures that touch no merge: one
   * across row 0 for the column origins and widths, one down column 2 for
   * the row origins. Everything the assertions below say about geometry is
   * therefore the editor's own, so a layout change cannot make them vacuous.
   */
  function calibrate(): void {
    const cols = dragRects([0, 0], [0, 2]).sort((p, q) => p[0] - q[0]);
    expect(cols).toHaveLength(3);
    colX = cols.map((r) => r[0]);
    colW = cols.map((r) => r[2]);

    const rows = dragRects([0, 2], [3, 2]).sort((p, q) => p[1] - q[1]);
    expect(rows).toHaveLength(4);
    rowY = rows.map((r) => r[1]);
  }

  /**
   * Rows 0–2 of columns 0–1: both columns in the two plain rows, and in the
   * merged row one band `1,0-1` two columns wide. The issue's defect is the
   * absence of `0,1` and `2,1` from this list.
   */
  const ROWS_0_TO_2 = ['0,0', '0,1', '1,0-1', '2,0', '2,1'];

  it('a vertical drag in the merged column pulls the covered column in', () => {
    expect(drag([0, 0], [2, 0])).toEqual(ROWS_0_TO_2);
  });

  it('a vertical drag in the covered column keeps the anchor cell selected', () => {
    expect(drag([0, 1], [2, 1])).toEqual(ROWS_0_TO_2);
  });

  it('a diagonal drag naming both merged columns covers both', () => {
    expect(drag([0, 0], [2, 1])).toEqual(ROWS_0_TO_2);
  });

  it('a drag upward produces the same rectangle as the drag downward', () => {
    expect(drag([2, 1], [0, 1])).toEqual(ROWS_0_TO_2);
  });

  it('control: a horizontal drag clear of the merge selects only what it covers', () => {
    expect(drag([0, 1], [0, 2])).toEqual(['0,1', '0,2']);
  });

  it('control: a drag inside the unmerged column selects that column alone', () => {
    expect(drag([0, 2], [2, 2])).toEqual(['0,2', '1,2', '2,2']);
  });

  it('shift+click on a cell in another row selects the same rectangle a drag does', () => {
    press(0, 1);
    release();
    press(2, 1, { shiftKey: true });
    release();

    expect(highlighted()).toEqual(ROWS_0_TO_2);
  });
});
