import { describe, it, expect } from 'vitest';
import {
  findLinkRunAt,
  linkTextFollowsHref,
  expandRangeForLinks,
} from '../../src/view/link-run.js';
import { createEmptyBlock } from '../../src/model/types.js';
import type { Block, Inline } from '../../src/model/types.js';
import { Doc } from '../../src/model/document.js';
import { MemDocStore } from '../../src/store/memory.js';

function makeBlock(inlines: Inline[]): Block {
  const block = createEmptyBlock();
  block.inlines = inlines;
  return block;
}

function makeDoc(blocks: Block[]): Doc {
  const store = new MemDocStore();
  store.setDocument({ blocks });
  return new Doc(store);
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

describe('linkTextFollowsHref', () => {
  it('is true when the run text is exactly its own href', () => {
    const block = makeBlock([{ text: A, style: { href: A } }]);
    const run = findLinkRunAt(block, 3)!;
    expect(linkTextFollowsHref(block, run)).toBe(true);
  });

  it('is false for a customised display text', () => {
    const block = makeBlock([
      { text: 'before ', style: {} },
      { text: 'click me', style: { href: A } },
    ]);
    const run = findLinkRunAt(block, 9)!;
    expect(linkTextFollowsHref(block, run)).toBe(false);
  });

  it('reads the run extent, not the whole block', () => {
    // The URL is the link's text but the paragraph carries more around it.
    const block = makeBlock([
      { text: 'see ', style: {} },
      { text: A, style: { href: A } },
      { text: ' now', style: {} },
    ]);
    const run = findLinkRunAt(block, 6)!;
    expect(run).toEqual({ start: 4, end: 4 + A.length, href: A });
    expect(linkTextFollowsHref(block, run)).toBe(true);
  });

  it('follows the run across same-href sub-runs (a bold prefix)', () => {
    const block = makeBlock([
      { text: A.slice(0, 4), style: { href: A, bold: true } },
      { text: A.slice(4), style: { href: A } },
    ]);
    const run = findLinkRunAt(block, 2)!;
    expect(linkTextFollowsHref(block, run)).toBe(true);
  });
});

describe('expandRangeForLinks', () => {
  /** "plain LINK plain" — the link covers offsets 6..10. */
  function linked(): { doc: Doc; id: string } {
    const block = makeBlock([
      { text: 'plain ', style: {} },
      { text: 'link', style: { href: A } },
      { text: ' plain', style: {} },
    ]);
    return { doc: makeDoc([block]), id: block.id };
  }

  it('grows a selection that ends mid-link out to the link end', () => {
    const { doc, id } = linked();
    expect(
      expandRangeForLinks(doc, {
        anchor: { blockId: id, offset: 2 },
        focus: { blockId: id, offset: 8 },
      }),
    ).toEqual({
      anchor: { blockId: id, offset: 2 },
      focus: { blockId: id, offset: 10 },
    });
  });

  it('grows a selection that starts mid-link out to the link start', () => {
    const { doc, id } = linked();
    expect(
      expandRangeForLinks(doc, {
        anchor: { blockId: id, offset: 8 },
        focus: { blockId: id, offset: 14 },
      }),
    ).toEqual({
      anchor: { blockId: id, offset: 6 },
      focus: { blockId: id, offset: 14 },
    });
  });

  it('is direction-independent: a backward drag snaps the same span', () => {
    const { doc, id } = linked();
    const forward = expandRangeForLinks(doc, {
      anchor: { blockId: id, offset: 2 },
      focus: { blockId: id, offset: 8 },
    });
    const backward = expandRangeForLinks(doc, {
      anchor: { blockId: id, offset: 8 },
      focus: { blockId: id, offset: 2 },
    });
    // Same covered span, endpoints swapped — the anchor stays the anchor.
    expect(backward).toEqual({
      anchor: { blockId: id, offset: 10 },
      focus: { blockId: id, offset: 2 },
    });
    expect(forward.focus.offset).toBe(backward.anchor.offset);
    expect(forward.anchor.offset).toBe(backward.focus.offset);
  });

  it('corrects an endpoint that a fixed mousedown anchor left mid-link', () => {
    // A forward drag that *began* mid-link: only correcting the moving
    // focus would leave this one partial.
    const { doc, id } = linked();
    expect(
      expandRangeForLinks(doc, {
        anchor: { blockId: id, offset: 7 },
        focus: { blockId: id, offset: 9 },
      }),
    ).toEqual({
      anchor: { blockId: id, offset: 6 },
      focus: { blockId: id, offset: 10 },
    });
  });

  it('leaves a collapsed caret inside a link alone', () => {
    // The guard that keeps insertLink's edit-in-place branch reachable,
    // "Add comment" refused, and ⌘B reading the caret style (#1038).
    const { doc, id } = linked();
    const caret = {
      anchor: { blockId: id, offset: 8 },
      focus: { blockId: id, offset: 8 },
    };
    expect(expandRangeForLinks(doc, caret)).toBe(caret);
  });

  it('does not swallow a link the selection merely abuts', () => {
    const { doc, id } = linked();
    // Ends exactly at the link start.
    const before = {
      anchor: { blockId: id, offset: 0 },
      focus: { blockId: id, offset: 6 },
    };
    expect(expandRangeForLinks(doc, before)).toBe(before);
    // Starts exactly at the link end.
    const after = {
      anchor: { blockId: id, offset: 10 },
      focus: { blockId: id, offset: 16 },
    };
    expect(expandRangeForLinks(doc, after)).toBe(after);
  });

  it('leaves a range that already covers the whole link alone', () => {
    const { doc, id } = linked();
    const whole = {
      anchor: { blockId: id, offset: 6 },
      focus: { blockId: id, offset: 10 },
    };
    expect(expandRangeForLinks(doc, whole)).toBe(whole);
  });

  it('drops a now-stale wrap affinity from a moved endpoint only', () => {
    const { doc, id } = linked();
    const out = expandRangeForLinks(doc, {
      anchor: { blockId: id, offset: 2, lineAffinity: 'forward' },
      focus: { blockId: id, offset: 8, lineAffinity: 'forward' },
    });
    expect(out.anchor.lineAffinity).toBe('forward');
    expect(out.focus.lineAffinity).toBeUndefined();
  });

  it('skips tableCellRange mode, where block-local offsets mean nothing', () => {
    const { doc, id } = linked();
    const cellRange = {
      anchor: { blockId: id, offset: 8 },
      focus: { blockId: id, offset: 8 },
      tableCellRange: {
        blockId: id,
        start: { rowIndex: 0, colIndex: 0 },
        end: { rowIndex: 1, colIndex: 1 },
      },
    };
    expect(expandRangeForLinks(doc, cellRange)).toBe(cellRange);
  });

  it('expands the mid-link endpoint of a multi-block selection', () => {
    const first = makeBlock([
      { text: 'plain ', style: {} },
      { text: 'link', style: { href: A } },
      { text: ' plain', style: {} },
    ]);
    const second = makeBlock([{ text: 'second', style: {} }]);
    const doc = makeDoc([first, second]);
    expect(
      expandRangeForLinks(doc, {
        anchor: { blockId: first.id, offset: 8 },
        focus: { blockId: second.id, offset: 3 },
      }),
    ).toEqual({
      anchor: { blockId: first.id, offset: 6 },
      focus: { blockId: second.id, offset: 3 },
    });
    // Backward across the same two blocks: the same endpoint still grows
    // left, because the expansion works on the normalized order.
    expect(
      expandRangeForLinks(doc, {
        anchor: { blockId: second.id, offset: 3 },
        focus: { blockId: first.id, offset: 8 },
      }),
    ).toEqual({
      anchor: { blockId: second.id, offset: 3 },
      focus: { blockId: first.id, offset: 6 },
    });
  });

  it('declines to snap when the endpoints cannot be ordered', () => {
    // A cell block is not in getBlockIndex's context, so the order — and
    // with it the safe expansion direction — is unknown. Snapping the wrong
    // way would drop selected characters, so the range is left as is.
    const inCell = makeBlock([
      { text: 'plain ', style: {} },
      { text: 'link', style: { href: A } },
    ]);
    const other = makeBlock([{ text: 'other', style: {} }]);
    const doc = makeDoc([other]);
    const range = {
      anchor: { blockId: inCell.id, offset: 8 },
      focus: { blockId: other.id, offset: 2 },
    };
    expect(expandRangeForLinks(doc, range)).toBe(range);
  });
});
