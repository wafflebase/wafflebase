import type { Comment, CommentAnchor, CommentAuthor, Thread } from './types';

function assertNonEmpty(body: string): string {
  const trimmed = body.trim();
  if (trimmed.length === 0) {
    throw new Error('Comment body cannot be empty');
  }
  return body; // preserve newlines / leading-trailing spaces inside non-empty content
}

export function createThread(
  anchor: CommentAnchor,
  body: string,
  author: CommentAuthor,
  newThreadId: () => string,
  newCommentId: () => string,
  now: () => number,
): Thread {
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

export function addReply(
  thread: Thread,
  body: string,
  author: CommentAuthor,
  newCommentId: () => string,
  now: () => number,
): Thread {
  const text = assertNonEmpty(body);
  const reply: Comment = {
    id: newCommentId(),
    author,
    body: text,
    createdAt: now(),
  };
  return { ...thread, comments: [...thread.comments, reply] };
}

export function editComment(
  thread: Thread,
  commentId: string,
  body: string,
  now: () => number,
): Thread {
  const text = assertNonEmpty(body);
  const idx = thread.comments.findIndex((c) => c.id === commentId);
  if (idx < 0) throw new Error(`Comment not found: ${commentId}`);
  const next = [...thread.comments];
  next[idx] = { ...next[idx], body: text, editedAt: now() };
  return { ...thread, comments: next };
}

/**
 * Returns null when the root comment is deleted — caller should delete the
 * thread entry. Otherwise returns the thread with the reply removed.
 */
export function deleteComment(
  thread: Thread,
  commentId: string,
): Thread | null {
  const idx = thread.comments.findIndex((c) => c.id === commentId);
  if (idx < 0) throw new Error(`Comment not found: ${commentId}`);
  if (idx === 0) return null;
  return {
    ...thread,
    comments: thread.comments.filter((c) => c.id !== commentId),
  };
}

export function setThreadResolved(
  thread: Thread,
  resolved: boolean,
  by: CommentAuthor,
  now: () => number,
): Thread {
  if (resolved) {
    return { ...thread, resolved: true, resolvedAt: now(), resolvedBy: by };
  }
  const { resolvedAt: _a, resolvedBy: _b, ...rest } = thread;
  return { ...rest, resolved: false };
}
