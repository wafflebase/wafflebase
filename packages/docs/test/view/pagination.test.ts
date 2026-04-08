import { describe, it, expect } from 'vitest';
import {
  paginateLayout,
  getPageYOffset,
  getTotalHeight,
  findPageForPosition,
  paginatedPixelToPosition,
} from '../../src/view/pagination.js';
import { DEFAULT_PAGE_SETUP } from '../../src/model/types.js';
import type { DocumentLayout, LayoutBlock, LayoutLine, LayoutRun } from '../../src/view/layout.js';

function mockLine(height: number): LayoutLine {
  return { runs: [], y: 0, height, width: 100 };
}

function mockRun(text: string, x: number, charOffsets: number[], charStart = 0): LayoutRun {
  return {
    inline: { text, style: {} },
    text,
    x,
    width: charOffsets.length > 0 ? charOffsets[charOffsets.length - 1] : 0,
    inlineIndex: 0,
    charStart,
    charEnd: charStart + text.length,
    charOffsets,
  };
}

function mockLineWithRuns(runs: LayoutRun[], height = 24): LayoutLine {
  const width = runs.length > 0
    ? runs[runs.length - 1].x + runs[runs.length - 1].width
    : 0;
  return { runs, y: 0, height, width };
}

function mockBlock(
  id: string,
  lines: LayoutLine[],
  marginTop = 0,
  marginBottom = 8,
): LayoutBlock {
  const totalHeight = lines.reduce((h, l) => h + l.height, 0);
  return {
    block: {
      id,
      type: 'paragraph',
      inlines: [{ text: 'test', style: {} }],
      style: { alignment: 'left', lineHeight: 1.5, marginTop, marginBottom, textIndent: 0, marginLeft: 0 },
    },
    x: 0,
    y: 0,
    width: 624,
    height: totalHeight,
    lines,
  };
}

