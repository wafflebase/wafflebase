import { describe, it, expect } from 'vitest';

import { DEFAULT_BLOCK_STYLE, DEFAULT_INLINE_STYLE } from '@wafflebase/docs';
import type { Block, Document } from '@wafflebase/docs';

import { pathToDocPosition } from '../../../../src/app/docs/comments/docs-anchor.ts';
import { computeCommentMarkers } from '../../../../src/app/docs/comments/decorations.ts';
import type {
  DocsRangeAnchor,
  Thread,
} from '../../../../src/types/comments.ts';

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

const author = { userId: 'u1', username: 'alice' };
const fakePos = { __pos: 'p' } as unknown as DocsRangeAnchor['posRange'];

function makeThread(
  id: string,
  blockId: string,
  resolved = false,
): Thread<DocsRangeAnchor> {
  return {
    id,
    anchor: { kind: 'docs-range', blockId, posRange: fakePos, quotedText: 'world' },
    comments: [{ id: 'c-' + id, author, body: 'q', createdAt: 0 }],
    resolved,
    createdAt: 0,
  };
}

describe('pathToDocPosition', () => {
  it('reverses docPositionToTreePath for top-level blocks', () => {
    const d = doc(block('b1', 'Hello', ' world'));
    expect(pathToDocPosition(d, [0, 0, 0])).toEqual({ blockId: 'b1', offset: 0 });
    expect(pathToDocPosition(d, [0, 0, 5])).toEqual({ blockId: 'b1', offset: 5 });
    expect(pathToDocPosition(d, [0, 1, 2])).toEqual({ blockId: 'b1', offset: 7 });
  });

  it('resolves the second block and into its second inline', () => {
    const d = doc(block('b1', 'aaa'), block('b2', 'Hello', ' world'));
    expect(pathToDocPosition(d, [1, 1, 3])).toEqual({ blockId: 'b2', offset: 8 });
  });

  it('returns null when blockIdx is out of range', () => {
    const d = doc(block('b1', 'hi'));
    expect(pathToDocPosition(d, [42, 0, 0])).toBe(null);
  });

  it('returns null for a path shorter than [block, inline, char]', () => {
    // Yorkie returns shortened paths only when both endpoints reference
    // a deleted node (orphan signal). resolveDocsAnchor already keys on
    // length < 3 to bail; pathToDocPosition mirrors that — it never has
    // to invent an offset for a degenerate path.
    const d = doc(block('b1', 'hello'));
    expect(pathToDocPosition(d, [0])).toBe(null);
  });
});

describe('computeCommentMarkers', () => {
  it('emits one marker per live thread with anchor/focus DocPositions', () => {
    const d = doc(block('b1', 'Hello world'));
    const tree = {
      posRangeToPathRange: () => [
        [0, 0, 6],
        [0, 0, 11],
      ] as [number[], number[]],
    };
    const t = makeThread('t1', 'b1');
    const markers = computeCommentMarkers([t], d, tree);
    expect(markers.length).toBe(1);
    expect(markers[0].id).toBe('t1');
    expect(markers[0].anchor).toEqual({ blockId: 'b1', offset: 6 });
    expect(markers[0].focus).toEqual({ blockId: 'b1', offset: 11 });
  });

  it('drops resolved threads', () => {
    const d = doc(block('b1', 'Hello'));
    const tree = {
      posRangeToPathRange: () => [
        [0, 0, 0],
        [0, 0, 5],
      ] as [number[], number[]],
    };
    const markers = computeCommentMarkers(
      [makeThread('t1', 'b1', true)],
      d,
      tree,
    );
    expect(markers).toEqual([]);
  });

  it('drops orphan threads (resolveDocsAnchor → orphan)', () => {
    const d = doc(block('b1', 'Hello'));
    const tree = {
      posRangeToPathRange: () => {
        throw new Error('deleted');
      },
    };
    const markers = computeCommentMarkers([makeThread('t1', 'b1')], d, tree);
    expect(markers).toEqual([]);
  });

  it('drops threads whose resolved path has no matching block', () => {
    const d = doc(block('b1', 'Hello'));
    const tree = {
      posRangeToPathRange: () => [
        [42, 0, 0],
        [42, 0, 1],
      ] as [number[], number[]],
    };
    const markers = computeCommentMarkers([makeThread('t1', 'b1')], d, tree);
    expect(markers).toEqual([]);
  });

  it('handles multiple threads, preserving input order', () => {
    const d = doc(block('b1', 'one'), block('b2', 'two'));
    let call = 0;
    const ranges: Array<[number[], number[]]> = [
      [[0, 0, 0], [0, 0, 3]],
      [[1, 0, 0], [1, 0, 3]],
    ];
    const tree = {
      posRangeToPathRange: () => ranges[call++],
    };
    const markers = computeCommentMarkers(
      [makeThread('t1', 'b1'), makeThread('t2', 'b2')],
      d,
      tree,
    );
    expect(markers.length).toBe(2);
    expect(markers[0].id).toBe('t1');
    expect(markers[1].id).toBe('t2');
  });
});
