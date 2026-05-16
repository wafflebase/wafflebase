import {
  getBlockText,
  resolveOffset,
} from '@wafflebase/docs';
import type {
  Block,
  DocPosition,
  DocRange,
  Document,
} from '@wafflebase/docs';
import type { Tree } from '@yorkie-js/sdk';
import type { DocsRangeAnchor } from '@/types/comments.ts';

const DEFAULT_QUOTED_MAX_CHARS = 240;

export type { DocsRangeAnchor };

export interface AnchorContext {
  blockId: string;
  quotedText: string;
}

export type ResolvedAnchor =
  | { kind: 'live'; startPath: number[]; endPath: number[] }
  | { kind: 'orphan' };

/**
 * Translate a DocPosition into a full Yorkie Tree path ending in
 * `[..., blockIdx, inlineIdx, charOffset]`. Handles body / header /
 * footer regions and (recursively) blocks inside table cells, matching
 * the path shape `YorkieDocStore.resolveBlockTreePath` produces.
 *
 * Returns null when the block id is not present anywhere in the doc.
 */
export function docPositionToTreePath(
  doc: Document,
  pos: DocPosition,
): number[] | null {
  const found = findBlockPathInDoc(doc, pos.blockId);
  if (!found) return null;
  const { block, path: prefix } = found;
  const { inlineIndex, charOffset } = resolveOffset(block, pos.offset);
  return [...prefix, inlineIndex, charOffset];
}

/**
 * Reverse of `docPositionToTreePath`. The last two path components are
 * the inline index and character offset; everything before them is the
 * path to the block element, which we walk the Document model to find.
 * Returns null when any component is out of range.
 */
export function pathToDocPosition(
  doc: Document,
  path: number[],
): DocPosition | null {
  if (path.length < 3) return null;
  const blockPath = path.slice(0, -2);
  const inlineIdx = path[path.length - 2];
  const charOffset = path[path.length - 1];

  const block = findBlockByTreePath(doc, blockPath);
  if (!block) return null;

  let offset = 0;
  const limit = Math.min(inlineIdx, block.inlines.length);
  for (let i = 0; i < limit; i++) {
    offset += block.inlines[i].text.length;
  }
  return { blockId: block.id, offset: offset + charOffset };
}

/**
 * Capture `{ blockId, quotedText }` for a DocRange. quotedText is the text
 * inside the range, capped at `maxChars` chars with an ellipsis when
 * truncated. blockId is taken from the normalized start position.
 */
export function extractAnchorContext(
  doc: Document,
  range: DocRange,
  maxChars: number = DEFAULT_QUOTED_MAX_CHARS,
): AnchorContext {
  const [start, end] = orderRange(doc, range);

  const startIdx = doc.blocks.findIndex((b) => b.id === start.blockId);
  if (startIdx < 0) {
    // Block in header/footer/table — fall back to a single-block slice
    // from the resolved block, which `findBlockPathInDoc` can locate.
    const found = findBlockPathInDoc(doc, start.blockId);
    if (!found) return { blockId: start.blockId, quotedText: '' };
    const single = blockSlice(found.block, start.offset, end.offset);
    return {
      blockId: start.blockId,
      quotedText: truncate(single, maxChars),
    };
  }
  const endIdx = doc.blocks.findIndex((b) => b.id === end.blockId);

  const text = endIdx === startIdx
    ? blockSlice(doc.blocks[startIdx], start.offset, end.offset)
    : joinAcrossBlocks(doc.blocks, startIdx, start.offset, endIdx, end.offset);

  return { blockId: start.blockId, quotedText: truncate(text, maxChars) };
}

/**
 * Resolve a docs-range anchor against the current tree state.
 *
 * Returns `orphan` when the SDK either throws (rare in current SDK
 * versions) or returns a degraded path. A text-level position always has
 * at least 3 components — `[..., blockIdx, inlineIdx, charOffset]`. When
 * the SDK collapses both endpoints onto a deleted node's tomb it
 * returns a shorter path (e.g. `[blockIdx]`), which is the
 * post-deletion signal we key on.
 */
export function resolveDocsAnchor(
  tree: Pick<Tree, 'posRangeToPathRange'>,
  anchor: DocsRangeAnchor,
): ResolvedAnchor {
  try {
    const [startPath, endPath] = tree.posRangeToPathRange(anchor.posRange);
    if (startPath.length < 3 || endPath.length < 3) {
      return { kind: 'orphan' };
    }
    return { kind: 'live', startPath, endPath };
  } catch {
    return { kind: 'orphan' };
  }
}

// ---------- internal helpers ----------

function orderRange(
  doc: Document,
  range: DocRange,
): [DocPosition, DocPosition] {
  const ai = doc.blocks.findIndex((b) => b.id === range.anchor.blockId);
  const fi = doc.blocks.findIndex((b) => b.id === range.focus.blockId);
  if (ai !== fi) return ai < fi ? [range.anchor, range.focus] : [range.focus, range.anchor];
  return range.anchor.offset <= range.focus.offset
    ? [range.anchor, range.focus]
    : [range.focus, range.anchor];
}

