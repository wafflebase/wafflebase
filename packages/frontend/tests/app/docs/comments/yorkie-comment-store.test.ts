import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';
import yorkie from '@yorkie-js/sdk';
import { DEFAULT_BLOCK_STYLE, generateBlockId } from '@wafflebase/docs';
import type { Block } from '@wafflebase/docs';

import { YorkieCommentStore } from '../../../../src/app/docs/comments/yorkie-comment-store.ts';
import { resolveDocsAnchor } from '../../../../src/app/docs/comments/docs-anchor.ts';
import type { YorkieDocsRoot } from '../../../../src/types/docs-document.ts';
import type { CommentAuthor } from '../../../../src/types/comments.ts';

const alice: CommentAuthor = { userId: 'u1', username: 'alice' };
const bob: CommentAuthor = { userId: 'u2', username: 'bob' };

function makeBlock(text: string): Block {
  return {
    id: generateBlockId(),
    type: 'paragraph',
    inlines: [{ text, style: {} }],
    style: { ...DEFAULT_BLOCK_STYLE },
  };
}

function seedTree(
  doc: yorkie.Document<YorkieDocsRoot>,
  blocks: Block[],
): void {
  doc.update((root) => {
    root.content = new yorkie.Tree({
      type: 'doc',
      children: blocks.map((b) => ({
        type: 'block',
        attributes: {
          id: b.id,
          type: b.type,
          alignment: b.style.alignment,
          lineHeight: String(b.style.lineHeight),
          marginTop: String(b.style.marginTop),
          marginBottom: String(b.style.marginBottom),
          textIndent: String(b.style.textIndent),
          marginLeft: String(b.style.marginLeft),
        },
        children: [
          {
            type: 'inline',
            children: b.inlines
              .filter((i) => i.text.length > 0)
              .map((i) => ({ type: 'text', value: i.text })),
          },
        ],
      })),
    });
  });
}

function makeIds() {
  let n = 0;
  return () => `id-${++n}`;
}

function makeNow() {
  let t = 1000;
  return () => ++t;
}

