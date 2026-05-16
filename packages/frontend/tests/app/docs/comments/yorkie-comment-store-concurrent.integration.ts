/**
 * Multi-user concurrent integration tests for YorkieCommentStore.
 *
 * These tests verify that the comments JSON map on the docs Yorkie
 * document converges correctly under concurrent edits — concurrent
 * thread creation on the same range, concurrent replies, concurrent
 * resolve, and undo of anchor-text deletion restoring a live range.
 *
 * Requires a running Yorkie server:
 *   docker compose up -d
 *   YORKIE_RPC_ADDR=http://localhost:8080 pnpm frontend test:integration
 *
 * Gated by `YORKIE_RPC_ADDR` so the suite runs only when explicitly
 * enabled in CI / local integration runs.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { generateBlockId, DEFAULT_BLOCK_STYLE } from '@wafflebase/docs';
import type { Block } from '@wafflebase/docs';
import type { Document } from '@yorkie-js/react';

import { createTwoUserDocs } from '../../../helpers/two-user-docs-yorkie.ts';
import { YorkieCommentStore } from '../../../../src/app/docs/comments/yorkie-comment-store.ts';
import { resolveDocsAnchor } from '../../../../src/app/docs/comments/docs-anchor.ts';
import type { CommentAuthor } from '../../../../src/types/comments.ts';
import type { YorkieDocsRoot } from '../../../../src/types/docs-document.ts';

const shouldRun = Boolean(process.env.YORKIE_RPC_ADDR);

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

function ids(prefix: string) {
  let n = 0;
  return () => `${prefix}-${++n}`;
}

describe('YorkieCommentStore — concurrent', { skip: !shouldRun }, () => {
  it('concurrent addThread on the same range — both threads preserved', async () => {
    const block = makeBlock('Hello world');
    const ctx = await createTwoUserDocs('comments-concurrent-add', [block]);
    try {
      const storeA = new YorkieCommentStore(
        ctx.docA as Document<YorkieDocsRoot>,
        { newId: ids('a') },
      );
      const storeB = new YorkieCommentStore(
        ctx.docB as Document<YorkieDocsRoot>,
        { newId: ids('b') },
      );

      const sameRange = {
        startPath: [0, 0, 6],
        endPath: [0, 0, 11],
        blockId: block.id,
        quotedText: 'world',
      };

      const [tA, tB] = await Promise.all([
        storeA.addThread(sameRange, 'A says', alice),
        storeB.addThread(sameRange, 'B says', bob),
      ]);

      assert.notEqual(tA.id, tB.id, 'thread ids must differ');

      await ctx.sync();

      const listA = await storeA.listThreads();
      const listB = await storeB.listThreads();
      assert.equal(listA.length, 2);
      assert.equal(listB.length, 2);
      const idsA = listA.map((t) => t.id).sort();
      const idsB = listB.map((t) => t.id).sort();
      assert.deepEqual(idsA, idsB);
    } finally {
      await ctx.cleanup();
    }
  });

  it('concurrent replies on the same thread — both preserved', async () => {
    const block = makeBlock('Hello world');
    const ctx = await createTwoUserDocs('comments-concurrent-reply', [block]);
    try {
      const storeA = new YorkieCommentStore(
        ctx.docA as Document<YorkieDocsRoot>,
        { newId: ids('a') },
      );
      const storeB = new YorkieCommentStore(
        ctx.docB as Document<YorkieDocsRoot>,
        { newId: ids('b') },
      );

      const t = await storeA.addThread(
        {
          startPath: [0, 0, 6],
          endPath: [0, 0, 11],
          blockId: block.id,
          quotedText: 'world',
        },
        'root',
        alice,
      );
      await ctx.sync();

      await Promise.all([
        storeA.addReply(t.id, 'reply A', alice),
        storeB.addReply(t.id, 'reply B', bob),
      ]);
      await ctx.sync();

      const [storedA] = await storeA.listThreads();
      const [storedB] = await storeB.listThreads();
      assert.equal(storedA.comments.length, 3, 'root + 2 replies');
      assert.equal(storedB.comments.length, 3);
      const bodiesA = storedA.comments.map((c) => c.body).sort();
      const bodiesB = storedB.comments.map((c) => c.body).sort();
      assert.deepEqual(bodiesA, bodiesB);
      assert.deepEqual(bodiesA, ['reply A', 'reply B', 'root']);
    } finally {
      await ctx.cleanup();
    }
  });

  it('concurrent setThreadResolved — final state consistent (LWW)', async () => {
    const block = makeBlock('Hello world');
    const ctx = await createTwoUserDocs('comments-concurrent-resolve', [block]);
    try {
      const storeA = new YorkieCommentStore(
        ctx.docA as Document<YorkieDocsRoot>,
        { newId: ids('a') },
      );
      const storeB = new YorkieCommentStore(
        ctx.docB as Document<YorkieDocsRoot>,
        { newId: ids('b') },
      );

      const t = await storeA.addThread(
        {
          startPath: [0, 0, 6],
          endPath: [0, 0, 11],
          blockId: block.id,
          quotedText: 'world',
        },
        'root',
        alice,
      );
      await ctx.sync();

      await Promise.all([
        storeA.setThreadResolved(t.id, true, alice),
        storeB.setThreadResolved(t.id, false, bob),
      ]);
      await ctx.sync();

      const [stateA] = await storeA.listThreads();
      const [stateB] = await storeB.listThreads();
      assert.equal(stateA.resolved, stateB.resolved, 'replicas must converge');
    } finally {
      await ctx.cleanup();
    }
  });

  it('A deletes anchor block, B sees orphan; undo on A restores live', async () => {
    const block = makeBlock('Hello world');
    const filler = makeBlock('filler');
    const ctx = await createTwoUserDocs('comments-orphan-undo', [block, filler]);
    try {
      const docA = ctx.docA as Document<YorkieDocsRoot>;
      const docB = ctx.docB as Document<YorkieDocsRoot>;
      const storeA = new YorkieCommentStore(docA, { newId: ids('a') });
      const storeB = new YorkieCommentStore(docB, { newId: ids('b') });

      await storeA.addThread(
        {
          startPath: [0, 0, 6],
          endPath: [0, 0, 11],
          blockId: block.id,
          quotedText: 'world',
        },
        'root',
        alice,
      );
      await ctx.sync();

      // A deletes the first block (carrying the anchor).
      ctx.storeA.deleteBlock(block.id);
      await ctx.sync();

      const [seenByB] = await storeB.listThreads();
      const treeB = docB.getRoot().content;
      const resB = resolveDocsAnchor(treeB, seenByB.anchor);
      assert.equal(resB.kind, 'orphan', 'B should see the thread as orphan');

      // Undo on A puts the block back; B should see the anchor live again.
      ctx.storeA.undo();
      await ctx.sync();

      const treeB2 = docB.getRoot().content;
      const [seenByB2] = await storeB.listThreads();
      const resB2 = resolveDocsAnchor(treeB2, seenByB2.anchor);
      assert.equal(resB2.kind, 'live', 'after undo, B should see the anchor live again');
    } finally {
      await ctx.cleanup();
    }
  });
});
