import type { Comment, CommentAuthor, Thread, Worksheet } from '@wafflebase/sheets';

function ensureComments(ws: Worksheet): { [threadId: string]: Thread } {
  if (!ws.comments) ws.comments = {};
  return ws.comments;
}

export function applyAddThread(ws: Worksheet, thread: Thread): void {
  ensureComments(ws)[thread.id] = thread;
}

export function applyAddReply(
  ws: Worksheet,
  threadId: string,
  reply: Comment,
): void {
  const t = ws.comments?.[threadId];
  if (!t) throw new Error(`Thread not found: ${threadId}`);
  t.comments.push(reply);
}

export function applyEditComment(
  ws: Worksheet,
  threadId: string,
  commentId: string,
  body: string,
  editedAt: number,
): void {
  const t = ws.comments?.[threadId];
  if (!t) throw new Error(`Thread not found: ${threadId}`);
  const c = t.comments.find((x) => x.id === commentId);
  if (!c) throw new Error(`Comment not found: ${commentId}`);
  c.body = body;
  c.editedAt = editedAt;
}

/**
 * Removes the comment. If it was the root, the thread entry is removed
 * from the worksheet map.
 */
export function applyDeleteComment(
  ws: Worksheet,
  threadId: string,
  commentId: string,
): void {
  const t = ws.comments?.[threadId];
  if (!t) return;
  const idx = t.comments.findIndex((c) => c.id === commentId);
  if (idx < 0) return;
  if (idx === 0) {
    delete ws.comments![threadId];
    return;
  }
  t.comments.splice(idx, 1);
}

export function applyResolveThread(
  ws: Worksheet,
  threadId: string,
  resolved: boolean,
  by: CommentAuthor,
  ts: number,
): void {
  const t = ws.comments?.[threadId];
  if (!t) throw new Error(`Thread not found: ${threadId}`);
  t.resolved = resolved;
  if (resolved) {
    t.resolvedAt = ts;
    t.resolvedBy = by;
  } else {
    delete t.resolvedAt;
    delete t.resolvedBy;
  }
}
