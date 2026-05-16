import type { Document } from '@yorkie-js/react';

import type { CommentStore } from '@/components/comments/comment-store.ts';
import type {
  Comment,
  CommentAuthor,
  DocsRangeAnchor,
  Thread,
} from '@/types/comments.ts';
import type { YorkieDocsRoot } from '@/types/docs-document.ts';

/**
 * Caller-supplied input for `addThread`. The store fills in the
 * CRDT-stable `posRange` from the path endpoints; `blockId` and
 * `quotedText` are passed through verbatim (the caller has the
 * `Document` model and computes them with `extractAnchorContext`).
 */
export interface PendingDocsAnchor {
  startPath: number[];
  endPath: number[];
  blockId: string;
  quotedText: string;
}

export interface YorkieCommentStoreOptions {
  newId?: () => string;
  now?: () => number;
}

function defaultId(): string {
  return Math.random().toString(36).slice(2);
}

// Yorkie 0.7.x classifies every integer-valued JS number as
// PrimitiveType.Integer (32-bit). Coerce timestamps to BigInt so the SDK
// stores them as Long; convert back at the read boundary.
function toYorkieMs(ms: number): number {
  return BigInt(ms) as unknown as number;
}

function fromYorkieMs(value: number | bigint | undefined): number | undefined {
  if (value === undefined) return undefined;
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
    createdAt: fromYorkieMs(c.createdAt)!,
  };
  const editedAt = fromYorkieMs(c.editedAt);
  if (editedAt !== undefined) copy.editedAt = editedAt;
  return copy;
}

/**
 * Detach a Thread from its Yorkie CRDT proxy by deep-copying its
 * comments / author / timestamp fields into plain JS objects.
 *
 * `posRange` is deliberately left as-is. Stored as a Yorkie array, its
 * `toJSON()` returns a string-escaped serialization that does not
 * round-trip through `JSON.parse(JSON.stringify(...))` — the SDK's
 * `posRangeToPathRange` then can't read it. Holding the proxy
 * reference is safe: the Yorkie document outlives any thread snapshot
 * we hand out, and the only consumer (`resolveDocsAnchor`) calls a
 * read-only SDK method on it.
 */
export function copyDocsThread(
  t: Thread<DocsRangeAnchor>,
): Thread<DocsRangeAnchor> {
  const copy: Thread<DocsRangeAnchor> = {
    id: t.id,
    anchor: {
      kind: 'docs-range',
      blockId: t.anchor.blockId,
      posRange: t.anchor.posRange,
      quotedText: t.anchor.quotedText,
    },
    comments: Array.from(t.comments ?? []).map(copyComment),
    resolved: t.resolved,
    createdAt: fromYorkieMs(t.createdAt)!,
  };
  const resolvedAt = fromYorkieMs(t.resolvedAt);
  if (resolvedAt !== undefined) copy.resolvedAt = resolvedAt;
  if (t.resolvedBy !== undefined) copy.resolvedBy = copyAuthor(t.resolvedBy);
  return copy;
}

function assertNonEmptyBody(body: string): string {
  if (body.trim().length === 0) {
    throw new Error('Comment body cannot be empty');
  }
  return body;
}

