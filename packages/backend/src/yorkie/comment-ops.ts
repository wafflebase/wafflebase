import { randomUUID } from 'node:crypto';
import {
  addReply,
  createThread,
  deleteComment,
  editComment,
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

/**
 * Whether a map entry is a thread.
 *
 * **Not `Array.isArray(thread.comments)`.** A Yorkie array proxy wraps a
 * `CRDTArray`, not an array, so `Array.isArray` is false for every comment
 * list actually stored in a CRDT — the same trap `worksheet-charts.controller.ts`
 * documents for `detachYorkieValue`. Guarding on it made `listThreads` skip
 * every real thread and `findThread` return `undefined`, so the whole comments
 * API read empty against a live document while passing on plain-object
 * fixtures.
 *
 * Array-*likeness* is the test that holds on both sides: the proxy exposes a
 * numeric `length` (and `Symbol.iterator`, which is what `copyThread`'s
 * `Array.from` reads), and so does a plain array. A `toJSON`/`getID` function
 * surfaced by a key walk is not an object, so it is still rejected.
 */
function isThread(value: unknown): value is AnyThread {
  if (!value || typeof value !== 'object') return false;
  const comments = (value as { comments?: unknown }).comments;
  if (!comments || typeof comments !== 'object') return false;
  return typeof (comments as { length?: unknown }).length === 'number';
}

/** Every thread in the map, oldest first, detached from the CRDT proxy. */
export function listThreads(map: ThreadMap | undefined): AnyThread[] {
  if (!map) return [];
  const out: AnyThread[] = [];
  for (const id of Object.keys(map)) {
    const thread = map[id];
    if (!isThread(thread)) continue;
    out.push(copyThread(thread));
  }
  return out.sort((a, b) => a.createdAt - b.createdAt);
}

export function findThread(
  map: ThreadMap | undefined,
  threadId: string,
): AnyThread | undefined {
  const thread = map?.[threadId];
  return isThread(thread) ? thread : undefined;
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

/**
 * One comment of a thread, detached, or `undefined`.
 *
 * Detached rather than live because the only caller is an authorization check
 * that reads `author.userId` and then answers — handing it a proxy would let a
 * comparison run against a CRDT wrapper instead of a string.
 */
export function findComment(
  thread: AnyThread,
  commentId: string,
): Comment | undefined {
  return copyThread(thread).comments.find((c) => c.id === commentId);
}

/**
 * The `User.id` a comment is attributed to, as it was stored.
 *
 * `CommentAuthor.userId` is a string on purpose (the model is shared with
 * anonymous share-link sessions), so authorship is compared as a string and
 * never coerced — an author id that is not a `User.id` matches nobody rather
 * than matching user 0.
 */
export function commentAuthorId(comment: Comment | undefined): string | null {
  const raw = comment?.author?.userId;
  return typeof raw === 'string' && raw.length > 0 ? raw : null;
}

export function applyAddThread(map: ThreadMap, thread: AnyThread): void {
  map[thread.id] = thread;
}

export function applyAddReply(thread: AnyThread, reply: Comment): void {
  thread.comments.push(reply);
}

/**
 * Rewrite one comment's body, through the engine's own `editComment` (which
 * owns the non-empty-body rule and the `editedAt` stamp the editor renders
 * "(edited)" from).
 *
 * The engine builds a whole new thread; only the two fields that actually
 * changed are written onto the live comment, never a whole-comment
 * reassignment — replacing the element would clobber a concurrent write to a
 * sibling field the same way reassigning the thread would clobber a reply.
 * Returns the edited comment detached, or `undefined` when there is no such
 * comment.
 */
export function applyEditComment(
  thread: AnyThread,
  commentId: string,
  body: string,
  now: number,
): Comment | undefined {
  const index = thread.comments.findIndex((c) => c.id === commentId);
  if (index < 0) return undefined;
  const next = editComment(
    scratchThread(copyThread(thread).comments) as unknown as Thread,
    commentId,
    body,
    () => toYorkieMs(now),
  );
  const edited = next.comments[index];
  const target = thread.comments[index];
  target.body = edited.body;
  target.editedAt = edited.editedAt as number;
  return copyComment(edited);
}

/**
 * Resolve or reopen, writing the fields `setThreadResolved` produces onto the
 * live proxy — the engine decides *which* fields a resolution carries and
 * that reopening drops them, this only lands the difference.
 *
 * A drop is guarded on the key being *present*: Yorkie's object proxy routes
 * `delete` to `CRDTObject.deleteByKey` → `RHTPQMap.deleteByKey`, which throws
 * `fail to find <key>` for a key that was never set. Reopening a thread that
 * was never resolved is a perfectly ordinary request (`PATCH {resolved:false}`
 * is accepted on any thread), and it must not 500.
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
  } else if (thread.resolvedAt !== undefined) {
    delete thread.resolvedAt;
  }
  if (next.resolvedBy !== undefined) {
    thread.resolvedBy = next.resolvedBy;
  } else if (thread.resolvedBy !== undefined) {
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
