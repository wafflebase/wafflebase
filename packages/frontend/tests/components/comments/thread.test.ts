import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

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
    assert.equal(t.resolved, false);
    assert.equal(t.createdAt, 42);
    assert.equal(t.comments.length, 1);
    assert.equal(t.comments[0].body, 'hello world');
    assert.equal(t.comments[0].author.userId, 'u1');
    assert.equal(t.comments[0].createdAt, 42);
    assert.equal(t.comments[0].editedAt, undefined);
  });

  it('rejects an empty body (after trim)', () => {
    const newId = makeIds();
    assert.throws(
      () => createThread(cellAnchor, '   \n  ', author1, newId, newId, () => 1),
      /empty/i,
    );
  });

  it('accepts newlines inside a non-empty body', () => {
    const newId = makeIds();
    const t = createThread(cellAnchor, 'line1\nline2', author1, newId, newId, () => 1);
    assert.equal(t.comments[0].body, 'line1\nline2');
  });
});

describe('addReply', () => {
  it('appends a reply preserving root', () => {
    const newId = makeIds();
    const now = fixedTime();
    const t = createThread(cellAnchor, 'root', author1, newId, newId, now);
    const t2 = addReply(t, 'reply', author2, newId, now);
    assert.equal(t2.comments.length, 2);
    assert.equal(t2.comments[0].body, 'root');
    assert.equal(t2.comments[1].body, 'reply');
    assert.equal(t2.comments[1].author.userId, 'u2');
  });

  it('rejects empty reply body', () => {
    const newId = makeIds();
    const now = fixedTime();
    const t = createThread(cellAnchor, 'root', author1, newId, newId, now);
    assert.throws(() => addReply(t, '   ', author2, newId, now), /empty/i);
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
    assert.equal(edited.body, 'new');
    assert.equal(edited.editedAt, 200);
    assert.ok((edited.editedAt as number) > edited.createdAt);
  });

  it('rejects empty body', () => {
    const newId = makeIds();
    const t = createThread(cellAnchor, 'root', author1, newId, newId, () => 1);
    const id = t.comments[0].id;
    assert.throws(() => editComment(t, id, '   ', () => 2), /empty/i);
  });

  it('throws when commentId is unknown', () => {
    const newId = makeIds();
    const t = createThread(cellAnchor, 'root', author1, newId, newId, () => 1);
    assert.throws(() => editComment(t, 'nope', 'x', () => 2), /not found/i);
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
    assert.notEqual(t3, null);
    assert.equal(t3!.comments.length, 1);
    assert.equal(t3!.comments[0].body, 'root');
  });

  it('returns null when the root comment is deleted', () => {
    const newId = makeIds();
    const t = createThread(cellAnchor, 'root', author1, newId, newId, () => 1);
    const rootId = t.comments[0].id;
    const t2 = deleteComment(t, rootId);
    assert.equal(t2, null);
  });

  it('throws when commentId is unknown', () => {
    const newId = makeIds();
    const t = createThread(cellAnchor, 'root', author1, newId, newId, () => 1);
    assert.throws(() => deleteComment(t, 'nope'), /not found/i);
  });
});

describe('setThreadResolved', () => {
  it('sets resolved=true with resolvedBy and resolvedAt', () => {
    const newId = makeIds();
    const t = createThread(cellAnchor, 'root', author1, newId, newId, () => 1);
    const t2 = setThreadResolved(t, true, author2, () => 999);
    assert.equal(t2.resolved, true);
    assert.equal(t2.resolvedBy?.userId, 'u2');
    assert.equal(t2.resolvedAt, 999);
  });

  it('clears resolvedBy and resolvedAt when reopened', () => {
    const newId = makeIds();
    const t = createThread(cellAnchor, 'root', author1, newId, newId, () => 1);
    const closed = setThreadResolved(t, true, author2, () => 999);
    const reopened: Thread = setThreadResolved(closed, false, author1, () => 1500);
    assert.equal(reopened.resolved, false);
    assert.equal(reopened.resolvedBy, undefined);
    assert.equal(reopened.resolvedAt, undefined);
  });
});
