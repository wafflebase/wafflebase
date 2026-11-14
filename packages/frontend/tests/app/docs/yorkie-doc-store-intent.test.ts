import { describe, it, expect } from 'vitest';
import yorkie, { converter } from '@yorkie-js/sdk';
import { YorkieDocStore } from '../../../src/app/docs/yorkie-doc-store.ts';
import { generateBlockId, DEFAULT_BLOCK_STYLE } from '@wafflebase/docs';
import type { Block } from '@wafflebase/docs';

/**
 * Intent preservation for concurrent typing in Docs (yorkie-team/yorkie#2309,
 * wafflebase#1114). Two users type a word at the same offset of one paragraph
 * while offline. Both replicas always converge; this checks that the merged
 * paragraph keeps each word contiguous. Typing "backward" (the caret held in
 * place, each character inserted before the previous one) interleaves the
 * words, e.g. `Xab가c나다Y`.
 *
 * Docs paragraphs are Yorkie Tree text nodes. The right-origin fix in the
 * SDK covers `Text` (Notes) only, so the cases Tree still interleaves are
 * pinned with `it.fails`: they turn red, and need flipping to `it`, once the
 * Tree fix lands.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDoc = any;

function makeBlock(text: string): Block {
  return {
    id: generateBlockId(),
    type: 'paragraph',
    inlines: [{ text, style: {} }],
    style: { ...DEFAULT_BLOCK_STYLE },
  };
}

/**
 * Sends `from`'s pending changes to the peers through the protobuf wire
 * format and acknowledges them to `from`: one round trip through a server.
 */
function send(from: AnyDoc, peers: AnyDoc[]): void {
  const pb = converter.toChangePack(from.createChangePack());
  const clientSeq = pb.checkpoint!.clientSeq;
  pb.checkpoint!.clientSeq = 0;
  for (const peer of peers) {
    peer.applyChangePack(converter.fromChangePack(pb));
  }
  pb.changes = [];
  pb.checkpoint!.clientSeq = clientSeq;
  from.applyChangePack(converter.fromChangePack(pb));
}

type Typing = 'forward' | 'backward';

function type(
  store: YorkieDocStore,
  blockId: string,
  at: number,
  word: string,
  how: Typing,
): void {
  const chars = [...word];
  if (how === 'forward') {
    chars.forEach((c, i) => store.insertText(blockId, at + i, c));
  } else {
    chars.reverse().forEach((c) => store.insertText(blockId, at, c));
  }
}

function paragraphText(store: YorkieDocStore): string {
  return store
    .getDocument()
    .blocks.map((b) => b.inlines.map((i) => i.text).join(''))
    .join('\n');
}

function run(howA: Typing, howB: Typing): void {
  const docA: AnyDoc = new yorkie.Document('docs-intent');
  const docB: AnyDoc = new yorkie.Document('docs-intent');
  docA.setActor('000000000000000000000001');
  docB.setActor('000000000000000000000002');
  docA.update((root: AnyDoc) => {
    root.content = new yorkie.Tree({ type: 'doc', children: [] });
  });
  const storeA = new YorkieDocStore(docA);
  const block = makeBlock('XY');
  storeA.setDocument({ blocks: [block] });
  send(docA, [docB]);
  const storeB = new YorkieDocStore(docB);

  type(storeA, block.id, 1, '가나다', howA);
  type(storeB, block.id, 1, 'abc', howB);
  send(docA, [docB]);
  send(docB, [docA]);

  const merged = paragraphText(storeA);
  expect(paragraphText(storeB)).toBe(merged);
  expect(merged).toMatch(/^X(가나다abc|abc가나다)Y$/);
}

describe('YorkieDocStore concurrent typing intent', () => {
  it('keeps both words contiguous: A forward, B forward', () => {
    run('forward', 'forward');
  });
  it('keeps both words contiguous: A forward, B backward', () => {
    run('forward', 'backward');
  });
  // Tree interleaves: X가abc나다Y.
  it.fails('keeps both words contiguous: A backward, B forward', () => {
    run('backward', 'forward');
  });
  // Tree interleaves: Xab가c나다Y.
  it.fails('keeps both words contiguous: A backward, B backward', () => {
    run('backward', 'backward');
  });
});
