import { describe, it, expect } from 'vitest';
import {
  createThread,
  addReply,
  editComment,
  deleteComment,
  setThreadResolved,
} from '../thread';
import type { CommentAnchor, CommentAuthor } from '../types';

const author1: CommentAuthor = { userId: 'u1', username: 'alice' };
const author2: CommentAuthor = { userId: 'u2', username: 'bob' };
const anchor: CommentAnchor = {
  kind: 'sheet-cell',
  tabId: 't1',
  rowId: 'r1',
  colId: 'c1',
};

describe('createThread', () => {
  it('creates a thread with one root comment', () => {
    const t = createThread(
      anchor,
      'hello',
      author1,
      () => 'tid',
      () => 'cid',
      () => 1000,
    );
    expect(t.id).toBe('tid');
    expect(t.anchor).toEqual(anchor);
    expect(t.resolved).toBe(false);
    expect(t.createdAt).toBe(1000);
    expect(t.comments).toHaveLength(1);
    expect(t.comments[0]).toEqual({
      id: 'cid',
      author: author1,
      body: 'hello',
      createdAt: 1000,
    });
  });

  it('rejects empty body after trim', () => {
    expect(() =>
      createThread(
        anchor,
        '   \n  ',
        author1,
        () => 'tid',
        () => 'cid',
        () => 1000,
      ),
    ).toThrow(/empty/i);
  });

  it('preserves newlines in body', () => {
    const t = createThread(
      anchor,
      'a\nb',
      author1,
      () => 'tid',
      () => 'cid',
      () => 1000,
    );
    expect(t.comments[0].body).toBe('a\nb');
  });
});

describe('addReply', () => {
  it('appends a reply comment', () => {
    let t = createThread(
      anchor,
      'root',
      author1,
      () => 'tid',
      () => 'c0',
      () => 1000,
    );
    t = addReply(
      t,
      'reply',
      author2,
      () => 'c1',
      () => 2000,
    );
    expect(t.comments).toHaveLength(2);
    expect(t.comments[1]).toEqual({
      id: 'c1',
      author: author2,
      body: 'reply',
      createdAt: 2000,
    });
  });

  it('rejects empty body', () => {
    const t = createThread(
      anchor,
      'root',
      author1,
      () => 'tid',
      () => 'c0',
      () => 1000,
    );
    expect(() =>
      addReply(
        t,
        '  ',
        author2,
        () => 'c1',
        () => 2000,
      ),
    ).toThrow(/empty/i);
  });
});

describe('editComment', () => {
  it('updates body and stamps editedAt', () => {
    let t = createThread(
      anchor,
      'old',
      author1,
      () => 'tid',
      () => 'c0',
      () => 1000,
    );
    t = editComment(t, 'c0', 'new', () => 5000);
    expect(t.comments[0].body).toBe('new');
    expect(t.comments[0].editedAt).toBe(5000);
  });

  it('throws for unknown commentId', () => {
    const t = createThread(
      anchor,
      'x',
      author1,
      () => 'tid',
      () => 'c0',
      () => 1000,
    );
    expect(() => editComment(t, 'missing', 'new', () => 2000)).toThrow(
      /not found/i,
    );
  });
});

describe('deleteComment', () => {
  it('returns null when root deleted (signals thread delete)', () => {
    const t = createThread(
      anchor,
      'root',
      author1,
      () => 'tid',
      () => 'c0',
      () => 1000,
    );
    expect(deleteComment(t, 'c0')).toBeNull();
  });

  it('removes a reply but keeps the thread', () => {
    let t = createThread(
      anchor,
      'root',
      author1,
      () => 'tid',
      () => 'c0',
      () => 1000,
    );
    t = addReply(
      t,
      'reply',
      author2,
      () => 'c1',
      () => 2000,
    );
    const result = deleteComment(t, 'c1');
    expect(result).not.toBeNull();
    expect(result!.comments).toHaveLength(1);
    expect(result!.comments[0].id).toBe('c0');
  });
});

describe('setThreadResolved', () => {
  it('marks resolved with author and timestamp', () => {
    let t = createThread(
      anchor,
      'x',
      author1,
      () => 'tid',
      () => 'c0',
      () => 1000,
    );
    t = setThreadResolved(t, true, author2, () => 5000);
    expect(t.resolved).toBe(true);
    expect(t.resolvedAt).toBe(5000);
    expect(t.resolvedBy).toEqual(author2);
  });

  it('clears resolution on reopen', () => {
    let t = createThread(
      anchor,
      'x',
      author1,
      () => 'tid',
      () => 'c0',
      () => 1000,
    );
    t = setThreadResolved(t, true, author2, () => 5000);
    t = setThreadResolved(t, false, author1, () => 6000);
    expect(t.resolved).toBe(false);
    expect(t.resolvedAt).toBeUndefined();
    expect(t.resolvedBy).toBeUndefined();
  });
});