describe('paginateLayout', () => {
  const setup = DEFAULT_PAGE_SETUP;
  // contentHeight = 1056 - 96 - 96 = 864

  it('empty document produces one empty page', () => {
    const layout: DocumentLayout = { blocks: [], totalHeight: 0, blockParentMap: new Map() };
    const result = paginateLayout(layout, setup);
    expect(result.pages).toHaveLength(1);
    expect(result.pages[0].lines).toHaveLength(0);
  });

  it('single line fits on one page', () => {
    const block = mockBlock('b1', [mockLine(24)]);
    const layout: DocumentLayout = { blocks: [block], totalHeight: 24, blockParentMap: new Map() };
    const result = paginateLayout(layout, setup);
    expect(result.pages).toHaveLength(1);
    expect(result.pages[0].lines).toHaveLength(1);
    expect(result.pages[0].lines[0].y).toBe(96); // margins.top
  });

  it('lines overflow to second page', () => {
    const lines = Array.from({ length: 9 }, () => mockLine(100));
    const block = mockBlock('b1', lines, 0, 0);
    const layout: DocumentLayout = { blocks: [block], totalHeight: 900, blockParentMap: new Map() };
    const result = paginateLayout(layout, setup);
    expect(result.pages).toHaveLength(2);
    expect(result.pages[0].lines).toHaveLength(8);
    expect(result.pages[1].lines).toHaveLength(1);
  });

  it('skips marginTop at page top', () => {
    const lines1 = Array.from({ length: 8 }, () => mockLine(108));
    const block1 = mockBlock('b1', lines1, 0, 0);
    const block2 = mockBlock('b2', [mockLine(24)], 20, 0);
    const layout: DocumentLayout = {
      blocks: [block1, block2],
      totalHeight: 908,
      blockParentMap: new Map(),
    };
    const result = paginateLayout(layout, setup);
    expect(result.pages).toHaveLength(2);
    expect(result.pages[1].lines[0].y).toBe(96); // marginTop skipped
  });

  it('landscape swaps dimensions', () => {
    const landscapeSetup = {
      ...DEFAULT_PAGE_SETUP,
      orientation: 'landscape' as const,
    };
    const lines = Array.from({ length: 7 }, () => mockLine(100));
    const block = mockBlock('b1', lines, 0, 0);
    const layout: DocumentLayout = { blocks: [block], totalHeight: 700, blockParentMap: new Map() };
    const result = paginateLayout(layout, landscapeSetup);
    expect(result.pages).toHaveLength(2);
    expect(result.pages[0].lines).toHaveLength(6);
    expect(result.pages[1].lines).toHaveLength(1);
  });

  it('oversized line gets its own page', () => {
    const block = mockBlock('b1', [mockLine(900)], 0, 0);
    const layout: DocumentLayout = { blocks: [block], totalHeight: 900, blockParentMap: new Map() };
    const result = paginateLayout(layout, setup);
    expect(result.pages).toHaveLength(1);
    expect(result.pages[0].lines).toHaveLength(1);
  });

  it('page dimensions match effective paper size', () => {
    const layout: DocumentLayout = { blocks: [], totalHeight: 0, blockParentMap: new Map() };
    const result = paginateLayout(layout, setup);
    expect(result.pages[0].width).toBe(816);
    expect(result.pages[0].height).toBe(1056);
  });

  it('applies marginBottom only on the last page of a split block', () => {
    const lines = Array.from({ length: 9 }, () => mockLine(100));
    const block1 = mockBlock('b1', lines, 0, 20);
    const block2 = mockBlock('b2', [mockLine(24)], 0, 0);
    const layout: DocumentLayout = {
      blocks: [block1, block2],
      totalHeight: 924,
      blockParentMap: new Map(),
    };
    const result = paginateLayout(layout, setup);
    expect(result.pages).toHaveLength(2);
    const block2Line = result.pages[1].lines.find(pl => pl.blockIndex === 1);
    expect(block2Line).toBeDefined();
    expect(block2Line!.y).toBe(96 + 100 + 20); // margins.top + line9 + marginBottom
  });
});

describe('getPageYOffset', () => {
  it('computes correct Y offset for each page', () => {
    const layout: DocumentLayout = { blocks: [], totalHeight: 0, blockParentMap: new Map() };
    const paginated = paginateLayout(layout, DEFAULT_PAGE_SETUP);
    expect(getPageYOffset(paginated, 0)).toBe(40); // pageGap
  });
});

describe('getTotalHeight', () => {
  it('accounts for all pages and gaps', () => {
    const layout: DocumentLayout = { blocks: [], totalHeight: 0, blockParentMap: new Map() };
    const paginated = paginateLayout(layout, DEFAULT_PAGE_SETUP);
    expect(getTotalHeight(paginated)).toBe(1136); // 40 + 1056 + 40
  });

  it('multi-page height is correct', () => {
    const lines = Array.from({ length: 9 }, () => mockLine(100));
    const block = mockBlock('b1', lines, 0, 0);
    const layout: DocumentLayout = { blocks: [block], totalHeight: 900, blockParentMap: new Map() };
    const paginated = paginateLayout(layout, DEFAULT_PAGE_SETUP);
    expect(getTotalHeight(paginated)).toBe(2232); // 40 + 1056 + 40 + 1056 + 40
  });
});

describe('findPageForPosition', () => {
  it('finds position on first page', () => {
    const block = mockBlock('b1', [mockLine(24)]);
    const layout: DocumentLayout = { blocks: [block], totalHeight: 24, blockParentMap: new Map() };
    const paginated = paginateLayout(layout, DEFAULT_PAGE_SETUP);
    const found = findPageForPosition(paginated, 'b1', 0, layout);
    expect(found).toBeDefined();
    expect(found!.pageIndex).toBe(0);
  });

  it('returns undefined for unknown blockId', () => {
    const layout: DocumentLayout = { blocks: [], totalHeight: 0, blockParentMap: new Map() };
    const paginated = paginateLayout(layout, DEFAULT_PAGE_SETUP);
    const found = findPageForPosition(paginated, 'unknown', 0, layout);
    expect(found).toBeUndefined();
  });
});

