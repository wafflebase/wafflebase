import { describe, it, expect } from 'vitest';
import {
  paginateLayout,
  getPageYOffset,
  getTotalHeight,
  findPageForPosition,
  paginatedPixelToPosition,
} from '../../src/view/pagination.js';
import { DEFAULT_PAGE_SETUP } from '../../src/model/types.js';
import type { DocumentLayout, LayoutBlock, LayoutLine } from '../../src/view/layout.js';

function mockLine(height: number): LayoutLine {
  return { runs: [], y: 0, height, width: 100 };
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
    const layout: DocumentLayout = { blocks: [], totalHeight: 0 };
    const result = paginateLayout(layout, setup);
    expect(result.pages).toHaveLength(1);
    expect(result.pages[0].lines).toHaveLength(0);
  });

  it('single line fits on one page', () => {
    const block = mockBlock('b1', [mockLine(24)]);
    const layout: DocumentLayout = { blocks: [block], totalHeight: 24 };
    const result = paginateLayout(layout, setup);
    expect(result.pages).toHaveLength(1);
    expect(result.pages[0].lines).toHaveLength(1);
    expect(result.pages[0].lines[0].y).toBe(96); // margins.top
  });

  it('lines overflow to second page', () => {
    const lines = Array.from({ length: 9 }, () => mockLine(100));
    const block = mockBlock('b1', lines, 0, 0);
    const layout: DocumentLayout = { blocks: [block], totalHeight: 900 };
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
    const layout: DocumentLayout = { blocks: [block], totalHeight: 700 };
    const result = paginateLayout(layout, landscapeSetup);
    expect(result.pages).toHaveLength(2);
    expect(result.pages[0].lines).toHaveLength(6);
    expect(result.pages[1].lines).toHaveLength(1);
  });

  it('oversized line gets its own page', () => {
    const block = mockBlock('b1', [mockLine(900)], 0, 0);
    const layout: DocumentLayout = { blocks: [block], totalHeight: 900 };
    const result = paginateLayout(layout, setup);
    expect(result.pages).toHaveLength(1);
    expect(result.pages[0].lines).toHaveLength(1);
  });

  it('page dimensions match effective paper size', () => {
    const layout: DocumentLayout = { blocks: [], totalHeight: 0 };
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
    const layout: DocumentLayout = { blocks: [], totalHeight: 0 };
    const paginated = paginateLayout(layout, DEFAULT_PAGE_SETUP);
    expect(getPageYOffset(paginated, 0)).toBe(40); // pageGap
  });
});

describe('getTotalHeight', () => {
  it('accounts for all pages and gaps', () => {
    const layout: DocumentLayout = { blocks: [], totalHeight: 0 };
    const paginated = paginateLayout(layout, DEFAULT_PAGE_SETUP);
    expect(getTotalHeight(paginated)).toBe(1136); // 40 + 1056 + 40
  });

  it('multi-page height is correct', () => {
    const lines = Array.from({ length: 9 }, () => mockLine(100));
    const block = mockBlock('b1', lines, 0, 0);
    const layout: DocumentLayout = { blocks: [block], totalHeight: 900 };
    const paginated = paginateLayout(layout, DEFAULT_PAGE_SETUP);
    expect(getTotalHeight(paginated)).toBe(2232); // 40 + 1056 + 40 + 1056 + 40
  });
});

describe('findPageForPosition', () => {
  it('finds position on first page', () => {
    const block = mockBlock('b1', [mockLine(24)]);
    const layout: DocumentLayout = { blocks: [block], totalHeight: 24 };
    const paginated = paginateLayout(layout, DEFAULT_PAGE_SETUP);
    const found = findPageForPosition(paginated, 'b1', 0, layout);
    expect(found).toBeDefined();
    expect(found!.pageIndex).toBe(0);
  });

  it('returns undefined for unknown blockId', () => {
    const layout: DocumentLayout = { blocks: [], totalHeight: 0 };
    const paginated = paginateLayout(layout, DEFAULT_PAGE_SETUP);
    const found = findPageForPosition(paginated, 'unknown', 0, layout);
    expect(found).toBeUndefined();
  });
});

describe('paginatedPixelToPosition', () => {
  it('maps click in page content area', () => {
    const block = mockBlock('b1', [mockLine(24)]);
    const layout: DocumentLayout = { blocks: [block], totalHeight: 24 };
    const paginated = paginateLayout(layout, DEFAULT_PAGE_SETUP);
    // Click inside page 1 content area
    // pageY = 40 (gap), content starts at 40 + 96 (margin) = 136
    const result = paginatedPixelToPosition(paginated, layout, 400, 150, 816);
    expect(result).toBeDefined();
    expect(result!.blockId).toBe('b1');
  });

  it('maps click in page gap to nearest page', () => {
    const block = mockBlock('b1', [mockLine(24)]);
    const layout: DocumentLayout = { blocks: [block], totalHeight: 24 };
    const paginated = paginateLayout(layout, DEFAULT_PAGE_SETUP);
    const result = paginatedPixelToPosition(paginated, layout, 400, 10, 816);
    expect(result).toBeDefined();
    expect(result!.blockId).toBe('b1');
  });
});
