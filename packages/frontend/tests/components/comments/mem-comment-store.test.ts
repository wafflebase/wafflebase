import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { MemCommentStore } from '../../../src/components/comments/mem-comment-store.ts';
import type {
  CommentAnchor,
  CommentAuthor,
} from '../../../src/components/comments/types.ts';

const alice: CommentAuthor = { userId: 'u1', username: 'alice' };
const bob: CommentAuthor = { userId: 'u2', username: 'bob' };

const cellAnchor: CommentAnchor = {
  kind: 'sheet-cell',
  tabId: 'tab1',
  rowId: 'r1',
  colId: 'c1',
};

function newStore() {
  let n = 0;
  let t = 1000;
  return new MemCommentStore<CommentAnchor>({
    newId: () => `id-${++n}`,
    now: () => ++t,
  });
}

describe('MemCommentStore', () => {
  it('addThread persists and listThreads returns it', async () => {
    const store = newStore();
    const t = await store.addThread(cellAnchor, 'hi', alice);
    const list = await store.listThreads();
    assert.equal(list.length, 1);
    assert.equal(list[0].id, t.id);
    assert.equal(list[0].comments[0].body, 'hi');
  });

  it('addReply appends to comments[]', async () => {
    const store = newStore();
    const t = await store.addThread(cellAnchor, 'root', alice);
    const reply = await store.addReply(t.id, 'reply', bob);
    const [stored] = await store.listThreads();
    assert.equal(stored.comments.length, 2);
    assert.equal(stored.comments[1].id, reply.id);
    assert.equal(stored.comments[1].body, 'reply');
  });

  it('editComment updates body and editedAt', async () => {
    const store = newStore();
    const t = await store.addThread(cellAnchor, 'orig', alice);
    const rootId = t.comments[0].id;
    await store.editComment(t.id, rootId, 'new');
    const [stored] = await store.listThreads();
    const edited = stored.comments.find((c) => c.id === rootId)!;
    assert.equal(edited.body, 'new');
    assert.ok(edited.editedAt !== undefined);
    assert.ok((edited.editedAt as number) > edited.createdAt);
  });

  it('deleteComment of root removes the thread entirely', async () => {
    const store = newStore();
    const t = await store.addThread(cellAnchor, 'root', alice);
    await store.deleteComment(t.id, t.comments[0].id);
    const list = await store.listThreads();
    assert.equal(list.length, 0);
  });

  it('deleteComment of a reply keeps the thread', async () => {
    const store = newStore();
    const t = await store.addThread(cellAnchor, 'root', alice);
    const reply = await store.addReply(t.id, 'reply', bob);
    await store.deleteComment(t.id, reply.id);
    const [stored] = await store.listThreads();
    assert.equal(stored.comments.length, 1);
    assert.equal(stored.comments[0].body, 'root');
  });

  it('setThreadResolved(true) marks resolved and filter listThreads', async () => {
    const store = newStore();
    const t = await store.addThread(cellAnchor, 'root', alice);
    await store.setThreadResolved(t.id, true, bob);
    const open = await store.listThreads({ resolved: false });
    const closed = await store.listThreads({ resolved: true });
    assert.equal(open.length, 0);
    assert.equal(closed.length, 1);
    assert.equal(closed[0].resolvedBy?.userId, 'u2');
    assert.ok(closed[0].resolvedAt !== undefined);
  });

  it('subscribe fires on every mutation; unsubscribe stops further events', async () => {
    const store = newStore();
    let calls = 0;
    const unsub = store.subscribe(() => {
      calls++;
    });
    const t = await store.addThread(cellAnchor, 'root', alice);
    await store.addReply(t.id, 'reply', bob);
    await store.editComment(t.id, t.comments[0].id, 'edited');
    assert.equal(calls, 3);
    unsub();
    await store.setThreadResolved(t.id, true, bob);
    assert.equal(calls, 3);
  });

  it('listThreads returns a snapshot (mutating it does not affect the store)', async () => {
    const store = newStore();
    await store.addThread(cellAnchor, 'root', alice);
    const list = await store.listThreads();
    list.length = 0;
    const refetched = await store.listThreads();
    assert.equal(refetched.length, 1);
  });
});
