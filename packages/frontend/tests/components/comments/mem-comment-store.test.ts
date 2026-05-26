import { describe, it, expect } from 'vitest';

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
    expect(list.length).toBe(1);
    expect(list[0].id).toBe(t.id);
    expect(list[0].comments[0].body).toBe('hi');
  });

  it('addReply appends to comments[]', async () => {
    const store = newStore();
    const t = await store.addThread(cellAnchor, 'root', alice);
    const reply = await store.addReply(t.id, 'reply', bob);
    const [stored] = await store.listThreads();
    expect(stored.comments.length).toBe(2);
    expect(stored.comments[1].id).toBe(reply.id);
    expect(stored.comments[1].body).toBe('reply');
  });

  it('editComment updates body and editedAt', async () => {
    const store = newStore();
    const t = await store.addThread(cellAnchor, 'orig', alice);
    const rootId = t.comments[0].id;
    await store.editComment(t.id, rootId, 'new');
    const [stored] = await store.listThreads();
    const edited = stored.comments.find((c) => c.id === rootId)!;
    expect(edited.body).toBe('new');
    expect(edited.editedAt !== undefined).toBeTruthy();
    expect((edited.editedAt as number) > edited.createdAt).toBeTruthy();
  });

  it('deleteComment of root removes the thread entirely', async () => {
    const store = newStore();
    const t = await store.addThread(cellAnchor, 'root', alice);
    await store.deleteComment(t.id, t.comments[0].id);
    const list = await store.listThreads();
    expect(list.length).toBe(0);
  });

  it('deleteComment of a reply keeps the thread', async () => {
    const store = newStore();
    const t = await store.addThread(cellAnchor, 'root', alice);
    const reply = await store.addReply(t.id, 'reply', bob);
    await store.deleteComment(t.id, reply.id);
    const [stored] = await store.listThreads();
    expect(stored.comments.length).toBe(1);
    expect(stored.comments[0].body).toBe('root');
  });

  it('setThreadResolved(true) marks resolved and filter listThreads', async () => {
    const store = newStore();
    const t = await store.addThread(cellAnchor, 'root', alice);
    await store.setThreadResolved(t.id, true, bob);
    const open = await store.listThreads({ resolved: false });
    const closed = await store.listThreads({ resolved: true });
    expect(open.length).toBe(0);
    expect(closed.length).toBe(1);
    expect(closed[0].resolvedBy?.userId).toBe('u2');
    expect(closed[0].resolvedAt !== undefined).toBeTruthy();
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
    expect(calls).toBe(3);
    unsub();
    await store.setThreadResolved(t.id, true, bob);
    expect(calls).toBe(3);
  });

  it('listThreads returns a snapshot (mutating it does not affect the store)', async () => {
    const store = newStore();
    await store.addThread(cellAnchor, 'root', alice);
    const list = await store.listThreads();
    list.length = 0;
    const refetched = await store.listThreads();
    expect(refetched.length).toBe(1);
  });
});
