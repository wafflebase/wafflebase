import type {
  Comment,
  CommentAnchor,
  CommentAuthor,
  Thread,
} from './types.ts';

/**
 * `AnchorInput` is what the caller passes to addThread; `A` is what's
 * persisted. They are usually the same — sheets passes its stored
 * `sheet-cell` anchor directly. Docs differs: the caller passes path
 * endpoints that the Yorkie store turns into a CRDT-stable `posRange`
 * inside the same `doc.update()` transaction.
 */
export interface CommentStore<
  A extends CommentAnchor = CommentAnchor,
  AnchorInput = A,
> {
  addThread(input: AnchorInput, body: string, author: CommentAuthor): Promise<Thread<A>>;
  addReply(threadId: string, body: string, author: CommentAuthor): Promise<Comment>;
  editComment(threadId: string, commentId: string, body: string): Promise<void>;
  deleteComment(threadId: string, commentId: string): Promise<void>;
  setThreadResolved(
    threadId: string,
    resolved: boolean,
    by: CommentAuthor,
  ): Promise<void>;
  /**
   * Read threads. Filter by resolved state; anchor-based filtering belongs
   * to the UI because anchor resolution is a live tree operation.
   */
  listThreads(opts?: { resolved?: boolean }): Promise<Thread<A>[]>;
  /**
   * Subscribe to thread-set changes (add/remove/edit) from both local and
   * remote sources. Returns unsubscribe.
   */
  subscribe(cb: () => void): () => void;
}
