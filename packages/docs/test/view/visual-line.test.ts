import { describe, it, expect } from 'vitest';
import { findVisualLine } from '../../src/view/visual-line.js';
import type { LayoutBlock, LayoutLine, LayoutRun } from '../../src/view/layout.js';
import type { Block, Inline } from '../../src/model/types.js';
import { DEFAULT_BLOCK_STYLE } from '../../src/model/types.js';

/**
 * Helper to build a minimal LayoutBlock with the given line char ranges.
 * Each entry in `lineRanges` is [charStart, charEnd].
 */
function makeLayoutBlock(
  blockId: string,
  lineRanges: [number, number][],
): LayoutBlock {
  const block: Block = {
    id: blockId,
    type: 'paragraph',
    inlines: [{ text: 'x'.repeat(lineRanges[lineRanges.length - 1]?.[1] ?? 0), style: {} } as Inline],
    style: { ...DEFAULT_BLOCK_STYLE },
  };
  const lines: LayoutLine[] = lineRanges.map(([start, end], i) => ({
    runs: [{ charStart: start, charEnd: end, x: 0, width: 100, text: '', inlineIndex: 0, inline: block.inlines[0] } as LayoutRun],
    y: i * 20,
    height: 20,
    width: 100,
  }));
  return { block, x: 0, y: 0, width: 100, height: lines.length * 20, lines };
}

describe('findVisualLine', () => {
  const lb = makeLayoutBlock('b1', [[0, 10], [10, 20], [20, 25]]);

  it('returns line index and total lines for a position on the first line', () => {
    const result = findVisualLine(lb, { blockId: 'b1', offset: 5 });
    expect(result).toEqual({ lineIndex: 0, totalLines: 3, lineStart: 0, lineEnd: 10 });
  });

  it('returns line index for a position on the second line', () => {
    const result = findVisualLine(lb, { blockId: 'b1', offset: 15 });
    expect(result).toEqual({ lineIndex: 1, totalLines: 3, lineStart: 10, lineEnd: 20 });
  });

  it('returns last line for a position on the last line', () => {
    const result = findVisualLine(lb, { blockId: 'b1', offset: 22 });
    expect(result).toEqual({ lineIndex: 2, totalLines: 3, lineStart: 20, lineEnd: 25 });
  });

  it('handles position at line boundary (belongs to next line)', () => {
    // offset 10 is the start of line 2 — should map to line index 1
    const result = findVisualLine(lb, { blockId: 'b1', offset: 10 });
    expect(result).toEqual({ lineIndex: 1, totalLines: 3, lineStart: 10, lineEnd: 20 });
  });

  it('handles position at end of last line', () => {
    const result = findVisualLine(lb, { blockId: 'b1', offset: 25 });
    expect(result).toEqual({ lineIndex: 2, totalLines: 3, lineStart: 20, lineEnd: 25 });
  });

  it('handles single-line block', () => {
    const single = makeLayoutBlock('b2', [[0, 5]]);
    const result = findVisualLine(single, { blockId: 'b2', offset: 3 });
    expect(result).toEqual({ lineIndex: 0, totalLines: 1, lineStart: 0, lineEnd: 5 });
  });

  it('returns undefined for empty block', () => {
    const empty = makeLayoutBlock('b3', []);
    const result = findVisualLine(empty, { blockId: 'b3', offset: 0 });
    expect(result).toBeUndefined();
  });
});
