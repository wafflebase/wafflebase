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
 * Translate a DocPosition into a Yorkie Tree path
 * `[blockIdx, inlineIdx, charOffset]`. Top-level blocks only in this
 * iteration; table-cell paths (prefix `[tableIdx, rowIdx, cellIdx, ...]`)
 * are handled by a follow-up helper before the comments UI lands.
 *
 * Returns null when the block id is unknown.
 */
export function docPositionToTreePath(
  doc: Document,
  pos: DocPosition,
): number[] | null {
  const blockIdx = doc.blocks.findIndex((b) => b.id === pos.blockId);
  if (blockIdx < 0) return null;
  const { inlineIndex, charOffset } = resolveOffset(doc.blocks[blockIdx], pos.offset);
  return [blockIdx, inlineIndex, charOffset];
}

/**
 * Reverse of `docPositionToTreePath`. Translate a Yorkie Tree path
 * `[blockIdx, inlineIdx, charOffset]` back into a `DocPosition` against
 * the current document model. Missing tail components default to 0,
 * which matches Yorkie's behavior when an endpoint is at the start of a
 * block. Returns null when the block index is out of range.
 */
export function pathToDocPosition(
  doc: Document,
  path: number[],
): DocPosition | null {
  const blockIdx = path[0] ?? 0;
  const inlineIdx = path[1] ?? 0;
  const charOffset = path[2] ?? 0;
  const block = doc.blocks[blockIdx];
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
    return { blockId: start.blockId, quotedText: '' };
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
 * 3 components — `[blockIdx, inlineIdx, charOffset]`. When the SDK
 * collapses both endpoints onto a deleted node's tomb it returns a
 * shorter path (e.g. `[blockIdx]`), which is the post-deletion signal we
 * key on. Anything shorter than 3 components on either endpoint is
 * treated as orphan.
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
