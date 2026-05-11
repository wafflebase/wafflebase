import type { Comment, CommentAuthor, Thread, Worksheet } from '@wafflebase/sheets';

function ensureComments(ws: Worksheet): { [threadId: string]: Thread } {
  if (!ws.comments) ws.comments = {};
  return ws.comments;
}

// Yorkie 0.7.x classifies every integer-valued JS number as PrimitiveType.Integer
// (32-bit), so Date.now() (~1.78e12) gets truncated to its low 32 bits on the
// wire and remote peers decode timestamps like 1970-01-06. Coerce to bigint so
// Yorkie stores it as Long, then read it back as a JS number at the boundary.
function toYorkieMs(ms: number): number {
  return BigInt(ms) as unknown as number;
}

function fromYorkieMs(value: number | bigint): number {
  return typeof value === 'bigint' ? Number(value) : value;
}

function copyAuthor(a: CommentAuthor): CommentAuthor {
  const copy: CommentAuthor = { userId: a.userId, username: a.username };
  if (a.photo !== undefined) copy.photo = a.photo;
  return copy;
}

function copyComment(c: Comment): Comment {
  const copy: Comment = {
    id: c.id,
    author: copyAuthor(c.author),
    body: c.body,
    createdAt: fromYorkieMs(c.createdAt),
  };
  if (c.editedAt !== undefined) copy.editedAt = fromYorkieMs(c.editedAt);
  return copy;
}

/**
 * Detach a Thread from the Yorkie CRDT proxy by deep-copying its fields
 * into a plain JS object. structuredClone fails on CRDT proxies, so callers
 * that hand threads to React/Canvas code must go through this helper.
 */
export function copyThread(t: Thread): Thread {
  const copy: Thread = {
    id: t.id,
    anchor: {
      kind: t.anchor.kind,
      tabId: t.anchor.tabId,
      rowId: t.anchor.rowId,
      colId: t.anchor.colId,
    },
    comments: Array.from(t.comments ?? []).map(copyComment),
    resolved: t.resolved,
    createdAt: fromYorkieMs(t.createdAt),
  };
  if (t.resolvedAt !== undefined) copy.resolvedAt = fromYorkieMs(t.resolvedAt);
  if (t.resolvedBy !== undefined) copy.resolvedBy = copyAuthor(t.resolvedBy);
  return copy;
}

function withYorkieTimestamps(c: Comment): Comment {
  const next: Comment = {
    id: c.id,
    author: c.author,
    body: c.body,
    createdAt: toYorkieMs(c.createdAt),
  };
  if (c.editedAt !== undefined) next.editedAt = toYorkieMs(c.editedAt);
  return next;
}

export function applyAddThread(ws: Worksheet, thread: Thread): void {
  const stored: Thread = {
    ...thread,
    createdAt: toYorkieMs(thread.createdAt),
    comments: thread.comments.map(withYorkieTimestamps),
  };
  if (thread.resolvedAt !== undefined) {
    stored.resolvedAt = toYorkieMs(thread.resolvedAt);
  }
  ensureComments(ws)[thread.id] = stored;
}

export function applyAddReply(
  ws: Worksheet,
  threadId: string,
  reply: Comment,
): void {
  const t = ws.comments?.[threadId];
  if (!t) throw new Error(`Thread not found: ${threadId}`);
  t.comments.push(withYorkieTimestamps(reply));
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
  c.editedAt = toYorkieMs(editedAt);
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
    t.resolvedAt = toYorkieMs(ts);
    t.resolvedBy = by;
  } else {
    delete t.resolvedAt;
    delete t.resolvedBy;
  }
}
