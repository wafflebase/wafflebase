import { useState } from "react";
import { Button } from "@/components/ui/button";
import { CommentComposer } from "./CommentComposer";
import type { Thread, CommentAuthor } from "@wafflebase/sheets";

type Props = {
  threads: Thread[];
  currentUser: CommentAuthor | null;
  onAddThread: (body: string) => Promise<void>;
  onReply: (threadId: string, body: string) => Promise<void>;
  onResolve: (threadId: string) => Promise<void>;
  onEditComment: (
    threadId: string,
    commentId: string,
    body: string,
  ) => Promise<void>;
  onDeleteComment: (threadId: string, commentId: string) => Promise<void>;
  onClose: () => void;
};

/**
 * Popover that lists all open threads on the active cell and provides
 * controls to reply, resolve, edit, and delete comments.
 */
export function CommentPopover({
  threads,
  currentUser,
  onAddThread,
  onReply,
  onResolve,
  onEditComment,
  onDeleteComment,
  onClose,
}: Props) {
  const [editingCommentId, setEditingCommentId] = useState<string | null>(null);
  const [replyingToThreadId, setReplyingToThreadId] = useState<string | null>(
    null,
  );
  const isReadOnly = currentUser === null;

  return (
    <div
      className="flex w-80 flex-col gap-3 rounded-lg border bg-background p-4 shadow-lg"
      role="dialog"
      aria-label="Comments"
    >
      <div className="flex items-center justify-between">
        <span className="text-sm font-semibold">Comments</span>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-6 w-6 p-0"
          onClick={onClose}
          aria-label="Close"
        >
          ×
        </Button>
      </div>

      {threads.map((thread) => (
        <article key={thread.id} className="flex flex-col gap-2 border-t pt-3">
          {thread.comments.map((c) => (
            <div key={c.id} className="flex flex-col gap-1">
              <header className="flex items-baseline gap-2 text-xs text-muted-foreground">
                <strong className="font-medium text-foreground">
                  {c.author.username}
                </strong>
                <time>{new Date(c.createdAt).toLocaleString()}</time>
                {c.editedAt && <span>(edited)</span>}
              </header>

              {editingCommentId === c.id ? (
                <CommentComposer
                  initialBody={c.body}
                  submitLabel="Save"
                  onSubmit={async (body) => {
                    await onEditComment(thread.id, c.id, body);
                    setEditingCommentId(null);
                  }}
                  onCancel={() => setEditingCommentId(null)}
                  autoFocus
                />
              ) : (
                <p className="text-sm whitespace-pre-wrap">{c.body}</p>
              )}

              {!isReadOnly &&
                currentUser.userId === c.author.userId &&
                editingCommentId !== c.id && (
                  <div className="flex gap-2">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-6 px-2 text-xs"
                      onClick={() => setEditingCommentId(c.id)}
                    >
                      Edit
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-6 px-2 text-xs text-destructive hover:text-destructive"
                      onClick={() => onDeleteComment(thread.id, c.id)}
                    >
                      Delete
                    </Button>
                  </div>
                )}
            </div>
          ))}

          {!isReadOnly && (
            <div className="flex flex-col gap-2 pt-1">
              {replyingToThreadId === thread.id ? (
                <CommentComposer
                  submitLabel="Reply"
                  onSubmit={async (body) => {
                    await onReply(thread.id, body);
                    setReplyingToThreadId(null);
                  }}
                  onCancel={() => setReplyingToThreadId(null)}
                  autoFocus
                />
              ) : (
                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-7 text-xs"
                    onClick={() => setReplyingToThreadId(thread.id)}
                  >
                    Reply
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-7 text-xs"
                    onClick={() => onResolve(thread.id)}
                  >
                    Resolve
                  </Button>
                </div>
              )}
            </div>
          )}
        </article>
      ))}

      {threads.length === 0 && !isReadOnly && (
        <CommentComposer
          submitLabel="Comment"
          onSubmit={(body) => onAddThread(body)}
          autoFocus
        />
      )}

      {isReadOnly && threads.length === 0 && (
        <p className="text-sm text-muted-foreground">
          Sign in to leave a comment.
        </p>
      )}
    </div>
  );
}
