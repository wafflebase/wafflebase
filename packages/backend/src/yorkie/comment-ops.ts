import { randomUUID } from 'node:crypto';
import {
  addReply,
  createThread,
  deleteComment,
  setThreadResolved,
} from '@wafflebase/sheets';
import type {
  Comment,
  CommentAnchor,
  CommentAuthor,
  Thread,
} from '@wafflebase/sheets';
import { detachYorkieValue } from './yorkie-json';

/**
 * Comment-thread operations over the map a document stores its threads in.
 *
 * Comments live only inside the Yorkie CRDT — no table, no service — so the
 * `/api/v1` comment routes are the first backend code that writes them. The
 * map is `sheets[tabId].comments` for a spreadsheet and `root.comments` for a
 * word-processor document or a PDF, but the *thread* shape is identical in all
 * three (`@wafflebase/sheets` owns the canonical `Thread`), so every function
 * here takes the map rather than the root and works both on a Yorkie proxy
 * inside `doc.update` and on a plain object in a unit test.
 *
 * **Every thread rule comes from `@wafflebase/sheets`' `comment/thread.ts`** —
 * `createThread`, `addReply`, `deleteComment` (deleting the opening comment
 * deletes the conversation) and `setThreadResolved` — which is the module the
 * editor's own stores use. This file is only the CRDT-shaped shell around
 * them: the engine functions are value-returning (they build a *new* thread),
 * and a Yorkie write has to mutate the live proxy in place instead, or the
 * assignment would replace the whole thread and clobber a concurrent reply.
 * So each `apply*` below asks the engine what the result should be and then
 * writes the difference onto the proxy. No rule is restated here.
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
 *
 * The anchor goes through {@link detachYorkieValue} rather than a spread. A
 * spread copies only the top level, so the *nested* values of the anchor
 * shapes that have them — a PDF region's `rect`, a docs range's `posRange` —
 * would stay live Yorkie proxies and reach `res.json()`, which is exactly the
 * bug `pdf-comment-store.ts`'s field-by-field `copyAnchor` exists to prevent.
 * A recursive walk covers all three anchor shapes without this module having
 * to know any of them.
 */
export function copyThread(t: AnyThread): AnyThread {
  const copy: AnyThread = {
    id: t.id,
    anchor: (detachYorkieValue(t.anchor) ?? {}) as AnyAnchor,
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
 * Build a thread with one root comment, through the engine's own
 * `createThread`. Ids are UUIDs, matching what the editor's stores mint, and
 * `now` is handed over already at the Yorkie boundary so the timestamps the
 * engine writes are `Long`s — the returned value is what gets assigned into
 * the map.
 */
export function buildThread(input: {
  anchor: AnyAnchor;
  body: string;
  author: CommentAuthor;
  now: number;
}): AnyThread {
  return createThread(
    input.anchor as unknown as CommentAnchor,
    input.body,
    copyAuthor(input.author),
    randomUUID,
    randomUUID,
    () => toYorkieMs(input.now),
  ) as unknown as AnyThread;
}

/**
 * A throwaway thread the engine's value-returning helpers can be applied to
 * when only their *result* for one comment is wanted. Never stored.
 */
function scratchThread(comments: Comment[] = []): Thread<AnyAnchor> {
  return {
    id: '',
    anchor: { kind: 'scratch' },
    comments,
    resolved: false,
    createdAt: 0,
  };
}

export function buildReply(input: {
  body: string;
  author: CommentAuthor;
  now: number;
}): Comment {
  // `addReply` owns the reply's shape and its non-empty-body rule; it returns
  // a whole new thread, and the reply is the only comment on the scratch one.
  const built = addReply(
    scratchThread() as unknown as Thread,
    input.body,
    copyAuthor(input.author),
    randomUUID,
    () => toYorkieMs(input.now),
  );
  return built.comments[built.comments.length - 1];
}

export function applyAddThread(map: ThreadMap, thread: AnyThread): void {
  map[thread.id] = thread;
}

export function applyAddReply(thread: AnyThread, reply: Comment): void {
  thread.comments.push(reply);
}

/**
 * Resolve or reopen, writing the fields `setThreadResolved` produces onto the
 * live proxy — the engine decides *which* fields a resolution carries and
 * that reopening drops them, this only lands the difference.
 */
export function applySetResolved(
  thread: AnyThread,
  resolved: boolean,
  by: CommentAuthor,
  now: number,
): void {
  const next = setThreadResolved(
    scratchThread() as unknown as Thread,
    resolved,
    copyAuthor(by),
    () => toYorkieMs(now),
  ) as unknown as AnyThread;
  thread.resolved = next.resolved;
  if (next.resolvedAt !== undefined) {
    thread.resolvedAt = next.resolvedAt;
  } else {
    delete thread.resolvedAt;
  }
  if (next.resolvedBy !== undefined) {
    thread.resolvedBy = next.resolvedBy;
  } else {
    delete thread.resolvedBy;
  }
}

/**
 * Remove one comment, asking the engine's `deleteComment` what that means: it
 * returns `null` when the *opening* comment goes, which is how the editor's
 * stores learn to delete the whole conversation rather than leave one with
 * nothing to anchor it.
 *
 * The decision runs on a detached copy and is then applied to the proxy in
 * place (a `splice`, not a reassignment), so a concurrent reply on the same
 * thread survives. Returns what happened so the route can report it instead
 * of answering "deleted" for a comment id that was never there.
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
  const remaining = deleteComment(
    scratchThread(copyThread(thread).comments) as unknown as Thread,
    commentId,
  );
  if (remaining === null) {
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

/**
 * The body to store, or `null` when there is nothing to store.
 *
 * "Nothing" is judged on the trimmed value but the body is kept **verbatim**,
 * which is `assertNonEmpty`'s rule in `@wafflebase/sheets`'
 * `comment/thread.ts`: the engine deliberately preserves newlines and
 * leading/trailing spaces *inside* non-empty content, so trimming here would
 * have made an API-written comment differ from the same text typed in the
 * editor. This is the type check the engine cannot do — it takes a `string`
 * and a JSON body may hold anything — plus its emptiness rule, expressed as a
 * `null` the route turns into a 400 rather than a thrown `Error`.
 */
export function normalizeBody(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  return raw.trim().length > 0 ? raw : null;
}
