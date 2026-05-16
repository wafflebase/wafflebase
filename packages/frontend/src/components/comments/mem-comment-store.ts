import type { CommentStore } from './comment-store.ts';
import {
  addReply as addReplyPure,
  createThread,
  deleteComment as deleteCommentPure,
  editComment as editCommentPure,
  setThreadResolved as setThreadResolvedPure,
} from './thread.ts';
import type {
  Comment,
  CommentAnchor,
  CommentAuthor,
  Thread,
} from './types.ts';

export interface MemCommentStoreOptions {
  newId?: () => string;
  now?: () => number;
}

function defaultId(): string {
  return Math.random().toString(36).slice(2);
}

export class MemCommentStore<A extends CommentAnchor = CommentAnchor>
  implements CommentStore<A>
{
  private threads = new Map<string, Thread<A>>();
  private subscribers = new Set<() => void>();
  private readonly newId: () => string;
  private readonly now: () => number;

  constructor(opts: MemCommentStoreOptions = {}) {
    this.newId = opts.newId ?? defaultId;
    this.now = opts.now ?? (() => Date.now());
  }

  async addThread(
    anchor: A,
    body: string,
    author: CommentAuthor,
  ): Promise<Thread<A>> {
    const thread = createThread<A>(
      anchor,
      body,
      author,
      this.newId,
      this.newId,
      this.now,
    );
    this.threads.set(thread.id, thread);
    this.notify();
    return thread;
  }

  async addReply(
    threadId: string,
    body: string,
    author: CommentAuthor,
  ): Promise<Comment> {
    const thread = this.requireThread(threadId);
    const next = addReplyPure(thread, body, author, this.newId, this.now);
    this.threads.set(threadId, next);
    this.notify();
    return next.comments[next.comments.length - 1];
  }

  async editComment(
    threadId: string,
    commentId: string,
    body: string,
  ): Promise<void> {
    const thread = this.requireThread(threadId);
    const next = editCommentPure(thread, commentId, body, this.now);
    this.threads.set(threadId, next);
    this.notify();
  }

  async deleteComment(threadId: string, commentId: string): Promise<void> {
    const thread = this.requireThread(threadId);
    const next = deleteCommentPure(thread, commentId);
    if (next === null) {
      this.threads.delete(threadId);
    } else {
      this.threads.set(threadId, next);
    }
    this.notify();
  }

  async setThreadResolved(
    threadId: string,
    resolved: boolean,
    by: CommentAuthor,
  ): Promise<void> {
    const thread = this.requireThread(threadId);
    const next = setThreadResolvedPure(thread, resolved, by, this.now);
    this.threads.set(threadId, next);
    this.notify();
  }

  async listThreads(opts?: { resolved?: boolean }): Promise<Thread<A>[]> {
    const all = Array.from(this.threads.values());
    if (opts?.resolved === undefined) return all;
    return all.filter((t) => t.resolved === opts.resolved);
  }

  subscribe(cb: () => void): () => void {
    this.subscribers.add(cb);
    return () => {
      this.subscribers.delete(cb);
    };
  }

  private requireThread(threadId: string): Thread<A> {
    const t = this.threads.get(threadId);
    if (!t) throw new Error(`Thread not found: ${threadId}`);
    return t;
  }

  private notify(): void {
    for (const cb of this.subscribers) cb();
  }
}
