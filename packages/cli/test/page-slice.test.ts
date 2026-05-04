import { describe, it, expect } from 'vitest';
import type {
  Block,
  Document,
  LayoutLine,
  LayoutPage,
  PageLine,
  PaginatedLayout,
} from '@wafflebase/docs';
import { DEFAULT_BLOCK_STYLE, DEFAULT_PAGE_SETUP } from '@wafflebase/docs';
import { sliceBlocksByPages } from '../src/docs/page-slice.js';
import type { PageRange } from '../src/docs/page-range.js';

function block(id: string, text: string): Block {
  return {
    id,
    type: 'paragraph',
    inlines: [{ text, style: {} }],
    style: { ...DEFAULT_BLOCK_STYLE },
  };
}

function pageLine(blockIndex: number, pageIndex: number): PageLine {
  const layoutLine: LayoutLine = { runs: [], y: 0, height: 16, width: 100 };
  return {
    blockIndex,
    lineIndex: 0,
    line: layoutLine,
    x: 0,
    y: 0,
    pageIndex,
  };
}

/**
 * Build a paginated layout where each `linesPerPage[i]` entry is the
 * list of `blockIndex` values that have a line on 1-based page `i+1`.
 * A block can appear on multiple pages — the slicer must collapse those
 * to a single output entry per block.
 */
function buildLayout(linesPerPage: number[][]): PaginatedLayout {
  const pages: LayoutPage[] = linesPerPage.map((blockIndices, i) => ({
    pageIndex: i,
    width: 800,
    height: 1000,
    lines: blockIndices.map((bi) => pageLine(bi, i + 1)),
  }));
  return { pages, pageSetup: { ...DEFAULT_PAGE_SETUP } };
}

function range(...pages: number[]): PageRange {
  return { pages: new Set(pages), warnings: [] };
}

describe('sliceBlocksByPages', () => {
  // 4 blocks (b0..b3), spread across 3 pages:
  //   page 1: b0, b1
  //   page 2: b1 (continued), b2
  //   page 3: b3
  const doc: Document = {
    blocks: [
      block('b0', 'first'),
      block('b1', 'spans pages 1-2'),
      block('b2', 'second-page-only'),
      block('b3', 'last-page-only'),
    ],
  };
  const layout = buildLayout([
    [0, 1], // page 1
    [1, 2], // page 2 (b1 line continues, b2 starts)
    [3],    // page 3
  ]);

  it('returns blocks whose lines intersect the requested pages', () => {
    const r = sliceBlocksByPages(doc, layout, range(1), 'md');
    expect(r.blocks.map((b) => b.id)).toEqual(['b0', 'b1']);
  });

  it('preserves document order across multi-page selections', () => {
    const r = sliceBlocksByPages(doc, layout, range(1, 2), 'md');
    expect(r.blocks.map((b) => b.id)).toEqual(['b0', 'b1', 'b2']);
  });

  it('includes a spanning block exactly once', () => {
    // b1 appears on both page 1 and page 2 — selecting both must not
    // duplicate it.
    const r = sliceBlocksByPages(doc, layout, range(1, 2), 'text');
    const ids = r.blocks.map((b) => b.id);
    expect(ids.filter((id) => id === 'b1')).toHaveLength(1);
  });

  it('includes a spanning block when only one of its pages is requested', () => {
    // Selecting page 2 alone still pulls b1 because it has a line there.
    const r = sliceBlocksByPages(doc, layout, range(2), 'md');
    expect(r.blocks.map((b) => b.id)).toEqual(['b1', 'b2']);
  });

  it('attaches pageMeta when format is json', () => {
    const r = sliceBlocksByPages(doc, layout, range(1, 2), 'json');
    expect(r.pageMeta).toBeDefined();
    expect(r.pageMeta).toEqual([
      { blockId: 'b0', lines: [1] },
      // b1 has a line on page 1 and page 2, so its lines list is [1, 2]
      { blockId: 'b1', lines: [1, 2] },
      { blockId: 'b2', lines: [2] },
    ]);
  });

  it('omits pageMeta for md and text formats', () => {
    expect(sliceBlocksByPages(doc, layout, range(1), 'md').pageMeta).toBeUndefined();
    expect(sliceBlocksByPages(doc, layout, range(1), 'text').pageMeta).toBeUndefined();
  });

  it('returns an empty result when no requested pages match', () => {
    const r = sliceBlocksByPages(doc, layout, range(99), 'md');
    expect(r.blocks).toEqual([]);
  });

  it('drops blocks with no layout lines', () => {
    const docWithGhost: Document = {
      blocks: [
        block('b0', 'on page 1'),
        block('b-ghost', 'never paginated'),
      ],
    };
    const layoutGhost = buildLayout([[0]]); // only b0
    const r = sliceBlocksByPages(docWithGhost, layoutGhost, range(1), 'md');
    expect(r.blocks.map((b) => b.id)).toEqual(['b0']);
  });
});
