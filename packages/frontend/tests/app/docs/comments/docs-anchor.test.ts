import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

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
    assert.deepEqual(docPositionToTreePath(d, { blockId: 'b1', offset: 0 }), [0, 0, 0]);
  });

  it('second block resolves to [1, ...]', () => {
    const d = doc(block('b1', 'hello'), block('b2', 'world'));
    assert.deepEqual(docPositionToTreePath(d, { blockId: 'b2', offset: 3 }), [1, 0, 3]);
  });

  it('offset inside second inline → correct inlineIdx + charOffset', () => {
    const d = doc(block('b1', 'Hello', ' world'));
    // offset 7 → inline 0 has 5 chars, remaining 2 in inline 1
    assert.deepEqual(docPositionToTreePath(d, { blockId: 'b1', offset: 7 }), [0, 1, 2]);
  });

  it('offset exactly at inline boundary stays in earlier inline', () => {
    const d = doc(block('b1', 'Hello', ' world'));
    // offset 5 = end of inline 0
    assert.deepEqual(docPositionToTreePath(d, { blockId: 'b1', offset: 5 }), [0, 0, 5]);
  });

  it('unknown blockId returns null', () => {
    const d = doc(block('b1', 'hello'));
    assert.equal(docPositionToTreePath(d, { blockId: 'bogus', offset: 0 }), null);
  });

  it('offset past block end clamps to last inline end (resolveOffset semantics)', () => {
    const d = doc(block('b1', 'Hello'));
    assert.deepEqual(docPositionToTreePath(d, { blockId: 'b1', offset: 999 }), [0, 0, 5]);
  });
});

describe('extractAnchorContext', () => {
  it('single-block range returns blockId and exact slice as quotedText', () => {
    const d = doc(block('b1', 'Hello world'));
    const ctx = extractAnchorContext(d, {
      anchor: { blockId: 'b1', offset: 6 },
      focus: { blockId: 'b1', offset: 11 },
    });
    assert.equal(ctx.blockId, 'b1');
    assert.equal(ctx.quotedText, 'world');
  });

  it('reverse-ordered range (focus before anchor) is normalized', () => {
    const d = doc(block('b1', 'Hello world'));
    const ctx = extractAnchorContext(d, {
      anchor: { blockId: 'b1', offset: 11 },
      focus: { blockId: 'b1', offset: 6 },
    });
    assert.equal(ctx.quotedText, 'world');
  });

  it('multi-block range is joined with newlines', () => {
    const d = doc(block('b1', 'first'), block('b2', 'second'), block('b3', 'third'));
    const ctx = extractAnchorContext(d, {
      anchor: { blockId: 'b1', offset: 2 }, // "rst"
      focus: { blockId: 'b3', offset: 3 },  // "thi"
    });
    assert.equal(ctx.blockId, 'b1');
    assert.equal(ctx.quotedText, 'rst\nsecond\nthi');
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
    assert.equal(ctx.quotedText.length, 10);
    assert.ok(ctx.quotedText.endsWith('…'));
  });

  it('unknown start block returns empty quotedText but preserved blockId', () => {
    const d = doc(block('b1', 'hi'));
    const ctx = extractAnchorContext(d, {
      anchor: { blockId: 'gone', offset: 0 },
      focus: { blockId: 'gone', offset: 0 },
    });
    assert.equal(ctx.blockId, 'gone');
    assert.equal(ctx.quotedText, '');
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
    assert.deepEqual(result, {
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
    assert.deepEqual(result, { kind: 'orphan' });
  });

  it('round-trip: pathRangeToPosRange → resolveDocsAnchor returns the same paths', () => {
    // Simulated Yorkie behavior with an opaque posRange value.
    const treePath: [number[], number[]] = [
      [2, 0, 0],
      [2, 0, 7],
    ];
    const fakePos = { roundtripped: true } as unknown as DocsRangeAnchor['posRange'];

    const pathRangeToPosRange = (range: [number[], number[]]) => {
      assert.deepEqual(range, treePath);
      return fakePos;
    };
    const posRangeToPathRange = (pos: DocsRangeAnchor['posRange']) => {
      assert.equal(pos, fakePos);
      return treePath;
    };

    const posRange = pathRangeToPosRange(treePath);
    const result = resolveDocsAnchor(
      { posRangeToPathRange },
      anchor('b3', posRange),
    );
    assert.deepEqual(result, {
      kind: 'live',
      startPath: treePath[0],
      endPath: treePath[1],
    });
  });
});
