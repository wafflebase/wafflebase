import { describe, it, expect } from 'vitest';
import { computeSelectionRects } from '../../src/view/selection.js';
import type { DocumentLayout, LayoutBlock, LayoutLine, LayoutRun } from '../../src/view/layout.js';
import { getPageXOffset, getPageYOffset, type PaginatedLayout } from '../../src/view/pagination.js';
import { DEFAULT_BLOCK_STYLE, DEFAULT_PAGE_SETUP } from '../../src/model/types.js';
import { stubMeasurer } from './_stub-measurer.js';

const CHAR_W = 8;
const LINE_H = 20;
const MARGIN_LEFT = 96;
const MARGIN_TOP = 96;

function run(text: string, charStart: number): LayoutRun {
  return {
    inline: { text, style: { fontSize: 11, fontFamily: 'Arial' } },
    text,
    x: 0,
    width: text.length * CHAR_W,
    inlineIndex: 0,
    charStart,
    charEnd: charStart + text.length,
    charOffsets: Array.from({ length: text.length }, (_, i) => (i + 1) * CHAR_W),
  };
}

function line(r: LayoutRun): LayoutLine {
  return { runs: [r], y: 0, height: LINE_H, width: r.width };
}

/**
 * One paragraph whose text 'AAAAABBBBB' wrapped into two visual lines of
 * five characters. Offset 5 is the wrap boundary: it is both the end of
 * line 0 and the start of line 1.
 */
function makeWrappedLayout(): { layout: DocumentLayout; paginatedLayout: PaginatedLayout } {
  const lines = [line(run('AAAAA', 0)), line(run('BBBBB', 5))];
  const block: LayoutBlock = {
    block: {
      id: 'b1',
      type: 'paragraph',
      inlines: [{ text: 'AAAAABBBBB', style: {} }],
      style: { ...DEFAULT_BLOCK_STYLE },
    },
    x: 0,
    y: 0,
    width: 624,
    height: LINE_H * 2,
    lines,
  };
  const layout: DocumentLayout = {
    blocks: [block],
    totalHeight: LINE_H * 2,
    blockParentMap: new Map(),
  };
  const paginatedLayout: PaginatedLayout = {
    pages: [{
      pageIndex: 0,
      width: 816,
      height: 1056,
      lines: lines.map((l, li) => ({
        blockIndex: 0,
        lineIndex: li,
        line: l,
        x: MARGIN_LEFT,
        y: MARGIN_TOP + li * LINE_H,
        pageIndex: 1,
      })),
    }],
    pageSetup: DEFAULT_PAGE_SETUP,
  };
  return { layout, paginatedLayout };
}

// Page-local line Y plus wherever the paginator places page 0 on canvas.
const PAGE_Y = getPageYOffset(makeWrappedLayout().paginatedLayout, 0);
const PAGE_X = getPageXOffset(makeWrappedLayout().paginatedLayout, 816);
const LINE0_Y = PAGE_Y + MARGIN_TOP;
const LINE1_Y = PAGE_Y + MARGIN_TOP + LINE_H;

function rectsFor(anchor: Parameters<typeof computeSelectionRects>[0]['anchor'], focus: Parameters<typeof computeSelectionRects>[0]['focus']) {
  const { layout, paginatedLayout } = makeWrappedLayout();
  return computeSelectionRects(
    { anchor, focus },
    paginatedLayout,
    layout,
    stubMeasurer(CHAR_W),
    816,
  );
}

describe('selection endpoint lineAffinity', () => {
  it('starts the highlight on the clicked line for a forward-affinity start', () => {
    const rects = rectsFor(
      { blockId: 'b1', offset: 5, lineAffinity: 'forward' },
      { blockId: 'b1', offset: 10 },
    );

    expect(rects).toHaveLength(1);
    expect(rects[0].y).toBe(LINE1_Y);
    expect(rects[0].x).toBe(PAGE_X + MARGIN_LEFT);
    expect(rects[0].width).toBe(5 * CHAR_W);
  });

  it('honors a backward-affinity start (highlight opens on the previous line)', () => {
    const rects = rectsFor(
      { blockId: 'b1', offset: 5, lineAffinity: 'backward' },
      { blockId: 'b1', offset: 10 },
    );

    // Start resolves to the end of line 0, so the highlight spans two
    // visual lines: a zero-width tail on line 0 plus all of line 1.
    expect(rects.length).toBeGreaterThan(1);
    expect(rects[0].y).toBe(LINE0_Y);
    expect(rects.some((r) => r.y === LINE1_Y)).toBe(true);
  });

  it('defaults an affinity-less start to the forward reading', () => {
    const rects = rectsFor(
      { blockId: 'b1', offset: 5 },
      { blockId: 'b1', offset: 10 },
    );

    expect(rects).toHaveLength(1);
    expect(rects[0].y).toBe(LINE1_Y);
  });

  it('keeps the affinity when the range is reversed (focus before anchor)', () => {
    const rects = rectsFor(
      { blockId: 'b1', offset: 10 },
      { blockId: 'b1', offset: 5, lineAffinity: 'forward' },
    );

    // normalizeRange makes the focus the start; its affinity must survive.
    expect(rects).toHaveLength(1);
    expect(rects[0].y).toBe(LINE1_Y);
  });

  it('keeps a backward-affinity end on the line the offset closes', () => {
    const rects = rectsFor(
      { blockId: 'b1', offset: 0 },
      { blockId: 'b1', offset: 5, lineAffinity: 'backward' },
    );

    expect(rects).toHaveLength(1);
    expect(rects[0].y).toBe(LINE0_Y);
    expect(rects[0].width).toBe(5 * CHAR_W);
  });

  it('moves the end onto the next line for a forward-affinity end', () => {
    const rects = rectsFor(
      { blockId: 'b1', offset: 0 },
      { blockId: 'b1', offset: 5, lineAffinity: 'forward' },
    );

    expect(rects.length).toBeGreaterThan(1);
    expect(rects[rects.length - 1].y).toBe(LINE1_Y);
  });
});
