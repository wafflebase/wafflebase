// packages/docs/src/store/block-helpers.ts
import type { Block, Inline } from '../model/types.js';
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

function cloneBlock(block: Block): Block {
  return JSON.parse(JSON.stringify(block));
}
