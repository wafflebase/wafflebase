// packages/docs/test/store/block-helpers.test.ts
import { describe, it, expect } from 'vitest';
import { resolveOffset, resolveDeleteRange, applyInsertText, applyDeleteText, resolveStyleRange, applyInlineStyle } from '../../src/store/block-helpers.js';
import type { Block } from '../../src/model/types.js';
import { DEFAULT_BLOCK_STYLE } from '../../src/model/types.js';

function makeBlock(...inlines: Array<{ text: string; style?: Record<string, unknown> }>): Block {
  return {
    id: 'b1',
    type: 'paragraph',
    inlines: inlines.map((i) => ({ text: i.text, style: i.style ?? {} })),
    style: DEFAULT_BLOCK_STYLE,
  };
}

describe('resolveOffset', () => {
  it('resolves within single inline', () => {
    const block = makeBlock({ text: 'Hello' });
    expect(resolveOffset(block, 3)).toEqual({ inlineIndex: 0, charOffset: 3 });
  });

  it('resolves at inline boundary — lands on current inline end', () => {
    const block = makeBlock({ text: 'Hello' }, { text: 'World' });
    expect(resolveOffset(block, 5)).toEqual({ inlineIndex: 0, charOffset: 5 });
  });

  it('resolves in second inline', () => {
    const block = makeBlock({ text: 'Hello' }, { text: 'World' });
    expect(resolveOffset(block, 7)).toEqual({ inlineIndex: 1, charOffset: 2 });
  });

  it('clamps past end to last inline', () => {
    const block = makeBlock({ text: 'Hi' });
    expect(resolveOffset(block, 99)).toEqual({ inlineIndex: 0, charOffset: 2 });
  });

  it('resolves offset 0 in empty inline', () => {
    const block = makeBlock({ text: '' });
    expect(resolveOffset(block, 0)).toEqual({ inlineIndex: 0, charOffset: 0 });
  });
});

describe('resolveDeleteRange', () => {
  it('resolves within single inline', () => {
    const block = makeBlock({ text: 'Hello' });
    expect(resolveDeleteRange(block, 1, 3)).toEqual([
      { inlineIndex: 0, charFrom: 1, charTo: 4 },
    ]);
  });

  it('resolves across two inlines', () => {
    const block = makeBlock({ text: 'Hello' }, { text: 'World' });
    expect(resolveDeleteRange(block, 3, 4)).toEqual([
      { inlineIndex: 0, charFrom: 3, charTo: 5 },
      { inlineIndex: 1, charFrom: 0, charTo: 2 },
    ]);
  });

  it('resolves across three inlines', () => {
    const block = makeBlock({ text: 'AA' }, { text: 'BB' }, { text: 'CC' });
    expect(resolveDeleteRange(block, 1, 4)).toEqual([
      { inlineIndex: 0, charFrom: 1, charTo: 2 },
      { inlineIndex: 1, charFrom: 0, charTo: 2 },
      { inlineIndex: 2, charFrom: 0, charTo: 1 },
    ]);
  });

  it('clamps length to block text length', () => {
    const block = makeBlock({ text: 'Hi' });
    expect(resolveDeleteRange(block, 1, 100)).toEqual([
      { inlineIndex: 0, charFrom: 1, charTo: 2 },
    ]);
  });
});

describe('applyInsertText', () => {
  it('inserts text in single inline', () => {
    const block = makeBlock({ text: 'Helo' });
    const result = applyInsertText(block, 3, 'l');
    expect(result.inlines[0].text).toBe('Hello');
  });

  it('inserts text at inline boundary', () => {
    const block = makeBlock({ text: 'AB' }, { text: 'CD' });
    const result = applyInsertText(block, 2, 'X');
    expect(result.inlines[0].text).toBe('ABX');
    expect(result.inlines[1].text).toBe('CD');
  });

  it('inserts text at offset 0', () => {
    const block = makeBlock({ text: 'Hello' });
    const result = applyInsertText(block, 0, 'X');
    expect(result.inlines[0].text).toBe('XHello');
  });

  it('preserves inline styles', () => {
    const block = makeBlock({ text: 'AB', style: { bold: true } });
    const result = applyInsertText(block, 1, 'X');
    expect(result.inlines[0].text).toBe('AXB');
    expect(result.inlines[0].style).toEqual({ bold: true });
  });
});