function newDoc(blocks: Block[]) {
  const doc = new yorkie.Document<YorkieDocsRoot>(
    `comments-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  seedTree(doc, blocks);
  return doc;
}

describe('YorkieCommentStore — addThread', () => {
  let doc: yorkie.Document<YorkieDocsRoot>;
  let block: Block;
  let store: YorkieCommentStore;

  beforeEach(() => {
    block = makeBlock('Hello world');
    doc = newDoc([block]);
    store = new YorkieCommentStore(doc, { newId: makeIds(), now: makeNow() });
  });

  it('persists a thread in root.comments with a CRDT-stable posRange', async () => {
    const t = await store.addThread(
      {
        startPath: [0, 0, 6],
        endPath: [0, 0, 11],
        blockId: block.id,
        quotedText: 'world',
      },
      'is this right?',
      alice,
    );
    assert.equal(t.anchor.kind, 'docs-range');
    assert.equal(t.anchor.blockId, block.id);
    assert.equal(t.anchor.quotedText, 'world');
    assert.ok(t.anchor.posRange, 'posRange must be set by the store');

    const stored = doc.getRoot().comments?.[t.id];
    assert.ok(stored, 'thread must be persisted under root.comments');
    assert.equal(stored?.comments[0].body, 'is this right?');
  });

  it('round-trips: anchor resolves back to the original path range', async () => {
    const t = await store.addThread(
      {
        startPath: [0, 0, 6],
        endPath: [0, 0, 11],
        blockId: block.id,
        quotedText: 'world',
      },
      'q',
      alice,
    );
    const res = resolveDocsAnchor(doc.getRoot().content, t.anchor);
    assert.equal(res.kind, 'live');
    if (res.kind === 'live') {
      assert.deepEqual(res.startPath, [0, 0, 6]);
      assert.deepEqual(res.endPath, [0, 0, 11]);
    }
  });
});

describe('YorkieCommentStore — replies, edit, delete', () => {
  let doc: yorkie.Document<YorkieDocsRoot>;
  let store: YorkieCommentStore;

  beforeEach(() => {
    const block = makeBlock('Hello');
    doc = newDoc([block]);
    store = new YorkieCommentStore(doc, { newId: makeIds(), now: makeNow() });
  });

  async function seedThread() {
    return store.addThread(
      { startPath: [0, 0, 0], endPath: [0, 0, 5], blockId: 'unused', quotedText: 'Hello' },
      'root',
      alice,
    );
  }

  it('addReply appends to comments[]', async () => {
    const t = await seedThread();
    const reply = await store.addReply(t.id, 'reply', bob);
    const stored = doc.getRoot().comments?.[t.id];
    assert.equal(stored?.comments.length, 2);
    assert.equal(stored?.comments[1].id, reply.id);
    assert.equal(stored?.comments[1].body, 'reply');
  });

  it('editComment updates body and editedAt', async () => {
    const t = await seedThread();
    const rootId = t.comments[0].id;
    await store.editComment(t.id, rootId, 'edited');
    const stored = doc.getRoot().comments?.[t.id];
    const edited = stored?.comments.find((c) => c.id === rootId);
    assert.equal(edited?.body, 'edited');
    assert.ok((edited?.editedAt as number) > edited!.createdAt);
  });

  it('deleteComment of a reply keeps the thread', async () => {
    const t = await seedThread();
    const reply = await store.addReply(t.id, 'reply', bob);
    await store.deleteComment(t.id, reply.id);
    const stored = doc.getRoot().comments?.[t.id];
    assert.equal(stored?.comments.length, 1);
  });

  it('deleteComment of the root removes the whole thread', async () => {
    const t = await seedThread();
    await store.deleteComment(t.id, t.comments[0].id);
    assert.equal(doc.getRoot().comments?.[t.id], undefined);
  });
});

describe('YorkieCommentStore — listThreads + setThreadResolved', () => {
  it('filters by resolved state and reflects resolvedBy / resolvedAt', async () => {
    const doc = newDoc([makeBlock('abcde')]);
    const store = new YorkieCommentStore(doc, { newId: makeIds(), now: makeNow() });
    const t = await store.addThread(
      { startPath: [0, 0, 0], endPath: [0, 0, 5], blockId: 'b', quotedText: 'abcde' },
      'root',
      alice,
    );
    await store.setThreadResolved(t.id, true, bob);
    const open = await store.listThreads({ resolved: false });
    const closed = await store.listThreads({ resolved: true });
    assert.equal(open.length, 0);
    assert.equal(closed.length, 1);
    assert.equal(closed[0].resolvedBy?.userId, 'u2');
    assert.ok(closed[0].resolvedAt !== undefined);

    // Reopen
    await store.setThreadResolved(t.id, false, alice);
    const reopened = await store.listThreads({ resolved: false });
    assert.equal(reopened.length, 1);
    assert.equal(reopened[0].resolvedBy, undefined);
    assert.equal(reopened[0].resolvedAt, undefined);
  });

  it('returns an empty list when comments map is unset', async () => {
    const doc = newDoc([makeBlock('hi')]);
    const store = new YorkieCommentStore(doc, { newId: makeIds(), now: makeNow() });
    const list = await store.listThreads();
    assert.deepEqual(list, []);
  });
});

describe('YorkieCommentStore — orphan resolution under text deletion', () => {
  it('partial deletion shrinks posRange and resolveDocsAnchor still returns live', async () => {
    const block = makeBlock('Hello world');
    const doc = newDoc([block]);
    const store = new YorkieCommentStore(doc, { newId: makeIds(), now: makeNow() });
    const t = await store.addThread(
      { startPath: [0, 0, 6], endPath: [0, 0, 11], blockId: block.id, quotedText: 'world' },
      'q',
      alice,
    );

    // Delete just "wo" from "world" (positions 6-8).
    doc.update((root) => {
      root.content.editByPath([0, 0, 6], [0, 0, 8]);
    });

    const res = resolveDocsAnchor(doc.getRoot().content, t.anchor);
    assert.equal(res.kind, 'live', 'partial deletion must keep the anchor live');
  });

  it('deleting the entire anchored block reports orphan', async () => {
    const block = makeBlock('Hello world');
    const second = makeBlock('keep me');
    const doc = newDoc([block, second]);
    const store = new YorkieCommentStore(doc, { newId: makeIds(), now: makeNow() });
    const t = await store.addThread(
      { startPath: [0, 0, 6], endPath: [0, 0, 11], blockId: block.id, quotedText: 'world' },
      'q',
      alice,
    );

    // Delete the whole first block (between path [0] and [1]).
    doc.update((root) => {
      root.content.editByPath([0], [1]);
    });

    const res = resolveDocsAnchor(doc.getRoot().content, t.anchor);
    assert.equal(res.kind, 'orphan');
  });
});

describe('YorkieCommentStore — subscribe', () => {
  it('fires on local mutations and unsubscribes cleanly', async () => {
    const doc = newDoc([makeBlock('hi')]);
    const store = new YorkieCommentStore(doc, { newId: makeIds(), now: makeNow() });
    let calls = 0;
    const unsub = store.subscribe(() => {
      calls++;
    });
    const t = await store.addThread(
      { startPath: [0, 0, 0], endPath: [0, 0, 2], blockId: 'b', quotedText: 'hi' },
      'root',
      alice,
    );
    await store.addReply(t.id, 'reply', bob);
    assert.ok(calls >= 2, `expected ≥2 subscribe calls, got ${calls}`);
    const before = calls;
    unsub();
    await store.setThreadResolved(t.id, true, bob);
    assert.equal(calls, before, 'no further calls after unsubscribe');
  });
});
