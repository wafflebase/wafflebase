import type { Document } from "@yorkie-js/react";

import type { CommentStore } from "@/components/comments/comment-store.ts";
import type {
  BoardAnchor,
  Comment,
  CommentAuthor,
  Thread,
} from "@/types/comments.ts";
import type { YorkieBoardRoot } from "@/types/board-document.ts";

export interface BoardCommentStoreOptions {
  newId?: () => string;
  now?: () => number;
}

function defaultId(): string {
  return Math.random().toString(36).slice(2);
}

// Yorkie classifies integer-valued JS numbers as 32-bit Integer; store
// timestamps as BigInt (Long) and convert back at the read boundary.
export function toYorkieMs(ms: number): number {
  return BigInt(ms) as unknown as number;
}
export function fromYorkieMs(value: number | bigint | undefined): number | undefined {
  if (value === undefined) return undefined;
  return typeof value === "bigint" ? Number(value) : value;
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
 * Field-by-field copy: a spread would carry live Yorkie proxies out of the
 * CRDT (the bug the copy layer in `pdf-comment-store.ts` exists for), and
 * an undefined optional must not be written as a key.
 */
export function copyBoardAnchor(a: BoardAnchor): BoardAnchor {
  const copy: BoardAnchor = { kind: "board", x: Number(a.x), y: Number(a.y) };
  if (a.elementId !== undefined) copy.elementId = a.elementId;
  if (a.u !== undefined) copy.u = Number(a.u);
  if (a.v !== undefined) copy.v = Number(a.v);
  return copy;
}

/** Deep-copy a thread out of the Yorkie proxy into plain JS. */
export function copyBoardThread(t: Thread<BoardAnchor>): Thread<BoardAnchor> {
  const copy: Thread<BoardAnchor> = {
    id: t.id,
    anchor: copyBoardAnchor(t.anchor),
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
  if (body.trim().length === 0) throw new Error("Comment body cannot be empty");
  return body;
}

/**
 * Board comment threads at `root.comments[threadId]` — the same layout as
 * pdf and docs, so the backend's copy path (`stripComments`) already
 * drops them from a copied board.
 *
 * Writes open their own `doc.update`: they come from the comment panel
 * and composer, never from inside a `YorkieBoardStore.batch()`, so there
 * is no batch to nest into. Each write is its own Yorkie change, which
 * means the board's Mod+Z can undo the latest comment write like any
 * other local change — a known limitation of Yorkie's history, which has
 * no per-change opt-out.
 */
export class BoardCommentStore implements CommentStore<BoardAnchor> {
  private readonly doc: Document<YorkieBoardRoot>;
  private readonly newId: () => string;
  private readonly now: () => number;
  private readonly subscribers = new Set<() => void>();
  private readonly unsubscribeRoot: () => void;

  constructor(doc: Document<YorkieBoardRoot>, opts: BoardCommentStoreOptions = {}) {
    this.doc = doc;
    this.newId = opts.newId ?? defaultId;
    this.now = opts.now ?? (() => Date.now());
    // Content events only. Presence traffic (every peer cursor move on a
    // board) must not re-list the threads.
    const off = doc.subscribe((e: { type: string }) => {
      if (
        e.type === "local-change" ||
        e.type === "remote-change" ||
        e.type === "snapshot"
      ) {
        this.notify();
      }
    });
    this.unsubscribeRoot = off as unknown as () => void;
  }

  dispose(): void {
    this.unsubscribeRoot();
    this.subscribers.clear();
  }

  async addThread(
    anchor: BoardAnchor,
    body: string,
    author: CommentAuthor,
  ): Promise<Thread<BoardAnchor>> {
    const text = assertNonEmptyBody(body);
    const threadId = this.newId();
    const rootCommentId = this.newId();
    const ts = this.now();
    this.doc.update((root) => {
      // Seeded by `initialBoardRoot`; guarded for a board attached before
      // the seed existed.
      if (!root.comments) root.comments = {};
      root.comments[threadId] = {
        id: threadId,
        anchor: copyBoardAnchor(anchor),
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
    if (!stored) throw new Error("addThread: thread vanished after insert");
    return copyBoardThread(stored);
  }

  async addReply(threadId: string, body: string, author: CommentAuthor): Promise<Comment> {
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

  async setThreadResolved(threadId: string, resolved: boolean, by: CommentAuthor): Promise<void> {
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

  async listThreads(opts?: { resolved?: boolean }): Promise<Thread<BoardAnchor>[]> {
    return this.listThreadsSync(opts);
  }

  /** Synchronous read, for the canvas pin layer. */
  listThreadsSync(opts?: { resolved?: boolean }): Thread<BoardAnchor>[] {
    const map = this.doc.getRoot().comments;
    if (!map) return [];
    const all = Object.values(map)
      .filter((t) => t?.anchor?.kind === "board")
      .map(copyBoardThread)
      .sort((a, b) => a.createdAt - b.createdAt);
    if (opts?.resolved === undefined) return all;
    return all.filter((t) => t.resolved === opts.resolved);
  }

  subscribe(cb: () => void): () => void {
    this.subscribers.add(cb);
    return () => {
      this.subscribers.delete(cb);
    };
  }

  private requireThread(root: YorkieBoardRoot, threadId: string): Thread<BoardAnchor> {
    const thread = root.comments?.[threadId];
    if (!thread) throw new Error(`Thread not found: ${threadId}`);
    return thread as Thread<BoardAnchor>;
  }

  private notify(): void {
    for (const cb of this.subscribers) cb();
  }
}
