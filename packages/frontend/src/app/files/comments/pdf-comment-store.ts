import type { Document } from '@yorkie-js/react';

import type { CommentStore } from '@/components/comments/comment-store.ts';
import type {
  Comment,
  CommentAuthor,
  PdfRegionAnchor,
  Thread,
} from '@/types/comments.ts';
import type { YorkiePdfRoot } from '@/types/pdf-document.ts';

export interface PdfCommentStoreOptions {
  newId?: () => string;
  now?: () => number;
}

function defaultId(): string {
  return Math.random().toString(36).slice(2);
}

// Yorkie classifies integer-valued JS numbers as 32-bit Integer; store
// timestamps as BigInt (Long) and convert back at the read boundary.
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

/** Deep-copy a thread out of the Yorkie proxy into plain JS. */
export function copyPdfThread(t: Thread<PdfRegionAnchor>): Thread<PdfRegionAnchor> {
  const copy: Thread<PdfRegionAnchor> = {
    id: t.id,
    anchor: {
      kind: 'pdf-region',
      pageIndex: t.anchor.pageIndex,
      rect: {
        x: t.anchor.rect.x,
        y: t.anchor.rect.y,
        w: t.anchor.rect.w,
        h: t.anchor.rect.h,
      },
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
  if (body.trim().length === 0) throw new Error('Comment body cannot be empty');
  return body;
}

export class PdfCommentStore implements CommentStore<PdfRegionAnchor> {
  private readonly doc: Document<YorkiePdfRoot>;
  private readonly newId: () => string;
  private readonly now: () => number;
  private readonly subscribers = new Set<() => void>();
  private readonly unsubscribeRoot: () => void;

  constructor(doc: Document<YorkiePdfRoot>, opts: PdfCommentStoreOptions = {}) {
    this.doc = doc;
    this.newId = opts.newId ?? defaultId;
    this.now = opts.now ?? (() => Date.now());
    const off = doc.subscribe(() => this.notify());
    this.unsubscribeRoot = off as unknown as () => void;
  }

  dispose(): void {
    this.unsubscribeRoot();
    this.subscribers.clear();
  }

  async addThread(
    anchor: PdfRegionAnchor,
    body: string,
    author: CommentAuthor,
  ): Promise<Thread<PdfRegionAnchor>> {
    const text = assertNonEmptyBody(body);
    const threadId = this.newId();
    const rootCommentId = this.newId();
    const ts = this.now();

    this.doc.update((root) => {
      // Seeded at bootstrap (initialPdfRoot); guard only for legacy docs.
      if (!root.comments) root.comments = {};
      root.comments[threadId] = {
        id: threadId,
        anchor: {
          kind: 'pdf-region',
          pageIndex: anchor.pageIndex,
          rect: { ...anchor.rect },
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
    if (!stored) throw new Error('addThread: thread vanished after insert');
    return copyPdfThread(stored);
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
      this.requireThread(root, threadId).comments.push(reply);
    });
    return copyComment(reply);
  }

  async editComment(threadId: string, commentId: string, body: string): Promise<void> {
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

  async listThreads(opts?: { resolved?: boolean }): Promise<Thread<PdfRegionAnchor>[]> {
    const map = this.doc.getRoot().comments;
    if (!map) return [];
    const all = Object.values(map).map(copyPdfThread);
    if (opts?.resolved === undefined) return all;
    return all.filter((t) => t.resolved === opts.resolved);
  }

  subscribe(cb: () => void): () => void {
    this.subscribers.add(cb);
    return () => {
      this.subscribers.delete(cb);
    };
  }

  private requireThread(root: YorkiePdfRoot, threadId: string): Thread<PdfRegionAnchor> {
    const thread = root.comments?.[threadId];
    if (!thread) throw new Error(`Thread not found: ${threadId}`);
    return thread as Thread<PdfRegionAnchor>;
  }

  private notify(): void {
    for (const cb of this.subscribers) cb();
  }
}
