import { describe, it, expect } from 'vitest';
import { findLinkRunAt } from '../../src/view/link-run.js';
import { createEmptyBlock } from '../../src/model/types.js';
import type { Block, Inline } from '../../src/model/types.js';

function makeBlock(inlines: Inline[]): Block {
  const block = createEmptyBlock();
  block.inlines = inlines;
  return block;
}

const A = 'https://a.example.com';
const B = 'https://b.example.com';

describe('findLinkRunAt', () => {
  it('returns undefined when the block has no link', () => {
    const block = makeBlock([{ text: 'plain text', style: {} }]);
    expect(findLinkRunAt(block, 0)).toBeUndefined();
    expect(findLinkRunAt(block, 5)).toBeUndefined();
    expect(findLinkRunAt(block, 10)).toBeUndefined();
  });

  it('returns undefined on an empty block', () => {
    const block = makeBlock([{ text: '', style: {} }]);
    expect(findLinkRunAt(block, 0)).toBeUndefined();
  });

  it('finds the run when the offset is inside a link inline', () => {
    const block = makeBlock([
      { text: 'before ', style: {} },
      { text: 'link', style: { href: A } },
      { text: ' after', style: {} },
    ]);
    expect(findLinkRunAt(block, 9)).toEqual({ start: 7, end: 11, href: A });
  });

  it('treats both edges of the link inline as inside it', () => {
    const block = makeBlock([
      { text: 'before ', style: {} },
      { text: 'link', style: { href: A } },
      { text: ' after', style: {} },
    ]);
    expect(findLinkRunAt(block, 7)).toEqual({ start: 7, end: 11, href: A });
    expect(findLinkRunAt(block, 11)).toEqual({ start: 7, end: 11, href: A });
  });

  it('returns undefined when the offset is in surrounding plain text', () => {
    const block = makeBlock([
      { text: 'before ', style: {} },
      { text: 'link', style: { href: A } },
      { text: ' after', style: {} },
    ]);
    expect(findLinkRunAt(block, 3)).toBeUndefined();
    expect(findLinkRunAt(block, 13)).toBeUndefined();
  });

  it('extends across adjacent runs sharing the same href', () => {
    const block = makeBlock([
      { text: 'ht', style: { href: A, bold: true } },
      { text: 'tps', style: { href: A } },
      { text: ' after', style: {} },
    ]);
    expect(findLinkRunAt(block, 0)).toEqual({ start: 0, end: 5, href: A });
    expect(findLinkRunAt(block, 2)).toEqual({ start: 0, end: 5, href: A });
    expect(findLinkRunAt(block, 5)).toEqual({ start: 0, end: 5, href: A });
  });

  it('prefers the earlier run at the boundary between two different links', () => {
    const block = makeBlock([
      { text: 'aaa', style: { href: A } },
      { text: 'bbb', style: { href: B } },
    ]);
    // Same tie-break as getLinkAtCursor: the popover shows link A here.
    expect(findLinkRunAt(block, 3)).toEqual({ start: 0, end: 3, href: A });
    expect(findLinkRunAt(block, 4)).toEqual({ start: 3, end: 6, href: B });
  });

  it('ignores an href residue on an empty-text inline (emptied paragraph)', () => {
    // normalizeInlines keeps inlines[0].style when a paragraph is fully
    // emptied — a zero-width "run" that applyInlineStyle would no-op on.
    const block = makeBlock([{ text: '', style: { href: A } }]);
    expect(findLinkRunAt(block, 0)).toBeUndefined();
  });

  it('an empty href inline does not shadow an adjacent real link', () => {
    const block = makeBlock([
      { text: '', style: { href: A } },
      { text: 'abc', style: { href: B } },
    ]);
    expect(findLinkRunAt(block, 0)).toEqual({ start: 0, end: 3, href: B });
  });

  it('still crosses an empty inline sitting inside a wider same-href run', () => {
    const block = makeBlock([
      { text: 'ab', style: { href: A } },
      { text: '', style: { href: A } },
      { text: 'cd', style: { href: A } },
    ]);
    expect(findLinkRunAt(block, 1)).toEqual({ start: 0, end: 4, href: A });
  });
});
