import { useState } from "react";
import { Check, MoreHorizontal } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { formatRelativeTime } from "@/lib/utils";
import type {
  Comment,
  CommentAnchor,
  Thread,
} from "@/types/comments";

import { AuthorAvatar } from "./AuthorAvatar";
import { CommentBody } from "./CommentBody";
import { CommentComposer, type MentionMember } from "./CommentComposer";

type Props<A extends CommentAnchor> = {
  thread: Thread<A>;
  currentUserId?: string;
  /** When true, all mutation controls are hidden. */
  readOnly?: boolean;
  /** Autofocus the inline reply composer on mount. */
  autoFocusReply?: boolean;
  /** Workspace members for the reply/edit composers' @ mention dropdown. */
  members?: MentionMember[];
  onReply: (body: string) => Promise<void> | void;
  onResolveToggle: () => Promise<void> | void;
  onEdit: (commentId: string, body: string) => Promise<void> | void;
  onDelete: (commentId: string) => Promise<void> | void;
};

/**
 * Render one thread: root comment, replies (indented), action controls
 * on hover, always-visible inline reply composer. Used inside the
 * popover and the side panel. Anchor-agnostic.
 *
 * Layout matches the sheets popover: Resolve is a small icon on the
 * root header, Edit/Delete are behind a hover-revealed "more" menu, and
 * the reply box is always present so a single click on a marker is
 * enough to start typing.
 */
export function CommentThreadCard<A extends CommentAnchor>({
  thread,
  currentUserId,
  readOnly = false,
  autoFocusReply = false,
  members,
  onReply,
  onResolveToggle,
  onEdit,
  onDelete,
}: Props<A>) {
  const [editingCommentId, setEditingCommentId] = useState<string | null>(null);
  const [resolving, setResolving] = useState(false);
  const [rootComment, ...replyComments] = thread.comments;

  const handleResolveToggle = async () => {
    if (resolving) return;
    setResolving(true);
    try {
      await onResolveToggle();
    } catch {
      toast.error(
        thread.resolved
          ? "Couldn't reopen this thread. Please try again."
          : "Couldn't resolve this thread. Please try again.",
      );
    } finally {
      setResolving(false);
    }
  };

  const handleDelete = async (commentId: string) => {
    try {
      await onDelete(commentId);
    } catch {
      toast.error("Couldn't delete this comment. Please try again.");
    }
  };

  const renderComment = (c: Comment, isRoot: boolean) => {
    const canEditOrDelete =
      !readOnly &&
      currentUserId !== undefined &&
      c.author.userId === currentUserId &&
      editingCommentId !== c.id;
    const isEditing = editingCommentId === c.id;

    return (
      <div key={c.id} className="group flex flex-col gap-1">
        <header className="flex items-center gap-2 text-xs text-muted-foreground">
          <AuthorAvatar author={c.author} size="md" />
          <strong className="font-medium text-foreground">
            {c.author.username}
          </strong>
          <time>{formatRelativeTime(c.createdAt)}</time>
          {c.editedAt && c.editedAt > c.createdAt && <span>(edited)</span>}

          <div className="ml-auto flex items-center gap-0.5">
            {isRoot && !readOnly && currentUserId !== undefined && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-6 w-6 p-0"
                disabled={resolving}
                onClick={() => {
                  void handleResolveToggle();
                }}
                aria-label={thread.resolved ? "Reopen thread" : "Resolve thread"}
                title={thread.resolved ? "Reopen" : "Resolve"}
              >
                <Check className="h-3.5 w-3.5" />
              </Button>
            )}

            {canEditOrDelete && (
              <div className="invisible group-hover:visible group-focus-within:visible">
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-6 w-6 p-0"
                      aria-label="More actions"
                    >
                      <MoreHorizontal className="h-3.5 w-3.5" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onClick={() => setEditingCommentId(c.id)}>
                      Edit
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      className="text-destructive focus:text-destructive"
                      onClick={() => {
                        void handleDelete(c.id);
                      }}
                    >
                      Delete
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            )}
          </div>
        </header>

        {isEditing ? (
          <CommentComposer
            initialBody={c.body}
            submitLabel="Save"
            autoFocus
            compact
            members={members}
            onSubmit={async (body) => {
              await onEdit(c.id, body);
              setEditingCommentId(null);
            }}
            onCancel={() => setEditingCommentId(null)}
          />
        ) : (
          <CommentBody body={c.body} />
        )}
      </div>
    );
  };

  return (
    <article className="flex flex-col gap-2" aria-label="Comment thread">
      {rootComment && renderComment(rootComment, true)}

      {replyComments.length > 0 && (
        <div className="ml-4 flex flex-col gap-2 border-l pl-4">
          {replyComments.map((c) => renderComment(c, false))}
        </div>
      )}

      {!readOnly && currentUserId !== undefined && (
        <div className="ml-4 border-l pl-4">
          <CommentComposer
            submitLabel="Reply"
            onSubmit={onReply}
            compact
            autoFocus={autoFocusReply}
            members={members}
          />
        </div>
      )}
    </article>
  );
}
