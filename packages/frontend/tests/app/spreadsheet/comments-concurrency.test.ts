/**
 * Yorkie concurrent integration tests for cell comments.
 *
 * Each test creates two real Yorkie clients sharing the same document and
 * verifies that comment operations converge correctly under concurrency.
 *
 * Requires a running Yorkie server:
 *   docker compose up -d
 *   YORKIE_RPC_ADDR=http://localhost:8080 pnpm frontend test:integration
 */
import { describe, it, expect } from 'vitest';

import { createTwoUserSpreadsheet } from '../../helpers/two-user-spreadsheet-yorkie.ts';
import type { CommentAuthor } from '@wafflebase/sheets';

const shouldRun = Boolean(process.env.YORKIE_RPC_ADDR);

const authorA: CommentAuthor = { userId: 'u-a', username: 'alice' };
const authorB: CommentAuthor = { userId: 'u-b', username: 'bob' };

describe('comments concurrency', { skip: !shouldRun }, () => {
  /**
   * Scenario 1: Two clients add a thread to the same cell concurrently.
   * Both threads must be preserved after sync.
   */
  it('two threads added concurrently to the same cell are both preserved', async () => {
    const ctx = await createTwoUserSpreadsheet('thread-add-add');
    try {
      const rowIds = ctx.storeA.getRowOrder();
      const colIds = ctx.storeA.getColOrder();
      const anchor = {
        kind: 'sheet-cell' as const,
        tabId: ctx.tabId,
        rowId: rowIds[0],
        colId: colIds[0],
      };

      const [tA, tB] = await Promise.all([
        ctx.storeA.addThread(anchor, 'from A', authorA),
        ctx.storeB.addThread(anchor, 'from B', authorB),
      ]);
      await ctx.sync();

      const threadsA = await ctx.storeA.listThreads();
      const threadsB = await ctx.storeB.listThreads();

      // Both sides must have converged to the same state.
      const idsA = threadsA.map((t) => t.id).sort();
      const idsB = threadsB.map((t) => t.id).sort();
      expect(idsA, 'both clients must converge').toEqual(idsB);

      // Both threads must be present.
      expect(idsA.includes(tA.id), 'thread from A must be present').toBeTruthy();
      expect(idsA.includes(tB.id), 'thread from B must be present').toBeTruthy();
      expect(idsA.length, 'exactly two threads expected').toBe(2);
    } finally {
      await ctx.cleanup();
    }
  });

  /**
   * Scenario 2: Two clients add a reply to the same thread concurrently.
   * Both replies must be preserved after sync.
   */
  it('two replies added concurrently to the same thread are both preserved', async () => {
    const ctx = await createTwoUserSpreadsheet('reply-add-add');
    try {
      const rowIds = ctx.storeA.getRowOrder();
      const colIds = ctx.storeA.getColOrder();
      const anchor = {
        kind: 'sheet-cell' as const,
        tabId: ctx.tabId,
        rowId: rowIds[0],
        colId: colIds[0],
      };

      // Seed: create a thread on A and sync so both clients see it.
      const thread = await ctx.storeA.addThread(anchor, 'root comment', authorA);
      await ctx.sync();

      // Concurrent: both clients reply to the same thread.
      const [replyA, replyB] = await Promise.all([
        ctx.storeA.addReply(thread.id, 'reply from A', authorA),
        ctx.storeB.addReply(thread.id, 'reply from B', authorB),
      ]);
      await ctx.sync();

      const threadsA = await ctx.storeA.listThreads();
      const threadsB = await ctx.storeB.listThreads();

      expect(threadsA.length).toBe(1);
      expect(threadsB.length).toBe(1);

      // Same comment IDs on both sides.
      const commentIdsA = threadsA[0].comments.map((c) => c.id).sort();
      const commentIdsB = threadsB[0].comments.map((c) => c.id).sort();
      expect(commentIdsA, 'both clients must converge').toEqual(commentIdsB);

      // Root comment + 2 replies = 3 total.
      expect(commentIdsA.length, 'root + two replies expected').toBe(3);
      expect(commentIdsA.includes(replyA.id), 'reply from A must be present').toBeTruthy();
      expect(commentIdsA.includes(replyB.id), 'reply from B must be present').toBeTruthy();
    } finally {
      await ctx.cleanup();
    }
  });

  /**
   * Scenario 3: One client deletes a row while the other edits a comment
   * anchored to that row. After sync the row delete wins and the orphan
   * thread is auto-deleted (Task 7 orphan cleanup).
   */
  it('row delete cascades to orphan thread even when other client edits it', async () => {
    const ctx = await createTwoUserSpreadsheet('row-delete-cascade');
    try {
      const rowIds = ctx.storeA.getRowOrder();
      const colIds = ctx.storeA.getColOrder();
      // Add a thread anchored to row index 0.
      const anchor = {
        kind: 'sheet-cell' as const,
        tabId: ctx.tabId,
        rowId: rowIds[0],
        colId: colIds[0],
      };

      const thread = await ctx.storeA.addThread(anchor, 'original comment', authorA);
      await ctx.sync();

      // Concurrent: A deletes row 0; B edits the comment anchored there.
      await Promise.all([
        ctx.storeA.shiftCells('row', 0, -1),
        ctx.storeB.editComment(thread.id, thread.comments[0].id, 'edited body'),
      ]);
      await ctx.sync();

      // Both sides must converge — the thread is orphaned and removed.
      const threadsA = await ctx.storeA.listThreads();
      const threadsB = await ctx.storeB.listThreads();

      const idsA = threadsA.map((t) => t.id).sort();
      const idsB = threadsB.map((t) => t.id).sort();
      expect(idsA, 'both clients must converge').toEqual(idsB);
      expect(
        !idsA.includes(thread.id),
        'orphan thread must be removed after row delete'
      ).toBeTruthy();
    } finally {
      await ctx.cleanup();
    }
  });

  /**
   * Scenario 4: Two clients resolve the same thread concurrently.
   * After sync both sides must converge to a resolved state.
   */
  it('concurrent resolve of the same thread converges to resolved', async () => {
    const ctx = await createTwoUserSpreadsheet('concurrent-resolve');
    try {
      const rowIds = ctx.storeA.getRowOrder();
      const colIds = ctx.storeA.getColOrder();
      const anchor = {
        kind: 'sheet-cell' as const,
        tabId: ctx.tabId,
        rowId: rowIds[0],
        colId: colIds[0],
      };

      const thread = await ctx.storeA.addThread(anchor, 'needs resolving', authorA);
      await ctx.sync();

      // Both clients resolve the same thread concurrently.
      await Promise.all([
        ctx.storeA.setThreadResolved(thread.id, true, authorA),
        ctx.storeB.setThreadResolved(thread.id, true, authorB),
      ]);
      await ctx.sync();

      const threadsA = await ctx.storeA.listThreads();
      const threadsB = await ctx.storeB.listThreads();

      expect(threadsA.length).toBe(1);
      expect(threadsB.length).toBe(1);

      // Both must agree: thread is resolved.
      expect(threadsA[0].resolved, 'thread must be resolved on A').toBe(true);
      expect(threadsB[0].resolved, 'thread must be resolved on B').toBe(true);
      expect(threadsA[0].id, 'both sides point to the same thread').toBe(threadsB[0].id);
    } finally {
      await ctx.cleanup();
    }
  });
});
