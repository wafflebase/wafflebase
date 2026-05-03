import type {
  Block,
  BlockPageMeta,
  Document,
  PaginatedLayout,
} from '@wafflebase/docs';
import type { PageRange } from './page-range.js';

/**
 * Output formats supported by the CLI's `docs content --pages` flow.
 *
 * `'json'` keeps full structural fidelity and triggers `pageMeta`
 * emission so consumers can recover page boundaries without re-running
 * pagination. `'md'` and `'text'` drop the metadata since the
 * serializers themselves are page-blind — block selection alone is
 * enough.
 */
export type SliceFormat = 'json' | 'md' | 'text';

export interface PageSliceResult {
  /**
   * Subset of `doc.blocks` whose layout lines intersect the requested
   * pages, in original document order. A block that spans multiple
   * requested pages appears exactly once.
   */
  blocks: Block[];

  /**
   * Per-block 1-based page indices for the included blocks. Present
   * only when `format === 'json'` so the JSON serializer's `_pageMeta`
   * field stays accurate after slicing. Always in the same order as
   * `blocks`.
   */
  pageMeta?: BlockPageMeta[];
}

/**
 * Select the blocks of `doc` that participate in any of the pages named
 * by `range`, optionally producing per-block page metadata for the JSON
 * format. Block ordering matches `doc.blocks` — the slicer never
 * reorders content, only filters it.
 *
 * Selection rule (per `docs/design/docs-cli.md` §5.2): include any block
 * whose layout has at least one line on a requested page. Blocks emit
 * whole — there is no mid-block cut. A block that straddles the
 * boundary between a requested page and a non-requested one still
 * appears in the result, in full.
 *
 * Blocks with no layout lines (e.g., zero-height collapsed blocks the
 * paginator omitted) drop out entirely; if a future block type needs
 * "always include" semantics, the caller should pre-tag those blocks
 * before calling this function.
 */
export function sliceBlocksByPages(
  doc: Document,
  layout: PaginatedLayout,
  range: PageRange,
  format: SliceFormat,
): PageSliceResult {
  const wantedPages = range.pages;

  // Group all line pageIndices by blockIndex so we can both decide
  // inclusion and reuse the lookup for `pageMeta`. Walking pages in
  // order keeps the per-block `lines` list in document order.
  const linesByBlock = new Map<number, number[]>();
  for (const page of layout.pages) {
    for (const pl of page.lines) {
      const bucket = linesByBlock.get(pl.blockIndex);
      if (bucket) bucket.push(pl.pageIndex);
      else linesByBlock.set(pl.blockIndex, [pl.pageIndex]);
    }
  }

  const blocks: Block[] = [];
  const pageMeta: BlockPageMeta[] = [];

  for (let i = 0; i < doc.blocks.length; i++) {
    const lines = linesByBlock.get(i);
    if (!lines || lines.length === 0) continue;
    let intersects = false;
    for (const p of lines) {
      if (wantedPages.has(p)) {
        intersects = true;
        break;
      }
    }
    if (!intersects) continue;
    const block = doc.blocks[i];
    blocks.push(block);
    if (format === 'json') {
      pageMeta.push({ blockId: block.id, lines });
    }
  }

  return format === 'json' ? { blocks, pageMeta } : { blocks };
}
