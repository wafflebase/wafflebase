import type {
  Comment,
  CommentAnchor,
  CommentAuthor,
  Thread,
} from './types.ts';

function assertNonEmpty(body: string): string {
  if (body.trim().length === 0) {
    throw new Error('Comment body cannot be empty');
  }
  return body;
}

export function createThread<A extends CommentAnchor>(
  anchor: A,
  body: string,
  author: CommentAuthor,
  newThreadId: () => string,
  newCommentId: () => string,
  now: () => number,
): Thread<A> {
  const text = assertNonEmpty(body);
  const ts = now();
  return {
    id: newThreadId(),
    anchor,
    resolved: false,
    createdAt: ts,
    comments: [{ id: newCommentId(), author, body: text, createdAt: ts }],
  };
}

export function addReply<A extends CommentAnchor>(
  thread: Thread<A>,
  body: string,
  author: CommentAuthor,
  newCommentId: () => string,
  now: () => number,
): Thread<A> {
  const text = assertNonEmpty(body);
  const reply: Comment = {
    id: newCommentId(),
    author,
    body: text,
    createdAt: now(),
  };
  return { ...thread, comments: [...thread.comments, reply] };
}

export function editComment<A extends CommentAnchor>(
  thread: Thread<A>,
  commentId: string,
  body: string,
  now: () => number,
): Thread<A> {
  const text = assertNonEmpty(body);
  const idx = thread.comments.findIndex((c) => c.id === commentId);
  if (idx < 0) throw new Error(`Comment not found: ${commentId}`);
  const next = [...thread.comments];
  next[idx] = { ...next[idx], body: text, editedAt: now() };
  return { ...thread, comments: next };
}

/**
 * Returns null when the root comment is deleted — caller deletes the
 * whole thread. Otherwise returns the thread with the reply removed.
 */
export function deleteComment<A extends CommentAnchor>(
  thread: Thread<A>,
  commentId: string,
): Thread<A> | null {
  const idx = thread.comments.findIndex((c) => c.id === commentId);
  if (idx < 0) throw new Error(`Comment not found: ${commentId}`);
  if (idx === 0) return null;
  return {
    ...thread,
    comments: thread.comments.filter((c) => c.id !== commentId),
  };
}

export function setThreadResolved<A extends CommentAnchor>(
  thread: Thread<A>,
  resolved: boolean,
  by: CommentAuthor,
  now: () => number,
): Thread<A> {
  if (resolved) {
    return { ...thread, resolved: true, resolvedAt: now(), resolvedBy: by };
  }
  return {
    id: thread.id,
    anchor: thread.anchor,
    comments: thread.comments,
    createdAt: thread.createdAt,
    resolved: false,
  };
}
