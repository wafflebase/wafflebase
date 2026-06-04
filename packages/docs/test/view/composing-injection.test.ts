import { describe, it, expect } from 'vitest';
import {
  computeLayout,
  injectComposingInline,
  type ComposingContext,
} from '../../src/view/layout.js';
import { createBlock } from '../../src/model/types.js';
import type { LayoutBlock } from '../../src/view/layout.js';
import type { Inline } from '../../src/model/types.js';
import { stubMeasurer } from './_stub-measurer.js';

/** Concatenate the visible text of every run across a laid-out block. */
function blockText(lb: LayoutBlock): string {
  return lb.lines.flatMap((l) => l.runs.map((r) => r.text)).join('');
}

describe('injectComposingInline', () => {
  it('splices composing text mid-inline, splitting the inline', () => {
    const inlines: Inline[] = [{ text: 'ABCD', style: {} }];
    const result = injectComposingInline(inlines, 2, 'X');
    expect(result.map((i) => i.text)).toEqual(['AB', 'X', 'CD']);
  });

  it('inherits the style at the insertion point (left-biased at a boundary)', () => {
    const inlines: Inline[] = [
      { text: 'AB', style: { bold: true } },
      { text: 'CD', style: { italic: true } },
    ];
    // Offset 2 is the boundary; left bias means the composing text inherits
    // the preceding bold inline's style.
    const result = injectComposingInline(inlines, 2, 'X');
    const composing = result.find((i) => i.text === 'X');
    expect(composing?.style).toEqual({ bold: true });
  });

  it('appends at end-of-block, inheriting the trailing style', () => {
    const inlines: Inline[] = [{ text: 'AB', style: { bold: true } }];
    const result = injectComposingInline(inlines, 2, 'Z');
    expect(result.map((i) => i.text)).toEqual(['AB', 'Z']);
    expect(result[1].style).toEqual({ bold: true });
  });

  it('injects into an empty block', () => {
    const result = injectComposingInline([], 0, 'Q');
    expect(result.map((i) => i.text)).toEqual(['Q']);
  });

  it('returns the input unchanged for empty composing text', () => {
    const inlines: Inline[] = [{ text: 'AB', style: {} }];
    expect(injectComposingInline(inlines, 1, '')).toBe(inlines);
  });

  it('does not mutate the input inlines', () => {
    const inlines: Inline[] = [{ text: 'ABCD', style: {} }];
    injectComposingInline(inlines, 2, 'X');
    expect(inlines).toEqual([{ text: 'ABCD', style: {} }]);
  });
});

describe('computeLayout with composingContext', () => {
  const measurer = stubMeasurer(8); // 8px per char

  function paragraph(id: string, text: string) {
    const block = createBlock('paragraph');
    block.id = id;
    block.inlines = [{ text, style: {} }];
    return block;
  }

  it('injects composing text into the matching block only', () => {
    const a = paragraph('a', 'ABCD');
    const b = paragraph('b', 'WXYZ');
    const composing: ComposingContext = { blockId: 'a', offset: 2, text: 'oo' };
    const { layout } = computeLayout([a, b], measurer, 600, undefined, undefined, composing);
    expect(blockText(layout.blocks[0])).toBe('ABooCD');
    expect(blockText(layout.blocks[1])).toBe('WXYZ'); // untouched
  });

  it('reflows following text — composing text widens the line', () => {
    const a = paragraph('a', 'ABCD');
    const noComposing = computeLayout([a], measurer, 600).layout.blocks[0];
    const composing: ComposingContext = { blockId: 'a', offset: 2, text: 'oo' };
    const withComposing = computeLayout(
      [paragraph('a', 'ABCD')], measurer, 600, undefined, undefined, composing,
    ).layout.blocks[0];
    // "ABCD" (4) -> "ABooCD" (6): the single line is 2 chars * 8px wider.
    expect(withComposing.lines[0].width).toBe(noComposing.lines[0].width + 16);
  });

  it('reflows by wrapping when composing text overflows the line', () => {
    // Width fits 5 chars (40px). "ABCD" is one line; injecting "XX" makes
    // "ABXXCD" (6 chars / 48px), which must wrap to a second line.
    const a = paragraph('a', 'ABCD');
    const composing: ComposingContext = { blockId: 'a', offset: 2, text: 'XX' };
    const { layout } = computeLayout([a], measurer, 40, undefined, undefined, composing);
    expect(layout.blocks[0].lines.length).toBe(2);
    expect(blockText(layout.blocks[0])).toBe('ABXXCD');
  });

  it('injects into an empty block', () => {
    const empty = createBlock('paragraph');
    empty.id = 'e';
    empty.inlines = [{ text: '', style: {} }];
    const composing: ComposingContext = { blockId: 'e', offset: 0, text: '가' };
    const { layout } = computeLayout([empty], measurer, 600, undefined, undefined, composing);
    expect(blockText(layout.blocks[0])).toBe('가');
  });

  it('leaves layout unchanged when composingContext targets no present block', () => {
    const a = paragraph('a', 'ABCD');
    const composing: ComposingContext = { blockId: 'ghost', offset: 0, text: 'oo' };
    const { layout } = computeLayout([a], measurer, 600, undefined, undefined, composing);
    expect(blockText(layout.blocks[0])).toBe('ABCD');
  });
});
