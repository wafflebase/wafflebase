import { describe, it, expect } from 'vitest';
import { MemStore } from '../memory';
import type { CommentAnchor, CommentAuthor } from '../../comment/types';

const author: CommentAuthor = { userId: 'u1', username: 'alice' };
const anchor: CommentAnchor = {
  kind: 'sheet-cell',
  tabId: 't1',
  rowId: 'r1',
  colId: 'c1',
};

describe('MemStore comments', () => {
  it('creates a thread and lists it back', async () => {
    const store = new MemStore();
    const t = await store.addThread(anchor, 'hi', author);
    const all = await store.listThreads();
    expect(all).toHaveLength(1);
    expect(all[0].id).toBe(t.id);
    expect(all[0].comments[0].body).toBe('hi');
  });

  it('appends a reply', async () => {
    const store = new MemStore();
    const t = await store.addThread(anchor, 'root', author);
    await store.addReply(t.id, 'reply', author);
    const [thread] = await store.listThreads();
    expect(thread.comments.map((c) => c.body)).toEqual(['root', 'reply']);
  });

  it('deletes thread when root comment is deleted', async () => {
    const store = new MemStore();
    const t = await store.addThread(anchor, 'root', author);
    await store.deleteComment(t.id, t.comments[0].id);
    expect(await store.listThreads()).toEqual([]);
  });

  it('filters by resolved state', async () => {
    const store = new MemStore();
    const t1 = await store.addThread(anchor, 'one', author);
    const t2 = await store.addThread(anchor, 'two', author);
    await store.setThreadResolved(t1.id, true, author);
    expect((await store.listThreads({ resolved: false }))[0].id).toBe(t2.id);
    expect((await store.listThreads({ resolved: true }))[0].id).toBe(t1.id);
  });

  it('filters by cellAnchor', async () => {
    const store = new MemStore();
    const a1 = { ...anchor, rowId: 'r1', colId: 'c1' };
    const a2 = { ...anchor, rowId: 'r2', colId: 'c2' };
    await store.addThread(a1, 'on r1', author);
    await store.addThread(a2, 'on r2', author);
    const onR1 = await store.listThreads({ cellAnchor: { rowId: 'r1', colId: 'c1' } });
    expect(onR1).toHaveLength(1);
    expect(onR1[0].comments[0].body).toBe('on r1');
  });
});
