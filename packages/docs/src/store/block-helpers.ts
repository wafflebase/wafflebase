// packages/docs/src/store/block-helpers.ts
import type { Block, Inline, InlineStyle, BlockType } from '../model/types.js';
import { inlineStylesEqual } from '../model/types.js';

export interface InlinePosition {
  inlineIndex: number;
  charOffset: number;
}

export interface InlineSegment {
  inlineIndex: number;
  charFrom: number;
  charTo: number;
}

/**
 * Resolve a block-level character offset to an inline index + char offset.
 */
export function resolveOffset(block: Block, offset: number): InlinePosition {
  let remaining = offset;
  for (let i = 0; i < block.inlines.length; i++) {
    const len = block.inlines[i].text.length;
    if (remaining <= len) {
      return { inlineIndex: i, charOffset: remaining };
    }
    remaining -= len;
  }
  const last = block.inlines.length - 1;
  return { inlineIndex: last, charOffset: block.inlines[last].text.length };
}

/**
 * Resolve a delete range (offset + length) into per-inline segments.
 * Segments are returned in forward order (inline[0] first).
 */
export function resolveDeleteRange(
  block: Block,
  offset: number,
  length: number,
): InlineSegment[] {
  const segments: InlineSegment[] = [];
  let remaining = length;
  let pos = 0;

  for (let i = 0; i < block.inlines.length && remaining > 0; i++) {
    const inlineLen = block.inlines[i].text.length;
    const inlineEnd = pos + inlineLen;

    if (offset >= inlineEnd) {
      pos = inlineEnd;
      continue;
    }

    const charFrom = Math.max(0, offset - pos);
    const available = inlineLen - charFrom;
    const charTo = charFrom + Math.min(remaining, available);

    segments.push({ inlineIndex: i, charFrom, charTo });
    remaining -= charTo - charFrom;
    pos = inlineEnd;
  }

  return segments;
}

/**
 * Merge adjacent inlines with identical styles and remove empty inlines.
 * Always returns at least one inline.
 */
export function normalizeInlines(inlines: Inline[]): Inline[] {
  const merged: Inline[] = [];
  for (const inline of inlines) {
    if (inline.text.length === 0) continue;
    const last = merged[merged.length - 1];
    if (last && inlineStylesEqual(last.style, inline.style)) {
      last.text += inline.text;
    } else {
      merged.push({ text: inline.text, style: { ...inline.style } });
    }
  }
  return merged.length > 0
    ? merged
    : [{ text: '', style: inlines[0]?.style ?? {} }];
}

/**
 * Insert text at block-level offset. Returns a new Block (pure function).
 */
export function applyInsertText(block: Block, offset: number, text: string): Block {
  const newBlock = cloneBlock(block);
  const { inlineIndex, charOffset } = resolveOffset(newBlock, offset);
  const inline = newBlock.inlines[inlineIndex];
  inline.text =
    inline.text.slice(0, charOffset) + text + inline.text.slice(charOffset);
  return newBlock;
}

/**
 * Delete `length` characters starting at block-level offset. Returns new Block.
 */
export function applyDeleteText(block: Block, offset: number, length: number): Block {
  const newBlock = cloneBlock(block);
  const segments = resolveDeleteRange(newBlock, offset, length);

  // Delete in reverse order to preserve earlier indices
  for (let i = segments.length - 1; i >= 0; i--) {
    const seg = segments[i];
    const inline = newBlock.inlines[seg.inlineIndex];
    inline.text =
      inline.text.slice(0, seg.charFrom) + inline.text.slice(seg.charTo);
  }

  newBlock.inlines = normalizeInlines(newBlock.inlines);
  return newBlock;
}

export function cloneBlock(block: Block): Block {
  return JSON.parse(JSON.stringify(block));
}

/**
 * Resolve a style range [from, to) into per-inline segments.
 */
export function resolveStyleRange(
  block: Block,
  from: number,
  to: number,
): InlineSegment[] {
  return resolveDeleteRange(block, from, to - from);
}

/**
 * Get the inline style at a split point so empty sides preserve formatting.
 */
