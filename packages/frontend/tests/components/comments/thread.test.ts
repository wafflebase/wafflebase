import { describe, it, expect } from 'vitest';

import {
  addReply,
  createThread,
  deleteComment,
  editComment,
  setThreadResolved,
} from '../../../src/components/comments/thread.ts';
import type {
  CommentAnchor,
  CommentAuthor,
  Thread,
} from '../../../src/components/comments/types.ts';

const author1: CommentAuthor = { userId: 'u1', username: 'alice' };
const author2: CommentAuthor = { userId: 'u2', username: 'bob' };

const cellAnchor: CommentAnchor = {
  kind: 'sheet-cell',
  tabId: 'tab1',
  rowId: 'r1',
  colId: 'c1',
};

function makeIds() {
  let n = 0;
  return () => `id-${++n}`;
}

function fixedTime(): () => number {
  let n = 1_000;
  return () => ++n;
}

describe('createThread', () => {
  it('initializes a thread with a single root comment', () => {
    const newId = makeIds();
    const t = createThread(cellAnchor, 'hello world', author1, newId, newId, () => 42);
    expect(t.resolved).toBe(false);
    expect(t.createdAt).toBe(42);
    expect(t.comments.length).toBe(1);
    expect(t.comments[0].body).toBe('hello world');
    expect(t.comments[0].author.userId).toBe('u1');
    expect(t.comments[0].createdAt).toBe(42);
    expect(t.comments[0].editedAt).toBe(undefined);
  });

  it('rejects an empty body (after trim)', () => {
    const newId = makeIds();
    expect(() => createThread(cellAnchor, '   \n  ', author1, newId, newId, () => 1)).toThrow(/empty/i);
  });

  it('accepts newlines inside a non-empty body', () => {
    const newId = makeIds();
    const t = createThread(cellAnchor, 'line1\nline2', author1, newId, newId, () => 1);
    expect(t.comments[0].body).toBe('line1\nline2');
  });
});

describe('addReply', () => {
  it('appends a reply preserving root', () => {
    const newId = makeIds();
    const now = fixedTime();
    const t = createThread(cellAnchor, 'root', author1, newId, newId, now);
    const t2 = addReply(t, 'reply', author2, newId, now);
    expect(t2.comments.length).toBe(2);
    expect(t2.comments[0].body).toBe('root');
    expect(t2.comments[1].body).toBe('reply');
    expect(t2.comments[1].author.userId).toBe('u2');
  });

  it('rejects empty reply body', () => {
    const newId = makeIds();
    const now = fixedTime();
    const t = createThread(cellAnchor, 'root', author1, newId, newId, now);
    expect(() => addReply(t, '   ', author2, newId, now)).toThrow(/empty/i);
  });
});

describe('editComment', () => {
  it('updates the body and sets editedAt strictly greater than createdAt', () => {
    const newId = makeIds();
    let now = 100;
    const t = createThread(cellAnchor, 'old', author1, newId, newId, () => now);
    const rootId = t.comments[0].id;
    now = 200;
    const t2 = editComment(t, rootId, 'new', () => now);
    const edited = t2.comments.find((c) => c.id === rootId)!;
    expect(edited.body).toBe('new');
    expect(edited.editedAt).toBe(200);
    expect((edited.editedAt as number) > edited.createdAt).toBeTruthy();
  });

  it('rejects empty body', () => {
    const newId = makeIds();
    const t = createThread(cellAnchor, 'root', author1, newId, newId, () => 1);
    const id = t.comments[0].id;
    expect(() => editComment(t, id, '   ', () => 2)).toThrow(/empty/i);
  });

  it('throws when commentId is unknown', () => {
    const newId = makeIds();
    const t = createThread(cellAnchor, 'root', author1, newId, newId, () => 1);
    expect(() => editComment(t, 'nope', 'x', () => 2)).toThrow(/not found/i);
  });
});

describe('deleteComment', () => {
  it('removes a reply but keeps the thread', () => {
    const newId = makeIds();
    const now = fixedTime();
    const t = createThread(cellAnchor, 'root', author1, newId, newId, now);
    const t2 = addReply(t, 'reply', author2, newId, now);
    const replyId = t2.comments[1].id;
    const t3 = deleteComment(t2, replyId);
    expect(t3).not.toBe(null);
    expect(t3!.comments.length).toBe(1);
    expect(t3!.comments[0].body).toBe('root');
  });

  it('returns null when the root comment is deleted', () => {
    const newId = makeIds();
    const t = createThread(cellAnchor, 'root', author1, newId, newId, () => 1);
    const rootId = t.comments[0].id;
    const t2 = deleteComment(t, rootId);
    expect(t2).toBe(null);
  });

  it('throws when commentId is unknown', () => {
    const newId = makeIds();
    const t = createThread(cellAnchor, 'root', author1, newId, newId, () => 1);
    expect(() => deleteComment(t, 'nope')).toThrow(/not found/i);
  });
});

describe('setThreadResolved', () => {
  it('sets resolved=true with resolvedBy and resolvedAt', () => {
    const newId = makeIds();
    const t = createThread(cellAnchor, 'root', author1, newId, newId, () => 1);
    const t2 = setThreadResolved(t, true, author2, () => 999);
    expect(t2.resolved).toBe(true);
    expect(t2.resolvedBy?.userId).toBe('u2');
    expect(t2.resolvedAt).toBe(999);
  });

  it('clears resolvedBy and resolvedAt when reopened', () => {
    const newId = makeIds();
    const t = createThread(cellAnchor, 'root', author1, newId, newId, () => 1);
    const closed = setThreadResolved(t, true, author2, () => 999);
    const reopened: Thread = setThreadResolved(closed, false, author1, () => 1500);
    expect(reopened.resolved).toBe(false);
    expect(reopened.resolvedBy).toBe(undefined);
    expect(reopened.resolvedAt).toBe(undefined);
  });
});