export class YorkieCommentStore
  implements CommentStore<DocsRangeAnchor, PendingDocsAnchor>
{
  private readonly doc: Document<YorkieDocsRoot>;
  private readonly newId: () => string;
  private readonly now: () => number;
  private readonly subscribers = new Set<() => void>();
  private readonly unsubscribeRoot: () => void;

  constructor(
    doc: Document<YorkieDocsRoot>,
    opts: YorkieCommentStoreOptions = {},
  ) {
    this.doc = doc;
    this.newId = opts.newId ?? defaultId;
    this.now = opts.now ?? (() => Date.now());

    // Yorkie's subscribe fires after every change, local or remote.
    // Over-notification on tree-only edits is acceptable — listThreads is
    // cheap and the UI debounces.
    const off = this.doc.subscribe(() => {
      this.notify();
    });
    this.unsubscribeRoot = off as unknown as () => void;
  }

  dispose(): void {
    this.unsubscribeRoot();
    this.subscribers.clear();
  }

  async addThread(
    input: PendingDocsAnchor,
    body: string,
    author: CommentAuthor,
  ): Promise<Thread<DocsRangeAnchor>> {
    const text = assertNonEmptyBody(body);
    const threadId = this.newId();
    const rootCommentId = this.newId();
    const ts = this.now();

    this.doc.update((root) => {
      const tree = root.content;
      const posRange = tree.pathRangeToPosRange([input.startPath, input.endPath]);
      if (!root.comments) root.comments = {};
      root.comments[threadId] = {
        id: threadId,
        anchor: {
          kind: 'docs-range',
          blockId: input.blockId,
          posRange,
          quotedText: input.quotedText,
        },
        comments: [
          {
            id: rootCommentId,
            author: copyAuthor(author),
            body: text,
            createdAt: toYorkieMs(ts),
          },
        ],
        resolved: false,
        createdAt: toYorkieMs(ts),
      };
    });

    const stored = this.doc.getRoot().comments?.[threadId];
    if (!stored) {
      throw new Error('addThread: thread vanished after insert');
    }
    return copyDocsThread(stored);
  }

  async addReply(
    threadId: string,
    body: string,
    author: CommentAuthor,
  ): Promise<Comment> {
    const text = assertNonEmptyBody(body);
    const reply: Comment = {
      id: this.newId(),
      author: copyAuthor(author),
      body: text,
      createdAt: toYorkieMs(this.now()),
    };

    this.doc.update((root) => {
      const t = this.requireThread(root, threadId);
      t.comments.push(reply);
    });

    return copyComment(reply);
  }

  async editComment(
    threadId: string,
    commentId: string,
    body: string,
  ): Promise<void> {
    const text = assertNonEmptyBody(body);
    const editedAt = toYorkieMs(this.now());

    this.doc.update((root) => {
      const t = this.requireThread(root, threadId);
      const c = t.comments.find((x) => x.id === commentId);
      if (!c) throw new Error(`Comment not found: ${commentId}`);
      c.body = text;
      c.editedAt = editedAt;
    });
  }

  async deleteComment(threadId: string, commentId: string): Promise<void> {
    this.doc.update((root) => {
      const t = this.requireThread(root, threadId);
      const idx = t.comments.findIndex((c) => c.id === commentId);
      if (idx < 0) throw new Error(`Comment not found: ${commentId}`);
      if (idx === 0) {
        delete root.comments![threadId];
        return;
      }
      t.comments.splice(idx, 1);
    });
  }

  async setThreadResolved(
    threadId: string,
    resolved: boolean,
    by: CommentAuthor,
  ): Promise<void> {
    const ts = toYorkieMs(this.now());
    this.doc.update((root) => {
      const t = this.requireThread(root, threadId);
      t.resolved = resolved;
      if (resolved) {
        t.resolvedAt = ts;
        t.resolvedBy = copyAuthor(by);
      } else {
        delete t.resolvedAt;
        delete t.resolvedBy;
      }
    });
  }

  async listThreads(opts?: {
    resolved?: boolean;
  }): Promise<Thread<DocsRangeAnchor>[]> {
    const map = this.doc.getRoot().comments;
    if (!map) return [];
    const all = Object.values(map).map(copyDocsThread);
    if (opts?.resolved === undefined) return all;
    return all.filter((t) => t.resolved === opts.resolved);
  }

  subscribe(cb: () => void): () => void {
    this.subscribers.add(cb);
    return () => {
      this.subscribers.delete(cb);
    };
  }

  private requireThread(
    root: YorkieDocsRoot,
    threadId: string,
  ): Thread<DocsRangeAnchor> {
    const thread = root.comments?.[threadId];
    if (!thread) throw new Error(`Thread not found: ${threadId}`);
    return thread as Thread<DocsRangeAnchor>;
  }

  private notify(): void {
    for (const cb of this.subscribers) cb();
  }
}