describe('paginatedPixelToPosition', () => {
  it('maps click in page content area', () => {
    const block = mockBlock('b1', [mockLine(24)]);
    const layout: DocumentLayout = { blocks: [block], totalHeight: 24, blockParentMap: new Map() };
    const paginated = paginateLayout(layout, DEFAULT_PAGE_SETUP);
    // Click inside page 1 content area
    // pageY = 40 (gap), content starts at 40 + 96 (margin) = 136
    const result = paginatedPixelToPosition(paginated, layout, 400, 150, 816);
    expect(result).toBeDefined();
    expect(result!.blockId).toBe('b1');
  });

  it('maps click in page gap to nearest page', () => {
    const block = mockBlock('b1', [mockLine(24)]);
    const layout: DocumentLayout = { blocks: [block], totalHeight: 24, blockParentMap: new Map() };
    const paginated = paginateLayout(layout, DEFAULT_PAGE_SETUP);
    const result = paginatedPixelToPosition(paginated, layout, 400, 10, 816);
    expect(result).toBeDefined();
    expect(result!.blockId).toBe('b1');
  });
});

function mockPageBreakBlock(id: string): LayoutBlock {
  return {
    block: {
      id,
      type: 'page-break',
      inlines: [],
      style: { alignment: 'left' as const, lineHeight: 1.5, marginTop: 0, marginBottom: 0, textIndent: 0, marginLeft: 0 },
    },
    x: 0,
    y: 0,
    width: 624,
    height: 20,
    lines: [{ runs: [], y: 0, height: 20, width: 624 }],
  };
}

describe('paginateLayout — page-break', () => {
  const setup = DEFAULT_PAGE_SETUP;

  it('page-break forces content after it onto next page', () => {
    const b1 = mockBlock('b1', [mockLine(24)]);
    const pb = mockPageBreakBlock('pb');
    const b2 = mockBlock('b2', [mockLine(24)]);
    const layout: DocumentLayout = {
      blocks: [b1, pb, b2],
      totalHeight: 68,
      blockParentMap: new Map(),
    };
    const result = paginateLayout(layout, setup);
    expect(result.pages).toHaveLength(2);
    // Page 1: b1 line + page-break line
    expect(result.pages[0].lines).toHaveLength(2);
    expect(result.pages[0].lines[0].blockIndex).toBe(0);
    expect(result.pages[0].lines[1].blockIndex).toBe(1);
    // Page 2: b2 line
    expect(result.pages[1].lines).toHaveLength(1);
    expect(result.pages[1].lines[0].blockIndex).toBe(2);
  });

  it('page-break at start of document creates empty first page with only the break', () => {
    const pb = mockPageBreakBlock('pb');
    const b1 = mockBlock('b1', [mockLine(24)]);
    const layout: DocumentLayout = {
      blocks: [pb, b1],
      totalHeight: 44,
      blockParentMap: new Map(),
    };
    const result = paginateLayout(layout, setup);
    expect(result.pages).toHaveLength(2);
    expect(result.pages[0].lines).toHaveLength(1); // page-break line
    expect(result.pages[1].lines).toHaveLength(1); // b1
  });

  it('consecutive page-breaks create one page per break', () => {
    const pb1 = mockPageBreakBlock('pb1');
    const pb2 = mockPageBreakBlock('pb2');
    const b1 = mockBlock('b1', [mockLine(24)]);
    const layout: DocumentLayout = {
      blocks: [pb1, pb2, b1],
      totalHeight: 64,
      blockParentMap: new Map(),
    };
    const result = paginateLayout(layout, setup);
    expect(result.pages).toHaveLength(3);
    expect(result.pages[0].lines).toHaveLength(1); // pb1
    expect(result.pages[1].lines).toHaveLength(1); // pb2
    expect(result.pages[2].lines).toHaveLength(1); // b1
  });
});