describe('applyDeleteText', () => {
  it('deletes within single inline', () => {
    const block = makeBlock({ text: 'Hello' });
    const result = applyDeleteText(block, 1, 3);
    expect(result.inlines[0].text).toBe('Ho');
  });

  it('deletes across inline boundary with different styles', () => {
    const block = makeBlock({ text: 'Hello' }, { text: 'World', style: { bold: true } });
    const result = applyDeleteText(block, 3, 4);
    expect(result.inlines[0].text).toBe('Hel');
    expect(result.inlines[1].text).toBe('rld');
    expect(result.inlines[1].style).toEqual({ bold: true });
  });

  it('deletes across inline boundary with same styles — merges', () => {
    const block = makeBlock({ text: 'Hello' }, { text: 'World' });
    const result = applyDeleteText(block, 3, 4);
    expect(result.inlines).toHaveLength(1);
    expect(result.inlines[0].text).toBe('Helrld');
  });

  it('removes empty inlines after deletion (keeps at least one)', () => {
    const block = makeBlock({ text: 'AB' }, { text: 'CD' });
    const result = applyDeleteText(block, 0, 2);
    expect(result.inlines).toHaveLength(1);
    expect(result.inlines[0].text).toBe('CD');
  });

  it('keeps one empty inline when all text is deleted', () => {
    const block = makeBlock({ text: 'AB' });
    const result = applyDeleteText(block, 0, 2);
    expect(result.inlines).toHaveLength(1);
    expect(result.inlines[0].text).toBe('');
  });

  it('normalizes adjacent same-style inlines after deletion', () => {
    const block = makeBlock(
      { text: 'AA', style: { bold: true } },
      { text: 'XX' },
      { text: 'BB', style: { bold: true } },
    );
    const result = applyDeleteText(block, 2, 2);
    expect(result.inlines).toHaveLength(1);
    expect(result.inlines[0].text).toBe('AABB');
    expect(result.inlines[0].style).toEqual({ bold: true });
  });
});

describe('resolveStyleRange', () => {
  it('resolves within single inline', () => {
    const block = makeBlock({ text: 'Hello World' });
    expect(resolveStyleRange(block, 6, 11)).toEqual([
      { inlineIndex: 0, charFrom: 6, charTo: 11 },
    ]);
  });

  it('resolves across two inlines', () => {
    const block = makeBlock({ text: 'Hello' }, { text: 'World' });
    expect(resolveStyleRange(block, 3, 8)).toEqual([
      { inlineIndex: 0, charFrom: 3, charTo: 5 },
      { inlineIndex: 1, charFrom: 0, charTo: 3 },
    ]);
  });
});

describe('applyInlineStyle', () => {
  it('applies style within single inline — splits into 2', () => {
    const block = makeBlock({ text: 'Hello World' });
    const result = applyInlineStyle(block, 6, 11, { bold: true });
    expect(result.inlines).toHaveLength(2);
    expect(result.inlines[0]).toEqual({ text: 'Hello ', style: {} });
    expect(result.inlines[1]).toEqual({ text: 'World', style: { bold: true } });
  });

  it('applies style to entire inline — no split needed', () => {
    const block = makeBlock({ text: 'Hello' });
    const result = applyInlineStyle(block, 0, 5, { italic: true });
    expect(result.inlines).toHaveLength(1);
    expect(result.inlines[0]).toEqual({ text: 'Hello', style: { italic: true } });
  });

  it('applies style across inline boundary', () => {
    const block = makeBlock({ text: 'AB' }, { text: 'CD' });
    const result = applyInlineStyle(block, 1, 3, { bold: true });
    // "A" + "BC"(bold) + "D" — after normalize, "B"+"C" merge since same style
    expect(result.inlines).toHaveLength(3);
    expect(result.inlines[0]).toEqual({ text: 'A', style: {} });
    expect(result.inlines[1]).toEqual({ text: 'BC', style: { bold: true } });
    expect(result.inlines[2]).toEqual({ text: 'D', style: {} });
  });

  it('applies style in middle — splits into 3', () => {
    const block = makeBlock({ text: 'Hello World' });
    const result = applyInlineStyle(block, 2, 5, { underline: true });
    expect(result.inlines).toHaveLength(3);
    expect(result.inlines[0]).toEqual({ text: 'He', style: {} });
    expect(result.inlines[1]).toEqual({ text: 'llo', style: { underline: true } });
    expect(result.inlines[2]).toEqual({ text: ' World', style: {} });
  });

  it('merges with adjacent same-style after apply', () => {
    const block = makeBlock(
      { text: 'AB', style: { bold: true } },
      { text: 'CD' },
      { text: 'EF', style: { bold: true } },
    );
    // Apply bold to "CD" — all three become bold and merge
    const result = applyInlineStyle(block, 2, 4, { bold: true });
    expect(result.inlines).toHaveLength(1);
    expect(result.inlines[0]).toEqual({ text: 'ABCDEF', style: { bold: true } });
  });
});
