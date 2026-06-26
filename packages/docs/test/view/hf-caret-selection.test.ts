import { describe, it, expect } from 'vitest';
import {
  computeHFCursorPixel,
  computeHFSelectionRects,
} from '../../src/view/editor.js';
import type { DocumentLayout, LayoutBlock, LayoutRun } from '../../src/view/layout.js';
import type { LayoutTable } from '../../src/view/table-layout.js';
import type { PaginatedLayout } from '../../src/view/pagination.js';
import type { TextMeasurer } from '../../src/view/measurer.js';
import {
  DEFAULT_BLOCK_STYLE,
  DEFAULT_CELL_STYLE,
  DEFAULT_PAGE_SETUP,
  type Block,
  type HeaderFooter,
  type TableData,
} from '../../src/model/types.js';

// Each glyph is 6px wide in the stub measurer.
const measurer: TextMeasurer = {
  measureWidth: (text: string) => text.length * 6,
};

function run(text: string, charStart: number, x: number): LayoutRun {
  const charOffsets = Array.from({ length: text.length }, (_, i) => (i + 1) * 6);
  return {
    inline: { text, style: {} },
    text,
    x,
    width: text.length * 6,
    inlineIndex: 0,
    charStart,
    charEnd: charStart + text.length,
    charOffsets,
  };
}

function para(id: string, text: string): Block {
  return {
    id,
    type: 'paragraph',
    inlines: [{ text, style: {} }],
    style: { ...DEFAULT_BLOCK_STYLE },
  };
}

const paginatedLayout: PaginatedLayout = {
  pages: [{ pageIndex: 0, lines: [], width: 816, height: 1056 }],
  pageSetup: DEFAULT_PAGE_SETUP,
};

describe('computeHFCursorPixel — lineAffinity at wrap boundary', () => {
  // A single paragraph wrapped into two visual lines of 5 chars each. The
  // caret at offset 5 sits exactly on the wrap boundary: backward affinity
  // belongs to the end of line 0, forward affinity to the start of line 1.
  function makeWrappedHeader(): { hfLayout: DocumentLayout; hf: HeaderFooter } {
    const block = para('p1', 'AAAAABBBBB');
    const lb: LayoutBlock = {
      block,
      x: 0,
      y: 0,
      width: 60,
      height: 32,
      lines: [
        { y: 0, height: 16, width: 30, runs: [run('AAAAA', 0, 0)] },
        { y: 16, height: 16, width: 30, runs: [run('BBBBB', 5, 0)] },
      ],
    };
    const hfLayout: DocumentLayout = {
      blocks: [lb],
      totalHeight: 32,
      blockParentMap: new Map(),
    };
    return { hfLayout, hf: { blocks: [block], marginFromEdge: 48 } };
  }

  it('places a backward-affinity caret on the first visual line', () => {
    const { hfLayout, hf } = makeWrappedHeader();
    const pixel = computeHFCursorPixel(
      { blockId: 'p1', offset: 5 }, 'backward', hfLayout, hf, 'header',
      paginatedLayout, measurer, 816, 0, true,
    );
    expect(pixel).toBeDefined();
    // pageX = 0 (page fills canvas), margins.left = 96, x within line = 5×6px.
    expect(pixel!.x).toBe(96 + 30);
    // baseY = pageY(pageGap 40) + marginFromEdge(48) = 88; line 0 y offset 0.
    expect(pixel!.y).toBe(88);
  });

  it('places a forward-affinity caret on the next visual line', () => {
    const { hfLayout, hf } = makeWrappedHeader();
    const back = computeHFCursorPixel(
      { blockId: 'p1', offset: 5 }, 'backward', hfLayout, hf, 'header',
      paginatedLayout, measurer, 816, 0, true,
    );
    const fwd = computeHFCursorPixel(
      { blockId: 'p1', offset: 5 }, 'forward', hfLayout, hf, 'header',
      paginatedLayout, measurer, 816, 0, true,
    );
    expect(back).toBeDefined();
    expect(fwd).toBeDefined();
    // Forward affinity drops the caret to the start (x at line origin) of the
    // next visual line, one line height (16px) lower than backward affinity.
    expect(fwd!.y - back!.y).toBe(16);
    expect(fwd!.x).toBeLessThan(back!.x);
  });
});

describe('computeHFSelectionRects — mixed table / paragraph selection', () => {
  // Header layout: a paragraph block followed by a 1×1 table block. A
  // selection spanning the paragraph into the table cell must render BOTH the
  // paragraph portion and the table cell, not collapse to the cell alone.
  function makeMixedHeader(): { hfLayout: DocumentLayout; hf: HeaderFooter } {
    const pBlock = para('p1', 'HELLO');
    const cellBlock = para('c0', 'X');
    const tableData: TableData = {
      rows: [{ cells: [{ blocks: [cellBlock], style: { ...DEFAULT_CELL_STYLE } }] }],
      columnWidths: [1],
    };
    const tableBlock: Block = {
      id: 't1',
      type: 'table',
      inlines: [],
      style: { ...DEFAULT_BLOCK_STYLE },
      tableData,
    };
    const tl: LayoutTable = {
      cells: [[{ lines: [], blockBoundaries: [0], width: 100, height: 20, merged: false }]],
      columnXOffsets: [0],
      columnPixelWidths: [100],
      rowYOffsets: [0],
      rowHeights: [20],
      totalWidth: 100,
      totalHeight: 20,
      blockParentMap: new Map(),
    };
    const pLb: LayoutBlock = {
      block: pBlock,
      x: 0,
      y: 0,
      width: 30,
      height: 16,
      lines: [{ y: 0, height: 16, width: 30, runs: [run('HELLO', 0, 0)] }],
    };
    const tLb: LayoutBlock = {
      block: tableBlock,
      x: 0,
      y: 16,
      width: 100,
      height: 20,
      lines: [],
      layoutTable: tl,
    };
    const blockParentMap = new Map([
      ['c0', { tableBlockId: 't1', rowIndex: 0, colIndex: 0 }],
    ]);
    const hfLayout: DocumentLayout = {
      blocks: [pLb, tLb],
      totalHeight: 36,
      blockParentMap,
    };
    return {
      hfLayout,
      hf: { blocks: [pBlock, tableBlock], marginFromEdge: 48 },
    };
  }

  it('renders both the table cell and the outside paragraph portion', () => {
    const { hfLayout, hf } = makeMixedHeader();
    const rects = computeHFSelectionRects(
      { anchor: { blockId: 'p1', offset: 2 }, focus: { blockId: 'c0', offset: 1 } },
      hfLayout, hf, 'header', paginatedLayout, measurer, 816, 0,
    );
    // At least one rect for the table cell + at least one for the paragraph.
    expect(rects.length).toBeGreaterThanOrEqual(2);
    // A 100px-wide table cell rect must be present.
    expect(rects.some((r) => r.width === 100)).toBe(true);
    // The paragraph portion (from offset 2 to end of "HELLO" = 3 chars × 6px)
    // produces a narrow rect that is not the full cell width.
    expect(rects.some((r) => r.width > 0 && r.width < 100)).toBe(true);
  });

  it('still works for a pure paragraph selection (no table endpoints)', () => {
    const { hfLayout, hf } = makeMixedHeader();
    const rects = computeHFSelectionRects(
      { anchor: { blockId: 'p1', offset: 0 }, focus: { blockId: 'p1', offset: 5 } },
      hfLayout, hf, 'header', paginatedLayout, measurer, 816, 0,
    );
    expect(rects.length).toBe(1);
    expect(rects[0].width).toBe(30); // 5 glyphs × 6px
  });
});
