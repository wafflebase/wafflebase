import type {
  Comment,
  CommentAnchor,
  CommentAuthor,
  Thread,
} from './types.ts';

export interface CommentStore<A extends CommentAnchor = CommentAnchor> {
  addThread(anchor: A, body: string, author: CommentAuthor): Promise<Thread<A>>;
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
