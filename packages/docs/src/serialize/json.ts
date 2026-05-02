import type { Document } from '../model/types.js';
import type { PaginatedLayout } from '../view/pagination.js';

/**
 * Per-block page metadata attached by `serializeJson` when a paginated
 * layout is supplied. `lines` is the list of 1-based `pageIndex` values
 * for that block's lines, in order — a block whose three lines fall on
 * pages 1, 1, 2 yields `{ blockId, lines: [1, 1, 2] }`.
 *
 * Table blocks are represented at the row level: each entry in `lines`
 * corresponds to one logical row (the paginator emits one PageLine per
 * row, plus extra fragments when a row splits across pages — in which
 * case multiple entries share the same row index and pageIndex jumps).
 */
export interface BlockPageMeta {
  blockId: string;
  lines: number[];
}

/**
 * Result shape of `serializeJson`. Always a structural copy of `Document`;
 * `_pageMeta` is only present when the caller supplied a paginated layout.
 *
 * The `_` prefix marks this as transport metadata — it is not part of the
 * Yorkie-stored Document model, and importers/round-trippers should
 * strip it on the way back in.
 */
export interface SerializedJson extends Document {
  _pageMeta?: BlockPageMeta[];
}

/**
 * Serialize a `Document` to a JSON-friendly shape.
 *
 * - Without a paginated layout, returns the document untouched (well, a
 *   shallow copy with no `_pageMeta` field).
 * - With a paginated layout, attaches a top-level `_pageMeta` array of
 *   `{ blockId, lines: number[] }` so consumers (the CLI's page slicer,
 *   downstream tooling) can re-derive page boundaries without re-running
 *   pagination.
 *
 * Pagination is **not** run inside this function — the caller is
 * responsible for passing a `PaginatedLayout` already produced from the
 * same `Document`. Mismatched layout/document inputs would silently
 * produce nonsense `_pageMeta`; the function does not attempt to detect
 * that since it's a programming error, not a runtime condition.
 */
export function serializeJson(
  doc: Document,
  paginatedLayout?: PaginatedLayout,
): SerializedJson {
  if (!paginatedLayout) {
    return { ...doc };
  }

  // Group PageLine.pageIndex values by blockIndex, preserving page-by-page
  // and within-page order so the resulting `lines[]` reads in document
  // order (block-first, then line within the block).
  const linesByBlock = new Map<number, number[]>();
  for (const page of paginatedLayout.pages) {
    for (const pl of page.lines) {
      const bucket = linesByBlock.get(pl.blockIndex);
      if (bucket) {
        bucket.push(pl.pageIndex);
      } else {
        linesByBlock.set(pl.blockIndex, [pl.pageIndex]);
      }
    }
  }

  const pageMeta: BlockPageMeta[] = doc.blocks.map((block, i) => ({
    blockId: block.id,
    lines: linesByBlock.get(i) ?? [],
  }));

  return { ...doc, _pageMeta: pageMeta };
}
