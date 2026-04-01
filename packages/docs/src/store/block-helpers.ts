// packages/docs/src/store/block-helpers.ts
import type { Block } from '../model/types.js';

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
