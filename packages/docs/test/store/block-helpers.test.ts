// packages/docs/test/store/block-helpers.test.ts
import { describe, it, expect } from 'vitest';
import { resolveOffset, resolveDeleteRange } from '../../src/store/block-helpers.js';
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
