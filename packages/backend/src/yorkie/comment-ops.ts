import { randomUUID } from 'node:crypto';
import type { Comment, CommentAuthor, Thread } from '@wafflebase/sheets';

/**
 * Pure comment-thread operations over the map a document stores its threads
 * in.
 *
 * Comments live only inside the Yorkie CRDT — no table, no service — so the
 * `/api/v1` comment routes are the first backend code that writes them. The
 * map is `sheets[tabId].comments` for a spreadsheet and `root.comments` for a
 * word-processor document or a PDF, but the *thread* shape is identical in all
 * three (`@wafflebase/sheets` owns the canonical `Thread`), so every function
 * here takes the map rather than the root and works both on a Yorkie proxy
 * inside `doc.update` and on a plain object in a unit test.
 *
 * The anchor is deliberately open. Sheets anchor on axis ids, docs on a pair
 * of CRDT tree positions, PDFs on page-relative geometry; none of that matters
 * to reply / resolve / delete, and thread creation is the only place a
 * concrete anchor is built (see `comments.controller.ts`).
 */

/** Any thread anchor — the discriminant is all these operations read. */
export type AnyAnchor = { kind: string } & Record<string, unknown>;

export type AnyThread = Thread<AnyAnchor>;

export type ThreadMap = { [threadId: string]: AnyThread };

/**
 * Yorkie 0.7.x classifies every integer-valued JS number as a 32-bit
 * integer, so a `Date.now()` stored as a plain number is truncated to its low
 * 32 bits and every peer decodes a 1970 date. The frontend comment stores all
 * coerce to `bigint` on write and back on read; a backend writer has to cross
 * the same boundary the same way or the editor renders the wrong date for a
 * thread the API created.
 */
export function toYorkieMs(ms: number): number {
  return BigInt(ms) as unknown as number;
}

export function fromYorkieMs(value: number | bigint): number {
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
 * Detach a thread from the Yorkie proxy into a plain object, converting the
 * `Long` timestamps back to numbers so the JSON response carries real dates.
 * The anchor is spread rather than field-copied: this one helper serves the
 * sheet, docs and PDF anchor shapes.
 */
export function copyThread(t: AnyThread): AnyThread {
  const copy: AnyThread = {
    id: t.id,
    anchor: { ...t.anchor } as AnyAnchor,
    comments: Array.from(t.comments ?? []).map(copyComment),
    resolved: !!t.resolved,
    createdAt: fromYorkieMs(t.createdAt),
  };
  if (t.resolvedAt !== undefined) copy.resolvedAt = fromYorkieMs(t.resolvedAt);
  if (t.resolvedBy !== undefined) copy.resolvedBy = copyAuthor(t.resolvedBy);
  return copy;
}

/** Every thread in the map, oldest first, detached from the CRDT proxy. */
export function listThreads(map: ThreadMap | undefined): AnyThread[] {
  if (!map) return [];
  const out: AnyThread[] = [];
  for (const id of Object.keys(map)) {
    const thread = map[id];
    // A Yorkie object proxy answers `toJSON`/`getID` with a truthy function,
    // so a key walk can surface entries that are not threads at all.
    if (!thread || typeof thread !== 'object' || !Array.isArray(thread.comments)) {
      continue;
    }
    out.push(copyThread(thread));
  }
  return out.sort((a, b) => a.createdAt - b.createdAt);
}

export function findThread(
  map: ThreadMap | undefined,
  threadId: string,
): AnyThread | undefined {
  const thread = map?.[threadId];
  if (!thread || typeof thread !== 'object' || !Array.isArray(thread.comments)) {
    return undefined;
  }
  return thread;
}

/**
 * Build a thread with one root comment. Ids are UUIDs, matching what the
 * editor's stores mint, and the timestamps are already at the Yorkie
 * boundary — the returned value is what gets assigned into the map.
 */
export function buildThread(input: {
  anchor: AnyAnchor;
  body: string;
  author: CommentAuthor;
  now: number;
}): AnyThread {
  const comment: Comment = {
    id: randomUUID(),
    author: copyAuthor(input.author),
    body: input.body,
    createdAt: toYorkieMs(input.now),
  };
  return {
    id: randomUUID(),
    anchor: input.anchor,
    comments: [comment],
    resolved: false,
    createdAt: toYorkieMs(input.now),
  };
}

export function buildReply(input: {
  body: string;
  author: CommentAuthor;
  now: number;
}): Comment {
  return {
    id: randomUUID(),
    author: copyAuthor(input.author),
    body: input.body,
    createdAt: toYorkieMs(input.now),
  };
}

export function applyAddThread(map: ThreadMap, thread: AnyThread): void {
  map[thread.id] = thread;
}

export function applyAddReply(thread: AnyThread, reply: Comment): void {
  thread.comments.push(reply);
}

export function applySetResolved(
  thread: AnyThread,
  resolved: boolean,
  by: CommentAuthor,
  now: number,
): void {
  thread.resolved = resolved;
  if (resolved) {
    thread.resolvedAt = toYorkieMs(now);
    thread.resolvedBy = copyAuthor(by);
  } else {
    delete thread.resolvedAt;
    delete thread.resolvedBy;
  }
}

/**
 * Remove one comment. Deleting the root comment (index 0) deletes the whole
 * thread, which is the rule the editor's stores follow — a thread whose
 * opening comment is gone has nothing left to anchor a conversation on.
 *
 * Returns what happened so the route can report it instead of answering
 * "deleted" for a comment id that was never there.
 */
export function applyDeleteComment(
  map: ThreadMap,
  threadId: string,
  commentId: string,
): 'not_found' | 'comment_deleted' | 'thread_deleted' {
  const thread = findThread(map, threadId);
  if (!thread) return 'not_found';
  const index = thread.comments.findIndex((c) => c.id === commentId);
  if (index < 0) return 'not_found';
  if (index === 0) {
    delete map[threadId];
    return 'thread_deleted';
  }
  thread.comments.splice(index, 1);
  return 'comment_deleted';
}

export function applyDeleteThread(map: ThreadMap, threadId: string): boolean {
  if (!findThread(map, threadId)) return false;
  delete map[threadId];
  return true;
}

/** Trimmed body, or `null` when there is nothing left after trimming. */
export function normalizeBody(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const body = raw.trim();
  return body.length > 0 ? body : null;
}
