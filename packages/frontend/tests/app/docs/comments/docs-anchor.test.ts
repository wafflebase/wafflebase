import { describe, it, expect } from 'vitest';

import {
  DEFAULT_BLOCK_STYLE,
  DEFAULT_INLINE_STYLE,
} from '@wafflebase/docs';
import type { Block, Document } from '@wafflebase/docs';

import {
  docPositionToTreePath,
  extractAnchorContext,
  resolveDocsAnchor,
} from '../../../../src/app/docs/comments/docs-anchor.ts';
import type { DocsRangeAnchor } from '../../../../src/app/docs/comments/docs-anchor.ts';

function block(id: string, ...texts: string[]): Block {
  return {
    id,
    type: 'paragraph',
    style: { ...DEFAULT_BLOCK_STYLE },
    inlines: texts.length
      ? texts.map((t) => ({ text: t, style: { ...DEFAULT_INLINE_STYLE } }))
      : [{ text: '', style: { ...DEFAULT_INLINE_STYLE } }],
  };
}

function doc(...blocks: Block[]): Document {
  return { blocks };
}

const fakePosRange = { __posRange: 'abc' } as unknown as DocsRangeAnchor['posRange'];

const anchor = (
  blockId: string,
  posRange: DocsRangeAnchor['posRange'] = fakePosRange,
  quotedText = '',
): DocsRangeAnchor => ({ kind: 'docs-range', blockId, posRange, quotedText });

describe('docPositionToTreePath', () => {
  it('top-level block, offset 0 → [blockIdx, 0, 0]', () => {
    const d = doc(block('b1', 'hello'));
    expect(docPositionToTreePath(d, { blockId: 'b1', offset: 0 })).toEqual([0, 0, 0]);
  });

  it('second block resolves to [1, ...]', () => {
    const d = doc(block('b1', 'hello'), block('b2', 'world'));
    expect(docPositionToTreePath(d, { blockId: 'b2', offset: 3 })).toEqual([1, 0, 3]);
  });

  it('offset inside second inline → correct inlineIdx + charOffset', () => {
    const d = doc(block('b1', 'Hello', ' world'));
    // offset 7 → inline 0 has 5 chars, remaining 2 in inline 1
    expect(docPositionToTreePath(d, { blockId: 'b1', offset: 7 })).toEqual([0, 1, 2]);
  });

  it('offset exactly at inline boundary stays in earlier inline', () => {
    const d = doc(block('b1', 'Hello', ' world'));
    // offset 5 = end of inline 0
    expect(docPositionToTreePath(d, { blockId: 'b1', offset: 5 })).toEqual([0, 0, 5]);
  });

  it('unknown blockId returns null', () => {
    const d = doc(block('b1', 'hello'));
    expect(docPositionToTreePath(d, { blockId: 'bogus', offset: 0 })).toBe(null);
  });

  it('offset past block end clamps to last inline end (resolveOffset semantics)', () => {
    const d = doc(block('b1', 'Hello'));
    expect(docPositionToTreePath(d, { blockId: 'b1', offset: 999 })).toEqual([0, 0, 5]);
  });
});

describe('extractAnchorContext', () => {
  it('single-block range returns blockId and exact slice as quotedText', () => {
    const d = doc(block('b1', 'Hello world'));
    const ctx = extractAnchorContext(d, {
      anchor: { blockId: 'b1', offset: 6 },
      focus: { blockId: 'b1', offset: 11 },
    });
    expect(ctx.blockId).toBe('b1');
    expect(ctx.quotedText).toBe('world');
  });

  it('reverse-ordered range (focus before anchor) is normalized', () => {
    const d = doc(block('b1', 'Hello world'));
    const ctx = extractAnchorContext(d, {
      anchor: { blockId: 'b1', offset: 11 },
      focus: { blockId: 'b1', offset: 6 },
    });
    expect(ctx.quotedText).toBe('world');
  });

  it('multi-block range is joined with newlines', () => {
    const d = doc(block('b1', 'first'), block('b2', 'second'), block('b3', 'third'));
    const ctx = extractAnchorContext(d, {
      anchor: { blockId: 'b1', offset: 2 }, // "rst"
      focus: { blockId: 'b3', offset: 3 },  // "thi"
    });
    expect(ctx.blockId).toBe('b1');
    expect(ctx.quotedText).toBe('rst\nsecond\nthi');
  });

  it('quotedText is capped with an ellipsis when over maxChars', () => {
    const longText = 'a'.repeat(1000);
    const d = doc(block('b1', longText));
    const ctx = extractAnchorContext(
      d,
      {
        anchor: { blockId: 'b1', offset: 0 },
        focus: { blockId: 'b1', offset: 1000 },
      },
      10,
    );
    expect(ctx.quotedText.length).toBe(10);
    expect(ctx.quotedText.endsWith('…')).toBeTruthy();
  });

  it('unknown start block returns empty quotedText but preserved blockId', () => {
    const d = doc(block('b1', 'hi'));
    const ctx = extractAnchorContext(d, {
      anchor: { blockId: 'gone', offset: 0 },
      focus: { blockId: 'gone', offset: 0 },
    });
    expect(ctx.blockId).toBe('gone');
    expect(ctx.quotedText).toBe('');
  });
});

describe('resolveDocsAnchor', () => {
  it('returns live when posRangeToPathRange resolves', () => {
    const tree = {
      posRangeToPathRange: () => [
        [0, 0, 0],
        [0, 0, 5],
      ] as [number[], number[]],
    };
    const result = resolveDocsAnchor(tree, anchor('b1'));
    expect(result).toEqual({
      kind: 'live',
      startPath: [0, 0, 0],
      endPath: [0, 0, 5],
    });
  });

  it('returns orphan when posRangeToPathRange throws', () => {
    const tree = {
      posRangeToPathRange: () => {
        throw new Error('endpoint refers to deleted node');
      },
    };
    const result = resolveDocsAnchor(tree, anchor('b1'));
    expect(result).toEqual({ kind: 'orphan' });
  });

  it('returns orphan when SDK collapses path below text level (block deleted)', () => {
    // Observed SDK behavior on full block deletion: returns [[bi],[bi]] with
    // 1-level paths instead of throwing.
    const tree = {
      posRangeToPathRange: () => [[0], [0]] as [number[], number[]],
    };
    expect(resolveDocsAnchor(tree, anchor('b1'))).toEqual({ kind: 'orphan' });
  });

  it('round-trip: pathRangeToPosRange → resolveDocsAnchor returns the same paths', () => {
    // Simulated Yorkie behavior with an opaque posRange value.
    const treePath: [number[], number[]] = [
      [2, 0, 0],
      [2, 0, 7],
    ];
    const fakePos = { roundtripped: true } as unknown as DocsRangeAnchor['posRange'];

    const pathRangeToPosRange = (range: [number[], number[]]) => {
      expect(range).toEqual(treePath);
      return fakePos;
    };
    const posRangeToPathRange = (pos: DocsRangeAnchor['posRange']) => {
      expect(pos).toBe(fakePos);
      return treePath;
    };

    const posRange = pathRangeToPosRange(treePath);
    const result = resolveDocsAnchor(
      { posRangeToPathRange },
      anchor('b3', posRange),
    );
    expect(result).toEqual({
      kind: 'live',
      startPath: treePath[0],
      endPath: treePath[1],
    });
  });
});