function getSplitPointStyle(inlines: Inline[], offset: number): InlineStyle {
  const { inlineIndex } = resolveOffset({ inlines } as Block, offset);
  return { ...inlines[inlineIndex].style };
}

/**
 * Split a block at offset. Returns [beforeBlock, afterBlock].
 * The afterBlock gets the new id and type.
 */
export function applySplitBlock(
  block: Block,
  offset: number,
  newBlockId: string,
  newBlockType: BlockType,
): [Block, Block] {
  const before = cloneBlock(block);
  const after = cloneBlock(block);
  after.id = newBlockId;
  after.type = newBlockType;

  const beforeInlines: Inline[] = [];
  const afterInlines: Inline[] = [];
  let pos = 0;

  for (const inline of block.inlines) {
    const inlineEnd = pos + inline.text.length;

    if (inlineEnd <= offset) {
      beforeInlines.push({ text: inline.text, style: { ...inline.style } });
    } else if (pos >= offset) {
      afterInlines.push({ text: inline.text, style: { ...inline.style } });
    } else {
      const splitAt = offset - pos;
      beforeInlines.push({
        text: inline.text.slice(0, splitAt),
        style: { ...inline.style },
      });
      afterInlines.push({
        text: inline.text.slice(splitAt),
        style: { ...inline.style },
      });
    }
    pos = inlineEnd;
  }

  // Preserve the style at the split point for empty sides
  const splitStyle = getSplitPointStyle(block.inlines, offset);
  before.inlines = normalizeInlines(beforeInlines.length > 0 ? beforeInlines : [{ text: '', style: splitStyle }]);
  after.inlines = normalizeInlines(afterInlines.length > 0 ? afterInlines : [{ text: '', style: splitStyle }]);

  // Remove block-specific attrs from after block
  delete after.tableData;
  delete after.headingLevel;
  // Preserve list attrs when the new block is also a list-item
  if (newBlockType !== 'list-item') {
    delete after.listKind;
    delete after.listLevel;
  }

  return [before, after];
}

/**
 * Merge nextBlock into block. Returns the merged block.
 */
export function applyMergeBlocks(block: Block, nextBlock: Block): Block {
  const merged = cloneBlock(block);
  const nextClone = cloneBlock(nextBlock);
  merged.inlines = normalizeInlines([...merged.inlines, ...nextClone.inlines]);
  return merged;
}

/**
 * Apply inline style to a range within a block. Returns new Block.
 * Splits inlines as needed and normalizes the result.
 */
export function applyInlineStyle(
  block: Block,
  from: number,
  to: number,
  style: Partial<InlineStyle>,
): Block {
  // Enforce mutual exclusion: superscript and subscript cannot coexist
  const resolvedStyle: Partial<InlineStyle> = { ...style };
  if (resolvedStyle.superscript) {
    resolvedStyle.subscript = undefined;
  } else if (resolvedStyle.subscript) {
    resolvedStyle.superscript = undefined;
  }

  const newBlock = cloneBlock(block);
  const newInlines: Inline[] = [];
  let pos = 0;

  for (const inline of newBlock.inlines) {
    const inlineEnd = pos + inline.text.length;

    if (inlineEnd <= from || pos >= to) {
      newInlines.push({ text: inline.text, style: { ...inline.style } });
    } else {
      const overlapStart = Math.max(0, from - pos);
      const overlapEnd = Math.min(inline.text.length, to - pos);

      if (overlapStart > 0) {
        newInlines.push({
          text: inline.text.slice(0, overlapStart),
          style: { ...inline.style },
        });
      }

      newInlines.push({
        text: inline.text.slice(overlapStart, overlapEnd),
        style: { ...inline.style, ...resolvedStyle },
      });

      if (overlapEnd < inline.text.length) {
        newInlines.push({
          text: inline.text.slice(overlapEnd),
          style: { ...inline.style },
        });
      }
    }
    pos = inlineEnd;
  }

  newBlock.inlines = normalizeInlines(newInlines);
  return newBlock;
}