describe('paginatedPixelToPosition — charOffsets', () => {
  const setup = DEFAULT_PAGE_SETUP;
  // margins.left = 96, pageXOffset for canvasWidth=816 is 0

  it('snaps to correct character with proportional widths', () => {
    // "Wii": W=14px, i=4px, i=4px → charOffsets=[14, 18, 22]
    const run = mockRun('Wii', 0, [14, 18, 22]);
    const line = mockLineWithRuns([run]);
    const block = mockBlock('b1', [line]);
    const layout: DocumentLayout = { blocks: [block], totalHeight: 24, blockParentMap: new Map() };
    const paginated = paginateLayout(layout, setup);

    // Click at x=96+5 → inside 'W' (0-14px range), should be offset 0 (closer to 0 than 14)
    const r1 = paginatedPixelToPosition(paginated, layout, 96 + 5, 136, 816);
    expect(r1!.offset).toBe(0);

    // Click at x=96+10 → inside 'W' (0-14px range), should be offset 1 (closer to 14 than 0)
    const r2 = paginatedPixelToPosition(paginated, layout, 96 + 10, 136, 816);
    expect(r2!.offset).toBe(1);

    // Click at x=96+15 → inside first 'i' (14-18px range), should be offset 1 (closer to 14 than 18)
    const r3 = paginatedPixelToPosition(paginated, layout, 96 + 15, 136, 816);
    expect(r3!.offset).toBe(1);

    // Click at x=96+17 → inside first 'i' (14-18px range), should be offset 2 (closer to 18 than 14)
    const r4 = paginatedPixelToPosition(paginated, layout, 96 + 17, 136, 816);
    expect(r4!.offset).toBe(2);
  });

  it('clicking past end of run returns end offset', () => {
    const run = mockRun('ab', 0, [10, 20]);
    const line = mockLineWithRuns([run]);
    const block = mockBlock('b1', [line]);
    const layout: DocumentLayout = { blocks: [block], totalHeight: 24, blockParentMap: new Map() };
    const paginated = paginateLayout(layout, setup);

    // Click past the run width → falls through to "past end of line" path
    const r = paginatedPixelToPosition(paginated, layout, 96 + 25, 136, 816);
    expect(r!.offset).toBe(2);
  });

  it('clicking at x=0 in run returns offset 0', () => {
    const run = mockRun('abc', 0, [8, 16, 24]);
    const line = mockLineWithRuns([run]);
    const block = mockBlock('b1', [line]);
    const layout: DocumentLayout = { blocks: [block], totalHeight: 24, blockParentMap: new Map() };
    const paginated = paginateLayout(layout, setup);

    const r = paginatedPixelToPosition(paginated, layout, 96, 136, 816);
    expect(r!.offset).toBe(0);
  });

  it('handles multi-run lines correctly', () => {
    // "He" (bold, 20px) + "llo" (normal, 15px)
    const run1 = mockRun('He', 0, [12, 20], 0);
    const run2 = mockRun('llo', 20, [5, 10, 15], 2);
    const line = mockLineWithRuns([run1, run2]);
    const block = mockBlock('b1', [line]);
    const layout: DocumentLayout = { blocks: [block], totalHeight: 24, blockParentMap: new Map() };
    const paginated = paginateLayout(layout, setup);

    // Click at x=96+22 → inside run2 at localRunX=2, charOffsets=[5,10,15]
    // Closest to 0 (prev of index 0), so offset = 0 in run2 → global offset 2
    const r = paginatedPixelToPosition(paginated, layout, 96 + 22, 136, 816);
    expect(r!.offset).toBe(2);
  });
});