function blockSlice(block: Block, from: number, to: number): string {
  return getBlockText(block).slice(from, to);
}

function joinAcrossBlocks(
  blocks: Block[],
  startIdx: number,
  startOffset: number,
  endIdx: number,
  endOffset: number,
): string {
  const parts: string[] = [];
  parts.push(getBlockText(blocks[startIdx]).slice(startOffset));
  for (let i = startIdx + 1; i < endIdx; i++) {
    parts.push(getBlockText(blocks[i]));
  }
  if (endIdx > startIdx) {
    parts.push(getBlockText(blocks[endIdx]).slice(0, endOffset));
  }
  return parts.join('\n');
}

function truncate(text: string, maxChars: number): string {
  if (maxChars <= 0) return '';
  if (text.length <= maxChars) return text;
  return text.slice(0, maxChars - 1) + '…';
}

/**
 * Locate a block in the Document model and return the path the Yorkie
 * Tree uses to address it (matching `YorkieDocStore.resolveBlockTreePath`):
 *   - Header block:     [0, blockIdx]
 *   - Body block:       [blockIdx + bodyOffset]
 *   - Footer block:     [footerTreeIdx, blockIdx]
 *   - Table cell block: [...containing-block-path, rowIdx, cellIdx, blockIdx]
 *     (recursively for nested tables)
 * `bodyOffset` is 1 when a header is present, 0 otherwise.
 */
function findBlockPathInDoc(
  doc: Document,
  blockId: string,
): { block: Block; path: number[] } | null {
  if (doc.header) {
    for (let i = 0; i < doc.header.blocks.length; i++) {
      const b = doc.header.blocks[i];
      if (b.id === blockId) return { block: b, path: [0, i] };
      const sub = findBlockInTableByPath(b, blockId);
      if (sub) return { block: sub.block, path: [0, i, ...sub.path] };
    }
  }
  const bodyOffset = doc.header ? 1 : 0;
  for (let i = 0; i < doc.blocks.length; i++) {
    const b = doc.blocks[i];
    if (b.id === blockId) return { block: b, path: [i + bodyOffset] };
    const sub = findBlockInTableByPath(b, blockId);
    if (sub) return { block: sub.block, path: [i + bodyOffset, ...sub.path] };
  }
  if (doc.footer) {
    const footerTreeIdx = bodyOffset + doc.blocks.length;
    for (let i = 0; i < doc.footer.blocks.length; i++) {
      const b = doc.footer.blocks[i];
      if (b.id === blockId) return { block: b, path: [footerTreeIdx, i] };
      const sub = findBlockInTableByPath(b, blockId);
      if (sub) return { block: sub.block, path: [footerTreeIdx, i, ...sub.path] };
    }
  }
  return null;
}

function findBlockInTableByPath(
  parent: Block,
  blockId: string,
): { block: Block; path: number[] } | null {
  if (parent.type !== 'table' || !parent.tableData) return null;
  const rows = parent.tableData.rows;
  for (let r = 0; r < rows.length; r++) {
    const row = rows[r];
    for (let c = 0; c < row.cells.length; c++) {
      const cell = row.cells[c];
      for (let b = 0; b < cell.blocks.length; b++) {
        const blk = cell.blocks[b];
        if (blk.id === blockId) return { block: blk, path: [r, c, b] };
        const nested = findBlockInTableByPath(blk, blockId);
        if (nested) return { block: nested.block, path: [r, c, b, ...nested.path] };
      }
    }
  }
  return null;
}

/**
 * Walk the Document model along a tree path that points at a block
 * element (no inline / char-offset components). Mirrors how
 * `findBlockPathInDoc` constructs the path; any divergence means a
 * stale path and we return null.
 */
function findBlockByTreePath(doc: Document, path: number[]): Block | null {
  if (path.length === 0) return null;
  const bodyOffset = doc.header ? 1 : 0;

  if (doc.header && path[0] === 0) {
    if (path.length < 2) return null;
    return descendTablePath(doc.header.blocks, path, 1);
  }
  if (doc.footer && path[0] === bodyOffset + doc.blocks.length) {
    if (path.length < 2) return null;
    return descendTablePath(doc.footer.blocks, path, 1);
  }

  const bIdx = path[0] - bodyOffset;
  if (bIdx < 0 || bIdx >= doc.blocks.length) return null;
  return descendTablePath(doc.blocks, [bIdx, ...path.slice(1)], 0);
}

function descendTablePath(
  blocks: Block[],
  path: number[],
  pathStart: number,
): Block | null {
  const idx = path[pathStart];
  if (idx < 0 || idx >= blocks.length) return null;
  let block: Block = blocks[idx];
  let i = pathStart + 1;
  while (i < path.length) {
    if (block.type !== 'table' || !block.tableData) return null;
    if (path.length - i < 3) return null;
    const row = block.tableData.rows[path[i]];
    if (!row) return null;
    const cell = row.cells[path[i + 1]];
    if (!cell) return null;
    const next = cell.blocks[path[i + 2]];
    if (!next) return null;
    block = next;
    i += 3;
  }
  return block;
}
